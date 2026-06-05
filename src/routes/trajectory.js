import {
  loadTrajectoryIndex,
  getTrajectoryRecord,
  loadTrajectoryJson,
  deleteTrajectory,
} from '../trajectory-store.js';

export default function (app) {
  app.get('/api/trajectory', (req, res) => {
    const list = loadTrajectoryIndex();
    res.json(list.map(r => ({
      trajectoryId: r.trajectoryId,
      task: r.task,
      model: r.model,
      stepCount: r.stepCount,
      actionCount: r.actionCount,
      isSuccessful: r.isSuccessful,
      createdAt: r.createdAt,
    })));
  });

  app.get('/api/trajectory/:trajectoryId', (req, res) => {
    const record = getTrajectoryRecord(req.params.trajectoryId);
    if (!record) return res.status(404).json({ error: 'Trajectory not found' });

    const includeJson = req.query.full === '1' || req.query.full === 'true';
    const payload = { ...record };

    if (includeJson) {
      const trajectory = loadTrajectoryJson(req.params.trajectoryId);
      if (!trajectory) return res.status(404).json({ error: 'Trajectory file missing' });
      payload.trajectory = trajectory;
    }

    res.json(payload);
  });

  app.delete('/api/trajectory/:trajectoryId', (req, res) => {
    const ok = deleteTrajectory(req.params.trajectoryId);
    if (!ok) return res.status(404).json({ error: 'Trajectory not found' });
    res.json({ status: 'deleted', trajectoryId: req.params.trajectoryId });
  });
}
