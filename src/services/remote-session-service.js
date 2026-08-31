/**
 * Remote browser / BiB lifecycle — keyed by remote_session.id (1:1 with trajectory while mounted).
 * Agent sessions stay in-memory; bindings persist on remote_session.agent_session_id.
 */
import { randomUUID } from 'crypto';
import { AsyncLocalStorage } from 'async_hooks';
import * as remoteSessionDao from '../dao/remote-session-dao.js';
import * as executorNodeDao from '../dao/executor-node-dao.js';
import { USE_EXECUTOR } from '../../config/config.js';
import { state } from '../state.js';
import { sendToExecutor, waitForSessionEvent, closeSession as closeExecutorSession } from '../executor-session-client.js';
import {
  bindingToStatus,
  liveByRemoteSessionId,
  getLiveBindingByTrajectory,
  resolveLiveBinding,
  clearLiveBinding,
  withTrajectoryLock as withTrajectoryLockRaw,
} from './remote-session-state.js';

/**
 * Async context tracking which trajectory locks are already held by the current
 * async execution path (makes withTrajectoryLock reentrant for nested calls like
 * prepare → attachLive that run under the same trajectory's lock).
 * @type {AsyncLocalStorage<Set<number>>}
 */
const trajLockStack = new AsyncLocalStorage();

/**
 * Serialize per-trajectory critical sections (reentrant within the same async chain).
 * @param {number} trajectoryId trajectory DB id
 * @param {() => Promise<unknown>} fn async work to run under the lock
 * @returns {Promise<unknown>} result of fn
 */
export async function withTrajectoryLock(trajectoryId, fn) {
  const held = trajLockStack.getStore();
  const tid = Number(trajectoryId);
  const key = Number.isFinite(tid) && tid > 0 ? tid : 0;
  if (held && held.has(key)) return fn();
  const next = new Set(held || []);
  next.add(key);
  return trajLockStack.run(next, () => withTrajectoryLockRaw(key, fn));
}

export {
  getLiveBindingByRemoteSessionId,
  getLiveBindingByTrajectory,
  getLiveBindingByAgentSession,
  getLiveBindingByUuid,
  resolveLiveBinding,
  clearExecutorLive,
  clearExecutorLiveForNode,
  clearLiveBinding,
  restoreLiveBindingFromRow,
  listLiveBindings,
} from './remote-session-state.js';

/**
 * Open a new remote browser session record.
 * @param {object} [opts] session fields (browserContextId, targetId, viewport, etc.)
 * @returns {Promise<object>} created remote_session row
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

/**
 * Persist viewport dimensions for a remote session.
 * @param {number} id remote_session DB id
 * @param {object} root0 viewport fields
 * @param {number} root0.viewportW viewport width
 * @param {number} root0.viewportH viewport height
 * @param {number} root0.deviceScaleFactor device scale factor
 * @returns {Promise<object>} updated remote_session row
 */
export async function updateViewport(id, { viewportW, viewportH, deviceScaleFactor }) {
  return remoteSessionDao.update(id, {
    viewportW,
    viewportH,
    deviceScaleFactor,
  });
}

/**
 * Attach browser context + target ids to an existing remote session.
 * @param {number} id remote_session DB id
 * @param {object} root0 target fields
 * @param {string} root0.browserContextId browser context id
 * @param {string} root0.targetId CDP target id
 * @returns {Promise<object>} updated remote_session row
 */
export async function attachTarget(id, { browserContextId, targetId }) {
  return remoteSessionDao.update(id, {
    browserContextId: browserContextId || '',
    targetId: targetId || '',
  });
}

/**
 * Clear trajectory.remote_session_id (+ runtime) for rows pointing at this remote_session.
 * @param {number} remoteSessionId remote_session DB id to unmount from
 * @param {{ exceptTrajectoryId?: number|null, demoteLive?: boolean }} [opts] unmount options
 * @returns {Promise<number[]>} trajectory ids whose mount was cleared
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
    const { getTrajectoryRuntime } = await import('./trajectory/trajectory-runtime.js');
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

/**
 * Mount remote_session exclusively onto one trajectory (truth + cache via lifecycle).
 * @param {number} trajectoryId trajectory DB id
 * @param {number} remoteSessionId remote_session DB id
 * @returns {Promise<object>} updated trajectory row
 */
export async function mountTrajectoryRemoteSession(trajectoryId, remoteSessionId) {
  const { syncMount } = await import('./session-lifecycle.js');
  return syncMount(trajectoryId, remoteSessionId);
}

/**
 * One-shot repair for ghost occupancy (stale trajectory.remote_session_id).
 * @returns {Promise<number[]>} trajectory ids whose stale mounts were repaired
 */
export async function reconcileStaleTrajectoryRemoteMounts() {
  const trajectoryDao = await import('../dao/trajectory-dao.js');
  const cleared = await trajectoryDao.repairStaleRemoteMounts();
  if (!cleared.length) return cleared;
  try {
    const { getTrajectoryRuntime } = await import('./trajectory/trajectory-runtime.js');
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

/**
 * Close a remote session and sweep trajectory FKs (repairs ghost mounts).
 * @param {number} id remote_session DB id
 * @param {object} [root0] close options
 * @param {boolean} [root0.crashed] whether the session crashed
 * @returns {Promise<object|null>} updated session row, or null if not found
 */
export async function closeSession(id, { crashed = false } = {}) {
  const session = await remoteSessionDao.getById(id);
  const { clearOwnershipOnClose } = await import('./session-lifecycle.js');
  // Always sweep traj FKs — even if row already closed (repairs ghost mounts).
  await clearOwnershipOnClose(id).catch(() => {});
  if (!session) return null;
  if (session.status === 'closed' || session.status === 'crashed') return session;
  return remoteSessionDao.close(id, { crashed });
}

/**
 * Close a remote session by its session UUID.
 * @param {string} sessionUuid remote session UUID
 * @param {object} [opts] close options (crashed, …)
 * @returns {Promise<object|null>} updated session row, or null if not found
 */
export async function closeByUuid(sessionUuid, opts) {
  const session = await remoteSessionDao.getByUuid(sessionUuid);
  if (!session) return null;
  return closeSession(session.id, opts);
}

/**
 * Get a remote session by DB id.
 * @param {number} id remote_session DB id
 * @returns {Promise<object|null>} remote session row or null
 */
export async function getSession(id) {
  return remoteSessionDao.getById(id);
}

/**
 * Get a remote session by its session UUID.
 * @param {string} sessionUuid remote session UUID
 * @returns {Promise<object|null>} remote session row or null
 */
export async function getByUuid(sessionUuid) {
  return remoteSessionDao.getByUuid(sessionUuid);
}

/**
 * List remote sessions (filter/pagination via opts).
 * @param {object} [opts] list filter / pagination options
 * @returns {Promise<Array<object>>} remote session rows
 */
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
 * @param {number} trajectoryId trajectory DB id
 * @param {object} [opts] keep options
 * @param {number|null} [opts.keepRemoteSessionId] remote_session id to preserve
 * @param {string|null} [opts.keepAgentSessionId] agent session id to preserve
 * @returns {Promise<number[]>} closed remote_session ids
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
    // Close the executor agent session too — otherwise the old slot (Python +
    // Chrome) stays occupied and its CDP port is excluded from orphan-Chrome
    // reuse, so a re-attach after control-plane restart opens a brand-new slot
    // and the old Chrome becomes an unreachable orphan. keepBrowser=true leaves
    // the Chrome on CDP so the next attach reuses the same browser/page state.
    if (row.agentSessionId) {
      try {
        let nodeUuid = null;
        if (row.executorNodeId != null) {
          const node = await executorNodeDao.getById(row.executorNodeId).catch(() => null);
          nodeUuid = node?.nodeUuid || null;
        }
        await closeExecutorSession({
          nodeUuid,
          sessionId: row.agentSessionId,
          keepBrowser: true,
          timeoutMs: 2000,
        });
      } catch (err) {
        console.warn('[remote] supersede close agent session failed:', row.agentSessionId, err.message);
      }
    }
    clearLiveBinding(row.id);
    closed.push(row.id);
  }
  return closed;
}

/**
 * Attach BiB for a specific trajectory + agent session.
 * Creates or reactivates remote_session; mounts trajectory.remote_session_id.
 * @param {object} [opts] attach options (sessionId, trajectoryId, viewport, quality, resize, …)
 * @returns {Promise<{ remoteSession: object, status: object }>} remote session row + live status
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

  let nodeUuid = null;
  let remoteSession = null;
  let binding = null;

  // Claim row + mutate shared live bindings under the trajectory lock (reentrant).
  const claimAndBind = async () => {
    // Drop other traj-bound occupied rows; keep this agent session's row for reuse.
    if (Number.isFinite(trajectoryId)) {
      await supersedeStaleForTrajectory(trajectoryId, { keepAgentSessionId: sessionId });
    }
    nodeUuid = active.executorNodeUuid;
    const executorNodeId = await resolveExecutorNodeId(nodeUuid);
    const viewportW = Number(opts.viewportW) || 1600;
    const viewportH = Number(opts.viewportH) || 900;

    // Reuse idle remote row for same agent session when possible
    remoteSession = await remoteSessionDao.getOccupiedByAgentSession(sessionId);
    if (remoteSession && remoteSession.status === 'idle') {
      if (Number.isFinite(trajectoryId)) {
        const { assertClaimable } = await import('./session-lifecycle.js');
        assertClaimable(remoteSession, trajectoryId);
      }
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

    binding = {
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
  };

  if (Number.isFinite(trajectoryId) && trajectoryId > 0) {
    await withTrajectoryLock(trajectoryId, claimAndBind);
  } else {
    await claimAndBind();
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
    quality: opts.quality ?? 65,
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
    // Failure path must also sweep trajectory FKs, otherwise
    // trajectory.remote_session_id stays a ghost mount (perpetual 409 occupancy).
    try {
      const { clearOwnershipOnClose } = await import('./session-lifecycle.js');
      await clearOwnershipOnClose(remoteSession.id).catch(() => {});
      await remoteSessionDao.close(remoteSession.id, { crashed: true });
    } catch {}
    throw err;
  }
  if (!ready) {
    liveByRemoteSessionId.delete(remoteSession.id);
    try {
      const { clearOwnershipOnClose } = await import('./session-lifecycle.js');
      await clearOwnershipOnClose(remoteSession.id).catch(() => {});
      await remoteSessionDao.close(remoteSession.id, { crashed: true });
    } catch {}
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
 * @param {{ remoteSessionId?: number, trajectoryId?: number, crashed?: boolean }} opts detach options
 * @returns {Promise<{ closedId: number|null, status: object, streamDetached: boolean, sessionKept: boolean, remoteSessionId?: number, trajectoryId?: number }>} detach result + live status
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

  const sessionLifecycle = await import('./session-lifecycle.js');

  if (opts.crashed) {
    await remoteSessionDao.close(remoteSessionId, { crashed: true });
    await sessionLifecycle.clearOwnershipOnClose(remoteSessionId).catch((err) => {
      console.warn('[remote] clearOwnershipOnClose after crash detach:', err.message);
    });
  } else if (remote.status === 'active' || remote.status === 'idle') {
    // Ownership write gate: idle + grace + clear caches (not Chrome)
    await sessionLifecycle.streamDetachOwnership(remoteSessionId, { trajectoryId });
  } else {
    clearLiveBinding(remoteSessionId);
    await unmountTrajectoriesFromRemoteSession(remoteSessionId, {
      demoteLive: true,
    }).catch((err) => {
      console.warn('[remote] clear traj mounts after stream detach:', err.message);
    });
  }

  const tid = trajectoryId
    || (remote.trajectoryId != null ? Number(remote.trajectoryId) : null);

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
 * Resolve live status for a trajectory / remote session / agent session.
 * @param {{ trajectoryId?: number, remoteSessionId?: number, remoteSessionUuid?: string, sessionId?: string, preferAgentSessionId?: string }} [opts] lookup keys
 * @returns {Promise<object>} live status snapshot (attached, remoteSessionId, sessionId, viewport, …)
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
      const { getTrajectoryRuntime } = await import('./trajectory/trajectory-runtime.js');
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
          // Rewrite via syncMount (truth + cache), never cache-only updateMeta
          const { syncMount } = await import('./session-lifecycle.js');
          await syncMount(tid, binding.remoteSessionId);
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
    viewportW: 1600,
    viewportH: 900,
    manualRecording: false,
  };
}

/** Rebuild in-memory live map entry from DB row (boot reconcile). */
