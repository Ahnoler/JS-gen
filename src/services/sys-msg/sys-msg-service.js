import * as systemDao from '../../dao/system-dao.js';
import * as dataDao from '../../dao/sys-dict-data-dao.js';
import * as msgDao from '../../dao/sys-msg-dao.js';
import {
  MSG_TYPE_BATCH_IMPORT,
  MSG_TITLE_BATCH_IMPORT,
  SOURCE_TYPE_BATCH_IMPORT,
  MSG_STATUS_UNREAD,
  DICT_TYPE_SYS_MSG,
  composeBatchImportMsgContent,
  batchImportLinkUrl,
  shapeSysMsgApi,
} from './sys-msg-compose.js';

function httpError(status, message) {
  const err = new Error(message);
  err.statusCode = status;
  return err;
}

async function resolveTitle() {
  try {
    const rows = await dataDao.listByTypeActive(DICT_TYPE_SYS_MSG);
    const hit = (rows || []).find((r) => String(r.dictValue) === String(MSG_TYPE_BATCH_IMPORT));
    const label = String(hit?.dictLabel || '').trim();
    if (label) return label;
  } catch { /* dict missing → fallback */ }
  return MSG_TITLE_BATCH_IMPORT;
}

async function resolveFunctionName(functionId) {
  const id = Number(functionId);
  if (!Number.isFinite(id) || id <= 0) return { name: '', id: null };
  try {
    const node = await systemDao.getById(id);
    return { name: String(node?.name || '').trim(), id };
  } catch {
    return { name: '', id };
  }
}

/**
 * Insert a system message for a completed batch import job (idempotent by sourceId).
 * @param {object} job batch job row (id, functionId, originalFilename, status)
 * @param {object} [summary] job summary counts
 * @returns {Promise<{ id: number|null, duplicate: boolean }>} insert result
 */
export async function insertSysMsgFromBatchJob(job, summary = {}) {
  const batchId = String(job?.id || '');
  if (!batchId) return { id: null, duplicate: false };
  const { name: functionName, id: belongItemId } = await resolveFunctionName(job.functionId);
  const title = await resolveTitle();
  const msgContent = composeBatchImportMsgContent({
    functionName,
    filename: job.originalFilename || '',
    jobStatus: job.status,
    summary,
  });
  return msgDao.insertIgnoreDuplicate({
    msgTitle: title,
    msgContent,
    msgType: MSG_TYPE_BATCH_IMPORT,
    msgStatus: MSG_STATUS_UNREAD,
    linkUrl: batchImportLinkUrl(batchId),
    belongItemName: functionName,
    belongItemId,
    sourceType: SOURCE_TYPE_BATCH_IMPORT,
    sourceId: batchId,
    createBy: '系统',
  });
}

async function typeLabelMap() {
  try {
    const rows = await dataDao.listByTypeActive(DICT_TYPE_SYS_MSG);
    const map = {};
    for (const r of rows || []) map[String(r.dictValue)] = r.dictLabel;
    return map;
  } catch {
    return {};
  }
}

/**
 * List system messages with pagination.
 * @param {object} [root0] pagination options
 * @param {number} [root0.pageNum] page number (default 1)
 * @param {number} [root0.pageSize] page size (default 20)
 * @returns {Promise<{ rows: Array<object>, total: number }>} paginated messages with type labels
 */
export async function listMessages({ pageNum = 1, pageSize = 20 } = {}) {
  const { rows, total } = await msgDao.list({ pageNum, pageSize });
  const labels = await typeLabelMap();
  return {
    rows: rows.map((r) => shapeSysMsgApi(r, { msgTypeLabel: labels[String(r.msgType)] })),
    total,
  };
}

/**
 * Count unread system messages.
 * @returns {Promise<{ count: number }>} unread count
 */
export async function getUnreadCount() {
  const count = await msgDao.countUnread();
  return { count };
}

/**
 * Mark a single system message as read.
 * @param {number} id message DB id
 * @returns {Promise<{ success: boolean }>} result; throws 404 if not found
 */
export async function markMessageRead(id) {
  const row = await msgDao.markRead(id);
  if (!row) throw httpError(404, 'Message not found');
  return { success: true };
}

/**
 * Mark all system messages as read.
 * @returns {Promise<{ success: boolean }>} result
 */
export async function markAllMessagesRead() {
  await msgDao.markAllRead();
  return { success: true };
}
