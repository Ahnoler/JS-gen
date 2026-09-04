"""
JS snippet constants: 引入保证人 复合引擎动作的页面半边（填弹窗 + 后校验）.

真机实证（2026-09-04 run-ig）：本 SUT 的 tsscBtn 按钮（父页面「引入保证人」、
弹窗底部「确认」）对合成事件链不响应，必须走 CDP trusted click（real_click
通道，_workspace._real_click_via_cdp）；因此复合动作 introduce_guarantor
（_table.py）按 四段编排：
  1. CDP 真点击父页面「引入保证人」按钮（trusted）
  2. page.evaluate(JS_INTRODUCE_GUARANTOR_FILL)：等弹窗可见 → 候选行定位
     （含翻页 / tsscBtn tab 兜底）→ radio 真点击（mousedown 链）→ 表头定列
     写关系（el-select 下拉）+ 担保金额（native setter）→ 回读验证
  3. CDP 真点击弹窗「确认」（trusted）
  4. page.evaluate(JS_INTRODUCE_GUARANTOR_VERIFY)：等弹窗关闭 → 读错误面
     （「异常信息」弹窗；含「不可重复被引入」→ 查主列表给 dup 语义）→
     轮询父页面保证人信息列表（表头含 客户编号+与借款人关系 的表，排除
     弹窗自身）出现 guarantor_key 行

返回（KB 卡 data/kb/flows/guarantee_intro.json + r21 静默失败实证）：
  FILL: {ok:true} / {ok:false, error:'err-guarantee-*'}（候选行找不到 /
  下拉项找不到 / 金额写未验证等，原样带出禁止盲试）
  VERIFY: {ok:true, dup:false, rows:n, verified_in:'main-form'}（主列表新增行
  确认；verified_in='main-form' 表示已在主表单保证人信息列表验证，且该表表头
  须含 客户编号/与借款人关系/担保金额 特征）/ {ok:true, dup:true, rows:n,
  verified_in:'main-form'}（后端报不可重复被引入且主列表已有该行=幂等
  成功）/ {ok:false, error:'err-guarantee-dup-not-in-list'|
  'err-guarantee-rejected:<异常信息摘要>'|'err-guarantee-not-in-list:<key>'}
"""

JS_INTRODUCE_GUARANTOR_FILL = '''async (args) => {
    const [keyRaw, relationRaw, amountRaw] = args || [];
    const guarantorKey = String(keyRaw == null ? '' : keyRaw).trim();
    const relation = String(relationRaw == null ? '' : relationRaw).trim();
    const amount = String(amountRaw == null ? '' : amountRaw).trim();
    const fail = (err) => JSON.stringify({ ok: false, error: err });
    if (!guarantorKey || !relation || !amount) {
        return fail('err-guarantee-args-empty: guarantor_key/relation/amount 必填');
    }
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const norm = (s) => String(s == null ? '' : s).replace(/\\s+/g, ' ').trim();
    const compact = (s) => String(s == null ? '' : s).replace(/\\s+/g, '');
    const visible = (el) => {
        if (!el) return false;
        if (el.offsetParent !== null) return true;
        const st = getComputedStyle(el);
        if (st.display === 'none' || st.visibility === 'hidden') return false;
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
    };
    const realClick = async (el) => {
        if (!el) return false;
        el.scrollIntoView({ block: 'center', behavior: 'instant' });
        await sleep(120);
        const fire = (type) => el.dispatchEvent(
            new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
        fire('mousedown');
        await sleep(40);
        fire('mouseup');
        await sleep(30);
        fire('click');
        return true;
    };

    // 等弹窗可见（≤3s，判据：可见 dialog 内含「担保金额」）
    let introDlg = null;
    for (let i = 0; i < 12; i++) {
        await sleep(250);
        introDlg = [...document.querySelectorAll('.el-dialog, .el-drawer')]
            .find((d) => visible(d) && compact(d.textContent).includes('担保金额'));
        if (introDlg) break;
    }
    if (!introDlg) return fail('err-guarantee-dialog-not-opened');

    // 候选行定位：当前页 → 翻页（≤8 页）→ tsscBtn tab 兜底（对公保证/自然人保证）
    const rowText = (row) => compact(row.textContent || '');
    const findCandidateRow = (root) => [...root.querySelectorAll(
        '.el-table__body-wrapper tbody tr.el-table__row, .el-table__body tr, tbody tr.el-table__row'
    )].filter((row) => visible(row)
        && !row.closest('.el-table__fixed, .el-table__fixed-body-wrapper, .el-table__fixed-right')
        && rowText(row).includes(guarantorKey))[0] || null;
    const pageBtn = (txt) => [...introDlg.querySelectorAll('button, .el-button, .tsscBtn')]
        .filter((b) => visible(b) && norm(b.textContent) === txt)[0] || null;
    const gotoPage = async (p) => {
        const li = [...introDlg.querySelectorAll('.el-pager li')]
            .filter((e) => visible(e) && e.textContent.trim() === String(p)
                && !e.classList.contains('is-active'))[0];
        if (!li) return false;
        await realClick(li);
        await sleep(1200);
        return true;
    };
    let row = findCandidateRow(introDlg);
    if (!row) {
        for (let p = 2; p <= 8; p++) {
            if (!(await gotoPage(p))) break;
            row = findCandidateRow(introDlg);
            if (row) break;
        }
    }
    if (!row) {
        const tabs = [...introDlg.querySelectorAll('.tsscBtn')]
            .filter((t) => visible(t)
                && (norm(t.textContent) === '对公保证' || norm(t.textContent) === '自然人保证'));
        const activeTab = tabs.find((t) => t.className.includes('btndefault'));
        for (const t of tabs) {
            if (t === activeTab) continue;
            await realClick(t);
            await sleep(1200);
            row = findCandidateRow(introDlg);
            if (!row) {
                for (let p = 2; p <= 8; p++) {
                    if (!(await gotoPage(p))) break;
                    row = findCandidateRow(introDlg);
                    if (row) break;
                }
            }
            if (row) break;
        }
    }
    if (!row) return fail('err-guarantee-candidate-row-not-found:' + guarantorKey);

    // 行 radio 真点击（mousedown 链；优先 .el-radio__inner）
    const radio = row.querySelector('label.el-radio, .el-radio, input[type="radio"]');
    if (!radio) return fail('err-guarantee-radio-not-found');
    const radioTarget = (radio.querySelector && radio.querySelector('.el-radio__inner')) || radio;
    await realClick(radioTarget);
    await sleep(400);

    // 表头定列（r19 实证：可见控件顺序 ≠ 展示列序）
    const headerIndexOf = (tbl, name) => {
        const ths = [...tbl.querySelectorAll('.el-table__header-wrapper th')]
            .filter((th) => !th.classList.contains('gutter'));
        for (let i = 0; i < ths.length; i++) {
            if (norm(ths[i].innerText || ths[i].textContent).includes(name)) return i;
        }
        return -1;
    };
    const tbl = row.closest('.el-table') || introDlg;
    const tds = [...row.querySelectorAll('td')];
    const tdRel = tds[headerIndexOf(tbl, '与借款人关系')] || null;
    const tdAmt = tds[headerIndexOf(tbl, '担保金额')] || null;

    // 关系列 el-select：点开 → 最近可见 dropdown → 点含 relation 文本 item
    const sel = (tdRel && tdRel.querySelector('.el-select'))
        || row.querySelector('.el-select');
    if (!sel || !visible(sel)) return fail('err-guarantee-relation-select-not-found');
    const trigger = sel.querySelector('.el-input__inner') || sel;
    const r0 = trigger.getBoundingClientRect();
    await realClick(trigger);
    let hit = null;
    for (let i = 0; i < 12; i++) {
        await sleep(250);
        let best = null, bestScore = Infinity;
        for (const dd of document.querySelectorAll('.el-select-dropdown')) {
            if (dd.classList.contains('is-hidden') || !visible(dd)) continue;
            const rr = dd.getBoundingClientRect();
            if (rr.width <= 0) continue;
            const score = Math.abs(rr.top - r0.bottom) + Math.abs(rr.left - r0.left);
            if (score < bestScore) { bestScore = score; best = dd; }
        }
        if (!best) continue;
        const items = [...best.querySelectorAll('.el-select-dropdown__item')]
            .filter((it) => visible(it) && !it.classList.contains('is-disabled'));
        hit = items.find((it) => norm(it.textContent) === relation)
            || items.find((it) => norm(it.textContent).includes(relation));
        if (hit) break;
    }
    if (!hit) return fail('err-guarantee-relation-option-not-found:' + relation);
    hit.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    await sleep(40);
    hit.click();
    await sleep(350);
    const relEcho = norm(trigger.value || '');
    if (!relEcho || (relEcho !== norm(hit.textContent)
        && !norm(hit.textContent).includes(relEcho)
        && !relEcho.includes(norm(hit.textContent)))) {
        return fail('err-guarantee-relation-unverified: expected=' + relation + ' got=' + relEcho);
    }

    // 金额列 input：native setter + input/change + 回读验证
    let inp = null;
    if (tdAmt) {
        inp = [...tdAmt.querySelectorAll('input:not([type="hidden"]):not([type="radio"]), textarea')]
            .find((i) => visible(i) && !i.disabled && !i.readOnly) || null;
    }
    if (!inp) {
        inp = [...row.querySelectorAll('input:not([type="hidden"]):not([type="radio"]), textarea')]
            .find((i) => visible(i) && !i.disabled && !i.readOnly) || null;
    }
    if (!inp) return fail('err-guarantee-amount-input-not-found');
    inp.focus();
    const desc = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
    desc.set.call(inp, amount);
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    inp.dispatchEvent(new Event('change', { bubbles: true }));
    inp.blur();
    await sleep(400);
    const got = parseFloat(inp.value), want = parseFloat(amount);
    if (!(norm(inp.value) === norm(amount)
        || (Number.isFinite(got) && Number.isFinite(want) && got === want))) {
        return fail('err-guarantee-amount-unverified: expected=' + amount + ' got=' + inp.value);
    }
    return JSON.stringify({ ok: true, relation: relEcho, amount: inp.value });
}'''

JS_INTRODUCE_GUARANTOR_VERIFY = '''async (args) => {
    const [keyRaw] = args || [];
    const guarantorKey = String(keyRaw == null ? '' : keyRaw).trim();
    const fail = (err, extra) => JSON.stringify(Object.assign({ ok: false, error: err }, extra || {}));
    if (!guarantorKey) return fail('err-guarantee-args-empty: guarantor_key 必填');
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const norm = (s) => String(s == null ? '' : s).replace(/\\s+/g, ' ').trim();
    const compact = (s) => String(s == null ? '' : s).replace(/\\s+/g, '');
    const visible = (el) => {
        if (!el) return false;
        if (el.offsetParent !== null) return true;
        const st = getComputedStyle(el);
        if (st.display === 'none' || st.visibility === 'hidden') return false;
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
    };
    const realClick = async (el) => {
        if (!el) return false;
        el.scrollIntoView({ block: 'center', behavior: 'instant' });
        await sleep(120);
        const fire = (type) => el.dispatchEvent(
            new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
        fire('mousedown');
        await sleep(40);
        fire('mouseup');
        await sleep(30);
        fire('click');
        return true;
    };
    const findButton = (root, texts) => {
        for (const btn of root.querySelectorAll('button, .el-button, a')) {
            if (!visible(btn)) continue;
            const t = norm(btn.textContent);
            if (texts.includes(t)) return btn;
        }
        return null;
    };
    const visibleDialogs = () => [...document.querySelectorAll('.el-dialog, .el-drawer')]
        .filter((d) => visible(d));
    const introDlg = visibleDialogs()
        .find((d) => compact(d.textContent).includes('担保金额')) || null;

    // 主列表读取：表头含「客户编号」+「与借款人关系」+「担保金额」的 el-table，
    // 排除弹窗自身（表头特征断言防误读弹窗候选表/其他表）；多个候选表时依次
    // 尝试，取首个含 key 的表，否则回退第一个候选表的行数
    const readMain = () => {
        const tables = [...document.querySelectorAll('.el-table')].filter((t) => {
            if (introDlg && (introDlg.contains(t) || t.contains(introDlg))) return false;
            if (!visible(t)) return false;
            const head = compact(t.querySelector('.el-table__header-wrapper')?.textContent || '');
            return head.includes('客户编号') && head.includes('与借款人关系')
                && head.includes('担保金额');
        });
        let first = null;
        for (const t of tables) {
            const rows = [...t.querySelectorAll(
                '.el-table__body-wrapper tbody tr.el-table__row, .el-table__body tr'
            )].filter((r) => visible(r)
                && !r.closest('.el-table__fixed, .el-table__fixed-body-wrapper, .el-table__fixed-right'));
            const info = { rows: rows.length, hasKey: rows.some((r) => rowKey(r)) };
            if (info.hasKey) return info;
            if (!first) first = info;
        }
        return first;
    };
    const rowKey = (r) => compact(r.textContent || '').includes(guarantorKey);

    // 1) 错误面（r21 实证：确认失败错误只在「异常信息」弹窗）
    let errDlg = null;
    for (let i = 0; i < 8; i++) {
        errDlg = visibleDialogs().find((d) => d !== introDlg
            && compact(d.textContent).includes('异常信息'))
            || visibleDialogs().find((d) => d !== introDlg
                && d.classList.contains('el-message-box')
                && /失败|错误|不可|请先/.test(d.textContent));
        if (errDlg) break;
        await sleep(250);
    }
    if (errDlg) {
        const errText = norm(errDlg.textContent).slice(0, 300);
        const okBtn = findButton(errDlg, ['确 定', '确定', '确 认', '确认']);
        if (okBtn) { try { await realClick(okBtn); } catch (e) { /* leave */ } }
        await sleep(400);
        if (errText.includes('不可重复被引入')) {
            const main = readMain();
            if (main && main.hasKey) {
                return JSON.stringify({ ok: true, dup: true, rows: main.rows, verified_in: 'main-form' });
            }
            return fail('err-guarantee-dup-not-in-list');
        }
        return fail('err-guarantee-rejected:' + errText.slice(0, 160));
    }

    // 2) 等弹窗关闭（≤4s）
    if (introDlg) {
        let closed = false;
        for (let i = 0; i < 16; i++) {
            await sleep(250);
            if (!visible(introDlg) || !introDlg.isConnected) { closed = true; break; }
        }
        if (!closed) {
            // run-ig 实证：重复引入被后端拒（code:100 同一保证人不可重复被引入）
            // 时「异常信息」弹窗可能不渲染（仅 console/XHR），弹窗保持打开。
            // 此时若主列表已有该行 = 幂等成功（dup），否则才是真未关闭。
            const mainNow = readMain();
            if (mainNow && mainNow.hasKey) {
                return JSON.stringify({ ok: true, dup: true, rows: mainNow.rows, verified_in: 'main-form' });
            }
            return fail('err-guarantee-dialog-not-closed');
        }
    }

    // 3) 轮询主列表出现含 key 的行（≤3s）
    for (let i = 0; i < 12; i++) {
        const main = readMain();
        if (main && main.hasKey) {
            return JSON.stringify({ ok: true, dup: false, rows: main.rows, verified_in: 'main-form' });
        }
        await sleep(250);
    }
    const last = readMain();
    return fail('err-guarantee-not-in-list:' + guarantorKey,
        last ? { rows: last.rows } : undefined);
}'''
