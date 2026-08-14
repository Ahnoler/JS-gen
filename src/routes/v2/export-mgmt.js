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
  requireAccessToken,
  resolveSystemProject,
  listPartnerProjects,
  listPartnerSystems,
  pushImportDemand,
} from '../../services/partner-platform.js';
import {
  assertPushableForPartner,
  getRecordStatus,
  isPushableRecordStatus,
} from '../../services/export-push-gate.js';

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

/** Assemble only — do not mark is_export. */
async function buildOneTrajectory(traj, { systemId, projectId }) {
  const [phases, phaseScreenshots] = await Promise.all([
    trajectoryPhaseDao.listByTrajectory(traj.id),
    screenshotDao.listPhaseHighlightsByTrajectory(traj.id),
  ]);
  const built = buildTransactionPayload(traj, { systemId, projectId, phases, phaseScreenshots });
  return {
    trajectoryId: traj.id,
    schemaVersion: TRANSACTION_SCHEMA_VERSION,
    ...built,
  };
}

async function markBuiltExported(trajIds = []) {
  for (const id of trajIds) {
    if (id != null) await trajectoryDao.markExported(id);
  }
}

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
  app.get('/api/v2/export/trajectories/:id/legacy-engine', async (req, res) => {
    try {
      const traj = await trajectoryDao.getById(+req.params.id);
      if (!traj) return res.status(404).json({ error: 'Trajectory not found' });
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
    } catch (err) {
      res.status(err.statusCode || 500).json({ error: err.message });
    }
  });

  app.post('/api/v2/export/trajectories/:id/legacy-engine', async (req, res) => {
    try {
      const traj = await trajectoryDao.getById(+req.params.id);
      if (!traj) return res.status(404).json({ error: 'Trajectory not found' });
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
    } catch (err) {
      res.status(err.statusCode || 500).json({ error: err.message });
    }
  });

  app.post('/api/v2/export/legacy-engine/preview', (req, res) => {
    try {
      const body = req.body || {};
      const steps = Array.isArray(body.steps) ? body.steps : [];
      if (!steps.length) {
        return res.status(400).json({ error: 'steps[] is required' });
      }
      const payload = exportStepsToLegacyEngine(steps, {
        includeMeta: parseBool(body.includeMeta ?? body.include_meta, true),
      });
      res.json(payload);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * True when caller wants bare envelope only (no partner push).
   * Accepts download | raw | forImport | dryRun.
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

  /** Partner projects for batch-push dialog. */
  app.get('/api/v2/export/partner/projects', async (req, res) => {
    try {
      const accessToken = requireAccessToken(req);
      const projects = await listPartnerProjects({ accessToken });
      res.json({ projects, count: projects.length });
    } catch (err) {
      res.status(err.statusCode || 500).json({ error: err.message, partner: err.partner });
    }
  });

  /** Partner systems under a project (lazy tree). */
  app.get('/api/v2/export/partner/systems', async (req, res) => {
    try {
      const accessToken = requireAccessToken(req);
      const projectId = req.query.projectId ?? req.query.project_id;
      const parentId = req.query.parentId ?? req.query.parent_id;
      if (projectId == null || projectId === '') {
        return res.status(400).json({ error: 'projectId is required' });
      }
      const systems = await listPartnerSystems({ accessToken, projectId, parentId });
      res.json({ projectId: String(projectId), systems, count: systems.length });
    } catch (err) {
      res.status(err.statusCode || 500).json({ error: err.message, partner: err.partner });
    }
  });

  async function maybePushSingle(req, res, traj, src) {
    const { systemId, projectId } = resolveSystemProject(src);
    const result = await buildOneTrajectory(traj, { systemId, projectId });
    const dry = wantDryRun(src);
    const push = parseBool(src.push, false);

    if (wantBarePayload(src)) {
      if (parseBool(src.download, false)) {
        res.setHeader('Content-Disposition', `attachment; filename="transaction_${traj.id}.json"`);
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
   * Export / optional push single trajectory.
   * Query: systemId?, projectId?, download|raw|forImport|push?
   */
  app.get('/api/v2/export/trajectories/:id/transaction', async (req, res) => {
    try {
      const traj = await trajectoryDao.getById(+req.params.id);
      if (!traj) return res.status(404).json({ error: 'Trajectory not found' });
      return maybePushSingle(req, res, traj, req.query);
    } catch (err) {
      res.status(err.statusCode || 500).json({
        error: err.message,
        partner: err.partner,
        ...(err.code ? { code: err.code } : {}),
        ...(err.recordStatus !== undefined ? { recordStatus: err.recordStatus } : {}),
      });
    }
  });

  app.post('/api/v2/export/trajectories/:id/transaction', async (req, res) => {
    try {
      const body = req.body || {};
      const src = { ...req.query, ...body };
      const traj = await trajectoryDao.getById(+req.params.id);
      if (!traj) return res.status(404).json({ error: 'Trajectory not found' });
      return maybePushSingle(req, res, traj, src);
    } catch (err) {
      res.status(err.statusCode || 500).json({
        error: err.message,
        partner: err.partner,
        ...(err.code ? { code: err.code } : {}),
        ...(err.recordStatus !== undefined ? { recordStatus: err.recordStatus } : {}),
      });
    }
  });

  /**
   * Batch push trajectories to partner importDemand.
   * Body: { trajectoryIds, systemId?, projectId?, raw|forImport|dryRun|download? }
   * Product path: assemble + push; dry-run/raw returns envelope only.
   */
  app.post('/api/v2/export/transactions', async (req, res) => {
    try {
      const body = req.body || {};
      const { systemId, projectId } = resolveSystemProject(body);
      const ids = parseIdList(body.trajectoryIds ?? body.trajectory_ids);
      if (!ids.length) {
        return res.status(400).json({ error: '请选择要推送的交易' });
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
          const result = await buildOneTrajectory(traj, { systemId, projectId });
          buildOk += 1;
          const entry = result.payload?.transcationEventTypeList?.[0];
          if (entry) {
            okBuilt.push({
              entry,
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
          });
        } catch (e) {
          buildFailed += 1;
          items.push({ trajectoryId: id, ok: false, error: e.message });
        }
      }

      const merged = wrapTransactionList(okBuilt);

      if (dryOrBare) {
        if (parseBool(body.download, false)) {
          res.setHeader('Content-Disposition', 'attachment; filename="transactions_import.json"');
        }
        if (wantBarePayload(body)) {
          return res.json(merged.payload);
        }
        return res.json({
          schemaVersion: TRANSACTION_SCHEMA_VERSION,
          systemId: String(systemId),
          projectId: String(projectId),
          pushed: false,
          items,
          summary: { ok: buildOk, failed: buildFailed },
          payload: merged.payload,
        });
      }

      if (!okBuilt.length) {
        return res.status(422).json({
          error: '没有可推送的交易（需为已确认 completed，且含可导出步骤）',
          schemaVersion: TRANSACTION_SCHEMA_VERSION,
          systemId: String(systemId),
          projectId: String(projectId),
          pushed: false,
          items,
          summary: { ok: 0, failed: buildFailed },
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
        return res.status(e.statusCode || 502).json({
          error: e.message,
          schemaVersion: TRANSACTION_SCHEMA_VERSION,
          systemId: String(systemId),
          projectId: String(projectId),
          pushed: false,
          partner: e.partner || null,
          items,
          summary: { ok: 0, failed: buildOk + buildFailed, buildOk, buildFailed },
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
        schemaVersion: TRANSACTION_SCHEMA_VERSION,
        systemId: String(systemId),
        projectId: String(projectId),
        pushed: true,
        partner,
        items,
        summary: { ok: buildOk, failed: buildFailed },
      });
    } catch (err) {
      res.status(err.statusCode || 500).json({ error: err.message, partner: err.partner });
    }
  });

  app.post('/api/v2/export/legacy-engine/map-step', (req, res) => {
    try {
      const step = req.body?.step ?? req.body;
      const op = mapStepToLegacyEngineOp(step);
      if (!op) {
        return res.status(422).json({
          error: 'Step is not exportable (meta/scan action or empty)',
          exportable: false,
        });
      }
      res.json({ exportable: true, operation: op });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
}
