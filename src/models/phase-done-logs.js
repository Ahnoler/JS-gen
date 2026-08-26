export const DONE_LOG_TEXT_MAX = 2000;
export const DONE_LOG_SOURCES = new Set(['agent', 'fail']);

/**
 * 解析 done 日志文本/数组为规范条目列表。
 * @param {string|Array|undefined|null} raw 原始 done 日志（JSON 字符串或数组）
 * @returns {Array<{text: string, at: string, source: 'agent'|'fail'}>} 规范化条目
 */
export function parseDoneLogs(raw) {
  if (raw == null || raw === '') return [];
  let arr = raw;
  if (typeof raw === 'string') {
    try { arr = JSON.parse(raw); } catch { return []; }
  }
  if (!Array.isArray(arr)) return [];
  return arr.map(normalizeDoneLogEntry).filter(Boolean);
}

/**
 * 归一化单条 done 日志条目（校验 source/at，截断 text）。
 * @param {object|null|undefined} entry 原始条目
 * @returns {{text: string, at: string, source: 'agent'|'fail'}|null} 规范化条目
 */
export function normalizeDoneLogEntry(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const source = entry.source === 'fail' || entry.source === 'agent' ? entry.source : null;
  if (!source) return null;
  const at = typeof entry.at === 'string' && entry.at.trim() ? entry.at.trim() : null;
  if (!at) return null;
  const text = String(entry.text ?? '').trim().slice(0, DONE_LOG_TEXT_MAX);
  return { text, at, source };
}

/**
 * 追加一条 done 日志到已有日志（去重不做，保持顺序）。
 * @param {string|Array|undefined|null} existing 已有日志
 * @param {{text?: string, source?: string, at?: string}} [entry] 新条目
 * @param {() => string} [now] 时间戳函数
 * @returns {Array<{text: string, at: string, source: 'agent'|'fail'}>} 追加后的条目列表
 */
export function appendDoneLogEntry(existing, { text, source, at } = {}, now = () => new Date().toISOString()) {
  const trimmed = String(text ?? '').trim();
  if (!trimmed) return parseDoneLogs(existing);
  if (!DONE_LOG_SOURCES.has(source)) return parseDoneLogs(existing);
  const entry = {
    text: trimmed.slice(0, DONE_LOG_TEXT_MAX),
    at: typeof at === 'string' && at.trim() ? at.trim() : now(),
    source,
  };
  return [...parseDoneLogs(existing), entry];
}
