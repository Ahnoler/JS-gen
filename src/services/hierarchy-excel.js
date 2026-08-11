/**
 * Hierarchy tree export/import: portable JSON (uid) export, JSON template,
 * Excel template / export / import. Extracted from hierarchy-service.js —
 * move-only, no logic changes.
 */
import { randomUUID } from 'crypto';
import * as systemDao from '../dao/system-dao.js';
import {
  NODE_TYPE,
  TYPE_LABEL,
  ROOT_NODE_ID,
  isRootParentId,
  isRootNodeId,
} from '../models/hierarchy-constants.js';
import * as systemMgmtExcel from './system-mgmt-excel.js';
import { getTree } from './hierarchy-service.js';

const EXPORT_VERSION = 1;

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

/** Empty / sample template for import (legacy JSON shape; prefer Excel endpoints). */
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

/** Excel template (.xlsx Buffer). */
export async function getTreeTemplateExcel() {
  return systemMgmtExcel.buildExcelBuffer(systemMgmtExcel.sampleTemplateRows());
}

/** Export whole tree as Excel (.xlsx Buffer). */
export async function exportTreeExcel() {
  const data = await exportTree();
  const rows = systemMgmtExcel.flattenNodesToRows(data.nodes || []);
  return systemMgmtExcel.buildExcelBuffer(rows);
}

/**
 * Import tree from Excel buffer (flat rows with parent path).
 * @param {Buffer|ArrayBuffer|Uint8Array} buffer
 * @param {{ mode?: 'merge'|'append' }} [opts]
 */
export async function importTreeExcel(buffer, { mode: modeOpt } = {}) {
  const mode = modeOpt === 'append' ? 'append' : 'merge';
  const rows = await systemMgmtExcel.parseExcelBuffer(buffer);
  const stats = { created: 0, updated: 0, skipped: 0 };

  /** @type {Map<string, number>} path -> db id */
  const pathToId = new Map();

  // Seed existing tree paths so merge can attach under existing parents
  const all = await systemDao.listAll();
  const byId = new Map(all.map((n) => [Number(n.id), n]));
  for (const n of all) {
    if (isRootNodeId(n.id) || n.type === NODE_TYPE.ROOT) continue;
    const parts = [];
    let cur = n;
    const guard = new Set();
    while (cur && !isRootNodeId(cur.id) && cur.type !== NODE_TYPE.ROOT && !guard.has(cur.id)) {
      guard.add(cur.id);
      parts.unshift(String(cur.name || '').trim());
      const pid = isRootParentId(cur.parentId) ? ROOT_NODE_ID : Number(cur.parentId);
      cur = byId.get(pid);
    }
    if (parts.length) pathToId.set(parts.join('/'), Number(n.id));
  }

  for (const row of rows) {
    const parentParts = systemMgmtExcel.splitParentPath(row.parentPath);
    let parentId = ROOT_NODE_ID;
    if (parentParts.length) {
      const parentKey = parentParts.join('/');
      const pid = pathToId.get(parentKey);
      if (pid == null) {
        throw Object.assign(
          new Error(`第 ${row.rowNumber} 行找不到父节点路径「${parentKey}」`),
          { code: 'VALIDATION' },
        );
      }
      parentId = pid;
    }

    const selfPath = [...parentParts, row.name].join('/');
    const siblings = await systemDao.listByParent(parentId);
    const existing = siblings.find(
      (s) => s.type === row.type && String(s.name || '').trim() === row.name,
    );

    let saved;
    if (existing && mode === 'merge') {
      saved = await systemDao.update(existing.id, {
        name: row.name,
        description: row.description || existing.description,
        ...(row.type === NODE_TYPE.SYSTEM ? { url: row.url || existing.url || '' } : {}),
      });
      stats.updated += 1;
    } else if (existing && mode === 'append') {
      // Same name under parent already exists — create with new uuid still uses same name (allowed)
      saved = await systemDao.create({
        systemId: randomUUID(),
        type: row.type,
        parentId,
        name: row.name,
        description: row.description || null,
        url: row.type === NODE_TYPE.SYSTEM ? (row.url || '') : '',
        sortOrder: existing.sortOrder ?? 0,
      });
      stats.created += 1;
    } else {
      saved = await systemDao.create({
        systemId: randomUUID(),
        type: row.type,
        parentId,
        name: row.name,
        description: row.description || null,
        url: row.type === NODE_TYPE.SYSTEM ? (row.url || '') : '',
        sortOrder: 0,
      });
      stats.created += 1;
    }

    pathToId.set(selfPath, Number(saved.id));
  }

  return { mode, ...stats, tree: await getTree({ includeAccounts: false }) };
}
