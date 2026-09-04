/**
 * A3 变更影响反查服务：菜单变更流水 → 受影响轨迹（functionId 绑定）与受影响 KB 卡（menu_path 段名命中）。
 * 纯推导函数与 IO 组装分离；只读，不写任何数据。
 */
import { getDB } from '../../config/database.js';
import * as menuChangeLogDao from '../dao/menu-change-log-dao.js';
import * as systemDao from '../dao/system-dao.js';
import { listFlowCards } from './kb-flow-cards.js';
import { normSegName } from './menu-path-matcher.js';

const TRAJECTORY_TABLE = 'trajectory';

/**
 * 从变更行 detail 提取参与名字匹配的候选名集合（新旧名）。
 * @param {object|string|null} detail 变更明细（对象或 JSON 字符串）
 * @returns {string[]} 非空候选名数组
 */
function detailNames(detail) {
  let d = detail;
  if (typeof d === 'string') {
    try {
      d = JSON.parse(d);
    } catch {
      d = null;
    }
  }
  if (!d || typeof d !== 'object') return [];
  return [d.oldName, d.name, d.newName]
    .filter((x) => x != null && String(x).trim() !== '')
    .map((x) => String(x).trim());
}

/**
 * 纯函数：变更流水 → 逐行影响面（轨迹按 nodeId 直查绑定；卡按新旧名段命中 menu_path）。
 * @param {Array<object>} changeRows menu_change_log 行（camelCase）
 * @param {{ flatNodes: Array<{id:number, parentId:number, name:string, type:number}>, trajectoriesByFunction: Map<number, Array<{id:number, name:string}>>, cards: Array<{flow:string, menu_path:string}> }} deps 节点/轨迹绑定索引/卡片
 * @returns {{ changes: Array<object>, summary: { changes: number, affectedTrajectoryCount: number, affectedKbCardCount: number } }} 影响报表
 */
export function deriveChangeImpacts(changeRows, { flatNodes, trajectoriesByFunction, cards }) {
  const cardSegs = cards.map((c) => ({
    card: c,
    segs: String(c.menu_path || '').split('/').map((s) => normSegName(s)).filter(Boolean),
  }));
  const changes = changeRows.map((row) => {
    const nodeId = row.nodeId == null ? null : Number(row.nodeId);
    const affectedTrajectories = nodeId != null ? (trajectoriesByFunction.get(nodeId) || []) : [];
    const names = detailNames(row.detail).map(normSegName);
    const affectedKbCards = cardSegs
      .filter(({ segs }) => names.some((nm) => nm !== '' && segs.includes(nm)))
      .map(({ card }) => card.flow);
    return { ...row, affectedTrajectories, affectedKbCards };
  });
  return {
    changes,
    summary: {
      changes: changes.length,
      affectedTrajectoryCount: changes.reduce((acc, c) => acc + c.affectedTrajectories.length, 0),
      affectedKbCardCount: changes.reduce((acc, c) => acc + c.affectedKbCards.length, 0),
    },
  };
}

/**
 * 组装变更影响分析：变更流水 + 轨迹绑定 + KB 卡一次性查齐后推导。
 * @param {number} systemNodeId 系统节点 id
 * @param {{ version?: number|string|null, limit?: number }} [opts] 版本过滤与行数上限（默认 200）
 * @returns {Promise<{ changes: Array<object>, summary: object }>} 影响报表（无变更→空表非错误）
 */
export async function analyzeChangeImpact(systemNodeId, { version, limit = 200 } = {}) {
  const changeRows = await menuChangeLogDao.listBySystem(Number(systemNodeId), {
    version: version || null,
    limit,
  });
  if (!changeRows.length) {
    return { changes: [], summary: { changes: 0, affectedTrajectoryCount: 0, affectedKbCardCount: 0 } };
  }
  const [flatNodes, cards] = await Promise.all([systemDao.listAll(), listFlowCards()]);
  const fnIds = [...new Set(flatNodes.map((n) => Number(n.id)))];
  const boundRows = fnIds.length
    ? await getDB()(TRAJECTORY_TABLE).whereIn('function_id', fnIds).select(['id', 'name', 'function_id'])
    : [];
  const trajectoriesByFunction = new Map();
  for (const r of boundRows) {
    const fid = Number(r.function_id);
    if (!trajectoriesByFunction.has(fid)) trajectoriesByFunction.set(fid, []);
    trajectoriesByFunction.get(fid).push({ id: Number(r.id), name: String(r.name || '') });
  }
  return deriveChangeImpacts(changeRows, { flatNodes, trajectoriesByFunction, cards });
}
