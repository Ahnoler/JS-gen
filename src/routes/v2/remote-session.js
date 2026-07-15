import * as remoteSessionDao from '../../dao/remote-session-dao.js';
import * as remoteSessionService from '../../services/remote-session-service.js';
import { initRemoteBridgeWs } from '../../cdp/remote-bridge.js';

export default function (app) {
  initRemoteBridgeWs();

  /** Live CDP attach: Session Chrome + screencast bridge + DB row */
  app.post('/api/v2/remote-sessions/attach-live', async (req, res) => {
    try {
      const result = await remoteSessionService.attachLive(req.body || {});
      res.status(201).json(result);
    } catch (err) {
      const code = /not ready|unavailable|No page/i.test(err.message) ? 503 : 500;
      res.status(code).json({ error: err.message });
    }
  });

  app.get('/api/v2/remote-sessions/live/status', async (req, res) => {
    try {
      res.json(await remoteSessionService.getLiveStatus());
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

  /** Detach live CDP bridge for this remote_session (or current live if id matches). */
  app.post('/api/v2/remote-sessions/:id/detach', async (req, res) => {
    try {
      const id = +req.params.id;
      const live = await remoteSessionService.getLiveStatus();
      if (live.remoteSessionId && live.remoteSessionId !== id) {
        return res.status(409).json({
          error: 'Detached id does not match the active live session',
          activeId: live.remoteSessionId,
        });
      }
      const result = await remoteSessionService.detachLive({
        crashed: !!(req.body && req.body.crashed),
      });
      if (!result.closedId && !live.attached) {
        const session = await remoteSessionService.closeSession(id, {
          crashed: !!(req.body && req.body.crashed),
        });
        if (!session) return res.status(404).json({ error: 'Remote session not found' });
        return res.json({ remoteSession: session, status: result.status });
      }
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/v2/remote-sessions/:id/close', async (req, res) => {
    try {
      const crashed = !!(req.body && req.body.crashed);
      const live = await remoteSessionService.getLiveStatus();
      if (live.remoteSessionId === +req.params.id) {
        await remoteSessionService.detachLive({ crashed });
      }
      const session = await remoteSessionService.closeSession(+req.params.id, { crashed });
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
