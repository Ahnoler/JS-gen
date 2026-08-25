# Auto-generated / keep in sync with src/cdp/locator-candidates.js PAGE_LOCATOR_HELPERS.
# Regenerate: node scripts/_gen_locator_helpers_py.mjs
# Used by scripts/controller/actions/_js_snippets.py and scripts/manual_recorder/js.py.

PAGE_LOCATOR_HELPERS = r'''
  function xpathLiteral(text) {
    const t = String(text || '');
    if (t.indexOf("'") < 0) return "'" + t + "'";
    if (t.indexOf('"') < 0) return '"' + t + '"';
    const parts = t.split("'").map(function (p) { return "'" + p + "'"; });
    return 'concat(' + parts.join(", \"'\", ") + ')';
  }
  function normalizeControlText(text) {
    return String(text || '').replace(/\s+/g, ' ').trim().slice(0, 40);
  }
  function normalizeFormLabel(text) {
    return String(text || '').replace(/\s+/g, ' ').trim().replace(/[：:*\s]+$/g, '').slice(0, 40);
  }
  function stripVolatileTreeText(text) {
    return String(text || '').replace(/\s+/g, ' ').trim()
      .replace(/\[\s*V[-\d.]+\s*\]$/i, '')
      .replace(/\(\d+\)\s*$/, '')
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
    const tokens = String(className || '').trim().split(/\s+/).filter(Boolean);
    return tokens.indexOf(String(token || '').trim()) >= 0;
  }
  function isGeneratedId(id) {
    const s = String(id || '').trim();
    if (!s) return true;
    if (/^el-id-/i.test(s)) return true;
    if (/^\d{4,}$/.test(s)) return true;
    if (/^tab-\d{6,}$/i.test(s)) return true;
    if (/^[a-z]+-\d{10,}$/i.test(s)) return true;
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)) return true;
    if (/^ember\d+/i.test(s)) return true;
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
      .split(/\s+/)
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
    const loc = String(local || '').replace(/^\/+/, '');
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
  /**
   * Popover / dropdown tree belonging to a form tree-select (TsscMultiTree etc.).
   * Sidebar page trees must stay tree_node — only upgrade when in tree-popover or
   * Vue ancestry reaches TsscMultiTree with a form-item host.
   */
  function resolveFormTreeSelectHostFromPopoverTree(node) {
    if (!node || !node.closest) return null;
    const content = node.closest('.el-tree-node__content');
    if (!content) return null;
    const inTreePop = content.closest('.tree-popover');
    const inPop = inTreePop || content.closest(
      '.el-popover, .el-popper, .el-select-dropdown, .el-cascader__dropdown, .el-tree-select__popper'
    );
    if (!inPop) return null;
    const pickHost = (fi, fallbackEl) => {
      if (!fi) return fallbackEl || null;
      return fi.querySelector(
        '.el-tree-select, .el-cascader, span.my-popover, .my-popover, [class*="tsscmultitree"]'
      ) || fallbackEl || fi;
    };
    const isTssc = (v) => !!(v && v.$options && v.$options.name
      && String(v.$options.name).includes('TsscMultiTree'));
    let start = null;
    const treeEl = content.closest('.el-tree');
    if (treeEl && treeEl.__vue__) start = treeEl.__vue__;
    else if (content.__vue__) start = content.__vue__;
    let v = start;
    while (v) {
      if (isTssc(v) && v.$el) {
        const fi = v.$el.closest && v.$el.closest('.el-form-item');
        return pickHost(fi, v.$el);
      }
      v = v.$parent;
    }
    if (inTreePop) {
      const items = document.querySelectorAll('.el-form-item');
      const hits = [];
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.querySelector(
          '.tsscTree, .tree-popover, .el-tree-select, .el-cascader, [class*="tsscmultitree"], span.my-popover'
        )) hits.push(item);
      }
      if (hits.length === 1) return pickHost(hits[0], null);
    }
    return null;
  }
  function normalizeTargetRoot(node) {
    return normalizeHost(node);
  }
  function normalizeHost(node) {
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
    if (tree) {
      const formHost = resolveFormTreeSelectHostFromPopoverTree(tree);
      if (formHost) return formHost;
      return tree;
    }
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
    // Todo card actions before form widgets — portal 待办 wraps cards in el-checkbox-group;
    // climbing to the group yields //div[@aria-label='checkbox-group'] and false ok-xpath-smart.
    const todoAction = node.closest('.todo-item-action');
    if (todoAction) return todoAction;
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
    if (node.closest('.el-tree-node__content')) {
      if (resolveFormTreeSelectHostFromPopoverTree(node)) return 'form_tree_select';
      return 'tree_node';
    }
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
    if (node.closest('[class*="tsscmultitree"], [class*="TsscMultiTree"]')) return 'form_tree_select';
    const fiTree = node.closest('.el-form-item');
    if (fiTree && fiTree.querySelector(
      '.tsscTree, .tree-popover, .el-tree-select, .el-cascader, [class*="tsscmultitree"], span.my-popover, .my-popover'
    )) {
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
    if (hasClassToken(cls, 'todo-item-action') || node.closest('.todo-item-action')) return 'button';
    if (tagL === 'button' || hasClassToken(cls, 'el-button')) return 'button';
    if (tagL === 'a') return 'link';
    return 'generic';
  }
  function formFieldXpathSmartOf(node, formLabel) {
    const lbl0 = normalizeFormLabel(formLabel);
    // Corrupt formLabel that is actually an XPath fragment must be ignored.
    const lbl = (lbl0 && !/^\/[^\s]*\[/.test(lbl0)) ? lbl0 : '';
    const scope = scopeOf(node);
    const scopeKind = (scope === 'drawer' || scope === 'dialog') ? scope : '';
    // A form item without a real <label> element cannot use a label-based
    // xpath, regardless of the formLabel hint (login/placeholder-only forms).
    const realLabel = (() => {
      if (!node || !node.closest) return '';
      const item = node.closest('.el-form-item');
      const l = item && item.querySelector('.el-form-item__label, label');
      return l ? normalizeControlText(l.textContent) : '';
    })();
    if ((!lbl || !realLabel || !node) && node) {
      const tagL0 = (node.tagName || '').toLowerCase();
      const ph = normalizeControlText((node.getAttribute && node.getAttribute('placeholder')) || '');
      if (ph) {
        const leaf0 = tagL0 === 'textarea' ? 'textarea' : 'input';
        return scopedXPath(leaf0 + '[contains(@placeholder,' + xpathLiteral(ph) + ')]', scopeKind);
      }
      const name = (node.getAttribute && node.getAttribute('name')) || '';
      if (name) {
        const leaf0 = tagL0 === 'textarea' ? 'textarea' : 'input';
        return scopedXPath(leaf0 + '[@name=' + xpathLiteral(name) + ']', scopeKind);
      }
    }
    if (!lbl || !node) return '';
    const lit = xpathLiteral(lbl);
    // Exact label (+ Element UI * / colon suffixes). contains() wrongly hits
    // prefix siblings (财务部联系人 → 财务部联系人手机号码).
    const itemPred = "div[contains(@class,'el-form-item')][.//label["
      + "normalize-space(.)=" + lit
      + " or normalize-space(.)=concat(" + lit + ", ':')"
      + " or normalize-space(.)=concat(" + lit + ", '：')"
      + " or normalize-space(.)=concat(" + lit + ", '*')"
      + " or normalize-space(.)=concat('*', " + lit + ")"
      + " or normalize-space(.)=concat('*', " + lit + ", ':')"
      + " or normalize-space(.)=concat('*', " + lit + ", '：')"
      + "]]";
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
  /* regionAnchor* — xpath 消歧：为同名 leaf 加 titled host 前缀，导出唯一相对 xpath。
   * 不是产品「分块/section=」；产品区域请用 region_* / L1。 */
  function regionAnchorOf(host) {
    if (!host || !host.closest) return null;
    const collapse = host.closest('.el-collapse-item');
    if (collapse) {
      const header = collapse.querySelector('.el-collapse-item__header');
      const title = normalizeControlText((header && (header.innerText || header.textContent)) || '');
      if (!title) return null;
      return {
        kind: 'collapse',
        title: title,
        prefix: "//div[" + classTokenPred('el-collapse-item') + "][.//*[ " + classTokenPred('el-collapse-item__header') + " and contains(normalize-space(.)," + xpathLiteral(title) + ")]]",
      };
    }
    const pane = host.closest('.el-tab-pane');
    if (pane) {
      const tabs = pane.closest && pane.closest('.el-tabs');
      let tabLabel = '';
      if (tabs) {
        const paneId = pane.getAttribute('id') || '';
        if (paneId) {
          const tabItem = tabs.querySelector('.el-tabs__item[aria-controls="' + paneId + '"]');
          if (tabItem) tabLabel = normalizeControlText(tabItem.innerText || tabItem.textContent || '');
        }
      }
      if (!tabLabel) return null;
      // Best-effort: tab/card anchors are secondary to collapse (P0 dual-save fixture).
      return {
        kind: 'tab',
        title: tabLabel,
        prefix: "//*[ " + classTokenPred('el-tabs') + "][.//*[ " + classTokenPred('el-tabs__item')
          + " and normalize-space()=" + xpathLiteral(tabLabel) + "]]//*[ "
          + classTokenPred('el-tab-pane') + "]",
      };
    }
    const card = host.closest('.el-card');
    if (card) {
      const h = card.querySelector('.el-card__header');
      const title = normalizeControlText((h && (h.innerText || h.textContent)) || '');
      if (!title) return null;
      return {
        kind: 'card',
        title: title,
        prefix: "//div[" + classTokenPred('el-card') + "][.//*[ " + classTokenPred('el-card__header') + " and contains(normalize-space(.)," + xpathLiteral(title) + ")]]",
      };
    }
    const todo = host.closest('.todo-item');
    if (todo) {
      const blob = String(todo.innerText || todo.textContent || '');
      const keyM = blob.match(/\b(?:PJ|DGSX)\d+\b/);
      let title = keyM ? keyM[0] : '';
      if (!title) {
        const header = todo.querySelector('.todo-item__header');
        let ht = header ? normalizeControlText(header.innerText || header.textContent || '') : '';
        const actions = header && header.querySelector('.todo-item-actions');
        if (actions) {
          const at = normalizeControlText(actions.innerText || actions.textContent || '');
          if (at) ht = normalizeControlText(ht.replace(at, ''));
        }
        title = ht || normalizeControlText(blob.split(/[\n\r]+/).map(function (s) { return s.trim(); }).filter(Boolean)[0] || '');
      }
      if (!title) return null;
      return {
        kind: 'todo',
        title: title,
        prefix: "//div[" + classTokenPred('todo-item') + "][contains(normalize-space(.)," + xpathLiteral(title) + ")]",
      };
    }
    return null;
  }
    /* SHARED_ASSIGN_REGION — keep in sync with scan_form.py assignRegion */
    function regionLabelOf(role, title) {
      const t = String(title || '').replace(/\s+/g, ' ').trim().slice(0, 40);
      if (role === 'overlay') return t || '弹层';
      if (role === 'table') return t || '表格';
      if (role === 'section') return t || '区块';
      if (role === 'tab') return t || '页签';
      if (role === 'wizard') return t || '向导';
      if (role === 'todo') return t || '待办';
      if (role === 'shell-aside') return '侧栏';
      if (role === 'shell-header') return '顶栏';
      if (role === 'main') return '主区';
      if (role === 'page') return '页面';
      return t || '其他';
    }
    function layerLabel(s) {
      return String(s || '').replace(/\s+/g, ' ').trim().slice(0, 40);
    }
    function buildRegionLayers(region) {
      if (!region) return [];
      const role = String(region.region_role || '');
      const label = layerLabel(region.region_label);
      if (role === 'overlay') {
        return label ? [{ role: 'overlay', label: label }] : [];
      }
      if (role === 'table') {
        return [{ role: 'table', label: label || '表格' }];
      }
      if (role === 'todo') {
        return label ? [{ role: 'todo', label: label }] : [];
      }
      const out = [];
      const card = layerLabel(region.region_card);
      if (card) out.push({ role: 'card', label: card });
      const chrome = region.region_chrome;
      if (chrome && chrome.label && (chrome.role === 'tab' || chrome.role === 'wizard')) {
        const cl = layerLabel(chrome.label);
        if (cl) out.push({ role: chrome.role, label: cl });
      }
      const section = layerLabel(region.region_section);
      if (section) out.push({ role: 'section', label: section });
      const block = layerLabel(region.region_block);
      if (block) out.push({ role: 'titlebox', label: block });
      return out;
    }
    function prependPageLayer(layers, pageLabel) {
      const src = Array.isArray(layers) ? layers.slice() : [];
      let existingPage = '';
      if (src[0] && src[0].role === 'page') existingPage = layerLabel(src[0].label);
      const cleaned = [];
      for (let i = 0; i < src.length; i++) {
        if (src[i] && src[i].role === 'page') continue;
        cleaned.push(src[i]);
      }
      const incoming = layerLabel(pageLabel);
      const page = existingPage || incoming;
      if (page) cleaned.unshift({ role: 'page', label: page });
      return cleaned;
    }
    function withLayers(region) {
      if (!region) return region;
      region.layers = buildRegionLayers(region);
      return region;
    }
    function assignRegion(el) {
      if (!el || !el.closest) {
        return withLayers({ region_role: 'other', region_id: 'other', region_label: regionLabelOf('other') });
      }
      if (el.closest('.el-dialog, .el-drawer, .el-message-box')) {
        const o = el.closest('.el-dialog, .el-drawer, .el-message-box');
        const title = (o.querySelector('.el-dialog__title, .el-drawer__title')
          && (o.querySelector('.el-dialog__title, .el-drawer__title').textContent || ''))
          || o.getAttribute('aria-label') || '';
        const id = 'overlay:' + String(title || 'overlay').replace(/\s+/g, ' ').trim().slice(0, 40);
        return withLayers({ region_role: 'overlay', region_id: id, region_label: regionLabelOf('overlay', title) });
      }
      if (el.closest('.el-table, .tssc-multiple-table-content, .myTable')) {
        return withLayers({ region_role: 'table', region_id: 'table', region_label: regionLabelOf('table') });
      }
      if (el.closest('.todo-item')) {
        const todo = el.closest('.todo-item');
        const blob = String(todo.innerText || todo.textContent || '');
        // Prefer 业务主键：XXX (covers DGSX/PJ/YXPC/VALT/…); fall back to PJ|DGSX regex.
        const bizM = blob.match(/业务主键[：:]\s*([A-Za-z0-9]+)/);
        const keyM = blob.match(/\b(?:PJ|DGSX)\d+\b/);
        const bizKey = (bizM && bizM[1]) || (keyM ? keyM[0] : '');
        const header = todo.querySelector('.todo-item__header');
        let ht = header ? String(header.innerText || '').replace(/\s+/g, ' ').trim() : '';
        const actions = header && header.querySelector('.todo-item-actions');
        if (actions) {
          const at = String(actions.innerText || '').replace(/\s+/g, ' ').trim();
          if (at) ht = ht.replace(at, '').replace(/\s+/g, ' ').trim();
        }
        // Human-facing label: Chinese header title first; never prefer bare biz key.
        let human = ht;
        if (bizKey && human) {
          human = human.split(bizKey).join('').replace(/\s+/g, ' ').trim();
        }
        human = human.replace(/^[\s\-_|/·.]+|[\s\-_|/·.]+$/g, '').trim();
        const firstLine = blob.split(/[\n\r]+/).map(function (s) { return s.trim(); }).filter(Boolean)[0] || '';
        const label = (human || ht || bizKey || firstLine || 'todo').slice(0, 40);
        // Stable id prefers biz key so same Chinese title across cards still collide-refine cleanly.
        const idKey = bizKey || label || 'todo';
        return withLayers({
          region_role: 'todo',
          region_id: 'section:' + idKey,
          region_label: regionLabelOf('todo', label),
        });
      }
      if (el.closest('.el-aside, .sidebar, aside, .el-menu')) {
        return withLayers({ region_role: 'shell-aside', region_id: 'shell-aside', region_label: regionLabelOf('shell-aside') });
      }
      if (el.closest('.el-header, .navbar, header, .tags-view-container')) {
        return withLayers({ region_role: 'shell-header', region_id: 'shell-header', region_label: regionLabelOf('shell-header') });
      }
      const composed = composeContentRegion(el);
      if (composed && composed.region_id) return withLayers(composed);
      if (el.closest('.el-main, .app-main, .plugin-content, main')) {
        return withLayers({ region_role: 'main', region_id: 'main', region_label: regionLabelOf('main') });
      }
      return withLayers({ region_role: 'other', region_id: 'other', region_label: regionLabelOf('other') });
    }
    function pickScrollRoot() {
      const cands = document.querySelectorAll('.el-main, .app-main');
      for (let k = 0; k < cands.length; k++) {
        const el = cands[k];
        const s = getComputedStyle(el);
        const oy = s.overflowY || s.overflow;
        if ((oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight + 8) return el;
      }
      let best = null;
      const all = document.querySelectorAll('div, main, section, article');
      for (let k = 0; k < all.length; k++) {
        const el = all[k];
        if (el.clientHeight < 100) continue;
        const s = getComputedStyle(el);
        const oy = s.overflowY || s.overflow;
        if (oy !== 'auto' && oy !== 'scroll') continue;
        if (el.scrollHeight <= el.clientHeight + 8) continue;
        if (!best || el.scrollHeight > best.scrollHeight) best = el;
      }
      if (best) return best;
      return document.scrollingElement || document.documentElement;
    }
    function stepBBoxOf(el) {
      if (!el || !el.getBoundingClientRect) return null;
      const root = pickScrollRoot();
      const isDoc = root === document.scrollingElement || root === document.documentElement;
      const box = isDoc ? { x: 0, y: 0 } : root.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      return {
        x1: Math.round(r.left - box.x),
        y1: Math.round(r.top + root.scrollTop - box.y),
        x2: Math.round(r.right - box.x),
        y2: Math.round(r.bottom + root.scrollTop - box.y),
      };
    }
    function documentBBoxOf(el) {
      if (!el || !el.getBoundingClientRect) return null;
      const doc = document.scrollingElement || document.documentElement;
      const sx = doc ? (doc.scrollLeft || 0) : 0;
      const sy = doc ? (doc.scrollTop || 0) : 0;
      const r = el.getBoundingClientRect();
      return {
        x1: Math.round(r.left + sx),
        y1: Math.round(r.top + sy),
        x2: Math.round(r.right + sx),
        y2: Math.round(r.bottom + sy),
      };
    }
    function buildFeatureCard(el, regionHint) {
      var region = regionHint || assignRegion(el);
      var cls = String((el && el.getAttribute && el.getAttribute('class')) || '').trim();
      var classTokens = cls.split(/s+/).filter(Boolean).slice(0, 12);
      var title = '';
      if (el && el.getAttribute) {
        var rawTitle = el.getAttribute('aria-label') || el.getAttribute('title') || '';
        title = String(rawTitle || '').replace(/s+/g, ' ').trim().slice(0, 80);
      }
      if (!title && el && el.closest) {
        var card = el.closest('.el-card');
        if (card) {
          var h = card.querySelector('.el-card__header');
          title = String((h && (h.innerText || h.textContent)) || '').replace(/s+/g, ' ').trim().slice(0, 80);
        }
        // Prefer nearer titlebox over outer collapse — coarse assignRegion stays
        // collapse-first; feature_card / L1c should reflect finer panel when present.
        if (!title) {
          var tb = el.closest('.titlebox');
          if (tb) title = titleboxTitleText(tb).slice(0, 80);
        }
        if (!title) {
          var collapse = el.closest('.el-collapse-item');
          if (collapse) {
            var ch = collapse.querySelector('.el-collapse-item__header');
            title = String((ch && (ch.innerText || ch.textContent)) || '').replace(/s+/g, ' ').trim().slice(0, 80);
          }
        }
        if (!title && region && region.region_label) {
          var rl = String(region.region_label || '').replace(/s+/g, ' ').trim();
          // Skip taxonomy tokens (section/main/…) — keep readable card keys only.
          if (rl && rl !== '区块' && rl !== '主区' && rl !== '其他' && rl !== '弹层' && rl !== '表格'
            && rl !== '侧栏' && rl !== '顶栏' && rl !== '页面') {
            title = rl.slice(0, 80);
          }
        }
      }
      var band = 'center';
      if (el && el.getBoundingClientRect) {
        var rect = el.getBoundingClientRect();
        var cy = rect.top + rect.height / 2;
        var vh = window.innerHeight || 800;
        band = cy < vh * 0.25 ? 'top'
          : (cy > vh * 0.75 ? 'bottom' : (rect.left < 120 ? 'side' : 'center'));
      }
      var childCounts = { button: 0, input: 0, menu: 0 };
      if (el && el.querySelectorAll) {
        childCounts.button = Math.min(el.querySelectorAll('button, .el-button').length, 50);
        childCounts.input = Math.min(el.querySelectorAll(
          'input:not([type="hidden"]), textarea, .el-input__inner'
        ).length, 50);
        childCounts.menu = Math.min(el.querySelectorAll(
          '.el-menu-item, .el-submenu__title, [role="menuitem"]'
        ).length, 50);
      }
      var role = region && region.region_role ? region.region_role : 'other';
      var conf = role === 'other' ? 0.4 : 0.9;
      return {
        tag: (el && el.tagName ? el.tagName : '').toLowerCase(),
        classTokens: classTokens,
        title: title,
        band: band,
        childCounts: childCounts,
        flags: {
          overlay: role === 'overlay',
          tableLike: role === 'table',
          menuLike: role === 'shell-aside' || role === 'menu',
          titledPanel: !!title,
        },
        ruleRole: role,
        ruleConfidence: conf,
      };
    }
    /* SHARED_COLLISION_REFINE — titlebox finer L1 on region_id collision */
    function isActionOnlyTitle(t) {
      const s = String(t || '').replace(/\s+/g, ' ').trim();
      if (!s) return true;
      return /^(新增|修改|查看|删除|保存|\+\s*新增)$/.test(s);
    }
    function titleboxTitleText(box) {
      if (!box) return '';
      const span = box.querySelector && box.querySelector('span.title');
      let raw = '';
      if (span) raw = span.innerText || span.textContent || '';
      else raw = box.innerText || box.textContent || '';
      return String(raw).replace(/\s+/g, ' ').trim().slice(0, 40);
    }
    function pickNearestTitlebox(boxes, host) {
      if (!boxes || !boxes.length || !host || !host.getBoundingClientRect) return boxes && boxes[0];
      const hr = host.getBoundingClientRect();
      const hostCx = hr.left + hr.width / 2;
      const hostCy = hr.top + hr.height / 2;
      let bestAbove = null;
      let bestAboveGap = Infinity;
      let bestDist = null;
      let bestDistSq = Infinity;
      for (let i = 0; i < boxes.length; i++) {
        const box = boxes[i];
        const br = box.getBoundingClientRect && box.getBoundingClientRect();
        if (!br || br.width <= 0 || br.height <= 0) continue;
        const boxBottom = br.bottom;
        const boxCx = br.left + br.width / 2;
        const boxCy = br.top + br.height / 2;
        if (boxBottom <= hr.top) {
          const gap = hr.top - boxBottom;
          if (gap < bestAboveGap) {
            bestAboveGap = gap;
            bestAbove = box;
          }
        }
        const dx = boxCx - hostCx;
        const dy = boxCy - hostCy;
        const distSq = dx * dx + dy * dy;
        if (distSq < bestDistSq) {
          bestDistSq = distSq;
          bestDist = box;
        }
      }
      return bestAbove || bestDist || boxes[0];
    }
    function isShellChromeNode(node) {
      if (!node || !node.closest) return false;
      return !!node.closest('.tags-view-container, header, .el-header, .navbar');
    }
    function nearestContentTabs(el) {
      let n = el;
      while (n && n.closest) {
        const tabs = n.closest('.el-tabs');
        if (!tabs) break;
        if (!isShellChromeNode(tabs)) return tabs;
        n = tabs.parentElement;
      }
      return null;
    }
    function activeTabLabel(tabs) {
      if (!tabs || !tabs.querySelector) return '';
      const item = tabs.querySelector('.el-tabs__item.is-active');
      return String((item && (item.innerText || item.textContent)) || '')
        .replace(/\s+/g, ' ').trim().slice(0, 40);
    }
    function nearestPageSteps(el) {
      if (!el) return null;
      if (el.closest) {
        const inside = el.closest('.el-steps');
        if (inside && !isShellChromeNode(inside)) return inside;
      }
      let n = el.parentElement;
      while (n && n !== document.body && n !== document.documentElement) {
        if (n.matches && n.matches('.el-steps') && !isShellChromeNode(n)) return n;
        if (n.querySelector) {
          const direct = n.querySelectorAll(':scope > .el-steps');
          for (let i = 0; i < direct.length; i++) {
            if (!isShellChromeNode(direct[i])) return direct[i];
          }
          const nested = n.querySelectorAll(
            ':scope > * > .el-steps, :scope > * > * > .el-steps, :scope > * > * > * > .el-steps'
          );
          for (let i = 0; i < nested.length; i++) {
            if (isShellChromeNode(nested[i])) continue;
            const wrap = nested[i].parentElement;
            if (!/step/i.test(String((wrap && wrap.className) || ''))) continue;
            return nested[i];
          }
        }
        n = n.parentElement;
      }
      return null;
    }
    function stepTitle(step) {
      if (!step) return '';
      const t = step.querySelector && (
        step.querySelector('.el-step__title') || step.querySelector('.el-step__head')
      );
      return String((t && (t.innerText || t.textContent)) || step.innerText || '')
        .replace(/\s+/g, ' ').trim().slice(0, 40);
    }
    function stepStatusClass(step) {
      const bits = [String((step && step.className) || '')];
      if (step && step.querySelector) {
        const head = step.querySelector('.el-step__head');
        const title = step.querySelector('.el-step__title');
        if (head) bits.push(String(head.className || ''));
        if (title) bits.push(String(title.className || ''));
      }
      return bits.join(' ');
    }
    function currentStepLabel(steps) {
      if (!steps || !steps.querySelectorAll) return '';
      const items = Array.from(steps.querySelectorAll('.el-step'));
      if (!items.length) return '';
      for (let i = 0; i < items.length; i++) {
        const cls = stepStatusClass(items[i]);
        if (/\bis-process\b|\bprocess\b/.test(cls)
          && !/\bis-wait\b/.test(cls)
          && !/\bis-finish\b/.test(cls)) {
          const t = stepTitle(items[i]);
          if (t) return t;
        }
      }
      let lastFinish = -1;
      for (let i = 0; i < items.length; i++) {
        if (/\bis-finish\b|\bis-success\b/.test(stepStatusClass(items[i]))) {
          lastFinish = i;
        }
      }
      if (lastFinish >= 0 && lastFinish + 1 < items.length) {
        const t = stepTitle(items[lastFinish + 1]);
        if (t) return t;
      }
      for (let i = 0; i < items.length; i++) {
        const t = stepTitle(items[i]);
        if (t) return t;
      }
      return '';
    }
    function readChrome(el) {
      const tabs = nearestContentTabs(el);
      if (tabs) {
        const label = activeTabLabel(tabs);
        if (label) return { role: 'tab', label: label };
      }
      const steps = nearestPageSteps(el);
      if (steps) {
        const label = currentStepLabel(steps);
        if (label) return { role: 'wizard', label: label };
      }
      return null;
    }
    function stripActionTail(title) {
      let s = String(title || '').replace(/\s+/g, ' ').trim();
      s = s.replace(/\s+(新增|修改|查看|删除|保存|\+\s*新增)$/g, '').trim();
      return s.slice(0, 40);
    }
    function collapseSectionTitle(el) {
      if (!el || !el.closest) return '';
      const it = el.closest('.el-collapse-item');
      if (!it) return '';
      const h = it.querySelector && it.querySelector('.el-collapse-item__header');
      return stripActionTail((h && (h.innerText || h.textContent)) || '');
    }
    function cardTitleOf(el) {
      if (!el || !el.closest) return '';
      const card = el.closest('.el-card');
      if (!card) return '';
      const h = card.querySelector && card.querySelector('.el-card__header');
      return normalizeControlText((h && (h.innerText || h.textContent)) || '');
    }
    function titleboxAnchorOf(el, scope) {
      if (!el || !scope) return null;
      const inside = el.closest && el.closest('.titlebox');
      if (inside && (!scope.contains || scope.contains(inside))) {
        const t = titleboxTitleText(inside);
        if (t && !isActionOnlyTitle(t)) return inside;
      }
      const nodeList = scope.querySelectorAll ? scope.querySelectorAll('.titlebox') : [];
      const boxes = [];
      for (let i = 0; i < nodeList.length; i++) boxes.push(nodeList[i]);
      return pickNearestTitlebox(boxes, el) || null;
    }
    function isBareActionButton(el) {
      if (!el || !el.closest) return false;
      const isBtn = el.tagName === 'BUTTON'
        || (el.classList && typeof el.classList.contains === 'function'
          && el.classList.contains('el-button'));
      if (!isBtn) return false;
      // Page-level action buttons (e.g. fixed wizard/tab bottom bars) are not
      // part of any content block — never inherit a titlebox by geometry.
      return !el.closest('.el-collapse-item, .titlebox, .el-table');
    }
    function composeTitleboxTitle(el, scope) {
      if (!el || !scope) return '';
      if (isBareActionButton(el)) return '';
      const want = String((el.innerText || el.textContent || '')).replace(/\s+/g, ' ').trim().slice(0, 40);
      const anchor = titleboxAnchorOf(el, scope);
      if (!anchor) return '';
      const title = titleboxTitleText(anchor);
      if (!title || isActionOnlyTitle(title) || title === want) return '';
      return title;
    }
    function finishCompose(card, chrome, section, block) {
      const parts = [];
      const ids = [];
      if (card) {
        parts.push(card);
        ids.push('card:' + card);
      }
      if (chrome && chrome.label) {
        parts.push(chrome.label);
        ids.push((chrome.role === 'wizard' ? 'wizard:' : 'tab:') + chrome.label);
      }
      if (section) {
        parts.push(section);
        ids.push('section:' + section);
      }
      if (block) {
        parts.push(block);
        ids.push('titlebox:' + block);
      }
      if (!parts.length) return null;
      let role = 'section';
      if (block || section) role = 'section';
      else if (chrome && chrome.role === 'wizard') role = 'wizard';
      else if (chrome && chrome.role === 'tab') role = 'tab';
      else if (card) role = 'card';
      const out = {
        region_role: role,
        region_id: ids.join('|'),
        region_label: parts.join(' / '),
      };
      if (card) out.region_card = card;
      if (chrome && chrome.label) out.region_chrome = { role: chrome.role, label: chrome.label };
      if (section) out.region_section = section;
      if (block) {
        out.region_block = block;
        out.title = block;
      }
      return out;
    }
    function composeContentRegion(el) {
      if (!el || !el.closest) return null;
      let chrome = readChrome(el);
      let section = collapseSectionTitle(el);
      let card = cardTitleOf(el);
      let scope = null;
      if (el.closest('.el-collapse-item')) scope = el.closest('.el-collapse-item');
      else if (el.closest('.el-tab-pane')) scope = el.closest('.el-tab-pane');
      else if (el.closest('.el-main, .app-main, .plugin-content, main')) {
        scope = el.closest('.el-main, .app-main, .plugin-content, main');
      } else {
        scope = (typeof document !== 'undefined' && document.body) ? document.body : el;
      }
      const block = composeTitleboxTitle(el, scope);
      // Floating/fixed bars outside tab panes (e.g. bottom action bar): the
      // element itself has no chrome/section, but its nearest titlebox lives
      // inside the pane. Inherit that titlebox's own context so the full
      // region path (tab | section | titlebox) survives for such controls.
      if (block && !chrome && !section && !(el.closest && el.closest('.titlebox'))) {
        const anchor = titleboxAnchorOf(el, scope);
        if (anchor) {
          chrome = readChrome(anchor);
          section = collapseSectionTitle(anchor);
          if (!card) card = cardTitleOf(anchor);
        }
      }
      try {
        return finishCompose(card, chrome, section, block);
      } catch (e) {
        return finishCompose(card, chrome, section, '');
      }
    }
    function mergeTitleboxIntoRegion(region, finer) {
      const title = finer && (finer.title || finer.region_label);
      if (!title) return region;
      const rid = String((region && region.region_id) || '');
      if (rid.indexOf('titlebox:') >= 0) return region;
      const chrome = region && region.region_chrome ? region.region_chrome : null;
      const section = (region && region.region_section) || '';
      const card = (region && region.region_card) || '';
      const next = finishCompose(card, chrome, section, String(title));
      return next || region;
    }
    function findTitleboxRegion(host, needle) {
      if (!host || !host.closest) return null;
      const want = String(needle || '').replace(/\s+/g, ' ').trim();
      const inside = host.closest('.titlebox');
      if (inside) {
        const title = titleboxTitleText(inside);
        if (title && !isActionOnlyTitle(title) && title !== want) {
          return {
            region_role: 'section',
            region_id: 'section:' + title,
            region_label: title,
            title: title,
          };
        }
      }
      let n = host;
      for (let d = 0; d < 14 && n; d++) {
        if (n.querySelector) {
          const candidates = [];
          const boxes = n.querySelectorAll('.titlebox');
          for (let bi = 0; bi < boxes.length; bi++) {
            const box = boxes[bi];
            if (!n.contains(host)) continue;
            if (box.contains(host)) continue;
            const title = titleboxTitleText(box);
            if (title && !isActionOnlyTitle(title) && title !== want) {
              candidates.push({ box: box, title: title });
            }
          }
          if (candidates.length > 0) {
            const picked = pickNearestTitlebox(
              candidates.map(function (c) { return c.box; }),
              host
            );
            for (let ci = 0; ci < candidates.length; ci++) {
              if (candidates[ci].box === picked) {
                const t = candidates[ci].title;
                return {
                  region_role: 'section',
                  region_id: 'section:' + t,
                  region_label: t,
                  title: t,
                };
              }
            }
            const fallback = candidates[0];
            return {
              region_role: 'section',
              region_id: 'section:' + fallback.title,
              region_label: fallback.title,
              title: fallback.title,
            };
          }
        }
        n = n.parentElement;
      }
      return null;
    }
    function titleboxAnchorXPath(host, title, leafLocal) {
      const leaf = String(leafLocal || '').replace(/^\/+/, '');
      const t = String(title || '').replace(/\s+/g, ' ').trim();
      if (!host || !leaf || !t) return '';
      const lit = xpathLiteral(t);
      return "//div[contains(concat(' ',normalize-space(@class),' '),' titlebox ')]"
        + "[.//*[contains(concat(' ',normalize-space(@class),' '),' title ') and normalize-space()=" + lit + "]"
        + " or normalize-space()=" + lit + "]"
        + "/ancestor::*[.//" + leaf + "][1]//" + leaf;
    }
    function refineCollidingRegions(items, needle) {
      if (!items || items.length < 2) return;
      const byId = {};
      for (let i = 0; i < items.length; i++) {
        const id = String((items[i].region && items[i].region.region_id) || 'other');
        if (!byId[id]) byId[id] = [];
        byId[id].push(i);
      }
      const ids = Object.keys(byId);
      for (let k = 0; k < ids.length; k++) {
        const idxs = byId[ids[k]];
        if (idxs.length < 2) continue;
        for (let j = 0; j < idxs.length; j++) {
          const it = items[idxs[j]];
          const role = String((it.region && it.region.region_role) || '');
          if (role === 'overlay' || role === 'table' || role === 'todo'
            || role === 'shell-aside' || role === 'shell-header') continue;
          const finer = findTitleboxRegion(it.el, needle);
          if (finer) it.region = withLayers(mergeTitleboxIntoRegion(it.region, finer));
        }
      }
    }
    /* SHARED_INVENTORY_COLLECT — AG-fullpage; keep in sync with _locator_helpers_js.py */
    var INVENTORY_CAP = 120;
    var INVENTORY_COLLECT_LIMIT = 2000;
    function inventoryNorm(s) {
      return String(s || '').replace(/\s+/g, ' ').trim();
    }
    function inventoryKindOf(el) {
      return classifyOperable(el);
    }
    function classifyOperable(el) {
      if (!el) return '';
      // Todo card actions before form checkbox — portal 待办 wraps cards in el-checkbox-group.
      if (el.closest && el.closest('.todo-item-action')) return 'button';
      if (el.closest && el.closest('.el-checkbox-group, .el-checkbox')) return 'form_checkbox';
      const k = detectTargetKind(el);
      if (k === 'form_input' || k === 'form_select' || k === 'form_date' || k === 'form_radio'
        || k === 'form_checkbox' || k === 'form_tree_select') return k;
      if (k === 'menu' || k === 'submenu') return 'menu';
      if (k === 'icon') return 'icon';
      if (k === 'button' || k === 'adjacent_button' || k === 'link' || k === 'table_row_button'
        || k === 'tab' || k === 'generic') return 'button';
      return '';
    }
    function inventoryPickControl(item) {
      if (!item) return null;
      const candidates = [
        item.querySelector('.el-tree-select'),
        item.querySelector('.el-cascader'),
        item.querySelector('span.my-popover, .my-popover'),
        item.querySelector('.el-select'),
        item.querySelector('.el-date-editor'),
        item.querySelector('.el-radio-group'),
        item.querySelector('.el-checkbox-group'),
        item.querySelector('.el-textarea__inner'),
        item.querySelector('textarea'),
        Array.from(item.querySelectorAll('.el-input__inner, input:not([type="hidden"])'))
          .find(function (inp) { return !inp.closest('.el-popover, .tree-popover'); }),
        item.querySelector('button'),
        item.querySelector('a'),
      ].filter(Boolean);
      return candidates[0] || item;
    }
    function inventoryTextOf(el, kind) {
      if (!el) return '';
      if (kind.indexOf('form_') === 0) {
        const item = el.closest && el.closest('.el-form-item');
        const lbl = item && item.querySelector('.el-form-item__label');
        const t = normalizeFormLabel(lbl && lbl.textContent);
        if (t) return t;
        return inventoryNorm(el.getAttribute && el.getAttribute('placeholder'));
      }
      return cleanVisibleText(el);
    }
    function collectL2Hosts() {
      const sel = [
        '.el-form-item input:not([type="hidden"])',
        '.el-form-item textarea',
        '.el-form-item .el-select .el-input__inner',
        '.el-form-item .el-date-editor',
        '.el-form-item .el-radio, .el-form-item .el-radio-group .el-radio',
        '.el-form-item .el-checkbox, .el-form-item .el-checkbox-group .el-checkbox',
        'button.el-button, .el-button, button',
        '.todo-item-action',
        '.menu-item, .submenu-item, .el-menu-item, .el-submenu__title, .el-dropdown-menu__item, [role="menuitem"]',
        '[class*="el-icon"][aria-label], .el-tooltip[class*="el-icon"], a[class*="el-icon"]',
      ].join(',');
      const nodes = document.querySelectorAll(sel);
      const out = [];
      const seen = typeof WeakSet !== 'undefined' ? new WeakSet() : null;
      for (let i = 0; i < nodes.length; i++) {
        const el = nodes[i];
        if (!isVisible(el)) continue;
        let host = normalizeHost(el) || el;
        const formItem = host.closest && host.closest('.el-form-item');
        if (formItem && host === formItem) host = inventoryPickControl(formItem) || host;
        if (seen) {
          if (seen.has(host)) continue;
          seen.add(host);
        }
        const kind = classifyOperable(host);
        if (!kind) continue;
        let operable = host;
        if (kind.indexOf('form_') === 0 && formItem) {
          operable = inventoryPickControl(formItem) || host;
        }
        const text = inventoryTextOf(operable, kind);
        out.push({ el: operable, text: text, kind: kind });
        if (out.length >= INVENTORY_COLLECT_LIMIT) break;
      }
      return out;
    }
    function collectInventoryHosts() {
      return collectL2Hosts();
    }
    function kindsForAction(action) {
      const a = String(action || '');
      if (a === 'fill_form_field') {
        return { form_input: 1, form_date: 1, form_radio: 1, form_checkbox: 1, form_tree_select: 1 };
      }
      if (a === 'select_option') return { form_select: 1 };
      if (a === 'click_menu_item') return { menu: 1 };
      if (a === 'click_element_by_index') return { button: 1, icon: 1, menu: 1 };
      return null;
    }
    function filterInventoryByKind(list, action) {
      const allow = kindsForAction(action);
      if (!allow) return list.slice();
      return list.filter(function (it) { return !!allow[it.kind]; });
    }
    function filterInventoryByText(list, needle) {
      const n = inventoryNorm(needle).toLowerCase();
      if (!n) return list.slice();
      return list.filter(function (it) {
        return inventoryNorm(it.text).toLowerCase().indexOf(n) >= 0;
      });
    }
  /* regionAnchorXPath — xpath 消歧：regionAnchorOf(host).prefix + '//' + leaf */
  function regionAnchorXPath(host, leafLocal) {
    const leaf = String(leafLocal || '').replace(/^\/+/, '');
    if (!host || !leaf) return '';
    const sec = regionAnchorOf(host);
    if (!sec || !sec.prefix) return '';
    return sec.prefix + '//' + leaf;
  }
  function pageStateOf() {
    try {
      const stepsRoot = document.querySelector('.el-steps');
      if (stepsRoot) {
        const steps = stepsRoot.querySelectorAll('.el-step');
        for (let i = 0; i < steps.length; i++) {
          const s = steps[i];
          const process = s.classList.contains('is-process')
            || s.classList.contains('is-active')
            || !!(s.querySelector && s.querySelector('.is-process, .is-active, .el-step__head.is-process'));
          if (!process) continue;
          const titleEl = s.querySelector('.el-step__title');
          const title = normalizeControlText((titleEl && (titleEl.innerText || titleEl.textContent)) || s.innerText || '');
          if (title) return { kind: 'wizard_step', title: title };
        }
      }
      const dialogs = document.querySelectorAll('.el-dialog');
      for (let i = 0; i < dialogs.length; i++) {
        if (!isVisible(dialogs[i])) continue;
        const titleEl = dialogs[i].querySelector('.el-dialog__title');
        const title = normalizeControlText((titleEl && titleEl.textContent) || '');
        if (title) return { kind: 'dialog', title: title.slice(0, 40) };
      }
      const drawers = document.querySelectorAll('.el-drawer');
      for (let j = 0; j < drawers.length; j++) {
        if (!isVisible(drawers[j])) continue;
        const titleEl = drawers[j].querySelector('.el-drawer__title, .el-drawer__header');
        const title = normalizeControlText((titleEl && titleEl.textContent) || '');
        if (title) return { kind: 'drawer', title: title.slice(0, 40) };
      }
      const bc = document.querySelector('.el-breadcrumb');
      if (bc) {
        const title = normalizeControlText(bc.innerText || bc.textContent || '');
        if (title) return { kind: 'breadcrumb', title: title.slice(0, 40) };
      }
    } catch (e) { /* ignore */ }
    return null;
  }
  function isWizardNavLabel(text) {
    const t = normalizeControlText(text);
    return t === '下一步' || t === '上一步';
  }
  function pageStateAnchorXPath(host, leafLocal, pageState) {
    const leaf = String(leafLocal || '').replace(/^\/+/, '');
    if (!host || !leaf || !pageState || !pageState.title) return '';
    const lit = xpathLiteral(pageState.title);
    if (pageState.kind === 'wizard_step') {
      return "//*[" + classTokenPred('el-steps') + "][.//*[(contains(@class,'is-process') or contains(@class,'is-active')) and contains(normalize-space(.)," + lit + ")]]"
        + "/ancestor::*[.//" + leaf + "][1]//" + leaf;
    }
    if (pageState.kind === 'dialog') {
      return "//*[" + classTokenPred('el-dialog') + "][.//*[" + classTokenPred('el-dialog__title')
        + " and contains(normalize-space(.)," + lit + ")]]/ancestor-or-self::*[.//" + leaf + "][1]//" + leaf;
    }
    if (pageState.kind === 'drawer') {
      return "//*[" + classTokenPred('el-drawer') + "][.//*[(" + classTokenPred('el-drawer__title')
        + " or " + classTokenPred('el-drawer__header') + ") and contains(normalize-space(.)," + lit + ")]]"
        + "/ancestor-or-self::*[.//" + leaf + "][1]//" + leaf;
    }
    if (pageState.kind === 'breadcrumb') {
      return "//*[" + classTokenPred('el-breadcrumb') + " and contains(normalize-space(.)," + lit + ")]"
        + "/ancestor::*[.//" + leaf + "][1]//" + leaf;
    }
    return '';
  }
  function pageStateNavXPath(host, leafLocal, pageState) {
    return pageStateAnchorXPath(host, leafLocal, pageState);
  }
  /* PAGE_STATE_GEN — collision-only page-state wrap for clickables */
  function tryPageStateAnchor(host, leaf, text) {
    const ps = pageStateOf();
    if (!ps) return null;
    const xp = pageStateAnchorXPath(host, leaf, ps);
    if (!xp) return null;
    const nodes = evalXpathAll(xp);
    if (nodes.length === 1 && nodes[0] === host) return xp;
    return null;
  }
  /** Relative leaf after the last // in a smart xpath (for section anchoring). */
  function leafFromSmartExpr(expr) {
    const s = String(expr || '').trim();
    if (!s) return '';
    const idx = s.lastIndexOf('//');
    if (idx < 0) return s.replace(/^\/+/, '');
    return s.slice(idx + 2);
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
    if (hasClassToken(cls, 'todo-item-action') || (node.closest && node.closest('.todo-item-action'))) {
      const lit = xpathLiteral(t);
      const local = "div[" + classTokenPred('todo-item-action') + " and normalize-space()=" + lit + "]";
      const anchored = regionAnchorXPath(node, local);
      if (anchored) return anchored;
      return scopedXPath(local, scopeKind);
    }
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
  // 结构化布尔属性（录制插件格式对齐）：HTML 布尔属性（disabled/readonly/required）
  // 属性值为空串，collectAttrs 的 !at.value 过滤会丢弃它们，这里显式采集。
  // 非 form 控件（div/span）无这些 DOM 属性，统一输出 false。
  function collectAttrFlags(el) {
    if (!el) return { disabled: false, required: false, readonly: false };
    return {
      disabled: el.disabled === true,
      required: el.required === true,
      readonly: el.readOnly === true,
    };
  }
  function buildLocatorSnap(node, text, xpathFull, formLabel, opts) {
    opts = opts || {};
    const host = normalizeTargetRoot(node) || node;
    const region = (opts && opts.region && opts.region.region_id)
      ? opts.region
      : assignRegion(host);
    const kind = opts.targetKind || detectTargetKind(host);
    const t = normalizeControlText(text) || cleanVisibleText(host);
    const abs = String(xpathFull || absXPath(host) || '');
    let formLbl = normalizeFormLabel(formLabel || '');
    if (!formLbl && host && host.closest) {
      const item = host.closest('.el-form-item');
      const lbl = item && item.querySelector('.el-form-item__label, label');
      formLbl = normalizeFormLabel(lbl && lbl.textContent);
    }
    let smart = xpathSmartOf(host, t, formLbl, kind);
    let occurrence = 0;
    let verified = false;
    if (smart || t) {
      // Button-oriented default leaf; non-button duplicate hosts without smart multi-hit
      // fall back to xpath_full until a follow-up generalizes leaf extraction.
      const localLeaf = (function () {
        const tagL = (host.tagName || '').toLowerCase();
        const lit = xpathLiteral(t);
        const cls = String(host.className || '');
        if (tagL === 'a') return 'a[normalize-space()=' + lit + ']';
        if (/(^| )el-button( |$)/.test(cls) && tagL !== 'button') {
          return '*[' + classTokenPred('el-button') + ' and normalize-space()=' + lit + ']';
        }
        return 'button[normalize-space()=' + lit + ']';
      })();
      if (isWizardNavLabel(t)) {
        const navXp = tryPageStateAnchor(host, localLeaf, t);
        if (navXp) {
          smart = navXp;
          occurrence = 0;
          verified = true;
        }
      }
      let leafForAnchor = localLeaf;
      let trySectionAnchor = false;
      let nodesMulti = false;
      if (regionAnchorOf(host) && t) {
        const labelNodes = evalXpathAll('//' + localLeaf);
        if (labelNodes.length >= 2) trySectionAnchor = true;
      }
      if (smart) {
        const nodes = evalXpathAll(smart);
        if (nodes.length >= 2) {
          nodesMulti = true;
          trySectionAnchor = true;
          const fromSmart = leafFromSmartExpr(smart);
          if (fromSmart) leafForAnchor = fromSmart;
        }
      }
      if (trySectionAnchor) {
        const anchored = regionAnchorXPath(host, leafForAnchor);
        if (anchored) {
          const anodes = evalXpathAll(anchored);
          let idx = -1;
          for (let i = 0; i < anodes.length; i++) {
            if (anodes[i] === host) { idx = i; break; }
          }
          if (anodes.length === 1 && idx === 0) {
            smart = anchored;
            occurrence = 0;
            verified = true;
          }
        }
      }
      if ((!verified || nodesMulti) && region && (region.title || region.region_block)) {
        const tbTitle = region.title || region.region_block;
        const tbXp = titleboxAnchorXPath(host, tbTitle, leafForAnchor || localLeaf);
        if (tbXp) {
          const tnodes = evalXpathAll(tbXp);
          let tidx = -1;
          for (let i = 0; i < tnodes.length; i++) {
            if (tnodes[i] === host) { tidx = i; break; }
          }
          if (tnodes.length === 1 && tidx === 0) {
            smart = tbXp;
            occurrence = 0;
            verified = true;
          }
        }
      }
      const stillMulti = !!(smart && evalXpathAll(smart).length >= 2);
      const leafCollision = evalXpathAll('//' + (leafForAnchor || localLeaf)).length >= 2;
      const skipPageStateWrap = String(kind).indexOf('form_') === 0;
      if ((stillMulti || leafCollision) && !skipPageStateWrap && t) {
        const psXp = tryPageStateAnchor(host, leafForAnchor || localLeaf, t);
        if (psXp) {
          smart = psXp;
          occurrence = 0;
          verified = true;
        }
      }
      if (!verified && smart) {
        const pinned = pinOccurrence(smart, host);
        smart = pinned.xpath;
        occurrence = pinned.occurrence;
        verified = pinned.verified;
        // Do not export global [n] when section/titlebox anchor exists but uniqueness failed.
        if (occurrence >= 1 && (regionAnchorOf(host) || (region && (region.title || region.region_block)))) {
          smart = '';
          verified = false;
          occurrence = 0;
        }
      }
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
      attr: collectAttrFlags(host),
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
      region_role: region.region_role,
      region_id: region.region_id,
      region_label: region.region_label,
      region_chrome: region.region_chrome,
      region_section: region.region_section,
      region_block: region.region_block,
      layers: region.layers || [],
      feature_card: buildFeatureCard(host, region),
      page_bbox: documentBBoxOf(host) || undefined,
    };
  }
'''
