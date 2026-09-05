/**
 * 菜单 JSON 导入 service：解析被测系统《建模组件关系》JSON，
 * 建两级菜单树（模块/功能）并按 umlEcd 幂等 upsert，同步页面清单。
 *
 * 本路径写入的 `umlEcd` 为建模侧 UML 编码（如 `UML00005556`），是两种格式之一；
 * 另一种是 AI 扫描新建的 `String(node.id)`，见 `menu-scan-apply.assignAiUmlEcdFromId`
 * 与推送侧 `resolveMenuUmlEcd`。
 */
import { getDB } from '../../config/database.js';
import * as systemDao from '../dao/system-dao.js';
import * as systemPageDao from '../dao/system-page-dao.js';
import * as systemMenuSnapshotDao from '../dao/system-menu-snapshot-dao.js';
import * as menuChangeLogDao from '../dao/menu-change-log-dao.js';
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
 * 收集一个节点直属活动（children 中 umlType='3'）的落地页。
 * @param {object} node 子领域/模块节点
 * @param {{ all?: boolean }} [opts] all=true 时收齐全部非空 managePage（中间菜单目录）；默认只留第一个（可导航功能）
 * @returns {object[]} 项含 pageId/pageName/resPath/pageType='managePage'
 */
function collectPages(node, opts = {}) {
  const wantAll = !!opts.all;
  const pages = [];
  const seen = new Set();
  const children = Array.isArray(node.children) ? node.children : [];
  let skippedExtraManage = 0;
  for (const child of children) {
    if (String(child.umlType) !== '3') continue;
    const managePage = child.managePage;
    const pageId = managePage ? String(managePage.pdCmptEcd || '').trim() : '';
    if (!pageId) continue;
    if (seen.has(pageId)) continue;
    if (!wantAll && pages.length > 0) {
      skippedExtraManage += 1;
      continue;
    }
    seen.add(pageId);
    pages.push({
      pageId,
      pageName: String(managePage.pdCmptNm || '').trim(),
      resPath: String(managePage.resPath || '').trim(),
      pageType: 'managePage',
    });
  }
  if (!wantAll && skippedExtraManage > 0) {
    console.warn(
      '[menu-json-import] multiple managePages under node %s; kept first %s, skipped %d',
      String(node.umlEcd || node.umlNm || ''),
      pages[0]?.pageId,
      skippedExtraManage,
    );
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

    const isTopLevel = ancestorModule === null;
    if (isTopLevel) {
      // 顶层子领域 → 模块；若自身也是叶子，pages 挂模块自己身上
      const nodePages = collectPages(node);
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
      // 非顶层叶子子领域 → 一律 intermediate（建模目录，不可导航）。
      // 可点二级菜单只认扫描；扫描后按同名/pageId 从 intermediate 回填 umlEcd（无白名单）。
      const allPages = collectPages(node, { all: true });
      ancestorModule.functions.push({
        umlEcd,
        name,
        seqNo,
        pages: allPages,
        intermediate: true,
      });
    } else {
      // 中间层非叶子：不建节点；自身直属活动页面并入最近已建祖先（模块）
      const nodePages = collectPages(node);
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
 * @returns {Promise<{ created: number, updated: number, adopted: number, markedOffline: number, pagesImported: number, snapshotVersion: number, deleted: number, migratedNodes: number, migratedTransactions: number, tree: object[] }>} 导入统计与重建后的树；markedOffline 为消失标记计数（removed_flag=1，"版本已下线"）；migratedNodes/migratedTransactions 为规则5.3/5.4 迁移计数
 * @throws {{ code: 'VALIDATION' }} 目标节点不存在或非系统类型时抛出
 */
export async function importMenuJson(systemNodeId, buffer) {
  const { roots } = parseMenuJson(buffer);
  const plan = buildImportJsonPlan({ roots });

  const target = await systemDao.getRawById(Number(systemNodeId));
  if (!target || Number(target.type) !== 1) {
    throw Object.assign(new Error('目标节点必须是系统（type=1）'), { code: 'VALIDATION' });
  }

  const stats = { created: 0, updated: 0, adopted: 0, markedOffline: 0, pagesImported: 0, deleted: 0, migratedNodes: 0, migratedTransactions: 0 };
  // 变更事件流水收集：事务尾批量落 system_menu_change_log（source='import'）
  const changeRows = [];

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
      const intermediate = !!item.intermediate;
      // 中间菜单不挂导航 pageId；可导航功能仍取 pages[0]
      const pdCmptEcd = intermediate ? '' : (pages[0]?.pageId || '');
      if (umlEcd) planUmlEcds.add(umlEcd);

      const patchCommon = {
        name,
        umlEcd,
        pdCmptEcd,
        source: 'json_import',
        removedFlag: 0,
        intermediateFlag: intermediate ? 1 : 0,
        ...(intermediate ? { menuXpath: '' } : {}),
      };

      let node = null;
      // 分支 1：umlEcd 命中既有节点
      if (umlEcd && byUmlEcd.has(umlEcd)) {
        node = byUmlEcd.get(umlEcd);
        const oldName = String(node.name || '').trim();
        const oldParentId = Number(node.parentId);
        // 规则5.3：新 JSON 中父级变化 → 迁移节点到新父下（先清旧 childIndex 键防误收编）
        if (oldParentId !== Number(parentId)) {
          const oldKey = `${oldParentId}|${Number(node.type)}|${oldName.toLowerCase()}`;
          if (childIndex.get(oldKey) && Number(childIndex.get(oldKey).id) === Number(node.id)) {
            childIndex.delete(oldKey);
          }
          await trx('system').where({ id: Number(node.id) }).update({ parent_id: Number(parentId), sort_order: seqNo });
          node.parentId = Number(parentId);
          stats.migratedNodes += 1;
          // 变更事件：节点迁移（5.3）
          changeRows.push({ changeType: 'moved', nodeId: Number(node.id), detail: { name, oldParentId, newParentId: Number(parentId) } });
        }
        await systemDao.update(node.id, patchCommon, trx);
        stats.updated += 1;
        // 变更事件：改名 / 更新
        if (oldName !== name) {
          changeRows.push({ changeType: 'renamed', nodeId: Number(node.id), detail: { oldName, name } });
        } else {
          changeRows.push({ changeType: 'updated', nodeId: Number(node.id), detail: { name } });
        }
      } else {
        const key = `${parentId}|${type}|${name.toLowerCase()}`;
        // 分支 2：同父同型同名命中（收编）
        if (childIndex.has(key)) {
          node = childIndex.get(key);
          await systemDao.update(node.id, patchCommon, trx);
          stats.adopted += 1;
          // 变更事件：收编
          changeRows.push({ changeType: 'adopted', nodeId: Number(node.id), detail: { name } });
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
            intermediateFlag: intermediate ? 1 : 0,
            menuXpath: '',
          }, trx);
          stats.created += 1;
          // 变更事件：新建
          changeRows.push({ changeType: 'created', nodeId: Number(node.id), detail: { name, parentId: Number(parentId) } });
        }
      }

      // 登记进两个索引（供后续同层查重）
      if (umlEcd) byUmlEcd.set(umlEcd, node);
      childIndex.set(`${parentId}|${type}|${name.toLowerCase()}`, node);

      // 收集本次 plan 落位节点 id（供规则5.4 交易迁移按页面匹配）
      // 中间菜单不进 5.4 目标（避免交易寄挂到不可导航节点）
      if (!intermediate) planNodeIds.push(Number(node.id));

      // 同步页面清单（中间菜单挂全量目录页；导航功能仍 0/1 页）
      await systemPageDao.replaceForNode(node.id, pages, trx);
      stats.pagesImported += pages.length;
      return node;
    }

    // 遍历 plan：模块挂 target.id 下，功能挂对应模块下
    for (const mod of plan.modules) {
      const moduleNode = await upsertNode(mod, target.id, NODE_TYPE_MODULE, []);
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
          .select('id', 'name', 'function_id', 'page_id');
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
          // 变更事件：交易迁移
          changeRows.push({
            changeType: 'transaction_migrated',
            nodeId: targetNodeId,
            detail: {
              trajectoryId: Number(t.id),
              trajectoryName: String(t.name || ''),
              fromFunctionId: curFn,
              toFunctionId: targetNodeId,
              pageId: String(t.page_id || ''),
            },
          });
        }
      }
    }

    // 消失标记：既有子树中 source='json_import' 且 umlEcd 非空、但不在本次 plan 的节点
    // 同时收集被标记的模块/功能，供规则5.8 删除/保留判定
    const unmatchedModuleIds = new Set();
    // 存 {id, name} 对，供 5.8 删除处取节点名记录变更事件
    const unmatchedFunctionIds = [];
    for (const mod of existingModules) {
      const ecd = String(mod.umlEcd || '').trim();
      if (mod.source === 'json_import' && ecd && !planUmlEcds.has(ecd)) {
        // 消失标记语义 = 版本已下线（removed_flag 归导入独占；unmatched_flag 归扫描，导入不碰）
        await systemDao.update(mod.id, { removedFlag: 1 }, trx);
        stats.markedOffline += 1;
        unmatchedModuleIds.add(Number(mod.id));
        // 变更事件：消失标记 → 版本已下线
        changeRows.push({ changeType: 'offline_marked', nodeId: Number(mod.id), detail: { name: String(mod.name || ''), reason: 'not_in_new_json' } });
      }
      const existingFunctions = await systemDao.listByParent(mod.id, trx);
      for (const fn of existingFunctions) {
        const fnEcd = String(fn.umlEcd || '').trim();
        if (fn.source === 'json_import' && fnEcd && !planUmlEcds.has(fnEcd)) {
          // 消失标记语义 = 版本已下线（removed_flag 归导入独占；unmatched_flag 归扫描，导入不碰）
          await systemDao.update(fn.id, { removedFlag: 1 }, trx);
          stats.markedOffline += 1;
          unmatchedFunctionIds.push({ id: Number(fn.id), name: String(fn.name || '') });
          // 变更事件：消失标记 → 版本已下线
          changeRows.push({ changeType: 'offline_marked', nodeId: Number(fn.id), detail: { name: String(fn.name || ''), reason: 'not_in_new_json' } });
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
    for (const fn of unmatchedFunctionIds) {
      const fnId = fn.id;
      const trajCount = await countTrajectoryByFnIds([fnId]);
      if (trajCount === 0) {
        // batch_recording_job.function_id 为 RESTRICT 外键：菜单消失后任务历史保留、功能引用置空
        await trx('batch_recording_job').where({ function_id: fnId }).update({ function_id: null });
        await trx('system').where({ id: fnId }).del();
        stats.deleted += 1;
        // 变更事件：功能删除
        changeRows.push({ changeType: 'deleted', nodeId: fnId, detail: { name: fn.name } });
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
        // 取模块名（删前查；remainingChildren 已空但模块行仍在）
        const modRow = await systemDao.getRawById(modId, trx);
        await trx('system').where({ id: modId }).del();
        stats.deleted += 1;
        // 变更事件：模块删除
        changeRows.push({ changeType: 'deleted', nodeId: modId, detail: { name: String(modRow?.name || '') } });
      }
    }

    // ── 变更事件批量落库（source='import'，挂本次 menuVersion）──
    if (changeRows.length) {
      await menuChangeLogDao.insertRows(
        changeRows.map((r) => ({ ...r, systemNodeId: target.id, menuVersion, source: 'import' })),
        trx,
      );
    }
  });

  const tree = await getTree({ includeAccounts: false });
  return { ...stats, tree };
}
