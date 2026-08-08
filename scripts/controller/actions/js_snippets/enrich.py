"""
JS snippet constants: JS_ENRICH_CLICK_LOCATOR (extracted from _js_snippets.py).
Re-exported by scripts/actions/_js_snippets.py for backward compat.
"""
from scripts.actions._locator_helpers_js import PAGE_LOCATOR_HELPERS

JS_ENRICH_CLICK_LOCATOR = '''([xpath, text, tagHint, targetKindHint, formLabelHint]) => {
''' + PAGE_LOCATOR_HELPERS + '''
  function resolveByXpath(xp) {
    if (!xp) return null;
    let s = String(xp);
    if (s && !s.startsWith('/') && !s.startsWith('(')) s = '/' + s;
    try {
      return document.evaluate(s, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
    } catch (e) {
      return null;
    }
  }
  function findByText(want, tagHint) {
    want = normalizeControlText(want);
    if (!want) return null;
    const drawers = [...document.querySelectorAll('.el-drawer')].filter(isVisible);
    const dialogs = [...document.querySelectorAll('.el-dialog, .el-message-box')].filter(isVisible);
    const scopes = [];
    if (drawers.length) scopes.push(drawers[drawers.length - 1]);
    if (dialogs.length) scopes.push(dialogs[dialogs.length - 1]);
    scopes.push(document);
    const sel = 'button, a, .el-button, .el-menu-item, .el-submenu__title, .el-dropdown-menu__item, [role="menuitem"], .el-tabs__item, [role="tab"], .el-tree-node__content, [aria-label], [title]';
    for (const scope of scopes) {
      const hits = [...scope.querySelectorAll(sel)].filter(isVisible).filter((el) => {
        const t = cleanVisibleText(el);
        return t === want || t.includes(want);
      });
      if (hits.length) {
        if (tagHint) {
          const th = String(tagHint).toLowerCase();
          const tagged = hits.filter((el) => (el.tagName || '').toLowerCase() === th);
          if (tagged.length) return tagged[tagged.length - 1];
        }
        return hits[hits.length - 1];
      }
    }
    return null;
  }

  let el = resolveByXpath(xpath);
  if (el) el = normalizeTargetRoot(el) || el;
  if (!el) el = findByText(text, tagHint);
  if (el) el = normalizeTargetRoot(el) || el;
  if (!el) return null;

  const formLbl = normalizeFormLabel(formLabelHint || '');
  const kindHint = String(targetKindHint || '').trim();
  const t = normalizeControlText(text) || cleanVisibleText(el);
  const abs = absXPath(el);
  const loc = buildLocatorSnap(el, t, abs, formLbl, { targetKind: kindHint || undefined });
  return {
    tag_name: loc.tag || (el.tagName || '').toLowerCase(),
    xpath: loc.xpath || abs,
    xpath_smart: loc.xpath_smart || '',
    xpath_full: loc.xpath_full || abs,
    xpath_abs: abs,
    css_selector: loc.cssSelector || '',
    text: loc.text || t,
    formLabel: loc.formLabel || formLbl,
    attributes: loc.attributes || {},
    candidates: loc.candidates || [],
    target_kind: loc.target_kind,
    locator_scope: loc.locator_scope,
    locator_occurrence: loc.locator_occurrence,
    locator_verified: loc.locator_verified,
    locator_strategy: loc.locator_strategy,
    locator_fallback_reason: loc.locator_fallback_reason,
  };
}'''

# ── Icon buttons (el-tooltip + aria-describedby → tooltip text) ──────────────
# Shared helpers concatenated into stamp / collect / click snippets.

