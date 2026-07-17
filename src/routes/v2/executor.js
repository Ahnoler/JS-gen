/**
 * Executor node ops API (read-only + drain trigger).
 * Registration happens over WS /ws/executor (executor.register), not HTTP.
 */
import * as executorService from '../../services/executor-node-service.js';
import * as registry from '../../executor-registry.js';

export default function (app) {
  app.get('/api/v2/executors', async (_req, res) => {
    try {
      const nodes = await executorService.list();
      res.json({ count: nodes.length, nodes });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/v2/executors/:nodeUuid', async (req, res) => {
    try {
      const node = await executorService.getByUuid(req.params.nodeUuid);
      if (!node) return res.status(404).json({ error: 'Executor node not found' });
      res.json({
        ...node,
        connected: registry.isConnected(node.nodeUuid),
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/v2/executors/:nodeUuid/drain', async (req, res) => {
    try {
      const node = await executorService.drain(req.params.nodeUuid);
      if (!node) return res.status(404).json({ error: 'Executor node not found' });
      res.json(node);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
}
