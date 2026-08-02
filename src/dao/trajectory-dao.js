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
      this.where('name', 'like', kw).orWhere('task', 'like', kw);
    });
  }
  const statuses = parseRecordStatuses(recordStatus);
  if (statuses) {
    query.whereIn('record_status', statuses);
  }
  return query;
}

const SORT_COL_MAP = {
  created_at: 'created_at',
  createdAt: 'created_at',
  updated_at: 'updated_at',
  updatedAt: 'updated_at',
  name: 'name',
  step_count: 'step_count',
  stepCount: 'step_count',
  phase_count: 'phase_count',
  phaseCount: 'phase_count',
  record_status: 'record_status',
  recordStatus: 'record_status',
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
    is_replay: s.isReplay ? 1 : 0,
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
    return insertStepRows(trx, trajectoryDbId, steps, stepNumberOffset);
  });
}

export async function updateMeta(trajectoryDbId, fields, trx = null) {
  const patch = toDbRow(fields);
  if (!Object.keys(patch).length) return 0;
  const db = trx || getDB();
  return db(TABLE).where({ id: trajectoryDbId }).update(patch);
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
  entity.steps = await db('trajectory_step')
    .where({ trajectory_id: row.id })
    .andWhere((qb) => {
      qb.where({ is_replay: false }).orWhereNull('is_replay');
    })
    .orderBy(['step_number', 'action_index'])
    .then(fromDbRows);
  return entity;
}

export async function listByFunction(functionId, {
  page = 1, pageSize = 20, keyword, sortBy, order, recordStatus,
} = {}) {
  const db = getDB();
  const offset = (page - 1) * pageSize;
  const query = applyListFilters(db(TABLE).where({ function_id: functionId }), {
    keyword,
    recordStatus,
  });

  const sortCol = SORT_COL_MAP[sortBy] || 'created_at';
  const sortOrder = String(order).toLowerCase() === 'asc' ? 'asc' : 'desc';

  const [{ total }] = await query.clone().count('* as total');
  const rows = await query.clone().orderBy(sortCol, sortOrder).limit(pageSize).offset(offset);
  const entities = fromDbRows(rows);

  // Attach phase counts for hierarchy UI
  for (const e of entities) {
    const [{ phases }] = await db('trajectory_phase')
      .where({ trajectory_id: e.id })
      .count('* as phases');
    e.phaseCount = Number(phases) || 0;
  }
  return { rows: entities, total, page, pageSize };
}

export async function list({
  page = 1, pageSize = 20, keyword, sortBy, order, recordStatus,
} = {}) {
  const db = getDB();
  const offset = (page - 1) * pageSize;
  const query = applyListFilters(db(TABLE), { keyword, recordStatus });

  const sortCol = SORT_COL_MAP[sortBy] || 'created_at';
  const sortOrder = String(order).toLowerCase() === 'asc' ? 'asc' : 'desc';

  const [{ total }] = await query.clone().count('* as total');
  const rows = await query.orderBy(sortCol, sortOrder).limit(pageSize).offset(offset);
  const entities = fromDbRows(rows);
  for (const e of entities) {
    const [{ phases }] = await db('trajectory_phase')
      .where({ trajectory_id: e.id })
      .count('* as phases');
    e.phaseCount = Number(phases) || 0;
  }
  return { rows: entities, total, page, pageSize };
}

export async function remove(id) {
  return getDB()(TABLE).where({ id }).del();
}

export async function removeByTrajectoryId(id) {
  return remove(+id);
}
