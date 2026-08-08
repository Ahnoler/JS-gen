/**
 * locator-builders/text.js — extracted from locator-candidates.js.
 * Public API re-exported by src/cdp/locator-candidates.js.
 */
export const MENU_CLASS_TOKENS = Object.freeze([
  'menu-item',
  'submenu-item',
  'nav-item',
  'el-menu-item',
  'el-submenu__title',
  'el-dropdown-menu__item',
]);

/**
 * XPath string literal for a text value.
 * @param {string} text
 */
export function xpathLiteral(text) {
  const t = String(text || '');
  if (!t.includes("'")) return `'${t}'`;
  if (!t.includes('"')) return `"${t}"`;
  const parts = t.split("'").map((p) => `'${p}'`);
  return `concat(${parts.join(`, "'", `)})`;
}

/**
 * Normalize visible control text for matching / storage.
 * @param {string} text
 */
export function normalizeControlText(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 40);
}

/**
 * Normalize form label (strip trailing colon / required marker).
 * @param {string} text
 */
export function normalizeFormLabel(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[：:*\s]+$/g, '')
    .slice(0, 40);
}

/**
 * Strip volatile tree suffixes: trailing (count) and [V-x.x.x] version badges.
 * @param {string} text
 */
export function stripVolatileTreeText(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\[\s*V[-\d.]+\s*\]$/i, '')
    .replace(/\(\d+\)\s*$/, '')
    .trim()
    .slice(0, 40);
}

/**
 * Extract first el-icon-* class token from a className string.
 * @param {string} className
 */
export function extractElIconClass(className) {
  const m = String(className || '').match(/el-icon-[a-z0-9-]+/i);
  return m ? m[0] : '';
}

/**
 * XPath class-token predicate (exact token, not substring).
 * @param {string} token
 */
export function classTokenPred(token) {
  const t = String(token || '').trim();
  if (!t) return '';
  return `contains(concat(' ',normalize-space(@class),' '),' ${t} ')`;
}

/**
 * @param {string} className
 * @param {string} token
 */
export function hasClassToken(className, token) {
  const tokens = String(className || '').trim().split(/\s+/).filter(Boolean);
  return tokens.includes(String(token || '').trim());
}

/**
 * Reject generated / unstable ids.
 * @param {string} id
 */
export function isGeneratedId(id) {
  const s = String(id || '').trim();
  if (!s) return true;
  if (/^el-id-/i.test(s)) return true;
  if (/^\d{4,}$/.test(s)) return true;
  // Element UI / app tabs often mint tab-<timestamp> ids per mount
  if (/^tab-\d{6,}$/i.test(s)) return true;
  if (/^[a-z]+-\d{10,}$/i.test(s)) return true;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)) return true;
  if (/^ember\d+/i.test(s)) return true;
  if (/^vue-/i.test(s)) return true;
  if (/^:r[0-9a-z]+:/i.test(s)) return true;
  return false;
}

/**
 * @param {string} name
 */
export function isGeneratedName(name) {
  const s = String(name || '').trim();
  if (!s) return true;
  if (/^[0-9a-f]{16,}$/i.test(s)) return true;
  if (/^\d{10,}$/.test(s)) return true;
  return isGeneratedId(s);
}

/**
 * Detect dialog/drawer/nav scope from absolute xpath or className.
 * @param {string} xpathFull
 * @param {string} className
 * @param {string} [container]
 * @returns {'dialog'|'drawer'|'nav'|''}
 */
