"""
JS snippet constants: JS_TSSC_MULTI_SELECT.

TsscMultiSelect (.tssc-multi-select) has two dropdown shapes:
- remote table: `.select-table` / `tr.el-table__row` (e.g. 要素名称)
- dict options: `.el-select-dropdown__item` (e.g. 要素类型)

Prefer table rows when present; otherwise fall back to el-option.
Not tree; outer confirm dialog is the caller's job.

Wet research (2026-09-09 Playwright @ 产品要素库「选择要素」→「要素名称」):
remote table search is async (~300ms). P1 must NOT treat "any visible row"
as ready — the default page still has rows (often first=部署方式) until the
filter settles; clicking that stale first row yielded ok-p1:部署方式 while
option_text was 服务ID.
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
        return 'no-tssc-multi-select | Not TsscMultiSelect. Use select_option for plain el-select, or report.';
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

    const elSelect = fieldItem.querySelector('.el-select');
    let opener = triggerInput || elSelect || host;
    if (triggerInput && triggerInput.readOnly && elSelect) opener = elSelect;
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

    const dropdownHasTable = () =>
        openDropdowns().some(dd => dd.querySelector('.select-table'));

    for (let i = 0; i < 12; i++) {
        if (dropdownHasTable() || collectOptions().length) break;
        await sleep(250);
    }

    const hasTable = dropdownHasTable();
    if (!hasTable) {
        let items = collectOptions();
        if (items.length === 0) return 'no-items';

        const itemLabel = (el) => {
            if (!el) return { cells: [], full: '' };
            const full = norm(el.textContent);
            return { cells: full ? [full] : [], full };
        };

        const rowSummary = (el) => itemLabel(el).full;

        const exactMatchItem = (el, want) => itemLabel(el).full === want;

        const fuzzyMatchItem = (el, want) => {
            const { full } = itemLabel(el);
            return full.includes(want) ? full.length : Infinity;
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
            target = findExact(pool, optNorm) || findFuzzy(pool, optNorm);
        }

        if (!target) {
            const summaries = pool.slice(0, 5).map(rowSummary).join('; ');
            return 'option-not-found:' + optNorm + ' | mode:option | rows: ' + summaries;
        }

        target.scrollIntoView({ block: 'nearest' });
        target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        target.click();

        await sleep(250);
        const after = readback();

        if (wantFirst) {
            if (after) return 'ok-first:' + after;
            return 'err-no-echo: clicked first option, readback empty';
        }
        if (readbackMatches(after, optNorm)) {
            if (after === optNorm) return 'ok:' + after;
            return 'ok-echo:' + after;
        }
        if (after && after.includes(optNorm)) return 'ok-echo:' + after;
        return 'err-no-echo: expected ' + optNorm + ' | current:' + (after || '(empty)');
    }

    // --- table v2: P0 opened; P1 search+first / P2 clear+first ---
    const isFirstAlias = (s) => {
        const n = norm(s);
        if (!n) return true;
        const lower = n.toLowerCase();
        return FIRST_ALIASES.includes(lower) || FIRST_ALIASES.includes(n);
    };

    const forceExactOff = (dd) => {
        for (const sw of dd.querySelectorAll('.el-switch')) {
            const lbl = sw.closest('.el-form-item, label, span, div')?.textContent
                || sw.innerText
                || sw.getAttribute('aria-label')
                || '';
            if (!lbl.includes('精确')) continue;
            if (!sw.classList.contains('is-checked')) continue;
            const clickTarget = sw.querySelector('.el-switch__core') || sw;
            clickTarget.click();
        }
    };

    const findSearchInput = (dd) =>
        dd.querySelector('.search input.el-input__inner, .search input, .select-table input.el-input__inner');

    const setSearch = (input, val) => {
        if (!input) return;
        const proto = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
        proto.set.call(input, val);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
    };

    const visibleRows = () => {
        const out = [];
        const seen = new Set();
        for (const dd of openDropdowns()) {
            if (!dd.querySelector('.select-table')) continue;
            for (const tr of dd.querySelectorAll('tr.el-table__row')) {
                if (seen.has(tr)) continue;
                seen.add(tr);
                const r = tr.getBoundingClientRect();
                if (r.height <= 0) continue;
                out.push(tr);
            }
        }
        return out;
    };

    const clickRow = async (target) => {
        if (!target) return '';
        target.scrollIntoView({ block: 'nearest' });
        const clickEl = target.querySelector('td .cell, td') || target;
        clickEl.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        clickEl.click();
        if (clickEl !== target) target.click();
        await sleep(250);
        return readback();
    };

    const clickFirstRow = async () => {
        const rows = visibleRows();
        if (!rows.length) return '';
        return await clickRow(rows[0]);
    };

    // P2 / empty-list wait: any visible row is enough (list already cleared).
    const pollRows = async () => {
        for (let i = 0; i < 12; i++) {
            if (visibleRows().length) return;
            await sleep(250);
        }
    };

    const rowText = (tr) => norm(
        [...tr.querySelectorAll('td')].map((td) => td.textContent || '').join(' ')
    );

    // Wet 2026-09-09: after setSearch('服务ID'), pollRows exited on iter 1 with
    // stale 5-row page (first=deplMod|部署方式); ~500ms later only svcId|服务ID.
    // Wait until a visible row's text includes want (or table empties → P2).
    const pollMatchingRow = async (want) => {
        for (let i = 0; i < 16; i++) {
            const rows = visibleRows();
            const hit = rows.find((tr) => rowText(tr).includes(want));
            if (hit) return hit;
            if (!rows.length) return null;
            await sleep(250);
        }
        return null;
    };

    if (!isFirstAlias(optNorm)) {
        let p1HasSearch = false;
        for (const dd of openDropdowns()) {
            if (!dd.querySelector('.select-table')) continue;
            forceExactOff(dd);
            const searchInput = findSearchInput(dd);
            if (!searchInput) continue;
            p1HasSearch = true;
            setSearch(searchInput, optNorm);
        }
        if (p1HasSearch) {
            const hit = await pollMatchingRow(optNorm);
            if (hit) {
                const echo = await clickRow(hit);
                if (echo) return 'ok-p1:' + echo;
                return 'err-no-echo: P1 clicked matching table row, readback empty';
            }
            // No matching row after wait (or emptied) → P2 clear+first.
        }
    }

    for (const dd of openDropdowns()) {
        if (!dd.querySelector('.select-table')) continue;
        setSearch(findSearchInput(dd), '');
    }
    await pollRows();
    if (visibleRows().length) {
        const echo = await clickFirstRow();
        if (echo) return 'ok-p2:' + echo;
        return 'err-no-echo: P2 clicked first table row, readback empty';
    }
    return 'err-no-options: table empty after clear. Prefer real_click / click_element to fill this field; do NOT blindly retry select_option.';
}'''
