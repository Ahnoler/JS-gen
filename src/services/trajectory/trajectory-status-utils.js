/**
 * 轨迹录制状态判定助手。
 *
 * 提供轨迹服务和运行器使用的、基于数据库的录制活动检查。将此规则集中在一个
 * 小模块中，可避免调用方根据瞬时运行时标志或过期元数据推断 AI 活动状态。
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
