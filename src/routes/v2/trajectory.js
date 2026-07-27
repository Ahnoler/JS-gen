import { writeFileSync, mkdirSync, existsSync } from 'fs';
import path from 'path';
import * as trajectoryDao from '../../dao/trajectory-dao.js';
import * as trajectoryService from '../../services/trajectory-service.js';
import { trajectoryStepToActionEntry } from '../../models/element.js';
import { TRAJECTORY_RECORD_STATUSES } from '../../models/constants.js';
import { PROJECT_DIR } from '../../../config/config.js';

/** Normalize DAO step → assembler command (DAO returns elementJson, not element). */
function stepsToActionCommands(steps) {
  return (steps || []).map((s) => {
    const entry = trajectoryStepToActionEntry(s);
    const rawEl = s.element ?? s.elementJson ?? null;
    const el = typeof rawEl === 'string'
      ? (() => { try { return JSON.parse(rawEl); } catch { return {}; } })()
      : (rawEl || {});
    return {
      ...entry,
      // Ensure target from either shape
      target: entry.target || el.xpath || el.target || '',
      phase: s.phaseNumber ?? 0,
      source: s.source || 'agent',
    };
  });
}

export default function (app) {
  function sendErr(res, err, fallback = 500) {
    const status = err.statusCode || fallback;
    const body = { error: err.message };
    if (err.holders) body.holders = err.holders;
    res.status(status).json(body);
  }

  /** AI 分析：需求描述 -> 阶段步骤数组（不落库） */
  app.post('/api/v2/trajectories/analyze', async (req, res) => {
    try {
      const { description, stepLength, model } = req.body || {};
      const phases = await trajectoryService.analyzeRequirementToPhases({
        description,
        stepLength,
        model,
      });
      res.json(phases);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/v2/trajectories', async (req, res) => {
    try {
      const {
        page,
        pageSize,
        functionId,
        keyword,
        sortBy,
        order,
        recordStatus,
        status,
      } = req.query;
      const statusRaw = recordStatus ?? status;
      const bad = trajectoryDao.invalidRecordStatuses(statusRaw);
      if (bad.length) {
        return res.status(400).json({
          error: `Invalid recordStatus: ${bad.join(', ')}`,
          allowed: [...TRAJECTORY_RECORD_STATUSES],
        });
      }
      const pagination = {
        page: +page || 1,
        pageSize: +pageSize || 20,
        keyword,
        sortBy,
        order,
        recordStatus: statusRaw,
      };
      const result = functionId
        ? await trajectoryService.listByFunction(+functionId, pagination)
        : await trajectoryDao.list(pagination);
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  /** Create a transaction (trajectory) shell under a function. */
  app.post('/api/v2/trajectories', async (req, res) => {
    try {
      const {
        functionId,
        name,
        requirement,
        task,
        model,
        phases,
        systemAccountId,
        accountId,
        caseEntries,
        caseData,
      } = req.body || {};

      const functionNum = functionId != null ? +functionId : undefined;
      const boundAccount = systemAccountId ?? accountId ?? null;
      if (Array.isArray(phases)) {
        const traj = await trajectoryService.createTransactionWithPhases({
          functionId: functionNum,
          name: name || '',
          requirement: requirement ?? task ?? '',
          phases,
          model: model || '',
          systemAccountId: boundAccount,
          caseEntries,
          caseData,
        });
        res.status(201).json(traj);
        return;
      }

      const id = await trajectoryService.createEmptyTrajectory({
        functionId: functionNum,
        name: name || '',
        task: requirement ?? task ?? '',
        model: model || '',
        systemAccountId: boundAccount,
      });
      const traj = await trajectoryDao.getById(id);
      res.status(201).json(traj);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  /** Patch trajectory meta (e.g. bind systemAccountId before studio). */
  app.patch('/api/v2/trajectories/:id', async (req, res) => {
    try {
      const tid = +req.params.id;
      const body = req.body || {};
      if (body.systemAccountId != null || body.accountId != null) {
        const result = await trajectoryService.setTrajectoryAccount(
          tid,
          body.systemAccountId ?? body.accountId,
        );
        // Allow binding account + case entries in one call
        if (body.caseEntries !== undefined || body.caseData !== undefined) {
          await trajectoryService.setTrajectoryCaseEntries(
            tid,
            body.caseEntries ?? body.caseData,
          );
          const traj = await trajectoryService.getTrajectoryWithPhases(tid);
          return res.json({ ...result, trajectory: traj });
        }
        return res.json(result);
      }
      const allowed = {};
      if (body.name != null) allowed.name = String(body.name);
      if (body.task != null) allowed.task = String(body.task);
      if (body.model != null) allowed.model = String(body.model);
      if (Object.keys(allowed).length) {
        await trajectoryDao.updateMeta(tid, allowed);
      }
      if (body.caseEntries !== undefined || body.caseData !== undefined) {
        await trajectoryService.setTrajectoryCaseEntries(
          tid,
          body.caseEntries ?? body.caseData,
        );
      } else if (!Object.keys(allowed).length) {
        return res.status(400).json({ error: 'No updatable fields' });
      }
      const traj = await trajectoryService.getTrajectoryWithPhases(tid);
      if (!traj) return res.status(404).json({ error: 'Trajectory not found' });
      res.json(traj);
    } catch (err) {
      sendErr(res, err);
    }
  });

  /** Replace case KV entries for a trajectory. */
  app.put('/api/v2/trajectories/:id/case-data', async (req, res) => {
    try {
      const entries = req.body?.caseEntries ?? req.body?.caseData ?? req.body?.entries ?? [];
      const traj = await trajectoryService.setTrajectoryCaseEntries(+req.params.id, entries);
      res.json(traj);
    } catch (err) {
      sendErr(res, err);
    }
  });

  app.get('/api/v2/trajectories/:id', async (req, res) => {
    try {
      const traj = await trajectoryService.getTrajectoryWithPhases(req.params.id);
      if (!traj) return res.status(404).json({ error: 'Trajectory not found' });
      res.json(traj);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/v2/trajectories/:id/attach', async (req, res) => {
    try {
      const result = await trajectoryService.attachTrajectoryLive(+req.params.id);
      res.status(201).json(result);
    } catch (err) {
      sendErr(res, err);
    }
  });

  app.post('/api/v2/trajectories/:id/detach', async (req, res) => {
    try {
      const result = await trajectoryService.detachTrajectoryLive(+req.params.id);
      res.json(result);
    } catch (err) {
      sendErr(res, err);
    }
  });

  /** Phase-step tree: { phases:[{...phase, steps:[...]}, ...] } */
  app.get('/api/v2/trajectories/:id/tree', async (req, res) => {
    try {
      const tree = await trajectoryService.getTrajectoryTree(+req.params.id);
      if (!tree) return res.status(404).json({ error: 'Trajectory not found' });
      res.json(tree);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  /** Phases for a trajectory (by numeric trajectory.id). */
  app.get('/api/v2/trajectories/:id/phases', async (req, res) => {
    try {
      const traj = await trajectoryDao.getById(+req.params.id);
      if (!traj) return res.status(404).json({ error: 'Trajectory not found' });
      const phases = await trajectoryService.listPhasesByTrajectory(traj.id);
      res.json({ trajectoryId: traj.id, phases });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  /** Append a phase: body { description?, phaseNumber? } */
  app.post('/api/v2/trajectories/:id/phases', async (req, res) => {
    try {
      const phase = await trajectoryService.addPhaseToTrajectory(+req.params.id, {
        description: req.body?.description ?? req.body?.task ?? '',
        phaseNumber: req.body?.phaseNumber ?? null,
      });
      res.status(201).json(phase);
    } catch (err) {
      res.status(err.statusCode || 500).json({ error: err.message });
    }
  });

  /** Sync phases by id: body { phases: string[] | { id?, description }[], caseEntries? } */
  app.put('/api/v2/trajectories/:id/phases', async (req, res) => {
    try {
      const phases = req.body?.phases ?? req.body?.descriptions ?? null;
      let traj = await trajectoryService.syncTrajectoryPhaseDescriptions(+req.params.id, phases);
      if (req.body?.caseEntries !== undefined || req.body?.caseData !== undefined) {
        traj = await trajectoryService.setTrajectoryCaseEntries(
          +req.params.id,
          req.body.caseEntries ?? req.body.caseData,
        );
      }
      res.json(traj);
    } catch (err) {
      sendErr(res, err);
    }
  });

  /** Merged action flow for a trajectory (DB steps; pending empty — use session action-flow for live). */
  app.get('/api/v2/trajectories/:id/action-flow', async (req, res) => {
    try {
      const flow = await trajectoryService.getTrajectoryActionFlow(+req.params.id, []);
      res.json(flow);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * Materialize DB steps as scripts/action/action_db_*.json for the assembler.
   */
  app.post('/api/v2/trajectories/:id/assemble-file', async (req, res) => {
    try {
      const traj = await trajectoryDao.getById(+req.params.id);
      if (!traj) return res.status(404).json({ error: 'Trajectory not found' });
      const actionDir = path.join(PROJECT_DIR, 'scripts', 'action');
      if (!existsSync(actionDir)) mkdirSync(actionDir, { recursive: true });
      const commands = stepsToActionCommands(traj.steps);
      const actionJson = {
        id: String(traj.id),
        name: 'db-trajectory',
        url: traj.url || '',
        tests: [{ id: String(traj.id), name: 'db-trajectory', commands }],
      };
      const fileName = `action_db_${traj.id}.json`;
      const absPath = path.join(actionDir, fileName);
      writeFileSync(absPath, JSON.stringify(actionJson, null, 2), 'utf-8');
      res.json({
        actionFile: `scripts/action/${fileName}`,
        absPath,
        commandCount: commands.length,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete('/api/v2/trajectories/:id', async (req, res) => {
    try {
      const numeric = Number(req.params.id);
      if (Number.isNaN(numeric)) return res.status(400).json({ error: 'Numeric trajectory id required' });
      await trajectoryDao.remove(numeric);
      return res.json({ status: 'deleted', id: numeric });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  /** Clear recorded steps; keep phase descriptions and reset statuses to pending.
   *  Optional body.phaseIds: clear only those phases' steps (omit / empty = all). */
  app.post('/api/v2/trajectories/:id/clear', async (req, res) => {
    try {
      const phaseIds = req.body?.phaseIds ?? req.body?.phase_ids ?? null;
      const cleared = await trajectoryService.clearTrajectory(+req.params.id, { phaseIds });
      if (!cleared) return res.status(404).json({ error: 'Trajectory not found' });
      res.json(cleared);
    } catch (err) {
      sendErr(res, err);
    }
  });

  /**
   * One-shot enter recording studio (requires bound systemAccountId):
   * 1) session create  2) allocate browser  3) BiB stream  4) navigate/login
   * Broadcasts recording:prepare { stage, status } over /ws. Stream may be degraded
   * without failing the critical path (session + login). Idempotent when already live.
   * POST /api/v2/trajectories/:id/record/prepare
   */
  app.post('/api/v2/trajectories/:id/record/prepare', async (req, res) => {
    try {
      const result = await trajectoryService.prepareTrajectoryRecording(+req.params.id);
      res.json(result);
    } catch (err) {
      sendErr(res, err);
    }
  });

  /**
   * Login context: owning system + accounts for AI recording pre-login.
   * GET /api/v2/trajectories/:id/login-context
   */
  app.get('/api/v2/trajectories/:id/login-context', async (req, res) => {
    try {
      const ctx = await trajectoryService.getTrajectoryLoginContext(+req.params.id);
      res.json(ctx);
    } catch (err) {
      sendErr(res, err);
    }
  });

  /**
   * Start AI recording for all phases or subset.
   * Body: { phaseIds?: number[], accountId?: number }
   * Login/navigate is done in record/prepare (not stored as steps).
   * accountId optional — defaults to trajectory.systemAccountId.
   */
  app.post('/api/v2/trajectories/:id/record/start', async (req, res) => {
    try {
      const phaseIds = req.body?.phaseIds;
      const accountId = req.body?.accountId ?? req.body?.systemAccountId;
      const result = await trajectoryService.startTrajectoryRecording(+req.params.id, {
        phaseIds: Array.isArray(phaseIds) ? phaseIds : null,
        accountId,
      });
      res.json(result);
    } catch (err) {
      res.status(err.statusCode || 500).json({ error: err.message });
    }
  });

  /**
   * Re-run selected steps in the live session.
   * Body: { stepIds: number[], isReplay?: boolean } — default isReplay=true (not counted in step list).
   */
  app.post('/api/v2/trajectories/:id/steps/replay', async (req, res) => {
    try {
      const result = await trajectoryService.replayTrajectorySteps(+req.params.id, {
        stepIds: req.body?.stepIds,
        isReplay: req.body?.isReplay !== false && req.body?.is_replay !== false,
      });
      res.json(result);
    } catch (err) {
      // Include replay summary (ok/failed/results) in envelope data when present
      if (err.payload) {
        return res.status(err.statusCode || 500).json({
          error: err.message,
          ...err.payload,
        });
      }
      sendErr(res, err);
    }
  });

  /**
   * Explicit end of recording (does not detach BiB).
   * Body: { success?: boolean } default true → recorded; false → draft
   */
  app.post('/api/v2/trajectories/:id/record/stop', async (req, res) => {
    try {
      const success = req.body?.success !== false && req.body?.success !== 0;
      const result = await trajectoryService.stopTrajectoryRecording(+req.params.id, { success });
      res.json(result);
    } catch (err) {
      res.status(err.statusCode || 500).json({ error: err.message });
    }
  });

  /**
   * Human confirm / cancel-confirm a trajectory (transaction-level).
   * Body: { confirmed: boolean } — true → recordStatus=completed; false → draft.
   * Does not modify trajectory_step.confirmed.
   */
  app.post('/api/v2/trajectories/:id/confirm', async (req, res) => {
    try {
      const confirmed = req.body?.confirmed !== false && req.body?.confirmed !== 0;
      const result = await trajectoryService.confirmTrajectory(+req.params.id, confirmed);
      res.json(result);
    } catch (err) {
      sendErr(res, err);
    }
  });

  /**
   * Resolve Element UI form control by label_text on attached BiB page.
   * Body: { labelText: string }
   * Returns { element, matchedLabel } for writing trajectory_step.element_json.
   */
  app.post('/api/v2/trajectories/:id/resolve-element', async (req, res) => {
    try {
      const labelText = req.body?.labelText ?? req.body?.label_text ?? '';
      const result = await trajectoryService.resolveTrajectoryElement(+req.params.id, { labelText });
      res.json(result);
    } catch (err) {
      sendErr(res, err);
    }
  });

  /**
   * Toggle manual recording. Body: { enabled, phaseId? }
   * phaseId omitted → append to last phase of trajectory.
   */
  app.post('/api/v2/trajectories/:id/manual-record', async (req, res) => {
    try {
      const result = await trajectoryService.toggleTrajectoryManualRecord(
        +req.params.id,
        !!req.body?.enabled,
        { phaseId: req.body?.phaseId ?? req.body?.trajectoryPhaseId ?? null },
      );
      res.json(result);
    } catch (err) {
      res.status(err.statusCode || 500).json({ error: err.message });
    }
  });

  /** Steps for a trajectory_phase (by numeric phase.id). */
  app.get('/api/v2/trajectory-phases/:id/steps', async (req, res) => {
    try {
      const steps = await trajectoryService.listStepsByPhase(+req.params.id);
      res.json({ phaseId: +req.params.id, steps });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.patch('/api/v2/trajectory-steps/:id/confirm', async (req, res) => {
    try {
      const row = await trajectoryService.confirmTrajectoryStep(+req.params.id, !!req.body?.confirmed);
      if (!row) return res.status(404).json({ error: 'Trajectory step not found' });
      res.json(row);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/v2/trajectory-steps', async (req, res) => {
    try {
      const row = await trajectoryService.createTrajectoryStep(req.body || {});
      res.status(201).json(row);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.patch('/api/v2/trajectory-steps/:id', async (req, res) => {
    try {
      const row = await trajectoryService.updateTrajectoryStep(+req.params.id, req.body || {});
      if (!row) return res.status(404).json({ error: 'Trajectory step not found' });
      res.json(row);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete('/api/v2/trajectory-steps/:id', async (req, res) => {
    try {
      const result = await trajectoryService.removeTrajectoryStep(+req.params.id);
      if (!result.removed) return res.status(404).json({ error: 'Trajectory step not found' });
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
}
