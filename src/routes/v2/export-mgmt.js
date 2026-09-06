/**
 * Export / batch-push management — legacy-engine + partner transaction push.
 *
 * Prefix: /api/v2/export/*
 */
import * as trajectoryDao from '../../dao/trajectory-dao.js';
import * as trajectoryPhaseDao from '../../dao/trajectory-phase-dao.js';
import * as screenshotDao from '../../dao/screenshot-dao.js';
import {
  LEGACY_ENGINE_FIELD_SCHEMA,
  LEGACY_ENGINE_EMITTED_TYPES,
  ACTION_TO_ENGINE_TYPE,
  exportStepsToLegacyEngine,
  mapStepToLegacyEngineOp,
} from '../../services/legacy-engine-export.js';
import {
  buildTransactionPayload,
  wrapTransactionList,
  TRANSACTION_SCHEMA_VERSION,
  TRANSACTION_ENVELOPE_FIELDS,
  EVENT_TYPE_NAME,
} from '../../services/transaction-export.js';
import {
  buildTransactionPayloadV3,
  wrapTransactionListV3,
  validatePageLevelCoverage,
  coverageBlocksPush,
  TRANSACTION_SCHEMA_VERSION_V3,
} from '../../services/transaction-export-v3.js';
import {
  requireAccessToken,
  resolveSystemProject,
  listPartnerProjects,
  listPartnerSystems,
  listPartnerSystemTree,
  listPartnerMenuPushSystems,
  pushImportDemand,
} from '../../services/partner-platform.js';
import {
  assertPushableForPartner,
  getRecordStatus,
  isPushableRecordStatus,
} from '../../services/export-push-gate.js';
import { asyncHandler, AppError } from '../../http/app-error.js';

function parseIdList(raw) {
  if (raw == null || raw === '') return [];
  if (Array.isArray(raw)) return raw.map((x) => Number(x)).filter((n) => Number.isFinite(n));
  return String(raw)
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n));
}

function parseBool(raw, defaultValue = false) {
  if (raw == null || raw === '') return defaultValue;
  if (typeof raw === 'boolean') return raw;
  return !['0', 'false', 'no', 'off'].includes(String(raw).trim().toLowerCase());
}

/**
 * 路由级错误归一：AppError 原样抛出（由 asyncHandler 渲染）；
 * 非 AppError（partner-platform / export-push-gate 抛出的带 statusCode/code/partner 的
 * 普通 Error）包装为 AppError，保持既有状态码与响应体形状不变。
 * @param {unknown} err caught error
 * @param {(e: object) => object} buildBody AppError.body 构造器
 * @returns {never} 恒抛出
 */
function rethrowRouteError(err, buildBody) {
  if (err instanceof AppError) throw err;
  throw new AppError(err.message, {
    code: err.code,
    status: err.statusCode || 500,
    body: buildBody(err),
  });
}

// partner 平台错误体：{ error, partner }
const partnerErrorBody = (e) => ({ error: e.message, partner: e.partner });

// 单交易路由错误体：附加可选 code / recordStatus
const statusAwareErrorBody = (e) => ({
  error: e.message,
  partner: e.partner,
  ...(e.code ? { code: e.code } : {}),
  ...(e.recordStatus !== undefined ? { recordStatus: e.recordStatus } : {}),
});

/**
 * Assemble only — do not mark is_export. V2 精简版：不携带 phases（截图/metadata 由 V3 承担）。
 * @param {object} traj trajectory row from DAO
 * @param {{ systemId?: number|string, projectId?: number|string }} root0 system/project context
 * @param {number|string} [root0.systemId] partner system id
 * @param {number|string} [root0.projectId] partner project id
 * @returns {Promise<object>} assembled transaction envelope
 */
async function buildOneTrajectory(traj, { systemId, projectId }) {
  const built = buildTransactionPayload(traj, { systemId, projectId });
  return {
    trajectoryId: traj.id,
    schemaVersion: TRANSACTION_SCHEMA_VERSION,
    ...built,
  };
}

/**
 * V3.1 组装（页面级截图结构）。
 * @param {object} traj trajectory row from DAO
 * @param {{ systemId?: number|string, projectId?: number|string }} root0 system/project context
 * @param {number|string} [root0.systemId] partner system id
 * @param {number|string} [root0.projectId] partner project id
 * @returns {Promise<object>} assembled V3 transaction envelope
 */
async function buildOneTrajectoryV3(traj, { systemId, projectId }) {
  const [phases, phaseScreenshots, dialogScreenshots, pageLevelScreenshots] = await Promise.all([
    trajectoryPhaseDao.listByTrajectory(traj.id),
    screenshotDao.listPhaseHighlightsByTrajectory(traj.id),
    screenshotDao.listDialogScreenshotsByTrajectory(traj.id),
    screenshotDao.listPageLevelByTrajectory(traj.id),
  ]);
  const built = buildTransactionPayloadV3(traj, {
    systemId,
    projectId,
    phases,
    phaseScreenshots,
    dialogScreenshots,
    pageLevelScreenshots,
  });
  return {
    trajectoryId: traj.id,
    schemaVersion: TRANSACTION_SCHEMA_VERSION_V3,
    ...built,
  };
}

async function markBuiltExported(trajIds = []) {
  for (const id of trajIds) {
    if (id != null) await trajectoryDao.markExported(id);
  }
}

/**
 * True when caller wants bare envelope only (no partner push).
 * Accepts download | raw | forImport | dryRun.
 * @param {object} [src] request query/body source
 * @returns {boolean} whether dry-run / bare export is requested
 */
function wantDryRun(src = {}) {
  return parseBool(src.download, false)
    || parseBool(src.raw, false)
    || parseBool(src.forImport, false)
    || parseBool(src.for_import, false)
    || parseBool(src.dryRun, false)
    || parseBool(src.dry_run, false);
}

function wantBarePayload(src = {}) {
  return parseBool(src.download, false)
    || parseBool(src.raw, false)
    || parseBool(src.forImport, false)
    || parseBool(src.for_import, false);
}

/**
 * 单交易组装/推送公共实现（V2/V3 由 options 参数化）。
 * @param {import('express').Request} req Express request
 * @param {import('express').Response} res Express response
 * @param {object} traj trajectory row from DAO
 * @param {object} src merged query/body source
 * @param {object} options version-specific config
 * @param {(traj: object, ctx: object) => Promise<object>} options.buildOne envelope builder
 * @param {string} options.downloadName bare-payload download filename prefix
 * @param {(result: object) => void} [options.assertPushCoverage] pre-push coverage gate (V3 only)
 * @returns {Promise<void>}
 */
async function maybePushSingleImpl(req, res, traj, src, { buildOne, downloadName, assertPushCoverage }) {
  const { systemId, projectId } = resolveSystemProject(src);
  const result = await buildOne(traj, { systemId, projectId });
  const dry = wantDryRun(src);
  const push = parseBool(src.push, false);

  if (wantBarePayload(src)) {
    if (parseBool(src.download, false)) {
      res.setHeader('Content-Disposition', `attachment; filename="${downloadName}_${traj.id}.json"`);
    }
    return res.json(result.payload);
  }

  if (!push || dry) {
    // Export-only path (no mark unless historically expected) — mark only when pushed.
    // For non-push export, keep previous behavior of markExported so raw 联调 still flips flag.
    if (!push) {
      await trajectoryDao.markExported(traj.id);
      return res.json({ ...result, isExport: 1, pushed: false });
    }
    return res.json({ ...result, isExport: 0, pushed: false });
  }

  // Real partner push: gate-driven — only completed (已确认) may push.
  assertPushableForPartner(traj);
  if (assertPushCoverage) await assertPushCoverage(result);

  const accessToken = requireAccessToken(req);
  const partner = await pushImportDemand(result.payload, { accessToken });
  await trajectoryDao.markExported(traj.id);
  return res.json({
    ...result,
    isExport: 1,
    pushed: true,
    partner,
  });
}

/**
 * @param {import('express').Request} req Express request
 * @param {import('express').Response} res Express response
 * @param {object} traj trajectory row from DAO
 * @param {object} src merged query/body source
 * @returns {Promise<void>}
 */
async function maybePushSingle(req, res, traj, src) {
  return maybePushSingleImpl(req, res, traj, src, {
    buildOne: buildOneTrajectory,
    downloadName: 'transaction',
  });
}

/**
 * V3.0 单交易组装/推送（镜像 maybePushSingle，用 V3 组装 + 页面级截图覆盖度门禁）。
 * @param {import('express').Request} req Express request
 * @param {import('express').Response} res Express response
 * @param {object} traj trajectory row from DAO
 * @param {object} src merged query/body source
 * @returns {Promise<void>}
 */
async function maybePushSingleV3(req, res, traj, src) {
  return maybePushSingleImpl(req, res, traj, src, {
    buildOne: buildOneTrajectoryV3,
    downloadName: 'transaction_v3',
    assertPushCoverage(result) {
      const coverage = validatePageLevelCoverage(result.payload?.transcationEventTypeList?.[0]);
      if (coverageBlocksPush(coverage, result.stats)) {
        throw new AppError('页面级截图缺失，无法推送', {
          status: 409,
          body: {
            code: 'page_level_screenshot_missing',
            error: '页面级截图缺失，无法推送',
            missingPageLevelScreenshots: coverage.missing,
            stats: result.stats,
            pushed: false,
          },
        });
      }
    },
  });
}

/**
 * Batch transaction export/push handler factory — V2/V3 差异全部由参数表达。
 * @param {object} options version-specific config
 * @param {number|string} options.schemaVersion envelope schema version
 * @param {(traj: object, ctx: object) => Promise<object>} options.buildOne envelope builder
 * @param {(okBuilt: object[]) => { payload: object, stats?: object, skipped?: object }} options.wrapList list wrapper
 * @param {string} options.bareFilename download filename for bare-payload mode
 * @param {boolean} [options.includeScreenshotsInBuilt] keep legacy `screenshots` field in okBuilt entries (V2)
 * @param {boolean} [options.gateCoverage] per-item page-level coverage gate + `coverage` in items (V3)
 * @param {boolean} [options.includeMergedStats] include merged stats/skipped in push response (V3)
 * @returns {(req: import('express').Request, res: import('express').Response) => Promise<void>} route handler
 */
function buildTransactionExportHandler({
  schemaVersion,
  buildOne,
  wrapList,
  bareFilename,
  includeScreenshotsInBuilt = false,
  gateCoverage = false,
  includeMergedStats = false,
}) {
  return async function transactionExportHandler(req, res) {
    const body = req.body || {};
    const { systemId, projectId } = resolveSystemProject(body);
    const ids = parseIdList(body.trajectoryIds ?? body.trajectory_ids);
    if (!ids.length) {
      throw new AppError('请选择要推送的交易', { code: 'VALIDATION' });
    }

    const dryOrBare =
      wantBarePayload(body) ||
      parseBool(body.dryRun, false) ||
      parseBool(body.dry_run, false);
    const willPush = !dryOrBare;

    const items = [];
    const okBuilt = [];
    let buildOk = 0;
    let buildFailed = 0;

    for (const id of ids) {
      try {
        const traj = await trajectoryDao.getById(id);
        if (!traj) {
          buildFailed += 1;
          items.push({ trajectoryId: id, ok: false, error: '交易不存在' });
          continue;
        }
        if (willPush && !isPushableRecordStatus(getRecordStatus(traj))) {
          buildFailed += 1;
          const status = getRecordStatus(traj);
          items.push({
            trajectoryId: id,
            ok: false,
            error: `只能推送状态为「已确认」的交易（当前: ${status ?? 'unknown'}）`,
            code: 'not_pushable_status',
            recordStatus: status,
          });
          continue;
        }
        const result = await buildOne(traj, { systemId, projectId });
        const entry = result.payload?.transcationEventTypeList?.[0];
        let coverage;
        if (gateCoverage) {
          coverage = validatePageLevelCoverage(entry);
          if (willPush && coverageBlocksPush(coverage, result.stats)) {
            buildFailed += 1;
            items.push({
              trajectoryId: id,
              ok: false,
              error: '页面级截图缺失，无法推送',
              code: 'page_level_screenshot_missing',
              missingPageLevelScreenshots: coverage.missing,
              stats: result.stats,
            });
            continue;
          }
        }
        buildOk += 1;
        if (entry) {
          okBuilt.push({
            entry,
            ...(includeScreenshotsInBuilt ? { screenshots: result.payload?.screenshots || [] } : {}),
            count: result.count,
            skipped: result.skipped,
            stats: result.stats,
            trajectoryId: id,
          });
        }
        items.push({
          trajectoryId: id,
          ok: true,
          isExport: 0,
          payload: result.payload,
          count: result.count,
          skipped: result.skipped,
          stats: result.stats,
          ...(gateCoverage ? { coverage } : {}),
        });
      } catch (e) {
        buildFailed += 1;
        items.push({ trajectoryId: id, ok: false, error: e.message });
      }
    }

    const merged = wrapList(okBuilt);

    if (dryOrBare) {
      if (parseBool(body.download, false)) {
        res.setHeader('Content-Disposition', `attachment; filename="${bareFilename}"`);
      }
      if (wantBarePayload(body)) {
        return res.json(merged.payload);
      }
      return res.json({
        schemaVersion,
        systemId: String(systemId),
        projectId: String(projectId),
        pushed: false,
        items,
        summary: { ok: buildOk, failed: buildFailed },
        payload: merged.payload,
      });
    }

    if (!okBuilt.length) {
      throw new AppError('没有可推送的交易（需为已确认 completed，且含可导出步骤）', {
        status: 422,
        body: {
          error: '没有可推送的交易（需为已确认 completed，且含可导出步骤）',
          schemaVersion,
          systemId: String(systemId),
          projectId: String(projectId),
          pushed: false,
          items,
          summary: { ok: 0, failed: buildFailed },
        },
      });
    }

    const accessToken = requireAccessToken({
      headers: req.headers,
      body,
      query: req.query,
    });

    let partner;
    try {
      partner = await pushImportDemand(merged.payload, { accessToken });
    } catch (e) {
      throw new AppError(e.message, {
        status: e.statusCode || 502,
        body: {
          error: e.message,
          schemaVersion,
          systemId: String(systemId),
          projectId: String(projectId),
          pushed: false,
          partner: e.partner || null,
          items,
          summary: { ok: 0, failed: buildOk + buildFailed, buildOk, buildFailed },
        },
      });
    }

    const pushedIds = okBuilt.map((b) => b.trajectoryId);
    await markBuiltExported(pushedIds);
    for (const it of items) {
      if (it.ok && pushedIds.includes(it.trajectoryId)) {
        it.isExport = 1;
      }
    }

    res.json({
      schemaVersion,
      systemId: String(systemId),
      projectId: String(projectId),
      pushed: true,
      partner,
      items,
      ...(includeMergedStats ? { stats: merged.stats, skipped: merged.skipped } : {}),
      summary: { ok: buildOk, failed: buildFailed },
    });
  };
}

/**
 * Register export / batch-push management routes.
 * @param {import('express').Application} app Express application
 */
export default function (app) {
  /** Partner transaction envelope schema */
  app.get('/api/v2/export/transaction/schema', (_req, res) => {
    res.json({
      schemaVersion: TRANSACTION_SCHEMA_VERSION,
      fields: TRANSACTION_ENVELOPE_FIELDS,
      eventTypeName: EVENT_TYPE_NAME,
      actionTypeMap: ACTION_TO_ENGINE_TYPE,
      notes: [
        'Partner envelope spellings (transcation*, mothed) are intentional',
        'V2: 每步 regionId/parentRegionId（层级作证）；每交易 phases[]（截图引用 + metadata）。旧字段拼写不变',
        // TODO: partial export (stepIds/phaseIds) + export coverage
        // TODO: placeholder
      ],
    });
  });

  /** Field contract + recorded-action → engine type map */
  app.get('/api/v2/export/legacy-engine/schema', (_req, res) => {
    res.json({
      schemaVersion: 1,
      fields: LEGACY_ENGINE_FIELD_SCHEMA,
      types: LEGACY_ENGINE_EMITTED_TYPES,
      actionTypeMap: ACTION_TO_ENGINE_TYPE,
      notes: [
        '仅映射当前可录制并落库的动作；不覆盖传统引擎全部操作类型',
        'locateBy 默认 xpath；target 优先 xpath_smart，无相对 xpath 时回退 xpath_full（不丢弃步骤）',
        'meta 含 stepId/action/element/params 等调试字段，对接传统引擎核心 5 字段时可剥离',
      ],
    });
  });

  /**
   * Export trajectory steps for traditional engine.
   */
  app.get('/api/v2/export/trajectories/:id/legacy-engine', asyncHandler(async (req, res) => {
    const traj = await trajectoryDao.getById(+req.params.id);
    if (!traj) throw new AppError('Trajectory not found', { code: 'NOT_FOUND' });
    const payload = exportStepsToLegacyEngine(traj.steps || [], {
      stepIds: parseIdList(req.query.stepIds),
      phaseIds: parseIdList(req.query.phaseIds),
      includeMeta: parseBool(req.query.includeMeta, true),
    });
    res.json({
      trajectoryId: traj.id,
      name: traj.name || null,
      ...payload,
    });
  }));

  /** Export trajectory steps for traditional engine (POST body variant). */
  app.post('/api/v2/export/trajectories/:id/legacy-engine', asyncHandler(async (req, res) => {
    const traj = await trajectoryDao.getById(+req.params.id);
    if (!traj) throw new AppError('Trajectory not found', { code: 'NOT_FOUND' });
    const body = req.body || {};
    const payload = exportStepsToLegacyEngine(traj.steps || [], {
      stepIds: parseIdList(body.stepIds ?? body.step_ids),
      phaseIds: parseIdList(body.phaseIds ?? body.phase_ids),
      includeMeta: parseBool(body.includeMeta ?? body.include_meta, true),
    });
    res.json({
      trajectoryId: traj.id,
      name: traj.name || null,
      ...payload,
    });
  }));

  /** Preview legacy-engine export for arbitrary steps[] (no DB read). */
  app.post('/api/v2/export/legacy-engine/preview', asyncHandler(async (req, res) => {
    const body = req.body || {};
    const steps = Array.isArray(body.steps) ? body.steps : [];
    if (!steps.length) throw new AppError('steps[] is required', { code: 'VALIDATION' });
    const payload = exportStepsToLegacyEngine(steps, {
      includeMeta: parseBool(body.includeMeta ?? body.include_meta, true),
    });
    res.json(payload);
  }));

  /** Partner projects for batch-push dialog. */
  app.get('/api/v2/export/partner/projects', asyncHandler(async (req, res) => {
    try {
      const accessToken = requireAccessToken(req);
      const projects = await listPartnerProjects({ accessToken });
      res.json({ projects, count: projects.length });
    } catch (err) {
      rethrowRouteError(err, partnerErrorBody);
    }
  }));

  /**
   * Partner systems under a project.
   * 默认（无 parentId）返回完整嵌套树——自根向下递归展开全部子节点；
   * 传 parentId 时保持旧懒加载行为，只返回该层的直接子节点。
   */
  app.get('/api/v2/export/partner/systems', asyncHandler(async (req, res) => {
    try {
      const accessToken = requireAccessToken(req);
      const projectId = req.query.projectId ?? req.query.project_id;
      const parentId = req.query.parentId ?? req.query.parent_id;
      if (projectId == null || projectId === '') {
        throw new AppError('projectId is required', { code: 'VALIDATION' });
      }
      let systems;
      if (parentId != null && parentId !== '') {
        systems = await listPartnerSystems({ accessToken, projectId, parentId });
      } else {
        systems = await listPartnerSystemTree({ accessToken, projectId });
      }
      const count = (function countNodes(nodes) {
        return (nodes || []).reduce(
          (sum, n) => sum + 1 + countNodes(n.children),
          0,
        );
      })(systems);
      res.json({ projectId: String(projectId), systems, count });
    } catch (err) {
      rethrowRouteError(err, partnerErrorBody);
    }
  }));

  /** 菜单推送专用系统查询（partner getSystemNodeLevel，POST 无参数；独立基址 PARTNER_MENU_PUSH_BASE） */
  app.get('/api/v2/export/partner/menu-push/systems', asyncHandler(async (req, res) => {
    try {
      const accessToken = requireAccessToken(req);
      const systems = await listPartnerMenuPushSystems({ accessToken });
      const count = (function countNodes(nodes) {
        return (nodes || []).reduce(
          (sum, n) => sum + 1 + countNodes(n.children),
          0,
        );
      })(systems);
      res.json({ systems, count });
    } catch (err) {
      rethrowRouteError(err, partnerErrorBody);
    }
  }));

  /**
   * Export / optional push single trajectory.
   * Query: systemId?, projectId?, download|raw|forImport|push?
   */
  app.get('/api/v2/export/trajectories/:id/transaction', asyncHandler(async (req, res) => {
    try {
      const traj = await trajectoryDao.getById(+req.params.id);
      if (!traj) throw new AppError('Trajectory not found', { code: 'NOT_FOUND' });
      return maybePushSingle(req, res, traj, req.query);
    } catch (err) {
      rethrowRouteError(err, statusAwareErrorBody);
    }
  }));

  /** Export / optional push single trajectory (POST body variant). */
  app.post('/api/v2/export/trajectories/:id/transaction', asyncHandler(async (req, res) => {
    try {
      const body = req.body || {};
      const src = { ...req.query, ...body };
      const traj = await trajectoryDao.getById(+req.params.id);
      if (!traj) throw new AppError('Trajectory not found', { code: 'NOT_FOUND' });
      return maybePushSingle(req, res, traj, src);
    } catch (err) {
      rethrowRouteError(err, statusAwareErrorBody);
    }
  }));

  /**
   * Batch push trajectories to partner importDemand.
   * Body: { trajectoryIds, systemId?, projectId?, raw|forImport|dryRun|download? }
   * Product path: assemble + push; dry-run/raw returns envelope only.
   */
  app.post('/api/v2/export/transactions', asyncHandler(buildTransactionExportHandler({
    schemaVersion: TRANSACTION_SCHEMA_VERSION,
    buildOne: buildOneTrajectory,
    wrapList: wrapTransactionList,
    bareFilename: 'transactions_import.json',
    includeScreenshotsInBuilt: true,
  })));

  // ── V3.0：阶段长图控件点亮（groups 结果结构，V2.0 保留）──
  /** Export / optional push single trajectory (V3 page-level screenshot structure). */
  app.get('/api/v2/export/trajectories/:id/transaction-v3', asyncHandler(async (req, res) => {
    try {
      const traj = await trajectoryDao.getById(+req.params.id);
      if (!traj) throw new AppError('Trajectory not found', { code: 'NOT_FOUND' });
      return maybePushSingleV3(req, res, traj, req.query);
    } catch (err) {
      rethrowRouteError(err, statusAwareErrorBody);
    }
  }));

  /** Export / optional push single trajectory (V3, POST body variant). */
  app.post('/api/v2/export/trajectories/:id/transaction-v3', asyncHandler(async (req, res) => {
    try {
      const body = req.body || {};
      const src = { ...req.query, ...body };
      const traj = await trajectoryDao.getById(+req.params.id);
      if (!traj) throw new AppError('Trajectory not found', { code: 'NOT_FOUND' });
      return maybePushSingleV3(req, res, traj, src);
    } catch (err) {
      rethrowRouteError(err, statusAwareErrorBody);
    }
  }));

  /**
   * V3.0 批量推送。Body 同 V2.0：{ trajectoryIds, systemId?, projectId?, raw|forImport|dryRun|download? }。
   */
  app.post('/api/v2/export/transactions-v3', asyncHandler(buildTransactionExportHandler({
    schemaVersion: TRANSACTION_SCHEMA_VERSION_V3,
    buildOne: buildOneTrajectoryV3,
    wrapList: wrapTransactionListV3,
    bareFilename: 'transactions_v3_import.json',
    gateCoverage: true,
    includeMergedStats: true,
  })));

  /** Map a single recorded step to its legacy-engine operation (exportable check). */
  app.post('/api/v2/export/legacy-engine/map-step', asyncHandler(async (req, res) => {
    const step = req.body?.step ?? req.body;
    const op = mapStepToLegacyEngineOp(step);
    if (!op) {
      throw new AppError('Step is not exportable (meta/scan action or empty)', {
        status: 422,
        body: {
          error: 'Step is not exportable (meta/scan action or empty)',
          exportable: false,
        },
      });
    }
    res.json({ exportable: true, operation: op });
  }));
}
