/**
 * System reference values — captured from the target system, optionally verified
 * for reuse as fill-form references.
 *
 * NOT user 业务数据 (requirement text). Do not write extractBusinessEntriesFromRequirement
 * results here. Legacy business_data / business_data_entry remain separate.
 */
import * as systemRefDao from '../dao/system-ref-dao.js';
import * as trajectoryDao from '../dao/trajectory-dao.js';
import { AppError } from '../http/app-error.js';

async function assertTrajectory(trajectoryId) {
  const tid = Number(trajectoryId);
  if (!Number.isFinite(tid) || tid <= 0) {
    throw new AppError('Invalid trajectory id', { code: 'VALIDATION' });
  }
  const traj = await trajectoryDao.getById(tid);
  if (!traj) throw new AppError('Trajectory not found', { code: 'NOT_FOUND' });
  return tid;
}

/**
 * List headers (paginated).
 * @param {object} [query] pagination / filter query
 * @param {number} [query.page] page number (default 1)
 * @param {number} [query.pageSize] page size (default 20)
 * @param {number} [query.trajectoryId] filter by trajectory id
 * @param {string} [query.verificationStatus] filter by verification status
 * @returns {Promise<{ rows: Array<object>, total: number }>} paginated system_ref_data headers
 */
export async function listSystemRefData(query = {}) {
  return systemRefDao.list({
    page: +query.page || 1,
    pageSize: +query.pageSize || 20,
    trajectoryId: query.trajectoryId != null ? +query.trajectoryId : null,
    verificationStatus: query.verificationStatus || query.verification_status || null,
  });
}

/**
 * Get a single system_ref_data header by id.
 * @param {number} id system_ref_data DB id
 * @returns {Promise<object>} system_ref_data row; throws 404 if not found
 */
export async function getSystemRefData(id) {
  const row = await systemRefDao.getById(id);
  if (!row) {
    throw new AppError('System ref data not found', { code: 'NOT_FOUND' });
  }
  return row;
}

/**
 * Replace KV entries for a trajectory; returns { trajectoryId, entries, header }.
 * @param {number} trajectoryId trajectory DB id
 * @param {object} [body] request body
 * @param {Array<object>} [body.entries] KV entries to persist
 * @param {string} [body.source] capture source (default 'system_capture')
 * @param {string} [body.verificationStatus] verification status (default 'raw')
 * @param {string} [body.description] header description
 * @param {string} [body.sessionId] capturing session id
 * @returns {Promise<{ trajectoryId: number, entries: Array<object>, header: object|null }>} saved entries and header
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

/**
 * List system_ref entries for a trajectory, optionally filtered by verification status.
 * @param {number} trajectoryId trajectory DB id
 * @param {object} [query] filter query
 * @param {string} [query.verificationStatus] filter by verification status
 * @returns {Promise<{ trajectoryId: number, entries: Array<object> }>} entries for the trajectory
 */
export async function listTrajectorySystemRefEntries(trajectoryId, query = {}) {
  const tid = await assertTrajectory(trajectoryId);
  const verificationStatus = query.verificationStatus || query.verification_status || null;
  const entries = await systemRefDao.listEntriesByTrajectory(tid, { verificationStatus });
  return { trajectoryId: tid, entries };
}

/**
 * Delete a single system_ref_data header by id.
 * @param {number} id system_ref_data DB id
 * @returns {Promise<{ status: string, id: number, recordId: string }>} deletion result
 */
export async function deleteSystemRefData(id) {
  const row = await systemRefDao.getById(id);
  if (!row) throw new AppError('System ref data not found', { code: 'NOT_FOUND' });
  await systemRefDao.remove(row.id);
  return { status: 'deleted', id: row.id, recordId: row.recordId };
}

/**
 * Delete all system_ref_data headers and entries for a trajectory.
 * @param {number} trajectoryId trajectory DB id
 * @returns {Promise<{ status: string, trajectoryId: number, deletedHeaders: number }>} deletion result
 */
export async function deleteTrajectorySystemRef(trajectoryId) {
  const tid = await assertTrajectory(trajectoryId);
  const n = await systemRefDao.removeByTrajectory(tid);
  return { status: 'deleted', trajectoryId: tid, deletedHeaders: n };
}
