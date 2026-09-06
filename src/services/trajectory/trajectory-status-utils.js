/**
 * 轨迹状态判定助手（record_status v2）。零依赖、可被服务与 runner 安全引用。
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
