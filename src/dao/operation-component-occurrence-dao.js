import { getDB } from '../../config/database.js';
import { toDbRow, fromDbRow } from './helpers.js';

const TABLE = 'operation_component_occurrence';

function shape(row) {
  const obj = fromDbRow(row);
  if (!obj) return null;
  obj.similarity = obj.similarity == null ? null : Number(obj.similarity);
  return obj;
}

export async function create(data) {
  const row = toDbRow({
    componentId: data.componentId,
    trajectoryId: data.trajectoryId,
    trajectoryPhaseId: data.trajectoryPhaseId,
    similarity: data.similarity ?? null,
    stepStart: data.stepStart ?? null,
    stepEnd: data.stepEnd ?? null,
  });
  try {
    const [id] = await getDB()(TABLE).insert(row);
    return getById(id);
  } catch (err) {
    // Unique (component_id, trajectory_phase_id) — treat as idempotent
    if (String(err?.code) === 'ER_DUP_ENTRY' || /Duplicate/i.test(String(err?.message))) {
      const existing = await getDB()(TABLE)
        .where({
          component_id: data.componentId,
          trajectory_phase_id: data.trajectoryPhaseId,
        })
        .first();
      return shape(existing);
    }
    throw err;
  }
}

export async function getById(id) {
  const row = await getDB()(TABLE).where({ id }).first();
  return shape(row);
}

export async function listByComponent(componentId) {
  const rows = await getDB()(TABLE)
    .where({ component_id: componentId })
    .orderBy('id', 'asc');
  return rows.map(shape);
}

export async function countByComponent(componentId) {
  const row = await getDB()(TABLE)
    .where({ component_id: componentId })
    .count({ total: '*' })
    .first();
  return Number(row?.total) || 0;
}

export async function listByComponentWithPhaseMeta(componentId) {
  const rows = await getDB()(TABLE)
    .leftJoin('trajectory_phase', `${TABLE}.trajectory_phase_id`, 'trajectory_phase.id')
    .leftJoin('trajectory', `${TABLE}.trajectory_id`, 'trajectory.id')
    .where(`${TABLE}.component_id`, componentId)
    .select(
      `${TABLE}.*`,
      'trajectory_phase.phase_number as phase_number',
      'trajectory_phase.description as phase_description',
      'trajectory.name as trajectory_name',
    )
    .orderBy(`${TABLE}.id`, 'asc');

  return rows.map((r) => {
    const base = shape(r);
    return {
      ...base,
      phaseNumber: r.phase_number ?? null,
      phaseDescription: r.phase_description ?? null,
      trajectoryName: r.trajectory_name ?? null,
    };
  });
}

export async function removeByComponent(componentId) {
  return getDB()(TABLE).where({ component_id: componentId }).del();
}
