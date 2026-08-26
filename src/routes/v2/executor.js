/**
 * Executor node ops API (read-only + drain trigger).
 * Registration happens over WS /ws/executor (executor.register), not HTTP.
 */
import * as executorService from '../../services/executor-node-service.js';
import * as registry from '../../executor-registry.js';

/**
 * Executor node ops API (read-only + drain trigger).
 * Registration happens over WS /ws/executor (executor.register), not HTTP.
 *
 * Prefix: /api/v2/executors/*
 * @param {import('express').Application} app Express application
 */
export default function (app) {
  /** List all registered executor nodes. */
  app.get('/api/v2/executors', async (_req, res) => {
    try {
      const nodes = await executorService.list();
      res.json({ count: nodes.length, nodes });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  /** Get a single executor node by UUID (includes WS connection status). */
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

  /** Drain an executor node (stop accepting new session leases). */
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
