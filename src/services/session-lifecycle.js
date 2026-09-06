/**
 * Session ownership write gate: mount / streamDetach grace / expire / close clear.
 * BiB stop stays in remote-session-service; this module owns truth + cache writes.
 */
import { REMOTE_SESSION_GRACE_MS } from '../../config/config.js';
import * as remoteSessionDao from '../dao/remote-session-dao.js';
import * as trajectoryDao from '../dao/trajectory-dao.js';
import {
  canClaimRemoteSession,
  computeGraceUntil,
  graceOwnedError,
} from './session-lifecycle-rules.js';
import { clearLiveBinding } from './remote-session-state.js';

function logLifecycle(event, fields = {}) {
  console.log(`[lifecycle.${event}]`, JSON.stringify(fields));
}

async function clearRuntimeMounts(cleared, remoteSessionId) {
  if (!cleared?.length) return;
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
}

/**
 * Assert a remote session is claimable by a trajectory; throw 409 otherwise.
 * @param {object} row remote_session row
 * @param {number} claimantTrajectoryId trajectory DB id attempting to claim
 * @param {number} [nowMs] current time in ms, default Date.now()
 */
export function assertClaimable(row, claimantTrajectoryId, nowMs = Date.now()) {
  const r = canClaimRemoteSession(row, claimantTrajectoryId, nowMs);
  if (r.ok) return;
  if (r.code === 'grace_owned') {
    logLifecycle('claim_denied', {
      trajectoryId: claimantTrajectoryId,
      remoteSessionId: r.remoteSessionId,
      ownerTrajectoryId: r.ownerTrajectoryId,
      graceUntil: r.graceUntil,
    });
    throw graceOwnedError(r);
  }
  const err = new Error(r.code || 'claim_denied');
  err.statusCode = 409;
  err.code = r.code;
  throw err;
}

/**
 * Exclusive mount: truth + cache. Clears other caches pointing at this rs.
 * @param {number} trajectoryId trajectory DB id
 * @param {number} remoteSessionId remote_session DB id
 * @returns {Promise<number[]>} trajectory ids whose cache was cleared
 */
export async function syncMount(trajectoryId, remoteSessionId) {
  const tid = Number(trajectoryId);
  const rid = Number(remoteSessionId);
  if (!Number.isFinite(tid) || tid <= 0 || !Number.isFinite(rid) || rid <= 0) return [];

  const cleared = await trajectoryDao.clearMountByRemoteSessionId(rid, {
    exceptTrajectoryId: tid,
    demoteLive: true,
  });
  await clearRuntimeMounts(cleared, rid);
  // Mount / owner reclaim: clear grace_until so reclaim is not still "in grace"
  await remoteSessionDao.update(rid, { trajectoryId: tid, graceUntil: null });
  await trajectoryDao.updateMeta(tid, { remoteSessionId: rid });
  logLifecycle('attach', { trajectoryId: tid, remoteSessionId: rid, clearedCaches: cleared });
  return cleared;
}

/**
 * Cache-only clear (does not touch remote_session.trajectory_id / grace).
 * @param {number} remoteSessionId remote_session DB id
 * @param {object} [root0] options
 * @param {number|null} [root0.exceptTrajectoryId] trajectory id to preserve
 * @param {boolean} [root0.demoteLive] whether to demote live trajectories, default true
 * @returns {Promise<number[]>} trajectory ids whose cache was cleared
 */
export async function clearMountCache(remoteSessionId, {
  exceptTrajectoryId = null,
  demoteLive = true,
} = {}) {
  const rid = Number(remoteSessionId);
  const cleared = await trajectoryDao.clearMountByRemoteSessionId(rid, {
    exceptTrajectoryId,
    demoteLive,
  });
  await clearRuntimeMounts(cleared, rid);
  return cleared;
}

/**
 * streamDetach ownership side: idle + grace + clear caches (not Chrome).
 * @param {number} remoteSessionId remote_session DB id
 * @param {object} [root0] options
 * @param {number|null} [root0.trajectoryId] owning trajectory id
 * @param {number} [root0.graceMs] grace window in ms, default REMOTE_SESSION_GRACE_MS
 * @returns {Promise<object|null>} updated remote_session row, or null if not found
 */
export async function streamDetachOwnership(remoteSessionId, {
  trajectoryId = null,
  graceMs = REMOTE_SESSION_GRACE_MS,
} = {}) {
  const rid = Number(remoteSessionId);
  const remote = await remoteSessionDao.getById(rid);
  if (!remote) return null;

  const owner = trajectoryId != null
    ? Number(trajectoryId)
    : (remote.trajectoryId != null ? Number(remote.trajectoryId) : null);
  const graceUntil = computeGraceUntil(Date.now(), graceMs);

  await remoteSessionDao.markIdle(rid, {
    graceUntil,
    trajectoryId: owner, // keep / set owner during grace
  });
  const cleared = await trajectoryDao.clearMountByRemoteSessionId(rid, { demoteLive: true });
  await clearRuntimeMounts(cleared, rid);
  clearLiveBinding(rid);
  logLifecycle('stream_detach', { remoteSessionId: rid, trajectoryId: owner, graceUntil });
  logLifecycle('grace_set', { remoteSessionId: rid, trajectoryId: owner, graceUntil });
  return remoteSessionDao.getById(rid);
}

/**
 * Expire grace for a single remote session and clear its mounts.
 * @param {number} remoteSessionId remote_session DB id
 * @returns {Promise<number|null>} expired remote_session id, or null if not found
 */
export async function expireGrace(remoteSessionId) {
  const rid = Number(remoteSessionId);
  const row = await remoteSessionDao.getById(rid);
  if (!row) return null;
  await remoteSessionDao.clearGraceOwnership(rid);
  const cleared = await trajectoryDao.clearMountByRemoteSessionId(rid, { demoteLive: true });
  await clearRuntimeMounts(cleared, rid);
  logLifecycle('grace_expire', {
    remoteSessionId: rid,
    prevTrajectoryId: row.trajectoryId,
  });
  return rid;
}

/**
 * Expire all remote sessions whose grace window has elapsed.
 * @param {Date} [now] reference time, default now
 * @returns {Promise<number[]>} expired remote_session ids
 */
export async function expireAllDueGrace(now = new Date()) {
  const rows = await remoteSessionDao.listGraceExpired({ now });
  const out = [];
  for (const row of rows) {
    await remoteSessionDao.clearGraceOwnership(row.id);
    const cleared = await trajectoryDao.clearMountByRemoteSessionId(row.id, { demoteLive: true });
    await clearRuntimeMounts(cleared, row.id);
    logLifecycle('grace_expire', {
      remoteSessionId: row.id,
      prevTrajectoryId: row.trajectoryId,
    });
    out.push(row.id);
  }
  return out;
}

/**
 * Clear ownership + caches when a remote session is closed/crashed.
 * @param {number} remoteSessionId remote_session DB id
 * @returns {Promise<void>}
 */
export async function clearOwnershipOnClose(remoteSessionId) {
  const rid = Number(remoteSessionId);
  const cleared = await trajectoryDao.clearMountByRemoteSessionId(rid, { demoteLive: true });
  await clearRuntimeMounts(cleared, rid);
  clearLiveBinding(rid);
  logLifecycle('close', { remoteSessionId: rid });
}

/**
 * Wrap stale-mount repair (truth backfill left to callers / Task 5).
 * @returns {Promise<number[]>} trajectory ids whose stale mounts were repaired
 */
export async function reconcileDirtyMounts() {
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
  logLifecycle('reconcile_dirty', { cleared });
  return cleared;
}
