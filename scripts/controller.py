"""
Controller: Element UI custom actions for browser_use.
"""
import json
import os
from datetime import datetime

from browser_use.agent.views import ActionResult
from .form_rules import match_rule


JS_WAIT_LOADING = '''() => new Promise(resolve => {
    let elapsed = 0;
    const check = () => {
        if (elapsed >= 30000) { resolve('timeout'); return; }
        const mask = document.querySelector('.el-loading-mask:not(.el-loading-mask--hidden)');
        if (!mask || mask.offsetParent === null) resolve();
        else { elapsed += 200; setTimeout(check, 200); }
    };
    check();
})'''

JS_GET_CONTAINER = '''(() => {
    for (const d of document.querySelectorAll('.el-dialog'))
        if (d.offsetParent !== null) return d;
    for (const d of document.querySelectorAll('.el-drawer'))
        if (d.offsetParent !== null) return d;
    return document;
})()'''

JS_NATIVE_SETTER = ''  # Inlined in JS_FILL_FORM_FIELD

JS_CHECK_LOADING = '''() => {
    const mask = document.querySelector('.el-loading-mask:not(.el-loading-mask--hidden)');
    return mask && mask.offsetParent !== null;
}'''

# Build an XPath for a form field element by its label text
JS_LOCATOR = '''(label) => {
    const xpath = (el) => {
        if (!el || el === document || el.nodeType !== 1) return '';
        const parent = el.parentNode;
        const tag = el.tagName.toLowerCase();
        const idx = 1 + [...parent.children].filter(c => c.tagName === el.tagName).indexOf(el);
        return xpath(parent) + '/' + tag + '[' + idx + ']';
    };
    const container = ''' + JS_GET_CONTAINER + ''';
    const items = container.querySelectorAll('.el-form-item');
    for (const item of items) {
        const lbl = item.querySelector('.el-form-item__label');
        if (lbl && lbl.textContent.trim().includes(label)) {
            const target = item.querySelector('input:not([type="hidden"]), textarea, .el-select .el-input__inner');
            if (target) return xpath(target);
        }
    }
    return '';
}'''

JS_FILL_FORM_FIELD = '''([label, val]) => {
    const setFn = (t, v) => {
        const TagProto = t.tagName === 'TEXTAREA' ? HTMLTextAreaElement : HTMLInputElement;
        const setter = Object.getOwnPropertyDescriptor(TagProto.prototype, 'value').set;
        setter.call(t, v);
        t.setAttribute('value', v);
        t.dispatchEvent(new Event('input', {bubbles:true}));
        t.dispatchEvent(new Event('change', {bubbles:true}));
        t.dispatchEvent(new Event('blur', {bubbles:true}));
    };
    const container = ''' + JS_GET_CONTAINER + ''';
    const items = container.querySelectorAll('.el-form-item');
    for (const item of items) {
        const lbl = item.querySelector('.el-form-item__label')?.textContent?.trim() || '';
        if (!lbl.includes(label)) continue;
        const input = item.querySelector('input:not([type="hidden"])');
        const textarea = item.querySelector('textarea');
        const target = input || textarea;
        if (!target) return 'no-input-found';
        if (target.disabled || target.readOnly) return 'field-disabled';
        if (target.closest('.el-date-editor, .tsscdatepicker')) return 'is-date-picker';
        setFn(target, val);
        return 'ok';
    }
    const allInputs = container.querySelectorAll('input:not([type="hidden"]), textarea');
    for (const inp of allInputs) {
        if (inp.closest('.el-date-editor, .tsscdatepicker')) continue;
        const ph = inp.getAttribute('placeholder') || '';
        if (ph.includes(label) && !inp.disabled && !inp.readOnly && inp.offsetParent !== null) {
            setFn(inp, val);
            return 'ok-placeholder';
        }
    }
    for (const inp of allInputs) {
        if (inp.closest('.el-date-editor, .tsscdatepicker')) continue;
        const type = inp.getAttribute('type') || 'text';
        if (type.toLowerCase() === label.toLowerCase() && !inp.disabled && !inp.readOnly && inp.offsetParent !== null) {
            setFn(inp, val);
            return 'ok-type';
        }
    }
    return 'label-not-found';
}'''

JS_FIND_LABELED_SELECT = '''([label, mode]) => {
    const getSelectedLabel = (formItem) => {
        const select = formItem.querySelector('.el-select');
        if (!select) return null;
        const trigger = select.querySelector('.el-input__inner');
        if (trigger) {
            const v = (trigger.value || '').trim();
            if (v) return v;
        }
        const tag = select.querySelector('.el-select__tags-text');
        if (tag) {
            const t = tag.textContent.trim();
            if (t) return t;
        }
        const selItem = select.querySelector('.el-select-dropdown__item.is-selected');
        if (selItem) return selItem.textContent.trim();
        return null;
    };
    const container = ''' + JS_GET_CONTAINER + ''';
    const items = container.querySelectorAll('.el-form-item');
    for (const item of items) {
        const lbl = item.querySelector('.el-form-item__label')?.textContent?.trim() || '';
        if (!lbl.includes(label)) continue;
        const trigger = item.querySelector('.el-select .el-input__inner');
        if (!trigger && mode === 'trigger') return 'no-select-found';
        if (!trigger) continue;
        if (mode === 'check') {
            const cur = getSelectedLabel(item);
            if (cur) return 'already:' + cur;
            return 'not-filled';
        }
        if (mode === 'trigger') {
            if (trigger.disabled) return 'select-disabled';
            // tssc-multi-select needs real mouse events, not just .click()
            trigger.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
            trigger.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
            trigger.click();
            return 'triggered';
        }
        if (mode === 'confirm') {
            const cur = getSelectedLabel(item);
            if (cur) return 'SELECTED:' + cur;
            return 'NOT-SELECTED';
        }
        return 'unknown-mode';
    }
    const allSelects = container.querySelectorAll('.el-select .el-input__inner');
    if (mode === 'check') {
        for (const sel of allSelects) {
            if (sel.offsetParent !== null) {
                const v = (sel.value || '').trim();
                if (v.length > 0) return 'already:' + v;
                const t = (sel.textContent || '').trim();
                if (t.length > 0 && !t.includes('请选择')) return 'already:' + t;
                break;
            }
        }
        return 'not-filled';
    }
    if (mode === 'trigger') {
        for (const sel of allSelects) {
            const ph = sel.getAttribute('placeholder') || '';
            if (ph.includes(label) && !sel.disabled && sel.offsetParent !== null) { sel.click(); return 'triggered'; }
        }
        for (const sel of allSelects) {
            if (!sel.disabled && sel.offsetParent !== null) { sel.click(); return 'triggered'; }
        }
        return 'label-not-found';
    }
    if (mode === 'confirm') {
        for (const sel of allSelects) {
            if (sel.offsetParent !== null) {
                const v = (sel.value || '').trim();
                if (v) return 'SELECTED:' + v;
            }
        }
        return 'NOT-SELECTED';
    }
    return 'unknown-mode';
}'''

JS_FIND_VISIBLE_DROPDOWN = '''(() => {
    const dropdowns = document.querySelectorAll('.el-select-dropdown');
    for (const dd of dropdowns) {
        if (dd.offsetParent !== null && !dd.classList.contains('is-hidden')) return dd;
    }
    return document;
})()'''

JS_SELECT_OPTION = '''(option) => {
    const dropdown = ''' + JS_FIND_VISIBLE_DROPDOWN + ''';
    let items = dropdown.querySelectorAll('.el-select-dropdown__item');
    // Fallback: if no dropdown is visible (tssc-multi-select renders options outside),
    // search at document level — tssc-multi-select appends options outside the dialog
    if (items.length === 0 || dropdown === document) {
        items = document.querySelectorAll('.el-select-dropdown__item');
    }
    const FIRST_ALIASES = ['first', '1st', '第一个', '第一项'];
    const tryClick = (item) => {
        // Scroll item into view before clicking (handles long dropdowns with scroll)
        item.scrollIntoView({ block: 'nearest' });
        // mousedown for tssc-multi-select, click for standard el-select
        item.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        item.click();
        const t = item.textContent.trim();
        return 'ok:' + t;
    };
    if (FIRST_ALIASES.includes(option.toLowerCase().trim())) {
        for (const item of items) {
            if (item.offsetParent !== null) { return tryClick(item); }
        }
        if (items.length > 0) { return tryClick(items[0]); }
        return 'no-items';
    }
    for (const item of items) {
        if (item.textContent.trim() === option) {
            return tryClick(item);
        }
    }
    for (const item of items) {
        if (item.textContent.trim().includes(option)) {
            return tryClick(item);
        }
    }
    // Target not found — check if the current dropdown is truly empty (has "无数据")
    const hasEmpty = document.querySelector('.el-select-dropdown__empty');
    if (hasEmpty) {
        return 'no-items';
    }
    return 'option-not-found:' + [...items].map(i => i.textContent.trim()).join(', ');
}'''

JS_CLICK_RADIO = '''([label, option]) => {
    const container = ''' + JS_GET_CONTAINER + ''';
    const items = container.querySelectorAll('.el-form-item');
    for (const item of items) {
        const lbl = item.querySelector('.el-form-item__label')?.textContent?.trim() || '';
        if (!lbl.includes(label)) continue;
        const radios = item.querySelectorAll('.el-radio');
        for (const radio of radios) {
            if (radio.textContent.trim() === option && radio.offsetParent !== null) {
                radio.click(); return 'ok';
            }
        }
        return 'option-not-found';
    }
    return 'label-not-found';
}'''


async def _wait_if_loading(page):
    loading = await page.evaluate(JS_CHECK_LOADING)
    if loading:
        await page.evaluate(JS_WAIT_LOADING)


def _register_case_data_actions(controller, case_data_store):
    # case_data_store is a process-level dict: persists for the lifetime of the Python process
    @controller.action('Save data to the shared case data store for cross-phase data sharing.')
    async def save_case_data(key: str, value: str):
        try:
            case_data_store[key] = value
            return _ok(f'saved:{key}={value}')
        except Exception as e:
            return _err(f'save-error:{e}')

    @controller.action('Read data from the shared case data store.')
    async def read_case_data(key: str):
        val = case_data_store.get(key)
        if val is None:
            return _err(f'NO-DATA:{key}')
        return val


def _register_form_actions(controller, browser_context, form_rules):
    @controller.action('Expand ALL el-tree nodes recursively (up to 10 rounds).')
    async def expand_all_el_tree():
        page = await browser_context.get_current_page()
        total = 0
        for _ in range(10):
            clicked = await page.evaluate('''() => {
                const tree = document.querySelector('.el-tree');
                if (!tree) return -1;
                let n = 0;
                tree.querySelectorAll('.el-tree-node:not(.is-expanded)').forEach(node => {
                    const icon = node.querySelector(':scope > .el-tree-node__content > .el-tree-node__expand-icon');
                    if (icon) { icon.click(); n++; }
                });
                return n;
            }''')
            if clicked == -1:
                return _err('no-el-tree-found')
            if clicked == 0:
                break
            total += clicked
            await page.wait_for_timeout(500)
        return _ok(f'expanded-{total}-nodes')

    @controller.action('Get a value for a form field by its label using form rules.')
    async def match_form_rule(label_text: str):
        val = match_rule(label_text, form_rules)
        return val if val else 'NO-RULE'

    @controller.action('Fill a form field using Element UI native DOM setter. Do NOT use for date fields — use click_element instead.')
    async def fill_form_field(label_text: str, value: str):
        page = await browser_context.get_current_page()
        await _wait_if_loading(page)
        result = await page.evaluate(JS_FILL_FORM_FIELD, [label_text, value])
        if result == 'is-date-picker':
            return ActionResult(extracted_content='is-date-picker: This is a date picker field. Use click_element to interact with the calendar UI instead.', is_done=False)
        if result == 'ok':
            loc = await page.evaluate(JS_LOCATOR, [label_text])
            return _ok('ok' + ' | loc:' + loc) if loc else _ok('ok')
        return result

    @controller.action('Check the current value of a form field by its label. Use this BEFORE filling to avoid re-filling already-set fields. Returns the field value, or "empty" if blank, or "label-not-found".')
    async def check_field_value(label_text: str):
        page = await browser_context.get_current_page()
        return await page.evaluate('''([label]) => {
            const c = ''' + JS_GET_CONTAINER + ''';
            const items = c.querySelectorAll('.el-form-item');
            for (const item of items) {
                const lbl = item.querySelector('.el-form-item__label');
                if (!lbl || !lbl.textContent.trim().includes(label)) continue;
                const input = item.querySelector('input:not([type="hidden"]), textarea, .el-select .el-input__inner');
                if (!input) return 'no-input';
                const v = (input.value || '').trim();
                return v || 'empty';
            }
            return 'label-not-found';
        }''', [label_text])

    @controller.action('Select an option in an el-select dropdown by label and option text.')
    async def select_option(label_text: str, option_text: str):
        page = await browser_context.get_current_page()
        await _wait_if_loading(page)

        already = await page.evaluate(JS_FIND_LABELED_SELECT, [label_text, 'check'])
        if already.startswith('already:'):
            loc = await page.evaluate(JS_LOCATOR, [label_text])
            return _ok(already + ' | loc:' + loc) if loc else _ok(already)

        trigger_result = await page.evaluate(JS_FIND_LABELED_SELECT, [label_text, 'trigger'])
        if trigger_result in ('label-not-found', 'no-select-found', 'select-disabled'):
            return trigger_result

        await page.wait_for_timeout(800)
        select_result = await page.evaluate(JS_SELECT_OPTION, option_text)
        await page.wait_for_timeout(500)

        if not select_result.startswith('ok'):
            confirm = await page.evaluate(JS_FIND_LABELED_SELECT, [label_text, 'confirm'])
            if confirm.startswith('SELECTED:'):
                confirm_val = confirm.split(':', 1)[1]
                loc = await page.evaluate(JS_LOCATOR, [label_text])
                return _ok(f'ok | ok:{confirm_val}' + ' | loc:' + loc) if loc else _ok(f'ok | ok:{confirm_val}')
            return _err(f'{select_result} | no-confirm')

        selected_text = select_result.split(':', 1)[1] if ':' in select_result else ''
        if selected_text:
            await page.evaluate('''([label, text]) => {
                const container = ''' + JS_GET_CONTAINER + ''';
                const items = container.querySelectorAll('.el-form-item');
                for (const item of items) {
                    const lbl = item.querySelector('.el-form-item__label')?.textContent?.trim() || '';
                    if (!lbl.includes(label)) continue;
                    const trigger = item.querySelector('.el-select .el-input__inner');
                    if (!trigger) continue;
                    trigger.value = text;
                    trigger.setAttribute('value', text);
                    return;
                }
            }''', [label_text, selected_text])
        loc = await page.evaluate(JS_LOCATOR, [label_text])
        return _ok(f'ok | {select_result}' + ' | loc:' + loc) if loc else _ok(f'ok | {select_result}')


def _register_navigation_actions(controller, browser_context):
    @controller.action('Switch to a tab by tab name in el-tabs component.')
    async def switch_tab(tab_name: str):
        page = await browser_context.get_current_page()
        result = await page.evaluate('''
            (name) => {
                const tabs = document.querySelectorAll('.el-tabs__item');
                for (const tab of tabs) {
                    if (tab.textContent.trim() === name && tab.offsetParent !== null) {
                        tab.click(); return 'ok';
                    }
                }
                return 'tab-not-found';
            }
        ''', tab_name)
        await page.wait_for_timeout(800)
        return result

    @controller.action('Click a menu item by its text. Expands parent submenu if needed.')
    async def click_menu_item(menu_text: str):
        page = await browser_context.get_current_page()
        result = await page.evaluate('''
            (text) => {
                const directItem = [...document.querySelectorAll('.el-menu-item')]
                    .find(el => el.textContent.trim() === text && el.offsetParent !== null);
                if (directItem) { directItem.click(); return 'ok'; }
                const submenus = document.querySelectorAll('.el-submenu');
                for (const sm of submenus) {
                    const title = sm.querySelector('.el-submenu__title');
                    const items = sm.querySelectorAll('.el-menu-item');
                    const hasTarget = [...items].some(i => i.textContent.trim() === text);
                    if (hasTarget) {
                        if (!sm.classList.contains('is-opened') && title) title.click();
                        const target = [...items].find(i => i.textContent.trim() === text);
                        if (target) { setTimeout(() => target.click(), 300); return 'ok-expanded'; }
                    }
                }
                return 'not-found';
            }
        ''', menu_text)
        await page.wait_for_timeout(500)
        if result.startswith('ok'):
            return _ok(result + ' | loc:.el-menu-item:has-text("' + menu_text + '")')
        return result


def _register_table_actions(controller, browser_context):
    @controller.action('Click a row action button in el-table by row text and button identifier.')
    async def click_table_row_action(row_text: str, button_text: str):
        page = await browser_context.get_current_page()
        result = await page.evaluate('''
            ([rowText, btnText]) => {
                const rows = document.querySelectorAll('.el-table__body-wrapper .el-table__row');
                for (const row of rows) {
                    if (!row.textContent.includes(rowText)) continue;
                    const buttons = row.querySelectorAll('button, .el-button, i[class*="icon"]');
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
                    return 'button-not-found-in-row';
                }
                return 'row-not-found';
            }
        ''', [row_text, button_text])
        await page.wait_for_timeout(500)
        if result.startswith('ok'):
            return _ok(result + ' | loc:.el-table__row:has-text("' + row_text + '")')
        return result


def _register_misc_actions(controller, browser_context):
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
        return json.dumps(state, ensure_ascii=False)

    @controller.action('Close visible el-notification popup, read its text, and return it. Returns "no-notification" if none found. Use this for server-side validation errors — NOT for dialogs/drawers.')
    async def close_notification():
        page = await browser_context.get_current_page()
        notif = await page.query_selector('.el-notification')
        if notif:
            visible = await notif.evaluate('el => el.offsetParent !== null')
            if visible:
                notif_text = await notif.evaluate('el => el.textContent?.trim() || ""')
                close_btn = await notif.query_selector('.el-notification__closeBtn')
                if close_btn:
                    await close_btn.click()
                    await page.wait_for_timeout(300)
                    return _ok(f'ok-notification: {notif_text[:200]}')
                return _ok(f'ok-notification-noclose: {notif_text[:200]}')
        return 'no-notification'

    @controller.action('Close the topmost el-dialog, el-message-box, or el-drawer. El-notification has its own close_notification action.')
    async def close_dialog():
        page = await browser_context.get_current_page()
        # 1. Close el-message-box (error alert/confirm popup — highest z-index overlay)
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
        # 3. Close dialog — iterate in REVERSE order (last visible = topmost)
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
            // 4. Drawer as last resort (may contain user data)
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

    @controller.action('Click an adjacent button (选择/引入) to fill a field, but only if the field is empty.')
    async def click_adjacent_button(label_text: str):
        page = await browser_context.get_current_page()
        await _wait_if_loading(page)
        result = await page.evaluate('''([label]) => {
            const container = ''' + JS_GET_CONTAINER + ''';
            const items = container.querySelectorAll('.el-form-item');
            for (const item of items) {
                const lbl = item.querySelector('.el-form-item__label')?.textContent?.trim() || '';
                if (!lbl.includes(label)) continue;
                const input = item.querySelector('.el-input__inner');
                if (input && input.value && input.value.trim() !== '') {
                    return 'already-filled';
                }
                const btn = item.querySelector('button.el-button--primary.is-plain, button.el-button--primary');
                if (btn && btn.offsetParent !== null) { btn.click(); return 'clicked'; }
                return 'no-button-found';
            }
            return 'label-not-found';
        }''', [label_text])
        if result == 'clicked':
            loc = await page.evaluate(JS_LOCATOR, [label_text])
            return _ok('clicked | loc:' + loc) if loc else _ok('clicked')
        return result

    @controller.action('Click a radio option by label text and radio option text.')
    async def click_radio(label_text: str, option_text: str):
        page = await browser_context.get_current_page()
        return await page.evaluate(JS_CLICK_RADIO, [label_text, option_text])

    @controller.action('Take a screenshot and save it to the snapshots directory.')
    async def take_screenshot():
        page = await browser_context.get_current_page()
        ts = datetime.now().strftime("%Y%m%d_%H%M%S")
        snapshot_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'snapshots')
        os.makedirs(snapshot_dir, exist_ok=True)
        path = os.path.join(snapshot_dir, f"screenshot_{ts}.png")
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
            return _ok(f'clicked-{index}')
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
        return _ok(f'🔍  Scrolled down by {amount} pixels')

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
        return _ok(f'🔍  Scrolled up by {amount} pixels')


def _ok(msg):
    """Wrap a success string in ActionResult with is_done=False."""
    return ActionResult(extracted_content=str(msg), is_done=False)

def _err(msg):
    """Wrap an error string in ActionResult."""
    return ActionResult(extracted_content=str(msg), is_done=False, success=False)

def build_controller(browser_context, form_rules, case_data_store=None, exclude_actions=None):
    from browser_use import Controller
    if exclude_actions is None:
        exclude_actions = ['input_text', 'select_dropdown_option']
    controller = Controller(exclude_actions=exclude_actions)

    if case_data_store is not None:
        _register_case_data_actions(controller, case_data_store)
    _register_form_actions(controller, browser_context, form_rules)
    _register_navigation_actions(controller, browser_context)
    _register_table_actions(controller, browser_context)
    _register_misc_actions(controller, browser_context)

    return controller
