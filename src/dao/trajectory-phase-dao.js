import { getDB } from '../../config/database.js';
import { toDbRow, fromDbRow, fromDbRows } from './helpers.js';

const TABLE = 'trajectory_phase';

export async function create(data) {
  const [id] = await getDB()(TABLE).insert(toDbRow(data));
  return getById(id);
}

export async function getById(id) {
  const row = await getDB()(TABLE).where({ id }).first();
  return fromDbRow(row);
}

export async function listByTrajectory(trajectoryId) {
  const rows = await getDB()(TABLE)
    .where({ trajectory_id: trajectoryId })
    .orderBy('phase_number');
  return fromDbRows(rows);
}

export async function updateStatus(phaseId, status) {
  const data = { status };
  if (status === 'completed' || status === 'failed') {
    data.completed_at = getDB().fn.now();
  } else {
    // Keep completed_at consistent for non-terminal statuses (e.g. pending/running).
    data.completed_at = null;
  }
  await getDB()(TABLE).where({ id: phaseId }).update(toDbRow(data));
  return getById(phaseId);
}
