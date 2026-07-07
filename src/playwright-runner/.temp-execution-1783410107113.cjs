const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const _TMP = process.env.TMPDIR || process.env.TMP || process.env.TEMP || '/tmp';
const _CDP_PORT = 0;
const _errors = [];
function _recordError(step, action, label, value, error, details, severity) {
  _errors.push({ step, action, label, value, error, details, severity: severity || 'error' });
}

// Identity field generators
function genCreditCode() { const s='0123456789ABCDEFGHJKLMNPQRTUWXY'; let r=''; for(let i=0;i<18;i++) r+=s[Math.floor(Math.random()*s.length)]; return r; }
function genValidIdCard() { const a=[110101,110102,110105,120103,310101,320102,440103]; let r=String(a[Math.floor(Math.random()*a.length)]); for(let i=0;i<12;i++) r+=Math.floor(Math.random()*10); let w=[7,9,10,5,8,4,2,1,6,3,7,9,10,5,8,4,2], s=0; for(let i=0;i<17;i++) s+=parseInt(r[i])*w[i]; let c=['1','0','X','9','8','7','6','5','4','3','2']; r+=c[s%11]; return r; }
function genMobile() { const p=['138','139','150','151','152','157','158','159','186','187','188']; let r=p[Math.floor(Math.random()*p.length)]; for(let i=0;i<8;i++) r+=Math.floor(Math.random()*10); return r; }
function genEmail() { const n=['test','admin','user','demo','info']; const d=['example.com','test.com','demo.cn']; return n[Math.floor(Math.random()*n.length)]+Math.floor(Math.random()*1000)+'@'+d[Math.floor(Math.random()*d.length)]; }
function genBankCard() { let r='62'; for(let i=0;i<17;i++) r+=Math.floor(Math.random()*10); return r; }
function genName() { const s=['张','王','李','赵','陈','刘','杨','黄','周','吴']; const m=['伟','芳','娜','敏','静','强','磊','洋','勇','艳']; return s[Math.floor(Math.random()*s.length)]+m[Math.floor(Math.random()*m.length)]+m[Math.floor(Math.random()*m.length)]; }
function genAmount() { return String(Math.floor(Math.random()*9000000+1000000)); }
function genAddress() { const c=['北京市朝阳区','上海市浦东新区','广州市天河区','深圳市南山区','杭州市西湖区']; return c[Math.floor(Math.random()*c.length)]+'某某路'+Math.floor(Math.random()*200+1)+'号'; }

(async () => {
  const browser = await chromium.launch({ headless: false, args: ['--start-maximized'] });
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1920, height: 1080 });
  try {

    await page.goto('http://test.creditv5p2.tansun.com.cn/#/cstMgt/csinfMnt/cpctMgt/cpctMgtPg?part=cstMgtcsinfMntcpctMgtcpctMgtPg&goBack=goBack&newtag=false&needupdate=yes', { waitUntil: 'networkidle', timeout: 60000 });
// CTRL helpers — loaded from src/ctrl-actions.js
  // Inject Element UI helpers into browser context (from controller.py)
  await page.evaluate(() => {
    window.CTRL = {
      getContainer: () => {
        for (const d of document.querySelectorAll('.el-dialog')) if (d.offsetParent !== null) return d;
        for (const d of document.querySelectorAll('.el-drawer')) if (d.offsetParent !== null) return d;
        return document;
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
          const t = item.querySelector('input:not([type="hidden"])') || item.querySelector('textarea');
          if (!t) return 'no-input-found';
          if (t.disabled || t.readOnly) return 'field-disabled';
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
          const searchChars = [...new Set(label.replace(/[s,，、]/g, ''))];
          if (searchChars.length < 2) continue;
          const allCharsMatch = searchChars.every(ch => lbl.includes(ch));
          if (!allCharsMatch) continue;
          const t = item.querySelector('input:not([type="hidden"])') || item.querySelector('textarea');
          if (!t) return 'no-input-found';
          if (t.disabled || t.readOnly) return 'field-disabled';
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
            setFn(inp, val);
            return 'ok-placeholder';
          }
        }
        // Pass 4: fuzzy match — pick the label with highest character overlap
        let bestMatch = null, bestScore = 0;
        for (const item of c.querySelectorAll('.el-form-item')) {
          const lbl = item.querySelector('.el-form-item__label')?.textContent?.trim() || '';
          if (!lbl) continue;
          const a = [...new Set(label.replace(/[s,，、]/g, ''))];
          const b = [...new Set(lbl.replace(/[s,，、]/g, ''))];
          const common = a.filter(ch => b.includes(ch)).length;
          const score = common / Math.max(a.length, b.length, 1);
          if (score > bestScore) { bestScore = score; bestMatch = item; }
        }
        if (bestMatch && bestScore >= 0.4) {
          const t = bestMatch.querySelector('input:not([type="hidden"])') || bestMatch.querySelector('textarea');
          if (t && !t.disabled && !t.readOnly) { setFn(t, val); return 'ok-fuzzy'; }
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
          const trigger = item.querySelector('.el-select .el-input__inner');
          if (!trigger) return 'no-select-found';
          if (trigger.disabled) return 'select-disabled';
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
          return 'triggered';
        }
        // Fallback: match by placeholder (for forms without .el-form-item__label)
        for (const sel of c.querySelectorAll('.el-select .el-input__inner')) {
          const ph = sel.getAttribute('placeholder') || '';
          if (ph.includes(label) && !sel.disabled && sel.offsetParent !== null) {
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
            return 'triggered-placeholder';
          }
        }
        return 'label-not-found';
      },
      selectDate: (label, dateStr) => {
        const c = CTRL.getContainer();
        for (const item of c.querySelectorAll('.el-form-item')) {
          const lbl = item.querySelector('.el-form-item__label');
          if (!lbl || !lbl.textContent.trim().includes(label)) continue;
          const input = item.querySelector('input');
          if (!input) return 'no-input';
          if (input.value === dateStr) return 'already:' + dateStr;
          const editor = item.querySelector('.el-date-editor') || input.closest('.el-date-editor');
          if (!editor) return 'no-editor';
          editor.click();
          const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;
          setter.call(input, dateStr);
          input.dispatchEvent(new Event('input',{bubbles:true}));
          input.dispatchEvent(new Event('change',{bubbles:true}));
          const p = document.querySelector('.el-picker-panel,.el-date-range-picker');
          if (p && p.offsetParent !== null) document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
          return 'selected:' + dateStr;
        }
        return 'label-not-found';
      },
      clickRadio: (label, option) => {
        for (const item of CTRL.getContainer().querySelectorAll('.el-form-item')) {
          if (!(item.querySelector('.el-form-item__label')?.textContent?.trim()||'').includes(label)) continue;
          for (const r of item.querySelectorAll('.el-radio')) { if (r.textContent.trim()===option && r.offsetParent!==null) { r.click(); return 'ok'; } }
          return 'option-not-found';
        }
        return 'label-not-found';
      },
      selectTreeOption: (label, option) => {
        const item = [...CTRL.getContainer().querySelectorAll('.el-form-item')].find(i => (i.querySelector('.el-form-item__label')?.textContent?.trim()||'').includes(label));
        if (!item) return 'label-not-found';
        const input = item.querySelector('input');
        if (!input || input.disabled || input.readOnly) return input ? 'disabled' : 'no-input';
        input.click();
        const tree = document.querySelector('.el-tree');
        if (!tree) return 'no-tree-component';
        let vm = tree.__vue__;
        while (vm && vm.$options && !vm.$options.name?.includes('TsscMultiTree')) vm = vm.$parent;
        if (!vm) return 'no-tree-component';
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
        if (d) { d.click(); return 'ok'; }
        for (const sm of document.querySelectorAll('.el-submenu')) {
          if ([...sm.querySelectorAll('.el-menu-item')].some(i => i.textContent.trim()===text)) {
            if (!sm.classList.contains('is-opened')) sm.querySelector('.el-submenu__title')?.click();
            setTimeout(() => { const t = [...sm.querySelectorAll('.el-menu-item')].find(i => i.textContent.trim()===text); if (t) t.click(); }, 300);
            return 'ok-expanded';
          }
        }
        return 'not-found';
      },
      closeDialog: () => {
        const n = document.querySelector('.el-notification');
        if (n && n.offsetParent!==null) { const cb = n.querySelector('.el-notification__closeBtn'); if (cb) cb.click(); return 'ok-notification'; }
        for (const d of [...document.querySelectorAll('.el-dialog')].reverse()) {
          if (d.offsetParent!==null) { const cb = d.querySelector('.el-dialog__headerbtn .el-dialog__close,.el-dialog__headerbtn .el-icon-close'); if (cb) { cb.click(); return 'ok'; } const cb2 = d.querySelector('.el-dialog__footer .el-button--default'); if (cb2) { cb2.click(); return 'ok-cancel'; } return 'no-close-button'; }
        }
        for (const d of [...document.querySelectorAll('.el-drawer')].reverse()) { if (d.offsetParent!==null) { const cb = d.querySelector('.el-drawer__close-btn,.el-drawer__header .el-icon-close'); if (cb) { cb.click(); return 'ok'; } return 'no-close-button'; } }
        return 'no-overlay-open';
      },
      checkFieldValue: (label) => {
        for (const item of CTRL.getContainer().querySelectorAll('.el-form-item')) {
          const lbl = item.querySelector('.el-form-item__label');
          if (!lbl || !lbl.textContent.trim().includes(label)) continue;
          const input = item.querySelector('input:not([type="hidden"]),textarea,.el-select .el-input__inner');
          if (!input) return 'no-input';
          return (input.value||'').trim() || 'empty';
        }
        return 'label-not-found';
      },
      clickAdjacentButton: (label) => {
        for (const item of CTRL.getContainer().querySelectorAll('.el-form-item')) {
          if (!(item.querySelector('.el-form-item__label')?.textContent?.trim()||'').includes(label)) continue;
          const input = item.querySelector('.el-input__inner');
          if (input && input.value && input.value.trim()!=='') return 'already-filled';
          const btn = item.querySelector('button.el-button--primary.is-plain,button.el-button--primary');
          if (btn && btn.offsetParent!==null) { btn.click(); return 'clicked'; }
          return 'no-button-found';
        }
        return 'label-not-found';
      },
      waitForLoading: () => new Promise(resolve => { let el=0; const ck=()=>{ if(el>=30000){resolve('timeout');return; } const busy=document.querySelector('.el-loading-mask:not(.el-loading-mask--hidden), .el-loading-spinner, [class*="loading-spinner"], [class*="loading-mask"]:not([class*="hidden"])'); if(!busy||busy.offsetParent===null){ const anims=document.getAnimations?document.getAnimations().filter(a=>a.playState==='running'):[]; if(anims.length===0) resolve(); else { el+=100; setTimeout(ck,100); } } else { el+=200; setTimeout(ck,200); } }; ck(); }),
      switchTab: (name) => { for (const tab of document.querySelectorAll('.el-tabs__item')) { if (tab.textContent.trim()===name && tab.offsetParent!==null) { tab.click(); return 'ok'; } } return 'tab-not-found'; },
      expandAllTreeNodes: () => { let t=0; for(let r=0;r<10;r++){ const tree=document.querySelector('.el-tree'); if(!tree) return -1; let n=0; tree.querySelectorAll('.el-tree-node:not(.is-expanded)').forEach(node=>{ const ic=node.querySelector(':scope>.el-tree-node__content>.el-tree-node__expand-icon'); if(ic){ic.click();n++;} }); if(n===0)break; t+=n; } return t; },
      fillAddressFields: (addr) => {
        let count = 0;
        for (const item of CTRL.getContainer().querySelectorAll('.el-form-item')) {
          const lbl = item.querySelector('.el-form-item__label')?.textContent?.trim() || '';
          if (!lbl.includes('地址')) continue;
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
    	    for (const row of document.querySelectorAll('.el-table__body-wrapper .el-table__row')) {
    	      if (!row.textContent.includes(rowText)) continue;
    	      const radio = row.querySelector('label.el-radio');
    	      if (!radio || radio.offsetParent === null) return 'radio-not-found';
    	      const inner = radio.querySelector('.el-radio__inner');
    	      (inner || radio).click();
    	      return 'ok';
    	    }
    	    return 'row-not-found';
    	  },
      verifyFormStructure: (expectedFields) => {
        // expectedFields: [{label, is_required}, ...] from save_form_snapshot
        const container = CTRL.getContainer();
        const items = container.querySelectorAll('.el-form-item');
        const actualLabels = [];
        for (const item of items) {
          const lbl = item.querySelector('.el-form-item__label');
          if (lbl) actualLabels.push(lbl.textContent.trim());
        }
    
        const expectedLabels = expectedFields.map(f => f.label);
        const requiredLabels = expectedFields.filter(f => f.is_required).map(f => f.label);
        const optionalLabels = expectedFields.filter(f => !f.is_required).map(f => f.label);
    
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
              isReq = !!(item.matches('.is-required') || item.querySelector('.is-required, .el-form-item__label .el-form-item__label--required') || /\*/.test(lbl));
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
    };
  });
    await page.evaluate(() => CTRL.waitForLoading());
    // [1] fill_form_field
    console.log('[1] Fill "请输入您的用户名" → "701994"');

    await page.waitForSelector('.el-form-item', { timeout: 10000 }).catch(() => {});
    // Scope fallback locators to active dialog/drawer
    const _scope1 = await page.evaluate(() => {
      for (const d of document.querySelectorAll('.el-dialog')) if (d.offsetParent !== null) return '.el-dialog';
      for (const d of document.querySelectorAll('.el-drawer')) if (d.offsetParent !== null) return '.el-drawer';
      return '';
    });
    const _base1 = _scope1 ? page.locator(_scope1) : page;
    let _r1 = await page.evaluate((v) => CTRL.fillFormField('请输入您的用户名', v), '701994');
    console.log('[1]   CTRL:', _r1);
    let _dt1 = 'CTRL: ' + _r1;
    if (_r1 !== 'ok' && _r1 !== 'ok-date' && _r1 !== 'ok-placeholder' && _r1 !== 'ok-fuzzy') {
      console.log('[1]   falling back to Playwright text...');
      try {
        const _fb1 = _base1.locator('.el-form-item').filter({ hasText: '请输入您的用户名' }).locator('input:not([type="hidden"]), textarea').first();
        await _fb1.fill('701994', { timeout: 3000 });
        _r1 = 'ok-playwright';
        console.log('[1]   Playwright text OK');
      } catch (_e_fb1) {
        console.log('[1]   Playwright fallback failed:', _e_fb1.message);
        _dt1 += ' | Playwright hasText: failed';
        _dt1 += ' | absolute XPath: N/A → label_text may need updating and an absolute XPath may need updating';
        _recordError(1, 'fill_form_field', '请输入您的用户名', String('701994'), 'needs-llm-fix', _dt1);
      }
    }
    // Retry "请输入您的用户名" (first fill in this block may fail on new form)
    await page.evaluate((v) => CTRL.fillFormField('请输入您的用户名', v), '701994');
    // [2] fill_form_field
    console.log('[2] Fill "请输入您的密码" → "1"');

    await page.waitForSelector('.el-form-item', { timeout: 10000 }).catch(() => {});
    // Scope fallback locators to active dialog/drawer
    const _scope2 = await page.evaluate(() => {
      for (const d of document.querySelectorAll('.el-dialog')) if (d.offsetParent !== null) return '.el-dialog';
      for (const d of document.querySelectorAll('.el-drawer')) if (d.offsetParent !== null) return '.el-drawer';
      return '';
    });
    const _base2 = _scope2 ? page.locator(_scope2) : page;
    let _r2 = await page.evaluate((v) => CTRL.fillFormField('请输入您的密码', v), '1');
    console.log('[2]   CTRL:', _r2);
    let _dt2 = 'CTRL: ' + _r2;
    if (_r2 !== 'ok' && _r2 !== 'ok-date' && _r2 !== 'ok-placeholder' && _r2 !== 'ok-fuzzy') {
      console.log('[2]   falling back to Playwright text...');
      try {
        const _fb2 = _base2.locator('.el-form-item').filter({ hasText: '请输入您的密码' }).locator('input:not([type="hidden"]), textarea').first();
        await _fb2.fill('1', { timeout: 3000 });
        _r2 = 'ok-playwright';
        console.log('[2]   Playwright text OK');
      } catch (_e_fb2) {
        console.log('[2]   Playwright fallback failed:', _e_fb2.message);
        _dt2 += ' | Playwright hasText: failed';
        _dt2 += ' | absolute XPath: N/A → label_text may need updating and an absolute XPath may need updating';
        _recordError(2, 'fill_form_field', '请输入您的密码', String('1'), 'needs-llm-fix', _dt2);
      }
    }
    // [3] click_element_by_index
    console.log('[3] Click [8] "登 录"');
    await page.waitForFunction(before => location.href !== before, page.url(), { timeout: 5000 }).catch(() => {});

    await page.waitForSelector('.el-form-item', { timeout: 10000 }).catch(() => {});
    let _clicked3 = false;
    let _dt3 = '';
    if (!_clicked3) {
      try {
        await page.locator('xpath=/html/body/div[1]/div/div[1]/div/div/div[2]/form/div[8]/button').first().click({ timeout: 3000 });
        _clicked3 = true;
        console.log('[3]   clicked via xpath');
      } catch (_e_xpath3) { console.log('[3]   xpath failed:', _e_xpath3.message); _dt3 += ' | xpath: failed'; }
    }
    if (!_clicked3) {
      try {
        await page.locator(':text-is("登 录")').first().click({ timeout: 3000 });
        _clicked3 = true;
        console.log('[3]   clicked via text');
      } catch (_e_text3) { console.log('[3]   text failed:', _e_text3.message); _dt3 += ' | text: failed'; }
    }
    if (!_clicked3) {
      try {
        await page.evaluate((xp) => {
          const el = document.evaluate(xp, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
          if (el) { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); return true; }
          return false;
        }, '/html/body/div[1]/div/div[1]/div/div/div[2]/form/div[8]/button');
        _clicked3 = true;
        console.log('[3]   clicked via JS dispatchEvent');
      } catch (_e_js3) { _dt3 += ' | JS: failed'; }
    }
    if (!_clicked3) {
      try {
        await page.evaluate((text) => {
          const candidates = [...document.querySelectorAll('button, a, span, li, label, .el-button, .el-menu-item')].filter(el => el.offsetParent !== null);
          let best = null, bestScore = 0;
          const t = [...new Set(text.replace(/\s/g,''))];
          for (const el of candidates) {
            const elText = el.textContent?.trim() || '';
            if (!elText) continue;
            const e = [...new Set(elText.replace(/\s/g,''))];
            const common = t.filter(ch => e.includes(ch)).length;
            const score = common / Math.max(t.length, e.length, 1);
            if (score > bestScore) { bestScore = score; best = el; }
          }
          if (best && bestScore >= 0.4) { best.click(); return bestScore; }
          return 0;
        }, '登 录').then(score => {
          if (score > 0) { _clicked3 = true; console.log('[3]   clicked via fuzzy (score=' + score.toFixed(2) + ')'); }
        });
      } catch (_e_fz3) { _dt3 += ' | fuzzy: failed'; }
    }
    if (!_clicked3) {
      _dt3 += ' → page structure changed — re-locate element';
      _recordError(3, 'click_element_by_index', '登 录', '/html/body/div[1]/div/div[1]/div/div/div[2]/form/div[8]/button', 'needs-llm-fix', _dt3);
      throw new Error('[3] Click failed: target element not found on page. Stopping — subsequent steps depend on this navigation.');
    }
    // Post-click: check for page navigation
    const _urlBefore3 = page.url();
    await page.evaluate(() => CTRL.waitForLoading());
    let _navigated3 = false;
    try {
      await page.waitForFunction((before) => location.href !== before, _urlBefore3, { timeout: 3000 });
      _navigated3 = true;
    } catch (_e_nav3) { /* no URL change — dialog or in-page action */ }
    if (_navigated3) {
      // Page navigated, wait for full load
      await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
      await page.waitForSelector('.el-menu, .el-table, .el-form-item, .el-tabs, .el-dialog', { timeout: 10000 }).catch(() => {});
    }
    // [4] click_element_by_index
    console.log('[4] Click [10] "客户管理"');
    await page.waitForFunction(before => location.href !== before, page.url(), { timeout: 5000 }).catch(() => {});

    await page.waitForSelector('.el-form-item', { timeout: 10000 }).catch(() => {});
    let _clicked4 = false;
    let _dt4 = '';
    if (!_clicked4) {
      try {
        await page.locator('xpath=/html/body/div[1]/div/section/div[1]/nav/ul/li[3]').first().click({ timeout: 3000 });
        _clicked4 = true;
        console.log('[4]   clicked via xpath');
      } catch (_e_xpath4) { console.log('[4]   xpath failed:', _e_xpath4.message); _dt4 += ' | xpath: failed'; }
    }
    if (!_clicked4) {
      try {
        await page.locator(':text-is("客户管理")').first().click({ timeout: 3000 });
        _clicked4 = true;
        console.log('[4]   clicked via text');
      } catch (_e_text4) { console.log('[4]   text failed:', _e_text4.message); _dt4 += ' | text: failed'; }
    }
    if (!_clicked4) {
      try {
        await page.evaluate((xp) => {
          const el = document.evaluate(xp, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
          if (el) { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); return true; }
          return false;
        }, '/html/body/div[1]/div/section/div[1]/nav/ul/li[3]');
        _clicked4 = true;
        console.log('[4]   clicked via JS dispatchEvent');
      } catch (_e_js4) { _dt4 += ' | JS: failed'; }
    }
    if (!_clicked4) {
      try {
        await page.evaluate((text) => {
          const candidates = [...document.querySelectorAll('button, a, span, li, label, .el-button, .el-menu-item')].filter(el => el.offsetParent !== null);
          let best = null, bestScore = 0;
          const t = [...new Set(text.replace(/\s/g,''))];
          for (const el of candidates) {
            const elText = el.textContent?.trim() || '';
            if (!elText) continue;
            const e = [...new Set(elText.replace(/\s/g,''))];
            const common = t.filter(ch => e.includes(ch)).length;
            const score = common / Math.max(t.length, e.length, 1);
            if (score > bestScore) { bestScore = score; best = el; }
          }
          if (best && bestScore >= 0.4) { best.click(); return bestScore; }
          return 0;
        }, '客户管理').then(score => {
          if (score > 0) { _clicked4 = true; console.log('[4]   clicked via fuzzy (score=' + score.toFixed(2) + ')'); }
        });
      } catch (_e_fz4) { _dt4 += ' | fuzzy: failed'; }
    }
    if (!_clicked4) {
      _dt4 += ' → page structure changed — re-locate element';
      _recordError(4, 'click_element_by_index', '客户管理', '/html/body/div[1]/div/section/div[1]/nav/ul/li[3]', 'needs-llm-fix', _dt4);
      throw new Error('[4] Click failed: target element not found on page. Stopping — subsequent steps depend on this navigation.');
    }
    // Post-click: check for page navigation
    const _urlBefore4 = page.url();
    await page.evaluate(() => CTRL.waitForLoading());
    let _navigated4 = false;
    try {
      await page.waitForFunction((before) => location.href !== before, _urlBefore4, { timeout: 3000 });
      _navigated4 = true;
    } catch (_e_nav4) { /* no URL change — dialog or in-page action */ }
    if (_navigated4) {
      // Page navigated, wait for full load
      await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
      await page.waitForSelector('.el-menu, .el-table, .el-form-item, .el-tabs, .el-dialog', { timeout: 10000 }).catch(() => {});
    }
    // [5] click_element_by_index
    console.log('[5] Click [31] "对公客户管理"');
    await page.waitForFunction(before => location.href !== before, page.url(), { timeout: 5000 }).catch(() => {});

    await page.waitForSelector('.el-form-item', { timeout: 10000 }).catch(() => {});
    let _clicked5 = false;
    let _dt5 = '';
    if (!_clicked5) {
      try {
        await page.locator('xpath=/html/body/div[1]/div/section/div[1]/nav/div[1]/div/div[1]/div/ul/li[1]/ul/li[1]').first().click({ timeout: 3000 });
        _clicked5 = true;
        console.log('[5]   clicked via xpath');
      } catch (_e_xpath5) { console.log('[5]   xpath failed:', _e_xpath5.message); _dt5 += ' | xpath: failed'; }
    }
    if (!_clicked5) {
      try {
        await page.locator(':text-is("对公客户管理")').first().click({ timeout: 3000 });
        _clicked5 = true;
        console.log('[5]   clicked via text');
      } catch (_e_text5) { console.log('[5]   text failed:', _e_text5.message); _dt5 += ' | text: failed'; }
    }
    if (!_clicked5) {
      try {
        await page.evaluate((xp) => {
          const el = document.evaluate(xp, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
          if (el) { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); return true; }
          return false;
        }, '/html/body/div[1]/div/section/div[1]/nav/div[1]/div/div[1]/div/ul/li[1]/ul/li[1]');
        _clicked5 = true;
        console.log('[5]   clicked via JS dispatchEvent');
      } catch (_e_js5) { _dt5 += ' | JS: failed'; }
    }
    if (!_clicked5) {
      try {
        await page.evaluate((text) => {
          const candidates = [...document.querySelectorAll('button, a, span, li, label, .el-button, .el-menu-item')].filter(el => el.offsetParent !== null);
          let best = null, bestScore = 0;
          const t = [...new Set(text.replace(/\s/g,''))];
          for (const el of candidates) {
            const elText = el.textContent?.trim() || '';
            if (!elText) continue;
            const e = [...new Set(elText.replace(/\s/g,''))];
            const common = t.filter(ch => e.includes(ch)).length;
            const score = common / Math.max(t.length, e.length, 1);
            if (score > bestScore) { bestScore = score; best = el; }
          }
          if (best && bestScore >= 0.4) { best.click(); return bestScore; }
          return 0;
        }, '对公客户管理').then(score => {
          if (score > 0) { _clicked5 = true; console.log('[5]   clicked via fuzzy (score=' + score.toFixed(2) + ')'); }
        });
      } catch (_e_fz5) { _dt5 += ' | fuzzy: failed'; }
    }
    if (!_clicked5) {
      _dt5 += ' → page structure changed — re-locate element';
      _recordError(5, 'click_element_by_index', '对公客户管理', '/html/body/div[1]/div/section/div[1]/nav/div[1]/div/div[1]/div/ul/li[1]/ul/li[1]', 'needs-llm-fix', _dt5);
      throw new Error('[5] Click failed: target element not found on page. Stopping — subsequent steps depend on this navigation.');
    }
    // Post-click: check for page navigation
    const _urlBefore5 = page.url();
    await page.evaluate(() => CTRL.waitForLoading());
    let _navigated5 = false;
    try {
      await page.waitForFunction((before) => location.href !== before, _urlBefore5, { timeout: 3000 });
      _navigated5 = true;
    } catch (_e_nav5) { /* no URL change — dialog or in-page action */ }
    if (_navigated5) {
      // Page navigated, wait for full load
      await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
      await page.waitForSelector('.el-menu, .el-table, .el-form-item, .el-tabs, .el-dialog', { timeout: 10000 }).catch(() => {});
    }
    // [6] click_element_by_index
    console.log('[6] Click [49] "新增"');
    await page.waitForFunction(before => location.href !== before, page.url(), { timeout: 5000 }).catch(() => {});

    await page.waitForSelector('.el-form-item', { timeout: 10000 }).catch(() => {});
    let _clicked6 = false;
    let _dt6 = '';
    if (!_clicked6) {
      try {
        await page.locator('xpath=/html/body/div[1]/div/section/div[3]/div[1]/div/main/div/div[1]/div/div/div/div[2]/div/div/form/div[2]/div/div/span[1]/label/button').first().click({ timeout: 3000 });
        _clicked6 = true;
        console.log('[6]   clicked via xpath');
      } catch (_e_xpath6) { console.log('[6]   xpath failed:', _e_xpath6.message); _dt6 += ' | xpath: failed'; }
    }
    if (!_clicked6) {
      try {
        await page.locator(':text-is("新增")').first().click({ timeout: 3000 });
        _clicked6 = true;
        console.log('[6]   clicked via text');
      } catch (_e_text6) { console.log('[6]   text failed:', _e_text6.message); _dt6 += ' | text: failed'; }
    }
    if (!_clicked6) {
      try {
        await page.evaluate((xp) => {
          const el = document.evaluate(xp, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
          if (el) { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); return true; }
          return false;
        }, '/html/body/div[1]/div/section/div[3]/div[1]/div/main/div/div[1]/div/div/div/div[2]/div/div/form/div[2]/div/div/span[1]/label/button');
        _clicked6 = true;
        console.log('[6]   clicked via JS dispatchEvent');
      } catch (_e_js6) { _dt6 += ' | JS: failed'; }
    }
    if (!_clicked6) {
      try {
        await page.evaluate((text) => {
          const candidates = [...document.querySelectorAll('button, a, span, li, label, .el-button, .el-menu-item')].filter(el => el.offsetParent !== null);
          let best = null, bestScore = 0;
          const t = [...new Set(text.replace(/\s/g,''))];
          for (const el of candidates) {
            const elText = el.textContent?.trim() || '';
            if (!elText) continue;
            const e = [...new Set(elText.replace(/\s/g,''))];
            const common = t.filter(ch => e.includes(ch)).length;
            const score = common / Math.max(t.length, e.length, 1);
            if (score > bestScore) { bestScore = score; best = el; }
          }
          if (best && bestScore >= 0.4) { best.click(); return bestScore; }
          return 0;
        }, '新增').then(score => {
          if (score > 0) { _clicked6 = true; console.log('[6]   clicked via fuzzy (score=' + score.toFixed(2) + ')'); }
        });
      } catch (_e_fz6) { _dt6 += ' | fuzzy: failed'; }
    }
    if (!_clicked6) {
      _dt6 += ' → page structure changed — re-locate element';
      _recordError(6, 'click_element_by_index', '新增', '/html/body/div[1]/div/section/div[3]/div[1]/div/main/div/div[1]/div/div/div/div[2]/div/div/form/div[2]/div/div/span[1]/label/button', 'needs-llm-fix', _dt6);
      throw new Error('[6] Click failed: target element not found on page. Stopping — subsequent steps depend on this navigation.');
    }
    // Post-click: check for page navigation
    const _urlBefore6 = page.url();
    await page.evaluate(() => CTRL.waitForLoading());
    let _navigated6 = false;
    try {
      await page.waitForFunction((before) => location.href !== before, _urlBefore6, { timeout: 3000 });
      _navigated6 = true;
    } catch (_e_nav6) { /* no URL change — dialog or in-page action */ }
    if (_navigated6) {
      // Page navigated, wait for full load
      await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
      await page.waitForSelector('.el-menu, .el-table, .el-form-item, .el-tabs, .el-dialog', { timeout: 10000 }).catch(() => {});
    }
    console.log("[FORM-CHECK] Verifying container: drawer:新增客户校验");
    const __fc0 = await page.evaluate((f) => JSON.parse(CTRL.verifyFormStructure(f)), [{"label": "客户状态", "is_required": true}, {"label": "对公客户类型", "is_required": true}, {"label": "证件类型", "is_required": true}, {"label": "客户名称", "is_required": true}, {"label": "证件号码", "is_required": true}]);
    if (__fc0.hasRequiredChange) {
      const _m = __fc0.missing_required.join(",");
      const _a = __fc0.added_required.join(",");
      _recordError(7, "form_structure_changed", "", "", "missing=[" + _m + "] added=[" + _a + "]", JSON.stringify({
        container: "drawer:新增客户校验",
        missing_required: __fc0.missing_required,
        added_required: __fc0.added_required,
        missing_optional: __fc0.missing_optional,
        added_optional: __fc0.added_optional,
        expected_required: __fc0.required_count,
        expected_optional: __fc0.optional_count,
        action_index: 6
      }));
      throw new Error("Form required fields changed: missing=[" + _m + "] added=[" + _a + "]");
    }
    if (__fc0.hasOptionalChange) {
      _recordError(7, "form_warning", "", "", "optional fields changed", JSON.stringify({
        container: "drawer:新增客户校验",
        missing_optional: __fc0.missing_optional,
        added_optional: __fc0.added_optional,
      }), "warning");
      console.log("[FORM-CHECK P3] WARN: Optional fields changed | missing:", JSON.stringify(__fc0.missing_optional), "| added:", JSON.stringify(__fc0.added_optional));
    }
    if (__fc0.reordered && !__fc0.hasRequiredChange && !__fc0.hasOptionalChange) {
      _recordError(7, "form_warning", "", "", "field order changed", JSON.stringify({
        container: "drawer:新增客户校验",
        reordered: true,
      }), "warning");
      console.log("[FORM-CHECK P4] WARN: Field order changed, all fields present");
    }
    console.log("[FORM-CHECK] Verification passed for container: drawer:新增客户校验");
    // [7] select_option
    console.log('[7] Select "对公客户类型" = "企业类"');

    await page.waitForSelector('.el-form-item', { timeout: 10000 }).catch(() => {});
    let _rs7 = await page.evaluate(() => CTRL.selectOption('对公客户类型', '企业类'));
    console.log('[7]   CTRL:', _rs7);
    let _dts7 = 'CTRL: ' + _rs7;
    const _scope7 = await page.evaluate(() => {
      for (const d of document.querySelectorAll('.el-dialog')) if (d.offsetParent !== null) return '.el-dialog';
      for (const d of document.querySelectorAll('.el-drawer')) if (d.offsetParent !== null) return '.el-drawer';
      return '';
    });
    const _base7 = _scope7 ? page.locator(_scope7) : page;
    if (_rs7 !== 'triggered' && _rs7 !== 'triggered-placeholder') {
      console.log('[7]   falling back to Playwright...');
      // Dismiss any stray dropdown before retrying
      await page.keyboard.press('Escape');
      try {
        await _base7.locator('.el-form-item').filter({ hasText: '对公客户类型' }).locator('.el-select .el-input__inner').first().click({ timeout: 3000 });
        await page.evaluate(() => CTRL.waitForLoading());
        const _opt7 = page.locator('.el-select-dropdown__item').filter({ hasText: '企业类' }).first();
        await _opt7.click({ timeout: 3000 });
        _rs7 = 'ok-playwright';
        console.log('[7]   Playwright fallback OK');
      } catch (_e_s7) {
        console.log('[7]   Playwright fallback failed:', _e_s7.message);
        _dts7 += ' | Playwright native: failed';
        _dts7 += ' | absolute XPath: N/A → label_text/option_text may need updating and an absolute XPath may need updating';
        _recordError(7, 'select_option', '对公客户类型', '企业类', 'needs-llm-fix', _dts7);
      }
    }

    // [8] select_option
    console.log('[8] Select "证件类型" = "营业执照"');

    await page.waitForSelector('.el-form-item', { timeout: 10000 }).catch(() => {});
    let _rs8 = await page.evaluate(() => CTRL.selectOption('证件类型', '营业执照'));
    console.log('[8]   CTRL:', _rs8);
    let _dts8 = 'CTRL: ' + _rs8;
    const _scope8 = await page.evaluate(() => {
      for (const d of document.querySelectorAll('.el-dialog')) if (d.offsetParent !== null) return '.el-dialog';
      for (const d of document.querySelectorAll('.el-drawer')) if (d.offsetParent !== null) return '.el-drawer';
      return '';
    });
    const _base8 = _scope8 ? page.locator(_scope8) : page;
    if (_rs8 !== 'triggered' && _rs8 !== 'triggered-placeholder') {
      console.log('[8]   falling back to Playwright...');
      // Dismiss any stray dropdown before retrying
      await page.keyboard.press('Escape');
      try {
        await _base8.locator('.el-form-item').filter({ hasText: '证件类型' }).locator('.el-select .el-input__inner').first().click({ timeout: 3000 });
        await page.evaluate(() => CTRL.waitForLoading());
        const _opt8 = page.locator('.el-select-dropdown__item').filter({ hasText: '营业执照' }).first();
        await _opt8.click({ timeout: 3000 });
        _rs8 = 'ok-playwright';
        console.log('[8]   Playwright fallback OK');
      } catch (_e_s8) {
        console.log('[8]   Playwright fallback failed:', _e_s8.message);
        _dts8 += ' | Playwright native: failed';
        _dts8 += ' | absolute XPath: N/A → label_text/option_text may need updating and an absolute XPath may need updating';
        _recordError(8, 'select_option', '证件类型', '营业执照', 'needs-llm-fix', _dts8);
      }
    }

    // [9] fill_form_field
    console.log('[9] Fill "客户名称" → "测试科技发展有限公司"');

    await page.waitForSelector('.el-form-item', { timeout: 10000 }).catch(() => {});
    // Scope fallback locators to active dialog/drawer
    const _scope9 = await page.evaluate(() => {
      for (const d of document.querySelectorAll('.el-dialog')) if (d.offsetParent !== null) return '.el-dialog';
      for (const d of document.querySelectorAll('.el-drawer')) if (d.offsetParent !== null) return '.el-drawer';
      return '';
    });
    const _base9 = _scope9 ? page.locator(_scope9) : page;
    let _r9 = await page.evaluate((v) => CTRL.fillFormField('客户名称', v), '测试科技发展有限公司');
    console.log('[9]   CTRL:', _r9);
    let _dt9 = 'CTRL: ' + _r9;
    if (_r9 !== 'ok' && _r9 !== 'ok-date' && _r9 !== 'ok-placeholder' && _r9 !== 'ok-fuzzy') {
      console.log('[9]   falling back to Playwright text...');
      try {
        const _fb9 = _base9.locator('.el-form-item').filter({ hasText: '客户名称' }).locator('input:not([type="hidden"]), textarea').first();
        await _fb9.fill('测试科技发展有限公司', { timeout: 3000 });
        _r9 = 'ok-playwright';
        console.log('[9]   Playwright text OK');
      } catch (_e_fb9) {
        console.log('[9]   Playwright fallback failed:', _e_fb9.message);
        _dt9 += ' | Playwright hasText: failed';
        _dt9 += ' | absolute XPath: N/A → label_text may need updating and an absolute XPath may need updating';
        _recordError(9, 'fill_form_field', '客户名称', String('测试科技发展有限公司'), 'needs-llm-fix', _dt9);
      }
    }
    // [10] fill_form_field
    console.log('[10] Fill "证件号码" → "91691717BPJ59WKU0N"');

    await page.waitForSelector('.el-form-item', { timeout: 10000 }).catch(() => {});
    const _v10 = genCreditCode();
    console.log('[10]   generated unique value:', _v10);
    // Scope fallback locators to active dialog/drawer
    const _scope10 = await page.evaluate(() => {
      for (const d of document.querySelectorAll('.el-dialog')) if (d.offsetParent !== null) return '.el-dialog';
      for (const d of document.querySelectorAll('.el-drawer')) if (d.offsetParent !== null) return '.el-drawer';
      return '';
    });
    const _base10 = _scope10 ? page.locator(_scope10) : page;
    let _r10 = await page.evaluate((v) => CTRL.fillFormField('证件号码', v), _v10);
    console.log('[10]   CTRL:', _r10);
    let _dt10 = 'CTRL: ' + _r10;
    if (_r10 !== 'ok' && _r10 !== 'ok-date' && _r10 !== 'ok-placeholder' && _r10 !== 'ok-fuzzy') {
      console.log('[10]   falling back to Playwright text...');
      try {
        const _fb10 = _base10.locator('.el-form-item').filter({ hasText: '证件号码' }).locator('input:not([type="hidden"]), textarea').first();
        await _fb10.fill(_v10, { timeout: 3000 });
        _r10 = 'ok-playwright';
        console.log('[10]   Playwright text OK');
      } catch (_e_fb10) {
        console.log('[10]   Playwright fallback failed:', _e_fb10.message);
        _dt10 += ' | Playwright hasText: failed';
        _dt10 += ' | absolute XPath: N/A → label_text may need updating and an absolute XPath may need updating';
        _recordError(10, 'fill_form_field', '证件号码', String(_v10), 'needs-llm-fix', _dt10);
      }
    }

  } catch (err) {
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
