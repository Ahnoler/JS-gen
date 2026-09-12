/**
 * 用于交易生命周期更新的批处理进度通知辅助函数。本模块按需解析交易所属的批处理项，
 * 使核心批处理服务无需耦合仅知晓交易 ID 的调用方。
 */
import * as batchDao from '../../dao/batch-recording-dao.js';

/**
 * Notify batch progress for a trajectory by looking up its batch item and emitting progress.
 * @param {number} trajectoryId trajectory DB id
 * @returns {Promise<void>} resolves when progress is emitted (or skipped if no batch item)
 */
export async function notifyBatchProgressForTrajectory(trajectoryId) {
  try {
    const item = await batchDao.findItemByTrajectoryId(trajectoryId);
    if (!item) return;
    const { emitProgress } = await import('./trajectory-batch-service.js');
    await emitProgress(item.batchId, item);
  } catch (err) {
    console.warn('[batch] notify progress skipped:', err?.message || err);
  }
}
