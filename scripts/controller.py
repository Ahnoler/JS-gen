"""
Controller: Element UI custom actions for browser_use.
"""
import os
import json
from datetime import datetime
from pathlib import Path

from .form_rules import match_rule


def build_controller(browser_context, form_rules, case_data_ref=None, exclude_actions=None):
    from browser_use import Controller
    if exclude_actions is None:
        exclude_actions = ['input_text', 'select_dropdown_option']
    controller = Controller(exclude_actions=exclude_actions)

    if case_data_ref is not None:
        @controller.action('Save data to the shared case data store for cross-phase data sharing.')
        async def save_case_data(key: str, value: str):
            cdp = case_data_ref.get('path')
            if cdp is None:
                return 'no-case-data-path'
            try:
                if cdp.exists():
                    with open(cdp, 'r', encoding='utf-8') as f:
                        data = json.load(f)
                else:
                    data = {}
                data[key] = value
                cdp.parent.mkdir(parents=True, exist_ok=True)
                with open(cdp, 'w', encoding='utf-8') as f:
                    json.dump(data, f, ensure_ascii=False, indent=2)
                return f'saved:{key}={value}'
            except Exception as e:
                return f'save-error:{e}'

        @controller.action('Read data from the shared case data store.')
        async def read_case_data(key: str):
            cdp = case_data_ref.get('path')
            if cdp is None or not cdp.exists():
                return f'NO-DATA:{key}'
            try:
                with open(cdp, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                return data.get(key, f'NO-DATA:{key}')
            except Exception as e:
                return f'read-error:{e}'

    @controller.action('Expand ALL el-tree nodes...')
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
            if clicked == -1: return 'no-el-tree-found'
            if clicked == 0: break
            total += clicked
            await page.wait_for_timeout(500)
        return f'expanded-{total}-nodes'

    @controller.action('Get a value for a form field by its label.')
    async def match_form_rule(label_text: str):
        val = match_rule(label_text, form_rules)
        return val if val else 'NO-RULE'

    @controller.action('Fill a form field using Element UI native DOM setter.')
    async def fill_form_field(label_text: str, value: str):
        page = await browser_context.get_current_page()
        loading = await page.evaluate('''() => {
            const mask = document.querySelector('.el-loading-mask:not(.el-loading-mask--hidden)');
            return mask && mask.offsetParent !== null;
        }''')
        if loading:
            await page.evaluate('''() => new Promise(resolve => {
                let elapsed = 0;
                const check = () => {
                    if (elapsed >= 30000) { resolve('timeout'); return; }
                    const mask = document.querySelector('.el-loading-mask:not(.el-loading-mask--hidden)');
                    if (!mask || mask.offsetParent === null) resolve();
                    else { elapsed += 200; setTimeout(check, 200); }
                };
                check();
            })''')
        result = await page.evaluate('''
            ([label, val]) => {
                let container = document;
                const topOverlay = (() => {
                    for (const d of document.querySelectorAll('.el-dialog'))
                        if (d.offsetParent !== null) return d;
                    for (const d of document.querySelectorAll('.el-drawer'))
                        if (d.offsetParent !== null) return d;
                    return null;
                })();
                if (topOverlay) container = topOverlay;

                const items = container.querySelectorAll('.el-form-item');
                for (const item of items) {
                    const lbl = item.querySelector('.el-form-item__label')?.textContent?.trim() || '';
                    if (!lbl.includes(label)) continue;
                    const input = item.querySelector('input:not([type="hidden"])');
                    const textarea = item.querySelector('textarea');
                    const target = input || textarea;
                    if (!target) return 'no-input-found';
                    if (target.disabled || target.readOnly) return 'field-disabled';
                    const proto = input ? HTMLInputElement : HTMLTextAreaElement;
                    const setter = Object.getOwnPropertyDescriptor(proto.prototype, 'value').set;
                    setter.call(target, val);
                    target.dispatchEvent(new Event('input', {bubbles:true}));
                    target.dispatchEvent(new Event('change', {bubbles:true}));
                    target.dispatchEvent(new Event('blur', {bubbles:true}));
                    return 'ok';
                }
                const allInputs = container.querySelectorAll('input:not([type="hidden"]), textarea');
                for (const inp of allInputs) {
                    const ph = inp.getAttribute('placeholder') || '';
                    if (ph.includes(label) && !inp.disabled && !inp.readOnly && inp.offsetParent !== null) {
                        const proto = inp.tagName === 'TEXTAREA' ? HTMLTextAreaElement : HTMLInputElement;
                        const setter = Object.getOwnPropertyDescriptor(proto.prototype, 'value').set;
                        setter.call(inp, val);
                        inp.dispatchEvent(new Event('input', {bubbles:true}));
                        inp.dispatchEvent(new Event('change', {bubbles:true}));
                        inp.dispatchEvent(new Event('blur', {bubbles:true}));
                        return 'ok-placeholder';
                    }
                }
                for (const inp of allInputs) {
                    const type = inp.getAttribute('type') || 'text';
                    if (type.toLowerCase() === label.toLowerCase() && !inp.disabled && !inp.readOnly && inp.offsetParent !== null) {
                        const proto = inp.tagName === 'TEXTAREA' ? HTMLTextAreaElement : HTMLInputElement;
                        const setter = Object.getOwnPropertyDescriptor(proto.prototype, 'value').set;
                        setter.call(inp, val);
                        inp.dispatchEvent(new Event('input', {bubbles:true}));
                        inp.dispatchEvent(new Event('change', {bubbles:true}));
                        inp.dispatchEvent(new Event('blur', {bubbles:true}));
                        return 'ok-type';
                    }
                }
                return 'label-not-found';
            }
        ''', [label_text, value])
        return result

    @controller.action('Select an option in an el-select dropdown.')
    async def select_option(label_text: str, option_text: str):
        page = await browser_context.get_current_page()
        loading = await page.evaluate('''() => {
            const mask = document.querySelector('.el-loading-mask:not(.el-loading-mask--hidden)');
            return mask && mask.offsetParent !== null;
        }''')
        if loading:
            await page.evaluate('''() => new Promise(resolve => {
                let elapsed = 0;
                const check = () => {
                    if (elapsed >= 30000) { resolve('timeout'); return; }
                    const mask = document.querySelector('.el-loading-mask:not(.el-loading-mask--hidden)');
                    if (!mask || mask.offsetParent === null) resolve();
                    else { elapsed += 200; setTimeout(check, 200); }
                };
                check();
            })''')
        # Pre-check: is the select already showing a value?
        # If yes, pretend we just successfully selected it — don't tell LLM we skipped
        already_check = await page.evaluate('''
            ([label]) => {
                let container = document;
                const _topOvl = (() => {
                    for (const d of document.querySelectorAll('.el-dialog'))
                        if (d.offsetParent !== null) return d;
                    for (const d of document.querySelectorAll('.el-drawer'))
                        if (d.offsetParent !== null) return d;
                    return null;
                })();
                if (_topOvl) container = _topOvl;
                const items = container.querySelectorAll('.el-form-item');
                for (const item of items) {
                    const lbl = item.querySelector('.el-form-item__label')?.textContent?.trim() || '';
                    if (!lbl.includes(label)) continue;
                    const trigger = item.querySelector('.el-select .el-input__inner');
                    if (!trigger) continue;
                    const curVal = (trigger.value || '').trim();
                    if (curVal && curVal.length > 0) return 'already:' + curVal;
                    const curText = (trigger.textContent || '').trim();
                    if (curText && curText.length > 0 && !curText.includes('请选择')) return 'already:' + curText;
                }
                const allSelects = container.querySelectorAll('.el-select .el-input__inner');
                for (const sel of allSelects) {
                    if (sel.offsetParent !== null) {
                        const curVal = (sel.value || '').trim();
                        if (curVal && curVal.length > 0) return 'already:' + curVal;
                        const curText = (sel.textContent || '').trim();
                        if (curText && curText.length > 0 && !curText.includes('请选择')) return 'already:' + curText;
                        break;
                    }
                }
                return 'not-filled';
            }
        ''', [label_text])
        if already_check.startswith('already:'):
            confirm_val = already_check.split(':', 1)[1] if ':' in already_check else ''
            return f'ok | confirm=SELECTED:{confirm_val}'
        trigger_result = await page.evaluate('''
            ([label]) => {
                let container = document;
                const _topOvl = (() => {
                    for (const d of document.querySelectorAll('.el-dialog'))
                        if (d.offsetParent !== null) return d;
                    for (const d of document.querySelectorAll('.el-drawer'))
                        if (d.offsetParent !== null) return d;
                    return null;
                })();
                if (_topOvl) container = _topOvl;
                const items = container.querySelectorAll('.el-form-item');
                for (const item of items) {
                    const lbl = item.querySelector('.el-form-item__label')?.textContent?.trim() || '';
                    if (!lbl.includes(label)) continue;
                    const trigger = item.querySelector('.el-select .el-input__inner');
                    if (!trigger) return 'no-select-found';
                    if (trigger.disabled) return 'select-disabled';
                    trigger.click();
                    return 'triggered';
                }
                const allSelects = container.querySelectorAll('.el-select .el-input__inner');
                for (const sel of allSelects) {
                    const ph = sel.getAttribute('placeholder') || '';
                    if (ph.includes(label) && !sel.disabled && sel.offsetParent !== null) {
                        sel.click();
                        return 'triggered';
                    }
                }
                for (const sel of allSelects) {
                    if (!sel.disabled && sel.offsetParent !== null) {
                        sel.click();
                        return 'triggered';
                    }
                }
                return 'label-not-found';
            }
        ''', [label_text])
        if trigger_result in ('label-not-found', 'no-select-found', 'select-disabled'):
            return trigger_result
        await page.wait_for_timeout(800)
        select_result = await page.evaluate('''
            (option) => {
                const dropdowns = document.querySelectorAll('.el-select-dropdown');
                let dropdown = null;
                for (const dd of dropdowns) {
                    if (dd.offsetParent !== null && !dd.classList.contains('is-hidden')) {
                        dropdown = dd;
                    }
                }
                if (!dropdown) dropdown = document;
                const items = dropdown.querySelectorAll('.el-select-dropdown__item');
                const FIRST_ALIASES = ['first', '1st', '第一个', '第一项'];
                if (FIRST_ALIASES.includes(option.toLowerCase().trim())) {
                    for (const item of items) {
                        if (item.offsetParent !== null) { item.click(); return 'ok-first'; }
                    }
                    if (items.length > 0) { items[0].click(); return 'ok-first-hidden'; }
                    return 'no-items';
                }
                for (const item of items) {
                    if (item.textContent.trim() === option) {
                        item.click();
                        return 'ok';
                    }
                }
                for (const item of items) {
                    if (item.textContent.trim().includes(option)) {
                        item.click();
                        return 'ok-partial';
                    }
                }
                return 'option-not-found:' + [...items].map(i => i.textContent.trim()).join(', ');
            }
        ''', option_text)
        await page.wait_for_timeout(300)

        # After selection, read the selected value from the page to confirm it worked
        confirm_text = await page.evaluate('''
            ([label]) => {
                let container = document;
                const _topOvl = (() => {
                    for (const d of document.querySelectorAll('.el-dialog'))
                        if (d.offsetParent !== null) return d;
                    for (const d of document.querySelectorAll('.el-drawer'))
                        if (d.offsetParent !== null) return d;
                    return null;
                })();
                if (_topOvl) container = _topOvl;
                const items = container.querySelectorAll('.el-form-item');
                for (const item of items) {
                    const lbl = item.querySelector('.el-form-item__label')?.textContent?.trim() || '';
                    if (!lbl.includes(label)) continue;
                    const trigger = item.querySelector('.el-select .el-input__inner');
                    if (!trigger) continue;
                    const val = (trigger.value || '').trim();
                    const txt = (trigger.textContent || '').trim();
                    if (val) return 'SELECTED:' + val;
                    if (txt && !txt.includes('请选择')) return 'SELECTED:' + txt;
                }
                for (const sel of container.querySelectorAll('.el-select .el-input__inner')) {
                    if (sel.offsetParent !== null) {
                        const val = (sel.value || '').trim();
                        if (val) return 'SELECTED:' + val;
                    }
                }
                return 'NOT-SELECTED';
            }
        ''', [label_text])

        if confirm_text.startswith('SELECTED:'):
            return f'ok | confirm={confirm_text}'
        return f'{select_result} | no-confirm'

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
        return 'loading-done'

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
                drawerCount: visibleDrawers.length,
                loading: !!document.querySelector('.el-loading-mask:not(.el-loading-mask--hidden)'),
                openDropdown: !!document.querySelector('.el-select-dropdown:not(.is-hidden)'),
                formErrors: [...document.querySelectorAll('.el-form-item__error')].map(e => e.textContent.trim()).filter(Boolean),
                messages: [...document.querySelectorAll('.el-message')].map(e => e.textContent.trim()).filter(Boolean),
                notifications: [...document.querySelectorAll('.el-notification')].map(e => e.textContent.trim()).filter(Boolean),
                activeTab: document.querySelector('.el-tabs__item.is-active')?.textContent?.trim() || null,
                treeNodes: document.querySelectorAll('.el-tree-node').length || 0,
                tableRows: document.querySelectorAll('.el-table__body-wrapper .el-table__row').length || 0,
                url: location.href,
            };
        }''')
        return json.dumps(state, ensure_ascii=False)

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
        return result

    @controller.action('Switch to a tab by tab name in el-tabs component.')
    async def switch_tab(tab_name: str):
        page = await browser_context.get_current_page()
        result = await page.evaluate('''
            (name) => {
                const tabs = document.querySelectorAll('.el-tabs__item');
                for (const tab of tabs) {
                    if (tab.textContent.trim() === name && tab.offsetParent !== null) {
                        tab.click();
                        return 'ok';
                    }
                }
                return 'tab-not-found';
            }
        ''', tab_name)
        await page.wait_for_timeout(800)
        return result

    @controller.action('Click a menu item by its text. Handles expanding parent submenu if needed.')
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
        return result

    @controller.action('Close the topmost el-dialog or el-drawer.')
    async def close_dialog():
        page = await browser_context.get_current_page()
        result = await page.evaluate('''() => {
            let top = null;
            for (const sel of ['.el-dialog', '.el-drawer']) {
                for (const d of document.querySelectorAll(sel)) {
                    if (d.offsetParent !== null) { top = d; break; }
                }
                if (top) break;
            }
            if (!top) return 'no-overlay-open';
            const closeBtn = top.querySelector('.el-dialog__headerbtn .el-dialog__close, .el-drawer__close-btn, .el-drawer__header .el-icon-close');
            if (closeBtn) { closeBtn.click(); return 'ok'; }
            const cancelBtn = top.querySelector('.el-dialog__footer .el-button--default');
            if (cancelBtn) { cancelBtn.click(); return 'ok-cancel'; }
            return 'no-close-button';
        }''')
        await page.wait_for_timeout(500)
        return result

    @controller.action('Click a radio option by label text and radio option text.')
    async def click_radio(label_text: str, option_text: str):
        page = await browser_context.get_current_page()
        result = await page.evaluate('''
            ([label, option]) => {
                let container = document;
                const _topOvl = (() => {
                    for (const d of document.querySelectorAll('.el-dialog'))
                        if (d.offsetParent !== null) return d;
                    for (const d of document.querySelectorAll('.el-drawer'))
                        if (d.offsetParent !== null) return d;
                    return null;
                })();
                if (_topOvl) container = _topOvl;
                const items = container.querySelectorAll('.el-form-item');
                for (const item of items) {
                    const lbl = item.querySelector('.el-form-item__label')?.textContent?.trim() || '';
                    if (!lbl.includes(label)) continue;
                    const radios = item.querySelectorAll('.el-radio');
                    for (const radio of radios) {
                        if (radio.textContent.trim() === option && radio.offsetParent !== null) {
                            radio.click();
                            return 'ok';
                        }
                    }
                    return 'option-not-found';
                }
                return 'label-not-found';
            }
        ''', [label_text, option_text])
        return result

    @controller.action('Take a screenshot and save it to the snapshots directory.')
    async def take_screenshot():
        page = await browser_context.get_current_page()
        ts = datetime.now().strftime("%Y%m%d_%H%M%S")
        snapshot_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'snapshots')
        os.makedirs(snapshot_dir, exist_ok=True)
        path = os.path.join(snapshot_dir, f"screenshot_{ts}.png")
        await page.screenshot(path=path, full_page=False)
        return f'screenshot-saved:{path}'

    return controller
