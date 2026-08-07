import { getDB } from '../../config/database.js';
import { toDbRow, fromDbRow, fromDbRows } from './helpers.js';

const TABLE = 'trajectory_step';

/**
 * Batch insert steps. Accepts camelCase fields including:
 * params/element (mapped to params_json/element_json) and source.
 */
export async function batchSave(steps) {
  if (!steps.length) return;
  const db = getDB();
  const rows = steps.map((s) => {
    const row = toDbRow({
      trajectoryId: s.trajectoryId,
      stepNumber: s.stepNumber,
      phaseNumber: s.phaseNumber ?? 0,
      actionIndex: s.actionIndex ?? 0,
      actionType: s.actionType ?? s.action ?? '',
      success: s.success ?? null,
      error: s.error ?? null,
      extractedContent: s.extractedContent ?? s.result ?? '',
      trajectoryPhaseId: s.trajectoryPhaseId ?? null,
      source: s.source ?? 'agent',
      actionId: s.actionId ?? null,
    });
    // JSON columns: prefer already-named *_json, else serialize params/element
    row.params_json = s.paramsJson ?? s.params ?? null;
    row.element_json = s.elementJson ?? s.element ?? null;
    return row;
  });
  for (let i = 0; i < rows.length; i += 100) {
    await db(TABLE).insert(rows.slice(i, i + 100));
  }
}

export async function listByTrajectory(trajectoryId, { source } = {}) {
  let query = getDB()(TABLE).where({ trajectory_id: trajectoryId });
  if (source) query = query.where({ source });
  const rows = await query.orderBy(['step_number', 'action_index']);
  return fromDbRows(rows);
}

export async function listByPhase(trajectoryPhaseId) {
  const rows = await getDB()(TABLE)
    .where({ trajectory_phase_id: trajectoryPhaseId })
    .orderBy('step_number');
  return fromDbRows(rows);
}

export async function listBySource(trajectoryId, source) {
  return listByTrajectory(trajectoryId, { source });
}

export async function removeByTrajectory(trajectoryId) {
  return getDB()(TABLE).where({ trajectory_id: trajectoryId }).del();
}

export async function getById(id) {
  const row = await getDB()(TABLE).where({ id }).first();
  return fromDbRow(row);
}

export async function create(step) {
  const row = toDbRow({
    trajectoryId: step.trajectoryId,
    stepNumber: step.stepNumber,
    phaseNumber: step.phaseNumber ?? 0,
    actionIndex: step.actionIndex ?? 0,
    actionType: step.actionType ?? step.action ?? '',
    success: step.success ?? null,
    error: step.error ?? null,
    extractedContent: step.extractedContent ?? step.result ?? '',
    trajectoryPhaseId: step.trajectoryPhaseId ?? null,
    source: step.source ?? 'manual',
    confirmed: step.confirmed !== undefined && step.confirmed !== null ? !!step.confirmed : true,
    confirmedAt: step.confirmedAt ?? null,
  });
  row.params_json = step.paramsJson ?? step.params ?? null;
  row.element_json = step.elementJson ?? step.element ?? null;
  const [id] = await getDB()(TABLE).insert(row);
  return getById(id);
}

export async function update(id, fields) {
  const patch = toDbRow(fields);
  // params/element are not DB columns — map to *_json
  delete patch.params;
  delete patch.element;
  // description column removed from trajectory_step
  delete patch.description;
  if ('paramsJson' in fields || 'params' in fields) {
    const raw = fields.paramsJson ?? fields.params ?? null;
    patch.params_json = raw == null || typeof raw === 'string' ? raw : JSON.stringify(raw);
  }
  if ('elementJson' in fields || 'element' in fields) {
    const raw = fields.elementJson ?? fields.element ?? null;
    patch.element_json = raw == null || typeof raw === 'string' ? raw : JSON.stringify(raw);
  }
  if (!Object.keys(patch).length) return getById(id);
  await getDB()(TABLE).where({ id }).update(patch);
  return getById(id);
}

export async function removeById(id) {
  return getDB()(TABLE).where({ id }).del();
}

export async function reorderByTrajectory(trajectoryId) {
  const rows = await getDB()(TABLE)
    .where({ trajectory_id: trajectoryId })
    .orderBy(['step_number', 'action_index', 'id']);
  for (let i = 0; i < rows.length; i += 1) {
    await getDB()(TABLE).where({ id: rows[i].id }).update({ step_number: i + 1 });
  }
  return listByTrajectory(trajectoryId);
}

/**
 * Apply planned order: update phase binding + step_number for each row in one transaction.
 * @param {number} trajectoryId
 * @param {Array<{ id: number, trajectoryPhaseId: number|null, phaseNumber: number, stepNumber: number }>} ordered
 */
export async function applyPlannedOrder(trajectoryId, ordered) {
  const db = getDB();
  const tid = Number(trajectoryId);
  await db.transaction(async (trx) => {
    for (const s of ordered) {
      await trx(TABLE).where({ id: s.id, trajectory_id: tid }).update({
        trajectory_phase_id: s.trajectoryPhaseId,
        phase_number: s.phaseNumber,
        step_number: s.stepNumber,
      });
    }
  });
}
