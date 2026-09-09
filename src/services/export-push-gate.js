/**
 * Partner push eligibility by trajectory.persistent_record_status.
 * Product: only confirmed (completed) may push.
 *
 * 判定源是持久基线 persistent_record_status（录制/detach 过程中 record_status 会被
 * 临时改写为 recording 等，detach 后由后端恢复基线；推送不应被瞬态状态拦截）。
 */

export const PUSHABLE_RECORD_STATUSES = Object.freeze(['completed']);

const PUSHABLE = new Set(PUSHABLE_RECORD_STATUSES);

/**
 * Read the push-gate status from a trajectory row: prefer persistent baseline
 * (persistentRecordStatus / persistent_record_status), fall back to record_status
 * for rows produced before the persistent column existed.
 * @param {object|null} traj trajectory row (camelCase or snake_case)
 * @returns {string|null} persistent record status value
 */
export function getRecordStatus(traj) {
  if (!traj || typeof traj !== 'object') return null;
  return traj.persistentRecordStatus
    ?? traj.persistent_record_status
    ?? traj.recordStatus
    ?? traj.record_status
    ?? null;
}

/**
 * True when status is in PUSHABLE_RECORD_STATUSES (completed).
 * @param {string|null} status persistent record status
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
