import { getDB } from '../../config/database.js';
import { toDbRow, fromDbRow, fromDbRows } from './helpers.js';

const TABLE = 'system_account';

function client(db) {
  return db || getDB();
}

export async function listBySystem(systemId, db = null) {
  const rows = await client(db)(TABLE)
    .where({ system_id: systemId })
    .orderBy([{ column: 'sort_order', order: 'asc' }, { column: 'id', order: 'asc' }]);
  return fromDbRows(rows);
}

export async function listAll(db = null) {
  const rows = await client(db)(TABLE)
    .orderBy([{ column: 'system_id', order: 'asc' }, { column: 'sort_order', order: 'asc' }, { column: 'id', order: 'asc' }]);
  return fromDbRows(rows);
}

export async function getById(id, db = null) {
  const row = await client(db)(TABLE).where({ id }).first();
  return fromDbRow(row);
}

export async function create(data, db = null) {
  const [id] = await client(db)(TABLE).insert(toDbRow(data));
  return getById(id, db);
}

export async function update(id, data, db = null) {
  await client(db)(TABLE).where({ id }).update(toDbRow(data));
  return getById(id, db);
}

export async function remove(id, db = null) {
  return client(db)(TABLE).where({ id }).del();
}
