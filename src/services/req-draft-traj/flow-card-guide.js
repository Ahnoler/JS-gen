/**
 * Helpers for selecting flow cards and shaping their guidance during draft
 * trajectory proposal.
 *
 * This module identifies persistence boundaries, checks whether a group of
 * steps can be treated as one closed loop, ranks relevant cards through the
 * shared recall function, and reduces card data to the compact shape supplied
 * to the atomization LLM. It does not mutate cards or persist proposal data.
 */
import { matchFlowForAtom } from './flow-card-recall.js';

const PERSIST_BOUNDARY_RE = /保存|提交|启用|禁用|克隆|删除|作废|撤销(?!查询)/;

/**
 * Determine whether an action is a persistence boundary for atom grouping.
 *
 * Save, submit, state-changing, and destructive operations end a closed-loop
 * group. The regular expression deliberately excludes query-like revoke text
 * through its negative lookahead.
 * @param {unknown} action Candidate action text
 * @returns {boolean} True when the action ends a persistence group
 */
export function isPersistBoundaryAction(action) {
  return PERSIST_BOUNDARY_RE.test(String(action || ''));
}

/**
 * Check whether a sequence contains at most one persistence boundary.
 *
 * Empty or missing input is rejected. Navigation and preparation actions may
 * accompany a single write boundary, while multiple boundaries require
 * separate atoms so one atom does not represent multiple transactions.
 * @param {{ stepActions?: unknown[] }} opts Step action collection
 * @returns {boolean} True when the actions form one closed loop
 */
export function stepsShareClosedLoop({ stepActions }) {
  const actions = (stepActions || []).map((a) => String(a || '').trim()).filter(Boolean);
  if (actions.length === 0) return false;
  const boundaries = actions.filter((a) => isPersistBoundaryAction(a));
  return boundaries.length <= 1;
}

/**
 * Flatten chain metadata and step fields into recall text.
 * @param {Array<{ title?: string, chainId?: string, steps?: Array<{ action?: string, zjjk?: string, page?: string, buttons?: string }> }>} chains Parsed chains
 * @returns {string} Newline-separated text used as the recall query
 */
function chainHaystack(chains) {
  const parts = [];
  for (const c of chains || []) {
    parts.push(c.title, c.chainId);
    for (const s of c.steps || []) {
      parts.push(s.action, s.zjjk, s.page, s.buttons);
    }
  }
  return parts.filter(Boolean).join('\n');
}

/**
 * Select the highest-scoring distinct flow cards relevant to parsed chains.
 *
 * Cards are scored independently through the shared matcher, ordered by score
 * and then stem, and deduplicated before the requested limit is applied.
 * @param {{ chains?: object[], cards?: object[], limit?: number }} opts Selection inputs
 * @returns {object[]} Relevant cards in deterministic score order
 */
export function selectRelevantFlowCards({ chains, cards, limit = 6 }) {
  const list = Array.isArray(cards) ? cards : [];
  const hay = chainHaystack(chains);
  /** @type {Array<{ card: object, score: number }>} */
  const scored = [];
  for (const card of list) {
    const hit = matchFlowForAtom({ title: hay, taskDraft: '', cards: [card] });
    const score = Number(hit.score) || 0;
    if (score > 0) scored.push({ card, score });
  }
  scored.sort((a, b) => b.score - a.score || String(a.card._stem).localeCompare(String(b.card._stem)));
  const out = [];
  const seen = new Set();
  for (const { card } of scored) {
    const stem = card._stem || card.flow;
    if (seen.has(stem)) continue;
    seen.add(stem);
    out.push(card);
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * Project flow cards into the bounded guidance shape sent to the atomizer.
 *
 * The summary retains card identity, menu path, six preconditions, and useful
 * node fields. Button and field lists are capped to keep prompt size stable.
 * @param {object[]} cards Flow cards to summarize
 * @returns {Array<object>} LLM-facing card summaries
 */
export function summarizeCardsForLlm(cards) {
  return (cards || []).map((card) => ({
    flowRef: card._stem || null,
    flow: card.flow,
    menu_path: card.menu_path || '',
    preconditions: (card.preconditions || []).slice(0, 6),
    nodes: (card.nodes || []).map((n) => ({
      id: n.id,
      page: n.page,
      enter: n.enter,
      buttons: (n.buttons || []).slice(0, 12),
      fields: (n.fields || []).slice(0, 16),
    })),
  }));
}
