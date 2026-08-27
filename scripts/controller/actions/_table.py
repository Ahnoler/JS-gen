"""Table actions: click row actions in el-table."""

from scripts.state import _record_action
from ._helpers import _ok, _err, _is_ok_result, _enrich_click_element


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
        await page.wait_for_timeout(500)
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
            return _err(
                f'{result}. '
                f'不要盲点行内其他按钮。若该操作按钮在表格上方工具栏（本类页面常见：'
                f'单选框选中行 → 点工具栏「{button_text}」），改为先 '
                f'click_table_row_radio(row_text="{row_text}") 选中行，再点击工具栏按钮。',
            )
        return result

    @controller.action('Click the radio button in an el-table row, identified by row text. Clicks label.el-radio > .el-radio__inner. Supports Element UI fixed columns.')
    async def click_table_row_radio(row_text: str):
        page = await browser_context.get_current_page()
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
            ([rowText]) => {
                if (!rowText) return 'row-text-empty';
                const pickSel = (root) => root && root.querySelector(
                    'label.el-radio, .el-radio, label.el-checkbox, .el-checkbox, input[type="radio"]'
                );
                const clickSel = (el) => {
                    if (!el) return false;
                    const inner = el.querySelector
                        ? el.querySelector('.el-radio__inner, .el-checkbox__inner')
                        : null;
                    (inner || el).click();
                    return true;
                };
                const wantFirst = /^(first|1st|第一个|第一项|首行)$/i.test(String(rowText).trim());
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
                const tables = document.querySelectorAll('.el-table');
                for (const table of tables) {
                    const bodyRows = table.querySelectorAll(
                        '.el-table__body-wrapper tbody tr.el-table__row, .el-table__body-wrapper tbody tr'
                    );
                    for (let i = 0; i < bodyRows.length; i++) {
                        const row = bodyRows[i];
                        if (!rowMatches(row)) continue;
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
                        clickSel(radio);
                        return 'ok';
                    }
                }
                return 'row-not-found';
            }
        ''', [row_text])
        await page.wait_for_timeout(500)
        if _is_ok_result(result):
            _record_action('click_table_row_radio', {'row_text': row_text}, result, element=element)
            return _ok(result + ' | loc:.el-table__row:has-text("' + row_text + '")')
        return result
