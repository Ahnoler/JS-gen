"""Injected page script for manual DOM recording."""
from __future__ import annotations

# ── Injected page script ───────────────────────────────────────────────────
# Emits console messages: __JSGEN_MANUAL__ + JSON payload
JS_MANUAL_RECORDER = r'''(() => {
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
    if (el.id) return '//*[@id="' + el.id + '"]';
    const parts = [];
    let cur = el;
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

  function formItemLabel(el) {
    const item = el.closest('.el-form-item');
    if (!item) return '';
    const lbl = item.querySelector('.el-form-item__label');
    return (lbl && lbl.textContent || '').trim().replace(/[：:*\s]+$/g, '');
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
      const raw = (dataRow.innerText || dataRow.textContent || '').trim().replace(/\s+/g, ' ');
      if (!raw || raw === 'radio' || raw === 'checkbox') return '';
      return raw.slice(0, 80);
    }
    const best = parts.find((p) => p.length >= 2 && !/^(操作|编辑|删除|修改|查看|详情)$/.test(p)) || parts[0];
    return String(best || '').slice(0, 80);
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

  function elMeta(el, textOverride) {
    const t = textOverride != null ? String(textOverride) : shortLabel(el);
    const hi = highlightIndexOf(el);
    // Prefer browser_use-compatible xpath for assembler; keep absolute as backup
    const bu = buXPathOf(el);
    const abs = xpathOf(el);
    const tag = (el.tagName || '').toLowerCase();
    const cls = String((el.getAttribute && el.getAttribute('class')) || el.className || '');
    // Text-anchored smart xpath for buttons/links (stable across dialog remounts)
    let smart = '';
    const nt = String(t || '').replace(/\\s+/g, ' ').trim().slice(0, 40);
    if (nt && (tag === 'button' || tag === 'a' || /(^| )el-button( |$)/.test(cls))) {
      const lit = nt.indexOf("'") < 0 ? ("'" + nt + "'") : ('"' + nt.replace(/"/g, '') + '"');
      const local = tag === 'a' ? ('a[normalize-space()=' + lit + ']') : ('button[normalize-space()=' + lit + ']');
      const inDrawer = !!(el.closest && el.closest('.el-drawer'));
    const inDialog = !!(el.closest && el.closest('.el-dialog, .el-message-box'));
    if (inDrawer) {
      smart = "(//div[contains(@class,'el-drawer')])[last()]//" + local;
    } else if (inDialog) {
      smart = "(//div[contains(@class,'el-dialog') or contains(@class,'el-message-box')])[last()]//" + local;
    } else {
      smart = '//' + local;
    }
    }
    const primary = smart || bu || abs;
    const candidates = [];
    if (smart) candidates.push({ type: 'xpath_smart', value: smart });
    if (abs) candidates.push({ type: 'xpath_full', value: abs });
    const meta = {
      xpath: primary,
      bu_xpath: bu,
      xpath_abs: abs,
      xpath_full: abs,
      xpath_smart: smart,
      candidates: candidates,
      tag: tag,
      attributes: attrs(el),
      text: nt || t,
    };
    if (hi != null) meta.highlight_index = hi;
    return meta;
  }

  function emitMenu(menuEl) {
    const menuText = shortLabel(menuEl);
    if (!menuText) return false;
    emit(Object.assign({ kind: 'click_menu_item', menu_text: menuText }, elMeta(menuEl, menuText)));
    return true;
  }

  function isNonRecordableFocusClick(el) {
    if (!el || !el.closest) return false;
    // Real action controls inside a form-item must still be recorded
    if (el.closest('.el-radio, .el-checkbox, .el-switch, button, .el-button, a[href], .el-upload')) {
      if (!el.closest('.el-select, .el-cascader, .el-date-editor, .el-input, .el-autocomplete')) {
        return false;
      }
    }
    if (el.closest(
      '.el-select, .el-cascader, .el-date-editor, .el-time-picker, .el-autocomplete,' +
      '.el-input__inner, .el-input__suffix, .el-input__prefix, .el-input__icon,' +
      '.el-textarea__inner, .el-select__caret, .el-input__suffix-inner'
    )) {
      return true;
    }
    const focusInput = el.closest('input, textarea, .el-input, .el-textarea');
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
    const formItem = el.closest('.el-form-item');
    if (formItem && formItem.querySelector(
      '.el-select, .el-cascader, .el-date-editor, .el-time-picker, .el-autocomplete,' +
      '.el-input, .el-textarea, input:not([type=checkbox]):not([type=radio]):not([type=hidden]), textarea'
    )) {
      return true;
    }
    return false;
  }

  // --- clicks (assigned so reinject can hot-update without duplicate listeners) ---
  window.__jsgenManualOnClick = (ev) => {
    if (!window.__jsgenManualEnabled) return;
    if (window.__jsgenManualSkipUntil && Date.now() < window.__jsgenManualSkipUntil) return;
    let el = ev.target;
    if (!el) return;
    if (el.nodeType !== 1) el = el.parentElement;
    if (!el || !el.closest) return;

    // Skip anonymous body teleports / masks (same junk as CDP /div[2] pattern)
    const junkCls = /(^| )(v-modal|el-loading-mask|el-overlay|el-dialog__wrapper|el-drawer__wrapper|el-message|el-notification|el-popper|el-select-dropdown|el-picker-panel)( |$)/;
    if (el === document.body || el === document.documentElement) return;
    if (junkCls.test(String(el.className || ''))) {
      if (!el.closest('.el-select-dropdown__item, .el-cascader-node, .el-picker-panel td')) return;
    }
    if (el.parentElement === document.body && !el.id && !String(el.className || '').trim()) return;

    // el-select option
    const opt = el.closest('.el-select-dropdown__item');
    if (opt) {
      const optionText = visibleText(opt);
      // find active select input if possible
      const open = document.querySelector('.el-select .el-input.is-focus, .el-select .is-focus');
      const label = open ? formItemLabel(open) : '';
      emit({
        kind: 'select_option',
        label_text: label,
        option_text: optionText,
        xpath: xpathOf(opt),
        tag: 'li',
        attributes: attrs(opt),
        text: optionText,
      });
      return;
    }

    // Date picker day → fill_date (calendar pick, not typed)
    const dateTd = el.closest('.el-date-table td');
    if (dateTd && dateTd.closest('.el-picker-panel, .el-date-picker')) {
      const built = dateValueFromPickerCell(dateTd);
      const before = Array.from(document.querySelectorAll('.el-date-editor')).filter((ed) => ed.offsetParent !== null).map((ed) => {
        const input = ed.querySelector('input');
        return { label: formItemLabel(ed), value: String((input && input.value) || '').trim() };
      });
      openDateEditorMeta();
      // Defer: detect which date field changed (multi-date forms); also covers year/month arrow focus loss
      setTimeout(() => {
        const after = Array.from(document.querySelectorAll('.el-date-editor')).filter((ed) => ed.offsetParent !== null).map((ed) => {
          const input = ed.querySelector('input');
          return { label: formItemLabel(ed), value: String((input && input.value) || '').trim(), input: input, ed: ed };
        });
        const beforeMap = {};
        for (const b of before) beforeMap[b.label] = b.value;
        let pick = null;
        const changed = after.filter((a) => a.label && a.value && a.value !== (beforeMap[a.label] || ''));
        if (built) pick = changed.find((a) => a.value === built) || null;
        if (!pick && changed.length === 1) pick = changed[0];
        if (!pick && changed.length > 1) pick = changed[changed.length - 1];
        if (!pick) {
          const meta = openDateEditorMeta();
          const value = String((meta.input && meta.input.value) || built || '').trim();
          const label = (meta.label || '').trim();
          if (value && label) pick = { label: label, value: value, input: meta.input };
        }
        if (!pick || !pick.label || !pick.value) return;
        emit(Object.assign({
          kind: 'fill_date',
          label_text: pick.label,
          value: pick.value,
        }, elMeta(pick.input || dateTd, pick.value)));
      }, 80);
      return;
    }
    if (el.closest('.el-picker-panel, .el-date-picker, .el-time-panel')) {
      openDateEditorMeta();
      return;
    }

    // Opening select/cascader/date is NOT a step — only the option pick above counts
    if (
      el.closest('.el-select') ||
      el.closest('.el-cascader') ||
      el.closest('.el-date-editor') ||
      el.closest('.el-time-picker') ||
      el.closest('.el-autocomplete')
    ) {
      const dateEd = el.closest('.el-date-editor');
      if (dateEd) {
        try { window.__jsgenActiveDateEditor = dateEd; } catch (e) {}
      }
      return;
    }

    // Focusing a text field is NOT a step — fill is recorded on leave / change
    if (isNonRecordableFocusClick(el)) {
      return;
    }

    // Element UI / dropdown menu (including popup menus teleported to body)
    const menu = el.closest(
      '.el-menu-item, .el-submenu__title, .el-menu--popup .el-menu-item, .el-dropdown-menu__item, [role="menuitem"]'
    );
    if (menu && emitMenu(menu)) return;

    // Sidebar / nav area: custom menus without el-menu classes (e.g. 客户管理)
    const navRoot = el.closest(
      'aside, .el-aside, nav, .el-menu, [class*="sidebar"], [class*="side-menu"], [class*="SideMenu"], [class*="nav-menu"], [class*="NavMenu"], [class*="menu-wrap"]'
    );
    if (navRoot) {
      const item = el.closest('li, a, button, [role="menuitem"], [class*="menu-item"], [class*="MenuItem"]') || el;
      if (emitMenu(item)) return;
    }

    // table row action button
    const rowBtn = el.closest('.el-table__body .el-button, .el-table__body button, .el-table__body a');
    if (rowBtn) {
      const rowText = tableRowIdentityText(rowBtn).slice(0, 40);
      const buttonText = visibleText(rowBtn);
      emit(Object.assign({
        kind: 'click_table_row_button',
        row_text: rowText,
        button_text: buttonText,
      }, elMeta(rowBtn, buttonText)));
      return;
    }

    // table row radio (e.g. 客户列表) — identify row by main-body cell text, not fixed-column shell
    const tableRadio = el.closest(
      '.el-table__body .el-radio, .el-table__body .el-radio-button, .el-table__row .el-radio, .el-table__row .el-radio-button,' +
      '.el-table__fixed .el-radio, .el-table__fixed-body-wrapper .el-radio, .el-table__fixed-left .el-radio'
    );
    if (tableRadio) {
      const rowText = tableRowIdentityText(tableRadio);
      if (!rowText) return; // cannot replay without a durable row key
      emit(Object.assign({
        kind: 'click_table_row_radio',
        row_text: rowText,
      }, elMeta(tableRadio, rowText)));
      return;
    }

    // radio in form
    const radio = el.closest('.el-radio, .el-radio-button');
    if (radio) {
      const label = formItemLabel(radio);
      const optionText = visibleText(radio);
      emit({
        kind: 'click_radio',
        label_text: label,
        option_text: optionText,
        xpath: xpathOf(radio),
        tag: radio.tagName.toLowerCase(),
        attributes: attrs(radio),
        text: optionText,
      });
      return;
    }

    // tab
    const tab = el.closest('.el-tabs__item');
    if (tab) {
      emit({
        kind: 'switch_tab',
        tab_name: visibleText(tab),
        xpath: xpathOf(tab),
        tag: tab.tagName.toLowerCase(),
        attributes: attrs(tab),
        text: visibleText(tab),
      });
      return;
    }

    // dialog close
    if (el.closest('.el-dialog__headerbtn, .el-drawer__close-btn')) {
      emit({
        kind: 'close_dialog',
        xpath: xpathOf(el),
        tag: el.tagName.toLowerCase(),
        attributes: attrs(el),
        text: '',
      });
      return;
    }

    // adjacent button next to form label (引入/查询 etc.)
    const adjBtn = el.closest('.el-form-item .el-button, .el-form-item button');
    if (adjBtn) {
      const label = formItemLabel(adjBtn);
      if (label) {
        emit(Object.assign({
          kind: 'click_adjacent_button',
          label_text: label,
        }, elMeta(adjBtn, visibleText(adjBtn))));
        return;
      }
    }

    // generic button / link / clickable
    const btn = el.closest('button, .el-button, a.el-link, a[href], [role="button"]');
    if (btn && !isInIgnore(btn)) {
      // Extra guard: never record select/date openers as clicks
      if (btn.closest('.el-select') || btn.closest('.el-cascader') || btn.closest('.el-date-editor')) {
        return;
      }
      const text = shortLabel(btn) || (btn.getAttribute && (btn.getAttribute('aria-label') || btn.getAttribute('title'))) || '';
      if (!text && (btn.tagName || '').toLowerCase() === 'div') return;
      emit(Object.assign({ kind: 'click' }, elMeta(btn, text)));
      return;
    }

    // tree node
    const tree = el.closest('.el-tree-node__content');
    if (tree) {
      emit(Object.assign({ kind: 'click' }, elMeta(tree)));
      return;
    }

    // Never emit empty anonymous div/span clicks (CDP /div[2] junk pattern)
    // or date-string clicks from reopening a filled date editor
    const tag = (el.tagName || '').toLowerCase();
    const t = shortLabel(el);
    if (/^\d{4}-\d{2}-\d{2}$/.test(t) && (tag === 'div' || tag === 'span' || tag === 'input')) {
      return;
    }
    if (el.parentElement === document.body && tag === 'div' && !el.id && !String(el.className || '').trim()) {
      return;
    }
    if (!t && (tag === 'div' || tag === 'span') && !String(el.className || '').trim() && !el.id) {
      return;
    }

    // Last-resort: any element with short visible text that looks like a control
    // (covers custom sidebar spans that are not inside known nav roots)
    if (!isInIgnore(el)) {
      const host = el.closest('[onclick], [ng-click], [class*="menu"], [class*="nav-item"], [class*="NavItem"]');
      if (host) {
        const text = shortLabel(host);
        if (text && text.length <= 20) {
          emit(Object.assign({ kind: 'click_menu_item', menu_text: text }, elMeta(host, text)));
        }
      }
    }
  };

  // --- input / change (form fields) ---
  function emitFill(el) {
    if (!window.__jsgenManualEnabled) return;
    if (!el || isInIgnore(el)) return;
    if (el.type === 'hidden' || el.type === 'password' && false) { /* allow password */ }
    const tag = (el.tagName || '').toLowerCase();
    if (tag !== 'input' && tag !== 'textarea') return;
    if (el.closest('.el-select')) return; // select handled via option click
    // Date: prefer calendar pick recording; only emit typed non-empty values.
    // TODO(date-leave-backup): blur/change 到其他字段时，若日期 input 已有非空值则补录
    // fill_date（与 src/cdp/inspect.js resolveFocusedFillPayload 同需求）。选天主路径够用前不实现。
    const isDate = !!el.closest('.el-date-editor');
    const label = formItemLabel(el);
    const value = el.value || '';
    if (!String(value).trim()) return;
    const kind = isDate ? 'fill_date' : 'fill';
    emit({
      kind: kind,
      label_text: label,
      value: value,
      xpath: xpathOf(el),
      tag: tag,
      attributes: attrs(el),
      text: value.slice(0, 80),
    });
  }

  window.__jsgenManualOnChange = (ev) => {
    const el = ev.target;
    if (el && el.matches && el.matches('input, textarea')) emitFill(el);
  };

  window.__jsgenManualOnBlur = (ev) => {
    const el = ev.target;
    if (el && el.matches && el.matches('input, textarea')) emitFill(el);
  };

  if (!window.__jsgenManualInstalled) {
    window.__jsgenManualInstalled = true;
    document.addEventListener('click', (ev) => {
      if (typeof window.__jsgenManualOnClick === 'function') window.__jsgenManualOnClick(ev);
    }, true);
    document.addEventListener('change', (ev) => {
      if (typeof window.__jsgenManualOnChange === 'function') window.__jsgenManualOnChange(ev);
    }, true);
    document.addEventListener('blur', (ev) => {
      if (typeof window.__jsgenManualOnBlur === 'function') window.__jsgenManualOnBlur(ev);
    }, true);
  }

  return 'installed';
})()'''

