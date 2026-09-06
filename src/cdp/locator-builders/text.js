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
 * @param {string} text Text to quote.
 * @returns {string} XPath-safe string literal (uses concat() when both quotes present).
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
 * @param {string} text Raw control text.
 * @returns {string} Whitespace-collapsed, trimmed text capped at 40 chars.
 */
export function normalizeControlText(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 40);
}

/**
 * Normalize form label (strip trailing colon / required marker).
 * @param {string} text Raw form label.
 * @returns {string} Trimmed label without trailing colon/asterisk, capped at 40 chars.
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
 * @param {string} text Raw tree text.
 * @returns {string} Stable text with volatile suffixes removed, capped at 40 chars.
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
 * @param {string} className Element class string.
 * @returns {string} First `el-icon-*` token, or empty string.
 */
export function extractElIconClass(className) {
  const m = String(className || '').match(/el-icon-[a-z0-9-]+/i);
  return m ? m[0] : '';
}

/**
 * XPath class-token predicate (exact token, not substring).
 * @param {string} token Class token to match.
 * @returns {string} XPath `contains(concat(...))` predicate, or empty string.
 */
export function classTokenPred(token) {
  const t = String(token || '').trim();
  if (!t) return '';
  return `contains(concat(' ',normalize-space(@class),' '),' ${t} ')`;
}

/**
 * Whether a className string contains a given exact token.
 * @param {string} className Element class string.
 * @param {string} token Class token to test.
 * @returns {boolean} True if the token is present as a whitespace-delimited class.
 */
export function hasClassToken(className, token) {
  const tokens = String(className || '').trim().split(/\s+/).filter(Boolean);
  return tokens.includes(String(token || '').trim());
}

/**
 * Reject generated / unstable ids.
 * @param {string} id Candidate id.
 * @returns {boolean} True if the id is empty or matches a generated-id pattern.
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
 * Reject generated / unstable name attributes.
 * @param {string} name Candidate name.
 * @returns {boolean} True if the name is empty or matches a generated-name pattern.
 */
export function isGeneratedName(name) {
  const s = String(name || '').trim();
  if (!s) return true;
  if (/^[0-9a-f]{16,}$/i.test(s)) return true;
  if (/^\d{10,}$/.test(s)) return true;
  return isGeneratedId(s);
}
