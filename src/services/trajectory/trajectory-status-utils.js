/**
 * Trajectory recording-status predicates.
 *
 * Exposes the database-backed recording activity check used by trajectory
 * services and runners. Keeping this rule in one small module prevents callers
 * from inferring AI activity from transient runtime flags or stale metadata.
 */
import * as trajectoryDao from '../../dao/trajectory-dao.js';

/**
 * AI 录制是否活跃（单一事实源：phase.status='running'）。
 * @param {number} trajectoryId trajectory DB id
 * @returns {Promise<boolean>} true when at least one phase is in 'running' status
 */
export async function isAiRecordingActive(trajectoryId) {
  return trajectoryDao.hasRunningPhase(trajectoryId);
}
