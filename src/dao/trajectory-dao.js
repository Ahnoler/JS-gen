import { getDB } from '../../config/database.js';
import { toDbRow, fromDbRow, fromDbRows } from './helpers.js';
import { TRAJECTORY_RECORD_STATUSES } from '../models/constants.js';

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
 * 五档统计：与行查询同基准过滤（functionId/keyword/batchTaskName），忽略 recordStatus。
 * @returns {Promise<{ total: number, draft: number, recording: number, failed: number, recorded: number, completed: number }>}
 */
export async function countByRecordStatus({ functionId = null, keyword = null, batchTaskName = null } = {}) {
  const db = getDB();
  const base = db({ t: TABLE })
    .leftJoin({ bj: 'batch_recording_job' }, 'bj.id', 't.batch_job_id');
  if (functionId != null && Number.isFinite(Number(functionId))) {
    base.where('t.function_id', Number(functionId));
  }
  applyListFilters(base, { keyword, recordStatus: null });
  applyBatchTaskNameFilter(base, batchTaskName);
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
      recordStatus: trajectory.recordStatus ?? 'draft',
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
    const fields = { remoteSessionId: null };
    if (demoteLive && row.record_status === 'recording'
        && !(await hasRunningPhase(row.id))) {
      fields.recordStatus = 'draft';
    }
    await updateMeta(row.id, fields, db);
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
 * Repair stale trajectory.remote_session_id pointers (and demote 非AI录制中→draft).
 * @returns {Promise<number[]>} cleared trajectory ids
 */
export async function repairStaleRemoteMounts(trx = null) {
  const stale = await listStaleRemoteMounts();
  if (!stale.length) return [];
  const db = trx || getDB();
  const cleared = [];
  for (const row of stale) {
    const fields = { remoteSessionId: null };
    if (row.recordStatus === 'recording' && !(await hasRunningPhase(row.id))) {
      fields.recordStatus = 'draft';
    }
    await updateMeta(row.id, fields, db);
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
  page = 1, pageSize = 20, keyword, sortBy, order, recordStatus, batchTaskName = null,
} = {}) {
  const db = getDB();
  const offset = (page - 1) * pageSize;
  const base = db({ t: TABLE })
    .leftJoin({ bj: 'batch_recording_job' }, 'bj.id', 't.batch_job_id')
    .where('t.function_id', functionId);
  const query = applyListFilters(base, { keyword, recordStatus });
  applyBatchTaskNameFilter(query, batchTaskName);

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
  const stats = await countByRecordStatus({ functionId, keyword, batchTaskName });
  return { rows: entities, total, page, pageSize, stats };
}

export async function list({
  page = 1, pageSize = 20, keyword, sortBy, order, recordStatus, batchTaskName = null,
} = {}) {
  const db = getDB();
  const offset = (page - 1) * pageSize;
  const base = db({ t: TABLE })
    .leftJoin({ bj: 'batch_recording_job' }, 'bj.id', 't.batch_job_id');
  const query = applyListFilters(base, { keyword, recordStatus });
  applyBatchTaskNameFilter(query, batchTaskName);

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
  const stats = await countByRecordStatus({ keyword, batchTaskName });
  return { rows: entities, total, page, pageSize, stats };
}

export async function remove(id) {
  return getDB()(TABLE).where({ id }).del();
}

export async function removeByTrajectoryId(id) {
  return remove(+id);
}
