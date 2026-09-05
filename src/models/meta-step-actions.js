/**
 * Internal / non-business trajectory steps.
 * Still persisted for Type B (save_form_snapshot) and engineering,
 * but hidden from product step lists / stepCount by default.
 */
import { normalizeActionName } from './action-name.js';

/** Actions that must not appear as user-facing business steps. */
export const META_STEP_ACTIONS = Object.freeze([
  'save_form_snapshot',
  'scan_form_fields',
  'scan_visible_fields',
  'get_page_state',
  'get_pending_tasks',
  'init_task_list',
  'sync_tasks_from_errors',
  'task_done',
  'task_retry',
  'mark_field_done',
  'rebuild_task_list',
  'match_form_rule',
  'check_field_value',
  'verify_field_value',
  'wait_for_loading',
  'expand_all_el_tree',
  'take_screenshot',
  'save_trajectory',
  'save_business_data',
  'read_business_data',
  'close_notification',
]);

const META_SET = new Set(META_STEP_ACTIONS);

/**
 * Pure observation / engineering actions (no page interaction produced).
 * These are NOT persisted into trajectory_step at all.
 */
export const ENGINEERING_STEP_ACTIONS = Object.freeze([
  'semantic_snapshot',
  'read_error_notify',
  'read_xhr_log',
  'kb_flow',
]);

const ENGINEERING_SET = new Set(ENGINEERING_STEP_ACTIONS);

/**
 * 判断动作类型是否为观察/工程类动作（不落库）。
 * @param {string} [actionType] 动作类型
 * @returns {boolean} 是否为工程类动作
 */
export function isEngineeringStepAction(actionType) {
  const a = normalizeActionName(actionType || '');
  return Boolean(a) && ENGINEERING_SET.has(a);
}

/**
 * 判断动作类型是否为元步骤（不产生页面操作）。
 * @param {string} [actionType] 动作类型
 * @returns {boolean} 是否为元步骤动作
 */
export function isMetaStepAction(actionType) {
  const a = normalizeActionName(actionType || '');
  return Boolean(a) && META_SET.has(a);
}

/**
 * 判断步骤对象是否为元步骤。
 * @param {object} step 步骤对象
 * @returns {boolean} 是否为元步骤
 */
export function isMetaStep(step) {
  return isMetaStepAction(step?.actionType || step?.action || '');
}

/**
 * 过滤元步骤（默认剔除；includeMeta 时原样返回）。
 * @template T
 * @param {T[]} steps 步骤列表
 * @param {{ includeMeta?: boolean }} [opts] 选项
 * @returns {T[]} 过滤后的步骤列表
 */
export function filterMetaSteps(steps, { includeMeta = false } = {}) {
  if (includeMeta || !Array.isArray(steps)) return steps || [];
  return steps.filter((s) => !isMetaStep(s));
}
