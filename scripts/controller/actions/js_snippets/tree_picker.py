"""JS snippet constant: JS_TREE_PICKER_CLICK.

「维护方案品种明细」等产品/品种树（TsscMultiTree popover 变体）：$emit 三段式注入
对它不触发（ok 但 input.value 空、只读额度字段不回填，见 tmp/e2e/pz_probe.md）。
唯一有效交互是**逐级真实点击树节点文本**：叶子点一次即选中 → popover 自动关 →
fieldItem 内 input.value 回显 + 弹窗内 4 只读字段自动回填。本 snippet 就是照抄
侦察报告的最小交互序列，并以内联回显校验为成功谓词（绝不假 ok）。

与 select_tree_option（$emit 三段式单选叶树）/ tree_check_confirm（勾选树）分工，
见 _tree.tree_picker_click docstring 与 scripts/prompts/agent-tools-tree.md。
"""

JS_TREE_PICKER_CLICK = '''async (args) => {
    const [labelText, pathJson, skipOpen] = args || [];
    // skipOpen='1'（KB-I5 run7）：popover 已由 real_click（CDP trusted 事件）打开，
    // 跳过初始触发器合成链——再 fire 会把刚打开的 popover 切换关闭。
    const skipTriggerFire = skipOpen === '1';
    let path = [];
    try { path = JSON.parse(pathJson || '[]'); } catch (e) { path = []; }
    path = (Array.isArray(path) ? path : []).map((s) => String(s == null ? '' : s).trim()).filter(Boolean);
    const norm = (s) => String(s == null ? '' : s).replace(/\\s+/g, ' ').trim();
    if (!labelText || path.length === 0) {
        return JSON.stringify({ ok: false, error: 'err-tree-args-empty' });
    }
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const fire = (el, type) => el.dispatchEvent(
        new MouseEvent(type, { bubbles: true, cancelable: true, view: window })
    );
    const fireChain = async (el) => {
        el.scrollIntoView({ block: 'center', behavior: 'instant' });
        // KB-I5 run6: my-popover/el-tooltip 触发器可能挂 hover 打开——
        // mousedown 链前先补 mouseover/mouseenter（对 click 触发器无副作用）。
        fire(el, 'mouseover');
        fire(el, 'mouseenter');
        fire(el, 'mousedown');
        await sleep(40);
        fire(el, 'mouseup');
        await sleep(40);
        fire(el, 'click');
    };

    // 1) label 定位（弹窗/抽屉感知）：页面容器内精确 label → 可见 dialog/drawer 内
    //    精确 label → 可见 dialog/drawer 内 label 包含匹配（取文本最短者，防命中外层）。
    const findItem = (root, exact) => {
        for (const item of root.querySelectorAll('.el-form-item')) {
            const l = norm(item.querySelector('.el-form-item__label')?.textContent);
            if (!l) continue;
            if (exact ? l === labelText : l.indexOf(labelText) !== -1) return item;
        }
        return null;
    };
    const visibleDlg = () => [...document.querySelectorAll('.el-dialog, .el-drawer, .el-popover, .el-popper')]
        // KB-I5 run7: position:fixed popper 的 offsetParent 为 null，改用 rects 判可见
        .filter((d) => d.offsetParent !== null || d.getClientRects().length > 0);
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
        return JSON.stringify({ ok: false, error: 'err-tree-label-not-found:' + labelText });
    }
    fieldItem.scrollIntoView({ block: 'center', behavior: 'instant' });

    // 2) 打开触发器：实证「维护方案品种明细」产品名称字段内部 input 是隐藏的，
    //    唯一有效触发器 = 可见 span.el-tooltip.my-popover.item（点 input 无效），
    //    故 my-popover span 优先 → .el-select .el-input__inner → 可见非 hidden input。
    let trigger = [...fieldItem.querySelectorAll('span.el-tooltip.my-popover.item')]
        .find((s) => s.offsetParent !== null || s.getClientRects().length > 0);
    if (!trigger) {
        trigger = fieldItem.querySelector('.el-select .el-input__inner');
    }
    if (!trigger) {
        trigger = [...fieldItem.querySelectorAll('input')]
            .find((i) => i.type !== 'hidden' && (i.offsetParent !== null || i.getClientRects().length > 0));
    }
    if (!trigger) {
        return JSON.stringify({ ok: false, error: 'err-tree-trigger-not-found:' + labelText });
    }
    if (trigger.disabled || trigger.readOnly) {
        // readOnly 触发器（只读回显 input）仍可点开 popover，仅 disabled 拦下
        if (trigger.disabled) {
            return JSON.stringify({ ok: false, error: 'err-tree-disabled:' + labelText });
        }
    }
    if (!skipTriggerFire) {
        await fireChain(trigger);
    }
    await sleep(400);

    // 3) 逐级点击：对 path 每项，轮询 ≤2000ms 在可见树节点（popover 优先 → document 级兜底）
    //    中找 norm(text)==该项的节点 → mousedown 链真实点击 → 等 300ms 展开 → 下一项。
    const findNode = (text) => {
        const scopes = visibleDlg()
            .filter((d) => d.querySelector('.el-tree-node'))
            .sort((a, b) => norm(a.textContent).length - norm(b.textContent).length);
        scopes.push(document.body);
        for (const scope of scopes) {
            for (const c of scope.querySelectorAll('.el-tree-node__content, .el-tree-node .node')) {
                // KB-I5 run7: position:fixed popper 内节点 offsetParent 为 null，
                // 只用 rects 判可见（display:none 时 rects 为空）
                if (c.getClientRects().length === 0) continue;
                if (norm(c.textContent) === text) return c;
            }
        }
        return null;
    };
    const clicked = [];
    for (const step of path) {
        let node = null;
        for (let waited = 0; waited <= 2000 && !node; waited += 150) {
            node = findNode(step);
            if (!node) await sleep(150);
        }
        // KB-I5 run6: 第一级未现时重开一次触发器（popover 可能未打开/被重渲染吃掉）；
        // skipTriggerFire（run7 real_click 已打开）时不再补 fire。
        if (!node && clicked.length === 0 && !skipTriggerFire) {
            await fireChain(trigger);
            for (let waited = 0; waited <= 1500 && !node; waited += 150) {
                node = findNode(step);
                if (!node) await sleep(150);
            }
        }
        if (!node) {
            return JSON.stringify({
                ok: false,
                error: 'err-tree-node-not-found:' + labelText + ':' + step,
                clicked: clicked,
            });
        }
        await fireChain(node);
        clicked.push(step);
        await sleep(300); // 展开/选中渲染
    }

    // 4) 成功谓词：fieldItem 内 input.value 回显且含 path 最后项 → ok；否则再等 500ms
    //    重读一次；仍空 → err-tree-no-echo（绝不假 ok）。
    const readEcho = () => {
        for (const inp of fieldItem.querySelectorAll('input:not([type="hidden"])')) {
            if (inp.value && inp.value.trim()) return inp.value.trim();
        }
        return '';
    };
    const leaf = path[path.length - 1];
    let echo = readEcho();
    if (!echo || norm(echo).indexOf(norm(leaf)) === -1) {
        await sleep(500);
        echo = readEcho();
    }
    if (!echo || norm(echo).indexOf(norm(leaf)) === -1) {
        return JSON.stringify({
            ok: false,
            error: 'err-tree-no-echo:' + labelText + ':' + leaf,
            clicked: clicked,
            echo: echo,
        });
    }
    return JSON.stringify({ ok: true, echo: echo, clicked: clicked });
}'''
