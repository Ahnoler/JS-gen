/**
 * Hierarchy JSON tree import: merge/append upsert of nodes by uid.
 */
import { randomUUID } from 'crypto';
import * as systemDao from '../dao/system-dao.js';
import {
  NODE_TYPE,
  TYPE_LABEL,
  ROOT_NODE_ID,
  SEED_SYSTEM_ID,
  SEED_MODULE_ID,
  SEED_FUNCTION_ID,
} from '../models/hierarchy-constants.js';
import { getTree } from './hierarchy-tree-query.js';

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
