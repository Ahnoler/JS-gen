/**
 * In-control-plane action_log copy (write-through cache, 2026-09-07 user design).
 *
 * 执行机每次上报 action_log_sync（全量快照语义）时，控制面同步维护一份内存副本；
 * 前端展示与假成功门闩判定读副本（即时），DB 降级为异步持久化层（最终一致，
 * persist 失败走 step_persist_failed 告警）。server 重启副本即失，查询侧回退 DB。
 *
 * 【部署架构】执行机→控制面只有出站 WS 一条通道（见 executor/ws-client.js 顶部注释），
 * 副本数据源就是该通道上的 action_log_sync 全量快照——不新增任何网络假设。
 */
import {
  META_STEP_ACTIONS,
  isEngineeringStepAction,
} from '../../models/meta-step-actions.js';

/** @type {Map<number, { entries: object[], updatedAt: number }>} trajectory DB id -> copy */
const copies = new Map();

const COPY_TTL_MS = 30 * 60 * 1000;

/**
 * Overwrite the copy for a trajectory with the latest full snapshot.
 * @param {number} trajectoryDbId trajectory DB id
 * @param {object[]} entries full _ACTION_LOG entries from the executor
 * @returns {void} nothing; copy is stored in-module
 */
export function setActionLogCopy(trajectoryDbId, entries) {
  const tid = Number(trajectoryDbId);
  if (!Number.isFinite(tid) || tid <= 0 || !Array.isArray(entries)) return;
  copies.set(tid, { entries, updatedAt: Date.now() });
}

/**
 * Get the copy snapshot, or null when absent (server restart / never recorded / cleared).
 * @param {number} trajectoryDbId trajectory DB id
 * @returns {{ entries: object[], updatedAt: number }|null}
 */
export function getActionLogCopy(trajectoryDbId) {
  const tid = Number(trajectoryDbId);
  if (!Number.isFinite(tid) || tid <= 0) return null;
  const copy = copies.get(tid);
  if (!copy) return null;
  if (Date.now() - copy.updatedAt > COPY_TTL_MS) {
    copies.delete(tid);
    return null;
  }
  return copy;
}

/**
 * Count business steps in the copy: excludes meta actions (persisted but hidden
 * from product stepCount) AND engineering/observation actions (never persisted),
 * matching the product stepCount semantics of refreshTrajectoryCounts.
 * @param {number} trajectoryDbId trajectory DB id
 * @returns {number}
 */
export function countBusinessSteps(trajectoryDbId) {
  const copy = getActionLogCopy(trajectoryDbId);
  if (!copy) return 0;
  return copy.entries.filter((e) => {
    const action = String(e?.action || e?.actionType || '').trim();
    return action && !META_STEP_ACTIONS.includes(action) && !isEngineeringStepAction(action);
  }).length;
}

/**
 * Drop the copy once DB persistence has caught up (query side falls back to DB).
 * @param {number} trajectoryDbId trajectory DB id
 * @returns {void} nothing; copy is removed in-module
 */
export function clearActionLogCopy(trajectoryDbId) {
  const tid = Number(trajectoryDbId);
  if (Number.isFinite(tid)) copies.delete(tid);
}
