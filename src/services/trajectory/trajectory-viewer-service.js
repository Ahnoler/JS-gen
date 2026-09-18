/**
 * Viewer tracking for the recording studio.
 *
 * Tracks which clients are currently viewing a trajectory's recording page across
 * browsers/machines. When the last viewer leaves (or its heartbeat expires), the
 * service schedules a graceful release of the trajectory's executor resources.
 *
 * This is intentionally separate from WebSocket connections: a viewer may be on
 * the recording page without an active WS, and multiple viewers can share the same
 * trajectory executor session.
 */
import { detachTrajectoryLive } from './trajectory-attach-service.js';

/** Heartbeat interval expected from active viewers (ms). */
const VIEWER_HEARTBEAT_MS = 10000;
/** Viewer considered stale after this silence (ms). */
const VIEWER_STALE_MS = 30000;
/** Grace period before detaching when count drops to zero, to survive page refresh. */
const DETACH_GRACE_MS = 5000;

/** @type {Map<number, Map<string, {lastSeenAt: number}>>} */
const viewersByTrajectory = new Map();

/** @type {Map<number, ReturnType<typeof setTimeout>>} */
const detachTimers = new Map();

let cleanupTimer = null;

/**
 * Ensure a periodic cleanup pass runs to evict stale viewer entries.
 * @returns {void}
 */
function ensureCleanupTimer() {
  if (cleanupTimer) return;
  cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [tid, viewers] of viewersByTrajectory) {
      for (const [viewerId, meta] of viewers) {
        if (now - meta.lastSeenAt >= VIEWER_STALE_MS) {
          viewers.delete(viewerId);
        }
      }
      if (viewers.size === 0) {
        viewersByTrajectory.delete(tid);
        scheduleDetachIfEmpty(tid);
      }
    }
  }, VIEWER_HEARTBEAT_MS);
}

/**
 * Current number of active viewers for a trajectory.
 * @param {number|string} trajectoryId trajectory DB id
 * @returns {number} viewer count
 */
export function getViewerCount(trajectoryId) {
  const tid = Number(trajectoryId);
  return viewersByTrajectory.get(tid)?.size || 0;
}

/**
 * Register a viewer for a trajectory.
 * @param {number|string} trajectoryId trajectory DB id
 * @param {string} viewerId client-generated viewer id (unique per tab)
 * @returns {number} current viewer count after registration
 */
export function enterViewer(trajectoryId, viewerId) {
  const tid = Number(trajectoryId);
  if (!Number.isFinite(tid) || tid <= 0 || !viewerId) return getViewerCount(tid);

  cancelScheduledDetach(tid);

  let viewers = viewersByTrajectory.get(tid);
  if (!viewers) {
    viewers = new Map();
    viewersByTrajectory.set(tid, viewers);
  }
  viewers.set(String(viewerId), { lastSeenAt: Date.now() });
  ensureCleanupTimer();
  return getViewerCount(tid);
}

/**
 * Unregister a viewer for a trajectory.
 * @param {number|string} trajectoryId trajectory DB id
 * @param {string} viewerId client-generated viewer id
 * @returns {number} current viewer count after removal
 */
export function leaveViewer(trajectoryId, viewerId) {
  const tid = Number(trajectoryId);
  if (!Number.isFinite(tid) || tid <= 0 || !viewerId) return getViewerCount(tid);

  const viewers = viewersByTrajectory.get(tid);
  if (viewers) {
    viewers.delete(String(viewerId));
    if (viewers.size === 0) {
      viewersByTrajectory.delete(tid);
    }
  }
  scheduleDetachIfEmpty(tid);
  return getViewerCount(tid);
}

/**
 * Refresh a viewer's heartbeat.
 * @param {number|string} trajectoryId trajectory DB id
 * @param {string} viewerId client-generated viewer id
 * @returns {number} current viewer count
 */
export function touchViewer(trajectoryId, viewerId) {
  const tid = Number(trajectoryId);
  if (!Number.isFinite(tid) || tid <= 0 || !viewerId) return getViewerCount(tid);

  const viewers = viewersByTrajectory.get(tid);
  if (viewers) {
    const v = viewers.get(String(viewerId));
    if (v) v.lastSeenAt = Date.now();
  }
  return getViewerCount(tid);
}

/**
 * Cancel a pending detach for a trajectory (used when a viewer re-enters).
 * @param {number} tid trajectory DB id
 * @returns {void}
 */
function cancelScheduledDetach(tid) {
  const timer = detachTimers.get(tid);
  if (timer) {
    clearTimeout(timer);
    detachTimers.delete(tid);
  }
}

/**
 * Schedule executor release if no viewers remain for a trajectory.
 * @param {number} tid trajectory DB id
 * @returns {void}
 */
function scheduleDetachIfEmpty(tid) {
  if (getViewerCount(tid) > 0) {
    cancelScheduledDetach(tid);
    return;
  }
  if (detachTimers.has(tid)) return;

  const timer = setTimeout(() => {
    detachTimers.delete(tid);
    if (getViewerCount(tid) === 0) {
      detachTrajectoryLive(tid, { reason: 'no_viewers' }).catch((err) => {
        console.warn(`[viewer-service] detach failed for traj #${tid}:`, err?.message || err);
      });
    }
  }, DETACH_GRACE_MS);
  detachTimers.set(tid, timer);
}
