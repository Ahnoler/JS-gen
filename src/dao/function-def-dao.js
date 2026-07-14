import { getDB } from '../../config/database.js';
import { toDbRow, fromDbRow, fromDbRows } from './helpers.js';

const TABLE = 'function_def';

/** Seed UUID for default unclassified function — must not be deleted. */
export const SEED_FUNCTION_ID = '00000000-0000-0000-0000-000000000003';

export async function listByProcess(processId) {
  const rows = await getDB()(TABLE).where({ process_id: processId }).orderBy('sort_order', 'asc');
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
  if (row?.functionId === SEED_FUNCTION_ID) {
    const err = new Error('Cannot delete the default「未分类」function');
    err.code = 'SEED_PROTECTED';
    throw err;
  }
  return getDB()(TABLE).where({ id }).del();
}

export async function getDefaultFunctionId() {
  const row = await getDB()(TABLE)
    .join('process', 'function_def.process_id', 'process.id')
    .join('system', 'process.system_id', 'system.id')
    .where('system.system_id', '00000000-0000-0000-0000-000000000001')
    .where('function_def.name', '未分类')
    .first('function_def.id');
  return row?.id || null;
}
