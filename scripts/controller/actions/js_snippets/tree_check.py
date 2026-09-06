"""
JS snippet constants: JS_TREE_CHECK_CONFIRM.

TsscMultiTree/流程选人 type checkbox trees (show-checkbox el-tree inside a
popover/dialog): choosing the node must fire the framework's REAL check event
(handleCheckClick) — the selected-person list (nextNodeAprvPsnList) is only
written by that event, never by $emit('input') (KB-I5 r6c root cause, verified
in the round-6/7 wet test). This snippet does one deterministic pass:

  trigger open → poll for the node → click its checkbox (mousedown chain) →
  preset-checked double-click recovery → VERIFY (node is-checked AND tree
  checked-count >= 1) → {ok:true, checked, node_text, checked_count}.

It only checks the box; confirming the dialog stays the caller's turn.
"""

JS_TREE_CHECK_CONFIRM = '''async (args) => {
    const [labelText, nodeText] = args || [];
    const norm = (s) => String(s == null ? '' : s).replace(/\\s+/g, ' ').trim();
    if (!labelText || !nodeText) {
        return JSON.stringify({ ok: false, error: 'err-tree-args-empty' });
    }
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const fire = (el, type) => el.dispatchEvent(
        new MouseEvent(type, { bubbles: true, cancelable: true, view: window })
    );
    const fireChain = async (el) => {
        el.scrollIntoView({ block: 'center', behavior: 'instant' });
        fire(el, 'mousedown');
        await sleep(40);
        fire(el, 'mouseup');
        await sleep(40);
        fire(el, 'click');
    };

    // 1) field label / container resolution (3 tiers):
    //    a) exact .el-form-item__label; b) visible container (dialog/popover)
    //    whose inner text CONTAINS labelText (want the shortest text node, e.g.
    //    "下一节点审批人" for label "审批人"); c) first visible container that
    //    hosts an el-tree — the picker dialog itself.
    const labels = [...document.querySelectorAll('.el-form-item__label')];
    const label = labels.find((l) => norm(l.textContent) === labelText);
    let item = label ? label.closest('.el-form-item') : null;
    if (!item) {
        const containers = [...document.querySelectorAll(
            '.el-dialog, .el-popper, .el-popover, .tree-popover, .el-select-dropdown')]
            .filter((c) => c.offsetParent !== null && c.getClientRects().length > 0);
        const candidates = containers.filter((c) => norm(c.textContent).indexOf(labelText) !== -1)
            .sort((a, b) => norm(a.textContent).length - norm(b.textContent).length);
        item = action(candidates[0]) || null;
        if (!item) {
            const withTree = containers.find((c) => c.querySelector('.el-tree'));
            item = action(withTree) || null;
        }
    }
    function action(c) { return c ? (c.querySelector('.el-form-item') || c) : null; }
    if (!item) {
        return JSON.stringify({ ok: false, error: 'err-tree-label-not-found:' + labelText });
    }
    const tScope = item.querySelector('.el-form-item') || item;

    // 2) open trigger (optional): the tree may live in a body-attached HIDDEN
    //    .tree-popover (流程选人). Prefer the field's trigger, then the visible
    //    dialog's search input; skip entirely when nodes are already visible.
    const locateNode = (visibleOnly) => {
        for (const node of document.querySelectorAll('.el-tree-node')) {
            if (visibleOnly && node.offsetParent === null) continue;
            const c = node.querySelector('.node, .el-tree-node__content') || node;
            if (norm(c.textContent) === nodeText) return node;
        }
        return null;
    };
    let nodeEl = locateNode(true) || locateNode(false);
    if (nodeEl && nodeEl.offsetParent === null) {
        const anc = nodeEl.closest('.el-dialog, .el-popover, .el-popper, .tree-popover, .el-form-item');
        let trigger = null;
        if (anc) {
            trigger = (anc.querySelector('.el-form-item .el-input__inner'))
                || [...anc.querySelectorAll('input')].find(
                    (i) => i.type !== 'hidden' && (i.offsetParent !== null || i.getClientRects().length > 0));
        }
        if (!trigger) {
            const dlg = [...document.querySelectorAll('.el-dialog')]
                .find((d) => d.offsetParent !== null);
            if (dlg) trigger = [...dlg.querySelectorAll('input')].find(
                (i) => i.type !== 'hidden' && (i.offsetParent !== null || i.getClientRects().length > 0));
        }
        if (!trigger) {
            return JSON.stringify({ ok: false, error: 'err-tree-trigger-not-found:' + labelText });
        }
        await fireChain(trigger);
        await sleep(500);
        nodeEl = locateNode(true) || locateNode(false);
        if (!nodeEl) {
            return JSON.stringify({ ok: false, error: 'err-tree-node-not-found:' + labelText + ':' + nodeText });
        }
    }
    if (!nodeEl) {
        return JSON.stringify({ ok: false, error: 'err-tree-node-not-found:' + labelText + ':' + nodeText });
    }

    // 4) click the node checkbox (mousedown chain); preset-checked nodes get a
    //    second click: the first toggle would UNcheck it, and the node must END
    //    checked so the real handleCheckClick fires with the selection.
    const nodeEl2 = nodeEl.closest('.el-tree-node') || nodeEl;
    const cb = nodeEl2.querySelector('.el-checkbox');
    const wasChecked = !!(cb && cb.classList.contains('is-checked'));
    const tgt = cb || nodeEl2.querySelector('.node, .el-tree-node__content') || nodeEl2;
    await fireChain(tgt);
    if (wasChecked) {
        await sleep(150);
        await fireChain(tgt);
    }

    // 5) VERIFY (success predicate): node ends checked AND tree checked-count >= 1.
    let okState = false;
    let count = 0;
    for (let waited = 0; waited <= 600 && !okState; waited += 100) {
        const tree = (nodeEl2.closest('.el-tree')) || (cb && cb.closest('.el-tree'));
        const cbNow = (nodeEl2.querySelector('.el-checkbox'));
        const checkedNow = !!(cbNow && cbNow.classList.contains('is-checked'));
        count = tree ? tree.querySelectorAll('.el-checkbox.is-checked').length : 0;
        okState = checkedNow && count >= 1;
        if (!okState) await sleep(100);
    }
    if (!okState) {
        return JSON.stringify({
            ok: false,
            error: 'err-tree-check-unverified:' + labelText + ':' + nodeText + ':checked=' + (okState ? '1' : '0'),
            checked_count: count,
        });
    }
    return JSON.stringify({ ok: true, checked: true, node_text: nodeText, checked_count: count });
}'''
