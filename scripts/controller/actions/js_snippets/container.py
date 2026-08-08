"""
JS snippet constants: JS_GET_CONTAINER (extracted from _js_snippets.py).
Re-exported by scripts/actions/_js_snippets.py for backward compat.
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

