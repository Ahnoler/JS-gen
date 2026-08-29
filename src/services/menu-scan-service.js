/**
 * 菜单扫描 Node 编排 service：在 executor 会话里驱动浏览器登录被测系统、
 * 调用 `scan_menu_tree` 动作抓取实际菜单树，再把扫描结果与既有模块/功能做名称匹配，
 * 在单个事务内更新命中节点的 menuXpath（并清 unmatchedFlag），新建未命中节点。
 * 全局单飞：同一时刻只允许一个菜单扫描任务运行。
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
 * 6. 释放浏览器会话
 */
import { randomUUID } from 'crypto';
import { getDB } from '../../config/database.js';
import * as systemDao from '../dao/system-dao.js';
import * as systemAccountDao from '../dao/system-account-dao.js';
import * as systemPageDao from '../dao/system-page-dao.js';
import * as systemMenuSnapshotDao from '../dao/system-menu-snapshot-dao.js';
import * as menuChangeLogDao from '../dao/menu-change-log-dao.js';
import * as execSession from '../executor-session-client.js';

const NODE_TYPE_SYSTEM = 1;
const NODE_TYPE_MODULE = 2;
const NODE_TYPE_FUNCTION = 3;

/** 阶段二（按组件编号合并幽灵节点）逐菜单读取组件编号的硬上限，防长扫描。 */
const PHASE2_MAX_READS = 100;

/** 模块级单飞标记：当前运行中的扫描 scanId；非 null 表示有任务进行中。 */
let currentScan = null;
/** 模块级任务登记表：scanId -> job 视图。 */
const scanJobs = new Map();

/**
 * 启动一次菜单扫描（后台执行，立即返回 scanId）。
 *
 * 校验目标系统、取登录账号、登记 job 后，**不 await** 地在后台跑 `runScan`，
 * 内部 try/catch 把成功/失败写回 job，finally 尽力关闭会话并清空单飞标记。
 * @param {number|string} systemNodeId 被测系统节点 id（必须 type=1）
 * @returns {Promise<{ scanId: string }>} 新建的扫描任务 id
 * @throws {{ code: 'CONFLICT' }} 已有扫描进行中
 * @throws {{ code: 'VALIDATION' }} 目标节点不存在/非系统、URL 未配置、无可用登录账号
 */
export async function startScan(systemNodeId) {
  if (currentScan !== null) {
    throw Object.assign(new Error('已有菜单扫描在进行中'), { code: 'CONFLICT' });
  }

  const node = await systemDao.getRawById(Number(systemNodeId));
  if (!node || Number(node.type) !== NODE_TYPE_SYSTEM) {
    throw Object.assign(new Error('目标节点不存在或不是系统（type=1）'), { code: 'VALIDATION' });
  }
  const url = String(node.url || '').trim();
  if (!url) {
    throw Object.assign(new Error('系统未配置 URL'), { code: 'VALIDATION' });
  }

  const accounts = await systemAccountDao.listBySystem(node.id);
  const account = accounts.find((a) => String(a.account || '').trim() && String(a.password || '').trim());
  if (!account) {
    throw Object.assign(new Error('请先配置系统登录账号'), { code: 'VALIDATION' });
  }

  const scanId = randomUUID();
  scanJobs.set(scanId, {
    scanId,
    systemNodeId: node.id,
    status: 'running',
    stats: {},
    error: null,
    startedAt: new Date().toISOString(),
    finishedAt: null,
  });

  currentScan = scanId;

  // 后台执行：不 await，内部自管 job 状态与单飞标记。
  runScan({ scanId, systemNodeId: node.id, url, account }).catch((err) => {
    // runScan 内部已 try/catch 兜底；这里仅防止极端未捕获异常导致单飞永久卡死。
    const job = scanJobs.get(scanId);
    if (job && job.status === 'running') {
      job.status = 'failed';
      job.error = err?.message || String(err);
      job.finishedAt = new Date().toISOString();
    }
    if (currentScan === scanId) currentScan = null;
  });

  return { scanId };
}

/**
 * 执行一次菜单扫描的全过程：开 executor 会话 → 登录 → 扫描菜单树 → 写库。
 *
 * 内部全 try/catch：成功置 `status='completed'`+stats，失败置 `status='failed'`+error；
 * finally 里尽力关闭 executor 会话并清空单飞标记。
 * @param {object} ctx 扫描上下文
 * @param {string} ctx.scanId 扫描任务 id
 * @param {number} ctx.systemNodeId 系统节点 id
 * @param {string} ctx.url 被测系统 URL
 * @param {object} ctx.account 登录账号（{ account, password }）
 * @returns {Promise<void>}
 */
async function runScan({ scanId, systemNodeId, url, account }) {
  const job = scanJobs.get(scanId);
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
    const loginDoneP = execSession.waitForSessionEvent(sessionId, 'replay_done', 180000);
    execSession.forwardStdin({
      nodeUuid,
      sessionId,
      event: 'replay_actions',
      data: {
        actions: [
          { action: 'go_to_url', params: { url } },
          { action: 'login', params: { username, password } },
        ],
        is_replay: true,
        stop_on_fail: true,
      },
    });
    const loginResult = await loginDoneP;
    const loginFailed = Number(loginResult?.failed || 0);
    const loginOk = Number(loginResult?.ok || 0);
    if (loginResult?.error || loginFailed > 0 || loginOk < 2) {
      throw new Error(loginResult?.error || `登录失败 (ok=${loginOk} failed=${loginFailed})`);
    }

    // —— 扫描菜单树 ——
    const scanDoneP = execSession.waitForSessionEvent(sessionId, 'replay_done', 300000);
    execSession.forwardStdin({
      nodeUuid,
      sessionId,
      event: 'replay_actions',
      data: {
        actions: [{ action: 'scan_menu_tree', params: {} }],
        is_replay: true,
        stop_on_fail: true,
      },
    });
    const scanResult = await scanDoneP;
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

    job.status = 'completed';
    job.stats = {
      ...plan.stats,
      updates: plan.updates.length,
      phase2Reads: phase2.reads,
      mergedByPageId: phase2.merges.length,
      unmatchedMarked: applyStats.unmatchedMarked,
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
    if (currentScan === scanId) currentScan = null;
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
      children: children.map((fn) => ({
        id: Number(fn.id),
        name: String(fn.name || ''),
        source: String(fn.source || ''),
        unmatchedFlag: Number(fn.unmatchedFlag || 0),
      })),
    });
  }
  return out;
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
async function runPhase2Match({ plan, runtime, execSession, existing, systemNodeId }) {
  const merges = [];
  let reads = 0;
  try {
    // —— 收集幽灵节点：source='json_import' 的功能，逐节点查 system_page ——
    // 节点数有限，逐节点查（DAO 按 system_node_id 查，无 whereIn 批量接口）。
    const ghosts = [];
    const emptyXpathJsonFns = []; // json_import 且 menuXpath 空的全集（含无 pageIds 者）——置标与排序后推用
    // 同时建 nodeId → {node, moduleId, moduleName} 反查索引，供 update 候选判定
    const fnIndex = new Map();
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
        const pages = await systemPageDao.listByNodeId(fn.id);
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
        const doneP = execSession.waitForSessionEvent(runtime.sessionId, 'replay_done', 25000);
        execSession.forwardStdin({
          nodeUuid: runtime.nodeUuid,
          sessionId: runtime.sessionId,
          event: 'replay_actions',
          data: {
            actions: [
              { action: 'click_menu_xpath', params: { xpath: cand.menuXpath } },
              { action: 'read_page_component_code', params: {} },
            ],
            is_replay: true,
            stop_on_fail: false,
          },
        });
        const r = await doneP;
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
async function applyScanPlan(plan, systemNodeId, merges = [], ghosts = [], emptyXpathJsonFns = []) {
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
          type: NODE_TYPE_MODULE,
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
            type: NODE_TYPE_MODULE,
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
          type: NODE_TYPE_FUNCTION,
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

/**
 * 构建菜单扫描结果的应用计划（纯函数，禁止碰 DB/网络）。
 *
 * 匹配规则：L1 按 `name` trim 后精确匹配既有模块名；
 * L2 按 `parentName`+`name` 匹配该模块下的功能名。
 * 命中 → `updates`（带 menuXpath）；若该节点 `unmatchedFlag===1` → 同时记入 `clearedUnmatched`。
 * 未命中 → `creates`（L1 带 `parentName:''`，L2 带 parentName）。
 * @param {Array<{ level: 1|2, name: string, parentName?: string, xpath: string }>} scannedMenus 扫描到的菜单项
 * @param {Array<object>} existingModules 既有模块（含功能 children），每个元素含 id/name/source/unmatchedFlag
 * @returns {{ updates: Array<object>, creates: Array<object>, clearedUnmatched: number[], stats: object }} 应用计划，含 updates/creates/clearedUnmatched 与 stats（totalScanned/matched/created/clearedUnmatched/unmatchedScanned）
 */
export function buildScanApplyPlan(scannedMenus, existingModules) {
  const menus = Array.isArray(scannedMenus) ? scannedMenus : [];
  const modules = Array.isArray(existingModules) ? existingModules : [];

  const updates = [];
  const creates = [];
  const clearedUnmatched = [];
  const unmatchedScanned = [];

  // L1 名称索引：trim 后精确匹配。
  const l1Index = new Map();
  for (const mod of modules) {
    l1Index.set(String(mod.name || '').trim(), mod);
  }

  let matched = 0;
  const l1CreatedNames = new Set();

  // sortOrder 计数器：L1 全局下标（0-based，按 level===1 出现序）；
  // L2 按 parentName 分组下标（每个 parentName 独立从 0 计数）。
  let l1Sort = 0;
  const l2SortByParent = new Map();

  for (const m of menus) {
    const level = Number(m.level);
    const name = String(m.name || '').trim();
    const parentName = String(m.parentName || '').trim();
    const xpath = String(m.xpath || '');

    if (!name) continue;

    if (level === 1) {
      const sortOrder = l1Sort;
      l1Sort += 1;
      const mod = l1Index.get(name);
      if (mod) {
        updates.push({ nodeId: mod.id, menuXpath: xpath, sortOrder });
        matched += 1;
        if (Number(mod.unmatchedFlag) === 1) clearedUnmatched.push(mod.id);
      } else {
        creates.push({ level: 1, name, parentName: '', xpath, sortOrder });
        l1CreatedNames.add(name);
      }
      continue;
    }

    if (level === 2) {
      const sortOrder = l2SortByParent.get(parentName) || 0;
      l2SortByParent.set(parentName, sortOrder + 1);
      const parentMod = l1Index.get(parentName);
      let fnNode = null;
      if (parentMod && Array.isArray(parentMod.children)) {
        fnNode = parentMod.children.find((c) => String(c.name || '').trim() === name) || null;
      }
      if (fnNode) {
        updates.push({ nodeId: fnNode.id, menuXpath: xpath, sortOrder });
        matched += 1;
        if (Number(fnNode.unmatchedFlag) === 1) clearedUnmatched.push(fnNode.id);
      } else {
        creates.push({ level: 2, name, parentName, xpath, sortOrder });
      }
      continue;
    }
    // 其他层级忽略。
  }

  for (const c of creates) {
    unmatchedScanned.push({ name: c.name, parentName: c.parentName });
  }

  return {
    updates,
    creates,
    clearedUnmatched,
    stats: {
      totalScanned: menus.length,
      matched,
      created: creates.length,
      clearedUnmatched: clearedUnmatched.length,
      unmatchedScanned,
    },
  };
}

/**
 * 查询扫描任务视图。
 * @param {string} scanId 扫描任务 id
 * @returns {{ scanId: string, systemNodeId: number, status: 'running'|'completed'|'failed', stats: object, error: string|null, startedAt: string, finishedAt: string|null }} 任务视图
 * @throws {{ code: 'NOT_FOUND' }} scanId 不存在
 */
export function getScan(scanId) {
  const job = scanJobs.get(scanId);
  if (!job) {
    throw Object.assign(new Error('scan not found'), { code: 'NOT_FOUND' });
  }
  return {
    scanId: job.scanId,
    systemNodeId: job.systemNodeId,
    status: job.status,
    stats: job.stats,
    error: job.error,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
  };
}
