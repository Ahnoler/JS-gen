/**
 * 菜单扫描会话编排：runScan 驱动一次扫描的全过程（打开 executor 会话 → 自动登录 →
 * scan_menu_tree 抓取菜单树 → buildScanApplyPlan 生成应用计划 → runPhase2Match 阶段二
 * 组件编号合并 → applyScanPlan 事务落库），含阶段二幽灵节点合并的实现。
 * 任务登记/单飞状态（scanJobs/currentScan）由 menu-scan-job.js 持有，本模块通过
 * getScanJob/clearCurrentScan 读写任务视图；applyScanPlan 在 menu-scan-apply.js。
 *
 * 【扫描运行时】（一次扫描约 3-5 分钟）
 * 1. 打开浏览器 + 自动登录                          ← 准备阶段
 * 2. scan_menu_tree：一次提取全部菜单               ← 排序数据的"出生地"
 *    → menus 数组，顺序 = 真实系统页面菜单的 DOM 顺序
 *    例：[{level:1, name:"客户管理"}, {level:2, name:"对公客户管理", parentName:"客户管理"}, ...]
 * 3. buildScanApplyPlan：名称匹配，生成应用计划      ← 排序号在这里"编号"
 *    → 遍历 menus 时用两个计数器给每个菜单编号：
 *      · L1 计数器（全局）：第 1 个一级菜单=0，第 2 个=1……
 *      · L2 计数器（按 parentName 分组）：每个一级菜单下的二级菜单独立从 0 计数
 *    → 编号写进计划条目：updates/creates 每条带 {nodeId(或名称), menuXpath, sortOrder}
 * 4. 阶段二组件编号合并（runPhase2Match）            ← 合并路径透传编号
 *    → 幽灵节点改名合并时，替换的 update 条目带上真实菜单的 sortOrder
 * 5. applyScanPlan：事务内落库                       ← 排序号在这里"写入数据库"（毫秒级）
 *    → 命中节点：UPDATE system SET menu_xpath=…, unmatched_flag=0, sort_order=编号
 *    → 新建节点：INSERT 时带 sort_order=编号
 *    → 幽灵置标：sort_order=100000+（排到真实菜单之后）
 * 6. 补采空 pageId：对空 pd_cmpt_ecd 的 L2 点读天元写入
 * 7. 释放浏览器会话
 */
import { randomUUID } from 'crypto';
import { REPLAY_LOGIN_TIMEOUT_MS, REPLAY_PHASE2_TIMEOUT_MS, REPLAY_STEP_TIMEOUT_MS } from '../../config/config.js';
import * as systemDao from '../dao/system-dao.js';
import * as systemPageDao from '../dao/system-page-dao.js';
import * as execSession from '../executor-session-client.js';
import { runReplayActions } from './replay-actions.js';
import { getScanJob, clearCurrentScan } from './menu-scan-job.js';
import { applyScanPlan } from './menu-scan-apply.js';
import { buildScanApplyPlan } from './menu-scan-service.js';
import { fillEmptyPageIdsForSystem } from './menu-scan-pageid.js';

/** 阶段二（按组件编号合并幽灵节点）逐菜单读取组件编号的硬上限，防长扫描。 */
const PHASE2_MAX_READS = 100;

/**
 * 执行一次菜单扫描的全过程：开 executor 会话 → 登录 → 扫描菜单树 → 写库。
 *
 * 内部全 try/catch：成功置 `status='completed'`+stats，失败置 `status='failed'`+error；
 * finally 里尽力关闭 executor 会话并清空单飞标记（经 menu-scan-job 的 clearCurrentScan）。
 * 任务视图（job）在 menu-scan-job.js 的 scanJobs 表中，通过 getScanJob 读取后原地更新。
 * @param {object} ctx 扫描上下文
 * @param {string} ctx.scanId 扫描任务 id
 * @param {number} ctx.systemNodeId 系统节点 id
 * @param {string} ctx.url 被测系统 URL
 * @param {object} ctx.account 登录账号（{ account, password }）
 * @returns {Promise<void>}
 */
export async function runScan({ scanId, systemNodeId, url, account }) {
  const job = getScanJob(scanId);
  const username = String(account.account || '').trim();
  const password = String(account.password || '').trim();
  const sessionId = randomUUID();
  let opened = null;
  let nodeUuid = null;

  try {
    opened = await execSession.openSession({ sessionId, preferIdleChrome: false });
    nodeUuid = opened?.nodeUuid || null;
    if (!nodeUuid) throw new Error('openSession 未返回 nodeUuid');

    // —— 登录（仿 runDefaultLogin）——
    const { result: loginResult } = await runReplayActions({
      execSession,
      sessionId,
      nodeUuid,
      actions: [
        { action: 'go_to_url', params: { url } },
        { action: 'login', params: { username, password } },
      ],
      timeoutMs: REPLAY_LOGIN_TIMEOUT_MS,
      stopOnFail: true,
      isReplay: true,
    });
    const loginFailed = Number(loginResult?.failed || 0);
    const loginOk = Number(loginResult?.ok || 0);
    if (loginResult?.error || loginFailed > 0 || loginOk < 2) {
      throw new Error(loginResult?.error || `登录失败 (ok=${loginOk} failed=${loginFailed})`);
    }

    // —— 扫描菜单树 ——
    const { result: scanResult } = await runReplayActions({
      execSession,
      sessionId,
      nodeUuid,
      actions: [{ action: 'scan_menu_tree', params: {} }],
      timeoutMs: REPLAY_STEP_TIMEOUT_MS,
      stopOnFail: true,
      isReplay: true,
    });
    const results = Array.isArray(scanResult?.results) ? scanResult.results : [];
    const scanRow = results.find((r) => r && r.action === 'scan_menu_tree');
    const menus = scanRow ? (scanRow.menus || scanRow.data?.menus || []) : [];
    if (!Array.isArray(menus) || menus.length === 0) {
      throw new Error('扫描结果为空');
    }

    // —— 组装既有子树并构建应用计划 ——
    const existingModules = await loadExistingModules(systemNodeId);
    const plan = buildScanApplyPlan(menus, existingModules);

    // —— 阶段二：按组件编号合并幽灵节点（菜单改名场景）——
    // 在 applyScanPlan 之前运行：读取未匹配 L2 菜单的真实组件编号，
    // 命中幽灵（source=json_import、有 system_page 页面 ID、无 menu_xpath）则从
    // plan.creates 移除并改走 plan.updates 回写 xpath（复用更新路径改名合并）。
    const phase2 = await runPhase2Match({
      plan,
      runtime: { nodeUuid, sessionId },
      execSession,
      existing: existingModules,
      systemNodeId,
    });

    // —— 事务内写库（含阶段二 merge / 置标 / 变更事件）——
    const applyStats = await applyScanPlan(plan, systemNodeId, phase2.merges, phase2.ghosts, phase2.emptyXpathJsonFns);

    let pageIdStats = { pageIdCandidates: 0, pageIdFilled: 0, pageIdSkipped: 0 };
    try {
      pageIdStats = await fillEmptyPageIdsForSystem({
        systemNodeId,
        runtime: { sessionId, nodeUuid },
        execSession,
      });
    } catch (fillErr) {
      console.warn('[menu-scan] pageId fill failed: %s', fillErr?.message || fillErr);
    }

    job.status = 'completed';
    job.stats = {
      ...plan.stats,
      updates: plan.updates.length,
      phase2Reads: phase2.reads,
      mergedByPageId: phase2.merges.length,
      unmatchedMarked: applyStats.unmatchedMarked,
      ...pageIdStats,
    };
    job.finishedAt = new Date().toISOString();
  } catch (err) {
    console.error('[menu-scan] failed:', err && (err.stack || err.message || String(err)));
    job.status = 'failed';
    job.error = err?.message || String(err);
    job.finishedAt = new Date().toISOString();
  } finally {
    // 尽力关闭会话；失败不掩盖已写入的 job 状态。
    if (nodeUuid) {
      try {
        await execSession.closeSession({ nodeUuid, sessionId });
      } catch {
        /* 尽力而为，忽略关闭失败 */
      }
    }
    clearCurrentScan(scanId);
  }
}

/**
 * 仅补采落地 pageId：登录后对空 pd_cmpt_ecd 的 L2 点读天元写入（不扫菜单树、不改结构）。
 * @param {object} ctx
 * @param {string} ctx.scanId 任务 id（复用 scanJobs）
 * @param {number} ctx.systemNodeId 系统节点 id
 * @param {string} ctx.url 被测系统 URL
 * @param {object} ctx.account 登录账号
 * @param {string[]} [ctx.sources] source 过滤，默认 `['ai']`
 * @returns {Promise<void>}
 */
export async function runFillPageIds({ scanId, systemNodeId, url, account, sources = ['ai'] }) {
  const job = getScanJob(scanId);
  const username = String(account.account || '').trim();
  const password = String(account.password || '').trim();
  const sessionId = randomUUID();
  let opened = null;
  let nodeUuid = null;

  try {
    opened = await execSession.openSession({ sessionId, preferIdleChrome: false });
    nodeUuid = opened?.nodeUuid || null;
    if (!nodeUuid) throw new Error('openSession 未返回 nodeUuid');

    const { result: loginResult } = await runReplayActions({
      execSession,
      sessionId,
      nodeUuid,
      actions: [
        { action: 'go_to_url', params: { url } },
        { action: 'login', params: { username, password } },
      ],
      timeoutMs: REPLAY_LOGIN_TIMEOUT_MS,
      stopOnFail: true,
      isReplay: true,
    });
    const loginFailed = Number(loginResult?.failed || 0);
    const loginOk = Number(loginResult?.ok || 0);
    if (loginResult?.error || loginFailed > 0 || loginOk < 2) {
      throw new Error(loginResult?.error || `登录失败 (ok=${loginOk} failed=${loginFailed})`);
    }

    const pageIdStats = await fillEmptyPageIdsForSystem({
      systemNodeId,
      runtime: { sessionId, nodeUuid },
      execSession,
      sources,
    });

    job.status = 'completed';
    job.stats = { sources, ...pageIdStats };
    job.finishedAt = new Date().toISOString();
  } catch (err) {
    console.error('[menu-fill-pageid] failed:', err && (err.stack || err.message || String(err)));
    job.status = 'failed';
    job.error = err?.message || String(err);
    job.finishedAt = new Date().toISOString();
  } finally {
    if (nodeUuid) {
      try {
        await execSession.closeSession({ nodeUuid, sessionId });
      } catch {
        /* ignore */
      }
    }
    clearCurrentScan(scanId);
  }
}

/**
 * 装载系统下的既有模块及其功能，组装成 plan 入参形态。
 * @param {number} systemNodeId 系统节点 id
 * @returns {Promise<Array<object>>} 既有模块数组，每个元素含 id/name/source/unmatchedFlag 与 children（功能）
 */
async function loadExistingModules(systemNodeId) {
  const modules = await systemDao.listByParent(systemNodeId);
  const out = [];
  for (const mod of modules) {
    const children = await systemDao.listByParent(mod.id);
    out.push({
      id: Number(mod.id),
      name: String(mod.name || ''),
      source: String(mod.source || ''),
      unmatchedFlag: Number(mod.unmatchedFlag || 0),
      // 中间菜单不参与扫描匹配 / phase2 幽灵（永不可导航）
      children: children
        .filter((fn) => Number(fn.intermediateFlag) !== 1)
        .map((fn) => ({
          id: Number(fn.id),
          name: String(fn.name || ''),
          source: String(fn.source || ''),
          unmatchedFlag: Number(fn.unmatchedFlag || 0),
          menuXpath: String(fn.menuXpath || ''),
          intermediateFlag: Number(fn.intermediateFlag || 0),
        })),
    });
  }
  return out;
}

/**
 * 批量预取 json_import 且 menuXpath 为空的功能节点的 system_page 行（1+N → 1+1）。
 * 候选条件与 runPhase2Match 幽灵判定保持一致；无候选时返回空 Map。
 * @param {Array<object>} existing loadExistingModules 产物（模块数组，children 为功能节点）
 * @returns {Promise<Map<number, object[]>>} 功能节点 id → system_page camelCase 行数组
 */
async function loadGhostPageIdsByNodeIds(existing) {
  const ids = [];
  for (const mod of existing) {
    for (const fn of (Array.isArray(mod.children) ? mod.children : [])) {
      if (String(fn.source || '') !== 'json_import') continue;
      if (String(fn.menuXpath || '').trim()) continue;
      ids.push(Number(fn.id));
    }
  }
  const rows = ids.length ? await systemPageDao.listByNodeIds(ids) : [];
  const byNode = new Map();
  for (const p of rows) {
    const key = Number(p.systemNodeId);
    if (!byNode.has(key)) byNode.set(key, []);
    byNode.get(key).push(p);
  }
  return byNode;
}

/**
 * 阶段二：按组件编号（page_id）合并幽灵节点。
 *
 * 幽灵节点 = source='json_import' 且有 system_page 页面 ID 且 menuXpath 为空的功能节点
 * （JSON 导入后菜单改名，JSON 仍用旧名，扫描发现真实菜单但按名匹配不上）。
 *
 * 候选来源 = plan.updates（按名匹配到既有节点的扫描菜单）。当某 update 匹配到的
 * 既有节点 source !== 'json_import'（即匹配到了 AI 补充节点，非 JSON 节点）且其父模块
 * 下存在幽灵时，逐个读取真实组件编号：命中某幽灵的 pageIds → 将该 update 的 xpath
 * 重定向到幽灵节点（移除原 duplicateNodeId 的 update，push 幽灵的 update），由
 * applyScanPlan 在事务内改名 + 交易重指向 + 删 duplicateNodeId。
 *
 * 全程 try/catch：异常只 warn 不炸扫描，未读取的候选保留原 update（xpath 写到 AI 节点）。
 * @param {object} opts 参数对象
 * @param {object} opts.plan 扫描应用计划（会被原地修改：替换命中的 updates）
 * @param {{ nodeUuid: string, sessionId: string }} opts.runtime executor 会话运行时
 * @param {object} opts.execSession executor 会话客户端（waitForSessionEvent/forwardStdin）
 * @param {Array<object>} opts.existing 既有模块数组（loadExistingModules 产物）
 * @param {number} opts.systemNodeId 系统节点 id
 * @returns {Promise<{ merges: Array<object>, reads: number, ghosts: Array<object> }>} 合并结果、实际读取次数、幽灵全集
 */
export async function runPhase2Match({ plan, runtime, execSession, existing, systemNodeId }) {
  const merges = [];
  let reads = 0;
  try {
    // —— 收集幽灵节点：source='json_import' 的功能，逐节点查 system_page ——
    // W5-C 批量：pages 经 listByNodeIds 一次取回（1+N → 1+1），逐节点查询取消。
    const ghosts = [];
    const emptyXpathJsonFns = []; // json_import 且 menuXpath 空的全集（含无 pageIds 者）——置标与排序后推用
    // 同时建 nodeId → {node, moduleId, moduleName} 反查索引，供 update 候选判定
    const fnIndex = new Map();
    const pageIdsByNode = await loadGhostPageIdsByNodeIds(existing);
    for (const mod of existing) {
      for (const fn of (Array.isArray(mod.children) ? mod.children : [])) {
        fnIndex.set(Number(fn.id), {
          node: fn,
          moduleId: Number(mod.id),
          moduleName: String(mod.name || ''),
        });
        if (String(fn.source || '') !== 'json_import') continue;
        if (String(fn.menuXpath || '').trim()) continue; // 已有 xpath（曾合并/曾匹配）不是幽灵——否则多页面幽灵会被后续菜单反复改名
        emptyXpathJsonFns.push({
          nodeId: Number(fn.id),
          name: String(fn.name || ''),
          moduleId: Number(mod.id),
        });
        const pages = pageIdsByNode.get(Number(fn.id)) || [];
        const pageIds = new Set((Array.isArray(pages) ? pages : [])
          .map((p) => String(p.pageId || ''))
          .filter(Boolean));
        if (pageIds.size === 0) continue; // 无页面 ID 不算幽灵
        ghosts.push({
          nodeId: Number(fn.id),
          name: String(fn.name || ''),
          module: String(mod.name || ''),
          moduleId: Number(mod.id),
          pageIds,
        });
      }
    }
    if (!ghosts.length) return { merges, reads, ghosts, emptyXpathJsonFns };

    // —— 候选来源改为 plan.updates ——
    // 条件：update 对应的既有节点 source !== 'json_import'（匹配到了 AI/其他非 JSON 节点），
    //       且其父模块下存在幽灵，且 menuXpath 非空。
    const ghostModuleIds = new Set(ghosts.map((g) => Number(g.moduleId)));
    const candidates = [];
    for (const u of plan.updates) {
      const info = fnIndex.get(Number(u.nodeId));
      if (!info) continue; // update 节点不在既有索引（不应发生，防御式）
      if (String(info.node.source || '') === 'json_import') continue; // 匹配到 JSON 节点，无需合并
      if (!Number(ghostModuleIds.has(Number(info.moduleId)))) continue; // 父模块无幽灵
      if (!String(u.menuXpath || '').trim()) continue; // 无 xpath 无法导航
      candidates.push({
        update: u,
        duplicateNodeId: Number(u.nodeId),
        duplicateName: String(info.node.name || ''),
        moduleId: Number(info.moduleId),
        moduleName: String(info.moduleName || ''),
        menuXpath: String(u.menuXpath || ''),
      });
    }

    // 硬上限：防长扫描；超出的候选本轮跳过（下次扫描条件仍成立）
    const maxReads = Math.min(candidates.length, PHASE2_MAX_READS);

    for (let i = 0; i < maxReads; i += 1) {
      const cand = candidates[i];
      reads += 1;
      let readCode = '';
      try {
        const { result: r } = await runReplayActions({
          execSession,
          sessionId: runtime.sessionId,
          nodeUuid: runtime.nodeUuid,
          actions: [
            { action: 'click_menu_xpath', params: { xpath: cand.menuXpath } },
            { action: 'read_page_component_code', params: {} },
          ],
          timeoutMs: REPLAY_PHASE2_TIMEOUT_MS,
          stopOnFail: false,
          isReplay: true,
        });
        const results = Array.isArray(r?.results) ? r.results : [];
        const row = results.find((it) => it && it.action === 'read_page_component_code');
        // 防御式：row.pageCode 为对象 { componentCode, ... }
        const payload = row?.pageCode && typeof row.pageCode === 'object' ? row.pageCode : null;
        readCode = payload ? String(payload.componentCode || '').trim() : '';
      } catch (readErr) {
        console.warn('[menu-scan] phase2 read failed for nodeId=%s: %s', cand.duplicateNodeId, readErr?.message || readErr);
        continue; // 读取失败 → 跳过该候选（保留原 update 写 xpath 到 AI 节点）
      }
      if (!readCode) continue; // 空组件编号 → 跳过

      // 命中判定：readCode ∈ 某幽灵的 pageIds。
      // 页面 ID 可能被多个 JSON 叶子共享（共享页面）——多幽灵命中属歧义，不合并（否则菜单
      // 每轮被不同幽灵认领，反复翻转）；仅唯一命中才合并。
      const hits = ghosts.filter((g) => g.pageIds.has(readCode));
      if (hits.length !== 1) continue; // 0=未命中；>1=共享页面歧义 → 跳过
      const ghost = hits[0];

      // 从 plan.updates 移除 duplicateNodeId 那条（按引用剔除）
      const idx = plan.updates.indexOf(cand.update);
      if (idx >= 0) plan.updates.splice(idx, 1);

      // 替换为幽灵节点的 update（xpath 写到幽灵上，透传真实菜单顺序 sortOrder）
      plan.updates.push({ nodeId: ghost.nodeId, menuXpath: cand.menuXpath, sortOrder: cand.update.sortOrder });

      // 记录 merge（显式 duplicateNodeId）
      merges.push({
        ghostNodeId: ghost.nodeId,
        ghostOldName: ghost.name,
        duplicateNodeId: cand.duplicateNodeId,
        duplicateName: cand.duplicateName,
        moduleId: ghost.moduleId,
        menuName: cand.duplicateName, // 扫描菜单名 = AI 节点名（匹配到的名）
        menuXpath: cand.menuXpath,
        pageId: readCode,
      });

      // 一个幽灵只合并一次：从幽灵集合移除
      ghost.pageIds.clear();
    }

    return { merges, reads, ghosts, emptyXpathJsonFns };
  } catch (err) {
    console.warn('[menu-scan] phase2 failed: %s', err?.message || err);
    return { merges, reads, ghosts: [], emptyXpathJsonFns: [] };
  }
}
