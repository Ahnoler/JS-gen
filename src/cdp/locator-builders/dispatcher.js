/**
 * locator-builders/dispatcher.js — extracted from locator-candidates.js.
 * Public API re-exported by src/cdp/locator-candidates.js.
 */
import { buildAdjacentButtonXPathSmart } from './controls.js';
import { buildCloseXPathSmart } from './controls.js';
import { buildFormFieldXPathSmart } from './controls.js';
import { buildIconXPathSmart } from './controls.js';
import { buildMenuXPathSmart } from './controls.js';
import { buildPlaceholderXPathSmart } from './controls.js';
import { buildStableAttrXPathSmart } from './controls.js';
import { buildTabXPathSmart } from './controls.js';
import { buildTableRowButtonXPathSmart } from './controls.js';
import { buildTableRowRadioXPathSmart } from './controls.js';
import { buildTreeNodeXPathSmart } from './controls.js';
import { classTokenPred } from './text.js';
import { detectContainerKind, scopedXPath } from './scope.js';
import { isMenuLike } from './controls.js';
import { normalizeControlText } from './text.js';
import { normalizeFormLabel } from './text.js';
import { withOccurrence } from './scope.js';
import { xpathLiteral } from './text.js';

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
