import { writeFileSync, mkdirSync, existsSync } from 'fs';
import path from 'path';
import * as trajectoryDao from '../../dao/trajectory-dao.js';
import * as trajectoryService from '../../services/trajectory-service.js';
import { PROJECT_DIR } from '../../../config/config.js';

function stepsToActionCommands(steps) {
  return (steps || []).map((s) => {
    const params = s.params ?? s.paramsJson ?? null;
    return {
      action: s.actionType || s.action || '',
      params: typeof params === 'string'
        ? (() => { try { return JSON.parse(params); } catch { return {}; } })()
        : (params || {}),
      result: s.extractedContent || s.result || '',
      phase: s.phaseNumber ?? 0,
      target: s.element?.xpath || '',
      source: s.source || 'agent',
    };
  });
}

export default function (app) {
  app.get('/api/v2/trajectories', async (req, res) => {
    try {
      const { page, pageSize, functionId } = req.query;
      const result = functionId
        ? await trajectoryService.listByFunction(+functionId, { page: +page || 1, pageSize: +pageSize || 20 })
        : await trajectoryDao.list({ page: +page || 1, pageSize: +pageSize || 20 });
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  /** Create empty long-lived trajectory under a function. */
  app.post('/api/v2/trajectories', async (req, res) => {
    try {
      const { functionId, task, model } = req.body || {};
      const id = await trajectoryService.createEmptyTrajectory({
        functionId: functionId != null ? +functionId : undefined,
        task: task || '',
        model: model || '',
      });
      const traj = await trajectoryDao.getById(id);
      res.status(201).json(traj);
    } catch (err) {
      res.status(500).json({ error: err.message });
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

  /** Steps for a trajectory_phase (by numeric phase.id). */
  app.get('/api/v2/trajectory-phases/:id/steps', async (req, res) => {
    try {
      const steps = await trajectoryService.listStepsByPhase(+req.params.id);
      res.json({ phaseId: +req.params.id, steps });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
}
