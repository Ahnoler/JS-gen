import * as batchDao from '../../dao/batch-recording-dao.js';

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
