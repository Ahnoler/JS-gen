/**
 * Export management — adapters for external consumers (traditional execution engine, …).
 *
 * Prefix: /api/v2/export/*
 */
import * as trajectoryDao from '../../dao/trajectory-dao.js';
import {
  LEGACY_ENGINE_FIELD_SCHEMA,
  LEGACY_ENGINE_EMITTED_TYPES,
  ACTION_TO_ENGINE_TYPE,
  exportStepsToLegacyEngine,
  mapStepToLegacyEngineOp,
} from '../../services/legacy-engine-export.js';
import {
  buildTransactionPayload,
  TRANSACTION_ENVELOPE_FIELDS,
  EVENT_TYPE_NAME,
} from '../../services/transaction-export.js';

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

function requireSystemProject(src) {
  const systemId = src.systemId ?? src.system_id;
  const projectId = src.projectId ?? src.project_id;
  if (systemId == null || systemId === '' || projectId == null || projectId === '') {
    const err = new Error('systemId and projectId are required');
    err.statusCode = 400;
    throw err;
  }
  return { systemId, projectId };
}

async function exportOneTrajectory(traj, { systemId, projectId }) {
  const built = buildTransactionPayload(traj, { systemId, projectId });
  await trajectoryDao.markExported(traj.id);
  return {
    trajectoryId: traj.id,
    isExport: 1,
    schemaVersion: 1,
    ...built,
  };
}

export default function (app) {
  /** Partner transaction envelope schema (参数.txt) */
  app.get('/api/v2/export/transaction/schema', (_req, res) => {
    res.json({
      schemaVersion: 1,
      fields: TRANSACTION_ENVELOPE_FIELDS,
      eventTypeName: EVENT_TYPE_NAME,
      actionTypeMap: ACTION_TO_ENGINE_TYPE,
      notes: [
        'Partner envelope spellings (transcation*, mothed) are intentional',
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
   * GET: full trajectory (query filters).
   * Query: stepIds, phaseIds, includeMeta
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

  /**
   * Same export with JSON body filters (preferred for long stepId lists).
   * Body: { stepIds?, phaseIds?, includeMeta? }
   */
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

  /**
   * Dry-run: map an in-memory steps array (no DB). For SPA preview / contract tests.
   * Body: { steps: [...], includeMeta? }
   */
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
   * Export trajectory as partner transaction envelope.
   * Query: systemId, projectId, download?
   */
  app.get('/api/v2/export/trajectories/:id/transaction', async (req, res) => {
    try {
      const { systemId, projectId } = requireSystemProject(req.query);
      const traj = await trajectoryDao.getById(+req.params.id);
      if (!traj) return res.status(404).json({ error: 'Trajectory not found' });
      const result = await exportOneTrajectory(traj, { systemId, projectId });
      if (parseBool(req.query.download, false)) {
        res.setHeader('Content-Disposition', `attachment; filename="transaction_${traj.id}.json"`);
        return res.json(result.payload);
      }
      res.json(result);
    } catch (err) {
      res.status(err.statusCode || 500).json({ error: err.message });
    }
  });

  /**
   * Same export; systemId/projectId in body or query. Body: { systemId?, projectId?, download? }
   */
  app.post('/api/v2/export/trajectories/:id/transaction', async (req, res) => {
    try {
      const body = req.body || {};
      const { systemId, projectId } = requireSystemProject({ ...req.query, ...body });
      const traj = await trajectoryDao.getById(+req.params.id);
      if (!traj) return res.status(404).json({ error: 'Trajectory not found' });
      const result = await exportOneTrajectory(traj, { systemId, projectId });
      if (parseBool(body.download ?? req.query.download, false)) {
        res.setHeader('Content-Disposition', `attachment; filename="transaction_${traj.id}.json"`);
        return res.json(result.payload);
      }
      res.json(result);
    } catch (err) {
      res.status(err.statusCode || 500).json({ error: err.message });
    }
  });

  /**
   * Batch export trajectories as partner transaction envelopes.
   * Body: { trajectoryIds, systemId, projectId }
   */
  app.post('/api/v2/export/transactions', async (req, res) => {
    try {
      const body = req.body || {};
      const { systemId, projectId } = requireSystemProject(body);
      const ids = parseIdList(body.trajectoryIds ?? body.trajectory_ids);
      if (!ids.length) {
        return res.status(400).json({ error: 'trajectoryIds[] is required' });
      }
      const items = [];
      let ok = 0;
      let failed = 0;
      for (const id of ids) {
        try {
          const traj = await trajectoryDao.getById(id);
          if (!traj) {
            failed += 1;
            items.push({ trajectoryId: id, ok: false, error: 'Trajectory not found' });
            continue;
          }
          const result = await exportOneTrajectory(traj, { systemId, projectId });
          ok += 1;
          items.push({
            trajectoryId: id,
            ok: true,
            isExport: 1,
            payload: result.payload,
            count: result.count,
            skipped: result.skipped,
            stats: result.stats,
          });
        } catch (e) {
          failed += 1;
          items.push({ trajectoryId: id, ok: false, error: e.message });
        }
      }
      res.json({
        schemaVersion: 1,
        systemId: String(systemId),
        projectId: String(projectId),
        items,
        summary: { ok, failed },
      });
    } catch (err) {
      res.status(err.statusCode || 500).json({ error: err.message });
    }
  });

  /** Map a single step (debug) */
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
