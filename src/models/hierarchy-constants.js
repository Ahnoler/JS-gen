/**
 * Hierarchy node types in unified `system` table.
 * 0 = 根（唯一 id=0）, 1 = 系统, 2 = 模块, 3 = 功能
 */
export const NODE_TYPE = Object.freeze({
  ROOT: 0,
  SYSTEM: 1,
  MODULE: 2,
  FUNCTION: 3,
});

export const TYPE_LABEL = Object.freeze({
  [NODE_TYPE.ROOT]: '根',
  [NODE_TYPE.SYSTEM]: '系统',
  [NODE_TYPE.MODULE]: '模块',
  [NODE_TYPE.FUNCTION]: '功能',
});

/** Sentinel root row id / parent_id for type=1 系统 nodes. */
export const ROOT_NODE_ID = 0;

/**
 * True for null / undefined / 0 (points at virtual/real root).
 * @param {number|string|null|undefined} parentId 父节点 id
 * @returns {boolean} 是否指向根节点
 */
export function isRootParentId(parentId) {
  if (parentId == null || parentId === '') return true;
  const n = Number(parentId);
  return Number.isFinite(n) && n === ROOT_NODE_ID;
}

/**
 * 是否为根节点 id（0）。
 * @param {number|string} id 节点 id
 * @returns {boolean} 是否为根节点
 */
export function isRootNodeId(id) {
  return Number(id) === ROOT_NODE_ID;
}

/** Seed UUIDs (system.system_id) — must not be deleted. */
export const SEED_ROOT_ID = '00000000-0000-0000-0000-000000000000';
export const SEED_SYSTEM_ID = '00000000-0000-0000-0000-000000000001';
export const SEED_MODULE_ID = '00000000-0000-0000-0000-000000000002';
export const SEED_FUNCTION_ID = '00000000-0000-0000-0000-000000000003';

export const SEED_UUID_BY_TYPE = Object.freeze({
  [NODE_TYPE.ROOT]: SEED_ROOT_ID,
  [NODE_TYPE.SYSTEM]: SEED_SYSTEM_ID,
  [NODE_TYPE.MODULE]: SEED_MODULE_ID,
  [NODE_TYPE.FUNCTION]: SEED_FUNCTION_ID,
});
