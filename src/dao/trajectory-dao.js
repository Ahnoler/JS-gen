import { getDB } from '../../config/database.js';
import { toDbRow, fromDbRow, fromDbRows } from './helpers.js';

const TABLE = 'trajectory';

export async function save(trajectory) {
  const db = getDB();
  return db.transaction(async (trx) => {
    const [id] = await trx(TABLE).insert(toDbRow({
      trajectoryId: trajectory.trajectoryId,
      task: trajectory.task,
      model: trajectory.model,
      stepCount: trajectory.stepCount,
      actionCount: trajectory.actionCount,
      isDone: trajectory.isDone,
      isSuccessful: trajectory.isSuccessful,
      url: trajectory.url,
      functionId: trajectory.functionId ?? null,
      remoteSessionId: trajectory.remoteSessionId ?? null,
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
    action_type: s.actionType ?? s.action ?? '',
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
 * Append steps to an existing trajectory (same session_id / trajectory_id).
 * Returns number of steps inserted.
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
    .select('id', 'phase_number');
  return rows;
}

export async function getByTrajectoryId(trajectoryId) {
  const db = getDB();
  const row = await db(TABLE).where({ trajectory_id: trajectoryId }).first();
  if (!row) return null;
  const entity = fromDbRow(row);
  entity.steps = await db('trajectory_step')
    .where({ trajectory_id: row.id })
    .orderBy(['step_number', 'action_index'])
    .then(fromDbRows);
  return entity;
}

export async function listByFunction(functionId, { page = 1, pageSize = 20 } = {}) {
  const db = getDB();
  const offset = (page - 1) * pageSize;
  const query = db(TABLE).where({ function_id: functionId });
  const [{ total }] = await query.clone().count('* as total');
  const rows = await query.clone().orderBy('created_at', 'desc').limit(pageSize).offset(offset);
  return { rows: fromDbRows(rows), total, page, pageSize };
}

export async function list({ page = 1, pageSize = 20 } = {}) {
  const db = getDB();
  const offset = (page - 1) * pageSize;
  const [{ total }] = await db(TABLE).count('* as total');
  const rows = await db(TABLE).orderBy('created_at', 'desc').limit(pageSize).offset(offset);
  return { rows: fromDbRows(rows), total, page, pageSize };
}

export async function remove(id) {
  return getDB()(TABLE).where({ id }).del();
}

export async function removeByTrajectoryId(trajectoryId) {
  return getDB()(TABLE).where({ trajectory_id: trajectoryId }).del();
}
