export const DONE_LOG_TEXT_MAX = 2000;
export const DONE_LOG_SOURCES = new Set(['agent', 'fail']);

export function parseDoneLogs(raw) {
  if (raw == null || raw === '') return [];
  let arr = raw;
  if (typeof raw === 'string') {
    try { arr = JSON.parse(raw); } catch { return []; }
  }
  if (!Array.isArray(arr)) return [];
  return arr.map(normalizeDoneLogEntry).filter(Boolean);
}

export function normalizeDoneLogEntry(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const source = entry.source === 'fail' || entry.source === 'agent' ? entry.source : null;
  if (!source) return null;
  const at = typeof entry.at === 'string' && entry.at.trim() ? entry.at.trim() : null;
  if (!at) return null;
  const text = String(entry.text ?? '').trim().slice(0, DONE_LOG_TEXT_MAX);
  return { text, at, source };
}

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
