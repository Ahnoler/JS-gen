/**
 * CDP DOM inspect helpers: highlight under cursor + resolve element meta for recording.
 */
const HIGHLIGHT_CONFIG = {
  showInfo: false,
  showRulers: false,
  showExtensionLines: false,
  contentColor: { r: 111, g: 168, b: 220, a: 0.35 },
  paddingColor: { r: 147, g: 196, b: 125, a: 0.4 },
  borderColor: { r: 255, g: 229, b: 153, a: 0.7 },
  marginColor: { r: 246, g: 178, b: 107, a: 0.35 },
};

/** Page-side function: build manual-recorder-compatible payload from an element.
 * Optional args: clientX, clientY — used to pierce anonymous body overlays via elementsFromPoint.
 */
const BUILD_PAYLOAD_FN = `function(clientX, clientY) {
  let el = this;
  if (!el || el.nodeType !== 1) return null;

  function xpathOf(node) {
    if (!node || node.nodeType !== 1) return '';
    if (node.id) return '//*[@id="' + node.id + '"]';
    const parts = [];
    let cur = node;
    while (cur && cur.nodeType === 1 && cur !== document.body) {
      let ix = 1;
      let sib = cur.previousElementSibling;
      while (sib) {
        if (sib.tagName === cur.tagName) ix++;
        sib = sib.previousElementSibling;
      }
      parts.unshift(cur.tagName.toLowerCase() + '[' + ix + ']');
      cur = cur.parentElement;
    }
    return '/' + parts.join('/');
  }

  function buElementPosition(currentElement) {
    if (!currentElement || !currentElement.parentElement) return 0;
    const tagName = currentElement.nodeName.toLowerCase();
    const siblings = Array.from(currentElement.parentElement.children)
      .filter((sib) => sib.nodeName.toLowerCase() === tagName);
    if (siblings.length === 1) return 0;
    return siblings.indexOf(currentElement) + 1;
  }

  function buXPathOf(node) {
    if (!node || node.nodeType !== 1) return '';
    const segments = [];
    let currentElement = node;
    while (currentElement && currentElement.nodeType === 1) {
      const parent = currentElement.parentNode;
      if (parent && (parent.nodeType === 11 ||
          (parent.nodeName && parent.nodeName.toLowerCase() === 'iframe'))) break;
      const position = buElementPosition(currentElement);
      const tagName = currentElement.nodeName.toLowerCase();
      segments.unshift(tagName + (position > 0 ? '[' + position + ']' : ''));
      currentElement = parent;
    }
    return segments.join('/');
  }

  function attrs(node) {
    const a = {};
    if (!node || !node.attributes) return a;
    for (const at of node.attributes) {
      if (at.value && at.value.length < 120) a[at.name] = at.value;
    }
    return a;
  }

  function visibleText(node) {
    if (!node) return '';
    return (node.innerText || node.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 80);
  }

  /** Prefer main body row text — Element UI fixed columns often only contain radio/checkbox. */
  function tableRowIdentityText(rowOrEl) {
    if (!rowOrEl) return '';
    const row = rowOrEl.closest ? rowOrEl.closest('.el-table__row, tr') : rowOrEl;
    if (!row) return '';
    let dataRow = row;
    const table = row.closest && row.closest('.el-table');
    if (table && row.parentElement) {
      const siblings = Array.from(row.parentElement.children).filter(
        (r) => r.nodeType === 1 && ((r.classList && r.classList.contains('el-table__row')) || r.tagName === 'TR')
      );
      const idx = siblings.indexOf(row);
      const bodyRows = table.querySelectorAll(
        '.el-table__body-wrapper tbody tr.el-table__row, .el-table__body-wrapper tbody tr'
      );
      if (idx >= 0 && bodyRows[idx]) dataRow = bodyRows[idx];
    }
    const cells = dataRow.querySelectorAll('td');
    const parts = [];
    for (const td of cells) {
      const onlySelect = td.querySelector('.el-radio, .el-checkbox');
      let t = (td.innerText || td.textContent || '').trim().replace(/\\s+/g, ' ');
      if (onlySelect && t.length < 2) continue;
      if (!t || t === 'radio' || t === 'checkbox') continue;
      parts.push(t);
    }
    if (!parts.length) {
      const raw = (dataRow.innerText || dataRow.textContent || '').trim().replace(/\\s+/g, ' ');
      if (!raw || raw === 'radio' || raw === 'checkbox') return '';
      return raw.slice(0, 80);
    }
    const best = parts.find((p) => p.length >= 2 && !/^(操作|编辑|删除|修改|查看|详情)$/.test(p)) || parts[0];
    return String(best || '').slice(0, 80);
  }

  function shortLabel(node) {
    if (!node) return '';
    const fromAttr = (node.getAttribute && (
      node.getAttribute('title') ||
      node.getAttribute('aria-label') ||
      node.getAttribute('data-name') ||
      node.getAttribute('data-menu') ||
      ''
    )) || '';
    if (fromAttr.trim()) return fromAttr.trim().replace(/\\s+/g, ' ').slice(0, 40);
    const t = visibleText(node);
    if (!t) return '';
    return t.split(/[\\n\\r]/)[0].trim().slice(0, 40);
  }

  function formItemLabel(node) {
    const item = node.closest && node.closest('.el-form-item');
    if (!item) return '';
    const lbl = item.querySelector('.el-form-item__label');
    return (lbl && lbl.textContent || '').trim().replace(/[：:*\\s]+$/g, '');
  }

  function openDateEditorMeta() {
    let editor = null;
    try {
      if (window.__jsgenActiveDateEditor && document.contains(window.__jsgenActiveDateEditor)) {
        editor = window.__jsgenActiveDateEditor;
      }
    } catch (e) {}
    const active = document.activeElement;
    if (!editor && active && active.closest) editor = active.closest('.el-date-editor');
    if (!editor) {
      editor = document.querySelector('.el-date-editor.is-active');
    }
    if (!editor) {
      const focused = document.querySelector('.el-date-editor .el-input.is-focus, .el-date-editor input:focus');
      if (focused) editor = focused.closest('.el-date-editor');
    }
    if (!editor) {
      const eds = Array.from(document.querySelectorAll('.el-date-editor'));
      for (const ed of eds) {
        const inp = ed.querySelector('input');
        if (inp && inp.getAttribute('aria-expanded') === 'true') { editor = ed; break; }
      }
    }
    // Visible picker open: prefer the single visible editor in a dialog, else any expanded-looking one
    if (!editor) {
      const panelOpen = Array.from(document.querySelectorAll('.el-picker-panel, .el-date-picker')).some((p) => {
        const st = window.getComputedStyle(p);
        return st.display !== 'none' && st.visibility !== 'hidden' && p.offsetParent !== null;
      });
      if (panelOpen) {
        const visible = Array.from(document.querySelectorAll('.el-date-editor')).filter((ed) => ed.offsetParent !== null);
        const inDlg = visible.filter((ed) => ed.closest('.el-dialog, .el-drawer, .el-message-box'));
        const pool = inDlg.length ? inDlg : visible;
        if (pool.length === 1) editor = pool[0];
        else if (pool.length > 1) {
          editor = pool.find((ed) => ed.classList.contains('is-active')) || pool[0];
        }
      }
    }
    if (editor) {
      try { window.__jsgenActiveDateEditor = editor; } catch (e) {}
    }
    if (!editor) return { label: '', editor: null, input: null };
    const input = editor.querySelector('input');
    return { label: formItemLabel(editor), editor: editor, input: input };
  }

  /** Build YYYY-MM-DD from el-date-table cell + panel header (picker click, before value commits). */
  function dateValueFromPickerCell(cell) {
    const td = cell.closest ? cell.closest('td') : cell;
    if (!td || !td.closest) return '';
    const panel = td.closest('.el-picker-panel, .el-date-picker');
    if (!panel) return '';
    if (td.classList.contains('disabled')) return '';
    const dayRaw = ((td.querySelector('span') || td).textContent || '').trim();
    const day = parseInt(dayRaw, 10);
    if (!day || day < 1 || day > 31) return '';
    let year = null, month = null;
    const labels = panel.querySelectorAll('.el-date-picker__header-label');
    for (const lb of labels) {
      const t = (lb.textContent || '').trim();
      const ym = t.match(/(\\d{4})\\s*年/);
      const mm = t.match(/(\\d{1,2})\\s*月/);
      if (ym) year = parseInt(ym[1], 10);
      if (mm) month = parseInt(mm[1], 10);
    }
    if (year == null || month == null) {
      const ht = ((panel.querySelector('.el-date-picker__header') || {}).textContent || '').replace(/\\s+/g, ' ');
      const ym = ht.match(/(\\d{4})\\s*年/);
      const mm = ht.match(/(\\d{1,2})\\s*月/);
      if (ym) year = parseInt(ym[1], 10);
      if (mm) month = parseInt(mm[1], 10);
    }
    if (year == null || month == null) return '';
    if (td.classList.contains('prev-month')) {
      month -= 1;
      if (month < 1) { month = 12; year -= 1; }
    } else if (td.classList.contains('next-month')) {
      month += 1;
      if (month > 12) { month = 1; year += 1; }
    }
    return year + '-' + String(month).padStart(2, '0') + '-' + String(day).padStart(2, '0');
  }

  function elMeta(node, textOverride) {
    const t = textOverride != null ? String(textOverride) : shortLabel(node);
    const bu = buXPathOf(node);
    const abs = xpathOf(node);
    return {
      xpath: bu || abs,
      bu_xpath: bu,
      xpath_abs: abs,
      tag: (node.tagName || '').toLowerCase(),
      attributes: attrs(node),
      text: t,
    };
  }

  /** Anonymous body teleports / masks that steal getNodeForLocation hits. */
  function isJunkShell(node) {
    if (!node || node.nodeType !== 1) return true;
    if (node === document.body || node === document.documentElement) return true;
    const cls = String(node.className || '');
    if (/(^| )(v-modal|el-loading-mask|el-overlay|el-dialog__wrapper|el-drawer__wrapper|el-message|el-notification|el-popper|el-select-dropdown|el-picker-panel|el-autocomplete-suggestion)( |$)/.test(cls)) {
      return true;
    }
    // Exact DB pattern: body > div[N] with no id/class (xpath /div[2])
    if (node.parentElement === document.body && !node.id && !String(cls).trim()) {
      return true;
    }
    return false;
  }

  function isWorthlessClick(node, text) {
    if (!node) return true;
    if (isJunkShell(node)) return true;
    const t = (text || '').trim();
    const tag = (node.tagName || '').toLowerCase();
    // YYYY-MM-DD text on non-buttons = date-editor reopen / picker residue
    if (/^\\d{4}-\\d{2}-\\d{2}$/.test(t) && tag !== 'button' && tag !== 'a') {
      return true;
    }
    // body > anonymous div (xpath /div[N]) — never a durable control
    if (node.parentElement === document.body && tag === 'div' && !node.id && !String(node.className || '').trim()) {
      return true;
    }
    if (t) {
      const role = (node.getAttribute && node.getAttribute('role')) || '';
      if (tag === 'button' || tag === 'a' || role === 'button' || role === 'menuitem' || role === 'link' || role === 'tab') {
        return false;
      }
      const cls = String(node.className || '');
      if (/el-button|el-menu-item|el-dropdown-menu__item|btn/.test(cls)) return false;
      if (node.closest && node.closest('button, .el-button, a[href], [role="button"], .el-menu-item')) return false;
      // Has text but not a recognizable control — still skip anonymous shells
      if (tag === 'div' || tag === 'span') {
        if (!cls && !node.id) return true;
      }
      return false;
    }
    if (tag === 'button' || tag === 'a') return false;
    const role = (node.getAttribute && node.getAttribute('role')) || '';
    if (role === 'button' || role === 'menuitem' || role === 'link' || role === 'tab') return false;
    const cls = String(node.className || '');
    if (/el-button|el-menu-item|el-dropdown-menu__item|btn/.test(cls)) return false;
    if (node.closest && node.closest('button, .el-button, a[href], [role="button"]')) return false;
    if (tag === 'div' || tag === 'span') return true;
    return false;
  }

  // Pierce junk overlay hit by CDP getNodeForLocation
  if (typeof clientX === 'number' && typeof clientY === 'number' && isJunkShell(el)) {
    try {
      const stack = document.elementsFromPoint(clientX, clientY) || [];
      let pierced = null;
      for (let i = 0; i < stack.length; i++) {
        const n = stack[i];
        if (n && n.nodeType === 1 && !isJunkShell(n)) {
          pierced = n;
          break;
        }
      }
      if (pierced) el = pierced;
      else return null; // pure overlay hit — do not record
    } catch (e) {
      return null;
    }
  }

  // Classify like scripts/manual_recorder.py JS_MANUAL_RECORDER click handler
  function isNonRecordableFocusClick(node) {
    if (!node || !node.closest) return false;
    // Real action controls inside a form-item must still be recorded
    if (node.closest('.el-radio, .el-checkbox, .el-switch, button, .el-button, a[href], .el-upload')) {
      // except caret/clear icons that live inside inputs/selects
      if (!node.closest('.el-select, .el-cascader, .el-date-editor, .el-input, .el-autocomplete')) {
        return false;
      }
    }
    if (node.closest(
      '.el-select, .el-cascader, .el-date-editor, .el-time-picker, .el-autocomplete,' +
      '.el-input__inner, .el-input__suffix, .el-input__prefix, .el-input__icon,' +
      '.el-textarea__inner, .el-select__caret, .el-input__suffix-inner'
    )) {
      return true;
    }
    const focusInput = node.closest('input, textarea, .el-input, .el-textarea');
    if (focusInput) {
      const tag = (focusInput.tagName || '').toLowerCase();
      const type = (focusInput.getAttribute && focusInput.getAttribute('type') || '').toLowerCase();
      if (
        tag === 'textarea' ||
        (tag === 'input' && !['checkbox', 'radio', 'button', 'submit', 'reset', 'file', 'image', 'hidden'].includes(type)) ||
        (focusInput.classList && (focusInput.classList.contains('el-input') || focusInput.classList.contains('el-textarea')))
      ) {
        return true;
      }
    }
    // Label / blank area of a field form-item (incl. select) — not a step
    const formItem = node.closest('.el-form-item');
    if (formItem && formItem.querySelector(
      '.el-select, .el-cascader, .el-date-editor, .el-time-picker, .el-autocomplete,' +
      '.el-input, .el-textarea, input:not([type=checkbox]):not([type=radio]):not([type=hidden]), textarea'
    )) {
      return true;
    }
    return false;
  }

  const opt = el.closest && el.closest('.el-select-dropdown__item');
  if (opt) {
    const optionText = visibleText(opt);
    const open = document.querySelector('.el-select .el-input.is-focus, .el-select .is-focus');
    return Object.assign({
      kind: 'select_option',
      label_text: open ? formItemLabel(open) : '',
      option_text: optionText,
      source_channel: 'cdp_bib',
    }, elMeta(opt, optionText));
  }

  // Date picker day cell → fill_date (user picks from calendar, does not type)
  const dateTd = el.closest && el.closest('.el-date-table td');
  if (dateTd && dateTd.closest('.el-picker-panel, .el-date-picker')) {
    const value = dateValueFromPickerCell(dateTd);
    const meta = openDateEditorMeta();
    // After year/month arrow navigation focus often leaves the input — still record
    if (value && meta.label) {
      return Object.assign({
        kind: 'fill_date',
        label_text: meta.label,
        value: value,
        source_channel: 'cdp_bib',
      }, elMeta(meta.input || dateTd, value));
    }
    // Incomplete at press-time (no label / header parse) → bridge confirms after click commits
    return {
      kind: 'fill_date_pending',
      label_text: (meta && meta.label) || '',
      value: value || '',
      source_channel: 'cdp_bib',
      tag: 'input',
      attributes: {},
      text: value || '',
      xpath: (meta && meta.input) ? (buXPathOf(meta.input) || xpathOf(meta.input)) : '',
      bu_xpath: (meta && meta.input) ? buXPathOf(meta.input) : '',
      xpath_abs: (meta && meta.input) ? xpathOf(meta.input) : '',
    };
  }
  // Year/month tables & header arrows: keep active editor stash, do not record
  if (el.closest && el.closest('.el-picker-panel, .el-date-picker, .el-time-panel')) {
    openDateEditorMeta();
    return null;
  }

  // Skip opening pickers / focusing text fields before any generic click classification
  if (isNonRecordableFocusClick(el)) {
    // Remember which date editor the user opened (arrows later steal focus)
    const dateEd = el.closest && el.closest('.el-date-editor');
    if (dateEd) {
      try { window.__jsgenActiveDateEditor = dateEd; } catch (e) {}
    }
    return null;
  }

  const menu = el.closest && el.closest(
    '.el-menu-item, .el-submenu__title, .el-menu--popup .el-menu-item, .el-dropdown-menu__item, [role="menuitem"]'
  );
  if (menu) {
    const menuText = shortLabel(menu);
    if (menuText) {
      return Object.assign({
        kind: 'click_menu_item',
        menu_text: menuText,
        source_channel: 'cdp_bib',
      }, elMeta(menu, menuText));
    }
  }

  const navRoot = el.closest && el.closest(
    'aside, .el-aside, nav, .el-menu, [class*="sidebar"], [class*="side-menu"], [class*="SideMenu"], [class*="nav-menu"], [class*="NavMenu"], [class*="menu-wrap"]'
  );
  if (navRoot) {
    const item = el.closest('li, a, button, [role="menuitem"], [class*="menu-item"], [class*="MenuItem"]') || el;
    const menuText = shortLabel(item);
    if (menuText) {
      return Object.assign({
        kind: 'click_menu_item',
        menu_text: menuText,
        source_channel: 'cdp_bib',
      }, elMeta(item, menuText));
    }
  }

  const rowBtn = el.closest && el.closest('.el-table__body .el-button, .el-table__body button, .el-table__body a');
  if (rowBtn) {
    const buttonText = visibleText(rowBtn);
    return Object.assign({
      kind: 'click_table_row_button',
      row_text: tableRowIdentityText(rowBtn).slice(0, 40),
      button_text: buttonText,
      source_channel: 'cdp_bib',
    }, elMeta(rowBtn, buttonText));
  }

  const tableRadio = el.closest && el.closest(
    '.el-table__body .el-radio, .el-table__body .el-radio-button, .el-table__row .el-radio, .el-table__row .el-radio-button,' +
    '.el-table__fixed .el-radio, .el-table__fixed-body-wrapper .el-radio, .el-table__fixed-left .el-radio'
  );
  if (tableRadio) {
    const rowText = tableRowIdentityText(tableRadio);
    if (!rowText) return null;
    return Object.assign({
      kind: 'click_table_row_radio',
      row_text: rowText,
      source_channel: 'cdp_bib',
    }, elMeta(tableRadio, rowText));
  }

  const radio = el.closest && el.closest('.el-radio, .el-radio-button');
  if (radio) {
    const optionText = shortLabel(radio);
    return Object.assign({
      kind: 'click_radio',
      label_text: formItemLabel(radio),
      option_text: optionText,
      source_channel: 'cdp_bib',
    }, elMeta(radio, optionText));
  }

  const tab = el.closest && el.closest('.el-tabs__item');
  if (tab) {
    const tabName = shortLabel(tab);
    return Object.assign({
      kind: 'switch_tab',
      tab_name: tabName,
      source_channel: 'cdp_bib',
    }, elMeta(tab, tabName));
  }

  const closeBtn = el.closest && el.closest('.el-dialog__headerbtn, .el-message-box__headerbtn, .el-drawer__close-btn');
  if (closeBtn) {
    return Object.assign({ kind: 'close_dialog', source_channel: 'cdp_bib' }, elMeta(closeBtn, 'close'));
  }

  const btn = el.closest && el.closest('button, .el-button, a, [role="button"]');
  if (btn && btn.closest && (
    btn.closest('.el-select') || btn.closest('.el-cascader') || btn.closest('.el-date-editor')
      || btn.closest('.el-input') || btn.closest('.el-autocomplete')
  )) {
    return null;
  }
  const target = btn || el;
  if (isNonRecordableFocusClick(target)) return null;
  const text = shortLabel(target);
  if (isWorthlessClick(target, text)) return null;
  return Object.assign({
    kind: 'click',
    source_channel: 'cdp_bib',
  }, elMeta(target, text));
}`;

/**
 * @param {import('./client.js').CdpClient} client
 */
export async function enableInspect(client) {
  await client.send('DOM.enable');
  await client.send('Overlay.enable');
  await client.send('Runtime.enable');
}

/**
 * @param {import('./client.js').CdpClient} client
 * @param {number} x CSS px
 * @param {number} y CSS px
 */
export async function highlightAt(client, x, y) {
  const loc = await client.send('DOM.getNodeForLocation', {
    x: Math.round(x),
    y: Math.round(y),
    includeUserAgentShadowDOM: true,
  });
  const nodeId = loc?.nodeId;
  const backendNodeId = loc?.backendNodeId;
  if (!nodeId && !backendNodeId) {
    try { await client.send('Overlay.hideHighlight'); } catch {}
    return null;
  }
  const highlightConfig = HIGHLIGHT_CONFIG;
  if (nodeId) {
    await client.send('Overlay.highlightNode', { nodeId, highlightConfig });
  } else {
    await client.send('Overlay.highlightNode', { backendNodeId, highlightConfig });
  }
  return { nodeId: nodeId || null, backendNodeId: backendNodeId || null, frameId: loc.frameId || null };
}

export async function hideHighlight(client) {
  try { await client.send('Overlay.hideHighlight'); } catch {}
}

/**
 * Resolve element under (x,y) into a manual_recorder payload.
 * @param {import('./client.js').CdpClient} client
 * @param {number} x
 * @param {number} y
 */
export async function resolvePayloadAt(client, x, y) {
  const loc = await client.send('DOM.getNodeForLocation', {
    x: Math.round(x),
    y: Math.round(y),
    includeUserAgentShadowDOM: true,
  });
  if (!loc?.backendNodeId && !loc?.nodeId) return null;

  let objectId = null;
  try {
    const resolved = await client.send('DOM.resolveNode', {
      backendNodeId: loc.backendNodeId || undefined,
      nodeId: loc.nodeId || undefined,
    });
    objectId = resolved?.object?.objectId;
  } catch {
    return null;
  }
  if (!objectId) return null;

  const result = await client.send('Runtime.callFunctionOn', {
    objectId,
    functionDeclaration: BUILD_PAYLOAD_FN,
    arguments: [
      { value: Math.round(x) },
      { value: Math.round(y) },
    ],
    returnByValue: true,
  });
  const payload = result?.result?.value;
  if (!payload || typeof payload !== 'object') return null;
  payload.client_x = Math.round(x);
  payload.client_y = Math.round(y);
  return payload;
}

/**
 * Briefly suppress page-injected manual recorder to avoid double-counting BiB clicks.
 * @param {import('./client.js').CdpClient} client
 * @param {number} [ms]
 */
export async function suppressPageManualRecorder(client, ms = 600) {
  try {
    await client.send('Runtime.evaluate', {
      expression: `window.__jsgenManualSkipUntil = Date.now() + ${Number(ms) || 600}`,
      returnByValue: true,
    });
  } catch {}
}

/**
 * Snapshot the focused input/textarea as a fill / fill_date payload for recording.
 * @param {import('./client.js').CdpClient} client
 */
export async function resolveFocusedFillPayload(client) {
  try {
    const result = await client.send('Runtime.evaluate', {
      expression: `(() => {
        const el = document.activeElement;
        if (!el) return null;
        const tag = (el.tagName || '').toLowerCase();
        if (tag !== 'input' && tag !== 'textarea') return null;
        if (el.closest && el.closest('.el-select')) return null;
        // Date values come from picker day clicks, not focus flush (often still empty).
        // TODO(date-leave-backup): 离开日期框点到其他字段时，若 input 已有非空值则补录
        // fill_date（选天路径漏记时的兜底）。等端到端/用户反馈需要再做；注意与打开空选择器、
        // 重复选同一日期的去重配合，避免误记/双记。
        if (el.closest && el.closest('.el-date-editor')) return null;
        const item = el.closest && el.closest('.el-form-item');
        const lbl = item && item.querySelector('.el-form-item__label');
        const label = (lbl && lbl.textContent || '').trim().replace(/[：:*\\s]+$/g, '');
        const value = el.value || '';
        if (!String(value).trim()) return null;
        function xpathOf(node) {
          if (!node || node.nodeType !== 1) return '';
          if (node.id) return '//*[@id="' + node.id + '"]';
          const parts = [];
          let cur = node;
          while (cur && cur.nodeType === 1 && cur !== document.body) {
            let ix = 1;
            let sib = cur.previousElementSibling;
            while (sib) {
              if (sib.tagName === cur.tagName) ix++;
              sib = sib.previousElementSibling;
            }
            parts.unshift(cur.tagName.toLowerCase() + '[' + ix + ']');
            cur = cur.parentElement;
          }
          return '/' + parts.join('/');
        }
        return {
          kind: 'fill',
          label_text: label,
          value: value,
          xpath: xpathOf(el),
          bu_xpath: '',
          xpath_abs: xpathOf(el),
          tag: tag,
          attributes: {},
          text: String(value).slice(0, 80),
          source_channel: 'cdp_bib',
        };
      })()`,
      returnByValue: true,
      awaitPromise: false,
    });
    const payload = result?.result?.value;
    if (!payload || typeof payload !== 'object') return null;
    if (!payload.label_text && !payload.xpath) return null;
    return payload;
  } catch {
    return null;
  }
}

/**
 * After a date-picker day click commits, read the open/stashed date editor value.
 * Used when year/month arrows stole focus so press-time label/value was incomplete.
 * @param {import('./client.js').CdpClient} client
 * @param {{ label_text?: string, value?: string } | null} [hint]
 */
export async function resolveCommittedDateFillPayload(client, hint = null) {
  try {
    const hintLabel = hint?.label_text ? String(hint.label_text) : '';
    const hintValue = hint?.value ? String(hint.value) : '';
    const result = await client.send('Runtime.evaluate', {
      expression: `(() => {
        const hintLabel = ${JSON.stringify(hintLabel)};
        const hintValue = ${JSON.stringify(hintValue)};
        function formItemLabel(node) {
          const item = node && node.closest && node.closest('.el-form-item');
          if (!item) return '';
          const lbl = item.querySelector('.el-form-item__label');
          return (lbl && lbl.textContent || '').trim().replace(/[：:*\\s]+$/g, '');
        }
        function xpathOf(node) {
          if (!node || node.nodeType !== 1) return '';
          if (node.id) return '//*[@id="' + node.id + '"]';
          const parts = [];
          let cur = node;
          while (cur && cur.nodeType === 1 && cur !== document.body) {
            let ix = 1;
            let sib = cur.previousElementSibling;
            while (sib) {
              if (sib.tagName === cur.tagName) ix++;
              sib = sib.previousElementSibling;
            }
            parts.unshift(cur.tagName.toLowerCase() + '[' + ix + ']');
            cur = cur.parentElement;
          }
          return '/' + parts.join('/');
        }
        let editor = null;
        try {
          if (window.__jsgenActiveDateEditor && document.contains(window.__jsgenActiveDateEditor)) {
            editor = window.__jsgenActiveDateEditor;
          }
        } catch (e) {}
        if (!editor) editor = document.querySelector('.el-date-editor.is-active');
        if (!editor) {
          const focused = document.querySelector('.el-date-editor .el-input.is-focus, .el-date-editor input:focus');
          if (focused) editor = focused.closest('.el-date-editor');
        }
        if (!editor) {
          const visible = Array.from(document.querySelectorAll('.el-date-editor')).filter((ed) => ed.offsetParent !== null);
          const inDlg = visible.filter((ed) => ed.closest('.el-dialog, .el-drawer, .el-message-box'));
          const pool = inDlg.length ? inDlg : visible;
          if (hintLabel) {
            editor = pool.find((ed) => formItemLabel(ed) === hintLabel) || null;
          }
          if (!editor && pool.length === 1) editor = pool[0];
          if (!editor && pool.length > 1) {
            // Prefer the editor whose value matches the just-picked date / changed most recently
            editor = pool.find((ed) => {
              const v = (ed.querySelector('input') || {}).value || '';
              return hintValue && v === hintValue;
            }) || pool.find((ed) => ((ed.querySelector('input') || {}).value || '').trim()) || pool[0];
          }
        }
        if (!editor) return null;
        try { window.__jsgenActiveDateEditor = editor; } catch (e) {}
        const input = editor.querySelector('input');
        const value = String((input && input.value) || hintValue || '').trim();
        const label = formItemLabel(editor) || hintLabel;
        if (!value || !label) return null;
        return {
          kind: 'fill_date',
          label_text: label,
          value: value,
          xpath: xpathOf(input || editor),
          bu_xpath: '',
          xpath_abs: xpathOf(input || editor),
          tag: 'input',
          attributes: {},
          text: value.slice(0, 80),
          source_channel: 'cdp_bib',
        };
      })()`,
      returnByValue: true,
      awaitPromise: false,
    });
    const payload = result?.result?.value;
    if (!payload || typeof payload !== 'object') return null;
    if (!payload.label_text || !payload.value) return null;
    return payload;
  } catch {
    return null;
  }
}
