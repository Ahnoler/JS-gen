import * as trajectoryService from '../../services/trajectory-service.js';
import { sendErr } from './trajectory-shared.js';

export default function (app) {
  app.post('/api/v2/trajectories/:id/attach', async (req, res) => {
    try {
      const result = await trajectoryService.attachTrajectoryLive(+req.params.id);
      res.status(201).json(result);
    } catch (err) {
      sendErr(res, err);
    }
  });

  app.post('/api/v2/trajectories/:id/detach', async (req, res) => {
    try {
      const result = await trajectoryService.detachTrajectoryLive(+req.params.id);
      res.json(result);
    } catch (err) {
      sendErr(res, err);
    }
  });

  /** Disconnect BiB stream only — keep agent session + browser idle. */
  app.post('/api/v2/trajectories/:id/stream/detach', async (req, res) => {
    try {
      const result = await trajectoryService.detachTrajectoryStream(+req.params.id);
      res.json(result);
    } catch (err) {
      sendErr(res, err);
    }
  });

  /**
   * One-shot enter recording studio (requires bound systemAccountId):
   * 1) session create  2) allocate browser  3) BiB stream  4) navigate/login
   * Broadcasts recording:prepare { stage, status } over /ws. Stream may be degraded
   * without failing the critical path (session + login). Idempotent when already live.
   * POST /api/v2/trajectories/:id/record/prepare
   */
  app.post('/api/v2/trajectories/:id/record/prepare', async (req, res) => {
    try {
      const result = await trajectoryService.prepareTrajectoryRecording(+req.params.id);
      res.json(result);
    } catch (err) {
      sendErr(res, err);
    }
  });

  /**
   * Start AI recording for all phases or subset.
   * Body: { phaseIds?: number[], accountId?: number }
   * Login/navigate is done in record/prepare (not stored as steps).
   * accountId optional — defaults to trajectory.systemAccountId.
   */
  app.post('/api/v2/trajectories/:id/record/start', async (req, res) => {
    try {
      const phaseIds = req.body?.phaseIds;
      const accountId = req.body?.accountId ?? req.body?.systemAccountId;
      const result = await trajectoryService.startTrajectoryRecording(+req.params.id, {
        phaseIds: Array.isArray(phaseIds) ? phaseIds : null,
        accountId,
      });
      res.json(result);
    } catch (err) {
      sendErr(res, err);
    }
  });

  /**
   * Explicit end of recording (does not detach BiB).
   * Body: { success?: boolean } default true → recorded; false → draft
   */
  app.post('/api/v2/trajectories/:id/record/stop', async (req, res) => {
    try {
      const success = req.body?.success !== false && req.body?.success !== 0;
      const result = await trajectoryService.stopTrajectoryRecording(+req.params.id, { success });
      res.json(result);
    } catch (err) {
      sendErr(res, err);
    }
  });

  /**
   * Human confirm / cancel-confirm a trajectory (transaction-level).
   * Body: { confirmed: boolean } — true → recordStatus=completed; false → draft.
   * Does not modify trajectory_step.confirmed (回放确认).
   */
  app.post('/api/v2/trajectories/:id/confirm', async (req, res) => {
    try {
      const confirmed = req.body?.confirmed !== false && req.body?.confirmed !== 0;
      const result = await trajectoryService.confirmTrajectory(+req.params.id, confirmed);
      res.json(result);
    } catch (err) {
      sendErr(res, err);
    }
  });

  /**
   * Resolve Element UI control by label_text / actionType+params on attached BiB page.
   * Body: { labelText?, actionType?, params?, mode? } — default mode=inventory
   * Returns { element, matchedLabel } or { ambiguous:true, matches:[] }.
   */
  app.post('/api/v2/trajectories/:id/resolve-element', async (req, res) => {
    try {
      const body = req.body || {};
      const result = await trajectoryService.resolveTrajectoryElement(+req.params.id, {
        labelText: body.labelText ?? body.label_text ?? '',
        actionType: body.actionType ?? body.action ?? '',
        params: body.params || {},
        mode: body.mode ?? 'inventory',
        pageLabel: body.pageLabel ?? body.page_label ?? '',
      });
      res.json(result);
    } catch (err) {
      sendErr(res, err);
    }
  });

  /**
   * Toggle manual recording. Body: { enabled, phaseId? }
   * phaseId omitted → append to last phase of trajectory.
   */
  app.post('/api/v2/trajectories/:id/manual-record', async (req, res) => {
    try {
      const result = await trajectoryService.toggleTrajectoryManualRecord(
        +req.params.id,
        !!req.body?.enabled,
        { phaseId: req.body?.phaseId ?? req.body?.trajectoryPhaseId ?? null },
      );
      res.json(result);
    } catch (err) {
      res.status(err.statusCode || 500).json({ error: err.message });
    }
  });
}
