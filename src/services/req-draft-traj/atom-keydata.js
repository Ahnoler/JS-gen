/**
 * Layer B/C helpers: pageCodes + sanitize 关键数据 (no ZJJK tables in keydata).
 */
import { extractZjjkCodes } from './provenance.js';

const KEYDATA_HEADER_RE = /^(关键数据|业务数据|案例数据|测试数据|预设数据|用例数据)\s*[:：]?$/i;
/** Line is "only" page-code metadata if every token is ZJJK-ish or label noise. */
const PURE_ZJJK_META_RE = /^(?:大页面|页签|页面|组件|编号)?\s*[:：]?\s*(?:ZJJK\d{5,}(?:\s*[\/|,，]\s*ZJJK\d{5,})*)\s*$/i;

/**
 * @param {{ llmPageCodes?: unknown, taskDraft?: string, zjjkCells?: unknown[] }} opts
 * @returns {string[]}
 */
export function collectPageCodes({ llmPageCodes, taskDraft, zjjkCells } = {}) {
  /** @type {string[]} */
  const out = [];
  const seen = new Set();
  const pushAll = (raw) => {
    for (const code of extractZjjkCodes(String(raw || ''))) {
      if (seen.has(code)) continue;
      seen.add(code);
      out.push(code);
    }
  };
  if (Array.isArray(llmPageCodes)) {
    for (const item of llmPageCodes) pushAll(item);
  }
  pushAll(taskDraft);
  if (Array.isArray(zjjkCells)) {
    for (const cell of zjjkCells) pushAll(cell);
  }
  return out;
}

/**
 * @param {string} line
 * @returns {boolean}
 */
function isPureZjjkMetaLine(line) {
  const t = String(line || '').trim();
  if (!t) return false;
  if (PURE_ZJJK_META_RE.test(t)) return true;
  // bare code(s) only
  const codes = extractZjjkCodes(t);
  if (!codes.length) return false;
  const stripped = t.replace(/ZJJK\d{5,}/gi, '').replace(/[\s\/|,，:：\-—_]/g, '');
  return stripped.length === 0;
}

/**
 * Remove ZJJK-only lines from 关键数据; drop empty keydata section.
 * @param {string} taskDraft
 * @returns {{ taskDraft: string, extractedCodes: string[] }}
 */
export function sanitizeTaskDraftKeyData(taskDraft) {
  const lines = String(taskDraft || '').split(/\r?\n/);
  /** @type {string[]} */
  const extractedCodes = [];
  /** @type {string[]} */
  const out = [];
  let inKey = false;
  /** @type {string[]} */
  const keyBuf = [];

  const flushKey = () => {
    const kept = [];
    for (const raw of keyBuf) {
      const t = raw.trim();
      if (!t) {
        kept.push(raw);
        continue;
      }
      if (isPureZjjkMetaLine(t)) {
        for (const c of extractZjjkCodes(t)) {
          if (!extractedCodes.includes(c)) extractedCodes.push(c);
        }
        continue;
      }
      kept.push(raw);
    }
    while (kept.length && !kept[kept.length - 1].trim()) kept.pop();
    const body = kept.filter((l) => l.trim());
    if (body.length === 0) return;
    out.push('关键数据');
    out.push(...kept);
  };

  for (const line of lines) {
    const t = line.trim();
    if (!inKey) {
      if (KEYDATA_HEADER_RE.test(t)) {
        inKey = true;
        keyBuf.length = 0;
        continue;
      }
      out.push(line);
      continue;
    }
    if (/^\d+[\.、\)]\s*/.test(t) || /^来源\s*[:：]/.test(t)) {
      flushKey();
      inKey = false;
      out.push(line);
      continue;
    }
    keyBuf.push(line);
  }
  if (inKey) flushKey();

  let text = out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  if (text) text += '\n';
  return { taskDraft: text, extractedCodes };
}

/**
 * @param {string} taskDraft
 * @returns {boolean}
 */
export function isLegacyZjjkOnlyKeyData(taskDraft) {
  const lines = String(taskDraft || '').split(/\r?\n/);
  let inKey = false;
  /** @type {string[]} */
  const body = [];
  for (const line of lines) {
    const t = line.trim();
    if (!inKey) {
      if (KEYDATA_HEADER_RE.test(t)) inKey = true;
      continue;
    }
    if (/^\d+[\.、\)]\s*/.test(t)) break;
    if (!t) continue;
    body.push(t);
  }
  if (body.length === 0) return false;
  return body.every((l) => isPureZjjkMetaLine(l));
}
