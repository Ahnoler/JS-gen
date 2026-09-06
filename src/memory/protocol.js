/**
 * AI 记忆系统 — 跨端契约常量（Node ↔ Python 共享约定）。
 * 权威定义见 docs/AI记忆系统优化方案.md §5.1 / §5.6。
 * Python 侧镜像：scripts/memory/writer.py。
 */

/** 已知事件类型（append-only 事件流）。未来新增类型只追加，不改旧语义。 */
export const KNOWN_EVENT_TYPES = new Set([
  'action',
  'phase_done',
  'business_saved',
  'case_read',
  'contract',
  'summary',
  'decision',
  'context_drop',
  'nav',
  'notification',
  'page_state',
  'form_state',
  'action_removed',
  'system',
]);

/** 事实来源（reliability 基准见 weight-engine.js）。 */
export const FACT_SOURCES = new Set([
  'requirement', // 需求/业务数据（base_weight 1.0，不可被 LLM 覆盖）
  'user',
  'page',
  'rule',
  'llm',
  'observer',
  'system',
  'human',
  'agent',
  'history', // P2-2 同 function 历史成功交易复用（低权重，stance=inferred）
]);

/** 事实立场。 */
export const STANCES = new Set(['authoritative', 'inferred', 'disputed', 'neutral']);

/** 决策类型。 */
export const DECISION_TYPES = new Set([
  'agent_step',
  'form_value',
  'scenario_summary',
  'heal',
  'analyze_phase',
]);

/** 审计状态。 */
export const AUDIT_STATUSES = new Set(['pending', 'passed', 'failed']);

/** 事件来源（Node 侧接收时允许的取值）。 */
export const EVENT_SOURCES = new Set([
  'requirement', // 需求/业务数据摄取（权威）
  'agent',
  'cdp',
  'manual',
  'node',
  'rule',
  'user',
  'system',
  'history', // P2-2 历史交易复用
]);

/**
 * 规范化事件类型：空/超长回退 'system'，其余原样保留（允许未来新增类型）。
 * @param {string} raw Raw event type.
 * @returns {string} Normalized event type.
 */
export function normalizeEventType(raw) {
  const v = String(raw ?? '').trim();
  if (!v || v.length > 64) return 'system';
  return v;
}

/**
 * 规范化来源。
 * @param {string} raw Raw source string.
 * @returns {string} Normalized source (falls back to 'agent').
 */
export function normalizeSource(raw) {
  const v = String(raw ?? '').trim();
  if (!v || v.length > 32) return 'agent';
  return EVENT_SOURCES.has(v) ? v : 'agent';
}

/**
 * 规范化立场。
 * @param {string} raw Raw stance string.
 * @returns {string} Normalized stance (falls back to 'neutral').
 */
export function normalizeStance(raw) {
  const v = String(raw ?? '').trim();
  return STANCES.has(v) ? v : 'neutral';
}
