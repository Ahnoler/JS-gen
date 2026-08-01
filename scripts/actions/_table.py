"""Table actions: click row actions in el-table."""

from ._state import _record_action
from ._helpers import _ok, _is_ok_result, _enrich_click_element


def _register_table_actions(controller, browser_context):
    @controller.action('Click a button in an el-table row by matching row text and button text. Supports edit/delete icon shortcuts and fallback to first visible button.')
    async def click_table_row_button(row_text: str, button_text: str):
        page = await browser_context.get_current_page()
        # Pre-mutation snapshot of the intended control
        element = await _enrich_click_element(
            page,
            text=button_text,
            target_kind='table_row_button',
        )
        if element:
            element['row_text'] = row_text
            element['button_text'] = button_text
            element['target_kind'] = 'table_row_button'
        result = await page.evaluate('''
            ([rowText, btnText]) => {
                const rows = document.querySelectorAll('.el-table__body-wrapper .el-table__row');
                for (const row of rows) {
                    if (!row.textContent.includes(rowText)) continue;
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
                    for (const btn of buttons) {
                        if (btn.offsetParent !== null) { btn.click(); return 'ok-fallback'; }
                    }
                    return 'button-not-found-in-row';
                }
                return 'row-not-found';
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
            return _ok(result + ' | loc:.el-table__row:has-text("' + row_text + '")')
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
            element['row_text'] = row_text
            element['target_kind'] = 'table_row_radio'
        result = await page.evaluate('''
            ([rowText]) => {
                if (!rowText) return 'row-text-empty';
                const tables = document.querySelectorAll('.el-table');
                for (const table of tables) {
                    const bodyRows = table.querySelectorAll('.el-table__body-wrapper tbody tr.el-table__row, .el-table__body-wrapper tbody tr');
                    for (let i = 0; i < bodyRows.length; i++) {
                        const row = bodyRows[i];
                        if (!(row.textContent || '').includes(rowText)) continue;
                        let radio = row.querySelector('label.el-radio, .el-radio');
                        if (!radio) {
                            const fixedRows = table.querySelectorAll(
                                '.el-table__fixed-body-wrapper tbody tr.el-table__row, .el-table__fixed tbody tr.el-table__row, .el-table__fixed-left tbody tr.el-table__row'
                            );
                            if (fixedRows[i]) radio = fixedRows[i].querySelector('label.el-radio, .el-radio');
                        }
                        if (!radio) return 'radio-not-found-in-row';
                        const inner = radio.querySelector('.el-radio__inner');
                        (inner || radio).click();
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
