"""
Miscellaneous actions: loading, page state, trajectory, notifications,
dialogs, screenshots, element click, scrolling.

Note: click_adjacent_button and click_radio moved to _form.py for
logical coherence with other form-filling actions.
"""

import json
import os
import re
import sys
from datetime import datetime

from scripts import state as _state
from ._helpers import _ok, _err, _enrich_click_element, _is_ok_result, _wait_if_loading
from .result_protocol import err_with
from ._js_snippets import (
    JS_CHECK_LOADING,
    JS_COLLECT_ICON_BUTTONS,
    JS_CLICK_ICON_BUTTON,
    JS_STAMP_ICON_ARIA_LABELS,
    JS_STRIP_STALE_WRAPPERS,
)
from .js_snippets._locator_helpers_js import PAGE_LOCATOR_HELPERS
from ...models import ActionFile, FormSnapshot, FormSnapshotCollection
from .replay_timing import WAIT_300_MS, WAIT_400_MS, WAIT_450_MS, WAIT_500_MS

# Path helper: __file__ is scripts/controller/actions/_misc.py, so go up 3 levels
_SCRIPTS_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Consecutive get_page_state while mask still visible after wait (blocks idle spin).
_GPS_LOADING_SPIN = {'count': 0}

# Form-submit button labels — must use click_save during AI recording (not index click).
_SUBMIT_BTN_RE = re.compile(r'^(保存|提交|确认|确定)(并.*)?$')


def _is_form_submit_label(text: str) -> bool:
    t = re.sub(r'\s+', '', (text or '').strip())
    return bool(t and _SUBMIT_BTN_RE.match(t))


_JS_VISIBLE_FORM_OVERLAY = '''() => {
''' + PAGE_LOCATOR_HELPERS + '''
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


# G1 container-scope-first click: when a visible drawer/dialog/message-box is
# open, try to click a matching button INSIDE that overlay before falling back
# to the page-level JS_CLICK_ICON_BUTTON (which prefers page-level over
# overlays and can hit a same-label toolbar button on the main list page,
# e.g. 查询 in a drawer shadowed by 查询 on the main page). Returns 'miss'
# when no visible overlay or no in-overlay match — callers then run the
# original page-level path unchanged (no-container diff is invisible).
# Counterpart of JS_IDENTIFY_CONTAINER (base.py): that one names the active
# container for scan/fill; this one clicks within the overlay scope first.
_JS_CLICK_BUTTON_IN_CONTAINER = r'''async ([buttonText]) => {
    const norm = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
    const want = norm(buttonText);
    if (!want) return 'miss';
    const overlays = [...document.querySelectorAll('.el-dialog, .el-drawer, .el-message-box')]
        .filter((d) => d.offsetParent !== null && d.getClientRects().length > 0);
    // Topmost visible overlay wins (highest z-index, like _misc overlay scan).
    let scope = null;
    let bestZ = -1;
    for (const o of overlays) {
        const z = parseInt(getComputedStyle(o).zIndex || '0', 10) || 0;
        if (z >= bestZ) { bestZ = z; scope = o; }
    }
    // KB-I5 r6: generic click resolver — with no visible overlay the scope is
    // the whole document, so non-button affordances on plain pages (todo-card
    // 处理 = div.todo-item-action) are reachable via click_button too.
    const inContainer = !!scope;
    if (!scope) scope = document;
    const candidates = inContainer
        ? 'button, .el-button, a, label.el-radio, .el-radio, label.el-checkbox, .el-checkbox, .el-tree-node__content'
        : 'button, .el-button, [role="button"], div.todo-item-action, .el-radio, .el-checkbox, .el-tree-node__content';
    // KB-I5 r4: clickable candidates are not only buttons — Element UI radios
    // (el-select options / el-table radio columns / radio labels) also carry
    // actionable text and only respond to the full mousedown event chain.
    const scan = (root, loose) => {
        const ms = [];
        for (const b of root.querySelectorAll(candidates)) {
            if (b.offsetParent === null || b.disabled) continue;
            if (b.closest('.el-table__body-wrapper')) continue;
            const t = norm(b.innerText || b.textContent);
            if (!t || t.length > 40) continue;
            if (loose) {
                // container branch keeps its historical loose match (includes)
                if (t === want || (t.includes(want) && !want.includes(t))) ms.push({ el: b, text: t });
            } else if (t === want) {
                // page-level branch: exact text match only
                ms.push({ el: b, text: t });
            }
        }
        return ms;
    };
    let matches = scan(scope, inContainer);
    // KB-I5 r6: TsscMultiTree / el-select pickers render their option panel in a
    // body-attached popover OUTSIDE the dialog DOM — scan visible poppers too
    // when the dialog itself has no match.
    if (!matches.length) {
        const poppers = [...document.querySelectorAll(
            '.el-popover, .el-popper, .el-select-dropdown, .tree-popover')]
            .filter((p) => p.offsetParent !== null && p.getClientRects().length > 0);
        for (const pop of poppers) {
            matches = scan(pop, inContainer);
            if (matches.length) break;
        }
    }
    // KB-I5 r6: click_button('<字段label>') with no button/option match opens the
    // labelled field's picker trigger (tree-select / el-select) so the popover
    // stays open for a follow-up click_button('<option>').
    if (!matches.length) {
        const labels = scope.querySelectorAll('.el-form-item__label');
        for (const l of labels) {
            if (norm(l.textContent) !== want) continue;
            const item = l.closest('.el-form-item');
            // KB-I5 r6b: TsscMultiTree renders a hidden search input BEFORE the
            // visible display input — the first input has offsetParent===null, so
            // only choosing item.querySelector('input') skips the field entirely.
            // Prefer the el-select trigger, then the first VISIBLE non-hidden input.
            const trigger = item && (item.querySelector('.el-select .el-input__inner')
                || [...item.querySelectorAll('input')].find(
                    (i) => i.type !== 'hidden' && i.offsetParent !== null)
                || item.querySelector('input'));
            if (trigger && (trigger.offsetParent !== null || trigger.getClientRects().length > 0)) {
                trigger.scrollIntoView({ block: 'center', behavior: 'instant' });
                const fireT = (type) => trigger.dispatchEvent(
                    new MouseEvent(type, { bubbles: true, cancelable: true, view: window })
                );
                fireT('mousedown');
                await new Promise((r) => setTimeout(r, 40));
                fireT('mouseup');
                await new Promise((r) => setTimeout(r, 40));
                fireT('click');
                return inContainer ? ('ok-container:' + want) : ('ok-click:' + want);
            }
        }
    }
    // KB-I5 r6c: tree node matched inside a CLOSED tree-popover (trigger never
    // opened / popover re-hidden by a race). Open the owning field's visible
    // trigger, wait for the popover to render, then toggle the node's checkbox.
    // TsscMultiTree list (nextNodeAprvPsnList) is only written by the real
    // check event — handleCheckClick — never by $emit('input').
    if (!matches.length) {
        const hiddenNodes = [...scope.querySelectorAll('.el-tree-node')]
            .filter((n) => n.offsetParent === null);
        const hn = hiddenNodes.find((n) => {
            const c = n.querySelector('.el-tree-node__content');
            return c && norm(c.textContent) === want;
        });
        if (hn) {
            const popper = hn.closest('.el-popover, .el-popper, .tree-popover');
            const item = popper && popper.closest('.el-form-item');
            const trigger = item && [...item.querySelectorAll('input')].find(
                (i) => i.type !== 'hidden' && i.offsetParent !== null);
            if (trigger) {
                const wasChecked = hn.classList.contains('is-checked');
                const ft = (el, type) => el.dispatchEvent(
                    new MouseEvent(type, { bubbles: true, cancelable: true, view: window })
                );
                trigger.scrollIntoView({ block: 'center', behavior: 'instant' });
                ft(trigger, 'mousedown');
                await new Promise((r) => setTimeout(r, 40));
                ft(trigger, 'mouseup');
                await new Promise((r) => setTimeout(r, 40));
                ft(trigger, 'click');
                await new Promise((r) => setTimeout(r, 300));
                const treeNow = hn.closest('.el-tree');
                const nodeNow = treeNow && [...treeNow.querySelectorAll('.el-tree-node')].find((n) => {
                    const c = n.querySelector('.el-tree-node__content');
                    return c && norm(c.textContent) === want;
                });
                if (nodeNow) {
                    const cb = nodeNow.querySelector('.el-checkbox');
                    const tgt = cb || nodeNow.querySelector('.el-tree-node__content') || nodeNow;
                    const fire2 = (type) => tgt.dispatchEvent(
                        new MouseEvent(type, { bubbles: true, cancelable: true, view: window })
                    );
                    fire2('mousedown');
                    await new Promise((r) => setTimeout(r, 40));
                    fire2('mouseup');
                    await new Promise((r) => setTimeout(r, 40));
                    fire2('click');
                    if (wasChecked) {
                        // preset-checked node: first click toggled OFF — click again
                        // so the node ends checked and the check event carries it.
                        await new Promise((r) => setTimeout(r, 150));
                        fire2('mousedown');
                        await new Promise((r) => setTimeout(r, 40));
                        fire2('mouseup');
                        await new Promise((r) => setTimeout(r, 40));
                        fire2('click');
                    }
                    return inContainer ? ('ok-container:' + want) : ('ok-click:' + want);
                }
                return inContainer ? ('ok-container:' + want) : ('ok-click:' + want);
            }
        }
    }
    if (!matches.length) return 'miss';
    const exact = matches.filter((m) => m.text === want);
    const pool = exact.length ? exact : matches;
    let hit = pool[0];
    let target = hit.el;
    // KB-I5 r6: el-tree nodes with show-checkbox — clicking the label span only
    // highlights; the node's checkbox is what registers the selection. Prefer
    // the checkbox inside the matched .el-tree-node__content.
    if (target.classList.contains('el-tree-node__content')) {
        const cb = target.querySelector('.el-checkbox')
            || (target.parentElement && target.parentElement.querySelector(':scope > .el-checkbox'));
        const lbl = target.querySelector('.el-tree-node__label');
        if (cb) target = cb;
        else if (lbl) target = lbl;
    }
    target.scrollIntoView({ block: 'center', behavior: 'instant' });
    // Element UI widgets (el-select, el-table radios, drawer confirm buttons,
    // todo-card action divs) need the real mousedown -> mouseup -> click
    // sequence; a synthetic single click() leaves Vue models un-updated.
    // KB-I5 r6: gaps widened 30ms -> 40ms per pin spec.
    const fire = (type) => target.dispatchEvent(
        new MouseEvent(type, { bubbles: true, cancelable: true, view: window })
    );
    fire('mousedown');
    await new Promise((r) => setTimeout(r, 40));
    fire('mouseup');
    await new Promise((r) => setTimeout(r, 40));
    fire('click');
    return inContainer ? ('ok-container:' + hit.text) : ('ok-click:' + hit.text);
}'''


def _register_misc_actions(controller, browser_context, business_data_store=None):
    from .click_action_engine import ClickEngine

    _click_engine = ClickEngine(browser_context, business_data_store)
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
            sys.stderr.write("[get-page-state] JS_CHECK_LOADING wait probe failed" + '\n')
            sys.stderr.flush()
            pass

        still_loading = False
        try:
            still_loading = bool(await page.evaluate(JS_CHECK_LOADING))
        except Exception:
            sys.stderr.write("[get-page-state] JS_CHECK_LOADING recheck failed" + '\n')
            sys.stderr.flush()
            still_loading = False

        if still_loading:
            _GPS_LOADING_SPIN['count'] = int(_GPS_LOADING_SPIN.get('count') or 0) + 1
            n = _GPS_LOADING_SPIN['count']
            if n >= 2:
                return _err(
                    'page-loading-spin-blocked | loading mask still visible after wait. '
                    'Do NOT call get_page_state again. Call wait_for_loading() once, then '
                    'click_button / click_element_by_index / scan_visible_fields — '
                    'not another get_page_state.',
                    include_in_memory=True,
                )
            return _err(
                'page-still-loading | waited for loading mask but it is still present. '
                'Do NOT call get_page_state again while loading. '
                'NEXT_ACTION: wait_for_loading() once, then a UI action '
                '(click_button / click_element / scan) — not get_page_state.',
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
                notifications: [...document.querySelectorAll('.el-notification')].filter(e => {
                    const r = e.getBoundingClientRect();
                    const cs = getComputedStyle(e);
                    return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none';
                }).map(e => e.textContent.trim()).filter(Boolean),
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
            sys.stderr.write("[get-page-state] iconButtons stamp/collect failed" + '\n')
            sys.stderr.flush()
            state['iconButtons'] = []
        _state._TRAJECTORY_URL = state.get('url', '')
        return json.dumps(state, ensure_ascii=False)

    @controller.action(
        'Click a button by its label. Handles TWO kinds: (a) icon-only buttons '
        'whose text lives in el-tooltip / aria-label (e.g. el-tooltip + el-icon-*), '
        '(b) plain visible text buttons like toolbar 查询/重置/新增/修改/查看 — '
        'if no icon matches, a same-label visible text button is clicked directly '
        "(table-row affordances excluded; page-level preferred over overlays; returns "
        "'ok-text:<label>'). Only fails when the label is absent or ambiguous "
        "('err-icon-label-ambiguous:{candidates}' / 'err-icon-label-miss'). "
        'Use get_page_state().iconButtons to discover true icon labels.'
    )
    async def click_button(button_text: str):
        return await _click_engine.click_button(button_text, mode="record")

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
            coll = FormSnapshotCollection.from_store(business_data_store)
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
                sys.stderr.write("[close-notification] close button click failed (DOM dispatch fallback)" + '\n')
                sys.stderr.flush()
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
            await page.wait_for_timeout(WAIT_300_MS)
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
        await page.wait_for_timeout(WAIT_500_MS)
        if _is_ok_result(result):
            _state._record_action('close_dialog', {}, result, element=element)
            if business_data_store is not None:
                from scripts.controller.actions.container_naming import clear_trigger_button
                clear_trigger_button(business_data_store)
            try:
                from scripts.controller.actions._phase_boundary import maybe_record_picker_closed
                from ._js_snippets import JS_IS_QUERY_TOOLBAR
                still = False
                try:
                    still = bool(await page.evaluate(JS_IS_QUERY_TOOLBAR))
                except Exception:
                    sys.stderr.write("[close-dialog] JS_IS_QUERY_TOOLBAR recheck failed" + '\n')
                    sys.stderr.flush()
                    still = False
                parent = (business_data_store or {}).get('_parent_container_before_picker') or 'main'
                maybe_record_picker_closed(
                    business_data_store, still_query_ui=still, parent_container=parent,
                )
            except Exception:
                sys.stderr.write("[close-dialog] maybe_record_picker_closed helper failed" + '\n')
                sys.stderr.flush()
                pass
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
        return await _click_engine.click_element_by_index(index, mode="record")

    @controller.action('Scroll down the page by pixel amount. Scrolls the main content container or window.')
    async def scroll_down(amount: int = 300):
        amount = int(amount)
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
        amount = int(amount)
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
