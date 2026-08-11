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

function sendErr(res, err, fallback = 500) {
  const status = err.statusCode || fallback;
  const body = { error: err.message };
  if (err.holders) body.holders = err.holders;
  res.status(status).json(body);
}

export default function (app) {
  /** Prepare: materialize + assemble + step map */
  app.post('/api/v2/trajectories/:id/replay/prepare', async (req, res) => {
    try {
      const result = await replayService.prepareReplay(+req.params.id);
      res.json(result);
    } catch (err) {
      sendErr(res, err);
    }
  });

  /** Start Playwright replay; progress on WS replay:* */
  app.post('/api/v2/trajectories/:id/replay/start', async (req, res) => {
    try {
      const result = await replayService.startReplay(+req.params.id, {
        replayPlanId: req.body?.replayPlanId || null,
      });
      res.json(result);
    } catch (err) {
      sendErr(res, err);
    }
  });

  app.post('/api/v2/trajectories/:id/replay/stop', async (req, res) => {
    try {
      res.json(replayService.stopReplay(+req.params.id));
    } catch (err) {
      sendErr(res, err);
    }
  });

  app.get('/api/v2/trajectories/:id/replay/latest', async (req, res) => {
    try {
      const latest = replayService.getLatestReplay(+req.params.id);
      if (!latest) return res.status(404).json({ error: 'No replay found for trajectory' });
      res.json(latest);
    } catch (err) {
      sendErr(res, err);
    }
  });

  app.get('/api/v2/replays/:replayId', async (req, res) => {
    try {
      const replay = replayService.getReplay(req.params.replayId);
      if (!replay) return res.status(404).json({ error: 'Replay not found' });
      res.json(replay);
    } catch (err) {
      sendErr(res, err);
    }
  });

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
