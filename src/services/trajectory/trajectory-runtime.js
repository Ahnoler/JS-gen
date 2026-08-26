/**
 * In-memory trajectory ↔ executor session runtime map.
 */
import * as execSession from '../../executor-session-client.js';
import * as slotLease from '../../executor-slot-lease.js';
import { state } from '../../state.js';

const trajectoryRuntimeMap = new Map();

/**
 * Get the in-memory runtime entry for a trajectory, or null.
 * @param {number} trajectoryId trajectory DB id
 * @returns {object|null} runtime entry or null
 */
export function getTrajectoryRuntime(trajectoryId) {
  return trajectoryRuntimeMap.get(Number(trajectoryId)) || null;
}

/** @returns {Map<number, object>} the full trajectory runtime map */
export function getAllTrajectoryRuntimes() {
  return trajectoryRuntimeMap;
}

/**
 * Mark activity for idle reaper (after a step is persisted).
 * @param {number} trajectoryId trajectory DB id
 * @param {Date} [at] timestamp, default now
 */
export function touchTrajectoryRuntimeActivity(trajectoryId, at = new Date()) {
  const runtime = trajectoryRuntimeMap.get(Number(trajectoryId));
  if (!runtime) return;
  runtime.lastStepAt = at instanceof Date ? at.toISOString() : String(at);
}

/**
 * Clear in-memory trajectory↔executor bindings for a node (offline / crash).
 * @param {string} nodeUuid executor node uuid
 * @returns {number} number of runtimes cleared
 */
export function clearTrajectoryRuntimesForNode(nodeUuid) {
  if (!nodeUuid) return 0;
  let n = 0;
  for (const [tid, runtime] of [...trajectoryRuntimeMap.entries()]) {
    if (runtime?.executorNodeUuid !== nodeUuid) continue;
    if (runtime.sessionId) {
      const session = state.sessions.get(runtime.sessionId);
      if (session?._trajPersistUnsub) {
        try { session._trajPersistUnsub(); } catch {}
      }
      if (session?._aiRecordUnsub) {
        try { session._aiRecordUnsub(); } catch {}
      }
      state.sessions.delete(runtime.sessionId);
    }
    trajectoryRuntimeMap.delete(tid);
    n += 1;
  }
  return n;
}

/**
 * Drop stale trajectory runtime when the control-plane session is gone,
 * or when the executor no longer has that sessionId.
 * @param {number} tid trajectory DB id
 * @param {object} [root0] options
 * @param {boolean} [root0.verifyExecutor] whether to check executor session liveness
 * @returns {Promise<object|null>} retained runtime, or null if dropped
 */
export async function clearStaleTrajectoryRuntime(tid, { verifyExecutor = true } = {}) {
  const existing = trajectoryRuntimeMap.get(tid);
  if (!existing) return null;
  if (!existing.sessionId || !state.sessions.has(existing.sessionId)) {
    slotLease.releaseByTrajectory(tid);
    trajectoryRuntimeMap.delete(tid);
    return null;
  }
  if (verifyExecutor && existing.executorNodeUuid) {
    try {
      const sessions = await execSession.listExecutorSessions(existing.executorNodeUuid, 8000);
      const live = sessions.some((s) => s.sessionId === existing.sessionId);
      if (!live) {
        const session = state.sessions.get(existing.sessionId);
        if (session?._trajPersistUnsub) {
          try { session._trajPersistUnsub(); } catch {}
        }
        if (session?._aiRecordUnsub) {
          try { session._aiRecordUnsub(); } catch {}
        }
        state.sessions.delete(existing.sessionId);
        slotLease.releaseByTrajectory(tid);
        trajectoryRuntimeMap.delete(tid);
        return null;
      }
    } catch {
      // If executor is unreachable, keep runtime until disconnect purge.
    }
  }
  return existing;
}

/**
 * Mark current ACTION_LOG ids as consumed so they are not later appended as steps.
 * @param {object} runtime trajectory runtime entry
 * @returns {Promise<void>}
 */
export async function markConsumedActionLog(runtime) {
  if (!runtime?.sessionId || !runtime?.executorNodeUuid) return;
  try {
    const resultP = execSession.waitForSessionEvent(runtime.sessionId, 'get_action_log_result', 5000);
    execSession.forwardStdin({
      nodeUuid: runtime.executorNodeUuid,
      sessionId: runtime.sessionId,
      event: 'get_action_log',
      data: {},
    });
    const result = await resultP.catch(() => null);
    const entries = Array.isArray(result?.entries) ? result.entries : [];
    for (const entry of entries) {
      const id = entry?.id != null ? String(entry.id) : '';
      if (id) runtime.persistedActionIds.add(id);
    }
  } catch (err) {
    console.warn('[trajectory] markConsumedActionLog failed:', err.message);
  }
}

/**
 * Bind control-plane session + trajectory runtime after a successful openSession.
 * Caller should invoke bindTrajectoryManualPersist after this returns.
 * @param {number} tid trajectory DB id
 * @param {string} sessionId executor session id
 * @param {object} opened openSession result (nodeUuid, slotIndex, model, cdpPort, …)
 * @param {object} [root0] options
 * @param {string|null} [root0.bibError] BiB attach error, if any
 * @param {number|null} [root0.remoteSessionId] remote_session DB id
 * @returns {object} trajectory runtime entry
 */
export function registerTrajectorySession(tid, sessionId, opened, { bibError = null, remoteSessionId = null } = {}) {
  const persistedActionIds = new Set();
  state.sessions.set(sessionId, {
    sessionId,
    stepIndex: 0,
    trajectories: [],
    createdAt: new Date().toISOString(),
    model: opened.model || null,
    lastTask: null,
    lastMaxSteps: null,
    businessDataFile: null,
    useExecutor: true,
    executorNodeUuid: opened.nodeUuid,
    executorSlotIndex: opened.slotIndex,
    busy: false,
    dbTrajectoryId: tid,
    selectedPhaseId: null,
    activePhaseId: null,
    autoPersist: true,
    persistedActionIds,
    cdpPort: opened.cdpPort ?? null,
    cdpReady: opened.cdpReady !== false,
  });

  const runtime = {
    trajectoryId: tid,
    sessionId,
    executorNodeUuid: opened.nodeUuid,
    executorSlotIndex: opened.slotIndex,
    remoteSessionId,
    attachedAt: new Date().toISOString(),
    lastStepAt: null,
    persistedActionIds,
    selectedPhaseId: null,
    abortRecording: false,
    /** User stop for in-flight steps/replay (incl. Type A/B heal). */
    abortReplay: false,
    /** Set by record/stop: { success } so the runner preserves the user's chosen result. */
    userStop: null,
    bibError,
    manualRecording: false,
  };
  trajectoryRuntimeMap.set(tid, runtime);
  return runtime;
}

/**
 * Delete the runtime entry for a trajectory (for detach / attach that mutate the map directly).
 * @param {number} tid trajectory DB id
 * @returns {boolean} true if an entry was deleted
 */
export function deleteTrajectoryRuntime(tid) {
  return trajectoryRuntimeMap.delete(Number(tid));
}
