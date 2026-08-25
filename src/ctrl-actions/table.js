/**
 * CTRL_OBJECT part: waitForLoading / switchTab / expandAllTreeNodes / fillAddressFields / clickTableRowButton / clickTableRowRadio.
 * Concatenated with sibling parts into CTRL_OBJECT in index.js —
 * do not change indentation, braces, or the trailing comma; the
 * assembled string must stay byte-identical (characterize-ctrl.mjs).
 */
export const CTRL_PART_TABLE = `  waitForLoading: () => new Promise(resolve => { let el=0; const ck=()=>{ if(el>=30000){resolve('timeout');return; } const busy=document.querySelector('.el-loading-mask:not(.el-loading-mask--hidden), .el-loading-spinner, [class*=\"loading-spinner\"], [class*=\"loading-mask\"]:not([class*=\"hidden\"])'); if(!busy||busy.offsetParent===null){ const anims=document.getAnimations?document.getAnimations().filter(a=>a.playState==='running'):[]; if(anims.length===0) resolve(); else { el+=100; setTimeout(ck,100); } } else { el+=200; setTimeout(ck,200); } }; ck(); }),
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
	    const _cellTexts = (row) => { const cs = row.querySelectorAll('td, .el-table__cell'); const out = []; for (const c of cs) { const t = (c.innerText || c.textContent || '').trim().replace(/\s+/g, ' '); if (t && t !== 'radio' && t !== 'checkbox') out.push(t); } return out; };
	    const _rows = document.querySelectorAll('.el-table__body-wrapper .el-table__row');
	    let row = null;
	    for (const r of _rows) { const ts = _cellTexts(r); for (const t of ts) { if (t === rowText) { row = r; break; } } if (row) break; }
	    if (!row) { for (const r of _rows) { if ((r.textContent || '').includes(rowText)) { row = r; break; } } }
	    if (!row) return 'row-not-found';
	    const _tryRow = (row) => {
		      row.scrollIntoView({ block: 'center', behavior: 'instant' });
	      for (const btn of row.querySelectorAll('button,.el-button,i[class*="icon"]')) {
	        const t=btn.textContent?.trim()||'', c=btn.className||'';
	        if (t.includes(btnText) || c.includes(btnText.toLowerCase())) { if (btn.offsetParent!==null) { btn.click(); return 'ok'; } }
	      }
	      if (btnText==='edit'||btnText==='编辑') { const ic=row.querySelector('i.el-icon-edit,i[class*="bianji"],i[class*="edit"],i[class*="xiugai"]'); if (ic&&ic.offsetParent!==null) { ic.click(); return 'ok-icon'; } }
	      if (btnText==='delete'||btnText==='删除') { const ic=row.querySelector('i.el-icon-delete,i[class*="shanchu"],i[class*="delete"]'); if (ic&&ic.offsetParent!==null) { ic.click(); return 'ok-icon'; } }
	      for (const btn of row.querySelectorAll('button,.el-button')) { if (btn.offsetParent!==null) { btn.click(); return 'ok-fallback'; } }
	      return 'button-not-found';
	    };
	    return _tryRow(row);
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
	    const _rcellTexts = (row) => { const cs = row.querySelectorAll('td, .el-table__cell'); const out = []; for (const c of cs) { const t = (c.innerText || c.textContent || '').trim().replace(/\s+/g, ' '); if (t && t !== 'radio' && t !== 'checkbox') out.push(t); } return out; };
	    const _rowMatches = (row) => { if (wantFirst) return true; const ts = _rcellTexts(row); for (const t of ts) { if (t === rowText) return true; } return (row.textContent || '').includes(rowText); };
	    const tables = document.querySelectorAll('.el-table');
	    for (const table of tables) {
	      const bodyRows = table.querySelectorAll('.el-table__body-wrapper tbody tr.el-table__row, .el-table__body-wrapper tbody tr');
	      for (let i = 0; i < bodyRows.length; i++) {
	        const row = bodyRows[i];
	        if (!_rowMatches(row)) continue;
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
`;
