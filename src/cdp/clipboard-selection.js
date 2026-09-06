/**
 * Shared BiB clipboard getSelection helpers (executor + local remote-bridge).
 * Page expression returns { ok: true, text: string }.
 */
export const CLIPBOARD_GET_SELECTION_EXPRESSION = `(() => {
  try {
    const el = document.activeElement;
    if (el) {
      const tag = (el.tagName || '').toUpperCase();
      if (tag === 'INPUT' || tag === 'TEXTAREA') {
        const start = Number(el.selectionStart);
        const end = Number(el.selectionEnd);
        if (Number.isFinite(start) && Number.isFinite(end) && end >= start) {
          return { ok: true, text: String(el.value || '').slice(start, end) };
        }
      }
      if (typeof el.value === 'string'
          && typeof el.selectionStart === 'number'
          && typeof el.selectionEnd === 'number') {
        return {
          ok: true,
          text: String(el.value).slice(el.selectionStart, el.selectionEnd),
        };
      }
    }
    const sel = window.getSelection && window.getSelection();
    return { ok: true, text: sel ? String(sel.toString() || '') : '' };
  } catch (e) {
    return { ok: false, text: '', reason: 'evaluate_error' };
  }
})()`;

/**
 * Normalize a raw clipboard getSelection result into a stable shape.
 * @param {unknown} raw Raw evaluate result from the page expression.
 * @returns {{ ok: boolean, text: string, reason?: string }} Normalized selection result.
 */
export function normalizeClipboardSelectionResult(raw) {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, text: '', reason: 'evaluate_error' };
  }
  const o = /** @type {Record<string, unknown>} */ (raw);
  if (o.ok === false) {
    return {
      ok: false,
      text: '',
      reason: typeof o.reason === 'string' ? o.reason : 'evaluate_error',
    };
  }
  return { ok: true, text: o.text == null ? '' : String(o.text) };
}
