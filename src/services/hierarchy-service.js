import { randomUUID } from 'crypto';
import * as systemDao from '../dao/system-dao.js';
import * as systemAccountDao from '../dao/system-account-dao.js';
import {
  NODE_TYPE,
  TYPE_LABEL,
  SEED_SYSTEM_ID,
  SEED_MODULE_ID,
  SEED_FUNCTION_ID,
} from '../models/hierarchy-constants.js';

const EXPORT_VERSION = 1;

/**
 * Full hierarchy tree: 系统 → 模块 → 功能 (+ accounts on type=0).
 */
export async function getTree({ includeAccounts = true } = {}) {
  const systems = await systemDao.list();
  const tree = [];
  for (const sys of systems) {
    const modules = await systemDao.listModules(sys.id);
    const moduleNodes = [];
    for (const mod of modules) {
      const functions = await systemDao.listFunctions(mod.id);
      moduleNodes.push({
        ...mod,
        children: functions,
        functions: functions.map((f) => ({
          id: f.id,
          functionId: f.functionId || f.uid,
          name: f.name,
          type: f.type,
          typeLabel: f.typeLabel,
          description: f.description,
          sortOrder: f.sortOrder,
        })),
      });
    }
    const node = {
      ...sys,
      children: moduleNodes,
      modules: moduleNodes,
      processes: moduleNodes,
    };
    if (includeAccounts) {
      const accounts = await systemAccountDao.listBySystem(sys.id);
      node.accounts = accounts.map((a) => ({
        id: a.id,
        name: a.name,
        loginUrl: a.loginUrl || '',
        username: a.username || '',
        password: a.password || '',
        remark: a.remark || null,
        sortOrder: a.sortOrder ?? 0,
      }));
    }
    tree.push(node);
  }
  return tree;
}

export async function createSystem(name, description) {
  return systemDao.create({
    type: NODE_TYPE.SYSTEM,
    parentId: null,
    name,
    description,
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
    const pid = parentId === null || parentId === 'null' ? null : +parentId;
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
    if (cur.parentId == null) break;
    cur = byId.get(cur.parentId);
  }
  return chain;
}

/**
 * Fuzzy search by name, then trace ancestry.
 * Example path: 信贷系统-对公客户管理模块-对公客户新增功能
 */
export async function searchNodes(keyword, { limit = 50 } = {}) {
  const q = String(keyword || '').trim();
  if (!q) {
    return { query: '', count: 0, results: [] };
  }
  const matched = await systemDao.searchByName(q, { limit });
  const all = await systemDao.listAllRaw();
  const byId = new Map(all.map((n) => [n.id, n]));

  const results = matched.map((m) => {
    const pathNodes = buildPath(m.id, byId);
    const display = (n) => {
      const label = TYPE_LABEL[n.type] || '';
      if (n.type === NODE_TYPE.SYSTEM) return n.name;
      if (label && n.name.endsWith(label)) return n.name;
      return `${n.name}${label}`;
    };
    const path = pathNodes.map(display).join('-');
    return {
      id: m.id,
      name: m.name,
      type: m.type,
      typeLabel: m.typeLabel || TYPE_LABEL[m.type],
      uid: m.uid || m.systemId,
      parentId: m.parentId,
      path,
      pathNodes,
    };
  });

  return { query: q, count: results.length, results };
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
      sortOrder: sys.sortOrder ?? 0,
      children,
    });
  }
  return {
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    typeMap: { 0: '系统', 1: '模块', 2: '功能' },
    nodes,
  };
}

/** Empty / sample template for import. */
export function getTreeTemplate() {
  return {
    version: EXPORT_VERSION,
    typeMap: { 0: '系统', 1: '模块', 2: '功能' },
    description: '将 nodes 填入后 POST /api/v2/system-mgmt/import。uid 可选；缺省自动生成。mode=merge 按 uid 合并，append 始终新建。',
    nodes: [
      {
        uid: '',
        type: 0,
        name: '示例系统',
        description: '',
        sortOrder: 0,
        children: [
          {
            uid: '',
            type: 1,
            name: '示例模块',
            description: '',
            sortOrder: 0,
            children: [
              {
                uid: '',
                type: 2,
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
    await upsertNode(root, null, NODE_TYPE.SYSTEM);
  }

  return { mode, ...stats, tree: await getTree({ includeAccounts: false }) };
}
