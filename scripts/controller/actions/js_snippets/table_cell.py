"""
JS snippet constant: JS_FILL_TABLE_CELL (el-table 行内单元格写入动作).

KB-I5 run15 实证根因（100% 自主闭环最后缺口）：「引入保证人」弹窗内的行内
输入（与借款人关系 el-select / 担保金额 input）没有任何 el-form-item label：
- fill_form_field 判 absent-skip（label-not-found）；
- set_vue_model 需要 label 定位 form-item；
- real_click 只点不输。
→ 需要按「行文本 + 列序号」直接操作 el-table 行内控件的动作。

模式（mode，由包装动作决定，args 第 4 位）：
- 'input'  (fill_table_cell):  行内第 column_index 个可见可编辑
  input/textarea（跳过 radio/checkbox/hidden/disabled/readonly），native
  setter 写值 + input/change 事件 → 回读验证（字符串相等或数值相等）。
- 'select' (select_table_cell): 行内第 column_index 个可见 .el-select，
  点开下拉（mousedown→click 链）→ 点含 value 文本的
  .el-select-dropdown__item → 回读 trigger input 值验证。
- column_index=-1（fill_table_cell）语义：操作行内第一个可见 .el-select，
  即「与借款人关系」这类行内下拉可直接 fill_table_cell(row, -1, 企业股东)。

KB-I5 run21 / task4 内联修复（表头定列序）：「引入保证人」弹窗表头列序 =
担保方式 / 与借款人关系 / 证件号码 / 担保金额，行内可见控件顺序 ≠ 展示列序
（担保方式列可能是 col0 的 select，按可见控件计数会点错列）。args 第 5 位
header_name 提供时优先走表头定位：扫描行所在 .el-table 的表头 th 文本命中
header_name 的列下标 → 取该行对应 td → td 内有 .el-select 走 select 写入、
否则取 td 内第一个可见可编辑 input/textarea 走 native setter 写入。表头未
命中时回落到 column_index 计数（原行为不变）。

行定位：可见 .el-dialog 内优先（弹窗内表格不被页面表格遮蔽），找不到再全局；
匹配顺序（matched_by 随返回值带出便于诊断）=
'contains' 单元格文本精确 → 去空白包含 →
'serial-tail'/'serial-head' key 为纯数字≥16位（系统流水号形态，行内不可见）
取后/前12位包含 →
'prefix' key 以4位数字前缀（2608/2609 等截断显示形态）开头且行文本以该前缀
开头。row_text 优先用可见行文本（2608 前缀或企业名），系统流水号仅作兜底。
跳过 el-table__fixed 系列克隆行。成功谓词失败时返回
{ok:false, error:'err-table-cell-not-written:<row>:<col>'}。
"""

JS_FILL_TABLE_CELL = '''async (args) => {
    const [rowTextRaw, colIndexRaw, valueRaw, mode] = args;
    const rowText = String(rowTextRaw == null ? '' : rowTextRaw).trim();
    const colIndex = Number(colIndexRaw);
    const value = String(valueRaw == null ? '' : valueRaw);
    const headerName = String(args[4] == null ? '' : args[4]).trim();
    const kind = (mode === 'select' || (mode !== 'input' && colIndex === -1)) ? 'select' : 'input';
    const fail = (why) => JSON.stringify({
        ok: false,
        error: 'err-table-cell-not-written:' + rowText + ':' + colIndexRaw + ':' + why,
    });
    if (!rowText || Number.isNaN(colIndex)) {
        return fail('args: row_text 与 column_index 必填');
    }
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const visible = (el) => {
        if (!el) return false;
        if (el.offsetParent !== null) return true;
        const st = getComputedStyle(el);
        if (st.display === 'none' || st.visibility === 'hidden') return false;
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
    };
    const norm = (s) => String(s == null ? '' : s).replace(/\\s+/g, ' ').trim();

    // 1) 可见弹窗内优先（同 click_table_row_radio 的 topmost-zIndex 规则）
    let scopeRoot = document;
    const overlays = [...document.querySelectorAll('.el-dialog, .el-drawer')]
        .filter((d) => visible(d));
    if (overlays.length) {
        let best = null, bestZ = -1;
        for (const o of overlays) {
            const z = parseInt(getComputedStyle(o).zIndex || '0', 10) || 0;
            if (z >= bestZ) { bestZ = z; best = o; }
        }
        scopeRoot = best;
    }
    // 行匹配命中方式（matched_by），随成功/失败返回便于诊断
    let matchedBy = null;
    // 行匹配返回命中方式（matched_by），失败返回 null：
    // - 'contains'      行文本精确/去空白包含（原语义，优先）
    // - 'serial-tail'   key 为纯数字≥16位（系统流水号形态，行内不可见）→ 取后12位包含
    // - 'serial-head'   同上取前12位包含
    // - 'prefix'        key 以4位数字前缀（2608/2609 等截断显示形态）开头且行文本以该前缀开头
    const rowMatches = (row) => {
        const cells = row.querySelectorAll('td, .el-table__cell');
        for (const c of cells) {
            const t = norm(c.innerText || c.textContent);
            if (t && t === rowText) return 'contains';
        }
        const rowCompact = norm(row.textContent || '').replace(/\\s+/g, '');
        const wantCompact = rowText.replace(/\\s+/g, '');
        if (wantCompact && rowCompact.includes(wantCompact)) return 'contains';
        if (/^\\d{16,}$/.test(wantCompact)) {
            const tail = wantCompact.slice(-12);
            const head = wantCompact.slice(0, 12);
            if (tail && rowCompact.includes(tail)) return 'serial-tail';
            if (head && rowCompact.includes(head)) return 'serial-head';
        }
        const p4 = /^(\\d{4})/.exec(wantCompact);
        if (p4 && rowCompact.startsWith(p4[1])) return 'prefix';
        return null;
    };
    // 行序号兜底: row_text='4'/'#4'/'row4' → 第4个可见行(1起)；'first' → 第1行。
    // 弹窗快照常常不含表格行文本，序号是唯一可靠入口（run16 实证）。
    const rowByIndex = /^(?:#|row\\s*)?(\\d+)$|^first$|^1st$|^第一行$/i.exec(rowText);
    const rowIdx = rowByIndex
        ? (rowByIndex[1] ? parseInt(rowByIndex[1], 10) : 1) : 0;
    const findRow = (root) => {
        const rows = [...root.querySelectorAll(
            '.el-table__body-wrapper tbody tr.el-table__row, .el-table__body tr, tbody tr.el-table__row'
        )].filter((row) => {
            if (row.closest('.el-table__fixed, .el-table__fixed-body-wrapper, .el-table__fixed-right')) return false;
            return visible(row);
        });
        if (rowByIndex) { matchedBy = 'row-index'; return rows[rowIdx - 1] || null; }
        for (const row of rows) {
            const m = rowMatches(row);
            if (m) { matchedBy = m; return row; }
        }
        return null;
    };
    let row = findRow(scopeRoot);
    if (!row && scopeRoot !== document) row = findRow(document);
    if (!row) return fail('row-not-found（弹窗内+全局均无匹配可见行）');
    row.scrollIntoView({ block: 'center', behavior: 'instant' });
    await sleep(200);

    // 1.5) 表头定列序（run21/task4 修复）：header_name 命中表头列下标 →
    // 取该行对应 td（跳过 fixed 克隆 td）。返回 null = 未命中（回落 colIndex）。
    const resolveByHeader = () => {
        if (!headerName) return null;
        const tbl = row.closest('.el-table');
        if (!tbl) return null;
        const ths = [...tbl.querySelectorAll('.el-table__header-wrapper th')]
            .filter((th) => !th.classList.contains('gutter'));
        const texts = ths.map((th) => norm(th.innerText || th.textContent));
        let hIdx = -1;
        for (let i = 0; i < texts.length; i++) {
            if (texts[i] && texts[i].includes(headerName)) { hIdx = i; break; }
        }
        if (hIdx < 0) return null;
        const tds = [...row.querySelectorAll('td')];
        return tds[hIdx] || null;
    };

    const errPayload = (extra) => JSON.stringify(Object.assign({
        ok: false,
        error: 'err-table-cell-not-written:' + rowText + ':' + colIndexRaw + ':'
            + (extra && extra.why ? extra.why : 'write-unverified'),
        matched_by: matchedBy || null,
    }, extra || {}));

    // 2) select 写入（含下拉打开/选项点击/回读验证）
    async function writeSelect(selectEl, want, rText, cIdx) {
        const trigger = selectEl.querySelector('.el-input__inner') || selectEl;
        const openSel = async () => {
            const fire = (type) => trigger.dispatchEvent(
                new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
            fire('mousedown');
            await sleep(60);
            fire('mouseup');
            await sleep(30);
            fire('click');
        };
        await openSel();
        // 等待可见下拉出现（选 trigger 最近的可见 dropdown，避免命中陈旧弹层）
        const items = () => {
            const tr = trigger.getBoundingClientRect();
            let best = null, bestScore = Infinity;
            for (const dd of document.querySelectorAll('.el-select-dropdown')) {
                if (dd.classList.contains('is-hidden')) continue;
                const st = getComputedStyle(dd);
                if (st.display === 'none' || st.visibility === 'hidden') continue;
                const r = dd.getBoundingClientRect();
                if (r.width <= 0) continue;
                const score = Math.abs(r.top - tr.bottom) + Math.abs(r.left - tr.left);
                if (score < bestScore) { bestScore = score; best = dd; }
            }
            if (!best) return [];
            return [...best.querySelectorAll('.el-select-dropdown__item')]
                .filter((i) => !i.classList.contains('is-disabled') && visible(i));
        };
        let pool = [];
        for (let i = 0; i < 12; i++) {
            await sleep(250);
            pool = items();
            if (pool.length) break;
        }
        if (!pool.length) return errPayload({ why: 'dropdown-not-opened: 行内 el-select 下拉无可见选项' });
        const hit = pool.find((i) => norm(i.textContent) === want)
            || pool.find((i) => norm(i.textContent).includes(want));
        if (!hit) {
            return errPayload({ why: 'option-not-found: 候选=' + pool.slice(0, 20).map((i) => norm(i.textContent)).join('|') });
        }
        hit.scrollIntoView({ block: 'nearest' });
        hit.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        await sleep(40);
        hit.click();
        await sleep(350);
        const readBack = norm(trigger.value || '');
        const chosen = norm(hit.textContent);
        if (!readBack || readBack === chosen || chosen.startsWith(readBack) || readBack.startsWith(chosen)) {
            return JSON.stringify({
                ok: true, kind: 'select', row_text: rText, column_index: cIdx,
                value: chosen, read_back: readBack, matched_by: matchedBy || null,
            });
        }
        return errPayload({ why: 'select-unverified: expected=' + chosen + ' got=' + readBack });
    }

    // 3) input 写入（native setter + input/change + 回读验证）
    async function writeInput(inp, rText, cIdx) {
        const oldVal = inp.value;
        inp.focus();
        const proto = inp.tagName === 'TEXTAREA'
            ? window.HTMLTextAreaElement.prototype
            : window.HTMLInputElement.prototype;
        const desc = Object.getOwnPropertyDescriptor(proto, 'value');
        desc.set.call(inp, value);
        inp.dispatchEvent(new Event('input', { bubbles: true }));
        inp.dispatchEvent(new Event('change', { bubbles: true }));
        inp.blur();
        await sleep(400);
        const readBack = inp.value;
        const numEq = (() => {
            const a = parseFloat(readBack), b = parseFloat(value);
            return Number.isFinite(a) && Number.isFinite(b) && a === b;
        })();
        if (norm(readBack) === norm(value) || numEq) {
            return JSON.stringify({
                ok: true, kind: 'input', row_text: rText, column_index: cIdx,
                value: value, old_value: oldVal, read_back: readBack,
                matched_by: matchedBy || null,
            });
        }
        return errPayload({ why: 'write-unverified: expected=' + value + ' got=' + readBack });
    }

    // 表头命中优先路径：td 内 select → writeSelect；input → writeInput
    const tdByHeader = resolveByHeader();
    if (tdByHeader) {
        const selInTd = tdByHeader.querySelector('.el-select');
        if (selInTd && visible(selInTd)) {
            return await writeSelect(selInTd, value, rowText, colIndexRaw);
        }
        const editable = [...tdByHeader.querySelectorAll(
            'input:not([type="hidden"]):not([type="radio"]):not([type="checkbox"]), textarea'
        )].filter((i) => visible(i) && !i.disabled && !i.readOnly);
        if (editable[0]) {
            return await writeInput(editable[0], rowText, colIndexRaw);
        }
        // header 命中但 td 内无可写控件 → 回落 colIndex 计数
    }

    // 4) input 模式（colIndex 计数）
    if (kind === 'input') {
        const inputs = [...row.querySelectorAll(
            'input:not([type="hidden"]):not([type="radio"]):not([type="checkbox"]), textarea'
        )].filter((i) => visible(i) && !i.disabled && !i.readOnly);
        if (colIndex === -1) {
            // -1 在 input 模式下转 select：行内第一个 el-select
            const sel = row.querySelector('.el-select');
            if (sel && visible(sel)) return await writeSelect(sel, value, rowText, colIndexRaw);
            return errPayload({ why: 'column_index=-1 但行内无可见 .el-select；可见 input 数=' + inputs.length });
        }
        const inp = inputs[colIndex];
        if (!inp) {
            return errPayload({ why: 'input-not-found: 第' + colIndex + '个可见可编辑输入不存在，行内可见输入数=' + inputs.length });
        }
        return await writeInput(inp, rowText, colIndexRaw);
    }

    // 5) select 模式（colIndex 计数，含 column_index=-1 转入）
    const selects = [...row.querySelectorAll('.el-select')].filter((s) => visible(s));
    const sel = selects[colIndex];
    if (!sel) {
        return errPayload({ why: 'select-not-found: 第' + colIndex + '个可见 .el-select 不存在，行内可见 select 数=' + selects.length });
    }
    return await writeSelect(sel, value, rowText, colIndexRaw);
}'''
