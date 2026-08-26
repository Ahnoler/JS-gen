import { createPushChannel } from '../runtime/sse-channel.js';
import { onWsMessage } from '../ws-server.js';
import { executeScript, executeScriptSync } from '../runtime/script-runner.js';

/**
 * Engineering-only Playwright script execution — SSE-streaming run, WebSocket
 * run trigger, and a synchronous run endpoint. (Deprecated product path; live
 * replay uses /api/v2/trajectories/:id/replay/*.)
 *
 * Prefix: /api/test/run*
 * @param {import('express').Application} app Express application
 */
export default function (app) {
  /** Run a Playwright script and stream execution events as SSE. */
  app.post('/api/test/run', (req, res) => {
    const { script, fileName } = req.body || {};
    if (!script) return res.status(400).json({ error: 'script is required' });

    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    if (res.socket) {
      res.socket.setNoDelay(true);
      res.socket.setKeepAlive(true, 30000);
    }

    const channel = createPushChannel(null, res, 'execution');
    executeScript({ script, fileName, channel });
  });

  onWsMessage((ws, msg) => {
    if (msg.type === 'execution:start') {
      const { script, fileName } = msg.payload || {};
      if (!script) {
        ws.send(JSON.stringify({ type: 'execution:error', payload: { message: 'script is required' } }));
        return;
      }
      const channel = createPushChannel(ws, null, 'execution');
      executeScript({ script, fileName, channel });
    }
  });

  /** Run a Playwright script synchronously and return the final result JSON. */
  app.post('/api/test/run-sync', async (req, res) => {
    const { script, fileName } = req.body || {};
    if (!script) return res.status(400).json({ error: 'script is required' });

    try {
      const result = await executeScriptSync({ script, fileName });
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
}
