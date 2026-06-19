#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
Playwright script assembler.

Reads an action JSON file (with {action, params, element} entries) and generates
a Playwright JS script with proper CTRL helpers for Element UI components.

Usage:
    python script_assembler.py <action_file.json> [output_path.js]
    python script_assembler.py -  # read from stdin
"""
import json
import os
import sys
import re
from datetime import datetime


# ========================== CTRL Injection Template ==========================

CTRL_API_CODE = '''const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: false, slowMo: 100, args: ['--window-position=-8,0'] });
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });

  await context.addInitScript(() => {
    window.CTRL = {
      getContainer: () => {
        for (const d of document.querySelectorAll('.el-dialog')) if (d.offsetParent !== null) return d;
        for (const d of document.querySelectorAll('.el-drawer')) if (d.offsetParent !== null) return d;
        return document;
      },
      fillFormField: (label, val) => {
        const c = window.CTRL.getContainer();
        const setFn = (t, v) => {
          const TagProto = t.tagName==='TEXTAREA'?HTMLTextAreaElement:HTMLInputElement;
          const setter = Object.getOwnPropertyDescriptor(TagProto.prototype,'value').set;
          setter.call(t, v);
          t.setAttribute('value', v);
          t.dispatchEvent(new Event('input',{bubbles:true}));
          t.dispatchEvent(new Event('change',{bubbles:true}));
          t.dispatchEvent(new Event('blur',{bubbles:true}));
        };
        for (const item of c.querySelectorAll('.el-form-item')) {
          const lbl = item.querySelector('.el-form-item__label')?.textContent?.trim() || '';
          if (lbl === label) { const t = item.querySelector('input:not([type="hidden"])')||item.querySelector('textarea'); if(!t) return 'no-input'; if(t.disabled||t.readOnly) return 'disabled'; if(t.closest('.el-date-editor,.tsscdatepicker')) { t.focus(); setFn(t,val); try{let vm=t.__vue__;if(vm){let p=vm.$parent;if(p&&p.$options&&p.$options.name==='ElDatePicker'){p.value=val;p.$emit('input',val);p.$emit('change',val);p.date=new Date(val);p.$emit('pick',new Date(val));}}}catch(e){} (t.parentNode?.querySelector('input')||t).click(); return new Promise(resolve=>{setTimeout(()=>{const d=new Date(val).getDate();for(const p of document.querySelectorAll('.el-picker-panel')){if(!p.offsetParent||p.style.display==='none')continue;for(const c of p.querySelectorAll('td.available:not(.prev-month):not(.next-month)')){if(parseInt(c.textContent.trim())===d&&!c.disabled){c.click();break}}}document.querySelectorAll('.el-picker-panel,.el-date-picker').forEach(x=>{x.style.display='none';x.classList.add('is-hidden')});resolve('ok-date')},200)}); } setFn(t,val); return 'ok'; }
        }
        for (const item of c.querySelectorAll('.el-form-item')) {
          const lbl = item.querySelector('.el-form-item__label')?.textContent?.trim() || '';
          if (lbl.includes(label)) { const t = item.querySelector('input:not([type="hidden"])')||item.querySelector('textarea'); if(!t) return 'no-input'; if(t.disabled||t.readOnly) return 'disabled'; if(t.closest('.el-date-editor,.tsscdatepicker')) { t.focus(); setFn(t,val); try{let vm=t.__vue__;if(vm){let p=vm.$parent;if(p&&p.$options&&p.$options.name==='ElDatePicker'){p.value=val;p.$emit('input',val);p.$emit('change',val);p.date=new Date(val);p.$emit('pick',new Date(val));}}}catch(e){} (t.parentNode?.querySelector('input')||t).click(); return new Promise(resolve=>{setTimeout(()=>{const d=new Date(val).getDate();for(const p of document.querySelectorAll('.el-picker-panel')){if(!p.offsetParent||p.style.display==='none')continue;for(const c of p.querySelectorAll('td.available:not(.prev-month):not(.next-month)')){if(parseInt(c.textContent.trim())===d&&!c.disabled){c.click();break}}}document.querySelectorAll('.el-picker-panel,.el-date-picker').forEach(x=>{x.style.display='none';x.classList.add('is-hidden')});resolve('ok-date')},200)}); } setFn(t,val); return 'ok'; }
        }
        // character-set match (handles word order differences like 登记注册地址 vs 注册登记地址)
        const _labelChars = [...new Set(label.replace(/[\\s,，、]/g,''))];
        if (_labelChars.length >= 2) {
          for (const item of c.querySelectorAll('.el-form-item')) {
            const lbl = item.querySelector('.el-form-item__label')?.textContent?.trim() || '';
            if (!_labelChars.every(ch => lbl.includes(ch))) continue;
            const t = item.querySelector('input:not([type="hidden"])')||item.querySelector('textarea'); if(!t) return 'no-input'; if(t.disabled||t.readOnly) return 'disabled';
            if(t.closest('.el-date-editor,.tsscdatepicker')) { t.focus(); setFn(t,val); try{let vm=t.__vue__;if(vm){let p=vm.$parent;if(p&&p.$options&&p.$options.name==='ElDatePicker'){p.value=val;p.$emit('input',val);p.$emit('change',val);p.date=new Date(val);p.$emit('pick',new Date(val));}}}catch(e){} (t.parentNode?.querySelector('input')||t).click(); return new Promise(resolve=>{setTimeout(()=>{const d=new Date(val).getDate();for(const p of document.querySelectorAll('.el-picker-panel')){if(!p.offsetParent||p.style.display==='none')continue;for(const c of p.querySelectorAll('td.available:not(.prev-month):not(.next-month)')){if(parseInt(c.textContent.trim())===d&&!c.disabled){c.click();break}}}document.querySelectorAll('.el-picker-panel,.el-date-picker').forEach(x=>{x.style.display='none';x.classList.add('is-hidden')});resolve('ok-date')},200)}); } setFn(t,val); return 'ok';
          }
        }
        for (const inp of c.querySelectorAll('input:not([type="hidden"]), textarea')) {
          const ph = inp.getAttribute('placeholder') || '';
          if (ph.includes(label) && !inp.disabled && !inp.readOnly && inp.offsetParent !== null) { setFn(inp,val); return 'ok-placeholder'; }
        }
        return 'label-not-found';
      },
      selectOption: (label, option) => {
        const c = window.CTRL.getContainer();
        for (const item of c.querySelectorAll('.el-form-item')) {
          const lbl = item.querySelector('.el-form-item__label')?.textContent?.trim() || '';
          if (!lbl.includes(label)) continue;
          const trigger = item.querySelector('.el-select .el-input__inner');
          if (!trigger) return 'no-select-found';
          trigger.dispatchEvent(new MouseEvent('mousedown',{bubbles:true}));
          trigger.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));
          trigger.click();
          setTimeout(() => {
            const opts = document.querySelectorAll('.el-select-dropdown__item');
            const FIRST = ['first','1st','\u7b2c\u4e00\u4e2a','\u7b2c\u4e00\u9879'];
            const t = FIRST.includes(option.toLowerCase().trim())
              ? [...opts].find(it => it.offsetParent !== null) || opts[0]
              : [...opts].find(it => it.textContent.trim() === option) || [...opts].find(it => it.textContent.trim().includes(option));
            if (t) { t.scrollIntoView({block:'nearest'}); t.dispatchEvent(new MouseEvent('mousedown',{bubbles:true})); t.click(); }
          }, 200);
          return 'triggered';
        }
        return 'label-not-found';
      },
      selectDate: (label, dateStr) => {
        const c = window.CTRL.getContainer();
        for (const item of c.querySelectorAll('.el-form-item')) {
          const lbl = item.querySelector('.el-form-item__label')?.textContent?.trim() || '';
          if (!lbl.includes(label)) continue;
          const input = item.querySelector('.el-date-editor input, .tsscdatepicker input');
          if (!input) continue;
          const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;
          setter.call(input, dateStr);
          input.dispatchEvent(new Event('input',{bubbles:true}));
          input.dispatchEvent(new Event('change',{bubbles:true}));
          input.dispatchEvent(new Event('blur',{bubbles:true}));
          input.blur();
          try{let vm=input.__vue__;if(vm){let p=vm.$parent;if(p&&p.$options&&p.$options.name==='ElDatePicker'){p.value=dateStr;p.$emit('input',dateStr);p.$emit('change',dateStr);p.$emit('pick',new Date(dateStr));}}}catch(e){}
          document.querySelectorAll('.el-picker-panel,.el-date-picker').forEach(x=>{x.style.display='none';x.classList.add('is-hidden')});
          return 'selected';
        }
        return 'label-not-found';
      },
      clickMenuItem: (text) => {
        for (const item of [...document.querySelectorAll('.el-menu-item')].filter(i=>i.textContent.trim()===text&&i.offsetParent)) { item.click(); return 'ok'; }
        for (const sm of document.querySelectorAll('.el-submenu')) {
          const title = sm.querySelector('.el-submenu__title');
          if (title) title.click();
          for (const si of sm.querySelectorAll('.el-menu-item')) { if (si.textContent.trim()===text) { setTimeout(()=>si.click(),300); return 'ok-expanded'; } }
        }
        return 'not-found';
      },
      clickTableRowAction: (rowText, btnText) => {
        for (const row of document.querySelectorAll('.el-table__body-wrapper .el-table__row')) {
          if (!row.textContent.includes(rowText)) continue;
          for (const btn of row.querySelectorAll('button,.el-button')) { const t=btn.textContent?.trim()||''; if(t.includes(btnText)&&btn.offsetParent){btn.click();return 'ok';} }
          return 'button-not-found';
        }
        return 'row-not-found';
      },
      clickRadio: (label, option) => {
        const c = window.CTRL.getContainer();
        for (const item of c.querySelectorAll('.el-form-item')) {
          const lbl = item.querySelector('.el-form-item__label')?.textContent?.trim()||'';
          if (!lbl.includes(label)) continue;
          for (const radio of item.querySelectorAll('.el-radio')) { if(radio.textContent.trim()===option&&radio.offsetParent){radio.click();return 'ok';} }
          return 'option-not-found';
        }
        return 'label-not-found';
      },
      clickAdjacentButton: (label) => {
        const c = window.CTRL.getContainer();
        for (const item of c.querySelectorAll('.el-form-item')) {
          const lbl = item.querySelector('.el-form-item__label')?.textContent?.trim()||'';
          if (!lbl.includes(label)) continue;
          const inp = item.querySelector('.el-input__inner');
          if (inp&&inp.value&&inp.value.trim()!=='') return 'already-filled';
          const btn = item.querySelector('button.el-button--primary.is-plain');
          if (btn&&btn.offsetParent){btn.click();return 'clicked';}
          return 'no-button-found';
        }
        return 'label-not-found';
      },
      closeDialog: () => {
        for (const d of [...document.querySelectorAll('.el-dialog')].reverse()) { if(d.offsetParent) { const cb=d.querySelector('.el-dialog__headerbtn .el-icon-close'); if(cb){cb.click();return 'ok';} return 'no-close-button'; } }
        return 'no-overlay-open';
      },
      switchTab: (name) => {
        for (const tab of document.querySelectorAll('.el-tabs__item')) { if(tab.textContent.trim()===name&&tab.offsetParent){tab.click();return 'ok';} }
        return 'tab-not-found';
      },
      waitForLoading: () => new Promise(resolve => { let el=0; const ck=()=>{ if(el>=30000){resolve('timeout');return; } const m=document.querySelector('.el-loading-mask:not(.el-loading-mask--hidden)'); if(!m||m.offsetParent===null) resolve(); else { el+=200; setTimeout(ck,200); } }; ck(); }),
      checkFieldValue: (label) => {
        const c = window.CTRL.getContainer();
        for (const item of c.querySelectorAll('.el-form-item')) { const lbl=item.querySelector('.el-form-item__label')?.textContent?.trim()||''; if(!lbl.includes(label)) continue; const inp=item.querySelector('input:not([type="hidden"])')||item.querySelector('textarea'); return inp?.value||'empty'; }
        return 'label-not-found';
      },
      expandAllTreeNodes: () => { let t=0; for(let r=0;r<10;r++){ const n=document.querySelectorAll('.el-tree-node:not(.is-expanded)'); if(n.length===0)break; n.forEach(node=>{const i=node.querySelector(':scope>.el-tree-node__content>.el-tree-node__expand-icon');if(i){i.click();t++;}}); } return t; },
    };
  });

  const page = await context.newPage();

  try {
'''

CTRL_FOOTER = '''  } catch (err) {
    console.error('Test failed:', err.message);
    try { await page.screenshot({ path: '/tmp/error.png' }); } catch {}
    throw err;
  } finally {
    console.log('Waiting 30s before closing browser...');
    await page.waitForTimeout(30000);
    await browser.close();
  }
})().catch(err => { console.error(err); process.exit(1); });
'''


# ========================== Action-to-Code Mapping ==========================

def _escape(s):
    """Escape single quotes for JS strings."""
    return s.replace('\\', '\\\\').replace("'", "\\'") if s else ''


def _generate_action_code(entry, step_num, url):
    """Generate Playwright JS code from a recorded action entry."""
    action = entry.get('action', '')
    params = entry.get('params', {}) or {}
    element = entry.get('element', None)

    def pre():
        return "    await page.evaluate(() => CTRL.waitForLoading());"

    lines = [f'    // [{step_num}] {action}']

    def p(k, default=''):
        v = params.get(k, default)
        return str(v) if v else default

    if action == 'go_to_url':
        return ''  # skip, URL already handled in header

    if action == 'fill_form_field':
        l, v = p('label_text'), p('value')
        lines.append(f"    console.log('[{step_num}] Fill \"{l}\"');")
        lines.append(pre())
        lines.append(f"    const _r{step_num} = await page.evaluate(() => CTRL.fillFormField('{_escape(l)}', '{_escape(v)}'));")
        lines.append(f"    if (_r{step_num} !== 'ok' && _r{step_num} !== 'ok-date' && _r{step_num} !== 'ok-placeholder' && _r{step_num} !== 'ok-type')")
        lines.append(f"      console.log('[{step_num}] fill result:', _r{step_num});")
        lines.append('    // Verify value was set; if empty, fall back to Playwright native fill')
        lines.append('    await page.waitForTimeout(100);')
        lines.append(f'    const _c{step_num} = await page.evaluate((lbl) => {{')
        lines.append("      for (const item of document.querySelectorAll('.el-form-item')) {")
        lines.append("        const l = item.querySelector('.el-form-item__label')?.textContent?.trim() || '';")
        lines.append("        if (!l.includes(lbl) && ![...new Set(lbl.replace(/[\\s,，、]/g,''))].every(c => l.includes(c))) continue;")
        lines.append("        const t = item.querySelector('input:not([type=\\\"hidden\\\"])') || item.querySelector('textarea');")
        lines.append("        return t ? t.value : '';")
        lines.append('      }')
        lines.append("      return '';")
        lines.append(f"    }}, '{_escape(l)}');")
        lines.append(f"    if (_c{step_num} !== '{_escape(v)}' && _c{step_num}.trim() === '') {{")
        lines.append('      console.log(`[' + str(step_num) + '] Value empty after CTRL fill, trying Playwright native fill...`);')
        lines.append(f"      await page.locator('.el-form-item').filter({{ hasText: '{_escape(l)}' }}).locator('input, textarea').first().fill('{_escape(v)}');")
        lines.append(f"      console.log('[{step_num}] PW fill done');")
        lines.append('    }')
        lines.append('    await page.waitForTimeout(200);')
        return '\n'.join(lines)

    if action == 'select_option':
        l, o = p('label_text'), p('option_text')
        lines.append(f"    console.log('[{step_num}] Select \"{l}\"');")
        lines.append(pre())
        lines.append(f"    await page.evaluate(() => CTRL.selectOption('{_escape(l)}', '{_escape(o)}'));")
        lines.append('    await page.waitForTimeout(300);')
        return '\n'.join(lines)

    if action == 'fill_date_field':
        l, v = p('label_text'), p('value')
        lines.append(f"    console.log('[{step_num}] Set date \"{l}\"');")
        lines.append(pre())
        lines.append(f"    await page.evaluate(() => CTRL.selectDate('{_escape(l)}', '{_escape(v)}'));")
        lines.append('    await page.waitForTimeout(300);')
        return '\n'.join(lines)

    if action == 'click_menu_item':
        t = p('menu_text')
        lines.append(f"    console.log('[{step_num}] Menu \"{t}\"');")
        lines.append(pre())
        lines.append(f"    await page.evaluate(() => CTRL.clickMenuItem('{_escape(t)}'));")
        lines.append('    await page.waitForTimeout(300);')
        lines.append("    await page.evaluate(() => CTRL.waitForLoading());")
        return '\n'.join(lines)

    if action == 'click_table_row_action':
        r, b = p('row_text'), p('button_text')
        lines.append(f"    console.log('[{step_num}] Table action');")
        lines.append(pre())
        lines.append(f"    await page.evaluate(() => CTRL.clickTableRowAction('{_escape(r)}', '{_escape(b)}'));")
        lines.append('    await page.waitForTimeout(300);')
        return '\n'.join(lines)

    if action == 'click_adjacent_button':
        l = p('label_text')
        lines.append(f"    console.log('[{step_num}] Adjacent \"{l}\"');")
        lines.append(pre())
        lines.append(f"    await page.evaluate(() => CTRL.clickAdjacentButton('{_escape(l)}'));")
        lines.append('    await page.evaluate(() => CTRL.waitForLoading());')
        lines.append('    await page.waitForTimeout(300);')
        return '\n'.join(lines)

    if action == 'click_radio':
        l, o = p('label_text'), p('option_text')
        lines.append(f"    console.log('[{step_num}] Radio \"{l}\"');")
        lines.append(pre())
        lines.append(f"    await page.evaluate(() => CTRL.clickRadio('{_escape(l)}', '{_escape(o)}'));")
        lines.append('    await page.waitForTimeout(300);')
        return '\n'.join(lines)

    if action == 'click_element_by_index':
        idx = p('index')
        xp = ''
        if element:
            xp = (element.get('xpath') or '')
        if not xp:
            xp = entry.get('target', '') or ''
        txt = ''
        if element:
            txt = (element.get('text') or '')
        if not txt:
            txt = entry.get('propertiesName', '') or p('text', '')
        if xp:
            if not xp.startswith('/') and not xp.startswith('//'):
                xp = '/' + xp
            lines.append(f"    console.log('[{step_num}] Click [{idx}]');")
            lines.append("    await page.waitForFunction(before => location.href !== before, page.url(), { timeout: 5000 }).catch(() => {});")
            lines.append('    await page.evaluate(() => CTRL.waitForLoading());')
            lines.append('    try {')
            lines.append(f"      await page.locator('xpath={_escape(xp)}').first().click({{ timeout: 3000 }});")
            lines.append('    } catch (e) {')
            lines.append('      try {')
            if txt:
                lines.append(f"        await page.locator(':text-is(\"{_escape(txt)}\")').first().click({{ timeout: 5000 }});")
            else:
                lines.append(f"        await page.locator('xpath={_escape(xp)}').first().click({{ timeout: 5000, force: true }});")
            lines.append('      } catch (e2) {')
            lines.append(f"        // Final fallback: JS dispatchEvent bypasses visibility/pointer-events checks")
            lines.append(f"        await page.evaluate((xp) => {{")
            lines.append(f"          const el = document.evaluate(xp, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;")
            lines.append(f"          if (el) el.dispatchEvent(new MouseEvent('click', {{ bubbles: true }}));")
            lines.append(f"        }}, '{_escape(xp)}');")
            lines.append('      }')
            lines.append('    }')
            lines.append('    await page.waitForTimeout(300);')
            return '\n'.join(lines)
        lines.append(f"    console.log('[{step_num}] Click [{idx}] (no XPath)');")
        return '\n'.join(lines)

    if action == 'switch_tab':
        n = p('tab_name')
        lines.append(f"    console.log('[{step_num}] Tab \"{n}\"');")
        lines.append(f"    await page.evaluate(() => CTRL.switchTab('{_escape(n)}'));")
        lines.append('    await page.waitForTimeout(500);')
        return '\n'.join(lines)

    if action == 'close_dialog':
        lines.append(f"    console.log('[{step_num}] Close dialog');")
        lines.append('    await page.evaluate(() => CTRL.closeDialog());')
        lines.append('    await page.waitForTimeout(500);')
        return '\n'.join(lines)

    if action == 'wait_for_loading':
        lines.append('    await page.evaluate(() => CTRL.waitForLoading());')
        return '\n'.join(lines)

    if action in ('scroll_down', 'scroll_up', 'get_page_state', 'scan_form_fields', 'scan_visible_fields',
                  'check_field_value', 'verify_field_value', 'take_screenshot',
                  'save_trajectory', 'save_case_data', 'read_case_data',
                  'match_form_rule', 'init_task_list', 'get_pending_tasks', 'sync_tasks_from_errors',
                  'expand_all_el_tree', 'task_done', 'task_retry'):
        # Skip internal/exploratory actions
        return ''

    if action in ('fill_form_fields_batch', 'fill_pending_batch'):
        # Batch operations expanded as individual actions in the recording
        return ''

    lines.append(f'    // skipped: {action}')
    return '\n'.join(lines)


# ========================== Assembly ==========================

def assemble_script(action_entries, target_url=None):
    """Assemble a complete Playwright script from recorded action entries."""
    body = []
    step = 1

    url = target_url or ''
    if not url or 'unknown' in url.lower():
        url = 'http://target-url-placeholder'
    body.append(f'    await page.goto(\'{url}\', {{ waitUntil: \'networkidle\', timeout: 60000 }});')
    body.append('    await page.waitForTimeout(2000);')

    for entry in action_entries:
        action = entry.get('action', '')
        if action in ('scroll_down', 'scroll_up', 'get_page_state', 'scan_form_fields', 'scan_visible_fields',
                      'check_field_value', 'verify_field_value', 'take_screenshot', 'save_trajectory',
                      'save_case_data', 'read_case_data', 'match_form_rule', 'init_task_list',
                      'get_pending_tasks', 'sync_tasks_from_errors', 'expand_all_el_tree',
                      'task_done', 'task_retry', 'fill_form_fields_batch', 'fill_pending_batch'):
            continue
        code = _generate_action_code(entry, step, url)
        if code:
            body.append(code)
            step += 1

    return CTRL_API_CODE + '\n'.join(body) + '\n\n' + CTRL_FOOTER


# ========================== Main ==========================

def main():
    if len(sys.argv) < 2:
        print('Usage: python script_assembler.py <action_file.json> [output.js]', file=sys.stderr)
        sys.exit(1)

    input_path = sys.argv[1]
    output_path = sys.argv[2] if len(sys.argv) > 2 else None

    if input_path == '-':
        data = json.load(sys.stdin)
    else:
        with open(input_path, 'r', encoding='utf-8') as f:
            data = json.load(f)

    # Read commands from either format
    raw_cmds = data.get('actions', []) or (data.get('tests', [{}])[0].get('commands', []) if data.get('tests') else [])
    # If entries already have action field, use directly; otherwise convert old format
    has_new = raw_cmds and any(c.get('action') for c in raw_cmds if isinstance(c, dict))
    if not has_new:
        actions = []
        for cmd in raw_cmds:
            c = cmd.get('command', '')
            if c == 'input':
                actions.append({'action': 'fill_form_field', 'params': {'label_text': cmd.get('propertiesName', ''), 'value': cmd.get('value', '')},
                    'element': {'xpath': cmd.get('target', ''), 'tag_name': cmd.get('tagName', ''), 'attributes': cmd.get('attributes', {})}})
            elif c == 'select':
                actions.append({'action': 'select_option', 'params': {'label_text': cmd.get('propertiesName', ''), 'option_text': cmd.get('value', '')},
                    'element': {'xpath': cmd.get('target', ''), 'tag_name': cmd.get('tagName', ''), 'attributes': cmd.get('attributes', {})}})
            elif c == 'click':
                actions.append({'action': 'click_element_by_index', 'params': {'index': cmd.get('value', '0'), 'tag_name': cmd.get('tagName', ''), 'text': cmd.get('propertiesName', '')},
                    'element': {'xpath': cmd.get('target', ''), 'tag_name': cmd.get('tagName', ''), 'attributes': cmd.get('attributes', {})}})
    else:
        actions = raw_cmds
    url = data.get('url', '') or ''
    if not url or 'unknown' in url.lower():
        for entry in actions if isinstance(actions, list) else []:
            if entry.get('action') == 'go_to_url':
                url = entry.get('params', {}).get('url', '') or ''
                if url:
                    break

    script = assemble_script(actions, url)

    if output_path:
        with open(output_path, 'w', encoding='utf-8') as f:
            f.write(script)
        print(f'Script written: {output_path}')
        print(f'Steps: {len([a for a in actions if a.get("action","") not in ("scroll_down","scroll_up","get_page_state","scan_form_fields","scan_visible_fields","check_field_value","verify_field_value","take_screenshot","save_trajectory","save_case_data","read_case_data","match_form_rule","init_task_list","get_pending_tasks","sync_tasks_from_errors","expand_all_el_tree","task_done","task_retry")])}')
    else:
        print(script)


if __name__ == '__main__':
    main()
