import { randomUUID } from 'crypto';
import * as remoteSessionDao from '../dao/remote-session-dao.js';

/**
 * Open a new remote browser session record.
 * @param {Object} [opts]
 * @param {string} [opts.browserContextId]
 * @param {string} [opts.targetId]
 * @param {'context'|'target'} [opts.isolation]
 * @param {number} [opts.viewportW]
 * @param {number} [opts.viewportH]
 * @param {number} [opts.deviceScaleFactor]
 * @param {string} [opts.url]
 */
export async function openSession(opts = {}) {
  return remoteSessionDao.create({
    sessionUuid: randomUUID(),
    browserContextId: opts.browserContextId || '',
    targetId: opts.targetId || '',
    isolation: opts.isolation || 'context',
    viewportW: opts.viewportW || 0,
    viewportH: opts.viewportH || 0,
    deviceScaleFactor: opts.deviceScaleFactor ?? 1.0,
    url: opts.url || '',
    status: 'active',
  });
}

export async function updateViewport(id, { viewportW, viewportH, deviceScaleFactor }) {
  return remoteSessionDao.update(id, {
    viewportW,
    viewportH,
    deviceScaleFactor,
  });
}

export async function attachTarget(id, { browserContextId, targetId }) {
  return remoteSessionDao.update(id, {
    browserContextId: browserContextId || '',
    targetId: targetId || '',
  });
}

export async function closeSession(id, { crashed = false } = {}) {
  const session = await remoteSessionDao.getById(id);
  if (!session) return null;
  if (session.status !== 'active') return session;
  return remoteSessionDao.close(id, { crashed });
}

export async function closeByUuid(sessionUuid, opts) {
  const session = await remoteSessionDao.getByUuid(sessionUuid);
  if (!session) return null;
  return closeSession(session.id, opts);
}

export async function getSession(id) {
  return remoteSessionDao.getById(id);
}

export async function getByUuid(sessionUuid) {
  return remoteSessionDao.getByUuid(sessionUuid);
}

export async function listSessions(opts) {
  return remoteSessionDao.list(opts);
}
