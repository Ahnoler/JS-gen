import { getDB } from '../../config/database.js';
import { toDbRow, fromDbRow, fromDbRows } from './helpers.js';
import {
  TRAJECTORY_RECORD_STATUSES,
  PERSISTENT_RECORD_STATUSES,
  isPersistentRecordStatus,
  resolvePostRecordingStatus,
} from '../models/constants.js';

const TABLE = 'trajectory';

const ALLOWED_RECORD_STATUS = new Set(TRAJECTORY_RECORD_STATUSES);

/**
 * 批量统计多轨迹的阶段数（一次 GROUP BY 查询；1+N 修复）。
 * @param {Array<number|string>} trajectoryIds 轨迹 id 数组
 * @returns {Promise<Map<number, number>>} 轨迹 id → 阶段数（无阶段的 id 不在 Map 中）
 */
async function countPhasesByTrajectoryIds(trajectoryIds) {
  const nums = [...new Set((trajectoryIds || []).map((x) => Number(x)).filter((n) => Number.isFinite(n) && n > 0))];
  const counts = new Map();
  if (!nums.length) return counts;
  const rows = await getDB()('trajectory_phase')
    .select('trajectory_id')
    .whereIn('trajectory_id', nums)
    .groupBy('trajectory_id')
    .count('* as phases');
  for (const row of rows) counts.set(Number(row.trajectory_id), Number(row.phases) || 0);
  return counts;
}

/**
 * Normalize query recordStatus / status into a unique list of valid enums.
 * Accepts string, comma-separated string, or array.
 * @param {string|string[]|null} raw Input record status string or array
 * @returns {string[]|null} null = no filter
 */
export function parseRecordStatuses(raw) {
  if (raw == null || raw === '') return null;
  const parts = Array.isArray(raw)
    ? raw.flatMap((s) => String(s).split(','))
    : String(raw).split(',');
  const statuses = [...new Set(
    parts.map((s) => s.trim()).filter((s) => s && ALLOWED_RECORD_STATUS.has(s)),
  )];
  return statuses.length ? statuses : null;
}

/**
 * Get record statuses that were requested but are not valid enums.
 * @param {string|string[]|null} raw Input record status string or array
 * @returns {string[]} statuses that were requested but not in the enum
 */
export function invalidRecordStatuses(raw) {
  if (raw == null || raw === '') return [];
  const parts = Array.isArray(raw)
    ? raw.flatMap((s) => String(s).split(','))
    : String(raw).split(',');
  return [...new Set(
    parts.map((s) => s.trim()).filter((s) => s && !ALLOWED_RECORD_STATUS.has(s)),
  )];
}

function applyListFilters(query, { keyword, recordStatus, isExport } = {}) {
  if (keyword && String(keyword).trim()) {
    const kw = `%${String(keyword).trim()}%`;
    query.where(function () {
      this.where('t.name', 'like', kw).orWhere('t.task', 'like', kw);
    });
  }
  const statuses = parseRecordStatuses(recordStatus);
  if (statuses) {
    query.whereIn('t.record_status', statuses);
  }
  if (isExport === 0 || isExport === 1) {
    query.where('t.is_export', isExport);
  }
  return query;
}

function applyBatchTaskNameFilter(query, batchTaskName) {
  const v = batchTaskName == null ? '' : String(batchTaskName).trim();
  if (v) {
    query.where('bj.name', 'like', `%${v}%`);
  }
  return query;
}

const RECORD_STATUS_STATS = ['draft', 'recording', 'failed', 'recorded', 'completed'];

/**
 * Get statistics for trajectory record statuses (draft, recording, failed, recorded, completed).
 * Filters match the same criteria as list queries (functionId/keyword/recordStatus/batchTaskName).
 * @param {object} [options] Optional filter parameters
 * @param {number|null} [options.functionId] Filter by function ID
 * @param {string|null} [options.keyword] Search keyword for name or task
 * @param {string|string[]|null} [options.recordStatus] Filter by record status
 * @param {string|null} [options.batchTaskName] Filter by batch task name
 * @param {number|null} [options.paasUserId] Filter by PaaS user ID
 * @param {number|null} [options.isExport] Filter by export flag (0 = not exported, 1 = exported, null = all)
 * @returns {Promise<{ total: number, draft: number, recording: number, failed: number, recorded: number, completed: number }>} 各状态统计
 */
export async function countByRecordStatus({ functionId = null, keyword = null, recordStatus = null, batchTaskName = null, paasUserId = null, isExport = null } = {}) {
  const db = getDB();
  const base = db({ t: TABLE })
    .leftJoin({ bj: 'batch_recording_job' }, 'bj.id', 't.batch_job_id');
  if (functionId != null && Number.isFinite(Number(functionId))) {
    base.where('t.function_id', Number(functionId));
  }
  applyListFilters(base, { keyword, recordStatus, isExport });
  applyBatchTaskNameFilter(base, batchTaskName);
  if (paasUserId) base.where('t.paas_user_id', paasUserId);
  const rows = await base
    .select('t.record_status as recordStatus')
    .count('* as cnt')
    .groupBy('t.record_status');
  const stats = { total: 0 };
  for (const s of RECORD_STATUS_STATS) stats[s] = 0;
  for (const r of rows) {
    const key = String(r.recordStatus);
    const n = Number(r.cnt) || 0;
    stats.total += n;
    if (key in stats) stats[key] = n;
  }
  return stats;
}

const SORT_COL_MAP = {
  created_at: 't.created_at',
  createdAt: 't.created_at',
  updated_at: 't.updated_at',
  updatedAt: 't.updated_at',
  name: 't.name',
  step_count: 't.step_count',
  stepCount: 't.step_count',
  phase_count: 't.phase_count',
  phaseCount: 't.phase_count',
  record_status: 't.record_status',
  recordStatus: 't.record_status',
};

/**
 * Insert a new trajectory row into the database.
 * When `trx` is provided, uses that transaction and does not commit.
 * @param {object} trajectory Trajectory data to save
 * @param {import('knex').Knex|null} [trx] Optional transaction object
 * @returns {Promise<number>} The numeric primary key of the inserted row
 */
export async function save(trajectory, trx = null) {
  const run = async (client) => {
    const [id] = await client(TABLE).insert(toDbRow({
      name: trajectory.name ?? '',
      trajectoryLog: trajectory.trajectoryLog ?? null,
      task: trajectory.task,
      model: trajectory.model,
      stepCount: trajectory.stepCount,
      phaseCount: trajectory.phaseCount ?? 0,
      isDone: trajectory.isDone,
      isSuccessful: trajectory.isSuccessful,
      url: trajectory.url,
      functionId: trajectory.functionId ?? null,
      systemAccountId: trajectory.systemAccountId ?? null,
      remoteSessionId: trajectory.remoteSessionId ?? null,
      batchJobId: trajectory.batchJobId ?? null,
      paasUserId: trajectory.paasUserId ?? null,
      recordStatus: trajectory.recordStatus ?? 'draft',
      persistentRecordStatus: trajectory.persistentRecordStatus
        ?? (isPersistentRecordStatus(trajectory.recordStatus) ? trajectory.recordStatus : 'draft'),
    }));

    if (trajectory.steps?.length) {
      await insertStepRows(client, id, trajectory.steps);
    }
    return id;
  };
  if (trx) return run(trx);
  return getDB().transaction((t) => run(t));
}

async function insertStepRows(trx, trajectoryDbId, steps, stepNumberOffset = 0) {
  const stepRows = steps.map((s, i) => ({
    trajectory_id: trajectoryDbId,
    step_number: s.stepNumber || stepNumberOffset + i + 1,
    phase_number: s.phaseNumber ?? 0,
    action_index: s.actionIndex ?? 0,
    action_type: (s.actionType ?? s.action) || '',
    params_json: s.paramsJson ?? s.params ?? null,
    element_json: s.elementJson ?? s.element ?? null,
    success: s.success ?? null,
    error: s.error ?? null,
    extracted_content: s.extractedContent ?? s.result ?? '',
    trajectory_phase_id: s.trajectoryPhaseId ?? null,
    source: s.source ?? 'agent',
  }));
  for (let i = 0; i < stepRows.length; i += 100) {
    await trx('trajectory_step').insert(stepRows.slice(i, i + 100));
  }
  return stepRows.length;
}

/**
 * Append steps to an existing trajectory by numeric primary key.
 * @param {number} trajectoryDbId The trajectory ID to append steps to
 * @param {Array<object>} steps Array of step objects to append
 * @param {object} [options] Optional configuration
 * @param {number} [options.stepNumberOffset] Offset to start step numbering from
 * @returns {Promise<number>} Number of steps appended
 */
export async function appendSteps(trajectoryDbId, steps, { stepNumberOffset = 0 } = {}) {
  if (!steps?.length) return 0;
  const db = getDB();
  return db.transaction(async (trx) => {
    const count = await insertStepRows(trx, trajectoryDbId, steps, stepNumberOffset);
    await markExportDirty(trajectoryDbId, trx);
    return count;
  });
}

/**
 * Update trajectory metadata fields.
 * @param {number} trajectoryDbId The trajectory ID to update
 * @param {object} fields Fields to update
 * @param {import('knex').Knex|null} [trx] Optional transaction object
 * @returns {Promise<number>} Number of affected rows
 */
export async function updateMeta(trajectoryDbId, fields, trx = null) {
  const patch = toDbRow(fields);
  if (!Object.keys(patch).length) return 0;
  const db = trx || getDB();
  return db(TABLE).where({ id: trajectoryDbId }).update(patch);
}

/**
 * Mark a trajectory as not exported (dirty state).
 * @param {number} trajectoryId The trajectory ID to mark as dirty
 * @param {import('knex').Knex|null} [trx] Optional transaction object
 * @returns {Promise<number>} Number of affected rows
 */
export async function markExportDirty(trajectoryId, trx = null) {
  const id = Number(trajectoryId);
  if (!Number.isFinite(id) || id <= 0) return 0;
  const db = trx || getDB();
  return db(TABLE).where({ id }).update({ is_export: 0 });
}

/**
 * Mark a trajectory as exported.
 * @param {number} trajectoryId The trajectory ID to mark as exported
 * @param {import('knex').Knex|null} [trx] Optional transaction object
 * @returns {Promise<number>} Number of affected rows
 */
export async function markExported(trajectoryId, trx = null) {
  const id = Number(trajectoryId);
  if (!Number.isFinite(id) || id <= 0) return 0;
  const db = trx || getDB();
  return db(TABLE).where({ id }).update({ is_export: 1 });
}

/**
 * Clear trajectory.remote_session_id rows pointing at a remote_session.
 * Used for exclusive mount + close/idle sweeps (prevents ghost "occupancy").
 * @param {number} remoteSessionId The remote session ID to clear mounts for
 * @param {object} [opts] Optional configuration
 * @param {number|null} [opts.exceptTrajectoryId] Trajectory ID to exclude from clearing
 * @param {boolean} [opts.demoteLive] Whether to demote live recording status
 * @param {import('knex').Knex|null} [opts.trx] Optional transaction object
 * @returns {Promise<number[]>} Array of cleared trajectory IDs
 */
export async function clearMountByRemoteSessionId(remoteSessionId, {
  exceptTrajectoryId = null,
  demoteLive = true,
  trx = null,
} = {}) {
  const rid = Number(remoteSessionId);
  if (!Number.isFinite(rid) || rid <= 0) return [];
  const db = trx || getDB();
  let q = db(TABLE).where({ remote_session_id: rid });
  const exceptId = exceptTrajectoryId != null ? Number(exceptTrajectoryId) : null;
  if (Number.isFinite(exceptId) && exceptId > 0) {
    q = q.whereNot({ id: exceptId });
  }
  const rows = await q.clone().select('id', 'record_status');
  if (!rows.length) return [];

  const cleared = [];
  for (const row of rows) {
    await updateMeta(row.id, { remoteSessionId: null }, db);
    if (demoteLive && row.record_status === 'recording') {
      // 非终结性（关浏览器/断开/回收/重启中断）：恢复到录制前持久状态，杜绝降级。
      await restorePersistentRecordStatus(row.id, db);
    }
    cleared.push(Number(row.id));
  }
  return cleared;
}

/**
 * Find trajectories with stale remote_session_id references.
 * Stale conditions include: missing remote session, closed/crashed sessions, 
 * unmounted sessions, or sessions owned by another trajectory.
 * @returns {Promise<Array<{ id: number, remoteSessionId: number, recordStatus: string }>>} 过期挂载列表
 */
export async function listStaleRemoteMounts() {
  const db = getDB();
  const rows = await db({ t: TABLE })
    .leftJoin({ rs: 'remote_session' }, 'rs.id', 't.remote_session_id')
    .whereNotNull('t.remote_session_id')
    .andWhere(function staleMountWhere() {
      this.whereNull('rs.id')
        .orWhereIn('rs.status', ['closed', 'crashed'])
        .orWhereNull('rs.trajectory_id')
        .orWhereRaw('rs.trajectory_id <> t.id');
    })
    .select('t.id as id', 't.remote_session_id as remoteSessionId', 't.record_status as recordStatus');
  return rows.map((r) => ({
    id: Number(r.id),
    remoteSessionId: Number(r.remoteSessionId),
    recordStatus: r.recordStatus,
  }));
}

/**
 * Repair stale trajectory.remote_session_id pointers (恢复临时录制中的持久状态基线).
 * @param {import('knex').Knex|null} [trx] Optional transaction object
 * @returns {Promise<number[]>} Array of cleared trajectory IDs
 */
export async function repairStaleRemoteMounts(trx = null) {
  const stale = await listStaleRemoteMounts();
  if (!stale.length) return [];
  const db = trx || getDB();
  const cleared = [];
  for (const row of stale) {
    await updateMeta(row.id, { remoteSessionId: null }, db);
    if (row.recordStatus === 'recording') {
      // 非终结性恢复：恢复到录制前持久状态基线，不降级。
      await restorePersistentRecordStatus(row.id, db);
    }
    cleared.push(row.id);
  }
  return cleared;
}

/**
 * Conditional meta update (CAS). Returns number of affected rows.
 * @param {number} trajectoryDbId The trajectory ID to update
 * @param {object} fields Fields to update
 * @param {object} [where] Optional where conditions
 * @param {string[]|null} [where.recordStatusIn] Filter by record status
 * @returns {Promise<number>} Number of affected rows
 */
export async function updateMetaIf(trajectoryDbId, fields, { recordStatusIn = null } = {}) {
  const patch = toDbRow(fields);
  if (!Object.keys(patch).length) return 0;
  let q = getDB()(TABLE).where({ id: trajectoryDbId });
  if (Array.isArray(recordStatusIn) && recordStatusIn.length) {
    q = q.whereIn('record_status', recordStatusIn);
  }
  return q.update(patch);
}

/**
 * Get trajectory current record_status and persistent_record_status (lightweight, no steps).
 * persistent_record_status column may not exist in older migrations, 
 * defaults to null (handled as draft baseline by upper layers).
 * @param {number} trajectoryDbId The trajectory ID to query
 * @returns {Promise<{ recordStatus: string, persistentRecordStatus: string|null }|null>} Record status object or null if not found
 */
export async function getRecordStatusRow(trajectoryDbId) {
  const db = getDB();
  const row = await db(TABLE).where({ id: trajectoryDbId }).first('record_status');
  if (!row) return null;
  let persistentRecordStatus = null;
  try {
    const pr = await db(TABLE).where({ id: trajectoryDbId }).first('persistent_record_status');
    persistentRecordStatus = pr?.persistent_record_status ?? null;
  } catch {
    persistentRecordStatus = null;
  }
  return {
    recordStatus: row.record_status,
    persistentRecordStatus,
  };
}

/**
 * 写入 record_status（必写），同时尽力写 persistent_record_status（列缺失时降级为仅 record_status）。
 * @param {number} trajectoryDbId 轨迹 id
 * @param {string} next 目标记录状态
 * @param {import('knex').Knex|null} [trx] 可选事务对象
 * @returns {Promise<number>} 受影响行数
 */
async function writeRecordStatusResilient(trajectoryDbId, next, trx = null) {
  await updateMeta(trajectoryDbId, { recordStatus: next }, trx);
  try {
    await updateMeta(trajectoryDbId, { persistentRecordStatus: next }, trx);
  } catch (err) {
    console.warn(
      `[trajectory] persistent_record_status write skipped for #${trajectoryDbId}: ${err?.message || err}`,
    );
  }
}

/**
 * Enter transient 'recording' state.
 * Records the persistent status baseline (persistent_record_status) before recording,
 * ensuring the trajectory can be restored to this baseline after recording ends
 * without being downgraded by temporary states.
 * First recording (baseline empty/null → draft) defaults to draft.
 * @param {number} trajectoryDbId The trajectory ID to enter recording state
 * @returns {Promise<{ recordStatus: string, persistentBase: string }>} Current record status and persistent baseline
 */
export async function enterTransientRecording(trajectoryDbId) {
  const row = await getRecordStatusRow(trajectoryDbId);
  if (!row) return { recordStatus: 'recording', persistentBase: 'draft' };

  // 基线：当前 record_status 若是持久状态则取之，否则沿用既有基线；仍为空则 draft。
  const base = isPersistentRecordStatus(row.recordStatus)
    ? row.recordStatus
    : (isPersistentRecordStatus(row.persistentRecordStatus) ? row.persistentRecordStatus : 'draft');

  await updateMeta(trajectoryDbId, { recordStatus: 'recording' });
  try {
    await updateMeta(trajectoryDbId, { persistentRecordStatus: base });
  } catch (err) {
    console.warn(
      `[trajectory] persistent_record_status write skipped for #${trajectoryDbId}: ${err?.message || err}`,
    );
  }
  return { recordStatus: 'recording', persistentBase: base };
}

/**
 * After recording session ends, write the result persistent status (resolvePostRecordingStatus).
 * outcome: 'success' | 'failure' | 'restore'
 * Synchronously maintains persistent_record_status baseline (consistent with final record status).
 * @param {number} trajectoryDbId The trajectory ID to finish recording
 * @param {string} outcome Recording outcome: 'success' | 'failure' | 'restore'
 * @param {import('knex').Knex|null} [trx] Optional transaction object
 * @returns {Promise<string>} Final record status
 */
export async function finishTransientRecording(trajectoryDbId, outcome, trx = null) {
  const row = await getRecordStatusRow(trajectoryDbId);
  const base = isPersistentRecordStatus(row?.persistentRecordStatus)
    ? row.persistentRecordStatus
    : 'draft';
  const next = resolvePostRecordingStatus(base, outcome);
  await writeRecordStatusResilient(trajectoryDbId, next, trx);
  return next;
}

/**
 * Non-terminating recovery: for temporary recordings without explicit success/failure
 * (browser close, disconnect, recycle, lazy cleanup, etc.), restore to the 
 * persistent status baseline before recording, preventing downgrade to draft.
 * @param {number} trajectoryDbId The trajectory ID to restore
 * @param {import('knex').Knex|null} [trx] Optional transaction object
 * @returns {Promise<string|null>} Restored record status or null if not found
 */
export async function restorePersistentRecordStatus(trajectoryDbId, trx = null) {
  const row = await getRecordStatusRow(trajectoryDbId);
  if (!row) return null;
  if (row.recordStatus !== 'recording') {
    // 非录制中：仅同步基线（若缺失则回填为当前持久状态）；不改当前状态。
    const base = isPersistentRecordStatus(row.persistentRecordStatus)
      ? row.persistentRecordStatus
      : (isPersistentRecordStatus(row.recordStatus) ? row.recordStatus : 'draft');
    if (base !== row.persistentRecordStatus) {
      try {
        await updateMeta(trajectoryDbId, { persistentRecordStatus: base }, trx);
      } catch (err) {
        console.warn(
          `[trajectory] persistent_record_status write skipped for #${trajectoryDbId}: ${err?.message || err}`,
        );
      }
    }
    return row.recordStatus;
  }
  const base = isPersistentRecordStatus(row.persistentRecordStatus)
    ? row.persistentRecordStatus
    : 'draft';
  await writeRecordStatusResilient(trajectoryDbId, base, trx);
  // 非终结性释放：running 阶段清为 pending，避免前端 aiActive（running 信号）继续显示“录制中”。
  try {
    await getDB()('trajectory_phase')
      .where({ trajectory_id: trajectoryDbId, status: 'running' })
      .update({ status: 'pending', completed_at: null });
  } catch (err) {
    console.warn(
      `[trajectory] reset running phases skipped for #${trajectoryDbId}: ${err?.message || err}`,
    );
  }
  return base;
}

/**
 * Set a trajectory to explicit persistent record status (and backfill persistent_record_status baseline).
 * @param {number} trajectoryDbId The trajectory ID to update
 * @param {string} status Persistent record status to set
 * @param {import('knex').Knex|null} [trx] Optional transaction object
 * @returns {Promise<number>} Number of affected rows
 */
export async function setPersistentRecordStatus(trajectoryDbId, status, trx = null) {
  if (!PERSISTENT_RECORD_STATUSES.includes(status)) return 0;
  return writeRecordStatusResilient(trajectoryDbId, status, trx);
}

/**
 * Get the maximum step number for a trajectory.
 * @param {number} trajectoryDbId The trajectory ID to query
 * @returns {Promise<number>} Maximum step number or 0 if no steps exist
 */
export async function getMaxStepNumber(trajectoryDbId) {
  const row = await getDB()('trajectory_step')
    .where({ trajectory_id: trajectoryDbId })
    .max('step_number as maxStep')
    .first();
  return row?.maxStep || 0;
}

/**
 * Get existing phase numbers for a trajectory.
 * @param {number} trajectoryDbId The trajectory ID to query
 * @returns {Promise<Array<{ id: number, phase_number: number, description: string|null }>>} Array of phase objects
 */
export async function getExistingPhaseNumbers(trajectoryDbId) {
  const rows = await getDB()('trajectory_phase')
    .where({ trajectory_id: trajectoryDbId })
    .select('id', 'phase_number', 'description');
  return rows;
}

/**
 * Check if AI recording is active: any phase with status='running' (maintained by recording runner).
 * After being mounted and merged into recording, used in demote/sweep to distinguish 
 * between "truly recording" and "just viewing/occupying".
 * @param {number} trajectoryId The trajectory ID to check
 * @returns {Promise<boolean>} True if any running phase exists
 */
export async function hasRunningPhase(trajectoryId) {
  const n = Number(trajectoryId);
  if (!Number.isFinite(n) || n <= 0) return false;
  const row = await getDB()('trajectory_phase')
    .where({ trajectory_id: n, status: 'running' })
    .first('id');
  return !!row;
}

/**
 * Get the maximum phase number for a trajectory.
 * @param {number} trajectoryDbId The trajectory ID to query
 * @returns {Promise<number>} Maximum phase number or 0 if no phases exist
 */
export async function getMaxPhaseNumber(trajectoryDbId) {
  const row = await getDB()('trajectory_phase')
    .where({ trajectory_id: trajectoryDbId })
    .max('phase_number as maxPhase')
    .first();
  return row?.maxPhase || 0;
}

/**
 * Load trajectory by numeric primary key with steps.
 * @param {number} id The trajectory ID to load
 * @returns {Promise<object|null>} Trajectory object with steps or null if not found
 */
export async function getById(id) {
  const db = getDB();
  const row = await db(TABLE).where({ id }).first();
  if (!row) return null;
  const entity = fromDbRow(row);
  entity.isExport = Number(entity.isExport) ? 1 : 0;
  entity.steps = await db('trajectory_step')
    .where({ trajectory_id: row.id })
    .orderBy(['step_number', 'action_index'])
    .then(fromDbRows);
  return entity;
}

/**
 * List trajectories by function ID with pagination and filtering.
 * @param {number} functionId The function ID to filter by
 * @param {object} [options] Optional pagination and filter parameters
 * @param {number} [options.page] Page number (1-based)
 * @param {number} [options.pageSize] Number of items per page
 * @param {string|null} [options.keyword] Search keyword for name or task
 * @param {string|null} [options.sortBy] Sort column (createdAt, updatedAt, name, stepCount, phaseCount, recordStatus)
 * @param {string} [options.order] Sort order ('asc' or 'desc')
 * @param {string|string[]|null} [options.recordStatus] Filter by record status
 * @param {string|null} [options.batchTaskName] Filter by batch task name
 * @param {number|null} [options.paasUserId] Filter by PaaS user ID
 * @param {number|null} [options.isExport] Filter by export flag (0 = not exported, 1 = exported, null = all)
 * @returns {Promise<{ rows: Array<object>, total: number, page: number, pageSize: number, stats: object }>} Paginated trajectory list with statistics
 */
export async function listByFunction(functionId, {
  page = 1, pageSize = 20, keyword, sortBy, order, recordStatus, batchTaskName = null, paasUserId = null, isExport = null,
} = {}) {
  const db = getDB();
  const offset = (page - 1) * pageSize;
  const base = db({ t: TABLE })
    .leftJoin({ bj: 'batch_recording_job' }, 'bj.id', 't.batch_job_id')
    .where('t.function_id', functionId);
  const query = applyListFilters(base, { keyword, recordStatus, isExport });
  applyBatchTaskNameFilter(query, batchTaskName);
  if (paasUserId) query.where('t.paas_user_id', paasUserId);

  const sortCol = SORT_COL_MAP[sortBy] || 't.created_at';
  const sortOrder = String(order).toLowerCase() === 'asc' ? 'asc' : 'desc';

  const [{ total }] = await query.clone().count('* as total');
  const rows = await query.clone()
    .select('t.*', 'bj.name as batchTaskName')
    .orderBy(sortCol, sortOrder)
    .limit(pageSize)
    .offset(offset);
  const entities = fromDbRows(rows);

  // W5-C 批量：一次 GROUP BY 统计全部行列的阶段数（1+N → 1+1）。
  const phaseCounts = await countPhasesByTrajectoryIds(entities.map((e) => Number(e.id)));
  for (const e of entities) {
    e.isExport = Number(e.isExport) ? 1 : 0;
    e.phaseCount = phaseCounts.get(Number(e.id)) || 0;
  }
  const stats = await countByRecordStatus({ functionId, keyword, recordStatus, batchTaskName, paasUserId, isExport });
  return { rows: entities, total, page, pageSize, stats };
}

/**
 * List all trajectories with pagination and filtering.
 * @param {object} [options] Optional pagination and filter parameters
 * @param {number} [options.page] Page number (1-based)
 * @param {number} [options.pageSize] Number of items per page
 * @param {string|null} [options.keyword] Search keyword for name or task
 * @param {string|null} [options.sortBy] Sort column (createdAt, updatedAt, name, stepCount, phaseCount, recordStatus)
 * @param {string} [options.order] Sort order ('asc' or 'desc')
 * @param {string|string[]|null} [options.recordStatus] Filter by record status
 * @param {string|null} [options.batchTaskName] Filter by batch task name
 * @param {number|null} [options.paasUserId] Filter by PaaS user ID
 * @param {number|null} [options.isExport] Filter by export flag (0 = not exported, 1 = exported, null = all)
 * @returns {Promise<{ rows: Array<object>, total: number, page: number, pageSize: number, stats: object }>} Paginated trajectory list with statistics
 */
export async function list({
  page = 1, pageSize = 20, keyword, sortBy, order, recordStatus, batchTaskName = null, paasUserId = null, isExport = null,
} = {}) {
  const db = getDB();
  const offset = (page - 1) * pageSize;
  const base = db({ t: TABLE })
    .leftJoin({ bj: 'batch_recording_job' }, 'bj.id', 't.batch_job_id');
  const query = applyListFilters(base, { keyword, recordStatus, isExport });
  applyBatchTaskNameFilter(query, batchTaskName);
  if (paasUserId) query.where('t.paas_user_id', paasUserId);

  const sortCol = SORT_COL_MAP[sortBy] || 't.created_at';
  const sortOrder = String(order).toLowerCase() === 'asc' ? 'asc' : 'desc';

  const [{ total }] = await query.clone().count('* as total');
  const rows = await query.clone()
    .select('t.*', 'bj.name as batchTaskName')
    .orderBy(sortCol, sortOrder)
    .limit(pageSize)
    .offset(offset);
  const entities = fromDbRows(rows);
  // W5-C 批量：一次 GROUP BY 统计全部行列的阶段数（1+N → 1+1）。
  const phaseCounts = await countPhasesByTrajectoryIds(entities.map((e) => Number(e.id)));
  for (const e of entities) {
    e.isExport = Number(e.isExport) ? 1 : 0;
    e.phaseCount = phaseCounts.get(Number(e.id)) || 0;
  }
  const stats = await countByRecordStatus({ keyword, recordStatus, batchTaskName, paasUserId, isExport });
  return { rows: entities, total, page, pageSize, stats };
}

/**
 * Remove a trajectory by ID.
 * @param {number} id The trajectory ID to remove
 * @returns {Promise<number>} Number of affected rows
 */
export async function remove(id) {
  return getDB()(TABLE).where({ id }).del();
}

/**
 * Remove a trajectory by trajectory ID (alias for remove).
 * @param {number} id The trajectory ID to remove
 * @returns {Promise<number>} Number of affected rows
 */
export async function removeByTrajectoryId(id) {
  return remove(+id);
}

/**
 * 统计一组功能节点 id 下存在的交易数量。
 * @param {number[]} functionIds 功能节点 id 数组
 * @returns {Promise<number>} 交易数量
 */
export async function countByFunctionIds(functionIds) {
  const ids = (Array.isArray(functionIds) ? functionIds : []).map(Number).filter(Number.isFinite);
  if (!ids.length) return 0;
  const row = await getDB()(TABLE).whereIn('function_id', ids).count('* as c').first();
  return Number(row?.c) || 0;
}

/**
 * 按功能节点批量统计绑定轨迹数与最近执行时间（覆盖报表用，一次查询防 N+1）。
 * 最近执行时间取该 function_id 下 updated_at 最大值。
 * @param {number[]} functionIds 功能节点 id 数组
 * @returns {Promise<Map<number, {trajCount: number, lastExecutedAt: string|null}>>} functionId → 统计（无绑定轨迹的 id 不在 Map 中）
 */
export async function statsByFunctionIds(functionIds) {
  const ids = (Array.isArray(functionIds) ? functionIds : []).map(Number).filter(Number.isFinite);
  if (!ids.length) return new Map();
  const rows = await getDB()(TABLE)
    .whereIn('function_id', ids)
    .groupBy('function_id')
    .select(['function_id', getDB().raw('MAX(updated_at) as last_at')])
    .count('* as c');
  const out = new Map();
  for (const r of rows) {
    out.set(Number(r.function_id), {
      trajCount: Number(r.c) || 0,
      lastExecutedAt: r.last_at == null ? null : String(r.last_at),
    });
  }
  return out;
}
