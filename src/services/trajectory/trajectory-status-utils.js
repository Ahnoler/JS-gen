/**
 * 轨迹状态判定助手（record_status v2）。零依赖、可被服务与 runner 安全引用。
 */
import * as trajectoryDao from '../../dao/trajectory-dao.js';

/** AI 录制是否活跃（单一事实源：phase.status='running'）。 */
export async function isAiRecordingActive(trajectoryId) {
  return trajectoryDao.hasRunningPhase(trajectoryId);
}
