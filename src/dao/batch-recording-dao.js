/**
 * DAO for batch_recording_job / batch_recording_item.
 * Status transitions use compare-and-set (version / fromStatus) to avoid races.
 */
import { getDB } from '../../config/database.js';
import { toDbRow, fromDbRow, fromDbRows } from './helpers.js';
import {
  BATCH_ITEM_TERMINAL,
  BATCH_JOB_TERMINAL,
  BATCH_ITEM_RESUMABLE,
} from '../models/constants.js';

const JOB_TABLE = 'batch_recording_job';
const ITEM_TABLE = 'batch_recording_item';

function parseAnalysisJson(raw) {
  if (raw == null) return null;
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(String(raw));
  } catch {
    return null;
  }
}

function shapeItem(row) {
  const item = fromDbRow(row);
  if (!item) return null;
  item.analysisJson = parseAnalysisJson(item.analysisJson);
  return item;
}

function shapeItems(rows) {
  return (rows || []).map(shapeItem);
}

export async function createJob(job, items = [], trx = null) {
  const db = trx || getDB();
  const run = async (client) => {
    await client(JOB_TABLE).insert(toDbRow({
      id: job.id,
      idempotencyKey: job.idempotencyKey,
      requestHash: job.requestHash,
      functionId: job.functionId,
      systemAccountId: job.systemAccountId,
      model: job.model || '',
      originalFilename: job.originalFilename || '',
      name: job.name || '',
      paasUserId: job.paasUserId ?? null,
      mode: job.mode === 'draft' ? 'draft' : 'record',
      status: job.status || 'accepted',
      cancelRequestedAt: job.cancelRequestedAt ?? null,
      errorMessage: job.errorMessage ?? null,
    }));

    if (items.length) {
      const rows = items.map((it) => toDbRow({
        batchId: job.id,
        rowNumber: it.rowNumber,
        name: it.name || '',
        requirement: it.requirement || '',
        status: it.status || 'pending',
        analysisJson: it.analysisJson != null ? JSON.stringify(it.analysisJson) : null,
        trajectoryId: it.trajectoryId ?? null,
        errorCode: it.errorCode ?? null,
        errorMessage: it.errorMessage ?? null,
        attemptCount: it.attemptCount ?? 0,
        nextAttemptAt: it.nextAttemptAt ?? null,
        version: it.version ?? 1,
      }));
      for (let i = 0; i < rows.length; i += 100) {
        await client(ITEM_TABLE).insert(rows.slice(i, i + 100));
      }
    }
    return getJobById(job.id, client);
  };
  if (trx) return run(db);
  return getDB().transaction((t) => run(t));
}

export async function getJobById(id, trx = null) {
  const db = trx || getDB();
  const row = await db(JOB_TABLE).where({ id: String(id) }).first();
  return fromDbRow(row);
}

export async function getJobByIdempotencyKey(key, trx = null) {
  const db = trx || getDB();
  const row = await db(JOB_TABLE).where({ idempotency_key: String(key) }).first();
  return fromDbRow(row);
}

export async function updateJobStatus(id, fromStatuses, toStatus, extra = {}) {
  const statuses = Array.isArray(fromStatuses) ? fromStatuses : [fromStatuses];
  const patch = toDbRow({
    status: toStatus,
    updatedAt: new Date(),
    ...extra,
  });
  const n = await getDB()(JOB_TABLE)
    .where({ id: String(id) })
    .whereIn('status', statuses)
    .update(patch);
  return n > 0;
}

export async function forceUpdateJob(id, fields) {
  const patch = toDbRow({ ...fields, updatedAt: new Date() });
  await getDB()(JOB_TABLE).where({ id: String(id) }).update(patch);
  return getJobById(id);
}

export async function getItemById(id, trx = null) {
  const db = trx || getDB();
  const row = await db(ITEM_TABLE).where({ id: Number(id) }).first();
  return shapeItem(row);
}

export async function findItemByTrajectoryId(trajectoryId) {
  const tid = Number(trajectoryId);
  if (!Number.isFinite(tid) || tid <= 0) return null;
  const row = await getDB()(ITEM_TABLE)
    .where({ trajectory_id: tid })
    .orderBy('id', 'desc')
    .first();
  return shapeItem(row);
}

export async function listItemsByBatch(batchId, {
  page = 1,
  pageSize = 50,
  status = null,
} = {}) {
  const db = getDB();
  const q = db(ITEM_TABLE).where({ batch_id: String(batchId) });
  if (status) {
    const statuses = Array.isArray(status) ? status : String(status).split(',');
    q.whereIn('status', statuses.map((s) => String(s).trim()).filter(Boolean));
  }
  const [{ total }] = await q.clone().count('* as total');
  const rows = await q.clone()
    .orderBy('row_number', 'asc')
    .limit(pageSize)
    .offset((page - 1) * pageSize);
  return {
    rows: shapeItems(rows),
    total: Number(total) || 0,
    page,
    pageSize,
  };
}

export async function listAllItemsByBatch(batchId, trx = null) {
  const db = trx || getDB();
  const rows = await db(ITEM_TABLE)
    .where({ batch_id: String(batchId) })
    .orderBy('row_number', 'asc');
  return shapeItems(rows);
}

export async function countItemsByStatus(batchId, trx = null) {
  const db = trx || getDB();
  const rows = await db(ITEM_TABLE)
    .where({ batch_id: String(batchId) })
    .select('status')
    .count('* as cnt')
    .groupBy('status');
  const out = {};
  for (const r of rows) {
    out[r.status] = Number(r.cnt) || 0;
  }
  return out;
}

/**
 * CAS transition for an item. Optionally require version match.
 * @returns {Promise<object|null>} updated item or null if CAS lost
 */
export async function transitionItem(itemId, fromStatuses, toStatus, {
  version = null,
  workerToken = null,
  expectedWorkerToken = null,
  clearLease = false,
  extra = {},
  trx = null,
} = {}) {
  const db = trx || getDB();
  const statuses = Array.isArray(fromStatuses) ? fromStatuses : [fromStatuses];
  const q = db(ITEM_TABLE)
    .where({ id: Number(itemId) })
    .whereIn('status', statuses);
  if (version != null) q.andWhere({ version: Number(version) });
  if (expectedWorkerToken != null) q.andWhere({ worker_token: expectedWorkerToken });

  const patch = {
    status: toStatus,
    version: db.raw('version + 1'),
    updated_at: new Date(),
    ...toDbRow(extra),
  };
  if (workerToken != null) patch.worker_token = workerToken;
  if (clearLease) {
    patch.worker_token = null;
    patch.lease_expires_at = null;
  }

  const n = await q.update(patch);
  if (!n) return null;
  return getItemById(itemId, trx);
}

/**
 * Atomically claim the next FIFO item for analysis or recording.
 */
export async function claimNextItem({
  statuses,
  workerToken,
  leaseMs,
  jobStatuses = null,
  jobModes = null,
} = {}) {
  const db = getDB();
  return db.transaction(async (trx) => {
    let q = trx(ITEM_TABLE)
      .whereIn('status', statuses)
      .andWhere((builder) => {
        builder.whereNull('lease_expires_at')
          .orWhere('lease_expires_at', '<', new Date());
      })
      .andWhere((builder) => {
        builder.whereNull('next_attempt_at')
          .orWhere('next_attempt_at', '<=', new Date());
      })
      .orderBy('id', 'asc');

    // Prefer simple row lock; filter by job status after fetch if needed
    const candidates = await q.limit(20).forUpdate();
    let row = null;
    for (const cand of candidates) {
      if (jobStatuses?.length || jobModes?.length) {
        const job = await trx(JOB_TABLE).where({ id: cand.batch_id }).first();
        if (!job) continue;
        if (jobStatuses?.length && !jobStatuses.includes(job.status)) continue;
        if (jobModes?.length) {
          const mode = job.mode || 'record';
          if (!jobModes.includes(mode)) continue;
        }
      }
      row = cand;
      break;
    }
    if (!row) return null;

    const leaseExpires = new Date(Date.now() + Number(leaseMs || 600000));
    const n = await trx(ITEM_TABLE)
      .where({ id: row.id, version: row.version })
      .update({
        worker_token: workerToken,
        lease_expires_at: leaseExpires,
        version: Number(row.version) + 1,
        updated_at: new Date(),
        attempt_count: Number(row.attempt_count || 0) + 1,
      });
    if (!n) return null;
    return getItemById(row.id, trx);
  });
}

export async function bindTrajectoryAsDrafted(itemId, trajectoryId, {
  version,
  trx = null,
} = {}) {
  return transitionItem(itemId, ['analyzed'], 'drafted', {
    version,
    clearLease: true,
    extra: {
      trajectoryId: Number(trajectoryId),
      errorCode: null,
      errorMessage: null,
    },
    trx,
  });
}

export async function bindTrajectoryAndQueue(itemId, trajectoryId, {
  version,
  analysisJson = undefined,
  trx = null,
} = {}) {
  const extra = {
    trajectoryId: Number(trajectoryId),
  };
  if (analysisJson !== undefined) {
    extra.analysisJson = analysisJson == null ? null : JSON.stringify(analysisJson);
  }
  return transitionItem(itemId, ['analyzed'], 'queued', {
    version,
    clearLease: true,
    extra,
    trx,
  });
}

export async function markItemWaiting(itemId, fromStatuses, { version, errorMessage = null } = {}) {
  return transitionItem(itemId, fromStatuses, 'waiting_executor', {
    version,
    clearLease: true,
    extra: {
      errorCode: 'WAITING_EXECUTOR',
      errorMessage: errorMessage || 'Waiting for executor capacity',
      nextAttemptAt: new Date(Date.now() + 1000),
    },
  });
}

export async function markItemFailed(itemId, fromStatuses, {
  version = null,
  errorCode = 'FAILED',
  errorMessage = '',
  expectedWorkerToken = null,
} = {}) {
  return transitionItem(itemId, fromStatuses, 'failed', {
    version,
    expectedWorkerToken,
    clearLease: true,
    extra: { errorCode, errorMessage: String(errorMessage || '').slice(0, 4000) },
  });
}

export async function markItemCancelled(itemId, fromStatuses, {
  version = null,
  errorMessage = 'Cancelled',
} = {}) {
  return transitionItem(itemId, fromStatuses, 'cancelled', {
    version,
    clearLease: true,
    extra: {
      errorCode: 'CANCELLED',
      errorMessage,
      workerToken: null,
      leaseExpiresAt: null,
    },
  });
}

export async function markItemRecorded(itemId, {
  version = null,
  expectedWorkerToken = null,
} = {}) {
  return transitionItem(itemId, ['recording'], 'recorded', {
    version,
    expectedWorkerToken,
    clearLease: true,
    extra: {
      errorCode: null,
      errorMessage: null,
    },
  });
}

export async function cancelOpenItems(batchId) {
  const open = [
    'pending',
    'analyzing',
    'analyzed',
    'queued',
    'waiting_executor',
  ];
  const n = await getDB()(ITEM_TABLE)
    .where({ batch_id: String(batchId) })
    .whereIn('status', open)
    .update(toDbRow({
      status: 'cancelled',
      errorCode: 'CANCELLED',
      errorMessage: 'Cancelled before start',
      workerToken: null,
      leaseExpiresAt: null,
      updatedAt: new Date(),
    }));
  // bump versions individually is expensive; bulk bump
  await getDB()(ITEM_TABLE)
    .where({ batch_id: String(batchId), status: 'cancelled' })
    .andWhere('error_code', 'CANCELLED')
    .update({ version: getDB().raw('version + 1') });
  return n;
}

export async function listJobsNeedingRecovery() {
  const db = getDB();
  const jobs = await db(JOB_TABLE)
    .whereNotIn('status', [...BATCH_JOB_TERMINAL])
    .orderBy('created_at', 'asc');
  return fromDbRows(jobs);
}

export async function listItemsNeedingRecovery() {
  const db = getDB();
  const rows = await db(ITEM_TABLE)
    .whereIn('status', [
      ...BATCH_ITEM_RESUMABLE,
      'preparing',
      'recording',
    ])
    .orderBy('id', 'asc');
  return shapeItems(rows);
}

export async function listInFlightItemsByBatch(batchId) {
  const rows = await getDB()(ITEM_TABLE)
    .where({ batch_id: String(batchId) })
    .whereIn('status', ['preparing', 'recording', 'analyzing'])
    .orderBy('id', 'asc');
  return shapeItems(rows);
}

export async function summarizeJob(batchId) {
  const counts = await countItemsByStatus(batchId);
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const accepted = total - (counts.rejected || 0);
  return {
    total,
    accepted,
    rejected: counts.rejected || 0,
    pending: counts.pending || 0,
    analyzing: counts.analyzing || 0,
    analyzed: counts.analyzed || 0,
    queued: counts.queued || 0,
    waitingExecutor: counts.waiting_executor || 0,
    preparing: counts.preparing || 0,
    recording: counts.recording || 0,
    recorded: counts.recorded || 0,
    drafted: counts.drafted || 0,
    failed: counts.failed || 0,
    cancelled: counts.cancelled || 0,
  };
}

export function deriveJobTerminalStatus(summary, { cancelled = false } = {}) {
  if (cancelled) return 'cancelled';
  const effective = (summary.accepted || 0) - (summary.cancelled || 0);
  const success = (summary.recorded || 0) + (summary.drafted || 0);
  const failed = summary.failed || 0;
  const rejected = summary.rejected || 0;
  const unfinished = (summary.pending || 0)
    + (summary.analyzing || 0)
    + (summary.analyzed || 0)
    + (summary.queued || 0)
    + (summary.waitingExecutor || 0)
    + (summary.preparing || 0)
    + (summary.recording || 0);
  if (unfinished > 0) return null;
  if (success > 0 && (failed > 0 || rejected > 0 || (summary.cancelled || 0) > 0)) {
    return 'completed_with_errors';
  }
  if (success > 0 && failed === 0 && rejected === 0) return 'completed';
  if (success === 0 && (failed > 0 || effective === 0)) return 'failed';
  if (success === 0 && (summary.cancelled || 0) > 0 && failed === 0 && rejected === 0) {
    return 'cancelled';
  }
  return 'completed_with_errors';
}

/**
 * 任务名候选（搜索下拉用）：按 functionId + 关键字模糊去重，最近创建优先。
 * 仅返回已产生交易轨迹的任务（EXISTS trajectory.batch_job_id）——空任务不进下拉。
 * @param {{ functionId?: number, keyword?: string, paasUserId?: string|null, limit?: number }} opts
 * @returns {Promise<string[]>}
 */
export async function listDistinctNames({ functionId, keyword = '', paasUserId = null, limit = 20 } = {}) {
  const db = getDB();
  const q = db(JOB_TABLE)
    .select('name')
    .whereNotNull('name')
    .where('name', '!=', '')
    .whereExists(
      db.select(1).from('trajectory')
        .whereRaw('trajectory.batch_job_id = batch_recording_job.id'),
    )
    .orderBy('created_at', 'desc');
  if (functionId != null && functionId !== '') q.where('function_id', Number(functionId));
  if (paasUserId) q.where('paas_user_id', paasUserId);
  const kw = String(keyword || '').trim();
  if (kw) q.where('name', 'like', `%${kw}%`);
  q.limit(Math.min(100, Math.max(1, Number(limit) || 20)));
  const rows = await q;
  const seen = new Set();
  const names = [];
  for (const r of rows) {
    const n = String(r.name || '').trim();
    if (n && !seen.has(n)) {
      seen.add(n);
      names.push(n);
    }
  }
  return names;
}

export { BATCH_ITEM_TERMINAL, BATCH_JOB_TERMINAL, JOB_TABLE, ITEM_TABLE };
