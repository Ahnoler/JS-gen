/**
 * Flow-card recall: deterministic match + template hint builders for atom recording.
 */
import * as trajectoryDao from '../../dao/trajectory-dao.js';
import { getFlowCard } from '../kb-flow-cards.js';

export const FLOW_TEMPLATE_MARKER = '【流程卡模板】';
const FLOW_TEMPLATE_END_MARKER = '【/流程卡模板】';

const CJK_RUN_RE = /[\u3400-\u9fff\u3040-\u30ff]+/g;
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
 * ASCII word tokens of a text (recall P0 lever 2, spec 2026-09-10-recall-p0-three-levers
 * §6.2): alphanumeric runs split at camelCase/letter-digit boundaries, whole
 * runs kept too, everything lowercased; runs/parts shorter than 2 chars are
 * dropped (single digits/letters carry no recall signal and only feed false
 * positives). Same-source contract: profileTokens (card side) and
 * extractQueryTokens (query side) both consume this — a code visible on one
 * side is tokenized identically on the other.
 * @param {string} text Haystack or query text
 * @returns {Set<string>} Lowercase tokens (whole runs + boundary parts)
 */
export function tokenizeCodes(text) {
  const hay = String(text || '');
  /** @type {Set<string>} */
  const tokens = new Set();
  for (const run of hay.match(/[A-Za-z0-9]+/g) || []) {
    const low = run.toLowerCase();
    if (low.length >= 2) tokens.add(low);
    const parts = run
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .replace(/([A-Za-z])(\d+)/g, '$1 $2')
      .replace(/(\d+)([A-Za-z])/g, '$1 $2')
      .split(/\s+/);
    for (const part of parts) {
      const partLow = part.toLowerCase();
      if (partLow.length >= 2 && partLow !== low) tokens.add(partLow);
    }
  }
  return tokens;
}

/**
 * ASCII code tokens + CJK bigrams of a text (card/node profile vocabulary).
 * @param {string} text Haystack text
 * @returns {Set<string>} Token set (lowercased bigrams + lowercased ASCII code tokens)
 */
function profileTokens(text) {
  const hay = String(text || '');
  /** @type {Set<string>} */
  const tokens = new Set();
  for (const token of tokenizeCodes(hay)) tokens.add(token);
  for (const run of hay.match(CJK_RUN_RE) || []) {
    for (let i = 0; i + 2 <= run.length; i += 1) {
      tokens.add(run.slice(i, i + 2));
    }
  }
  return tokens;
}

/**
 * Weight factor for controlled-vocabulary query expansion (recall P0 lever 3,
 * spec 2026-09-10-recall-p0-three-levers §6.3): injected expand tokens count
 * at this fraction of their own idf × len weight — a low-weight ADDITIVE
 * signal, never a rewrite of the original query.
 */
export const SYNONYM_WEIGHT = 0.5;

/**
 * Controlled-vocabulary query expansion (recall P0 lever 3): for each synonym
 * entry whose `term` occurs in the query text and whose `scope` admits the
 * query's module (scope null = global; otherwise must equal moduleKey), the
 * `expand` strings are tokenized with the SAME query tokenizer (so card-vocab
 * semantic terms get longest-match treatment) and injected as additional query
 * tokens at SYNONYM_WEIGHT × their own weight. Tokens already present in the
 * query keep their full weight (expansion only ever ADDS signal). Purely
 * additive and opt-in: callers that pass no `synonyms` see byte-identical
 * behavior (spec §7 graceful degradation — an empty/missing table = no-op).
 * @param {Map<string, number>} tokens Query token map (mutated: injected tokens added)
 * @param {string} hay Raw query text (title + taskDraft, lowercased for matching)
 * @param {Set<string>} semanticDict Raw card vocabulary terms
 * @param {Array<{term: string, expand: string[], scope?: string|null}>} synonyms Controlled vocabulary entries
 * @param {string|null} moduleKey Query's module key (null = only scope-less entries apply)
 * @returns {Map<string, number>|null} token → weight multiplier for injected tokens, or null when nothing was injected
 */
function applySynonymExpansion(tokens, hay, semanticDict, synonyms, moduleKey) {
  if (!Array.isArray(synonyms) || synonyms.length === 0) return null;
  const lowHay = hay.toLowerCase();
  /** @type {Map<string, number>} */
  const scales = new Map();
  for (const entry of synonyms) {
    if (!entry || !entry.term || !Array.isArray(entry.expand) || entry.expand.length === 0) continue;
    if (entry.scope && (!moduleKey || entry.scope !== moduleKey)) continue;
    if (!lowHay.includes(String(entry.term).toLowerCase())) continue;
    for (const exp of entry.expand) {
      for (const [token, len] of extractQueryTokens(String(exp), semanticDict)) {
        if (!tokens.has(token)) {
          tokens.set(token, len);
          scales.set(token, SYNONYM_WEIGHT);
        }
      }
    }
  }
  return scales.size > 0 ? scales : null;
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
 * Tokenize a query: ASCII code tokens (camelCase-split, lowercased) + CJK
 * bigrams, with multi-char semantic terms matched longest-first (consumed
 * chars no longer feed shorter tokens, so one long hit is not double-credited
 * by its substrings).
 * @param {string} text Query text
 * @param {Set<string>} semanticDict Raw card vocabulary terms
 * @returns {Map<string, number>} token → char length
 */
function extractQueryTokens(text, semanticDict) {
  const hay = String(text || '');
  /** @type {Map<string, number>} */
  const tokens = new Map();
  for (const token of tokenizeCodes(hay)) {
    if (!tokens.has(token)) tokens.set(token, token.length);
  }

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
 * terms), idf = log(1 + N/df), weight = idf × len. Tokens present in
 * `weightScales` (synonym-injected) get their weight and maxPossible
 * contribution multiplied by the scale factor.
 * @param {Map<string, number>} tokens Query tokens
 * @param {ReturnType<typeof corpusProfile>} corpus Card corpus profile
 * @param {Map<string, number>|null} [weightScales] token → multiplier for synonym-injected tokens
 * @returns {{ weights: Map<string, number>, maxPossible: number }} Token weights and their sum over matchable tokens
 */
function tokenWeights(tokens, corpus, weightScales = null) {
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
    const scale = weightScales?.get(token) ?? 1;
    const weight = Math.log(1 + corpus.n / df) * len * scale;
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
 * The ratio denominator is the node-expressible portion of the card score —
 * weights of tokens that hit the card but cannot appear in any node haystack
 * (e.g. a code living only in hash_markers) are excluded, so card-level
 * identity codes cannot drown real node evidence. When every matched token is
 * node-expressible the denominator equals cardScore (legacy behavior).
 * @param {{ card: object, stem: string|null, haystack: string, tokens: Set<string>, semanticTerms: string[] }} entry Corpus entry
 * @param {Map<string, number>} weights Query token weights
 * @param {number} cardScore Winning card score (unused when all tokens are node-expressible; kept for signature continuity)
 * @param {string} title Query title (polarity disambiguation)
 * @returns {string|null} Node id or null
 */
function bestNodeIdFor(entry, weights, cardScore, title) {
  const nodes = entry.card.nodes || [];
  let nodeEligibleScore = 0;
  for (const [token, weight] of weights) {
    const matchable = nodes.some((node) => {
      const nodeHay = buildNodeHaystack(node);
      return token.length <= 2 ? nodeTokensFor(node).has(token) : nodeHay.includes(token);
    });
    if (matchable) nodeEligibleScore += weight;
  }
  const denominator = nodeEligibleScore > 0 ? nodeEligibleScore : cardScore;

  let bestNodeId = null;
  let bestNodeScore = 0;

  for (const node of nodes) {
    if (nodeExcludedByPolarity(node, title)) continue;
    const nodeHay = buildNodeHaystack(node);
    const nodeTokens = nodeTokensFor(node);
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
    && bestNodeScore >= denominator * NODE_SCORE_RATIO
    ? bestNodeId
    : null;
}

/** Per-node token cache (node hayfields are static for a given node object). */
const nodeTokensCache = new WeakMap();

/**
 * Cached profileTokens for a node's haystack (bestNodeIdFor runs the tokenized
 * membership check twice — eligibility pass + scoring pass). Keyed by the node
 * object; cloned corpora (cold runs) get their own entries and GC.
 * @param {object} node Flow-card node
 * @returns {Set<string>} Token set
 */
function nodeTokensFor(node) {
  let set = nodeTokensCache.get(node);
  if (!set) {
    set = profileTokens(buildNodeHaystack(node));
    nodeTokensCache.set(node, set);
  }
  return set;
}

/**
 * Ranked flow-card candidates (spec 2026-09-09-kb-recall-eval-design §7):
 * same scoring and threshold semantics as matchFlowForAtom, exposed as a
 * score-descending list so eval metrics (MRR/nDCG) can consume real rankings.
 * candidates only contain cards that clear the score floors; empty result
 * returns candidates: [].
 *
 * Controlled-vocabulary expansion (recall P0 lever 3): when `synonyms` is
 * provided, query tokens bridged from the table are injected at
 * SYNONYM_WEIGHT × their own weight (scope-gated by `moduleKey`). Without
 * `synonyms` the ranking is byte-identical to legacy behavior.
 * @param {{ title?: string, taskDraft?: string, cards?: object[], k?: number, synonyms?: Array<object>|null, moduleKey?: string|null }} opts Match options: query text (title + taskDraft), flow-card corpus, candidate list length, optional controlled-vocabulary entries, optional query module key (gates scoped entries)
 * @returns {{ flowRef: string|null, nodeId: string|null, score: number|null, candidates: Array<{ flowRef: string|null, score: number, nodeId: string|null }> }} Top-1 mirror of matchFlowForAtom plus the top-k candidate list
 */
export function rankFlowCards({ title, taskDraft, cards, k = 5, synonyms = null, moduleKey = null } = {}) {
  if (!cards?.length) {
    return { flowRef: null, nodeId: null, score: null, candidates: [] };
  }
  const corpus = corpusProfile(cards);
  const queryText = `${title || ''}${taskDraft || ''}`;
  const tokens = extractQueryTokens(queryText, corpus.semanticDict);
  if (!tokens.size) {
    return { flowRef: null, nodeId: null, score: null, candidates: [] };
  }
  const queryModuleKey = moduleKey ? String(moduleKey) : null;
  const weightScales = applySynonymExpansion(tokens, queryText, corpus.semanticDict, synonyms, queryModuleKey);
  const { weights, maxPossible } = tokenWeights(tokens, corpus, weightScales);
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
 * @param {{ title?: string, taskDraft?: string, cards?: object[], synonyms?: Array<object>|null, moduleKey?: string|null }} opts Match options: query text (title + taskDraft), flow-card corpus, optional controlled-vocabulary entries, optional query module key (gates scoped synonym entries)
 * @returns {{ flowRef: string|null, nodeId: string|null, score: number|null }} Winning card score exposed for observability
 */
export function matchFlowForAtom({ title, taskDraft, cards, synonyms, moduleKey } = {}) {
  const { flowRef, nodeId, score } = rankFlowCards({ title, taskDraft, cards, k: 1, synonyms, moduleKey });
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
