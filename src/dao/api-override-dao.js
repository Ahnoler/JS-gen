import { getDB } from '../../config/database.js';
import { toDbRow, fromDbRow, fromDbRows } from './helpers.js';

const TABLE = 'api_override';

/**
 * Map camelCase entity fields that use non-default JSON column names.
 * respHeaders → resp_headers_json
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

export async function create(data) {
  const [id] = await getDB()(TABLE).insert(toOverrideRow(data));
  return getById(id);
}

export async function getById(id) {
  const row = await getDB()(TABLE).where({ id }).first();
  return fromOverrideRow(row);
}

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

export async function update(id, data) {
  await getDB()(TABLE).where({ id }).update(toOverrideRow(data));
  return getById(id);
}

export async function remove(id) {
  return getDB()(TABLE).where({ id }).del();
}
