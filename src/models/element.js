/**
 * Helpers for trajectory_step.element_json (ElementInfo + candidates[]).
 *
 * prepareElementJson / hasUsableLocator are the write-path policy:
 * offline rebuild may invent xpath_smart from cues, but must NOT set
 * locator_verified=true (only DOM-evaluated snaps may claim that).
 */

import { normalizeActionName } from './action-name.js';
import { enrichLocatorFields, sanitizeAttributes } from '../cdp/locator-candidates.js';

/**
 * @typedef {Object} LocatorCandidate
 * @property {'css'|'xpath_full'|'xpath_smart'} type
 * @property {string} value
 */

/**
 * @typedef {Object} ElementJson
 * @property {string} [tag]
 * @property {string} [xpath]
 * @property {string} [cssSelector]
 * @property {Object<string,string>} [attributes]
 * @property {string} [text]
 * @property {string} [xpath_smart]
 * @property {string} [xpath_full]
 * @property {string} [xpath_abs]
 * @property {LocatorCandidate[]} [candidates]
 * @property {string} [target_kind]
 * @property {string} [locator_scope]
 * @property {number} [locator_occurrence]
 * @property {boolean} [locator_verified]
 * @property {string} [locator_strategy]
 * @property {string} [locator_fallback_reason]
 * @property {string} [formLabel]
 * @property {string[]} [options] — full el-select inventory at record time (export/reference; not the selected value)
 */

/** Single-target DOM actions that require a usable xpath on write. */
export const SINGLE_TARGET_ACTIONS = Object.freeze([
  'fill_form_field',
  'select_option',
  'select_tree_option',
  'click_radio',
  'click_element_by_index',
  'click_menu_item',
  'click_table_row_button',
  'click_table_row_radio',
  'click_adjacent_button',
  'click_icon_button',
  'switch_tab',
  'close_dialog',
]);

/** Composite / non-DOM utilities — locator validation skipped. */
export const LOCATOR_EXEMPT_ACTIONS = Object.freeze([
  'login',
  'expand_all_el_tree',
  'go_to_url',
  'wait_for_loading',
  'done',
  'save_form_snapshot',
  'scan_visible_fields',
  'get_page_state',
]);

/**
 * @param {string} actionType
 */
export function isSingleTargetAction(actionType) {
  const a = normalizeActionName(actionType || '');
  return SINGLE_TARGET_ACTIONS.includes(a);
}

/**
 * @param {unknown} element
 * @returns {boolean}
 */
export function hasUsableLocator(element) {
  if (!element || typeof element !== 'object') return false;
  const el = /** @type {Record<string, unknown>} */ (element);
  const candidates = Array.isArray(el.candidates) ? el.candidates : [];
  const smart = String(
    el.xpath_smart
    || candidates.find((c) => c && c.type === 'xpath_smart')?.value
    || '',
  ).trim();
  const full = String(
    el.xpath_full
    || el.xpath_abs
    || candidates.find((c) => c && c.type === 'xpath_full')?.value
    || '',
  ).trim();
  const primary = String(el.xpath || el.target || '').trim();
  const usable = (s) => {
    if (!s) return false;
    if (s.startsWith('//') || s.startsWith('(') || s.startsWith('/')) return true;
    return false;
  };
  return usable(smart) || usable(full) || usable(primary);
}

/**
 * Preserve / copy locator diagnostic fields onto a normalized element.
 * @param {Record<string, unknown>} target
 * @param {Record<string, unknown>} source
 */
function copyLocatorMeta(target, source) {
  for (const key of [
    'target_kind',
    'locator_scope',
    'locator_occurrence',
    'locator_verified',
    'locator_strategy',
    'locator_fallback_reason',
    'formLabel',
    'bu_xpath',
    'region_role',
    'region_id',
    'region_label',
    'region_chrome',
    'region_section',
    'region_block',
  ]) {
    if (source[key] !== undefined && source[key] !== null && source[key] !== '') {
      target[key] = source[key];
    }
  }
  if (Array.isArray(source.layers)) target.layers = source.layers;
  if (source.bbox && typeof source.bbox === 'object' && !Array.isArray(source.bbox)) target.bbox = source.bbox;
  if (source.page_bbox && typeof source.page_bbox === 'object' && !Array.isArray(source.page_bbox)) target.page_bbox = source.page_bbox;
  if (Array.isArray(source.options)) {
    const opts = [];
    const seen = new Set();
    for (const o of source.options) {
      const s = String(o ?? '').trim();
      if (!s || s === '请选择' || seen.has(s)) continue;
      seen.add(s);
      opts.push(s);
    }
    if (opts.length) target.options = opts;
  }
  if (source.locator_verified === true) target.locator_verified = true;
  if (source.locator_verified === false) target.locator_verified = false;
}

/**
 * Build element_json from runtime element info (ActionEntry / StepEntry shape).
 * Preserves strategy / fallback / scope metadata.
 * @param {Object} element
 * @returns {ElementJson}
 */
export function toElementJson(element = {}) {
  const candidates = Array.isArray(element.candidates)
    ? element.candidates.map((c) => ({
      type: c.type,
      value: c.value ?? '',
    }))
    : [];
  const xpathSmart = String(
    element.xpath_smart
    || candidates.find((c) => c && c.type === 'xpath_smart')?.value
    || '',
  ).trim();
  const xpathFull = String(
    element.xpath_full
    || element.xpath_abs
    || candidates.find((c) => c && c.type === 'xpath_full')?.value
    || '',
  ).trim();
  const strategy = String(element.locator_strategy || '').trim();
  const primary = strategy === 'xpath_full'
    ? (xpathFull || element.xpath || element.target || xpathSmart || '')
    : (xpathSmart || element.xpath || element.target || xpathFull || '');

  /** @type {ElementJson & Record<string, unknown>} */
  const json = {
    tag: element.tag || element.tagName || element.tag_name || '',
    xpath: primary,
    cssSelector: element.cssSelector || element.css_selector || '',
    attributes: sanitizeAttributes(
      element.attributes && typeof element.attributes === 'object' ? element.attributes : {},
    ),
    text: element.text || '',
  };
  if (xpathSmart) json.xpath_smart = xpathSmart;
  if (xpathFull) {
    json.xpath_full = xpathFull;
    json.xpath_abs = xpathFull;
  }
  if (candidates.length) json.candidates = candidates;
  copyLocatorMeta(json, /** @type {Record<string, unknown>} */ (element));
  if (!json.locator_strategy) {
    json.locator_strategy = xpathSmart ? 'xpath_smart' : (xpathFull || primary ? 'xpath_full' : '');
  }
  return json;
}

/**
 * Derive / normalize element_json for persistence.
 * Offline service must not promote non-DOM-verified expressions to locator_verified.
 *
 * @param {object} opts
 * @param {object|null} [opts.element]
 * @param {string} [opts.actionType]
 * @param {object|null} [opts.params]
 * @param {boolean} [opts.requireUsable=false] — throw if single-target and no xpath
 * @returns {ElementJson|null}
 */
export function prepareElementJson({
  element = null,
  actionType = '',
  params = null,
  requireUsable = false,
} = {}) {
  const action = normalizeActionName(actionType || '');
  const p = params && typeof params === 'object' ? params : {};
  const raw = element && typeof element === 'object' ? { ...element } : {};

  // Merge action params into enrichment cues
  const formLabel = raw.formLabel || raw.label_text || p.label_text || '';
  const text = raw.text
    || p.text
    || p.menu_text
    || p.button_text
    || p.tab_name
    || p.option_text
    || '';
  const targetKind = raw.target_kind || raw.targetKind || '';
  const inferredKind = targetKind
    || (action === 'click_menu_item' ? 'menu'
      : action === 'click_icon_button' ? 'icon'
        : action === 'switch_tab' ? 'tab'
          : action === 'click_table_row_button' ? 'table_row_button'
            : action === 'click_table_row_radio' ? 'table_row_radio'
              : action === 'click_adjacent_button' ? 'adjacent_button'
                : action === 'close_dialog' ? 'dialog_close'
                  : action === 'select_tree_option' ? 'form_tree_select'
                    : action.startsWith('fill_') || action === 'select_option'
                      || action === 'click_radio'
                      ? 'form_input'
                      : '');

  const hadVerified = raw.locator_verified === true;
  const enriched = enrichLocatorFields({
    ...raw,
    tag: raw.tag || raw.tagName || raw.tag_name || '',
    text,
    formLabel,
    target_kind: inferredKind,
    rowText: raw.rowText || raw.row_text || p.row_text || '',
    buttonText: raw.buttonText || raw.button_text || p.button_text || '',
    menuText: raw.menuText || raw.menu_text || p.menu_text || '',
    tabName: raw.tabName || raw.tab_name || p.tab_name || '',
    optionText: raw.optionText || raw.option_text || p.option_text || '',
    // Offline: never invent verified
    locator_verified: false,
  });

  // Restore DOM-evaluated verified flag when caller already verified
  if (hadVerified && enriched.xpath_smart) {
    enriched.locator_verified = true;
    enriched.locator_strategy = 'xpath_smart';
    enriched.xpath = enriched.xpath_smart;
    delete enriched.locator_fallback_reason;
  } else if (!enriched.xpath_smart && (enriched.xpath_full || enriched.xpath)) {
    // Keep absolute as primary; do not claim verified smart
    enriched.locator_strategy = 'xpath_full';
    enriched.locator_verified = false;
    if (!enriched.locator_fallback_reason) {
      enriched.locator_fallback_reason = 'offline_or_unverified';
    }
  }

  const json = toElementJson(enriched);

  // Persist select option inventory from params when element lacked it
  if (!json.options && Array.isArray(p.options)) {
    const opts = [];
    const seen = new Set();
    for (const o of p.options) {
      const s = String(o ?? '').trim();
      if (!s || s === '请选择' || seen.has(s)) continue;
      seen.add(s);
      opts.push(s);
    }
    if (opts.length) json.options = opts;
  }

  if (requireUsable && isSingleTargetAction(action) && !LOCATOR_EXEMPT_ACTIONS.includes(action)) {
    if (!hasUsableLocator(json)) {
      const err = new Error(
        `locator-capture-error: single-target action "${action}" requires xpath_smart or xpath_full`,
      );
      err.statusCode = 400;
      err.code = 'LOCATOR_REQUIRED';
      throw err;
    }
  }

  return hasUsableLocator(json) || Object.keys(raw).length ? json : null;
}

/**
 * Convert a StepEntry-like action log item to TrajectoryStep entity fields (camelCase).
 * @param {Object} entry
 * @param {Object} [context] — trajectoryId, stepNumber, phaseNumber, etc.
 * @returns {import('./entities.js').TrajectoryStep}
 */
export function stepEntryToTrajectoryStep(entry, context = {}) {
  const actionType = normalizeActionName(entry.action || entry.actionType || '');
  const params = entry.params || entry.paramsJson || null;
  const element = entry.element && typeof entry.element === 'object' && !Array.isArray(entry.element)
    ? prepareElementJson({
      element: entry.element,
      actionType,
      params,
      requireUsable: false,
    })
    : null;
  return {
    actionType,
    params,
    element,
    extractedContent: entry.result ?? entry.extractedContent ?? '',
    success: entry.success ?? null,
    error: entry.error ?? null,
    phaseNumber: context.phaseNumber ?? entry.phaseNumber ?? entry.phase ?? 0,
    stepNumber: context.stepNumber ?? entry.stepNumber ?? 0,
    actionIndex: context.actionIndex ?? entry.actionIndex ?? 0,
    trajectoryId: context.trajectoryId ?? entry.trajectoryId,
    trajectoryPhaseId: context.trajectoryPhaseId ?? entry.trajectoryPhaseId ?? null,
    source: context.source ?? entry.source ?? 'agent',
  };
}

/**
 * Map trajectory_step row to action_{ts}.json entry format (for script_assembler).
 * @param {Object} step — camelCase TrajectoryStep from DAO
 * @returns {Object}
 */
export function trajectoryStepToActionEntry(step) {
  let el = step.element ?? step.elementJson ?? {};
  if (typeof el === 'string') {
    try { el = JSON.parse(el); } catch { el = {}; }
  }
  let params = step.params ?? step.paramsJson ?? {};
  if (typeof params === 'string') {
    try { params = JSON.parse(params); } catch { params = {}; }
  }
  const prepared = prepareElementJson({
    element: el,
    actionType: step.actionType || step.action || '',
    params,
    requireUsable: false,
  }) || toElementJson(el);
  const candidates = Array.isArray(prepared.candidates) ? prepared.candidates : [];
  const xpathSmart = prepared.xpath_smart || '';
  const xpathFull = prepared.xpath_full || prepared.xpath_abs || '';
  const primaryXpath = prepared.xpath || xpathSmart || xpathFull || '';
  const text = prepared.text || params?.text || '';
  const nextParams = { ...(params || {}) };
  if (text && !nextParams.text) nextParams.text = text;

  return {
    action: normalizeActionName(step.actionType || step.action || ''),
    params: nextParams,
    result: step.extractedContent || '',
    target: primaryXpath,
    cssSelector: prepared.cssSelector || '',
    tagName: prepared.tag || '',
    attributes: prepared.attributes || {},
    element: prepared,
    id: step.id != null ? String(step.id) : '',
    stepId: step.id != null ? String(step.id) : '',
    phaseId: step.trajectoryPhaseId ?? step.phaseId ?? null,
    phase: step.phaseNumber ?? step.phase ?? 0,
  };
}

/**
 * Map trajectory_step rows to assembler command entries (action_{ts}.json shape).
 * Shared by v2 trajectories assemble-file and the legacy assembled-replay prepare path.
 *
 * @param {Array} steps
 * @param {Object} [opts]
 * @param {boolean} [opts.preferEntryPhase=false] — when step.phaseNumber is missing,
 *   fall back to entry.phase (step.phase) instead of 0 (legacy assembled-replay behavior).
 * @returns {Object[]}
 */
export function stepsToActionCommands(steps, { preferEntryPhase = false } = {}) {
  return (steps || []).map((s) => {
    const entry = trajectoryStepToActionEntry(s);
    const rawEl = s.element ?? s.elementJson ?? null;
    const el = typeof rawEl === 'string'
      ? (() => { try { return JSON.parse(rawEl); } catch { return {}; } })()
      : (rawEl || {});
    return {
      ...entry,
      // Ensure target from either shape
      target: entry.target || el.xpath || el.target || '',
      phase: preferEntryPhase ? (s.phaseNumber ?? entry.phase ?? 0) : (s.phaseNumber ?? 0),
      source: s.source || 'agent',
    };
  });
}
