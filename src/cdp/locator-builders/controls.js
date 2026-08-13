/**
 * locator-builders/controls.js — extracted from locator-candidates.js.
 * Public API re-exported by src/cdp/locator-candidates.js.
 */
import { MENU_CLASS_TOKENS } from './text.js';
import { classTokenPred } from './text.js';
import { detectContainerKind, scopedXPath, withOccurrence } from './scope.js';
import { extractElIconClass } from './text.js';
import { hasClassToken } from './text.js';
import { isGeneratedId } from './text.js';
import { isGeneratedName } from './text.js';
import { normalizeControlText } from './text.js';
import { normalizeFormLabel } from './text.js';
import { stripVolatileTreeText } from './text.js';
import { xpathLiteral } from './text.js';

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
 * @param {{ label?: string, tag?: string, className?: string, xpathFull?: string, container?: string, occurrence?: number, targetKind?: string }} opts
 */
export function buildFormFieldXPathSmart({
  label = '',
  tag = '',
  className = '',
  xpathFull = '',
  container = '',
  occurrence = 0,
  targetKind = '',
} = {}) {
  const lbl = normalizeFormLabel(label);
  if (!lbl) return '';

  const lit = xpathLiteral(lbl);
  // Exact label (+ * / colon suffixes). Avoid contains() prefix collisions.
  const itemPred =
    `div[contains(@class,'el-form-item')]`
    + `[.//label[`
    + `normalize-space(.)=${lit}`
    + ` or normalize-space(.)=concat(${lit}, ':')`
    + ` or normalize-space(.)=concat(${lit}, '：')`
    + ` or normalize-space(.)=concat(${lit}, '*')`
    + ` or normalize-space(.)=concat('*', ${lit})`
    + ` or normalize-space(.)=concat('*', ${lit}, ':')`
    + ` or normalize-space(.)=concat('*', ${lit}, '：')`
    + `]]`;

  const tagL = String(tag || '').toLowerCase();
  const cls = String(className || '');
  const full = String(xpathFull || '');
  const tk = String(targetKind || '').trim();
  let leaf = 'input';
  if (tagL === 'textarea' || /el-textarea/i.test(cls) || /textarea/i.test(full)) {
    leaf = 'textarea';
  } else if (
    tk === 'form_select'
    || /el-select/i.test(cls)
    || /el-select/i.test(full)
    || (tagL === 'div' && /el-select/i.test(cls))
  ) {
    leaf = "div[contains(@class,'el-select')]";
  } else if (
    tk === 'form_date'
    || /el-date-editor|tsscdatepicker/i.test(cls)
    || /el-date-editor/i.test(full)
  ) {
    leaf = "div[contains(@class,'el-date-editor')]";
  } else if (
    tk === 'form_radio'
    || /el-radio-group/i.test(cls)
    || /el-radio-group/i.test(full)
  ) {
    leaf = "div[contains(@class,'el-radio-group')]";
  } else if (
    tk === 'form_checkbox'
    || /el-checkbox-group/i.test(cls)
    || /el-checkbox-group/i.test(full)
  ) {
    leaf = "div[contains(@class,'el-checkbox-group')]";
  } else if (/el-cascader/i.test(cls) || /el-cascader/i.test(full)) {
    leaf = "div[contains(@class,'el-cascader')]";
  } else if (
    tk === 'form_tree_select'
    || /el-tree-select|tsscmultitree/i.test(cls)
    || /el-tree-select|tsscmultitree/i.test(full)
  ) {
    leaf = "div[contains(@class,'el-tree-select') or contains(@class,'tsscmultitree')]";
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
  let kind = detectContainerKind(xpathFull, className, container);
  if (targetKind === 'notification_close') {
    const local =
      `div[${classTokenPred('el-notification')}]`
      + `//*[${classTokenPred('el-notification__closeBtn')}]`;
    return withOccurrence(`//${local}`, occurrence);
  }
  // Icon-only close (i.el-dialog__close) is ambiguous — Element UI drawers reuse
  // that class. Prefer overlay scope so replay hits visible drawer closes too.
  if (!kind) kind = 'overlay';
  const local =
    `*[${classTokenPred('el-dialog__headerbtn')} or ${classTokenPred('el-drawer__close-btn')}`
    + ` or ${classTokenPred('el-message-box__headerbtn')} or ${classTokenPred('el-dialog__close')}]`;
  return withOccurrence(scopedXPath(local, kind), occurrence);
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
  // Exact form label (same as buildFormFieldXPathSmart) — adjacent buttons sit
  // under the same form-item; contains() would bind the wrong item for prefixes.
  const itemPred =
    `div[contains(@class,'el-form-item')]`
    + `[.//label[`
    + `normalize-space(.)=${lit}`
    + ` or normalize-space(.)=concat(${lit}, ':')`
    + ` or normalize-space(.)=concat(${lit}, '：')`
    + ` or normalize-space(.)=concat(${lit}, '*')`
    + ` or normalize-space(.)=concat('*', ${lit})`
    + ` or normalize-space(.)=concat('*', ${lit}, ':')`
    + ` or normalize-space(.)=concat('*', ${lit}, '：')`
    + `]]`;
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
