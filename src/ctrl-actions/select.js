/**
 * CTRL_OBJECT part: selectOption / selectDate / clickRadio / selectTreeOption.
 * Concatenated with sibling parts into CTRL_OBJECT in index.js —
 * do not change indentation, braces, or the trailing comma; the
 * assembled string must stay byte-identical (characterize-ctrl.mjs).
 */
export const CTRL_PART_SELECT = `  selectOption: (label, option) => {
    const c = CTRL.getContainer();
    const first = ['first','1st','第一个','第一项'];
    const findTarget = (opts) => {
      const list = [...opts];
      if (first.includes(option.toLowerCase().trim()))
        return list.find(it => it.offsetParent !== null) || list[0];
      return list.find(it => it.textContent.trim() === option) || list.find(it => it.textContent.trim().includes(option));
    };
    const clickTarget = (t) => {
      t.scrollIntoView({block:'nearest'});
      t.dispatchEvent(new MouseEvent('mousedown',{bubbles:true}));
      t.click();
    };
    const pickFromOpen = () => {
      const opts = document.querySelectorAll('.el-select-dropdown__item');
      let t = findTarget(opts);
      if (t) { clickTarget(t); return; }
      /* SELECT_LAZY_LOAD_ON_MISS */
      const findWrap = (dd) => {
        if (!dd) return null;
        const w1 = dd.querySelector('.el-select-dropdown__wrap');
        if (w1 && w1.scrollHeight > w1.clientHeight + 2) return w1;
        const w2 = dd.querySelector('.el-scrollbar__wrap');
        if (w2 && w2.scrollHeight > w2.clientHeight + 2) return w2;
        for (const n of dd.querySelectorAll('*')) {
          const s = getComputedStyle(n);
          if ((s.overflowY === 'auto' || s.overflowY === 'scroll') && n.scrollHeight > n.clientHeight + 2) return n;
        }
        return null;
      };
      const findDropdown = () => {
        for (const dd of document.querySelectorAll('.el-select-dropdown')) {
          if (dd.classList.contains('is-hidden')) continue;
          const style = getComputedStyle(dd);
          if (style.display === 'none' || style.visibility === 'hidden') continue;
          const rect = dd.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) return dd;
        }
        return null;
      };
      const dropdown = findDropdown();
      const wrap = findWrap(dropdown);
      if (!wrap) return;
      let round = 0, stableStreak = 0, prevCount = opts.length, prevHeight = wrap.scrollHeight;
      const scrollRound = () => {
        if (round >= 8) {
          t = findTarget(document.querySelectorAll('.el-select-dropdown__item'));
          if (t) clickTarget(t);
          return;
        }
        wrap.scrollTop = wrap.scrollHeight;
        setTimeout(() => {
          const opts2 = document.querySelectorAll('.el-select-dropdown__item');
          t = findTarget(opts2);
          if (t) { clickTarget(t); return; }
          const h = wrap.scrollHeight;
          const c = opts2.length;
          if (c === prevCount && h === prevHeight) stableStreak += 1;
          else { stableStreak = 0; prevCount = c; prevHeight = h; }
          round += 1;
          if (stableStreak >= 2) {
            t = findTarget(document.querySelectorAll('.el-select-dropdown__item'));
            if (t) clickTarget(t);
            return;
          }
          scrollRound();
        }, 250);
      };
      scrollRound();
    };
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
      setTimeout(() => pickFromOpen(), 200);
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
        setTimeout(() => pickFromOpen(), 200);
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
`;
