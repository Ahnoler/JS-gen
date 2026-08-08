/**
 * locator-builders/candidates.js — extracted from locator-candidates.js.
 * Public API re-exported by src/cdp/locator-candidates.js.
 */
import { buildXPathSmart } from './dispatcher.js';
import { detectContainerKind } from './scope.js';
import { normalizeControlText } from './text.js';
import { normalizeFormLabel } from './text.js';

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
