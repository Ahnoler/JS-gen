/**
 * Remote-session in-memory state hub: live BiB bindings keyed by
 * remote_session.id and per-trajectory serialize locks, plus their accessors.
 * Extracted from remote-session-service.js — move-only, no logic changes.
 */
import { state } from '../state.js';

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
export const liveByRemoteSessionId = new Map();

/** @type {Map<number, Promise<unknown>>} serialize prepare/detach/release per trajectory */
const trajLocks = new Map();

/**
 * Serialize prepare/detach/release calls per trajectory (promise-chain lock).
 * @param {number} trajectoryId trajectory DB id
 * @param {() => Promise<unknown>} fn async work to run under the lock
 * @returns {Promise<unknown>} result of fn
 */
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

/**
 * Convert a live binding into a client-facing status snapshot.
 * @param {LiveBinding|null} [binding] live binding entry
 * @returns {object} status object (attached, remoteSessionId, sessionId, viewport, …)
 */
export function bindingToStatus(binding) {
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
      viewportW: binding?.viewportW ?? 1600,
      viewportH: binding?.viewportH ?? 900,
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

/**
 * Get the live binding for a remote_session id, or null.
 * @param {number} remoteSessionId remote_session DB id
 * @returns {LiveBinding|null} binding or null
 */
export function getLiveBindingByRemoteSessionId(remoteSessionId) {
  const id = Number(remoteSessionId);
  if (!Number.isFinite(id)) return null;
  return liveByRemoteSessionId.get(id) || null;
}

/**
 * Get the live binding for a trajectory, preferring attached + matching session.
 * @param {number} trajectoryId trajectory DB id
 * @param {object} [root0] options
 * @param {number|null} [root0.preferRemoteSessionId] preferred remote_session id
 * @param {string|null} [root0.preferAgentSessionId] preferred agent session id
 * @returns {LiveBinding|null} binding or null
 */
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

/**
 * Get the live binding for an agent session id (prefers attached).
 * @param {string} agentSessionId executor session id
 * @returns {LiveBinding|null} binding or null
 */
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

/**
 * Get the live binding for a remote_session UUID, or null.
 * @param {string} remoteSessionUuid remote session UUID
 * @returns {LiveBinding|null} binding or null
 */
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
 * @param {{ trajectoryId?: number|null, sessionId?: string|null, remoteSessionId?: number|null, remoteSessionUuid?: string|null }} opts lookup keys (any subset)
 * @returns {LiveBinding|null} resolved binding, or null
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

/** Clear all live BiB bindings (full executor reset). */
export function clearExecutorLive() {
  liveByRemoteSessionId.clear();
}

/**
 * Clear live BiB bindings for a specific executor node (or all if no uuid).
 * @param {string|null} [nodeUuid] executor node uuid (falsy = clear all)
 * @returns {void}
 */
export function clearExecutorLiveForNode(nodeUuid) {
  if (!nodeUuid) {
    clearExecutorLive();
    return;
  }
  for (const [id, b] of [...liveByRemoteSessionId.entries()]) {
    if (b.nodeUuid === nodeUuid) liveByRemoteSessionId.delete(id);
  }
}

/**
 * Clear the live binding for a single remote_session id.
 * @param {number} remoteSessionId remote_session DB id
 * @returns {void}
 */
export function clearLiveBinding(remoteSessionId) {
  const id = Number(remoteSessionId);
  if (Number.isFinite(id)) liveByRemoteSessionId.delete(id);
}

/**
 * Rebuild in-memory live map entry from DB row (boot reconcile).
 * @param {object} row remote_session DB row
 * @param {object} [root0] options
 * @param {string|null} [root0.nodeUuid] executor node uuid
 * @param {boolean} [root0.attached] whether the binding is attached, default false
 * @returns {LiveBinding|null} restored binding, or null if row has no id
 */
export function restoreLiveBindingFromRow(row, { nodeUuid = null, attached = false } = {}) {
  if (!row?.id) return null;
  const binding = {
    remoteSessionId: row.id,
    remoteSessionUuid: row.sessionUuid,
    trajectoryId: row.trajectoryId != null ? Number(row.trajectoryId) : null,
    agentSessionId: row.agentSessionId || '',
    nodeUuid,
    executorNodeId: row.executorNodeId ?? null,
    viewportW: row.viewportW || 1600,
    viewportH: row.viewportH || 900,
    attached: !!attached && row.status === 'active',
  };
  if (binding.attached) liveByRemoteSessionId.set(row.id, binding);
  return binding;
}

/**
 * List all current live BiB bindings.
 * @returns {LiveBinding[]} array of live bindings
 */
export function listLiveBindings() {
  return [...liveByRemoteSessionId.values()];
}
