/**
 * Heal Contract builder — pure function mapping a failure + MissingReason to the
 * structured contract consumed by the Python Agent.
 *
 * Prompt side consumes: mode / scope / strategy / reason / target.
 * Runtime side consumes: runtime.
 * The two sides are built separately here and must never be merged downstream.
 */
import { analyzeMissingReason } from './missing-reason-analyzer.js';

const TARGET_KEYS = ['action', 'label', 'xpath_smart', 'option_text'];
const RUNTIME_KEYS = ['retry_count', 'max_steps'];

function normalizeInt(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function pickXpathSmart(failedEntry) {
  const element = failedEntry?.element && typeof failedEntry.element === 'object'
    ? failedEntry.element
    : {};
  const candidates = Array.isArray(element.candidates) ? element.candidates : [];
  for (const candidate of candidates) {
    if (candidate?.type === 'xpath_smart' && candidate.value) {
      return String(candidate.value).trim();
    }
  }
  return String(
    element.xpath_smart
    || failedEntry?.target
    || element.xpath
    || '',
  ).trim();
}

function pickOptionText(action, params) {
  const explicit = String(
    params?.option_text
    || params?.node_text
    || '',
  ).trim();
  if (explicit) return explicit;
  if (['select_option', 'select_tree_option', 'click_radio'].includes(action)) {
    return String(params?.value || params?.option || params?.text || '').trim();
  }
  return '';
}

function isReasonShape(reason) {
  return reason
    && typeof reason === 'object'
    && typeof reason.category === 'string'
    && typeof reason.suggestedAction === 'string'
    && Array.isArray(reason.evidence);
}

const STRATEGY_BY_CATEGORY = {
  changed_structure: 'structure_repair',
  not_loaded: 'retry_current_step',
  conditional_absent: 'visibility_recovery',
  business_locked: 'visibility_recovery',
  permission_blocked: 'visibility_recovery',
  not_visible: 'visibility_recovery',
  unknown: 'visibility_recovery',
};

/**
 * Build a structured heal contract from a failed entry and missing-reason analysis.
 * @param {object} input heal contract input
 * @param {object} [input.failedEntry] the failed action entry (action, params, element, …)
 * @param {string|object} [input.errorResult] error text or structured error from the failed step
 * @param {'step'|'form_structure'} [input.healType] heal scope (default 'step')
 * @param {number} [input.maxSteps] max heal retry steps (default 12, or 24 for form_structure)
 * @param {object|null} [input.reason] pre-resolved missing reason; default: analyzeMissingReason(...)
 * @param {number} [input.retryCount] current retry count (default 1)
 * @param {object} [input.context] extra context for reason analysis
 * @param {object|null} [input.formStructureReport] form-structure heal report (for healType='form_structure')
 * @returns {{
 *   mode: 'heal',
 *   scope: 'step'|'form_structure',
 *   strategy: 'visibility_recovery'|'structure_repair'|'retry_current_step',
 *   reason: object,
 *   target: object,
 *   runtime: object,
 * }} structured heal contract for the Python Agent
 */
export function buildHealContract({
  failedEntry = {},
  errorResult = '',
  healType = 'step',
  maxSteps = 12,
  reason = null,
  retryCount = 1,
  context = {},
  formStructureReport = null,
} = {}) {
  const failed = failedEntry && typeof failedEntry === 'object' ? failedEntry : {};
  const action = String(failed.action || '').trim();
  const params = failed.params && typeof failed.params === 'object' ? failed.params : {};
  const normalizedHealType = String(healType || 'step').toLowerCase() === 'form_structure'
    ? 'form_structure'
    : 'step';
  const defaultMaxSteps = normalizedHealType === 'form_structure' ? 24 : 12;
  const maxStepsInt = normalizeInt(maxSteps, defaultMaxSteps);

  const resolvedReason = isReasonShape(reason)
    ? reason
    : analyzeMissingReason({
        action,
        params,
        errorResult,
        healType: normalizedHealType,
        formStructureReport,
        context,
      });

  const category = STRATEGY_BY_CATEGORY[resolvedReason.category]
    ? resolvedReason.category
    : 'unknown';
  const strategy = STRATEGY_BY_CATEGORY[category] || 'visibility_recovery';

  const label = String(
    params.label_text
    || params.label
    || (failed.element && typeof failed.element === 'object' ? failed.element.formLabel : '')
    || params.placeholder
    || '',
  ).trim();

  return {
    mode: 'heal',
    scope: normalizedHealType,
    strategy,
    reason: {
      category,
      confidence: Number.isFinite(Number(resolvedReason.confidence))
        ? Number(resolvedReason.confidence)
        : 0.2,
      evidence: Array.isArray(resolvedReason.evidence)
        ? resolvedReason.evidence.map((item) => String(item ?? '').slice(0, 240))
        : [],
      suggestedAction: String(resolvedReason.suggestedAction || 'fail'),
    },
    target: {
      action,
      label,
      xpath_smart: pickXpathSmart(failed),
      option_text: pickOptionText(action, params),
    },
    runtime: {
      retry_count: normalizeInt(retryCount, 1),
      max_steps: maxStepsInt,
    },
  };
}

export { TARGET_KEYS, RUNTIME_KEYS };
