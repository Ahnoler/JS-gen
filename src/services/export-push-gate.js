/**
 * Partner push eligibility by trajectory.recordStatus.
 * Product: only confirmed (completed) may push.
 */

export const PUSHABLE_RECORD_STATUSES = Object.freeze(['completed']);

const PUSHABLE = new Set(PUSHABLE_RECORD_STATUSES);

/**
 * Read recordStatus from a trajectory row (camelCase or snake_case).
 * @param {object|null} traj trajectory row
 * @returns {string|null} record status value
 */
export function getRecordStatus(traj) {
  if (!traj || typeof traj !== 'object') return null;
  return traj.recordStatus ?? traj.record_status ?? null;
}

/**
 * True when status is in PUSHABLE_RECORD_STATUSES (completed).
 * @param {string|null} status record status
 * @returns {boolean} whether the status is pushable
 */
export function isPushableRecordStatus(status) {
  return PUSHABLE.has(status);
}

/**
 * Throw 409 if trajectory is not in a pushable status.
 * @param {object} traj trajectory row
 * @returns {void}
 * @throws {{ statusCode: number, code: string, recordStatus: string|null }}
 */
export function assertPushableForPartner(traj) {
  const status = getRecordStatus(traj);
  if (!isPushableRecordStatus(status)) {
    const err = new Error(
      `只能推送状态为「已确认」的交易（当前: ${status ?? 'unknown'}）`,
    );
    err.statusCode = 409;
    err.code = 'not_pushable_status';
    err.recordStatus = status;
    throw err;
  }
}
