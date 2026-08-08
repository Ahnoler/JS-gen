"""
JS snippet constants: JS_SCENARIO_PAGE_SNAPSHOT, JS_VERIFY_FORM_STRUCTURE (extracted from _js_snippets.py).
Re-exported by scripts/actions/_js_snippets.py for backward compat.
"""
from .container import JS_GET_CONTAINER

JS_SCENARIO_PAGE_SNAPSHOT = r'''() => {
  const isVis = (el) => {
    if (!el) return false;
    if (el.offsetParent === null && !el.closest('.el-table__fixed')) return false;
    const st = getComputedStyle(el);
    return st.display !== 'none' && st.visibility !== 'hidden';
  };
  const dialogs = document.querySelectorAll('.el-dialog');
  const visibleDialogs = [...dialogs].filter(d => d.offsetParent !== null);
  const drawers = document.querySelectorAll('.el-drawer');
  const visibleDrawers = [...drawers].filter(d => d.offsetParent !== null);
  const formErrors = [];
  const seen = new Set();
  for (const el of document.querySelectorAll('.el-form-item__error')) {
    const error = (el.textContent || '').trim();
    if (!error) continue;
    const formItem = el.closest('.el-form-item');
    const label = (formItem && formItem.querySelector('.el-form-item__label')
      ? formItem.querySelector('.el-form-item__label').textContent.trim()
      : '');
    const key = label + '|' + error;
    if (seen.has(key)) continue;
    seen.add(key);
    formErrors.push({ label, error });
  }
  const loading = [...document.querySelectorAll('.el-loading-mask')].some(m => {
    if (m.classList.contains('el-loading-mask--hidden')) return false;
    return isVis(m);
  });
  return {
    url: location.href,
    title: (document.title || '').trim(),
    visibleDialogCount: visibleDialogs.length,
    visibleDialogTitles: visibleDialogs.map(
      d => d.querySelector('.el-dialog__title')?.textContent?.trim() || ''
    ).filter(Boolean).slice(0, 3),
    drawerCount: visibleDrawers.length,
    loading,
    formErrors: formErrors.slice(0, 8),
    activeTab: document.querySelector('.el-tabs__item.is-active')?.textContent?.trim() || null,
    messages: [...document.querySelectorAll('.el-message')]
      .map(e => e.textContent.trim()).filter(Boolean).slice(0, 3),
    notifications: [...document.querySelectorAll('.el-notification')]
      .filter(e => e.offsetParent !== null)
      .map(e => e.textContent.trim()).filter(Boolean).slice(0, 3),
  };
}'''

# Align with src/ctrl-actions.js CTRL.verifyFormStructure(fields, containerId)
# Arg: fields[] (legacy) OR { fields|expectedFields, container }

JS_VERIFY_FORM_STRUCTURE = '''(arg) => {
    const wrapOk = (d) => {
        if (!d) return false;
        const wrap = d.closest && d.closest('.el-dialog__wrapper, .el-message-box__wrapper, .el-drawer__wrapper');
        if (wrap && getComputedStyle(wrap).display === 'none') return false;
        if (d.offsetParent !== null) return true;
        const st = getComputedStyle(d);
        if (st.display === 'none' || st.visibility === 'hidden') return false;
        const r = d.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
    };
    const matchTitle = (el, want) => {
        const w = String(want || '').trim();
        if (!w || !el) return false;
        const aria = (el.getAttribute('aria-label') || '').trim();
        const header = (el.querySelector('.el-drawer__title, .el-drawer__header, .el-dialog__title')?.textContent || '').trim();
        return aria === w || header === w
            || (aria && (aria.includes(w) || w.includes(aria)))
            || (header && (header.includes(w) || w.includes(header)));
    };
    const expected = Array.isArray(arg)
        ? arg
        : (Array.isArray(arg?.fields) ? arg.fields
            : (Array.isArray(arg?.expectedFields) ? arg.expectedFields : []));
    const idRaw = Array.isArray(arg)
        ? null
        : ((arg?.container == null || arg?.container === '') ? 'main' : String(arg.container).trim());
    let root = null;
    let scopeMode = 'legacy';
    if (!idRaw) {
        root = ''' + JS_GET_CONTAINER + ''';
        scopeMode = 'legacy';
    } else if (idRaw === 'main') {
        root = document;
        scopeMode = 'main';
    } else if (idRaw.startsWith('drawer:')) {
        const want = idRaw.slice(7);
        root = [...document.querySelectorAll('.el-drawer')].filter(wrapOk).find((d) => matchTitle(d, want)) || null;
        scopeMode = 'drawer';
    } else if (idRaw.startsWith('dialog:')) {
        const want = idRaw.slice(7);
        root = [...document.querySelectorAll('.el-dialog, .el-message-box')].filter(wrapOk).find((d) => matchTitle(d, want)) || null;
        scopeMode = 'dialog';
    } else {
        root = ''' + JS_GET_CONTAINER + ''';
        scopeMode = 'legacy';
    }
    if (!root) {
        return JSON.stringify({
            ok: false,
            error: 'container_not_found',
            container: idRaw,
            count: 0,
            expected_count: expected.length,
            required_count: 0,
            optional_count: 0,
            missing_required: [],
            missing_optional: [],
            added_required: [],
            added_optional: [],
            hasRequiredChange: false,
            hasOptionalChange: false,
            reordered: false,
            fields: [],
        });
    }
    let itemList = [...root.querySelectorAll('.el-form-item')];
    if (scopeMode === 'main') {
        itemList = itemList.filter((item) => {
            const dr = item.closest('.el-drawer');
            if (dr && wrapOk(dr)) return false;
            const dg = item.closest('.el-dialog, .el-message-box');
            if (dg && wrapOk(dg)) return false;
            return true;
        });
    }
    const items = itemList;
    const actualLabels = [];
    for (const item of items) {
        const lbl = item.querySelector('.el-form-item__label');
        if (lbl) actualLabels.push(lbl.textContent.trim());
    }
    const expectedLabels = expected.map(f => f.label || f);
    const requiredLabels = expected.filter(f => f.is_required || f.isRequired).map(f => f.label);
    const optionalLabels = expected.filter(f => !(f.is_required || f.isRequired)).map(f => f.label);
    const missing_required = requiredLabels.filter(l => !actualLabels.includes(l));
    const missing_optional = optionalLabels.filter(l => !actualLabels.includes(l));
    const added_all = actualLabels.filter(l => !expectedLabels.includes(l));
    const added_required = [];
    const added_optional = [];
    for (const lbl of added_all) {
        let isReq = false;
        for (const item of items) {
            const itemLbl = item.querySelector('.el-form-item__label');
            if (itemLbl && itemLbl.textContent.trim() === lbl) {
                isReq = !!(item.matches('.is-required')
                    || item.querySelector('.is-required, .el-form-item__label .el-form-item__label--required')
                    || /\\*/.test(lbl));
                break;
            }
        }
        if (isReq) added_required.push(lbl);
        else added_optional.push(lbl);
    }
    const hasRequiredChange = missing_required.length > 0 || added_required.length > 0;
    const hasOptionalChange = missing_optional.length > 0 || added_optional.length > 0;
    let reordered = false;
    if (!hasRequiredChange && !hasOptionalChange && actualLabels.length === expectedLabels.length) {
        for (let i = 0; i < expectedLabels.length; i++) {
            if (expectedLabels[i] !== actualLabels[i]) { reordered = true; break; }
        }
    }
    return JSON.stringify({
        ok: !hasRequiredChange,
        container: idRaw || scopeMode,
        count: actualLabels.length,
        expected_count: expectedLabels.length,
        required_count: requiredLabels.length,
        optional_count: optionalLabels.length,
        missing_required, missing_optional,
        added_required, added_optional,
        hasRequiredChange, hasOptionalChange, reordered,
        fields: actualLabels,
    });
}'''
