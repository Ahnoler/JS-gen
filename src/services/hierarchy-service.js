import { randomUUID } from 'crypto';
import * as systemDao from '../dao/system-dao.js';
import * as systemAccountDao from '../dao/system-account-dao.js';
import {
  NODE_TYPE,
  TYPE_LABEL,
  ROOT_NODE_ID,
  isRootParentId,
  isRootNodeId,
  SEED_SYSTEM_ID,
  SEED_MODULE_ID,
  SEED_FUNCTION_ID,
} from '../models/hierarchy-constants.js';

const EXPORT_VERSION = 1;

/**
 * Hierarchy tree under sentinel root id=0：根 → 系统 → 模块 → 功能（children[]）。
 * 支持名称模糊（HTTP name → keyword）与 type 筛选；筛选时保留祖先，且始终带上根节点。
 * 有关键词时，命中节点附带 path（不含根名「根」）。
 * 可选在 type=1 系统节点上附带 accounts。
 * @param {{ includeAccounts?: boolean, keyword?: string, type?: number|string, limit?: number }} [opts]
 * @returns {Promise<object[]>} 长度为 1 的数组：[{ id:0, type:0, children:[…] }]
 */
export async function getTree({
  includeAccounts = true,
  keyword,
  type,
  limit,
} = {}) {
  const kw = String(keyword || '').trim();
  const typeFilter = type !== undefined && type !== null && type !== ''
    ? Number(type)
    : undefined;
  if (typeFilter != null && Number.isFinite(typeFilter)) {
    assertTypeFilter(typeFilter);
  }

  const allNodes = await systemDao.listAll();
  let nodes = allNodes;
  const matchedIds = new Set();

  if (kw || typeFilter != null) {
    const matched = await systemDao.listFiltered({
      type: typeFilter,
      keyword: kw || undefined,
      limit: kw ? (limit ?? 50) : limit,
    }).then((rows) => rows.filter((n) => !isRootNodeId(n.id)));

    for (const m of matched) matchedIds.add(Number(m.id));

    const allRaw = await systemDao.listAllRaw();
    const byId = new Map(allRaw.map((n) => [n.id, n]));
    const keep = new Set([ROOT_NODE_ID]);
    for (const m of matched) {
      let cur = byId.get(m.id);
      const guard = new Set();
      while (cur && !guard.has(cur.id)) {
        guard.add(cur.id);
        keep.add(cur.id);
        if (isRootNodeId(cur.id)) break;
        if (isRootParentId(cur.parentId) && !byId.has(cur.parentId)) break;
        cur = byId.get(cur.parentId);
      }
    }
    nodes = allNodes.filter((n) => keep.has(Number(n.id)));

    if (kw) {
      for (const n of nodes) {
        if (!matchedIds.has(Number(n.id))) continue;
        n.path = formatPath(buildPath(n.id, byId));
      }
    }
  }

  if (includeAccounts) {
    for (const node of nodes) {
      if (node.type !== NODE_TYPE.SYSTEM) continue;
      const accounts = await systemAccountDao.listBySystem(node.id);
      node.accounts = accounts.map((a) => ({
        id: a.id,
        systemId: a.systemId,
        name: a.name,
        loginUrl: a.loginUrl || '',
        username: a.username || '',
        password: a.password || '',
        remark: a.remark || null,
        sortOrder: a.sortOrder ?? 0,
      }));
    }
  }

  return ensureRootTree(nestToChildrenTree(nodes));
}

/**
 * Guarantee API shape: data = [{ id:0, type:0, children:[…] }].
 */
export async function ensureRootTree(tree = []) {
  const list = Array.isArray(tree) ? tree : [];
  if (list.length === 1 && isRootNodeId(list[0].id)) {
    list[0].children = list[0].children || [];
    return list;
  }

  let rootNode = list.find((n) => isRootNodeId(n.id));
  const others = list.filter((n) => !isRootNodeId(n.id));
  if (!rootNode) {
    const fromDb = await systemDao.getById(ROOT_NODE_ID);
    rootNode = fromDb
      ? { ...fromDb, children: [] }
      : {
        id: ROOT_NODE_ID,
        type: NODE_TYPE.ROOT,
        typeLabel: TYPE_LABEL[NODE_TYPE.ROOT],
        parentId: ROOT_NODE_ID,
        name: '根',
        description: '系统树根节点（不可删除）',
        url: '',
        sortOrder: 0,
        children: [],
      };
  }
  rootNode.children = [
    ...(rootNode.children || []),
    ...others,
  ];
  return [rootNode];
}

function assertTypeFilter(t) {
  if (![NODE_TYPE.SYSTEM, NODE_TYPE.MODULE, NODE_TYPE.FUNCTION].includes(t)) {
    const err = new Error('type 须为 1=系统 / 2=模块 / 3=功能');
    err.code = 'VALIDATION';
    throw err;
  }
}

function formatPath(pathNodes) {
  const display = (n) => {
    const label = TYPE_LABEL[n.type] || '';
    if (n.type === NODE_TYPE.SYSTEM) return n.name;
    if (label && n.name.endsWith(label)) return n.name;
    return `${n.name}${label}`;
  };
  return pathNodes
    .filter((n) => n.type !== NODE_TYPE.ROOT && !isRootNodeId(n.id))
    .map(display)
    .join('-');
}

/**
 * Nest flat nodes into a children[] tree only (no modules/functions aliases).
 * @param {object[]} nodes
 * @returns {object[]}
 */
export function nestToChildrenTree(nodes = []) {
  const byId = new Map();
  for (const n of nodes) {
    byId.set(Number(n.id), {
      ...n,
      children: [],
    });
  }
  const roots = [];
  for (const node of byId.values()) {
    // drop legacy nested aliases if present on copies
    delete node.modules;
    delete node.processes;
    delete node.functions;

    // id=0 根节点始终作为森林根（即使 parent_id 指向自身）
    if (isRootNodeId(node.id)) {
      roots.push(node);
      continue;
    }

    const pid = isRootParentId(node.parentId) ? ROOT_NODE_ID : Number(node.parentId);
    if (!byId.has(pid)) {
      roots.push(node);
      continue;
    }
    byId.get(pid).children.push(node);
  }
  // stable order within each children list
  const sortChildren = (list) => {
    list.sort((a, b) => (a.sortOrder - b.sortOrder) || (a.id - b.id));
    for (const c of list) sortChildren(c.children);
  };
  sortChildren(roots);
  return roots;
}

/** @deprecated use nestToChildrenTree */
export function nestFlatTree(nodes = []) {
  return nestToChildrenTree(nodes);
}

export async function createSystem(name, description, url = '') {
  return systemDao.create({
    type: NODE_TYPE.SYSTEM,
    parentId: ROOT_NODE_ID,
    name,
    description,
    url,
  });
}

export async function updateSystem(id, patch) {
  return systemDao.update(id, patch);
}

export async function createProcess(systemId, name, description, sortOrder) {
  return createModule(systemId, name, description, sortOrder);
}

export async function createModule(systemId, name, description, sortOrder) {
  return systemDao.create({
    type: NODE_TYPE.MODULE,
    parentId: +systemId,
    name,
    description,
    sortOrder: sortOrder ?? 0,
  });
}

export async function createFunction(moduleId, name, description, sortOrder) {
  return systemDao.create({
    type: NODE_TYPE.FUNCTION,
    parentId: +moduleId,
    name,
    description,
    sortOrder: sortOrder ?? 0,
  });
}

/** Unified create: body.type + parentId + name… */
export async function createNode(input = {}) {
  return systemDao.create(input);
}

export async function updateNode(id, patch) {
  const existing = await systemDao.getById(id);
  if (!existing) return null;
  return systemDao.update(id, patch);
}

export async function deleteNode(id) {
  return systemDao.remove(id);
}

export async function getNode(id) {
  return systemDao.getById(id);
}

export async function listNodes({ type, parentId } = {}) {
  if (type != null && type !== '') {
    const t = Number(type);
    if (parentId === '' || parentId === undefined) {
      if (t === NODE_TYPE.SYSTEM) return systemDao.list();
      return systemDao.listByType(t, {});
    }
    const pid = parentId === null || parentId === 'null' || parentId === '0'
      ? ROOT_NODE_ID
      : +parentId;
    return systemDao.listByType(t, { parentId: pid });
  }
  if (parentId != null && parentId !== '') {
    return systemDao.listByParent(+parentId);
  }
  return systemDao.listAllRaw();
}

/**
 * Build ancestry chain root → … → node (inclusive).
 */
export function buildPath(nodeId, byId) {
  const chain = [];
  let cur = byId.get(+nodeId);
  const guard = new Set();
  while (cur && !guard.has(cur.id)) {
    guard.add(cur.id);
    chain.unshift({
      id: cur.id,
      name: cur.name,
      type: cur.type,
      typeLabel: TYPE_LABEL[cur.type] || String(cur.type),
      uid: cur.uid,
    });
    if (isRootNodeId(cur.id)) break;
    if (isRootParentId(cur.parentId) && !byId.has(cur.parentId)) break;
    cur = byId.get(cur.parentId);
  }
  return chain;
}

/**
 * @deprecated 已合并进 getTree({ keyword, type })；保留兼容调用。
 */
export async function searchNodes(keyword, { limit = 50, type } = {}) {
  return getTree({
    includeAccounts: false,
    keyword,
    type,
    limit,
  });
}

/** Export tree as portable JSON (no DB ids; uses uid). */
export async function exportTree() {
  const systems = await systemDao.list();
  const nodes = [];
  for (const sys of systems) {
    const modules = await systemDao.listModules(sys.id);
    const children = [];
    for (const mod of modules) {
      const functions = await systemDao.listFunctions(mod.id);
      children.push({
        uid: mod.uid || mod.processId || mod.moduleId,
        type: NODE_TYPE.MODULE,
        name: mod.name,
        description: mod.description || '',
        sortOrder: mod.sortOrder ?? 0,
        children: functions.map((f) => ({
          uid: f.uid || f.functionId,
          type: NODE_TYPE.FUNCTION,
          name: f.name,
          description: f.description || '',
          sortOrder: f.sortOrder ?? 0,
          children: [],
        })),
      });
    }
    nodes.push({
      uid: sys.uid || sys.systemId,
      type: NODE_TYPE.SYSTEM,
      name: sys.name,
      description: sys.description || '',
      url: sys.url || '',
      sortOrder: sys.sortOrder ?? 0,
      children,
    });
  }
  return {
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    typeMap: { ...TYPE_LABEL },
    nodes,
  };
}

/** Empty / sample template for import. */
export function getTreeTemplate() {
  return {
    version: EXPORT_VERSION,
    typeMap: { ...TYPE_LABEL },
    description: '将 nodes 填入后 POST /api/v2/system-mgmt/import。uid 可选；缺省自动生成。mode=merge 按 uid 合并，append 始终新建。系统节点可带 url。',
    nodes: [
      {
        uid: '',
        type: NODE_TYPE.SYSTEM,
        name: '示例系统',
        description: '',
        url: 'https://example.com',
        sortOrder: 0,
        children: [
          {
            uid: '',
            type: NODE_TYPE.MODULE,
            name: '示例模块',
            description: '',
            sortOrder: 0,
            children: [
              {
                uid: '',
                type: NODE_TYPE.FUNCTION,
                name: '示例功能',
                description: '',
                sortOrder: 0,
                children: [],
              },
            ],
          },
        ],
      },
    ],
  };
}

/**
 * Import tree.
 * @param {{ nodes?: Array, mode?: 'merge'|'append' }} payload
 * mode=merge: upsert by uid; append: always insert new uuids
 */
export async function importTree(payload = {}) {
  const mode = payload.mode === 'append' ? 'append' : 'merge';
  const roots = Array.isArray(payload.nodes) ? payload.nodes : [];
  if (!roots.length) {
    throw Object.assign(new Error('nodes 不能为空'), { code: 'VALIDATION' });
  }

  const stats = { created: 0, updated: 0, skipped: 0 };

  async function upsertNode(node, parentId, expectedType) {
    const type = Number(node.type);
    if (type !== expectedType) {
      throw Object.assign(
        new Error(`节点「${node.name}」type 应为 ${expectedType}（${TYPE_LABEL[expectedType]}），实际 ${type}`),
        { code: 'VALIDATION' },
      );
    }
    const name = String(node.name || '').trim();
    if (!name) {
      throw Object.assign(new Error('导入节点缺少 name'), { code: 'VALIDATION' });
    }

    let uid = String(node.uid || node.systemId || '').trim();
    if (mode === 'append' || !uid) uid = randomUUID();

    let existing = null;
    if (mode === 'merge' && node.uid) {
      existing = await systemDao.getByUuid(String(node.uid).trim());
    }

    let saved;
    if (existing && mode === 'merge') {
      if (existing.type !== type) {
        throw Object.assign(new Error(`uid=${node.uid} 已存在但 type 不一致`), { code: 'VALIDATION' });
      }
      saved = await systemDao.update(existing.id, {
        name,
        description: node.description ?? existing.description,
        sortOrder: node.sortOrder ?? existing.sortOrder,
        ...(type === NODE_TYPE.SYSTEM ? { url: node.url ?? existing.url ?? '' } : {}),
      });
      stats.updated += 1;
    } else {
      // Protect seed uuids from being overwritten with wrong structure on append
      if ([SEED_SYSTEM_ID, SEED_MODULE_ID, SEED_FUNCTION_ID].includes(uid) && mode === 'append') {
        uid = randomUUID();
      }
      saved = await systemDao.create({
        systemId: uid,
        type,
        parentId,
        name,
        description: node.description ?? null,
        url: type === NODE_TYPE.SYSTEM ? (node.url ?? '') : '',
        sortOrder: node.sortOrder ?? 0,
      });
      stats.created += 1;
    }

    const children = Array.isArray(node.children) ? node.children : [];
    const childType = type === NODE_TYPE.SYSTEM
      ? NODE_TYPE.MODULE
      : type === NODE_TYPE.MODULE
        ? NODE_TYPE.FUNCTION
        : null;
    if (childType != null) {
      for (const child of children) {
        await upsertNode(child, saved.id, childType);
      }
    } else if (children.length) {
      stats.skipped += children.length;
    }
    return saved;
  }

  for (const root of roots) {
    await upsertNode(root, ROOT_NODE_ID, NODE_TYPE.SYSTEM);
  }

  return { mode, ...stats, tree: await getTree({ includeAccounts: false }) };
}
