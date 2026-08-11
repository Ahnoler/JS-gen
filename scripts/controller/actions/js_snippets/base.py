"""
JS snippet constants: JS_IDENTIFY_CONTAINER, JS_IS_QUERY_TOOLBAR, JS_WAIT_LOADING, JS_CHECK_LOADING, JS_NATIVE_SETTER, JS_LOCATOR, JS_SMART_LOCATOR, JS_FIELD_DISABLED (extracted from _js_snippets.py).
Re-exported by scripts/controller/actions/_js_snippets.py for backward compat.
"""
from .container import JS_GET_CONTAINER
from ._locator_helpers_js import PAGE_LOCATOR_HELPERS

JS_IDENTIFY_CONTAINER = '''(() => {
    const c = ''' + JS_GET_CONTAINER + ''';
    if (c === document) return 'main';
    if (c.classList.contains('el-dialog')) {
        const t = (c.querySelector('.el-dialog__title')?.textContent || '').trim() || 'unnamed';
        return 'dialog:' + t;
    }
    if (c.classList.contains('el-drawer')) {
        const l = c.getAttribute('aria-label') || 'unnamed';
        return 'drawer:' + l;
    }
    const tp = c.closest('.el-tab-pane');
    if (tp) {
        const tabs = tp.closest('.el-tabs');
        if (tabs) {
            const a = tabs.querySelector('.el-tabs__item.is-active');
            if (a) return 'tab:' + a.textContent.trim();
        }
    }
    return 'unknown:' + (c.tagName || 'unknown');
})()'''

# True when visible scope has 查询/搜索 and no 保存/提交 (list filter / query dialog).

JS_IS_QUERY_TOOLBAR = '''(() => {
    const root = ''' + JS_GET_CONTAINER + ''';
    const scope = root === document ? document.body : root;
    if (!scope) return false;
    const btns = scope.querySelectorAll('button, .el-button, [role="button"]');
    let hasQuery = false;
    let hasSave = false;
    for (const b of btns) {
        if (b.offsetParent === null && b.getClientRects().length === 0) continue;
        const t = (b.innerText || b.textContent || '').replace(/\\s+/g, ' ').trim();
        if (!t || t.length > 12) continue;
        if (/^(查询|搜索|查找)$/.test(t)) hasQuery = true;
        if (/^(保存|提交)$/.test(t)) hasSave = true;
    }
    return hasQuery && !hasSave;
})()'''

# ── Loading / waiting ──


JS_WAIT_LOADING = '''() => new Promise(resolve => {
    let elapsed = 0;
    const check = () => {
        if (elapsed >= 30000) { resolve('timeout'); return; }
        const mask = document.querySelector('.el-loading-mask:not(.el-loading-mask--hidden)');
        if (!mask || mask.offsetParent === null) resolve();
        else { elapsed += 200; setTimeout(check, 200); }
    };
    check();
})'''


JS_CHECK_LOADING = '''() => {
    const mask = document.querySelector('.el-loading-mask:not(.el-loading-mask--hidden)');
    return mask && mask.offsetParent !== null;
}'''


JS_NATIVE_SETTER = ''  # Inlined in JS_FILL_FORM_FIELD

# ── Locators ──


JS_LOCATOR = '''(label) => {
    const xpath = (el) => {
        if (!el || el === document || el.nodeType !== 1) return '';
        const parent = el.parentNode;
        const tag = el.tagName.toLowerCase();
        const idx = 1 + [...parent.children].filter(c => c.tagName === el.tagName).indexOf(el);
        return xpath(parent) + '/' + tag + '[' + idx + ']';
    };
    const container = ''' + JS_GET_CONTAINER + ''';
    const items = container.querySelectorAll('.el-form-item');
    for (const item of items) {
        const lbl = item.querySelector('.el-form-item__label');
        if (!lbl) continue;
        const t = lbl.textContent.trim();
        if (t !== label && !t.includes(label)) continue;
        const target = item.querySelector('input:not([type="hidden"]), textarea, .el-select .el-input__inner');
        if (target) return JSON.stringify({xpath: xpath(target), tag: target.tagName.toLowerCase(), attrs: (()=>{const a={};for(const at of target.attributes) if(at.value&&at.value.length<100) a[at.name]=at.value; return a;})()});
    }
    return '';
}'''


JS_SMART_LOCATOR = '''([label]) => {
''' + PAGE_LOCATOR_HELPERS + '''
    const container = ''' + JS_GET_CONTAINER + ''';
    const want = normalizeFormLabel(label);
    if (!want) return '';

    function formItemLabel(item) {
      const lbl = item.querySelector('.el-form-item__label');
      return normalizeFormLabel(lbl && lbl.textContent);
    }
    function pickControl(item) {
      const candidates = [
        item.querySelector('.el-tree-select'),
        item.querySelector('.el-cascader'),
        item.querySelector('span.my-popover, .my-popover'),
        item.querySelector('.el-select'),
        item.querySelector('.el-date-editor'),
        item.querySelector('.el-radio-group'),
        item.querySelector('.el-checkbox-group'),
        item.querySelector('.el-textarea__inner'),
        item.querySelector('textarea'),
        Array.from(item.querySelectorAll('.el-input__inner, input:not([type="hidden"])'))
          .find(function (inp) { return !inp.closest('.el-popover, .tree-popover'); }),
      ].filter(Boolean);
      return candidates[0] || null;
    }

    let matched = null;
    const items = container.querySelectorAll('.el-form-item');
    for (const item of items) {
      if (!isVisible(item) && item.offsetParent === null) continue;
      const lbl = formItemLabel(item);
      if (!lbl) continue;
      if (lbl === want || lbl.includes(want) || want.includes(lbl)) {
        matched = { item, label: lbl };
        if (lbl === want) break;
      }
    }
    let target = matched ? pickControl(matched.item) : null;
    let formLabel = matched ? matched.label : '';
    if (!target) {
      for (const inp of container.querySelectorAll('input:not([type="hidden"]), textarea')) {
        const ph = String(inp.placeholder || '');
        if (ph && (ph.includes(label) || normalizeFormLabel(ph) === want) && isVisible(inp)) {
          target = inp;
          formLabel = want;
          break;
        }
      }
    }
    if (!target) return '';
    const host = normalizeTargetRoot(target) || target;
    const abs = absXPath(host);
    const loc = buildLocatorSnap(host, cleanVisibleText(host), abs, formLabel);
    return JSON.stringify({
      xpath: loc.xpath || abs,
      css_sel: loc.cssSelector || '',
      tag: loc.tag || (host.tagName || '').toLowerCase(),
      attrs: loc.attributes || {},
      xpath_smart: loc.xpath_smart || '',
      xpath_full: loc.xpath_full || abs,
      xpath_abs: abs,
      candidates: loc.candidates || [],
      text: loc.text || '',
      formLabel: loc.formLabel || formLabel,
      target_kind: loc.target_kind,
      locator_scope: loc.locator_scope,
      locator_occurrence: loc.locator_occurrence,
      locator_verified: loc.locator_verified,
      locator_strategy: loc.locator_strategy,
      locator_fallback_reason: loc.locator_fallback_reason,
    });
}'''

# ── Shared: is form-item control disabled? (scan / fill / select / tree / radio) ──
# Single source for "editable vs read-only". Native input.disabled alone is NOT enough:
# TsscMultiTree / TsscInput keep <input> enabled while Vue props.disabled=true
# (e.g. 新增弹窗「分类目录」). Also honor Element UI .is-disabled wrappers.
# Do NOT treat input readOnly as disabled (el-select / date inputs are often readOnly).


JS_FIELD_DISABLED = '''(inputEl, trigger, item) => {
    if (trigger && trigger.disabled) return true;
    if (inputEl && inputEl.disabled) return true;
    const root = item
        || (inputEl && inputEl.closest && inputEl.closest('.el-form-item'))
        || (trigger && trigger.closest && trigger.closest('.el-form-item'));
    if (!root) return false;
    const content = root.querySelector('.el-form-item__content') || root;
    if (content.querySelector(
        '.el-input.is-disabled, .el-textarea.is-disabled, .el-select.is-disabled,'
        + ' .el-radio-group.is-disabled, .el-checkbox-group.is-disabled,'
        + ' .el-cascader.is-disabled, .el-date-editor.is-disabled,'
        + ' .el-radio.is-disabled, .el-checkbox.is-disabled'
    )) return true;
    const hosts = content.querySelectorAll(
        '.my-popover, .tree-popover, [class*="tssc"], .el-select, .el-input,'
        + ' .el-cascader, .el-date-editor, .el-radio-group, .el-checkbox-group'
    );
    for (const host of hosts) {
        let v = host.__vue__;
        let depth = 0;
        while (v && depth < 10) {
            const n = (v.$options && v.$options.name) ? String(v.$options.name) : '';
            if (
                n.includes('TsscMultiTree') || n.includes('TsscInput') || n.includes('TsscSelect')
                || n.includes('TsscDate') || n === 'ElSelect' || n === 'ElInput'
                || n === 'ElCascader' || n === 'ElDatePicker' || n === 'ElRadioGroup'
                || n === 'ElCheckboxGroup'
            ) {
                if (v.disabled === true || (v.$props && v.$props.disabled === true)) return true;
            }
            v = v.$parent;
            depth++;
        }
    }
    return false;
}'''

# ── Fill form field ──

