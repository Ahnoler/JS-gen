"""
JS snippet constant: JS_SAVE_SECTION (鍒嗗尯浣滅敤鍩熶繚瀛樺姩浣?.

KB-I5 run11 瀹炶瘉寮曟搸缂哄彛鈶★細妯″潡瀛愯鍥撅紙濡傘€屼綇鎴垮紑鍙戣捶娆俱€嶇敵鎶ラ〉锛夋瘡涓垎鍖?鍚勬湁鐙珛鐨勩€屼繚瀛樸€嶆寜閽紱real_click(text=淇濆瓨) 鎭掑懡涓悓涓€鍧愭爣 (840,521)锛宺10b
瀹炶瘉銆岀偣閿欏垎鍖轰繚瀛樹笉鐢熸晥銆嶁€斺€斾繚瀛樺悗閲嶈繘瀛楁涓虹┖锛堢敵璇烽噾棰?涓绘媴淇濈被鍨嬶級銆?闇€瑕佷竴涓寜鍒嗗尯鏍囬瀹氫綅鍏跺鍣ㄥ唴淇濆瓨鎸夐挳鐨勫姩浣溿€?
绛栫暐锛氬叏椤垫壘 norm(text)===section_title 鐨勬爣棰樺厓绱狅紙el-collapse-item__header /
.el-tabs__item / .el-card__header / 浠绘剰 heading锛夛紝娌跨鍏堝悜涓婃壘銆屽惈銆庝繚瀛樸€?鎸夐挳鐨勬渶灏忓鍣ㄣ€嶁啋 鍦ㄨ瀹瑰櫒鍐呯偣淇濆瓨锛坢ousedown/mouseup/click 浜嬩欢閾撅級鈫?绛夊緟
2.5s 鈫?鎶?.el-message toast 鏂囨湰 鈫?杩斿洖 {ok, clicked, toast}銆?鎵句笉鍒版爣棰樻垨瀹瑰櫒鍐呮棤淇濆瓨鎸夐挳 鈫?{ok:false, error:'err-section-not-found:<title>'}銆?"""

JS_SAVE_SECTION = '''async (args) => {
    const [sectionTitle] = args || [];
    const title = String(sectionTitle || '').trim();
    const norm = (s) => String(s == null ? '' : s).replace(/\\s+/g, ' ').trim();
    if (!title) {
        return JSON.stringify({ ok: false, error: 'err-section-not-found:' });
    }
    const visible = (el) => el && (el.offsetParent !== null || el.getClientRects().length > 0);

    // 1) 鎵炬爣棰樺厓绱狅細浼樺厛绮剧‘绛夊€硷紝閫€鑰?contains銆傝烦杩囩函瀹瑰櫒锛堟枃鏈笌瀛愭爲鐩稿悓锛夈€?    const findTitleEls = (exact) => {
        const hits = [];
        for (const el of document.body.querySelectorAll('*')) {
            if (!visible(el)) continue;
            const t = norm(el.textContent);
            if (!t || t.length > 60) continue;
            if (exact ? t !== title : t.indexOf(title) === -1) continue;
            // 鏍囬鍏冪礌鐗瑰緛锛歨eading 绫诲悕 / collapse header / tab / card header / 鐭枃鏈彾瀛?            const cls = String(el.className || '');
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

    // 2) 娌跨鍏堝悜涓婃壘鍚繚瀛樻寜閽殑鏈€灏忓鍣紱鍦ㄦ墍鏈夋爣棰樺€欓€変腑鍙栧鍣ㄦ渶灏忚€呫€?    //    淇濆瓨鎸夐挳浼樺厛 enabled锛坉isableBtn/is-disabled/disabled 鐨勪繚瀛樼偣浜嗕篃涓嶅彂璇锋眰锛?    //    KB-I5 run12 瀹炶瘉锛氱偣涓?disabled 淇濆瓨 鈫?鏃?saveOrUpdate 璇锋眰锛夈€?    const btnEnabled = (b) => !(b.disabled || b.getAttribute('aria-disabled') === 'true'
        || /disableBtn|is-disabled/.test(String(b.className || '')));
    const saveBtnIn = (root) => {
        const enabled = [], disabled = [];
        for (const b of root.querySelectorAll('button, a, [role="button"], .el-button')) {
            if (!visible(b)) continue;
            const t = norm(b.textContent);
            if (t !== '淇濆瓨' && t.indexOf('淇濆瓨') === -1) continue;
            (btnEnabled(b) ? enabled : disabled).push(b);
        }
        const pick = (arr) => arr.sort((a, b) =>
            norm(a.textContent).length - norm(b.textContent).length)[0] || null;
        return pick(enabled) || pick(disabled);
    };
    let picked = null;      // {container, btn, containerSize}
    let disabledOnly = null; // 鍏滃簳锛氬鍣ㄥ唴鍙湁 disabled 淇濆瓨锛堢偣鍑讳笉鍙戣姹傦級
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
                break; // 璇ユ爣棰樺€欓€夌殑鏈€灏忓惈 enabled 淇濆瓨瀹瑰櫒
            }
        }
        if (firstAny && !disabledOnly) disabledOnly = firstAny;
    }
    if (!picked && disabledOnly) picked = disabledOnly;
    if (!picked) {
        return JSON.stringify({ ok: false, error: 'err-section-not-found:' + title });
    }

    // 3) mousedown/mouseup/click 浜嬩欢閾剧偣鍑讳繚瀛樸€?    const btn = picked.btn;
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

    // 4) 绛夊緟 2.5s 鈫?鎶?toast锛?el-message锛夋枃鏈€?    await new Promise((r) => setTimeout(r, 2500));
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
