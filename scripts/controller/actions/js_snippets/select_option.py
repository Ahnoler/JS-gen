"""
JS snippet constants: JS_SELECT_OPTION, JS_READ_SELECT_OPTIONS, JS_FIND_OPTION (extracted from _js_snippets.py).
Re-exported by scripts/controller/actions/_js_snippets.py for backward compat.
"""
from .select_trigger import JS_FIND_VISIBLE_DROPDOWN

JS_SELECT_OPTION = '''async (arg) => {
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
    const ddUsable = (dd) => {
        if (!dd || dd.classList.contains('is-hidden')) return false;
        const style = getComputedStyle(dd);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
        // Accept width>0 even when height is still 0 (enter animation / remote table).
        return dd.getBoundingClientRect().width > 0;
    };
    if (triggerInput) {
        // Element UI often sets aria-owns / aria-controls on the input wrapper
        const owned = triggerInput.getAttribute('aria-controls')
            || triggerInput.getAttribute('aria-owns')
            || triggerInput.closest('.el-select')?.getAttribute('aria-owns');
        if (owned) {
            const byId = document.getElementById(owned);
            if (ddUsable(byId)) dropdown = byId;
        }
        // Popper may sit next to the select; pick the visible dropdown nearest the trigger
        if (!dropdown) {
            const tr = triggerInput.getBoundingClientRect();
            let best = null, bestDist = Infinity;
            for (const dd of document.querySelectorAll('.el-select-dropdown')) {
                if (!ddUsable(dd)) continue;
                const rect = dd.getBoundingClientRect();
                const dist = Math.abs(rect.top - tr.bottom) + Math.abs(rect.left - tr.left);
                // Prefer dropdown that already has options / table rows
                const rich = dd.querySelectorAll(
                    '.el-select-dropdown__item, tr.el-table__row'
                ).length;
                const score = dist - (rich ? 10000 : 0);
                if (score < bestDist) { bestDist = score; best = dd; }
            }
            dropdown = best;
        }
    }
    if (!dropdown) {
        dropdown = ''' + JS_FIND_VISIBLE_DROPDOWN + ''';
    }
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    /* SELECT_TABLE_ROW_OPTIONS — TsscMultiSelect remote picker uses el-table rows */
    const collectTableRows = (root) => {
        if (!root || root === document) return [];
        return root.querySelectorAll(
            '.el-table__body-wrapper tr.el-table__row, .el-table__body tr.el-table__row, tr.el-table__row'
        );
    };
    const openDropdownRoots = () => {
        const roots = [];
        const push = (dd) => {
            if (!dd || dd === document || roots.includes(dd)) return;
            if (dd.classList.contains('is-hidden')) return;
            const st = getComputedStyle(dd);
            if (st.display === 'none' || st.visibility === 'hidden') return;
            // Opening animation often has width>0 but height=0 — still accept.
            if (dd.getBoundingClientRect().width <= 0) return;
            roots.push(dd);
        };
        push(dropdown);
        for (const dd of document.querySelectorAll('.el-select-dropdown')) push(dd);
        return roots;
    };
    const collectItems = () => {
        for (const root of openDropdownRoots()) {
            // Prefer table rows when present (TsscMultiSelect); plain el-option second.
            const rows = collectTableRows(root);
            if (rows.length) return rows;
            const items = root.querySelectorAll('.el-select-dropdown__item');
            if (items.length) return items;
        }
        return [];
    };
    const optionLabel = (el) => {
        if (!el) return '';
        // Prefer first non-numeric body cell (客户名称); skip 客户编号-only cells.
        const cells = el.querySelectorAll ? el.querySelectorAll('td .cell, td') : [];
        for (const cell of cells) {
            const cellText = String(cell.textContent || '').replace(/\\s+/g, ' ').trim();
            if (cellText && !/^\\d+$/.test(cellText)) return cellText;
        }
        return String(el.textContent || '').replace(/\\s+/g, ' ').trim();
    };
    const labelMatches = (lab, want) => {
        if (!want) return false;
        if (lab === want) return true;
        // Table-select often glues name+id in textContent: 国讯网络有限公司260807…
        if (lab.startsWith(want) && lab.length > want.length && /^\\d/.test(lab.slice(want.length))) {
            return true;
        }
        return false;
    };
    const buildPool = (items) => {
        const visibleItems = [...items].filter(i => {
            if (i.classList.contains('is-disabled')) return false;
            const style = getComputedStyle(i);
            if (style.display === 'none' || style.visibility === 'hidden') return false;
            const r = i.getBoundingClientRect();
            if (r.width > 0 && r.height > 0) return true;
            // Opening popper: rows may report 0×0 while parent already has width.
            if (i.tagName === 'TR') {
                const dd = i.closest && i.closest('.el-select-dropdown');
                if (dd && dd.getBoundingClientRect().width > 0) return true;
            }
            return false;
        });
        return visibleItems.length > 0 ? visibleItems : [...items];
    };
    const FIRST_ALIASES = ['first', '1st', '第一个', '第一项'];
    const tryClick = (item) => {
        item.scrollIntoView({ block: 'nearest' });
        const t = optionLabel(item);
        const clickEl = (item.tagName === 'TR')
            ? (item.querySelector('td .cell, td') || item)
            : item;
        clickEl.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        clickEl.click();
        if (item.tagName === 'TR' && clickEl !== item) item.click();
        if (triggerInput) {
            setTimeout(() => {
                triggerInput.dispatchEvent(new Event('input', { bubbles: true }));
                triggerInput.dispatchEvent(new Event('change', { bubbles: true }));
                window.__last_select_trigger = null;
            }, 0);
        }
        return 'ok:' + t;
    };
    const matchInPool = (pickPool) => {
        if (!exactOnly && FIRST_ALIASES.includes(option.toLowerCase().trim())) {
            return tryClick(pickPool[0]);
        }
        for (const item of pickPool) {
            if (labelMatches(optionLabel(item), option)) return tryClick(item);
        }
        if (!exactOnly) {
            for (const item of pickPool) {
                if (optionLabel(item).includes(option)) return tryClick(item);
            }
        }
        return null;
    };
    let items = collectItems();
    let pickPool = buildPool(items);
    // Remote TsscMultiSelect: dropdown may open before rows arrive.
    if (pickPool.length === 0) {
        for (let i = 0; i < 12; i++) {
            await sleep(250);
            items = collectItems();
            pickPool = buildPool(items);
            if (pickPool.length) break;
        }
    }
    if (pickPool.length === 0) return 'no-items';
    let hit = matchInPool(pickPool);
    if (hit) return hit;

    /* SELECT_LAZY_LOAD_ON_MISS */
    const findWrap = (dd) => {
        if (!dd || dd === document) return null;
        const w1 = dd.querySelector('.el-select-dropdown__wrap');
        if (w1 && w1.scrollHeight > w1.clientHeight + 2) return w1;
        const w2 = dd.querySelector('.el-scrollbar__wrap');
        if (w2 && w2.scrollHeight > w2.clientHeight + 2) return w2;
        for (const n of dd.querySelectorAll('*')) {
            const s = getComputedStyle(n);
            if ((s.overflowY === 'auto' || s.overflowY === 'scroll')
                && n.scrollHeight > n.clientHeight + 2) return n;
        }
        return null;
    };
    try {
        const wrap = findWrap(dropdown);
        if (wrap) {
            let stableStreak = 0;
            let prevCount = pickPool.length;
            let prevHeight = wrap.scrollHeight;
            for (let i = 0; i < 8; i++) {
                wrap.scrollTop = wrap.scrollHeight;
                await sleep(250);
                items = collectItems();
                pickPool = buildPool(items);
                const h = wrap.scrollHeight;
                const c = pickPool.length;
                if (c === prevCount && h === prevHeight) {
                    stableStreak += 1;
                } else {
                    stableStreak = 0;
                    prevCount = c;
                    prevHeight = h;
                }
                if (stableStreak >= 2) break;
            }
            hit = matchInPool(pickPool);
            if (hit) return hit;
        }
    } catch (e) {
        items = collectItems();
        pickPool = buildPool(items);
        hit = matchInPool(pickPool);
        if (hit) return hit;
    }

    const hasEmpty = (dropdown && dropdown !== document)
        ? dropdown.querySelector('.el-select-dropdown__empty')
        : document.querySelector('.el-select-dropdown__empty');
    if (hasEmpty) return 'no-items';
    const preview = pickPool.slice(0, 30).map(i => optionLabel(i)).filter(Boolean);
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
    /* SELECT_TABLE_ROW_OPTIONS */
    if (items.length === 0) {
        const root = (dropdown && dropdown !== document) ? dropdown : document;
        items = root.querySelectorAll(
            '.el-select-dropdown .el-table__body-wrapper tr.el-table__row, .el-select-dropdown tr.el-table__row, tr.el-table__row'
        );
    }
    const optionLabel = (el) => {
        if (!el) return '';
        if (el.tagName === 'TR' || (el.classList && el.classList.contains('el-table__row'))) {
            const cell = el.querySelector('td .cell, td');
            return String((cell && cell.textContent) || el.textContent || '')
                .replace(/\\s+/g, ' ').trim();
        }
        return String(el.textContent || '').replace(/\\s+/g, ' ').trim();
    };
    const FIRST_ALIASES = ['first', '1st', '第一个', '第一项'];
    if (FIRST_ALIASES.includes(option.toLowerCase().trim())) {
        for (const item of items) {
            if (item.offsetParent !== null) return optionLabel(item);
        }
        if (items.length > 0) return optionLabel(items[0]);
        return 'NO_ITEMS';
    }
    for (const item of items) {
        if (optionLabel(item) === option) return option;
    }
    for (const item of items) {
        if (optionLabel(item).includes(option)) return optionLabel(item);
    }
    const hasEmpty = document.querySelector('.el-select-dropdown__empty');
    if (hasEmpty) return 'NO_ITEMS';
    return 'NOT_FOUND:' + [...items].map(i => optionLabel(i)).join(', ');
}'''

# ── Radio ──

