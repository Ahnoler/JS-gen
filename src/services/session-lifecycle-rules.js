/** Pure remote_session ownership / grace helpers (no DB). */

/**
 * Compute the grace-until timestamp from a base time and grace duration.
 * @param {number} [fromMs] base time in ms (default now)
 * @param {number} [graceMs] grace duration in ms (default 900000 = 15 min)
 * @returns {Date} grace-until timestamp
 */
export function computeGraceUntil(fromMs = Date.now(), graceMs = 900000) {
  return new Date(Number(fromMs) + Number(graceMs));
}

/**
 * Check whether a row is still within its grace window.
 * @param {object} row remote_session row with graceUntil
 * @param {number} [nowMs] current time in ms (default now)
 * @returns {boolean} true if graceUntil is still in the future
 */
export function isWithinGrace(row, nowMs = Date.now()) {
  if (!row?.graceUntil) return false;
  const t = new Date(row.graceUntil).getTime();
  if (!Number.isFinite(t)) return false;
  return t > nowMs;
}

/**
 * Determine whether a trajectory can claim a remote_session.
 * @param {{ trajectoryId?: number|null, graceUntil?: Date|string|null, status?: string }} row remote_session row
 * @param {number} claimantTrajectoryId trajectory DB id attempting to claim
 * @param {number} [nowMs] current time in ms (default now)
 * @returns {{ ok: boolean, code?: string, ownerTrajectoryId?: number, graceUntil?: Date|string, remoteSessionId?: number|null }} claim result
 */
export function canClaimRemoteSession(row, claimantTrajectoryId, nowMs = Date.now()) {
  const claimant = Number(claimantTrajectoryId);
  const owner = row?.trajectoryId != null ? Number(row.trajectoryId) : null;
  if (!Number.isFinite(claimant) || claimant <= 0) {
    return { ok: false, code: 'invalid_claimant' };
  }
  if (owner == null || !Number.isFinite(owner)) return { ok: true };
  if (owner === claimant) return { ok: true };
  if (isWithinGrace(row, nowMs)) {
    return {
      ok: false,
      code: 'grace_owned',
      ownerTrajectoryId: owner,
      graceUntil: row.graceUntil,
      remoteSessionId: row.id != null ? Number(row.id) : null,
    };
  }
  return { ok: true };
}

/**
 * Build a 409 error for a grace-owned remote_session claim rejection.
 * @param {object} [details] grace-owned details
 * @param {number} [details.ownerTrajectoryId] current owner trajectory id
 * @param {Date|string} [details.graceUntil] grace deadline
 * @param {number} [details.remoteSessionId] remote_session id
 * @returns {Error & { statusCode: number, code: string }} configured error
 */
export function graceOwnedError(details = {}) {
  const err = new Error(
    `remote_session still owned by trajectory ${details.ownerTrajectoryId} until ${details.graceUntil}`,
  );
  err.statusCode = 409;
  err.code = 'grace_owned';
  err.ownerTrajectoryId = details.ownerTrajectoryId ?? null;
  err.graceUntil = details.graceUntil ?? null;
  err.remoteSessionId = details.remoteSessionId ?? null;
  return err;
}
