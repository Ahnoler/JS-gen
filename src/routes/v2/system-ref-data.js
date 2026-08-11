/**
 * System reference data APIs — target-system captured / verified fill references.
 * Distinct from user 业务数据 and legacy /api/v2/case-data.
 */
import * as systemRefService from '../../services/system-ref-service.js';

function sendErr(res, err) {
  const code = err.statusCode || 500;
  return res.status(code).json({ error: err.message });
}

export default function registerSystemRefData(app) {
  app.get('/api/v2/system-ref-data', async (req, res) => {
    try {
      const result = await systemRefService.listSystemRefData(req.query);
      res.json(result);
    } catch (err) {
      sendErr(res, err);
    }
  });

  app.get('/api/v2/system-ref-data/:id', async (req, res) => {
    try {
      const row = await systemRefService.getSystemRefData(+req.params.id);
      res.json(row);
    } catch (err) {
      sendErr(res, err);
    }
  });

  app.delete('/api/v2/system-ref-data/:id', async (req, res) => {
    try {
      const result = await systemRefService.deleteSystemRefData(+req.params.id);
      res.json(result);
    } catch (err) {
      sendErr(res, err);
    }
  });

  /** List entries for a trajectory (optional ?verificationStatus=verified). */
  app.get('/api/v2/trajectories/:id/system-ref-entries', async (req, res) => {
    try {
      const result = await systemRefService.listTrajectorySystemRefEntries(
        +req.params.id,
        req.query,
      );
      res.json(result);
    } catch (err) {
      sendErr(res, err);
    }
  });

  /**
   * Replace all system-ref KV for a trajectory.
   * Body: { entries: [{ fieldKey, fieldValue }], source?, verificationStatus?, description? }
   */
  app.put('/api/v2/trajectories/:id/system-ref-entries', async (req, res) => {
    try {
      const result = await systemRefService.replaceTrajectorySystemRefEntries(
        +req.params.id,
        req.body || {},
      );
      res.json(result);
    } catch (err) {
      sendErr(res, err);
    }
  });

  app.delete('/api/v2/trajectories/:id/system-ref-entries', async (req, res) => {
    try {
      const result = await systemRefService.deleteTrajectorySystemRef(+req.params.id);
      res.json(result);
    } catch (err) {
      sendErr(res, err);
    }
  });
}
