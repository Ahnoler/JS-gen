/** 方案 D v1 允许的 mode。 */
export const PHASE_CONTRACT_MODES = Object.freeze([
  'login', 'query', 'navigate', 'create', 'modify', 'introduce_pick', 'other',
]);

/** 方案 D v1 允许的 successWhen 令牌。 */
export const PHASE_CONTRACT_KINDS = Object.freeze([
  'toast_ok', 'url_change', 'saved_navigation', 'query_clicked', 'page_opened',
  'nav_next_clicked', 'picker_closed', 'confirm_click', 'dialog_confirmed',
  'introduced_backfilled',
]);

const SUBMIT_MODES = new Set(['create', 'modify', 'introduce_pick']);

/**
 * 校验并归一化阶段合约。非法则返回 null，不抛错。
 * @param {unknown} raw 分析模型或库中的合约对象
 * @returns {{ v: 1, mode: string, refill: 'none'|'all_editable', submitRequired: boolean, successWhen: string[], source: 'analyze' } | null} 合法 v1 合约；非法时为 null
 */
export function normalizePhaseContract(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  if (Number(raw.v) !== 1) return null;
  if (raw.source !== 'analyze') return null;
  const mode = raw.mode;
  if (!PHASE_CONTRACT_MODES.includes(mode)) return null;
  const refill = raw.refill;
  if (refill !== 'none' && refill !== 'all_editable') return null;
  if (refill === 'all_editable' && mode !== 'create' && mode !== 'modify') return null;
  if (typeof raw.submitRequired !== 'boolean') return null;
  if (raw.submitRequired && !SUBMIT_MODES.has(mode)) return null;
  if (!Array.isArray(raw.successWhen)) return null;
  const successWhen = [];
  for (const kind of raw.successWhen) {
    if (!PHASE_CONTRACT_KINDS.includes(kind)) return null;
    if (!successWhen.includes(kind)) successWhen.push(kind);
  }
  return { v: 1, mode, refill, submitRequired: raw.submitRequired, successWhen, source: 'analyze' };
}
