import { randomUUID } from 'crypto';
import * as remoteSessionDao from '../dao/remote-session-dao.js';
import { USE_EXECUTOR } from '../../config/config.js';
import { state } from '../state.js';
import { sendToExecutor, waitForSessionEvent } from '../executor-session-client.js';

let executorLive = {
  attached: false,
  remoteSession: null,
  sessionId: null,
  executorNodeUuid: null,
  viewportW: 1920,
  viewportH: 1080,
};

/** Browser session id currently bound by attachLive (executor mode). */
export function getExecutorLiveSessionId() {
  return executorLive.sessionId || null;
}

/** Reset live BiB state (executor disconnect / purge). */
export function clearExecutorLive() {
  executorLive = {
    attached: false,
    remoteSession: null,
    sessionId: null,
    executorNodeUuid: null,
    viewportW: 1920,
    viewportH: 1080,
  };
}

/** Clear live BiB only when it belonged to the given node. */
export function clearExecutorLiveForNode(nodeUuid) {
  if (!nodeUuid || executorLive.executorNodeUuid === nodeUuid) {
    clearExecutorLive();
  }
}

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

/**
 * Attach Node CDP bridge to the live Session Chrome and open a DB row.
 * Lazy-imports bridge to avoid circular dependency with CRUD helpers.
 */
export async function attachLive(opts = {}) {
  if (!USE_EXECUTOR) {
    const bridge = await import('../cdp/remote-bridge.js');
    return bridge.attachLive(opts);
  }

  const wantSessionId = opts.sessionId || opts.browserSessionId;
  const active = wantSessionId
    ? state.sessions.get(wantSessionId)
    : [...state.sessions.values()].find((s) => s?.useExecutor);

  if (!active?.executorNodeUuid || !active?.sessionId) {
    throw new Error('No executor-backed browser session found for attachLive');
  }

  // Create a remote_session row for RSCF header association.
  const remoteSession = await openSession({
    isolation: 'target',
    viewportW: Number(opts.viewportW) || 1920,
    viewportH: Number(opts.viewportH) || 1080,
    deviceScaleFactor: opts.deviceScaleFactor ?? 1.0,
    url: '',
  });

  const sessionId = active.sessionId;
  const nodeUuid = active.executorNodeUuid;
  executorLive = {
    attached: true,
    remoteSession,
    sessionId,
    executorNodeUuid: nodeUuid,
    viewportW: remoteSession.viewportW || 1920,
    viewportH: remoteSession.viewportH || 1080,
  };

  const readyP = waitForSessionEvent(sessionId, 'session.bib_ready', 45000);
  const errP = waitForSessionEvent(sessionId, 'session.bib_error', 45000).then((p) => {
    const msg = p?.error || p?.message || 'BiB attach failed';
    const err = new Error(msg);
    err.statusCode = 503;
    throw err;
  });
  sendToExecutor(nodeUuid, 'session.attach_bib', {
    sessionId,
    remoteSessionUuid: remoteSession.sessionUuid,
    quality: opts.quality ?? 70,
    resize: opts.resize === true,
    viewportW: executorLive.viewportW,
    viewportH: executorLive.viewportH,
    deviceScaleFactor: opts.deviceScaleFactor ?? 1.0,
  });

  // Wait for executor to confirm bib-ready (so UI can trust viewport).
  let ready;
  try {
    ready = await Promise.race([readyP, errP]);
  } catch (err) {
    executorLive = {
      attached: false,
      remoteSession: null,
      sessionId: null,
      executorNodeUuid: null,
      viewportW: 1920,
      viewportH: 1080,
    };
    try { await closeSession(remoteSession.id, { crashed: true }); } catch {}
    throw err;
  }
  if (!ready) {
    executorLive = {
      attached: false,
      remoteSession: null,
      sessionId: null,
      executorNodeUuid: null,
      viewportW: 1920,
      viewportH: 1080,
    };
    try { await closeSession(remoteSession.id, { crashed: true }); } catch {}
    throw new Error(
      `Executor BiB attach timed out (no session.bib_ready). Check executor CDP port / Chrome for session ${sessionId}`,
    );
  }
  if (ready?.viewportW) executorLive.viewportW = Number(ready.viewportW);
  if (ready?.viewportH) executorLive.viewportH = Number(ready.viewportH);

  return {
    remoteSession,
    status: {
      attached: true,
      remoteSessionId: remoteSession.id,
      remoteSessionUuid: remoteSession.sessionUuid,
      cdpReady: true,
      inputEnabled: !active.busy,
      agentBusy: !!active.busy,
      viewportW: executorLive.viewportW,
      viewportH: executorLive.viewportH,
      manualRecording: false,
    },
  };
}

/** Stop screencast / BiB only — browser + executor slot stay alive (idle).
 * Frontend「断开画面」→ this. Frontend「释放执行资源」→ trajectory detach (kills browser).
 */
export async function detachLive(opts = {}) {
  if (!USE_EXECUTOR) {
    const bridge = await import('../cdp/remote-bridge.js');
    return bridge.detachLive(opts);
  }

  const sessionId = executorLive.sessionId;
  const remoteSession = executorLive.remoteSession;
  if (!executorLive.attached || !sessionId || !remoteSession?.id) {
    return { closedId: null, status: await getLiveStatus() };
  }

  try {
    sendToExecutor(executorLive.executorNodeUuid, 'session.detach_bib', {
      sessionId,
      crashed: !!opts.crashed,
    });
    await waitForSessionEvent(sessionId, 'session.bib_detached', 15000).catch(() => {});
  } finally {
    try { await closeSession(remoteSession.id, { crashed: !!opts.crashed }); } catch {}
    const closedId = remoteSession.id;
    executorLive = {
      attached: false,
      remoteSession: null,
      sessionId: null,
      executorNodeUuid: null,
      viewportW: 1920,
      viewportH: 1080,
    };
    // Clear stream binding on trajectory runtime — browser/session remain for prepare reuse.
    try {
      const { getAllTrajectoryRuntimes } = await import('./trajectory-runtime.js');
      const { updateMeta } = await import('../dao/trajectory-dao.js');
      for (const [tid, runtime] of getAllTrajectoryRuntimes().entries()) {
        if (runtime?.sessionId !== sessionId) continue;
        runtime.remoteSessionId = null;
        runtime.bibError = null;
        await updateMeta(tid, { remoteSessionId: null }).catch(() => {});
      }
    } catch (err) {
      console.warn('[remote] clear traj remoteSessionId after stream detach:', err.message);
    }
    return { closedId, status: await getLiveStatus(), streamDetached: true, sessionKept: true };
  }
}

export async function getLiveStatus() {
  if (!USE_EXECUTOR) {
    const bridge = await import('../cdp/remote-bridge.js');
    return bridge.getRemoteStatus();
  }

  const sessionObj = executorLive.sessionId ? state.sessions.get(executorLive.sessionId) : null;
  const agentBusy = !!sessionObj?.busy;
  return {
    attached: !!executorLive.attached,
    remoteSessionId: executorLive.remoteSession?.id ?? null,
    remoteSessionUuid: executorLive.remoteSession?.sessionUuid ?? null,
    sessionId: executorLive.sessionId || null,
    cdpReady: true,
    inputEnabled: !!executorLive.attached && !agentBusy,
    agentBusy,
    viewportW: executorLive.viewportW,
    viewportH: executorLive.viewportH,
    manualRecording: false,
  };
}
