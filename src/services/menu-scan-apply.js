/**
 * 菜单扫描应用计划事务落库：applyScanPlan 在单个事务内更新命中节点、
 * 新建未命中模块/功能，并应用阶段二 merge（改名/合并/置标），最后批量落库变更事件。
 */
import { getDB } from '../../config/database.js';
import * as systemDao from '../dao/system-dao.js';
import * as systemMenuSnapshotDao from '../dao/system-menu-snapshot-dao.js';
import * as menuChangeLogDao from '../dao/menu-change-log-dao.js';
import { NODE_TYPE } from '../models/hierarchy-constants.js';

/**
 * 在单个事务内应用扫描计划：更新命中节点、新建未命中节点。
 *
 * L1 命中 → 更新 menuXpath 并清 unmatchedFlag；未命中 → 新建 type=2 模块。
 * L2 命中 → 更新 menuXpath 并清 unmatchedFlag；未命中 → 先确保父模块存在
 * （复用刚建的 level1 或已匹配同名模块），再新建 type=3 功能。
 * 阶段二 merge：幽灵节点改名 + 同层同名重复节点合并 + 剩余幽灵置标 + 变更事件落库。
 * @param {{ updates: Array<{ nodeId: number, menuXpath: string }>, creates: Array<{ level: 1|2, name: string, parentName: string }> }} plan 应用计划
 * @param {number} systemNodeId 系统节点 id
 * @param {Array<object>} [merges] 阶段二合并结果数组（默认 []）
 * @param {Array<object>} [ghosts] 幽灵节点全集（含未命中的，供置标；默认 []）
 * @param {Array<object>} [emptyXpathJsonFns] json_import 且 menuXpath 为空的功能全集（含无页面 ID 者，置标与排序后推用；默认 []）
 * @returns {Promise<{ unmatchedMarked: number }>} 置标统计
 */
export async function applyScanPlan(plan, systemNodeId, merges = [], ghosts = [], emptyXpathJsonFns = []) {
  const scanChangeRows = [];
  let unmatchedMarked = 0;
  await getDB().transaction(async (trx) => {
    // 先建 L1（保证 L2 能找到父模块），再处理 L2。
    const l1Creates = plan.creates.filter((c) => c.level === 1);
    const l2Creates = plan.creates.filter((c) => c.level === 2);

    // parentName → moduleId 映射：含本次新建的 L1 与既有匹配模块。
    const moduleByName = new Map();

    // 更新命中节点（L1/L2 一并），写回真实菜单顺序 sortOrder。
    for (const u of plan.updates) {
      await systemDao.update(
        u.nodeId,
        {
          menuXpath: u.menuXpath,
          unmatchedFlag: 0,
          ...(u.sortOrder !== undefined ? { sortOrder: u.sortOrder } : {}),
        },
        trx,
      );
    }

    // 新建 L1 模块。
    for (const c of l1Creates) {
      const created = await systemDao.create(
        {
          type: NODE_TYPE.MODULE,
          parentId: systemNodeId,
          name: c.name,
          source: 'ai',
          menuXpath: c.xpath || '',
          sortOrder: c.sortOrder ?? 0,
        },
        trx,
      );
      moduleByName.set(c.name.trim(), Number(created.id));
    }

    // 新建 L2 功能：父模块按 parentName 在 moduleByName 找；
    // 找不到说明 parentName 是已匹配的既有模块——需要补查。
    for (const c of l2Creates) {
      const parentName = String(c.parentName || '').trim();
      let parentId = moduleByName.get(parentName);
      if (!parentId) {
        // 既有匹配模块未登记：查系统下同名模块。
        const mods = await systemDao.listByParent(systemNodeId, trx);
        const found = mods.find((m) => String(m.name || '').trim() === parentName);
        if (found) {
          parentId = Number(found.id);
          moduleByName.set(parentName, parentId);
        }
      }
      if (!parentId) {
        // 父模块仍不存在：兜底新建一个空 L1 模块，避免功能悬空。
        const created = await systemDao.create(
          {
            type: NODE_TYPE.MODULE,
            parentId: systemNodeId,
            name: parentName,
            source: 'ai',
            menuXpath: '',
            sortOrder: 0,
          },
          trx,
        );
        parentId = Number(created.id);
        moduleByName.set(parentName, parentId);
      }
      await systemDao.create(
        {
          type: NODE_TYPE.FUNCTION,
          parentId,
          name: c.name,
          source: 'ai',
          menuXpath: c.xpath || '',
          sortOrder: c.sortOrder ?? 0,
        },
        trx,
      );
    }

    // ── 阶段二 merge 应用（同事务）──
    // menuXpath 已由上面 plan.updates 循环回写到幽灵节点；此处改名 + 显式删除 AI 重复节点 + 交易重指向。
    for (const m of merges) {
      // 幽灵节点改名（menuXpath 已回写）
      await systemDao.update(m.ghostNodeId, { name: m.menuName, unmatchedFlag: 0 }, trx);
      scanChangeRows.push({
        changeType: 'renamed',
        nodeId: m.ghostNodeId,
        detail: { oldName: m.ghostOldName, name: m.menuName, pageId: m.pageId, via: 'page_id_match' },
      });

      // 显式删除 AI 重复节点（duplicateNodeId 来自 phase2 命中，比同名查找更可靠）
      const dupId = Number(m.duplicateNodeId);
      if (Number.isFinite(dupId) && dupId > 0) {
        // 交易与批量导入任务重指向：duplicateNodeId → ghostNodeId
        // （batch_recording_job.function_id 为 RESTRICT 外键，不重指向会阻塞删除）
        await trx('trajectory').where({ function_id: dupId }).update({ function_id: Number(m.ghostNodeId) });
        await trx('batch_recording_job').where({ function_id: dupId }).update({ function_id: Number(m.ghostNodeId) });
        await trx('system').where({ id: dupId }).del();
        scanChangeRows.push({
          changeType: 'merged',
          nodeId: m.ghostNodeId,
          detail: { duplicateNodeId: dupId, duplicateName: m.duplicateName, menuName: m.menuName, pageId: m.pageId, via: 'page_id_match' },
        });
      } else {
        // fallback：无显式 duplicateNodeId 时按同名查找（父模块下同名且 id≠ghost）
        const siblings = await systemDao.listByParent(m.moduleId, trx);
        for (const dup of siblings) {
          if (Number(dup.id) === Number(m.ghostNodeId)) continue;
          if (String(dup.name || '').trim() !== String(m.menuName || '').trim()) continue;
          await trx('trajectory').where({ function_id: Number(dup.id) }).update({ function_id: Number(m.ghostNodeId) });
          await trx('system').where({ id: Number(dup.id) }).del();
          scanChangeRows.push({
            changeType: 'merged',
            nodeId: m.ghostNodeId,
            detail: { duplicateNodeId: Number(dup.id), duplicateName: String(dup.name || ''), menuName: m.menuName, pageId: m.pageId, via: 'page_id_match' },
          });
        }
      }
    }

    // ── 剩余幽灵置标：本轮没被 phase2 命中且 menuXpath 仍空 ──
    // 遍历 json_import 空 xpath 全集（含无 pageIds 者），把 sortOrder 推到真实菜单之后
    // （100000+），避免其 JSON seqNo 与真实菜单下标撞号穿插。
    const mergedGhostIds = new Set(merges.map((m) => Number(m.ghostNodeId)));
    const ghostPageIdsById = new Map(ghosts.map((g) => [Number(g.nodeId), g.pageIds]));
    let ghostSort = 100000;
    for (const g of (emptyXpathJsonFns.length ? emptyXpathJsonFns : ghosts)) {
      if (mergedGhostIds.has(Number(g.nodeId))) continue; // 已合并
      // menuXpath 仍空（未被 plan.updates 回写）才算未匹配幽灵
      const node = await systemDao.getRawById(g.nodeId, trx);
      if (!node) continue;
      if (String(node.menuXpath || '').trim()) continue; // 已有 xpath（被其他路径匹配）
      if (Number(node.removedFlag) === 1) continue; // 已下线节点不再重复置未匹配标（已下线优先）
      const pageIds = ghostPageIdsById.get(Number(g.nodeId));
      await systemDao.update(g.nodeId, { unmatchedFlag: 1, sortOrder: ghostSort }, trx);
      ghostSort += 1;
      unmatchedMarked += 1;
      scanChangeRows.push({
        changeType: 'unmatched_marked',
        nodeId: Number(g.nodeId),
        detail: { name: g.name, pageIds: pageIds ? [...pageIds] : [] },
      });
    }

    // ── 扫描变更事件批量落库（source='scan'，版本用最新快照版本）──
    if (scanChangeRows.length) {
      const menuVersion = await systemMenuSnapshotDao.getLatestVersion(systemNodeId, trx);
      await menuChangeLogDao.insertRows(
        scanChangeRows.map((r) => ({ ...r, systemNodeId, menuVersion, source: 'scan' })),
        trx,
      );
    }
  });
  return { unmatchedMarked };
}
