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
/** Absolute score floors kept from the substring scorer (pin continuity). */
const MIN_CARD_SCORE = 2;
const MIN_NODE_SCORE = 1;
/** Node must cover at least this fraction of the winning card's score. */
const NODE_SCORE_RATIO = 0.5;
/** Relative coverage floor: cardScore / maxPossible (spec §7.2). */
const MIN_CARD_COVERAGE = 0.25;
/** Longest semantic term (chars) considered for longest-match tokenization. */
const MAX_TERM_LEN = 12;
const MAX_PRECONDITIONS = 8;

/**
 * Bigrams + whole codes of a text (card/node profile vocabulary).
 * @param {string} text Haystack text
 * @returns {Set<string>} Token set (lowercased bigrams + uppercased codes)
 */
function profileTokens(text) {
  const hay = String(text || '');
  /** @type {Set<string>} */
  const tokens = new Set();
  for (const m of hay.matchAll(FS_CODE_RE)) tokens.add(m[0].toUpperCase());
  for (const m of hay.matchAll(ZJJK_CODE_RE)) tokens.add(m[0].toUpperCase());
  for (const run of hay.match(CJK_RUN_RE) || []) {
    for (let i = 0; i + 2 <= run.length; i += 1) {
      tokens.add(run.slice(i, i + 2));
    }
  }
  return tokens;
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
  // Short label fields only (rules[].keyword, state_actions entity/status,
  // pendingSteps name): they carry operating vocabulary the headline fields
  // miss (e.g. 客户转正 in customer_onboarding) without long-prose noise.
  for (const rule of card.rules || []) {
    parts.push(rule.keyword);
  }
  for (const sa of card.state_actions || []) {
    parts.push(sa.entity, sa.status);
  }
  for (const ps of card.pendingSteps || []) {
    parts.push(ps.name);
  }
  return parts.filter(Boolean).join('|').toLowerCase();
}

/**
 * Flow name with all whitespace stripped — specificity tie-break key.
 * @param {object} card Flow card
 * @returns {string} Whitespace-stripped flow name
 */
function normFlowName(card) {
  return String(card?.flow || '').replace(/\s+/g, '');
}

/**
 * @param {object} node
 * @returns {string}
 */
function buildNodeHaystack(node) {
  return [node.id, node.page, node.enter].filter(Boolean).join('|').toLowerCase();
}

/** Cached card corpus profile (per cards array identity). */
const corpusCache = new WeakMap();

/**
 * Build (and cache) the corpus profile: per-card haystack + token set, and the
 * semantic dictionary of raw flow/alias/keyword terms for longest-match.
 * @param {object[]} cards Flow cards
 * @returns {{ cards: Array<{ card: object, stem: string|null, haystack: string, tokens: Set<string>, semanticTerms: string[] }>, semanticDict: Set<string>, n: number }} Cached corpus profile for the given cards array
 */
function corpusProfile(cards) {
  const cached = corpusCache.get(cards);
  if (cached) return cached;
  /** @type {Array<{ card: object, stem: string|null, haystack: string, tokens: Set<string>, semanticTerms: string[] }>} */
  const entries = [];
  /** @type {Set<string>} */
  const semanticDict = new Set();
  for (const card of cards) {
    const haystack = buildCardHaystack(card);
    const semanticTerms = [
      card.flow,
      ...(card.aliases || []),
      ...(card.keywords || []),
    ].filter(Boolean);
    for (const term of semanticTerms) semanticDict.add(String(term));
    entries.push({
      card,
      stem: card._stem ?? null,
      haystack,
      tokens: profileTokens(haystack),
      semanticTerms,
    });
  }
  const profile = { cards: entries, semanticDict, n: entries.length };
  corpusCache.set(cards, profile);
  return profile;
}

/**
 * Tokenize a query: whole FS/ZJJK codes + CJK bigrams, with multi-char
 * semantic terms matched longest-first (consumed chars no longer feed shorter
 * tokens, so one long hit is not double-credited by its substrings).
 * @param {string} text Query text
 * @param {Set<string>} semanticDict Raw card vocabulary terms
 * @returns {Map<string, number>} token → char length
 */
function extractQueryTokens(text, semanticDict) {
  const hay = String(text || '');
  /** @type {Map<string, number>} */
  const tokens = new Map();
  for (const m of hay.matchAll(FS_CODE_RE)) tokens.set(m[0].toUpperCase(), m[0].length);
  for (const m of hay.matchAll(ZJJK_CODE_RE)) tokens.set(m[0].toUpperCase(), m[0].length);

  for (const run of hay.match(CJK_RUN_RE) || []) {
    const consumed = new Uint8Array(run.length);
    for (let len = Math.min(run.length, MAX_TERM_LEN); len >= 3; len -= 1) {
      for (let i = 0; i + len <= run.length; i += 1) {
        let overlaps = false;
        for (let k = i; k < i + len; k += 1) {
          if (consumed[k]) { overlaps = true; break; }
        }
        if (overlaps) continue;
        const term = run.slice(i, i + len);
        if (semanticDict.has(term)) {
          tokens.set(term, len);
          for (let k = i; k < i + len; k += 1) consumed[k] = 1;
        }
      }
    }
    for (let i = 0; i + 2 <= run.length; i += 1) {
      if (consumed[i] && consumed[i + 1]) continue;
      tokens.set(run.slice(i, i + 2), 2);
    }
  }
  return tokens;
}

/**
 * idf-weighted match weights: for each query token, df = cards containing it
 * (token-set membership for bigram/code tokens, substring for long semantic
 * terms), idf = log(1 + N/df), weight = idf × len.
 * @param {Map<string, number>} tokens Query tokens
 * @param {ReturnType<typeof corpusProfile>} corpus Card corpus profile
 * @returns {{ weights: Map<string, number>, maxPossible: number }} Token weights and their sum over matchable tokens
 */
function tokenWeights(tokens, corpus) {
  /** @type {Map<string, number>} */
  const weights = new Map();
  let maxPossible = 0;
  for (const [token, len] of tokens) {
    let df = 0;
    if (len <= 2) {
      for (const entry of corpus.cards) {
        if (entry.tokens.has(token)) df += 1;
      }
    } else {
      for (const entry of corpus.cards) {
        if (entry.haystack.includes(token)) df += 1;
      }
    }
    if (df === 0) continue;
    const weight = Math.log(1 + corpus.n / df) * len;
    weights.set(token, weight);
    maxPossible += weight;
  }
  return { weights, maxPossible };
}

/**
 * True when the node's id/page polarity contradicts the query title
 * (启用 query must not land on 禁用/下架/disable nodes and vice versa; spec §7.2).
 * @param {object} node Flow card node
 * @param {string} title Query title
 * @returns {boolean} Whether the node is excluded
 */
function nodeExcludedByPolarity(node, title) {
  const idPage = `${node.id || ''} ${node.page || ''}`.toLowerCase();
  const t = String(title || '');
  const wantsEnable = /启用/.test(t) && !/禁用|下架/.test(t);
  const wantsDisable = /禁用|下架/.test(t) && !/启用/.test(t);
  if (wantsEnable && /disable|禁用|下架/.test(idPage)) return true;
  if (wantsDisable && /enable|启用/.test(idPage)) return true;
  return false;
}

/**
 * Best node for a scored card under the given query weights (spec §7.2):
 * node must clear MIN_NODE_SCORE and cover NODE_SCORE_RATIO of the card score.
 * @param {{ card: object, stem: string|null, haystack: string, tokens: Set<string>, semanticTerms: string[] }} entry Corpus entry
 * @param {Map<string, number>} weights Query token weights
 * @param {number} cardScore Winning card score
 * @param {string} title Query title (polarity disambiguation)
 * @returns {string|null} Node id or null
 */
function bestNodeIdFor(entry, weights, cardScore, title) {
  let bestNodeId = null;
  let bestNodeScore = 0;

  for (const node of entry.card.nodes || []) {
    if (nodeExcludedByPolarity(node, title)) continue;
    const nodeHay = buildNodeHaystack(node);
    const nodeTokens = profileTokens(nodeHay);
    let nodeScore = 0;
    for (const [token, weight] of weights) {
      const hit = token.length <= 2
        ? nodeTokens.has(token)
        : nodeHay.includes(token);
      if (hit) nodeScore += weight;
    }
    if (nodeScore > bestNodeScore) {
      bestNodeScore = nodeScore;
      bestNodeId = node.id;
    }
  }

  return bestNodeScore >= MIN_NODE_SCORE
    && bestNodeScore >= cardScore * NODE_SCORE_RATIO
    ? bestNodeId
    : null;
}

/**
 * Ranked flow-card candidates (spec 2026-09-09-kb-recall-eval-design §7):
 * same scoring and threshold semantics as matchFlowForAtom, exposed as a
 * score-descending list so eval metrics (MRR/nDCG) can consume real rankings.
 * candidates only contain cards that clear the score floors; empty result
 * returns candidates: [].
 * @param {{ title?: string, taskDraft?: string, cards?: object[], k?: number }} opts Match options: query text (title + taskDraft), flow-card corpus, candidate list length
 * @returns {{ flowRef: string|null, nodeId: string|null, score: number|null, candidates: Array<{ flowRef: string|null, score: number, nodeId: string|null }> }} Top-1 mirror of matchFlowForAtom plus the top-k candidate list
 */
export function rankFlowCards({ title, taskDraft, cards, k = 5 } = {}) {
  if (!cards?.length) {
    return { flowRef: null, nodeId: null, score: null, candidates: [] };
  }
  const corpus = corpusProfile(cards);
  const tokens = extractQueryTokens(`${title || ''}${taskDraft || ''}`, corpus.semanticDict);
  if (!tokens.size) {
    return { flowRef: null, nodeId: null, score: null, candidates: [] };
  }
  const { weights, maxPossible } = tokenWeights(tokens, corpus);
  if (maxPossible <= 0) {
    return { flowRef: null, nodeId: null, score: null, candidates: [] };
  }

  /** @type {Array<{ entry: object, score: number }>} */
  const scored = [];
  for (const entry of corpus.cards) {
    let score = 0;
    for (const [token, weight] of weights) {
      const hit = token.length <= 2
        ? entry.tokens.has(token)
        : entry.haystack.includes(token);
      if (hit) score += weight;
    }
    // Score floors are absolute + relative to maxPossible, so filtering each
    // card independently keeps the top-1 identical to the previous single-best
    // check (both floors are monotone in score).
    if (score >= MIN_CARD_SCORE && score / maxPossible >= MIN_CARD_COVERAGE) {
      scored.push({ entry, score });
    }
  }

  // Tie-break: shorter flow name is the more specific card (mirrors the
  // Python recall rule so the two implementations converge); stable sort keeps
  // first-seen order on full ties, matching the previous single-pass loop.
  scored.sort((a, b) => b.score - a.score
    || normFlowName(a.entry.card).length - normFlowName(b.entry.card).length);
  scored.length = Math.min(scored.length, Math.max(1, k));

  const candidates = scored.map(({ entry, score }) => ({
    flowRef: entry.stem,
    score,
    nodeId: bestNodeIdFor(entry, weights, score, `${title || ''}`),
  }));

  const top = candidates[0] || null;
  return {
    flowRef: top ? top.flowRef : null,
    nodeId: top ? top.nodeId : null,
    score: top ? top.score : null,
    candidates,
  };
}

/**
 * Deterministic flow-card recall for atom recording (spec §7.2):
 * bigram/code tokens + longest semantic match, idf × len scoring, relative
 * coverage floor and polarity disambiguation.
 * @param {{ title?: string, taskDraft?: string, cards?: object[] }} opts Match options: query text (title + taskDraft) and flow-card corpus
 * @returns {{ flowRef: string|null, nodeId: string|null, score: number|null }} Winning card score exposed for observability
 */
export function matchFlowForAtom({ title, taskDraft, cards } = {}) {
  const { flowRef, nodeId, score } = rankFlowCards({ title, taskDraft, cards, k: 1 });
  return { flowRef, nodeId, score };
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
