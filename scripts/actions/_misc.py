"""
Miscellaneous actions: loading, page state, trajectory, notifications,
dialogs, screenshots, element click, scrolling.

Note: click_adjacent_button and click_radio moved to _form.py for
logical coherence with other form-filling actions.
"""

import json
import os
import re
from datetime import datetime

from . import _state
from ._helpers import _ok, _err, _enrich_click_element, _is_ok_result, _wait_if_loading
from ._js_snippets import (
    JS_CHECK_LOADING,
    JS_COLLECT_ICON_BUTTONS,
    JS_CLICK_ICON_BUTTON,
    JS_STAMP_ICON_ARIA_LABELS,
)
from ..models import ActionFile, FormSnapshot, FormSnapshotCollection

# Path helper: __file__ is scripts/actions/_misc.py, so go up 2 levels
_SCRIPTS_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Consecutive get_page_state while mask still visible after wait (blocks idle spin).
_GPS_LOADING_SPIN = {'count': 0}

# Form-submit button labels — must use click_save during AI recording (not index click).
_SUBMIT_BTN_RE = re.compile(r'^(保存|提交|确认|确定)(并.*)?$')


def _is_form_submit_label(text: str) -> bool:
    t = re.sub(r'\s+', '', (text or '').strip())
    return bool(t and _SUBMIT_BTN_RE.match(t))


_JS_VISIBLE_FORM_OVERLAY = '''() => {
    const isVisible = (el) => {
        if (!el) return false;
        const style = getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0)
            return false;
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
    };
    for (const d of document.querySelectorAll('.el-dialog')) {
        const wrap = d.closest('.el-dialog__wrapper') || d;
        if (isVisible(wrap) && isVisible(d) && d.querySelector('.el-form')) return true;
    }
    for (const d of document.querySelectorAll('.el-drawer')) {
        const wrap = d.closest('.el-drawer__wrapper') || d;
        if (isVisible(wrap) && isVisible(d) && d.querySelector('.el-form')) return true;
    }
    return false;
}'''


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
        _GPS_LOADING_SPIN['count'] = 0
        return _ok('loading-done')

    @controller.action(
        'Get current page state: visible dialogs, loading, errors, iconButtons '
        '(el-tooltip / aria-describedby / ElTooltip content labels), etc. formErrors entries are '
        '{label, error} with the field label from .el-form-item__label. '
        'If the page is loading, this waits for the mask first — do NOT call '
        'get_page_state repeatedly while loading; use wait_for_loading or a real UI action.'
    )
    async def get_page_state():
        page = await browser_context.get_current_page()

        # Auto-wait when mask is up so the agent cannot idle-poll loading snapshots.
        try:
            if await page.evaluate(JS_CHECK_LOADING):
                await _wait_if_loading(page)
        except Exception:
            pass

        still_loading = False
        try:
            still_loading = bool(await page.evaluate(JS_CHECK_LOADING))
        except Exception:
            still_loading = False

        if still_loading:
            _GPS_LOADING_SPIN['count'] = int(_GPS_LOADING_SPIN.get('count') or 0) + 1
            n = _GPS_LOADING_SPIN['count']
            if n >= 2:
                return _err(
                    'page-loading-spin-blocked | loading mask still visible after wait. '
                    'Do NOT call get_page_state again. Call wait_for_loading() once, then '
                    'click_icon_button / click_element_by_index / scan_visible_fields — '
                    'not another get_page_state.',
                    include_in_memory=True,
                )
            return _err(
                'page-still-loading | waited for loading mask but it is still present. '
                'Do NOT call get_page_state again while loading. '
                'NEXT_ACTION: wait_for_loading() once, then a UI action '
                '(click_icon_button / click_element / scan) — not get_page_state.',
                include_in_memory=True,
            )

        _GPS_LOADING_SPIN['count'] = 0

        state = await page.evaluate('''() => {
            const dialogs = document.querySelectorAll('.el-dialog');
            const visibleDialogs = [...dialogs].filter(d => d.offsetParent !== null);
            const drawers = document.querySelectorAll('.el-drawer');
            const visibleDrawers = [...drawers].filter(d => d.offsetParent !== null);
            const formErrors = [];
            const seen = new Set();
            for (const el of document.querySelectorAll('.el-form-item__error')) {
                const error = (el.textContent || '').trim();
                if (!error) continue;
                const formItem = el.closest('.el-form-item');
                const label = (formItem && formItem.querySelector('.el-form-item__label')
                    ? formItem.querySelector('.el-form-item__label').textContent.trim()
                    : '');
                const key = label + '|' + error;
                if (seen.has(key)) continue;
                seen.add(key);
                formErrors.push({ label, error });
            }
            const isVis = (el) => {
                if (!el) return false;
                if (el.offsetParent === null && !el.closest('.el-table__fixed')) return false;
                const st = getComputedStyle(el);
                return st.display !== 'none' && st.visibility !== 'hidden';
            };
            const loading = [...document.querySelectorAll('.el-loading-mask')].some(m => {
                if (m.classList.contains('el-loading-mask--hidden')) return false;
                return isVis(m);
            });
            const openDropdown = [...document.querySelectorAll('.el-select-dropdown')].some(d => {
                if (d.classList.contains('is-hidden')) return false;
                return isVis(d);
            });
            return {
                dialogCount: dialogs.length,
                visibleDialogCount: visibleDialogs.length,
                visibleDialogTitles: visibleDialogs.map(d => d.querySelector('.el-dialog__title')?.textContent?.trim() || ''),
                msgboxVisible: !!document.querySelector('.el-message-box') && document.querySelector('.el-message-box').offsetParent !== null,
                drawerCount: visibleDrawers.length,
                loading,
                openDropdown,
                formErrors,
                messages: [...document.querySelectorAll('.el-message')].map(e => e.textContent.trim()).filter(Boolean),
                notifications: [...document.querySelectorAll('.el-notification')].filter(e => e.offsetParent !== null).map(e => e.textContent.trim()).filter(Boolean),
                activeTab: document.querySelector('.el-tabs__item.is-active')?.textContent?.trim() || null,
                treeNodes: document.querySelectorAll('.el-tree-node').length || 0,
                tableRows: document.querySelectorAll('.el-table__body-wrapper .el-table__row').length || 0,
                url: location.href,
            };
        }''')
        try:
            # Stamp aria-label from ElTooltip content / popper before collect so
            # iconButtons is non-empty even before first hover.
            await page.evaluate(JS_STAMP_ICON_ARIA_LABELS)
            icon_buttons = await page.evaluate(JS_COLLECT_ICON_BUTTONS)
            state['iconButtons'] = icon_buttons if isinstance(icon_buttons, list) else []
        except Exception:
            state['iconButtons'] = []
        _state._TRAJECTORY_URL = state.get('url', '')
        return json.dumps(state, ensure_ascii=False)

    @controller.action(
        'Click an icon-only button by its tooltip / ElTooltip content / aria-label text '
        '(e.g. el-tooltip + el-icon-*). Prefer this over click_element on empty-text icons. '
        'Use get_page_state().iconButtons or aria-label on indexed elements to discover labels. '
        'If the task names a toolbar icon (e.g. 新增一级分类), call this directly.'
    )
    async def click_icon_button(button_text: str):
        page = await browser_context.get_current_page()
        try:
            await page.evaluate(JS_STAMP_ICON_ARIA_LABELS)
        except Exception:
            pass
        element = await _enrich_click_element(
            page, text=button_text, target_kind='icon',
        )
        result = await page.evaluate(JS_CLICK_ICON_BUTTON, button_text)
        await page.wait_for_timeout(400)
        if _is_ok_result(result):
            _state._record_action(
                'click_icon_button',
                {'button_text': button_text},
                result,
                element=element,
            )
            return _ok(result)
        return result

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
            return _ok(f'ok-notification: {notif_text[:200]}', include_in_memory=True)
        return 'no-notification'

    @controller.action('Close the topmost el-dialog / el-drawer / el-message-box via the title-bar X close control. Message-box primary/cancel buttons should use click_element_by_index instead.')
    async def close_dialog():
        page = await browser_context.get_current_page()
        element = await _enrich_click_element(
            page, text='', target_kind='dialog_close',
        )
        result = await page.evaluate('''() => {
            function clickClose(root, sels) {
              for (const sel of sels) {
                const btn = root.querySelector(sel);
                if (btn && btn.offsetParent !== null) { btn.click(); return true; }
              }
              return false;
            }
            const closeSels = [
              '.el-dialog__headerbtn', '.el-dialog__close', '.el-dialog__headerbtn .el-icon-close',
              '.el-drawer__close-btn', '.el-drawer__header .el-icon-close',
              '.el-message-box__headerbtn', '.el-message-box__headerbtn .el-icon-close',
            ];
            for (const d of [...document.querySelectorAll('.el-dialog')].reverse()) {
              if (d.offsetParent !== null) {
                if (clickClose(d, closeSels)) return 'ok';
                return 'no-close-button';
              }
            }
            for (const d of [...document.querySelectorAll('.el-drawer')].reverse()) {
              if (d.offsetParent !== null) {
                if (clickClose(d, closeSels)) return 'ok';
                return 'no-close-button';
              }
            }
            for (const d of [...document.querySelectorAll('.el-message-box')].reverse()) {
              if (d.offsetParent !== null) {
                if (clickClose(d, closeSels)) return 'ok';
                return 'no-close-button';
              }
            }
            return 'no-overlay-open';
        }''')
        await page.wait_for_timeout(500)
        if _is_ok_result(result):
            _state._record_action('close_dialog', {}, result, element=element)
            return _ok(result)
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
            # Capture stable locators BEFORE click (drawer/dialog may unmount after).
            element_info = None
            elem_text = ''
            tag_name = ''
            if element_node:
                try:
                    elem_text = element_node.get_all_text_till_next_clickable_element() or ''
                    elem_text = elem_text.strip()[:80]
                except Exception:
                    elem_text = ''
                tag_name = element_node.tag_name or ''
                element_info = await _enrich_click_element(
                    page,
                    xpath=element_node.xpath or '',
                    text=elem_text,
                    tag_name=tag_name,
                    attributes=element_node.attributes or {},
                )

            # Forbid index-click on form-dialog 确认/保存 — forces click_save and stops
            # select→修改→确认 loops after premature done() rejection.
            btn_label = ((element_info or {}).get('text') or elem_text or '').strip()
            if _is_form_submit_label(btn_label):
                compact = re.sub(r'\s+', '', btn_label)
                in_form_overlay = False
                dialog_title = ''
                try:
                    overlay_info = await page.evaluate('''() => {
                        const isVisible = (el) => {
                            if (!el) return false;
                            const style = getComputedStyle(el);
                            if (style.display === 'none' || style.visibility === 'hidden') return false;
                            const r = el.getBoundingClientRect();
                            return r.width > 0 && r.height > 0;
                        };
                        for (const d of document.querySelectorAll('.el-dialog')) {
                            const wrap = d.closest('.el-dialog__wrapper') || d;
                            if (isVisible(wrap) && isVisible(d)) {
                                const title = (d.querySelector('.el-dialog__title')?.textContent || '').trim();
                                const hasForm = !!d.querySelector('.el-form');
                                return { inForm: hasForm, title };
                            }
                        }
                        for (const d of document.querySelectorAll('.el-drawer')) {
                            const wrap = d.closest('.el-drawer__wrapper') || d;
                            if (isVisible(wrap) && isVisible(d)) {
                                const title = (d.getAttribute('aria-label') || '').trim();
                                const hasForm = !!d.querySelector('.el-form');
                                return { inForm: hasForm, title };
                            }
                        }
                        return { inForm: false, title: '' };
                    }''')
                    if isinstance(overlay_info, dict):
                        in_form_overlay = bool(overlay_info.get('inForm'))
                        dialog_title = str(overlay_info.get('title') or '')
                except Exception:
                    in_form_overlay = bool(await page.evaluate(_JS_VISIBLE_FORM_OVERLAY))
                try:
                    from ._phase_intent import (
                        get_phase_intent,
                        is_introduce_phase,
                        record_success_token,
                        should_block_index_submit,
                    )
                    contract = get_phase_intent(case_data_store)
                except Exception:
                    contract = None
                    is_introduce_phase = lambda c: False  # noqa: E731
                    should_block_index_submit = None  # type: ignore
                    record_success_token = None  # type: ignore

                block = False
                if should_block_index_submit is not None:
                    block = should_block_index_submit(
                        contract,
                        btn_label,
                        in_form_overlay=in_form_overlay,
                        dialog_title=dialog_title,
                    )
                elif compact.startswith(('保存', '提交')) or in_form_overlay:
                    block = True

                if block:
                    if compact.startswith('确认'):
                        needle = '确认'
                    elif compact.startswith('确定'):
                        needle = '确定'
                    elif compact.startswith('提交'):
                        needle = '提交'
                    else:
                        needle = '保存'
                    return _err(
                        f'use-click-save | Index click on "{btn_label}" is forbidden for form submit. '
                        f'Call click_save(button_text="{needle}") NOW. '
                        f'Do NOT re-select the table row or re-click 修改 — if the dialog is open, '
                        f'only click_save. Success = 操作成功 toast OR post-save navigation.',
                        include_in_memory=True,
                    )

            download_path = await browser_context._click_element_node(element_node)
            if download_path:
                return _ok(f'downloaded:{download_path}')
            if element_node:
                _state._record_action('click_element_by_index', {
                    'index': index,
                    'tag_name': element_info.get('tag_name') if element_info else tag_name,
                    'text': (element_info or {}).get('text') or elem_text or '',
                }, f'ok-clicked-{index}', element=element_info)
                try:
                    from ._phase_intent import get_phase_intent, is_introduce_phase, record_success_token
                    contract = get_phase_intent(case_data_store)
                    if contract and is_introduce_phase(contract):
                        compact = re.sub(r'\s+', '', btn_label)
                        if compact.startswith(('确认', '确定')):
                            record_success_token(case_data_store, 'confirm_click', btn_label)
                except Exception:
                    pass
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
