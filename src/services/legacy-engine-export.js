/**
 * Traditional execution-engine export mapping.
 *
 * Only maps actions we can currently record — not the full traditional-engine
 * type catalog. Contract:
 *   name      — 操作名称
 *   type      — 类型（见 ACTION_TO_ENGINE_TYPE）
 *   value     — 值
 *   locateBy  — 定位方法 (default xpath)
 *   target    — 操作对象 (prefer xpath_smart; fall back to absolute xpath_full)
 */

import { normalizeActionName } from '../models/action-name.js';
import { trajectoryStepToActionEntry } from '../models/element.js';

/**
 * Recorded action → traditional-engine type.
 * Only entries for actions the agent/manual recorder actually persist.
 */
export const ACTION_TO_ENGINE_TYPE = Object.freeze({
  fill_form_field: 'input',
  select_option: 'select:click',
  select_tree_option: 'select:tree',
  click_element_by_index: 'click',
  click_menu_item: 'click',
  click_table_row_button: 'click',
  click_table_row_radio: 'radio',
  click_adjacent_button: 'click',
  click_icon_button: 'click',
  click_radio: 'radio',
  switch_tab: 'click',
  close_dialog: 'click',
  expand_all_el_tree: 'click',
});

/** Types we emit today (derived from ACTION_TO_ENGINE_TYPE). */
export const LEGACY_ENGINE_EMITTED_TYPES = Object.freeze(
  [...new Set([...Object.values(ACTION_TO_ENGINE_TYPE), 'date'])].sort(),
);

/** Meta / scan / memory / non-recorded-UI actions — not exported */
export const SKIP_ACTIONS = new Set([
  'scroll_down',
  'scroll_up',
  'get_page_state',
  'scan_form_fields',
  'scan_visible_fields',
  'check_field_value',
  'verify_field_value',
  'take_screenshot',
  'save_trajectory',
  'save_business_data',
  'read_business_data',
  'match_form_rule',
  'init_task_list',
  'get_pending_tasks',
  'sync_tasks_from_errors',
  'login',
  'task_done',
  'task_retry',
  'save_form_snapshot',
  'done',
  'wait_for_loading',
  'go_to_url',
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
    desc: `当前可录制动作映射：${LEGACY_ENGINE_EMITTED_TYPES.join(' | ')}`,
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
    desc: '默认 xpath',
    default: 'xpath',
  },
  {
    key: 'target',
    zh: '操作对象',
    type: 'string',
    desc: '优先相对 xpath（xpath_smart）；无则回退绝对 xpath_full，不丢弃步骤',
  },
]);

/**
 * Prefer relative xpath_smart; fall back to absolute when smart is unavailable.
 * Some controls genuinely have no stable relative xpath — still export a locator.
 * @param {object} entry — from trajectoryStepToActionEntry
 * @returns {{ target: string, source: 'xpath_smart'|'xpath_full'|'' }} chosen locator + source
 */
export function pickExportTarget(entry) {
  const el = entry?.element || {};
  const cands = Array.isArray(el.candidates) ? el.candidates : [];
  const smart = String(
    el.xpath_smart
    || cands.find((c) => c?.type === 'xpath_smart')?.value
    || '',
  ).trim();
  if (smart.startsWith('//') || smart.startsWith('(')) {
    return { target: smart, source: 'xpath_smart' };
  }

  const primary = String(entry?.target || el.xpath || '').trim();
  if (primary.startsWith('//') || primary.startsWith('(')) {
    return { target: primary, source: 'xpath_smart' };
  }

  const full = String(
    el.xpath_full
    || el.xpath_abs
    || cands.find((c) => c?.type === 'xpath_full')?.value
    || '',
  ).trim();
  if (full) {
    return { target: full, source: 'xpath_full' };
  }

  // Absolute-looking primary (e.g. /html/body/...)
  if (primary.startsWith('/')) {
    return { target: primary, source: 'xpath_full' };
  }

  return { target: '', source: '' };
}

/**
 * @deprecated use pickExportTarget — kept for callers expecting a string
 * @param {object} entry action entry
 * @returns {string} chosen target xpath
 */
export function pickRelativeTarget(entry) {
  return pickExportTarget(entry).target;
}

/**
 * Build a human-readable operation name from action + params + element.
 * @param {string} action normalized action name
 * @param {object} [params] action params
 * @param {object} [element] element info
 * @returns {string} localized operation name
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
 * Pick the value field for the engine op (fill value / option / url).
 * @param {string} action normalized action name
 * @param {object} [params] action params
 * @returns {string} value string (empty when not applicable)
 */
export function pickOperationValue(action, params = {}) {
  const p = params || {};
  switch (action) {
    case 'fill_form_field':
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

function resolveEngineType(action, element = {}) {
  const mapped = ACTION_TO_ENGINE_TYPE[action];
  if (!mapped) return null;
  if (action !== 'fill_form_field') return mapped;
  const blob = [
    element.target_kind,
    element.xpath_smart,
    element.xpath,
    element.xpath_full,
    element.cssSelector,
    JSON.stringify(element.attributes || {}),
  ].join(' ');
  if (/el-date-editor|tsscdatepicker|form_date|DatePicker/i.test(blob)) return 'date';
  return mapped;
}

/**
 * Map one DB / action-entry step to the 5-field engine op (+ metadata).
 * @param {object} step — trajectory_step DAO shape or action entry
 * @returns {object|null} engine op (5 fields + meta), or null if action is not exportable
 */
export function mapStepToLegacyEngineOp(step) {
  const entry = step?.action && step?.element !== undefined && !step?.actionType
    ? step
    : trajectoryStepToActionEntry(step || {});
  const action = normalizeActionName(entry.action || step?.actionType || '');
  if (!action || SKIP_ACTIONS.has(action)) return null;

  const engineType = resolveEngineType(action, entry.element || {});
  if (!engineType) return null;
  const params = entry.params || {};
  const element = entry.element || {};
  const { target, source } = pickExportTarget(entry);
  const warnings = [];
  if (source === 'xpath_full') warnings.push('absolute_xpath_fallback');
  if (!target) warnings.push('missing_xpath');

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
      targetSource: source || null,
      warnings,
      // Pass through raw step payloads (no clone) — consumer decides what to use
      element: step?.element ?? step?.elementJson ?? entry.element ?? null,
      params: step?.params ?? step?.paramsJson ?? entry.params ?? null,
    },
  };
}

/**
 * @param {object[]} steps trajectory steps
 * @param {{ stepIds?: Array<number|string>, phaseIds?: Array<number|string>, includeMeta?: boolean }} [opts] filter + meta options
 * @returns {{ schemaVersion: number, fields: object[], count: number, skipped: object, stats: object, operations: object[] }} engine export payload
 */
export function exportStepsToLegacyEngine(steps, opts = {}) {
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
  let absoluteFallback = 0;

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
    if (op.meta?.targetSource === 'xpath_full') absoluteFallback += 1;
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
    },
    stats: {
      absoluteFallback,
    },
    operations,
  };
}
