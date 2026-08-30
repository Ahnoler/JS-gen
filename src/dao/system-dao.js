/**
 * DAO for the `system` table — hierarchical system/module/function node tree with UUID ids.
 */
import { getDB } from '../../config/database.js';
import { toDbRow, fromDbRow } from './helpers.js';
import {
  NODE_TYPE,
  TYPE_LABEL,
  ROOT_NODE_ID,
  isRootParentId,
  isRootNodeId,
  SEED_ROOT_ID,
  SEED_SYSTEM_ID,
  SEED_MODULE_ID,
  SEED_FUNCTION_ID,
  SEED_UUID_BY_TYPE,
} from '../models/hierarchy-constants.js';

const TABLE = 'system';

export {
  NODE_TYPE,
  TYPE_LABEL,
  ROOT_NODE_ID,
  isRootParentId,
  isRootNodeId,
  SEED_ROOT_ID,
  SEED_SYSTEM_ID,
  SEED_MODULE_ID,
  SEED_FUNCTION_ID,
};

function assertType(type) {
  const t = Number(type);
  if (![NODE_TYPE.SYSTEM, NODE_TYPE.MODULE, NODE_TYPE.FUNCTION].includes(t)) {
    throw Object.assign(new Error(`Invalid type: ${type} (expect 1=系统 2=模块 3=功能)`), { code: 'VALIDATION' });
  }
  return t;
}

/**
 * Raw camelCase row without API aliases (for ancestry maps).
 * @param {object} row DB row
 * @returns {object|null} normalized raw node, or null when row is null
 */
export function fromRaw(row) {
  if (!row) return null;
  const n = fromDbRow(row);
  const type = Number(n.type);
  return {
    id: n.id,
    uid: n.systemId,
    systemId: n.systemId,
    type,
    typeLabel: TYPE_LABEL[type] || String(n.type),
    parentId: isRootNodeId(n.id) || type === NODE_TYPE.ROOT || type === NODE_TYPE.SYSTEM
      ? (isRootParentId(n.parentId) ? ROOT_NODE_ID : Number(n.parentId))
      : (n.parentId == null || n.parentId === '' ? null : Number(n.parentId)),
    name: n.name,
    description: n.description ?? null,
    url: n.url || '',
    sortOrder: n.sortOrder ?? 0,
    createdAt: n.createdAt,
    updatedAt: n.updatedAt,
    umlEcd: n.umlEcd || '',
    pdCmptEcd: n.pdCmptEcd || '',
    source: n.source || '',
    menuXpath: n.menuXpath || '',
    unmatchedFlag: n.unmatchedFlag ?? 0,
    removedFlag: n.removedFlag ?? 0,
  };
}

/**
 * Map DB row → API-shaped node (keeps processId/functionId/moduleId aliases for UI).
 * @param {object} row DB row
 * @returns {object|null} API-shaped node, or null when row is null
 */
export function shapeNode(row) {
  if (!row) return null;
  const n = fromRaw(row);
  const base = { ...n };
  if (n.type === NODE_TYPE.MODULE) {
    return {
      ...base,
      moduleId: n.uid,
      processId: n.uid,
      systemId: n.parentId,
    };
  }
  if (n.type === NODE_TYPE.FUNCTION) {
    return {
      ...base,
      functionId: n.uid,
      processId: n.parentId,
      moduleId: n.parentId,
    };
  }
  return base;
}

function shapeNodes(rows) {
  return rows.map(shapeNode);
}

/**
 * List nodes of a given type, optionally filtered by parent, ordered by sort_order then id.
 * @param {number} type node type (1=system, 2=module, 3=function)
 * @param {object} [opts] 选项
 * @param {number} [opts.parentId] parent node id (0/ROOT for system roots)
 * @returns {Promise<object[]>} API-shaped node entities
 */
export async function listByType(type, { parentId } = {}) {
  assertType(type);
  let q = getDB()(TABLE).where({ type });
  if (parentId !== undefined) {
    if (isRootParentId(parentId)) {
      // type=系统 roots: parent_id=0（兼容尚未迁移的 NULL）
      q = q.andWhere(function rootParent() {
        this.where({ parent_id: ROOT_NODE_ID }).orWhereNull('parent_id');
      });
    } else {
      q = q.where({ parent_id: parentId });
    }
  }
  const rows = await q.orderBy([
    { column: 'sort_order', order: 'asc' },
    { column: 'id', order: 'asc' },
  ]);
  return shapeNodes(rows);
}

/**
 * List root systems (type=1, parent_id=0).
 * @returns {Promise<object[]>} API-shaped root system nodes
 */
export async function list() {
  return listByType(NODE_TYPE.SYSTEM, { parentId: ROOT_NODE_ID });
}

/**
 * List all nodes as raw camelCase rows ordered by type/sort_order/id.
 * @returns {Promise<object[]>} raw node entities
 */
export async function listAllRaw() {
  const rows = await getDB()(TABLE).orderBy([
    { column: 'type', order: 'asc' },
    { column: 'sort_order', order: 'asc' },
    { column: 'id', order: 'asc' },
  ]);
  return rows.map(fromRaw);
}

/**
 * All hierarchy nodes as API-shaped flat list (parentId links).
 * @returns {Promise<object[]>} API-shaped node entities
 */
export async function listAll() {
  return listFiltered({});
}

/**
 * Flat list with optional filters.
 * @param {object} [opts] 筛选选项
 * @param {number|string} [opts.type] filter by node type
 * @param {string} [opts.keyword] LIKE search on name
 * @param {number} [opts.limit] max rows (clamped 1..500)
 * @returns {Promise<object[]>} API-shaped node entities
 */
export async function listFiltered({ type, keyword, limit } = {}) {
  let q = getDB()(TABLE);
  if (type !== undefined && type !== null && type !== '') {
    q = q.where({ type: Number(type) });
  }
  const kw = String(keyword || '').trim();
  if (kw) {
    q = q.where('name', 'like', `%${kw}%`);
  }
  q = q.orderBy([
    { column: 'type', order: 'asc' },
    { column: 'sort_order', order: 'asc' },
    { column: 'id', order: 'asc' },
  ]);
  if (limit != null && Number.isFinite(+limit) && +limit > 0) {
    q = q.limit(Math.min(500, Math.max(1, +limit)));
  }
  const rows = await q;
  return shapeNodes(rows);
}

/**
 * List child nodes of a parent ordered by sort_order then id.
 * @param {number} parentId parent node id (0/ROOT for top level)
 * @param {object|null} [db] optional knex instance（事务内传 trx）
 * @returns {Promise<object[]>} API-shaped node entities
 */
export async function listByParent(parentId, db = null) {
  let q = (db || getDB())(TABLE);
  if (isRootParentId(parentId)) {
    q = q.andWhere(function rootParent() {
      this.where({ parent_id: ROOT_NODE_ID }).orWhereNull('parent_id');
    });
  } else {
    q = q.where({ parent_id: parentId });
  }
  const rows = await q.orderBy([{ column: 'sort_order', order: 'asc' }, { column: 'id', order: 'asc' }]);
  return shapeNodes(rows);
}

/**
 * List modules (processes) under a system.
 * @param {number} systemId parent system id
 * @returns {Promise<object[]>} API-shaped module nodes
 */
export async function listProcesses(systemId) {
  return listByType(NODE_TYPE.MODULE, { parentId: systemId });
}

/**
 * Alias for listProcesses — modules under a system.
 * @param {number} systemId parent system id
 * @returns {Promise<object[]>} API-shaped module nodes
 */
export async function listModules(systemId) {
  return listProcesses(systemId);
}

/**
 * List functions under a module.
 * @param {number} moduleId parent module id
 * @returns {Promise<object[]>} API-shaped function nodes
 */
export async function listFunctions(moduleId) {
  return listByType(NODE_TYPE.FUNCTION, { parentId: moduleId });
}

/**
 * Fetch a single node by id (API-shaped).
 * @param {number} id 主键
 * @param {object|null} [db] optional knex instance
 * @returns {Promise<object|null>} API-shaped node or null when not found
 */
export async function getById(id, db = null) {
  const client = db || getDB();
  const row = await client(TABLE).where({ id }).first();
  return shapeNode(row);
}

/**
 * Fetch a single node by id (raw, no API aliases).
 * @param {number} id 主键
 * @param {object|null} [db] optional knex instance
 * @returns {Promise<object|null>} raw node entity or null when not found
 */
export async function getRawById(id, db = null) {
  const client = db || getDB();
  const row = await client(TABLE).where({ id }).first();
  return fromRaw(row);
}

/**
 * Fetch a node by its system_id (UUID).
 * @param {string} systemId UUID
 * @returns {Promise<object|null>} API-shaped node or null when not found
 */
export async function getByUuid(systemId) {
  const row = await getDB()(TABLE).where({ system_id: systemId }).first();
  return shapeNode(row);
}

/**
 * Fuzzy match on name; returns shaped nodes.
 * @param {string} keyword name search term
 * @param {object} [opts] 选项
 * @param {number} [opts.limit] max rows (clamped 1..200)
 * @returns {Promise<object[]>} API-shaped node entities
 */
export async function searchByName(keyword, { limit = 50 } = {}) {
  const q = String(keyword || '').trim();
  if (!q) return [];
  const rows = await getDB()(TABLE)
    .where('name', 'like', `%${q}%`)
    .orderBy([{ column: 'type', order: 'asc' }, { column: 'id', order: 'asc' }])
    .limit(Math.min(200, Math.max(1, limit)));
  return shapeNodes(rows);
}

/**
 * Create a node (system/module/function) with parent validation and return the created entity.
 * @param {object} data camelCase node fields (type/name/parentId required)
 * @param {object|null} [db] optional knex instance
 * @returns {Promise<object|null>} created API-shaped node entity
 */
export async function create(data, db = null) {
  const client = db || getDB();
  const type = assertType(data.type ?? NODE_TYPE.SYSTEM);
  let parentId = data.parentId;

  if (type === NODE_TYPE.SYSTEM) {
    if (!isRootParentId(parentId) && parentId !== undefined) {
      throw Object.assign(new Error('type=1（系统）的 parentId 必须为 0'), { code: 'VALIDATION' });
    }
    parentId = ROOT_NODE_ID;
  } else {
    if (isRootParentId(parentId) || !Number.isFinite(+parentId)) {
      throw Object.assign(new Error('模块/功能必须指定有效 parentId'), { code: 'VALIDATION' });
    }
    parentId = +parentId;
    const parent = await getRawById(parentId, client);
    if (!parent) throw Object.assign(new Error('父节点不存在'), { code: 'NOT_FOUND' });
    if (type === NODE_TYPE.MODULE && parent.type !== NODE_TYPE.SYSTEM) {
      throw Object.assign(new Error('模块的父节点必须是系统（type=1）'), { code: 'VALIDATION' });
    }
    if (type === NODE_TYPE.FUNCTION && parent.type !== NODE_TYPE.MODULE) {
      throw Object.assign(new Error('功能的父节点必须是模块（type=2）'), { code: 'VALIDATION' });
    }
  }

  const name = String(data.name || '').trim();
  if (!name) throw Object.assign(new Error('name is required'), { code: 'VALIDATION' });

  const insert = {
    systemId: data.systemId || data.uid,
    type,
    parentId,
    name,
    description: data.description ?? null,
    url: type === NODE_TYPE.SYSTEM ? String(data.url ?? '').trim() : '',
    sortOrder: data.sortOrder ?? 0,
    umlEcd: String(data.umlEcd ?? '').trim(),
    pdCmptEcd: String(data.pdCmptEcd ?? '').trim(),
    source: String(data.source ?? '').trim(),
    menuXpath: String(data.menuXpath ?? '').trim(),
    unmatchedFlag: data.unmatchedFlag ? 1 : 0,
    removedFlag: data.removedFlag ? 1 : 0,
  };
  if (!insert.systemId) {
    const { randomUUID } = await import('crypto');
    insert.systemId = randomUUID();
  }
  const [id] = await client(TABLE).insert(toDbRow(insert));
  return getById(id, client);
}

/**
 * Update a node by id (name/description/sortOrder; url only for systems) and return the updated entity.
 * @param {number} id 主键
 * @param {object} data partial camelCase node fields
 * @param {object|null} [db] optional knex instance
 * @returns {Promise<object|null>} updated API-shaped node entity
 */
export async function update(id, data, db = null) {
  const client = db || getDB();
  const existing = await getRawById(id, client);
  if (!existing) return null;

  const allowed = ['name', 'description', 'sortOrder'];
  allowed.push('umlEcd', 'pdCmptEcd', 'source', 'menuXpath', 'unmatchedFlag');
  allowed.push('removedFlag');
  if (existing.type === NODE_TYPE.SYSTEM) allowed.push('url');

  const patch = {};
  for (const key of allowed) {
    if (data && Object.prototype.hasOwnProperty.call(data, key) && data[key] !== undefined) {
      if (key === 'name') patch[key] = String(data[key]).trim();
      else if (key === 'url') patch[key] = String(data[key] ?? '').trim();
      else patch[key] = data[key];
    }
  }
  if (patch.unmatchedFlag !== undefined) patch.unmatchedFlag = patch.unmatchedFlag ? 1 : 0;
  if (patch.removedFlag !== undefined) patch.removedFlag = patch.removedFlag ? 1 : 0;
  if (patch.name !== undefined && !patch.name) {
    throw Object.assign(new Error('name is required'), { code: 'VALIDATION' });
  }
  if (!Object.keys(patch).length) return getById(id, client);
  await client(TABLE).where({ id }).update(toDbRow(patch));
  return getById(id, client);
}

/**
 * Delete a node by id; protects root and seed nodes.
 * @param {number} id 主键
 * @returns {Promise<number>} number of deleted rows
 */
export async function remove(id) {
  const row = await getRawById(id);
  if (!row) return 0;
  if (isRootNodeId(id) || row.uid === SEED_ROOT_ID || row.type === NODE_TYPE.ROOT) {
    const err = new Error('不能删除系统树根节点');
    err.code = 'SEED_PROTECTED';
    throw err;
  }
  const seedUuid = SEED_UUID_BY_TYPE[row.type];
  if (seedUuid && row.uid === seedUuid) {
    const err = new Error(`不能删除默认「未分类」${TYPE_LABEL[row.type] || '节点'}`);
    err.code = 'SEED_PROTECTED';
    throw err;
  }
  return getDB()(TABLE).where({ id }).del();
}

/**
 * Resolve the default seed function id (for trajectories without an explicit function).
 * @returns {Promise<number|null>} default function id or null when not found
 */
export async function getDefaultFunctionId() {
  const row = await getDB()(TABLE)
    .where({ type: NODE_TYPE.FUNCTION, system_id: SEED_FUNCTION_ID })
    .first('id');
  return row?.id || null;
}
