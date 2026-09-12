/**
 * Missing Reason Analyzer — deterministic, pure-function rule engine (MVP).
 *
 * Node control plane owns failure-reason classification. It has no I/O and no
 * environment branches: the same input always yields the same MissingReason, so
 * scripts/characterization/characterize-heal-locate.mjs can pin the table.
 *
 * Rule priority (highest first):
 *   changed_structure → business_locked → permission_blocked
 *   → conditional_absent → not_loaded → not_visible → unknown
 */

const MAX_EVIDENCE_LEN = 160;

/**
 * 在诊断信息中暴露证据文本前归一化空白并限制长度。
 * @param {unknown} value 任意证据值
 * @param {number} [max] 最大输出长度
 * @returns {string} 截断后的单行文本
 */
function clipText(value, max = MAX_EVIDENCE_LEN) {
  const s = String(value ?? '').replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

/**
 * 将步骤错误转换为可比较的文本，同时保留结构化错误。
 * @param {unknown} errorResult 原始操作结果或抛出的错误
 * @returns {string} 确定性的错误表示
 */
function normalizeError(errorResult) {
  if (errorResult == null || errorResult === '') return '';
  if (typeof errorResult === 'string') return errorResult;
  if (errorResult instanceof Error) return errorResult.message || String(errorResult);
  try {
    return JSON.stringify(errorResult);
  } catch {
    return String(errorResult);
  }
}

/**
 * 将可选值转换为字符串数组并丢弃空条目。
 * @param {unknown} value 候选数组
 * @returns {string[]} 归一化后的非空字符串值
 */
function asStringArray(value) {
  return Array.isArray(value) ? value.map((v) => String(v ?? '')).filter(Boolean) : [];
}

/**
 * 将表单结构报告归一化为分类规则使用的字段。缺失或格式错误的报告会生成所有变更标记均为
 * false 的空报告。
 * @param {unknown} report 原始表单结构报告
 * @returns {{hasRequiredChange: boolean, hasOptionalChange: boolean, added_required: string[], added_optional: string[], missing_required: string[], missing_optional: string[]}} 归一化后的报告
 */
function normalizeReport(report) {
  if (!report || typeof report !== 'object') {
    return {
      hasRequiredChange: false,
      hasOptionalChange: false,
      added_required: [],
      added_optional: [],
      missing_required: [],
      missing_optional: [],
    };
  }
  const addedRequired = asStringArray(report.added_required);
  const addedOptional = asStringArray(report.added_optional);
  const missingRequired = asStringArray(report.missing_required);
  const missingOptional = asStringArray(report.missing_optional);
  return {
    hasRequiredChange: report.hasRequiredChange === true || addedRequired.length > 0 || missingRequired.length > 0,
    hasOptionalChange: report.hasOptionalChange === true || addedOptional.length > 0 || missingOptional.length > 0,
    added_required: addedRequired,
    added_optional: addedOptional,
    missing_required: missingRequired,
    missing_optional: missingOptional,
  };
}

const CONFIDENCE = {
  changed_structure: 0.95,
  business_locked: 0.9,
  permission_blocked: 0.9,
  conditional_absent: 0.85,
  not_loaded: 0.8,
  not_visible: 0.75,
  unknown: 0.2,
};

const SUGGESTED_ACTION = {
  changed_structure: 'repair',
  business_locked: 'skip',
  permission_blocked: 'skip',
  conditional_absent: 'skip',
  not_loaded: 'retry',
  not_visible: 'heal',
  unknown: 'fail',
};

const BUSINESS_LOCKED_RE = /disabled|read-?only|no-permission|locked/i;
const PERMISSION_BLOCKED_RE = /403|forbidden|unauthorized|无权限/i;
const CONDITIONAL_ABSENT_RE = /ok-skip:|absent[-_]?skip/i;
const NOT_LOADED_RE = /timeout|loading|page-idle|networkidle/i;
const NOT_VISIBLE_RE = /label-not-found|xpath-not-found|option-not-found|no-items|not-found|no-visible|false_ok|option-mismatch|option-not-synced|xpath[-_]miss|click-failed/i;

/**
 * Analyze a failed step and classify the missing reason into a deterministic category.
 * @param {object} input analyzer input
 * @param {string} [input.action] failed action name
 * @param {object} [input.params] failed action params
 * @param {string|object} [input.errorResult] error text or structured error from the failed step
 * @param {'step'|'form_structure'} [input.healType] heal scope (default 'step')
 * @param {object|null} [input.formStructureReport] form-structure diff report (for healType='form_structure')
 * @param {object} [input.context] extra context (timeout, absentSkip, previousAction, …)
 * @returns {{ category: string, confidence: number, evidence: string[], suggestedAction: string }} classified missing reason
 */
export function analyzeMissingReason({
  action = '',
  params = {},
  errorResult = '',
  healType = 'step',
  formStructureReport = null,
  context = {},
} = {}) {
  const actionText = String(action ?? '').trim();
  const errorText = normalizeError(errorResult);
  const healTypeText = String(healType ?? 'step').toLowerCase();
  const report = normalizeReport(formStructureReport);
  const ctx = context && typeof context === 'object' ? context : {};

  const evidence = [];
  if (errorText) evidence.push(`error=${clipText(errorText)}`);
  if (actionText) evidence.push(`action=${clipText(actionText, 80)}`);
  if (healTypeText === 'form_structure') evidence.push('heal_type=form_structure');
  if (report.added_required.length) evidence.push('report.added_required=non_empty');
  if (report.missing_required.length) evidence.push('report.missing_required=non_empty');
  if (report.added_optional.length) evidence.push('report.added_optional=non_empty');
  if (report.missing_optional.length) evidence.push('report.missing_optional=non_empty');
  if (ctx.timeout === true) evidence.push('context.timeout=true');
  if (ctx.absentSkip === true || ctx.absent_skip === true) evidence.push('context.absent_skip=true');
  const previousAction = ctx.previousAction ?? ctx.previous_action;
  if (previousAction) evidence.push(`previous_action=${clipText(previousAction, 80)}`);

  let category = 'unknown';
  if (
    healTypeText === 'form_structure'
    || report.hasRequiredChange
    || report.hasOptionalChange
  ) {
    category = 'changed_structure';
  } else if (BUSINESS_LOCKED_RE.test(errorText)) {
    category = 'business_locked';
  } else if (PERMISSION_BLOCKED_RE.test(errorText)) {
    category = 'permission_blocked';
  } else if (
    CONDITIONAL_ABSENT_RE.test(errorText)
    || ctx.absentSkip === true
    || ctx.absent_skip === true
  ) {
    category = 'conditional_absent';
  } else if (NOT_LOADED_RE.test(errorText) || ctx.timeout === true) {
    category = 'not_loaded';
  } else if (NOT_VISIBLE_RE.test(errorText)) {
    category = 'not_visible';
  }

  return {
    category,
    confidence: CONFIDENCE[category] ?? 0.2,
    evidence,
    suggestedAction: SUGGESTED_ACTION[category] ?? 'fail',
  };
}
