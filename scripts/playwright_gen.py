"""
Playwright script generator patches for custom Element UI actions.
Monkey-patches AgentHistoryList.save_as_playwright_script to handle custom controller actions.
"""
from functools import partial
from pathlib import Path

def _make_simple_mapper(comment, js_code, wait_ms=500):
    def _mapper(history_list, params, step_info_str, **kwargs):
        return [
            f'            # Action: {comment}',
            f'            print(f"Executing {comment} ({step_info_str})")',
            f'            await page.evaluate({repr(js_code)})',
            f'            await page.wait_for_timeout({wait_ms})',
        ]
    return _mapper


def _map_fill_form_field(history_list, params, step_info_str, **kwargs):
    label = params.get('label_text', '')
    value = params.get('value', '')
    return [
        f'            # Action: fill_form_field (Element UI native setter)',
        f'            print(f"Filling form field \'{label}\" with value ({step_info_str})")',
        f'            await page.evaluate("""',
        f'                ([label, val]) => {{',
        f'                    let container = document;',
        f'                    const dialogs = document.querySelectorAll(\'.el-dialog\');',
        f'                    if (dialogs.length > 0) {{',
        f'                        let topDialog = null;',
        f'                        for (const d of dialogs) {{ if (d.offsetParent !== null) topDialog = d; }}',
        f'                        if (topDialog) container = topDialog;',
        f'                    }}',
        f'                    const items = container.querySelectorAll(\'.el-form-item\');',
        f'                    for (const item of items) {{',
        f'                        const lbl = item.querySelector(\'.el-form-item__label\')?.textContent?.trim() || \'\';',
        f'                        if (!lbl.includes(label)) continue;',
        f'                        const input = item.querySelector(\'input:not([type="hidden"])\');',
        f'                        const textarea = item.querySelector(\'textarea\');',
        f'                        const target = input || textarea;',
        f'                        if (!target) return \'no-input-found\';',
        f'                        const proto = input ? HTMLInputElement : HTMLTextAreaElement;',
        f'                        const setter = Object.getOwnPropertyDescriptor(proto.prototype, \'value\').set;',
        f'                        setter.call(target, val);',
        f'                        target.dispatchEvent(new Event(\'input\', {{bubbles:true}}));',
        f'                        target.dispatchEvent(new Event(\'change\', {{bubbles:true}}));',
        f'                        target.dispatchEvent(new Event(\'blur\', {{bubbles:true}}));',
        f'                        return \'ok\';',
        f'                    }}',
        f'                    return \'label-not-found\';',
        f'                }}',
        f'            """, [{repr(label)}, {repr(value)}])',
        f'            await page.wait_for_timeout(500)',
    ]


def _map_select_option(history_list, params, step_info_str, **kwargs):
    label = params.get('label_text', '')
    option = params.get('option_text', '')
    return [
        f'            # Action: select_option (Element UI el-select)',
        f'            print(f"Selecting option \'{option}\' in \'{label}\" ({step_info_str})")',
        f'            await page.evaluate("""',
        f'                (label) => {{',
        f'                    const items = document.querySelectorAll(\'.el-form-item\');',
        f'                    for (const item of items) {{',
        f'                        const lbl = item.querySelector(\'.el-form-item__label\')?.textContent?.trim() || \'\';',
        f'                        if (!lbl.includes(label)) continue;',
        f'                        const trigger = item.querySelector(\'.el-select .el-input__inner\');',
        f'                        if (trigger) {{ trigger.click(); return \'triggered\'; }}',
        f'                    }}',
        f'                    return \'not-found\';',
        f'                }}',
        f'            """, {repr(label)})',
        f'            await page.wait_for_timeout(800)',
        f'            await page.evaluate("""',
        f'                (option) => {{',
        f'                    const items = document.querySelectorAll(\'.el-select-dropdown__item\');',
        f'                    for (const item of items) {{',
        f'                        if (item.textContent.trim() === option) {{ item.click(); return \'ok\'; }}',
        f'                    }}',
        f'                    for (const item of items) {{',
        f'                        if (item.textContent.trim().includes(option)) {{ item.click(); return \'ok-partial\'; }}',
        f'                    }}',
        f'                    return \'option-not-found\';',
        f'                }}',
        f'            """, {repr(option)})',
        f'            await page.wait_for_timeout(300)',
    ]


def _map_click_radio(history_list, params, step_info_str, **kwargs):
    label = params.get('label_text', '')
    option = params.get('option_text', '')
    return [
        f'            # Action: click_radio (Element UI el-radio)',
        f'            print(f"Clicking radio \'{option}\' in \'{label}\" ({step_info_str})")',
        f'            await page.evaluate("""',
        f'                ([label, option]) => {{',
        f'                    const items = document.querySelectorAll(\'.el-form-item\');',
        f'                    for (const item of items) {{',
        f'                        const lbl = item.querySelector(\'.el-form-item__label\')?.textContent?.trim() || \'\';',
        f'                        if (!lbl.includes(label)) continue;',
        f'                        const radios = item.querySelectorAll(\'.el-radio\');',
        f'                        for (const radio of radios) {{',
        f'                            if (radio.textContent.trim() === option && radio.offsetParent !== null) {{ radio.click(); return \'ok\'; }}',
        f'                        }}',
        f'                    }}',
        f'                }}',
        f'            """, [{repr(label)}, {repr(option)}])',
        f'            await page.wait_for_timeout(300)',
    ]


def _map_take_screenshot(history_list, params, step_info_str, **kwargs):
    return [
        f'            # Action: take_screenshot',
        f'            print(f"Taking screenshot ({step_info_str})")',
        f'            await page.screenshot(path="screenshot_step.png")',
    ]


def patch_playwright_script_generator():
    """Monkey-patch AgentHistoryList.save_as_playwright_script with custom Element UI handlers."""
    from browser_use.agent.playwright_script_generator import PlaywrightScriptGenerator
    from browser_use.agent.views import AgentHistoryList

    custom_handlers = {}
    custom_handlers['fill_form_field'] = _map_fill_form_field
    custom_handlers['select_option'] = _map_select_option
    custom_handlers['click_radio'] = _map_click_radio
    custom_handlers['take_screenshot'] = _map_take_screenshot
    custom_handlers['expand_all_el_tree'] = _make_simple_mapper(
        'expand_all_el_tree',
        '''() => { for(let i=0;i<10;i++){ const tree=document.querySelector('.el-tree'); if(!tree)return; let n=0; tree.querySelectorAll('.el-tree-node:not(.is-expanded)').forEach(node=>{ const icon=node.querySelector(':scope > .el-tree-node__content > .el-tree-node__expand-icon'); if(icon){icon.click();n++;} }); if(n===0)break; } }'''
    )
    custom_handlers['wait_for_loading'] = _make_simple_mapper(
        'wait_for_loading',
        '''() => new Promise(resolve => { const check = () => { const m = document.querySelector('.el-loading-mask:not(.el-loading-mask--hidden)'); if (!m || m.offsetParent === null) resolve(); else setTimeout(check, 200); }; check(); })'''
    )
    custom_handlers['close_dialog'] = _make_simple_mapper(
        'close_dialog',
        '''() => { const dialogs = document.querySelectorAll('.el-dialog'); let top = null; for (const d of dialogs) { if (d.offsetParent !== null) { top = d; break; } } if (!top) return; const c = top.querySelector('.el-dialog__headerbtn .el-dialog__close'); if (c) c.click(); else { const b = top.querySelector('.el-dialog__footer .el-button--default'); if (b) b.click(); } }''',
        wait_ms=500
    )
    custom_handlers['click_menu_item'] = _make_simple_mapper(
        'click_menu_item',
        '''(text) => { const item = [...document.querySelectorAll('.el-menu-item')].find(el => el.textContent.trim() === text && el.offsetParent !== null); if (item) { item.click(); return; } const sms = document.querySelectorAll('.el-submenu'); for (const sm of sms) { if ([...sm.querySelectorAll('.el-menu-item')].some(i => i.textContent.trim() === text)) { if (!sm.classList.contains('is-opened')) sm.querySelector('.el-submenu__title')?.click(); setTimeout(() => { [...sm.querySelectorAll('.el-menu-item')].find(i => i.textContent.trim() === text)?.click(); }, 300); break; } } }''',
        wait_ms=800
    )
    custom_handlers['switch_tab'] = _make_simple_mapper(
        'switch_tab',
        '''(name) => { const tab = [...document.querySelectorAll('.el-tabs__item')].find(t => t.textContent.trim() === name && t.offsetParent !== null); if (tab) tab.click(); }''',
        wait_ms=800
    )
    custom_handlers['click_table_row_action'] = _make_simple_mapper(
        'click_table_row_action',
        '''([rowText, btnText]) => { const rows = document.querySelectorAll('.el-table__body-wrapper .el-table__row'); for (const row of rows) { if (!row.textContent.includes(rowText)) continue; const btns = row.querySelectorAll('button, .el-button'); for (const b of btns) { if ((b.textContent?.trim()?.includes(btnText) || b.className?.includes(btnText)) && b.offsetParent !== null) { b.click(); return; } } if (btnText==='edit'||btnText==='编辑') { const icon = row.querySelector('i.el-icon-edit,i[class*=\"bianji\"],i[class*=\"edit\"]'); if (icon && icon.offsetParent !== null) { icon.click(); return; } } if (btnText==='delete'||btnText==='删除') { const icon = row.querySelector('i.el-icon-delete,i[class*=\"shanchu\"],i[class*=\"delete\"]'); if (icon && icon.offsetParent !== null) { icon.click(); return; } } } }''',
        wait_ms=500
    )
    custom_handlers['get_page_state'] = _make_simple_mapper(
        'get_page_state',
        '''() => ({ dialogs: document.querySelectorAll('.el-dialog').length, loading: !!document.querySelector('.el-loading-mask:not(.el-loading-mask--hidden)') })''',
        wait_ms=0
    )
    custom_handlers['match_form_rule'] = _make_simple_mapper(
        'match_form_rule',
        '''() => {}''',
        wait_ms=0
    )

    _original_save = AgentHistoryList.save_as_playwright_script

    def patched_save(self, output_path, sensitive_data_keys=None, browser_config=None, context_config=None):
        serialized_history = self.model_dump()['history']
        gen = PlaywrightScriptGenerator(serialized_history, sensitive_data_keys, browser_config, context_config)
        for action_type, handler in custom_handlers.items():
            gen._action_handlers[action_type] = partial(handler, serialized_history)
        script_content = gen.generate_script_content()
        path_obj = Path(output_path)
        path_obj.parent.mkdir(parents=True, exist_ok=True)
        with open(path_obj, 'w', encoding='utf-8') as f:
            f.write(script_content)

    AgentHistoryList.save_as_playwright_script = patched_save
