/**
 * Partner push eligibility by trajectory.recordStatus.
 * Product: only 「录制完成」 (recorded) and confirmed (completed) may push.
 */

export const PUSHABLE_RECORD_STATUSES = Object.freeze(['recorded', 'completed']);

const PUSHABLE = new Set(PUSHABLE_RECORD_STATUSES);

export function getRecordStatus(traj) {
  if (!traj || typeof traj !== 'object') return null;
  return traj.recordStatus ?? traj.record_status ?? null;
}

export function isPushableRecordStatus(status) {
  return PUSHABLE.has(status);
}

/**
 * @throws {{ statusCode: number, code: string, recordStatus: * }}
 */
export function assertPushableForPartner(traj) {
  const status = getRecordStatus(traj);
  if (!isPushableRecordStatus(status)) {
    const err = new Error(
      `只能推送状态为「录制完成」的交易（当前: ${status ?? 'unknown'}）`,
    );
    err.statusCode = 409;
    err.code = 'not_pushable_status';
    err.recordStatus = status;
    throw err;
  }
}
