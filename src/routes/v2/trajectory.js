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

  app.get('/api/v2/trajectories/:id', async (req, res) => {
    try {
      const traj = await trajectoryService.getTrajectoryWithPhases(req.params.id);
      if (!traj) return res.status(404).json({ error: 'Trajectory not found' });
      res.json(traj);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * Materialize DB steps as scripts/action/action_db_*.json for the assembler.
   */
  app.post('/api/v2/trajectories/:id/assemble-file', async (req, res) => {
    try {
      const traj = await trajectoryDao.getByTrajectoryId(req.params.id);
      if (!traj) return res.status(404).json({ error: 'Trajectory not found' });
      const actionDir = path.join(PROJECT_DIR, 'scripts', 'action');
      if (!existsSync(actionDir)) mkdirSync(actionDir, { recursive: true });
      const commands = stepsToActionCommands(traj.steps);
      const actionJson = {
        id: traj.trajectoryId,
        name: 'db-trajectory',
        url: traj.url || '',
        tests: [{ id: traj.trajectoryId, name: 'db-trajectory', commands }],
      };
      const safeId = String(traj.trajectoryId).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 48);
      const fileName = `action_db_${safeId}.json`;
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
      const id = req.params.id;
      const deleted = await trajectoryDao.removeByTrajectoryId(id);
      if (deleted) return res.json({ status: 'deleted', trajectoryId: id });
      const numeric = Number(id);
      if (!Number.isNaN(numeric) && String(numeric) === id) {
        await trajectoryDao.remove(numeric);
        return res.json({ status: 'deleted', id: numeric });
      }
      return res.status(404).json({ error: 'Trajectory not found' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
}
