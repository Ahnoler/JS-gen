"""
JS snippet constants: JS_FILL_FORM_FIELD, JS_FILL_BY_XPATH, JS_CAPTURE_FROM_XPATH (extracted from _js_snippets.py).
Re-exported by scripts/controller/actions/_js_snippets.py for backward compat.
"""
from .base import JS_FIELD_DISABLED
from .container import JS_GET_CONTAINER

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
  const findInputFromSnap = (snap, root) => {
    let target = null;
    for (let i = snap.snapshotLength - 1; i >= 0; i--) {
      const n = snap.snapshotItem(i);
      if (!n || !isVis(n)) continue;
      if (root && root !== document && !root.contains(n)) continue;
      const inner = (n.matches && (n.matches('input, textarea') ? n : null))
        || n.querySelector?.('input:not([type="hidden"]), textarea');
      target = inner || n;
      break;
    }
    return target;
  };
  const tryXpath = (xp, root) => {
    if (!xp) return null;
    let s = String(xp);
    try {
      const ctx = root || document;
      if (root && s.startsWith('//')) s = '.' + s;
      const snap = document.evaluate(s, ctx, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
      return findInputFromSnap(snap, root);
    } catch (e) {
      return null;
    }
  };
  let target = null;
  if (xpath) {
    target = tryXpath(xpath, null);
    if (!target && /el-dialog|el-message-box|el-drawer/.test(String(xpath)) && /\[last\(\)\]/.test(String(xpath))) {
      const m = String(xpath).match(/\[last\(\)\](?:\/\/(.+))?$/);
      const local = m && m[1] ? m[1] : '';
      const dlg = /el-drawer/.test(String(xpath)) ? lastVisibleDrawer() : lastVisibleDialog();
      if (dlg && local) target = tryXpath('.//' + local, dlg);
    }
  }
  if (!target && placeholderHint) {
    const want = String(placeholderHint || '').trim();
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

# Stamp element metadata from a write-path xpath (no label→SMART_LOCATOR generation).

JS_CAPTURE_FROM_XPATH = r'''([xpath_smart, label, target_kind]) => {
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
  const findNodeFromSnap = (snap, root) => {
    for (let i = snap.snapshotLength - 1; i >= 0; i--) {
      const n = snap.snapshotItem(i);
      if (!n || !isVis(n)) continue;
      if (root && root !== document && !root.contains(n)) continue;
      return n;
    }
    return null;
  };
  const tryXpath = (xpath, root) => {
    if (!xpath) return null;
    let s = String(xpath);
    try {
      const ctx = root || document;
      if (root && s.startsWith('//')) s = '.' + s;
      const snap = document.evaluate(s, ctx, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
      return findNodeFromSnap(snap, root);
    } catch (e) {
      return null;
    }
  };
  const absXPath = (node) => {
    if (!node || node.nodeType !== 1) return '';
    const parts = [];
    let cur = node;
    while (cur && cur.nodeType === 1) {
      const tag = cur.tagName.toLowerCase();
      const parent = cur.parentNode;
      if (!parent) break;
      const sibs = [...parent.children].filter(c => c.tagName === cur.tagName);
      const idx = sibs.indexOf(cur) + 1;
      parts.unshift(tag + '[' + idx + ']');
      cur = parent;
      if (cur === document.documentElement) {
        parts.unshift('html[1]');
        break;
      }
    }
    return '/' + parts.join('/');
  };
  let node = tryXpath(xp, null);
  if (!node && /el-dialog|el-message-box|el-drawer/.test(xp) && /\[last\(\)\]/.test(xp)) {
    const m = xp.match(/\[last\(\)\](?:\/\/(.+))?$/);
    const local = m && m[1] ? m[1] : '';
    const dlg = /el-drawer/.test(xp) ? lastVisibleHost(true) : lastVisibleHost(false);
    if (dlg && local) node = tryXpath('.//' + local, dlg);
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
  const abs = absXPath(node);
  const tag = (node.tagName || '').toLowerCase();
  const attrs = {};
  for (const a of node.attributes || []) attrs[a.name] = a.value;
  const text = (node.innerText || node.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 200);
  return {
    xpath: xp,
    xpath_smart: xp,
    xpath_full: abs,
    css_sel: '',
    tag,
    attrs,
    text,
    formLabel: String(label || ''),
    target_kind: String(target_kind || ''),
    candidates: [
      { type: 'xpath_smart', value: xp },
      { type: 'xpath_full', value: abs },
    ],
  };
}'''

# Fill date picker resolved by relative xpath (native setter + ElDatePicker Vue sync).
