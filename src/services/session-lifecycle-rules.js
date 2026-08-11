/** Pure remote_session ownership / grace helpers (no DB). */

export function computeGraceUntil(fromMs = Date.now(), graceMs = 900000) {
  return new Date(Number(fromMs) + Number(graceMs));
}

export function isWithinGrace(row, nowMs = Date.now()) {
  if (!row?.graceUntil) return false;
  const t = new Date(row.graceUntil).getTime();
  if (!Number.isFinite(t)) return false;
  return t > nowMs;
}

/**
 * @param {{ trajectoryId?: number|null, graceUntil?: Date|string|null, status?: string }} row
 * @param {number} claimantTrajectoryId
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
