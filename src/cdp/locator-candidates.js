/**
 * Stable locator helpers for Element UI controls (canonical Node builders).
 *
 * Primary: xpath_smart (relative / text/label/attr-anchored)
 * Fallback: xpath_full (absolute) + locator_strategy / locator_fallback_reason
 *
 * Keep PAGE_LOCATOR_HELPERS in sync — injected into CDP Runtime.evaluate.
 *
 * Implementation split into ./locator-builders/*.js (text/scope/controls/
 * dispatcher/candidates) and ./page-locator-helpers.js; this file re-exports
 * the full public API so existing consumers are unchanged.
 */
export {
  MENU_CLASS_TOKENS,
  xpathLiteral,
  normalizeControlText,
  normalizeFormLabel,
  stripVolatileTreeText,
  extractElIconClass,
  classTokenPred,
  hasClassToken,
  isGeneratedId,
  isGeneratedName,
} from './locator-builders/text.js';
export { detectContainerKind, withOccurrence } from './locator-builders/scope.js';
export {
  buildStableAttrXPathSmart,
  buildFormFieldXPathSmart,
  buildMenuXPathSmart,
  buildIconXPathSmart,
  buildTabXPathSmart,
  buildTableRowButtonXPathSmart,
  buildTableRowRadioXPathSmart,
  buildCloseXPathSmart,
  buildAdjacentButtonXPathSmart,
  buildTreeNodeXPathSmart,
  buildPlaceholderXPathSmart,
  isMenuLike,
} from './locator-builders/controls.js';
export { buildXPathSmart } from './locator-builders/dispatcher.js';
export {
  buildCandidates,
  sanitizeAttributes,
  enrichLocatorFields,
} from './locator-builders/candidates.js';
export { PAGE_LOCATOR_HELPERS, JS_POLL_UTIL } from './page-locator-helpers.js';
