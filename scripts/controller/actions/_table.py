"""Table actions: click row actions in el-table."""

from scripts.state import _record_action
from ._helpers import _ok, _err, _is_ok_result, _enrich_click_element
from .result_protocol import err_with
from .replay_timing import WAIT_500_MS


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
