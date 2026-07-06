"""Table actions: click row actions in el-table."""

from ._state import _record_action
from ._helpers import _ok


def _register_table_actions(controller, browser_context):
    @controller.action('Click a button in an el-table row by matching row text and button text. Supports edit/delete icon shortcuts and fallback to first visible button.')
    async def click_table_row_button(row_text: str, button_text: str):
        page = await browser_context.get_current_page()
        result = await page.evaluate('''
            ([rowText, btnText]) => {
                const rows = document.querySelectorAll('.el-table__body-wrapper .el-table__row');
                for (const row of rows) {
                    if (!row.textContent.includes(rowText)) continue;
                    // Pass 1: search for matching button by text or class
                    const buttons = row.querySelectorAll('button, .el-button, i[class*="icon"]');
                    for (const btn of buttons) {
                        const text = btn.textContent?.trim() || '';
                        const cls = btn.className || '';
                        if (text.includes(btnText) || cls.includes(btnText.toLowerCase())) {
                            if (btn.offsetParent !== null) { btn.click(); return 'ok'; }
                        }
                    }
                    // Pass 1b: edit / delete icon shortcuts
                    if (btnText === 'edit' || btnText === '编辑') {
                        const editIcon = row.querySelector('i.el-icon-edit, i[class*="bianji"], i[class*="edit"], i[class*="xiugai"]');
                        if (editIcon && editIcon.offsetParent !== null) { editIcon.click(); return 'ok-icon'; }
                    }
                    if (btnText === 'delete' || btnText === '删除') {
                        const delIcon = row.querySelector('i.el-icon-delete, i[class*="shanchu"], i[class*="delete"]');
                        if (delIcon && delIcon.offsetParent !== null) { delIcon.click(); return 'ok-icon'; }
                    }
                    // Pass 2: fallback — click first visible button in the row
                    for (const btn of buttons) {
                        if (btn.offsetParent !== null) { btn.click(); return 'ok-fallback'; }
                    }
                    return 'button-not-found-in-row';
                }
                return 'row-not-found';
            }
        ''', [row_text, button_text])
        await page.wait_for_timeout(500)
        if result.startswith('ok'):
            _record_action('click_table_row_button', {'row_text': row_text, 'button_text': button_text}, result)
            return _ok(result + ' | loc:.el-table__row:has-text("' + row_text + '")')
        return result

    @controller.action('Click the radio button in an el-table row, identified by row text. Clicks label.el-radio > .el-radio__inner.')
    async def click_table_row_radio(row_text: str):
        page = await browser_context.get_current_page()
        result = await page.evaluate('''
            ([rowText]) => {
                const rows = document.querySelectorAll('.el-table__body-wrapper .el-table__row');
                for (const row of rows) {
                    if (!row.textContent.includes(rowText)) continue;
                    const radio = row.querySelector('label.el-radio');
                    if (!radio || radio.offsetParent === null) return 'radio-not-found-in-row';
                    const inner = radio.querySelector('.el-radio__inner');
                    (inner || radio).click();
                    return 'ok';
                }
                return 'row-not-found';
            }
        ''', [row_text])
        await page.wait_for_timeout(500)
        if result == 'ok':
            _record_action('click_table_row_radio', {'row_text': row_text}, result)
            return _ok(result + ' | loc:.el-table__row:has-text("' + row_text + '")')
        return result
