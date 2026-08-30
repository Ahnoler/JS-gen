/**
 * DAO for the `system_account` table — account credentials scoped to a target system.
 */
import { getDB } from '../../config/database.js';
import { toDbRow, fromDbRow, fromDbRows } from './helpers.js';

const TABLE = 'system_account';

function client(db) {
  return db || getDB();
}

/**
 * List accounts belonging to a given system, ordered by sort_order then id.
 * @param {number} systemId target system id
 * @param {object|null} [db] optional knex instance (uses shared DB when null)
 * @returns {Promise<object[]>} account entities
 */
export async function listBySystem(systemId, db = null) {
  const rows = await client(db)(TABLE)
    .where({ system_id: systemId })
    .orderBy([{ column: 'sort_order', order: 'asc' }, { column: 'id', order: 'asc' }]);
  return fromDbRows(rows);
}

/**
 * 按多个系统 id 批量列出账号（每系统内按 sort_order、id 升序；供 1+N 场景一次取回）。
 * @param {Array<number|string>} systemIds 目标系统 id 数组
 * @param {object|null} [db] 可选 knex 实例
 * @returns {Promise<object[]>} 账号实体数组
 */
export async function listBySystemIds(systemIds, db = null) {
  const ids = (Array.isArray(systemIds) ? systemIds : [])
    .map((v) => Number(v))
    .filter((v) => Number.isFinite(v) && v > 0);
  if (!ids.length) return [];
  const rows = await client(db)(TABLE)
    .whereIn('system_id', ids)
    .orderBy([{ column: 'sort_order', order: 'asc' }, { column: 'id', order: 'asc' }]);
  return fromDbRows(rows);
}

/**
 * List all accounts ordered by system_id, sort_order, id.
 * @param {object|null} [db] optional knex instance
 * @returns {Promise<object[]>} account entities
 */
export async function listAll(db = null) {
  const rows = await client(db)(TABLE)
    .orderBy([{ column: 'system_id', order: 'asc' }, { column: 'sort_order', order: 'asc' }, { column: 'id', order: 'asc' }]);
  return fromDbRows(rows);
}

/**
 * Fetch a single account by id.
 * @param {number} id 主键
 * @param {object|null} [db] optional knex instance
 * @returns {Promise<object|null>} account entity or null when not found
 */
export async function getById(id, db = null) {
  const row = await client(db)(TABLE).where({ id }).first();
  return fromDbRow(row);
}

/**
 * Insert a new account and return the created entity.
 * @param {object} data camelCase account fields
 * @param {object|null} [db] optional knex instance
 * @returns {Promise<object|null>} created account entity
 */
export async function create(data, db = null) {
  const [id] = await client(db)(TABLE).insert(toDbRow(data));
  return getById(id, db);
}

/**
 * Update an account by id and return the updated entity.
 * @param {number} id 主键
 * @param {object} data partial camelCase account fields
 * @param {object|null} [db] optional knex instance
 * @returns {Promise<object|null>} updated account entity
 */
export async function update(id, data, db = null) {
  await client(db)(TABLE).where({ id }).update(toDbRow(data));
  return getById(id, db);
}

/**
 * Delete an account by id.
 * @param {number} id 主键
 * @param {object|null} [db] optional knex instance
 * @returns {Promise<number>} number of deleted rows
 */
export async function remove(id, db = null) {
  return client(db)(TABLE).where({ id }).del();
}
