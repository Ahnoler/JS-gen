import * as trajectoryDao from '../../dao/trajectory-dao.js';
import * as trajectoryService from '../../services/trajectory-service.js';

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

  app.delete('/api/v2/trajectories/:id', async (req, res) => {
    try {
      await trajectoryDao.remove(req.params.id);
      res.json({ status: 'deleted' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
}
