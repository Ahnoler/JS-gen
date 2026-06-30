"""
JS code snippets injected into the browser via page.evaluate().

These are pure string constants used by controller actions to interact
with Element UI / Vue components. Several constants reference
JS_GET_CONTAINER via string concatenation — all MUST remain in this
single module to satisfy Python module-level concat evaluation order.
"""

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
    const container = ''' + JS_GET_CONTAINER + ''';
    const items = container.querySelectorAll('.el-form-item');
    for (const item of items) {
        const lbl = item.querySelector('.el-form-item__label')?.textContent?.trim() || '';
        if (lbl !== label && !lbl.includes(label)) continue;
        const target = item.querySelector('input:not([type="hidden"]), textarea, .el-select .el-input__inner');
        if (!target) continue;
        const tag = target.tagName.toLowerCase();
        const attrs = {};
        for (const a of target.attributes) if (a.value && a.value.length > 0) attrs[a.name] = a.value;
        const id = target.id;
        let xpath = '';
        if (id && !/^\\d{4,}$/.test(id) && !/^el-id-/.test(id)) xpath = `//${tag}[@id="${id}"]`;
        if (!xpath && target.placeholder && !target.closest('.el-select')) xpath = `//${tag}[@placeholder="${target.placeholder}"]`;
        if (!xpath && target.name) xpath = `//${tag}[@name="${target.name}"]`;
        if (!xpath && target.type && tag !== 'textarea') xpath = `//${tag}[@type="${target.type}"]`;
        if (!xpath) xpath = `//${tag}[@class="${(target.getAttribute('class')||'').split(' ').filter(Boolean).join(' ')}"]`;
        return JSON.stringify({xpath, tag, attrs});
    }
    for (const inp of container.querySelectorAll('input:not([type="hidden"]), textarea')) {
        const ph = inp.placeholder || '';
        if (ph.includes(label) && inp.offsetParent !== null) {
            const tag = inp.tagName.toLowerCase();
            return JSON.stringify({xpath: `//${tag}[@placeholder="${ph}"]`, tag, attrs: {placeholder: ph}});
        }
    }
    return '';
}'''

# ── Fill form field ──

JS_FILL_FORM_FIELD = '''([label, val]) => {
    const setFn = (t, v) => {
        const TagProto = t.tagName === 'TEXTAREA' ? HTMLTextAreaElement : HTMLInputElement;
        const setter = Object.getOwnPropertyDescriptor(TagProto.prototype, 'value').set;
        setter.call(t, v);
        t.setAttribute('value', v);
        t.dispatchEvent(new Event('input', {bubbles:true}));
        t.dispatchEvent(new Event('change', {bubbles:true}));
        t.dispatchEvent(new Event('blur', {bubbles:true}));
    };
    const container = ''' + JS_GET_CONTAINER + ''';
    const items = container.querySelectorAll('.el-form-item');
    // Pass 1: exact label match
    for (const item of items) {
        const lbl = item.querySelector('.el-form-item__label')?.textContent?.trim() || '';
        if (lbl !== label) continue;
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
            // 2. Attribute value (may persist even if property cleared)
            const av = (trigger.getAttribute('value') || '').trim();
            if (av) return av;
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
    const container = ''' + JS_GET_CONTAINER + ''';
    const items = container.querySelectorAll('.el-form-item');
    // Pass 1: exact label match
    for (let pass = 1; pass <= 2; pass++) {
        const exact = pass === 1;
        for (const item of items) {
            const lbl = item.querySelector('.el-form-item__label')?.textContent?.trim() || '';
            if (exact) { if (lbl !== label) continue; }
            else { if (lbl === label || !lbl.includes(label)) continue; }
        const trigger = item.querySelector('.el-select .el-input__inner');
        if (!trigger && mode === 'trigger') return 'no-select-found';
        if (!trigger) continue;
        if (mode === 'check') {
            const cur = getSelectedLabel(item);
            if (cur) return 'already:' + cur;
            return 'not-filled';
        }
        if (mode === 'trigger') {
            if (trigger.disabled) return 'select-disabled';
            // tssc-multi-select needs real mouse events, not just .click()
            trigger.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
            trigger.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
            trigger.click();
            return 'triggered';
        }
        if (mode === 'confirm') {
            const cur = getSelectedLabel(item);
            if (cur) return 'SELECTED:' + cur;
            return 'NOT-SELECTED';
        }
        return 'unknown-mode';
    }
    }
    const allSelects = container.querySelectorAll('.el-select .el-input__inner');
    if (mode === 'check') {
        for (const sel of allSelects) {
            if (sel.offsetParent !== null) {
                const v = (sel.value || '').trim();
                if (v.length > 0) return 'already:' + v;
                const t = (sel.textContent || '').trim();
                if (t.length > 0 && !t.includes('请选择')) return 'already:' + t;
                break;
            }
        }
        return 'not-filled';
    }
    if (mode === 'trigger') {
        for (const sel of allSelects) {
            const ph = sel.getAttribute('placeholder') || '';
            if (ph.includes(label) && !sel.disabled && sel.offsetParent !== null) { sel.click(); return 'triggered'; }
        }
        for (const sel of allSelects) {
            if (!sel.disabled && sel.offsetParent !== null) { sel.click(); return 'triggered'; }
        }
        return 'label-not-found';
    }
    if (mode === 'confirm') {
        for (const sel of allSelects) {
            if (sel.offsetParent !== null) {
                const v = (sel.value || '').trim();
                if (v) return 'SELECTED:' + v;
            }
        }
        return 'NOT-SELECTED';
    }
    return 'unknown-mode';
}'''

JS_FIND_VISIBLE_DROPDOWN = '''(() => {
    const dropdowns = document.querySelectorAll('.el-select-dropdown');
    for (const dd of dropdowns) {
        if (dd.offsetParent !== null && !dd.classList.contains('is-hidden')) return dd;
    }
    return document;
})()'''

JS_SELECT_OPTION = '''(option) => {
    const dropdown = ''' + JS_FIND_VISIBLE_DROPDOWN + ''';
    let items = dropdown.querySelectorAll('.el-select-dropdown__item');
    if (items.length === 0 || dropdown === document) {
        items = document.querySelectorAll('.el-select-dropdown__item');
    }
    const FIRST_ALIASES = ['first', '1st', '第一个', '第一项'];
    const tryClick = (item) => {
        item.scrollIntoView({ block: 'nearest' });
        item.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        item.click();
        const t = item.textContent.trim();
        return 'ok:' + t;
    };
    if (FIRST_ALIASES.includes(option.toLowerCase().trim())) {
        for (const item of items) {
            if (item.offsetParent !== null) { return tryClick(item); }
        }
        if (items.length > 0) { return tryClick(items[0]); }
        return 'no-items';
    }
    for (const item of items) {
        if (item.textContent.trim() === option) {
            return tryClick(item);
        }
    }
    for (const item of items) {
        if (item.textContent.trim().includes(option)) {
            return tryClick(item);
        }
    }
    const hasEmpty = document.querySelector('.el-select-dropdown__empty');
    if (hasEmpty) {
        return 'no-items';
    }
    return 'option-not-found:' + [...items].map(i => i.textContent.trim()).join(', ');
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

JS_SELECT_TREE_OPTION = '''([label, option]) => {
    // Open the popover first so tree DOM is rendered
    const container = ''' + JS_GET_CONTAINER + ''';
    const items = container.querySelectorAll('.el-form-item');
    let fieldItem = null;
    for (const item of items) {
        const l = item.querySelector('.el-form-item__label')?.textContent?.trim() || '';
        if (l === label || l.includes(label)) { fieldItem = item; break; }
    }
    if (!fieldItem) return 'label-not-found';
    const input = fieldItem.querySelector('input');
    if (!input) return 'no-input';
    if (input.disabled || input.readOnly) return 'disabled';
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

    // Search treeData for matching label
    let code = null;
    const treeData = vm.treeData || [];
    for (const node of treeData) {
        if (node.label === option) { code = node.value || node.id; break; }
        if (node.label && node.label.includes(option) && !code) { code = node.value || node.id; }
    }
    if (!code) {
        // Fallback: search in data
        const walk = (nodes) => {
            for (const n of nodes) {
                if (n.label === option) return n.value || n.id;
                if (n.label && n.label.includes(option)) return n.value || n.id;
                if (n.children) { const r = walk(n.children); if (r) return r; }
            }
            return null;
        };
        code = walk(vm.data || []);
    }
    // P0: exact/partial match in treeData → select via Vue API
    if (code) {
        vm.$emit('input', code);
        setTimeout(() => {
            if (typeof vm.handleHideClick === 'function') vm.handleHideClick();
        }, 100);
        return 'ok:' + option + ' (' + code + ')';
    }

    // P1: no match → search UI with keyword → click first visible leaf
    const popover = document.querySelector('.tree-popover');
    if (popover) {
        const searchInput = popover.querySelector('input');
        const searchBtn = popover.querySelector('button');
        if (searchInput && searchBtn) {
            const s = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
            s.call(searchInput, option || '科技');
            searchInput.dispatchEvent(new InputEvent('input', { bubbles: true }));
            setTimeout(() => { searchBtn.click(); }, 200);
            const result = await new Promise(resolve => {
                setTimeout(() => {
                    const nodes = document.querySelectorAll('.el-tree-node:not(.is-hidden)');
                    for (const node of nodes) {
                        const icon = node.querySelector('.el-tree-node__expand-icon');
                        const children = node.querySelector('.el-tree-node__children');
                        const isLeaf = !icon || icon.classList.contains('is-leaf') || !children;
                        if (isLeaf) {
                            const lbl = node.querySelector('.el-tree-node__label');
                            if (lbl) lbl.click(); else node.click();
                            resolve((lbl?.textContent || node.textContent || '').trim());
                            return;
                        }
                    }
                    resolve(null);
                }, 1000);
            });
            if (result) {
                setTimeout(() => {
                    if (typeof vm.handleHideClick === 'function') vm.handleHideClick();
                }, 100);
                return 'ok-search:' + result;
            }
        }
    }

    // P2: search returned no results → pick first leaf from tree data
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
        setTimeout(() => {
            if (typeof vm.handleHideClick === 'function') vm.handleHideClick();
        }, 100);
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
    if (item.querySelector('.el-select')) return 'select';
    // Tree-select: custom TsscMultiTree component (e.g. 行业代码).
    // The popover wrapper (.my-popover / .tree-popover) is always in the DOM
    // even when collapsed — detect it before classifying as plain 'input'.
    if (item.querySelector('.my-popover, .tree-popover')) return 'tree-select';
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

# ── Form field scanning ──

JS_SCAN_FORM_FIELDS = '''async (quick) => {
    const container = ''' + JS_GET_CONTAINER + ''';
    const classify = ''' + JS_CLASSIFY_FIELD + ''';
    const isDisabled = ''' + JS_FIELD_DISABLED + ''';
    const isRequired = ''' + JS_FIELD_REQUIRED + ''';
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
        if (quick && (item.offsetParent === null)) continue;
        const label = item.querySelector('.el-form-item__label')?.textContent?.trim() || '';
        const input = item.querySelector('input:not([type="hidden"])');
        const textarea = item.querySelector('textarea');
        const trigger = item.querySelector('.el-select .el-input__inner');
        if (!label && !input && !textarea && !trigger) continue;
        const kind = classify(item);
        const inputEl = input || textarea;
        let currentValue = inputEl?.value || trigger?.value || '';
        if (!currentValue) {
            const ariaInput = item.querySelector('[aria-valuetext]') || item.querySelector('[aria-valuenow]');
            if (ariaInput) currentValue = ariaInput.getAttribute('aria-valuetext') || ariaInput.getAttribute('aria-valuenow') || '';
        }
        if (!currentValue && trigger) currentValue = trigger.getAttribute('aria-label') || trigger.getAttribute('title') || '';
        const placeholder = (inputEl || trigger)?.getAttribute?.('placeholder') || '';
        // Two-level disabled detection (DOM native → ARIA on element itself)
        const disabled = isDisabled(inputEl, trigger);
        const required = isRequired(item, label, inputEl);
        const selected = !!(trigger && item.querySelector('.el-select-dropdown__item.is-selected, .el-select__tags-text'));
        const hasButton = !!item.querySelector('button.el-button--primary, button.el-button--primary.is-plain') ||
            ['选择','获取地址','引入','新增','添加'].some(t => {
                const btns = item.querySelectorAll('button');
                for (let i = 0; i < btns.length; i++) {
                    if (btns[i].textContent.includes(t)) return true;
                }
                return false;
            });
        const field = { label, kind, currentValue, options: [], placeholder, required, disabled, selected, hasButton };
        fields.push(field);
        if (kind === 'select') {
            const t = trigger || item.querySelector('input:not([type="hidden"])');
            selectFields.push({ field, trigger: t });
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

JS_CHECK_SINGLE_FIELD = '''(label) => {
    const container = ''' + JS_GET_CONTAINER + ''';
    const classify = ''' + JS_CLASSIFY_FIELD + ''';
    const isDisabled = ''' + JS_FIELD_DISABLED + ''';
    const isRequired = ''' + JS_FIELD_REQUIRED + ''';
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
            let currentValue = inputEl?.value || trigger?.value || '';
            if (!currentValue) {
                const ariaInput = item.querySelector('[aria-valuetext]') || item.querySelector('[aria-valuenow]');
                if (ariaInput) currentValue = ariaInput.getAttribute('aria-valuetext') || ariaInput.getAttribute('aria-valuenow') || '';
            }
            if (!currentValue && trigger) currentValue = trigger.getAttribute('aria-label') || trigger.getAttribute('title') || '';
            const placeholder = (inputEl || trigger)?.getAttribute?.('placeholder') || '';
            const disabled = isDisabled(inputEl, trigger);
            const selected = !!(trigger && item.querySelector('.el-select-dropdown__item.is-selected, .el-select__tags-text'));
            const hasButton = !!item.querySelector('button.el-button--primary, button.el-button--primary.is-plain') ||
                ['选择','获取地址','引入','新增','添加'].some(t => {
                    const btns = item.querySelectorAll('button');
                    for (let i = 0; i < btns.length; i++) {
                        if (btns[i].textContent.includes(t)) return true;
                    }
                    return false;
                });
            const required = isRequired(item, lbl, inputEl);
            return JSON.stringify({ label: lbl, kind, currentValue, placeholder, disabled, selected, required, hasButton });
        }
    }
    return 'label-not-found';
}'''
