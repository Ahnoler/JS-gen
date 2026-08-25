/**
 * System reference values — captured from the target system, optionally verified
 * for reuse as fill-form references.
 *
 * NOT user 业务数据 (requirement text). Do not write extractBusinessEntriesFromRequirement
 * results here. Legacy business_data / business_data_entry remain separate.
 */
import * as systemRefDao from '../dao/system-ref-dao.js';
import * as trajectoryDao from '../dao/trajectory-dao.js';

function trajError(message, statusCode) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

async function assertTrajectory(trajectoryId) {
  const tid = Number(trajectoryId);
  if (!Number.isFinite(tid) || tid <= 0) throw trajError('Invalid trajectory id', 400);
  const traj = await trajectoryDao.getById(tid);
  if (!traj) throw trajError('Trajectory not found', 404);
  return tid;
}

/**
 * List headers (paginated).
 */
export async function listSystemRefData(query = {}) {
  return systemRefDao.list({
    page: +query.page || 1,
    pageSize: +query.pageSize || 20,
    trajectoryId: query.trajectoryId != null ? +query.trajectoryId : null,
    verificationStatus: query.verificationStatus || query.verification_status || null,
  });
}

export async function getSystemRefData(id) {
  const row = await systemRefDao.getById(id);
  if (!row) {
    throw trajError('System ref data not found', 404);
  }
  return row;
}

/**
 * Replace KV entries for a trajectory; returns { trajectoryId, entries, header }.
 */
export async function replaceTrajectorySystemRefEntries(trajectoryId, body = {}) {
  const tid = await assertTrajectory(trajectoryId);
  const entries = body.entries ?? body.systemRefEntries ?? body.caseEntries ?? [];
  const source = body.source || 'system_capture';
  const verificationStatus = body.verificationStatus ?? body.verification_status ?? 'raw';
  const description = body.description || '';
  const sessionId = body.sessionId || body.session_id || '';

  const saved = await systemRefDao.replaceEntriesForTrajectory(tid, entries, {
    source,
    verificationStatus,
    description,
    sessionId,
  });

  const headers = await systemRefDao.list({ trajectoryId: tid, page: 1, pageSize: 1 });
  return {
    trajectoryId: tid,
    entries: saved,
    header: headers.rows[0] || null,
  };
}

export async function listTrajectorySystemRefEntries(trajectoryId, query = {}) {
  const tid = await assertTrajectory(trajectoryId);
  const verificationStatus = query.verificationStatus || query.verification_status || null;
  const entries = await systemRefDao.listEntriesByTrajectory(tid, { verificationStatus });
  return { trajectoryId: tid, entries };
}

export async function deleteSystemRefData(id) {
  const row = await systemRefDao.getById(id);
  if (!row) throw trajError('System ref data not found', 404);
  await systemRefDao.remove(row.id);
  return { status: 'deleted', id: row.id, recordId: row.recordId };
}

export async function deleteTrajectorySystemRef(trajectoryId) {
  const tid = await assertTrajectory(trajectoryId);
  const n = await systemRefDao.removeByTrajectory(tid);
  return { status: 'deleted', trajectoryId: tid, deletedHeaders: n };
}
