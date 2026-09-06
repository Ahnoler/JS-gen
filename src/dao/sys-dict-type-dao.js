/**
 * DAO for the `sys_dict_type` table — dictionary type definitions.
 */
import { getDB } from '../../config/database.js';
import { toDbRow, fromDbRow, fromDbRows } from './helpers.js';

const TABLE = 'sys_dict_type';

function shape(row) {
  if (!row) return null;
  return fromDbRow(row);
}

/**
 * List dictionary types ordered by dict_id, optionally filtered by status.
 * @param {object} [opts] 筛选选项
 * @param {string} [opts.status] status filter
 * @returns {Promise<object[]>} dictionary type entities
 */
export async function list({ status } = {}) {
  let q = getDB()(TABLE).orderBy([
    { column: 'dict_id', order: 'asc' },
  ]);
  if (status != null && status !== '') {
    q = q.where({ status: String(status) });
  }
  return fromDbRows(await q);
}

/**
 * Fetch a dictionary type by its dict_id.
 * @param {number} dictId 字典 id
 * @returns {Promise<object|null>} dictionary type entity or null when not found
 */
export async function getById(dictId) {
  const row = await getDB()(TABLE).where({ dict_id: dictId }).first();
  return shape(row);
}

/**
 * Fetch a dictionary type by its dict_type code.
 * @param {string} dictType 字典类型编码
 * @returns {Promise<object|null>} dictionary type entity or null when not found
 */
export async function getByType(dictType) {
  const row = await getDB()(TABLE).where({ dict_type: dictType }).first();
  return shape(row);
}

/**
 * Create a new dictionary type and return the created entity.
 * @param {object} data camelCase dict type fields
 * @returns {Promise<object|null>} created dictionary type entity
 */
export async function create(data) {
  const row = {
    dict_name: data.dictName ?? data.dict_name ?? '',
    dict_type: data.dictType ?? data.dict_type ?? '',
    status: data.status ?? '0',
    remark: data.remark ?? null,
    create_by: '',
    update_by: '',
  };
  const [id] = await getDB()(TABLE).insert(row);
  return getById(id);
}

/**
 * Update a dictionary type by dict_id and return the updated entity.
 * @param {number} dictId 字典 id
 * @param {object} data partial camelCase dict type fields
 * @returns {Promise<object|null>} updated dictionary type entity
 */
export async function update(dictId, data) {
  const patch = {};
  if (data.dictName !== undefined) patch.dict_name = data.dictName;
  if (data.dictType !== undefined) patch.dict_type = data.dictType;
  if (data.status !== undefined) patch.status = data.status;
  if (data.remark !== undefined) patch.remark = data.remark;
  if (!Object.keys(patch).length) return getById(dictId);
  patch.update_time = getDB().fn.now();
  await getDB()(TABLE).where({ dict_id: dictId }).update(patch);
  return getById(dictId);
}

/**
 * Delete a dictionary type by dict_id.
 * @param {number} dictId 字典 id
 * @returns {Promise<number>} number of deleted rows
 */
export async function remove(dictId) {
  return getDB()(TABLE).where({ dict_id: dictId }).del();
}
