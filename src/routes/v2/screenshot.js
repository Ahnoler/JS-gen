import * as screenshotService from '../../services/screenshot-service.js';

/**
 * Screenshot management — pending upload list, single/bulk MinIO upload, image
 * fetch, delete, and per-trajectory listing.
 *
 * Prefix: /api/v2/screenshots/*, /api/v2/trajectories/:id/screenshots
 * @param {import('express').Application} app Express application
 */
export default function (app) {
  /** List screenshots pending upload to MinIO. */
  app.get('/api/v2/screenshots/pending', async (req, res) => {
    try {
      const list = await screenshotService.listPendingScreenshots();
      res.json(list);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // One-click bulk upload of all local-pending screenshots to MinIO.
  app.post('/api/v2/screenshots/pending/upload', async (req, res) => {
    try {
      const summary = await screenshotService.uploadPendingScreenshots();
      res.json(summary);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Upload a single pending screenshot by id (per-row action in the docs UI).
  /** Upload a single pending screenshot to MinIO by id. */
  app.post('/api/v2/screenshots/:id/upload', async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id) || id <= 0) {
        return res.status(400).json({ error: 'Numeric screenshot id required' });
      }
      const result = await screenshotService.uploadPendingScreenshot(id);
      if (result.status === 'not_found') return res.status(404).json(result);
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  /** Get a screenshot's raw image bytes by id. */
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

  /** Delete a screenshot by id. */
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

  /** List all screenshots for a trajectory. */
  app.get('/api/v2/trajectories/:trajectoryId/screenshots', async (req, res) => {
    try {
      const list = await screenshotService.listByTrajectory(+req.params.trajectoryId);
      res.json(list);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
}
