/**
 * Hierarchy node types in unified `system` table.
 * 1 = 系统, 2 = 模块, 3 = 功能（不从 0 起计）
 */
export const NODE_TYPE = Object.freeze({
  SYSTEM: 1,
  MODULE: 2,
  /** @deprecated use MODULE */
  PROCESS: 2,
  FUNCTION: 3,
});

export const TYPE_LABEL = Object.freeze({
  [NODE_TYPE.SYSTEM]: '系统',
  [NODE_TYPE.MODULE]: '模块',
  [NODE_TYPE.FUNCTION]: '功能',
});

/** Seed UUIDs (system.system_id) — must not be deleted. */
export const SEED_SYSTEM_ID = '00000000-0000-0000-0000-000000000001';
export const SEED_MODULE_ID = '00000000-0000-0000-0000-000000000002';
/** @deprecated use SEED_MODULE_ID */
export const SEED_PROCESS_ID = SEED_MODULE_ID;
export const SEED_FUNCTION_ID = '00000000-0000-0000-0000-000000000003';

export const SEED_UUID_BY_TYPE = Object.freeze({
  [NODE_TYPE.SYSTEM]: SEED_SYSTEM_ID,
  [NODE_TYPE.MODULE]: SEED_MODULE_ID,
  [NODE_TYPE.FUNCTION]: SEED_FUNCTION_ID,
});
