/**
 * Remote browser / BiB lifecycle — keyed by remote_session.id (1:1 with trajectory while mounted).
 * Agent sessions stay in-memory; bindings persist on remote_session.agent_session_id.
 */
import { randomUUID } from 'crypto';
import * as remoteSessionDao from '../dao/remote-session-dao.js';
import * as executorNodeDao from '../dao/executor-node-dao.js';
import { USE_EXECUTOR } from '../../config/config.js';
import { state } from '../state.js';
import { sendToExecutor, waitForSessionEvent } from '../executor-session-client.js';

/**
 * @typedef {{
 *   remoteSessionId: number,
 *   remoteSessionUuid: string,
 *   trajectoryId: number|null,
 *   agentSessionId: string,
 *   nodeUuid: string|null,
 *   executorNodeId: number|null,
 *   viewportW: number,
 *   viewportH: number,
 *   attached: boolean,
 * }} LiveBinding
 */

/** @type {Map<number, LiveBinding>} key = remoteSessionId */
const liveByRemoteSessionId = new Map();

/** @type {Map<number, Promise<unknown>>} serialize prepare/detach/release per trajectory */
const trajLocks = new Map();

export function withTrajectoryLock(trajectoryId, fn) {
  const tid = Number(trajectoryId);
  const key = Number.isFinite(tid) && tid > 0 ? tid : 0;
  const prev = trajLocks.get(key) || Promise.resolve();
  let release;
  const gate = new Promise((r) => { release = r; });
  const run = prev.then(() => fn()).finally(() => release());
  trajLocks.set(key, gate.then(() => undefined, () => undefined));
  return run;
}

function bindingToStatus(binding) {
  if (!binding?.attached) {
    return {
      attached: false,
      remoteSessionId: binding?.remoteSessionId ?? null,
      remoteSessionUuid: binding?.remoteSessionUuid ?? null,
      sessionId: binding?.agentSessionId ?? null,
      trajectoryId: binding?.trajectoryId ?? null,
      cdpReady: true,
      inputEnabled: false,
      agentBusy: false,
      viewportW: binding?.viewportW ?? 1920,
      viewportH: binding?.viewportH ?? 1080,
      manualRecording: false,
    };
  }
  const sessionObj = binding.agentSessionId ? state.sessions.get(binding.agentSessionId) : null;
  const agentBusy = !!sessionObj?.busy;
  return {
    attached: true,
    remoteSessionId: binding.remoteSessionId,
    remoteSessionUuid: binding.remoteSessionUuid,
    sessionId: binding.agentSessionId,
    trajectoryId: binding.trajectoryId,
    cdpReady: true,
    inputEnabled: !agentBusy,
    agentBusy,
    viewportW: binding.viewportW,
    viewportH: binding.viewportH,
    manualRecording: false,
  };
}

export function getLiveBindingByRemoteSessionId(remoteSessionId) {
  const id = Number(remoteSessionId);
  if (!Number.isFinite(id)) return null;
  return liveByRemoteSessionId.get(id) || null;
}

export function getLiveBindingByTrajectory(
  trajectoryId,
  { preferRemoteSessionId = null, preferAgentSessionId = null } = {},
) {
  const tid = Number(trajectoryId);
  if (!Number.isFinite(tid)) return null;

  // Prefer actually-attached binding that matches the live agent session.
  if (preferAgentSessionId) {
    const want = String(preferAgentSessionId);
    for (const b of liveByRemoteSessionId.values()) {
      if (Number(b.trajectoryId) !== tid || !b.attached) continue;
      if (b.agentSessionId && String(b.agentSessionId) === want) return b;
    }
  }

  const preferId = preferRemoteSessionId != null ? Number(preferRemoteSessionId) : null;
  if (Number.isFinite(preferId)) {
    const preferred = liveByRemoteSessionId.get(preferId);
    if (preferred && Number(preferred.trajectoryId) === tid) return preferred;
  }

  const attached = [...liveByRemoteSessionId.values()].filter(
    (b) => Number(b.trajectoryId) === tid && b.attached,
  );
  if (attached.length === 1) return attached[0];
  if (attached.length > 1) {
    // Multiple stale bindings — prefer newest remote_session row id.
    return attached.reduce((a, b) => (a.remoteSessionId > b.remoteSessionId ? a : b));
  }

  for (const b of liveByRemoteSessionId.values()) {
    if (Number(b.trajectoryId) === tid) return b;
  }
  return null;
}

export function getLiveBindingByAgentSession(agentSessionId) {
  if (!agentSessionId) return null;
  for (const b of liveByRemoteSessionId.values()) {
    if (b.agentSessionId === agentSessionId && b.attached) return b;
  }
  for (const b of liveByRemoteSessionId.values()) {
    if (b.agentSessionId === agentSessionId) return b;
  }
  return null;
}

export function getLiveBindingByUuid(remoteSessionUuid) {
  if (!remoteSessionUuid) return null;
  const want = String(remoteSessionUuid);
  for (const b of liveByRemoteSessionId.values()) {
    if (b.remoteSessionUuid && String(b.remoteSessionUuid) === want) return b;
  }
  return null;
}

/**
 * Shared BiB target resolution (trajectory ↔ remote_session ↔ agent session).
 * Priority: trajectoryId → remoteSessionId/uuid → sessionId →
 * (only when no identity keys given) single attached binding.
 * @param {{ trajectoryId?: number|null, sessionId?: string|null, remoteSessionId?: number|null, remoteSessionUuid?: string|null }} opts
 * @returns {LiveBinding|null}
 */
export function resolveLiveBinding(opts = {}) {
  const tid = opts.trajectoryId != null ? Number(opts.trajectoryId) : null;
  const hasTid = Number.isFinite(tid);
  const hasRemoteId = opts.remoteSessionId != null && Number.isFinite(Number(opts.remoteSessionId));
  const hasRemoteUuid = !!opts.remoteSessionUuid;
  const hasSessionId = !!opts.sessionId;
  const hasIdentity = hasTid || hasRemoteId || hasRemoteUuid || hasSessionId;

  if (hasTid) {
    const b = getLiveBindingByTrajectory(tid, {
      preferRemoteSessionId: hasRemoteId ? Number(opts.remoteSessionId) : null,
      preferAgentSessionId: hasSessionId ? opts.sessionId : null,
    });
    if (b) return b;
  }

  if (hasRemoteId) {
    const b = getLiveBindingByRemoteSessionId(opts.remoteSessionId);
    if (b) return b;
  }

  if (hasRemoteUuid) {
    const b = getLiveBindingByUuid(opts.remoteSessionUuid);
    if (b) return b;
  }

  if (hasSessionId) {
    const b = getLiveBindingByAgentSession(opts.sessionId);
    if (b) return b;
  }

  // Safe legacy fallback: only when caller sent no identity at all.
  if (!hasIdentity) {
    const attached = [...liveByRemoteSessionId.values()].filter((b) => b.attached);
    if (attached.length === 1) return attached[0];
  }

  return null;
}

export function clearExecutorLive() {
  liveByRemoteSessionId.clear();
}

export function clearExecutorLiveForNode(nodeUuid) {
  if (!nodeUuid) {
    clearExecutorLive();
    return;
  }
  for (const [id, b] of [...liveByRemoteSessionId.entries()]) {
    if (b.nodeUuid === nodeUuid) liveByRemoteSessionId.delete(id);
  }
}

export function clearLiveBinding(remoteSessionId) {
  const id = Number(remoteSessionId);
  if (Number.isFinite(id)) liveByRemoteSessionId.delete(id);
}

/**
 * Open a new remote browser session record.
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
    status: opts.status || 'active',
    executorNodeId: opts.executorNodeId ?? null,
    slotIndex: opts.slotIndex ?? null,
    clientKey: opts.clientKey ?? null,
    agentSessionId: opts.agentSessionId ?? null,
    trajectoryId: opts.trajectoryId ?? null,
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

/**
 * Clear trajectory.remote_session_id (+ runtime) for rows pointing at this remote_session.
 * @param {number} remoteSessionId
 * @param {{ exceptTrajectoryId?: number|null, demoteLive?: boolean }} [opts]
 * @returns {Promise<number[]>}
 */
export async function unmountTrajectoriesFromRemoteSession(remoteSessionId, {
  exceptTrajectoryId = null,
  demoteLive = true,
} = {}) {
  const trajectoryDao = await import('../dao/trajectory-dao.js');
  const cleared = await trajectoryDao.clearMountByRemoteSessionId(remoteSessionId, {
    exceptTrajectoryId,
    demoteLive,
  });
  if (!cleared.length) return cleared;
  try {
    const { getTrajectoryRuntime } = await import('./trajectory-runtime.js');
    const rid = Number(remoteSessionId);
    for (const tid of cleared) {
      const runtime = getTrajectoryRuntime(tid);
      if (runtime && Number(runtime.remoteSessionId) === rid) {
        runtime.remoteSessionId = null;
        runtime.bibError = null;
      }
    }
  } catch {}
  return cleared;
}

/** Mount remote_session exclusively onto one trajectory (clears other traj FKs first). */
export async function mountTrajectoryRemoteSession(trajectoryId, remoteSessionId) {
  const tid = Number(trajectoryId);
  const rid = Number(remoteSessionId);
  if (!Number.isFinite(tid) || tid <= 0 || !Number.isFinite(rid) || rid <= 0) return [];
  const cleared = await unmountTrajectoriesFromRemoteSession(rid, {
    exceptTrajectoryId: tid,
    demoteLive: true,
  });
  const trajectoryDao = await import('../dao/trajectory-dao.js');
  await trajectoryDao.updateMeta(tid, { remoteSessionId: rid });
  return cleared;
}

/** One-shot repair for ghost occupancy (stale trajectory.remote_session_id). */
export async function reconcileStaleTrajectoryRemoteMounts() {
  const trajectoryDao = await import('../dao/trajectory-dao.js');
  const cleared = await trajectoryDao.repairStaleRemoteMounts();
  if (!cleared.length) return cleared;
  try {
    const { getTrajectoryRuntime } = await import('./trajectory-runtime.js');
    for (const tid of cleared) {
      const runtime = getTrajectoryRuntime(tid);
      if (runtime) {
        runtime.remoteSessionId = null;
        runtime.bibError = null;
      }
    }
  } catch {}
  return cleared;
}

export async function closeSession(id, { crashed = false } = {}) {
  const session = await remoteSessionDao.getById(id);
  clearLiveBinding(id);
  // Always sweep traj FKs — even if row already closed (repairs ghost mounts).
  await unmountTrajectoriesFromRemoteSession(id, { demoteLive: true }).catch(() => {});
  if (!session) return null;
  if (session.status === 'closed' || session.status === 'crashed') return session;
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

async function resolveExecutorNodeId(nodeUuid) {
  if (!nodeUuid) return null;
  const node = await executorNodeDao.getByUuid(nodeUuid).catch(() => null);
  return node?.id ?? null;
}

/**
 * Close duplicate occupied remote_session rows for one trajectory so BiB UUID
 * stays aligned with the live agent session (avoids black-screen subscribe).
 * Keeps rows matching keepRemoteSessionId and/or keepAgentSessionId.
 */
export async function supersedeStaleForTrajectory(
  trajectoryId,
  { keepRemoteSessionId = null, keepAgentSessionId = null } = {},
) {
  const tid = Number(trajectoryId);
  if (!Number.isFinite(tid) || tid <= 0) return [];
  const keepId = keepRemoteSessionId != null ? Number(keepRemoteSessionId) : null;
  const keepAgent = keepAgentSessionId ? String(keepAgentSessionId) : null;
  const rows = await remoteSessionDao.listOccupiedByTrajectory(tid);
  const closed = [];
  for (const row of rows) {
    if (Number.isFinite(keepId) && row.id === keepId) continue;
    if (keepAgent && row.agentSessionId && String(row.agentSessionId) === keepAgent) continue;
    try {
      await detachLive({ trajectoryId: tid, remoteSessionId: row.id, crashed: false });
    } catch (err) {
      console.warn('[remote] supersede detach failed:', row.id, err.message);
    }
    try {
      const fresh = await remoteSessionDao.getById(row.id);
      if (fresh && (fresh.status === 'active' || fresh.status === 'idle')) {
        await remoteSessionDao.close(row.id, { crashed: false });
      }
    } catch {}
    clearLiveBinding(row.id);
    closed.push(row.id);
  }
  return closed;
}

/**
 * Attach BiB for a specific trajectory + agent session.
 * Creates or reactivates remote_session; mounts trajectory.remote_session_id.
 */
export async function attachLive(opts = {}) {
  if (!USE_EXECUTOR) {
    const bridge = await import('../cdp/remote-bridge.js');
    return bridge.attachLive(opts);
  }

  const wantSessionId = opts.sessionId || opts.browserSessionId;
  const trajectoryId = opts.trajectoryId != null ? Number(opts.trajectoryId) : null;

  const active = wantSessionId
    ? state.sessions.get(wantSessionId)
    : null;

  if (!active?.executorNodeUuid || !active?.sessionId) {
    const err = new Error(
      wantSessionId
        ? 'No executor-backed browser session found for attachLive'
        : 'sessionId is required for attachLive (no global fallback)',
    );
    err.statusCode = 400;
    throw err;
  }

  const sessionId = active.sessionId;

  // Drop other traj-bound occupied rows; keep this agent session's row for reuse.
  if (Number.isFinite(trajectoryId)) {
    await supersedeStaleForTrajectory(trajectoryId, { keepAgentSessionId: sessionId });
  }
  const nodeUuid = active.executorNodeUuid;
  const executorNodeId = await resolveExecutorNodeId(nodeUuid);
  const viewportW = Number(opts.viewportW) || 1920;
  const viewportH = Number(opts.viewportH) || 1080;

  // Reuse idle remote row for same agent session when possible
  let remoteSession = await remoteSessionDao.getOccupiedByAgentSession(sessionId);
  if (remoteSession && remoteSession.status === 'idle') {
    remoteSession = await remoteSessionDao.markActive(remoteSession.id, {
      trajectoryId: trajectoryId || remoteSession.trajectoryId,
    });
    remoteSession = await remoteSessionDao.update(remoteSession.id, {
      executorNodeId,
      slotIndex: active.executorSlotIndex ?? remoteSession.slotIndex ?? null,
      agentSessionId: sessionId,
      viewportW,
      viewportH,
      deviceScaleFactor: opts.deviceScaleFactor ?? 1.0,
    });
  } else if (!remoteSession || remoteSession.status !== 'active') {
    remoteSession = await openSession({
      isolation: 'target',
      viewportW,
      viewportH,
      deviceScaleFactor: opts.deviceScaleFactor ?? 1.0,
      url: '',
      status: 'active',
      executorNodeId,
      slotIndex: active.executorSlotIndex ?? null,
      agentSessionId: sessionId,
      trajectoryId: trajectoryId || null,
    });
  } else {
    // Already active — refresh bindings
    remoteSession = await remoteSessionDao.update(remoteSession.id, {
      executorNodeId,
      slotIndex: active.executorSlotIndex ?? remoteSession.slotIndex ?? null,
      agentSessionId: sessionId,
      trajectoryId: trajectoryId ?? remoteSession.trajectoryId ?? null,
      viewportW,
      viewportH,
    });
  }

  // Detach prior BiB for this agent session if bound to a different remote row
  for (const [rid, b] of [...liveByRemoteSessionId.entries()]) {
    if (b.agentSessionId === sessionId && rid !== remoteSession.id && b.attached) {
      try {
        sendToExecutor(b.nodeUuid, 'session.detach_bib', { sessionId, crashed: false });
        await waitForSessionEvent(sessionId, 'session.bib_detached', 8000).catch(() => {});
      } catch {}
      liveByRemoteSessionId.delete(rid);
    }
  }

  const binding = {
    remoteSessionId: remoteSession.id,
    remoteSessionUuid: remoteSession.sessionUuid,
    trajectoryId: trajectoryId ?? remoteSession.trajectoryId ?? null,
    agentSessionId: sessionId,
    nodeUuid,
    executorNodeId,
    viewportW: remoteSession.viewportW || viewportW,
    viewportH: remoteSession.viewportH || viewportH,
    attached: false,
  };
  liveByRemoteSessionId.set(remoteSession.id, binding);

  if (trajectoryId) {
    try {
      await mountTrajectoryRemoteSession(trajectoryId, remoteSession.id);
    } catch (err) {
      console.warn('[remote] mount trajectory.remote_session_id failed:', err.message);
    }
  }

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
    viewportW: binding.viewportW,
    viewportH: binding.viewportH,
    deviceScaleFactor: opts.deviceScaleFactor ?? 1.0,
  });

  let ready;
  try {
    ready = await Promise.race([readyP, errP]);
  } catch (err) {
    liveByRemoteSessionId.delete(remoteSession.id);
    try { await remoteSessionDao.close(remoteSession.id, { crashed: true }); } catch {}
    throw err;
  }
  if (!ready) {
    liveByRemoteSessionId.delete(remoteSession.id);
    try { await remoteSessionDao.close(remoteSession.id, { crashed: true }); } catch {}
    throw new Error(
      `Executor BiB attach timed out (no session.bib_ready). Check executor CDP port / Chrome for session ${sessionId}`,
    );
  }
  if (ready?.viewportW) binding.viewportW = Number(ready.viewportW);
  if (ready?.viewportH) binding.viewportH = Number(ready.viewportH);
  binding.attached = true;
  liveByRemoteSessionId.set(remoteSession.id, binding);

  return {
    remoteSession,
    status: bindingToStatus(binding),
  };
}

/**
 * Disconnect stream only: stop BiB, mark remote idle, clear trajectory mount.
 * Does NOT kill Chrome / Python / slot.
 * @param {{ remoteSessionId?: number, trajectoryId?: number, crashed?: boolean }} opts
 */
export async function detachLive(opts = {}) {
  if (!USE_EXECUTOR) {
    const bridge = await import('../cdp/remote-bridge.js');
    return bridge.detachLive(opts);
  }

  let remoteSessionId = opts.remoteSessionId != null ? Number(opts.remoteSessionId) : null;
  const trajectoryId = opts.trajectoryId != null ? Number(opts.trajectoryId) : null;

  if (!remoteSessionId && trajectoryId) {
    const traj = await (await import('../dao/trajectory-dao.js')).getById(trajectoryId);
    remoteSessionId = traj?.remoteSessionId != null ? Number(traj.remoteSessionId) : null;
    if (!remoteSessionId) {
      const binding = getLiveBindingByTrajectory(trajectoryId);
      remoteSessionId = binding?.remoteSessionId ?? null;
    }
  }

  if (!remoteSessionId) {
    // Legacy: no ownership → no-op (do not tear down unrelated streams)
    return {
      closedId: null,
      status: await getLiveStatus({ trajectoryId: trajectoryId || undefined }),
      streamDetached: false,
      sessionKept: true,
    };
  }

  const remote = await remoteSessionDao.getById(remoteSessionId);
  if (!remote) {
    clearLiveBinding(remoteSessionId);
    return {
      closedId: null,
      status: await getLiveStatus({ trajectoryId: trajectoryId || undefined }),
      streamDetached: false,
      sessionKept: true,
    };
  }

  if (trajectoryId && remote.trajectoryId != null && Number(remote.trajectoryId) !== trajectoryId) {
    const err = new Error('remote_session does not belong to this trajectory');
    err.statusCode = 409;
    throw err;
  }

  const binding = liveByRemoteSessionId.get(remoteSessionId);
  const agentSessionId = binding?.agentSessionId || remote.agentSessionId || null;
  const nodeUuid = binding?.nodeUuid || null;

  if (agentSessionId && nodeUuid) {
    try {
      sendToExecutor(nodeUuid, 'session.detach_bib', {
        sessionId: agentSessionId,
        crashed: !!opts.crashed,
      });
      await waitForSessionEvent(agentSessionId, 'session.bib_detached', 15000).catch(() => {});
    } catch (err) {
      console.warn('[remote] detach_bib failed:', err.message);
    }
  }

  clearLiveBinding(remoteSessionId);

  if (opts.crashed) {
    await remoteSessionDao.close(remoteSessionId, { crashed: true });
  } else if (remote.status === 'active' || remote.status === 'idle') {
    await remoteSessionDao.markIdle(remoteSessionId);
  }

  // Clear ALL traj FKs pointing at this remote_session (not only the caller tid).
  const cleared = await unmountTrajectoriesFromRemoteSession(remoteSessionId, {
    demoteLive: true,
  }).catch((err) => {
    console.warn('[remote] clear traj mounts after stream detach:', err.message);
    return [];
  });

  const tid = trajectoryId
    || (remote.trajectoryId != null ? Number(remote.trajectoryId) : null)
    || (cleared[0] != null ? Number(cleared[0]) : null);

  return {
    closedId: remoteSessionId,
    status: await getLiveStatus({ trajectoryId: tid || undefined }),
    streamDetached: true,
    sessionKept: true,
    remoteSessionId,
    trajectoryId: tid,
  };
}

/**
 * @param {{ trajectoryId?: number, remoteSessionId?: number, remoteSessionUuid?: string, sessionId?: string, preferAgentSessionId?: string }} [opts]
 */
export async function getLiveStatus(opts = {}) {
  if (!USE_EXECUTOR) {
    const bridge = await import('../cdp/remote-bridge.js');
    return bridge.getRemoteStatus();
  }

  const tid = opts.trajectoryId != null ? Number(opts.trajectoryId) : null;
  let preferRemoteSessionId = opts.remoteSessionId != null ? Number(opts.remoteSessionId) : null;
  let preferAgentSessionId = opts.preferAgentSessionId || opts.sessionId || null;

  if (Number.isFinite(tid)) {
    try {
      const { getTrajectoryRuntime } = await import('./trajectory-runtime.js');
      const runtime = getTrajectoryRuntime(tid);
      if (!preferAgentSessionId && runtime?.sessionId) {
        preferAgentSessionId = runtime.sessionId;
      }
      if (!Number.isFinite(preferRemoteSessionId) && runtime?.remoteSessionId != null) {
        preferRemoteSessionId = Number(runtime.remoteSessionId);
      }
    } catch {}
    if (!Number.isFinite(preferRemoteSessionId)) {
      try {
        const trajectoryDao = await import('../dao/trajectory-dao.js');
        const traj = await trajectoryDao.getById(tid);
        if (traj?.remoteSessionId != null) preferRemoteSessionId = Number(traj.remoteSessionId);
      } catch {}
    }
  }

  let binding = null;
  if (Number.isFinite(tid)) {
    binding = getLiveBindingByTrajectory(tid, {
      preferRemoteSessionId: Number.isFinite(preferRemoteSessionId) ? preferRemoteSessionId : null,
      preferAgentSessionId: preferAgentSessionId || null,
    });
  }
  if (!binding) {
    binding = resolveLiveBinding({
      ...opts,
      trajectoryId: Number.isFinite(tid) ? tid : opts.trajectoryId,
      remoteSessionId: Number.isFinite(preferRemoteSessionId) ? preferRemoteSessionId : opts.remoteSessionId,
      sessionId: preferAgentSessionId || opts.sessionId,
    });
  }
  if (binding) {
    // Keep trajectory.remote_session_id aligned with the BiB UUID clients filter on.
    if (
      Number.isFinite(tid)
      && binding.attached
      && binding.remoteSessionId
      && preferAgentSessionId
      && binding.agentSessionId
      && String(binding.agentSessionId) === String(preferAgentSessionId)
    ) {
      try {
        const trajectoryDao = await import('../dao/trajectory-dao.js');
        const traj = await trajectoryDao.getById(tid);
        if (traj && Number(traj.remoteSessionId) !== Number(binding.remoteSessionId)) {
          await mountTrajectoryRemoteSession(tid, binding.remoteSessionId);
        }
      } catch (err) {
        console.warn('[remote] rewrite traj.remote_session_id failed:', err.message);
      }
    }
    return bindingToStatus(binding);
  }
  return {
    attached: false,
    remoteSessionId: null,
    remoteSessionUuid: null,
    sessionId: null,
    trajectoryId: Number.isFinite(tid) ? tid : null,
    cdpReady: true,
    inputEnabled: false,
    agentBusy: false,
    viewportW: 1920,
    viewportH: 1080,
    manualRecording: false,
  };
}

/** Rebuild in-memory live map entry from DB row (boot reconcile). */
export function restoreLiveBindingFromRow(row, { nodeUuid = null, attached = false } = {}) {
  if (!row?.id) return null;
  const binding = {
    remoteSessionId: row.id,
    remoteSessionUuid: row.sessionUuid,
    trajectoryId: row.trajectoryId != null ? Number(row.trajectoryId) : null,
    agentSessionId: row.agentSessionId || '',
    nodeUuid,
    executorNodeId: row.executorNodeId ?? null,
    viewportW: row.viewportW || 1920,
    viewportH: row.viewportH || 1080,
    attached: !!attached && row.status === 'active',
  };
  if (binding.attached) liveByRemoteSessionId.set(row.id, binding);
  return binding;
}

export function listLiveBindings() {
  return [...liveByRemoteSessionId.values()];
}
