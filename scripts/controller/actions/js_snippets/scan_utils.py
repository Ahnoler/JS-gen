"""
JS snippet constants: JS_CLASSIFY_FIELD, JS_FIELD_REQUIRED, JS_READ_CURRENT_VALUE, JS_SECTION_ATTACH_BLOCK, JS_SCROLL_TO_FIRST_ERROR (extracted from _js_snippets.py).
Re-exported by scripts/controller/actions/_js_snippets.py for backward compat.
"""
from .container import JS_GET_CONTAINER

JS_CLASSIFY_FIELD = '''(item) => {
    if (item.querySelector('.el-date-editor, .tsscdatepicker, [class*="date-picker"], [class*="datepicker"]')) return 'date';
    const el = item.querySelector('input:not([type="hidden"])');
    if (el && el.closest('.el-date-editor, .tsscdatepicker')) return 'date';
    if (el && (el.getAttribute('type') === 'date')) return 'date';
    // TsscMultiTree / Element tree-select BEFORE .el-select (Tssc wraps el-select).
    // Do NOT use bare .el-tree — product/category sidebars also use .el-tree.
    if (item.querySelector(
        '.tree-popover, .tsscTree, .el-tree-select,'
        + ' [class*="tsscmultitree"], [class*="TsscMultiTree"]'
    )) return 'tree-select';
    // .my-popover alone is ambiguous — only tree-select when Vue ancestry is TsscMultiTree
    const popHosts = item.querySelectorAll('.my-popover, [class*="tssc"]');
    for (const host of popHosts) {
        let v = host.__vue__;
        while (v) {
            const n = (v.$options && v.$options.name) ? String(v.$options.name) : '';
            if (n.includes('TsscMultiTree')) return 'tree-select';
            v = v.$parent;
        }
    }
    if (item.querySelector('.el-select')) return 'select';
    if (item.querySelector('.el-radio')) return 'radio';
    if (item.querySelector('.el-checkbox')) return 'checkbox';
    if (el || item.querySelector('textarea')) return 'input';
    return 'unknown';
}'''

# JS_FIELD_DISABLED is defined once above (before fill/select) — single source for editable checks.


JS_FIELD_REQUIRED = '''(item, label, inputEl) => {
    const hasRequiredClass = !!(item.matches('.is-required') || item.querySelector('.is-required, .el-form-item__label .el-form-item__label--required'));
    const hasAsterisk = /\\*/.test(label);
    const hasNativeRequired = (inputEl?.required) || (inputEl?.getAttribute('aria-required') === 'true');
    return hasRequiredClass || hasAsterisk || hasNativeRequired;
}'''


JS_READ_CURRENT_VALUE = '''(inputEl, trigger, item) => {
    // Radio / checkbox: input.value is the option's value attribute, NOT selection state.
    // Unchecked radios still have value="1"/value="对公" → must only read checked UI.
    if (item && item.querySelector('.el-radio')) {
        const checked = item.querySelector('.el-radio.is-checked');
        if (!checked) return '';
        const lab = checked.querySelector('.el-radio__label');
        return ((lab && lab.textContent) || checked.textContent || '').replace(/\\s+/g, ' ').trim();
    }
    if (item && item.querySelector('.el-checkbox')) {
        const checkedBoxes = item.querySelectorAll('.el-checkbox.is-checked');
        if (!checkedBoxes.length) return '';
        return [...checkedBoxes].map(c => {
            const lab = c.querySelector('.el-checkbox__label');
            return ((lab && lab.textContent) || c.textContent || '').replace(/\\s+/g, ' ').trim();
        }).filter(Boolean).join(',');
    }
    // 1. primary input/textarea
    let val = inputEl?.value || trigger?.value || '';
    // 2. multi-input fallback (tree-select may have two inputs)
    if (!val) {
        const allInputs = item.querySelectorAll('input:not([type="hidden"])');
        for (const inp of allInputs) {
            if (inp.type === 'radio' || inp.type === 'checkbox') continue;
            if (inp.value && inp.value.trim()) { val = inp.value.trim(); break; }
        }
    }
    // 3. ARIA attributes
    if (!val) {
        const ariaInput = item.querySelector('[aria-valuetext]') || item.querySelector('[aria-valuenow]');
        if (ariaInput) val = ariaInput.getAttribute('aria-valuetext') || ariaInput.getAttribute('aria-valuenow') || '';
    }
    // 4. trigger aria/title fallback
    if (!val && trigger) val = trigger.getAttribute('aria-label') || trigger.getAttribute('title') || '';
    return val;
}'''

# ── Form field scanning ──

# Shared collapse/tab/card section attach (scan + click_save use same title#n dedupe).

JS_SECTION_ATTACH_BLOCK = r'''
    const emptySectionAssign = () => ({
        section_id: '__root__',
        section_title: '',
        region_label: '',
        region_role: '',
        region_id: '',
    });
    const withRegionMirror = (reg) => {
        if (!reg || typeof reg !== 'object') {
            return emptySectionAssign();
        }
        const label = String(reg.region_label || '').trim();
        const rid = String(reg.region_id || '').trim();
        if (!label && !rid) {
            return emptySectionAssign();
        }
        // LEGACY_SECTION_RETIRE: mirror L1 region_* → section_* for dual-read compat (click_save).
        return {
            section_id: rid || '__root__',
            section_title: label,
            region_label: label,
            region_role: reg.region_role || '',
            region_id: rid,
        };
    };
    const attachSection = (field, el) => {
        if (!el) {
            Object.assign(field, emptySectionAssign());
            return;
        }
        if (typeof assignRegion !== 'function') {
            Object.assign(field, emptySectionAssign());
            return;
        }
        Object.assign(field, withRegionMirror(assignRegion(el)));
    };
'''


JS_SCROLL_TO_FIRST_ERROR = '''() => {
    const container = ''' + JS_GET_CONTAINER + ''';
    // Pass 1: .el-form-item.is-error (Element UI sets this class on validation fail)
    const errorItems = container.querySelectorAll('.el-form-item.is-error');
    for (const item of errorItems) {
        if (item.offsetParent === null) continue;
        const errEl = item.querySelector('.el-form-item__error');
        if (errEl && errEl.offsetParent !== null && errEl.textContent.trim()) {
            item.scrollIntoView({ block: 'center', behavior: 'instant' });
            const label = (item.querySelector('.el-form-item__label')?.textContent || '').trim();
            const error = errEl.textContent.trim();
            return JSON.stringify({ label, error });
        }
    }
    // Pass 2: any visible .el-form-item__error (some custom forms don't set is-error)
    const allErrors = container.querySelectorAll('.el-form-item__error');
    for (const err of allErrors) {
        if (err.offsetParent === null || !err.textContent.trim()) continue;
        const item = err.closest('.el-form-item');
        if (item && item.offsetParent !== null) {
            item.scrollIntoView({ block: 'center', behavior: 'instant' });
            const label = (item.querySelector('.el-form-item__label')?.textContent || '').trim();
            return JSON.stringify({ label, error: err.textContent.trim() });
        }
    }
    return JSON.stringify({ label: '', error: '' });
}'''

# Find 保存/提交 (or custom text), scrollIntoView, click. Prefer footer / primary.
# Args: buttonText string or [buttonText, section]. Section scopes search; no section + ≥2
# matches → ambiguous (no click). Returns JSON {ok, text, section, xpath, reason, candidates}.
