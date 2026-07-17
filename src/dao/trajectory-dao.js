import { getDB } from '../../config/database.js';
import { toDbRow, fromDbRow, fromDbRows } from './helpers.js';

const TABLE = 'trajectory';

export async function save(trajectory) {
  const db = getDB();
  return db.transaction(async (trx) => {
    const [id] = await trx(TABLE).insert(toDbRow({
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
      remoteSessionId: trajectory.remoteSessionId ?? null,
      recordStatus: trajectory.recordStatus ?? 'draft',
    }));

    if (trajectory.steps?.length) {
      await insertStepRows(trx, id, trajectory.steps);
    }
    return id;
  });
}

async function insertStepRows(trx, trajectoryDbId, steps, stepNumberOffset = 0) {
  const stepRows = steps.map((s, i) => ({
    trajectory_id: trajectoryDbId,
    step_number: s.stepNumber || stepNumberOffset + i + 1,
    phase_number: s.phaseNumber ?? 0,
    action_index: s.actionIndex ?? 0,
    action_type: (s.actionType ?? s.action) || '',
    description: s.description ?? '',
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
    return insertStepRows(trx, trajectoryDbId, steps, stepNumberOffset);
  });
}

export async function updateMeta(trajectoryDbId, fields) {
  const patch = toDbRow(fields);
  if (!Object.keys(patch).length) return;
  await getDB()(TABLE).where({ id: trajectoryDbId }).update(patch);
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
    .orderBy(['step_number', 'action_index'])
    .then(fromDbRows);
  return entity;
}

/** @deprecated use getById — kept for transitional call sites */
export async function getByTrajectoryId(idOrBiz) {
  const numeric = Number(idOrBiz);
  if (Number.isFinite(numeric) && String(numeric) === String(idOrBiz)) {
    return getById(numeric);
  }
  return null;
}

export async function listByFunction(functionId, { page = 1, pageSize = 20, keyword, sortBy, order } = {}) {
  const db = getDB();
  const offset = (page - 1) * pageSize;
  const query = db(TABLE).where({ function_id: functionId });
  if (keyword && String(keyword).trim()) {
    const kw = `%${String(keyword).trim()}%`;
    query.where(function () {
      this.where('name', 'like', kw).orWhere('task', 'like', kw);
    });
  }

  const sortColMap = {
    created_at: 'created_at',
    createdAt: 'created_at',
    updated_at: 'updated_at',
    updatedAt: 'updated_at',
    name: 'name',
    step_count: 'step_count',
    stepCount: 'step_count',
    phase_count: 'phase_count',
    phaseCount: 'phase_count',
  };
  const sortCol = sortColMap[sortBy] || 'created_at';
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

export async function list({ page = 1, pageSize = 20, keyword, sortBy, order } = {}) {
  const db = getDB();
  const offset = (page - 1) * pageSize;
  const query = db(TABLE);
  if (keyword && String(keyword).trim()) {
    const kw = `%${String(keyword).trim()}%`;
    query.where(function () {
      this.where('name', 'like', kw).orWhere('task', 'like', kw);
    });
  }

  const sortColMap = {
    created_at: 'created_at',
    createdAt: 'created_at',
    updated_at: 'updated_at',
    updatedAt: 'updated_at',
    name: 'name',
    step_count: 'step_count',
    stepCount: 'step_count',
    phase_count: 'phase_count',
    phaseCount: 'phase_count',
  };
  const sortCol = sortColMap[sortBy] || 'created_at';
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
