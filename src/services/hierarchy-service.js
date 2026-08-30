/**
 * Hierarchy tree service: root → system → module → function tree CRUD,
 * account sync, search, and JSON/Excel import/export re-exports.
 */
import { randomUUID } from 'crypto';
import { getDB } from '../../config/database.js';
import * as systemDao from '../dao/system-dao.js';
import * as systemAccountDao from '../dao/system-account-dao.js';
import * as trajectoryDao from '../dao/trajectory-dao.js';
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

export {
  exportTree,
  getTreeTemplate,
  getTreeTemplateExcel,
  exportTreeExcel,
  importTreeExcel,
} from './hierarchy-excel.js';

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
 * Create a system node under the root.
 * @param {string} name system name
 * @param {string} [description] description
 * @param {string} [url] system URL
 * @returns {Promise<object>} created system node
 */
export async function createSystem(name, description, url = '') {
  return systemDao.create({
    type: NODE_TYPE.SYSTEM,
    parentId: ROOT_NODE_ID,
    name,
    description,
    url,
  });
}

/**
 * Update a node by id with a partial patch.
 * @param {number} id node id
 * @param {object} patch fields to update
 * @returns {Promise<object|null>} updated node, or null if not found
 */
export async function updateSystem(id, patch) {
  return systemDao.update(id, patch);
}

/**
 * Legacy alias for createModule.
 * @param {number|string} systemId parent system id
 * @param {string} name module name
 * @param {string} [description] description
 * @param {number} [sortOrder] sort order
 * @returns {Promise<object>} created module node
 */
export async function createProcess(systemId, name, description, sortOrder) {
  return createModule(systemId, name, description, sortOrder);
}

/**
 * Create a module node under a system.
 * @param {number|string} systemId parent system id
 * @param {string} name module name
 * @param {string} [description] description
 * @param {number} [sortOrder] sort order
 * @returns {Promise<object>} created module node
 */
export async function createModule(systemId, name, description, sortOrder) {
  return systemDao.create({
    type: NODE_TYPE.MODULE,
    parentId: +systemId,
    name,
    description,
    sortOrder: sortOrder ?? 0,
  });
}

/**
 * Create a function node under a module.
 * @param {number|string} moduleId parent module id
 * @param {string} name function name
 * @param {string} [description] description
 * @param {number} [sortOrder] sort order
 * @returns {Promise<object>} created function node
 */
export async function createFunction(moduleId, name, description, sortOrder) {
  return systemDao.create({
    type: NODE_TYPE.FUNCTION,
    parentId: +moduleId,
    name,
    description,
    sortOrder: sortOrder ?? 0,
  });
}

/**
 * Normalize/validate the `accounts` array accepted by node POST/PUT.
 * @param {Array} input raw accounts array
 * @returns {Array} normalized account objects
 */
export function normalizeSystemAccounts(input) {
  if (!Array.isArray(input)) {
    throw Object.assign(new Error('accounts 必须是数组'), { code: 'VALIDATION' });
  }

  const seenNames = new Set();
  const seenIds = new Set();
  return input.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw Object.assign(new Error(`accounts[${index}] 必须是对象`), { code: 'VALIDATION' });
    }

    const name = String(item.name ?? '').trim();
    if (!name) {
      throw Object.assign(new Error(`accounts[${index}].name is required`), { code: 'VALIDATION' });
    }
    const nameKey = name.toLocaleLowerCase();
    if (seenNames.has(nameKey)) {
      throw Object.assign(new Error(`accounts 存在重复名称：${name}`), { code: 'VALIDATION' });
    }
    seenNames.add(nameKey);

    const id = item.id != null ? Number(item.id) : undefined;
    if (id !== undefined && (!Number.isFinite(id) || id <= 0)) {
      throw Object.assign(new Error(`accounts[${index}].id 无效`), { code: 'VALIDATION' });
    }
    if (id !== undefined) {
      if (seenIds.has(id)) {
        throw Object.assign(new Error(`accounts 存在重复 id：${id}`), { code: 'VALIDATION' });
      }
      seenIds.add(id);
    }

    const sortOrder = item.sortOrder == null ? index : Number(item.sortOrder);
    if (!Number.isFinite(sortOrder)) {
      throw Object.assign(new Error(`accounts[${index}].sortOrder 无效`), { code: 'VALIDATION' });
    }

    return {
      id,
      name,
      account: stringifyCredential(item.account).trim(),
      password: stringifyCredential(item.password),
      loginUrl: String(item.loginUrl ?? '').trim(),
      remark: item.remark ?? null,
      sortOrder,
    };
  });
}

function stringifyCredential(value) {
  if (value === undefined || value === null) return '';
  if (typeof value === 'object') return '';
  return String(value);
}

function assertAccountsForSystem(nodeType, accounts) {
  if (accounts !== undefined && accounts !== null && Number(nodeType) !== NODE_TYPE.SYSTEM) {
    throw Object.assign(new Error('accounts 仅支持 type=1（系统）节点'), { code: 'VALIDATION' });
  }
}

async function syncSystemAccounts(systemId, normalized, trx) {
  const existing = await systemAccountDao.listBySystem(systemId, trx);
  const key = (name) => String(name || '').trim().toLocaleLowerCase();
  const byId = new Map(existing.map((a) => [Number(a.id), a]));
  const byName = new Map(existing.map((a) => [key(a.name), a]));

  const touchedIds = new Set();

  for (const item of normalized) {
    let target = null;
    if (item.id !== undefined) {
      target = byId.get(item.id);
      if (!target || Number(target.systemId) !== Number(systemId)) {
        throw Object.assign(
          new Error(`accounts 中 id=${item.id} 不存在或不属于当前系统`),
          { code: 'VALIDATION' },
        );
      }
    } else {
      target = byName.get(key(item.name));
    }

    const data = {
      name: item.name,
      loginUrl: item.loginUrl,
      account: item.account,
      password: item.password,
      remark: item.remark,
      sortOrder: item.sortOrder,
    };

    const saved = target
      ? await systemAccountDao.update(target.id, data, trx)
      : await systemAccountDao.create({ systemId: Number(systemId), ...data }, trx);
    touchedIds.add(Number(saved.id));
  }

  for (const cur of existing) {
    if (touchedIds.has(Number(cur.id))) continue;
    try {
      await systemAccountDao.remove(cur.id, trx);
    } catch (err) {
      if (err?.errno === 1451 || err?.code === 'ER_ROW_IS_REFERENCED_2') {
        throw Object.assign(
          new Error(`账号「${cur.name}」已被批量录制任务引用，无法删除`),
          { code: 'CONFLICT' },
        );
      }
      throw err;
    }
  }

  return systemAccountDao.listBySystem(systemId, trx);
}

/**
 * Unified create: body.type + parentId + name…；type=1 可同时创建 accounts[]。
 * @param {object} input node fields (+ optional accounts[] for type=1)
 * @returns {Promise<object>} created node (with accounts when provided)
 */
export async function createNode(input = {}) {
  const { accounts, ...nodeInput } = input;
  assertAccountsForSystem(nodeInput.type, accounts);
  const hasAccounts = accounts !== undefined && accounts !== null;
  const normalized = hasAccounts ? normalizeSystemAccounts(accounts) : null;
  if (!normalized) return systemDao.create(nodeInput);

  return getDB().transaction(async (trx) => {
    const node = await systemDao.create(nodeInput, trx);
    node.accounts = await syncSystemAccounts(node.id, normalized, trx);
    return node;
  });
}

/**
 * Update a node by id; type=1 may also sync accounts[] in one transaction.
 * @param {number} id node id
 * @param {object} [patch] fields to update (+ optional accounts[])
 * @returns {Promise<object|null>} updated node, or null if not found
 */
export async function updateNode(id, patch = {}) {
  const existing = await systemDao.getById(id);
  if (!existing) return null;

  const { accounts, ...nodePatch } = patch;
  assertAccountsForSystem(existing.type, accounts);
  const hasAccounts = accounts !== undefined && accounts !== null;
  const normalized = hasAccounts ? normalizeSystemAccounts(accounts) : null;
  if (!normalized) return systemDao.update(id, nodePatch);

  return getDB().transaction(async (trx) => {
    const node = await systemDao.update(id, nodePatch, trx);
    if (!node) return null;
    node.accounts = await syncSystemAccounts(node.id, normalized, trx);
    return node;
  });
}

/**
 * Delete a node by id.
 * @param {number} id node id
 * @returns {Promise<number>} rows deleted
 */
export async function deleteNode(id) {
  await assertNodeHasNoTransaction(id);
  return systemDao.remove(id);
}

/**
 * 校验节点及其子树下不存在交易，存在则抛 VALIDATION。
 * @param {number} id 节点 id
 * @returns {Promise<void>} 通过时不返回值
 * @throws {{ code: 'VALIDATION' }} 子树下存在交易时抛出
 */
export async function assertNodeHasNoTransaction(id) {
  const node = await systemDao.getRawById(Number(id));
  if (!node) return;
  const ids = [Number(node.id)];
  if (Number(node.type) === 1 || Number(node.type) === 2) {
    const children = await systemDao.listByParent(node.id);
    for (const child of children) {
      ids.push(Number(child.id));
      if (Number(child.type) === 2) {
        const grandchildren = await systemDao.listByParent(child.id);
        for (const gc of grandchildren) ids.push(Number(gc.id));
      }
    }
  }
  const count = await trajectoryDao.countByFunctionIds(ids);
  if (count > 0) {
    throw Object.assign(new Error('当前节点下存在交易数据，不允许删除！'), { code: 'VALIDATION' });
  }
}

/**
 * Get a single node by id; system nodes (type=1) are enriched with accounts[].
 * @param {number} id node id
 * @returns {Promise<object|null>} node row (with accounts for systems), or null
 */
export async function getNode(id) {
  const node = await systemDao.getById(id);
  if (node && Number(node.type) === NODE_TYPE.SYSTEM) {
    // 详情回显系统账号（与 getTree includeAccounts 同形状），供编辑表单回显
    const accounts = await systemAccountDao.listBySystem(node.id);
    node.accounts = accounts.map((a) => ({
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
  return node;
}

/**
 * List nodes by type and/or parentId (flat list, not nested).
 * @param {{ type?: number|string, parentId?: number|string|null }} [opts] filter options
 * @returns {Promise<object[]>} matching node rows
 */
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

/**
 * Import tree.
 * @param {{ nodes?: Array, mode?: 'merge'|'append' }} payload import payload
 *   mode=merge: upsert by uid; append: always insert new uuids
 * @returns {Promise<{ mode: string, created: number, updated: number, skipped: number, tree: object[] }>} import stats + rebuilt tree
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
