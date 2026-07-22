/**
 * Stable locator helpers for buttons / links that sit under ephemeral body>div[N]
 * (Element UI dialogs rebuild on each open).
 *
 * Primary: xpath_smart (text-anchored)
 * Fallback candidates: xpath_full (absolute), css
 */

/**
 * XPath string literal for a text value.
 * @param {string} text
 */
export function xpathLiteral(text) {
  const t = String(text || '');
  if (!t.includes("'")) return `'${t}'`;
  if (!t.includes('"')) return `"${t}"`;
  // concat('a',"'",'b')
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
 * Build text-anchored xpath for clickable controls.
 * @param {{ tag?: string, text?: string, xpathFull?: string, className?: string, container?: 'dialog'|'drawer'|'' }} opts
 */
export function buildXPathSmart({
  tag = '',
  text = '',
  xpathFull = '',
  className = '',
  container = '',
} = {}) {
  const t = normalizeControlText(text);
  if (!t) return '';
  const tagL = String(tag || '').toLowerCase();
  const cls = String(className || '');
  const clickable =
    tagL === 'button'
    || tagL === 'a'
    || /(?:^|\s)el-button(?:\s|$)/.test(cls)
    || false;
  if (!clickable) return '';

  const lit = xpathLiteral(t);
  const local = tagL === 'a'
    ? `a[normalize-space()=${lit}]`
    : `button[normalize-space()=${lit}]`;

  const full = String(xpathFull || '');
  let kind = container;
  if (!kind) {
    if (/el-drawer/i.test(full) || /el-drawer/i.test(cls)) kind = 'drawer';
    else if (/el-dialog|el-message-box/i.test(full) || /el-dialog|el-message-box/i.test(cls)) kind = 'dialog';
  }

  if (kind === 'drawer') {
    return `(//div[contains(@class,'el-drawer')])[last()]//${local}`;
  }
  if (kind === 'dialog') {
    return `(//div[contains(@class,'el-dialog') or contains(@class,'el-message-box')])[last()]//${local}`;
  }
  // Default: page-global text button (stable across body>div[N] remounts)
  return `//${local}`;
}

/**
 * @param {{ xpathSmart?: string, xpathFull?: string, cssSelector?: string }} opts
 * @returns {Array<{ type: string, value: string }>}
 */
export function buildCandidates({ xpathSmart = '', xpathFull = '', cssSelector = '' } = {}) {
  /** @type {Array<{ type: string, value: string }>} */
  const out = [];
  if (xpathSmart) out.push({ type: 'xpath_smart', value: xpathSmart });
  if (xpathFull) out.push({ type: 'xpath_full', value: xpathFull });
  if (cssSelector) out.push({ type: 'css', value: cssSelector });
  return out;
}

/**
 * Enrich a raw element meta (from CDP inspect / resolve) with stable locators.
 * @param {object} meta
 */
export function enrichLocatorFields(meta = {}) {
  const tag = meta.tag || meta.tagName || meta.tag_name || '';
  const text = normalizeControlText(meta.text || '');
  const xpathFull = String(
    meta.xpath_full || meta.xpath_abs || meta.xpathAbs || meta.xpathFull || '',
  ).trim();
  const bu = String(meta.bu_xpath || meta.buXpath || '').trim();
  const existing = String(meta.xpath || meta.target || '').trim();
  const abs = xpathFull || (existing.startsWith('/') && !existing.startsWith('//') ? existing : '') || existing;
  const className = String(
    meta.className
    || meta.attributes?.class
    || meta.attributes?.className
    || '',
  );
  const cssSelector = String(meta.cssSelector || meta.css_selector || '').trim();

  const xpathSmart = buildXPathSmart({
    tag,
    text,
    xpathFull: abs,
    className,
  });

  const primary = xpathSmart || bu || abs || existing;
  const candidates = buildCandidates({
    xpathSmart,
    xpathFull: abs || (primary !== xpathSmart ? primary : ''),
    cssSelector,
  });

  return {
    ...meta,
    tag,
    text,
    xpath: primary,
    xpath_smart: xpathSmart,
    xpath_full: abs || '',
    xpath_abs: abs || meta.xpath_abs || '',
    bu_xpath: bu,
    cssSelector,
    candidates,
  };
}

/**
 * Page-side helper source (injected into CDP Runtime.evaluate strings).
 * Defines: xpathLiteral, normalizeControlText, xpathSmartOf, cssOfSimple, buildLocatorSnap
 */
export const PAGE_LOCATOR_HELPERS = `
  function xpathLiteral(text) {
    const t = String(text || '');
    if (t.indexOf("'") < 0) return "'" + t + "'";
    if (t.indexOf('"') < 0) return '"' + t + '"';
    const parts = t.split("'").map(function (p) { return "'" + p + "'"; });
    return 'concat(' + parts.join(", \\"'\\", ") + ')';
  }
  function normalizeControlText(text) {
    return String(text || '').replace(/\\s+/g, ' ').trim().slice(0, 40);
  }
  function cssOfSimple(node) {
    if (!node || node.nodeType !== 1) return '';
    if (node.id) {
      try { return '#' + CSS.escape(node.id); } catch (e) { return '#' + node.id; }
    }
    const tag = node.tagName.toLowerCase();
    const cls = String(node.className || '')
      .split(/\\s+/)
      .filter(Boolean)
      .slice(0, 3)
      .map(function (c) {
        try { return '.' + CSS.escape(c); } catch (e2) { return '.' + c; }
      })
      .join('');
    return tag + cls;
  }
  function xpathSmartOf(node, text) {
    const t = normalizeControlText(text);
    if (!t) return '';
    const tagL = (node && node.tagName ? node.tagName.toLowerCase() : '');
    const cls = String((node && node.className) || '');
    const clickable = tagL === 'button' || tagL === 'a' || /(^| )el-button( |$)/.test(cls);
    if (!clickable) return '';
    const lit = xpathLiteral(t);
    const local = tagL === 'a'
      ? 'a[normalize-space()=' + lit + ']'
      : 'button[normalize-space()=' + lit + ']';
    const inDrawer = !!(node && node.closest && node.closest('.el-drawer'));
    const inDialog = !!(node && node.closest && node.closest('.el-dialog, .el-message-box'));
    if (inDrawer) {
      return "(//div[contains(@class,'el-drawer')])[last()]//" + local;
    }
    if (inDialog) {
      return "(//div[contains(@class,'el-dialog') or contains(@class,'el-message-box')])[last()]//" + local;
    }
    return '//' + local;
  }
  function buildLocatorSnap(node, text, xpathFull) {
    const t = normalizeControlText(text);
    const abs = String(xpathFull || '');
    const smart = xpathSmartOf(node, t);
    const css = cssOfSimple(node);
    const primary = smart || abs;
    const candidates = [];
    if (smart) candidates.push({ type: 'xpath_smart', value: smart });
    if (abs) candidates.push({ type: 'xpath_full', value: abs });
    if (css) candidates.push({ type: 'css', value: css });
    return {
      xpath: primary,
      xpath_smart: smart,
      xpath_full: abs,
      xpath_abs: abs,
      cssSelector: css,
      text: t,
      candidates: candidates,
    };
  }
`;
