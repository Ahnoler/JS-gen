import { getDB } from '../../config/database.js';
import { toDbRow, fromDbRow, fromDbRows } from './helpers.js';

const TABLE = 'process';

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
  return getDB()(TABLE).where({ id }).del();
}
