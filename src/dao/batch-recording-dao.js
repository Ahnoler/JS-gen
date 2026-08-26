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

/**
 * Create a batch job with its items (transactional) and return the created job entity.
 * @param {object} job CamelCase job fields (id/idempotencyKey/functionId required)
 * @param {Array<object>} [items] Item rows to insert
 * @param {import('knex').Knex|null} [trx] Optional transaction
 * @returns {Promise<object|null>} Created job entity or null if creation failed
 */
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

/**
 * Fetch a batch job by ID.
 * @param {string} id Job ID
 * @param {import('knex').Knex|null} [trx] Optional transaction
 * @returns {Promise<object|null>} Job entity or null when not found
 */
export async function getJobById(id, trx = null) {
  const db = trx || getDB();
  const row = await db(JOB_TABLE).where({ id: String(id) }).first();
  return fromDbRow(row);
}

/**
 * Fetch a batch job by idempotency key.
 * @param {string} key Idempotency key
 * @param {import('knex').Knex|null} [trx] Optional transaction
 * @returns {Promise<object|null>} Job entity or null when not found
 */
export async function getJobByIdempotencyKey(key, trx = null) {
  const db = trx || getDB();
  const row = await db(JOB_TABLE).where({ idempotency_key: String(key) }).first();
  return fromDbRow(row);
}

/**
 * CAS job status transition: update only when current status is in fromStatuses.
 * @param {string} id Job ID
 * @param {string|string[]} fromStatuses Allowed current statuses
 * @param {string} toStatus Target status
 * @param {object} [extra] Additional fields to patch
 * @returns {Promise<boolean>} True if the transition applied
 */
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

/**
 * Force-update a job by ID (no status guard) and return the updated entity.
 * @param {string} id Job ID
 * @param {object} fields Partial camelCase job fields
 * @returns {Promise<object|null>} Updated job entity or null if not found
 */
export async function forceUpdateJob(id, fields) {
  const patch = toDbRow({ ...fields, updatedAt: new Date() });
  await getDB()(JOB_TABLE).where({ id: String(id) }).update(patch);
  return getJobById(id);
}

/**
 * Fetch a batch item by ID, parsing analysisJson.
 * @param {number} id Item ID
 * @param {import('knex').Knex|null} [trx] Optional transaction
 * @returns {Promise<object|null>} Item entity or null when not found
 */
export async function getItemById(id, trx = null) {
  const db = trx || getDB();
  const row = await db(ITEM_TABLE).where({ id: Number(id) }).first();
  return shapeItem(row);
}

/**
 * Find the latest batch item bound to a trajectory ID.
 * @param {number} trajectoryId Trajectory ID
 * @returns {Promise<object|null>} Item entity or null when not found
 */
export async function findItemByTrajectoryId(trajectoryId) {
  const tid = Number(trajectoryId);
  if (!Number.isFinite(tid) || tid <= 0) return null;
  const row = await getDB()(ITEM_TABLE)
    .where({ trajectory_id: tid })
    .orderBy('id', 'desc')
    .first();
  return shapeItem(row);
}

/**
 * Paginated list of items in a batch, optionally filtered by status.
 * @param {string} batchId Job ID
 * @param {object} [opts] Optional pagination and filter parameters
 * @param {number} [opts.page] Page number (1-based)
 * @param {number} [opts.pageSize] Number of items per page
 * @param {string|string[]|null} [opts.status] Status filter
 * @returns {Promise<{ rows: Array<object>, total: number, page: number, pageSize: number }>} Paginated item list
 */
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

/**
 * List all items in a batch ordered by row_number (no pagination).
 * @param {string} batchId Job ID
 * @param {import('knex').Knex|null} [trx] Optional transaction
 * @returns {Promise<Array<object>>} Item entities
 */
export async function listAllItemsByBatch(batchId, trx = null) {
  const db = trx || getDB();
  const rows = await db(ITEM_TABLE)
    .where({ batch_id: String(batchId) })
    .orderBy('row_number', 'asc');
  return shapeItems(rows);
}

/**
 * Count items grouped by status within a batch.
 * @param {string} batchId Job ID
 * @param {import('knex').Knex|null} [trx] Optional transaction
 * @returns {Promise<Record<string, number>>} Status to count map
 */
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
 * @param {number} itemId Item ID
 * @param {string|string[]} fromStatuses Allowed current statuses
 * @param {string} toStatus Target status
 * @param {object} [opts] Optional transition parameters
 * @param {number|null} [opts.version] Required version for CAS
 * @param {string|null} [opts.workerToken] Worker token to set
 * @param {string|null} [opts.expectedWorkerToken] Required current worker token
 * @param {boolean} [opts.clearLease] Clear worker_token/lease_expires_at
 * @param {object} [opts.extra] Additional fields to patch
 * @param {import('knex').Knex|null} [opts.trx] Optional transaction
 * @returns {Promise<object|null>} Updated item or null if CAS lost
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
 * @param {object} opts Claim options
 * @param {string[]} opts.statuses Eligible item statuses
 * @param {string} opts.workerToken Worker token to assign
 * @param {number} opts.leaseMs Lease duration in milliseconds
 * @param {string[]|null} [opts.jobStatuses] Filter by job status
 * @param {string[]|null} [opts.jobModes] Filter by job mode
 * @returns {Promise<object|null>} Claimed item entity or null when none available
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

/**
 * Transition an analyzed item to 'drafted', binding a trajectory (clears lease, clears error).
 * @param {number} itemId Item ID
 * @param {number} trajectoryId Trajectory to bind
 * @param {object} [opts] Optional transition parameters
 * @param {number} [opts.version] Required version for CAS
 * @param {import('knex').Knex|null} [opts.trx] Optional transaction
 * @returns {Promise<object|null>} Updated item or null if CAS lost
 */
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

/**
 * Transition an analyzed item to 'queued', binding a trajectory and optionally updating analysisJson.
 * @param {number} itemId Item ID
 * @param {number} trajectoryId Trajectory to bind
 * @param {object} [opts] Optional transition parameters
 * @param {number} [opts.version] Required version for CAS
 * @param {object} [opts.analysisJson] Optional analysis payload to store
 * @param {import('knex').Knex|null} [opts.trx] Optional transaction
 * @returns {Promise<object|null>} Updated item or null if CAS lost
 */
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

/**
 * Transition an item to 'waiting_executor' with a short next-attempt delay.
 * @param {number} itemId Item ID
 * @param {string|string[]} fromStatuses Allowed current statuses
 * @param {object} [opts] Optional transition parameters
 * @param {number} [opts.version] Required version for CAS
 * @param {string|null} [opts.errorMessage] Error message
 * @returns {Promise<object|null>} Updated item or null if CAS lost
 */
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

/**
 * Transition an item to 'failed', recording error details and clearing the lease.
 * @param {number} itemId Item ID
 * @param {string|string[]} fromStatuses Allowed current statuses
 * @param {object} [opts] Optional transition parameters
 * @param {number|null} [opts.version] Required version for CAS
 * @param {string} [opts.errorCode] Error code
 * @param {string} [opts.errorMessage] Error message (truncated to 4000 chars)
 * @param {string|null} [opts.expectedWorkerToken] Required current worker token
 * @returns {Promise<object|null>} Updated item or null if CAS lost
 */
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

/**
 * Transition an item to 'cancelled', clearing lease and worker token.
 * @param {number} itemId Item ID
 * @param {string|string[]} fromStatuses Allowed current statuses
 * @param {object} [opts] Optional transition parameters
 * @param {number|null} [opts.version] Required version for CAS
 * @param {string} [opts.errorMessage] Cancel reason
 * @returns {Promise<object|null>} Updated item or null if CAS lost
 */
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

/**
 * Transition an item to 'recorded'.
 * @param {number} itemId Item ID
 * @param {object} [opts] Optional transition parameters
 * @param {number|null} [opts.version] Required version for CAS
 * @param {string|null} [opts.expectedWorkerToken] Required current worker token
 * @returns {Promise<object|null>} Updated item or null if CAS lost
 */
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

/**
 * Cancel all open items in a batch.
 * @param {string} batchId Job ID
 * @returns {Promise<number>} Number of cancelled items
 */
export async function cancelOpenItems(batchId) {  const open = [
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

/**
 * List jobs that need recovery (not in terminal status).
 * @returns {Promise<Array<object>>} Array of jobs needing recovery
 */
export async function listJobsNeedingRecovery() {
  const db = getDB();
  const jobs = await db(JOB_TABLE)
    .whereNotIn('status', [...BATCH_JOB_TERMINAL])
    .orderBy('created_at', 'asc');
  return fromDbRows(jobs);
}

/**
 * List items that need recovery (resumable or in progress statuses).
 * @returns {Promise<Array<object>>} Array of items needing recovery
 */
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

/**
 * List in-flight items (preparing, recording, analyzing) in a batch.
 * @param {string} batchId Job ID
 * @returns {Promise<Array<object>>} Array of in-flight items
 */
export async function listInFlightItemsByBatch(batchId) {
  const rows = await getDB()(ITEM_TABLE)
    .where({ batch_id: String(batchId) })
    .whereIn('status', ['preparing', 'recording', 'analyzing'])
    .orderBy('id', 'asc');
  return shapeItems(rows);
}

/**
 * Summarize job statistics by counting items by status.
 * @param {string} batchId Job ID
 * @returns {Promise<object>} Job summary with status counts
 */
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

/**
 * Derive terminal status for a job based on item summary.
 * @param {object} summary Job summary with status counts
 * @param {object} [opts] Optional parameters
 * @param {boolean} [opts.cancelled] Whether the job was cancelled
 * @returns {string} Terminal status ('completed', 'completed_with_errors', 'failed', 'cancelled')
 */
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
 * List distinct job names for dropdown search.
 * Filters by functionId + keyword, deduplicates, orders by creation time.
 * Only returns jobs that have produced trajectories (EXISTS trajectory.batch_job_id) — empty jobs excluded.
 * @param {object} [opts] Optional filter parameters
 * @param {number} [opts.functionId] Filter by function ID
 * @param {string} [opts.keyword] Search keyword
 * @param {string|null} [opts.paasUserId] Filter by PaaS user ID
 * @param {number} [opts.limit] Maximum number of results
 * @returns {Promise<string[]>} Array of distinct job names
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
