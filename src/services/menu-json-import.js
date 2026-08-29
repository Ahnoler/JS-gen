/**
 * 菜单 JSON 导入 service：解析被测系统《建模组件关系》JSON，
 * 建两级菜单树（模块/功能）并按 umlEcd 幂等 upsert，同步页面清单。
 */
import { getDB } from '../../config/database.js';
import * as systemDao from '../dao/system-dao.js';
import * as systemPageDao from '../dao/system-page-dao.js';
import * as systemMenuSnapshotDao from '../dao/system-menu-snapshot-dao.js';
import { getTree } from './hierarchy-service.js';

const NODE_TYPE_MODULE = 2;
const NODE_TYPE_FUNCTION = 3;

/**
 * 解析《建模组件关系》JSON，归一化顶层 umlRelInfo 数组。纯函数，不碰 DB。
 * @param {Buffer|string} buffer JSON 文件内容（Buffer 或字符串）
 * @returns {{ roots: object[] }} 顶层数组 roots
 * @throws {{ code: 'VALIDATION' }} JSON 格式不符或缺少 umlRelInfo 时抛出
 */
export function parseMenuJson(buffer) {
  const text = Buffer.isBuffer(buffer) ? buffer.toString('utf8') : String(buffer);
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw Object.assign(new Error('JSON 格式不符：缺少 umlRelInfo'), { code: 'VALIDATION' });
  }
  if (!payload || typeof payload !== 'object') {
    throw Object.assign(new Error('JSON 格式不符：缺少 umlRelInfo'), { code: 'VALIDATION' });
  }
  const rel = payload.umlRelInfo;
  if (rel == null || (typeof rel !== 'object' && !Array.isArray(rel))) {
    throw Object.assign(new Error('JSON 格式不符：缺少 umlRelInfo'), { code: 'VALIDATION' });
  }
  const roots = Array.isArray(rel) ? rel : [rel];
  return { roots };
}

/**
 * 收集一个节点直属活动（children 中 umlType='3'）的页面清单。
 * managePage 的 pdCmptEcd 非空才入页；guidePages 同理。同一节点内按 pageId 去重（保留首个）。
 * @param {object} node 子领域/模块节点
 * @returns {object[]} 页面对象数组（pageId/pageName/resPath/pageType）
 */
function collectPages(node) {
  const pages = [];
  const seen = new Set();
  const children = Array.isArray(node.children) ? node.children : [];
  for (const child of children) {
    if (String(child.umlType) !== '3') continue;
    const managePage = child.managePage;
    if (managePage && String(managePage.pdCmptEcd || '').trim()) {
      const pageId = String(managePage.pdCmptEcd).trim();
      if (!seen.has(pageId)) {
        seen.add(pageId);
        pages.push({
          pageId,
          pageName: String(managePage.pdCmptNm || '').trim(),
          resPath: String(managePage.resPath || '').trim(),
          pageType: 'managePage',
        });
      }
    }
    const guidePages = Array.isArray(child.guidePages) ? child.guidePages : [];
    for (const gp of guidePages) {
      const pageId = String(gp.pdCmptEcd || '').trim();
      if (!pageId) continue;
      if (seen.has(pageId)) continue;
      seen.add(pageId);
      pages.push({
        pageId,
        pageName: String(gp.pdCmptNm || '').trim(),
        resPath: '',
        pageType: 'guidePage',
      });
    }
  }
  return pages;
}

/**
 * 递归判断一个子领域节点是否为叶子（children 中没有 umlType='2' 子领域）。
 * @param {object} node 子领域节点
 * @returns {boolean} 是否叶子子领域
 */
function isLeafSubdomain(node) {
  const children = Array.isArray(node.children) ? node.children : [];
  return !children.some((c) => String(c.umlType) === '2');
}

/**
 * 递归遍历子领域树，压平中间层，将功能与直属页面挂到顶层祖先模块。
 * 顶层 umlType='2' 节点 → 模块；任意深度的叶子子领域 → 功能（挂到顶层模块）；
 * 中间层节点自身的直属活动页面并入其最近已建祖先（模块）的 pages。
 * @param {object[]} nodes 当前层的子领域节点
 * @param {object|null} ancestorModule 最近已建的顶层模块（顶层调用时为 null）
 * @param {object[]} modules 累积的模块结果数组
 */
function flattenSubdomains(nodes, ancestorModule, modules) {
  for (const node of nodes) {
    if (String(node.umlType) !== '2') continue;
    const seqNo = Number(node.seqNo) || 0;
    const name = String(node.umlNm || '').trim();
    const umlEcd = String(node.umlEcd || '').trim();
    const nodePages = collectPages(node);

    const isTopLevel = ancestorModule === null;
    if (isTopLevel) {
      // 顶层子领域 → 模块；若自身也是叶子，pages 挂模块自己身上
      const moduleObj = {
        umlEcd,
        name,
        seqNo,
        functions: [],
        pages: nodePages,
      };
      modules.push(moduleObj);
      const children = Array.isArray(node.children) ? node.children : [];
      const subChildren = children.filter((c) => String(c.umlType) === '2');
      if (subChildren.length) {
        // 有子领域 → 递归，中间层/叶子的页面归本模块
        flattenSubdomains(subChildren, moduleObj, modules);
      }
      // 无子领域（顶层即叶子）：functions 为空，pages 已挂模块自身，无需再递归
    } else if (isLeafSubdomain(node)) {
      // 叶子子领域 → 功能，挂到顶层祖先模块
      ancestorModule.functions.push({
        umlEcd,
        name,
        seqNo,
        pages: nodePages,
      });
    } else {
      // 中间层非叶子：不建节点；自身直属活动页面并入最近已建祖先（模块）
      if (nodePages.length) {
        ancestorModule.pages.push(...nodePages);
      }
      const children = Array.isArray(node.children) ? node.children : [];
      const subChildren = children.filter((c) => String(c.umlType) === '2');
      flattenSubdomains(subChildren, ancestorModule, modules);
    }
  }
}

/**
 * 根据 parseMenuJson 的 roots 构建导入计划（模块→功能→页面）。纯函数，不碰 DB。
 * @param {{ roots: object[] }} parsed parseMenuJson 的返回值
 * @returns {{ modules: Array<{ umlEcd: string, name: string, seqNo: number, functions: Array<{ umlEcd: string, name: string, seqNo: number, pages: object[] }>, pages: object[] }> }} 导入计划
 */
export function buildImportJsonPlan({ roots }) {
  const modules = [];
  const topNodes = Array.isArray(roots) ? roots : [];
  flattenSubdomains(topNodes, null, modules);
  return { modules };
}

/**
 * 导入菜单 JSON：解析 + 构建计划 + 事务内 upsert 节点与页面，最后重建树。
 *
 * 规则5.1：事务内、预加载既有子树完成后（upsert 前）落一版整树历史快照。
 * 规则5.8：消失标记之后，对子树无交易的节点物理删除（含 system_page CASCADE），
 *          先删功能再按"无 children + 自身 unmatched + 子树无交易"清理模块。
 * @param {number|string} systemNodeId 目标系统节点 id（必须 type=1）
 * @param {Buffer|string} buffer JSON 文件内容
 * @returns {Promise<{ created: number, updated: number, adopted: number, markedUnmatched: number, pagesImported: number, snapshotVersion: number, deleted: number, migratedNodes: number, migratedTransactions: number, tree: object[] }>} 导入统计与重建后的树；migratedNodes/migratedTransactions 为规则5.3/5.4 迁移计数
 * @throws {{ code: 'VALIDATION' }} 目标节点不存在或非系统类型时抛出
 */
export async function importMenuJson(systemNodeId, buffer) {
  const { roots } = parseMenuJson(buffer);
  const plan = buildImportJsonPlan({ roots });

  const target = await systemDao.getRawById(Number(systemNodeId));
  if (!target || Number(target.type) !== 1) {
    throw Object.assign(new Error('目标节点必须是系统（type=1）'), { code: 'VALIDATION' });
  }

  const stats = { created: 0, updated: 0, adopted: 0, markedUnmatched: 0, pagesImported: 0, deleted: 0, migratedNodes: 0, migratedTransactions: 0 };

  await getDB().transaction(async (trx) => {
    // 预加载既有子树：模块 + 模块下功能，建两个查重索引
    const byUmlEcd = new Map();
    const childIndex = new Map();
    const existingModules = await systemDao.listByParent(target.id, trx);
    for (const mod of existingModules) {
      if (String(mod.umlEcd || '').trim()) {
        byUmlEcd.set(String(mod.umlEcd).trim(), mod);
      }
      childIndex.set(`${target.id}|${Number(mod.type)}|${String(mod.name || '').trim().toLowerCase()}`, mod);
      const existingFunctions = await systemDao.listByParent(mod.id, trx);
      for (const fn of existingFunctions) {
        if (String(fn.umlEcd || '').trim()) {
          byUmlEcd.set(String(fn.umlEcd).trim(), fn);
        }
        childIndex.set(`${mod.id}|${Number(fn.type)}|${String(fn.name || '').trim().toLowerCase()}`, fn);
      }
    }

    // ── 规则5.1：导入前历史快照（任何写操作之前，真实"导入前"状态）──
    // 收集子树全部功能 id（模块自身不挂交易，交易挂在功能上）
    const allFunctionIds = [];
    for (const mod of existingModules) {
      const fns = await systemDao.listByParent(mod.id, trx);
      for (const fn of fns) allFunctionIds.push(Number(fn.id));
    }
    // 交易关联清单（defense: 表名 'trajectory'，function_id 列）
    let transactions = [];
    if (allFunctionIds.length) {
      transactions = await trx('trajectory')
        .whereIn('function_id', allFunctionIds)
        .select('id', 'name', 'function_id');
    }
    // 组装快照对象：模块及其功能子树 + 每节点页面清单 + 交易关联
    const snapshotModules = [];
    for (const mod of existingModules) {
      const modFns = await systemDao.listByParent(mod.id, trx);
      const fnNodes = [];
      for (const fn of modFns) {
        fnNodes.push({
          id: Number(fn.id),
          name: String(fn.name || ''),
          umlEcd: String(fn.umlEcd || ''),
          source: String(fn.source || ''),
          unmatchedFlag: Number(fn.unmatchedFlag ?? 0),
          menuXpath: String(fn.menuXpath || ''),
          pages: await systemPageDao.listByNodeId(fn.id, trx),
        });
      }
      snapshotModules.push({
        id: Number(mod.id),
        name: String(mod.name || ''),
        umlEcd: String(mod.umlEcd || ''),
        source: String(mod.source || ''),
        unmatchedFlag: Number(mod.unmatchedFlag ?? 0),
        menuXpath: String(mod.menuXpath || ''),
        children: fnNodes,
        pages: await systemPageDao.listByNodeId(mod.id, trx),
      });
    }
    const snapshotObj = { modules: snapshotModules, transactions };
    const menuVersion = await systemMenuSnapshotDao.getLatestVersion(target.id, trx) + 1;
    await systemMenuSnapshotDao.saveSnapshot(
      { systemNodeId: target.id, menuVersion, snapshot: JSON.stringify(snapshotObj) },
      trx,
    );
    stats.snapshotVersion = menuVersion;

    // 本次 plan 涉及的 umlEcd 集合（用于消失标记判断）
    const planUmlEcds = new Set();
    // 本次 plan 落位的全部节点 id（用于规则5.4 交易迁移按页面匹配）
    const planNodeIds = [];

    /**
     * upsert 一个节点（模块或功能），返回落位节点。命中后登记进两个索引。
     * @param {object} item plan 中的模块或功能对象
     * @param {number} parentId 父节点 id
     * @param {number} type 节点类型（2=模块 / 3=功能）
     * @param {object[]} pages 该节点的页面清单
     * @returns {Promise<object>} 落位节点（API 形态）
     */
    async function upsertNode(item, parentId, type, pages) {
      const name = String(item.name || '').trim();
      const umlEcd = String(item.umlEcd || '').trim();
      const seqNo = Number(item.seqNo) || 0;
      const pdCmptEcd = pages[0]?.pageId || '';
      if (umlEcd) planUmlEcds.add(umlEcd);

      let node = null;
      // 分支 1：umlEcd 命中既有节点
      if (umlEcd && byUmlEcd.has(umlEcd)) {
        node = byUmlEcd.get(umlEcd);
        // 规则5.3：新 JSON 中父级变化 → 迁移节点到新父下（先清旧 childIndex 键防误收编）
        if (Number(node.parentId) !== Number(parentId)) {
          const oldKey = `${Number(node.parentId)}|${Number(node.type)}|${String(node.name || '').trim().toLowerCase()}`;
          if (childIndex.get(oldKey) && Number(childIndex.get(oldKey).id) === Number(node.id)) {
            childIndex.delete(oldKey);
          }
          await trx('system').where({ id: Number(node.id) }).update({ parent_id: Number(parentId), sort_order: seqNo });
          node.parentId = Number(parentId);
          stats.migratedNodes += 1;
        }
        await systemDao.update(node.id, {
          name,
          umlEcd,
          pdCmptEcd,
          source: 'json_import',
          unmatchedFlag: 0,
        }, trx);
        stats.updated += 1;
      } else {
        const key = `${parentId}|${type}|${name.toLowerCase()}`;
        // 分支 2：同父同型同名命中（收编）
        if (childIndex.has(key)) {
          node = childIndex.get(key);
          await systemDao.update(node.id, {
            name,
            umlEcd,
            pdCmptEcd,
            source: 'json_import',
            unmatchedFlag: 0,
          }, trx);
          stats.adopted += 1;
        } else {
          // 分支 3：新建
          node = await systemDao.create({
            type,
            parentId,
            name,
            umlEcd,
            pdCmptEcd,
            source: 'json_import',
            sortOrder: seqNo,
          }, trx);
          stats.created += 1;
        }
      }

      // 登记进两个索引（供后续同层查重）
      if (umlEcd) byUmlEcd.set(umlEcd, node);
      childIndex.set(`${parentId}|${type}|${name.toLowerCase()}`, node);

      // 收集本次 plan 落位节点 id（供规则5.4 交易迁移按页面匹配）
      planNodeIds.push(Number(node.id));

      // 同步页面清单
      await systemPageDao.replaceForNode(node.id, pages, trx);
      stats.pagesImported += pages.length;
      return node;
    }

    // 遍历 plan：模块挂 target.id 下，功能挂对应模块下
    for (const mod of plan.modules) {
      const moduleNode = await upsertNode(mod, target.id, NODE_TYPE_MODULE, mod.pages || []);
      for (const fn of mod.functions || []) {
        await upsertNode(fn, moduleNode.id, NODE_TYPE_FUNCTION, fn.pages || []);
      }
    }

    // ── 规则5.4：交易迁移（按页面ID匹配新菜单，命中则 function_id 跟随）──
    if (planNodeIds.length) {
      const pageRows = await trx('system_page')
        .whereIn('system_node_id', planNodeIds)
        .select('page_id', 'system_node_id');
      const pageIdToNodes = new Map();
      for (const pr of pageRows) {
        const pid = String(pr.page_id || '');
        if (!pid) continue;
        if (!pageIdToNodes.has(pid)) pageIdToNodes.set(pid, []);
        pageIdToNodes.get(pid).push(Number(pr.system_node_id));
      }
      if (pageIdToNodes.size) {
        const boundTrajs = await trx('trajectory')
          .whereNot('page_id', '')
          .select('id', 'function_id', 'page_id');
        for (const t of boundTrajs) {
          const candidates = pageIdToNodes.get(String(t.page_id));
          if (!candidates || !candidates.length) continue; // 未匹配 → 保留原菜单（规则5.4）
          const curFn = Number(t.function_id);
          if (candidates.includes(curFn)) continue; // 已在正确菜单下
          // 多候选确定性规则：当前 function_id 在候选中优先（不动的情形上面已 continue），
          // 否则取最小 node id（可解释、可复现）
          const targetNodeId = Math.min(...candidates);
          await trx('trajectory').where({ id: Number(t.id) }).update({ function_id: targetNodeId });
          stats.migratedTransactions += 1;
        }
      }
    }

    // 消失标记：既有子树中 source='json_import' 且 umlEcd 非空、但不在本次 plan 的节点
    // 同时收集被标记的模块/功能，供规则5.8 删除/保留判定
    const unmatchedModuleIds = new Set();
    const unmatchedFunctionIds = new Set();
    for (const mod of existingModules) {
      const ecd = String(mod.umlEcd || '').trim();
      if (mod.source === 'json_import' && ecd && !planUmlEcds.has(ecd)) {
        await systemDao.update(mod.id, { unmatchedFlag: 1 }, trx);
        stats.markedUnmatched += 1;
        unmatchedModuleIds.add(Number(mod.id));
      }
      const existingFunctions = await systemDao.listByParent(mod.id, trx);
      for (const fn of existingFunctions) {
        const fnEcd = String(fn.umlEcd || '').trim();
        if (fn.source === 'json_import' && fnEcd && !planUmlEcds.has(fnEcd)) {
          await systemDao.update(fn.id, { unmatchedFlag: 1 }, trx);
          stats.markedUnmatched += 1;
          unmatchedFunctionIds.add(Number(fn.id));
        }
      }
    }

    // ── 规则5.8：删除/保留判定（仍在事务内）──
    // 实现顺序：先删功能（子树交易数===0），再检查模块是否"无 children 且自身 unmatched 且子树无交易"。
    // 统计某功能 id 集合下的交易数（defense: 表名 'trajectory'，function_id 列）
    const countTrajectoryByFnIds = async (fnIds) => {
      if (!fnIds.length) return 0;
      const row = await trx('trajectory').whereIn('function_id', fnIds).count('* as c').first();
      return Number(row?.c) || 0;
    };

    // 先删功能：被标记的功能，自身交易数 === 0 → 物理删除（system_page 由 FK CASCADE 自动删）
    for (const fnId of unmatchedFunctionIds) {
      const trajCount = await countTrajectoryByFnIds([fnId]);
      if (trajCount === 0) {
        await trx('system').where({ id: fnId }).del();
        stats.deleted += 1;
      }
    }

    // 父级清理：被标记的模块，若已无 children（功能已全删/被收编走）则自身子树无交易
    // （模块自身不挂交易，交易挂在功能上）→ 删除模块（含 system_page CASCADE）
    for (const modId of unmatchedModuleIds) {
      const remainingChildren = await systemDao.listByParent(modId, trx);
      if (remainingChildren.length > 0) continue; // 仍有子功能，保留
      const childFnIds = remainingChildren.map((c) => Number(c.id));
      const trajCount = await countTrajectoryByFnIds(childFnIds);
      if (trajCount === 0) {
        await trx('system').where({ id: modId }).del();
        stats.deleted += 1;
      }
    }
  });

  const tree = await getTree({ includeAccounts: false });
  return { ...stats, tree };
}
