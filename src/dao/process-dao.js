import { getDB } from '../../config/database.js';
import { toDbRow, fromDbRow, fromDbRows } from './helpers.js';

const TABLE = 'process';

/** Seed UUID for default unclassified process — must not be deleted. */
export const SEED_PROCESS_ID = '00000000-0000-0000-0000-000000000002';

export async function listBySystem(systemId) {
  const rows = await getDB()(TABLE).where({ system_id: systemId }).orderBy('sort_order', 'asc');
  return fromDbRows(rows);
}

export async function getById(id) {
  const row = await getDB()(TABLE).where({ id }).first();
  return fromDbRow(row);
}

export async function create(data) {
  const [id] = await getDB()(TABLE).insert(toDbRow(data));
  return getById(id);
}

export async function update(id, data) {
  await getDB()(TABLE).where({ id }).update(toDbRow(data));
  return getById(id);
}

export async function remove(id) {
  const row = await getById(id);
  if (row?.processId === SEED_PROCESS_ID) {
    const err = new Error('Cannot delete the default「未分类」process');
    err.code = 'SEED_PROTECTED';
    throw err;
  }
  return getDB()(TABLE).where({ id }).del();
}
