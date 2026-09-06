import * as remoteSessionDao from '../../dao/remote-session-dao.js';
import * as remoteSessionService from '../../services/remote-session-service.js';
import { asyncHandler, AppError } from '../../http/app-error.js';
import { initRemoteBridgeWs } from '../../cdp/remote-bridge.js';

/**
 * Remote CDP session lifecycle — attach/detach live screencast bridges, CRUD
 * session rows, and close/delete.
 *
 * Prefix: /api/v2/remote-sessions/*
 * @param {import('express').Application} app Express application
 */
export default function (app) {
  initRemoteBridgeWs();

  /** Live CDP attach: Session Chrome + screencast bridge + DB row */
  app.post('/api/v2/remote-sessions/attach-live', asyncHandler(async (req, res) => {
    const body = req.body || {};
    if (!body.sessionId && !body.browserSessionId) {
      return res.status(400).json({ error: 'sessionId is required' });
    }
    let result;
    try {
      result = await remoteSessionService.attachLive(body);
    } catch (err) {
      // Preserve legacy extended body (code / ownerTrajectoryId / graceUntil)
      // and 503-on-not-ready/unavailable status mapping.
      const status = err.statusCode
        || (/not ready|unavailable|No page/i.test(err.message) ? 503 : 500);
      const errBody = { error: err.message };
      if (err.code) errBody.code = err.code;
      if (err.ownerTrajectoryId != null) errBody.ownerTrajectoryId = err.ownerTrajectoryId;
      if (err.graceUntil != null) errBody.graceUntil = err.graceUntil;
      throw new AppError(err.message, { status, body: errBody });
    }
    res.status(201).json(result);
  }));

  /** Get live CDP attach status (optionally scoped by trajectory/session). */
  app.get('/api/v2/remote-sessions/live/status', asyncHandler(async (req, res) => {
    const trajectoryId = req.query.trajectoryId != null ? +req.query.trajectoryId : undefined;
    const remoteSessionId = req.query.remoteSessionId != null ? +req.query.remoteSessionId : undefined;
    const remoteSessionUuid = req.query.remoteSessionUuid || undefined;
    const sessionId = req.query.sessionId || undefined;
    res.json(await remoteSessionService.getLiveStatus({
      trajectoryId,
      remoteSessionId,
      remoteSessionUuid,
      sessionId,
    }));
  }));

  /** List remote sessions (paginated, optional status filter). */
  app.get('/api/v2/remote-sessions', asyncHandler(async (req, res) => {
    const { status, page, pageSize } = req.query;
    const result = await remoteSessionService.listSessions({
      status,
      page: +page || 1,
      pageSize: +pageSize || 20,
    });
    res.json(result);
  }));

  /** Open a new remote session (creates DB row). */
  app.post('/api/v2/remote-sessions', asyncHandler(async (req, res) => {
    const session = await remoteSessionService.openSession(req.body || {});
    res.status(201).json(session);
  }));

  /** Get a single remote session by numeric id or UUID. */
  app.get('/api/v2/remote-sessions/:id', asyncHandler(async (req, res) => {
    const id = req.params.id;
    const session = /^\d+$/.test(id)
      ? await remoteSessionService.getSession(+id)
      : await remoteSessionService.getByUuid(id);
    if (!session) return res.status(404).json({ error: 'Remote session not found' });
    res.json(session);
  }));

  /** Update editable fields of a remote session (viewport, target, url, …). */
  app.patch('/api/v2/remote-sessions/:id', asyncHandler(async (req, res) => {
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
  }));

  /**
   * Disconnect stream for this remote_session (→ idle). Ownership-checked.
   * Body may include trajectoryId for extra validation.
   */
  app.post('/api/v2/remote-sessions/:id/detach', asyncHandler(async (req, res) => {
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

    let result;
    try {
      result = await remoteSessionService.detachLive({
        remoteSessionId: id,
        trajectoryId: trajectoryId ?? (remote.trajectoryId != null ? Number(remote.trajectoryId) : undefined),
        crashed: !!(req.body && req.body.crashed),
      });
    } catch (err) {
      // Preserve legacy extended body (code / ownerTrajectoryId / graceUntil)
      throw new AppError(err.message, {
        status: err.statusCode || 500,
        body: {
          error: err.message,
          ...(err.code ? { code: err.code } : {}),
          ...(err.ownerTrajectoryId != null ? { ownerTrajectoryId: err.ownerTrajectoryId } : {}),
          ...(err.graceUntil != null ? { graceUntil: err.graceUntil } : {}),
        },
      });
    }
    res.json(result);
  }));

  /** Close a remote session (detach stream + close Chrome + free slot). */
  app.post('/api/v2/remote-sessions/:id/close', asyncHandler(async (req, res) => {
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
  }));

  /** Delete a remote session row by id. */
  app.delete('/api/v2/remote-sessions/:id', asyncHandler(async (req, res) => {
    await remoteSessionDao.remove(+req.params.id);
    res.json({ status: 'deleted' });
  }));
}
