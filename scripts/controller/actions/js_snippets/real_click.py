"""JS snippet constants: JS_REAL_CLICK_RECT (+ECHO, +TREE_POPOVER_OPEN).

CDP 真实点击通道的定位半边（KB-I5 run7）：trusted 事件通道
（TsscMultiTree tree-popover / el-cascader 等合成事件链不响应的组件）需要
**viewport 坐标**交给 CDP Input.dispatchMouseEvent。本 snippet 输入
CSS selector（可选）+ 元素文本（可选）+ 字段 label_text（可选，弹窗/抽屉
感知的 fieldItem 触发器定位），返回可见目标元素 getBoundingClientRect 中心
（viewport 坐标）；找不到或不可见 → {ok:false}。

成功时同一次 evaluate 顺带产出 **locator 快照**（locator 字段，shape 与
JS_ENRICH_CLICK_LOCATOR 一致：absXPath/buildLocatorSnap/assignRegion 来自
PAGE_LOCATOR_HELPERS）。必须在点击当场抓——popover 类目标点击后可能立即
关闭，事后 _enrich_click_element 会扑空。

配套动作 real_click 在 _workspace.py（new_cdp_session + Input.dispatchMouseEvent）；
tree_picker_click 打开失败时回退调用（_tree.py）。与 select_tree_option /
tree_picker_click（合成事件）分工见 agent-tools-common.md。
"""

from ._locator_helpers_js import PAGE_LOCATOR_HELPERS

JS_REAL_CLICK_RECT = '''async (args) => {
    const [selector, text, labelText] = args || [];
    const sel = String(selector || '').trim();
    const txt = String(text || '').trim();
    const lbl = String(labelText || '').trim();
    const norm = (s) => String(s == null ? '' : s).replace(/\\s+/g, ' ').trim();
    const visible = (el) => el && (el.offsetParent !== null || el.getClientRects().length > 0);
    if (!sel && !txt && !lbl) {
        return JSON.stringify({ ok: false, error: 'err-real-click-args-empty' });
    }
    let el = null;
    // 1) label_text 优先：弹窗/抽屉感知的 fieldItem 触发器定位（与
    //    tree_picker 触发器优先级一致：my-popover span → select input → 可见 input）
    if (!el && lbl) {
        const visibleDlg = () => [...document.querySelectorAll('.el-dialog, .el-drawer, .el-popover, .el-popper')]
            .filter((d) => visible(d));
        const findItem = (root, exact) => {
            for (const item of root.querySelectorAll('.el-form-item')) {
                const l = norm(item.querySelector('.el-form-item__label')?.textContent);
                if (!l) continue;
                if (exact ? l === lbl : l.indexOf(lbl) !== -1) return item;
            }
            return null;
        };
        let fieldItem = findItem(document.body, true);
        if (!fieldItem) {
            const dlgs = visibleDlg().sort((a, b) => norm(a.textContent).length - norm(b.textContent).length);
            for (const exact of [true, false]) {
                for (const dlg of dlgs) {
                    fieldItem = findItem(dlg, exact);
                    if (fieldItem) break;
                }
                if (fieldItem) break;
            }
        }
        if (fieldItem) {
            el = [...fieldItem.querySelectorAll('span.el-tooltip.my-popover.item')]
                .find((s) => visible(s)) || null;
            if (!el) el = fieldItem.querySelector('.el-select .el-input__inner');
            if (!el) {
                el = [...fieldItem.querySelectorAll('input')]
                    .find((i) => i.type !== 'hidden' && visible(i)) || null;
            }
        }
    }
    // 2) CSS selector：取第一个可见实例
    if (!el && sel) {
        for (const c of document.querySelectorAll(sel)) {
            if (visible(c)) { el = c; break; }
        }
    }
    // 3) 文本匹配：scope 优先级 = 可见 .el-popper/.el-popover（树/下拉 popover 在
    //    最上层，KB-I5 run7 实证：底层页被 dialog 遮挡但仍 rects>0，先扫 body 会
    //    误中底层同文本元素并点穿关闭 popover）→ 可见 dialog/drawer → body 兜底。
    //    scope 内取 norm(text) 含目标文本的最小元素（防命中外层容器）。
    if (!el && txt) {
        const poppers = [...document.querySelectorAll('.el-popper, .el-popover')]
            .filter((p) => visible(p))
            .sort((a, b) => norm(a.textContent).length - norm(b.textContent).length);
        const dlgs = [...document.querySelectorAll('.el-dialog, .el-drawer')]
            .filter((d) => visible(d))
            .sort((a, b) => norm(a.textContent).length - norm(b.textContent).length);
        const scopes = [...poppers, ...dlgs, document.body];
        for (const scope of scopes) {
            let best = null;
            for (const c of scope.querySelectorAll('*')) {
                if (!visible(c)) continue;
                const t = norm(c.textContent);
                if (!t || t.indexOf(txt) === -1) continue;
                if (c.children.length > 0 && [...c.children].some((k) => norm(k.textContent).indexOf(txt) !== -1)) continue;
                if (!best || t.length < norm(best.textContent).length) best = c;
            }
            if (best) { el = best; break; }
        }
    }
    if (!el) {
        // 组件类型处方（不硬编码页面/字段名）：文本无可见载体时最常见的坑是
        // 「它是某下拉的选项」——弹层未展开时选项根本不在 DOM 里，real_click
        // 永远找不到，必须改走 select_option（它会自行展开弹层）。
        return JSON.stringify({
            ok: false,
            error: 'err-real-click-target-not-found',
            prescription: txt
                ? ('「' + txt + '」在页面上没有可见载体。若它是某下拉的选项：弹层未展开时选项不在'
                   + ' DOM 里，应对该字段用 select_option(label_text=<字段名>, option_text="' + txt
                   + '")（select_option 会自行展开弹层）；若它应是按钮，先确认当前步骤/页面状态。')
                : '',
        });
    }
    // 组件类型驱动（按钮→click，下拉选项→select）：文本载体若落在 el-select
    // 选项上，不做信任点击——录制与回放都应走 select_option（与
    // click_element_by_index 的 use-select-option 栅栏同一条仓库规则）。
    if (el.closest('.el-select-dropdown__item')) {
        const trig = [...document.querySelectorAll('.el-select .el-input__inner')]
            .find((i) => visible(i) && i.getAttribute('aria-expanded') === 'true')
            || ((document.activeElement && document.activeElement.closest
                && document.activeElement.closest('.el-select')) ? document.activeElement : null);
        const it = trig && trig.closest ? trig.closest('.el-form-item') : null;
        const ownerLbl = it ? norm(it.querySelector('.el-form-item__label')?.textContent)
            .replace(/[：:*]+$/, '') : '';
        return JSON.stringify({
            ok: false,
            error: 'err-real-click-select-option',
            prescription: '「' + txt + '」是下拉' + (ownerLbl ? '「' + ownerLbl + '」' : '')
                + '的选项 → 用 select_option(label_text="' + (ownerLbl || '<字段名>')
                + '", option_text="' + txt + '")（select_option 会自行展开弹层；录制与回放都走 select_option，不要对选项做真实点击）。',
        });
    }
    const btnCarrier = el.closest('button, .el-button, [role="button"]');
    if (btnCarrier && (btnCarrier.disabled === true
        || btnCarrier.getAttribute('aria-disabled') === 'true')) {
        return JSON.stringify({
            ok: false,
            error: 'err-real-click-disabled-button',
            prescription: '「' + txt + '」当前是禁用按钮，点击无效——确认前置步骤是否完成，'
                + '或寻找替代路径（如同名操作藏在某下拉里则用 select_option）。',
        });
    }
    el.scrollIntoView({ block: 'center', behavior: 'instant' });
    await new Promise((r) => setTimeout(r, 150));
    const r = el.getBoundingClientRect();
    if (!(r.width > 0 && r.height > 0)) {
        return JSON.stringify({ ok: false, error: 'err-real-click-invisible', tag: el.tagName });
    }
''' + PAGE_LOCATOR_HELPERS + '''
    // Locator snapshot at click time — same shape as JS_ENRICH_CLICK_LOCATOR's
    // return, so _element_info_from_locate normalizes both identically. Popover
    // targets usually close on trusted click; a post-hoc enrich would find nothing.
    const snapRawText = normalizeControlText(txt) || cleanVisibleText(el);
    const snapKind = detectTargetKind(el);
    const snapText = snapKind === 'tree_node' ? stripVolatileTreeText(snapRawText) : snapRawText;
    const snapAbs = absXPath(el);
    const snapLoc = buildLocatorSnap(el, snapText, snapAbs, lbl, { targetKind: snapKind });
    const snapReg = assignRegion(el);
    return JSON.stringify({
        ok: true,
        x: Math.round(r.left + r.width / 2),
        y: Math.round(r.top + r.height / 2),
        w: Math.round(r.width),
        h: Math.round(r.height),
        tag: el.tagName + '.' + String(el.className || '').slice(0, 60),
        locator: {
            tag_name: snapLoc.tag || (el.tagName || '').toLowerCase(),
            xpath: snapLoc.xpath || snapAbs,
            xpath_smart: snapLoc.xpath_smart || '',
            xpath_full: snapLoc.xpath_full || snapAbs,
            xpath_abs: snapAbs,
            css_selector: snapLoc.cssSelector || '',
            text: snapText,
            formLabel: snapLoc.formLabel || lbl,
            attributes: snapLoc.attributes || {},
            attr: snapLoc.attr || undefined,
            candidates: snapLoc.candidates || [],
            target_kind: snapKind,
            row_text: '',
            region_id: snapReg.region_id || '',
            region_label: snapReg.region_label || '',
            layers: Array.isArray(snapReg.layers) ? snapReg.layers : [],
            bbox: stepBBoxOf(el),
            page_bbox: documentBBoxOf(el),
            locator_scope: snapLoc.locator_scope,
            locator_occurrence: snapLoc.locator_occurrence,
            field_slot: snapLoc.field_slot,
            display_label: snapLoc.display_label,
            locator_verified: snapLoc.locator_verified,
            locator_strategy: snapLoc.locator_strategy,
            locator_fallback_reason: snapLoc.locator_fallback_reason,
        },
    });
}'''

JS_REAL_CLICK_ECHO = '''async (args) => {
    const [labelText, leafText] = args || [];
    const lbl = String(labelText || '').trim();
    const leaf = String(leafText || '').trim();
    const norm = (s) => String(s == null ? '' : s).replace(/\\s+/g, ' ').trim();
    if (!lbl) return JSON.stringify({ ok: false, error: 'err-real-click-args-empty' });
    const visibleDlg = () => [...document.querySelectorAll('.el-dialog, .el-drawer, .el-popover, .el-popper')]
        .filter((d) => d.offsetParent !== null || d.getClientRects().length > 0);
    const findItem = (root, exact) => {
        for (const item of root.querySelectorAll('.el-form-item')) {
            const l = norm(item.querySelector('.el-form-item__label')?.textContent);
            if (!l) continue;
            if (exact ? l === lbl : l.indexOf(lbl) !== -1) return item;
        }
        return null;
    };
    let fieldItem = findItem(document.body, true);
    if (!fieldItem) {
        const dlgs = visibleDlg().sort((a, b) => norm(a.textContent).length - norm(b.textContent).length);
        for (const exact of [true, false]) {
            for (const dlg of dlgs) {
                fieldItem = findItem(dlg, exact);
                if (fieldItem) break;
            }
            if (fieldItem) break;
        }
    }
    if (!fieldItem) {
        return JSON.stringify({ ok: false, error: 'err-tree-label-not-found:' + lbl });
    }
    const readEcho = () => {
        for (const inp of fieldItem.querySelectorAll('input:not([type="hidden"])')) {
            if (inp.value && inp.value.trim()) return inp.value.trim();
        }
        return '';
    };
    let echo = readEcho();
    if (!echo || norm(echo).indexOf(norm(leaf)) === -1) {
        await new Promise((r) => setTimeout(r, 600));
        echo = readEcho();
    }
    if (!echo || (leaf && norm(echo).indexOf(norm(leaf)) === -1)) {
        return JSON.stringify({ ok: false, error: 'err-tree-no-echo:' + lbl + ':' + leaf, echo: echo });
    }
    return JSON.stringify({ ok: true, echo: echo });
}'''

JS_TREE_POPOVER_OPEN = '''async (args) => {
    const [firstLevelText] = args || [];
    const txt = String(firstLevelText || '').trim();
    const norm = (s) => String(s == null ? '' : s).replace(/\\s+/g, ' ').trim();
    const visible = (el) => el && (el.offsetParent !== null || el.getClientRects().length > 0);
    // KB-I5 run7：popover 触发器是 toggle——已开时再 real_click 会关掉。
    // 判据：可见 .el-popper/.el-popover 内存在 norm(text)===首级文本 的元素。
    for (const p of document.querySelectorAll('.el-popper, .el-popover')) {
        if (!visible(p)) continue;
        if (txt) {
            for (const c of p.querySelectorAll('*')) {
                if (visible(c) && norm(c.textContent) === txt) {
                    return JSON.stringify({ ok: true, open: true });
                }
            }
        }
    }
    return JSON.stringify({ ok: true, open: false });
}'''
