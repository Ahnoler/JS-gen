"""JS_MANUAL_RECORDER part A (injected page script, first half)."""

JS_MANUAL_PART_A = r'''(() => {
  window.__jsgenManualEnabled = true;

  const PREFIX = '__JSGEN_MANUAL__';
  let lastSig = '';
  let lastTs = 0;

  function emit(payload) {
    if (!window.__jsgenManualEnabled) return;
    if (window.__jsgenManualSkipUntil && Date.now() < window.__jsgenManualSkipUntil) return;
    const sig = JSON.stringify(payload);
    const now = Date.now();
    // Debounce identical events within 400ms
    if (sig === lastSig && now - lastTs < 400) return;
    lastSig = sig;
    lastTs = now;
    // Prefer Playwright binding (survives better than console on some pages)
    try {
      if (typeof window.__jsgenManualEmit === 'function') {
        window.__jsgenManualEmit(payload);
        return;
      }
    } catch (e) {}
    try { console.log(PREFIX + sig); } catch (e) {}
  }

  function xpathOf(el) {
    if (!el || el.nodeType !== 1) return '';
    if (el.id && !isGeneratedId(el.id)) return '//*[@id="' + el.id + '"]';
    const parts = [];
    let cur = el;
    while (cur && cur.nodeType === 1 && cur !== document.documentElement) {
      let ix = 1;
      let sib = cur.previousElementSibling;
      while (sib) {
        if (sib.tagName === cur.tagName) ix++;
        sib = sib.previousElementSibling;
      }
      parts.unshift(cur.tagName.toLowerCase() + '[' + ix + ']');
      cur = cur.parentElement;
    }
    return '/html' + (parts.length ? '/' + parts.join('/') : '');
  }

  // Same algorithm as browser_use/dom/buildDomTree.js getXPathTree(el, true)
  // Index in selector_map is only meaningful together with this xpath.
  function buElementPosition(currentElement) {
    if (!currentElement || !currentElement.parentElement) return 0;
    const tagName = currentElement.nodeName.toLowerCase();
    const siblings = Array.from(currentElement.parentElement.children)
      .filter((sib) => sib.nodeName.toLowerCase() === tagName);
    if (siblings.length === 1) return 0;
    return siblings.indexOf(currentElement) + 1;
  }

  function buXPathOf(el) {
    if (!el || el.nodeType !== 1) return '';
    const segments = [];
    let currentElement = el;
    while (currentElement && currentElement.nodeType === 1) {
      const parent = currentElement.parentNode;
      if (parent && (parent.nodeType === 11 /* ShadowRoot */ ||
          (parent.nodeName && parent.nodeName.toLowerCase() === 'iframe'))) {
        break;
      }
      const position = buElementPosition(currentElement);
      const tagName = currentElement.nodeName.toLowerCase();
      segments.unshift(tagName + (position > 0 ? '[' + position + ']' : ''));
      currentElement = parent;
    }
    return segments.join('/');
  }

  // If browser_use highlights are still on the page, read stamped index
  function highlightIndexOf(el) {
    let cur = el;
    while (cur && cur.nodeType === 1) {
      const hid = cur.getAttribute && cur.getAttribute('browser-user-highlight-id');
      if (hid && hid.indexOf('playwright-highlight-') === 0) {
        const n = parseInt(hid.slice('playwright-highlight-'.length), 10);
        if (!isNaN(n)) return n;
      }
      cur = cur.parentElement;
    }
    return null;
  }

  function placeholderLabel(el) {
    const ph = (el && el.getAttribute && el.getAttribute('placeholder')) || '';
    return (ph || '').replace(/^请输入/, '').replace(/[：:*\s]+$/g, '').trim();
  }

  function formItemLabel(node) {
    const item = node.closest && node.closest('.el-form-item');
    if (!item) return '';
    const lbl = item.querySelector('.el-form-item__label');
    const t = (lbl && lbl.textContent || '').trim().replace(/[：:*\s]+$/g, '');
    return t || placeholderLabel(node);
  }

  function openDateEditorMeta() {
    let editor = null;
    // Prefer LIVE open/focused editor over stale stash (multi date fields in one form)
    editor = document.querySelector('.el-date-editor.is-active');
    if (!editor) {
      const eds = Array.from(document.querySelectorAll('.el-date-editor'));
      for (const ed of eds) {
        const inp = ed.querySelector('input');
        if (inp && inp.getAttribute('aria-expanded') === 'true') { editor = ed; break; }
      }
    }
    if (!editor) {
      const focused = document.querySelector('.el-date-editor .el-input.is-focus, .el-date-editor input:focus');
      if (focused) editor = focused.closest('.el-date-editor');
    }
    const active = document.activeElement;
    if (!editor && active && active.closest) editor = active.closest('.el-date-editor');
    if (!editor) {
      try {
        if (window.__jsgenActiveDateEditor && document.contains(window.__jsgenActiveDateEditor)) {
          editor = window.__jsgenActiveDateEditor;
        }
      } catch (e) {}
    }
    if (editor) {
      try { window.__jsgenActiveDateEditor = editor; } catch (e) {}
    }
    if (!editor) return { label: '', editor: null, input: null };
    return { label: formItemLabel(editor), editor: editor, input: editor.querySelector('input') };
  }

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
      const ym = t.match(/(\d{4})\s*年/);
      const mm = t.match(/(\d{1,2})\s*月/);
      if (ym) year = parseInt(ym[1], 10);
      if (mm) month = parseInt(mm[1], 10);
    }
    if (year == null || month == null) {
      const header = panel.querySelector('.el-date-picker__header');
      const ht = (header && header.textContent || '').replace(/\s+/g, ' ');
      const ym = ht.match(/(\d{4})\s*年/);
      const mm = ht.match(/(\d{1,2})\s*月/);
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

  function visibleText(el) {
    if (!el) return '';
    return (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 80);
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
    const key = (dataRow.getAttribute && (dataRow.getAttribute('data-row-key')
      || dataRow.getAttribute('data-key'))) || '';
    const cells = dataRow.querySelectorAll('td');
    const parts = [];
    for (const td of cells) {
      const onlySelect = td.querySelector('.el-radio, .el-checkbox');
      let t = (td.innerText || td.textContent || '').trim().replace(/\s+/g, ' ');
      if (onlySelect && t.length < 2) continue;
      if (!t || t === 'radio' || t === 'checkbox') continue;
      parts.push(t);
    }
    if (!parts.length) {
      if (key) return String(key).slice(0, 80);
      const raw = (dataRow.innerText || dataRow.textContent || '').trim().replace(/\s+/g, ' ');
      if (!raw || raw === 'radio' || raw === 'checkbox') return '';
      return raw.slice(0, 80);
    }
    const best = parts.find((p) => p.length >= 2 && !/^(操作|编辑|删除|修改|查看|详情)$/.test(p)) || parts[0];
    return String(best || key || '').slice(0, 80);
  }

  function attrs(el) {
    const a = {};
    if (!el || !el.attributes) return a;
    for (const at of el.attributes) {
      if (at.value && at.value.length < 120) a[at.name] = at.value;
    }
    return a;
  }

  function isInIgnore(el) {
    if (!el || !el.closest) return true;
    if (el.closest('.el-select-dropdown, .el-picker-panel, .el-message, .el-notification')) {
      // dropdown option clicks are handled specially below
      if (el.closest('.el-select-dropdown__item, .el-cascader-node, .el-tree-node__content, .el-picker-panel__content td')) {
        return false;
      }
      return true;
    }
    // el-popper may host popup menus — allow menu items inside
    if (el.closest('.el-popper')) {
      if (el.closest('.el-menu-item, .el-submenu__title, .el-dropdown-menu__item, .el-select-dropdown__item, .el-cascader-node, .el-tree-node__content')) {
        return false;
      }
      return true;
    }
    return false;
  }

  function shortLabel(el) {
    if (!el) return '';
    // Prefer semantic attrs (submenu title / data-*) over nested innerText dump
    const fromAttr = (el.getAttribute && (
      el.getAttribute('title') ||
      el.getAttribute('aria-label') ||
      el.getAttribute('data-name') ||
      el.getAttribute('data-menu') ||
      ''
    )) || '';
    if (fromAttr.trim()) return fromAttr.trim().replace(/\s+/g, ' ').slice(0, 40);
    const t = visibleText(el);
    if (!t) return '';
    return t.split(/[\n\r]/)[0].trim().slice(0, 40);
  }

'''
