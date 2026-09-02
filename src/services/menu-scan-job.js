/**
 * 菜单扫描任务登记与单飞：模块级 currentScan 单飞标记 + scanJobs 任务登记表。
 * 对外提供 startScan（校验目标系统/账号 → 登记任务 → 后台执行 runScan）与
 * getScan（任务视图查询）；runScan 执行体在 menu-scan-session.js，通过本模块的
 * getScanJob/clearCurrentScan 读写任务状态与清空单飞标记。
 */
import { randomUUID } from 'crypto';
import * as systemDao from '../dao/system-dao.js';
import * as systemAccountDao from '../dao/system-account-dao.js';
import { NODE_TYPE } from '../models/hierarchy-constants.js';
import { runScan, runFillPageIds } from './menu-scan-session.js';

/** 模块级单飞标记：当前运行中的扫描 scanId；非 null 表示有任务进行中。 */
let currentScan = null;
/** 模块级任务登记表：scanId -> job 视图。 */
const scanJobs = new Map();

/**
 * 读取任务登记记录（供 menu-scan-session.js 跨模块读写；不存在返回 undefined）。
 * @param {string} scanId 扫描任务 id
 * @returns {object|undefined} job 记录（返回引用，调用方可原地更新 status/stats/error 等字段）
 */
export function getScanJob(scanId) {
  return scanJobs.get(scanId);
}

/**
 * 清空单飞标记（仅当标记仍指向该 scanId 时清空，避免误清后续新启扫描）。
 * @param {string} scanId 扫描任务 id
 * @returns {void}
 */
export function clearCurrentScan(scanId) {
  if (currentScan === scanId) currentScan = null;
}

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
  if (!node || Number(node.type) !== NODE_TYPE.SYSTEM) {
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
 * 启动仅补采落地 pageId 任务（默认只处理 source=ai 的空 pd_cmpt_ecd；不扫菜单树）。
 * @param {number|string} systemNodeId 系统节点 id
 * @param {{ sources?: string[] }} [opts]
 * @returns {Promise<{ scanId: string }>}
 */
export async function startFillPageIds(systemNodeId, opts = {}) {
  if (currentScan !== null) {
    throw Object.assign(new Error('已有菜单扫描/补采在进行中'), { code: 'CONFLICT' });
  }

  const node = await systemDao.getRawById(Number(systemNodeId));
  if (!node || Number(node.type) !== NODE_TYPE.SYSTEM) {
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

  const sources = Array.isArray(opts.sources) && opts.sources.length
    ? opts.sources.map((s) => String(s || '').trim()).filter(Boolean)
    : ['ai'];

  const scanId = randomUUID();
  scanJobs.set(scanId, {
    scanId,
    systemNodeId: node.id,
    kind: 'fill-pageid',
    status: 'running',
    stats: {},
    error: null,
    startedAt: new Date().toISOString(),
    finishedAt: null,
  });

  currentScan = scanId;

  runFillPageIds({ scanId, systemNodeId: node.id, url, account, sources }).catch((err) => {
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
