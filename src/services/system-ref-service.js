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

/**
 * Validate a trajectory identifier and confirm that its row exists.
 * @param {number|string} trajectoryId candidate trajectory id
 * @returns {Promise<number>} normalized, existing trajectory id
 * @throws {AppError} when the id is invalid or the trajectory is missing
 */
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
 * Persist a captured network exchange as a system_ref_data record (Task 9).
 * Dedup key: ``method + ' ' + normalizedUrl`` — an existing record short-circuits
 * persistence. Entries are extracted from the top-level keys of the captured
 * requestBody (prefix ``req.``) and responseBody (prefix ``resp.``); values are
 * JSON-stringified and truncated to 500 chars. When a body is not an object
 * (text/plain body), the whole body degrades to a single entry (prefix
 * ``req.``/``resp.`` + '_body'); null/empty bodies are skipped.
 * @param {number|string} trajectoryId trajectory DB id the capture belongs to
 * @param {object} payload network_captured entry (url, normalizedUrl, method, requestBody, responseBody, responseStatus, capturedAt)
 * @returns {Promise<{persisted: boolean, id?: number, existingId?: number, description?: string}>} persistence result
 */
export async function persistCapturedInterface(trajectoryId, payload) {
  const tid = Number(trajectoryId);
  const data = (payload && typeof payload === 'object') ? payload : {};
  const method = String(data.method || '').toUpperCase();
  const normalizedUrl = String(data.normalizedUrl || '');
  if (!Number.isFinite(tid) || tid <= 0 || !normalizedUrl || !method) {
    return { persisted: false };
  }

  const existing = await systemRefDao.findByUrlPattern(normalizedUrl, method);
  if (existing) {
    return { persisted: false, existingId: existing.id };
  }

  const description = `${method} ${normalizedUrl}`;
  const entries = [];

  const pushEntries = (prefix, body) => {
    if (body == null) return;
    if (typeof body === 'object' && !Array.isArray(body)) {
      for (const key of Object.keys(body)) {
        entries.push({
          fieldKey: `${prefix}.${key}`,
          fieldValue: JSON.stringify(body[key])?.slice(0, 500),
          source: 'system_capture',
          verificationStatus: 'raw',
        });
      }
      return;
    }
    // Non-object body (text / array / number): degrade to one whole-body entry.
    entries.push({
      fieldKey: `${prefix}_body`,
      fieldValue: String(typeof body === 'string' ? body : JSON.stringify(body)).slice(0, 500),
      source: 'system_capture',
      verificationStatus: 'raw',
    });
  };
  pushEntries('req', data.requestBody);
  pushEntries('resp', data.responseBody);

  const recordId = `sref_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const id = await systemRefDao.save({
    trajectoryId: tid,
    recordId,
    source: 'system_capture',
    description,
    keyCount: entries.length,
    rawJson: JSON.stringify(data),
    entries,
  });
  return { persisted: true, id };
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
