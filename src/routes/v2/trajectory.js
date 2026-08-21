import { writeFileSync, mkdirSync, existsSync } from 'fs';
import path from 'path';
import * as trajectoryDao from '../../dao/trajectory-dao.js';
import * as trajectoryService from '../../services/trajectory-service.js';
import { stepsToActionCommands } from '../../models/element.js';
import { TRAJECTORY_RECORD_STATUSES } from '../../models/constants.js';
import { PROJECT_DIR } from '#config/config.js';
import { sendErr } from './trajectory-shared.js';

export default function (app) {
  /** AI 分析：需求描述 -> { phases }（不落库；阶段数跟用户分步；案例数据附在各阶段描述后） */
  app.post('/api/v2/trajectories/analyze', async (req, res) => {
    try {
      const { description, model, functionId } = req.body || {};
      const result = await trajectoryService.analyzeRequirementToPhases({
        description,
        model,
      });

      // Optional: mark special-element candidates per phase for UI preview
      const fid = functionId != null ? Number(functionId) : null;
      if (Number.isFinite(fid) && fid > 0 && Array.isArray(result?.phases)) {
        try {
          const { resolveAncestorSystemId } = await import('../../services/hierarchy-service.js');
          const { fetchDisplayCandidatesForDescription } = await import(
            '../../services/special-element-service.js'
          );
          const systemId = await resolveAncestorSystemId(fid);
          if (systemId) {
            const enriched = [];
            for (const p of result.phases) {
              const desc = typeof p === 'string' ? p : (p?.description || '');
              const specialElementCandidates = await fetchDisplayCandidatesForDescription(
                systemId,
                desc,
                3,
              );
              if (typeof p === 'string') {
                enriched.push({ description: p, specialElementCandidates });
              } else {
                enriched.push({ ...p, specialElementCandidates });
              }
            }
            result.phases = enriched;
          }
        } catch (err) {
          console.warn('[analyze] special-element candidates skipped:', err?.message || err);
        }
      }

      res.json(result);
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
        batchTaskName,
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
        batchTaskName: batchTaskName ?? null,
        paasUserId: req.paasUserId ?? null,
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
          paasUserId: req.paasUserId ?? null,
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
        paasUserId: req.paasUserId ?? null,
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

  /** Phase-step tree: { phases:[{...phase, steps:[...]}, ...] } */
  app.get('/api/v2/trajectories/:id/tree', async (req, res) => {
    try {
      const includeMeta = req.query?.includeMeta === '1'
        || req.query?.includeMeta === 'true'
        || req.query?.include_meta === '1';
      const tree = await trajectoryService.getTrajectoryTree(+req.params.id, { includeMeta });
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
}
