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
    if (t) return false;
    const tag = (node.tagName || '').toLowerCase();
    if (tag === 'button' || tag === 'a') return false;
    const role = (node.getAttribute && node.getAttribute('role')) || '';
    if (role === 'button' || role === 'menuitem' || role === 'link' || role === 'tab') return false;
    const cls = String(node.className || '');
    if (/el-button|el-menu-item|el-dropdown-menu__item|btn/.test(cls)) return false;
    if (node.closest && node.closest('button, .el-button, a[href], [role="button"]')) return false;
    // empty anonymous div/span — not a meaningful control
    if (tag === 'div' || tag === 'span') return true;
    return false;
  }

  // Pierce junk overlay hit by CDP getNodeForLocation
  if (typeof clientX === 'number' && typeof clientY === 'number' && isJunkShell(el)) {
    try {
      const stack = document.elementsFromPoint(clientX, clientY) || [];
      for (let i = 0; i < stack.length; i++) {
        const n = stack[i];
        if (n && n.nodeType === 1 && !isJunkShell(n)) {
          el = n;
          break;
        }
      }
    } catch (e) {}
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

  // Skip opening pickers / focusing text fields before any generic click classification
  if (isNonRecordableFocusClick(el)) {
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
    const row = rowBtn.closest('tr');
    const buttonText = visibleText(rowBtn);
    return Object.assign({
      kind: 'click_table_row_button',
      row_text: row ? visibleText(row).slice(0, 40) : '',
      button_text: buttonText,
      source_channel: 'cdp_bib',
    }, elMeta(rowBtn, buttonText));
  }

  const tableRadio = el.closest && el.closest(
    '.el-table__body .el-radio, .el-table__body .el-radio-button, .el-table__row .el-radio, .el-table__row .el-radio-button'
  );
  if (tableRadio) {
    const row = tableRadio.closest('.el-table__row, tr');
    const rowText = row ? visibleText(row).slice(0, 80) : '';
    return Object.assign({
      kind: 'click_table_row_radio',
      row_text: rowText,
      source_channel: 'cdp_bib',
    }, elMeta(tableRadio, rowText || 'radio'));
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
        const item = el.closest && el.closest('.el-form-item');
        const lbl = item && item.querySelector('.el-form-item__label');
        const label = (lbl && lbl.textContent || '').trim().replace(/[：:*\\s]+$/g, '');
        const value = el.value || '';
        const isDate = !!(el.closest && el.closest('.el-date-editor'));
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
          kind: isDate ? 'fill_date' : 'fill',
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
