/**
 * 菜单扫描 Node 编排 service：在 executor 会话里驱动浏览器登录被测系统、
 * 调用 `scan_menu_tree` 动作抓取实际菜单树，再把扫描结果与既有模块/功能做名称匹配，
 * 在单个事务内更新命中节点的 menuXpath（并清 unmatchedFlag），新建未命中节点。
 * 全局单飞：同一时刻只允许一个菜单扫描任务运行。
 */
import { randomUUID } from 'crypto';
import { getDB } from '../../config/database.js';
import * as systemDao from '../dao/system-dao.js';
import * as systemAccountDao from '../dao/system-account-dao.js';
import * as execSession from '../executor-session-client.js';

const NODE_TYPE_SYSTEM = 1;
const NODE_TYPE_MODULE = 2;
const NODE_TYPE_FUNCTION = 3;

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

    // —— 事务内写库 ——
    await applyScanPlan(plan, systemNodeId);

    job.status = 'completed';
    job.stats = { ...plan.stats, updates: plan.updates.length };
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
 * 在单个事务内应用扫描计划：更新命中节点、新建未命中节点。
 *
 * L1 命中 → 更新 menuXpath 并清 unmatchedFlag；未命中 → 新建 type=2 模块。
 * L2 命中 → 更新 menuXpath 并清 unmatchedFlag；未命中 → 先确保父模块存在
 * （复用刚建的 level1 或已匹配同名模块），再新建 type=3 功能。
 * @param {{ updates: Array<{ nodeId: number, menuXpath: string }>, creates: Array<{ level: 1|2, name: string, parentName: string }> }} plan 应用计划
 * @param {number} systemNodeId 系统节点 id
 * @returns {Promise<void>}
 */
async function applyScanPlan(plan, systemNodeId) {
  await getDB().transaction(async (trx) => {
    // 先建 L1（保证 L2 能找到父模块），再处理 L2。
    const l1Creates = plan.creates.filter((c) => c.level === 1);
    const l2Creates = plan.creates.filter((c) => c.level === 2);

    // parentName → moduleId 映射：含本次新建的 L1 与既有匹配模块。
    const moduleByName = new Map();

    // 更新命中节点（L1/L2 一并）。
    for (const u of plan.updates) {
      await systemDao.update(u.nodeId, { menuXpath: u.menuXpath, unmatchedFlag: 0 }, trx);
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
          sortOrder: 0,
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
          sortOrder: 0,
        },
        trx,
      );
    }
  });
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

  for (const m of menus) {
    const level = Number(m.level);
    const name = String(m.name || '').trim();
    const parentName = String(m.parentName || '').trim();
    const xpath = String(m.xpath || '');

    if (!name) continue;

    if (level === 1) {
      const mod = l1Index.get(name);
      if (mod) {
        updates.push({ nodeId: mod.id, menuXpath: xpath });
        matched += 1;
        if (Number(mod.unmatchedFlag) === 1) clearedUnmatched.push(mod.id);
      } else {
        creates.push({ level: 1, name, parentName: '', xpath });
        l1CreatedNames.add(name);
      }
      continue;
    }

    if (level === 2) {
      const parentMod = l1Index.get(parentName);
      let fnNode = null;
      if (parentMod && Array.isArray(parentMod.children)) {
        fnNode = parentMod.children.find((c) => String(c.name || '').trim() === name) || null;
      }
      if (fnNode) {
        updates.push({ nodeId: fnNode.id, menuXpath: xpath });
        matched += 1;
        if (Number(fnNode.unmatchedFlag) === 1) clearedUnmatched.push(fnNode.id);
      } else {
        creates.push({ level: 2, name, parentName, xpath });
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
