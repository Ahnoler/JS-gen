"""
JS snippet constants: JS_ENRICH_CLICK_LOCATOR (extracted from _js_snippets.py).
Re-exported by scripts/controller/actions/_js_snippets.py for backward compat.
"""
from ._locator_helpers_js import PAGE_LOCATOR_HELPERS

JS_ENRICH_CLICK_LOCATOR = '''([xpath, text, tagHint, targetKindHint, formLabelHint]) => {
''' + PAGE_LOCATOR_HELPERS + '''
  function resolveXpathAny(xp) {
    if (!xp) return null;
    let s = String(xp);
    if (s && !s.startsWith('/') && !s.startsWith('(')) s = '/' + s;
    // Try the expression as-is, then with leading-slash normalization and /html root prefix.
    const candidates = [s];
    if (s.charAt(0) === '/' && s.charAt(1) !== '/' && s.indexOf('/html') !== 0) {
      candidates.push('/' + s);
      candidates.push('/html' + s);
    }
    for (let i = 0; i < candidates.length; i++) {
      try {
        const n = document.evaluate(candidates[i], document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
        if (n) return n;
      } catch (e) { /* try next candidate */ }
    }
    return null;
  }
  function resolveByXpath(xp) {
    return resolveXpathAny(xp);
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
  const reg = assignRegion(el);
  // Unique-key row text for table-row controls (same priority as buildLocatorSnap
  // table_row_button/radio): prefer a customer-number (14-18 digits) or unified
  // social-credit code (18 uppercase alphanumerics) so same-named rows disambiguate.
  let rowText = '';
  const tk = String(loc.target_kind || kindHint || '');
  if (tk === 'table_row_button' || tk === 'table_row_radio') {
    const rowEl = el.closest && el.closest('tr, .el-table__row');
    if (rowEl) {
      const cells = rowEl.querySelectorAll('td, .el-table__cell');
      for (let i = 0; i < cells.length; i++) {
        const ct = normalizeControlText(cells[i].innerText || cells[i].textContent || '');
        if (ct && (/^\\d{14,18}$/.test(ct) || /^[0-9A-Z]{18}$/.test(ct))) { rowText = ct; break; }
      }
      if (!rowText) {
        for (let i = 0; i < cells.length; i++) {
          const cell = cells[i];
          const ct = normalizeControlText(cell.innerText || cell.textContent || '');
          const hasSelect = !!cell.querySelector('.el-checkbox, .el-radio, input[type="checkbox"], input[type="radio"]');
          if (hasSelect && !ct) continue;
          if (ct && ct.length >= 2 && ct.length <= 48) { rowText = ct; break; }
        }
      }
    }
  }
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
    attr: loc.attr || undefined,
    candidates: loc.candidates || [],
    target_kind: loc.target_kind,
    row_text: rowText || '',
    region_id: reg.region_id || '',
    region_label: reg.region_label || '',
    layers: Array.isArray(reg.layers) ? reg.layers : [],
    bbox: stepBBoxOf(el),
    page_bbox: documentBBoxOf(el),
    locator_scope: loc.locator_scope,
    locator_occurrence: loc.locator_occurrence,
    locator_verified: loc.locator_verified,
    locator_strategy: loc.locator_strategy,
    locator_fallback_reason: loc.locator_fallback_reason,
  };
}'''

# ── Icon buttons (el-tooltip + aria-describedby → tooltip text) ──────────────
# Shared helpers concatenated into stamp / collect / click snippets.

