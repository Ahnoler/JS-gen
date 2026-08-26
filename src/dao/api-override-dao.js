/**
 * DAO for the `api_override` table — API response mocks/overrides keyed by scope.
 */
import { getDB } from '../../config/database.js';
import { toDbRow, fromDbRow, fromDbRows } from './helpers.js';

const TABLE = 'api_override';

/**
 * Map camelCase entity fields that use non-default JSON column names.
 * respHeaders → resp_headers_json
 * @param {object} data camelCase 实体
 * @returns {object} 映射后的行对象
 */
function toOverrideRow(data) {
  const row = toDbRow({ ...data });
  if ('resp_headers' in row) {
    row.resp_headers_json = row.resp_headers ?? null;
    delete row.resp_headers;
  }
  return row;
}

function fromOverrideRow(row) {
  if (!row) return null;
  const entity = fromDbRow(row);
  if ('respHeadersJson' in entity) {
    entity.respHeaders = entity.respHeadersJson;
    delete entity.respHeadersJson;
  }
  return entity;
}

function fromOverrideRows(rows) {
  return rows.map(fromOverrideRow);
}

/**
 * Insert a new API override row and return the created entity.
 * @param {object} data camelCase override entity
 * @returns {Promise<object|null>} created override entity
 */
export async function create(data) {
  const [id] = await getDB()(TABLE).insert(toOverrideRow(data));
  return getById(id);
}

/**
 * Fetch a single API override by id.
 * @param {number} id 主键
 * @returns {Promise<object|null>} override entity or null when not found
 */
export async function getById(id) {
  const row = await getDB()(TABLE).where({ id }).first();
  return fromOverrideRow(row);
}

/**
 * Paginated list of API overrides with optional filters.
 * @param {object} [opts] 筛选与分页选项
 * @param {boolean} [opts.enabled] filter by enabled flag
 * @param {string} [opts.scope] filter by scope
 * @param {number} [opts.scopeRefId] filter by scope reference id
 * @param {number} [opts.page] 1-based page number
 * @param {number} [opts.pageSize] page size
 * @returns {Promise<{ rows: object[], total: number, page: number, pageSize: number }>} 分页结果
 */
export async function list({ enabled, scope, scopeRefId, page = 1, pageSize = 50 } = {}) {
  const db = getDB();
  const offset = (page - 1) * pageSize;
  let query = db(TABLE);
  if (enabled !== undefined) query = query.where({ enabled: !!enabled });
  if (scope) query = query.where({ scope });
  if (scopeRefId != null) query = query.where({ scope_ref_id: scopeRefId });
  const [{ total }] = await query.clone().count('* as total');
  const rows = await query.clone()
    .orderBy([{ column: 'sort_order', order: 'asc' }, { column: 'created_at', order: 'desc' }])
    .limit(pageSize)
    .offset(offset);
  return { rows: fromOverrideRows(rows), total, page, pageSize };
}

/**
 * List enabled overrides applicable to a scope hierarchy (global + matching scope).
 * @param {object} [opts] 选项
 * @param {string} [opts.scope] scope name
 * @param {number|null} [opts.scopeRefId] scope reference id
 * @returns {Promise<object[]>} matching override entities
 */
export async function listApplicable({ scope = 'global', scopeRefId = null } = {}) {
  const db = getDB();
  const rows = await db(TABLE)
    .where({ enabled: true })
    .andWhere(function () {
      this.where({ scope: 'global' });
      if (scope !== 'global' && scopeRefId != null) {
        this.orWhere({ scope, scope_ref_id: scopeRefId });
      }
    })
    .orderBy([
      { column: 'sort_order', order: 'asc' },
      { column: 'id', order: 'asc' },
    ]);
  return fromOverrideRows(rows);
}

/**
 * Update an API override by id and return the updated entity.
 * @param {number} id 主键
 * @param {object} data partial camelCase override fields
 * @returns {Promise<object|null>} updated override entity
 */
export async function update(id, data) {
  await getDB()(TABLE).where({ id }).update(toOverrideRow(data));
  return getById(id);
}

/**
 * Delete an API override by id.
 * @param {number} id 主键
 * @returns {Promise<number>} number of deleted rows
 */
export async function remove(id) {
  return getDB()(TABLE).where({ id }).del();
}
