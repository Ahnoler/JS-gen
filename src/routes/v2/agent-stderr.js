import * as svc from '../../services/agent-stderr-log-service.js';
import { sendErr } from './trajectory-shared.js';

/**
 * Agent stderr log query/export API — list active log targets, filter lines by
 * slot/session/trajectory, and clear a session's log file.
 *
 * Prefix: /api/v2/recording/agent-stderr/*
 */

function parseFilter(query) {
  return {
    slot: query.slot != null && query.slot !== '' ? Number(query.slot) : undefined,
    sid: query.sid ? String(query.sid).toLowerCase() : undefined,
    sessionId: query.sessionId || undefined,
    trajectoryId: query.trajectoryId != null && query.trajectoryId !== ''
      ? Number(query.trajectoryId) : undefined,
  };
}

/**
 * Accept /active row paste: slotIndex → slot; ignore extra fields.
 * @param {object} [body] request body (paste of an /active row)
 * @returns {{ slot?: number, sid?: string, sessionId?: string, trajectoryId?: number }} parsed filter
 */
function parseFilterFromBody(body = {}) {
  const slotRaw = body.slotIndex != null ? body.slotIndex : body.slot;
  return {
    slot: slotRaw != null && slotRaw !== '' ? Number(slotRaw) : undefined,
    sid: body.sid ? String(body.sid).toLowerCase() : undefined,
    sessionId: body.sessionId ? String(body.sessionId) : undefined,
    trajectoryId: body.trajectoryId != null && body.trajectoryId !== ''
      ? Number(body.trajectoryId) : undefined,
  };
}

function hasAnyFilter(f) {
  return (f.slot != null && Number.isFinite(f.slot))
    || !!f.sid
    || !!f.sessionId
    || (f.trajectoryId != null && Number.isFinite(f.trajectoryId));
}

async function queryFilteredLines(filter) {
  let sessionId = filter.sessionId;
  if (!sessionId && filter.trajectoryId != null) {
    sessionId = await svc.resolveSessionIdFromFilter({ trajectoryId: filter.trajectoryId });
    if (!sessionId && !filter.sid && !(filter.slot != null && Number.isFinite(filter.slot))) {
      return [];
    }
  }
  return svc.filterLines({
    slot: filter.slot,
    sid: filter.sid,
    sessionId: sessionId || undefined,
  });
}

function sendLines(res, lines, filter, format) {
  const exportLines = svc.stripLinePrefixes(lines);
  if (String(format || 'text').toLowerCase() === 'json') {
    return res.json({ lines: exportLines, count: exportLines.length, filter });
  }
  return res.type('text/plain; charset=utf-8').send(`${exportLines.join('\n')}${exportLines.length ? '\n' : ''}`);
}

/**
 * Register agent-stderr log query/export routes.
 * @param {import('express').Application} app Express application
 */
export default function registerAgentStderr(app) {
  /** List active agent stderr log targets (sessions currently recording). */
  app.get('/api/v2/recording/agent-stderr/active', async (_req, res) => {
    try {
      res.json(await svc.listActiveStderrTargets());
    } catch (err) {
      sendErr(res, err);
    }
  });

  /** Get filtered agent stderr lines (requires slot/sid/sessionId/trajectoryId). */
  app.get('/api/v2/recording/agent-stderr', async (req, res) => {
    try {
      const filter = parseFilter(req.query);
      if (!hasAnyFilter(filter)) {
        return res.status(400).json({ error: 'slot, sid, sessionId, or trajectoryId required' });
      }
      const lines = await queryFilteredLines(filter);
      return sendLines(res, lines, filter, req.query.format);
    } catch (err) {
      sendErr(res, err);
    }
  });

  /** Paste one /active row as JSON body → export (preferred for /api/docs Try). */
  app.post('/api/v2/recording/agent-stderr', async (req, res) => {
    try {
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const filter = parseFilterFromBody(body);
      if (!hasAnyFilter(filter)) {
        return res.status(400).json({
          error: 'body needs slotIndex|slot, sid, sessionId, or trajectoryId (paste an /active row)',
        });
      }
      const lines = await queryFilteredLines(filter);
      return sendLines(res, lines, filter, body.format ?? req.query.format);
    } catch (err) {
      sendErr(res, err);
    }
  });

  /**
   * Clear one session's stderr file on the control plane.
   * Body: same as /active row (or { sessionId }). Scope = that sessionId's .log only.
   */
  app.post('/api/v2/recording/agent-stderr/clear', async (req, res) => {
    try {
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const filter = parseFilterFromBody(body);
      if (!hasAnyFilter(filter)) {
        return res.status(400).json({
          error: 'body needs sessionId (preferred) or trajectoryId/sid to resolve',
        });
      }
      const result = await svc.clearLogForFilter(filter);
      res.json(result);
    } catch (err) {
      sendErr(res, err);
    }
  });

  /** Get agent stderr lines for a specific trajectory (filtered by trajectoryId). */
  app.get('/api/v2/trajectories/:id/agent-stderr', async (req, res) => {
    try {
      const filter = {
        ...parseFilter(req.query),
        trajectoryId: Number(req.params.id),
      };
      const lines = await queryFilteredLines(filter);
      return sendLines(res, lines, filter, req.query.format);
    } catch (err) {
      sendErr(res, err);
    }
  });
}
