/**
 * In-control-plane action_log copy (write-through cache, 2026-09-07 user design).
 *
 * 执行机上报 action_log_sync：`syncMode=full` 覆盖副本；`syncMode=delta` 按
 * removedIds 删 + entries 追加（缺省/legacy 无 syncMode 视为 full）。
 * 前端展示与假成功门闩判定读副本（即时），DB 降级为异步持久化层。
 *
 * 【部署架构】执行机→控制面只有出站 WS 一条通道；增量 sync 降低管道字节，
 * 周期性 full（Python 侧）便于控制面重启后重新灌满副本。
 *
 * 副本有意限定在进程内，并会在短暂空闲后过期；因此调用方必须将本模块视为
 * 加速与实时状态视图，而非操作历史的持久化来源。
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
 * Apply an action_log_sync payload to the in-memory copy (full replace or delta merge).
 * @param {number} trajectoryDbId trajectory DB id
 * @param {object|null|undefined} payload sync payload (`entries` / `removedIds` / `syncMode`)
 * @returns {void}
 */
export function applyActionLogSync(trajectoryDbId, payload) {
  const tid = Number(trajectoryDbId);
  if (!Number.isFinite(tid) || tid <= 0) return;
  const entries = Array.isArray(payload?.entries) ? payload.entries : [];
  const removedIds = Array.isArray(payload?.removedIds) ? payload.removedIds : [];
  const mode = payload?.syncMode === 'delta' ? 'delta' : 'full';

  if (mode === 'full') {
    setActionLogCopy(tid, entries);
    return;
  }

  let copy = copies.get(tid);
  if (!copy) {
    copy = { entries: [], updatedAt: Date.now() };
    copies.set(tid, copy);
  }

  if (removedIds.length) {
    const drop = new Set(removedIds.map((id) => String(id || '')).filter(Boolean));
    if (drop.size) {
      copy.entries = copy.entries.filter((e) => !drop.has(String(e?.id || '')));
    }
  }

  const seen = new Set(
    copy.entries.map((e) => String(e?.id || '')).filter(Boolean),
  );
  for (const entry of entries) {
    const id = entry?.id != null ? String(entry.id) : '';
    if (!id || seen.has(id)) continue;
    copy.entries.push(entry);
    seen.add(id);
  }
  copy.updatedAt = Date.now();
}

/**
 * Get the copy snapshot, or null when absent (server restart / never recorded / cleared).
 * @param {number} trajectoryDbId trajectory DB id
 * @returns {{ entries: object[], updatedAt: number }|null} copy snapshot or null when absent
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
 * @returns {number} business step count in the copy (0 when absent)
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
 * Count business steps of ONE phase in the copy (fake-success gate, per-phase
 * variant of countBusinessSteps). Copy entries carry `phase` = phase number from
 * the Python _ACTION_LOG dump; steps without a phase number never match.
 * @param {number} trajectoryDbId trajectory DB id
 * @param {number} phaseNumber 1-based phase number
 * @returns {number} business step count within that phase (0 when copy absent)
 */
export function countBusinessStepsByPhase(trajectoryDbId, phaseNumber) {
  const copy = getActionLogCopy(trajectoryDbId);
  if (!copy) return 0;
  const pn = Number(phaseNumber);
  if (!Number.isFinite(pn)) return 0;
  return copy.entries.filter((e) => {
    const action = String(e?.action || e?.actionType || '').trim();
    if (!action || META_STEP_ACTIONS.includes(action) || isEngineeringStepAction(action)) return false;
    return Number(e?.phase) === pn;
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
