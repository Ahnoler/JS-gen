"""
JS snippet constants: JS_FIND_LABELED_SELECT, JS_FIND_VISIBLE_DROPDOWN, JS_SELECT_TRIGGER_BY_XPATH, JS_SELECT_VALUE_BY_XPATH (extracted from _js_snippets.py).
Re-exported by scripts/controller/actions/_js_snippets.py for backward compat.
"""
from .base import JS_FIELD_DISABLED
from ._locator_helpers_js import JS_POLL_UTIL

JS_FIND_LABELED_SELECT = '''([label, mode]) => {
    const isDisabled = ''' + JS_FIELD_DISABLED + ''';
    const getSelectedLabel = (formItem) => {
        const select = formItem.querySelector('.el-select');
        if (!select) return null;
        const trigger = select.querySelector('.el-input__inner');
        if (trigger) {
            // 1. DOM property value (most reliable after native setter)
            const v = (trigger.value || '').trim();
            if (v) return v;
            // 2. Attribute value — only trust if trigger.value is also non-empty.
            // When Vue/Element clears the model value it resets trigger.value to
            // '' but leaves the HTML attribute unchanged, causing stale reads.
            // So skip getAttribute('value') when the DOM property is empty.
            const av = (trigger.getAttribute('value') || '').trim();
            if (av && trigger.value !== '') return av;
            // 3. ARIA / title fallback
            const aria = (trigger.getAttribute('aria-label') || trigger.getAttribute('title') || '').trim();
            if (aria) return aria;
        }
        const tag = select.querySelector('.el-select__tags-text');
        if (tag) { const t = tag.textContent.trim(); if (t) return t; }
        const selItem = select.querySelector('.el-select-dropdown__item.is-selected');
        if (selItem) return selItem.textContent.trim();
        return null;
    };
    // Priority search: P0=dialog, P1=drawer, P2=document
    // ════════════════════════════════════════════════════════════════
    // Fix: container-level priority prevents cross-container field confusion.
    //
    // Problem:  When an el-drawer overlay has a field with the SAME label as
    // a field on the main page (e.g. "对私客户细分类型" appears both in the
    // drawer and on the main form), the old code searched all .el-form-item
    // elements at the document level and matched the main page's field first
    // (DOM order), ignoring the drawer's visible instance.
    //
    // Solution:  Three-tier priority search against containers:
    //   P0 — visible el-dialog
    //   P1 — visible el-drawer
    //   P2 — document (fallback)
    //
    // Note: el-drawer uses position:fixed or position:absolute depending on
    // the Element UI version; in either case offsetParent may be null (fixed)
    // or non-null (absolute). We use getBoundingClientRect as a robust check.
    // JS_GET_CONTAINER is left unchanged since it works for the fill path.
    const _isVisibleContainer = (el) => {
        if (el.offsetParent !== null) return true;
        const style = getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
    };
    const _containers = [];
    for (const d of document.querySelectorAll('.el-dialog'))
        if (_isVisibleContainer(d)) _containers.push(d);
    for (const d of document.querySelectorAll('.el-drawer'))
        if (_isVisibleContainer(d)) _containers.push(d);
    _containers.push(document);

    function _normFormLab(s) {
        return String(s || '').replace(/\s+/g, ' ').trim()
            .replace(/[：:*\s]+$/g, '').replace(/^[*\s]+/, '');
    }
    function _tryItems(items, label, mode) {
        // Exact normalized label first (strips Element UI * / colon). Pass-2
        // includes() alone wrongly preferred 国民经济部门类别 over 国民经济部门
        // when pass-1 raw equality failed on leading '*'.
        const wantN = _normFormLab(label);
        let exactItem = null;
        let includesItem = null;
        for (const item of items) {
            const lbl = item.querySelector('.el-form-item__label')?.textContent?.trim() || '';
            const labN = _normFormLab(lbl);
            if (wantN && labN === wantN) {
                exactItem = item;
                break;
            }
            if (wantN && !includesItem && labN && labN.includes(wantN)) includesItem = item;
        }
        const picked = exactItem || includesItem;
        if (!picked) return null;
        {
            const item = picked;
            const trigger = item.querySelector('.el-select .el-input__inner');
            if (!trigger && mode === 'trigger') return {skip: true, reason: 'no-select-found'};
            if (!trigger) return null;
            if (mode === 'check') {
                const cur = getSelectedLabel(item);
                if (cur) return {done: true, result: 'ok-already:' + cur};
                return {skip: true, reason: 'no-value'};
            }
            if (mode === 'trigger') {
                if (isDisabled(trigger, trigger, item)) return {skip: true, reason: 'disabled'};
                item.scrollIntoView({ block: 'center', behavior: 'instant' });
                trigger.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
                trigger.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
                trigger.click();
                window.__last_select_trigger = trigger;
                return {done: true, result: 'ok-triggered'};
            }
            if (mode === 'confirm') {
                const cur = getSelectedLabel(item);
                if (cur) return {done: true, result: 'ok-confirmed:' + cur};
                return {done: true, result: 'NOT-SELECTED'};
            }
            return {done: true, result: 'unknown-mode'};
        }
    }

    for (const c of _containers) {
        const items = c.querySelectorAll('.el-form-item');
        const r = _tryItems(items, label, mode);
        if (r) {
            if (r.done) return r.result;
            if (mode === 'check' && r.reason === 'no-value') {
                // P0/P1 container found the field but it's empty (not yet filled).
                // Return 'not-filled' immediately instead of falling through to
                // lower-priority containers (e.g. P2 document) that might have a
                // stale ok-already: value from a different instance of the same label.
                // Without this guard, the caller sees 'ok-already:一般农户' (from the
                // main page's filled select) and skips filling the drawer's empty one.
                return 'not-filled';
            }
            if (mode === 'trigger' && r.reason !== 'no-select-found') continue;
        }
    }
    const _allSelects = document.querySelectorAll('.el-select .el-input__inner');
    if (mode === 'check') {
        // Fallback after container form-item scan: only trust a select whose
        // placeholder (or its owning .el-form-item label) references the target
        // label. Without this guard the FIRST visible select — often the
        // pagination page-size "10条/页" — was reported as the field's value
        // ('ok-already:10条/页'), silently misdirecting the agent away from the
        // real field.
        // Prefer exact owner label, then includes / placeholder (prefix-safe).
        const wantN = _normFormLab(label);
        let exactSel = null;
        let includesSel = null;
        for (const sel of _allSelects) {
            if (sel.offsetParent === null) continue;
            const ph = sel.getAttribute('placeholder') || '';
            const ownerItem = sel.closest('.el-form-item');
            const ownerLabel = ownerItem ? (ownerItem.querySelector('.el-form-item__label')?.textContent || '').trim() : '';
            const ownerN = _normFormLab(ownerLabel);
            if (wantN && ownerN === wantN) { exactSel = sel; break; }
            if (!includesSel && ((wantN && ownerN && ownerN.includes(wantN)) || (ph && ph.includes(label)))) {
                includesSel = sel;
            }
        }
        const sel = exactSel || includesSel;
        if (sel) {
            const v = (sel.value || '').trim();
            if (v.length > 0) return 'ok-already:' + v;
            const t = (sel.textContent || '').trim();
            if (t.length > 0 && !t.includes('请选择')) return 'ok-already:' + t;
            return 'not-filled';
        }
        return 'not-found';
    }
    if (mode === 'trigger') {
        // Never click an unrelated select — that opens the wrong dropdown
        // (e.g. 国籍) and pollutes subsequent option-not-found lists.
        for (const sel of _allSelects) {
            const ph = sel.getAttribute('placeholder') || '';
            if (ph.includes(label) && !sel.disabled && sel.offsetParent !== null) {
                sel.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
                sel.click();
                window.__last_select_trigger = sel;
                return 'ok-triggered';
            }
        }
        return 'label-not-found';
    }
    if (mode === 'confirm') {
        for (const sel of _allSelects) {
            if (sel.offsetParent !== null) {
                const v = (sel.value || '').trim();
                if (v) return 'ok-confirmed:' + v;
            }
        }
        return 'NOT-SELECTED';
    }
    return 'unknown-mode';
}'''


JS_FIND_VISIBLE_DROPDOWN = '''(() => {
    const dropdowns = document.querySelectorAll('.el-select-dropdown');
    for (const dd of dropdowns) {
        if (dd.classList.contains('is-hidden')) continue;
        // ═══ Fix: handle position:fixed dropdowns ═══
        // Problem: el-select-dropdown uses position:fixed (common in Element UI
        // with custom popper wrappers).  HTMLElement.offsetParent is null for
        // position:fixed elements, so `dd.offsetParent !== null` fails to detect
        // the visible dropdown.  The function then returns `document`, causing
        // JS_SELECT_OPTION to fall back to document.querySelectorAll('.el-select-
        // dropdown__item') which picks items from ALL dropdowns — including hidden
        // ones on the main page — resulting in clicking the wrong dropdown's item
        // and silently failing to update the drawer's select value.
        //
        // Solution: when offsetParent is null, use getBoundingClientRect to check
        // visibility.  position:absolute dropdowns (non-null offsetParent) are
        // unaffected — the fast path still returns immediately.
        if (dd.offsetParent !== null) return dd;
        const style = getComputedStyle(dd);
        if (style.display === 'none' || style.visibility === 'hidden') continue;
        const rect = dd.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) return dd;
    }
    return document;
})()'''

JS_RESET_SELECT_UI = '''async () => {
''' + JS_POLL_UTIL + '''
  const visibleDropdowns = () => [...document.querySelectorAll('.el-select-dropdown')]
    .filter((dd) => {
      if (dd.classList.contains('is-hidden')) return false;
      const style = getComputedStyle(dd);
      if (style.display === 'none' || style.visibility === 'hidden') return false;
      const rect = dd.getBoundingClientRect();
      return rect.width > 0;
    });

  const before = visibleDropdowns().length;
  const trigger = window.__last_select_trigger || null;
  if (trigger) {
    try {
      trigger.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Escape',
        code: 'Escape',
        keyCode: 27,
        which: 27,
        bubbles: false,
        cancelable: true,
      }));
    } catch (e) {}
    try { trigger.blur(); } catch (e) {}
  }

  const outside = document.body || document.documentElement;
  if (outside) {
    outside.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    outside.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  }
  window.__last_select_trigger = null;

  for (let i = 0; i < 10 && visibleDropdowns().length > 0; i += 1) {
    await sleep(50);
  }
  const after = visibleDropdowns().length;
  return { before, after, closed: after === 0 };
}'''

# Open an el-select dropdown resolved by xpath; sets window.__last_select_trigger for JS_SELECT_OPTION.

JS_SELECT_TRIGGER_BY_XPATH = r'''([xpath, labelHint]) => {
  if (!xpath) return 'xpath-empty';
  const isVis = (el) => {
    if (!el || el.nodeType !== 1) return false;
    if (el.offsetParent === null && !el.closest('.el-table__fixed')) return false;
    const st = getComputedStyle(el);
    return st.display !== 'none' && st.visibility !== 'hidden';
  };
  const normFormLab = (s) => String(s || '').replace(/\s+/g, ' ').trim()
    .replace(/[：:*\s]+$/g, '').replace(/^[*\s]+/, '');
  const formItemLabel = (el) => {
    const item = el && el.closest && el.closest('.el-form-item');
    if (!item) return '';
    const lbl = item.querySelector('.el-form-item__label, label');
    return String((lbl && lbl.textContent) || '').replace(/\s+/g, ' ').trim();
  };
  const wrapVisible = (d) => {
    if (!d) return false;
    const wrap = d.closest && d.closest('.el-dialog__wrapper, .el-message-box__wrapper, .el-drawer__wrapper');
    if (wrap && getComputedStyle(wrap).display === 'none') return false;
    return isVis(d) || (wrap && isVis(wrap));
  };
  const lastVisibleHost = (drawer) => {
    const sel = drawer ? '.el-drawer' : '.el-dialog, .el-message-box';
    const all = [...document.querySelectorAll(sel)];
    for (let i = all.length - 1; i >= 0; i--) {
      if (wrapVisible(all[i])) return all[i];
    }
    return null;
  };
  const findNodeFromSnap = (snap, root, hint) => {
    const wantN = normFormLab(hint);
    let fallback = null;
    let exactMatch = null;
    let includesMatch = null;
    for (let i = snap.snapshotLength - 1; i >= 0; i--) {
      const n = snap.snapshotItem(i);
      if (!n || !isVis(n)) continue;
      if (root && root !== document && !root.contains(n)) continue;
      if (!fallback) fallback = n;
      if (wantN) {
        const labN = normFormLab(formItemLabel(n));
        if (labN === wantN) { exactMatch = n; break; }
        if (!includesMatch && labN && labN.includes(wantN)) includesMatch = n;
      }
    }
    return exactMatch || includesMatch || fallback;
  };
  const tryXpath = (xp, root, hint) => {
    if (!xp) return null;
    let s = String(xp);
    try {
      const ctx = root || document;
      if (root && s.startsWith('//')) s = '.' + s;
      const snap = document.evaluate(s, ctx, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
      return findNodeFromSnap(snap, root, hint);
    } catch (e) {
      return null;
    }
  };
  const findSelectTrigger = (node) => {
    if (!node) return null;
    if (node.matches && node.matches('.el-select .el-input__inner')) return node;
    const inner = node.querySelector?.('.el-select .el-input__inner');
    if (inner && isVis(inner)) return inner;
    const owner = node.closest?.('.el-select');
    if (owner) {
      const tr = owner.querySelector('.el-input__inner');
      if (tr && isVis(tr)) return tr;
    }
    return null;
  };
  const hint = labelHint == null ? '' : String(labelHint);
  let node = tryXpath(xpath, null, hint);
  if (!node && /el-dialog|el-message-box|el-drawer/.test(String(xpath)) && /\[last\(\)\]/.test(String(xpath))) {
    const m = String(xpath).match(/\[last\(\)\](?:\/\/(.+))?$/);
    const local = m && m[1] ? m[1] : '';
    const dlg = /el-drawer/.test(String(xpath)) ? lastVisibleHost(true) : lastVisibleHost(false);
    if (dlg && local) node = tryXpath('.//' + local, dlg, hint);
  }
  if (!node) return 'xpath-not-found';
  const trigger = findSelectTrigger(node);
  if (!trigger) return 'no-select-found';
  // Do NOT treat readOnly as disabled - Element UI el-select triggers are often
  // readOnly while still openable (table Source B selects rely on this path).
  if (trigger.disabled) return 'field-disabled';
  const item = trigger.closest('.el-form-item');
  (item || trigger.closest('.el-select') || trigger)?.scrollIntoView?.({ block: 'center', behavior: 'instant' });
  trigger.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  trigger.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  trigger.click();
  window.__last_select_trigger = trigger;
  return 'ok-triggered';
}'''

# Read current el-select display value by xpath (no click). Same resolve path as trigger.
# Returns: ok-already:<value> | empty | xpath-miss | xpath-empty | no-select-found

JS_SELECT_VALUE_BY_XPATH = r'''([xpath, labelHint]) => {
  if (!xpath) return 'xpath-empty';
  const isVis = (el) => {
    if (!el || el.nodeType !== 1) return false;
    if (el.offsetParent === null && !el.closest('.el-table__fixed')) return false;
    const st = getComputedStyle(el);
    return st.display !== 'none' && st.visibility !== 'hidden';
  };
  const normFormLab = (s) => String(s || '').replace(/\s+/g, ' ').trim()
    .replace(/[：:*\s]+$/g, '').replace(/^[*\s]+/, '');
  const formItemLabel = (el) => {
    const item = el && el.closest && el.closest('.el-form-item');
    if (!item) return '';
    const lbl = item.querySelector('.el-form-item__label, label');
    return String((lbl && lbl.textContent) || '').replace(/\s+/g, ' ').trim();
  };
  const wrapVisible = (d) => {
    if (!d) return false;
    const wrap = d.closest && d.closest('.el-dialog__wrapper, .el-message-box__wrapper, .el-drawer__wrapper');
    if (wrap && getComputedStyle(wrap).display === 'none') return false;
    return isVis(d) || (wrap && isVis(wrap));
  };
  const lastVisibleHost = (drawer) => {
    const sel = drawer ? '.el-drawer' : '.el-dialog, .el-message-box';
    const all = [...document.querySelectorAll(sel)];
    for (let i = all.length - 1; i >= 0; i--) {
      if (wrapVisible(all[i])) return all[i];
    }
    return null;
  };
  const findNodeFromSnap = (snap, root, hint) => {
    const wantN = normFormLab(hint);
    let fallback = null;
    let exactMatch = null;
    let includesMatch = null;
    for (let i = snap.snapshotLength - 1; i >= 0; i--) {
      const n = snap.snapshotItem(i);
      if (!n || !isVis(n)) continue;
      if (root && root !== document && !root.contains(n)) continue;
      if (!fallback) fallback = n;
      if (wantN) {
        const labN = normFormLab(formItemLabel(n));
        if (labN === wantN) { exactMatch = n; break; }
        if (!includesMatch && labN && labN.includes(wantN)) includesMatch = n;
      }
    }
    return exactMatch || includesMatch || fallback;
  };
  const tryXpath = (xp, root, hint) => {
    if (!xp) return null;
    let s = String(xp);
    try {
      const ctx = root || document;
      if (root && s.startsWith('//')) s = '.' + s;
      const snap = document.evaluate(s, ctx, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
      return findNodeFromSnap(snap, root, hint);
    } catch (e) {
      return null;
    }
  };
  const findSelectHost = (node) => {
    if (!node) return null;
    if (node.matches && node.matches('.el-select')) return node;
    const host = node.closest?.('.el-select');
    if (host) return host;
    const nested = node.querySelector?.('.el-select');
    return nested || null;
  };
  const readSelected = (select) => {
    if (!select) return '';
    const trigger = select.querySelector('.el-input__inner');
    if (trigger) {
      const v = (trigger.value || '').trim();
      if (v && !v.includes('请选择')) return v;
      // Do not trust attribute alone when DOM property is empty (Vue clear leaves stale attr).
      const aria = (trigger.getAttribute('aria-label') || trigger.getAttribute('title') || '').trim();
      if (aria && !aria.includes('请选择')) return aria;
    }
    const tag = select.querySelector('.el-select__tags-text');
    if (tag) {
      const t = (tag.textContent || '').trim();
      if (t && !t.includes('请选择')) return t;
    }
    const single = select.querySelector('.el-select__selected-item, .el-select__placeholder');
    if (single) {
      const t = (single.textContent || '').trim();
      if (t && !t.includes('请选择') && !single.classList?.contains('el-select__placeholder')) return t;
    }
    return '';
  };
  const hint = labelHint == null ? '' : String(labelHint);
  let node = tryXpath(xpath, null, hint);
  if (!node && /el-dialog|el-message-box|el-drawer/.test(String(xpath)) && /\[last\(\)\]/.test(String(xpath))) {
    const m = String(xpath).match(/\[last\(\)\](?:\/\/(.+))?$/);
    const local = m && m[1] ? m[1] : '';
    const dlg = /el-drawer/.test(String(xpath)) ? lastVisibleHost(true) : lastVisibleHost(false);
    if (dlg && local) node = tryXpath('.//' + local, dlg, hint);
  }
  if (!node) return 'xpath-miss';
  const select = findSelectHost(node);
  if (!select) return 'no-select-found';
  // Scroll the form-item (or select) into view so Element UI renders correctly
  // even when the field already has a value (ok-already skip path).
  try {
    const item = select.closest && select.closest('.el-form-item');
    (item || select).scrollIntoView({ block: 'center', behavior: 'instant' });
  } catch (e) {}
  const cur = readSelected(select);
  if (cur) return 'ok-already:' + cur;
  return 'empty';
}'''

