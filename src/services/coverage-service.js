/**
 * A2 覆盖分析服务：功能树执行覆盖度量与报表组装。
 * 覆盖判定=存在性（有 functionId 绑定轨迹即 covered）；最近执行/批量成功率/KB 卡数为明细列。
 */
import * as systemDao from '../dao/system-dao.js';
import * as trajectoryDao from '../dao/trajectory-dao.js';
import * as batchRecordingDao from '../dao/batch-recording-dao.js';
import { buildPath } from './hierarchy-tree-query.js';
import { resolveMenuPath } from './menu-path-matcher.js';
import { listFlowCards } from './kb-flow-cards.js';

/**
 * 由节点名链拼可读路径（用「/」连接，过滤掉哨兵根节点 id=0，不含「根」名）。
 * @param {Array<{id:number,name:string}>} chain buildPath 返回的祖先链（根→…→节点）
 * @returns {string} 形如「信贷系统/授信管理/新增对公授信」
 */
function chainToPath(chain) {
  return chain
    .filter((c) => Number(c.id) !== 0)
    .map((c) => String(c.name).trim())
    .join('/');
}

/**
 * 纯函数：把扁平节点与三组统计卷成覆盖报表行（供特征化与组装复用）。
 * lastExecutedAt 统一归一化为字符串（驱动无 dateStrings 时 DAO 可能给出 Date 对象）。
 * @param {Array<{id:number, parentId:number, name:string, type:number}>} flatNodes 扁平节点
 * @param {{ trajStats?: Map<number, {trajCount:number, lastExecutedAt:Date|string|null}>, batchStats?: Map<number, {batchTotal:number, batchSuccess:number}>, kbCardsByNode?: Map<number, number>, byId?: Map<number, object> }} [deps] 统计与 byId 索引（缺省由 flatNodes 自建）
 * @returns {{ rows: Array<{nodeId:number, type:number, name:string, path:string, trajCount:number, lastExecutedAt:string|null, batchTotal:number, batchSuccess:number, kbCards:number, covered:boolean}>, summary: { totalFunctions: number, coveredFunctions: number, coverageRate: number } }} 报表
 */
export function rollupCoverage(flatNodes, { trajStats, batchStats, kbCardsByNode, byId } = {}) {
  const idx = byId || new Map(flatNodes.map((n) => [Number(n.id), n]));
  const rows = [];
  let totalFunctions = 0;
  let coveredFunctions = 0;
  for (const n of flatNodes) {
    const traj = trajStats.get(Number(n.id));
    const batch = batchStats.get(Number(n.id));
    const kbCards = kbCardsByNode.get(Number(n.id)) || 0;
    const covered = (traj?.trajCount || 0) > 0;
    if (Number(n.type) === 3) {
      totalFunctions += 1;
      if (covered) coveredFunctions += 1;
    }
    rows.push({
      nodeId: Number(n.id),
      type: Number(n.type),
      name: String(n.name).trim(),
      path: chainToPath(buildPath(n.id, idx)),
      trajCount: traj?.trajCount || 0,
      lastExecutedAt:
        traj?.lastExecutedAt == null
          ? null
          : (traj.lastExecutedAt instanceof Date ? traj.lastExecutedAt.toISOString() : String(traj.lastExecutedAt)),
      batchTotal: batch?.batchTotal || 0,
      batchSuccess: batch?.batchSuccess || 0,
      kbCards,
      covered,
    });
  }
  return {
    rows,
    summary: {
      totalFunctions,
      coveredFunctions,
      coverageRate: totalFunctions ? coveredFunctions / totalFunctions : 0,
    },
  };
}

/**
 * 组装覆盖报表：全量节点 + 轨迹/批量统计 + KB 卡计数。
 * KB 卡按 menu_path 匹配到节点计数（仅 matched 计入）；rows 按 path 字典序，type 缺省只出功能节点行。
 * @param {{ systemId?: number|string, type?: 'function'|'all' }} [opts] systemId 限定系统子树；'function'=只出 type=3 行，'all'=出全部非根行
 * @returns {Promise<{ rows: Array<object>, summary: { totalFunctions: number, coveredFunctions: number, coverageRate: number } }>} 报表（summary 始终按功能节点口径统计）
 */
export async function buildCoverageReport({ systemId, type = 'function' } = {}) {
  const flatNodes = await systemDao.listAll();
  const sysId = systemId == null || systemId === '' ? null : Number(systemId);
  let scoped = flatNodes;
  if (sysId != null && Number.isFinite(sysId)) {
    const keep = new Set();
    const collect = (id) => {
      if (keep.has(id)) return;
      keep.add(id);
      for (const n of flatNodes) if (Number(n.parentId) === id) collect(Number(n.id));
    };
    collect(sysId);
    scoped = flatNodes.filter((n) => keep.has(Number(n.id)));
  }
  const trajStats = await trajectoryDao.statsByFunctionIds(
    scoped.filter((n) => Number(n.type) === 3).map((n) => Number(n.id)),
  );
  const batchStats = await batchRecordingDao.statsByFunctionId();
  const cards = await listFlowCards();
  const kbCardsByNode = new Map();
  for (const card of cards) {
    const r = resolveMenuPath(card.menu_path, flatNodes);
    if (r.matchStatus === 'matched') {
      kbCardsByNode.set(r.matchedNodeId, (kbCardsByNode.get(r.matchedNodeId) || 0) + 1);
    }
  }
  const report = rollupCoverage(scoped, { trajStats, batchStats, kbCardsByNode });
  const rows = type === 'all' ? report.rows : report.rows.filter((r) => r.type === 3);
  rows.sort((a, b) => String(a.path).localeCompare(String(b.path), 'zh-Hans-CN'));
  return { rows, summary: report.summary };
}
