"""
JS snippet constant: JS_SET_VUE_MODEL (Vue model direct-write action).

run9b/r10/r10b 实证根因（引擎自主闭环缺口）：
1. radio/select 的 UI 勾选与 Vue model 脱节 —— 主担保 radio UI 勾了「保证」但
   model 仍是旧值，保存发出旧码值。r10b 实证：直写 model.primWrntTp 3→2 修复。
2. disabled+required 字段（数字产业分类 DIGT_IDY_CL 等）UI 无法直填 ——
   绕过 disabled 直写 model 是合法路径（表单校验/提交读的是 model，不是 DOM）。

策略：label → form-item → __vue__ 链向上/向下找「含目标字段的 model 对象」→
直写 model[field_name] = value_str（字符串原样）→ vm.$forceUpdate() →
回读 model[field_name] === value_str 作为成功谓词。
"""

JS_SET_VUE_MODEL = '''async (args) => {
    const [labelText, fieldName, valueStr] = args;
    const label = String(labelText || '').trim();
    const field = String(fieldName || '').trim();
    if (!label || !field) {
        return JSON.stringify({ ok: false, error: 'err-vue-model-args:label/field required' });
    }
    const findItem = (root) => {
        for (const item of root.querySelectorAll('.el-form-item')) {
            const lbl = item.querySelector('.el-form-item__label')?.textContent?.trim() || '';
            if (lbl === label) return item;
        }
        return null;
    };
    const container = document.querySelector(
        '.el-dialog__wrapper:not([style*="display: none"]) .el-dialog,'
        + ' .el-drawer__container:not([style*="display: none"]) .el-drawer,'
        + ' .tssc-container, .app-container, main, body'
    ) || document.body;
    let item = findItem(container) || findItem(document.body);
    // KB-I5: 弹窗/抽屉的 form-item 可能不在主容器内——补扫可见 dialog/drawer
    if (!item) {
        for (const dlg of document.querySelectorAll('.el-dialog, .el-drawer')) {
            if (dlg.offsetParent === null) continue;
            item = findItem(dlg);
            if (item) break;
        }
    }
    if (!item) {
        return JSON.stringify({ ok: false, error: 'err-vue-model-label-not-found:' + label });
    }
    item.scrollIntoView({ block: 'center', behavior: 'instant' });

    // Collect candidate Vue instances: form-item host + $parent chain + descendants
    const seen = new Set();
    const candidates = [];
    const push = (v) => {
        if (v && v._isVue && !seen.has(v._uid)) { seen.add(v._uid); candidates.push(v); }
    };
    const walkDown = (v, depth) => {
        if (!v || depth > 6) return;
        push(v);
        (v.$children || []).forEach((c) => walkDown(c, depth + 1));
    };
    let base = item.__vue__ || (item.querySelector('[data-v-]') || {}).__vue__ || null;
    if (!base) {
        for (const el of item.querySelectorAll('*')) {
            if (el.__vue__) { base = el.__vue__; break; }
        }
    }
    // $parent chain upward (model 常挂在业务父组件)
    let up = base;
    for (let i = 0; up && i < 25; i++) {
        push(up);
        up = up.$parent;
    }
    // descendants downward（弹窗内子表单组件）
    if (base) walkDown(base, 0);
    // 兜底：可见 dialog/drawer 根实例
    if (!candidates.length) {
        for (const dlg of document.querySelectorAll('.el-dialog, .el-drawer')) {
            if (dlg.offsetParent === null) continue;
            for (const el of dlg.querySelectorAll('*')) {
                if (el.__vue__) { walkDown(el.__vue__, 0); break; }
            }
            if (candidates.length) break;
        }
    }

    const getModelOn = (vm) => {
        if (!vm) return null;
        if (vm.model && typeof vm.model === 'object' && field in vm.model) return vm.model;
        if (vm.formData && typeof vm.formData === 'object' && field in vm.formData) return vm.formData;
        if (vm.form && typeof vm.form === 'object' && field in vm.form) return vm.form;
        const data = vm.$data;
        if (data && typeof data === 'object') {
            for (const key of Object.keys(data)) {
                const sub = data[key];
                if (sub && typeof sub === 'object' && field in sub) return sub;
            }
        }
        return null;
    };

    let hitVm = null, hitModel = null, oldValue;
    for (const vm of candidates) {
        const m = getModelOn(vm);
        if (m) { hitVm = vm; hitModel = m; oldValue = m[field]; break; }
    }
    if (!hitModel) {
        return JSON.stringify({
            ok: false,
            error: 'err-vue-model-not-found:' + label + ':' + field,
        });
    }

    // 直写（字符串原样；绕过 disabled UI 是本动作的合法用途——校验/提交读 model）
    hitModel[field] = valueStr;
    if (typeof hitVm.$forceUpdate === 'function') hitVm.$forceUpdate();
    await new Promise((r) => setTimeout(r, 300));

    const readBack = hitModel[field];
    const same = String(readBack) === String(valueStr);
    if (!same) {
        return JSON.stringify({
            ok: false,
            error: 'err-vue-model-write-unverified:' + label + ':' + field
                + ':expected=' + valueStr + ':got=' + String(readBack),
        });
    }
    return JSON.stringify({
        ok: true,
        label: label,
        field: field,
        value: valueStr,
        old_value: oldValue === undefined ? null : String(oldValue),
    });
}'''
