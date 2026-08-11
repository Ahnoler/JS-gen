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
  'save_case_data',
  'read_case_data',
  'close_notification',
]);

const META_SET = new Set(META_STEP_ACTIONS);

/**
 * @param {string} [actionType]
 * @returns {boolean}
 */
export function isMetaStepAction(actionType) {
  const a = normalizeActionName(actionType || '');
  return Boolean(a) && META_SET.has(a);
}

/**
 * @param {object} step
 * @returns {boolean}
 */
export function isMetaStep(step) {
  return isMetaStepAction(step?.actionType || step?.action || '');
}

/**
 * @template T
 * @param {T[]} steps
 * @param {{ includeMeta?: boolean }} [opts]
 * @returns {T[]}
 */
export function filterMetaSteps(steps, { includeMeta = false } = {}) {
  if (includeMeta || !Array.isArray(steps)) return steps || [];
  return steps.filter((s) => !isMetaStep(s));
}
