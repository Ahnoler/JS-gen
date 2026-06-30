#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
Playwright script assembler.

Reads an action JSON file (with {action, params, element} entries) and generates
a Playwright JS script with proper CTRL helpers for Element UI components.

Features:
  - Multi-tier selector degradation (ID → class → XPath → text → fuzzy)
  - Identity field auto-generation (credit code, mobile, etc.)
  - Error collection + structured error report for self-healing
  - Per-tier error diagnostics (CTRL | Playwright | absolute XPath → English hint)

Verified (detection + self-healing):
  ✅ fill_form_field       — 3-tier: CTRL → Playwright hasText → absolute XPath
  ✅ select_option         — 3-tier: CTRL → Playwright native → absolute XPath
  ✅ click_element_by_index — N-tier: ID → class → XPath → text → JS → fuzzy

TODO — remaining operations lack multi-tier degradation + structured error reporting:
  ☐ click_menu_item        — single-tier CTRL, error: 'not-found'
  ☐ click_table_row_action — single-tier CTRL, error: returns CTRL string
  ☐ click_radio            — single-tier CTRL, error: returns CTRL string
  ☐ fill_date_field        — no fallback, direct CTRL call
  ☐ click_adjacent_button  — no fallback, direct CTRL call
  ☐ switch_tab             — no fallback
  ☐ close_dialog           — no fallback

Usage:
    python script_assembler.py <action_file.json> [output_path.js]
    python script_assembler.py -  # read from stdin
"""
import json
import os
import sys
import re
from datetime import datetime

_THIS_DIR = os.path.dirname(os.path.abspath(__file__))
_PROJECT_ROOT = os.path.dirname(_THIS_DIR)
if _PROJECT_ROOT not in sys.path:
    sys.path.insert(0, _PROJECT_ROOT)

from scripts.models import ActionEntry, ActionFile, FormSnapshot, ElementInfo


# Actions that are meta/utility only — not rendered as Playwright steps
_SKIP_ACTIONS = (
    'scroll_down', 'scroll_up', 'get_page_state', 'scan_form_fields', 'scan_visible_fields',
    'check_field_value', 'verify_field_value', 'take_screenshot',
    'save_trajectory', 'save_case_data', 'read_case_data',
    'match_form_rule', 'init_task_list', 'get_pending_tasks', 'sync_tasks_from_errors',
    'expand_all_el_tree', 'task_done', 'task_retry',
    'save_form_snapshot',
)

# ========================== CTRL Injection Template ==========================

CTRL_API_CODE = '''const { chromium } = require('playwright');
const fs = require('fs');

// ===== Identity value generators (from atp-rule) =====
function genValidIdCard(prefix) {
  prefix = prefix || '430101';
  const y = 1950 + Math.floor(Math.random() * 55);
  const m = String(Math.floor(Math.random() * 12) + 1).padStart(2, '0');
  const d = String(Math.floor(Math.random() * 28) + 1).padStart(2, '0');
  const seq = String(Math.floor(Math.random() * 999)).padStart(3, '0');
  const base = prefix + y + m + d + seq;
  const w = [7,9,10,5,8,4,2,1,6,3,7,9,10,5,8,4,2];
  const map = ['1','0','X','9','8','7','6','5','4','3','2'];
  const sum = base.split('').reduce((s, c, i) => s + parseInt(c) * w[i], 0);
  return base + map[sum % 11];
}
function genMobile() {
  const s = [3,4,5,6,7,8,9][Math.floor(Math.random() * 7)];
  let n = '1' + s;
  for (let i = 0; i < 9; i++) n += Math.floor(Math.random() * 10);
  return n;
}
function genEmail() {
  const names = ['test','admin','user','contact','info','service'];
  const domains = ['example.com','company.com','test.org','mail.cn'];
  return names[Math.floor(Math.random()*names.length)] + '_' + Math.random().toString(36).substring(2,6) + '@' + domains[Math.floor(Math.random()*domains.length)];
}
function genCreditCode() {
  const CHARS = '0123456789ABCDEFGHJKLMNPQRTUWXY';
  const W = [1,3,9,27,19,26,16,17,20,29,25,13,8,24,10,30,28];
  let body = '91' + String(Math.floor(Math.random()*900000)+100000);
  for (let i=0; i<9; i++) body += CHARS[Math.floor(Math.random()*CHARS.length)];
  const total = body.split('').reduce((s,c,i)=>s+CHARS.indexOf(c)*W[i],0);
  return body + CHARS[(31-total%31)%31];
}
function genBankCard() {
  let n = '62';
  for (let i=0; i<17; i++) n += Math.floor(Math.random()*10);
  return n.slice(0,19);
}
function genName() {
  const surnames = ['张','李','王','刘','陈','杨','赵','黄','周','吴'];
  const names = ['伟','芳','敏','静','丽','强','磊','洋','涛','明','飞','峰'];
  return surnames[Math.floor(Math.random()*surnames.length)] + names[Math.floor(Math.random()*names.length)] + names[Math.floor(Math.random()*names.length)];
}
function genAmount() {
  const base = Math.floor(Math.random()*9900000)+100000;
  const cent = Math.floor(Math.random()*100);
  return base + '.' + String(cent).padStart(2,'0');
}
function genAddress() {
  const cities = ['北京市朝阳区','上海市浦东新区','广州市天河区','深圳市南山区','杭州市西湖区','长沙市岳麓区'];
  const roads = ['中山路','人民路','解放路','建设路','五一路','芙蓉路'];
  return cities[Math.floor(Math.random()*cities.length)] + roads[Math.floor(Math.random()*roads.length)] + (Math.floor(Math.random()*200)+1) + '号';
}
function genIdentityValue(label) {
  const t = label.replace(/\\s+/g, '');
  if (t.includes('证件号码')||t.includes('信用代码')||t.includes('营业执照')) return genCreditCode();
  if (t.includes('身份证')) return genValidIdCard();
  if (t.includes('手机')||t.includes('电话')||t.includes('联系方式')) return genMobile();
  if (t.includes('邮箱')||t.includes('Email')||t.includes('电子邮箱')) return genEmail();
  if (t.includes('银行卡')||t.includes('银行账号')) return genBankCard();
  if (t.includes('姓名')||t.includes('用户名')||t.includes('联系人')) return genName();
  if (t.includes('金额')||t.includes('价格')||t.includes('费用')) return genAmount();
  if (t.includes('地址')||t.includes('详细地址')) return genAddress();
  return null;
}

// ===== Error collection =====
const _errors = [];
const _TMP = process.env.TMPDIR || process.env.TMP || process.env.TEMP || '/tmp';
function _recordError(step, action, label, value, error, details, severity) {
  severity = severity || 'error';
  _errors.push({ step, action, label: label||'', value: value||'', error, details: details||'', severity });
  var tag = severity === 'warning' ? 'WARNING' : 'FAILED';
  console.log('  [' + step + '] ' + action + ' ' + tag + ': ' + error);
}

(async () => {
  const _CDP_PORT = 9223 + Math.floor(Math.random() * 100);
  const browser = await chromium.launch({ headless: false, slowMo: 100, args: [`--window-position=-8,0`, `--remote-debugging-port=${_CDP_PORT}`] });
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
          t.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:v}));
          t.dispatchEvent(new Event('change',{bubbles:true}));
          t.dispatchEvent(new Event('blur',{bubbles:true}));
        };
        for (const item of c.querySelectorAll('.el-form-item')) {
          const lbl = item.querySelector('.el-form-item__label')?.textContent?.trim()||'';
          if (!lbl.includes(label)) continue;
          const t = item.querySelector('input:not([type="hidden"])')||item.querySelector('textarea');
          if (!t) return 'no-input-found';
          if (t.disabled||t.readOnly) return 'field-disabled';
          if (t.closest('.el-date-editor,.tsscdatepicker')) { t.focus(); setFn(t,val); try{let vm=t.__vue__;if(vm){let p=vm.$parent;if(p&&p.$options&&p.$options.name==='ElDatePicker'){p.value=val;p.$emit('input',val);p.$emit('change',val);p.date=new Date(val);p.$emit('pick',new Date(val));}}}catch(e){} (t.parentNode?.querySelector('input')||t).click(); return new Promise(resolve=>{setTimeout(()=>{const d=new Date(val).getDate();for(const p of document.querySelectorAll('.el-picker-panel')){if(!p.offsetParent||p.style.display==='none')continue;for(const c of p.querySelectorAll('td.available:not(.prev-month):not(.next-month)')){if(parseInt(c.textContent.trim())===d&&!c.disabled){c.click();break}}}document.querySelectorAll('.el-picker-panel,.el-date-picker').forEach(x=>{x.style.display='none';x.classList.add('is-hidden')});resolve('ok-date')},200)}); } setFn(t,val); return 'ok'; }
        const _labelChars = [...new Set(label.replace(/[\\s,，、]/g,''))];
        if (_labelChars.length >= 2) {
          for (const item of c.querySelectorAll('.el-form-item')) {
            const lbl = item.querySelector('.el-form-item__label')?.textContent?.trim()||'';
            if (!_labelChars.every(ch=>lbl.includes(ch))) continue;
            const t = item.querySelector('input:not([type="hidden"])')||item.querySelector('textarea');
            if (!t) return 'no-input-found';
            if (t.disabled||t.readOnly) return 'field-disabled';
            if (t.closest('.el-date-editor,.tsscdatepicker')) { t.focus(); setFn(t,val); try{let vm=t.__vue__;if(vm){let p=vm.$parent;if(p&&p.$options&&p.$options.name==='ElDatePicker'){p.value=val;p.$emit('input',val);p.$emit('change',val);p.date=new Date(val);p.$emit('pick',new Date(val));}}}catch(e){} (t.parentNode?.querySelector('input')||t).click(); return new Promise(resolve=>{setTimeout(()=>{const d=new Date(val).getDate();for(const p of document.querySelectorAll('.el-picker-panel')){if(!p.offsetParent||p.style.display==='none')continue;for(const c of p.querySelectorAll('td.available:not(.prev-month):not(.next-month)')){if(parseInt(c.textContent.trim())===d&&!c.disabled){c.click();break}}}document.querySelectorAll('.el-picker-panel,.el-date-picker').forEach(x=>{x.style.display='none';x.classList.add('is-hidden')});resolve('ok-date')},200)}); } setFn(t,val); return 'ok'; }
          }
        for (const inp of c.querySelectorAll('input:not([type="hidden"]),textarea')) {
          if (inp.closest('.el-date-editor,.tsscdatepicker')) continue;
          const ph = inp.getAttribute('placeholder')||'';
          if (ph.includes(label) && !inp.disabled && !inp.readOnly && inp.offsetParent!==null) { setFn(inp,val); return 'ok-placeholder'; }
        }
        let bestScore=0,bestItem=null;
        const _items=c.querySelectorAll('.el-form-item');
        for(var _i=0;_i<_items.length;_i++){const _item=_items[_i],_lbl=_item.querySelector('.el-form-item__label')?.textContent?.trim()||'';if(!_lbl)continue;const _a=[...new Set(label.replace(/[\\s,，、]/g,''))];const _b=[...new Set(_lbl.replace(/[\\s,，、]/g,''))];const _common=_a.filter(ch=>_b.includes(ch)).length;const _score=_common/Math.max(_a.length,_b.length,1);if(_score>bestScore){bestScore=_score;bestItem=_item;}}
        if(bestItem&&bestScore>=0.4){const _t=bestItem.querySelector('input:not([type="hidden"])')||bestItem.querySelector('textarea');if(_t&&!_t.disabled&&!_t.readOnly){setFn(_t,val);return'ok-fuzzy';}}
        return 'label-not-found';
      },
      selectOption: (label, option) => {
        const c = window.CTRL.getContainer();
        for (const item of c.querySelectorAll('.el-form-item')) {
          const lbl = item.querySelector('.el-form-item__label')?.textContent?.trim()||'';
          if (!lbl.includes(label)) continue;
          const trigger = item.querySelector('.el-select .el-input__inner');
          if (!trigger) return 'no-select-found';
          trigger.dispatchEvent(new MouseEvent('mousedown',{bubbles:true}));
          trigger.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));
          trigger.click();
          setTimeout(()=>{
            const opts=document.querySelectorAll('.el-select-dropdown__item');
            const FIRST=['first','1st','第一个','第一项'];
            const t=FIRST.includes(option.toLowerCase().trim())?[...opts].find(it=>it.offsetParent!==null)||opts[0]:[...opts].find(it=>it.textContent.trim()===option)||[...opts].find(it=>it.textContent.trim().includes(option));
            if(t){t.scrollIntoView({block:'nearest'});t.dispatchEvent(new MouseEvent('mousedown',{bubbles:true}));t.click();}
          },600);
          return 'triggered';
        }
        return 'label-not-found';
      },
      selectDate: (label, dateStr) => {
        const c=window.CTRL.getContainer();
        for(const item of c.querySelectorAll('.el-form-item')){const lbl=item.querySelector('.el-form-item__label')?.textContent?.trim()||'';if(!lbl.includes(label))continue;const input=item.querySelector('.el-date-editor input,.tsscdatepicker input');if(!input)continue;const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;setter.call(input,dateStr);input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));input.dispatchEvent(new Event('blur',{bubbles:true}));input.blur();try{let vm=input.__vue__;if(vm){let p=vm.$parent;if(p&&p.$options&&p.$options.name==='ElDatePicker'){p.value=dateStr;p.$emit('input',dateStr);p.$emit('change',dateStr);p.$emit('pick',new Date(dateStr));}}}catch(e){}document.querySelectorAll('.el-picker-panel,.el-date-picker').forEach(x=>{x.style.display='none';x.classList.add('is-hidden')});return'selected';}
        return'label-not-found';
      },
      clickMenuItem: (text) => {
        for(const item of[...document.querySelectorAll('.el-menu-item')].filter(i=>i.textContent.trim()===text&&i.offsetParent)){item.click();return'ok';}
        for(const sm of document.querySelectorAll('.el-submenu')){const title=sm.querySelector('.el-submenu__title');if(title)title.click();for(const si of sm.querySelectorAll('.el-menu-item')){if(si.textContent.trim()===text){setTimeout(()=>si.click(),300);return'ok-expanded';}}}
        return'not-found';
      },
      fillAddressFields: (addr) => {
        let count=0;const items=window.CTRL.getContainer().querySelectorAll('.el-form-item');for(const item of items){const lbl=item.querySelector('.el-form-item__label')?.textContent?.trim()||'';if(!lbl.includes('地址'))continue;const t=item.querySelector('input:not([type="hidden"]):not([disabled]):not([readOnly]),textarea:not([disabled]):not([readOnly])');if(!t)continue;const TagProto=t.tagName==='TEXTAREA'?HTMLTextAreaElement:HTMLInputElement;const setter=Object.getOwnPropertyDescriptor(TagProto.prototype,'value').set;setter.call(t,addr);t.setAttribute('value',addr);t.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:addr}));t.dispatchEvent(new Event('change',{bubbles:true}));t.dispatchEvent(new Event('blur',{bubbles:true}));count++;}
        return count>0?'ok:'+count:'no-address-fields';
      },
      clickTableRowAction: (rowText, btnText) => {
        for(const row of document.querySelectorAll('.el-table__body-wrapper .el-table__row')){if(!row.textContent.includes(rowText))continue;for(const btn of row.querySelectorAll('button,.el-button,i[class*="icon"]')){const t=btn.textContent?.trim()||'',c=btn.className||'';if(t.includes(btnText)||c.includes(btnText.toLowerCase())){if(btn.offsetParent){btn.click();return'ok';}}}if(btnText==='edit'||btnText==='编辑'){const ic=row.querySelector('i.el-icon-edit,i[class*="bianji"],i[class*="edit"],i[class*="xiugai"]');if(ic&&ic.offsetParent){ic.click();return'ok-icon';}}if(btnText==='delete'||btnText==='删除'){const ic=row.querySelector('i.el-icon-delete,i[class*="shanchu"],i[class*="delete"]');if(ic&&ic.offsetParent){ic.click();return'ok-icon';}}return'button-not-found';}
        return'row-not-found';
      },
      clickRadio: (label, option) => {
        const c=window.CTRL.getContainer();for(const item of c.querySelectorAll('.el-form-item')){const lbl=item.querySelector('.el-form-item__label')?.textContent?.trim()||'';if(!lbl.includes(label))continue;for(const radio of item.querySelectorAll('.el-radio')){if(radio.textContent.trim()===option&&radio.offsetParent){radio.click();return'ok';}}return'option-not-found';}
        return'label-not-found';
      },
      clickAdjacentButton: (label) => {
        const c=window.CTRL.getContainer();for(const item of c.querySelectorAll('.el-form-item')){const lbl=item.querySelector('.el-form-item__label')?.textContent?.trim()||'';if(!lbl.includes(label))continue;const inp=item.querySelector('.el-input__inner');if(inp&&inp.value&&inp.value.trim()!=='')return'already-filled';const btn=item.querySelector('button.el-button--primary.is-plain');if(btn&&btn.offsetParent){btn.click();return'clicked';}return'no-button-found';}
        return'label-not-found';
      },
      closeDialog: () => {
        for(const d of[...document.querySelectorAll('.el-dialog')].reverse()){if(d.offsetParent){const cb=d.querySelector('.el-dialog__headerbtn .el-icon-close');if(cb){cb.click();return'ok';}return'no-close-button';}}
        return'no-overlay-open';
      },
      switchTab: (name) => {
        for(const tab of document.querySelectorAll('.el-tabs__item')){if(tab.textContent.trim()===name&&tab.offsetParent){tab.click();return'ok';}}
        return'tab-not-found';
      },
      waitForLoading: () => new Promise(resolve=>{let el=0;const ck=()=>{if(el>=30000){resolve('timeout');return;}const m=document.querySelector('.el-loading-mask:not(.el-loading-mask--hidden)');if(!m||m.offsetParent===null)resolve();else{el+=200;setTimeout(ck,200);}};ck();}),
      checkFieldValue: (label) => {
        const c=window.CTRL.getContainer();for(const item of c.querySelectorAll('.el-form-item')){const lbl=item.querySelector('.el-form-item__label')?.textContent?.trim()||'';if(!lbl.includes(label))continue;const inp=item.querySelector('input:not([type="hidden"])')||item.querySelector('textarea');return inp?.value||'empty';}
        return'label-not-found';
      },
      expandAllTreeNodes: () => {let t=0;for(let r=0;r<10;r++){const n=document.querySelectorAll('.el-tree-node:not(.is-expanded)');if(n.length===0)break;n.forEach(node=>{const i=node.querySelector(':scope>.el-tree-node__content>.el-tree-node__expand-icon');if(i){i.click();t++;}});}return t;},
      verifyFormStructure: (expectedFields) => {
        const container = window.CTRL.getContainer();
        const items = container.querySelectorAll('.el-form-item');
        const actualLabels = [];
        for (const item of items) {
          const lbl = item.querySelector('.el-form-item__label');
          if (lbl) actualLabels.push(lbl.textContent.trim());
        }
        const expectedLabels = expectedFields.map(f => f.label);
        const requiredLabels = expectedFields.filter(f => f.is_required).map(f => f.label);
        const optionalLabels = expectedFields.filter(f => !f.is_required).map(f => f.label);
        const missing_required = requiredLabels.filter(l => !actualLabels.includes(l));
        const missing_optional = optionalLabels.filter(l => !actualLabels.includes(l));
        const added_all = actualLabels.filter(l => !expectedLabels.includes(l));
        const added_required = [];
        const added_optional = [];
        for (const lbl of added_all) {
          let isReq = false;
          for (const item of items) {
            const itemLbl = item.querySelector('.el-form-item__label');
            if (itemLbl && itemLbl.textContent.trim() === lbl) {
              isReq = !!(item.matches('.is-required') || item.querySelector('.is-required, .el-form-item__label .el-form-item__label--required') || /\\*/.test(lbl));
              break;
            }
          }
          if (isReq) added_required.push(lbl);
          else added_optional.push(lbl);
        }
        // P2: required fields changed → form error (triggers self-heal)
        const hasRequiredChange = missing_required.length > 0 || added_required.length > 0;
        // P3: optional fields changed → form warning (continue)
        const hasOptionalChange = missing_optional.length > 0 || added_optional.length > 0;
        // P4: field order changed → form warning (continue)
        let reordered = false;
        if (!hasRequiredChange && !hasOptionalChange && actualLabels.length === expectedLabels.length) {
          for (let i = 0; i < expectedLabels.length; i++) {
            if (expectedLabels[i] !== actualLabels[i]) { reordered = true; break; }
          }
        }
        return JSON.stringify({ ok: !hasRequiredChange, count: actualLabels.length, expected_count: expectedLabels.length, required_count: requiredLabels.length, optional_count: optionalLabels.length, missing_required, missing_optional, added_required, added_optional, hasRequiredChange, hasOptionalChange, reordered, fields: actualLabels });
      },
    };
  });

  const page = await context.newPage();

  try {
'''

CTRL_FOOTER = '''  } catch (err) {
    console.error('FATAL:', err.message);
    _recordError(0, 'fatal', '', '', err.message, 'Script-level crash');
  } finally {
    // Write error report
    if (_errors.length > 0) {
      const reportPath = require('path').join(_TMP, 'script-errors.json');
      try { fs.writeFileSync(reportPath, JSON.stringify(_errors, null, 2)); } catch {}
      const errCount = _errors.filter(e => e.severity !== 'warning').length;
      const warnCount = _errors.filter(e => e.severity === 'warning').length;
      var summary = '=====';
      if (errCount > 0) summary += ' ' + errCount + ' ERROR(S)';
      if (warnCount > 0) summary += (errCount > 0 ? ', ' : ' ') + warnCount + ' WARNING(S)';
      summary += ' =====';
      console.error(summary);
      _errors.forEach((e, i) => {
        var tag = e.severity === 'warning' ? 'WARN' : 'ERROR';
        console.error('[' + (i+1) + '] ' + tag + ' Step ' + e.step + ': ' + e.action + ' - ' + e.error + (e.details ? ' | ' + e.details : ''));
      });
      process.exit(errCount > 0 ? 1 : 0);
    } else {
      console.log('===== SUCCESS =====');
    }
    console.log('Waiting 30s before closing browser...');
    await page.waitForTimeout(30000);
    await browser.close();
  }
})().catch(err => { console.error(err); process.exit(1); });
'''

# Footer for partial replay: keeps browser open, prints CDP endpoint for agent hand-off
PARTIAL_CTRL_FOOTER = '''  } catch (err) {
    console.error('FATAL:', err.message);
    _recordError(0, 'fatal', '', '', err.message, 'Script-level crash');
  } finally {
    if (_errors.length > 0) {
      const reportPath = require('path').join(_TMP, 'script-errors.json');
      try { fs.writeFileSync(reportPath, JSON.stringify(_errors, null, 2)); } catch {}
      const errCount = _errors.filter(e => e.severity !== 'warning').length;
      const warnCount = _errors.filter(e => e.severity === 'warning').length;
      var summary = '=====';
      if (errCount > 0) summary += ' ' + errCount + ' ERROR(S)';
      if (warnCount > 0) summary += (errCount > 0 ? ', ' : ' ') + warnCount + ' WARNING(S)';
      summary += ' =====';
      console.error(summary);
      _errors.forEach((e, i) => {
        var tag = e.severity === 'warning' ? 'WARN' : 'ERROR';
        console.error('[' + (i+1) + '] ' + tag + ' Step ' + e.step + ': ' + e.action + ' - ' + e.error + (e.details ? ' | ' + e.details : ''));
      });
    } else {
      console.log('===== PARTIAL REPLAY OK =====');
    }
    console.log('CDP_PORT:' + _CDP_PORT);
    console.log('READY_FOR_AGENT: browser stays open');
  }
})().catch(err => { console.error(err); process.exit(1); });
'''


# ========================== Identity Field Detection ==========================

# Keywords that indicate a field value should be dynamically generated each run
_IDENTITY_KEYWORDS = [
    ('genCreditCode', ['证件号码', '统一社会信用代码', '信用代码', '营业执照', '营业执照号']),
    ('genValidIdCard', ['身份证', '身份证号', '居民身份证']),
    ('genMobile', ['手机', '电话', '联系方式', '联系电话', '电话号码']),
    ('genEmail', ['邮箱', 'Email', '电子邮箱']),
    ('genBankCard', ['银行卡', '银行卡号', '银行账号']),
    ('genName', ['姓名', '联系人']),
    ('genAmount', ['金额', '价格', '费用', '工资', '收入']),
    ('genAddress', ['地址', '详细地址', '联系地址']),
]

# Labels that should NEVER trigger identity generation (login, system fields)
_IDENTITY_EXCLUDE = ['用户名', '密码', '登录', '验证码', '图形', '短信', '验证', 'captcha']

def _is_identity_field(label):
    """Check if a label matches identity-type fields that need unique values."""
    if not label:
        return None
    t = re.sub(r'\s+', '', label)
    # Exclude login/system fields
    for excl in _IDENTITY_EXCLUDE:
        if excl in t:
            return None
    for gen_fn, keywords in _IDENTITY_KEYWORDS:
        for kw in keywords:
            if kw in t:
                return gen_fn
    return None


# ========================== Action-to-Code Mapping ==========================

def _escape(s):
    """Escape single quotes for JS strings."""
    return s.replace('\\', '\\\\').replace("'", "\\'") if s else ''


def _escape_js_string(s):
    """Escape a string for use inside a JS template literal or string."""
    if not s:
        return ''
    return s.replace('\\', '\\\\').replace("'", "\\'").replace('\n', '\\n')


FILL_RETRY_ACTIONS = {'fill_form_field', 'fill_date_field'}

def _generate_action_code(entry, step_num, url, is_first_fill=False):
    """Generate Playwright JS code from a recorded action entry.

    Accepts either a dict (legacy) or an ActionEntry model instance.
    """
    # Normalize to dict for backward compat with existing dict-access code
    if isinstance(entry, ActionEntry):
        _e = entry.model_dump()
    elif isinstance(entry, dict):
        _e = entry
    else:
        _e = {}
    action = _e.get('action', '')
    params = _e.get('params', {}) or {}

    def pre():
        return "    await page.evaluate(() => CTRL.waitForLoading());"

    def pre_ready():
        return "    await page.waitForSelector('.el-form-item', { timeout: 10000 }).catch(() => {});"

    lines = [f'    // [{step_num}] {action}']

    def p(k, default=''):
        v = params.get(k, default)
        return str(v) if v else default

    # ---- go_to_url (handled in header) ----
    if action == 'go_to_url':
        return ''

    # ---- login (expand into fill + click) ----
    if action == 'login':
        u, pw = p('username') or '', p('password') or ''
        cp = p('captcha') or ''
        sm = p('sms_code') or ''
        lines.append(f"    console.log('[{step_num}] Login: fill username + password');")
        lines.append(f"    await page.evaluate((v) => CTRL.fillFormField('用户名', v), '{_escape(u)}');")
        lines.append(f"    await page.evaluate((v) => CTRL.fillFormField('密码', v), '{_escape(pw)}');")
        if cp:
            lines.append(f"    await page.evaluate((v) => CTRL.fillFormField('验证码', v), '{_escape(cp)}');")
        if sm:
            lines.append(f"    await page.evaluate((v) => CTRL.fillFormField('短信验证码', v), '{_escape(sm)}');")
        lines.append(f"    await page.evaluate(() => {{")
        lines.append(f"      for (const btn of document.querySelectorAll('button')) {{")
        lines.append(f"        if (['登录','登錄','Login'].includes(btn.textContent.trim().replace(/\\\\s/g,'')) && btn.offsetParent && !btn.disabled) {{ btn.click(); break; }}")
        lines.append(f"      }}")
        lines.append(f"    }});")
        lines.append(f"    await page.waitForTimeout(3000);")
        return ''

    # ---- fill_form_field ----
    if action == 'fill_form_field':
        l, v = p('label_text'), p('value')
        id_fn = _is_identity_field(l)

        lines.append(f"    console.log('[{step_num}] Fill \"{l}\"');")
        lines.append(pre())
        lines.append(pre_ready())

        # Identity field: generate dynamic value
        if id_fn and v:
            lines.append(f"    const _v{step_num} = {id_fn}();")
            lines.append(f"    console.log('[{step_num}]   generated unique value:', _v{step_num});")
            val_expr = f"_v{step_num}"
        else:
            val_expr = f"'{_escape(v)}'"

        # Scope fallbacks to visible dialog/drawer (prevent filling fields behind overlays)
        lines.append(f"    // Scope fallback locators to active dialog/drawer")
        lines.append(f"    const _scope{step_num} = await page.evaluate(() => {{")
        lines.append(f"      for (const d of document.querySelectorAll('.el-dialog')) if (d.offsetParent !== null) return '.el-dialog';")
        lines.append(f"      for (const d of document.querySelectorAll('.el-drawer')) if (d.offsetParent !== null) return '.el-drawer';")
        lines.append(f"      return '';")
        lines.append(f"    }});")
        lines.append(f"    const _base{step_num} = _scope{step_num} ? page.locator(_scope{step_num}) : page;")

        # Address fields use fillAddressFields
        if '地址' in l or '址' in l or 'address' in l.lower():
            lines.append(f"    const _r{step_num} = await page.evaluate((addr) => CTRL.fillAddressFields(addr), {val_expr});")
            lines.append(f"    if (_r{step_num} === 'no-address-fields') {{")
            lines.append(f"      console.log('[{step_num}] address fill result:', _r{step_num});")
            lines.append(f"      const _a{step_num} = await _base{step_num}.locator('.el-form-item:has-text(\"地址\")').locator('input, textarea').all();")
            lines.append(f"      for (const _el of _a{step_num}) {{ await _el.fill({val_expr}); }}")
            lines.append(f"    }}")
        else:
            # Tier 1: CTRL.fillFormField
            lines.append(f"    let _r{step_num} = await page.evaluate((v) => CTRL.fillFormField('{_escape(l)}', v), {val_expr});")
            lines.append(f"    console.log('[{step_num}]   CTRL:', _r{step_num});")
            # Build structured details for LLM — tracks per-tier results
            lines.append(f"    let _dt{step_num} = 'CTRL: ' + _r{step_num};")

            # Tier 2: Playwright text-based fallback
            lines.append(f"    if (_r{step_num} !== 'ok' && _r{step_num} !== 'ok-date' && _r{step_num} !== 'ok-placeholder' && _r{step_num} !== 'ok-fuzzy') {{")
            lines.append(f"      console.log('[{step_num}]   falling back to Playwright text...');")
            lines.append(f"      try {{")
            lines.append(f"        const _fb{step_num} = _base{step_num}.locator('.el-form-item').filter({{ hasText: '{_escape_js_string(l)}' }}).locator('input:not([type=\"hidden\"]), textarea').first();")
            lines.append(f"        await _fb{step_num}.fill({val_expr}, {{ timeout: 3000 }});")
            lines.append(f"        _r{step_num} = 'ok-playwright';")
            lines.append(f"        console.log('[{step_num}]   Playwright text OK');")
            lines.append(f"      }} catch (_e_fb{step_num}) {{")
            lines.append(f"        console.log('[{step_num}]   Playwright fallback failed:', _e_fb{step_num}.message);")
            lines.append(f"        _dt{step_num} += ' | Playwright hasText: failed';")

            # Tier 3: absolute XPath fallback (page-wide, label-independent)
            abs_xp = _e.get('absoluteTarget', '') or ''
            if abs_xp and not abs_xp.startswith('/') and not abs_xp.startswith('//'):
                abs_xp = '/' + abs_xp

            if abs_xp:
                lines.append(f"        try {{")
                lines.append(f"          const _ax{step_num} = page.locator('xpath={_escape(abs_xp)}').first();")
                lines.append(f"          await _ax{step_num}.fill({val_expr}, {{ timeout: 3000 }});")
                lines.append(f"          _r{step_num} = 'ok-absxpath';")
                lines.append(f"          console.log('[{step_num}]   absolute XPath OK');")
                lines.append(f"        }} catch (_e_ax{step_num}) {{")
                lines.append(f"          console.log('[{step_num}]   absolute XPath fallback failed:', _e_ax{step_num}.message);")
                lines.append(f"          _dt{step_num} += ' | absolute XPath: failed';")
                lines.append(f"        }}")

            # Record error with per-tier structured details
            if abs_xp:
                lines.append(f"        if (_r{step_num} === 'ok-absxpath') {{")
                lines.append(f"          _dt{step_num} += ' | absolute XPath: OK → label_text only — selector still valid';")
                lines.append(f"          // Label mismatch: CTRL + Playwright failed, only XPath saved us. Flag for review.")
                lines.append(f"          _recordError({step_num}, 'fill_form_field', '{_escape_js_string(l)}', String({val_expr}), 'needs-llm-fix', _dt{step_num});")
                lines.append(f"        }} else {{")
                lines.append(f"          _dt{step_num} += ' → page structure changed — re-locate element';")
                lines.append(f"          _recordError({step_num}, 'fill_form_field', '{_escape_js_string(l)}', String({val_expr}), 'needs-llm-fix', _dt{step_num});")
                lines.append(f"        }}")
            else:
                lines.append(f"        _dt{step_num} += ' | absolute XPath: N/A → label_text may need updating and an absolute XPath may need updating';")
                lines.append(f"        _recordError({step_num}, 'fill_form_field', '{_escape_js_string(l)}', String({val_expr}), 'needs-llm-fix', _dt{step_num});")
            lines.append(f"      }}")
            lines.append(f"    }}")

        lines.append('    await page.waitForTimeout(400);')

        # First fill in a new block: retry once
        if is_first_fill:
            lines.append(f'    // Retry "{l}" (first fill in this block may fail on new form)')
            if '地址' in l or '址' in l or 'address' in l.lower():
                lines.append(f"    await page.evaluate((addr) => CTRL.fillAddressFields(addr), {val_expr});")
            else:
                lines.append(f"    await page.evaluate((v) => CTRL.fillFormField('{_escape(l)}', v), {val_expr});")
            lines.append('    await page.waitForTimeout(400);')
        return '\n'.join(lines)

    # ---- select_option ----
    if action == 'select_option':
        l, o = p('label_text'), p('option_text')
        lines.append(f"    console.log('[{step_num}] Select \"{l}\" = \"{o}\"');")
        lines.append(pre())
        lines.append(pre_ready())

        # Tier 1: CTRL.selectOption
        lines.append(f"    let _rs{step_num} = await page.evaluate(() => CTRL.selectOption('{_escape(l)}', '{_escape(o)}'));")
        lines.append(f"    console.log('[{step_num}]   CTRL:', _rs{step_num});")
        lines.append(f"    let _dts{step_num} = 'CTRL: ' + _rs{step_num};")

        # Scope fallback to active dialog/drawer
        lines.append(f"    const _scope{step_num} = await page.evaluate(() => {{")
        lines.append(f"      for (const d of document.querySelectorAll('.el-dialog')) if (d.offsetParent !== null) return '.el-dialog';")
        lines.append(f"      for (const d of document.querySelectorAll('.el-drawer')) if (d.offsetParent !== null) return '.el-drawer';")
        lines.append(f"      return '';")
        lines.append(f"    }});")
        lines.append(f"    const _base{step_num} = _scope{step_num} ? page.locator(_scope{step_num}) : page;")

        # Tier 2: Playwright native fallback
        lines.append(f"    if (_rs{step_num} !== 'triggered' && _rs{step_num} !== 'triggered-placeholder') {{")
        lines.append(f"      console.log('[{step_num}]   falling back to Playwright...');")
        lines.append(f"      // Dismiss any stray dropdown before retrying")
        lines.append(f"      await page.keyboard.press('Escape');")
        lines.append(f"      await page.waitForTimeout(300);")
        lines.append(f"      try {{")
        lines.append(f"        await _base{step_num}.locator('.el-form-item').filter({{ hasText: '{_escape_js_string(l)}' }}).locator('.el-select .el-input__inner').first().click({{ timeout: 3000 }});")
        lines.append(f"        await page.waitForTimeout(400);")
        lines.append(f"        const _opt{step_num} = page.locator('.el-select-dropdown__item').filter({{ hasText: '{_escape_js_string(o)}' }}).first();")
        lines.append(f"        await _opt{step_num}.click({{ timeout: 3000 }});")
        lines.append(f"        _rs{step_num} = 'ok-playwright';")
        lines.append(f"        console.log('[{step_num}]   Playwright fallback OK');")
        lines.append(f"      }} catch (_e_s{step_num}) {{")
        lines.append(f"        console.log('[{step_num}]   Playwright fallback failed:', _e_s{step_num}.message);")
        lines.append(f"        _dts{step_num} += ' | Playwright native: failed';")

        # Tier 3: absolute XPath fallback (click trigger by structural path)
        abs_xp = _e.get('absoluteTarget', '') or ''
        if abs_xp and not abs_xp.startswith('/') and not abs_xp.startswith('//'):
            abs_xp = '/' + abs_xp

        if abs_xp:
            lines.append(f"        try {{")
            lines.append(f"          await page.locator('xpath={_escape(abs_xp)}').first().click({{ timeout: 3000 }});")
            lines.append(f"          await page.waitForTimeout(600);")
            lines.append(f"          const _axo{step_num} = page.locator('.el-select-dropdown__item').filter({{ hasText: '{_escape_js_string(o)}' }}).first();")
            lines.append(f"          await _axo{step_num}.click({{ timeout: 3000 }});")
            lines.append(f"          _rs{step_num} = 'ok-absxpath';")
            lines.append(f"          console.log('[{step_num}]   absolute XPath OK');")
            lines.append(f"        }} catch (_e_axs{step_num}) {{")
            lines.append(f"          console.log('[{step_num}]   absolute XPath fallback failed:', _e_axs{step_num}.message);")
            lines.append(f"          _dts{step_num} += ' | absolute XPath: failed';")
            lines.append(f"        }}")

        # Record error with per-tier structured details
        if abs_xp:
            lines.append(f"        if (_rs{step_num} === 'ok-absxpath') {{")
            lines.append(f"          _dts{step_num} += ' | absolute XPath: OK → label_text/option_text only — selector still valid';")
            lines.append(f"          _recordError({step_num}, 'select_option', '{_escape_js_string(l)}', '{_escape_js_string(o)}', 'needs-llm-fix', _dts{step_num});")
            lines.append(f"        }} else {{")
            lines.append(f"          _dts{step_num} += ' → page structure changed — re-locate element';")
            lines.append(f"          _recordError({step_num}, 'select_option', '{_escape_js_string(l)}', '{_escape_js_string(o)}', 'needs-llm-fix', _dts{step_num});")
            lines.append(f"        }}")
        else:
            lines.append(f"        _dts{step_num} += ' | absolute XPath: N/A → label_text/option_text may need updating and an absolute XPath may need updating';")
            lines.append(f"        _recordError({step_num}, 'select_option', '{_escape_js_string(l)}', '{_escape_js_string(o)}', 'needs-llm-fix', _dts{step_num});")

        lines.append(f"      }}")   # close Playwright catch

        lines.append(f"    }}")

        lines.append('    await page.waitForTimeout(400);')
        return '\n'.join(lines)

    # ---- fill_date_field ----
    if action == 'fill_date_field':
        l, v = p('label_text'), p('value')
        lines.append(f"    console.log('[{step_num}] Set date \"{l}\" = \"{v}\"');")
        lines.append(pre())
        lines.append(f"    await page.evaluate(() => CTRL.selectDate('{_escape(l)}', '{_escape(v)}'));")
        lines.append('    await page.waitForTimeout(400);')
        if is_first_fill:
            lines.append(f'    // Retry "{l}" (first fill in this block may fail on new form)')
            lines.append(f"    await page.evaluate(() => CTRL.selectDate('{_escape(l)}', '{_escape(v)}'));")
            lines.append('    await page.waitForTimeout(400);')
        return '\n'.join(lines)

    # ---- click_menu_item ----
    if action == 'click_menu_item':
        t = p('menu_text')
        lines.append(f"    console.log('[{step_num}] Menu \"{t}\"');")
        lines.append(pre())
        lines.append(pre_ready())
        lines.append(f"    const _rm{step_num} = await page.evaluate(() => CTRL.clickMenuItem('{_escape(t)}'));")
        lines.append(f"    if (_rm{step_num} === 'not-found') _recordError({step_num}, 'click_menu_item', '{_escape_js_string(t)}', '', 'not-found', 'Menu item not visible or not found');")
        lines.append('    await page.waitForTimeout(400);')
        lines.append("    await page.evaluate(() => CTRL.waitForLoading());")
        return '\n'.join(lines)

    # ---- click_table_row_action ----
    if action == 'click_table_row_action':
        r, b = p('row_text'), p('button_text')
        lines.append(f"    console.log('[{step_num}] Table action \"{r}\" / \"{b}\"');")
        lines.append(pre())
        lines.append(pre_ready())
        lines.append(f"    const _rt{step_num} = await page.evaluate(() => CTRL.clickTableRowAction('{_escape(r)}', '{_escape(b)}'));")
        lines.append(f"    if (_rt{step_num} !== 'ok' && _rt{step_num} !== 'ok-icon') _recordError({step_num}, 'click_table_row_action', '{_escape_js_string(r)}', '{_escape_js_string(b)}', _rt{step_num}, 'Row or button not found');")
        lines.append('    await page.waitForTimeout(400);')
        return '\n'.join(lines)

    # ---- click_adjacent_button ----
    if action == 'click_adjacent_button':
        l = p('label_text')
        lines.append(f"    console.log('[{step_num}] Adjacent button \"{l}\"');")
        lines.append(pre())
        lines.append(f"    await page.evaluate(() => CTRL.clickAdjacentButton('{_escape(l)}'));")
        lines.append('    await page.evaluate(() => CTRL.waitForLoading());')
        lines.append('    await page.waitForTimeout(400);')
        return '\n'.join(lines)

    # ---- click_radio ----
    if action == 'click_radio':
        l, o = p('label_text'), p('option_text')
        lines.append(f"    console.log('[{step_num}] Radio \"{l}\" = \"{o}\"');")
        lines.append(pre())
        lines.append(f"    const _rr{step_num} = await page.evaluate(() => CTRL.clickRadio('{_escape(l)}', '{_escape(o)}'));")
        lines.append(f"    if (_rr{step_num} !== 'ok') _recordError({step_num}, 'click_radio', '{_escape_js_string(l)}', '{_escape_js_string(o)}', _rr{step_num}, '');")
        lines.append('    await page.waitForTimeout(400);')
        return '\n'.join(lines)

    # ---- select_tree_option ----
    if action == 'select_tree_option':
        l, o = p('label_text'), p('option_text')
        lines.append(f"    console.log('[{step_num}] Tree-select \"{l}\" = \"{o}\"');")
        lines.append(pre())
        lines.append(pre_ready())
        lines.append(f"    const _rt{step_num} = await page.evaluate(() => CTRL.selectTreeOption('{_escape(l)}', '{_escape(o)}'));")
        lines.append(f"    console.log('[{step_num}]   CTRL:', _rt{step_num});")
        lines.append(f"    if (!_rt{step_num} || _rt{step_num} === 'label-not-found' || _rt{step_num} === 'option-not-found' || _rt{step_num} === 'no-tree-component') {{")
        lines.append(f"      _recordError({step_num}, 'select_tree_option', '{_escape_js_string(l)}', '{_escape_js_string(o)}', _rt{step_num}, '');")
        lines.append(f"    }}")
        return '\n'.join(lines)

    # ---- click_element_by_index ----
    if action == 'click_element_by_index':
        idx = p('index')
        xp = _e.get('target', '') or ''
        txt = p('text', '')
        elem_id = _e.get('attributes', {}).get('id', '') or ''

        if not xp:
            lines.append(f"    console.log('[{step_num}] Click [{idx}] (no XPath)');")
            return '\n'.join(lines)

        if not xp.startswith('/') and not xp.startswith('//'):
            xp = '/' + xp

        lines.append(f"    console.log('[{step_num}] Click [{idx}]');")
        lines.append("    await page.waitForFunction(before => location.href !== before, page.url(), { timeout: 5000 }).catch(() => {});")
        lines.append(pre())
        lines.append(pre_ready())

        # Build degradation chain
        selectors = []
        # Tier 0: ID selector (most stable)
        if elem_id:
            selectors.append(('id', f"page.locator('#{_escape(elem_id)}').first()"))
        # Tier 1: Class-based (stable if unique enough)
        tag = _e.get('tagName', '') or ''
        attrs = _e.get('attributes', {}) or {}
        cls = attrs.get('class', '') or ''
        if cls and tag:
            safe_cls = cls.split(' ')[0].replace('"', '').replace("'", '')
            if safe_cls and len(safe_cls) > 2:
                selectors.append(('class', f"page.locator('{tag}.{safe_cls}').first()"))
        # Tier 2: XPath
        selectors.append(('xpath', f"page.locator('xpath={_escape(xp)}').first()"))
        # Tier 3: Text-based
        if txt:
            selectors.append(('text', f"page.locator(':text-is(\"{_escape(txt)}\")').first()"))
        # Tier 4: JS dispatchEvent
        selectors.append(('js', f"JS: document.evaluate('{_escape(xp)}', document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue"))
        # Tier 5: Fuzzy text match
        if txt:
            selectors.append(('fuzzy', f"JS-fuzzy: text='{_escape(txt)}'"))

        # Generate the degradation chain
        lines.append(f"    let _clicked{step_num} = false;")
        lines.append(f"    let _dt{step_num} = '';")
        for i, (sel_type, sel_expr) in enumerate(selectors):
            if sel_type in ('js', 'fuzzy'):
                # JS-based selectors use page.evaluate
                if sel_type == 'js':
                    lines.append(f"    if (!_clicked{step_num}) {{")
                    lines.append(f"      try {{")
                    lines.append(f"        await page.evaluate((xp) => {{")
                    lines.append(f"          const el = document.evaluate(xp, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;")
                    lines.append(f"          if (el) {{ el.dispatchEvent(new MouseEvent('click', {{ bubbles: true }})); return true; }}")
                    lines.append(f"          return false;")
                    lines.append(f"        }}, '{_escape(xp)}');")
                    lines.append(f"        _clicked{step_num} = true;")
                    lines.append(f"        console.log('[{step_num}]   clicked via JS dispatchEvent');")
                    lines.append(f"      }} catch (_e_js{step_num}) {{ _dt{step_num} += ' | JS: failed'; }}")
                    lines.append(f"    }}")
                elif sel_type == 'fuzzy':
                    lines.append(f"    if (!_clicked{step_num}) {{")
                    lines.append(f"      try {{")
                    lines.append(f"        await page.evaluate((text) => {{")
                    lines.append(f"          const candidates = [...document.querySelectorAll('button, a, span, li, label, .el-button, .el-menu-item')].filter(el => el.offsetParent !== null);")
                    lines.append(f"          let best = null, bestScore = 0;")
                    lines.append(f"          const t = [...new Set(text.replace(/\\s/g,''))];")
                    lines.append(f"          for (const el of candidates) {{")
                    lines.append(f"            const elText = el.textContent?.trim() || '';")
                    lines.append(f"            if (!elText) continue;")
                    lines.append(f"            const e = [...new Set(elText.replace(/\\s/g,''))];")
                    lines.append(f"            const common = t.filter(ch => e.includes(ch)).length;")
                    lines.append(f"            const score = common / Math.max(t.length, e.length, 1);")
                    lines.append(f"            if (score > bestScore) {{ bestScore = score; best = el; }}")
                    lines.append(f"          }}")
                    lines.append(f"          if (best && bestScore >= 0.4) {{ best.click(); return bestScore; }}")
                    lines.append(f"          return 0;")
                    lines.append(f"        }}, '{_escape(txt)}').then(score => {{")
                    lines.append(f"          if (score > 0) {{ _clicked{step_num} = true; console.log('[{step_num}]   clicked via fuzzy (score=' + score.toFixed(2) + ')'); }}")
                    lines.append(f"        }});")
                    lines.append(f"      }} catch (_e_fz{step_num}) {{ _dt{step_num} += ' | fuzzy: failed'; }}")
                    lines.append(f"    }}")
            else:
                lines.append(f"    if (!_clicked{step_num}) {{")
                lines.append(f"      try {{")
                lines.append(f"        await {sel_expr}.click({{ timeout: 3000 }});")
                lines.append(f"        _clicked{step_num} = true;")
                lines.append(f"        console.log('[{step_num}]   clicked via {sel_type}');")
                lines.append(f"      }} catch (_e_{sel_type}{step_num}) {{ console.log('[{step_num}]   {sel_type} failed:', _e_{sel_type}{step_num}.message); _dt{step_num} += ' | {sel_type}: failed'; }}")
                lines.append(f"    }}")

        # If all fail
        lines.append(f"    if (!_clicked{step_num}) {{")
        lines.append(f"      _dt{step_num} += ' → page structure changed — re-locate element';")
        lines.append(f"      _recordError({step_num}, 'click_element_by_index', '{_escape_js_string(txt)}', '{_escape_js_string(xp)}', 'needs-llm-fix', _dt{step_num});")
        lines.append(f"      throw new Error('[{step_num}] Click failed: target element not found on page. Stopping — subsequent steps depend on this navigation.');")
        lines.append(f"    }}")

        # Post-click smart wait: detect navigation, wait for page to stabilize
        lines.append(f"    // Post-click: check for page navigation")
        lines.append(f"    const _urlBefore{step_num} = page.url();")
        lines.append(f"    await page.evaluate(() => CTRL.waitForLoading());")
        lines.append(f"    let _navigated{step_num} = false;")
        lines.append(f"    try {{")
        lines.append(f"      await page.waitForFunction((before) => location.href !== before, _urlBefore{step_num}, {{ timeout: 3000 }});")
        lines.append(f"      _navigated{step_num} = true;")
        lines.append(f"    }} catch (_e_nav{step_num}) {{ /* no URL change — dialog or in-page action */ }}")
        lines.append(f"    if (_navigated{step_num}) {{")
        lines.append(f"      // Page navigated, wait for full load")
        lines.append(f"      await page.waitForLoadState('networkidle', {{ timeout: 15000 }}).catch(() => {{}});")
        lines.append(f"      await page.waitForSelector('.el-menu, .el-table, .el-form-item, .el-tabs, .el-dialog', {{ timeout: 10000 }}).catch(() => {{}});")
        lines.append(f"      await page.evaluate(() => CTRL.waitForLoading());")
        lines.append(f"    }}")
        lines.append('    await page.waitForTimeout(400);')
        return '\n'.join(lines)

    # ---- switch_tab ----
    if action == 'switch_tab':
        n = p('tab_name')
        lines.append(f"    console.log('[{step_num}] Tab \"{n}\"');")
        lines.append(f"    await page.evaluate(() => CTRL.switchTab('{_escape(n)}'));")
        lines.append('    await page.waitForTimeout(500);')
        return '\n'.join(lines)

    # ---- close_dialog ----
    if action == 'close_dialog':
        lines.append(f"    console.log('[{step_num}] Close dialog');")
        lines.append('    await page.evaluate(() => CTRL.closeDialog());')
        lines.append('    await page.waitForTimeout(500);')
        return '\n'.join(lines)

    # ---- wait_for_loading ----
    if action == 'wait_for_loading':
        lines.append('    await page.evaluate(() => CTRL.waitForLoading());')
        return '\n'.join(lines)

    # ---- skip internal/exploratory actions ----
    if action in _SKIP_ACTIONS:
        return ''


    lines.append(f'    // skipped: {action}')
    return '\n'.join(lines)


# ========================== Assembly ==========================

FILL_ACTIONS = {'fill_form_field', 'fill_date_field', 'select_option', 'click_radio', 'select_tree_option'}
BOUNDARY_ACTIONS = {'click_element_by_index', 'click_menu_item', 'switch_tab', 'close_dialog', 'go_to_url'}

def assemble_script(action_entries, target_url=None, form_snapshots=None):
    """Assemble a complete Playwright script from recorded action entries.
    form_snapshots: list of {container, fields, action_index} — one per scanned container.
    """
    body = []
    step = 1
    in_block = False

    url = target_url or ''
    if not url or 'unknown' in url.lower():
        url = 'http://target-url-placeholder'
    body.append(f'    await page.goto(\'{url}\', {{ waitUntil: \'networkidle\', timeout: 60000 }});')
    body.append("    await page.evaluate(() => CTRL.waitForLoading());")

    # Sort snapshots by action_index so checks inject at the right points
    # Normalize to FormSnapshot if raw dicts
    _raw_checks = form_snapshots or []
    _norm_checks = [FormSnapshot(**s) if isinstance(s, dict) else s for s in _raw_checks]
    pending_checks = sorted(_norm_checks, key=lambda s: s.action_index)
    action_counter = 0  # counts through ALL entries to find injection point
    _check_idx = [0]  # mutable counter for unique variable names

    def _inject_form_check(fields, container, action_index):
        """Inject a verifyFormStructure call for one container."""
        nonlocal step
        idx = _check_idx[0]
        _check_idx[0] += 1
        fields_json = json.dumps(fields, ensure_ascii=False)
        container_label = container or 'main'
        v = f'__fc{idx}'  # unique variable name per check
        body.append(f'    console.log("[FORM-CHECK] Verifying container: {container_label}");')
        body.append(f'    const {v} = await page.evaluate((f) => JSON.parse(CTRL.verifyFormStructure(f)), {fields_json});')
        # P2: required field change → error, stop script
        body.append(f'    if ({v}.hasRequiredChange) {{')
        body.append(f'      const _m = {v}.missing_required.join(",");')
        body.append(f'      const _a = {v}.added_required.join(",");')
        body.append(f'      _recordError({step}, "form_structure_changed", "", "", "missing=[" + _m + "] added=[" + _a + "]", JSON.stringify({{')
        body.append(f'        container: "{container_label}",')
        body.append(f'        missing_required: {v}.missing_required,')
        body.append(f'        added_required: {v}.added_required,')
        body.append(f'        missing_optional: {v}.missing_optional,')
        body.append(f'        added_optional: {v}.added_optional,')
        body.append(f'        expected_required: {v}.required_count,')
        body.append(f'        expected_optional: {v}.optional_count,')
        body.append(f'        action_index: {action_index or 0}')
        body.append(f'      }}));')
        body.append(f'      throw new Error("Form required fields changed: missing=[" + _m + "] added=[" + _a + "]");')
        body.append(f'    }}')
        # P3: optional field change → warning, continue
        body.append(f'    if ({v}.hasOptionalChange) {{')
        body.append(f'      _recordError({step}, "form_warning", "", "", "optional fields changed", JSON.stringify({{')
        body.append(f'        container: "{container_label}",')
        body.append(f'        missing_optional: {v}.missing_optional,')
        body.append(f'        added_optional: {v}.added_optional,')
        body.append(f'      }}), "warning");')
        body.append(f'      console.log("[FORM-CHECK P3] WARN: Optional fields changed | missing:", JSON.stringify({v}.missing_optional), "| added:", JSON.stringify({v}.added_optional));')
        body.append(f'    }}')
        # P4: field order change → warning, continue
        body.append(f'    if ({v}.reordered && !{v}.hasRequiredChange && !{v}.hasOptionalChange) {{')
        body.append(f'      _recordError({step}, "form_warning", "", "", "field order changed", JSON.stringify({{')
        body.append(f'        container: "{container_label}",')
        body.append(f'        reordered: true,')
        body.append(f'      }}), "warning");')
        body.append(f'      console.log("[FORM-CHECK P4] WARN: Field order changed, all fields present");')
        body.append(f'    }}')
        body.append(f'    console.log("[FORM-CHECK] Verification passed for container: {container_label}");')

    for entry in action_entries:
        # Normalize entry to dict
        _e = entry.model_dump() if isinstance(entry, ActionEntry) else (entry if isinstance(entry, dict) else {})
        action = _e.get('action', '')
        action_counter += 1

        if action in _SKIP_ACTIONS:
            continue

        if action in BOUNDARY_ACTIONS:
            in_block = False

        is_first_fill = action in FILL_ACTIONS and not in_block
        if is_first_fill:
            # Inject any pending form checks whose action_index has been passed
            while pending_checks and action_counter > pending_checks[0].action_index:
                check = pending_checks.pop(0)
                _inject_form_check(
                    [f.model_dump() for f in check.fields],
                    check.container,
                    check.action_index,
                )
            in_block = True

        code = _generate_action_code(entry, step, url, is_first_fill)
        if code:
            body.append(code)
            step += 1

    return CTRL_API_CODE + '\n'.join(body) + '\n\n' + CTRL_FOOTER


# ========================== Part 2: Partial assembly (for self-healing) ==========================

def assemble_partial_script(action_entries, target_url=None, stop_before_step=None):
    """Assemble script up to (but not including) the specified step number.
    Used to reproduce error state for self-healing diagnostics."""
    if stop_before_step is None:
        return assemble_script(action_entries, target_url)

    # Only include entries before the failing step
    partial_entries = action_entries[:stop_before_step - 1] if stop_before_step > 1 else []
    body = []
    step = 1
    in_block = False

    url = target_url or ''
    if not url or 'unknown' in url.lower():
        url = 'http://target-url-placeholder'
    body.append(f'    await page.goto(\'{url}\', {{ waitUntil: \'networkidle\', timeout: 60000 }});')
    body.append("    await page.evaluate(() => CTRL.waitForLoading());")

    for entry in partial_entries:
        _e = entry.model_dump() if isinstance(entry, ActionEntry) else (entry if isinstance(entry, dict) else {})
        action = _e.get('action', '')
        if action in _SKIP_ACTIONS:
            continue

        if action in BOUNDARY_ACTIONS:
            in_block = False

        is_first_fill = action in FILL_ACTIONS and not in_block
        if is_first_fill:
            in_block = True

        code = _generate_action_code(entry, step, url, is_first_fill)
        if code:
            body.append(code)
            step += 1

    return CTRL_API_CODE + '\n'.join(body) + '\n\n' + CTRL_FOOTER


def assemble_partial_for_cdp(action_entries, target_url=None, stop_before_step=None):
    """Like assemble_partial_script, but keeps browser open with CDP for agent hand-off."""
    if stop_before_step is None:
        return assemble_script(action_entries, target_url)
    partial_entries = action_entries[:stop_before_step - 1] if stop_before_step > 1 else []
    body = []
    step = 1
    in_block = False
    url = target_url or ''
    if not url or 'unknown' in url.lower():
        url = 'http://target-url-placeholder'
    body.append(f'    await page.goto(\'{url}\', {{ waitUntil: \'networkidle\', timeout: 60000 }});')
    body.append("    await page.evaluate(() => CTRL.waitForLoading());")
    for entry in partial_entries:
        _e = entry.model_dump() if isinstance(entry, ActionEntry) else (entry if isinstance(entry, dict) else {})
        action = _e.get('action', '')
        if action in _SKIP_ACTIONS:
            continue
        if action in BOUNDARY_ACTIONS:
            in_block = False
        is_first_fill = action in FILL_ACTIONS and not in_block
        if is_first_fill:
            in_block = True
        code = _generate_action_code(entry, step, url, is_first_fill)
        if code:
            body.append(code)
            step += 1
    return CTRL_API_CODE + '\n'.join(body) + '\n\n' + PARTIAL_CTRL_FOOTER


def apply_changes(commands, changes):
    """Apply LLM-recommended changes to the commands array.

    Args:
        commands: List of action entry dicts
        changes: List of {step: int, action: 'modify'|'delete'|'insert', entry: dict?}

    Returns:
        Modified commands list
    """
    cmds = list(commands)  # shallow copy
    # Sort in reverse step order so indices don't shift when applying
    for change in sorted(changes, key=lambda c: c['step'], reverse=True):
        step_num = change['step']
        action = change.get('action', 'modify')
        idx = step_num - 1  # convert to 0-based index

        if action == 'modify':
            if 0 <= idx < len(cmds):
                cmds[idx] = change.get('entry', cmds[idx])
        elif action == 'delete':
            if 0 <= idx < len(cmds):
                del cmds[idx]
        elif action == 'insert':
            entry = change.get('entry')
            if entry:
                cmds.insert(min(idx, len(cmds)), entry)
    return cmds


# ========================== Main ==========================

def main():
    if len(sys.argv) < 2:
        print('Usage: python script_assembler.py <action_file.json> [output.js] [--partial-stop N] [--partial-cdp N]', file=sys.stderr)
        sys.exit(1)

    input_path = sys.argv[1]
    output_path = None
    stop_before_step = None
    cdp_mode = False
    form_snapshot_path = None

    # Parse remaining args
    remaining = sys.argv[2:]
    while remaining:
        arg = remaining.pop(0)
        if arg == '--partial-stop' and remaining:
            stop_before_step = int(remaining.pop(0))
        elif arg == '--partial-cdp' and remaining:
            stop_before_step = int(remaining.pop(0))
            cdp_mode = True
        elif arg == '--form-snapshot' and remaining:
            form_snapshot_path = remaining.pop(0)
        elif not output_path:
            output_path = arg

    if input_path == '-':
        data = json.load(sys.stdin)
    else:
        with open(input_path, 'r', encoding='utf-8') as f:
            data = json.load(f)

    # Read commands from either format
    raw_cmds = data.get('actions', []) or (data.get('tests', [{}])[0].get('commands', []) if data.get('tests') else [])
    has_new = raw_cmds and any(c.get('action') for c in raw_cmds if isinstance(c, dict))
    if not has_new:
        actions = []
        for cmd in raw_cmds:
            c = cmd.get('command', '')
            if c == 'input':
                actions.append({'action': 'fill_form_field', 'params': {'label_text': cmd.get('propertiesName', ''), 'value': cmd.get('value', '')},
                    'target': cmd.get('target', ''), 'tagName': cmd.get('tagName', ''), 'attributes': cmd.get('attributes', {})})
            elif c == 'select':
                actions.append({'action': 'select_option', 'params': {'label_text': cmd.get('propertiesName', ''), 'option_text': cmd.get('value', '')},
                    'target': cmd.get('target', ''), 'tagName': cmd.get('tagName', ''), 'attributes': cmd.get('attributes', {})})
            elif c == 'click':
                actions.append({'action': 'click_element_by_index', 'params': {'index': cmd.get('value', '0'), 'tag_name': cmd.get('tagName', ''), 'text': cmd.get('propertiesName', '')},
                    'target': cmd.get('target', ''), 'tagName': cmd.get('tagName', ''), 'attributes': cmd.get('attributes', {})})
    else:
        actions = raw_cmds

    # Normalize to ActionEntry model objects
    actions = [
        ActionEntry(**a) if isinstance(a, dict) else a
        for a in (actions if isinstance(actions, list) else [])
    ]

    url = data.get('url', '') or ''
    if not url or 'unknown' in url.lower():
        for entry in actions:
            ae = entry if isinstance(entry, ActionEntry) else ActionEntry(**entry) if isinstance(entry, dict) else None
            if ae and ae.action == 'go_to_url':
                url = ae.params.get('url', '') or ''
                if url:
                    break

    # Read form snapshots array (from --form-snapshot arg, or match by action filename)
    form_snapshots = None
    if form_snapshot_path:
        if os.path.exists(form_snapshot_path):
            with open(form_snapshot_path, 'r', encoding='utf-8') as _f:
                _fs = json.load(_f)
            if isinstance(_fs, list):
                form_snapshots = _fs
    else:
        import re as _re
        _m = _re.search(r'action_(\d{8}_\d{6})\.json', input_path)
        if _m:
            _ts = _m.group(1)
            _form_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'forms', f'form_{_ts}.json')
            if os.path.exists(_form_path):
                with open(_form_path, 'r', encoding='utf-8') as _f:
                    _fs = json.load(_f)
                if isinstance(_fs, list):
                    form_snapshots = _fs

    if stop_before_step is not None:
        if cdp_mode:
            script = assemble_partial_for_cdp(actions, url, stop_before_step)
        else:
            script = assemble_partial_script(actions, url, stop_before_step)
    else:
        script = assemble_script(actions, url, form_snapshots=form_snapshots)

    if output_path:
        with open(output_path, 'w', encoding='utf-8') as f:
            f.write(script)
        print(f'Script written: {output_path}')
        visible_actions = [a for a in actions if (a.action if isinstance(a, ActionEntry) else a.get("action","")) not in _SKIP_ACTIONS]
        print(f'Steps: {len(visible_actions)}')
    else:
        print(script)


if __name__ == '__main__':
    main()
