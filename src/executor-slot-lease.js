/**
 * In-memory executor slot leases (control-plane).
 * One lease = one browser/agent slot owned by at most one trajectory (or a non-traj session).
 */

/** @typedef {{
 *   trajectoryId: number|null,
 *   sessionId: string,
 *   nodeUuid: string,
 *   slotIndex: number,
 *   acquiredAt: string,
 * }} SlotLease */

/** @type {Map<string, SlotLease>} key = `${nodeUuid}:${slotIndex}` */
const bySlotKey = new Map();
/** @type {Map<string, SlotLease>} */
const bySessionId = new Map();
/** @type {Map<number, SlotLease>} */
const byTrajectoryId = new Map();
/** Soft reservations while session.open is in flight (counts toward capacity). */
/** @type {Map<string, number>} */
const pendingByNode = new Map();

let mutexTail = Promise.resolve();

/** Serialize pick + pending reserve to avoid double-booking the last free slot. */
export function withLeaseMutex(fn) {
  const run = mutexTail.then(() => fn());
  mutexTail = run.then(() => undefined, () => undefined);
  return run;
}

export function slotKey(nodeUuid, slotIndex) {
  return `${nodeUuid}:${Number(slotIndex)}`;
}

export function countHardLeases(nodeUuid) {
  let n = 0;
  for (const lease of bySlotKey.values()) {
    if (lease.nodeUuid === nodeUuid) n += 1;
  }
  return n;
}

/** Hard leases + pending opens (for capacity checks). */
export function countInUse(nodeUuid) {
  return countHardLeases(nodeUuid) + (pendingByNode.get(nodeUuid) || 0);
}

export function reservePending(nodeUuid) {
  pendingByNode.set(nodeUuid, (pendingByNode.get(nodeUuid) || 0) + 1);
}

export function releasePending(nodeUuid) {
  const cur = pendingByNode.get(nodeUuid) || 0;
  if (cur <= 1) pendingByNode.delete(nodeUuid);
  else pendingByNode.set(nodeUuid, cur - 1);
}

/** @returns {SlotLease[]} */
export function listAll() {
  return [...bySlotKey.values()];
}

/** @returns {SlotLease[]} */
export function listByNode(nodeUuid) {
  return listAll().filter((l) => l.nodeUuid === nodeUuid);
}

export function getBySession(sessionId) {
  return bySessionId.get(sessionId) || null;
}

export function getByTrajectory(trajectoryId) {
  if (trajectoryId == null) return null;
  return byTrajectoryId.get(Number(trajectoryId)) || null;
}

/** Public holders list for 409 responses. */
export function listHolders() {
  return listAll().map((l) => ({
    trajectoryId: l.trajectoryId,
    executorNodeUuid: l.nodeUuid,
    slotIndex: l.slotIndex,
    sessionId: l.sessionId,
  }));
}

/**
 * Confirm a hard lease after session.open succeeds.
 * Replaces any prior lease for the same session / trajectory / slot key.
 * @param {{ sessionId: string, nodeUuid: string, slotIndex: number, trajectoryId?: number|null }} opts
 */
export function confirmLease({ sessionId, nodeUuid, slotIndex, trajectoryId = null }) {
  const tid = trajectoryId == null ? null : Number(trajectoryId);
  releaseBySession(sessionId);
  if (tid != null) releaseByTrajectory(tid);

  const key = slotKey(nodeUuid, slotIndex);
  const prev = bySlotKey.get(key);
  if (prev && prev.sessionId !== sessionId) {
    releaseBySession(prev.sessionId);
  }

  /** @type {SlotLease} */
  const lease = {
    trajectoryId: tid,
    sessionId,
    nodeUuid,
    slotIndex: Number(slotIndex),
    acquiredAt: new Date().toISOString(),
  };
  bySlotKey.set(key, lease);
  bySessionId.set(sessionId, lease);
  if (tid != null) byTrajectoryId.set(tid, lease);
  return lease;
}

export function releaseBySession(sessionId) {
  if (!sessionId) return false;
  const lease = bySessionId.get(sessionId);
  if (!lease) return false;
  bySessionId.delete(sessionId);
  bySlotKey.delete(slotKey(lease.nodeUuid, lease.slotIndex));
  if (lease.trajectoryId != null && byTrajectoryId.get(lease.trajectoryId)?.sessionId === sessionId) {
    byTrajectoryId.delete(lease.trajectoryId);
  }
  return true;
}

export function releaseByTrajectory(trajectoryId) {
  if (trajectoryId == null) return false;
  const tid = Number(trajectoryId);
  const lease = byTrajectoryId.get(tid);
  if (!lease) return false;
  return releaseBySession(lease.sessionId);
}

export function releaseByNode(nodeUuid) {
  if (!nodeUuid) return 0;
  pendingByNode.delete(nodeUuid);
  const leases = listByNode(nodeUuid);
  for (const lease of leases) releaseBySession(lease.sessionId);
  return leases.length;
}

export function noFreeSlotsError() {
  const err = new Error('No free executor slots');
  err.statusCode = 409;
  err.holders = listHolders();
  return err;
}
