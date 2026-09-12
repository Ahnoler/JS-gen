/**
 * Region role classification: rule-based + LLM fallback with an in-memory L1d cache.
 *
 * L1c = classify L1 page-region feature cards (role/label). LLM gated by L1C_LLM;
 * transport uses L1C_LLM_MODEL / L1C_LLM_BASE_URL / L1C_LLM_API_KEY (fallback LLM_*).
 */
/**
 * 使用确定性规则对采集的区域卡片分类，可选使用 LLM 辅助，
 * 并通过短期内存缓存处理重复的特征形态。
 */
import { createHash } from 'node:crypto';
import { callLLM } from '../llm-utils.js';
import {
  L1C_LLM,
  L1C_LLM_TIMEOUT_MS,
  L1C_LLM_MODEL,
  L1C_LLM_BASE_URL,
  L1C_LLM_API_KEY,
} from '../../config/config.js';

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

/**
 * 从 L1d 分类缓存读取未过期的值。
 * @param {string} key 缓存键
 * @returns {object|null} 缓存的分类结果，未命中或过期时为 null
 */
function cacheGet(key) {
  const row = l1dCache.get(key);
  if (!row) return null;
  if (row.exp <= Date.now()) {
    l1dCache.delete(key);
    return null;
  }
  return row.value;
}

/**
 * 将稳定的分类字段存入 L1d 缓存。
 * @param {string} key 缓存键
 * @param {object} value 分类结果
 * @returns {void}
 */
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

/**
 * Sha256 (truncated) signature of a region card's stable features.
 * @param {object} [card] region card
 * @returns {string} 32-hex signature
 */
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

/**
 * True when the rule role/confidence is weak enough to warrant LLM classification.
 * @param {object} [card] region card
 * @returns {boolean} whether LLM classification should run
 */
export function shouldLlmClassify(card = {}) {
  const role = String(card.ruleRole || card.role || 'other');
  const conf = Number(card.ruleConfidence ?? card.confidence ?? 0);
  if (conf < 0.7) return true;
  if (role === 'other' || role.startsWith('custom:')) return true;
  return false;
}

/**
 * 检查角色是否属于支持的分类体系或自定义角色格式。
 * @param {string} role 候选角色
 * @returns {boolean} 角色是否有效
 */
function isValidRole(role) {
  const r = String(role || '');
  return SEED.has(r) || CUSTOM_ROLE_RE.test(r);
}

/**
 * 解析包含 JSON 数组的 LLM 响应，并容忍周围的说明性文本。
 * @param {string} raw 原始模型响应
 * @returns {Array<object>|null} 解析后的数组，无效时为 null
 */
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

/**
 * 构造批量区域分类使用的受限提示词。
 * @param {Array<object>} cards 待分类的区域卡片
 * @returns {string} 序列化的分类提示词
 */
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

/**
 * 调用配置的 LLM，并强制执行区域分类超时限制。
 * @param {string} prompt 分类提示词
 * @param {string} model 模型标识
 * @returns {Promise<unknown>} 原始模型响应
 */
async function callLLMWithTimeout(prompt, model) {
  let timer;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('llm_timeout')), L1C_LLM_TIMEOUT_MS);
  });
  try {
    return await Promise.race([
      callLLM(prompt, model, {
        baseUrl: L1C_LLM_BASE_URL,
        apiKey: L1C_LLM_API_KEY,
        timeoutMs: L1C_LLM_TIMEOUT_MS,
      }),
      timeoutPromise,
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 对一批卡片分类，并规范化每个模型项目。
 * @param {Array<object>} cards 区域卡片
 * @returns {Promise<Array<object|null>>} 与卡片对齐的规范化结果
 */
async function llmClassifyBatch(cards) {
  const raw = await callLLMWithTimeout(buildClassifyPrompt(cards), L1C_LLM_MODEL);
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

/**
 * 将可选的 LLM 分类结果叠加到基于规则的基础结果上。
 * @param {object} base 基于规则的分类结果
 * @param {object|null} llmItem 规范化的 LLM 结果
 * @returns {object} 合并后的分类结果
 */
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

/**
 * Classify region cards: rule-based first, LLM for low-confidence/other, with L1d cache.
 * @param {Array<object>} [cards] region cards
 * @param {{ systemId?: string }} [opts] classification options
 * @returns {Promise<object[]>} cards enriched with role/label/confidence/source/signature
 */
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
