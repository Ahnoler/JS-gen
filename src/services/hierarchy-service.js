/**
 * Hierarchy tree service: root → system → module → function tree CRUD,
 * account sync, search, and JSON/Excel import/export re-exports.
 */
import { getDB } from '../../config/database.js';
import * as systemDao from '../dao/system-dao.js';
import * as systemAccountDao from '../dao/system-account-dao.js';
import { MASKED_PASSWORD, maskAccountPassword } from '../dao/system-account-dao.js';
import * as trajectoryDao from '../dao/trajectory-dao.js';
import {
  NODE_TYPE,
  ROOT_NODE_ID,
} from '../models/hierarchy-constants.js';

export {
  exportTree,
  getTreeTemplate,
  getTreeTemplateExcel,
  exportTreeExcel,
  importTreeExcel,
} from './hierarchy-excel.js';

export {
  getTree,
  ensureRootTree,
  nestToChildrenTree,
  resolveAncestorSystemId,
  buildPath,
} from './hierarchy-tree-query.js';

export { importTree } from './hierarchy-tree-import.js';

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
      throw Object.assign(new Error(`同一系统下角色名称不能重复：「${name}」`), { code: 'VALIDATION' });
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

/**
 * Reject writes that claim a name still held by another existing account row.
 * @param {Array<{id: number|string, name: string}>} existing rows for this system
 * @param {Array<{targetId: number|null, name: string}>} resolved planned writes
 * @returns {void}
 */
export function assertAccountNamesAvailable(existing, resolved) {
  const key = (name) => String(name || '').trim().toLocaleLowerCase();
  for (const item of resolved) {
    const nameKey = key(item.name);
    const holder = (existing || []).find((row) => key(row.name) === nameKey);
    if (!holder) continue;
    const holderId = Number(holder.id);
    const selfId = item.targetId == null ? null : Number(item.targetId);
    if (selfId != null && holderId === selfId) continue;
    throw Object.assign(
      new Error(
        `角色名称「${item.name}」已被占用。若要对调，请先将其中一条改为临时名称后再提交。`,
      ),
      { code: 'VALIDATION' },
    );
  }
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

  const resolved = [];
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
    resolved.push({
      item,
      target,
      targetId: target ? Number(target.id) : null,
      name: item.name,
    });
  }
  assertAccountNamesAvailable(existing, resolved);

  const touchedIds = new Set();

  for (const { item, target } of resolved) {
    const data = {
      name: item.name,
      loginUrl: item.loginUrl,
      account: item.account,
      password: item.password,
      remark: item.remark,
      sortOrder: item.sortOrder,
    };
    // 哨兵 '******' 表示前端未修改密码（掩码原样回传）：
    // 更新已有账号 → 跳过 password 字段，保持库中原值；
    // 新建账号 → 视为空密码。空字符串语义不变（更新即清空）。
    if (item.password === MASKED_PASSWORD) {
      if (target) delete data.password;
      else data.password = '';
    }

    let saved;
    try {
      saved = target
        ? await systemAccountDao.update(target.id, data, trx)
        : await systemAccountDao.create({ systemId: Number(systemId), ...data }, trx);
    } catch (err) {
      if (err?.errno === 1062 || err?.code === 'ER_DUP_ENTRY') {
        throw Object.assign(
          new Error(
            `同一系统下角色名称「${item.name}」已存在，请修改后再提交。若要对调两条账号，请先将其中一条改为临时名称。`,
          ),
          { code: 'CONFLICT' },
        );
      }
      throw err;
    }
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
    node.accounts = accounts.map((a) => maskAccountPassword({
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
export async function listNodes({ type, parentId, includeIntermediate = false } = {}) {
  let rows;
  if (type != null && type !== '') {
    const t = Number(type);
    if (parentId === '' || parentId === undefined) {
      if (t === NODE_TYPE.SYSTEM) rows = await systemDao.list();
      else rows = await systemDao.listByType(t, {});
    } else {
      const pid = parentId === null || parentId === 'null' || parentId === '0'
        ? ROOT_NODE_ID
        : +parentId;
      rows = await systemDao.listByType(t, { parentId: pid });
    }
  } else if (parentId != null && parentId !== '') {
    rows = await systemDao.listByParent(+parentId);
  } else {
    rows = await systemDao.listAllRaw();
  }
  if (includeIntermediate) return rows;
  return (rows || []).filter((n) => Number(n.intermediateFlag) !== 1);
}
