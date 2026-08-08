/**
 * locator-builders/scope.js — extracted from locator-candidates.js.
 * Public API re-exported by src/cdp/locator-candidates.js.
 */
import { hasClassToken } from './text.js';

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
 * @param {string} expr
 * @param {number} [occurrence]
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
 * @param {'dialog'|'drawer'|'overlay'|'nav'|''} kind
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
 * @param {string} local — starts without leading //
 * @param {'dialog'|'drawer'|'overlay'|'nav'|''} kind
 */
export function scopedXPath(local, kind) {
  const loc = String(local || '').replace(/^\/+/, '');
  if (!loc) return '';
  const prefix = scopePrefix(kind);
  if (prefix) return `${prefix}//${loc}`;
  return `//${loc}`;
}

/**
 * Stable attribute short-circuit xpath.
 * @param {{ tag?: string, attributes?: Record<string,string>, container?: string, xpathFull?: string, className?: string }} opts
 */
