/**
 * System reference data APIs — target-system captured / verified fill references.
 * Distinct from user 业务数据 and legacy /api/v2/case-data.
 */
import * as systemRefService from '../../services/system-ref-service.js';
import { sendErr, asyncHandler } from './trajectory-shared.js';

export default function registerSystemRefData(app) {
  app.get('/api/v2/system-ref-data', asyncHandler(async (req, res) => {
    const result = await systemRefService.listSystemRefData(req.query);
    res.json(result);
  }));

  app.get('/api/v2/system-ref-data/:id', asyncHandler(async (req, res) => {
    const row = await systemRefService.getSystemRefData(+req.params.id);
    res.json(row);
  }));

  app.delete('/api/v2/system-ref-data/:id', asyncHandler(async (req, res) => {
    const result = await systemRefService.deleteSystemRefData(+req.params.id);
    res.json(result);
  }));

  /** List entries for a trajectory (optional ?verificationStatus=verified). */
  app.get('/api/v2/trajectories/:id/system-ref-entries', asyncHandler(async (req, res) => {
    const result = await systemRefService.listTrajectorySystemRefEntries(
      +req.params.id,
      req.query,
    );
    res.json(result);
  }));

  /**
   * Replace all system-ref KV for a trajectory.
   * Body: { entries: [{ fieldKey, fieldValue }], source?, verificationStatus?, description? }
   */
  app.put('/api/v2/trajectories/:id/system-ref-entries', asyncHandler(async (req, res) => {
    const result = await systemRefService.replaceTrajectorySystemRefEntries(
      +req.params.id,
      req.body || {},
    );
    res.json(result);
  }));

  app.delete('/api/v2/trajectories/:id/system-ref-entries', asyncHandler(async (req, res) => {
    const result = await systemRefService.deleteTrajectorySystemRef(+req.params.id);
    res.json(result);
  }));
}
