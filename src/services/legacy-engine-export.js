/**
 * Traditional execution-engine export mapping.
 *
 * Contract (agreed; engine-side naming may evolve):
 *   name      — 操作名称
 *   type      — 类型 (click|input|select|tab|close|wait|navigate|expand|…)
 *   value     — 值
 *   locateBy  — 定位方法 (default xpath)
 *   target    — 操作对象 (relative xpath_smart preferred)
 */

import { normalizeActionName } from '../models/action-name.js';
import { trajectoryStepToActionEntry } from '../models/element.js';

/** action → engine type (parity with Python ACTION_TO_COMMAND) */
export const ACTION_TO_ENGINE_TYPE = Object.freeze({
  fill_form_field: 'input',
  fill_date_field: 'input',
  select_option: 'select',
  select_tree_option: 'select',
  click_element_by_index: 'click',
  click_menu_item: 'click',
  click_table_row_button: 'click',
  click_table_row_radio: 'click',
  click_adjacent_button: 'click',
  click_icon_button: 'click',
  click_radio: 'click',
  switch_tab: 'tab',
  close_dialog: 'close',
  wait_for_loading: 'wait',
  go_to_url: 'navigate',
  expand_all_el_tree: 'expand',
});

/** Meta / scan / memory actions — not executable by a traditional UI engine */
const SKIP_ACTIONS = new Set([
  'scroll_down',
  'scroll_up',
  'get_page_state',
  'scan_form_fields',
  'scan_visible_fields',
  'check_field_value',
  'verify_field_value',
  'take_screenshot',
  'save_trajectory',
  'save_case_data',
  'read_case_data',
  'match_form_rule',
  'init_task_list',
  'get_pending_tasks',
  'sync_tasks_from_errors',
  'login',
  'task_done',
  'task_retry',
  'save_form_snapshot',
  'done',
]);

export const LEGACY_ENGINE_FIELD_SCHEMA = Object.freeze([
  {
    key: 'name',
    zh: '操作名称',
    type: 'string',
    desc: '可读操作描述（由动作 + 关键文案/标签拼成）',
  },
  {
    key: 'type',
    zh: '类型',
    type: 'string',
    desc: 'click | input | select | tab | close | wait | navigate | expand',
  },
  {
    key: 'value',
    zh: '值',
    type: 'string',
    desc: '填写/选项值；点击类通常为空',
  },
  {
    key: 'locateBy',
    zh: '定位方法',
    type: 'string',
    desc: '默认 xpath；后续可扩展 css 等',
    default: 'xpath',
  },
  {
    key: 'target',
    zh: '操作对象',
    type: 'string',
    desc: '相对 xpath（优先 xpath_smart）；无则空串',
  },
]);

/**
 * Prefer relative xpath_smart; never invent absolute as primary for engine export.
 * @param {object} entry — from trajectoryStepToActionEntry
 */
export function pickRelativeTarget(entry) {
  const el = entry?.element || {};
  const cands = Array.isArray(el.candidates) ? el.candidates : [];
  const smart = String(
    el.xpath_smart
    || cands.find((c) => c?.type === 'xpath_smart')?.value
    || '',
  ).trim();
  if (smart.startsWith('//') || smart.startsWith('(')) return smart;

  const primary = String(entry?.target || el.xpath || '').trim();
  if (primary.startsWith('//') || primary.startsWith('(')) return primary;

  return '';
}

/**
 * @param {string} action
 * @param {object} params
 * @param {object} element
 */
export function buildOperationName(action, params = {}, element = {}) {
  const p = params || {};
  const text = String(
    p.text || p.menu_text || p.tab_name || p.button_text || element.text || '',
  ).trim();
  const label = String(p.label_text || p.label || '').trim();
  const option = String(p.option_text || p.option || p.value || '').trim();
  const row = String(p.row_text || '').trim();

  switch (action) {
    case 'fill_form_field':
    case 'fill_date_field':
      return label ? `填写:${label}` : `填写:${action}`;
    case 'select_option':
    case 'select_tree_option':
      return label ? `选择:${label}` : `选择:${option || action}`;
    case 'click_radio':
      return label ? `单选:${label}` : `单选:${option || action}`;
    case 'click_menu_item':
      return text ? `菜单:${text}` : '点击菜单';
    case 'click_table_row_button':
      return row && text ? `表格:${row}/${text}` : (text ? `表格:${text}` : '表格按钮');
    case 'click_table_row_radio':
      return row ? `表格单选:${row}` : '表格单选';
    case 'click_adjacent_button':
      return label ? `邻钮:${label}` : '邻钮';
    case 'click_icon_button':
      return text ? `图标:${text}` : '图标按钮';
    case 'click_element_by_index':
      return text ? `点击:${text}` : '点击';
    case 'switch_tab':
      return text ? `页签:${text}` : '切换页签';
    case 'close_dialog':
      return '关闭弹窗';
    case 'wait_for_loading':
      return '等待加载';
    case 'go_to_url':
      return p.url ? `打开:${String(p.url).slice(0, 60)}` : '打开页面';
    case 'expand_all_el_tree':
      return '展开树';
    default:
      return action || 'unknown';
  }
}

/**
 * @param {string} action
 * @param {object} params
 */
export function pickOperationValue(action, params = {}) {
  const p = params || {};
  switch (action) {
    case 'fill_form_field':
    case 'fill_date_field':
      return String(p.value ?? p.option_text ?? p.text ?? '');
    case 'select_option':
    case 'select_tree_option':
    case 'click_radio':
      return String(p.option_text ?? p.value ?? p.option ?? '');
    case 'go_to_url':
      return String(p.url ?? '');
    default:
      return '';
  }
}

/**
 * Map one DB / action-entry step to the 5-field engine op (+ metadata).
 * @param {object} step — trajectory_step DAO shape or action entry
 * @returns {object|null} null if action is not exportable
 */
export function mapStepToLegacyEngineOp(step) {
  const entry = step?.action && step?.element !== undefined && !step?.actionType
    ? step
    : trajectoryStepToActionEntry(step || {});
  const action = normalizeActionName(entry.action || step?.actionType || '');
  if (!action || SKIP_ACTIONS.has(action)) return null;

  const engineType = ACTION_TO_ENGINE_TYPE[action] || 'click';
  const params = entry.params || {};
  const element = entry.element || {};
  const target = pickRelativeTarget(entry);
  const warnings = [];
  if (!target) warnings.push('missing_relative_xpath');

  return {
    name: buildOperationName(action, params, element),
    type: engineType,
    value: pickOperationValue(action, params),
    locateBy: 'xpath',
    target,
    // metadata (not part of the 5-field contract; useful for SPA / debugging)
    meta: {
      stepId: entry.stepId || entry.id || step?.id || null,
      action,
      phaseNumber: entry.phase ?? step?.phaseNumber ?? 0,
      ok: Boolean(target),
      warnings,
    },
  };
}

/**
 * @param {object[]} steps
 * @param {{ requireTarget?: boolean, stepIds?: Array<number|string>, phaseIds?: Array<number|string>, includeMeta?: boolean }} [opts]
 */
export function exportStepsToLegacyEngine(steps, opts = {}) {
  const requireTarget = opts.requireTarget === true;
  const includeMeta = opts.includeMeta !== false;
  const stepIdSet = opts.stepIds?.length
    ? new Set(opts.stepIds.map((x) => String(x)))
    : null;
  const phaseIdSet = opts.phaseIds?.length
    ? new Set(opts.phaseIds.map((x) => Number(x)))
    : null;

  const operations = [];
  let skippedMeta = 0;
  let skippedFilter = 0;
  let skippedNoTarget = 0;

  for (const step of steps || []) {
    if (stepIdSet) {
      const sid = String(step.id ?? step.stepId ?? '');
      if (!stepIdSet.has(sid)) {
        skippedFilter += 1;
        continue;
      }
    }
    if (phaseIdSet) {
      const phaseId = step.trajectoryPhaseId ?? step.phaseId;
      const hitPhaseNum = phaseIdSet.has(Number(step.phaseNumber ?? step.phase));
      const hitPhaseId = phaseId != null && phaseIdSet.has(Number(phaseId));
      if (!hitPhaseNum && !hitPhaseId) {
        skippedFilter += 1;
        continue;
      }
    }

    const op = mapStepToLegacyEngineOp(step);
    if (!op) {
      skippedMeta += 1;
      continue;
    }
    if (requireTarget && !op.target) {
      skippedNoTarget += 1;
      continue;
    }
    if (!includeMeta) {
      const { name, type, value, locateBy, target } = op;
      operations.push({ name, type, value, locateBy, target });
    } else {
      operations.push(op);
    }
  }

  return {
    schemaVersion: 1,
    fields: LEGACY_ENGINE_FIELD_SCHEMA,
    count: operations.length,
    skipped: {
      metaActions: skippedMeta,
      filtered: skippedFilter,
      missingTarget: skippedNoTarget,
    },
    operations,
  };
}
