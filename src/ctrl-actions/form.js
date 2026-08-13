/**
 * CTRL_OBJECT part: getContainer / isFormItemDisabled / fillFormField.
 * Concatenated with sibling parts into CTRL_OBJECT in index.js —
 * do not change indentation, braces, or the trailing comma; the
 * assembled string must stay byte-identical (characterize-ctrl.mjs).
 */
export const CTRL_PART_FORM = `{
  getContainer: () => {
    for (const d of document.querySelectorAll('.el-dialog')) if (d.offsetParent !== null) return d;
    for (const d of document.querySelectorAll('.el-drawer')) if (d.offsetParent !== null) return d;
    return document;
  },
  isFormItemDisabled: (item, inputEl, trigger) => {
    if (trigger && trigger.disabled) return true;
    if (inputEl && inputEl.disabled) return true;
    if (!item) return false;
    const content = item.querySelector('.el-form-item__content') || item;
    if (content.querySelector('.el-input.is-disabled, .el-textarea.is-disabled, .el-select.is-disabled, .el-radio-group.is-disabled, .el-checkbox-group.is-disabled, .el-cascader.is-disabled, .el-date-editor.is-disabled, .el-radio.is-disabled, .el-checkbox.is-disabled')) return true;
    const hosts = content.querySelectorAll('.my-popover, .tree-popover, [class*="tssc"], .el-select, .el-input, .el-cascader, .el-date-editor, .el-radio-group');
    for (const host of hosts) {
      let v = host.__vue__;
      let depth = 0;
      while (v && depth < 10) {
        const n = (v.$options && v.$options.name) ? String(v.$options.name) : '';
        if (n.includes('TsscMultiTree') || n.includes('TsscInput') || n.includes('TsscSelect') || n.includes('TsscDate') || n === 'ElSelect' || n === 'ElInput' || n === 'ElCascader' || n === 'ElDatePicker' || n === 'ElRadioGroup') {
          if (v.disabled === true || (v.$props && v.$props.disabled === true)) return true;
        }
        v = v.$parent;
        depth++;
      }
    }
    return false;
  },
  fillFormField: (label, val) => {
    const c = CTRL.getContainer();
    const setFn = (t, v) => {
      const TagProto = t.tagName === 'TEXTAREA' ? HTMLTextAreaElement : HTMLInputElement;
      const setter = Object.getOwnPropertyDescriptor(TagProto.prototype, 'value').set;
      setter.call(t, v);
      t.setAttribute('value', v);
      t.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:v}));
      t.dispatchEvent(new Event('change',{bubbles:true}));
      t.dispatchEvent(new Event('blur',{bubbles:true}));
    };
    for (const item of c.querySelectorAll('.el-form-item')) {
      const lbl = item.querySelector('.el-form-item__label')?.textContent?.trim() || '';
      if (!lbl.includes(label)) continue;
      item.scrollIntoView({ block: 'center', behavior: 'instant' });
      const t = item.querySelector('input:not([type="hidden"])') || item.querySelector('textarea');
      if (!t) return 'no-input-found';
      if (CTRL.isFormItemDisabled(item, t, item.querySelector('.el-select .el-input__inner'))) return 'field-disabled';
      if (t.readOnly && !item.querySelector('.el-date-editor, .tsscdatepicker, .el-select, .my-popover, .tree-popover, .el-cascader')) return 'field-disabled';
      if (t.closest('.el-date-editor, .tsscdatepicker')) {
        t.focus();
        setFn(t, val);
        try{let w=t.closest('.el-date-editor,.tsscdatepicker');let vm=(w&&w.__vue__)||t.__vue__;let g=0;while(vm&&vm.$options&&g++<12){const n=vm.$options.name||'';if(n==='ElDatePicker'||n==='TsscMultiDatePicker'||/DatePicker/i.test(n)){let out=val;try{const vf=vm.valueFormat||'';if(/H|h|m|s/.test(String(vf))&&/^\d{4}-\d{2}-\d{2}$/.test(String(val)))out=val+' 00:00:00';}catch(e){}vm.value=out;vm.$emit('input',out);vm.$emit('change',out);try{vm.date=new Date(val);}catch(e){}try{vm.$emit('pick',new Date(val));}catch(e){}break;}vm=vm.$parent;}}catch(e){}
        (t.parentNode?.querySelector('input')||t).click();
        return new Promise(resolve => {
          setTimeout(() => {
            const day = new Date(val).getDate();
            for (const panel of document.querySelectorAll('.el-picker-panel')) {
              if (!panel.offsetParent || panel.style.display === 'none') continue;
              for (const td of panel.querySelectorAll('td.available:not(.prev-month):not(.next-month)')) {
                if (parseInt(td.textContent.trim()) === day && !td.disabled) { td.click(); break; }
              }
            }
            document.querySelectorAll('.el-picker-panel,.el-date-picker').forEach(x=>{x.style.display='none';x.classList.add('is-hidden')});
            resolve('ok-date');
          }, 200);
        });
      }
      setFn(t, val);
      return 'ok';
    }
    // Pass 2: character-set match (handles word order variations like 登记注册地址 vs 注册登记地址)
    for (const item of c.querySelectorAll('.el-form-item')) {
      const lbl = item.querySelector('.el-form-item__label')?.textContent?.trim() || '';
      const searchChars = [...new Set(label.replace(/[\s,，、]/g, ''))];
      if (searchChars.length < 2) continue;
      const allCharsMatch = searchChars.every(ch => lbl.includes(ch));
      if (!allCharsMatch) continue;
      item.scrollIntoView({ block: 'center', behavior: 'instant' });
      const t = item.querySelector('input:not([type="hidden"])') || item.querySelector('textarea');
      if (!t) return 'no-input-found';
      if (CTRL.isFormItemDisabled(item, t, item.querySelector('.el-select .el-input__inner'))) return 'field-disabled';
      if (t.readOnly && !item.querySelector('.el-date-editor, .tsscdatepicker, .el-select, .my-popover, .tree-popover, .el-cascader')) return 'field-disabled';
      if (t.closest('.el-date-editor, .tsscdatepicker')) {
        t.focus();
        setFn(t, val);
        try{let w=t.closest('.el-date-editor,.tsscdatepicker');let vm=(w&&w.__vue__)||t.__vue__;let g=0;while(vm&&vm.$options&&g++<12){const n=vm.$options.name||'';if(n==='ElDatePicker'||n==='TsscMultiDatePicker'||/DatePicker/i.test(n)){let out=val;try{const vf=vm.valueFormat||'';if(/H|h|m|s/.test(String(vf))&&/^\d{4}-\d{2}-\d{2}$/.test(String(val)))out=val+' 00:00:00';}catch(e){}vm.value=out;vm.$emit('input',out);vm.$emit('change',out);try{vm.date=new Date(val);}catch(e){}try{vm.$emit('pick',new Date(val));}catch(e){}break;}vm=vm.$parent;}}catch(e){}
        (t.parentNode?.querySelector('input')||t).click();
        return new Promise(resolve => {
          setTimeout(() => {
            const day = new Date(val).getDate();
            for (const panel of document.querySelectorAll('.el-picker-panel')) {
              if (!panel.offsetParent || panel.style.display === 'none') continue;
              for (const td of panel.querySelectorAll('td.available:not(.prev-month):not(.next-month)')) {
                if (parseInt(td.textContent.trim()) === day && !td.disabled) { td.click(); break; }
              }
            }
            document.querySelectorAll('.el-picker-panel,.el-date-picker').forEach(x=>{x.style.display='none';x.classList.add('is-hidden')});
            resolve('ok-date');
          }, 200);
        });
      }
      setFn(t, val);
      return 'ok';
    }
    for (const inp of c.querySelectorAll('input:not([type="hidden"]),textarea')) {
      if (inp.closest('.el-date-editor,.tsscdatepicker')) continue;
      const ph = inp.getAttribute('placeholder') || '';
      if (ph.includes(label) && !inp.disabled && !inp.readOnly && inp.offsetParent !== null) {
        inp.scrollIntoView({ block: 'center', behavior: 'instant' });
        setFn(inp, val);
        return 'ok-placeholder';
      }
    }
    // Pass 4: fuzzy match — pick the label with highest character overlap
    let bestMatch = null, bestScore = 0;
    for (const item of c.querySelectorAll('.el-form-item')) {
      const lbl = item.querySelector('.el-form-item__label')?.textContent?.trim() || '';
      if (!lbl) continue;
      const a = [...new Set(label.replace(/[\s,，、]/g, ''))];
      const b = [...new Set(lbl.replace(/[\s,，、]/g, ''))];
      const common = a.filter(ch => b.includes(ch)).length;
      const score = common / Math.max(a.length, b.length, 1);
      if (score > bestScore) { bestScore = score; bestMatch = item; }
    }
    if (bestMatch && bestScore >= 0.4) {
      bestMatch.scrollIntoView({ block: 'center', behavior: 'instant' });
      const t = bestMatch.querySelector('input:not([type="hidden"])') || bestMatch.querySelector('textarea');
      if (t && !CTRL.isFormItemDisabled(bestMatch, t, bestMatch.querySelector('.el-select .el-input__inner'))) { setFn(t, val); return 'ok-fuzzy'; }
    }
    const _allLbls = [...c.querySelectorAll('.el-form-item')].map(i => i.querySelector('.el-form-item__label')?.textContent?.trim() || '').filter(Boolean);
    if (_allLbls.length > 0) console.log('[fillFormField] Available labels:', JSON.stringify(_allLbls));
    return 'label-not-found';
  },
`;
