/**
 * locator-builders/scope.js — extracted from locator-candidates.js.
 * Public API re-exported by src/cdp/locator-candidates.js.
 */
import { hasClassToken } from './text.js';

/**
 * Detect the container kind (dialog / drawer / nav) from absolute xpath / className / container hint.
 * @param {string} [xpathFull] Absolute xpath.
 * @param {string} [className] Element class string.
 * @param {string} [container] Explicit container hint.
 * @returns {'dialog'|'drawer'|'nav'|''} Detected container kind, or empty string.
 */
export function detectContainerKind(xpathFull = '', className = '', container = '') {
  if (container === 'dialog' || container === 'drawer' || container === 'nav') return container;
  const full = String(xpathFull || '');
  const cls = String(className || '');
  // Drawer first. Match container tokens / el-drawer__* — not icon classes alone.
  if (
    /el-drawer/i.test(full)
    || hasClassToken(cls, 'el-drawer')
    || /(^|\s)el-drawer__/i.test(` ${cls}`)
  ) {
    return 'drawer';
  }
  // Dialog container only — do NOT treat el-dialog__close / el-dialog__headerbtn as dialog.
  // Those icon/headerbtn classes appear inside drawers too (Element UI reuses them).
  if (
    /el-dialog(?!__)/i.test(full)
    || /el-message-box/i.test(full)
    || hasClassToken(cls, 'el-dialog')
    || hasClassToken(cls, 'el-message-box')
    || /(^|\s)el-message-box__/i.test(` ${cls}`)
  ) {
    return 'dialog';
  }
  if (/\/nav\//i.test(full) || /\/aside\//i.test(full) || /el-aside|el-menu|sidebar|side-menu|nav-menu|menu-wrap/i.test(cls)) {
    return 'nav';
  }
  return '';
}

/**
 * Wrap an xpath expression with occurrence index when needed.
 * @param {string} expr XPath expression.
 * @param {number} [occurrence] 1-based occurrence index (0 = no index).
 * @returns {string} XPath wrapped with `[n]` when occurrence >= 1, else unchanged.
 */
export function withOccurrence(expr, occurrence = 0) {
  const xp = String(expr || '').trim();
  if (!xp) return '';
  const n = Number(occurrence) || 0;
  if (n < 1) return xp;
  const body = xp.startsWith('(') ? xp : `(${xp})`;
  return `${body}[${n}]`;
}

/**
 * Scope prefix for relative xpath.
 * @param {'dialog'|'drawer'|'overlay'|'nav'|''} kind Container kind.
 * @returns {string} Scope prefix xpath (empty for unknown kinds).
 */
export function scopePrefix(kind) {
  // Do NOT use [last()] — DOM last is often a leftover hidden dialog.
  // Replay picks the last visible match among all hits.
  if (kind === 'drawer') return "//div[contains(@class,'el-drawer')]";
  if (kind === 'dialog') {
    return "//div[contains(@class,'el-dialog') or contains(@class,'el-message-box')]";
  }
  // Ambiguous close / overlay: cover dialog + message-box + drawer (traj36).
  if (kind === 'overlay') {
    return "//div[contains(@class,'el-dialog') or contains(@class,'el-message-box') or contains(@class,'el-drawer')]";
  }
  return '';
}

/**
 * Join scope + local relative path.
 * @param {string} local Local relative xpath (without leading `//`).
 * @param {'dialog'|'drawer'|'overlay'|'nav'|''} kind Container kind.
 * @returns {string} Scoped xpath, or `//local` when no scope applies.
 */
export function scopedXPath(local, kind) {
  const loc = String(local || '').replace(/^\/+/, '');
  if (!loc) return '';
  const prefix = scopePrefix(kind);
  if (prefix) return `${prefix}//${loc}`;
  return `//${loc}`;
}

