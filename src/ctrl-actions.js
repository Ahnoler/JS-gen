/**
 * ctrl-actions.js — Canonical source for window.CTRL (replay / assemble).
 *
 * Legacy: For product replay prefer live `_replay.py`. CTRL remains the
 * engineering injection surface for assemble/test-run and the deprecated
 * `/api/v2/trajectories/:id/replay/*` path. Keep name-level parity with
 * Python cues via `node scripts/characterization/characterize-ctrl.mjs`.
 *
 * `CTRL_OBJECT` + `getInjectionCode()` are the single source of truth for the
 * CTRL.* surface injected into Playwright scripts. Agent-side duplicates live
 * in scripts/actions/_js_snippets.py and inline evaluate in actions/*.py —
 * keep name-level parity via `node scripts/characterization/characterize-ctrl.mjs` (not
 * byte-identical; agent has extra JS beyond CTRL).
 *
 * Consumers:
 *   1. assemble / script_assembler — getInjectionCode() → window.CTRL
 *   2. LLM prompt blocks — CTRL_PROMPT_BLOCK / CTRL_API_TABLE
 */

// ============================================================
// CTRL method body (object literal only). Edit here first; sync Python cues.
// ============================================================
const CTRL_OBJECT = `{
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
        try{let vm=t.__vue__;if(vm){let p=vm.$parent;if(p&&p.$options&&p.$options.name==='ElDatePicker'){p.value=val;p.$emit('input',val);p.$emit('change',val);p.date=new Date(val);p.$emit('pick',new Date(val));}}}catch(e){}
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
        try{let vm=t.__vue__;if(vm){let p=vm.$parent;if(p&&p.$options&&p.$options.name==='ElDatePicker'){p.value=val;p.$emit('input',val);p.$emit('change',val);p.date=new Date(val);p.$emit('pick',new Date(val));}}}catch(e){}
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
  selectOption: (label, option) => {
    const c = CTRL.getContainer();
    for (const item of c.querySelectorAll('.el-form-item')) {
      const lbl = item.querySelector('.el-form-item__label')?.textContent?.trim() || '';
      if (!lbl.includes(label)) continue;
      item.scrollIntoView({ block: 'center', behavior: 'instant' });
      const trigger = item.querySelector('.el-select .el-input__inner');
      if (!trigger) return 'no-select-found';
      if (CTRL.isFormItemDisabled(item, trigger, trigger)) return 'select-disabled';
      trigger.dispatchEvent(new MouseEvent('mousedown',{bubbles:true}));
      trigger.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));
      trigger.click();
      setTimeout(() => {
        const opts = document.querySelectorAll('.el-select-dropdown__item');
        const first = ['first','1st','第一个','第一项'];
        const t = first.includes(option.toLowerCase().trim())
          ? [...opts].find(it => it.offsetParent !== null) || opts[0]
          : [...opts].find(it => it.textContent.trim() === option) || [...opts].find(it => it.textContent.trim().includes(option));
        if (!t) return;
        t.scrollIntoView({block:'nearest'});
        t.dispatchEvent(new MouseEvent('mousedown',{bubbles:true}));
        t.click();
      }, 200);
      return 'ok-triggered';
    }
    // Fallback: match by placeholder (for forms without .el-form-item__label)
    for (const sel of c.querySelectorAll('.el-select .el-input__inner')) {
      const ph = sel.getAttribute('placeholder') || '';
      if (ph.includes(label) && !sel.disabled && sel.offsetParent !== null) {
        sel.scrollIntoView({ block: 'center', behavior: 'instant' });
        sel.dispatchEvent(new MouseEvent('mousedown',{bubbles:true}));
        sel.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));
        sel.click();
        setTimeout(() => {
          const opts = document.querySelectorAll('.el-select-dropdown__item');
          const first = ['first','1st','第一个','第一项'];
          const t = first.includes(option.toLowerCase().trim())
            ? [...opts].find(it => it.offsetParent !== null) || opts[0]
            : [...opts].find(it => it.textContent.trim() === option) || [...opts].find(it => it.textContent.trim().includes(option));
          if (!t) return;
          t.scrollIntoView({block:'nearest'});
          t.dispatchEvent(new MouseEvent('mousedown',{bubbles:true}));
          t.click();
        }, 200);
        return 'ok-triggered-placeholder';
      }
    }
    return 'label-not-found';
  },
  selectDate: (label, dateStr) => {
    const c = CTRL.getContainer();
    for (const item of c.querySelectorAll('.el-form-item')) {
      const lbl = item.querySelector('.el-form-item__label');
      if (!lbl || !lbl.textContent.trim().includes(label)) continue;
      item.scrollIntoView({ block: 'center', behavior: 'instant' });
      const input = item.querySelector('input');
      if (!input) return 'no-input';
      if (input.value === dateStr) return 'ok-already:' + dateStr;
      const editor = item.querySelector('.el-date-editor') || input.closest('.el-date-editor');
      if (!editor) return 'no-editor';
      editor.click();
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;
      setter.call(input, dateStr);
      input.dispatchEvent(new Event('input',{bubbles:true}));
      input.dispatchEvent(new Event('change',{bubbles:true}));
      const p = document.querySelector('.el-picker-panel,.el-date-range-picker');
      if (p && p.offsetParent !== null) document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
      return 'ok-date:' + dateStr;
    }
    return 'label-not-found';
  },
  clickRadio: (label, option) => {
    for (const item of CTRL.getContainer().querySelectorAll('.el-form-item')) {
      if (!(item.querySelector('.el-form-item__label')?.textContent?.trim()||'').includes(label)) continue;
      item.scrollIntoView({ block: 'center', behavior: 'instant' });
      if (CTRL.isFormItemDisabled(item, item.querySelector('input'), null)) return 'disabled';
      for (const r of item.querySelectorAll('.el-radio')) {
        if (r.classList.contains('is-disabled')) continue;
        if (r.textContent.trim()===option && r.offsetParent!==null) { r.click(); return 'ok'; }
      }
      return 'option-not-found';
    }
    return 'label-not-found';
  },
  selectTreeOption: (label, option) => {
    const item = [...CTRL.getContainer().querySelectorAll('.el-form-item')].find(i => (i.querySelector('.el-form-item__label')?.textContent?.trim()||'').includes(label));
    if (!item) return 'label-not-found';
    item.scrollIntoView({ block: 'center', behavior: 'instant' });
    const input = item.querySelector('input');
    if (!input) return 'no-input';
    if (CTRL.isFormItemDisabled(item, input, null)) return 'disabled';
    input.click();
    // Never bare document.querySelector('.el-tree') — page sidebars also use .el-tree
    const isTssc = (v) => !!(v && v.$options && v.$options.name && String(v.$options.name).includes('TsscMultiTree'));
    const walkVueForTssc = (start) => { let v = start; while (v) { if (isTssc(v)) return v; v = v.$parent; } return null; };
    let vm = null;
    for (const host of [item, ...item.querySelectorAll('.my-popover, .tree-popover, [class*="tssc"], .el-select, input')]) {
      if (!host || !host.__vue__) continue;
      vm = walkVueForTssc(host.__vue__);
      if (vm) break;
    }
    if (!vm) {
      for (const tree of document.querySelectorAll('.tree-popover .el-tree, .el-popper[aria-hidden="false"] .el-tree, .el-popover[aria-hidden="false"] .el-tree')) {
        if (!tree.__vue__) continue;
        vm = walkVueForTssc(tree.__vue__);
        if (vm) break;
      }
    }
    if (!vm) return 'no-tree-component | Not TsscMultiTree; use fill_form_field or select_option';
    const td = vm.treeData || [];
    let code = null;
    for (const n of td) { if (n.label===option) { code=n.value||n.id; break; } if (n.label&&n.label.includes(option)&&!code) { code=n.value||n.id; } }
    if (!code) { const w=(ns)=>{for(const n of ns){if(n.label===option)return n.value||n.id;if(n.label&&n.label.includes(option))return n.value||n.id;if(n.children){const r=w(n.children);if(r)return r;}}return null;}; code=w(vm.data||[]); }
    if (code) { vm.$emit('input', code); setTimeout(()=>{if(typeof vm.handleHideClick==='function')vm.handleHideClick();},100); return 'ok:'+option+' ('+code+')'; }
    // P1: search UI fallback
    const pop = document.querySelector('.tree-popover');
    if (!pop) return 'no-popover';
    const si = pop.querySelector('input'), sb = pop.querySelector('button');
    if (si && sb) {
      const s = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;
      s.call(si, option||'科技'); si.dispatchEvent(new InputEvent('input',{bubbles:true}));
      setTimeout(()=>sb.click(),200);
      return new Promise(resolve => {
        setTimeout(() => {
          const ns = document.querySelectorAll('.el-tree-node:not(.is-hidden)');
          for (const n of ns) { const ic=n.querySelector('.el-tree-node__expand-icon'), cd=n.querySelector('.el-tree-node__children'); if(!ic||ic.classList.contains('is-leaf')||!cd) { const lb=n.querySelector('.el-tree-node__label'); if(lb)lb.click();else n.click(); setTimeout(()=>{if(typeof vm.handleHideClick==='function')vm.handleHideClick();},100); resolve('ok-search:'+(lb?.textContent||n.textContent||'').trim()); return; } }
          // P2: first leaf fallback
          const wl=(ns)=>{for(const n of ns){if(!n.children||!n.children.length)return n;const r=wl(n.children);if(r)return r;}return null;};
          const first=wl(vm.data||[]); if(first){code=first.value||first.id;const ol=first.label||first.value||first.id;vm.$emit('input',code);setTimeout(()=>{if(typeof vm.handleHideClick==='function')vm.handleHideClick();},100);resolve('ok-fallback:'+ol+' ('+code+')');return;}
          resolve('no-leaf-after-search');
        }, 1000);
      });
    }
    // P2 only (no search UI)
    const wl=(ns)=>{for(const n of ns){if(!n.children||!n.children.length)return n;const r=wl(n.children);if(r)return r;}return null;};
    const first=wl(vm.data||[]); if(first){code=first.value||first.id;const ol=first.label||first.value||first.id;vm.$emit('input',code);setTimeout(()=>{if(typeof vm.handleHideClick==='function')vm.handleHideClick();},100);return 'ok-fallback:'+ol+' ('+code+')';}
    return 'option-not-found';
  },
  clickMenuItem: (text) => {
    const d = [...document.querySelectorAll('.el-menu-item')].find(el => el.textContent.trim()===text && el.offsetParent!==null);
    if (d) { d.scrollIntoView({ block: 'center', behavior: 'instant' }); d.click(); return 'ok'; }
    for (const sm of document.querySelectorAll('.el-submenu')) {
      if ([...sm.querySelectorAll('.el-menu-item')].some(i => i.textContent.trim()===text)) {
        if (!sm.classList.contains('is-opened')) sm.querySelector('.el-submenu__title')?.click();
        setTimeout(() => { const t = [...sm.querySelectorAll('.el-menu-item')].find(i => i.textContent.trim()===text); if (t) { t.scrollIntoView({ block: 'center', behavior: 'instant' }); t.click(); } }, 300);
        return 'ok-expanded';
      }
    }
    return 'not-found';
  },
  closeDialog: () => {
    const n = document.querySelector('.el-notification');
    if (n && n.offsetParent!==null) { n.scrollIntoView({ block: 'center', behavior: 'instant' }); const cb = n.querySelector('.el-notification__closeBtn'); if (cb) cb.click(); return 'ok-notification'; }
    for (const d of [...document.querySelectorAll('.el-dialog')].reverse()) {
      if (d.offsetParent!==null) { d.scrollIntoView({ block: 'center', behavior: 'instant' }); const cb = d.querySelector('.el-dialog__headerbtn .el-dialog__close,.el-dialog__headerbtn .el-icon-close'); if (cb) { cb.click(); return 'ok'; } const cb2 = d.querySelector('.el-dialog__footer .el-button--default'); if (cb2) { cb2.click(); return 'ok-cancel'; } return 'no-close-button'; }
    }
    for (const d of [...document.querySelectorAll('.el-drawer')].reverse()) { if (d.offsetParent!==null) { d.scrollIntoView({ block: 'center', behavior: 'instant' }); const cb = d.querySelector('.el-drawer__close-btn,.el-drawer__header .el-icon-close'); if (cb) { cb.click(); return 'ok'; } return 'no-close-button'; } }
    return 'no-overlay-open';
  },
  checkFieldValue: (label) => {
    for (const item of CTRL.getContainer().querySelectorAll('.el-form-item')) {
      const lbl = item.querySelector('.el-form-item__label');
      if (!lbl || !lbl.textContent.trim().includes(label)) continue;
      item.scrollIntoView({ block: 'center', behavior: 'instant' });
      const input = item.querySelector('input:not([type="hidden"]),textarea,.el-select .el-input__inner');
      if (!input) return 'no-input';
      return (input.value||'').trim() || 'empty';
    }
    return 'label-not-found';
  },
  clickAdjacentButton: (label) => {
    for (const item of CTRL.getContainer().querySelectorAll('.el-form-item')) {
      if (!(item.querySelector('.el-form-item__label')?.textContent?.trim()||'').includes(label)) continue;
      item.scrollIntoView({ block: 'center', behavior: 'instant' });
      const input = item.querySelector('.el-input__inner');
      if (input && input.value && input.value.trim()!=='') return 'already-filled';
      const btn = item.querySelector('button.el-button--primary.is-plain,button.el-button--primary');
      if (btn && btn.offsetParent!==null) { btn.click(); return 'ok-clicked'; }
      return 'no-button-found';
    }
    return 'label-not-found';
  },
  clickIconButton: (buttonText) => {
    if (!buttonText) return 'button-text-empty';
    const norm = (s) => (s || '').replace(/\\s+/g, ' ').trim();
    const shortLabel = (text) => {
      const t = norm(text);
      if (!t || t.length > 40 || t.split(/\\s+/).length > 6) return '';
      return t;
    };
    const hasIconClass = (el) => {
      const cls = typeof el.className === 'string' ? el.className : '';
      if (/(?:^|\\s)el-icon-[\\w-]+/.test(cls) || /(?:^|\\s)el-icon(?:\\s|$)/.test(cls)) return true;
      return !!el.querySelector('[class*=\"el-icon-\"], i[class*=\"icon\"]');
    };
    const isExcluded = (el) => {
      const cls = typeof el.className === 'string' ? el.className : '';
      if (/(?:^|\\s)el-popover__reference(?:\\s|$)/.test(cls)) return true;
      if (/(?:^|\\s)el-dropdown(?:\\s|$)/.test(cls)) return true;
      if (/(?:^|\\s)el-submenu(?:\\s|$)/.test(cls)) return true;
      if (/(?:^|\\s)el-menu-item(?:\\s|$)/.test(cls)) return true;
      if (/(?:^|\\s)header__action-item(?:\\s|$)/.test(cls)) return true;
      if (el.closest('.el-menu, .el-submenu, .el-dropdown-menu, .el-select-dropdown, .el-pagination')) return true;
      return norm(el.innerText || '').length > 8;
    };
    const tipEl = (el) => {
      const id = el.getAttribute('aria-describedby');
      if (!id) return null;
      const tip = document.getElementById(id);
      if (!tip) return null;
      const role = (tip.getAttribute('role') || '').toLowerCase();
      const tipCls = typeof tip.className === 'string' ? tip.className : '';
      if (role === 'tooltip' || /(?:^|\\s)el-tooltip__popper(?:\\s|$)/.test(tipCls)) return tip;
      return null;
    };
    const tipText = (el) => {
      const tip = tipEl(el);
      if (!tip) return '';
      const clone = tip.cloneNode(true);
      clone.querySelectorAll('.popper__arrow,[x-arrow]').forEach(n => n.remove());
      return shortLabel(clone.textContent);
    };
    const vueContent = (el) => {
      try {
        let cur = el;
        for (let i = 0; i < 3 && cur; i++) {
          const v = cur.__vue__;
          if (v) {
            const raw = (v.content != null) ? v.content
              : (v.$props && v.$props.content != null ? v.$props.content : null);
            const short = shortLabel(typeof raw === 'string' ? raw : '');
            if (short) return short;
          }
          cur = cur.parentElement;
        }
      } catch (e) {}
      return '';
    };
    const resolveLabel = (el) => {
      const fromAttr = shortLabel(el.getAttribute('aria-label')) || shortLabel(el.getAttribute('title'));
      if (fromAttr) return fromAttr;
      return tipText(el) || vueContent(el);
    };
    // Page toolbars sit outside dialogs — scan document, not getContainer().
    const sel = '[aria-describedby][class*=\"el-icon\"], [aria-describedby].el-tooltip, .el-tooltip[class*=\"el-icon\"]';
    const seen = new Set();
    for (const el of document.querySelectorAll(sel)) {
      if (seen.has(el)) continue;
      seen.add(el);
      if (el.offsetParent === null && !el.closest('.el-table__fixed')) continue;
      if (!hasIconClass(el) || isExcluded(el)) continue;
      const label = resolveLabel(el);
      if (label === buttonText || (label && label.includes(buttonText))) {
        el.scrollIntoView({ block: 'center', behavior: 'instant' });
        el.click();
        return 'ok';
      }
    }
    return 'not-found';
  },
  waitForLoading: () => new Promise(resolve => { let el=0; const ck=()=>{ if(el>=30000){resolve('timeout');return; } const busy=document.querySelector('.el-loading-mask:not(.el-loading-mask--hidden), .el-loading-spinner, [class*=\"loading-spinner\"], [class*=\"loading-mask\"]:not([class*=\"hidden\"])'); if(!busy||busy.offsetParent===null){ const anims=document.getAnimations?document.getAnimations().filter(a=>a.playState==='running'):[]; if(anims.length===0) resolve(); else { el+=100; setTimeout(ck,100); } } else { el+=200; setTimeout(ck,200); } }; ck(); }),
  switchTab: (name) => { for (const tab of document.querySelectorAll('.el-tabs__item')) { if (tab.textContent.trim()===name && tab.offsetParent!==null) { tab.scrollIntoView({ block: 'center', behavior: 'instant' }); tab.click(); return 'ok'; } } return 'tab-not-found'; },
  expandAllTreeNodes: () => { let t=0; for(let r=0;r<10;r++){ const tree=document.querySelector('.el-tree'); if(!tree) return -1; tree.scrollIntoView({ block: 'center', behavior: 'instant' }); let n=0; tree.querySelectorAll('.el-tree-node:not(.is-expanded)').forEach(node=>{ const ic=node.querySelector(':scope>.el-tree-node__content>.el-tree-node__expand-icon'); if(ic){ic.click();n++;} }); if(n===0)break; t+=n; } return t; },
  fillAddressFields: (addr) => {
    let count = 0;
    for (const item of CTRL.getContainer().querySelectorAll('.el-form-item')) {
      const lbl = item.querySelector('.el-form-item__label')?.textContent?.trim() || '';
      if (!lbl.includes('地址')) continue;
      item.scrollIntoView({ block: 'center', behavior: 'instant' });
      const t = item.querySelector('input:not([type="hidden"]):not([disabled]):not([readOnly]),textarea:not([disabled]):not([readOnly])');
      if (!t) continue;
      const TagProto = t.tagName==='TEXTAREA'?HTMLTextAreaElement:HTMLInputElement;
      const setter = Object.getOwnPropertyDescriptor(TagProto.prototype,'value').set;
      setter.call(t, addr);
      t.setAttribute('value', addr);
      t.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:addr}));
      t.dispatchEvent(new Event('change',{bubbles:true}));
      t.dispatchEvent(new Event('blur',{bubbles:true}));
      count++;
    }
    return count > 0 ? 'ok:' + count : 'no-address-fields';
  },
	  clickTableRowButton: (rowText, btnText) => {
		    for (const row of document.querySelectorAll('.el-table__body-wrapper .el-table__row')) {
		      if (!row.textContent.includes(rowText)) continue;
		      row.scrollIntoView({ block: 'center', behavior: 'instant' });
	      for (const btn of row.querySelectorAll('button,.el-button,i[class*="icon"]')) {
	        const t=btn.textContent?.trim()||'', c=btn.className||'';
	        if (t.includes(btnText) || c.includes(btnText.toLowerCase())) { if (btn.offsetParent!==null) { btn.click(); return 'ok'; } }
	      }
	      if (btnText==='edit'||btnText==='编辑') { const ic=row.querySelector('i.el-icon-edit,i[class*="bianji"],i[class*="edit"],i[class*="xiugai"]'); if (ic&&ic.offsetParent!==null) { ic.click(); return 'ok-icon'; } }
	      if (btnText==='delete'||btnText==='删除') { const ic=row.querySelector('i.el-icon-delete,i[class*="shanchu"],i[class*="delete"]'); if (ic&&ic.offsetParent!==null) { ic.click(); return 'ok-icon'; } }
	      for (const btn of row.querySelectorAll('button,.el-button')) { if (btn.offsetParent!==null) { btn.click(); return 'ok-fallback'; } }
	      return 'button-not-found';
	    }
	    return 'row-not-found';
	  },
	  clickTableRowRadio: (rowText) => {
	    if (!rowText) return 'row-text-empty';
	    const pickSel = (root) => root && root.querySelector(
	      'label.el-radio, .el-radio, label.el-checkbox, .el-checkbox, input[type="radio"]'
	    );
	    const clickSel = (el) => {
	      if (!el) return false;
	      const inner = el.querySelector
	        ? el.querySelector('.el-radio__inner, .el-checkbox__inner')
	        : null;
	      (inner || el).click();
	      return true;
	    };
	    const wantFirst = /^(first|1st|第一个|第一项|首行)$/i.test(String(rowText).trim());
	    const tables = document.querySelectorAll('.el-table');
	    for (const table of tables) {
	      const bodyRows = table.querySelectorAll('.el-table__body-wrapper tbody tr.el-table__row, .el-table__body-wrapper tbody tr');
	      for (let i = 0; i < bodyRows.length; i++) {
	        const row = bodyRows[i];
	        if (!wantFirst && !(row.textContent || '').includes(rowText)) continue;
	        row.scrollIntoView({ block: 'center', behavior: 'instant' });
	        let radio = pickSel(row);
	        if (!radio) {
	          const fixedRows = table.querySelectorAll(
	            '.el-table__fixed-body-wrapper tbody tr.el-table__row, .el-table__fixed tbody tr.el-table__row, .el-table__fixed-left tbody tr.el-table__row, .el-table__fixed-right tbody tr.el-table__row'
	          );
	          if (fixedRows[i]) radio = pickSel(fixedRows[i]);
	        }
	        if (!radio) {
	          if (wantFirst) continue;
	          return 'radio-not-found';
	        }
	        if (radio.offsetParent === null && !radio.closest('.el-table__fixed')) return 'radio-not-found';
	        clickSel(radio);
	        return 'ok';
	      }
	    }
	    return 'row-not-found';
	  },
  verifyFormStructure: (expectedFields, containerId) => {
    // expectedFields: [{label, is_required}, ...] from save_form_snapshot
    // containerId: recorded scope "main" | "drawer:…" | "dialog:…" (optional; omit → legacy getContainer)
    const wrapOk = (d) => {
      if (!d) return false;
      const wrap = d.closest && d.closest('.el-dialog__wrapper, .el-message-box__wrapper, .el-drawer__wrapper');
      if (wrap && getComputedStyle(wrap).display === 'none') return false;
      if (d.offsetParent !== null) return true;
      const st = getComputedStyle(d);
      if (st.display === 'none' || st.visibility === 'hidden') return false;
      const r = d.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };
    const matchTitle = (el, want) => {
      const w = String(want || '').trim();
      if (!w || !el) return false;
      const aria = (el.getAttribute('aria-label') || '').trim();
      const header = (el.querySelector('.el-drawer__title, .el-drawer__header, .el-dialog__title')?.textContent || '').trim();
      return aria === w || header === w
        || (aria && (aria.includes(w) || w.includes(aria)))
        || (header && (header.includes(w) || w.includes(header)));
    };
    const fieldsIn = Array.isArray(expectedFields) ? expectedFields : [];
    const idRaw = (containerId == null || containerId === '') ? null : String(containerId).trim();
    let root = null;
    let scopeMode = 'legacy';
    if (!idRaw) {
      root = CTRL.getContainer();
      scopeMode = 'legacy';
    } else if (idRaw === 'main') {
      root = document;
      scopeMode = 'main';
    } else if (idRaw.startsWith('drawer:')) {
      const want = idRaw.slice(7);
      root = [...document.querySelectorAll('.el-drawer')].filter(wrapOk).find((d) => matchTitle(d, want)) || null;
      scopeMode = 'drawer';
    } else if (idRaw.startsWith('dialog:')) {
      const want = idRaw.slice(7);
      root = [...document.querySelectorAll('.el-dialog, .el-message-box')].filter(wrapOk).find((d) => matchTitle(d, want)) || null;
      scopeMode = 'dialog';
    } else {
      root = CTRL.getContainer();
      scopeMode = 'legacy';
    }
    if (!root) {
      return JSON.stringify({
        ok: false,
        error: 'container_not_found',
        container: idRaw,
        count: 0,
        expected_count: fieldsIn.length,
        required_count: 0,
        optional_count: 0,
        missing_required: [],
        missing_optional: [],
        added_required: [],
        added_optional: [],
        hasRequiredChange: false,
        hasOptionalChange: false,
        reordered: false,
        fields: [],
      });
    }
    let itemList = [...root.querySelectorAll('.el-form-item')];
    if (scopeMode === 'main') {
      itemList = itemList.filter((item) => {
        const dr = item.closest('.el-drawer');
        if (dr && wrapOk(dr)) return false;
        const dg = item.closest('.el-dialog, .el-message-box');
        if (dg && wrapOk(dg)) return false;
        return true;
      });
    }
    const items = itemList;
    const actualLabels = [];
    for (const item of items) {
      const lbl = item.querySelector('.el-form-item__label');
      if (lbl) actualLabels.push(lbl.textContent.trim());
    }

    const expectedLabels = fieldsIn.map(f => f.label);
    const requiredLabels = fieldsIn.filter(f => f.is_required).map(f => f.label);
    const optionalLabels = fieldsIn.filter(f => !f.is_required).map(f => f.label);

    // Classify missing by severity
    const missing_required = requiredLabels.filter(l => !actualLabels.includes(l));
    const missing_optional = optionalLabels.filter(l => !actualLabels.includes(l));

    // Classify added: check each actual label against expected
    const added_all = actualLabels.filter(l => !expectedLabels.includes(l));
    // Added fields: check if required (→ P2 error) or optional (→ P3 warning)
    const added_required = [];
    const added_optional = [];
    for (const lbl of added_all) {
      // Find the el-form-item for this label
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

    return JSON.stringify({
      ok: !hasRequiredChange,
      container: idRaw || scopeMode,
      count: actualLabels.length,
      expected_count: expectedLabels.length,
      required_count: requiredLabels.length,
      optional_count: optionalLabels.length,
      missing_required, missing_optional,
      added_required, added_optional,
      hasRequiredChange, hasOptionalChange, reordered,
      fields: actualLabels
    });
  },
}`;
/**
 * 模板生成用：以 page.evaluate 注入格式输出（含缩进）
 * 用于 convertTrajectoryToScript 的模板
 */
export function getInjectionCode(indent = 2) {
  const sp = ' '.repeat(indent);
  return `${sp}// Inject Element UI helpers into browser context (from controller.py)
${sp}await page.evaluate(() => {
${sp}  window.CTRL = ${CTRL_OBJECT.replace(/\n/g, '\n' + sp + '  ')};
${sp}});`;
}

/**
 * LLM prompt 用：以 Markdown 代码块格式输出（可复制）
 * 用于 Agent prompt 中让 LLM 直接复制 CTRL 函数定义
 */
export const CTRL_PROMPT_BLOCK = '```javascript\nawait page.evaluate(() => {\n  window.CTRL = ' + CTRL_OBJECT.replace(/\n/g, '\n  ') + '\n});\n```';

/**
 * CTRL API 签名表（LLM prompt 用）
 */
export const CTRL_API_TABLE = `| 函数 | 参数 | 返回值 | 说明 |
|------|------|--------|------|
| CTRL.fillFormField | (label, value) | 'ok' / 'ok-date' / 'ok-placeholder' / 'ok-fuzzy' / 'field-disabled' / 'label-not-found' | 填充 el-input/textarea；成功均以 ok 开头；Vue/.is-disabled 只读字段返回 field-disabled |
| CTRL.selectOption | (label, option) | 'ok-triggered' / 'ok-triggered-placeholder' / 'select-disabled' / 'label-not-found' | 下拉选择 el-select，option='first' 选第一项 |
| CTRL.selectDate | (label, dateStr) | 'ok-date:xxx' / 'ok-already:xxx' / 'label-not-found' | 设置 el-date-editor，格式 YYYY-MM-DD |
| CTRL.clickRadio | (label, option) | 'ok' / 'disabled' / 'option-not-found' / 'label-not-found' | 点击 el-radio |
| CTRL.selectTreeOption | (label, option) | 'ok:xxx (code)' / 'ok-search:xxx' / 'ok-fallback:xxx (code)' / 'disabled' / 'no-tree-component' | 树选择器；只读 TsscMultiTree 返回 disabled |
| CTRL.isFormItemDisabled | (item, inputEl?, trigger?) | true/false | 可编辑判定：原生 disabled + .is-disabled 包装 + Vue props.disabled || CTRL.clickMenuItem | (text) | 'ok' / 'ok-expanded' / 'not-found' | 点击 el-menu-item，自动展开 el-submenu |
| CTRL.clickTableRowButton | (rowText, btnText) | 'ok' / 'ok-icon' / 'ok-fallback' / 'button-not-found' / 'row-not-found' | 点击 el-table 行内操作按钮 |
| CTRL.clickTableRowRadio | (rowText) | 'ok' / 'radio-not-found' / 'row-not-found' | 选中 el-table 行内单选按钮 |
| CTRL.closeDialog | () | 'ok' / 'ok-notification' / 'ok-cancel' / 'no-overlay-open' | 关闭通知/弹窗/抽屉 |
| CTRL.waitForLoading | () | 超时返回 'timeout' | 等待 loading 遮罩 + CSS 动画结束（200ms 轮询，最长 30s） |
| CTRL.switchTab | (name) | 'ok' / 'tab-not-found' | 切换 el-tabs |
| CTRL.checkFieldValue | (label) | 值 / 'empty' / 'label-not-found' | 读取表单字段当前值 |
| CTRL.clickAdjacentButton | (label) | 'ok-clicked' / 'already-filled'(非ok跳过) / 'no-button-found' | 点击字段旁的选择/引入按钮 |
| CTRL.clickIconButton | (buttonText) | 'ok' / 'not-found' / 'button-text-empty' | 按 el-tooltip / ElTooltip content / aria-label 点击图标按钮 |
| CTRL.fillAddressFields | (addr) | 'ok:N' / 'no-address-fields' | 填充所有标签含"地址"的字段 |
| CTRL.expandAllTreeNodes | () | 展开节点数 | 展开全部 el-tree 节点 |

成功可录制约定：result.startsWith('ok')。跳过码（如 already-filled）不以 ok 开头。`;

// Re-export raw CTRL object for template generation
export { CTRL_OBJECT };
