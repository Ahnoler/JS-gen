"""
JS snippet constant: JS_SAVE_SECTION (分区作用域保存动作).

KB-I5 run11 实证引擎缺口②：模块子视图（如「住房开发贷款」申报页）每个分区
各有独立的「保存」按钮；real_click(text=保存) 恒命中同一坐标 (840,521)，r10b
实证「点错分区保存不生效」——保存后重进字段为空（申请金额/主担保类型）。
需要一个按分区标题定位其容器内保存按钮的动作。

策略：全页找 norm(text)===section_title 的标题元素（el-collapse-item__header /
.el-tabs__item / .el-card__header / 任意 heading），沿祖先向上找「含『保存』
按钮的最小容器」→ 在该容器内点保存（mousedown/mouseup/click 事件链）→ 等待
2.5s → 抓 .el-message toast 文本 → 返回 {ok, clicked, toast}。
找不到标题或容器内无保存按钮 → {ok:false, error:'err-section-not-found:<title>'}。
"""

JS_SAVE_SECTION = '''async (args) => {
    const [sectionTitle] = args || [];
    const title = String(sectionTitle || '').trim();
    const norm = (s) => String(s == null ? '' : s).replace(/\\s+/g, ' ').trim();
    if (!title) {
        return JSON.stringify({ ok: false, error: 'err-section-not-found:' });
    }
    const visible = (el) => el && (el.offsetParent !== null || el.getClientRects().length > 0);

    // 1) 找标题元素：优先精确等值，退而 contains。跳过纯容器（文本与子树相同）。
    const findTitleEls = (exact) => {
        const hits = [];
        for (const el of document.body.querySelectorAll('*')) {
            if (!visible(el)) continue;
            const t = norm(el.textContent);
            if (!t || t.length > 60) continue;
            if (exact ? t !== title : t.indexOf(title) === -1) continue;
            // 标题元素特征：heading 类名 / collapse header / tab / card header / 短文本叶子
            const cls = String(el.className || '');
            const looksTitle = /header|title|tab|caption|legend|label/i.test(cls)
                || el.children.length === 0
                || [...el.children].every((c) => !norm(c.textContent));
            if (looksTitle) hits.push(el);
        }
        return hits;
    };
    let titleEls = findTitleEls(true);
    if (!titleEls.length) titleEls = findTitleEls(false);
    if (!titleEls.length) {
        return JSON.stringify({ ok: false, error: 'err-section-not-found:' + title });
    }

    // 2) 沿祖先向上找含保存按钮的最小容器；在所有标题候选中取容器最小者。
    //    保存按钮优先 enabled（disableBtn/is-disabled/disabled 的保存点了也不发请求，
    //    KB-I5 run12 实证：点中 disabled 保存 → 无 saveOrUpdate 请求）。
    const btnEnabled = (b) => !(b.disabled || b.getAttribute('aria-disabled') === 'true'
        || /disableBtn|is-disabled/.test(String(b.className || '')));
    const saveBtnIn = (root) => {
        const enabled = [], disabled = [];
        for (const b of root.querySelectorAll('button, a, [role="button"], .el-button')) {
            if (!visible(b)) continue;
            const t = norm(b.textContent);
            if (t !== '保存' && t.indexOf('保存') === -1) continue;
            (btnEnabled(b) ? enabled : disabled).push(b);
        }
        const pick = (arr) => arr.sort((a, b) =>
            norm(a.textContent).length - norm(b.textContent).length)[0] || null;
        return pick(enabled) || pick(disabled);
    };
    let picked = null;      // {container, btn, containerSize}
    let disabledOnly = null; // 兜底：容器内只有 disabled 保存（点击不发请求）
    for (const te of titleEls) {
        let node = te;
        let firstAny = null;
        for (let up = 0; node && up < 12; up++, node = node.parentElement) {
            const btn = saveBtnIn(node);
            if (!btn) continue;
            if (!firstAny) firstAny = { container: node, btn: btn, containerSize: node.textContent.length };
            if (btnEnabled(btn)) {
                const size = node.textContent.length;
                if (!picked || size < picked.containerSize) {
                    picked = { container: node, btn: btn, containerSize: size, titleEl: te };
                }
                break; // 该标题候选的最小含 enabled 保存容器
            }
        }
        if (firstAny && !disabledOnly) disabledOnly = firstAny;
    }
    if (!picked && disabledOnly) picked = disabledOnly;
    if (!picked) {
        return JSON.stringify({ ok: false, error: 'err-section-not-found:' + title });
    }

    // 3) mousedown/mouseup/click 事件链点击保存。
    const btn = picked.btn;
    btn.scrollIntoView({ block: 'center', behavior: 'instant' });
    await new Promise((r) => setTimeout(r, 200));
    const rect = btn.getBoundingClientRect();
    const opts = {
        bubbles: true, cancelable: true, view: window,
        clientX: Math.round(rect.left + rect.width / 2),
        clientY: Math.round(rect.top + rect.height / 2),
        button: 0
    };
    const tag = btn.tagName + '.' + String(btn.className || '').slice(0, 60);
    try {
        btn.dispatchEvent(new MouseEvent('mouseover', opts));
        btn.dispatchEvent(new MouseEvent('mousedown', opts));
        btn.dispatchEvent(new MouseEvent('mouseup', opts));
        btn.click();
    } catch (e) {
        return JSON.stringify({ ok: false, error: 'err-section-click-failed:' + String(e).slice(0, 120) });
    }

    // 4) 等待 2.5s → 抓 toast（.el-message）文本。
    await new Promise((r) => setTimeout(r, 2500));
    let toast = null;
    for (const m of document.querySelectorAll('.el-message')) {
        if (visible(m)) { toast = norm(m.textContent); break; }
    }
    return JSON.stringify({
        ok: true,
        clicked: true,
        section: title,
        button: tag,
        toast: toast
    });
}'''
