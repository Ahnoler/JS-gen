"""
JS snippet constants: JS_GET_CONTAINER (extracted from _js_snippets.py).
Re-exported by scripts/controller/actions/_js_snippets.py for backward compat.
"""

JS_GET_CONTAINER = '''(() => {
    const wrapOk = (d) => {
        if (!d) return false;
        const wrap = d.closest && d.closest('.el-dialog__wrapper, .el-message-box__wrapper, .el-drawer__wrapper');
        if (wrap && getComputedStyle(wrap).display === 'none') return false;
        if (d.offsetParent !== null) return true;
        const st = getComputedStyle(d);
        if (st.display === 'none' || st.visibility === 'hidden') return false;
        const r = d.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
    };
    // Prefer last visible overlay — DOM order [last] often hits a leftover hidden dialog
    const dialogs = [...document.querySelectorAll('.el-dialog, .el-message-box')].filter(wrapOk);
    if (dialogs.length) return dialogs[dialogs.length - 1];
    const drawers = [...document.querySelectorAll('.el-drawer')].filter(wrapOk);
    if (drawers.length) return drawers[drawers.length - 1];
    return document;
})()'''

# JS_VISIBLE_OVERLAY_OF — Z4 弹层作用域闸（只读增量，不改动 JS_GET_CONTAINER 任何行）：
# 判断页面是否存在可见弹层（.el-drawer / .el-dialog），以及给定 xpath 的第一个
# 命中元素是否落在该弹层 DOM 内。fill_form_field 在实际填充 evaluate 之前调用，
# 命中「弹层可见但目标在弹层外」时拒绝填充（防止弹窗外误填事故类）。
# 返回 JSON 对象：{overlayPresent, overlayKind, overlayLabel, targetFound,
# targetInsideOverlay}；整体 try/catch 异常返回 {error}。
JS_VISIBLE_OVERLAY_OF = '''([xpathExpr]) => {
    try {
        const isVisibleOverlay = (el, kind) => {
            if (!el) return false;
            const r = el.getBoundingClientRect();
            if (r.width <= 0 || r.height <= 0) return false;
            // Element UI 弹层由外层 wrapper（display:none）控制显隐；弹层本体是
            // position:fixed（offsetParent 恒为 null，不能用它判可见性）。
            // 隐藏对话框常驻 DOM 且 header 文本永在——header 文本不能当可见性依据。
            const scope = el.closest('.el-dialog__wrapper, .el-drawer__wrapper, .el-overlay') || el.parentElement || el;
            if (scope) {
                const st = getComputedStyle(scope);
                if (st.display === 'none' || st.visibility === 'hidden' || parseFloat(st.opacity || '1') === 0) return false;
            }
            const st2 = getComputedStyle(el);
            if (st2.display === 'none' || st2.visibility === 'hidden') return false;
            return true;
        };
        let overlay = null;
        let overlayKind = null;
        const drawers = [...document.querySelectorAll('.el-drawer')];
        for (let i = drawers.length - 1; i >= 0; i--) {
            if (isVisibleOverlay(drawers[i], 'drawer')) { overlay = drawers[i]; overlayKind = 'drawer'; break; }
        }
        if (!overlay) {
            const dialogs = [...document.querySelectorAll('.el-dialog')];
            for (let i = dialogs.length - 1; i >= 0; i--) {
                if (isVisibleOverlay(dialogs[i], 'dialog')) { overlay = dialogs[i]; overlayKind = 'dialog'; break; }
            }
        }
        let overlayLabel = null;
        if (overlay) {
            let raw = overlay.getAttribute('aria-label')
                || (overlay.querySelector('.el-drawer__title') || {}).textContent
                || (overlay.querySelector('.el-dialog__header') || {}).textContent
                || '';
            raw = String(raw || '').trim().replace(/\\s+/g, ' ');
            overlayLabel = raw ? raw.slice(0, 30) : null;
        }
        let targetFound = false;
        let targetInsideOverlay = null;
        const expr = String(xpathExpr === undefined || xpathExpr === null ? '' : xpathExpr);
        if (expr) {
            try {
                const snap = document.evaluate(expr, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
                let node = snap.snapshotLength > 0 ? snap.snapshotItem(0) : null;
                if (node && node.nodeType !== 1) node = node.parentElement;
                if (node && node.nodeType === 1) {
                    targetFound = true;
                    targetInsideOverlay = overlay ? !!overlay.contains(node) : false;
                }
            } catch (eX) {
                targetFound = false;
            }
        }
        return {
            overlayPresent: !!overlay,
            overlayKind: overlayKind,
            overlayLabel: overlayLabel,
            targetFound: targetFound,
            targetInsideOverlay: targetFound ? targetInsideOverlay : null,
        };
    } catch (e) {
        return { error: String((e && e.message) || e) };
    }
}'''

