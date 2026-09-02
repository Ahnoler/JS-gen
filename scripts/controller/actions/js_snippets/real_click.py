"""JS snippet constant: JS_REAL_CLICK_RECT.

CDP 真实点击通道的定位半边（KB-I5 run7）：trusted 事件通道
（TsscMultiTree tree-popover / el-cascader 等合成事件链不响应的组件）需要
**viewport 坐标**交给 CDP Input.dispatchMouseEvent。本 snippet 输入
CSS selector（可选）+ 元素文本（可选）+ 字段 label_text（可选，弹窗/抽屉
感知的 fieldItem 触发器定位），返回可见目标元素 getBoundingClientRect 中心
（viewport 坐标）；找不到或不可见 → {ok:false}。

配套动作 real_click 在 _workspace.py（new_cdp_session + Input.dispatchMouseEvent）；
tree_picker_click 打开失败时回退调用（_tree.py）。与 select_tree_option /
tree_picker_click（合成事件）分工见 agent-tools-common.md。
"""

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
        return JSON.stringify({ ok: false, error: 'err-real-click-target-not-found' });
    }
    el.scrollIntoView({ block: 'center', behavior: 'instant' });
    await new Promise((r) => setTimeout(r, 150));
    const r = el.getBoundingClientRect();
    if (!(r.width > 0 && r.height > 0)) {
        return JSON.stringify({ ok: false, error: 'err-real-click-invisible', tag: el.tagName });
    }
    return JSON.stringify({
        ok: true,
        x: Math.round(r.left + r.width / 2),
        y: Math.round(r.top + r.height / 2),
        w: Math.round(r.width),
        h: Math.round(r.height),
        tag: el.tagName + '.' + String(el.className || '').slice(0, 60),
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
