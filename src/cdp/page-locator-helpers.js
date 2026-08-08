/**
 * PAGE_LOCATOR_HELPERS — extracted from locator-candidates.js.
 * Injected into CDP Runtime.evaluate; keep in sync with scripts/actions/_locator_helpers_js.py.
 */
export const PAGE_LOCATOR_HELPERS = `
  function xpathLiteral(text) {
    const t = String(text || '');
    if (t.indexOf("'") < 0) return "'" + t + "'";
    if (t.indexOf('"') < 0) return '"' + t + '"';
    const parts = t.split("'").map(function (p) { return "'" + p + "'"; });
    return 'concat(' + parts.join(", \\"'\\", ") + ')';
  }
  function normalizeControlText(text) {
    return String(text || '').replace(/\\s+/g, ' ').trim().slice(0, 40);
  }
  function normalizeFormLabel(text) {
    return String(text || '').replace(/\\s+/g, ' ').trim().replace(/[：:*\\s]+$/g, '').slice(0, 40);
  }
  function stripVolatileTreeText(text) {
    return String(text || '').replace(/\\s+/g, ' ').trim()
      .replace(/\\[\\s*V[-\\d.]+\\s*\\]$/i, '')
      .replace(/\\(\\d+\\)\\s*$/, '')
      .trim().slice(0, 40);
  }
  function extractElIconClass(className) {
    const m = String(className || '').match(/el-icon-[a-z0-9-]+/i);
    return m ? m[0] : '';
  }
  function classTokenPred(token) {
    const t = String(token || '').trim();
    if (!t) return '';
    return "contains(concat(' ',normalize-space(@class),' '),' " + t + " ')";
  }
  function hasClassToken(className, token) {
    const tokens = String(className || '').trim().split(/\\s+/).filter(Boolean);
    return tokens.indexOf(String(token || '').trim()) >= 0;
  }
  function isGeneratedId(id) {
    const s = String(id || '').trim();
    if (!s) return true;
    if (/^el-id-/i.test(s)) return true;
    if (/^\\d{4,}$/.test(s)) return true;
    if (/^tab-\\d{6,}$/i.test(s)) return true;
    if (/^[a-z]+-\\d{10,}$/i.test(s)) return true;
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)) return true;
    if (/^ember\\d+/i.test(s)) return true;
    if (/^vue-/i.test(s)) return true;
    if (/^:r[0-9a-z]+:/i.test(s)) return true;
    return false;
  }
  var MENU_CLASS_TOKENS = ['menu-item','submenu-item','nav-item','el-menu-item','el-submenu__title','el-dropdown-menu__item'];
  function cssOfSimple(node) {
    if (!node || node.nodeType !== 1) return '';
    if (node.id && !isGeneratedId(node.id)) {
      try { return '#' + CSS.escape(node.id); } catch (e) { return '#' + node.id; }
    }
    const tag = node.tagName.toLowerCase();
    const cls = String(node.className || '')
      .split(/\\s+/)
      .filter(Boolean)
      .slice(0, 3)
      .map(function (c) {
        try { return '.' + CSS.escape(c); } catch (e2) { return '.' + c; }
      })
      .join('');
    return tag + cls;
  }
  function absXPath(node) {
    if (!node || node.nodeType !== 1) return '';
    if (node.id && !isGeneratedId(node.id)) return '//*[@id="' + node.id + '"]';
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
  function isVisible(el) {
    if (!el || el.nodeType !== 1) return false;
    const st = getComputedStyle(el);
    if (st.display === 'none' || st.visibility === 'hidden' || Number(st.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }
  function scopeOf(node) {
    if (!node || !node.closest) return 'page';
    if (node.closest('.el-drawer')) return 'drawer';
    if (node.closest('.el-dialog, .el-message-box')) return 'dialog';
    if (node.closest('nav, aside, .el-aside, .el-menu, [class*="sidebar"], [class*="side-menu"], [class*="nav-menu"], [class*="menu-wrap"]')) return 'nav';
    if (node.closest('.el-table')) return 'table';
    if (node.closest('.el-form-item')) return 'form_item';
    return 'page';
  }
  function scopePrefix(kind) {
    // Do NOT use [last()] — DOM last is often a leftover hidden dialog
    if (kind === 'drawer') return "//div[contains(@class,'el-drawer')]";
    if (kind === 'dialog') return "//div[contains(@class,'el-dialog') or contains(@class,'el-message-box')]";
    if (kind === 'overlay') return "//div[contains(@class,'el-dialog') or contains(@class,'el-message-box') or contains(@class,'el-drawer')]";
    return '';
  }
  function scopedXPath(local, kind) {
    const loc = String(local || '').replace(/^\\/+/, '');
    if (!loc) return '';
    const prefix = scopePrefix(kind);
    if (prefix) return prefix + '//' + loc;
    return '//' + loc;
  }
  function withOccurrence(expr, occurrence) {
    const xp = String(expr || '').trim();
    if (!xp) return '';
    const n = Number(occurrence) || 0;
    if (n < 1) return xp;
    const body = xp.charAt(0) === '(' ? xp : '(' + xp + ')';
    return body + '[' + n + ']';
  }
  function cleanVisibleText(node) {
    if (!node) return '';
    const fromAttr = (node.getAttribute && (
      node.getAttribute('aria-label') ||
      node.getAttribute('title') ||
      node.getAttribute('data-name') ||
      node.getAttribute('data-menu') ||
      ''
    )) || '';
    if (fromAttr.trim()) return normalizeControlText(fromAttr);
    try {
      const clone = node.cloneNode(true);
      const kill = clone.querySelectorAll(
        '.el-badge, .el-badge__content, [class*="badge"], .el-icon, i[class*="icon"], .el-submenu__icon-arrow, .popper__arrow, sup, sub'
      );
      for (let i = 0; i < kill.length; i++) {
        if (kill[i] && kill[i].parentNode) kill[i].parentNode.removeChild(kill[i]);
      }
      return normalizeControlText(clone.innerText || clone.textContent || '');
    } catch (e) {
      return normalizeControlText(node.innerText || node.textContent || '');
    }
  }
  function normalizeTargetRoot(node) {
    if (!node || node.nodeType !== 1) return null;
    if (!node.closest) return node;
    const close = node.closest(
      '.el-dialog__headerbtn, .el-drawer__close-btn, .el-message-box__headerbtn, .el-notification__closeBtn, .el-dialog__close'
    );
    if (close) return close;
    const menu = node.closest(
      '.menu-item, .submenu-item, .el-menu-item, .el-submenu__title, .el-dropdown-menu__item, [role="menuitem"]'
    );
    if (menu) return menu;
    const navRoot = node.closest(
      'aside, .el-aside, nav, .el-menu, [class*="sidebar"], [class*="side-menu"], [class*="nav-menu"], [class*="menu-wrap"]'
    );
    if (navRoot) {
      const item = node.closest('li, a, button, [role="menuitem"]');
      if (item) {
        const cls = String(item.className || '');
        for (let i = 0; i < MENU_CLASS_TOKENS.length; i++) {
          if (hasClassToken(cls, MENU_CLASS_TOKENS[i])) return item;
        }
        if (item.getAttribute && item.getAttribute('role') === 'menuitem') return item;
        if ((item.tagName || '').toLowerCase() === 'li' || (item.tagName || '').toLowerCase() === 'a') return item;
      }
    }
    const tab = node.closest('.el-tabs__item, [role="tab"]');
    if (tab) return tab;
    const rowBtn = node.closest('.el-table__body .el-button, .el-table__body button, .el-table__body a');
    if (rowBtn) return rowBtn;
    const tableRadio = node.closest(
      '.el-table__body .el-radio, .el-table__body .el-radio-button, .el-table__row .el-radio, .el-table__fixed .el-radio'
    );
    if (tableRadio) return tableRadio;
    const tree = node.closest('.el-tree-node__content');
    if (tree) return tree;
    // Custom tsscTree / popover tree: host is the clickable trigger, not the search input inside popover
    const formItemForTree = node.closest('.el-form-item');
    if (formItemForTree && formItemForTree.querySelector('.tsscTree, .tree-popover, .el-tree-select, .el-cascader')) {
      const treeTrigger = formItemForTree.querySelector(
        '.el-tree-select, .el-cascader, span.my-popover, .my-popover'
      );
      if (treeTrigger) return treeTrigger;
      const displayInputs = formItemForTree.querySelectorAll('input.el-input__inner, input:not([type="hidden"])');
      for (let i = 0; i < displayInputs.length; i++) {
        if (!displayInputs[i].closest('.el-popover, .tree-popover')) return displayInputs[i];
      }
    }
    const formWidget = node.closest(
      '.el-select, .el-date-editor, .el-cascader, .el-tree-select, .el-radio-group, .el-checkbox-group, .tsscdatepicker'
    );
    if (formWidget) return formWidget;
    const formCtrl = node.closest('.el-input, .el-textarea');
    if (formCtrl) {
      const inner = formCtrl.querySelector('input:not([type="hidden"]), textarea, .el-input__inner, .el-textarea__inner');
      return inner || formCtrl;
    }
    const adj = node.closest('.el-form-item button, .el-form-item .el-button, .el-form-item a');
    if (adj) return adj;
    const btn = node.closest('button, a.el-button, a[role="button"], .el-button, a[href]');
    if (btn) return btn;
    const icon = node.closest('.el-tooltip[class*="el-icon"], [class*="el-icon"][aria-label], [aria-label]');
    if (icon) return icon;
    return node;
  }
  function detectTargetKind(node) {
    if (!node || !node.closest) return 'generic';
    if (node.closest('.el-notification__closeBtn')) return 'notification_close';
    if (node.closest('.el-dialog__headerbtn, .el-drawer__close-btn, .el-message-box__headerbtn, .el-dialog__close')) return 'dialog_close';
    if (node.closest('.el-tabs__item, [role="tab"]')) return 'tab';
    if (node.closest('.el-table__body .el-radio, .el-table__row .el-radio, .el-table__fixed .el-radio')) return 'table_row_radio';
    if (node.closest('.el-table__body .el-button, .el-table__body button, .el-table__body a')) return 'table_row_button';
    if (node.closest('.el-tree-node__content')) return 'tree_node';
    if (node.closest('.menu-item, .submenu-item, .el-menu-item, .el-submenu__title, .el-dropdown-menu__item, [role="menuitem"]')) {
      return node.closest('.el-submenu__title') ? 'submenu' : 'menu';
    }
    const navRoot = node.closest('aside, .el-aside, nav, .el-menu, [class*="sidebar"], [class*="side-menu"], [class*="nav-menu"], [class*="menu-wrap"]');
    if (navRoot && node.closest('li, a')) return 'menu';
    if (node.closest('.el-form-item') && node.closest('button, .el-button')) return 'adjacent_button';
    if (node.closest('.el-date-editor')) return 'form_date';
    if (node.closest('.el-select')) return 'form_select';
    if (node.closest('.el-radio-group')) return 'form_radio';
    if (node.closest('.el-tree-select, .el-cascader')) return 'form_tree_select';
    const fiTree = node.closest('.el-form-item');
    if (fiTree && fiTree.querySelector('.tsscTree, .tree-popover, .el-tree-select, .el-cascader')) {
      return 'form_tree_select';
    }
    if (node.closest('.el-form-item') && (node.matches('input, textarea') || node.closest('.el-input, .el-textarea'))) return 'form_input';
    if ((node.getAttribute && (node.getAttribute('aria-label') || node.getAttribute('title'))) && !(node.innerText || '').trim()) return 'icon';
    {
      const clsI = String(node.className || '');
      const tagI = (node.tagName || '').toLowerCase();
      if (extractElIconClass(clsI) && (hasClassToken(clsI, 'el-tooltip') || tagI === 'a' || tagI === 'i')) return 'icon';
    }
    const tagL = (node.tagName || '').toLowerCase();
    const cls = String(node.className || '');
    if (tagL === 'button' || hasClassToken(cls, 'el-button')) return 'button';
    if (tagL === 'a') return 'link';
    return 'generic';
  }
  function formFieldXpathSmartOf(node, formLabel) {
    const lbl = normalizeFormLabel(formLabel);
    const scope = scopeOf(node);
    const scopeKind = (scope === 'drawer' || scope === 'dialog') ? scope : '';
    if ((!lbl || !node) && node) {
      const ph = normalizeControlText((node.getAttribute && node.getAttribute('placeholder')) || '');
      if (ph) {
        const tagL0 = (node.tagName || '').toLowerCase();
        const leaf0 = tagL0 === 'textarea' ? 'textarea' : 'input';
        return scopedXPath(leaf0 + '[contains(@placeholder,' + xpathLiteral(ph) + ')]', scopeKind);
      }
    }
    if (!lbl || !node) return '';
    const lit = xpathLiteral(lbl);
    const itemPred = "div[contains(@class,'el-form-item')][.//label[contains(normalize-space(.)," + lit + ")]]";
    const tagL = (node.tagName || '').toLowerCase();
    const cls = String(node.className || '');
    let leaf = 'input';
    if (tagL === 'textarea' || /(^| )el-textarea( |$)/.test(cls)) leaf = 'textarea';
    else if (node.closest && node.closest('.el-select')) leaf = "div[contains(@class,'el-select')]";
    else if (node.closest && node.closest('.el-date-editor, .tsscdatepicker')) leaf = "div[contains(@class,'el-date-editor')]";
    else if (node.closest && node.closest('.el-radio-group')) leaf = "div[contains(@class,'el-radio-group')]";
    else if (node.closest && node.closest('.el-checkbox-group')) leaf = "div[contains(@class,'el-checkbox-group')]";
    else if (node.closest && node.closest('.el-cascader')) leaf = "div[contains(@class,'el-cascader')]";
    else if (node.closest && node.closest('.el-tree-select')) leaf = "div[contains(@class,'el-tree-select') or contains(@class,'tsscmultitree')]";
    else if (node.closest && node.closest('.el-form-item')
      && node.closest('.el-form-item').querySelector('.tsscTree, .tree-popover')) {
      leaf = "span[contains(@class,'my-popover')]";
    }
    else if (tagL === 'input' || /(^| )el-input__inner( |$)/.test(cls)) leaf = 'input';
    else if (tagL === 'button' || /(^| )el-button( |$)/.test(cls)) leaf = 'button';
    else leaf = tagL || 'input';
    return scopedXPath(itemPred + '//' + leaf, scopeKind);
  }
  function menuXpathSmartOf(node, text) {
    const t = normalizeControlText(text);
    if (!t || !node) return '';
    const cls = String(node.className || '');
    const tokens = [];
    for (let i = 0; i < MENU_CLASS_TOKENS.length; i++) {
      if (hasClassToken(cls, MENU_CLASS_TOKENS[i])) tokens.push(MENU_CLASS_TOKENS[i]);
    }
    const lit = xpathLiteral(t);
    let roleOrClass = "[@role='menuitem']";
    if (tokens.length) {
      const ors = tokens.map(function (tok) { return classTokenPred(tok); }).join(' or ');
      roleOrClass = '[' + ors + " or @role='menuitem']";
    }
    // Separate predicates — (self::a or self::b)[pred] is invalid XPath 1.0.
    const local = '*[self::li or self::a or self::div or self::span]' + roleOrClass + '[normalize-space()=' + lit + ']';
    const scope = scopeOf(node);
    return scopedXPath(local, scope === 'drawer' || scope === 'dialog' ? scope : '');
  }
  function evalXpathAll(xp) {
    let s = String(xp || '');
    if (!s) return [];
    try {
      const snap = document.evaluate(s, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
      const out = [];
      for (let i = 0; i < snap.snapshotLength; i++) out.push(snap.snapshotItem(i));
      return out;
    } catch (e) {
      return [];
    }
  }
  function pinOccurrence(expr, host) {
    if (!expr || !host) return { xpath: expr || '', occurrence: 0, verified: false };
    const nodes = evalXpathAll(expr);
    if (!nodes.length) return { xpath: '', occurrence: 0, verified: false };
    let idx = -1;
    for (let i = 0; i < nodes.length; i++) {
      if (nodes[i] === host) { idx = i; break; }
    }
    if (idx < 0) return { xpath: '', occurrence: 0, verified: false };
    if (nodes.length === 1) return { xpath: expr, occurrence: 0, verified: true };
    return { xpath: withOccurrence(expr, idx + 1), occurrence: idx + 1, verified: true };
  }
  function stableAttrXPath(node) {
    if (!node || !node.getAttribute) return '';
    const tagL = (node.tagName || '*').toLowerCase();
    const names = ['data-testid','data-test','data-qa','data-name','data-menu','data-id','id','name','aria-label','title'];
    const scope = scopeOf(node);
    const scopeKind = (scope === 'drawer' || scope === 'dialog') ? scope : '';
    for (let i = 0; i < names.length; i++) {
      const name = names[i];
      const v = String(node.getAttribute(name) || '').trim();
      if (!v || v.length > 80) continue;
      if ((name === 'id' || name === 'data-id') && isGeneratedId(v)) continue;
      if (name === 'title' && (v.length > 40 || /^https?:/i.test(v))) continue;
      return scopedXPath(tagL + '[@' + name + '=' + xpathLiteral(v) + ']', scopeKind);
    }
    return '';
  }
  function xpathSmartOf(node, text, formLabel, targetKindHint) {
    if (!node) return '';
    const kind = targetKindHint || detectTargetKind(node);
    const scope = scopeOf(node);
    const scopeKind = (scope === 'drawer' || scope === 'dialog') ? scope : '';
    if (kind === 'dialog_close' || kind === 'notification_close') {
      if (kind === 'notification_close') {
        return "//div[" + classTokenPred('el-notification') + "]//*[ " + classTokenPred('el-notification__closeBtn') + "]";
      }
      return scopedXPath(
        "*[" + classTokenPred('el-dialog__headerbtn') + " or " + classTokenPred('el-drawer__close-btn')
          + " or " + classTokenPred('el-message-box__headerbtn') + " or " + classTokenPred('el-dialog__close') + "]",
        scopeKind || 'overlay'
      );
    }
    if (formLabel && String(kind).indexOf('form_') === 0) {
      const formXp = formFieldXpathSmartOf(node, formLabel);
      if (formXp) return formXp;
    }
    if (formLabel && (kind === 'form_input' || kind === 'form_date' || kind === 'form_select' || kind === 'form_radio' || kind === 'form_tree_select')) {
      const formXp = formFieldXpathSmartOf(node, formLabel);
      if (formXp) return formXp;
    }
    // Tabs: prefer visible text over minted tab-<timestamp> ids
    if (kind === 'tab') {
      const t = normalizeControlText(text);
      if (!t) return '';
      return scopedXPath(
        "*[(" + classTokenPred('el-tabs__item') + " or @role='tab') and normalize-space()=" + xpathLiteral(t) + "]",
        scopeKind
      );
    }
    const attrXp = stableAttrXPath(node);
    if (attrXp && kind !== 'form_input' && kind !== 'form_date' && kind !== 'form_select' && kind !== 'tab') return attrXp;
    if (kind === 'menu' || kind === 'submenu') return menuXpathSmartOf(node, text);
    if (kind === 'table_row_button') {
      const rowEl = node.closest && node.closest('tr, .el-table__row');
      let rowT = '';
      if (rowEl) {
        const cells = rowEl.querySelectorAll('td, .el-table__cell');
        for (let i = 0; i < cells.length; i++) {
          const cell = cells[i];
          const ct = normalizeControlText(cell.innerText || cell.textContent || '');
          const hasSelect = !!cell.querySelector('.el-checkbox, .el-radio, input[type="checkbox"], input[type="radio"]');
          if (hasSelect && !ct) continue;
          if (ct && ct.length >= 2 && ct.length <= 48) { rowT = ct; break; }
        }
      }
      const btnT = normalizeControlText(text) || cleanVisibleText(node);
      if (rowT && btnT) {
        return scopedXPath(
          "tr[.//*[normalize-space()=" + xpathLiteral(rowT) + "]]"
            + "//*[self::button or self::a or " + classTokenPred('el-button') + "][normalize-space()=" + xpathLiteral(btnT) + "]",
          scopeKind
        );
      }
      if (btnT) {
        return scopedXPath(
          "*[self::button or self::a or " + classTokenPred('el-button') + "][normalize-space()=" + xpathLiteral(btnT) + "]",
          scopeKind
        );
      }
    }
    if (kind === 'table_row_radio') {
      const rowEl = node.closest && node.closest('tr, .el-table__row');
      let rowT = '';
      if (rowEl) {
        const cells = rowEl.querySelectorAll('td, .el-table__cell');
        for (let i = 0; i < cells.length; i++) {
          const cell = cells[i];
          const ct = normalizeControlText(cell.innerText || cell.textContent || '');
          const hasSelect = !!cell.querySelector('.el-checkbox, .el-radio, input[type="checkbox"], input[type="radio"]');
          if (hasSelect && !ct) continue;
          if (ct && ct.length >= 2 && ct.length <= 48) { rowT = ct; break; }
        }
      }
      if (rowT) {
        return scopedXPath(
          "tr[.//*[normalize-space()=" + xpathLiteral(rowT) + "]]"
            + "//*[" + classTokenPred('el-radio') + " or " + classTokenPred('el-radio-button') + " or " + classTokenPred('el-checkbox') + "]",
          scopeKind
        );
      }
    }
    if (kind === 'icon') {
      const iconTok = extractElIconClass(String(node.className || ''));
      if (iconTok) {
        return scopedXPath("a[contains(@class," + xpathLiteral(iconTok) + ")]", scopeKind);
      }
      const t = normalizeControlText(text);
      if (!t) return '';
      return scopedXPath("*[@aria-label=" + xpathLiteral(t) + " or @title=" + xpathLiteral(t) + "]", scopeKind);
    }
    if (kind === 'tree_node') {
      const base = stripVolatileTreeText(text) || stripVolatileTreeText(cleanVisibleText(node));
      if (!base) return '';
      let local = "*[" + classTokenPred('el-tree-node__content') + " and starts-with(normalize-space()," + xpathLiteral(base) + ")]";
      // Parent tree-node for duplicate base names
      try {
        const treeNode = node.closest && node.closest('.el-tree-node');
        const parentNode = treeNode && treeNode.parentElement && treeNode.parentElement.closest
          ? treeNode.parentElement.closest('.el-tree-node')
          : null;
        if (parentNode) {
          const pContent = parentNode.querySelector(':scope > .el-tree-node__content');
          const pb = stripVolatileTreeText(pContent ? (pContent.innerText || pContent.textContent) : '');
          if (pb) {
            local = "*[" + classTokenPred('el-tree-node__content') + " and starts-with(normalize-space()," + xpathLiteral(pb) + ")]"
              + "/following-sibling::*[contains(@class,'el-tree-node__children')]"
              + "//" + local;
          }
        }
      } catch (e) { /* ignore */ }
      return scopedXPath(local, scopeKind);
    }
    if (!formLabel) {
      const ph = normalizeControlText((node.getAttribute && node.getAttribute('placeholder')) || '');
      if (ph && (kind === 'form_input' || kind === 'generic' || !kind)) {
        const tagLph = (node.tagName || '').toLowerCase();
        const leafPh = tagLph === 'textarea' ? 'textarea' : 'input';
        return scopedXPath(leafPh + '[contains(@placeholder,' + xpathLiteral(ph) + ')]', scopeKind);
      }
    }
    if (formLabel) {
      const formXp = formFieldXpathSmartOf(node, formLabel);
      if (formXp) return formXp;
    }
    const t = normalizeControlText(text);
    if (!t) return '';
    const tagL = (node.tagName || '').toLowerCase();
    const cls = String(node.className || '');
    const clickable = tagL === 'button' || tagL === 'a' || /(^| )el-button( |$)/.test(cls) || kind === 'button' || kind === 'link' || kind === 'adjacent_button';
    if (!clickable) {
      if (kind === 'menu' || kind === 'submenu') return menuXpathSmartOf(node, t);
      return '';
    }
    const lit = xpathLiteral(t);
    const local = tagL === 'a'
      ? 'a[normalize-space()=' + lit + ']'
      : (/(^| )el-button( |$)/.test(cls) && tagL !== 'button'
        ? '*[' + classTokenPred('el-button') + ' and normalize-space()=' + lit + ']'
        : 'button[normalize-space()=' + lit + ']');
    return scopedXPath(local, scopeKind);
  }
  function collectAttrs(el) {
    const a = {};
    if (!el || !el.attributes) return a;
    for (let i = 0; i < el.attributes.length; i++) {
      const at = el.attributes[i];
      if (!at || !at.name || !at.value) continue;
      if (/^(value|password|pwd|token|authorization|cookie)$/i.test(at.name)) continue;
      if (at.value.length > 120) continue;
      a[at.name] = at.value;
    }
    return a;
  }
  function buildLocatorSnap(node, text, xpathFull, formLabel, opts) {
    opts = opts || {};
    const host = normalizeTargetRoot(node) || node;
    const kind = opts.targetKind || detectTargetKind(host);
    const t = normalizeControlText(text) || cleanVisibleText(host);
    const abs = String(xpathFull || absXPath(host) || '');
    const formLbl = normalizeFormLabel(formLabel || '');
    let smart = xpathSmartOf(host, t, formLbl, kind);
    let occurrence = 0;
    let verified = false;
    if (smart) {
      const pinned = pinOccurrence(smart, host);
      smart = pinned.xpath;
      occurrence = pinned.occurrence;
      verified = pinned.verified;
    }
    const css = cssOfSimple(host);
    const primary = (smart && verified) ? smart : (abs || smart);
    const strategy = (smart && verified) ? 'xpath_smart' : 'xpath_full';
    const candidates = [];
    if (smart) candidates.push({ type: 'xpath_smart', value: smart });
    if (abs) candidates.push({ type: 'xpath_full', value: abs });
    if (css) candidates.push({ type: 'css', value: css });
    let parentText = '';
    if (kind === 'tree_node') {
      try {
        const treeNode = host.closest && host.closest('.el-tree-node');
        const parentNode = treeNode && treeNode.parentElement && treeNode.parentElement.closest
          ? treeNode.parentElement.closest('.el-tree-node')
          : null;
        if (parentNode) {
          const pContent = parentNode.querySelector(':scope > .el-tree-node__content');
          parentText = stripVolatileTreeText(pContent ? (pContent.innerText || pContent.textContent) : '');
        }
      } catch (e) { parentText = ''; }
    }
    const iconClass = kind === 'icon' ? extractElIconClass(String(host.className || '')) : '';
    const placeholder = (host.getAttribute && host.getAttribute('placeholder')) || '';
    return {
      xpath: primary,
      xpath_smart: (smart && verified) ? smart : (smart || ''),
      xpath_full: abs,
      xpath_abs: abs,
      cssSelector: css,
      text: t,
      formLabel: formLbl,
      tag: (host.tagName || '').toLowerCase(),
      attributes: collectAttrs(host),
      candidates: candidates,
      target_kind: kind,
      parent_text: parentText || undefined,
      icon_class: iconClass || undefined,
      placeholder: placeholder || undefined,
      locator_scope: scopeOf(host),
      locator_occurrence: occurrence || undefined,
      locator_verified: verified,
      locator_strategy: strategy,
      locator_fallback_reason: strategy === 'xpath_full'
        ? (smart ? 'smart_missed_host' : (t || formLbl ? 'no_smart_predicate' : 'empty_anchor_text'))
        : undefined,
    };
  }
`;
