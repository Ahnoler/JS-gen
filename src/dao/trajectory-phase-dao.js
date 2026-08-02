import { getDB } from '../../config/database.js';
import { toDbRow, fromDbRow, fromDbRows } from './helpers.js';

const TABLE = 'trajectory_phase';

export async function create(data, trx = null) {
  const db = trx || getDB();
  const [id] = await db(TABLE).insert(toDbRow(data));
  return getById(id, trx);
}

export async function getById(id, trx = null) {
  const db = trx || getDB();
  const row = await db(TABLE).where({ id }).first();
  return parseCandidates(row);
}

export async function listByTrajectory(trajectoryId) {
  const rows = await getDB()(TABLE)
    .where({ trajectory_id: trajectoryId })
    .orderBy('phase_number');
  return rows.map(parseCandidates);
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

function parseCandidates(row) {
  const obj = fromDbRow(row);
  if (!obj) return null;
  const raw = obj.specialElementCandidatesJson;
  if (raw != null && typeof raw === 'string') {
    try {
      obj.specialElementCandidatesJson = JSON.parse(raw);
    } catch {
      /* keep string */
    }
  }
  return obj;
}

export async function update(phaseId, fields, trx = null) {
  const db = trx || getDB();
  const patch = toDbRow({ ...fields });
  delete patch.id;
  if ('specialElementCandidatesJson' in fields || 'special_element_candidates_json' in fields) {
    const raw = fields.specialElementCandidatesJson
      ?? fields.special_element_candidates_json
      ?? null;
    patch.special_element_candidates_json = raw == null || typeof raw === 'string'
      ? raw
      : JSON.stringify(raw);
    delete patch.specialElementCandidatesJson;
  }
  if (!Object.keys(patch).length) return getById(phaseId, trx);
  await db(TABLE).where({ id: phaseId }).update(patch);
  return getById(phaseId, trx);
}
