/**
 * Hierarchy tree query helpers: tree fetching, root shape guarantee,
 * nesting, ancestor resolution, and path building.
 */
import * as systemDao from '../dao/system-dao.js';
import * as systemAccountDao from '../dao/system-account-dao.js';
import {
  NODE_TYPE,
  TYPE_LABEL,
  ROOT_NODE_ID,
  isRootParentId,
  isRootNodeId,
} from '../models/hierarchy-constants.js';

/**
 * Hierarchy tree under sentinel root id=0：根 → 系统 → 模块 → 功能（children[]）。
 * 支持名称模糊（HTTP name → keyword）与 type 筛选；筛选时保留祖先，且始终带上根节点。
 * 有关键词时，命中节点附带 path（不含根名「根」）。
 * 可选在 type=1 系统节点上附带 accounts。
 * @param {{ includeAccounts?: boolean, keyword?: string, type?: number|string, limit?: number }} [opts] tree filter options
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
    // W5-C 批量：一次 listBySystemIds 取回全部系统账号（每系统 1 次 → 1 次）。
    const systemIds = nodes
      .filter((n) => n.type === NODE_TYPE.SYSTEM)
      .map((n) => Number(n.id));
    const accounts = systemIds.length ? await systemAccountDao.listBySystemIds(systemIds) : [];
    const accountsBySystem = new Map();
    for (const a of accounts) {
      const key = Number(a.systemId);
      if (!accountsBySystem.has(key)) accountsBySystem.set(key, []);
      accountsBySystem.get(key).push(a);
    }
    for (const node of nodes) {
      if (node.type !== NODE_TYPE.SYSTEM) continue;
      node.accounts = (accountsBySystem.get(Number(node.id)) || []).map((a) => ({
        id: a.id,
        systemId: a.systemId,
        name: a.name,
        loginUrl: a.loginUrl || '',
        account: a.account || '',
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
 * @param {object[]} [tree] nested tree nodes
 * @returns {Promise<object[]>} length-1 array rooted at the sentinel root node
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
 * @param {object[]} nodes flat node list
 * @returns {object[]} nested tree with children[] (no legacy aliases)
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

/**
 * Walk parent_id upward until a type=1 系统 node is found.
 * Returns that system id, or null if the chain is broken / not under a system.
 * @param {number|string} nodeId starting node id
 * @returns {Promise<number|null>} ancestor system id, or null if chain breaks
 */
export async function resolveAncestorSystemId(nodeId) {
  const startId = Number(nodeId);
  if (!Number.isFinite(startId) || startId <= 0) return null;
  const guard = new Set();
  let curId = startId;
  while (Number.isFinite(curId) && curId > 0 && !guard.has(curId)) {
    guard.add(curId);
    const node = await systemDao.getRawById(curId);
    if (!node) return null;
    if (Number(node.type) === NODE_TYPE.SYSTEM) return Number(node.id);
    if (isRootNodeId(node.id)) return null;
    if (isRootParentId(node.parentId)) return null;
    curId = Number(node.parentId);
  }
  return null;
}

/**
 * Build ancestry chain root → … → node (inclusive).
 * @param {number|string} nodeId target node id
 * @param {Map<number, object>} byId node map keyed by id
 * @returns {object[]} ancestry chain (root-first, inclusive of target)
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
