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

/** Raw camelCase row without API aliases (for ancestry maps). */
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
  };
}

/** Map DB row → API-shaped node (keeps processId/functionId/moduleId aliases for UI). */
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

/** List root systems (type=1, parent_id=0). */
export async function list() {
  return listByType(NODE_TYPE.SYSTEM, { parentId: ROOT_NODE_ID });
}

export async function listAllRaw() {
  const rows = await getDB()(TABLE).orderBy([
    { column: 'type', order: 'asc' },
    { column: 'sort_order', order: 'asc' },
    { column: 'id', order: 'asc' },
  ]);
  return rows.map(fromRaw);
}

/** All hierarchy nodes as API-shaped flat list (parentId links). */
export async function listAll() {
  return listFiltered({});
}

/**
 * Flat list with optional filters.
 * @param {{ type?: number|string, keyword?: string, limit?: number }} [opts]
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

export async function listByParent(parentId) {
  let q = getDB()(TABLE);
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

export async function listProcesses(systemId) {
  return listByType(NODE_TYPE.MODULE, { parentId: systemId });
}

export async function listModules(systemId) {
  return listProcesses(systemId);
}

export async function listFunctions(moduleId) {
  return listByType(NODE_TYPE.FUNCTION, { parentId: moduleId });
}

export async function getById(id) {
  const row = await getDB()(TABLE).where({ id }).first();
  return shapeNode(row);
}

export async function getRawById(id) {
  const row = await getDB()(TABLE).where({ id }).first();
  return fromRaw(row);
}

export async function getByUuid(systemId) {
  const row = await getDB()(TABLE).where({ system_id: systemId }).first();
  return shapeNode(row);
}

/** Fuzzy match on name; returns shaped nodes. */
export async function searchByName(keyword, { limit = 50 } = {}) {
  const q = String(keyword || '').trim();
  if (!q) return [];
  const rows = await getDB()(TABLE)
    .where('name', 'like', `%${q}%`)
    .orderBy([{ column: 'type', order: 'asc' }, { column: 'id', order: 'asc' }])
    .limit(Math.min(200, Math.max(1, limit)));
  return shapeNodes(rows);
}

export async function create(data) {
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
    const parent = await getRawById(parentId);
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
  };
  if (!insert.systemId) {
    const { randomUUID } = await import('crypto');
    insert.systemId = randomUUID();
  }
  const [id] = await getDB()(TABLE).insert(toDbRow(insert));
  return getById(id);
}

export async function update(id, data) {
  const existing = await getRawById(id);
  if (!existing) return null;

  const allowed = ['name', 'description', 'sortOrder'];
  if (existing.type === NODE_TYPE.SYSTEM) allowed.push('url');

  const patch = {};
  for (const key of allowed) {
    if (data && Object.prototype.hasOwnProperty.call(data, key) && data[key] !== undefined) {
      if (key === 'name') patch[key] = String(data[key]).trim();
      else if (key === 'url') patch[key] = String(data[key] ?? '').trim();
      else patch[key] = data[key];
    }
  }
  if (patch.name !== undefined && !patch.name) {
    throw Object.assign(new Error('name is required'), { code: 'VALIDATION' });
  }
  if (!Object.keys(patch).length) return getById(id);
  await getDB()(TABLE).where({ id }).update(toDbRow(patch));
  return getById(id);
}

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

export async function getDefaultFunctionId() {
  const row = await getDB()(TABLE)
    .where({ type: NODE_TYPE.FUNCTION, system_id: SEED_FUNCTION_ID })
    .first('id');
  return row?.id || null;
}
