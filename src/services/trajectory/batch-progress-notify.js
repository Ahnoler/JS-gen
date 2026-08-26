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
