/**
 * Flow-card recall: deterministic match + template hint builders for atom recording.
 */
import * as trajectoryDao from '../../dao/trajectory-dao.js';
import { getFlowCard } from '../kb-flow-cards.js';

export const FLOW_TEMPLATE_MARKER = '【流程卡模板】';
const FLOW_TEMPLATE_END_MARKER = '【/流程卡模板】';

const CJK_RUN_RE = /[\u3400-\u9fff\u3040-\u30ff]+/g;
const FS_CODE_RE = /FS\d+/gi;
const ZJJK_CODE_RE = /ZJJK\d+/gi;
const MIN_CARD_SCORE = 2;
const MIN_NODE_SCORE = 1;
const NODE_SCORE_RATIO = 0.5;
const MAX_PRECONDITIONS = 8;

/**
 * @param {string} text
 * @returns {string[]}
 */
function extractAtomTokens(text) {
  const hay = String(text || '');
  const tokens = new Set();

  for (const m of hay.matchAll(FS_CODE_RE)) tokens.add(m[0].toUpperCase());
  for (const m of hay.matchAll(ZJJK_CODE_RE)) tokens.add(m[0].toUpperCase());

  for (const run of hay.match(CJK_RUN_RE) || []) {
    if (run.length < 2) continue;
    for (let len = 2; len <= run.length; len += 1) {
      for (let i = 0; i <= run.length - len; i += 1) {
        tokens.add(run.slice(i, i + len));
      }
    }
  }

  return [...tokens];
}

/**
 * @param {object} card
 * @returns {string}
 */
function buildCardHaystack(card) {
  const parts = [
    card.flow,
    ...(card.aliases || []),
    ...(card.keywords || []),
    ...(card.hash_markers || []),
  ];
  for (const node of card.nodes || []) {
    parts.push(node.id, node.page, node.enter);
  }
  return parts.filter(Boolean).join('|').toLowerCase();
}

/**
 * @param {object} node
 * @returns {string}
 */
function buildNodeHaystack(node) {
  return [node.id, node.page, node.enter].filter(Boolean).join('|').toLowerCase();
}

/**
 * @param {string[]} tokens
 * @param {string} haystack
 * @returns {number}
 */
function scoreTokens(tokens, haystack) {
  let score = 0;
  for (const token of tokens) {
    const needle = token.toLowerCase();
    if (haystack.includes(needle)) score += 1;
  }
  return score;
}

/**
 * @param {object} node
 * @param {string} taskDraft
 * @returns {number}
 */
function nodeTaskDraftBonus(node, taskDraft) {
  const draft = String(taskDraft || '').toLowerCase();
  if (!draft) return 0;
  let bonus = 0;
  for (const field of [node.enter, node.page, node.id]) {
    const value = String(field || '').trim().toLowerCase();
    if (value && draft.includes(value)) bonus += 1;
  }
  return bonus;
}

/**
 * @param {{ title?: string, taskDraft?: string, cards?: object[] }} opts
 * @returns {{ flowRef: string|null, nodeId: string|null }}
 */
export function matchFlowForAtom({ title, taskDraft, cards } = {}) {
  const tokens = extractAtomTokens(`${title || ''}${taskDraft || ''}`);
  if (!tokens.length || !cards?.length) {
    return { flowRef: null, nodeId: null };
  }

  let bestCard = null;
  let bestCardScore = 0;

  for (const card of cards) {
    const cardScore = scoreTokens(tokens, buildCardHaystack(card));
    if (cardScore > bestCardScore) {
      bestCardScore = cardScore;
      bestCard = card;
    }
  }

  if (!bestCard || bestCardScore < MIN_CARD_SCORE) {
    return { flowRef: null, nodeId: null };
  }

  const flowRef = bestCard._stem ?? null;
  let bestNodeId = null;
  let bestNodeScore = 0;

  for (const node of bestCard.nodes || []) {
    const nodeScore = scoreTokens(tokens, buildNodeHaystack(node))
      + nodeTaskDraftBonus(node, taskDraft);
    if (nodeScore > bestNodeScore) {
      bestNodeScore = nodeScore;
      bestNodeId = node.id;
    }
  }

  const nodeId = bestNodeScore >= MIN_NODE_SCORE
    && bestNodeScore >= bestCardScore * NODE_SCORE_RATIO
    ? bestNodeId
    : null;

  return { flowRef, nodeId };
}

/**
 * @param {{ card?: object|null, nodeId?: string|null, atomTask?: string }} opts
 * @returns {string|null}
 */
export function buildFlowTemplateHint({ card, nodeId, atomTask } = {}) {
  if (!card || typeof card !== 'object') return null;

  const lines = [
    `${FLOW_TEMPLATE_MARKER}${card.flow}`,
    `菜单：${card.menu_path == null ? '' : String(card.menu_path)}`,
    '前置条件：',
  ];

  const preconditions = (card.preconditions || []).slice(0, MAX_PRECONDITIONS);
  for (const item of preconditions) {
    lines.push(`- ${item}`);
  }

  const node = (card.nodes || []).find((n) => n.id === nodeId);
  if (node) {
    lines.push(`【本段起点】（node=${node.id} ${node.page || ''}）`.trimEnd());
    lines.push(`到达：${node.enter || ''}`);
  }

  lines.push('【本原子任务】');
  lines.push(String(atomTask || '').trim());
  lines.push(FLOW_TEMPLATE_END_MARKER);

  return lines.join('\n');
}

/**
 * @param {string} description
 * @param {string|null} hint
 * @returns {string}
 */
function stripFlowTemplateHint(description) {
  const text = String(description ?? '');
  if (!text.startsWith(FLOW_TEMPLATE_MARKER)) return text;

  const endIdx = text.indexOf(FLOW_TEMPLATE_END_MARKER);
  if (endIdx !== -1) {
    const afterEnd = endIdx + FLOW_TEMPLATE_END_MARKER.length;
    if (afterEnd >= text.length) return '';
    const nextNewline = text.indexOf('\n', afterEnd);
    return nextNewline === -1 ? '' : text.slice(nextNewline + 1);
  }

  // Legacy hints (no closing sentinel): assume single-line atom task body.
  const atomIdx = text.indexOf('【本原子任务】');
  if (atomIdx === -1) return text;

  const afterHeader = text.indexOf('\n', atomIdx);
  if (afterHeader === -1) return '';

  const afterAtomTask = text.indexOf('\n', afterHeader + 1);
  if (afterAtomTask === -1) return '';

  return text.slice(afterAtomTask + 1);
}

/**
 * @param {string} description
 * @param {string|null} hint
 * @returns {string}
 */
export function applyFlowTemplateHintToDescription(description, hint) {
  if (!hint) return String(description ?? '');
  const base = stripFlowTemplateHint(description);
  return base ? `${hint}\n${base}` : hint;
}

/**
 * Preview flow-template hint for a trajectory row (no DB write).
 * @param {object|null} traj trajectory row from trajectoryDao.getById
 * @returns {Promise<{ hint: string|null, kbFlowRef: string|null, kbFlowNodeId: string|null }>}
 */
async function flowTemplateHintFromTrajectory(traj) {
  const kbFlowRef = traj?.kbFlowRef ?? null;
  const kbFlowNodeId = traj?.kbFlowNodeId ?? null;
  if (!kbFlowRef) {
    return { hint: null, kbFlowRef, kbFlowNodeId };
  }
  const card = await getFlowCard({ stem: kbFlowRef });
  const hint = buildFlowTemplateHint({
    card,
    nodeId: kbFlowNodeId,
    atomTask: String(traj?.task || '').trim(),
  });
  return { hint, kbFlowRef, kbFlowNodeId };
}

/**
 * Load trajectory by id and preview the flow-card template hint (no DB write).
 * @param {number|string} trajectoryId
 * @param {{ getById?: (id: number) => Promise<object|null> }} [deps] test hooks
 * @returns {Promise<{ hint: string|null, kbFlowRef: string|null, kbFlowNodeId: string|null }>}
 */
export async function getFlowTemplateHintForTrajectory(trajectoryId, { getById = trajectoryDao.getById } = {}) {
  const tid = Number(trajectoryId);
  const traj = await getById(tid);
  if (!traj) {
    const err = new Error('Trajectory not found');
    err.statusCode = 404;
    throw err;
  }
  return flowTemplateHintFromTrajectory(traj);
}
