"""
JS code snippets injected into the browser via page.evaluate().

Canonical CTRL.* for replay/assemble lives in src/ctrl-actions.js
(window.CTRL via getInjectionCode). This module is the agent-side twin —
not byte-identical (more helpers than CTRL). Parity check:

    node scripts/characterization/characterize-ctrl.mjs

CTRL.* ↔ primary JS_* (or action) mapping:
    getContainer       → JS_GET_CONTAINER
    fillFormField      → JS_FILL_FORM_FIELD
    selectOption       → JS_SELECT_OPTION (+ JS_FIND_LABELED_SELECT)
    selectDate         → JS_FILL_DATE_FIELD
    clickRadio         → JS_CLICK_RADIO
    selectTreeOption   → JS_SELECT_TREE_OPTION
    waitForLoading     → JS_WAIT_LOADING
    clickIconButton    → JS_CLICK_ICON_BUTTON (+ click_icon_button in _misc.py)
    verifyFormStructure → JS_VERIFY_FORM_STRUCTURE
    (navigation/table/dialog/adjacent/expand/address
     live as inline evaluate or actions in _navigation/_table/_misc/_form;
     fillAddressFields is assembler/replay-oriented)

Several constants reference JS_GET_CONTAINER via string concatenation —
all MUST remain in this single module for Python module-level concat order.

Locator snapshot helpers: scripts/actions/_locator_helpers_js.py
(regenerate: node scripts/_gen_locator_helpers_py.mjs).
"""

from ._locator_helpers_js import PAGE_LOCATOR_HELPERS

# ── Container detection (must be defined FIRST — referenced by other snippets) ──

JS_GET_CONTAINER = '''(() => {
    for (const d of document.querySelectorAll('.el-dialog'))
        if (d.offsetParent !== null) return d;
    for (const d of document.querySelectorAll('.el-drawer'))
        if (d.offsetParent !== null) return d;
    return document;
})()'''

JS_IDENTIFY_CONTAINER = '''(() => {
    const c = ''' + JS_GET_CONTAINER + ''';
    if (c === document) return 'main';
    if (c.classList.contains('el-dialog')) {
        const t = (c.querySelector('.el-dialog__title')?.textContent || '').trim() || 'unnamed';
        return 'dialog:' + t;
    }
    if (c.classList.contains('el-drawer')) {
        const l = c.getAttribute('aria-label') || 'unnamed';
        return 'drawer:' + l;
    }
    const tp = c.closest('.el-tab-pane');
    if (tp) {
        const tabs = tp.closest('.el-tabs');
        if (tabs) {
            const a = tabs.querySelector('.el-tabs__item.is-active');
            if (a) return 'tab:' + a.textContent.trim();
        }
    }
    return 'unknown:' + (c.tagName || 'unknown');
})()'''

# True when visible scope has 查询/搜索 and no 保存/提交 (list filter / query dialog).
JS_IS_QUERY_TOOLBAR = '''(() => {
    const root = ''' + JS_GET_CONTAINER + ''';
    const scope = root === document ? document.body : root;
    if (!scope) return false;
    const btns = scope.querySelectorAll('button, .el-button, [role="button"]');
    let hasQuery = false;
    let hasSave = false;
    for (const b of btns) {
        if (b.offsetParent === null && b.getClientRects().length === 0) continue;
        const t = (b.innerText || b.textContent || '').replace(/\\s+/g, ' ').trim();
        if (!t || t.length > 12) continue;
        if (/^(查询|搜索|查找)$/.test(t)) hasQuery = true;
        if (/^(保存|提交)$/.test(t)) hasSave = true;
    }
    return hasQuery && !hasSave;
})()'''

# ── Loading / waiting ──

JS_WAIT_LOADING = '''() => new Promise(resolve => {
    let elapsed = 0;
    const check = () => {
        if (elapsed >= 30000) { resolve('timeout'); return; }
        const mask = document.querySelector('.el-loading-mask:not(.el-loading-mask--hidden)');
        if (!mask || mask.offsetParent === null) resolve();
        else { elapsed += 200; setTimeout(check, 200); }
    };
    check();
})'''

JS_CHECK_LOADING = '''() => {
    const mask = document.querySelector('.el-loading-mask:not(.el-loading-mask--hidden)');
    return mask && mask.offsetParent !== null;
}'''

JS_NATIVE_SETTER = ''  # Inlined in JS_FILL_FORM_FIELD

# ── Locators ──

JS_LOCATOR = '''(label) => {
    const xpath = (el) => {
        if (!el || el === document || el.nodeType !== 1) return '';
        const parent = el.parentNode;
        const tag = el.tagName.toLowerCase();
        const idx = 1 + [...parent.children].filter(c => c.tagName === el.tagName).indexOf(el);
        return xpath(parent) + '/' + tag + '[' + idx + ']';
    };
    const container = ''' + JS_GET_CONTAINER + ''';
    const items = container.querySelectorAll('.el-form-item');
    for (const item of items) {
        const lbl = item.querySelector('.el-form-item__label');
        if (!lbl) continue;
        const t = lbl.textContent.trim();
        if (t !== label && !t.includes(label)) continue;
        const target = item.querySelector('input:not([type="hidden"]), textarea, .el-select .el-input__inner');
        if (target) return JSON.stringify({xpath: xpath(target), tag: target.tagName.toLowerCase(), attrs: (()=>{const a={};for(const at of target.attributes) if(at.value&&at.value.length<100) a[at.name]=at.value; return a;})()});
    }
    return '';
}'''

JS_SMART_LOCATOR = '''([label]) => {
''' + PAGE_LOCATOR_HELPERS + '''
    const container = ''' + JS_GET_CONTAINER + ''';
    const want = normalizeFormLabel(label);
    if (!want) return '';

    function formItemLabel(item) {
      const lbl = item.querySelector('.el-form-item__label');
      return normalizeFormLabel(lbl && lbl.textContent);
    }
    function pickControl(item) {
      const candidates = [
        item.querySelector('.el-tree-select'),
        item.querySelector('.el-cascader'),
        item.querySelector('span.my-popover, .my-popover'),
        item.querySelector('.el-select'),
        item.querySelector('.el-date-editor'),
        item.querySelector('.el-radio-group'),
        item.querySelector('.el-checkbox-group'),
        item.querySelector('.el-textarea__inner'),
        item.querySelector('textarea'),
        Array.from(item.querySelectorAll('.el-input__inner, input:not([type="hidden"])'))
          .find(function (inp) { return !inp.closest('.el-popover, .tree-popover'); }),
      ].filter(Boolean);
      return candidates[0] || null;
    }

    let matched = null;
    const items = container.querySelectorAll('.el-form-item');
    for (const item of items) {
      if (!isVisible(item) && item.offsetParent === null) continue;
      const lbl = formItemLabel(item);
      if (!lbl) continue;
      if (lbl === want || lbl.includes(want) || want.includes(lbl)) {
        matched = { item, label: lbl };
        if (lbl === want) break;
      }
    }
    let target = matched ? pickControl(matched.item) : null;
    let formLabel = matched ? matched.label : '';
    if (!target) {
      for (const inp of container.querySelectorAll('input:not([type="hidden"]), textarea')) {
        const ph = String(inp.placeholder || '');
        if (ph && (ph.includes(label) || normalizeFormLabel(ph) === want) && isVisible(inp)) {
          target = inp;
          formLabel = want;
          break;
        }
      }
    }
    if (!target) return '';
    const host = normalizeTargetRoot(target) || target;
    const abs = absXPath(host);
    const loc = buildLocatorSnap(host, cleanVisibleText(host), abs, formLabel);
    return JSON.stringify({
      xpath: loc.xpath || abs,
      css_sel: loc.cssSelector || '',
      tag: loc.tag || (host.tagName || '').toLowerCase(),
      attrs: loc.attributes || {},
      xpath_smart: loc.xpath_smart || '',
      xpath_full: loc.xpath_full || abs,
      xpath_abs: abs,
      candidates: loc.candidates || [],
      text: loc.text || '',
      formLabel: loc.formLabel || formLabel,
      target_kind: loc.target_kind,
      locator_scope: loc.locator_scope,
      locator_occurrence: loc.locator_occurrence,
      locator_verified: loc.locator_verified,
      locator_strategy: loc.locator_strategy,
      locator_fallback_reason: loc.locator_fallback_reason,
    });
}'''

# ── Fill form field ──

JS_FILL_FORM_FIELD = '''([label, val]) => {
    const setFn = (t, v) => {
        const TagProto = t.tagName === 'TEXTAREA' ? HTMLTextAreaElement : HTMLInputElement;
        const setter = Object.getOwnPropertyDescriptor(TagProto.prototype, 'value').set;
        setter.call(t, v);
        t.setAttribute('value', v);
        t.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:v}));
        t.dispatchEvent(new Event('change', {bubbles:true}));
        t.dispatchEvent(new Event('blur', {bubbles:true}));
    };
    const container = ''' + JS_GET_CONTAINER + ''';
    const items = container.querySelectorAll('.el-form-item');
    // Pass 1: exact label match
    for (const item of items) {
        const lbl = item.querySelector('.el-form-item__label')?.textContent?.trim() || '';
        if (lbl !== label) continue;
        // Scroll the form-item into view so Element UI components render correctly
        item.scrollIntoView({ block: 'center', behavior: 'instant' });
        const input = item.querySelector('input:not([type="hidden"])');
        const textarea = item.querySelector('textarea');
        const target = input || textarea;
        if (!target) return 'no-input-found';
        if (target.disabled || target.readOnly) return 'field-disabled';
        if (target.closest('.el-date-editor, .tsscdatepicker')) {
            target.focus();
            try{let w=target.closest('.el-date-editor');if(w){let vm=w.__vue__;while(vm&&vm.$options&&vm.$options.name!=='ElDatePicker')vm=vm.$parent;if(vm){vm.value=val;vm.$emit('input',val);vm.$emit('change',val);vm.date=new Date(val);vm.$emit('pick',new Date(val));}}}catch(e){}
            setFn(target, val);
            target.blur();
            document.querySelectorAll('.el-picker-panel,.el-date-picker').forEach(x=>{x.style.display='none';x.classList.add('is-hidden')});
            return 'ok-date';
        }
        setFn(target, val);
        return 'ok';
    }
    // Pass 2: partial label match (exclude exact matches already tried)
    for (const item of items) {
        const lbl = item.querySelector('.el-form-item__label')?.textContent?.trim() || '';
        if (lbl === label) continue;
        if (!lbl.includes(label)) continue;
        const input = item.querySelector('input:not([type="hidden"])');
        const textarea = item.querySelector('textarea');
        const target = input || textarea;
        if (!target) return 'no-input-found';
        if (target.disabled || target.readOnly) return 'field-disabled';
        if (target.closest('.el-date-editor, .tsscdatepicker')) {
            target.focus();
            try{let w=target.closest('.el-date-editor');if(w){let vm=w.__vue__;while(vm&&vm.$options&&vm.$options.name!=='ElDatePicker')vm=vm.$parent;if(vm){vm.value=val;vm.$emit('input',val);vm.$emit('change',val);vm.date=new Date(val);vm.$emit('pick',new Date(val));}}}catch(e){}
            setFn(target, val);
            target.blur();
            document.querySelectorAll('.el-picker-panel,.el-date-picker').forEach(x=>{x.style.display='none';x.classList.add('is-hidden')});
            return 'ok-date';
        }
        setFn(target, val);
        return 'ok';
    }
    const allInputs = container.querySelectorAll('input:not([type="hidden"]), textarea');
    for (const inp of allInputs) {
        if (inp.closest('.el-date-editor, .tsscdatepicker')) continue;
        const ph = inp.getAttribute('placeholder') || '';
        if (ph.includes(label) && !inp.disabled && !inp.readOnly && inp.offsetParent !== null) {
            setFn(inp, val);
            return 'ok-placeholder';
        }
    }
    for (const inp of allInputs) {
        if (inp.closest('.el-date-editor, .tsscdatepicker')) continue;
        const type = inp.getAttribute('type') || 'text';
        if (type.toLowerCase() === label.toLowerCase() && !inp.disabled && !inp.readOnly && inp.offsetParent !== null) {
            setFn(inp, val);
            return 'ok-type';
        }
    }
    return 'label-not-found';
}'''

JS_FILL_DATE_FIELD = '''([label, val]) => {
    const setFn = (t, v) => {
        const TagProto = t.tagName === 'TEXTAREA' ? HTMLTextAreaElement : HTMLInputElement;
        const setter = Object.getOwnPropertyDescriptor(TagProto.prototype, 'value').set;
        setter.call(t, v);
        t.setAttribute('value', v);
        t.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:v}));
        t.dispatchEvent(new Event('change',{bubbles:true}));
        t.dispatchEvent(new Event('blur',{bubbles:true}));
    };
    const container = ''' + JS_GET_CONTAINER + ''';
    const items = container.querySelectorAll('.el-form-item');
    let target = null;
    for (let pass = 1; pass <= 2; pass++) {
        const exact = pass === 1;
        for (const item of items) {
            const lbl = item.querySelector('.el-form-item__label')?.textContent?.trim() || '';
            if (exact) { if (lbl !== label) continue; }
            else { if (lbl === label || !lbl.includes(label)) continue; }
            const t = item.querySelector('input:not([type="hidden"])') || item.querySelector('textarea');
            if (!t) return 'no-input';
            item.scrollIntoView({ block: 'center', behavior: 'instant' });
            if (t.disabled || t.readOnly) return 'disabled';
            if (t.closest('.el-date-editor, .tsscdatepicker')) { target = t; break; }
        }
        if (target) break;
    }
    if (!target) return 'nf:' + label;
    if (isNaN(new Date(val).getTime())) return 'invalid-date:' + val;
    // ── Design rationale: direct DOM injection, no panel interaction ──
    // Three approaches were tested on real Element UI date pickers (Edge CDP, 2026-06-30):
    //
    // ❌ Approach 1 — input.click() to open panel:
    //    Element UI listens on .el-input__prefix (calendar icon), not the <input>.
    //    click() on the input itself does nothing → "panel-not-opened".
    //
    // ❌ Approach 2 — prefixIcon.click() + month navigation + day click:
    //    Panel opens at current month. Requires prev/next button clicks to reach
    //    target month (fragile parsing of Chinese header text). After first fill,
    //    the panel gets display:none + is-hidden class; subsequent prefix clicks
    //    cannot reliably re-open it. Also: multiple panels (year/month/day) coexist
    //    in the DOM, making visible-panel detection error-prone.
    //
    // ❌ Approach 3 — setFn + p.date + parentNode click + setTimeout day click:
    //    ctrl-actions.js uses this (sets value, syncs Vue, clicks parent, then
    //    setTimeout→click day). On our target page, the panel opens at YEAR level
    //    after p.date is set, so day cells aren't visible → day-not-found.
    //
    // ✅ Approach 4 — native DOM setter ONLY, no panel:
    //    setFn() calls Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,
    //    'value').set.call(input, val) + InputEvent('input') + Event('change') +
    //    Event('blur'). This bypasses Element UI's panel entirely and writes
    //    directly to the underlying <input>. Vue sync (p.date + $emit('pick'))
    //    keeps the component's internal state consistent.
    //    Verified: values survive dialog open/close and persist correctly.
    // ── Date-picker Vue instance lookup ──
    // .el-date-editor.__vue__ resolves to the INNER ElInput component,
    // not the ElDatePicker.  ElInput.$emit('input') only reaches its
    // parent ElDatePicker — the ElForm (which holds the v-model) never
    // sees the update.  Must walk up the parent chain to find the
    // ElDatePicker instance, whose $emit('input') reaches ElForm.
    //
    // Verified with Edge CDP (2026-06-30): after emitting from ElDatePicker
    // level, ElForm.model.fdDt reflects the new value and save validation
    // passes.  Without this walk-up, save clears the date fields.
    target.focus();
    try{let w=target.closest('.el-date-editor');if(w){let vm=w.__vue__;while(vm&&vm.$options&&vm.$options.name!=='ElDatePicker')vm=vm.$parent;if(vm){vm.value=val;vm.$emit('input',val);vm.$emit('change',val);vm.date=new Date(val);vm.$emit('pick',new Date(val));}}}catch(e){}
    setFn(target, val);
    target.blur();
    document.querySelectorAll('.el-picker-panel,.el-date-picker').forEach(x=>{x.style.display='none';x.classList.add('is-hidden')});
    return 'ok-date';
}'''

# ── Select / dropdown ──

JS_FIND_LABELED_SELECT = '''([label, mode]) => {
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

    function _tryItems(items, label, mode) {
        for (let pass = 1; pass <= 2; pass++) {
            const exact = pass === 1;
            for (const item of items) {
                const lbl = item.querySelector('.el-form-item__label')?.textContent?.trim() || '';
                if (exact) { if (lbl !== label) continue; }
                else { if (lbl === label || !lbl.includes(label)) continue; }
            const trigger = item.querySelector('.el-select .el-input__inner');
            if (!trigger && mode === 'trigger') return {skip: true, reason: 'no-select-found'};
            if (!trigger) continue;
            if (mode === 'check') {
                const cur = getSelectedLabel(item);
                if (cur) return {done: true, result: 'ok-already:' + cur};
                return {skip: true, reason: 'no-value'};
            }
            if (mode === 'trigger') {
                if (trigger.disabled) return {skip: true, reason: 'disabled'};
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
        return null;
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
        for (const sel of _allSelects) {
            if (sel.offsetParent !== null) {
                const v = (sel.value || '').trim();
                if (v.length > 0) return 'ok-already:' + v;
                const t = (sel.textContent || '').trim();
                if (t.length > 0 && !t.includes('请选择')) return 'ok-already:' + t;
                break;
            }
        }
        return 'not-filled';
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

JS_SELECT_OPTION = '''(arg) => {
    // arg: string option text, or [option, exactOnly]
    // exactOnly=true → only exact label match (replay must not drift from recorded value)
    let option = arg;
    let exactOnly = false;
    if (Array.isArray(arg)) {
        option = arg[0];
        exactOnly = !!arg[1];
    }
    option = String(option == null ? '' : option);
    // Prefer the dropdown tied to the trigger we just opened.
    const triggerInput = window.__last_select_trigger || null;
    let dropdown = null;
    if (triggerInput) {
        // Element UI often sets aria-owns / aria-controls on the input wrapper
        const owned = triggerInput.getAttribute('aria-controls')
            || triggerInput.getAttribute('aria-owns')
            || triggerInput.closest('.el-select')?.getAttribute('aria-owns');
        if (owned) {
            const byId = document.getElementById(owned);
            if (byId) dropdown = byId;
        }
        // Popper may sit next to the select; pick the visible dropdown nearest the trigger
        if (!dropdown) {
            const tr = triggerInput.getBoundingClientRect();
            let best = null, bestDist = Infinity;
            for (const dd of document.querySelectorAll('.el-select-dropdown')) {
                if (dd.classList.contains('is-hidden')) continue;
                const style = getComputedStyle(dd);
                if (style.display === 'none' || style.visibility === 'hidden') continue;
                const rect = dd.getBoundingClientRect();
                if (rect.width <= 0 || rect.height <= 0) continue;
                const dist = Math.abs(rect.top - tr.bottom) + Math.abs(rect.left - tr.left);
                if (dist < bestDist) { bestDist = dist; best = dd; }
            }
            dropdown = best;
        }
    }
    if (!dropdown) {
        dropdown = ''' + JS_FIND_VISIBLE_DROPDOWN + ''';
    }
    let items = dropdown && dropdown !== document
        ? dropdown.querySelectorAll('.el-select-dropdown__item')
        : [];
    // Do NOT fall back to all document items — that mixes 国籍/行业/性别 options.
    if (items.length === 0) {
        const vis = ''' + JS_FIND_VISIBLE_DROPDOWN + ''';
        if (vis && vis !== document) items = vis.querySelectorAll('.el-select-dropdown__item');
    }
    const visibleItems = [...items].filter(i => {
        if (i.classList.contains('is-disabled')) return false;
        const style = getComputedStyle(i);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
        const r = i.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
    });
    const pickPool = visibleItems.length > 0 ? visibleItems : [...items];
    const FIRST_ALIASES = ['first', '1st', '第一个', '第一项'];
    const tryClick = (item) => {
        item.scrollIntoView({ block: 'nearest' });
        const t = item.textContent.trim();
        item.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        item.click();
        if (triggerInput) {
            setTimeout(() => {
                triggerInput.dispatchEvent(new Event('input', { bubbles: true }));
                triggerInput.dispatchEvent(new Event('change', { bubbles: true }));
                window.__last_select_trigger = null;
            }, 0);
        }
        return 'ok:' + t;
    };
    if (pickPool.length === 0) return 'no-items';
    if (!exactOnly && FIRST_ALIASES.includes(option.toLowerCase().trim())) {
        return tryClick(pickPool[0]);
    }
    for (const item of pickPool) {
        if (item.textContent.trim() === option) return tryClick(item);
    }
    if (!exactOnly) {
        for (const item of pickPool) {
            if (item.textContent.trim().includes(option)) return tryClick(item);
        }
    }
    const hasEmpty = (dropdown && dropdown !== document)
        ? dropdown.querySelector('.el-select-dropdown__empty')
        : document.querySelector('.el-select-dropdown__empty');
    if (hasEmpty) return 'no-items';
    const preview = pickPool.slice(0, 30).map(i => i.textContent.trim()).filter(Boolean);
    return 'option-not-found:' + preview.join(', ');
}'''

# Read all option labels for a labeled el-select (Vue instance + open popper).
# Used when recording select_option so params.options / element.options persist.
JS_READ_SELECT_OPTIONS = '''([label]) => {
    const want = String(label || '').trim();
    const SKIP = new Set(['请选择', '请选择…', '请选择...', '']);
    const pushUnique = (arr, s) => {
        const t = String(s || '').replace(/\\s+/g, ' ').trim();
        if (!t || SKIP.has(t) || arr.includes(t)) return;
        arr.push(t);
    };
    const fromOptionObj = (o) => {
        if (o == null) return '';
        if (typeof o === 'string' || typeof o === 'number') return String(o);
        // ElOption component instance or plain {label,value}
        const lab = o.label ?? o.currentLabel ?? (o.$props && o.$props.label)
            ?? o.text ?? o.name;
        if (lab != null && String(lab).trim()) return String(lab);
        const val = o.value ?? (o.$props && o.$props.value);
        return val != null ? String(val) : '';
    };
    const readVueOptions = (selectEl) => {
        const out = [];
        try {
            const vm = selectEl && selectEl.__vue__;
            if (!vm) return out;
            const ingest = (opts) => {
                if (!opts) return;
                if (Array.isArray(opts)) {
                    for (const o of opts) pushUnique(out, fromOptionObj(o));
                    return;
                }
                if (typeof opts === 'object') {
                    // Element UI may keep options as object / Map-like
                    const values = typeof opts.values === 'function'
                        ? [...opts.values()]
                        : Object.values(opts);
                    for (const o of values) pushUnique(out, fromOptionObj(o));
                }
            };
            ingest(vm.options);
            ingest(vm.$data && vm.$data.options);
            ingest(vm.$props && vm.$props.options);
            ingest(vm.cachedOptions);
            ingest(vm.$data && vm.$data.cachedOptions);
        } catch (e) {}
        return out;
    };
    const readOpenDropdown = (trigger) => {
        const out = [];
        try {
            let dropdown = null;
            if (trigger) {
                const owned = trigger.getAttribute('aria-controls')
                    || trigger.getAttribute('aria-owns')
                    || trigger.closest('.el-select')?.getAttribute('aria-owns');
                if (owned) dropdown = document.getElementById(owned);
                if (!dropdown) {
                    const tr = trigger.getBoundingClientRect();
                    let best = null, bestDist = Infinity;
                    for (const dd of document.querySelectorAll('.el-select-dropdown')) {
                        if (dd.classList.contains('is-hidden')) continue;
                        const style = getComputedStyle(dd);
                        if (style.display === 'none' || style.visibility === 'hidden') continue;
                        const rect = dd.getBoundingClientRect();
                        if (rect.width <= 0 || rect.height <= 0) continue;
                        const dist = Math.abs(rect.top - tr.bottom) + Math.abs(rect.left - tr.left);
                        if (dist < bestDist) { bestDist = dist; best = dd; }
                    }
                    dropdown = best;
                }
            }
            if (!dropdown) {
                for (const dd of document.querySelectorAll('.el-select-dropdown')) {
                    if (dd.classList.contains('is-hidden')) continue;
                    const style = getComputedStyle(dd);
                    if (style.display === 'none' || style.visibility === 'hidden') continue;
                    const rect = dd.getBoundingClientRect();
                    if (rect.width > 0 && rect.height > 0) { dropdown = dd; break; }
                }
            }
            if (!dropdown) return out;
            for (const item of dropdown.querySelectorAll('.el-select-dropdown__item')) {
                if (item.classList.contains('is-disabled')) continue;
                pushUnique(out, (item.textContent || '').trim());
            }
        } catch (e) {}
        return out;
    };
    const _isVisibleContainer = (el) => {
        if (el.offsetParent !== null) return true;
        const style = getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
    };
    const containers = [];
    for (const d of document.querySelectorAll('.el-dialog'))
        if (_isVisibleContainer(d)) containers.push(d);
    for (const d of document.querySelectorAll('.el-drawer'))
        if (_isVisibleContainer(d)) containers.push(d);
    containers.push(document);

    let trigger = null;
    let selectEl = null;
    if (want) {
        for (const c of containers) {
            for (let pass = 1; pass <= 2 && !trigger; pass++) {
                const exact = pass === 1;
                for (const item of c.querySelectorAll('.el-form-item')) {
                    const lbl = item.querySelector('.el-form-item__label')?.textContent?.trim() || '';
                    if (exact) { if (lbl !== want) continue; }
                    else { if (lbl === want || !lbl.includes(want)) continue; }
                    const t = item.querySelector('.el-select .el-input__inner');
                    const sel = item.querySelector('.el-select');
                    if (t || sel) {
                        trigger = t;
                        selectEl = sel || (t && t.closest('.el-select'));
                        break;
                    }
                }
            }
            if (trigger || selectEl) break;
        }
    }
    if (!trigger && window.__last_select_trigger) {
        trigger = window.__last_select_trigger;
        selectEl = trigger.closest && trigger.closest('.el-select');
    }

    const out = [];
    if (selectEl) {
        for (const s of readVueOptions(selectEl)) pushUnique(out, s);
    }
    for (const s of readOpenDropdown(trigger)) pushUnique(out, s);
    return out;
}'''

JS_FIND_OPTION = '''(option) => {
    const dropdown = ''' + JS_FIND_VISIBLE_DROPDOWN + ''';
    let items = dropdown.querySelectorAll('.el-select-dropdown__item');
    if (items.length === 0 || dropdown === document) {
        items = document.querySelectorAll('.el-select-dropdown__item');
    }
    const FIRST_ALIASES = ['first', '1st', '第一个', '第一项'];
    if (FIRST_ALIASES.includes(option.toLowerCase().trim())) {
        for (const item of items) {
            if (item.offsetParent !== null) return item.textContent.trim();
        }
        if (items.length > 0) return items[0].textContent.trim();
        return 'NO_ITEMS';
    }
    for (const item of items) {
        if (item.textContent.trim() === option) return option;
    }
    for (const item of items) {
        if (item.textContent.trim().includes(option)) return item.textContent.trim();
    }
    const hasEmpty = document.querySelector('.el-select-dropdown__empty');
    if (hasEmpty) return 'NO_ITEMS';
    return 'NOT_FOUND:' + [...items].map(i => i.textContent.trim()).join(', ');
}'''

# ── Radio ──

JS_CLICK_RADIO = '''([label, option]) => {
    const container = ''' + JS_GET_CONTAINER + ''';
    const items = container.querySelectorAll('.el-form-item');
    for (const item of items) {
        const lbl = item.querySelector('.el-form-item__label')?.textContent?.trim() || '';
        if (!lbl.includes(label)) continue;
        item.scrollIntoView({ block: 'center', behavior: 'instant' });
        const radios = item.querySelectorAll('.el-radio');
        for (const radio of radios) {
            if (radio.textContent.trim() === option && radio.offsetParent !== null) {
                radio.click(); return 'ok';
            }
        }
        return 'option-not-found';
    }
    return 'label-not-found';
}'''

# ── Tree select (custom TsscMultiTree component) ──
#
# 探索过程 (2026-06-30, Edge CDP 实测):
#   1. 该组件不是 Element UI 标准组件 — 是自定义的 el-popover + el-tree 组合。
#      DOM 选择器: .el-form-item → input(trigger) → .tree-popover > .el-tree
#   2. __vue__ 链: ElTree → ElPopover → ElTooltip → TsscMultiTree (关键层)
#      TsscMultiTree 持有 treeData (1974 个扁平节点) 和 data (22 个根节点)
#   3. 踩过的坑:
#      - span.click() 触发不了选中 → Vue 事件绑定在 TsscMultiTree 层
#      - el-tree.setCurrentKey() 选中了但 input 不更新 → 回调在 TsscMultiTree
#      - el-tree.setChecked() 同样无效 → 需要 TsscMultiTree.$emit('input', code)
#      - handleHideClick() 关闭弹窗 (可选)
#   4. 正确的 API: vm.$emit('input', code) → 组件自动 code→label 并更新 input 值
#   5. 数据查找: treeData 是扁平数组 [{label, value, children?}]; data 是树结构
#   6. 注意: 必须先用 input.click() 打开 popover 才能访问 .el-tree DOM
#
# 未来类似 action 的创建参考:
#   - 先通过 __vue__ 链找到业务组件 (含 data/props/methods 的那个)
#   - 测试 Vue 各种 API (setValue/handleSelect/onNodeClick/$emit) 找到正确入口
#   - 不要假设标准 Element UI API 有效 (即使 DOM 类名相同)

JS_SELECT_TREE_OPTION = '''async ([label, option]) => {
    // Open the popover first so tree DOM is rendered
    const container = ''' + JS_GET_CONTAINER + ''';
    const items = container.querySelectorAll('.el-form-item');
    let fieldItem = null;
    for (const item of items) {
        const l = item.querySelector('.el-form-item__label')?.textContent?.trim() || '';
        if (l === label || l.includes(label)) { fieldItem = item; break; }
    }
    if (!fieldItem) return 'label-not-found';
    fieldItem.scrollIntoView({ block: 'center', behavior: 'instant' });
    const input = fieldItem.querySelector('input');
    if (!input) return 'no-input';
    if (input.disabled || input.readOnly) return 'disabled';
    // Read value from any non-empty input in the form item
    const readDisplayValue = () => {
        for (const inp of fieldItem.querySelectorAll('input:not([type="hidden"])')) {
            if (inp.value && inp.value.trim()) return inp.value.trim();
        }
        return '';
    };
    // Open popover
    input.click();
    // Find TsscMultiTree instance
    let vm = null;
    setTimeout(() => {}, 0); // let DOM settle
    const tryFind = () => {
        const tree = document.querySelector('.el-tree');
        if (tree) {
            vm = tree.__vue__;
            while (vm && vm.$options && !vm.$options.name?.includes('TsscMultiTree'))
                vm = vm.$parent;
        }
        return vm;
    };
    vm = tryFind();
    if (!vm) return 'no-tree-component';

    // ═══════════════════════════════════════════════════════════════════
    // P0: Exact match — resolve to a leaf node code.
    //
    // data[] is hierarchical: { label, id, children? }.  Leaf = no children.
    // treeData[] is flat:     { name, id, pId } (no children, no label).
    //
    // Match by display text (label / name) OR by code (id).
    // ═══════════════════════════════════════════════════════════════════
    const isLeafNode = (node) => !node.children || node.children.length === 0;
    const dfsFirstLeaf = (nodes) => {
        for (const n of nodes) {
            if (isLeafNode(n)) return n;
            if (n.children) {
                const r = dfsFirstLeaf(n.children);
                if (r) return r;
            }
        }
        return null;
    };
    const nodeMatches = (n) => (n.label || n.name || '') === option || n.id === option;
    const walkForLeaf = (nodes) => {
        for (const n of nodes) {
            if (nodeMatches(n)) {
                if (isLeafNode(n)) return n.id;
                const leaf = dfsFirstLeaf(n.children || []);
                if (leaf) return leaf.id;
                return null;
            }
            if (n.children) { const r = walkForLeaf(n.children); if (r) return r; }
        }
        return null;
    };
    // Try hierarchical data first (proper tree), then flat treeData
    code = walkForLeaf(vm.data || []);
    if (!code) {
        const flat = vm.treeData || [];
        for (const n of flat) {
            if ((n.name || '') === option || n.id === option) { code = n.id; break; }
        }
    }
    if (code) {
        vm.$emit('input', code);
        // Verify the selection took effect — the component may reject invalid codes
        await new Promise(r => setTimeout(r, 150));
        const verifyVal = readDisplayValue();
        if (!verifyVal) {
            return 'fail: emit did not update input for code=' + code;
        }
        setTimeout(() => {
            if (typeof vm.handleHideClick === 'function') vm.handleHideClick();
        }, 100);
        return 'ok:' + option + ' (' + code + ')';
    }

    // ═══════════════════════════════════════════════════════════════════
    // P1: UI keyword search — Pass 1: click first visible leaf.
    // Pass 2: if only non-leaf visible → expand it → DFS first leaf child.
    // Supports .tree-popover (old) and .el-popover (custom wrappers).
    // ═══════════════════════════════════════════════════════════════════
    let popover = document.querySelector('.tree-popover');
    if (!popover || popover.offsetParent === null) {
        const allPopovers = document.querySelectorAll('.el-popover');
        for (const p of allPopovers) {
            if (p.offsetParent !== null) { popover = p; break; }
        }
    }
    if (popover) {
        // For custom search-input wrappers: use field's own input (already focused)
        // For standard tree-popover: find input/button inside popover
        const searchInput = popover.querySelector('.search-input input') || popover.querySelector('input');
        const searchBtn = popover.querySelector('.search-input button') || popover.querySelector('button');
        if (searchInput && searchBtn) {
            const s = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
            s.call(searchInput, option || '科技');
            searchInput.dispatchEvent(new InputEvent('input', { bubbles: true }));
            setTimeout(() => {
                searchBtn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
                searchBtn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
                searchBtn.click();
                searchBtn.dispatchEvent(new Event('click', { bubbles: true }));
            }, 200);
            const result = await new Promise(resolve => {
                // Poll for filtered results — the tree may take time to re-render
                let elapsed = 0;
                const poll = () => {
                    const allNodes = document.querySelectorAll('.el-tree-node');
                    const hidden = document.querySelectorAll('.el-tree-node.is-hidden').length;
                    const visible = allNodes.length - hidden;
                    // Tree is filtered when hidden nodes appear (search narrowed results)
                    if (visible < allNodes.length || elapsed >= 2000) {
                        const nodes = document.querySelectorAll('.el-tree-node:not(.is-hidden)');
                        // Pass 1: look for a visible leaf node
                        for (const node of nodes) {
                            const icon = node.querySelector('.el-tree-node__expand-icon');
                            const children = node.querySelector('.el-tree-node__children');
                            const isLeaf = !icon || icon.classList.contains('is-leaf') || !children || children.querySelectorAll('.el-tree-node').length === 0;
                            if (isLeaf) {
                                const lbl = node.querySelector('.el-tree-node__label');
                                const labelText = (lbl?.textContent || node.textContent || '').trim();
                                if (lbl) lbl.click(); else node.click();
                                const nodeVm = node.__vue__;
                                if (nodeVm && vm && typeof vm.$emit === 'function') {
                                    const nodeData = nodeVm.data || nodeVm.$data || {};
                                    const code = nodeData.value || nodeData.id || nodeData.code || '';
                                    if (code) vm.$emit('input', code);
                                }
                                resolve(labelText);
                                return;
                            }
                        }
                        // Pass 2: no leaf visible — expand first non-leaf, poll for leaf children
                        for (const node of nodes) {
                            const icon = node.querySelector('.el-tree-node__expand-icon');
                            if (icon && !icon.classList.contains('is-leaf')) {
                                icon.click();
                                setTimeout(() => {
                                    const children = node.querySelector('.el-tree-node__children');
                                    const leafKids = children ? children.querySelectorAll('.el-tree-node:not(.is-hidden)') : [];
                                    for (const child of leafKids) {
                                        const cIcon = child.querySelector('.el-tree-node__expand-icon');
                                        const cChildren = child.querySelector('.el-tree-node__children');
                                        const cIsLeaf = !cIcon || cIcon.classList.contains('is-leaf') || !cChildren || cChildren.querySelectorAll('.el-tree-node').length === 0;
                                        if (cIsLeaf) {
                                            const lbl = child.querySelector('.el-tree-node__label');
                                            const labelText = (lbl?.textContent || child.textContent || '').trim();
                                            if (lbl) lbl.click(); else child.click();
                                            const nodeVm = child.__vue__;
                                            if (nodeVm && vm && typeof vm.$emit === 'function') {
                                                const nodeData = nodeVm.data || nodeVm.$data || {};
                                                const code = nodeData.value || nodeData.id || nodeData.code || '';
                                                if (code) vm.$emit('input', code);
                                            }
                                            resolve(labelText);
                                            return;
                                        }
                                    }
                                    resolve(null);
                                }, 300);
                                return; // async — poll callback will resolve
                            }
                        }
                        resolve(null);
                    } else {
                        elapsed += 200;
                        setTimeout(poll, 200);
                    }
                };
                setTimeout(poll, 300);
            });
            if (result) {
                await new Promise(r => setTimeout(r, 150));
                const verifyVal = readDisplayValue();
                setTimeout(() => {
                    if (typeof vm.handleHideClick === 'function') vm.handleHideClick();
                }, 100);
                if (!verifyVal) {
                    return 'fail: search-click did not update input, clicked=' + result;
                }
                return 'ok-search:' + result;
            }
        }
    }

    // ═══════════════════════════════════════════════════════════════════
    // P2: Last resort — pick the first leaf node from the full tree data.
    // ═══════════════════════════════════════════════════════════════════
    const data = vm.data || [];
    const walkLeaf = (ns) => {
        for (const n of ns) {
            if (!n.children || n.children.length === 0) return n;
            const r = walkLeaf(n.children);
            if (r) return r;
        }
        return null;
    };
    const first = walkLeaf(data);
    if (first) {
        code = first.value || first.id;
        option = first.label || first.value || first.id;
        vm.$emit('input', code);
        await new Promise(r => setTimeout(r, 150));
        const verifyVal = readDisplayValue();
        setTimeout(() => {
            if (typeof vm.handleHideClick === 'function') vm.handleHideClick();
        }, 100);
        if (!verifyVal) {
            return 'fail: fallback emit did not update input for code=' + code;
        }
        return 'ok-fallback:' + option + ' (' + code + ')';
    }
    return 'option-not-found';
}'''

# ── Shared field helpers (referenced by JS_SCAN_FORM_FIELDS and JS_CHECK_SINGLE_FIELD) ──
# 设计意图：disabled/required/classify 判断逻辑在多处重复，抽成共享函数通过字符串拼接引用。
# 修改判断规则时只需改一处，避免 JS_SCAN_FORM_FIELDS 和 JS_CHECK_SINGLE_FIELD 行为不一致。

JS_CLASSIFY_FIELD = '''(item) => {
    if (item.querySelector('.el-date-editor, .tsscdatepicker, [class*="date-picker"], [class*="datepicker"]')) return 'date';
    const el = item.querySelector('input:not([type="hidden"])');
    if (el && el.closest('.el-date-editor, .tsscdatepicker')) return 'date';
    if (el && (el.getAttribute('type') === 'date')) return 'date';
    // Tree-select must be checked BEFORE .el-select — TsscMultiTree wraps .el-select
    // internally so both selectors match, but .my-popover/.tree-popover/.el-tree
    // is unique to tree components.
    if (item.querySelector('.my-popover, .tree-popover, .el-tree')) return 'tree-select';
    if (item.querySelector('.el-select')) return 'select';
    if (item.querySelector('.el-radio')) return 'radio';
    if (item.querySelector('.el-checkbox')) return 'checkbox';
    if (el || item.querySelector('textarea')) return 'input';
    return 'unknown';
}'''

JS_FIELD_DISABLED = '''(inputEl, trigger) => {
    // 只检查原生 disabled 属性，不检查 readOnly。
    // 原因：Element UI 的 el-select 内部 <input> 默认带 readOnly（阻止键盘输入但允许下拉交互）。
    // 如果把 readOnly 当作禁用标志，会导致所有 el-select 被误判为不可填写。
    // 同理不检查 aria-disabled——祖先元素可能通过 aria-disabled 标记整个表单区域为只读，
    // 但实际 input 元素本身并未禁用。
    // 2026-06-29：通过 Edge CDP 连接实际页面验证，readOnly 不等于不可填写。
    if (trigger) return !!(trigger.disabled);
    if (inputEl) return !!(inputEl.disabled);
    return false;
}'''

JS_FIELD_REQUIRED = '''(item, label, inputEl) => {
    const hasRequiredClass = !!(item.matches('.is-required') || item.querySelector('.is-required, .el-form-item__label .el-form-item__label--required'));
    const hasAsterisk = /\\*/.test(label);
    const hasNativeRequired = (inputEl?.required) || (inputEl?.getAttribute('aria-required') === 'true');
    return hasRequiredClass || hasAsterisk || hasNativeRequired;
}'''

JS_READ_CURRENT_VALUE = '''(inputEl, trigger, item) => {
    // Radio / checkbox: input.value is the option's value attribute, NOT selection state.
    // Unchecked radios still have value="1"/value="对公" → must only read checked UI.
    if (item && item.querySelector('.el-radio')) {
        const checked = item.querySelector('.el-radio.is-checked');
        if (!checked) return '';
        const lab = checked.querySelector('.el-radio__label');
        return ((lab && lab.textContent) || checked.textContent || '').replace(/\\s+/g, ' ').trim();
    }
    if (item && item.querySelector('.el-checkbox')) {
        const checkedBoxes = item.querySelectorAll('.el-checkbox.is-checked');
        if (!checkedBoxes.length) return '';
        return [...checkedBoxes].map(c => {
            const lab = c.querySelector('.el-checkbox__label');
            return ((lab && lab.textContent) || c.textContent || '').replace(/\\s+/g, ' ').trim();
        }).filter(Boolean).join(',');
    }
    // 1. primary input/textarea
    let val = inputEl?.value || trigger?.value || '';
    // 2. multi-input fallback (tree-select may have two inputs)
    if (!val) {
        const allInputs = item.querySelectorAll('input:not([type="hidden"])');
        for (const inp of allInputs) {
            if (inp.type === 'radio' || inp.type === 'checkbox') continue;
            if (inp.value && inp.value.trim()) { val = inp.value.trim(); break; }
        }
    }
    // 3. ARIA attributes
    if (!val) {
        const ariaInput = item.querySelector('[aria-valuetext]') || item.querySelector('[aria-valuenow]');
        if (ariaInput) val = ariaInput.getAttribute('aria-valuetext') || ariaInput.getAttribute('aria-valuenow') || '';
    }
    // 4. trigger aria/title fallback
    if (!val && trigger) val = trigger.getAttribute('aria-label') || trigger.getAttribute('title') || '';
    return val;
}'''

# ── Form field scanning ──

JS_SCAN_FORM_FIELDS = '''async ([quick, buttonKeywords]) => {
    const container = ''' + JS_GET_CONTAINER + ''';
    const classify = ''' + JS_CLASSIFY_FIELD + ''';
    const isDisabled = ''' + JS_FIELD_DISABLED + ''';
    const isRequired = ''' + JS_FIELD_REQUIRED + ''';
    const readValue = ''' + JS_READ_CURRENT_VALUE + ''';
    // 从 el-select 的 Vue 组件实例读取 options（不操作 DOM，不受下拉框位置影响）。
    // Element UI 的 Vue 实例挂载在 .el-select 的容器 DIV 上（不是内部 input）。
    const readVueOptions = (trigger) => {
        try {
            // trigger 是 .el-select .el-input__inner（input 元素）
            // __vue__ 在父级 .el-select（div 元素）上
            const selectEl = trigger.closest('.el-select');
            const vm = selectEl && selectEl.__vue__;
            if (vm) {
                // ElSelect 的 options 在 $data.options 或 vm.options
                const data = vm.$data || vm;
                if (data.options && Array.isArray(data.options)) {
                    return data.options.map(o => {
                        if (typeof o === 'string') return o;
                        return o.label || o.value || o.text || String(o);
                    }).filter(Boolean);
                }
                // Vue 3 / alternative: check vm.$props or vm
                const props = vm.$props || vm;
                if (props.options && Array.isArray(props.options)) {
                    return props.options.map(o => {
                        if (typeof o === 'string') return o;
                        return o.label || o.value || o.text || String(o);
                    }).filter(Boolean);
                }
            }
        } catch (e) {}
        return [];
    };
    // Phase 1: 扫描 container 内的所有 .el-form-item
    const allItems = container.querySelectorAll('.el-form-item');
    const fields = [];
    const selectFields = [];  // [{field, trigger}] — Phase 2 从这里读取 options
    for (const item of allItems) {
        // Prefer getBoundingClientRect over offsetParent — Element UI drawers
        // use position:fixed wrappers where offsetParent is often null while visible.
        if (quick) {
            const style = getComputedStyle(item);
            if (style.display === 'none' || style.visibility === 'hidden') continue;
            const rect = item.getBoundingClientRect();
            if (rect.width <= 0 || rect.height <= 0) continue;
        }
        const label = item.querySelector('.el-form-item__label')?.textContent?.trim() || '';
        const input = item.querySelector('input:not([type="hidden"])');
        const textarea = item.querySelector('textarea');
        const trigger = item.querySelector('.el-select .el-input__inner');
        if (!label && !input && !textarea && !trigger) continue;
        const kind = classify(item);
        const inputEl = input || textarea;
        let currentValue = readValue(inputEl, trigger, item);
        const placeholder = (inputEl || trigger)?.getAttribute?.('placeholder') || '';
        // Two-level disabled detection (DOM native → ARIA on element itself)
        const disabled = isDisabled(inputEl, trigger);
        const required = isRequired(item, label, inputEl);
        const selected = !!(trigger && item.querySelector('.el-select-dropdown__item.is-selected, .el-select__tags-text'));
        const hasButton = (() => {
            const btns = item.querySelectorAll('button');
            for (let i = 0; i < btns.length; i++) {
                const t = btns[i].textContent.trim();
                if (buttonKeywords.some(k => t.includes(k))) return t;
            }
            return '';
        })();
        const field = { label, kind, currentValue, options: [], placeholder, required, disabled, selected, hasButton };
        fields.push(field);
        if (kind === 'select') {
            const t = trigger || item.querySelector('input:not([type="hidden"])');
            selectFields.push({ field, trigger: t });
        } else if (kind === 'radio') {
            field.options = [...item.querySelectorAll('.el-radio')].map(r => {
                const lab = r.querySelector('.el-radio__label');
                return ((lab && lab.textContent) || r.textContent || '').replace(/\\s+/g, ' ').trim();
            }).filter(Boolean);
        } else if (kind === 'checkbox') {
            field.options = [...item.querySelectorAll('.el-checkbox')].map(c => {
                const lab = c.querySelector('.el-checkbox__label');
                return ((lab && lab.textContent) || c.textContent || '').replace(/\\s+/g, ' ').trim();
            }).filter(Boolean);
        }
    }
    // Phase 2: 从 Vue 组件实例读取每个 select 的 options。
    // 不打开下拉框——Vue 组件实例存储了完整的 options 数据，精准无污染，
    // 避免读到表格分页下拉、相邻 select 下拉、body 级别残留等无关选项。
    for (const { field, trigger } of selectFields) {
        if (!trigger) continue;
        let opts = readVueOptions(trigger);
        if (opts.length > 0) {
            field.options = opts;
        } else if (field.currentValue) {
            field.options = [field.currentValue];
        }
    }
    // Check for el-notification error popup
    let notification = null;
    for (const notif of document.querySelectorAll('.el-notification')) {
        const r = notif.getBoundingClientRect();
        const s = getComputedStyle(notif);
        if (r.width > 0 && r.height > 0 && s.display !== 'none') {
            notification = { visible: true, text: (notif.textContent || '').trim().replace(/\\s+/g, ' ').substring(0, 300) };
            break;
        }
    }
    const containerId = (() => {
        const c = (() => {
            for (const d of document.querySelectorAll('.el-dialog')) if (d.offsetParent !== null) return d;
            for (const d of document.querySelectorAll('.el-drawer')) if (d.offsetParent !== null) return d;
            return document;
        })();
        if (c === document) return 'main';
        if (c.classList.contains('el-dialog')) {
            const t = (c.querySelector('.el-dialog__title')?.textContent || '').trim() || 'unnamed';
            return 'dialog:' + t;
        }
        if (c.classList.contains('el-drawer')) {
            const l = c.getAttribute('aria-label') || 'unnamed';
            return 'drawer:' + l;
        }
        const tp = c.closest('.el-tab-pane');
        if (tp) {
            const tabs = tp.closest('.el-tabs');
            if (tabs) {
                const a = tabs.querySelector('.el-tabs__item.is-active');
                if (a) return 'tab:' + a.textContent.trim();
            }
        }
        return 'unknown';
    })();
    const result = { container: containerId, fields, notification };
    const json = JSON.stringify(result, null, 2);
    const now = new Date();
    const pad = n => String(n).padStart(2, '0');
    const scanTime = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
    const summary = { input:0, select:0, date:0, radio:0, checkbox:0, unknown:0, total:fields.length };
    fields.forEach(f => { if (summary[f.kind] !== undefined) summary[f.kind]++; });
    console.log('[AI填表] ====== 扫描的表单字段 ====== ' + scanTime + ' | ' +
        `input:${summary.input} select:${summary.select} date:${summary.date} radio:${summary.radio} checkbox:${summary.checkbox} total:${summary.total}`);
    console.log(json);
    return json;
}'''

JS_CHECK_SINGLE_FIELD = '''([label, buttonKeywords]) => {
    const container = ''' + JS_GET_CONTAINER + ''';
    const classify = ''' + JS_CLASSIFY_FIELD + ''';
    const isDisabled = ''' + JS_FIELD_DISABLED + ''';
    const isRequired = ''' + JS_FIELD_REQUIRED + ''';
    const readValue = ''' + JS_READ_CURRENT_VALUE + ''';
    for (let pass = 1; pass <= 2; pass++) {
        const exact = pass === 1;
        for (const item of container.querySelectorAll('.el-form-item')) {
            const lbl = item.querySelector('.el-form-item__label')?.textContent?.trim() || '';
            if (exact) { if (lbl !== label) continue; }
            else { if (lbl === label || !lbl.includes(label)) continue; }
            const input = item.querySelector('input:not([type="hidden"])');
            const textarea = item.querySelector('textarea');
            const trigger = item.querySelector('.el-select .el-input__inner');
            const kind = classify(item);
            const inputEl = input || textarea;
            let currentValue = readValue(inputEl, trigger, item);
            const placeholder = (inputEl || trigger)?.getAttribute?.('placeholder') || '';
            const disabled = isDisabled(inputEl, trigger);
            const selected = !!(trigger && item.querySelector('.el-select-dropdown__item.is-selected, .el-select__tags-text'));
            const hasButton = (() => {
                const btns = item.querySelectorAll('button');
                for (let i = 0; i < btns.length; i++) {
                    const t = btns[i].textContent.trim();
                    if (buttonKeywords.some(k => t.includes(k))) return t;
                }
                return '';
            })();
            const required = isRequired(item, lbl, inputEl);
            return JSON.stringify({ label: lbl, kind, currentValue, placeholder, disabled, selected, required, hasButton });
        }
    }
    return 'label-not-found';
}'''

JS_SCROLL_TO_FIRST_ERROR = '''() => {
    const container = ''' + JS_GET_CONTAINER + ''';
    // Pass 1: .el-form-item.is-error (Element UI sets this class on validation fail)
    const errorItems = container.querySelectorAll('.el-form-item.is-error');
    for (const item of errorItems) {
        if (item.offsetParent === null) continue;
        const errEl = item.querySelector('.el-form-item__error');
        if (errEl && errEl.offsetParent !== null && errEl.textContent.trim()) {
            item.scrollIntoView({ block: 'center', behavior: 'instant' });
            const label = (item.querySelector('.el-form-item__label')?.textContent || '').trim();
            const error = errEl.textContent.trim();
            return JSON.stringify({ label, error });
        }
    }
    // Pass 2: any visible .el-form-item__error (some custom forms don't set is-error)
    const allErrors = container.querySelectorAll('.el-form-item__error');
    for (const err of allErrors) {
        if (err.offsetParent === null || !err.textContent.trim()) continue;
        const item = err.closest('.el-form-item');
        if (item && item.offsetParent !== null) {
            item.scrollIntoView({ block: 'center', behavior: 'instant' });
            const label = (item.querySelector('.el-form-item__label')?.textContent || '').trim();
            return JSON.stringify({ label, error: err.textContent.trim() });
        }
    }
    return JSON.stringify({ label: '', error: '' });
}'''

# Find 保存/提交 (or custom text), scrollIntoView, click. Prefer footer / primary.
# Arg: buttonText string (default 保存). Returns JSON {ok, text, xpath, reason}.
JS_CLICK_SAVE_BUTTON = r'''(buttonText) => {
  const needle = String(buttonText || '保存').trim() || '保存';
  const rejectRe = /查询|返回|取消|关闭|重置|清空|删除|导出|引入|核查|上传|下载|暂存/;
  const isVisible = (el) => {
    if (!el || el.offsetParent === null && el.tagName !== 'BODY') {
      const r0 = el.getBoundingClientRect();
      if (!(r0.width > 0 && r0.height > 0)) return false;
    }
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && cs.opacity !== '0';
  };
  const btnText = (el) => (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
  const absXPath = (node) => {
    if (!node || node.nodeType !== 1) return '';
    const parts = [];
    let cur = node;
    while (cur && cur.nodeType === 1) {
      const tag = cur.tagName.toLowerCase();
      const parent = cur.parentNode;
      if (!parent) break;
      const sibs = [...parent.children].filter(c => c.tagName === cur.tagName);
      const idx = sibs.indexOf(cur) + 1;
      parts.unshift(tag + '[' + idx + ']');
      cur = parent;
      if (cur === document.documentElement) {
        parts.unshift('html[1]');
        break;
      }
    }
    return '/' + parts.join('/');
  };
  const scoreBtn = (el, text) => {
    let s = 0;
    if (text === needle) s += 100;
    else if (text.startsWith(needle)) s += 80;
    else if (text.includes(needle)) s += 50;
    else return -1;
    if (rejectRe.test(text) && text !== needle) return -1;
    if (el.classList.contains('el-button--primary') || el.classList.contains('el-button--success')) s += 30;
    if (el.closest('.el-dialog__footer, .el-drawer__footer, .el-message-box__btns, .dialog-footer, .form-footer, .footer-btns, [class*="footer"]')) s += 40;
    if (el.closest('.el-dialog, .el-drawer, .el-message-box')) s += 10;
    // Prefer page-level 保存 over nested utility dialogs (查询/返回)
    const overlay = el.closest('.el-dialog, .el-drawer, .el-message-box');
    if (overlay && /查询|返回|核查|核验/.test(btnText(overlay.querySelector('.el-dialog__title, .el-drawer__title, .el-message-box__title') || overlay))) {
      if (text === needle) s -= 5;
    }
    return s;
  };
  const selectors = 'button, .el-button, [role="button"], a.el-button';
  let best = null;
  let bestScore = -1;
  let bestText = '';
  for (const el of document.querySelectorAll(selectors)) {
    if (!isVisible(el)) continue;
    if (el.disabled || el.getAttribute('disabled') != null || el.classList.contains('is-disabled')) continue;
    const text = btnText(el);
    if (!text || text.length > 40) continue;
    const sc = scoreBtn(el, text);
    if (sc > bestScore) {
      bestScore = sc;
      best = el;
      bestText = text;
    }
  }
  if (!best || bestScore < 0) {
    return JSON.stringify({ ok: false, reason: 'button-not-found', needle });
  }
  try {
    best.scrollIntoView({ block: 'center', behavior: 'instant' });
  } catch (e) {}
  best.click();
  return JSON.stringify({
    ok: true,
    text: bestText,
    xpath: absXPath(best),
    tag: (best.tagName || '').toLowerCase(),
  });
}'''

# After submit: scan visible form errors + notifications / el-message.
JS_SCAN_SAVE_OUTCOME = r'''() => {
  const isVisible = (el) => {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none';
  };
  const formErrors = [];
  for (const el of document.querySelectorAll('.el-form-item__error')) {
    if (!isVisible(el)) continue;
    const error = (el.textContent || '').trim();
    if (!error) continue;
    const item = el.closest('.el-form-item');
    const label = ((item && item.querySelector('.el-form-item__label'))
      ? item.querySelector('.el-form-item__label').textContent
      : '').replace(/\s+/g, ' ').trim();
    formErrors.push({ label, error: error.slice(0, 120) });
  }
  const successRe = /操作成功|保存成功|提交成功|新建成功|修改成功|删除成功/;
  const failRe = /失败|错误|异常|不能|不允许|已存在|重复|校验|必填|不通过/;
  const successNotifs = [];
  const errorNotifs = [];
  const collect = (el) => {
    if (!isVisible(el)) return;
    const t = (el.textContent || '').replace(/\s+/g, ' ').trim();
    if (!t) return;
    if (successRe.test(t) && !failRe.test(t)) successNotifs.push(t.slice(0, 160));
    else if (failRe.test(t) || /el-notification--error|el-message--error|el-message--warning/.test(el.className || ''))
      errorNotifs.push(t.slice(0, 160));
    else if (el.classList && (el.classList.contains('el-notification--success') || el.classList.contains('el-message--success')))
      successNotifs.push(t.slice(0, 160));
  };
  for (const el of document.querySelectorAll('.el-notification, .el-message')) collect(el);
  return {
    formErrors,
    successNotifs,
    errorNotifs,
    url: location.href,
  };
}'''

# ── Click locator enrichment (AI click_element_by_index → xpath_smart) ──
# Args: [xpath, text, tagHint] — resolve node BEFORE click; walk up to button/a.
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

_JS_ICON_BUTTON_HELPERS = r'''
function _iconNormText(s) { return (s || '').replace(/\s+/g, ' ').trim(); }
function _iconShortLabel(text) {
  const t = _iconNormText(text);
  // Icon tooltips are short labels (e.g. 「新增一级分类」); reject menu dumps.
  if (!t || t.length > 40 || t.split(/\s+/).length > 6) return '';
  return t;
}
function _iconHasIconClass(el) {
  const cls = typeof el.className === 'string' ? el.className : '';
  if (/(?:^|\s)el-icon-[\w-]+/.test(cls) || /(?:^|\s)el-icon(?:\s|$)/.test(cls)) return true;
  return !!el.querySelector('[class*="el-icon-"], i[class*="icon"]');
}
function _iconIsExcludedHost(el) {
  const cls = typeof el.className === 'string' ? el.className : '';
  if (/(?:^|\s)el-popover__reference(?:\s|$)/.test(cls)) return true;
  if (/(?:^|\s)el-dropdown(?:\s|$)/.test(cls)) return true;
  if (/(?:^|\s)el-submenu(?:\s|$)/.test(cls)) return true;
  if (/(?:^|\s)el-menu-item(?:\s|$)/.test(cls)) return true;
  if (/(?:^|\s)header__action-item(?:\s|$)/.test(cls)) return true;
  if (el.closest('.el-menu, .el-submenu, .el-dropdown-menu, .el-select-dropdown, .el-pagination')) return true;
  // Real icon buttons are textless (or nearly); hosts with own body text are menus/search.
  const own = _iconNormText(el.innerText || '');
  if (own.length > 8) return true;
  return false;
}
function _iconTooltipEl(el) {
  const id = el.getAttribute('aria-describedby');
  if (!id) return null;
  const tip = document.getElementById(id);
  if (!tip) return null;
  // Only accept Element UI tooltip poppers — not popover/menu panels.
  const role = (tip.getAttribute('role') || '').toLowerCase();
  const tipCls = typeof tip.className === 'string' ? tip.className : '';
  if (role === 'tooltip' || /(?:^|\s)el-tooltip__popper(?:\s|$)/.test(tipCls)) return tip;
  return null;
}
function _iconTooltipText(el) {
  const tip = _iconTooltipEl(el);
  if (!tip) return '';
  const clone = tip.cloneNode(true);
  clone.querySelectorAll('.popper__arrow,[x-arrow]').forEach(n => n.remove());
  return _iconShortLabel(clone.textContent);
}
function _iconVueContent(el) {
  // Element UI ElTooltip keeps `content` on the Vue instance even before first
  // hover (aria-describedby / popper may be absent until then).
  try {
    let cur = el;
    for (let i = 0; i < 3 && cur; i++) {
      const v = cur.__vue__;
      if (v) {
        const raw = (v.content != null) ? v.content
          : (v.$props && v.$props.content != null ? v.$props.content : null);
        const short = _iconShortLabel(typeof raw === 'string' ? raw : '');
        if (short) return short;
      }
      cur = cur.parentElement;
    }
  } catch (e) {}
  return '';
}
function _iconResolveLabel(el) {
  const fromAttr = _iconShortLabel(el.getAttribute('aria-label'))
    || _iconShortLabel(el.getAttribute('title'));
  if (fromAttr) return fromAttr;
  return _iconTooltipText(el) || _iconVueContent(el);
}
function _iconCandidates(root) {
  // Include el-tooltip+el-icon hosts even without aria-describedby (pre-hover).
  const sel = [
    '[aria-describedby][class*="el-icon"]',
    '[aria-describedby].el-tooltip',
    '.el-tooltip[class*="el-icon"]',
  ].join(', ');
  const out = [];
  const seen = new Set();
  for (const el of (root || document).querySelectorAll(sel)) {
    if (seen.has(el)) continue;
    seen.add(el);
    if (!_iconHasIconClass(el)) continue;
    if (_iconIsExcludedHost(el)) continue;
    out.push(el);
  }
  return out;
}
function _iconIsVisible(el) {
  return el.offsetParent !== null || !!el.closest('.el-table__fixed');
}
'''

JS_STAMP_ICON_ARIA_LABELS = r'''() => {
''' + _JS_ICON_BUTTON_HELPERS + r'''
  let n = 0;
  for (const el of _iconCandidates(document)) {
    const existing = _iconShortLabel(el.getAttribute('aria-label'))
      || _iconShortLabel(el.getAttribute('title'));
    if (existing) continue;
    const tip = _iconResolveLabel(el);
    if (!tip) continue;
    el.setAttribute('aria-label', tip);
    n++;
  }
  return n;
}'''

# Page toolbars (tree action icons etc.) live outside dialogs — always scan document.
JS_COLLECT_ICON_BUTTONS = r'''() => {
''' + _JS_ICON_BUTTON_HELPERS + r'''
  const iconButtons = [];
  const seen = new Set();
  for (const el of _iconCandidates(document)) {
    if (!_iconIsVisible(el)) continue;
    const text = _iconResolveLabel(el);
    if (!text) continue;
    const className = typeof el.className === 'string' ? el.className : '';
    const key = text + '|' + className;
    if (seen.has(key)) continue;
    seen.add(key);
    iconButtons.push({ text, className });
  }
  return iconButtons;
}'''

JS_CLICK_ICON_BUTTON = r'''(buttonText) => {
''' + _JS_ICON_BUTTON_HELPERS + r'''
  if (!buttonText) return 'button-text-empty';
  for (const el of _iconCandidates(document)) {
    if (!_iconIsVisible(el)) continue;
    const label = _iconResolveLabel(el);
    if (label === buttonText || (label && label.includes(buttonText))) {
      el.scrollIntoView({ block: 'center', behavior: 'instant' });
      el.click();
      return 'ok';
    }
  }
  return 'not-found';
}'''

# Lightweight page snapshot for scenario describer (no iconButtons / no side effects).
JS_SCENARIO_PAGE_SNAPSHOT = r'''() => {
  const isVis = (el) => {
    if (!el) return false;
    if (el.offsetParent === null && !el.closest('.el-table__fixed')) return false;
    const st = getComputedStyle(el);
    return st.display !== 'none' && st.visibility !== 'hidden';
  };
  const dialogs = document.querySelectorAll('.el-dialog');
  const visibleDialogs = [...dialogs].filter(d => d.offsetParent !== null);
  const drawers = document.querySelectorAll('.el-drawer');
  const visibleDrawers = [...drawers].filter(d => d.offsetParent !== null);
  const formErrors = [];
  const seen = new Set();
  for (const el of document.querySelectorAll('.el-form-item__error')) {
    const error = (el.textContent || '').trim();
    if (!error) continue;
    const formItem = el.closest('.el-form-item');
    const label = (formItem && formItem.querySelector('.el-form-item__label')
      ? formItem.querySelector('.el-form-item__label').textContent.trim()
      : '');
    const key = label + '|' + error;
    if (seen.has(key)) continue;
    seen.add(key);
    formErrors.push({ label, error });
  }
  const loading = [...document.querySelectorAll('.el-loading-mask')].some(m => {
    if (m.classList.contains('el-loading-mask--hidden')) return false;
    return isVis(m);
  });
  return {
    url: location.href,
    title: (document.title || '').trim(),
    visibleDialogCount: visibleDialogs.length,
    visibleDialogTitles: visibleDialogs.map(
      d => d.querySelector('.el-dialog__title')?.textContent?.trim() || ''
    ).filter(Boolean).slice(0, 3),
    drawerCount: visibleDrawers.length,
    loading,
    formErrors: formErrors.slice(0, 8),
    activeTab: document.querySelector('.el-tabs__item.is-active')?.textContent?.trim() || null,
    messages: [...document.querySelectorAll('.el-message')]
      .map(e => e.textContent.trim()).filter(Boolean).slice(0, 3),
    notifications: [...document.querySelectorAll('.el-notification')]
      .filter(e => e.offsetParent !== null)
      .map(e => e.textContent.trim()).filter(Boolean).slice(0, 3),
  };
}'''

# Align with src/ctrl-actions.js CTRL.verifyFormStructure
JS_VERIFY_FORM_STRUCTURE = '''(expectedFields) => {
    const container = ''' + JS_GET_CONTAINER + ''';
    const items = container.querySelectorAll('.el-form-item');
    const actualLabels = [];
    for (const item of items) {
        const lbl = item.querySelector('.el-form-item__label');
        if (lbl) actualLabels.push(lbl.textContent.trim());
    }
    const expected = Array.isArray(expectedFields) ? expectedFields : [];
    const expectedLabels = expected.map(f => f.label || f);
    const requiredLabels = expected.filter(f => f.is_required || f.isRequired).map(f => f.label);
    const optionalLabels = expected.filter(f => !(f.is_required || f.isRequired)).map(f => f.label);
    const missing_required = requiredLabels.filter(l => !actualLabels.includes(l));
    const missing_optional = optionalLabels.filter(l => !actualLabels.includes(l));
    const added_all = actualLabels.filter(l => !expectedLabels.includes(l));
    const added_required = [];
    const added_optional = [];
    for (const lbl of added_all) {
        let isReq = false;
        for (const item of items) {
            const itemLbl = item.querySelector('.el-form-item__label');
            if (itemLbl && itemLbl.textContent.trim() === lbl) {
                isReq = !!(item.matches('.is-required')
                    || item.querySelector('.is-required, .el-form-item__label .el-form-item__label--required')
                    || /\\*/.test(lbl));
                break;
            }
        }
        if (isReq) added_required.push(lbl);
        else added_optional.push(lbl);
    }
    const hasRequiredChange = missing_required.length > 0 || added_required.length > 0;
    const hasOptionalChange = missing_optional.length > 0 || added_optional.length > 0;
    let reordered = false;
    if (!hasRequiredChange && !hasOptionalChange && actualLabels.length === expectedLabels.length) {
        for (let i = 0; i < expectedLabels.length; i++) {
            if (expectedLabels[i] !== actualLabels[i]) { reordered = true; break; }
        }
    }
    return JSON.stringify({
        ok: !hasRequiredChange,
        count: actualLabels.length,
        expected_count: expectedLabels.length,
        required_count: requiredLabels.length,
        optional_count: optionalLabels.length,
        missing_required, missing_optional,
        added_required, added_optional,
        hasRequiredChange, hasOptionalChange, reordered,
        fields: actualLabels,
    });
}'''
