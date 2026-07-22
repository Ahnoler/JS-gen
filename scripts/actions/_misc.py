"""
Miscellaneous actions: loading, page state, trajectory, notifications,
dialogs, screenshots, element click, scrolling.

Note: click_adjacent_button and click_radio moved to _form.py for
logical coherence with other form-filling actions.
"""

import json
import os
from datetime import datetime

from . import _state
from ._helpers import _ok, _err
from ._js_snippets import JS_GET_CONTAINER
from ..models import ActionFile, FormSnapshot, FormSnapshotCollection

# Path helper: __file__ is scripts/actions/_misc.py, so go up 2 levels
_SCRIPTS_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _register_misc_actions(controller, browser_context, case_data_store=None):
    @controller.action('Wait for Element UI loading mask to disappear.')
    async def wait_for_loading():
        page = await browser_context.get_current_page()
        await page.evaluate('''() => new Promise(resolve => {
            let elapsed = 0;
            const check = () => {
                if (elapsed >= 30000) { resolve('timeout'); return; }
                const mask = document.querySelector('.el-loading-mask:not(.el-loading-mask--hidden)');
                const spinner = document.querySelector('.el-loading-spinner');
                const spinnerVisible = spinner && spinner.offsetParent !== null;
                if ((!mask || mask.offsetParent === null) && !spinnerVisible) resolve('done');
                else { elapsed += 200; setTimeout(check, 200); }
            };
            check();
        })''')
        return _ok('loading-done')

    @controller.action('Get current page state: visible dialogs, loading, errors, etc.')
    async def get_page_state():
        page = await browser_context.get_current_page()
        state = await page.evaluate('''() => {
            const dialogs = document.querySelectorAll('.el-dialog');
            const visibleDialogs = [...dialogs].filter(d => d.offsetParent !== null);
            const drawers = document.querySelectorAll('.el-drawer');
            const visibleDrawers = [...drawers].filter(d => d.offsetParent !== null);
            return {
                dialogCount: dialogs.length,
                visibleDialogCount: visibleDialogs.length,
                visibleDialogTitles: visibleDialogs.map(d => d.querySelector('.el-dialog__title')?.textContent?.trim() || ''),
                msgboxVisible: !!document.querySelector('.el-message-box') && document.querySelector('.el-message-box').offsetParent !== null,
                drawerCount: visibleDrawers.length,
                loading: !!document.querySelector('.el-loading-mask:not(.el-loading-mask--hidden)'),
                openDropdown: !!document.querySelector('.el-select-dropdown:not(.is-hidden)'),
                formErrors: [...document.querySelectorAll('.el-form-item__error')].map(e => e.textContent.trim()).filter(Boolean),
                messages: [...document.querySelectorAll('.el-message')].map(e => e.textContent.trim()).filter(Boolean),
                notifications: [...document.querySelectorAll('.el-notification')].filter(e => e.offsetParent !== null).map(e => e.textContent.trim()).filter(Boolean),
                activeTab: document.querySelector('.el-tabs__item.is-active')?.textContent?.trim() || null,
                treeNodes: document.querySelectorAll('.el-tree-node').length || 0,
                tableRows: document.querySelectorAll('.el-table__body-wrapper .el-table__row').length || 0,
                url: location.href,
            };
        }''')
        _state._TRAJECTORY_URL = state.get('url', '')
        return json.dumps(state, ensure_ascii=False)

    @controller.action('Save the accumulated trajectory in atp-record import-compatible JSON format.')
    async def save_trajectory(output_dir: str = None):
        """Save trajectory entries to a JSON file in atp-record format."""
        if not _state._ACTION_LOG:
            return _err('no-trajectory-entries')
        try:
            if not output_dir:
                output_dir = os.path.join(_SCRIPTS_DIR, 'action')
            os.makedirs(output_dir, exist_ok=True)
            ts = datetime.now().strftime('%Y%m%d_%H%M%S')
            filepath = os.path.join(output_dir, f'action_{ts}.json')

            action_file = ActionFile.from_action_log(
                list(_state._ACTION_LOG),
                url=_state._TRAJECTORY_URL or 'http://unknown',
                name='browser-use-exploration',
            )
            action_json = action_file.model_dump()

            # Write form structure snapshots if available (prefer array, fall back to single)
            coll = FormSnapshotCollection.from_store(case_data_store)
            snapshots = coll.to_dicts()
            if snapshots:
                forms_dir = os.path.join(_SCRIPTS_DIR, 'forms')
                os.makedirs(forms_dir, exist_ok=True)
                form_path = os.path.join(forms_dir, f'form_{ts}.json')
                with open(form_path, 'w', encoding='utf-8') as f:
                    json.dump(snapshots, f, ensure_ascii=False, indent=2)
                action_json['form_snapshot'] = f'scripts/forms/form_{ts}.json'

            with open(filepath, 'w', encoding='utf-8') as f:
                json.dump(action_json, f, ensure_ascii=False, indent=2)

            count = len(_state._ACTION_LOG)
            _state._ACTION_LOG.clear()
            _state._emit_action_log_sync()
            return _ok(f'saved:{filepath} | entries:{count}')
        except Exception as e:
            return _err(f'save-error:{e}')

    @controller.action('Close visible el-notification popup, read its text, and return it. Returns "no-notification" if none found. Use this for server-side validation errors — NOT for dialogs/drawers.')
    async def close_notification():
        page = await browser_context.get_current_page()
        notif = await page.evaluate('''() => {
            for (const el of document.querySelectorAll('.el-notification')) {
                const r = el.getBoundingClientRect();
                if (r.width > 0 && r.height > 0) return el.id || el.getAttribute('data-index') || '';
            }
            return null;
        }''')
        if notif is not None:
            notif_text = await page.evaluate('''() => {
                for (const el of document.querySelectorAll('.el-notification')) {
                    const r = el.getBoundingClientRect();
                    if (r.width > 0 && r.height > 0) return (el.textContent || '').trim();
                }
                return '';
            }''')
            try:
                close_btn = page.locator('.el-notification__closeBtn').locator('visible=true').first
                await close_btn.click(timeout=3000)
            except Exception:
                await page.evaluate('''() => {
                    for (const el of document.querySelectorAll('.el-notification')) {
                        const r = el.getBoundingClientRect();
                        if (r.width > 0 && r.height > 0) {
                            const cb = el.querySelector('.el-notification__closeBtn');
                            if (cb) { cb.dispatchEvent(new MouseEvent('mousedown',{bubbles:true})); cb.click(); }
                            return;
                        }
                    }
                }''')
            await page.wait_for_timeout(300)
            return _ok(f'ok-notification: {notif_text[:200]}')
        return 'no-notification'

    @controller.action('Close the topmost el-dialog, el-message-box, or el-drawer. El-notification has its own close_notification action.')
    async def close_dialog():
        page = await browser_context.get_current_page()
        msgbox = await page.query_selector('.el-message-box')
        if msgbox:
            visible = await msgbox.evaluate('el => el.offsetParent !== null')
            if visible:
                text = await msgbox.evaluate('el => el.textContent?.trim() || ""')
                confirm = await msgbox.query_selector('.el-message-box__btns .el-button--primary, .el-message-box__btns .el-button--default')
                if confirm:
                    await confirm.click()
                    await page.wait_for_timeout(300)
                    return _ok(f'ok-msgbox: {text[:200]}')
                close_btn = await msgbox.query_selector('.el-message-box__headerbtn .el-icon-close')
                if close_btn:
                    await close_btn.click()
                    await page.wait_for_timeout(300)
                    return _ok(f'ok-msgbox-close: {text[:200]}')
        result = await page.evaluate('''() => {
            const dialogs = [...document.querySelectorAll('.el-dialog')].reverse();
            for (const d of dialogs) {
                if (d.offsetParent !== null) {
                    const closeBtn = d.querySelector('.el-dialog__headerbtn .el-dialog__close, .el-dialog__headerbtn .el-icon-close');
                    if (closeBtn) { closeBtn.click(); return 'ok'; }
                    const cancelBtn = d.querySelector('.el-dialog__footer .el-button--default');
                    if (cancelBtn) { cancelBtn.click(); return 'ok-cancel'; }
                    return 'no-close-button';
                }
            }
            for (const d of [...document.querySelectorAll('.el-drawer')].reverse()) {
                if (d.offsetParent !== null) {
                    const closeBtn = d.querySelector('.el-drawer__close-btn, .el-drawer__header .el-icon-close');
                    if (closeBtn) { closeBtn.click(); return 'ok'; }
                    return 'no-close-button';
                }
            }
            return 'no-overlay-open';
        }''')
        await page.wait_for_timeout(500)
        return result

    @controller.action('Take a screenshot and save it to the snapshots directory.')
    async def take_screenshot():
        page = await browser_context.get_current_page()
        ts = datetime.now().strftime("%Y%m%d_%H%M%S")
        screenshot_dir = os.path.join(_SCRIPTS_DIR, 'screenshots')
        os.makedirs(screenshot_dir, exist_ok=True)
        path = os.path.join(screenshot_dir, f"screenshot_{ts}.png")
        await page.screenshot(path=path, full_page=False)
        return _ok(f'screenshot-saved:{path}')

    @controller.action('Click element by its [] index.')
    async def click_element_by_index(index: int):
        """Replacement for default click_element_by_index."""
        page = await browser_context.get_current_page()
        try:
            element_node = await browser_context.get_dom_element_by_index(index)
            download_path = await browser_context._click_element_node(element_node)
            if download_path:
                return _ok(f'downloaded:{download_path}')
            if element_node:
                try:
                    elem_text = element_node.get_all_text_till_next_clickable_element() or ''
                    elem_text = elem_text.strip()[:80]
                except Exception:
                    elem_text = ''
                element_info = {
                    'tag_name': element_node.tag_name,
                    'xpath': element_node.xpath or '',
                    'attributes': element_node.attributes or {},
                    'text': elem_text or '',
                }
                _state._record_action('click_element_by_index', {
                    'index': index,
                    'tag_name': element_node.tag_name,
                    'text': elem_text or '',
                }, f'ok-clicked-{index}', element=element_info)
            return _ok(f'ok-clicked-{index}')
        except Exception as e:
            return _err(f'click-failed:{e}')

    @controller.action('Scroll down the page by pixel amount. Scrolls the main content container or window.')
    async def scroll_down(amount: int = 300):
        page = await browser_context.get_current_page()
        await page.evaluate(f'''() => {{
            const targets = document.querySelectorAll(
                '.plugin-content-list, .el-scrollbar__wrap, form.el-form, main, [class*="main-content"], .app-main, .app-content, .el-form'
            );
            for (const t of targets) {{
                const cs = getComputedStyle(t);
                if (cs.overflowY !== 'auto' && cs.overflowY !== 'scroll') continue;
                const diff = t.scrollHeight - t.clientHeight;
                if (diff > 10) {{
                    t.scrollTop = Math.min(t.scrollTop + {amount}, diff);
                    if (t.scrollTop > 0) return;
                }}
            }}
            window.scrollBy(0, {amount});
        }}''')
        return _ok(f'Scrolled down by {amount} pixels')

    @controller.action('Scroll up the page by pixel amount. Scrolls the main content container or window.')
    async def scroll_up(amount: int = 300):
        page = await browser_context.get_current_page()
        await page.evaluate(f'''() => {{
            const targets = document.querySelectorAll(
                '.plugin-content-list, .el-scrollbar__wrap, form.el-form, main, [class*="main-content"], .app-main, .app-content, .el-form'
            );
            for (const t of targets) {{
                const cs = getComputedStyle(t);
                if (cs.overflowY !== 'auto' && cs.overflowY !== 'scroll') continue;
                const diff = t.scrollHeight - t.clientHeight;
                if (diff > 10) {{
                    t.scrollTop = Math.max(t.scrollTop - {amount}, 0);
                    if (t.scrollTop > 0 || diff > 0) return;
                }}
            }}
            window.scrollBy(0, -{amount});
        }}''')
        return _ok(f'Scrolled up by {amount} pixels')
