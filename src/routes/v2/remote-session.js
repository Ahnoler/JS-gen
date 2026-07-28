import * as remoteSessionDao from '../../dao/remote-session-dao.js';
import * as remoteSessionService from '../../services/remote-session-service.js';
import { initRemoteBridgeWs } from '../../cdp/remote-bridge.js';

export default function (app) {
  initRemoteBridgeWs();

  /** Live CDP attach: Session Chrome + screencast bridge + DB row */
  app.post('/api/v2/remote-sessions/attach-live', async (req, res) => {
    try {
      const body = req.body || {};
      if (!body.sessionId && !body.browserSessionId) {
        return res.status(400).json({ error: 'sessionId is required' });
      }
      const result = await remoteSessionService.attachLive(body);
      res.status(201).json(result);
    } catch (err) {
      const code = err.statusCode
        || (/not ready|unavailable|No page/i.test(err.message) ? 503 : 500);
      res.status(code).json({ error: err.message });
    }
  });

  app.get('/api/v2/remote-sessions/live/status', async (req, res) => {
    try {
      const trajectoryId = req.query.trajectoryId != null ? +req.query.trajectoryId : undefined;
      const remoteSessionId = req.query.remoteSessionId != null ? +req.query.remoteSessionId : undefined;
      const sessionId = req.query.sessionId || undefined;
      res.json(await remoteSessionService.getLiveStatus({
        trajectoryId,
        remoteSessionId,
        sessionId,
      }));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/v2/remote-sessions', async (req, res) => {
    try {
      const { status, page, pageSize } = req.query;
      const result = await remoteSessionService.listSessions({
        status,
        page: +page || 1,
        pageSize: +pageSize || 20,
      });
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/v2/remote-sessions', async (req, res) => {
    try {
      const session = await remoteSessionService.openSession(req.body || {});
      res.status(201).json(session);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/v2/remote-sessions/:id', async (req, res) => {
    try {
      const id = req.params.id;
      const session = /^\d+$/.test(id)
        ? await remoteSessionService.getSession(+id)
        : await remoteSessionService.getByUuid(id);
      if (!session) return res.status(404).json({ error: 'Remote session not found' });
      res.json(session);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.patch('/api/v2/remote-sessions/:id', async (req, res) => {
    try {
      const id = +req.params.id;
      const body = req.body || {};
      const patch = {};

      if (body.viewportW != null) patch.viewportW = body.viewportW;
      if (body.viewportH != null) patch.viewportH = body.viewportH;
      if (body.deviceScaleFactor != null) patch.deviceScaleFactor = body.deviceScaleFactor;
      if (body.browserContextId != null) patch.browserContextId = body.browserContextId;
      if (body.targetId != null) patch.targetId = body.targetId;
      if (body.url != null) patch.url = body.url;

      if (!Object.keys(patch).length) {
        return res.status(400).json({ error: 'No updatable fields provided' });
      }

      const session = await remoteSessionDao.update(id, patch);
      if (!session) return res.status(404).json({ error: 'Remote session not found' });
      res.json(session);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * Disconnect stream for this remote_session (→ idle). Ownership-checked.
   * Body may include trajectoryId for extra validation.
   */
  app.post('/api/v2/remote-sessions/:id/detach', async (req, res) => {
    try {
      const id = +req.params.id;
      const trajectoryId = req.body?.trajectoryId != null ? +req.body.trajectoryId : undefined;
      const remote = await remoteSessionDao.getById(id);
      if (!remote) return res.status(404).json({ error: 'Remote session not found' });

      if (remote.status !== 'active' && remote.status !== 'idle') {
        // Idempotent: already idle/closed
        const status = await remoteSessionService.getLiveStatus({
          trajectoryId,
          remoteSessionId: id,
        });
        return res.json({
          closedId: id,
          streamDetached: remote.status === 'idle',
          sessionKept: true,
          status,
        });
      }

      if (
        trajectoryId
        && remote.trajectoryId != null
        && Number(remote.trajectoryId) !== trajectoryId
      ) {
        return res.status(409).json({
          error: 'remote_session does not belong to this trajectory',
          trajectoryId: remote.trajectoryId,
        });
      }

      const result = await remoteSessionService.detachLive({
        remoteSessionId: id,
        trajectoryId: trajectoryId ?? (remote.trajectoryId != null ? Number(remote.trajectoryId) : undefined),
        crashed: !!(req.body && req.body.crashed),
      });
      res.json(result);
    } catch (err) {
      res.status(err.statusCode || 500).json({ error: err.message });
    }
  });

  app.post('/api/v2/remote-sessions/:id/close', async (req, res) => {
    try {
      const crashed = !!(req.body && req.body.crashed);
      const id = +req.params.id;
      const remote = await remoteSessionDao.getById(id);
      if (!remote) return res.status(404).json({ error: 'Remote session not found' });

      await remoteSessionService.detachLive({
        remoteSessionId: id,
        trajectoryId: remote.trajectoryId != null ? Number(remote.trajectoryId) : undefined,
        crashed,
      }).catch(() => {});

      const session = await remoteSessionService.closeSession(id, { crashed });
      if (!session) return res.status(404).json({ error: 'Remote session not found' });
      res.json(session);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete('/api/v2/remote-sessions/:id', async (req, res) => {
    try {
      await remoteSessionDao.remove(+req.params.id);
      res.json({ status: 'deleted' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
}
