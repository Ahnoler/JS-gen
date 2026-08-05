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

export default function (app) {
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
