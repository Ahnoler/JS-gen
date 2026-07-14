import { getDB } from '../../config/database.js';
import { toDbRow, fromDbRow, fromDbRows } from './helpers.js';

const TABLE = 'remote_session';

export async function create(data) {
  const [id] = await getDB()(TABLE).insert(toDbRow(data));
  return getById(id);
}

export async function getById(id) {
  const row = await getDB()(TABLE).where({ id }).first();
  return fromDbRow(row);
}

export async function getByUuid(sessionUuid) {
  const row = await getDB()(TABLE).where({ session_uuid: sessionUuid }).first();
  return fromDbRow(row);
}

export async function list({ status, page = 1, pageSize = 20 } = {}) {
  const db = getDB();
  const offset = (page - 1) * pageSize;
  let query = db(TABLE);
  if (status) query = query.where({ status });
  const [{ total }] = await query.clone().count('* as total');
  const rows = await query.clone().orderBy('created_at', 'desc').limit(pageSize).offset(offset);
  return { rows: fromDbRows(rows), total, page, pageSize };
}

export async function update(id, data) {
  await getDB()(TABLE).where({ id }).update(toDbRow(data));
  return getById(id);
}

export async function close(id, { crashed = false } = {}) {
  return update(id, {
    status: crashed ? 'crashed' : 'closed',
    closedAt: new Date(),
  });
}

export async function remove(id) {
  return getDB()(TABLE).where({ id }).del();
}
