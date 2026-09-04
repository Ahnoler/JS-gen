"""Table actions: click row actions in el-table."""

from scripts.state import _record_action
from ._helpers import _ok, _err, _is_ok_result, _enrich_click_element
from .result_protocol import err_with
from ._js_snippets import (
    JS_STRIP_STALE_WRAPPERS,
    JS_FILL_TABLE_CELL,
    JS_INTRODUCE_GUARANTOR_FILL,
    JS_INTRODUCE_GUARANTOR_VERIFY,
)
from .replay_timing import WAIT_500_MS
from ._workspace import _workspace_result, _real_click_via_cdp


async def _table_cell_impl(browser_context, row_text, column_index, value, kind,
                           header_name=''):
    """Shared impl for fill_table_cell / select_table_cell via JS_FILL_TABLE_CELL.

    header_name (optional): 弹窗表头列名（如「担保金额」「与借款人关系」）。
    提供时优先按表头列序定位单元格（run21/task4 修复：可见控件顺序 ≠ 展示
    列序），表头未命中回落 column_index 计数。

    Returns (ok, payload_str) parsed from the JS JSON-string result."""
    page = await browser_context.get_current_page()
    result = await page.evaluate(
        JS_FILL_TABLE_CELL,
        [row_text, int(column_index), str(value), kind, str(header_name or '')])
    # Native setter + Vue re-render settling buffer after write.
    await page.wait_for_timeout(300)
    return _workspace_result(result)


def _register_table_actions(controller, browser_context, business_data_store=None):
    @controller.action('Click a button in an el-table row by matching row text and button text. Supports edit/delete icon shortcuts. If the row has no such button (toolbar-style tables: select the row via radio, then click the toolbar button), returns structured guidance instead of clicking an arbitrary control.')
    async def click_table_row_button(row_text: str, button_text: str):
        page = await browser_context.get_current_page()
        # Pre-mutation snapshot of the intended control
        element = await _enrich_click_element(
            page,
            text=button_text,
            target_kind='table_row_button',
        )
        if element:
            # Prefer the enriched unique-key row text (customer-number / credit code)
            # over the caller-supplied row_text, which may be an easily duplicated name.
            element['row_text'] = element.get('row_text') or row_text
            element['button_text'] = button_text
            element['target_kind'] = 'table_row_button'
        result = await page.evaluate('''
            ([rowText, btnText]) => {
                const rows = document.querySelectorAll('.el-table__body-wrapper .el-table__row');
                const rowCellTexts = (row) => {
                    const cells = row.querySelectorAll('td, .el-table__cell');
                    const out = [];
                    for (const c of cells) {
                        const t = (c.innerText || c.textContent || '').trim().replace(/\\s+/g, ' ');
                        if (t && t !== 'radio' && t !== 'checkbox') out.push(t);
                    }
                    return out;
                };
                let matchedRow = null;
                for (const row of rows) {
                    const texts = rowCellTexts(row);
                    for (const t of texts) { if (t === rowText) { matchedRow = row; break; } }
                    if (matchedRow) break;
                }
                if (!matchedRow) {
                    // Whitespace-stripped compare: agents pass multi-cell text
                    // space-joined ("编号 名称") while textContent concatenates
                    // adjacent cells without spaces ("编号名称").
                    const wantCompact = String(rowText).replace(/\\s+/g, '');
                    for (const row of rows) {
                        if (((row.textContent || '').replace(/\\s+/g, '')).includes(wantCompact)) { matchedRow = row; break; }
                    }
                }
                if (!matchedRow) return 'row-not-found';
                const row = matchedRow;
                const buttons = row.querySelectorAll('button, .el-button, a');
                    for (const btn of buttons) {
                        const text = btn.textContent?.trim() || '';
                        const cls = btn.className || '';
                        if (text.includes(btnText) || cls.includes(btnText.toLowerCase())) {
                            if (btn.offsetParent !== null) { btn.click(); return 'ok'; }
                        }
                    }
                    if (btnText === 'edit' || btnText === '编辑') {
                        const editIcon = row.querySelector('i.el-icon-edit, i[class*="bianji"], i[class*="edit"], i[class*="xiugai"]');
                        if (editIcon && editIcon.offsetParent !== null) { editIcon.click(); return 'ok-icon'; }
                    }
                    if (btnText === 'delete' || btnText === '删除') {
                        const delIcon = row.querySelector('i.el-icon-delete, i[class*="shanchu"], i[class*="delete"]');
                        if (delIcon && delIcon.offsetParent !== null) { delIcon.click(); return 'ok-icon'; }
                    }
                    // NO blind first-visible-button fallback — it clicked unrelated
                    // controls (e.g. the customer-name view link) and recorded fake
                    // success. Report what the row actually offers so the agent can
                    // switch strategy (radio-select + toolbar button).
                    const visibleBtns = [...buttons]
                        .filter((b) => b.offsetParent !== null)
                        .map((b) => (b.textContent || '').trim())
                        .filter(Boolean);
                    const hasRadio = !!row.querySelector('.el-radio, input[type=radio]');
                    return 'button-not-found-in-row:' + JSON.stringify({
                        wanted: btnText,
                        rowButtons: visibleBtns,
                        rowHasRadio: hasRadio,
                    });
            }
        ''', [row_text, button_text])
        await page.wait_for_timeout(WAIT_500_MS)
        if _is_ok_result(result):
            _record_action(
                'click_table_row_button',
                {'row_text': row_text, 'button_text': button_text},
                result,
                element=element,
            )
            if business_data_store is not None:
                from scripts.controller.actions.container_naming import remember_trigger_button
                remember_trigger_button(business_data_store, button_text)
            return _ok(result + ' | loc:.el-table__row:has-text("' + row_text + '")')
        if str(result).startswith('button-not-found-in-row'):
            import json as _json
            body = {}
            try:
                body = _json.loads(result.split(':', 1)[1])
            except Exception:
                body = {}
            radio_hint = (
                f'click_table_row_radio(row_text="{row_text}") 选中行后再点工具栏「{button_text}」'
                if body.get('rowHasRadio') else '该行无可选中单选框，请换定位策略'
            )
            return err_with(
                "err-button-not-found-in-row",
                f"行内没有「{button_text}」按钮",
                observed=result.split(':', 1)[1],
                next_action=radio_hint + '；禁止盲点行内其他控件',
            )
        if str(result) == 'row-not-found':
            return err_with(
                "err-table-row-not-found",
                f"表格中没有匹配行（row_text={row_text!r}）；匹配顺序=单元格精确→去空白包含",
                next_action='改抄扫描结果里该行的完整单元格文本后重试',
            )
        return result

    @controller.action('Click the radio button in an el-table row, identified by row text. Clicks label.el-radio > .el-radio__inner. Supports Element UI fixed columns.')
    async def click_table_row_radio(row_text: str):
        page = await browser_context.get_current_page()
        # Pre-strip stale dialog wrappers (tsscMutilDialog 关闭残留) so real
        # clicks reach the row radio; idempotent, <10ms.
        try:
            await page.evaluate(JS_STRIP_STALE_WRAPPERS)
        except Exception:
            pass
        element = await _enrich_click_element(
            page,
            text=row_text,
            target_kind='table_row_radio',
        )
        if element:
            # Prefer the enriched unique-key row text (customer-number / credit code)
            # over the caller-supplied row_text, which may be an easily duplicated name.
            element['row_text'] = element.get('row_text') or row_text
            element['target_kind'] = 'table_row_radio'
        result = await page.evaluate('''
            async ([rowText]) => {
                if (!rowText) return 'row-text-empty';
                const pickSel = (root) => root && root.querySelector(
                    'label.el-radio, .el-radio, label.el-checkbox, .el-checkbox, input[type="radio"]'
                );
                // KB-I5 round 4: Element UI radios need the real
                // mousedown -> mouseup -> click chain; a synthetic single
                // click() does not update the Vue model.
                const clickSel = async (el) => {
                    if (!el) return false;
                    const inner = el.querySelector
                        ? el.querySelector('.el-radio__inner, .el-checkbox__inner')
                        : null;
                    const target = inner || el;
                    const fire = (type) => target.dispatchEvent(
                        new MouseEvent(type, { bubbles: true, cancelable: true, view: window })
                    );
                    fire('mousedown');
                    await new Promise((r) => setTimeout(r, 30));
                    fire('mouseup');
                    await new Promise((r) => setTimeout(r, 30));
                    fire('click');
                    return true;
                };
                const wantFirst = /^(first|1st|第一个|第一项|首行)$/i.test(String(rowText).trim());
                // Container scope first: when a topmost visible drawer/dialog is
                // open, search tables ONLY inside it. Page-level lists also count
                // as "visible" (offsetParent non-null behind the overlay), so the
                // 额度节点表 (0 rows) inside a drawer must not be shadowed by a
                // hidden page list row (frz round-2 N2 failure). Topmost = highest
                // z-index, same rule as _JS_CLICK_BUTTON_IN_CONTAINER.
                const overlays = [...document.querySelectorAll('.el-drawer, .el-dialog')]
                    .filter((d) => {
                        if (d.offsetParent !== null) return true;
                        const st = getComputedStyle(d);
                        if (st.display === 'none' || st.visibility === 'hidden') return false;
                        const r = d.getBoundingClientRect();
                        return r.width > 0 && r.height > 0;
                    });
                let scope = null;
                let bestZ = -1;
                for (const o of overlays) {
                    const z = parseInt(getComputedStyle(o).zIndex || '0', 10) || 0;
                    if (z >= bestZ) { bestZ = z; scope = o; }
                }
                const scopeRoot = scope || document;
                // N2: a matched row must be VISIBLE (offsetParent!==null) — hidden
                // tables (e.g. a previous tab / closed drawer) used to match and
                // click an invisible radio, returning ok with rowCount=0 in the
                // real (visible) table. Same rect fallback pattern as
                // JS_FIND_LABELED_SELECT for position:fixed ancestors.
                const rowVisible = (row) => {
                    if (row.offsetParent !== null) return true;
                    const st = getComputedStyle(row);
                    if (st.display === 'none' || st.visibility === 'hidden') return false;
                    const rect = row.getBoundingClientRect();
                    return rect.width > 0 && rect.height > 0;
                };
                // Unique-key columns (customer-number / credit code) must match EXACTLY
                // to disambiguate same-named rows; fall back to textContent.includes.
                const rowCellTexts = (row) => {
                    const cells = row.querySelectorAll('td, .el-table__cell');
                    const out = [];
                    for (const c of cells) {
                        const t = (c.innerText || c.textContent || '').trim().replace(/\\s+/g, ' ');
                        if (t && t !== 'radio' && t !== 'checkbox') out.push(t);
                    }
                    return out;
                };
                const rowMatches = (row) => {
                    if (wantFirst) return true;
                    const texts = rowCellTexts(row);
                    for (const t of texts) { if (t === rowText) return true; }
                    // Whitespace-stripped fallback: caller row_text may be
                    // space-joined across cells ("编号 名称") while textContent
                    // concatenates adjacent cells without spaces.
                    const wantCompact = String(rowText).replace(/\\s+/g, '');
                    return ((row.textContent || '').replace(/\\s+/g, '')).includes(wantCompact);
                };
                const tables = scopeRoot.querySelectorAll('.el-table');
                let matchedCount = 0;
                for (const table of tables) {
                    const bodyRows = table.querySelectorAll(
                        '.el-table__body-wrapper tbody tr.el-table__row, .el-table__body-wrapper tbody tr'
                    );
                    for (let i = 0; i < bodyRows.length; i++) {
                        const row = bodyRows[i];
                        if (!rowMatches(row)) continue;
                        if (!rowVisible(row)) continue;
                        matchedCount += 1;
                        row.scrollIntoView({ block: 'center', behavior: 'instant' });
                        let radio = pickSel(row);
                        if (!radio) {
                            const fixedRows = table.querySelectorAll(
                                '.el-table__fixed-body-wrapper tbody tr.el-table__row, '
                                + '.el-table__fixed tbody tr.el-table__row, '
                                + '.el-table__fixed-left tbody tr.el-table__row, '
                                + '.el-table__fixed-right tbody tr.el-table__row'
                            );
                            if (fixedRows[i]) radio = pickSel(fixedRows[i]);
                        }
                        if (!radio) {
                            if (wantFirst) continue;
                            return 'radio-not-found-in-row';
                        }
                        await clickSel(radio);
                        return 'ok';
                    }
                }
                // N2: zero VISIBLE matched rows — an empty table (0 rows, e.g.
                // 额度节点表 with no data) must be an explicit failure, not a
                // fake ok. matchedCount stays 0 both when nothing matched the
                // text and when only hidden (offsetParent===null) copies matched.
                if (matchedCount === 0) {
                    return 'err-no-row-match:' + rowText;
                }
                return 'row-not-found';
            }
        ''', [row_text])
        await page.wait_for_timeout(WAIT_500_MS)
        if _is_ok_result(result):
            _record_action('click_table_row_radio', {'row_text': row_text}, result, element=element)
            return _ok(result + ' | loc:.el-table__row:has-text("' + row_text + '")')
        if str(result).startswith('err-no-row-match:'):
            # N2: explicit zero-row failure — never treat rowCount=0 as success.
            return err_with(
                "err-no-row-match",
                f"表格 0 行命中（row_text={row_text!r}），不视为选中成功",
                observed=str(result),
                next_action='改抄扫描结果里该行的完整单元格文本重试；若表格确实无数据行，跳过本步并回报空表',
            )
        if str(result) == 'row-not-found':
            return err_with(
                "err-table-row-not-found",
                f"表格中没有匹配行可选中单选框（row_text={row_text!r}）；匹配顺序=单元格精确→去空白包含",
                next_action='改抄扫描结果里该行的完整单元格文本后重试',
            )
        return result

    @controller.action(
        'Write a value into an editable cell of an el-table row in the topmost '
        'visible dialog (e.g. the 引入保证人 popup), identified by row_text '
        '(unique-key cell text preferred) and column_index (0-based, counting '
        'VISIBLE editable inputs, skipping radio/checkbox/hidden). Uses the '
        'Element UI native setter + input/change events, then reads the value '
        'back. column_index=-1 means: operate the first visible .el-select in '
        'the row (inline dropdown, e.g. 与借款人关系=企业股东). Errors: '
        'err-table-cell-not-written:<row>:<col> with why '
        '(row-not-found / input-not-found / write-unverified / '
        'dropdown-not-opened / option-not-found / select-unverified).'
    )
    async def fill_table_cell(row_text: str, column_index: int, value: str,
                              header_name: str = ''):
        ok, payload = await _table_cell_impl(
            browser_context, row_text, column_index, value, kind='input',
            header_name=header_name)
        if ok:
            return _ok(payload)
        return err_with(
            'err-table-cell-not-written',
            f'行内单元格写入未验证（row={row_text!r} col={column_index} value={value!r}）',
            observed=payload,
            next_action='先用 scan_visible_fields/semantic_snapshot 核对行内控件列序；'
                        '若目标是行内下拉请改用 select_table_cell 或 fill_table_cell(column_index=-1)',
        )

    @controller.action(
        'Select an option in an inline el-select inside an el-table row of the '
        'topmost visible dialog (e.g. 与借款人关系 in the 引入保证人 popup), '
        'identified by row_text and column_index (0-based, counting VISIBLE '
        '.el-select widgets in the row — NOT input columns). Opens the dropdown '
        'with a real mousedown chain, clicks the item whose text matches value, '
        'and reads the trigger input back. Errors: '
        'err-table-cell-not-written:<row>:<col> with why '
        '(row-not-found / select-not-found / dropdown-not-opened / '
        'option-not-found / select-unverified).'
    )
    async def select_table_cell(row_text: str, column_index: int, value: str,
                                header_name: str = ''):
        ok, payload = await _table_cell_impl(
            browser_context, row_text, column_index, value, kind='select',
            header_name=header_name)
        if ok:
            return _ok(payload)
        return err_with(
            'err-table-cell-not-written',
            f'行内下拉选择未验证（row={row_text!r} col={column_index} value={value!r}）',
            observed=payload,
            next_action='核对 column_index 是否按行内 .el-select 序号（0 起）；'
                        '普通 input 列请改用 fill_table_cell',
        )

    @controller.action(
        'Introduce a guarantor in the 引入保证人 dialog with a single call '
        '(composite engine action, data/kb/flows/guarantee_intro.json). '
        'Orchestration (真机实证: tsscBtn 只响应 CDP trusted click): '
        '1) real_click(CDP) the parent-page 引入保证人 button; 2) evaluate '
        'JS_INTRODUCE_GUARANTOR_FILL — wait for the dialog, locate the '
        'candidate row matching guarantor_key (pagination + 对公保证/自然人保证 '
        'tab fallback), real-click the row radio, pick relation in the '
        '与借款人关系 inline el-select and write amount into 担保金额 '
        '(header-based column resolution, read-back verified); 3) '
        'real_click(CDP) the dialog 确认 button; 4) evaluate '
        'JS_INTRODUCE_GUARANTOR_VERIFY — read the 异常信息 error surface, then '
        'verify against the PARENT-PAGE 保证人信息列表 (never the dialog '
        'candidate table). Returns {ok:true, dup:false, rows:n} on success; '
        '{ok:true, dup:true, rows:n} when the backend rejects with '
        '不可重复被引入 AND the guarantor is already in the main list '
        '(idempotent success — safe to continue). Errors are surfaced '
        'verbatim and must NOT be blindly retried: err-guarantee-* '
        '(dialog-not-opened / candidate-row-not-found:<key> / '
        'relation-option-not-found / amount-unverified / dup-not-in-list / '
        'rejected:<异常信息摘要> / not-in-list:<key>).'
    )
    async def introduce_guarantor(guarantor_key: str, relation: str, amount: str):
        """单调用完成 引入保证人 + 后校验（读父页面保证人信息列表）。

        dup=true = 幂等成功（保证人已在途被本单占用且主列表已有行），可直接
        继续后续步骤；错误串原样带出（err-guarantee-*），调用方应读取并修正
        参数/状态，禁止原参数盲试。"""
        page = await browser_context.get_current_page()
        # 1) Trusted open: tsscBtn ignores synthetic event chains (run-ig 实证)
        rc_open = await _real_click_via_cdp(page, text='引入保证人')
        if not rc_open.startswith('ok-real-click'):
            return err_with(
                'err-guarantee-intro-failed',
                '引入保证人按钮 trusted click 失败',
                observed=rc_open,
                next_action='核对当前页面是否为用信申报编辑页（含 保证人信息列表/引入保证人 按钮）')
        # 2) In-dialog fill (synthetic OK for el-table inner controls)
        fill_raw = await page.evaluate(
            JS_INTRODUCE_GUARANTOR_FILL,
            [str(guarantor_key), str(relation), str(amount)])
        ok_fill, fill_payload = _workspace_result(fill_raw)
        if not ok_fill:
            # 弹窗已打开，留现场给调用方截图/排查，不代关
            return err_with(
                'err-guarantee-intro-failed',
                f'引入保证人弹窗内填写未通过（key={guarantor_key!r} relation={relation!r} '
                f'amount={amount!r}）',
                observed=fill_payload,
                next_action='按 observed 中的 err-guarantee-* 原因处理（候选行/下拉项/金额回读），'
                            '弹窗仍开着可人工核对候选列表')
        # 3) Trusted confirm
        rc_confirm = await _real_click_via_cdp(page, text='确认')
        # 4) Verify: error surface (dup semantics) + parent-page main list
        verify_raw = await page.evaluate(
            JS_INTRODUCE_GUARANTOR_VERIFY, [str(guarantor_key)])
        await page.wait_for_timeout(800)
        ok, payload = _workspace_result(verify_raw)
        if not ok and rc_confirm.startswith('err-real-click-fail'):
            payload = payload + ' | confirm-trusted-click:' + rc_confirm
        if ok:
            _record_action('introduce_guarantor',
                           {'guarantor_key': guarantor_key, 'relation': relation,
                            'amount': amount},
                           payload)
            return _ok(payload)
        # Structured errors from the snippet are surfaced verbatim (no retry).
        return err_with(
            'err-guarantee-intro-failed',
            f'引入保证人未通过后校验（key={guarantor_key!r} relation={relation!r} '
            f'amount={amount!r}）',
            observed=payload,
            next_action='按 observed 中的 err-guarantee-* 原因处理：dup-not-in-list 需人工核对主列表；'
                        'rejected 含异常信息摘要（在途占用等），禁止原参数盲试',
        )
