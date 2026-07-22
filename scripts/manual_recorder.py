"""
Manual (human) DOM recorder — injects a page listener that captures user
interactions and maps them to controller ActionEntry (source=manual).

Flow:
  Dashboard 「开始人工录制」
    → Node POST /manual-record {enabled:true}
    → Python event manual_record_start
    → inject JS + page.on('console')
    → user clicks/fills in Chrome
    → console `__JSGEN_MANUAL__{...}`
    → map to ActionEntry → _ACTION_LOG → emit manual_action_recorded
    → Node appendRecordedStep(source=manual)

TODO (以后做 — 人工 click 的真实 highlight index):
  当前 click_element_by_index 的 params.index 固定为 -1，定位靠点击瞬间 xpath/text。
  原因：click 事件到达 Python 时页面往往已跳转，事后 get_state / selector_map 会偏。

  可行方案（预刷缓存 + mousedown 内存匹配）:
  1. Agent 空闲 / 人工录制开启时，周期性或按需 browser_context.get_state()，
     缓存当次 selector_map（xpath / attrs / text → index）。
  2. 页面侧改用 mousedown capture 上报（早于导航），用 bu_xpath 等与缓存做
     内存匹配得到 index，不再在 Python 侧事后 get_state。
  3. 未命中缓存时仍回退 index=-1 + xpath/text。
"""
from __future__ import annotations

import json
import re
import sys
from typing import Any, Callable, Optional

from .actions._state import (
    _ACTION_LOG,
    _record_action,
    set_current_source,
)
from .agent_utils import emit_json

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


def _xpath_literal(text: str) -> str:
    t = str(text or '')
    if "'" not in t:
        return f"'{t}'"
    if '"' not in t:
        return f'"{t}"'
    parts = t.split("'")
    return 'concat(' + ', "\'", '.join(f"'{p}'" for p in parts) + ')'


def _build_xpath_smart(tag: str, text: str, xpath_abs: str = '', class_name: str = '') -> str:
    """Text-anchored xpath for buttons/links — stable across dialog remounts."""
    t = re.sub(r'\s+', ' ', str(text or '')).strip()[:40]
    if not t:
        return ''
    tag_l = (tag or '').lower()
    cls = class_name or ''
    clickable = tag_l in ('button', 'a') or bool(re.search(r'(?:^|\s)el-button(?:\s|$)', cls))
    if not clickable:
        return ''
    lit = _xpath_literal(t)
    local = f'a[normalize-space()={lit}]' if tag_l == 'a' else f'button[normalize-space()={lit}]'
    abs_l = xpath_abs or ''
    if re.search(r'el-drawer', abs_l, re.I) or re.search(r'el-drawer', cls, re.I):
        return f"(//div[contains(@class,'el-drawer')])[last()]//{local}"
    if re.search(r'el-dialog|el-message-box', abs_l, re.I) or re.search(
        r'el-dialog|el-message-box', cls, re.I
    ):
        return (
            "(//div[contains(@class,'el-dialog') or contains(@class,'el-message-box')])[last()]"
            f"//{local}"
        )
    return f'//{local}'


def _map_dom_event_to_action(payload: dict) -> Optional[tuple[str, dict, Optional[dict]]]:
    """
    Map a DOM event payload to (action_name, params, element_info).
    Returns None if the event should be ignored.

    Manual click_element_by_index always uses index=-1; locate via xpath/text.
    """
    kind = (payload.get('kind') or '').strip()
    attrs = payload.get('attributes') or {}
    text = payload.get('text') or attrs.get('title') or ''
    text = re.sub(r'\s+', ' ', str(text or '')).strip()
    abs_xp = payload.get('xpath_abs') or payload.get('xpath_full') or ''
    bu = payload.get('bu_xpath') or ''
    smart = payload.get('xpath_smart') or ''
    tag = payload.get('tag') or ''
    cls = str(attrs.get('class') or attrs.get('className') or '')
    if not smart:
        smart = _build_xpath_smart(tag, text, abs_xp or str(payload.get('xpath') or ''), cls)
    css = payload.get('cssSelector') or payload.get('css_selector') or ''
    primary = smart or bu or payload.get('xpath') or abs_xp or ''
    candidates = payload.get('candidates')
    if not isinstance(candidates, list) or not candidates:
        candidates = []
        if smart:
            candidates.append({'type': 'xpath_smart', 'value': smart})
        if abs_xp:
            candidates.append({'type': 'xpath_full', 'value': abs_xp})
        elif primary and primary != smart:
            candidates.append({'type': 'xpath_full', 'value': primary})
        if css:
            candidates.append({'type': 'css', 'value': css})
    element = {
        'xpath': primary,
        'bu_xpath': bu,
        'xpath_abs': abs_xp or payload.get('xpath') or '',
        'xpath_full': abs_xp or '',
        'xpath_smart': smart,
        'tag_name': tag,
        'css_selector': css,
        'attributes': attrs,
        'text': text,
        'candidates': candidates,
    }

    if kind == 'fill':
        label = (payload.get('label_text') or '').strip()
        value = payload.get('value')
        if value is None:
            return None
        if not label and not element['xpath']:
            return None
        # Prefer labeled form fills for assembler
        if label:
            return 'fill_form_field', {'label_text': label, 'value': value}, element
        return 'fill_form_field', {'label_text': label or element['xpath'], 'value': value}, element

    if kind == 'fill_date':
        label = (payload.get('label_text') or '').strip()
        value = (payload.get('value') or '').strip()
        if not label or not value:
            return None
        return 'fill_date_field', {'label_text': label, 'value': value}, element

    if kind == 'select_option':
        label = (payload.get('label_text') or '').strip()
        option = (payload.get('option_text') or '').strip()
        if not option:
            return None
        return 'select_option', {'label_text': label or option, 'option_text': option}, element

    def _as_click_by_index(text: str):
        """Manual clicks → click_element_by_index with index=-1 (xpath/text locate only)."""
        t = (text or '').strip()
        if not t and not element.get('xpath') and not element.get('bu_xpath'):
            return None
        # Reject junk hits: empty body-level shells like /div[2] (teleport/mask)
        tag = (element.get('tag_name') or '').lower()
        attrs_map = element.get('attributes') or {}
        cls = str(attrs_map.get('class') or attrs_map.get('className') or '')
        xp = (element.get('bu_xpath') or element.get('xpath') or element.get('xpath_abs') or '').strip()
        # Body teleport /div[N] — never a durable control (even if text stole a date value)
        if re.match(r'^(html/body/)?/?div\[\d+\]$', xp, re.I):
            return None
        # Date-string clicks from reopening el-date-editor / picker residue
        if re.match(r'^\d{4}-\d{2}-\d{2}$', t) and tag in ('div', 'span', 'input', ''):
            return None
        if (
            not t
            and tag in ('div', 'span')
            and not cls
            and not attrs_map.get('id')
            and not attrs_map.get('role')
        ):
            # empty anonymous div/span with no usable locator text
            if tag in ('div', 'span') and not t:
                return None
        # Keep text on element for assembler XPath/text degradation chain
        if t and not element.get('text'):
            element['text'] = t
        return 'click_element_by_index', {
            # Manual recording: never resolve browser_use highlight index.
            # Post-click get_state sees a different page → wrong index/xpath.
            'index': -1,
            'tag_name': element.get('tag_name') or '',
            'text': t,
        }, element

    # Menu / nav / generic clicks → click_element_by_index (assembler N-tier relocate)
    if kind == 'click_menu_item':
        return _as_click_by_index(payload.get('menu_text') or payload.get('text') or '')

    if kind == 'click_table_row_button':
        btn = (payload.get('button_text') or payload.get('text') or '').strip()
        return _as_click_by_index(btn)

    if kind == 'click_table_row_radio':
        row = (payload.get('row_text') or '').strip()
        # Reject junk fallbacks from empty fixed-column rows (was recorded as "radio")
        if not row or row.lower() in ('radio', 'checkbox', 'true', 'false'):
            return None
        return 'click_table_row_radio', {'row_text': row}, element

    if kind == 'click_adjacent_button':
        # Prefer button visible text; fall back to field label
        return _as_click_by_index(payload.get('text') or payload.get('label_text') or '')

    if kind == 'click':
        return _as_click_by_index(payload.get('text') or '')

    # Specialized form widgets keep dedicated actions
    if kind == 'click_radio':
        label = (payload.get('label_text') or '').strip()
        option = (payload.get('option_text') or '').strip()
        if not option:
            return None
        return 'click_radio', {'label_text': label, 'option_text': option}, element

    if kind == 'switch_tab':
        name = (payload.get('tab_name') or '').strip()
        if not name:
            return None
        return 'switch_tab', {'tab_name': name}, element

    if kind == 'close_dialog':
        return 'close_dialog', {}, element

    return None


class ManualRecorder:
    """Manages inject + console/binding listener lifecycle for one browser_context."""

    def __init__(self, browser_context):
        self.browser_context = browser_context
        self.enabled = False
        self._console_handlers: dict[int, Callable] = {}  # page id → handler
        self._bound_pages: set[int] = set()
        self._binding_pages: set[int] = set()
        self._nav_hooks: set[int] = set()
        self._handle_lock = None  # asyncio.Lock, created lazily

    async def start(self) -> dict:
        self.enabled = True
        page = await self.browser_context.get_current_page()
        await self._attach_page(page)

        # Best-effort: listen for new pages
        try:
            session = getattr(self.browser_context, 'session', None)
            ctx = getattr(session, 'context', None) if session else None
            if ctx is not None:
                def _on_page(p):
                    import asyncio
                    try:
                        asyncio.get_event_loop().create_task(self._attach_page(p))
                    except Exception:
                        pass
                ctx.on('page', _on_page)
        except Exception as e:
            sys.stderr.write(f'[manual-recorder] page listener skip: {e}\n')
            sys.stderr.flush()

        # Brief warm-up: skip focus-only clicks while inject/CDP paths settle
        try:
            await page.evaluate(
                '() => { window.__jsgenManualWarmUntil = Date.now() + 1200; }'
            )
        except Exception:
            pass

        emit_json({"event": "manual_record_status", "data": {"enabled": True}})
        sys.stderr.write('[manual-recorder] STARTED\n')
        sys.stderr.flush()
        return {"enabled": True}

    async def stop(self) -> dict:
        self.enabled = False
        # Disable flag in all pages
        for page_id in list(self._bound_pages):
            try:
                page = self._find_page(page_id)
                if page:
                    await page.evaluate('() => { window.__jsgenManualEnabled = false; }')
            except Exception:
                pass
        # Also try current page
        try:
            page = await self.browser_context.get_current_page()
            if page:
                await page.evaluate('() => { window.__jsgenManualEnabled = false; }')
        except Exception:
            pass
        emit_json({"event": "manual_record_status", "data": {"enabled": False}})
        sys.stderr.write('[manual-recorder] STOPPED\n')
        sys.stderr.flush()
        return {"enabled": False}

    def _find_page(self, page_id: int):
        return None  # best-effort; reinject uses current page

    def _pw_page(self, page):
        return getattr(page, 'page', page)

    async def _on_new_page(self, page):
        if self.enabled:
            await self._attach_page(page)

    async def _reinject(self, page):
        if not self.enabled:
            return
        try:
            await page.evaluate(JS_MANUAL_RECORDER)
            # Force enable even if install was a no-op leftover flag from init race
            await page.evaluate(
                '() => { window.__jsgenManualEnabled = true; window.__jsgenManualWarmUntil = Date.now() + 1200; }'
            )
        except Exception as e:
            sys.stderr.write(f'[manual-recorder] reinject failed: {e}\n')
            sys.stderr.flush()

    async def _ensure_binding(self, page) -> None:
        """Playwright expose_binding — more reliable than console.log on overridden pages."""
        target = self._pw_page(page)
        pid = id(target)
        if pid in self._binding_pages:
            return

        def _on_emit(source, payload):
            if not self.enabled:
                return
            if isinstance(payload, dict):
                self._schedule_payload(payload)
            elif isinstance(payload, str):
                try:
                    self._schedule_payload(json.loads(payload))
                except Exception:
                    pass

        try:
            await target.expose_binding('__jsgenManualEmit', _on_emit)
            self._binding_pages.add(pid)
            sys.stderr.write('[manual-recorder] binding __jsgenManualEmit ready\n')
            sys.stderr.flush()
        except Exception as e:
            # Already registered or unsupported — console fallback remains
            self._binding_pages.add(pid)
            sys.stderr.write(f'[manual-recorder] binding skip: {e}\n')
            sys.stderr.flush()

    async def _attach_page(self, page) -> None:
        if page is None:
            return
        pid = id(page)
        target = self._pw_page(page)

        await self._ensure_binding(page)

        # Survive full page reloads
        try:
            await target.add_init_script(JS_MANUAL_RECORDER)
        except Exception as e:
            sys.stderr.write(f'[manual-recorder] init_script skip: {e}\n')
            sys.stderr.flush()

        try:
            await page.evaluate(JS_MANUAL_RECORDER)
            await page.evaluate('() => { window.__jsgenManualEnabled = true; }')
        except Exception as e:
            sys.stderr.write(f'[manual-recorder] inject failed: {e}\n')
            sys.stderr.flush()
            return

        # Re-inject after navigations (SPA soft-nav may keep listeners; hard nav needs this)
        if pid not in self._nav_hooks:
            self._nav_hooks.add(pid)

            def _schedule_reinject(*_args):
                if not self.enabled:
                    return
                import asyncio
                try:
                    loop = asyncio.get_event_loop()
                    if loop.is_running():
                        loop.create_task(self._reinject(page))
                except Exception:
                    pass

            try:
                target.on('load', _schedule_reinject)
                target.on('framenavigated', lambda frame: (
                    _schedule_reinject() if frame == target.main_frame else None
                ))
            except Exception as e:
                sys.stderr.write(f'[manual-recorder] nav hook skip: {e}\n')
                sys.stderr.flush()

        if pid in self._bound_pages:
            return
        self._bound_pages.add(pid)

        def on_console(msg):
            if not self.enabled:
                return
            try:
                text = msg.text if hasattr(msg, 'text') else str(msg)
            except Exception:
                return
            if not text.startswith('__JSGEN_MANUAL__'):
                return
            raw = text[len('__JSGEN_MANUAL__'):]
            try:
                payload = json.loads(raw)
            except Exception:
                return
            self._schedule_payload(payload)

        try:
            target.on('console', on_console)
            self._console_handlers[pid] = on_console
        except Exception as e:
            sys.stderr.write(f'[manual-recorder] console bind failed: {e}\n')
            sys.stderr.flush()

    def _schedule_payload(self, payload: dict) -> None:
        """Queue async handling so click index can be resolved via DomService scan."""
        import asyncio

        async def _runner():
            try:
                await self._handle_payload_async(payload)
            except Exception as e:
                sys.stderr.write(f'[manual-recorder] handle failed: {e}\n')
                sys.stderr.flush()

        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            loop = None

        if loop is not None:
            try:
                loop.call_soon_threadsafe(lambda: loop.create_task(_runner()))
                return
            except Exception:
                try:
                    loop.create_task(_runner())
                    return
                except Exception:
                    pass

        try:
            loop = asyncio.get_event_loop()
            if loop.is_running():
                loop.create_task(_runner())
                return
        except Exception:
            pass

        # Last resort: record without selector_map refresh
        self._record_mapped(_map_dom_event_to_action(payload))

    def ingest_external(self, payload: dict) -> None:
        """Ingest a payload from Node CDP BiB path (same shape as page inject)."""
        if not self.enabled or not isinstance(payload, dict):
            return
        import time
        sig = json.dumps(payload, sort_keys=True, ensure_ascii=False)[:500]
        now = time.time()
        last = getattr(self, '_ext_last', None)
        if last and last[0] == sig and now - last[1] < 0.45:
            return
        self._ext_last = (sig, now)
        self._schedule_payload(payload)

    async def _ensure_lock(self):
        import asyncio
        if self._handle_lock is None:
            self._handle_lock = asyncio.Lock()
        return self._handle_lock

    def _record_mapped(self, mapped) -> Optional[dict]:
        if not mapped:
            return None
        action_name, params, element = mapped
        try:
            set_current_source('manual')
            result = (
                f'manual:click_element_by_index'
                if action_name == 'click_element_by_index'
                else f'manual:{action_name}'
            )
            entry = _record_action(
                action_name, params,
                result,
                element=element,
                source='manual',
            )
        finally:
            set_current_source('agent')

        if not entry:
            return None

        emit_json({
            "event": "manual_action_recorded",
            "data": {
                "entry": entry,
                "count": len(_ACTION_LOG),
            },
        })
        sys.stderr.write(f'[manual-recorder] {action_name} {params}\n')
        sys.stderr.flush()
        return entry

    async def _handle_payload_async(self, payload: dict) -> None:
        lock = await self._ensure_lock()
        async with lock:
            mapped = _map_dom_event_to_action(payload)
            if not mapped:
                sys.stderr.write(f'[manual-recorder] unmapped kind={payload.get("kind")}\n')
                sys.stderr.flush()
                return
            action_name, params, element = mapped
            # Manual click_element_by_index: keep index=-1 and xpath/text from the
            # DOM event at click time. Do NOT call get_state / selector_map — that
            # reflects the post-navigation page and skews index + xpath.
            if action_name == 'click_element_by_index':
                params['index'] = -1

            self._record_mapped((action_name, params, element))


def asyncio_create_task(coro):
    import asyncio
    try:
        loop = asyncio.get_event_loop()
        if loop.is_running():
            return loop.create_task(coro)
    except Exception:
        pass
    return None
