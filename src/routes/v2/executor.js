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

  /**
   * Close an orphan executor session by nodeUuid + sessionId (no trajectory binding).
   * keepBrowser=true: kill the Python agent but leave Chrome on CDP for reuse.
   */
  app.post('/api/v2/executors/:nodeUuid/sessions/:sessionId/close', async (req, res) => {
    try {
      const { nodeUuid, sessionId } = req.params;
      if (!registry.isConnected(nodeUuid)) {
        return res.status(409).json({ error: 'executor node not connected' });
      }
      const execSession = await import('../../executor-session-client.js');
      const sessions = await execSession.listExecutorSessions(nodeUuid, 8000).catch(() => []);
      if (!(Array.isArray(sessions) ? sessions : []).some((s) => s.sessionId === sessionId)) {
        return res.status(404).json({ error: 'session not found on executor' });
      }
      await execSession.closeSession({ nodeUuid, sessionId, keepBrowser: true, timeoutMs: 12000 });
      res.json({ status: 'closed', nodeUuid, sessionId, keepBrowser: true });
    } catch (err) {
      res.status(err.statusCode || 500).json({ error: err.message });
    }
  });
}
