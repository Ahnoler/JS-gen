"""JS snippet constant: JS_STRIP_STALE_WRAPPERS.

弹窗关闭后残留 wrapper 清理（KB-I5 run5 收敛主因）：tsscMutilDialog 及
.el-dialog__wrapper / .el-message-box__wrapper 在弹窗关闭后 wrapper 节点仍
渲染占位（内层 .el-dialog 已 display:none，wrapper 本体仍是可拦截点击的
透明遮罩）→ 真实点击被拦（select_tree_option / tree_picker_click「返回 ok
但树开不了/节点找不到」）。

语义（幂等，可重复执行）：遍历 .el-dialog__wrapper / .el-message-box__wrapper /
#tsscMutilDialog（含同级 [class*="dialog__wrapper"]），对**仍在渲染**
（display/visibility 正常，能拦截点击）但**内部没有任何可见弹窗内容**
（.el-dialog/.el-message-box 全部 display:none 或无 rects）的残留 wrapper →
设 style.pointerEvents='none'。业务弹窗所在 wrapper 内层可见，不受影响。

注意：不能用 offsetParent===null 判 stale——el-dialog__wrapper 是
position:fixed，offsetParent 恒为 null，可见业务弹窗也会被误判（run6 教训）。
返回 {ok:true, stripCount:n, wrappers:[...]}（诊断清单）。

接线（per 动作预清洗）：tree_picker_click / click_button / click_table_row_radio
动作体最前各 evaluate 一次；strip_stale_dialogs() 亦可手动调用。
"""

JS_STRIP_STALE_WRAPPERS = '''() => {
    const wrappers = document.querySelectorAll(
        '.el-dialog__wrapper, .el-message-box__wrapper, #tsscMutilDialog, [class*="dialog__wrapper"]'
    );
    const stripCount = [];
    const inventory = [];
    for (const wrap of wrappers) {
        let display = '', visibility = '', hasVisibleDialog = false, stale = false;
        try {
            const cs = getComputedStyle(wrap);
            display = cs.display;
            visibility = cs.visibility;
            if (cs.display !== 'none' && cs.visibility !== 'hidden') {
                const dialogs = wrap.querySelectorAll('.el-dialog, .el-message-box');
                if (dialogs.length === 0) {
                    // bare residual shell (no dialog content at all)
                    stale = true;
                } else {
                    for (const d of dialogs) {
                        const dcs = getComputedStyle(d);
                        if (dcs.display !== 'none' && dcs.visibility !== 'hidden'
                            && d.getClientRects().length > 0) {
                            hasVisibleDialog = true;
                            break;
                        }
                    }
                    stale = !hasVisibleDialog;
                }
            }
        } catch (e) {
            stale = false;
        }
        if (inventory.length < 12) {
            inventory.push({
                id: wrap.id || undefined,
                cls: String(wrap.className || '').slice(0, 60),
                display,
                hasVisibleDialog,
                stripped: false,
            });
        }
        if (stale) {
            wrap.style.pointerEvents = 'none';
            stripCount.push(true);
            if (inventory.length) {
                inventory[inventory.length - 1].stripped = true;
            }
        }
    }
    return JSON.stringify({ ok: true, stripCount: stripCount.length, wrappers: inventory });
}'''
