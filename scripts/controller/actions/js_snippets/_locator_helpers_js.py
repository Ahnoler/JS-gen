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
  function sectionAnchorOf(host) {
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
    return null;
  }
    /* SHARED_ASSIGN_REGION — keep in sync with scan_form.py assignRegion */
    function regionLabelOf(role, title) {
      const t = String(title || '').replace(/\s+/g, ' ').trim().slice(0, 40);
      if (role === 'overlay') return t || '弹层';
      if (role === 'table') return t || '表格';
      if (role === 'section') return t || '区块';
      if (role === 'shell-aside') return '侧栏';
      if (role === 'shell-header') return '顶栏';
      if (role === 'main') return '主区';
      if (role === 'page') return '页面';
      return t || '其他';
    }
    function assignRegion(el) {
      if (!el || !el.closest) {
        return { region_role: 'other', region_id: 'other', region_label: regionLabelOf('other') };
      }
      if (el.closest('.el-dialog, .el-drawer, .el-message-box')) {
        const o = el.closest('.el-dialog, .el-drawer, .el-message-box');
        const title = (o.querySelector('.el-dialog__title, .el-drawer__title')
          && (o.querySelector('.el-dialog__title, .el-drawer__title').textContent || ''))
          || o.getAttribute('aria-label') || '';
        const id = 'overlay:' + String(title || 'overlay').replace(/\s+/g, ' ').trim().slice(0, 40);
        return { region_role: 'overlay', region_id: id, region_label: regionLabelOf('overlay', title) };
      }
      if (el.closest('.el-table, .tssc-multiple-table-content, .myTable')) {
        return { region_role: 'table', region_id: 'table', region_label: regionLabelOf('table') };
      }
      if (el.closest('.el-collapse-item')) {
        const it = el.closest('.el-collapse-item');
        const t = (it.querySelector('.el-collapse-item__header')
          && (it.querySelector('.el-collapse-item__header').innerText || ''))
          || '';
        const title = String(t).replace(/\s+/g, ' ').trim().slice(0, 40);
        return {
          region_role: 'section',
          region_id: 'section:' + (title || 'section'),
          region_label: regionLabelOf('section', title),
        };
      }
      if (el.closest('.el-aside, .sidebar, aside, .el-menu')) {
        return { region_role: 'shell-aside', region_id: 'shell-aside', region_label: regionLabelOf('shell-aside') };
      }
      if (el.closest('.el-header, .navbar, header, .tags-view-container')) {
        return { region_role: 'shell-header', region_id: 'shell-header', region_label: regionLabelOf('shell-header') };
      }
      if (el.closest('.el-main, .app-main, .plugin-content, main')) {
        return { region_role: 'main', region_id: 'main', region_label: regionLabelOf('main') };
      }
      return { region_role: 'other', region_id: 'other', region_label: regionLabelOf('other') };
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
          const finer = findTitleboxRegion(it.el, needle);
          if (finer) it.region = finer;
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
      if (!el) return '';
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
    function collectInventoryHosts() {
      const sel = [
        '.el-form-item input:not([type="hidden"])',
        '.el-form-item textarea',
        '.el-form-item .el-select .el-input__inner',
        '.el-form-item .el-date-editor',
        '.el-form-item .el-radio, .el-form-item .el-radio-group .el-radio',
        '.el-form-item .el-checkbox, .el-form-item .el-checkbox-group .el-checkbox',
        'button.el-button, .el-button, button',
        '.menu-item, .submenu-item, .el-menu-item, .el-submenu__title, .el-dropdown-menu__item, [role="menuitem"]',
        '[class*="el-icon"][aria-label], .el-tooltip[class*="el-icon"], a[class*="el-icon"]',
      ].join(',');
      const nodes = document.querySelectorAll(sel);
      const out = [];
      const seen = typeof WeakSet !== 'undefined' ? new WeakSet() : null;
      for (let i = 0; i < nodes.length; i++) {
        const el = nodes[i];
        if (!isVisible(el)) continue;
        let host = normalizeTargetRoot(el) || el;
        const formItem = host.closest && host.closest('.el-form-item');
        if (formItem && host === formItem) host = inventoryPickControl(formItem) || host;
        if (seen) {
          if (seen.has(host)) continue;
          seen.add(host);
        }
        const kind = inventoryKindOf(host);
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
  function sectionAnchorXPath(host, leafLocal) {
    const leaf = String(leafLocal || '').replace(/^\/+/, '');
    if (!host || !leaf) return '';
    const sec = sectionAnchorOf(host);
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
  function pageStateNavXPath(host, leafLocal, pageState) {
    const leaf = String(leafLocal || '').replace(/^\/+/, '');
    if (!host || !leaf || !pageState || !pageState.title) return '';
    const lit = xpathLiteral(pageState.title);
    if (pageState.kind === 'wizard_step') {
      return "//*[" + classTokenPred('el-steps') + "][.//*[(contains(@class,'is-process') or contains(@class,'is-active')) and contains(normalize-space(.)," + lit + ")]]"
        + "/ancestor::*[.//" + leaf + "][1]//" + leaf;
    }
    if (pageState.kind === 'breadcrumb') {
      return "//*[" + classTokenPred('el-breadcrumb') + " and contains(normalize-space(.)," + lit + ")]"
        + "/ancestor::*[.//" + leaf + "][1]//" + leaf;
    }
    return '';
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
    const region = (opts && opts.region && opts.region.region_id)
      ? opts.region
      : assignRegion(host);
    const kind = opts.targetKind || detectTargetKind(host);
    const t = normalizeControlText(text) || cleanVisibleText(host);
    const abs = String(xpathFull || absXPath(host) || '');
    const formLbl = normalizeFormLabel(formLabel || '');
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
        const ps = pageStateOf();
        const leafNav = (function () {
          const lit = xpathLiteral(t);
          const tagL = (host.tagName || '').toLowerCase();
          const cls = String(host.className || '');
          if (tagL === 'a') return 'a[normalize-space()=' + lit + ']';
          if (/(^| )el-button( |$)/.test(cls) && tagL !== 'button') {
            return '*[' + classTokenPred('el-button') + ' and normalize-space()=' + lit + ']';
          }
          return 'button[normalize-space()=' + lit + ']';
        })();
        const navXp = pageStateNavXPath(host, leafNav, ps);
        if (navXp) {
          const nodes = evalXpathAll(navXp);
          let idx = -1;
          for (let i = 0; i < nodes.length; i++) {
            if (nodes[i] === host) { idx = i; break; }
          }
          if (nodes.length === 1 && idx === 0) {
            smart = navXp;
            occurrence = 0;
            verified = true;
          }
        }
      }
      let leafForAnchor = localLeaf;
      let trySectionAnchor = false;
      let nodesMulti = false;
      if (sectionAnchorOf(host) && t) {
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
        const anchored = sectionAnchorXPath(host, leafForAnchor);
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
      if ((!verified || nodesMulti) && region && region.title) {
        const tbXp = titleboxAnchorXPath(host, region.title, leafForAnchor || localLeaf);
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
      if (!verified && smart) {
        const pinned = pinOccurrence(smart, host);
        smart = pinned.xpath;
        occurrence = pinned.occurrence;
        verified = pinned.verified;
        // Do not export global [n] when section/titlebox anchor exists but uniqueness failed.
        if (occurrence >= 1 && (sectionAnchorOf(host) || (opts.region && opts.region.title))) {
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
    };
  }
'''
