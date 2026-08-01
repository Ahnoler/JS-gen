import * as screenshotService from '../../services/screenshot-service.js';

export default function (app) {
  app.get('/api/v2/screenshots/:id/image', async (req, res) => {
    try {
      const row = await screenshotService.getScreenshotImage(+req.params.id);
      if (!row) return res.status(404).json({ error: 'Screenshot not found' });
      res.set('Content-Type', row.mime_type || 'image/png');
      res.set('Content-Length', row.file_size);
      res.send(row.image_data);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  /** Body: { steps: number[] } → screenshots[] metadata (no BLOB). */
  app.post('/api/v2/screenshots/by-steps', async (req, res) => {
    try {
      const steps = Array.isArray(req.body?.steps) ? req.body.steps : [];
      const screenshots = await screenshotService.listBySteps(steps);
      res.json({ screenshots });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/v2/trajectories/:trajectoryId/screenshots', async (req, res) => {
    try {
      const list = await screenshotService.listByTrajectory(+req.params.trajectoryId);
      res.json(list);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
}
