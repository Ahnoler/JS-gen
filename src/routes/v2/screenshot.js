import * as screenshotService from '../../services/screenshot-service.js';

export default function (app) {
  app.get('/api/v2/screenshots/pending', async (req, res) => {
    try {
      const list = await screenshotService.listPendingScreenshots();
      res.json(list);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/v2/screenshots/:id/image', async (req, res) => {
    try {
      const row = await screenshotService.getScreenshotImage(+req.params.id);
      if (!row) return res.status(404).json({ error: 'Screenshot not found' });
      res.set('Content-Type', row.mimeType || 'image/png');
      res.set('Content-Length', row.fileSize);
      res.send(row.buffer);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete('/api/v2/screenshots/:id', async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id) || id <= 0) {
        return res.status(400).json({ error: 'Numeric screenshot id required' });
      }
      const removed = await screenshotService.deleteScreenshot(id);
      if (!removed) return res.status(404).json({ error: 'Screenshot not found' });
      res.json({ status: 'deleted', id });
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
