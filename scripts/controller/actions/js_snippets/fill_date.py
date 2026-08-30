"""
JS snippet constants: JS_FILL_DATE_BY_XPATH, JS_CLICK_RADIO_BY_XPATH, JS_FILL_DATE_FIELD (extracted from _js_snippets.py).
Re-exported by scripts/controller/actions/_js_snippets.py for backward compat.
"""
from .base import JS_FIELD_DISABLED
from .container import JS_GET_CONTAINER

# Shared Vue commit: ElDatePicker AND TsscMultiDatePicker (.tsscdatepicker).
# Walking only to name==='ElDatePicker' skips Tssc → form.model stays empty.
JS_COMMIT_DATE_VUE_BODY = r'''
    const commitDateVue = (target, val) => {
      if (!target) return;
      const isDateVm = (vm) => {
        const n = (vm && vm.$options && vm.$options.name) || '';
        return n === 'ElDatePicker' || n === 'TsscMultiDatePicker' || /DatePicker/i.test(n);
      };
      const emitValOf = (vm, raw) => {
        const s = String(raw == null ? '' : raw).trim();
        try {
          const vf = (vm && (vm.valueFormat || (vm.$props && vm.$props.valueFormat))) || '';
          if (/H|h|m|s/.test(String(vf)) && /^\d{4}-\d{2}-\d{2}$/.test(s)) return s + ' 00:00:00';
        } catch (e) {}
        return s;
      };
      try {
        const w = target.closest && target.closest('.el-date-editor, .tsscdatepicker');
        let vm = (w && w.__vue__) || target.__vue__;
        let guard = 0;
        while (vm && vm.$options && !isDateVm(vm) && guard < 12) {
          vm = vm.$parent;
          guard += 1;
        }
        if (vm && isDateVm(vm)) {
          const out = emitValOf(vm, val);
          vm.value = out;
          vm.$emit('input', out);
          vm.$emit('change', out);
          try { vm.date = new Date(val); } catch (e) {}
          try { vm.$emit('pick', new Date(val)); } catch (e) {}
        }
        const item = target.closest && target.closest('.el-form-item');
        let fivm = item && item.__vue__;
        guard = 0;
        while (fivm && fivm.$options && fivm.$options.name !== 'ElFormItem' && guard < 8) {
          fivm = fivm.$parent;
          guard += 1;
        }
        if (fivm && fivm.prop && fivm.form && fivm.form.model) {
          const parts = String(fivm.prop).split('.');
          let cur = fivm.form.model;
          for (let i = 0; i < parts.length - 1; i++) {
            if (cur[parts[i]] == null || typeof cur[parts[i]] !== 'object') cur[parts[i]] = {};
            cur = cur[parts[i]];
          }
          const key = parts[parts.length - 1];
          let modelVal = String(val == null ? '' : val).trim();
          const existing = cur[key];
          if (typeof existing === 'string' && / 00:00:00$/.test(existing) && /^\d{4}-\d{2}-\d{2}$/.test(modelVal)) {
            modelVal = modelVal + ' 00:00:00';
          } else if (vm && isDateVm(vm)) {
            modelVal = emitValOf(vm, val);
          }
          cur[key] = modelVal;
          try { fivm.$emit('el.form.change', modelVal); } catch (e) {}
        }
      } catch (e) {}
    };
'''

JS_FILL_DATE_BY_XPATH = r'''([xpath, val]) => {
''' + JS_COMMIT_DATE_VUE_BODY + r'''
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
  const findDateInputFromSnap = (snap, root) => {
    for (let i = snap.snapshotLength - 1; i >= 0; i--) {
      const n = snap.snapshotItem(i);
      if (!n || !isVis(n)) continue;
      if (root && root !== document && !root.contains(n)) continue;
      const candidates = [];
      if (n.matches && n.matches('input')) candidates.push(n);
      const inner = n.querySelector?.('input:not([type="hidden"])');
      if (inner) candidates.push(inner);
      for (const inp of candidates) {
        if (inp.closest('.el-date-editor, .tsscdatepicker')) return inp;
      }
      const dateInp = n.querySelector?.('.el-date-editor input, .tsscdatepicker input');
      if (dateInp && isVis(dateInp)) return dateInp;
    }
    return null;
  };
  const tryXpath = (xp, root) => {
    if (!xp) return null;
    let s = String(xp);
    try {
      const ctx = root || document;
      if (root && s.startsWith('//')) s = '.' + s;
      const snap = document.evaluate(s, ctx, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
      return findDateInputFromSnap(snap, root);
    } catch (e) {
      return null;
    }
  };
  if (!xpath) return 'xpath-empty';
  if (isNaN(new Date(val).getTime())) return 'invalid-date:' + val;
  let target = tryXpath(xpath, null);
  if (!target && /el-dialog|el-message-box|el-drawer/.test(String(xpath)) && /\[last\(\)\]/.test(String(xpath))) {
    const m = String(xpath).match(/\[last\(\)\](?:\/\/(.+))?$/);
    const local = m && m[1] ? m[1] : '';
    const dlg = /el-drawer/.test(String(xpath)) ? lastVisibleDrawer() : lastVisibleDialog();
    if (dlg && local) target = tryXpath('.//' + local, dlg);
  }
  if (!target) return 'xpath-not-found';
  if (target.disabled) return 'field-disabled';
  // Scroll the form-item (or target) into view so Element UI date picker renders correctly.
  try {
    const item = target.closest && target.closest('.el-form-item');
    (item || target).scrollIntoView({ block: 'center', behavior: 'instant' });
  } catch (e) {}
  target.focus();
  commitDateVue(target, val);
  setFn(target, val);
  target.blur();
  document.querySelectorAll('.el-picker-panel,.el-date-picker').forEach(x => {
    x.style.display = 'none';
    x.classList.add('is-hidden');
  });
  return 'ok-date-xpath-smart';
}'''

# Click el-radio / el-checkbox option resolved by relative xpath.

JS_CLICK_RADIO_BY_XPATH = r'''([xpath, option]) => {
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
  const findNodeFromSnap = (snap, root) => {
    for (let i = snap.snapshotLength - 1; i >= 0; i--) {
      const n = snap.snapshotItem(i);
      if (!n || !isVis(n)) continue;
      if (root && root !== document && !root.contains(n)) continue;
      return n;
    }
    return null;
  };
  const tryXpath = (xp, root) => {
    if (!xp) return null;
    let s = String(xp);
    try {
      const ctx = root || document;
      if (root && s.startsWith('//')) s = '.' + s;
      const snap = document.evaluate(s, ctx, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
      return findNodeFromSnap(snap, root);
    } catch (e) {
      return null;
    }
  };
  const clickInHost = (host, want) => {
    if (!host) return 'xpath-not-found';
    const pick = (items) => {
      for (const item of items) {
        if (item.classList.contains('is-disabled')) continue;
        if (item.textContent.trim() === want && item.offsetParent !== null) {
          item.click();
          return 'ok';
        }
      }
      for (const item of items) {
        if (item.classList.contains('is-disabled')) continue;
        if (item.textContent.trim().includes(want) && item.offsetParent !== null) {
          item.click();
          return 'ok';
        }
      }
      return 'option-not-found';
    };
    const resolveGroupHost = (node) => {
      if (!node) return null;
      return node.closest?.('.el-radio-group')
        || node.closest?.('.el-checkbox-group')
        || node.closest?.('td, .el-table__cell')
        || node.closest?.('tr')
        || node.closest?.('.el-form-item')
        || node;
    };
    const hostEl = resolveGroupHost(host);
    const radios = hostEl.querySelectorAll('.el-radio');
    if (radios.length) return pick(radios);
    const boxes = hostEl.querySelectorAll('.el-checkbox');
    if (boxes.length) return pick(boxes);
    if (host.matches?.('.el-radio, .el-checkbox')) {
      if (!host.classList.contains('is-disabled') && host.textContent.trim().includes(want)) {
        host.click();
        return 'ok';
      }
    }
    return 'option-not-found';
  };
  if (!xpath) return 'xpath-empty';
  const want = String(option || '');
  let node = tryXpath(xpath, null);
  if (!node && /el-dialog|el-message-box|el-drawer/.test(String(xpath)) && /\[last\(\)\]/.test(String(xpath))) {
    const m = String(xpath).match(/\[last\(\)\](?:\/\/(.+))?$/);
    const local = m && m[1] ? m[1] : '';
    const dlg = /el-drawer/.test(String(xpath)) ? lastVisibleDrawer() : lastVisibleDialog();
    if (dlg && local) node = tryXpath('.//' + local, dlg);
  }
  if (!node) return 'xpath-not-found';
  // Scroll the form-item (or node) into view so Element UI radio/checkbox renders correctly.
  try {
    const item = node.closest && node.closest('.el-form-item');
    (item || node).scrollIntoView({ block: 'center', behavior: 'instant' });
  } catch (e) {}
  return clickInHost(node, want);
}'''

# ── Select / dropdown ──

