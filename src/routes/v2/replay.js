/**
 * Trajectory replay APIs (assemble → run → WS step/screenshot progress).
 *
 * Legacy: Product-supported replay is attached/live `replay_actions` via
 * `scripts/controller/actions/_replay.py` (e.g. `/steps/replay`). This `/replay/*` path
 * remains runnable as an engineering asset (assembled Playwright + CTRL) but
 * is no longer the product-supported path. Do not remove without a migration.
 */
import * as replayService from '../../services/replay-service.js';
import { onWsMessage } from '../../ws-server.js';
import { sendErr, asyncHandler } from './trajectory-shared.js';

export default function (app) {
  /** Prepare: materialize + assemble + step map */
  app.post('/api/v2/trajectories/:id/replay/prepare', asyncHandler(async (req, res) => {
    const result = await replayService.prepareReplay(+req.params.id);
    res.json(result);
  }));

  /** Start Playwright replay; progress on WS replay:* */
  app.post('/api/v2/trajectories/:id/replay/start', asyncHandler(async (req, res) => {
    const result = await replayService.startReplay(+req.params.id, {
      replayPlanId: req.body?.replayPlanId || null,
    });
    res.json(result);
  }));

  app.post('/api/v2/trajectories/:id/replay/stop', asyncHandler(async (req, res) => {
    res.json(replayService.stopReplay(+req.params.id));
  }));

  app.get('/api/v2/trajectories/:id/replay/latest', asyncHandler(async (req, res) => {
    const latest = replayService.getLatestReplay(+req.params.id);
    if (!latest) return res.status(404).json({ error: 'No replay found for trajectory' });
    res.json(latest);
  }));

  app.get('/api/v2/replays/:replayId', asyncHandler(async (req, res) => {
    const replay = replayService.getReplay(req.params.replayId);
    if (!replay) return res.status(404).json({ error: 'Replay not found' });
    res.json(replay);
  }));

  // Optional: start via WS with same payload
  onWsMessage((ws, msg) => {
    if (msg.type !== 'replay:start') return;
    const { trajectoryId, replayPlanId } = msg.payload || {};
    if (!trajectoryId) {
      ws.send(JSON.stringify({ type: 'replay:error', payload: { message: 'trajectoryId is required' } }));
      return;
    }
    Promise.resolve(replayService.startReplay(+trajectoryId, { replayPlanId, ws }))
      .then((result) => {
        ws.send(JSON.stringify({ type: 'replay:started', payload: result }));
      })
      .catch((err) => {
        ws.send(JSON.stringify({
          type: 'replay:error',
          payload: { message: err.message, statusCode: err.statusCode },
        }));
      });
  });
}
