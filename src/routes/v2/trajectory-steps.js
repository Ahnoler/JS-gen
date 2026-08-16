import * as trajectoryService from '../../services/trajectory-service.js';
import { sendErr } from './trajectory-shared.js';

export default function (app) {
  /**
   * Re-run selected steps in the live session (async).
   * Body: { stepIds: number[], isReplay?: boolean }
   * HTTP 202 Accepted; v2 envelope body.code remains 200 with
   * { trajectoryId, accepted: true, stepIds }. Progress via WS:
   * replay:started → replay:step (running|success|failed) → replay:finished.
   * Failure → confirmed=0 + single-step AI heal → continue remaining steps.
   */
  app.post('/api/v2/trajectories/:id/steps/replay', async (req, res) => {
    try {
      const accepted = await trajectoryService.acceptTrajectoryStepsReplay(+req.params.id, {
        stepIds: req.body?.stepIds,
        isReplay: req.body?.isReplay !== false && req.body?.is_replay !== false,
      });
      // HTTP 202; envelope middleware wraps as { code: 200, data: accepted }
      res.status(202).json(accepted);
    } catch (err) {
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
   * Stop in-flight steps/replay (including Type A/B heal). Does not change recordStatus.
   * Sends cancel_step; batch ends with WS replay:finished { aborted:true, reason:'user_stop' }.
   */
  app.post('/api/v2/trajectories/:id/steps/replay/stop', async (req, res) => {
    try {
      const result = await trajectoryService.stopTrajectoryStepsReplay(+req.params.id);
      res.json(result);
    } catch (err) {
      sendErr(res, err);
    }
  });

  /** Steps for a trajectory_phase (by numeric phase.id). */
  app.get('/api/v2/trajectory-phases/:id/steps', async (req, res) => {
    try {
      const includeMeta = req.query?.includeMeta === '1'
        || req.query?.includeMeta === 'true'
        || req.query?.include_meta === '1';
      const steps = await trajectoryService.listStepsByPhase(+req.params.id, { includeMeta });
      res.json({ phaseId: +req.params.id, steps });
    } catch (err) {
      res.status(err.statusCode || 500).json({ error: err.message });
    }
  });

  app.patch('/api/v2/trajectory-steps/:id/confirm', async (req, res) => {
    try {
      const row = await trajectoryService.confirmTrajectoryStep(+req.params.id, !!req.body?.confirmed);
      if (!row) return res.status(404).json({ error: 'Trajectory step not found' });
      res.json(row);
    } catch (err) {
      res.status(err.statusCode || 500).json({ error: err.message });
    }
  });

  app.post('/api/v2/trajectory-steps', async (req, res) => {
    try {
      const row = await trajectoryService.createTrajectoryStep(req.body || {});
      res.status(201).json(row);
    } catch (err) {
      res.status(err.statusCode || 500).json({ error: err.message, code: err.code });
    }
  });

  app.patch('/api/v2/trajectory-steps/:id', async (req, res) => {
    try {
      const row = await trajectoryService.updateTrajectoryStep(+req.params.id, req.body || {});
      if (!row) return res.status(404).json({ error: 'Trajectory step not found' });
      res.json(row);
    } catch (err) {
      res.status(err.statusCode || 500).json({ error: err.message, code: err.code });
    }
  });

  app.delete('/api/v2/trajectory-steps/:id', async (req, res) => {
    try {
      const result = await trajectoryService.removeTrajectoryStep(+req.params.id);
      if (!result.removed) return res.status(404).json({ error: 'Trajectory step not found' });
      res.json(result);
    } catch (err) {
      res.status(err.statusCode || 500).json({ error: err.message });
    }
  });

  app.post('/api/v2/trajectories/:id/steps/move', async (req, res) => {
    try {
      const row = await trajectoryService.moveTrajectoryStep(+req.params.id, {
        stepId: req.body?.stepId,
        targetPhaseId: req.body?.targetPhaseId ?? req.body?.trajectoryPhaseId,
        beforeStepId: req.body?.beforeStepId !== undefined
          ? req.body.beforeStepId
          : null,
      });
      if (!row) return res.status(404).json({ error: 'Trajectory step not found' });
      res.json(row);
    } catch (err) {
      res.status(err.statusCode || 500).json({ error: err.message, code: err.code });
    }
  });
}
