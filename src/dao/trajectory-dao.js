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
 * Normalize query recordStatus / status into a unique list of valid enums.
 * Accepts string, comma-separated string, or array.
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

/** @returns {string[]} statuses that were requested but not in the enum */
export function invalidRecordStatuses(raw) {
  if (raw == null || raw === '') return [];
  const parts = Array.isArray(raw)
    ? raw.flatMap((s) => String(s).split(','))
    : String(raw).split(',');
  return [...new Set(
    parts.map((s) => s.trim()).filter((s) => s && !ALLOWED_RECORD_STATUS.has(s)),
  )];
}

function applyListFilters(query, { keyword, recordStatus } = {}) {
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
 * 五档统计：与行查询同基准过滤（functionId/keyword/recordStatus/batchTaskName）。
 * @returns {Promise<{ total: number, draft: number, recording: number, failed: number, recorded: number, completed: number }>}
 */
export async function countByRecordStatus({ functionId = null, keyword = null, recordStatus = null, batchTaskName = null, paasUserId = null } = {}) {
  const db = getDB();
  const base = db({ t: TABLE })
    .leftJoin({ bj: 'batch_recording_job' }, 'bj.id', 't.batch_job_id');
  if (functionId != null && Number.isFinite(Number(functionId))) {
    base.where('t.function_id', Number(functionId));
  }
  applyListFilters(base, { keyword, recordStatus });
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
 * Insert trajectory row. When `trx` is provided, uses that transaction and does not commit.
 * @returns {Promise<number>} numeric PK
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
 * Append steps to an existing trajectory (by numeric PK).
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

export async function updateMeta(trajectoryDbId, fields, trx = null) {
  const patch = toDbRow(fields);
  if (!Object.keys(patch).length) return 0;
  const db = trx || getDB();
  return db(TABLE).where({ id: trajectoryDbId }).update(patch);
}

export async function markExportDirty(trajectoryId, trx = null) {
  const id = Number(trajectoryId);
  if (!Number.isFinite(id) || id <= 0) return 0;
  const db = trx || getDB();
  return db(TABLE).where({ id }).update({ is_export: 0 });
}

export async function markExported(trajectoryId, trx = null) {
  const id = Number(trajectoryId);
  if (!Number.isFinite(id) || id <= 0) return 0;
  const db = trx || getDB();
  return db(TABLE).where({ id }).update({ is_export: 1 });
}

/**
 * Clear trajectory.remote_session_id rows pointing at a remote_session.
 * Used for exclusive mount + close/idle sweeps (prevents ghost "occupancy").
 * @param {number} remoteSessionId
 * @param {{ exceptTrajectoryId?: number|null, demoteLive?: boolean, trx?: import('knex').Knex|null }} [opts]
 * @returns {Promise<number[]>} cleared trajectory ids
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
 * Trajectories whose remote_session_id is stale:
 * missing rs / closed|crashed / rs unmounted / rs owned by another traj.
 * @returns {Promise<Array<{ id: number, remoteSessionId: number, recordStatus: string }>>}
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
 * @returns {Promise<number[]>} cleared trajectory ids
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
 * @param {number} trajectoryDbId
 * @param {object} fields
 * @param {{ recordStatusIn?: string[] }} [where]
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
 * 读取轨迹当前 record_status / persistent_record_status（轻量，不含 steps）。
 * persistent_record_status 列可能在迁移前不存在，缺失时降级为 null（上层按 draft 基线处理）。
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
 * 进入临时「录制中」(recording) 状态。
 * 记录录制前的持久状态基线 persistent_record_status，保证录制结束后能恢复到
 * 该基线，而不被临时状态降级。
 * 首次录制（基线为空/null → draft）默认按 draft 处理。
 * @returns {Promise<{ recordStatus: string, persistentBase: string }>}
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
 * 录制会话结束后，写入其结果持久状态（resolvePostRecordingStatus）。
 * outcome: 'success' | 'failure' | 'restore'
 * 同步维护 persistent_record_status 基线（与最终记录状态一致）。
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
 * 非终结性恢复：临时录制未显式成功/失败（关浏览器、断开、回收、惰性清理等），
 * 一律恢复到录制前的持久状态基线，杜绝降级为 draft。
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
 * 将一条轨迹显式写为持久记录状态（同时回填 persistent_record_status 基线）。
 */
export async function setPersistentRecordStatus(trajectoryDbId, status, trx = null) {
  if (!PERSISTENT_RECORD_STATUSES.includes(status)) return 0;
  return writeRecordStatusResilient(trajectoryDbId, status, trx);
}

export async function getMaxStepNumber(trajectoryDbId) {
  const row = await getDB()('trajectory_step')
    .where({ trajectory_id: trajectoryDbId })
    .max('step_number as maxStep')
    .first();
  return row?.maxStep || 0;
}

export async function getExistingPhaseNumbers(trajectoryDbId) {
  const rows = await getDB()('trajectory_phase')
    .where({ trajectory_id: trajectoryDbId })
    .select('id', 'phase_number', 'description');
  return rows;
}

/**
 * AI 录制是否活跃：任一阶段 status='running'（录制 runner 每阶段维护）。
 * 占用中并入录制中后，用它在 demote/sweep 中区分「真正在录」与「只是观看占用」。
 */
export async function hasRunningPhase(trajectoryId) {
  const n = Number(trajectoryId);
  if (!Number.isFinite(n) || n <= 0) return false;
  const row = await getDB()('trajectory_phase')
    .where({ trajectory_id: n, status: 'running' })
    .first('id');
  return !!row;
}

export async function getMaxPhaseNumber(trajectoryDbId) {
  const row = await getDB()('trajectory_phase')
    .where({ trajectory_id: trajectoryDbId })
    .max('phase_number as maxPhase')
    .first();
  return row?.maxPhase || 0;
}

/** Load trajectory by numeric PK with steps. */
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

export async function listByFunction(functionId, {
  page = 1, pageSize = 20, keyword, sortBy, order, recordStatus, batchTaskName = null, paasUserId = null,
} = {}) {
  const db = getDB();
  const offset = (page - 1) * pageSize;
  const base = db({ t: TABLE })
    .leftJoin({ bj: 'batch_recording_job' }, 'bj.id', 't.batch_job_id')
    .where('t.function_id', functionId);
  const query = applyListFilters(base, { keyword, recordStatus });
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

  // Attach phase counts for hierarchy UI
  for (const e of entities) {
    e.isExport = Number(e.isExport) ? 1 : 0;
    const [{ phases }] = await db('trajectory_phase')
      .where({ trajectory_id: e.id })
      .count('* as phases');
    e.phaseCount = Number(phases) || 0;
  }
  const stats = await countByRecordStatus({ functionId, keyword, recordStatus, batchTaskName, paasUserId });
  return { rows: entities, total, page, pageSize, stats };
}

export async function list({
  page = 1, pageSize = 20, keyword, sortBy, order, recordStatus, batchTaskName = null, paasUserId = null,
} = {}) {
  const db = getDB();
  const offset = (page - 1) * pageSize;
  const base = db({ t: TABLE })
    .leftJoin({ bj: 'batch_recording_job' }, 'bj.id', 't.batch_job_id');
  const query = applyListFilters(base, { keyword, recordStatus });
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
  for (const e of entities) {
    e.isExport = Number(e.isExport) ? 1 : 0;
    const [{ phases }] = await db('trajectory_phase')
      .where({ trajectory_id: e.id })
      .count('* as phases');
    e.phaseCount = Number(phases) || 0;
  }
  const stats = await countByRecordStatus({ keyword, recordStatus, batchTaskName, paasUserId });
  return { rows: entities, total, page, pageSize, stats };
}

export async function remove(id) {
  return getDB()(TABLE).where({ id }).del();
}

export async function removeByTrajectoryId(id) {
  return remove(+id);
}
