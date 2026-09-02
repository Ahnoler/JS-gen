"""JS snippet constant: JS_CLOSE_VISIBLE_DIALOG.

业务外弹窗守卫（KB-I5 run4 实证）：「客户360视图详情」（身份识别=客户360 组件）
等非本流程弹窗弹出后会遮挡底层——弹窗打开期间底层全部按钮 disabled，引擎任何
动作都打在它上面 → 连锁 label-not-found / icon-miss 是弹窗遮挡不是扫描缺口。
另有 tsscMutilDialog 类弹窗关闭后 wrapper 残留 + disableBtn 残留态（取消/确认/X
全 disableBtn）→ 返回 err-dialog-not-closable，由驱动改走「刷新导航回列表→重新
引入→修改」通用还原，勿死循环点弹窗。

语义：只关指定/最顶层可见 .el-dialog（不碰 el-drawer——drawer 由驱动用返回/导航
处理）。按钮优先级：取消 → 确 定/确定 → headerbtn X；全部不可点 → 失败。
"""

JS_CLOSE_VISIBLE_DIALOG = '''async (args) => {
    const [wantTitle] = args || [];
    const norm = (s) => String(s == null ? '' : s).replace(/\\s+/g, ' ').trim();
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
    const isVisible = (el) => {
        if (!el) return false;
        const wrap = el.closest('.el-dialog__wrapper');
        if (wrap && getComputedStyle(wrap).display === 'none') return false;
        return el.offsetParent !== null && el.getClientRects().length > 0;
    };

    // 1) 选目标弹窗：可见 .el-dialog 中，标题含 wantTitle 者优先；否则取 DOM 序
    //    最后一个可见弹窗（最顶层）。绝不碰 .el-drawer。
    const dialogs = [...document.querySelectorAll('.el-dialog')].filter(isVisible);
    if (dialogs.length === 0) {
        return JSON.stringify({ ok: false, error: 'err-dialog-not-found:' + (wantTitle || '') });
    }
    let target = null;
    if (wantTitle) {
        target = dialogs.find((d) => {
            const t = norm(d.querySelector('.el-dialog__title')?.textContent);
            return t.indexOf(norm(wantTitle)) !== -1;
        });
    }
    if (!target) target = dialogs[dialogs.length - 1];
    const title = norm(target.querySelector('.el-dialog__title')?.textContent) || '(unnamed)';

    // 2) 找可点按钮：取消 → 确 定/确定（合 norm 空格）→ headerbtn X。
    //    disabled 判定：真 disabled / disabled attr / is-disabled / aria-disabled。
    const isDisabled = (b) => b.disabled
        || b.hasAttribute('disabled')
        || b.classList.contains('is-disabled')
        || b.getAttribute('aria-disabled') === 'true';
    const findBtn = (texts) => {
        for (const btn of target.querySelectorAll('button')) {
            if (!isVisible(btn) || isDisabled(btn)) continue;
            const t = norm(btn.textContent);
            if (texts.some((w) => t === norm(w) || t.indexOf(norm(w)) !== -1)) return btn;
        }
        return null;
    };
    let btn = findBtn(['取消']);
    if (!btn) btn = findBtn(['确 定', '确定']);
    if (btn) {
        await fireChain(btn);
        await sleep(600);
        const still = [...document.querySelectorAll('.el-dialog')].filter(isVisible);
        const gone = !still.includes(target);
        return JSON.stringify({
            ok: gone,
            closed: title,
            via: norm(btn.textContent),
            error: gone ? undefined : 'err-dialog-not-closable:' + title,
        });
    }
    // 3) X 兜底（headerbtn）
    const x = target.querySelector('.el-dialog__headerbtn');
    if (x && isVisible(x)) {
        await fireChain(x);
        await sleep(600);
        const still = [...document.querySelectorAll('.el-dialog')].filter(isVisible);
        const gone = !still.includes(target);
        return JSON.stringify({
            ok: gone,
            closed: title,
            via: 'X',
            error: gone ? undefined : 'err-dialog-not-closable:' + title,
        });
    }
    return JSON.stringify({ ok: false, error: 'err-dialog-not-closable:' + title });
}'''
