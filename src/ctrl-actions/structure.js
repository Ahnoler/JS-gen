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
    /* VERIFY_SOURCE_B_EL_TABLE */
    const normalizeControlText = (text) => String(text || '').replace(/\\s+/g, ' ').trim().slice(0, 40);
    const getRowLeadingText = (row) => {
      const cells = row.querySelectorAll('td, .el-table__cell');
      for (let i = 0; i < cells.length; i++) {
        const cell = cells[i];
        const ct = normalizeControlText(cell.innerText || cell.textContent || '');
        const hasSelect = !!cell.querySelector('.el-checkbox, .el-radio, input[type="checkbox"], input[type="radio"]');
        if (hasSelect && !ct) continue;
        if (ct) return ct;
      }
      return '';
    };
    const getColumnHeader = (table, cell) => {
      const tableEl = table.closest ? (table.closest('.el-table') || table) : table;
      const headerRow = tableEl.querySelector('.el-table__header thead tr, thead tr');
      if (!headerRow || cell.cellIndex < 0) return '';
      const th = headerRow.children[cell.cellIndex];
      return th ? normalizeControlText(th.innerText || th.textContent || '') : '';
    };
    const isPagerRow = (row) => {
      if (row.closest && row.closest('.el-pagination')) return true;
      const txt = (row.innerText || row.textContent || '').replace(/\\s+/g, ' ');
      if (/每页|条\\/页|前往|页码|pagination/i.test(txt) && row.querySelector('.el-pagination, .el-select, .el-input')) return true;
      return false;
    };
    const classifyTableCell = (cell) => {
      if (cell.querySelector('.el-date-editor, .tsscdatepicker, [class*="date-picker"], [class*="datepicker"]')) return 'date';
      if (cell.querySelector('.el-select')) return 'select';
      if (cell.querySelector('textarea')) return 'input';
      if (cell.querySelector('input:not([type="hidden"])')) return 'input';
      return 'unknown';
    };
    const collectTableControls = (row) => {
      const controls = [];
      const cells = row.querySelectorAll('td, .el-table__cell');
      const dateSeen = new Set();
      const groupSeen = new Set();
      for (let ci = 0; ci < cells.length; ci++) {
        const cell = cells[ci];
        const dateEls = cell.querySelectorAll('.el-date-editor, .tsscdatepicker, [class*="date-picker"], [class*="datepicker"]');
        for (let di = 0; di < dateEls.length; di++) {
          const de = dateEls[di];
          if (dateSeen.has(de)) continue;
          dateSeen.add(de);
          const operable = de.querySelector('input:not([type="hidden"])') || de;
          controls.push({ cell, el: operable, kind: 'date', options: [] });
        }
        const radioHosts = cell.querySelectorAll('.el-radio-group');
        const radioContainers = radioHosts.length ? [...radioHosts] : (cell.querySelectorAll('.el-radio').length ? [cell] : []);
        for (let rgi = 0; rgi < radioContainers.length; rgi++) {
          const host = radioContainers[rgi];
          const gkey = host === cell ? ('cell-radio:' + ci) : host;
          if (groupSeen.has(gkey)) continue;
          const radios = host.querySelectorAll('.el-radio');
          if (!radios.length) continue;
          groupSeen.add(gkey);
          const clickEl = radios[0].querySelector('.el-radio__input, input[type="radio"]') || radios[0];
          controls.push({ cell, el: clickEl, kind: 'radio', options: [] });
        }
        const cbHosts = cell.querySelectorAll('.el-checkbox-group');
        const cbContainers = cbHosts.length ? [...cbHosts] : (cell.querySelectorAll('.el-checkbox').length ? [cell] : []);
        for (let cgi = 0; cgi < cbContainers.length; cgi++) {
          const host = cbContainers[cgi];
          const gkey = host === cell ? ('cell-cb:' + ci) : host;
          if (groupSeen.has(gkey)) continue;
          const boxes = host.querySelectorAll('.el-checkbox');
          if (!boxes.length) continue;
          groupSeen.add(gkey);
          const clickEl = boxes[0].querySelector('.el-checkbox__input, input[type="checkbox"]') || boxes[0];
          controls.push({ cell, el: clickEl, kind: 'checkbox', options: [] });
        }
        const inputs = cell.querySelectorAll('input:not([type="hidden"])');
        for (let ii = 0; ii < inputs.length; ii++) {
          const input = inputs[ii];
          const t = (input.type || '').toLowerCase();
          if (t === 'checkbox' || t === 'radio') continue;
          if (input.closest && input.closest('.el-date-editor, .tsscdatepicker, [class*="date-picker"], [class*="datepicker"]')) continue;
          if (input.closest && input.closest('.el-select')) continue;
          if (input.closest && input.closest('.el-pagination')) continue;
          controls.push({ cell, el: input, kind: classifyTableCell(cell), options: [] });
        }
        const textareas = cell.querySelectorAll('textarea');
        for (let ti = 0; ti < textareas.length; ti++) {
          controls.push({ cell, el: textareas[ti], kind: 'input', options: [] });
        }
        const selects = cell.querySelectorAll('.el-select');
        for (let si = 0; si < selects.length; si++) {
          const sel = selects[si];
          const trigger = sel.querySelector('.el-input__inner');
          if (!trigger) continue;
          controls.push({ cell, el: trigger, kind: 'select', options: [] });
        }
      }
      return controls;
    };
    const buildTableDisplayName = (rowText, controls, idx, colHeader, placeholder) => {
      const rowT = normalizeControlText(rowText);
      if (!rowT) return '';
      if (controls.length <= 1) return rowT;
      if (colHeader) return rowT + '|' + normalizeControlText(colHeader);
      if (placeholder) return rowT + '|' + normalizeControlText(placeholder);
      return rowT + '|#' + (idx + 1);
    };
    let tableList = [...root.querySelectorAll('.el-table')];
    if (scopeMode === 'main') {
      tableList = tableList.filter((table) => {
        const dr = table.closest('.el-drawer');
        if (dr && wrapOk(dr)) return false;
        const dg = table.closest('.el-dialog, .el-message-box');
        if (dg && wrapOk(dg)) return false;
        return true;
      });
    }
    for (let ti = 0; ti < tableList.length; ti++) {
      const table = tableList[ti];
      const bodyRows = table.querySelectorAll('.el-table__body-wrapper tbody tr, tbody tr');
      /* SOURCE_B_EMPTY_LEADING */
      let domRowIndex = 0;
      for (let ri = 0; ri < bodyRows.length; ri++) {
        const row = bodyRows[ri];
        if (isPagerRow(row)) continue;
        domRowIndex += 1;
        let rowText = getRowLeadingText(row);
        if (!rowText) {
          rowText = 'row#' + domRowIndex;
        }
        const controls = collectTableControls(row);
        for (let ci = 0; ci < controls.length; ci++) {
          const ctrl = controls[ci];
          const cell = ctrl.cell;
          const el = ctrl.el;
          const colHeader = getColumnHeader(table, cell);
          const placeholder = (el.getAttribute && el.getAttribute('placeholder')) || '';
          const displayName = buildTableDisplayName(rowText, controls, ci, colHeader, placeholder);
          if (displayName) actualLabels.push(displayName);
        }
      }
    }
    {
      const seen = new Set();
      const deduped = [];
      for (let i = 0; i < actualLabels.length; i++) {
        const lbl = actualLabels[i];
        if (seen.has(lbl)) continue;
        seen.add(lbl);
        deduped.push(lbl);
      }
      actualLabels.length = 0;
      for (let i = 0; i < deduped.length; i++) actualLabels.push(deduped[i]);
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
