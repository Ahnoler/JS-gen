import { createHash } from 'node:crypto';
import { callLLM } from '../llm-utils.js';
import { L1C_LLM, L1C_LLM_TIMEOUT_MS } from '../../config/config.js';

const SEED = new Set([
  'shell-header',
  'shell-aside',
  'shell-tabs',
  'main',
  'section',
  'table',
  'overlay',
  'menu',
  'page',
  'other',
]);
const CUSTOM_ROLE_RE = /^custom:[a-z0-9_-]+$/i;
const L1D_TTL_MS = 3600 * 1000;

/** In-memory L1d cache: key `${systemId}:${signature}` → { value, exp } */
const l1dCache = new Map();

function cacheGet(key) {
  const row = l1dCache.get(key);
  if (!row) return null;
  if (row.exp <= Date.now()) {
    l1dCache.delete(key);
    return null;
  }
  return row.value;
}

function cacheSet(key, value) {
  l1dCache.set(key, {
    value: {
      role: value.role,
      label: value.label,
      confidence: value.confidence,
    },
    exp: Date.now() + L1D_TTL_MS,
  });
}

export function featureSignature(card = {}) {
  const payload = JSON.stringify({
    classTokens: card.classTokens || [],
    title: String(card.title || '').trim(),
    band: card.band || '',
    flags: card.flags || {},
    childCounts: card.childCounts || {},
  });
  return createHash('sha256').update(payload).digest('hex').slice(0, 32);
}

export function shouldLlmClassify(card = {}) {
  const role = String(card.ruleRole || card.role || 'other');
  const conf = Number(card.ruleConfidence ?? card.confidence ?? 0);
  if (conf < 0.7) return true;
  if (role === 'other' || role.startsWith('custom:')) return true;
  return false;
}

function isValidRole(role) {
  const r = String(role || '');
  return SEED.has(r) || CUSTOM_ROLE_RE.test(r);
}

function parseLlmJsonArray(raw) {
  const text = String(raw || '').trim();
  if (!text) return null;

  try {
    const arr = JSON.parse(text);
    if (Array.isArray(arr)) return arr;
  } catch { /* continue */ }

  const first = text.indexOf('[');
  const last = text.lastIndexOf(']');
  if (first >= 0 && last > first) {
    try {
      const arr = JSON.parse(text.slice(first, last + 1));
      if (Array.isArray(arr)) return arr;
    } catch { /* continue */ }
  }

  return null;
}

function buildClassifyPrompt(cards) {
  const slim = cards.map((c, i) => ({
    index: i,
    classTokens: c.classTokens || [],
    title: c.title || '',
    band: c.band || '',
    flags: c.flags || {},
    childCounts: c.childCounts || {},
    ruleRole: c.ruleRole || c.role || 'other',
    ruleConfidence: c.ruleConfidence ?? c.confidence ?? 0,
  }));
  return [
    'Classify UI region cards. Reply with ONLY a JSON array (same length and order as input).',
    'Each item: {"role":"shell-header|shell-aside|shell-tabs|main|section|table|overlay|menu|page|other|custom:<slug>","label":"...","confidence":0.0,"rationale":"..."}',
    'Cards:',
    JSON.stringify(slim),
  ].join('\n');
}

async function callLLMWithTimeout(prompt) {
  let timer;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('llm_timeout')), L1C_LLM_TIMEOUT_MS);
  });
  try {
    return await Promise.race([callLLM(prompt), timeoutPromise]);
  } finally {
    clearTimeout(timer);
  }
}

async function llmClassifyBatch(cards) {
  const raw = await callLLMWithTimeout(buildClassifyPrompt(cards));
  const arr = parseLlmJsonArray(raw);
  if (!arr) throw new Error('invalid_llm_json');

  const out = [];
  for (let i = 0; i < cards.length; i++) {
    const item = arr[i];
    if (item && typeof item === 'object' && isValidRole(item.role)) {
      out.push({
        role: String(item.role),
        label: String(item.label || cards[i].title || item.role || 'other').trim() || 'other',
        confidence: Math.min(1, Math.max(0, Number(item.confidence) || 0.5)),
        rationale: item.rationale ? String(item.rationale) : undefined,
      });
    } else {
      out.push(null);
    }
  }
  return out;
}

function mergeLlm(base, llmItem) {
  if (!llmItem) return { ...base, source: 'rule' };
  return {
    ...base,
    role: llmItem.role,
    label: llmItem.label,
    confidence: llmItem.confidence,
    source: 'llm',
    ...(llmItem.rationale ? { rationale: llmItem.rationale } : {}),
  };
}

export async function classifyRegions(cards = [], { systemId = '' } = {}) {
  const sid = String(systemId || '');
  const out = new Array(cards.length);
  const needLlm = [];

  for (let idx = 0; idx < cards.length; idx++) {
    const card = { ...cards[idx] };
    const sig = featureSignature(card);
    const ck = `${sid}:${sig}`;
    const hit = cacheGet(ck);
    if (hit) {
      out[idx] = {
        ...card,
        role: hit.role,
        label: hit.label,
        confidence: hit.confidence,
        source: 'l1d',
        signature: sig,
      };
      continue;
    }

    const role = String(card.ruleRole || 'other');
    const confidence = Number(card.ruleConfidence ?? 0.4);
    const title = String(card.title || '').trim();
    const base = {
      ...card,
      role,
      // Never use taxonomy role as human label (SPA would show "section").
      label: title || '',
      confidence,
      source: 'rule',
      signature: sig,
    };

    if (L1C_LLM && shouldLlmClassify(base)) needLlm.push({ idx, base, ck });
    else {
      out[idx] = base;
      if (!shouldLlmClassify(base)) cacheSet(ck, base);
    }
  }

  if (needLlm.length) {
    const batchItems = needLlm.slice(0, 12);
    const batch = batchItems.map((item) => item.base);
    try {
      const classified = await llmClassifyBatch(batch);
      for (let i = 0; i < batchItems.length; i++) {
        const { idx, ck } = batchItems[i];
        const merged = mergeLlm(batchItems[i].base, classified[i]);
        cacheSet(ck, merged);
        out[idx] = merged;
      }
      for (const rest of needLlm.slice(12)) {
        cacheSet(rest.ck, rest.base);
        out[rest.idx] = rest.base;
      }
    } catch {
      for (const { idx, base, ck } of needLlm) {
        cacheSet(ck, base);
        out[idx] = { ...base, fallback_reason: 'llm_error' };
      }
    }
  }

  return out;
}
