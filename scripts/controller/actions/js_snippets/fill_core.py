"""
JS snippet constants: JS_FILL_FORM_FIELD, JS_FILL_BY_XPATH, JS_CAPTURE_FROM_XPATH (extracted from _js_snippets.py).
Re-exported by scripts/controller/actions/_js_snippets.py for backward compat.
"""
from .base import JS_FIELD_DISABLED
from .container import JS_GET_CONTAINER
from ._locator_helpers_js import PAGE_LOCATOR_HELPERS

JS_FILL_FORM_FIELD = '''([label, val]) => {
    const isDisabled = ''' + JS_FIELD_DISABLED + ''';
    const setFn = (t, v) => {
        const TagProto = t.tagName === 'TEXTAREA' ? HTMLTextAreaElement : HTMLInputElement;
        const setter = Object.getOwnPropertyDescriptor(TagProto.prototype, 'value').set;
        setter.call(t, v);
        t.setAttribute('value', v);
        t.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:v}));
        t.dispatchEvent(new Event('change', {bubbles:true}));
        t.dispatchEvent(new Event('blur', {bubbles:true}));
    };
    const container = ''' + JS_GET_CONTAINER + ''';
    const items = container.querySelectorAll('.el-form-item');
    // Pass 1: exact label match
    for (const item of items) {
        const lbl = item.querySelector('.el-form-item__label')?.textContent?.trim() || '';
        if (lbl !== label) continue;
        // Scroll the form-item into view so Element UI components render correctly
        item.scrollIntoView({ block: 'center', behavior: 'instant' });
        const input = item.querySelector('input:not([type="hidden"])');
        const textarea = item.querySelector('textarea');
        const trigger = item.querySelector('.el-select .el-input__inner');
        const target = input || textarea;
        if (!target) return 'no-input-found';
        if (isDisabled(target, trigger, item)) return 'field-disabled';
        // Plain readonly text (not select/date/tree — those use readOnly on purpose)
        if (target.readOnly && !item.querySelector(
            '.el-date-editor, .tsscdatepicker, .el-select, .my-popover, .tree-popover, .el-cascader'
        )) return 'field-disabled';
        if (target.closest('.el-date-editor, .tsscdatepicker')) {
            target.focus();
            try{let w=target.closest('.el-date-editor');if(w){let vm=w.__vue__;while(vm&&vm.$options&&vm.$options.name!=='ElDatePicker')vm=vm.$parent;if(vm){vm.value=val;vm.$emit('input',val);vm.$emit('change',val);vm.date=new Date(val);vm.$emit('pick',new Date(val));}}}catch(e){}
            setFn(target, val);
            target.blur();
            document.querySelectorAll('.el-picker-panel,.el-date-picker').forEach(x=>{x.style.display='none';x.classList.add('is-hidden')});
            return 'ok-date';
        }
        setFn(target, val);
        return 'ok';
    }
    // Pass 2: partial label match (exclude exact matches already tried)
    for (const item of items) {
        const lbl = item.querySelector('.el-form-item__label')?.textContent?.trim() || '';
        if (lbl === label) continue;
        if (!lbl.includes(label)) continue;
        const input = item.querySelector('input:not([type="hidden"])');
        const textarea = item.querySelector('textarea');
        const trigger = item.querySelector('.el-select .el-input__inner');
        const target = input || textarea;
        if (!target) return 'no-input-found';
        if (isDisabled(target, trigger, item)) return 'field-disabled';
        if (target.readOnly && !item.querySelector(
            '.el-date-editor, .tsscdatepicker, .el-select, .my-popover, .tree-popover, .el-cascader'
        )) return 'field-disabled';
        if (target.closest('.el-date-editor, .tsscdatepicker')) {
            target.focus();
            try{let w=target.closest('.el-date-editor');if(w){let vm=w.__vue__;while(vm&&vm.$options&&vm.$options.name!=='ElDatePicker')vm=vm.$parent;if(vm){vm.value=val;vm.$emit('input',val);vm.$emit('change',val);vm.date=new Date(val);vm.$emit('pick',new Date(val));}}}catch(e){}
            setFn(target, val);
            target.blur();
            document.querySelectorAll('.el-picker-panel,.el-date-picker').forEach(x=>{x.style.display='none';x.classList.add('is-hidden')});
            return 'ok-date';
        }
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

# Fill input/textarea resolved by relative xpath (native setter for Element UI).
# Handles el-table fixed columns (offsetParent null) and dialog/drawer [last()] scopes.

JS_FILL_BY_XPATH = r'''([xpath, val, placeholderHint]) => {
  const setFn = (t, v) => {
    const TagProto = t.tagName === 'TEXTAREA' ? HTMLTextAreaElement : HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(TagProto.prototype, 'value').set;
    setter.call(t, v);
    t.setAttribute('value', v);
    t.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: v }));
    t.dispatchEvent(new Event('change', { bubbles: true }));
    t.dispatchEvent(new Event('blur', { bubbles: true }));
  };
  const isVis = (el) => {
    if (!el || el.nodeType !== 1) return false;
    if (el.offsetParent === null && !el.closest('.el-table__fixed')) return false;
    const st = getComputedStyle(el);
    return st.display !== 'none' && st.visibility !== 'hidden';
  };
  const wrapVisible = (d) => {
    if (!d) return false;
    const wrap = d.closest && d.closest('.el-dialog__wrapper, .el-message-box__wrapper, .el-drawer__wrapper');
    if (wrap && getComputedStyle(wrap).display === 'none') return false;
    return isVis(d) || (wrap && isVis(wrap));
  };
  const lastVisibleDialog = () => {
    const all = [...document.querySelectorAll('.el-dialog, .el-message-box')];
    for (let i = all.length - 1; i >= 0; i--) {
      if (wrapVisible(all[i])) return all[i];
    }
    return null;
  };
  const lastVisibleDrawer = () => {
    const all = [...document.querySelectorAll('.el-drawer')];
    for (let i = all.length - 1; i >= 0; i--) {
      if (wrapVisible(all[i])) return all[i];
    }
    return null;
  };
  // LABEL_HINT_DISAMBIG: when xpath hits multiple inputs (shared placeholder /
  // prefix labels like 财务部联系人 → 财务部联系人手机号码), prefer EXACT
  // normalized form-item label, then includes(), then last-visible fallback.
  const normFormLab = (s) => String(s || '').replace(/\s+/g, ' ').trim()
    .replace(/[：:*\s]+$/g, '').replace(/^[*\s]+/, '');
  const formItemLabel = (el) => {
    const item = el && el.closest && el.closest('.el-form-item');
    if (!item) return '';
    const lbl = item.querySelector('.el-form-item__label, label');
    return String((lbl && lbl.textContent) || '').replace(/\s+/g, ' ').trim();
  };
  const findInputFromSnap = (snap, root, labelHint) => {
    const want = String(labelHint || '').trim();
    const wantN = normFormLab(want);
    let fallback = null;
    let exactMatch = null;
    let includesMatch = null;
    for (let i = snap.snapshotLength - 1; i >= 0; i--) {
      const n = snap.snapshotItem(i);
      if (!n || !isVis(n)) continue;
      if (root && root !== document && !root.contains(n)) continue;
      const inner = (n.matches && (n.matches('input, textarea') ? n : null))
        || n.querySelector?.('input:not([type="hidden"]), textarea');
      const target = inner || n;
      if (!fallback) fallback = target;
      if (wantN) {
        const labN = normFormLab(formItemLabel(target));
        if (labN === wantN) {
          exactMatch = target;
          break;
        }
        if (!includesMatch && labN && labN.includes(wantN)) includesMatch = target;
      }
    }
    return exactMatch || includesMatch || fallback;
  };
  const tryXpath = (xp, root, labelHint) => {
    if (!xp) return null;
    let s = String(xp);
    try {
      const ctx = root || document;
      if (root && s.startsWith('//')) s = '.' + s;
      const snap = document.evaluate(s, ctx, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
      return findInputFromSnap(snap, root, labelHint);
    } catch (e) {
      return null;
    }
  };
  const labelHint = String(placeholderHint || '').trim();
  let target = null;
  if (xpath) {
    target = tryXpath(xpath, null, labelHint);
    if (!target && /el-dialog|el-message-box|el-drawer/.test(String(xpath)) && /\[last\(\)\]/.test(String(xpath))) {
      const m = String(xpath).match(/\[last\(\)\](?:\/\/(.+))?$/);
      const local = m && m[1] ? m[1] : '';
      const dlg = /el-drawer/.test(String(xpath)) ? lastVisibleDrawer() : lastVisibleDialog();
      if (dlg && local) target = tryXpath('.//' + local, dlg, labelHint);
    }
  }
  if (!target && labelHint) {
    const want = labelHint;
    if (want) {
      const scopes = [lastVisibleDrawer(), lastVisibleDialog(), document].filter(Boolean);
      for (const scope of scopes) {
        const inputs = scope.querySelectorAll('input:not([type="hidden"]), textarea');
        for (const inp of inputs) {
          if (!isVis(inp) || inp.disabled || inp.readOnly) continue;
          if (inp.closest('.el-date-editor, .tsscdatepicker')) continue;
          const ph = String(inp.getAttribute('placeholder') || '').trim();
          if (!ph) continue;
          if (ph.includes(want)) {
            target = inp;
            break;
          }
        }
        if (target) break;
      }
    }
    if (target) {
      setFn(target, val == null ? '' : String(val));
      return 'ok-placeholder';
    }
  }
  if (!target) return xpath ? 'xpath-not-found' : 'xpath-empty';
  if (target.disabled || target.readOnly) return 'field-disabled';
  if (target.tagName !== 'INPUT' && target.tagName !== 'TEXTAREA') return 'xpath-not-input';
  setFn(target, val == null ? '' : String(val));
  return 'ok-xpath-smart';
}'''

# Stamp element metadata from a write-path xpath; rebuild durable xpath_smart via helpers.

JS_CAPTURE_FROM_XPATH = (
    r'''([xpath_smart, label, target_kind]) => {
'''
    + PAGE_LOCATOR_HELPERS
    + r'''
  const xp = String(xpath_smart || '').trim();
  if (!xp) return null;
  const isVis = (el) => {
    if (!el || el.nodeType !== 1) return false;
    if (el.offsetParent === null && !el.closest('.el-table__fixed')) return false;
    const st = getComputedStyle(el);
    return st.display !== 'none' && st.visibility !== 'hidden';
  };
  const wrapVisible = (d) => {
    if (!d) return false;
    const wrap = d.closest && d.closest('.el-dialog__wrapper, .el-message-box__wrapper, .el-drawer__wrapper');
    if (wrap && getComputedStyle(wrap).display === 'none') return false;
    return isVis(d) || (wrap && isVis(wrap));
  };
  const lastVisibleHost = (drawer) => {
    const sel = drawer ? '.el-drawer' : '.el-dialog, .el-message-box';
    const all = [...document.querySelectorAll(sel)];
    for (let i = all.length - 1; i >= 0; i--) {
      if (wrapVisible(all[i])) return all[i];
    }
    return null;
  };
  const findNodeFromSnap = (snap, root, labelHint) => {
    // LABEL_HINT_DISAMBIG — same rule as JS_FILL_BY_XPATH (exact > includes)
    const want = String(labelHint || '').trim();
    const wantN = String(want || '').replace(/\s+/g, ' ').trim()
      .replace(/[：:*\s]+$/g, '').replace(/^[*\s]+/, '');
    let fallback = null;
    let exactMatch = null;
    let includesMatch = null;
    for (let i = snap.snapshotLength - 1; i >= 0; i--) {
      const n = snap.snapshotItem(i);
      if (!n || !isVis(n)) continue;
      if (root && root !== document && !root.contains(n)) continue;
      if (!fallback) fallback = n;
      if (wantN) {
        const item = n.closest && n.closest('.el-form-item');
        const lbl = item && item.querySelector('.el-form-item__label, label');
        const labN = String((lbl && lbl.textContent) || '').replace(/\s+/g, ' ').trim()
          .replace(/[：:*\s]+$/g, '').replace(/^[*\s]+/, '');
        if (labN === wantN) {
          exactMatch = n;
          break;
        }
        if (!includesMatch && labN && labN.includes(wantN)) includesMatch = n;
      }
    }
    return exactMatch || includesMatch || fallback;
  };
  const tryXpath = (xpath, root, labelHint) => {
    if (!xpath) return null;
    let s = String(xpath);
    try {
      const ctx = root || document;
      if (root && s.startsWith('//')) s = '.' + s;
      const snap = document.evaluate(s, ctx, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
      return findNodeFromSnap(snap, root, labelHint);
    } catch (e) {
      return null;
    }
  };
  let node = tryXpath(xp, null, String(label || '').trim());
  if (!node && /el-dialog|el-message-box|el-drawer/.test(xp) && /\[last\(\)\]/.test(xp)) {
    const m = xp.match(/\[last\(\)\](?:\/\/(.+))?$/);
    const local = m && m[1] ? m[1] : '';
    const dlg = /el-drawer/.test(xp) ? lastVisibleHost(true) : lastVisibleHost(false);
    if (dlg && local) node = tryXpath('.//' + local, dlg, String(label || '').trim());
  }
  if (!node) return null;
  const kind = String(target_kind || '').trim();
  const drillWriteHit = (n, k) => {
    if (!n) return n;
    if (k === 'form_date') {
      const candidates = [];
      if (n.matches && n.matches('input')) candidates.push(n);
      const inner = n.querySelector?.('input:not([type="hidden"])');
      if (inner) candidates.push(inner);
      for (const inp of candidates) {
        if (inp.closest('.el-date-editor, .tsscdatepicker')) return inp;
      }
      const dateInp = n.querySelector?.('.el-date-editor input, .tsscdatepicker input');
      if (dateInp && isVis(dateInp)) return dateInp;
      return n;
    }
    if (k === 'form_input') {
      const inner = (n.matches && (n.matches('input, textarea') ? n : null))
        || n.querySelector?.('input:not([type="hidden"]), textarea');
      return inner || n;
    }
    return n;
  };
  node = drillWriteHit(node, kind);
  const formLbl = normalizeFormLabel(String(label || '')) || (function () {
    const item = node.closest && node.closest('.el-form-item');
    const lbl = item && item.querySelector('.el-form-item__label, label');
    return normalizeFormLabel(lbl && lbl.textContent);
  })();
  const host = (typeof normalizeTargetRoot === 'function' ? (normalizeTargetRoot(node) || node) : node);
  const smart = (typeof formFieldXpathSmartOf === 'function'
    ? (formFieldXpathSmartOf(host, formLbl) || '')
    : '');
  const abs = absXPath(host);
  const primary = smart || abs;
  const tag = (host.tagName || '').toLowerCase();
  const attrs = {};
  for (const a of host.attributes || []) attrs[a.name] = a.value;
  const text = (host.innerText || host.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 200);
  return {
    xpath: primary,
    xpath_smart: smart,
    xpath_full: abs,
    css_sel: '',
    tag,
    attrs,
    text,
    formLabel: formLbl || String(label || ''),
    target_kind: String(target_kind || ''),
    candidates: [
      ...(smart ? [{ type: 'xpath_smart', value: smart }] : []),
      ...(abs ? [{ type: 'xpath_full', value: abs }] : []),
    ],
  };
}'''
)

# Fill date picker resolved by relative xpath (native setter + ElDatePicker Vue sync).
