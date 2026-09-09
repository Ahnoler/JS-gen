"""
JS snippet constants: JS_TSSC_MULTI_SELECT.

TsscMultiSelect (.tssc-multi-select) has two dropdown shapes:
- remote table: `.select-table` / `tr.el-table__row` (e.g. 要素名称)
- dict options: `.el-select-dropdown__item` (e.g. 要素类型)

Prefer table rows when present; otherwise fall back to el-option.
Not tree; outer confirm dialog is the caller's job.
"""
from .base import JS_FIELD_DISABLED
from .container import JS_GET_CONTAINER

JS_TSSC_MULTI_SELECT = '''async ([label, option]) => {
    const isDisabled = ''' + JS_FIELD_DISABLED + ''';
    const container = ''' + JS_GET_CONTAINER + ''';
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    const norm = (s) => String(s == null ? '' : s).replace(/\\s+/g, ' ').trim();

    let fieldItem = null;
    for (const item of container.querySelectorAll('.el-form-item')) {
        const l = item.querySelector('.el-form-item__label')?.textContent?.trim() || '';
        if (l === label || l.includes(label)) { fieldItem = item; break; }
    }
    if (!fieldItem) {
        // KB-I5: 弹窗/抽屉的 form-item 在页面容器之外——补扫可见 dialog/drawer
        for (const dlg of document.querySelectorAll('.el-dialog, .el-drawer')) {
            if (dlg.offsetParent === null) continue;
            for (const item of dlg.querySelectorAll('.el-form-item')) {
                const l = item.querySelector('.el-form-item__label')?.textContent?.trim() || '';
                if (l === label || l.includes(label)) { fieldItem = item; break; }
            }
            if (fieldItem) break;
        }
    }
    if (!fieldItem) return 'label-not-found';
    fieldItem.scrollIntoView({ block: 'center', behavior: 'instant' });

    const isTssc = (v) => !!(v && v.$options && v.$options.name
        && String(v.$options.name).includes('TsscMultiSelect'));
    const walkVueForTssc = (start) => {
        let v = start;
        while (v) {
            if (isTssc(v)) return v;
            v = v.$parent;
        }
        return null;
    };
    let host = fieldItem.querySelector('.tssc-multi-select');
    let vm = null;
    if (host && host.__vue__) vm = walkVueForTssc(host.__vue__);
    if (!vm) {
        for (const el of fieldItem.querySelectorAll('.tssc-multi-select, [class*="tssc"], .el-select, input')) {
            if (!el.__vue__) continue;
            vm = walkVueForTssc(el.__vue__);
            if (vm) {
                host = host || el.closest('.tssc-multi-select') || el;
                break;
            }
        }
    }
    if (!host && !vm) {
        return 'no-tssc-multi-select | Not TsscMultiSelect. Do NOT retry tssc_multi_select.';
    }

    const triggerInput = fieldItem.querySelector('.el-select .el-input__inner')
        || fieldItem.querySelector('input:not([type="hidden"])');
    if (isDisabled(triggerInput, null, fieldItem)) return 'disabled';
    if (vm && (vm.disabled === true || (vm.$props && vm.$props.disabled === true))) return 'disabled';

    const readback = () => {
        if (triggerInput) {
            const v = norm(triggerInput.value);
            if (v) return v;
        }
        if (vm) {
            const v = norm(vm.selectName || vm.myValue || vm.chosenValue);
            if (v) return v;
        }
        return '';
    };

    const FIRST_ALIASES = ['first', '1st', '第一个', '第一项'];
    const optNorm = norm(option);
    const wantFirst = !optNorm
        || FIRST_ALIASES.includes(optNorm.toLowerCase())
        || FIRST_ALIASES.includes(optNorm);

    const readbackMatches = (current, want) => {
        if (!current || !want) return false;
        if (current === want) return true;
        if (current.startsWith(want) && current.length > want.length
            && /^\\d/.test(current.slice(want.length))) return true;
        return false;
    };

    if (!wantFirst && optNorm) {
        const cur = readback();
        if (readbackMatches(cur, optNorm)) return 'ok-already:' + cur;
    }

    const opener = triggerInput
        || fieldItem.querySelector('.el-select .el-input__inner')
        || fieldItem.querySelector('.el-select')
        || host;
    if (opener) opener.click();
    await sleep(200);

    const openDropdowns = () => {
        const roots = [];
        for (const dd of document.querySelectorAll('.el-select-dropdown')) {
            if (dd.classList.contains('is-hidden')) continue;
            const st = getComputedStyle(dd);
            if (st.display === 'none' || st.visibility === 'hidden') continue;
            if (dd.getBoundingClientRect().width <= 0) continue;
            roots.push(dd);
        }
        return roots;
    };

    const collectRows = () => {
        const out = [];
        const seen = new Set();
        for (const dd of openDropdowns()) {
            const found = dd.querySelectorAll(
                '.select-table tr.el-table__row, .el-table__body tr.el-table__row, tr.el-table__row'
            );
            for (const tr of found) {
                if (seen.has(tr)) continue;
                seen.add(tr);
                out.push(tr);
            }
        }
        return out;
    };
    // Dict-mode (要素类型): el-option list, no .select-table (CDP 19242).
    const collectOptions = () => {
        const out = [];
        const seen = new Set();
        for (const dd of openDropdowns()) {
            if (dd.querySelector('.select-table')) continue;
            for (const li of dd.querySelectorAll('.el-select-dropdown__item')) {
                if (seen.has(li)) continue;
                seen.add(li);
                out.push(li);
            }
        }
        return out;
    };

    let rows = collectRows();
    if (rows.length === 0) {
        for (let i = 0; i < 12; i++) {
            await sleep(250);
            rows = collectRows();
            if (rows.length) break;
            if (collectOptions().length) break;
        }
    }
    let mode = 'table';
    let items = rows;
    if (items.length === 0) {
        items = collectOptions();
        mode = 'option';
    }
    if (items.length === 0) return 'no-items';

    const itemLabel = (el) => {
        if (!el) return { cells: [], full: '' };
        if (el.tagName === 'TR') {
            const cells = [];
            for (const cell of el.querySelectorAll('td .cell, td')) {
                const t = norm(cell.textContent);
                if (t) cells.push(t);
            }
            return { cells, full: norm(el.textContent) };
        }
        const full = norm(el.textContent);
        return { cells: full ? [full] : [], full };
    };

    const rowSummary = (el) => {
        const { cells, full } = itemLabel(el);
        return cells.length ? cells.join('|') : full;
    };

    const exactMatchItem = (el, want) => {
        const { cells, full } = itemLabel(el);
        for (const c of cells) {
            if (c === want) return true;
        }
        return full === want;
    };

    const fuzzyMatchItem = (el, want) => {
        const { cells, full } = itemLabel(el);
        let best = Infinity;
        if (full.includes(want)) best = Math.min(best, full.length);
        for (const c of cells) {
            if (c.includes(want)) best = Math.min(best, c.length);
        }
        return best;
    };

    const visiblePool = (list) => {
        const vis = [...list].filter(el => {
            if (el.classList.contains('is-disabled')) return false;
            const r = el.getBoundingClientRect();
            if (r.width > 0 && r.height > 0) return true;
            const dd = el.closest && el.closest('.el-select-dropdown');
            return !!(dd && dd.getBoundingClientRect().width > 0);
        });
        return vis.length ? vis : [...list];
    };

    const findExact = (pool, want) => {
        for (const el of pool) {
            if (exactMatchItem(el, want)) return el;
        }
        return null;
    };

    const findFuzzy = (pool, want) => {
        let best = null;
        let bestLen = Infinity;
        for (const el of pool) {
            const score = fuzzyMatchItem(el, want);
            if (score < bestLen) { best = el; bestLen = score; }
        }
        return bestLen < Infinity ? best : null;
    };

    let pool = visiblePool(items);
    let target = null;

    if (wantFirst) {
        target = pool[0];
    } else {
        target = findExact(pool, optNorm);
        if (!target && mode === 'table') {
            for (const dd of openDropdowns()) {
                const searchInput = dd.querySelector(
                    '.select-table input:not([type="hidden"]), .select-table .el-input__inner,'
                    + ' .el-input__inner, input:not([type="hidden"])'
                );
                if (!searchInput || searchInput === triggerInput) continue;
                const s = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
                s.call(searchInput, optNorm);
                searchInput.dispatchEvent(new InputEvent('input', { bubbles: true }));
                searchInput.dispatchEvent(new Event('change', { bubbles: true }));
                // Prefer fuzzy: force 精确查询 OFF (sid 5b463582 empty rows).
                for (const sw of dd.querySelectorAll('.el-switch')) {
                    const lbl = sw.closest('.el-form-item, label, span, div')?.textContent || sw.textContent || '';
                    if (!lbl.includes('精确')) continue;
                    const inner = sw.querySelector('.el-switch__core') || sw;
                    if (sw.classList.contains('is-checked')) inner.click();
                    break;
                }
                await sleep(500);
                items = collectRows();
                pool = visiblePool(items);
                target = findExact(pool, optNorm) || findFuzzy(pool, optNorm);
                if (target) break;
            }
        }
        if (!target) target = findFuzzy(pool, optNorm);
    }

    if (!target) {
        const summaries = pool.slice(0, 5).map(rowSummary).join('; ');
        return 'option-not-found:' + optNorm + ' | mode:' + mode + ' | rows: ' + summaries;
    }

    target.scrollIntoView({ block: 'nearest' });
    const clickEl = (target.tagName === 'TR')
        ? (target.querySelector('td .cell, td') || target)
        : target;
    clickEl.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    clickEl.click();
    if (target.tagName === 'TR' && clickEl !== target) target.click();

    await sleep(250);
    const after = readback();

    if (wantFirst) {
        if (after) return 'ok-first:' + after;
        return 'err-no-echo: clicked first ' + mode + ', readback empty';
    }
    if (readbackMatches(after, optNorm)) {
        if (after === optNorm) return 'ok:' + after;
        return 'ok-echo:' + after;
    }
    if (after && after.includes(optNorm)) return 'ok-echo:' + after;
    return 'err-no-echo: expected ' + optNorm + ' | current:' + (after || '(empty)');
}'''
