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
# Wizard exclusion: a stepped wizard drawer (e.g. credit application Step1: 查询/重置/下一步/返回,
# no save) also matches "有查询无保存" but is a FORM, not a query toolbar — treat it as non-query
# (return false) when any of these wizard signals is visible:
#   1. step bar:     .el-steps / .el-step visible in scope;
#   2. stepper nav:  visible buttons contain both 「下一步」 and 「上一步」 (query drawers never have both);
#   3. approval:     visible button 「流程提交」/「流程撤销」 or button/label text containing 「意见」.
# Note: 「返回」 alone is NOT a signal (query drawers have it too). Pure query toolbars
# (查询/重置, no wizard signals) still return true; scope with 保存/提交 still returns false.

JS_IS_QUERY_TOOLBAR = '''(() => {
    const root = ''' + JS_GET_CONTAINER + ''';
    const scope = root === document ? document.body : root;
    if (!scope) return false;
    const visible = (el) => el && el.offsetParent !== null && el.getClientRects().length > 0;
    const stepBar = scope.querySelector('.el-steps, .el-step');
    if (visible(stepBar)) return false; // wizard signal 1: step bar
    const btns = scope.querySelectorAll('button, .el-button, [role="button"]');
    let hasQuery = false;
    let hasSave = false;
    let hasPrev = false; // 「上一步」 — stepper nav signal
    let hasNext = false; // 「下一步」 — stepper nav signal
    let hasFlowBtn = false; // 「流程提交」/「流程撤销」/「意见」 — approval form signal
    for (const b of btns) {
        if (b.offsetParent === null && b.getClientRects().length === 0) continue;
        const t = (b.innerText || b.textContent || '').replace(/\\s+/g, ' ').trim();
        if (!t || t.length > 12) continue;
        if (/^(查询|搜索|查找)$/.test(t)) hasQuery = true;
        if (/^(保存|提交)$/.test(t)) hasSave = true;
        if (t === '上一步') hasPrev = true;
        if (t === '下一步') hasNext = true;
        if (t === '流程提交' || t === '流程撤销') hasFlowBtn = true;
        if (t.includes('意见')) hasFlowBtn = true;
    }
    if ((hasPrev && hasNext) || hasFlowBtn) return false; // wizard signals 2 & 3
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


# ── Locators ──


# Normalize a form label before comparing. Required-field asterisks and trailing
# colons defeat raw equality, so a plain `lbl === label` never fires on
# `*国民经济部门` / `要素名称：` and the caller silently falls through to the
# includes() branch (characterize-prefix-label-select). Strip trailing separators
# then the leading required marker — same normalization as select_trigger._tryItems.
JS_FIELD_LABEL_NORM = '''(s) => String(s || '').replace(/\\s+/g, ' ').trim()
        .replace(/[：:*\\s]+$/g, '').replace(/^[*\\s]+/, '')'''


# Form items whose label means `label`, in priority order: exact-normalized
# matches first, then includes() matches, then (opt-in) reverse-includes.
#
# Why ordering matters: the old shape was one includes() pass that returned the
# first DOM hit, so a sibling whose label merely CONTAINS the target stole the
# field. Three production incidents: 找「要素名称」命中「组件要素名称」、
# 找「国民经济部门」命中「国民经济部门类别」、找「实际控制人客户编号」命中
# 「实际控制人配偶客户编号」. Callers must take candidates in order and treat
# a target-less candidate as "not this field" rather than as a match.
JS_FIELD_ITEM_CANDIDATES = '''(root, label, allowReverse) => {
    const norm = ''' + JS_FIELD_LABEL_NORM + ''';
    const want = norm(label);
    if (!want) return [];
    const exact = [];
    const fwd = [];
    const rev = [];
    for (const item of root.querySelectorAll('.el-form-item')) {
        const lab = norm(item.querySelector('.el-form-item__label')?.textContent);
        if (!lab) continue;
        if (lab === want) exact.push(item);
        else if (lab.includes(want)) fwd.push(item);
        else if (allowReverse && want.includes(lab)) rev.push(item);
    }
    return exact.concat(fwd, rev);
}'''


# Shared live-probe field resolver (fill_engine kind-probe x2, select_dispatch
# _JS_LIVE_TSSC): visibility-bucketed pick on top of JS_FIELD_ITEM_CANDIDATES,
# semantically aligned with the action body tssc_multi_select.findFieldItem —
# visible-exact -> hidden-exact -> unique includes() fallback; multi-hit
# includes() returns an ``ambiguous`` marker instead of silently taking the
# first DOM hit. Scope is the caller's job (JS_GET_CONTAINER first + visible
# dialog/drawer rescan), same as the action body.
# Why: the old probes took candidatesOf(...)[0] — first DOM node, document-wide,
# hidden nodes included — so a hidden same-name node carrying .tssc-multi-select
# made fill_form_field report err-use-tssc-multi-select while select_option's
# findFieldItem resolved the real plain input and said no-tssc-multi-select
# (真机日志 2026-09-16：同字段两探针互相矛盾，agent 反复试错).
JS_FIELD_ITEM_PICK = '''(root, label, allowReverse) => {
    const norm = ''' + JS_FIELD_LABEL_NORM + ''';
    const candidatesOf = ''' + JS_FIELD_ITEM_CANDIDATES + ''';
    const want = norm(label);
    if (!want) return null;
    const visOf = (el) => el.offsetParent !== null || el.getClientRects().length > 0;
    const exactVisible = [];
    const exactAny = [];
    const fuzzy = [];
    for (const item of candidatesOf(root, label, allowReverse)) {
        const lab = norm(item.querySelector('.el-form-item__label')?.textContent);
        if (lab === want) (visOf(item) ? exactVisible : exactAny).push(item);
        else fuzzy.push({ item, lab });
    }
    if (exactVisible.length) return { item: exactVisible[0], via: 'exact' };
    if (exactAny.length) return { item: exactAny[0], via: 'exact-hidden' };
    if (fuzzy.length === 1) return { item: fuzzy[0].item, via: 'includes-unique' };
    if (fuzzy.length > 1) return { ambiguous: fuzzy.map((f) => f.lab) };
    return null;
}'''


JS_LOCATOR = '''(label) => {
    const xpath = (el) => {
        if (!el || el === document || el.nodeType !== 1) return '';
        const parent = el.parentNode;
        const tag = el.tagName.toLowerCase();
        const idx = 1 + [...parent.children].filter(c => c.tagName === el.tagName).indexOf(el);
        return xpath(parent) + '/' + tag + '[' + idx + ']';
    };
    const container = ''' + JS_GET_CONTAINER + ''';
    const candidatesOf = ''' + JS_FIELD_ITEM_CANDIDATES + ''';
    // Walk candidates in priority order; keep going when one carries no control
    // (a label-only or button-only item is not the field being located).
    for (const item of candidatesOf(container, label)) {
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

    // Exact label first, then includes() (and reverse-includes last) — a prefix
    // sibling must not win the field. Visibility stays a filter over the ordered
    // candidates, so an invisible exact match still yields to a visible partial.
    const candidatesOf = ''' + JS_FIELD_ITEM_CANDIDATES + ''';
    const hit = candidatesOf(container, label, true)
      .find(function (it) { return isVisible(it) || it.offsetParent !== null; });
    const matched = hit ? { item: hit, label: formItemLabel(hit) } : null;
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
      field_slot: loc.field_slot,
      display_label: loc.display_label,
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

