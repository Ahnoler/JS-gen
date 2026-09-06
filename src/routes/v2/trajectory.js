import * as trajectoryDao from '../../dao/trajectory-dao.js';
import * as trajectoryService from '../../services/trajectory-service.js';
import { TRAJECTORY_RECORD_STATUSES } from '../../models/constants.js';
import { asyncHandler, AppError } from '../../http/app-error.js';
import { asyncHandler as asyncHandlerSendErr } from './trajectory-shared.js';

/**
 * Trajectory (transaction) CRUD + phases + action-flow + clear +
 * login-context. Primary product v2 API.
 *
 * Prefix: /api/v2/trajectories/*
 * @param {import('express').Application} app Express application
 */
export default function (app) {
  /** AI 分析：需求描述 -> { phases }（不落库；阶段数跟用户分步；业务数据附在各阶段描述后） */
  app.post('/api/v2/trajectories/analyze', asyncHandler(async (req, res) => {
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
      // Legacy shape: always 500 { error } regardless of err.statusCode
      throw new AppError(err.message, { status: 500 });
    }
  }));

  /** List trajectories (paginated, filtered by functionId/keyword/recordStatus/batchTaskName/isExport). */
  app.get('/api/v2/trajectories', asyncHandler(async (req, res) => {
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
        isExport,
      } = req.query;
      const statusRaw = recordStatus ?? status;
      const bad = trajectoryDao.invalidRecordStatuses(statusRaw);
      if (bad.length) {
        return res.status(400).json({
          error: `Invalid recordStatus: ${bad.join(', ')}`,
          allowed: [...TRAJECTORY_RECORD_STATUSES],
        });
      }
      // isExport: '0' = not exported, '1' = exported, absent/empty = all
      let isExportFilter = null;
      if (isExport !== undefined && String(isExport).trim() !== '') {
        const v = String(isExport).trim();
        if (v !== '0' && v !== '1') {
          return res.status(400).json({ error: `Invalid isExport: ${v}`, allowed: [0, 1] });
        }
        isExportFilter = Number(v);
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
        isExport: isExportFilter,
      };
      const result = functionId
        ? await trajectoryService.listByFunction(+functionId, pagination)
        : await trajectoryDao.list(pagination);
      res.json(result);
    } catch (err) {
      // Legacy shape: always 500 { error } regardless of err.statusCode
      throw new AppError(err.message, { status: 500 });
    }
  }));

  /** Create a transaction (trajectory) shell under a function. */
  app.post('/api/v2/trajectories', asyncHandler(async (req, res) => {
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
        businessEntries,
        businessData,
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
          businessEntries,
          businessData,
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
      // Legacy shape: always 500 { error } regardless of err.statusCode
      throw new AppError(err.message, { status: 500 });
    }
  }));

  /** Patch trajectory meta (e.g. bind systemAccountId before studio). */
  app.patch('/api/v2/trajectories/:id', asyncHandlerSendErr(async (req, res) => {
    const tid = +req.params.id;
    const body = req.body || {};
    if (body.systemAccountId != null || body.accountId != null) {
      const result = await trajectoryService.setTrajectoryAccount(
        tid,
        body.systemAccountId ?? body.accountId,
      );
      // Allow binding account + business entries in one call
      if (body.businessEntries !== undefined || body.businessData !== undefined) {
        await trajectoryService.setTrajectoryBusinessEntries(
          tid,
          body.businessEntries ?? body.businessData,
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
    if (body.businessEntries !== undefined || body.businessData !== undefined) {
      await trajectoryService.setTrajectoryBusinessEntries(
        tid,
        body.businessEntries ?? body.businessData,
      );
    } else if (!Object.keys(allowed).length) {
      return res.status(400).json({ error: 'No updatable fields' });
    }
    const traj = await trajectoryService.getTrajectoryWithPhases(tid);
    if (!traj) return res.status(404).json({ error: 'Trajectory not found' });
    res.json(traj);
  }));

  /** Replace business KV entries for a trajectory. */
  app.put('/api/v2/trajectories/:id/business-data', asyncHandlerSendErr(async (req, res) => {
    const entries = req.body?.businessEntries ?? req.body?.businessData ?? req.body?.entries ?? [];
    const traj = await trajectoryService.setTrajectoryBusinessEntries(+req.params.id, entries);
    res.json(traj);
  }));

  /** Get a single trajectory with its phases. */
  app.get('/api/v2/trajectories/:id', asyncHandler(async (req, res) => {
    try {
      const traj = await trajectoryService.getTrajectoryWithPhases(req.params.id);
      if (!traj) return res.status(404).json({ error: 'Trajectory not found' });
      res.json(traj);
    } catch (err) {
      // Legacy shape: always 500 { error } regardless of err.statusCode
      throw new AppError(err.message, { status: 500 });
    }
  }));

  /** Phase-step tree: { phases:[{...phase, steps:[...]}, ...] } */
  app.get('/api/v2/trajectories/:id/tree', asyncHandler(async (req, res) => {
    try {
      const includeMeta = req.query?.includeMeta === '1'
        || req.query?.includeMeta === 'true'
        || req.query?.include_meta === '1';
      const tree = await trajectoryService.getTrajectoryTree(+req.params.id, { includeMeta });
      if (!tree) return res.status(404).json({ error: 'Trajectory not found' });
      res.json(tree);
    } catch (err) {
      // Legacy shape: always 500 { error } regardless of err.statusCode
      throw new AppError(err.message, { status: 500 });
    }
  }));

  /** Phases for a trajectory (by numeric trajectory.id). */
  app.get('/api/v2/trajectories/:id/phases', asyncHandler(async (req, res) => {
    try {
      const traj = await trajectoryDao.getById(+req.params.id);
      if (!traj) return res.status(404).json({ error: 'Trajectory not found' });
      const phases = await trajectoryService.listPhasesByTrajectory(traj.id);
      res.json({ trajectoryId: traj.id, phases });
    } catch (err) {
      // Legacy shape: always 500 { error } regardless of err.statusCode
      throw new AppError(err.message, { status: 500 });
    }
  }));

  /** Append a phase: body { description?, phaseNumber? } */
  app.post('/api/v2/trajectories/:id/phases', asyncHandler(async (req, res) => {
    const phase = await trajectoryService.addPhaseToTrajectory(+req.params.id, {
      description: req.body?.description ?? req.body?.task ?? '',
      phaseNumber: req.body?.phaseNumber ?? null,
    });
    res.status(201).json(phase);
  }));

  /** Sync phases by id: body { phases: string[] | { id?, description }[], businessEntries? } */
  app.put('/api/v2/trajectories/:id/phases', asyncHandlerSendErr(async (req, res) => {
    const phases = req.body?.phases ?? req.body?.descriptions ?? null;
    let traj = await trajectoryService.syncTrajectoryPhaseDescriptions(+req.params.id, phases);
    if (req.body?.businessEntries !== undefined || req.body?.businessData !== undefined) {
      traj = await trajectoryService.setTrajectoryBusinessEntries(
        +req.params.id,
        req.body.businessEntries ?? req.body.businessData,
      );
    }
    res.json(traj);
  }));

  /** Merged action flow for a trajectory (DB steps; pending empty — use session action-flow for live). */
  app.get('/api/v2/trajectories/:id/action-flow', asyncHandler(async (req, res) => {
    try {
      const flow = await trajectoryService.getTrajectoryActionFlow(+req.params.id, []);
      res.json(flow);
    } catch (err) {
      // Legacy shape: always 500 { error } regardless of err.statusCode
      throw new AppError(err.message, { status: 500 });
    }
  }));

  /** Delete a trajectory by numeric id. */
  app.delete('/api/v2/trajectories/:id', asyncHandler(async (req, res) => {
    try {
      const numeric = Number(req.params.id);
      if (Number.isNaN(numeric)) return res.status(400).json({ error: 'Numeric trajectory id required' });
      await trajectoryDao.remove(numeric);
      return res.json({ status: 'deleted', id: numeric });
    } catch (err) {
      // Legacy shape: always 500 { error } regardless of err.statusCode
      throw new AppError(err.message, { status: 500 });
    }
  }));

  /**
   * Clear recorded steps; keep phase descriptions and reset statuses to pending.
   * Optional body.phaseIds: clear only those phases' steps (omit / empty = all).
   */
  app.post('/api/v2/trajectories/:id/clear', asyncHandlerSendErr(async (req, res) => {
    const phaseIds = req.body?.phaseIds ?? req.body?.phase_ids ?? null;
    const cleared = await trajectoryService.clearTrajectory(+req.params.id, { phaseIds });
    if (!cleared) return res.status(404).json({ error: 'Trajectory not found' });
    res.json(cleared);
  }));

  /**
   * Login context: owning system + accounts for AI recording pre-login.
   * GET /api/v2/trajectories/:id/login-context
   */
  app.get('/api/v2/trajectories/:id/login-context', asyncHandlerSendErr(async (req, res) => {
    const ctx = await trajectoryService.getTrajectoryLoginContext(+req.params.id);
    res.json(ctx);
  }));
}
