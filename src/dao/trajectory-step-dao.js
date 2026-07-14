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
      description: s.description ?? '',
      success: s.success ?? null,
      error: s.error ?? null,
      extractedContent: s.extractedContent ?? s.result ?? '',
      trajectoryPhaseId: s.trajectoryPhaseId ?? null,
      source: s.source ?? 'agent',
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
