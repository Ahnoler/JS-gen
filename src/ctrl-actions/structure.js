/**
 * CTRL_OBJECT part: verifyFormStructure (closes the object literal).
 * Concatenated with sibling parts into CTRL_OBJECT in index.js —
 * do not change indentation, braces, or the trailing comma; the
 * assembled string must stay byte-identical (characterize-ctrl.mjs).
 */
export const CTRL_PART_STRUCTURE = `  verifyFormStructure: (expectedFields, containerId) => {
    // expectedFields: [{label, is_required}, ...] from save_form_snapshot
    // containerId: recorded scope "main" | "drawer:…" | "dialog:…" (optional; omit → legacy getContainer)
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
    const fieldsIn = Array.isArray(expectedFields) ? expectedFields : [];
    const idRaw = (containerId == null || containerId === '') ? null : String(containerId).trim();
    let root = null;
    let scopeMode = 'legacy';
    if (!idRaw) {
      root = CTRL.getContainer();
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
      root = CTRL.getContainer();
      scopeMode = 'legacy';
    }
    if (!root) {
      return JSON.stringify({
        ok: false,
        error: 'container_not_found',
        container: idRaw,
        count: 0,
        expected_count: fieldsIn.length,
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

    const expectedLabels = fieldsIn.map(f => f.label);
    const requiredLabels = fieldsIn.filter(f => f.is_required).map(f => f.label);
    const optionalLabels = fieldsIn.filter(f => !f.is_required).map(f => f.label);

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
          isReq = !!(item.matches('.is-required') || item.querySelector('.is-required, .el-form-item__label .el-form-item__label--required') || /\\*/.test(lbl));
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
      container: idRaw || scopeMode,
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
}`;
