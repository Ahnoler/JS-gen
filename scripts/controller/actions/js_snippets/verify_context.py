"""
JS snippet constant: JS_VERIFY_CONTEXT — 动作前上下文绑定（只读原子校验）。

设计来源：docs/superpowers/specs/2026-08-31-borrow-zcode-browser-design.md
（borrow-design Z4：防 scope 泄漏 / 弹窗外误填）。

期望参数格式（Python 侧调用约定）：

    page.evaluate(JS_VERIFY_CONTEXT, [expected_json])

expected_json 为 JSON 对象（或其字符串形式），判据键全部可选、命中即判：

- overlay_contains: 可见弹层 label 包含给定串（.el-drawer 取 aria-label 或
  .el-drawer__title 文本；.el-dialog 取 .el-dialog__header 文本——
  .el-dialog__title 可能为空）
- overlay_absent: 可见 .el-drawer / .el-dialog 均不存在（确认在底层列表页）
- breadcrumb_contains: 面包屑文本包含给定串（找含「当前位置」的元素取父容器）
- hash_contains: location.hash 包含给定串
- header_contains: 可见 .el-table 表头 th 文本整体拼接包含给定串
- title_contains: document.title 包含给定串

只看可见元素（offsetParent / getClientRects 过滤），自然排除 4 个隐藏
常驻弹窗。不认识的判据键进 mismatched，actual 记 "unknown-criterion"。

返回 JSON 字符串形状：

- 成功：'{"ok":<mismatched 为空>,"matched":[{"criterion","expected","actual"}],
  "mismatched":[...],"context":{"title","hash"(截100),"breadcrumb"(截60),
  "overlay":{"kind","label"}|null}}'
- 空判据（expectedJson 为空对象）也返回 context（ok:true），供「仅观察」用法。
- 异常：'{"ok":false,"error":"<msg>"}'

只读：绝不点击、不修改 DOM，actual 截断 60 字。
"""

JS_VERIFY_CONTEXT = '''(args) => {
    const [expectedJson] = args || [];
    try {
        const norm = (s) => String(s == null ? '' : s).replace(/\\s+/g, ' ').trim();
        const cut = (s, n) => { s = String(s == null ? '' : s); return s.length > n ? s.slice(0, n) : s; };
        const isVisible = (el) => {
            try {
                if (el.offsetParent === null && getComputedStyle(el).position !== 'fixed') return false;
                return el.getClientRects().length > 0;
            } catch (e) { return false; }
        };
        let expected = {};
        if (expectedJson != null) {
            expected = (typeof expectedJson === 'string') ? JSON.parse(expectedJson) : expectedJson;
            if (typeof expected !== 'object' || expected === null) expected = {};
        }
        const matched = [];
        const mismatched = [];
        const record = (criterion, exp, actual, ok) => {
            const item = { criterion: criterion, expected: exp, actual: cut(actual, 60) };
            (ok ? matched : mismatched).push(item);
        };
        // --- collect visible context ---
        const title = String(document.title || '');
        const hash = String(location.hash || '');
        let breadcrumb = '';
        for (const el of document.querySelectorAll('*')) {
            if (!isVisible(el)) continue;
            const t = norm(el.innerText || el.textContent);
            if (t.indexOf('当前位置') !== -1 && t.length < 500) {
                const parent = el.parentElement;
                const pText = parent ? norm(parent.innerText || parent.textContent) : t;
                breadcrumb = cut(pText.length > 0 ? pText : t, 60);
                break;
            }
        }
        let overlay = null;
        const drawer = [...document.querySelectorAll('.el-drawer')].filter(isVisible)[0];
        if (drawer) {
            const tEl = drawer.querySelector('.el-drawer__title');
            const label = norm(drawer.getAttribute('aria-label')) || norm(tEl ? tEl.innerText || tEl.textContent : '');
            overlay = { kind: 'drawer', label: label };
        } else {
            const dialog = [...document.querySelectorAll('.el-dialog')].filter(isVisible)[0];
            if (dialog) {
                const hEl = dialog.querySelector('.el-dialog__header');
                const label = norm(hEl ? hEl.innerText || hEl.textContent : '');
                overlay = { kind: 'dialog', label: label };
            }
        }
        let headerText = '';
        for (const table of document.querySelectorAll('.el-table')) {
            if (!isVisible(table)) continue;
            const ths = [...table.querySelectorAll('th')].filter(isVisible)
                .map((th) => norm(th.innerText || th.textContent))
                .filter((t) => t.length > 0);
            if (ths.length > 0) headerText += (headerText ? ' ' : '') + ths.join(' ');
        }
        // --- evaluate criteria ---
        for (const key of Object.keys(expected)) {
            const exp = String(expected[key] == null ? '' : expected[key]);
            if (key === 'overlay_contains') {
                const actual = overlay ? overlay.label : '';
                record(key, exp, actual || '(no visible overlay)', !!overlay && actual.indexOf(exp) !== -1);
            } else if (key === 'overlay_absent') {
                const present = !!overlay;
                record(key, exp, present ? (overlay.kind + ':' + overlay.label) : '(no visible overlay)', !present);
            } else if (key === 'breadcrumb_contains') {
                record(key, exp, breadcrumb || '(breadcrumb not found)', breadcrumb.indexOf(exp) !== -1);
            } else if (key === 'hash_contains') {
                record(key, exp, hash || '(empty hash)', hash.indexOf(exp) !== -1);
            } else if (key === 'header_contains') {
                record(key, exp, headerText || '(no visible el-table header)', headerText.indexOf(exp) !== -1);
            } else if (key === 'title_contains') {
                record(key, exp, title || '(empty title)', title.indexOf(exp) !== -1);
            } else {
                mismatched.push({ criterion: key, expected: exp, actual: 'unknown-criterion' });
            }
        }
        return JSON.stringify({
            ok: mismatched.length === 0,
            matched: matched,
            mismatched: mismatched,
            context: {
                title: title,
                hash: cut(hash, 100),
                breadcrumb: cut(breadcrumb, 60),
                overlay: overlay
            }
        });
    } catch (e) {
        return JSON.stringify({ ok: false, error: String(e && e.message ? e.message : e) });
    }
}'''
