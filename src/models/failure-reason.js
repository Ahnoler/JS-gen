/**
 * Trajectory recording failure taxonomy.
 *
 * `kind` is the machine code persisted in `trajectory.failed_kind` (also used
 * for filtering/statistics). The mapped text is the user-facing *category*
 * (persisted in `trajectory.failed_reason`, shown by the frontend both as the
 * AI-recording toast and the list "录制异常" tooltip). Detailed causes stay in
 * backend logs only, so the UI never shows raw provider errors.
 */

/** kind → user-facing category text. */
export const TRAJECTORY_FAIL_REASONS = Object.freeze({
  // LLM gateway failures — all collapse to one category for the user.
  llm_insufficient_balance: 'LLM 调用异常',
  llm_auth: 'LLM 调用异常',
  llm_rate_limit: 'LLM 调用异常',
  llm_server: 'LLM 调用异常',
  llm_unknown: 'LLM 调用异常',
  // Recording execution / quality.
  phase_failed: '阶段执行失败',
  quality_failed: '录制质量未达标',
  zero_step: '未录制到步骤',
  runner_error: '录制执行异常',
  user_marked_failed: '人工标记录制异常',
  batch_failed: '批量任务失败',
  interrupted: '录制中断',
});

/** LLM failure kinds (all displayed as `LLM 调用异常`). */
export const LLM_FAIL_KINDS = Object.freeze([
  'llm_insufficient_balance',
  'llm_auth',
  'llm_rate_limit',
  'llm_server',
  'llm_unknown',
]);

/**
 * Map a failure kind to its user-facing category text.
 * @param {string} kind failure kind code
 * @returns {string} category text (falls back to a generic label)
 */
export function failReasonText(kind) {
  return TRAJECTORY_FAIL_REASONS[kind] || '录制异常';
}

/**
 * Whether a failure kind belongs to the LLM-call family.
 * @param {string} kind failure kind code
 * @returns {boolean} true when kind is an LLM failure
 */
export function isLlmFailKind(kind) {
  return LLM_FAIL_KINDS.includes(kind);
}
