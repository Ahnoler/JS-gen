"""
JS snippet constants: JS_TSSC_MULTI_SELECT (extracted for TsscMultiSelect table-row pick).
Re-exported by scripts/controller/actions/_js_snippets.py for backward compat.

Single-select row pick for TsscMultiSelect (.tssc-multi-select + .select-table rows).
Not select_option; not tree; outer confirm dialog is the caller's job.
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

    let rows = collectRows();
    if (rows.length === 0) {
        for (let i = 0; i < 12; i++) {
            await sleep(250);
            rows = collectRows();
            if (rows.length) break;
        }
    }
    if (rows.length === 0) return 'no-items';

    const rowLabels = (tr) => {
        const cells = [];
        for (const cell of tr.querySelectorAll('td .cell, td')) {
            const t = norm(cell.textContent);
            if (t) cells.push(t);
        }
        const full = norm(tr.textContent);
        return { cells, full };
    };

    const rowSummary = (tr) => {
        const { cells, full } = rowLabels(tr);
        return cells.length ? cells.join('|') : full;
    };

    const exactMatchRow = (tr, want) => {
        const { cells, full } = rowLabels(tr);
        for (const c of cells) {
            if (c === want) return true;
        }
        return full === want;
    };

    const fuzzyMatchRow = (tr, want) => {
        const { cells, full } = rowLabels(tr);
        let best = Infinity;
        if (full.includes(want)) best = Math.min(best, full.length);
        for (const c of cells) {
            if (c.includes(want)) best = Math.min(best, c.length);
        }
        return best;
    };

    const visiblePool = (list) => {
        const vis = [...list].filter(tr => {
            if (tr.classList.contains('is-disabled')) return false;
            const r = tr.getBoundingClientRect();
            if (r.width > 0 && r.height > 0) return true;
            const dd = tr.closest('.el-select-dropdown');
            return !!(dd && dd.getBoundingClientRect().width > 0);
        });
        return vis.length ? vis : [...list];
    };

    const findExact = (pool, want) => {
        for (const tr of pool) {
            if (exactMatchRow(tr, want)) return tr;
        }
        return null;
    };

    const findFuzzy = (pool, want) => {
        let best = null;
        let bestLen = Infinity;
        for (const tr of pool) {
            const score = fuzzyMatchRow(tr, want);
            if (score < bestLen) { best = tr; bestLen = score; }
        }
        return bestLen < Infinity ? best : null;
    };

    let pool = visiblePool(rows);
    let target = null;

    if (wantFirst) {
        target = pool[0];
    } else {
        target = findExact(pool, optNorm);
        if (!target) {
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
                for (const sw of dd.querySelectorAll('.el-switch, [class*="exact"]')) {
                    const lbl = sw.closest('.el-form-item, label, span, div')?.textContent || sw.textContent || '';
                    if (lbl.includes('精确')) {
                        const inner = sw.querySelector('.el-switch__core') || sw;
                        if (!sw.classList.contains('is-checked')) inner.click();
                        break;
                    }
                }
                await sleep(400);
                rows = collectRows();
                pool = visiblePool(rows);
                target = findExact(pool, optNorm);
                if (target) break;
            }
        }
        if (!target) target = findFuzzy(pool, optNorm);
    }

    if (!target) {
        const summaries = pool.slice(0, 5).map(rowSummary).join('; ');
        return 'option-not-found:' + optNorm + ' | rows: ' + summaries;
    }

    target.scrollIntoView({ block: 'nearest' });
    const clickCell = target.querySelector('td .cell, td') || target;
    clickCell.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    clickCell.click();
    if (clickCell !== target) target.click();

    await sleep(250);
    const after = readback();

    if (wantFirst) {
        if (after) return 'ok-first:' + after;
        return 'err-no-echo: clicked first row, readback empty';
    }
    if (readbackMatches(after, optNorm)) {
        if (after === optNorm) return 'ok:' + after;
        return 'ok-echo:' + after;
    }
    if (after && after.includes(optNorm)) return 'ok-echo:' + after;
    return 'err-no-echo: expected ' + optNorm + ' | current:' + (after || '(empty)');
}'''
