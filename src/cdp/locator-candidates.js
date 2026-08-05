/**
 * Stable locator helpers for Element UI controls (canonical Node builders).
 *
 * Primary: xpath_smart (relative / text/label/attr-anchored)
 * Fallback: xpath_full (absolute) + locator_strategy / locator_fallback_reason
 *
 * Keep PAGE_LOCATOR_HELPERS in sync — injected into CDP Runtime.evaluate.
 */

/** Menu class tokens (exact classList membership). */
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
export function detectContainerKind(xpathFull = '', className = '', container = '') {
  if (container === 'dialog' || container === 'drawer' || container === 'nav') return container;
  const full = String(xpathFull || '');
  const cls = String(className || '');
  if (/el-drawer/i.test(full) || /el-drawer/i.test(cls)) return 'drawer';
  if (/el-dialog|el-message-box/i.test(full) || /el-dialog|el-message-box/i.test(cls)) return 'dialog';
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
 * @param {'dialog'|'drawer'|'nav'|''} kind
 */
function scopePrefix(kind) {
  // Do NOT use [last()] — DOM last is often a leftover hidden dialog.
  // Replay picks the last visible match among all hits.
  if (kind === 'drawer') return "//div[contains(@class,'el-drawer')]";
  if (kind === 'dialog') {
    return "//div[contains(@class,'el-dialog') or contains(@class,'el-message-box')]";
  }
  return '';
}

/**
 * Join scope + local relative path.
 * @param {string} local — starts without leading //
 * @param {'dialog'|'drawer'|'nav'|''} kind
 */
function scopedXPath(local, kind) {
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
export function buildStableAttrXPathSmart({
  tag = '',
  attributes = {},
  container = '',
  xpathFull = '',
  className = '',
} = {}) {
  const attrs = attributes && typeof attributes === 'object' ? attributes : {};
  const tagL = String(tag || '*').toLowerCase() || '*';
  const kind = detectContainerKind(xpathFull, className, container);

  const tryAttr = (name) => {
    const v = String(attrs[name] || '').trim();
    if (!v || v.length > 80) return '';
    if (name === 'id' && isGeneratedId(v)) return '';
    if (name === 'name' && isGeneratedName(v)) return '';
    if (name === 'data-id' && isGeneratedId(v)) return '';
    if (name === 'title' && (v.length > 40 || /^https?:/i.test(v))) return '';
    return scopedXPath(`${tagL}[@${name}=${xpathLiteral(v)}]`, kind);
  };

  for (const name of [
    'data-testid', 'data-test', 'data-qa',
    'data-name', 'data-menu', 'data-id',
    'id', 'name', 'aria-label', 'title',
  ]) {
    const xp = tryAttr(name);
    if (xp) return xp;
  }
  return '';
}

/**
 * Relative xpath for an Element UI form control by its label.
 * @param {{ label?: string, tag?: string, className?: string, xpathFull?: string, container?: string, occurrence?: number }} opts
 */
export function buildFormFieldXPathSmart({
  label = '',
  tag = '',
  className = '',
  xpathFull = '',
  container = '',
  occurrence = 0,
} = {}) {
  const lbl = normalizeFormLabel(label);
  if (!lbl) return '';

  const lit = xpathLiteral(lbl);
  const itemPred =
    `div[contains(@class,'el-form-item')]`
    + `[.//label[contains(normalize-space(.),${lit})]]`;

  const tagL = String(tag || '').toLowerCase();
  const cls = String(className || '');
  const full = String(xpathFull || '');
  let leaf = 'input';
  if (tagL === 'textarea' || /el-textarea/i.test(cls) || /textarea/i.test(full)) {
    leaf = 'textarea';
  } else if (/el-select/i.test(cls) || /el-select/i.test(full) || (tagL === 'div' && /el-select/i.test(cls))) {
    leaf = "div[contains(@class,'el-select')]";
  } else if (/el-date-editor|tsscdatepicker/i.test(cls) || /el-date-editor/i.test(full)) {
    leaf = "div[contains(@class,'el-date-editor')]";
  } else if (/el-radio-group/i.test(cls) || /el-radio-group/i.test(full)) {
    leaf = "div[contains(@class,'el-radio-group')]";
  } else if (/el-checkbox-group/i.test(cls) || /el-checkbox-group/i.test(full)) {
    leaf = "div[contains(@class,'el-checkbox-group')]";
  } else if (/el-cascader/i.test(cls) || /el-cascader/i.test(full)) {
    leaf = "div[contains(@class,'el-cascader')]";
  } else if (
    /el-tree-select|tsscmultitree|tsscTree|tree-popover|my-popover/i.test(cls)
    || /el-tree-select|tsscmultitree|tsscTree|tree-popover|my-popover/i.test(full)
  ) {
    // Custom bank tree (tsscTree in popover) uses span.my-popover as click trigger
    leaf = "span[contains(@class,'my-popover')]";
  } else if (tagL === 'input' || /el-input__inner/i.test(cls) || !tagL) {
    leaf = 'input';
  } else if (tagL === 'button' || /el-button/i.test(cls)) {
    leaf = 'button';
  } else {
    leaf = tagL;
  }

  const kind = detectContainerKind(full, cls, container);
  return withOccurrence(scopedXPath(`${itemPred}//${leaf}`, kind), occurrence);
}

/**
 * Menu / submenu / dropdown item relative xpath.
 * @param {{ tag?: string, text?: string, className?: string, xpathFull?: string, container?: string, attributes?: object, occurrence?: number }} opts
 */
export function buildMenuXPathSmart({
  tag = '',
  text = '',
  className = '',
  xpathFull = '',
  container = '',
  attributes = {},
  occurrence = 0,
} = {}) {
  const attrXp = buildStableAttrXPathSmart({
    tag: tag || 'li',
    attributes,
    container,
    xpathFull,
    className,
  });
  if (attrXp) return withOccurrence(attrXp, occurrence);

  const t = normalizeControlText(text);
  if (!t) return '';
  const cls = String(className || '');
  const tokens = MENU_CLASS_TOKENS.filter((tok) => hasClassToken(cls, tok));
  const lit = xpathLiteral(t);
  const classOr = tokens.length
    ? tokens.map((tok) => classTokenPred(tok)).join(' or ')
    : '';
  const roleOrClass = classOr
    ? `[${classOr} or @role='menuitem']`
    : "[@role='menuitem']";
  // Separate predicates — (self::a or self::b)[pred] is invalid XPath 1.0 (or yields boolean).
  const local =
    `*[self::li or self::a or self::div or self::span]`
    + roleOrClass
    + `[normalize-space()=${lit}]`;
  const kind = detectContainerKind(xpathFull, cls, container) || 'nav';
  // nav scope is soft — page-global is fine when class tokens pin the host
  const scopeKind = kind === 'nav' ? '' : kind;
  return withOccurrence(scopedXPath(local, scopeKind), occurrence);
}

/**
 * Icon button by el-icon-* class (preferred) or aria-label / title fallback.
 * Tip text is stored in params.text for replay disambiguation — not only aria-label
 * (ElTooltip toolbars often leave aria-label empty).
 */
export function buildIconXPathSmart({
  text = '',
  attributes = {},
  xpathFull = '',
  className = '',
  container = '',
  occurrence = 0,
} = {}) {
  const attrs = { ...(attributes || {}) };
  const cls = String(className || attrs.class || '');
  const iconTok = extractElIconClass(cls);
  const kind = detectContainerKind(xpathFull, className, container);
  if (iconTok) {
    const local = `a[contains(@class,${xpathLiteral(iconTok)})]`;
    return withOccurrence(scopedXPath(local, kind), occurrence);
  }
  const t = normalizeControlText(text || attrs['aria-label'] || attrs.title || '');
  if (!t) return '';
  const lit = xpathLiteral(t);
  const local = `*[@aria-label=${lit} or @title=${lit}]`;
  return withOccurrence(scopedXPath(local, kind), occurrence);
}

/**
 * Tab by visible text.
 */
export function buildTabXPathSmart({
  text = '',
  tabName = '',
  xpathFull = '',
  className = '',
  container = '',
  occurrence = 0,
} = {}) {
  const t = normalizeControlText(tabName || text);
  if (!t) return '';
  const lit = xpathLiteral(t);
  const kind = detectContainerKind(xpathFull, className, container);
  const local =
    `*[(${classTokenPred('el-tabs__item')} or @role='tab') and normalize-space()=${lit}]`;
  return withOccurrence(scopedXPath(local, kind), occurrence);
}

/**
 * Table row button.
 */
export function buildTableRowButtonXPathSmart({
  rowText = '',
  buttonText = '',
  text = '',
  xpathFull = '',
  className = '',
  container = '',
  occurrence = 0,
} = {}) {
  const row = normalizeControlText(rowText);
  const btn = normalizeControlText(buttonText || text);
  if (!row || !btn) return '';
  const kind = detectContainerKind(xpathFull, className, container);
  const local =
    `tr[.//*[normalize-space()=${xpathLiteral(row)}]]`
    + `//*[self::button or self::a or ${classTokenPred('el-button')}][normalize-space()=${xpathLiteral(btn)}]`;
  return withOccurrence(scopedXPath(local, kind), occurrence);
}

/**
 * Table row radio.
 */
export function buildTableRowRadioXPathSmart({
  rowText = '',
  xpathFull = '',
  className = '',
  container = '',
  occurrence = 0,
} = {}) {
  const row = normalizeControlText(rowText);
  if (!row) return '';
  const kind = detectContainerKind(xpathFull, className, container);
  const local =
    `tr[.//*[normalize-space()=${xpathLiteral(row)}]]`
    + `//*[${classTokenPred('el-radio')} or ${classTokenPred('el-radio-button')}]`;
  return withOccurrence(scopedXPath(local, kind), occurrence);
}

/**
 * Dialog / drawer / notification close control.
 */
export function buildCloseXPathSmart({
  targetKind = 'dialog_close',
  xpathFull = '',
  className = '',
  container = '',
  occurrence = 0,
} = {}) {
  const kind = detectContainerKind(xpathFull, className, container)
    || (targetKind === 'notification_close' ? '' : 'dialog');
  let local = '';
  if (targetKind === 'notification_close') {
    local =
      `div[${classTokenPred('el-notification')}]`
      + `//*[${classTokenPred('el-notification__closeBtn')}]`;
    return withOccurrence(`//${local}`, occurrence);
  }
  local =
    `*[${classTokenPred('el-dialog__headerbtn')} or ${classTokenPred('el-drawer__close-btn')}`
    + ` or ${classTokenPred('el-message-box__headerbtn')} or ${classTokenPred('el-dialog__close')}]`;
  return withOccurrence(scopedXPath(local, kind || 'dialog'), occurrence);
}

/**
 * Adjacent button next to a labeled form item.
 */
export function buildAdjacentButtonXPathSmart({
  formLabel = '',
  text = '',
  buttonText = '',
  xpathFull = '',
  className = '',
  container = '',
  occurrence = 0,
} = {}) {
  const lbl = normalizeFormLabel(formLabel);
  const btn = normalizeControlText(buttonText || text);
  if (!lbl) return '';
  const lit = xpathLiteral(lbl);
  const itemPred =
    `div[contains(@class,'el-form-item')]`
    + `[.//label[contains(normalize-space(.),${lit})]]`;
  const kind = detectContainerKind(xpathFull, className, container);
  let leaf = `*[self::button or ${classTokenPred('el-button')}]`;
  if (btn) leaf += `[normalize-space()=${xpathLiteral(btn)}]`;
  return withOccurrence(scopedXPath(`${itemPred}//${leaf}`, kind), occurrence);
}

/**
 * Tree node content by stable base text (strip (n) / [V-x]); optional parent axis.
 * Never anchors on exact volatile counts like "贷款(272)".
 */
export function buildTreeNodeXPathSmart({
  text = '',
  parentText = '',
  dataKey = '',
  xpathFull = '',
  className = '',
  container = '',
  occurrence = 0,
} = {}) {
  const base = stripVolatileTreeText(text);
  if (!base && !dataKey) return '';
  const kind = detectContainerKind(xpathFull, className, container);
  let local = '';
  if (dataKey) {
    local = `*[@data-key=${xpathLiteral(String(dataKey))}]`;
  } else {
    const lit = xpathLiteral(base);
    local =
      `*[${classTokenPred('el-tree-node__content')} and starts-with(normalize-space(),${lit})]`;
  }
  const parentBase = stripVolatileTreeText(parentText);
  if (parentBase && !dataKey) {
    const plit = xpathLiteral(parentBase);
    local =
      `*[${classTokenPred('el-tree-node__content')} and starts-with(normalize-space(),${plit})]`
      + `/following-sibling::*[contains(@class,'el-tree-node__children')]`
      + `//${local}`;
  }
  return withOccurrence(scopedXPath(local, kind), occurrence);
}

/**
 * Input by placeholder when form-item label is absent (e.g. 搜索关键字).
 */
export function buildPlaceholderXPathSmart({
  placeholder = '',
  tag = '',
  xpathFull = '',
  className = '',
  container = '',
  occurrence = 0,
} = {}) {
  const ph = normalizeControlText(placeholder);
  if (!ph) return '';
  const kind = detectContainerKind(xpathFull, className, container);
  const tagL = String(tag || '').toLowerCase();
  const leaf = tagL === 'textarea' ? 'textarea' : 'input';
  return withOccurrence(
    scopedXPath(`${leaf}[contains(@placeholder,${xpathLiteral(ph)})]`, kind),
    occurrence,
  );
}

/**
 * Detect whether class/tag looks like a menu host (offline).
 */
export function isMenuLike({ tag = '', className = '', xpathFull = '', attributes = {} } = {}) {
  const cls = String(className || attributes?.class || '');
  if (MENU_CLASS_TOKENS.some((tok) => hasClassToken(cls, tok))) return true;
  if (String(attributes?.role || '') === 'menuitem') return true;
  const kind = detectContainerKind(xpathFull, cls, '');
  const tagL = String(tag || '').toLowerCase();
  if (kind === 'nav' && (tagL === 'li' || tagL === 'a')) return true;
  return false;
}

/**
 * Build text-anchored / label-anchored / action-aware relative xpath.
 * @param {object} opts
 */
export function buildXPathSmart(opts = {}) {
  const {
    tag = '',
    text = '',
    formLabel = '',
    xpathFull = '',
    className = '',
    container = '',
    targetKind = '',
    rowText = '',
    buttonText = '',
    optionText = '',
    tabName = '',
    menuText = '',
    parentText = '',
    placeholder = '',
    attributes = {},
    occurrence = 0,
  } = opts;

  const attrXp = buildStableAttrXPathSmart({
    tag,
    attributes,
    container,
    xpathFull,
    className,
  });
  // Attr short-circuit only when not a labeled form field (label is more semantic)
  const formLbl = normalizeFormLabel(formLabel);
  const kind = String(targetKind || '').trim();

  if (kind === 'dialog_close' || kind === 'notification_close') {
    return buildCloseXPathSmart({
      targetKind: kind,
      xpathFull,
      className,
      container,
      occurrence,
    });
  }
  if (kind === 'table_row_button') {
    return buildTableRowButtonXPathSmart({
      rowText,
      buttonText: buttonText || text,
      text,
      xpathFull,
      className,
      container,
      occurrence,
    });
  }
  if (kind === 'table_row_radio') {
    return buildTableRowRadioXPathSmart({
      rowText,
      xpathFull,
      className,
      container,
      occurrence,
    });
  }
  if (kind === 'adjacent_button') {
    return buildAdjacentButtonXPathSmart({
      formLabel: formLbl,
      text,
      buttonText,
      xpathFull,
      className,
      container,
      occurrence,
    });
  }
  if (kind === 'icon') {
    return buildIconXPathSmart({
      text: text || menuText,
      attributes,
      xpathFull,
      className,
      container,
      occurrence,
    });
  }
  if (kind === 'tab') {
    return buildTabXPathSmart({
      text,
      tabName: tabName || text,
      xpathFull,
      className,
      container,
      occurrence,
    });
  }
  if (kind === 'tree_node') {
    return buildTreeNodeXPathSmart({
      text,
      parentText,
      dataKey: (attributes && attributes['data-key']) || '',
      xpathFull,
      className,
      container,
      occurrence,
    });
  }
  if (kind === 'menu' || kind === 'submenu') {
    return buildMenuXPathSmart({
      tag,
      text: menuText || text,
      className,
      xpathFull,
      container,
      attributes,
      occurrence,
    });
  }

  if (formLbl && (!kind || kind.startsWith('form_') || kind === 'generic' || !kind)) {
    const formXp = buildFormFieldXPathSmart({
      label: formLbl,
      tag,
      className,
      xpathFull,
      container,
      occurrence,
    });
    if (formXp) return formXp;
  }

  const ph = normalizeControlText(placeholder || (attributes && attributes.placeholder) || '');
  if (ph && (!formLbl || kind === 'form_input' || !kind)) {
    const phXp = buildPlaceholderXPathSmart({
      placeholder: ph,
      tag,
      xpathFull,
      className,
      container,
      occurrence,
    });
    if (phXp) return phXp;
  }

  if (attrXp && !formLbl) return withOccurrence(attrXp, occurrence);

  if (isMenuLike({ tag, className, xpathFull, attributes })) {
    return buildMenuXPathSmart({
      tag,
      text: menuText || text,
      className,
      xpathFull,
      container,
      attributes,
      occurrence,
    });
  }

  const t = normalizeControlText(text || optionText || buttonText || menuText || tabName);
  if (!t) return '';
  const tagL = String(tag || '').toLowerCase();
  const cls = String(className || '');
  const clickable =
    tagL === 'button'
    || tagL === 'a'
    || /(?:^|\s)el-button(?:\s|$)/.test(cls)
    || kind === 'button'
    || kind === 'link';
  if (!clickable) return '';

  const lit = xpathLiteral(t);
  let local = '';
  if (tagL === 'a' || kind === 'link') {
    local = `a[normalize-space()=${lit}]`;
  } else if (/(?:^|\s)el-button(?:\s|$)/.test(cls) && tagL !== 'button') {
    local = `*[${classTokenPred('el-button')} and normalize-space()=${lit}]`;
  } else {
    local = `button[normalize-space()=${lit}]`;
  }

  const scopeKind = detectContainerKind(xpathFull, cls, container);
  return withOccurrence(scopedXPath(local, scopeKind), occurrence);
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
 * Sanitize attributes for element_json (drop value / secrets / huge blobs).
 * @param {Record<string, string>} attrs
 */
export function sanitizeAttributes(attrs = {}) {
  const out = {};
  if (!attrs || typeof attrs !== 'object') return out;
  for (const [k, v] of Object.entries(attrs)) {
    const key = String(k || '');
    const val = String(v ?? '');
    if (!key || !val) continue;
    if (/^(value|password|pwd|token|authorization|cookie)$/i.test(key)) continue;
    if (val.length > 120) continue;
    out[key] = val;
  }
  return out;
}

/**
 * Enrich a raw element meta (from CDP inspect / resolve) with stable locators.
 * Offline rebuild must NOT invent locator_verified=true.
 * @param {object} meta
 */
export function enrichLocatorFields(meta = {}) {
  const tag = meta.tag || meta.tagName || meta.tag_name || '';
  const text = normalizeControlText(meta.text || '');
  const formLabel = normalizeFormLabel(
    meta.formLabel || meta.labelText || meta.label_text || meta.label || meta.matchedLabel || '',
  );
  const xpathFull = String(
    meta.xpath_full || meta.xpath_abs || meta.xpathAbs || meta.xpathFull || '',
  ).trim();
  const bu = String(meta.bu_xpath || meta.buXpath || '').trim();
  const existing = String(meta.xpath || meta.target || '').trim();
  const abs = xpathFull
    || (existing.startsWith('/') && !existing.startsWith('//') ? existing : '')
    || '';
  const className = String(
    meta.className
    || meta.attributes?.class
    || meta.attributes?.className
    || '',
  );
  const cssSelector = String(meta.cssSelector || meta.css_selector || '').trim();
  const attributes = sanitizeAttributes(
    meta.attributes && typeof meta.attributes === 'object' ? meta.attributes : {},
  );
  const targetKind = String(meta.target_kind || meta.targetKind || '').trim();
  const occurrence = Number(meta.locator_occurrence || meta.occurrence || 0) || 0;
  const container = String(meta.locator_scope || meta.scope || meta.container || '').trim();

  let xpathSmart = String(meta.xpath_smart || '').trim();
  if (!xpathSmart) {
    xpathSmart = buildXPathSmart({
      tag,
      text,
      formLabel,
      xpathFull: abs || xpathFull,
      className,
      container,
      targetKind,
      rowText: meta.rowText || meta.row_text || '',
      buttonText: meta.buttonText || meta.button_text || '',
      optionText: meta.optionText || meta.option_text || '',
      tabName: meta.tabName || meta.tab_name || '',
      menuText: meta.menuText || meta.menu_text || '',
      attributes,
      occurrence,
    });
  }

  // Only DOM-evaluated snaps may claim verified uniqueness.
  const locatorVerified = meta.locator_verified === true;

  let locatorStrategy = String(meta.locator_strategy || '').trim();
  let locatorFallbackReason = String(meta.locator_fallback_reason || '').trim();
  if (xpathSmart) {
    locatorStrategy = 'xpath_smart';
    locatorFallbackReason = '';
  } else {
    locatorStrategy = 'xpath_full';
    if (!locatorFallbackReason) {
      locatorFallbackReason = formLabel || text
        ? 'no_smart_predicate'
        : 'empty_anchor_text';
    }
  }

  // Relative preferred when present; absolute otherwise.
  const primary = xpathSmart || abs || bu || existing;

  const candidates = buildCandidates({
    xpathSmart,
    xpathFull: abs || (primary !== xpathSmart ? String(primary) : ''),
    cssSelector,
  });

  const scope = detectContainerKind(abs || xpathFull, className, container) || container || '';

  /** @type {Record<string, unknown>} */
  const out = {
    ...meta,
    tag,
    text,
    formLabel: formLabel || meta.formLabel || '',
    attributes,
    xpath: primary,
    xpath_smart: xpathSmart,
    xpath_full: abs || '',
    xpath_abs: abs || meta.xpath_abs || '',
    bu_xpath: bu,
    cssSelector,
    candidates,
    target_kind: targetKind || meta.target_kind || '',
    locator_scope: scope || meta.locator_scope || '',
    locator_strategy: locatorStrategy,
    locator_verified: locatorVerified,
  };
  if (occurrence) out.locator_occurrence = occurrence;
  if (locatorStrategy === 'xpath_full') {
    out.locator_fallback_reason = locatorFallbackReason || 'absolute_only_input';
  } else {
    delete out.locator_fallback_reason;
  }
  return out;
}

/**
 * Page-side helper source (injected into CDP Runtime.evaluate strings).
 * Keep in sync with Node builders above and scripts/actions/_locator_helpers_js.py.
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
  function normalizeFormLabel(text) {
    return String(text || '').replace(/\\s+/g, ' ').trim().replace(/[：:*\\s]+$/g, '').slice(0, 40);
  }
  function stripVolatileTreeText(text) {
    return String(text || '').replace(/\\s+/g, ' ').trim()
      .replace(/\\[\\s*V[-\\d.]+\\s*\\]$/i, '')
      .replace(/\\(\\d+\\)\\s*$/, '')
      .trim().slice(0, 40);
  }
  function extractElIconClass(className) {
    const m = String(className || '').match(/el-icon-[a-z0-9-]+/i);
    return m ? m[0] : '';
  }
  function classTokenPred(token) {
    const t = String(token || '').trim();
    if (!t) return '';
    return "contains(concat(' ',normalize-space(@class),' '),' " + t + " ')";
  }
  function hasClassToken(className, token) {
    const tokens = String(className || '').trim().split(/\\s+/).filter(Boolean);
    return tokens.indexOf(String(token || '').trim()) >= 0;
  }
  function isGeneratedId(id) {
    const s = String(id || '').trim();
    if (!s) return true;
    if (/^el-id-/i.test(s)) return true;
    if (/^\\d{4,}$/.test(s)) return true;
    if (/^tab-\\d{6,}$/i.test(s)) return true;
    if (/^[a-z]+-\\d{10,}$/i.test(s)) return true;
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)) return true;
    if (/^ember\\d+/i.test(s)) return true;
    if (/^vue-/i.test(s)) return true;
    if (/^:r[0-9a-z]+:/i.test(s)) return true;
    return false;
  }
  var MENU_CLASS_TOKENS = ['menu-item','submenu-item','nav-item','el-menu-item','el-submenu__title','el-dropdown-menu__item'];
  function cssOfSimple(node) {
    if (!node || node.nodeType !== 1) return '';
    if (node.id && !isGeneratedId(node.id)) {
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
  function absXPath(node) {
    if (!node || node.nodeType !== 1) return '';
    if (node.id && !isGeneratedId(node.id)) return '//*[@id="' + node.id + '"]';
    const parts = [];
    let cur = node;
    while (cur && cur.nodeType === 1 && cur !== document.body) {
      let ix = 1;
      let sib = cur.previousElementSibling;
      while (sib) {
        if (sib.tagName === cur.tagName) ix++;
        sib = sib.previousElementSibling;
      }
      parts.unshift(cur.tagName.toLowerCase() + '[' + ix + ']');
      cur = cur.parentElement;
    }
    return '/' + parts.join('/');
  }
  function isVisible(el) {
    if (!el || el.nodeType !== 1) return false;
    const st = getComputedStyle(el);
    if (st.display === 'none' || st.visibility === 'hidden' || Number(st.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }
  function scopeOf(node) {
    if (!node || !node.closest) return 'page';
    if (node.closest('.el-drawer')) return 'drawer';
    if (node.closest('.el-dialog, .el-message-box')) return 'dialog';
    if (node.closest('nav, aside, .el-aside, .el-menu, [class*="sidebar"], [class*="side-menu"], [class*="nav-menu"], [class*="menu-wrap"]')) return 'nav';
    if (node.closest('.el-table')) return 'table';
    if (node.closest('.el-form-item')) return 'form_item';
    return 'page';
  }
  function scopePrefix(kind) {
    // Do NOT use [last()] — DOM last is often a leftover hidden dialog
    if (kind === 'drawer') return "//div[contains(@class,'el-drawer')]";
    if (kind === 'dialog') return "//div[contains(@class,'el-dialog') or contains(@class,'el-message-box')]";
    return '';
  }
  function scopedXPath(local, kind) {
    const loc = String(local || '').replace(/^\\/+/, '');
    if (!loc) return '';
    const prefix = scopePrefix(kind);
    if (prefix) return prefix + '//' + loc;
    return '//' + loc;
  }
  function withOccurrence(expr, occurrence) {
    const xp = String(expr || '').trim();
    if (!xp) return '';
    const n = Number(occurrence) || 0;
    if (n < 1) return xp;
    const body = xp.charAt(0) === '(' ? xp : '(' + xp + ')';
    return body + '[' + n + ']';
  }
  function cleanVisibleText(node) {
    if (!node) return '';
    const fromAttr = (node.getAttribute && (
      node.getAttribute('aria-label') ||
      node.getAttribute('title') ||
      node.getAttribute('data-name') ||
      node.getAttribute('data-menu') ||
      ''
    )) || '';
    if (fromAttr.trim()) return normalizeControlText(fromAttr);
    try {
      const clone = node.cloneNode(true);
      const kill = clone.querySelectorAll(
        '.el-badge, .el-badge__content, [class*="badge"], .el-icon, i[class*="icon"], .el-submenu__icon-arrow, .popper__arrow, sup, sub'
      );
      for (let i = 0; i < kill.length; i++) {
        if (kill[i] && kill[i].parentNode) kill[i].parentNode.removeChild(kill[i]);
      }
      return normalizeControlText(clone.innerText || clone.textContent || '');
    } catch (e) {
      return normalizeControlText(node.innerText || node.textContent || '');
    }
  }
  function normalizeTargetRoot(node) {
    if (!node || node.nodeType !== 1) return null;
    if (!node.closest) return node;
    const close = node.closest(
      '.el-dialog__headerbtn, .el-drawer__close-btn, .el-message-box__headerbtn, .el-notification__closeBtn, .el-dialog__close'
    );
    if (close) return close;
    const menu = node.closest(
      '.menu-item, .submenu-item, .el-menu-item, .el-submenu__title, .el-dropdown-menu__item, [role="menuitem"]'
    );
    if (menu) return menu;
    const navRoot = node.closest(
      'aside, .el-aside, nav, .el-menu, [class*="sidebar"], [class*="side-menu"], [class*="nav-menu"], [class*="menu-wrap"]'
    );
    if (navRoot) {
      const item = node.closest('li, a, button, [role="menuitem"]');
      if (item) {
        const cls = String(item.className || '');
        for (let i = 0; i < MENU_CLASS_TOKENS.length; i++) {
          if (hasClassToken(cls, MENU_CLASS_TOKENS[i])) return item;
        }
        if (item.getAttribute && item.getAttribute('role') === 'menuitem') return item;
        if ((item.tagName || '').toLowerCase() === 'li' || (item.tagName || '').toLowerCase() === 'a') return item;
      }
    }
    const tab = node.closest('.el-tabs__item, [role="tab"]');
    if (tab) return tab;
    const rowBtn = node.closest('.el-table__body .el-button, .el-table__body button, .el-table__body a');
    if (rowBtn) return rowBtn;
    const tableRadio = node.closest(
      '.el-table__body .el-radio, .el-table__body .el-radio-button, .el-table__row .el-radio, .el-table__fixed .el-radio'
    );
    if (tableRadio) return tableRadio;
    const tree = node.closest('.el-tree-node__content');
    if (tree) return tree;
    // Custom tsscTree / popover tree: host is the clickable trigger, not the search input inside popover
    const formItemForTree = node.closest('.el-form-item');
    if (formItemForTree && formItemForTree.querySelector('.tsscTree, .tree-popover, .el-tree-select, .el-cascader')) {
      const treeTrigger = formItemForTree.querySelector(
        '.el-tree-select, .el-cascader, span.my-popover, .my-popover'
      );
      if (treeTrigger) return treeTrigger;
      const displayInputs = formItemForTree.querySelectorAll('input.el-input__inner, input:not([type="hidden"])');
      for (let i = 0; i < displayInputs.length; i++) {
        if (!displayInputs[i].closest('.el-popover, .tree-popover')) return displayInputs[i];
      }
    }
    const formWidget = node.closest(
      '.el-select, .el-date-editor, .el-cascader, .el-tree-select, .el-radio-group, .el-checkbox-group, .tsscdatepicker'
    );
    if (formWidget) return formWidget;
    const formCtrl = node.closest('.el-input, .el-textarea');
    if (formCtrl) {
      const inner = formCtrl.querySelector('input:not([type="hidden"]), textarea, .el-input__inner, .el-textarea__inner');
      return inner || formCtrl;
    }
    const adj = node.closest('.el-form-item button, .el-form-item .el-button, .el-form-item a');
    if (adj) return adj;
    const btn = node.closest('button, a.el-button, a[role="button"], .el-button, a[href]');
    if (btn) return btn;
    const icon = node.closest('.el-tooltip[class*="el-icon"], [class*="el-icon"][aria-label], [aria-label]');
    if (icon) return icon;
    return node;
  }
  function detectTargetKind(node) {
    if (!node || !node.closest) return 'generic';
    if (node.closest('.el-notification__closeBtn')) return 'notification_close';
    if (node.closest('.el-dialog__headerbtn, .el-drawer__close-btn, .el-message-box__headerbtn, .el-dialog__close')) return 'dialog_close';
    if (node.closest('.el-tabs__item, [role="tab"]')) return 'tab';
    if (node.closest('.el-table__body .el-radio, .el-table__row .el-radio, .el-table__fixed .el-radio')) return 'table_row_radio';
    if (node.closest('.el-table__body .el-button, .el-table__body button, .el-table__body a')) return 'table_row_button';
    if (node.closest('.el-tree-node__content')) return 'tree_node';
    if (node.closest('.menu-item, .submenu-item, .el-menu-item, .el-submenu__title, .el-dropdown-menu__item, [role="menuitem"]')) {
      return node.closest('.el-submenu__title') ? 'submenu' : 'menu';
    }
    const navRoot = node.closest('aside, .el-aside, nav, .el-menu, [class*="sidebar"], [class*="side-menu"], [class*="nav-menu"], [class*="menu-wrap"]');
    if (navRoot && node.closest('li, a')) return 'menu';
    if (node.closest('.el-form-item') && node.closest('button, .el-button')) return 'adjacent_button';
    if (node.closest('.el-date-editor')) return 'form_date';
    if (node.closest('.el-select')) return 'form_select';
    if (node.closest('.el-radio-group')) return 'form_radio';
    if (node.closest('.el-tree-select, .el-cascader')) return 'form_tree_select';
    const fiTree = node.closest('.el-form-item');
    if (fiTree && fiTree.querySelector('.tsscTree, .tree-popover, .el-tree-select, .el-cascader')) {
      return 'form_tree_select';
    }
    if (node.closest('.el-form-item') && (node.matches('input, textarea') || node.closest('.el-input, .el-textarea'))) return 'form_input';
    if ((node.getAttribute && (node.getAttribute('aria-label') || node.getAttribute('title'))) && !(node.innerText || '').trim()) return 'icon';
    {
      const clsI = String(node.className || '');
      const tagI = (node.tagName || '').toLowerCase();
      if (extractElIconClass(clsI) && (hasClassToken(clsI, 'el-tooltip') || tagI === 'a' || tagI === 'i')) return 'icon';
    }
    const tagL = (node.tagName || '').toLowerCase();
    const cls = String(node.className || '');
    if (tagL === 'button' || hasClassToken(cls, 'el-button')) return 'button';
    if (tagL === 'a') return 'link';
    return 'generic';
  }
  function formFieldXpathSmartOf(node, formLabel) {
    const lbl = normalizeFormLabel(formLabel);
    const scope = scopeOf(node);
    const scopeKind = (scope === 'drawer' || scope === 'dialog') ? scope : '';
    if ((!lbl || !node) && node) {
      const ph = normalizeControlText((node.getAttribute && node.getAttribute('placeholder')) || '');
      if (ph) {
        const tagL0 = (node.tagName || '').toLowerCase();
        const leaf0 = tagL0 === 'textarea' ? 'textarea' : 'input';
        return scopedXPath(leaf0 + '[contains(@placeholder,' + xpathLiteral(ph) + ')]', scopeKind);
      }
    }
    if (!lbl || !node) return '';
    const lit = xpathLiteral(lbl);
    const itemPred = "div[contains(@class,'el-form-item')][.//label[contains(normalize-space(.)," + lit + ")]]";
    const tagL = (node.tagName || '').toLowerCase();
    const cls = String(node.className || '');
    let leaf = 'input';
    if (tagL === 'textarea' || /(^| )el-textarea( |$)/.test(cls)) leaf = 'textarea';
    else if (node.closest && node.closest('.el-select')) leaf = "div[contains(@class,'el-select')]";
    else if (node.closest && node.closest('.el-date-editor, .tsscdatepicker')) leaf = "div[contains(@class,'el-date-editor')]";
    else if (node.closest && node.closest('.el-radio-group')) leaf = "div[contains(@class,'el-radio-group')]";
    else if (node.closest && node.closest('.el-checkbox-group')) leaf = "div[contains(@class,'el-checkbox-group')]";
    else if (node.closest && node.closest('.el-cascader')) leaf = "div[contains(@class,'el-cascader')]";
    else if (node.closest && node.closest('.el-tree-select')) leaf = "div[contains(@class,'el-tree-select') or contains(@class,'tsscmultitree')]";
    else if (node.closest && node.closest('.el-form-item')
      && node.closest('.el-form-item').querySelector('.tsscTree, .tree-popover')) {
      leaf = "span[contains(@class,'my-popover')]";
    }
    else if (tagL === 'input' || /(^| )el-input__inner( |$)/.test(cls)) leaf = 'input';
    else if (tagL === 'button' || /(^| )el-button( |$)/.test(cls)) leaf = 'button';
    else leaf = tagL || 'input';
    return scopedXPath(itemPred + '//' + leaf, scopeKind);
  }
  function menuXpathSmartOf(node, text) {
    const t = normalizeControlText(text);
    if (!t || !node) return '';
    const cls = String(node.className || '');
    const tokens = [];
    for (let i = 0; i < MENU_CLASS_TOKENS.length; i++) {
      if (hasClassToken(cls, MENU_CLASS_TOKENS[i])) tokens.push(MENU_CLASS_TOKENS[i]);
    }
    const lit = xpathLiteral(t);
    let roleOrClass = "[@role='menuitem']";
    if (tokens.length) {
      const ors = tokens.map(function (tok) { return classTokenPred(tok); }).join(' or ');
      roleOrClass = '[' + ors + " or @role='menuitem']";
    }
    // Separate predicates — (self::a or self::b)[pred] is invalid XPath 1.0.
    const local = '*[self::li or self::a or self::div or self::span]' + roleOrClass + '[normalize-space()=' + lit + ']';
    const scope = scopeOf(node);
    return scopedXPath(local, scope === 'drawer' || scope === 'dialog' ? scope : '');
  }
  function evalXpathAll(xp) {
    let s = String(xp || '');
    if (!s) return [];
    try {
      const snap = document.evaluate(s, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
      const out = [];
      for (let i = 0; i < snap.snapshotLength; i++) out.push(snap.snapshotItem(i));
      return out;
    } catch (e) {
      return [];
    }
  }
  function pinOccurrence(expr, host) {
    if (!expr || !host) return { xpath: expr || '', occurrence: 0, verified: false };
    const nodes = evalXpathAll(expr);
    if (!nodes.length) return { xpath: '', occurrence: 0, verified: false };
    let idx = -1;
    for (let i = 0; i < nodes.length; i++) {
      if (nodes[i] === host) { idx = i; break; }
    }
    if (idx < 0) return { xpath: '', occurrence: 0, verified: false };
    if (nodes.length === 1) return { xpath: expr, occurrence: 0, verified: true };
    return { xpath: withOccurrence(expr, idx + 1), occurrence: idx + 1, verified: true };
  }
  function stableAttrXPath(node) {
    if (!node || !node.getAttribute) return '';
    const tagL = (node.tagName || '*').toLowerCase();
    const names = ['data-testid','data-test','data-qa','data-name','data-menu','data-id','id','name','aria-label','title'];
    const scope = scopeOf(node);
    const scopeKind = (scope === 'drawer' || scope === 'dialog') ? scope : '';
    for (let i = 0; i < names.length; i++) {
      const name = names[i];
      const v = String(node.getAttribute(name) || '').trim();
      if (!v || v.length > 80) continue;
      if ((name === 'id' || name === 'data-id') && isGeneratedId(v)) continue;
      if (name === 'title' && (v.length > 40 || /^https?:/i.test(v))) continue;
      return scopedXPath(tagL + '[@' + name + '=' + xpathLiteral(v) + ']', scopeKind);
    }
    return '';
  }
  function xpathSmartOf(node, text, formLabel, targetKindHint) {
    if (!node) return '';
    const kind = targetKindHint || detectTargetKind(node);
    const scope = scopeOf(node);
    const scopeKind = (scope === 'drawer' || scope === 'dialog') ? scope : '';
    if (kind === 'dialog_close' || kind === 'notification_close') {
      if (kind === 'notification_close') {
        return "//div[" + classTokenPred('el-notification') + "]//*[ " + classTokenPred('el-notification__closeBtn') + "]";
      }
      return scopedXPath(
        "*[" + classTokenPred('el-dialog__headerbtn') + " or " + classTokenPred('el-drawer__close-btn')
          + " or " + classTokenPred('el-message-box__headerbtn') + " or " + classTokenPred('el-dialog__close') + "]",
        scopeKind || 'dialog'
      );
    }
    if (formLabel && String(kind).indexOf('form_') === 0) {
      const formXp = formFieldXpathSmartOf(node, formLabel);
      if (formXp) return formXp;
    }
    if (formLabel && (kind === 'form_input' || kind === 'form_date' || kind === 'form_select' || kind === 'form_radio' || kind === 'form_tree_select')) {
      const formXp = formFieldXpathSmartOf(node, formLabel);
      if (formXp) return formXp;
    }
    // Tabs: prefer visible text over minted tab-<timestamp> ids
    if (kind === 'tab') {
      const t = normalizeControlText(text);
      if (!t) return '';
      return scopedXPath(
        "*[(" + classTokenPred('el-tabs__item') + " or @role='tab') and normalize-space()=" + xpathLiteral(t) + "]",
        scopeKind
      );
    }
    const attrXp = stableAttrXPath(node);
    if (attrXp && kind !== 'form_input' && kind !== 'form_date' && kind !== 'form_select' && kind !== 'tab') return attrXp;
    if (kind === 'menu' || kind === 'submenu') return menuXpathSmartOf(node, text);
    if (kind === 'table_row_button') {
      const rowEl = node.closest && node.closest('tr, .el-table__row');
      let rowT = '';
      if (rowEl) {
        const cells = rowEl.querySelectorAll('td, .el-table__cell');
        for (let i = 0; i < cells.length; i++) {
          const cell = cells[i];
          const ct = normalizeControlText(cell.innerText || cell.textContent || '');
          const hasSelect = !!cell.querySelector('.el-checkbox, .el-radio, input[type="checkbox"], input[type="radio"]');
          if (hasSelect && !ct) continue;
          if (ct && ct.length >= 2 && ct.length <= 48) { rowT = ct; break; }
        }
      }
      const btnT = normalizeControlText(text) || cleanVisibleText(node);
      if (rowT && btnT) {
        return scopedXPath(
          "tr[.//*[normalize-space()=" + xpathLiteral(rowT) + "]]"
            + "//*[self::button or self::a or " + classTokenPred('el-button') + "][normalize-space()=" + xpathLiteral(btnT) + "]",
          scopeKind
        );
      }
      if (btnT) {
        return scopedXPath(
          "*[self::button or self::a or " + classTokenPred('el-button') + "][normalize-space()=" + xpathLiteral(btnT) + "]",
          scopeKind
        );
      }
    }
    if (kind === 'table_row_radio') {
      const rowEl = node.closest && node.closest('tr, .el-table__row');
      let rowT = '';
      if (rowEl) {
        const cells = rowEl.querySelectorAll('td, .el-table__cell');
        for (let i = 0; i < cells.length; i++) {
          const cell = cells[i];
          const ct = normalizeControlText(cell.innerText || cell.textContent || '');
          const hasSelect = !!cell.querySelector('.el-checkbox, .el-radio, input[type="checkbox"], input[type="radio"]');
          if (hasSelect && !ct) continue;
          if (ct && ct.length >= 2 && ct.length <= 48) { rowT = ct; break; }
        }
      }
      if (rowT) {
        return scopedXPath(
          "tr[.//*[normalize-space()=" + xpathLiteral(rowT) + "]]"
            + "//*[" + classTokenPred('el-radio') + " or " + classTokenPred('el-radio-button') + " or " + classTokenPred('el-checkbox') + "]",
          scopeKind
        );
      }
    }
    if (kind === 'icon') {
      const iconTok = extractElIconClass(String(node.className || ''));
      if (iconTok) {
        return scopedXPath("a[contains(@class," + xpathLiteral(iconTok) + ")]", scopeKind);
      }
      const t = normalizeControlText(text);
      if (!t) return '';
      return scopedXPath("*[@aria-label=" + xpathLiteral(t) + " or @title=" + xpathLiteral(t) + "]", scopeKind);
    }
    if (kind === 'tree_node') {
      const base = stripVolatileTreeText(text) || stripVolatileTreeText(cleanVisibleText(node));
      if (!base) return '';
      let local = "*[" + classTokenPred('el-tree-node__content') + " and starts-with(normalize-space()," + xpathLiteral(base) + ")]";
      // Parent tree-node for duplicate base names
      try {
        const treeNode = node.closest && node.closest('.el-tree-node');
        const parentNode = treeNode && treeNode.parentElement && treeNode.parentElement.closest
          ? treeNode.parentElement.closest('.el-tree-node')
          : null;
        if (parentNode) {
          const pContent = parentNode.querySelector(':scope > .el-tree-node__content');
          const pb = stripVolatileTreeText(pContent ? (pContent.innerText || pContent.textContent) : '');
          if (pb) {
            local = "*[" + classTokenPred('el-tree-node__content') + " and starts-with(normalize-space()," + xpathLiteral(pb) + ")]"
              + "/following-sibling::*[contains(@class,'el-tree-node__children')]"
              + "//" + local;
          }
        }
      } catch (e) { /* ignore */ }
      return scopedXPath(local, scopeKind);
    }
    if (!formLabel) {
      const ph = normalizeControlText((node.getAttribute && node.getAttribute('placeholder')) || '');
      if (ph && (kind === 'form_input' || kind === 'generic' || !kind)) {
        const tagLph = (node.tagName || '').toLowerCase();
        const leafPh = tagLph === 'textarea' ? 'textarea' : 'input';
        return scopedXPath(leafPh + '[contains(@placeholder,' + xpathLiteral(ph) + ')]', scopeKind);
      }
    }
    if (formLabel) {
      const formXp = formFieldXpathSmartOf(node, formLabel);
      if (formXp) return formXp;
    }
    const t = normalizeControlText(text);
    if (!t) return '';
    const tagL = (node.tagName || '').toLowerCase();
    const cls = String(node.className || '');
    const clickable = tagL === 'button' || tagL === 'a' || /(^| )el-button( |$)/.test(cls) || kind === 'button' || kind === 'link' || kind === 'adjacent_button';
    if (!clickable) {
      if (kind === 'menu' || kind === 'submenu') return menuXpathSmartOf(node, t);
      return '';
    }
    const lit = xpathLiteral(t);
    const local = tagL === 'a'
      ? 'a[normalize-space()=' + lit + ']'
      : (/(^| )el-button( |$)/.test(cls) && tagL !== 'button'
        ? '*[' + classTokenPred('el-button') + ' and normalize-space()=' + lit + ']'
        : 'button[normalize-space()=' + lit + ']');
    return scopedXPath(local, scopeKind);
  }
  function collectAttrs(el) {
    const a = {};
    if (!el || !el.attributes) return a;
    for (let i = 0; i < el.attributes.length; i++) {
      const at = el.attributes[i];
      if (!at || !at.name || !at.value) continue;
      if (/^(value|password|pwd|token|authorization|cookie)$/i.test(at.name)) continue;
      if (at.value.length > 120) continue;
      a[at.name] = at.value;
    }
    return a;
  }
  function buildLocatorSnap(node, text, xpathFull, formLabel, opts) {
    opts = opts || {};
    const host = normalizeTargetRoot(node) || node;
    const kind = opts.targetKind || detectTargetKind(host);
    const t = normalizeControlText(text) || cleanVisibleText(host);
    const abs = String(xpathFull || absXPath(host) || '');
    const formLbl = normalizeFormLabel(formLabel || '');
    let smart = xpathSmartOf(host, t, formLbl, kind);
    let occurrence = 0;
    let verified = false;
    if (smart) {
      const pinned = pinOccurrence(smart, host);
      smart = pinned.xpath;
      occurrence = pinned.occurrence;
      verified = pinned.verified;
    }
    const css = cssOfSimple(host);
    const primary = (smart && verified) ? smart : (abs || smart);
    const strategy = (smart && verified) ? 'xpath_smart' : 'xpath_full';
    const candidates = [];
    if (smart) candidates.push({ type: 'xpath_smart', value: smart });
    if (abs) candidates.push({ type: 'xpath_full', value: abs });
    if (css) candidates.push({ type: 'css', value: css });
    let parentText = '';
    if (kind === 'tree_node') {
      try {
        const treeNode = host.closest && host.closest('.el-tree-node');
        const parentNode = treeNode && treeNode.parentElement && treeNode.parentElement.closest
          ? treeNode.parentElement.closest('.el-tree-node')
          : null;
        if (parentNode) {
          const pContent = parentNode.querySelector(':scope > .el-tree-node__content');
          parentText = stripVolatileTreeText(pContent ? (pContent.innerText || pContent.textContent) : '');
        }
      } catch (e) { parentText = ''; }
    }
    const iconClass = kind === 'icon' ? extractElIconClass(String(host.className || '')) : '';
    const placeholder = (host.getAttribute && host.getAttribute('placeholder')) || '';
    return {
      xpath: primary,
      xpath_smart: (smart && verified) ? smart : (smart || ''),
      xpath_full: abs,
      xpath_abs: abs,
      cssSelector: css,
      text: t,
      formLabel: formLbl,
      tag: (host.tagName || '').toLowerCase(),
      attributes: collectAttrs(host),
      candidates: candidates,
      target_kind: kind,
      parent_text: parentText || undefined,
      icon_class: iconClass || undefined,
      placeholder: placeholder || undefined,
      locator_scope: scopeOf(host),
      locator_occurrence: occurrence || undefined,
      locator_verified: verified,
      locator_strategy: strategy,
      locator_fallback_reason: strategy === 'xpath_full'
        ? (smart ? 'smart_missed_host' : (t || formLbl ? 'no_smart_predicate' : 'empty_anchor_text'))
        : undefined,
    };
  }
`;
