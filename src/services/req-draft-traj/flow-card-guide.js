/**
 * Flow-card selection + closed-loop helpers for draft-traj propose (spec 2026-09-09).
 */
import { matchFlowForAtom } from './flow-card-recall.js';

const PERSIST_BOUNDARY_RE = /保存|提交|启用|禁用|克隆|删除|作废|撤销(?!查询)/;

export function isPersistBoundaryAction(action) {
  return PERSIST_BOUNDARY_RE.test(String(action || ''));
}

export function stepsShareClosedLoop({ stepActions }) {
  const actions = (stepActions || []).map((a) => String(a || '').trim()).filter(Boolean);
  if (actions.length === 0) return false;
  const boundaries = actions.filter((a) => isPersistBoundaryAction(a));
  return boundaries.length <= 1;
}

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
