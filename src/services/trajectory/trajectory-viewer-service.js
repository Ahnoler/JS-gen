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
import { getTrajectoryRuntime } from './trajectory-runtime.js';
import { state } from '../../state.js';

/** Heartbeat interval expected from active viewers (ms). */
const VIEWER_HEARTBEAT_MS = 10000;
/** Viewer considered stale after this silence (ms). */
const VIEWER_STALE_MS = 30000;
/** Grace period before detaching when count drops to zero, to survive page refresh. */
const DETACH_GRACE_MS = 5000;
/**
 * When the last viewer leaves while a recording is still running, do NOT detach
 * (that would abort the recording). Re-check after this interval instead.
 */
const RECORDING_RECHECK_MS = 15000;

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
 * Whether a trajectory is currently recording (AI run in flight or manual recording on).
 * Used to avoid auto-releasing the executor mid-recording — detach aborts the run and
 * reverts record_status to its persistent baseline (non-terminating release).
 *
 * Uses in-memory runtime flags, which the recording runner sets synchronously at run
 * start (before the login window starts) and clears on finish — more timely than the
 * DB-based running-phase check, which misses the login window.
 * @param {number} tid trajectory DB id
 * @returns {boolean} true when a recording is active
 */
function isActivelyRecording(tid) {
  const runtime = getTrajectoryRuntime(tid);
  if (!runtime) return false;
  if (runtime.manualRecording || runtime.aiRecording) return true;
  if (runtime.sessionId) {
    const session = state.sessions.get(runtime.sessionId);
    if (session?.aiRecording || session?.busy) return true;
  }
  return false;
}

/**
 * Arm a detach check for a trajectory after `delayMs`.
 * @param {number} tid trajectory DB id
 * @param {number} delayMs delay in milliseconds
 * @returns {void}
 */
function scheduleDetach(tid, delayMs) {
  if (detachTimers.has(tid)) return;
  const timer = setTimeout(() => {
    detachTimers.delete(tid);
    void runDetachCheck(tid);
  }, delayMs);
  detachTimers.set(tid, timer);
}

/**
 * Release the executor only when nobody is watching AND no recording is running.
 * If a recording is still in flight, re-check later instead of aborting it.
 * @param {number} tid trajectory DB id
 * @returns {Promise<void>} resolves after the check
 */
async function runDetachCheck(tid) {
  if (getViewerCount(tid) !== 0) return;
  if (isActivelyRecording(tid)) {
    // Recording in progress with no viewers → keep resources, re-check later.
    if (getViewerCount(tid) === 0) scheduleDetach(tid, RECORDING_RECHECK_MS);
    return;
  }
  await detachTrajectoryLive(tid, { reason: 'no_viewers' }).catch((err) => {
    console.warn(`[viewer-service] detach failed for traj #${tid}:`, err?.message || err);
  });
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
  scheduleDetach(tid, DETACH_GRACE_MS);
}
