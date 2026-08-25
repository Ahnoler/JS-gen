"""JS blob constants for replay (extracted verbatim from _replay.py)."""


# Broad "page busy" cues after save — masks, button/icon spinners, aria-busy.
# (Do not rely on tree DOM alone; tables/forms/dialogs share the same save pattern.)
_JS_PAGE_BUSY = r'''() => {
  const isVis = (el) => {
    if (!el || el.nodeType !== 1) return false;
    const st = getComputedStyle(el);
    if (st.display === 'none' || st.visibility === 'hidden' || Number(st.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const masks = [...document.querySelectorAll('.el-loading-mask')].filter(
    (m) => !m.classList.contains('el-loading-mask--hidden') && isVis(m)
  );
  if (masks.length) return 'mask';
  if ([...document.querySelectorAll('.el-button.is-loading, button.is-loading')].some(isVis)) {
    return 'btn-loading';
  }
  if ([...document.querySelectorAll('.el-icon-loading, .el-loading-spinner')].some(isVis)) {
    return 'spinner';
  }
  if ([...document.querySelectorAll('[aria-busy="true"]')].some(isVis)) return 'aria-busy';
  // Generic overlays (avoid matching tiny decorative is-loading on non-controls)
  for (const el of document.querySelectorAll('.loading, .is-loading')) {
    if (el.matches('.el-button, button')) continue;
    if (!isVis(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.width >= 24 && r.height >= 24) return 'loading-cls';
  }
  return '';
}'''

# Visible editable input in right panel / any el-form (tree detail / edit).
_JS_EDIT_FORM_INPUT_VISIBLE = r'''() => {
  const isVis = (el) => {
    if (!el || el.nodeType !== 1) return false;
    if (el.offsetParent === null && !el.closest('.el-table__fixed')) return false;
    const st = getComputedStyle(el);
    if (st.display === 'none' || st.visibility === 'hidden' || Number(st.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const roots = [
    document.querySelector('.right-container'),
    document.querySelector('.right-content'),
    document,
  ].filter(Boolean);
  const seen = new Set();
  for (const root of roots) {
    if (seen.has(root)) continue;
    seen.add(root);
    const inputs = root.querySelectorAll(
      '.el-form-item input:not([type="hidden"]):not([disabled]), '
      + '.el-form-item textarea:not([disabled])'
    );
    for (const el of inputs) {
      if (isVis(el) && !el.readOnly) return true;
    }
  }
  return false;
}'''



# Locate + click by durable cues (xpath_smart → semantic → xpath → text).
# Robustness: stripVolatile tree text, visible dialog (not DOM [last()]),
# icon class + tooltip (aria-label often empty on ElTooltip toolbars).
_JS_CLICK_DURABLE = r'''async ([text, xpath, tagHint, xpathSmart, opts]) => {
  opts = opts || {};
  const norm = (s) => (s || '').replace(/\s+/g, '').trim();
  const stripVolatile = (s) => norm(s)
    .replace(/\[\s*V[-\d.]+\s*\]$/i, '')
    .replace(/\(\d+\)$/, '');
  const wantRaw = String(text || '');
  const want = norm(wantRaw);
  const wantBase = stripVolatile(wantRaw);
  const parentText = String(opts.parentText || opts.parent_text || '');
  const iconClass = String(opts.iconClass || opts.icon_class || '');
  const targetKind = String(opts.targetKind || opts.target_kind || '');
  const isVisible = (el) => {
    if (!el) return false;
    const st = getComputedStyle(el);
    const box = el.getBoundingClientRect();
    if (st.display === 'none' || st.visibility === 'hidden' || box.width < 1 || box.height < 1) return false;
    return true;
  };
  const wrapVisible = (d) => {
    if (!d) return false;
    const wrap = d.closest && d.closest('.el-dialog__wrapper, .el-message-box__wrapper, .el-drawer__wrapper');
    if (wrap && getComputedStyle(wrap).display === 'none') return false;
    return isVisible(d) || (wrap && isVisible(wrap));
  };
  const lastVisibleDialog = () => {
    const all = [...document.querySelectorAll('.el-dialog, .el-message-box')];
    for (let i = all.length - 1; i >= 0; i--) {
      if (wrapVisible(all[i])) return all[i];
    }
    return null;
  };
  const lastVisibleDrawer = () => {
    const all = [...document.querySelectorAll('.el-drawer')];
    for (let i = all.length - 1; i >= 0; i--) {
      if (wrapVisible(all[i])) return all[i];
    }
    return null;
  };
  const clickEl = (el, how) => {
    if (!el) return null;
    el.scrollIntoView({ block: 'center', behavior: 'instant' });
    el.click();
    return how;
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const evalXpathAll = (xp, root) => {
    let s = String(xp || '');
    if (!s) return [];
    const run = (expr, ctx) => {
      try {
        const snap = document.evaluate(expr, ctx, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
        const out = [];
        for (let i = 0; i < snap.snapshotLength; i++) out.push(snap.snapshotItem(i));
        return out;
      } catch (e) {
        return [];
      }
    };
    try {
      const ctx = root || document;
      if (root && s.startsWith('//')) {
        s = '.' + s;
      } else if (root && !s.startsWith('.') && !s.startsWith('/') && !s.startsWith('(')) {
        s = './/' + s;
      } else if (!root && !s.startsWith('/') && !s.startsWith('(')) {
        s = '/' + s;
      }
      let out = run(s, ctx);
      // Recording often stores body-relative abs paths as /div[1]/… (no /html/body).
      // document.evaluate('/div[1]/…') misses; retry under /html/body.
      if (!out.length && !root && s.startsWith('/') && !s.startsWith('/html')) {
        out = run('/html/body' + s, document);
      }
      return out;
    } catch (e) {
      return [];
    }
  };
  const clickLastVisibleXpath = (xp, how, root) => {
    let nodes = evalXpathAll(xp, root).filter(isVisible);
    if (!nodes.length) return null;
    // Guard false ok-xpath-smart: recorded xpath may point at an ancestor
    // (e.g. el-checkbox-group[aria-label=checkbox-group] wrapping 待办 cards)
    // whose descendant text includes want but is not the control.
    if (want) {
      const exact = nodes.filter((el) => norm(el.innerText || el.textContent) === want);
      if (!exact.length) return null;
      nodes = exact;
    }
    return clickEl(nodes[nodes.length - 1], how);
  };
  const clickSmartXpath = (xp, how) => {
    if (!xp) return null;
    let hit = clickLastVisibleXpath(xp, how);
    if (hit) return hit;
    // Dialog/drawer [last()] often points at a hidden leftover — retry under visible overlay
    if (/el-dialog|el-message-box|el-drawer/.test(xp) && /\[last\(\)\]/.test(xp)) {
      const m = String(xp).match(/\[last\(\)\](?:\/\/(.+))?$/);
      const local = m && m[1] ? m[1] : '';
      const dlg = /el-drawer/.test(xp) ? lastVisibleDrawer() : lastVisibleDialog();
      if (dlg && local) {
        hit = clickLastVisibleXpath('.//' + local, how + '-vis-dlg', dlg);
        if (hit) return hit;
      }
      if (dlg && !local) return clickEl(dlg, how + '-vis-dlg-host');
    }
    return null;
  };
  const pickTreeNode = (rawWant, parentRaw) => {
    const base = stripVolatile(rawWant);
    if (!base) return null;
    let roots = [...document.querySelectorAll('.el-tree-node__content, .el-tree-node__label')].filter(isVisible);
    const pb = stripVolatile(parentRaw || '');
    if (pb) {
      const parentHit = roots.find((el) => {
        const t = stripVolatile(el.innerText || el.textContent);
        return t === pb || t.startsWith(pb);
      });
      if (parentHit) {
        const treeNode = parentHit.closest('.el-tree-node');
        if (treeNode) {
          roots = [...treeNode.querySelectorAll('.el-tree-node__content, .el-tree-node__label')]
            .filter(isVisible)
            .filter((el) => el !== parentHit);
        }
      }
    }
    const scored = [];
    for (const el of roots) {
      const t = stripVolatile(el.innerText || el.textContent);
      let score = 0;
      if (t === base) score = 3;
      else if (t.startsWith(base)) score = 2;
      else if (t.includes(base) || base.includes(t)) score = 1;
      if (score) scored.push({ el, t, score, len: t.length });
    }
    if (!scored.length) return null;
    scored.sort((a, b) => b.score - a.score || a.len - b.len);
    return scored[0].el;
  };
  const extractIconClass = () => {
    if (iconClass && /el-icon-[a-z0-9-]+/i.test(iconClass)) {
      const m = iconClass.match(/el-icon-[a-z0-9-]+/i);
      return m ? m[0] : iconClass;
    }
    const blob = String(xpathSmart || xpath || '');
    const m = blob.match(/el-icon-[a-z0-9-]+/i);
    return m ? m[0] : '';
  };
  const clickToolbarIcon = async () => {
    const cls = extractIconClass();
    const tipWant = want || wantBase;
    const anchors = [...document.querySelectorAll(
      'a.el-tooltip, .el-tooltip[class*="el-icon"], a[class*="el-icon-"], i.el-tooltip, .el-tooltip.item'
    )].filter(isVisible);
    // Prefer class match
    if (cls) {
      const byClass = anchors.filter((el) => String(el.className || '').includes(cls));
      if (byClass.length === 1) return clickEl(byClass[0], 'ok-icon-class');
      if (byClass.length > 1 && tipWant) {
        for (const el of byClass) {
          el.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
          await sleep(100);
          const tips = [...document.querySelectorAll('.el-tooltip__popper, [role="tooltip"]')]
            .filter((p) => {
              const st = getComputedStyle(p);
              return st.display !== 'none' && st.visibility !== 'hidden';
            })
            .map((p) => norm(p.textContent));
          const ok = tips.some((t) => t === tipWant || t.includes(tipWant) || tipWant.includes(t));
          el.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
          if (ok) return clickEl(el, 'ok-icon-class-tip');
        }
        return clickEl(byClass[byClass.length - 1], 'ok-icon-class-last');
      }
      if (byClass.length) return clickEl(byClass[byClass.length - 1], 'ok-icon-class');
    }
    if (!tipWant) return null;
    // aria / title
    const ariaHits = [...document.querySelectorAll('[aria-label], [title]')].filter(isVisible).filter((el) => {
      const a = norm(el.getAttribute('aria-label') || '');
      const t = norm(el.getAttribute('title') || '');
      return a === tipWant || t === tipWant;
    });
    if (ariaHits.length) return clickEl(ariaHits[ariaHits.length - 1], 'ok-aria-label');
    // hover tip match
    for (const el of anchors) {
      el.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
      await sleep(80);
      const poppers = [...document.querySelectorAll('.el-tooltip__popper, [role="tooltip"]')].filter((p) => {
        const st = getComputedStyle(p);
        return st.display !== 'none' && st.visibility !== 'hidden' && (p.offsetWidth > 0 || p.offsetHeight > 0);
      });
      const hit = poppers.find((p) => {
        const t = norm(p.textContent);
        return t === tipWant || t.includes(tipWant) || tipWant.includes(t);
      });
      if (hit) {
        el.click();
        return 'ok-tooltip-icon';
      }
      el.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
    }
    return null;
  };

  // 0) xpath_smart (with visible-dialog rewrite)
  if (xpathSmart) {
    const hit = clickSmartXpath(xpathSmart, 'ok-xpath-smart');
    if (hit) return hit;
  }

  // 0b) Tree node: volatile-stripped match (even when smart failed exact count)
  if (wantBase && (targetKind === 'tree_node' || /el-tree-node__content/.test(String(xpathSmart || '')))) {
    const node = pickTreeNode(wantRaw, parentText);
    if (node) return clickEl(node, 'ok-tree-volatile');
  }

  // 0c) Icon toolbar (class + tip) — before generic text so "删除" does not hit unrelated nodes
  if (targetKind === 'icon' || iconClass || /el-icon-/.test(String(xpathSmart || ''))) {
    const ih = await clickToolbarIcon();
    if (ih) return ih;
  }

  // 1a) Custom app menu
  if (want) {
    const customMenu = [...document.querySelectorAll('li.menu-item, .menu-item')].filter(isVisible);
    const exactCustom = customMenu.filter((el) => norm(el.textContent) === want);
    if (exactCustom.length) return clickEl(exactCustom[exactCustom.length - 1], 'ok-menu-item-custom');
  }

  // 1a2) Todo / workflow card actions (待办「处理」= div.todo-item-action, not button)
  if (want) {
    const actions = [...document.querySelectorAll('.todo-item-action')].filter(isVisible)
      .filter((el) => norm(el.innerText || el.textContent) === want);
    if (actions.length) {
      const pb = stripVolatile(parentText || '');
      if (pb) {
        const scoped = actions.filter((el) => {
          const card = el.closest('.todo-item');
          const blob = stripVolatile(card && (card.innerText || card.textContent));
          return blob && (blob.includes(pb) || pb.includes(blob.slice(0, pb.length)));
        });
        if (scoped.length) return clickEl(scoped[scoped.length - 1], 'ok-todo-action-scoped');
      }
      return clickEl(actions[actions.length - 1], 'ok-todo-action');
    }
  }

  // 1b) Element UI menu
  if (want) {
    const menuItems = [...document.querySelectorAll('.el-menu-item')];
    const direct = menuItems.find(el => norm(el.textContent) === want && isVisible(el));
    if (direct) return clickEl(direct, 'ok-menu-item');

    for (const sm of document.querySelectorAll('.el-submenu')) {
      const title = sm.querySelector(':scope > .el-submenu__title');
      const titleText = norm(title?.textContent || '');
      if (title && (titleText === want || titleText.startsWith(want))) {
        if (!sm.classList.contains('is-opened')) {
          title.click();
          await sleep(350);
        }
        return clickEl(title, 'ok-submenu-title');
      }
      const items = [...sm.querySelectorAll('.el-menu-item')];
      const target = items.find(i => {
        const t = norm(i.textContent);
        return t === want || t.includes(want);
      });
      if (target) {
        if (!sm.classList.contains('is-opened') && title) {
          title.click();
          await sleep(350);
        }
        return clickEl(target, 'ok-menu-expanded');
      }
    }
  }

  // 1c) Icon / tree / aria fallbacks
  if (want || wantBase) {
    const ih = await clickToolbarIcon();
    if (ih) return ih;

    const treeNode = pickTreeNode(wantRaw || wantBase, parentText);
    if (treeNode) return clickEl(treeNode, 'ok-tree-content');
  }

  // 2) Absolute / recorded xpath
  if (xpath) {
    const hit = clickSmartXpath(xpath, 'ok-xpath') || clickLastVisibleXpath(xpath, 'ok-xpath');
    if (hit) return hit;
  }

  // 3) Text in visible drawer → visible dialog → page
  if (want) {
    const scopes = [];
    const dr = lastVisibleDrawer();
    const dg = lastVisibleDialog();
    if (dr) scopes.push({ el: dr, how: 'ok-text-drawer' });
    if (dg) scopes.push({ el: dg, how: 'ok-text-dialog' });
    scopes.push({ el: document, how: 'ok-text-exact' });

    const btnSel = 'button, button.el-button, a.el-button, a[role="button"], .el-button';
    for (const { el: scope, how } of scopes) {
      const hits = [...scope.querySelectorAll(btnSel)].filter(isVisible).filter((el) => {
        const t = norm(el.innerText || el.textContent || '');
        return t === want || (wantBase && stripVolatile(el.innerText || '') === wantBase);
      });
      if (hits.length) return clickEl(hits[hits.length - 1], how);
    }

    const sel = 'button, a, .el-button, .el-menu-item, .el-submenu__title, [role="menuitem"], .el-tabs__item, li.menu-item, .menu-item, .el-tree-node__content, .plugin-nav-list, .plugin-nav-outer, .nav-content, .todo-item-action';
    const candidates = [...document.querySelectorAll(sel)].filter(isVisible);
    const exact = candidates.filter(el => norm(el.innerText || el.textContent) === want);
    if (exact.length) return clickEl(exact[exact.length - 1], 'ok-text-exact');
    let best = null;
    let bestLen = Infinity;
    // Substring-of-want (测算 ⊂ 3.评级等级测算) is unsafe unless nearly as long as want.
    const minSubLen = Math.max(4, Math.ceil((wantBase || want).length * 0.6));
    for (const el of candidates) {
      const t = stripVolatile(el.innerText || el.textContent);
      if (!t || t.length > 40) continue;
      if (wantBase && (t === wantBase || t.startsWith(wantBase) || t.includes(wantBase))) {
        if (t.length <= bestLen) { best = el; bestLen = t.length; }
      } else {
        const n = norm(el.innerText || el.textContent);
        const subOfWant = want.includes(n) && n.length >= minSubLen;
        if (n.includes(want) || subOfWant) {
          if (n.length <= bestLen) { best = el; bestLen = n.length; }
        }
      }
    }
    if (best) return clickEl(best, 'ok-text-fuzzy');
  }

  return 'not-found';
}'''



_JS_READ_VALUE_BY_XPATH = r'''([xpath, labelHint]) => {
  if (!xpath) return '';
  const isVis = (el) => {
    if (!el || el.nodeType !== 1) return false;
    if (el.offsetParent === null && !el.closest('.el-table__fixed')) return false;
    const st = getComputedStyle(el);
    return st.display !== 'none' && st.visibility !== 'hidden';
  };
  // LABEL_HINT_DISAMBIG (exact > includes): prefix labels must not read siblings.
  const normFormLab = (s) => String(s || '').replace(/\s+/g, ' ').trim()
    .replace(/[：:*\s]+$/g, '').replace(/^[*\s]+/, '');
  const formItemLabel = (el) => {
    const item = el && el.closest && el.closest('.el-form-item');
    if (!item) return '';
    const lbl = item.querySelector('.el-form-item__label, label');
    return String((lbl && lbl.textContent) || '').replace(/\s+/g, ' ').trim();
  };
  const findNode = (xp, root, hint) => {
    try {
      let s = String(xp || '');
      if (!s) return null;
      const ctx = root || document;
      if (root && s.startsWith('//')) s = '.' + s;
      const snap = document.evaluate(s, ctx, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
      const wantN = normFormLab(hint);
      let fallback = null;
      let exactMatch = null;
      let includesMatch = null;
      for (let i = snap.snapshotLength - 1; i >= 0; i--) {
        const n = snap.snapshotItem(i);
        if (!n || !isVis(n)) continue;
        if (!fallback) fallback = n;
        if (wantN) {
          const labN = normFormLab(formItemLabel(n));
          if (labN === wantN) {
            exactMatch = n;
            break;
          }
          if (!includesMatch && labN && labN.includes(wantN)) includesMatch = n;
        }
      }
      return exactMatch || includesMatch || fallback;
    } catch (e) { /* ignore */ }
    return null;
  };
  const readControl = (node) => {
    if (!node) return '';
    const tag = (node.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea') return (node.value || '').trim();
    const inp = node.querySelector && node.querySelector('input:not([type="hidden"]), textarea');
    if (inp) return (inp.value || '').trim();
    const sel = (node.matches && node.matches('.el-select'))
      ? node
      : (node.closest && node.closest('.el-select'));
    if (sel) {
      const trigger = sel.querySelector('.el-input__inner');
      if (trigger) {
        const v = (trigger.value || '').trim();
        if (v && !v.includes('请选择')) return v;
      }
      const tagEl = sel.querySelector('.el-select__tags-text');
      if (tagEl) {
        const t = (tagEl.textContent || '').trim();
        if (t && !t.includes('请选择')) return t;
      }
      const single = sel.querySelector('.el-select__selected-item');
      if (single) {
        const t = (single.textContent || '').trim();
        if (t && !t.includes('请选择')) return t;
      }
    }
    return '';
  };
  const hint = labelHint == null ? '' : String(labelHint);
  const node = findNode(xpath, null, hint);
  if (node) return readControl(node);
  if (/el-dialog|el-message-box|el-drawer/.test(xpath) && /\[last\(\)\]/.test(xpath)) {
    const wrapVisible = (d) => {
      if (!d) return false;
      const wrap = d.closest && d.closest('.el-dialog__wrapper, .el-message-box__wrapper, .el-drawer__wrapper');
      if (wrap && getComputedStyle(wrap).display === 'none') return false;
      return isVis(d) || (wrap && isVis(wrap));
    };
    const lastVisibleHost = (drawer) => {
      const sel = drawer ? '.el-drawer' : '.el-dialog, .el-message-box';
      const all = [...document.querySelectorAll(sel)];
      for (let i = all.length - 1; i >= 0; i--) {
        if (wrapVisible(all[i])) return all[i];
      }
      return null;
    };
    const m = String(xpath).match(/\[last\(\)\](?:\/\/(.+))?$/);
    const local = m && m[1] ? m[1] : '';
    const dlg = /el-drawer/.test(xpath) ? lastVisibleHost(true) : lastVisibleHost(false);
    if (dlg && local) {
      const scoped = findNode('.//' + local, dlg, hint);
      if (scoped) return readControl(scoped);
    }
  }
  return '';
}'''

# Read back a value by el-form-item label or placeholder — the mirror of
# JS_FILL_BY_XPATH's placeholder fallback. Used when a fill landed on the
# placeholder branch (stale xpath) so the verify reads the SAME input the
# fill wrote, instead of reading an empty stale-xpath node.
_JS_READ_VALUE_BY_LABEL = r'''([label, placeholder]) => {
  const isVis = (el) => {
    if (!el || el.nodeType !== 1) return false;
    if (el.offsetParent === null && !el.closest('.el-table__fixed')) return false;
    const st = getComputedStyle(el);
    return st.display !== 'none' && st.visibility !== 'hidden';
  };
  const read = (el) => {
    if (!el) return '';
    const tag = (el.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea') return (el.value || '').trim();
    const inp = el.querySelector && el.querySelector('input:not([type="hidden"]), textarea');
    return inp ? (inp.value || '').trim() : '';
  };
  const want = String(label || '').trim();
  const phWant = String(placeholder || '').trim();
  // Pass 1: exact el-form-item label
  const items = document.querySelectorAll('.el-form-item');
  for (const item of items) {
    const lbl = item.querySelector('.el-form-item__label')?.textContent?.trim() || '';
    if (lbl !== want) continue;
    const input = item.querySelector('input:not([type="hidden"])') || item.querySelector('textarea');
    if (input) return read(input);
  }
  // Pass 2: visible input matching placeholder (or fuzzy label in placeholder)
  for (const inp of document.querySelectorAll('input:not([type="hidden"]), textarea')) {
    if (!isVis(inp) || inp.disabled || inp.readOnly) continue;
    if (inp.closest('.el-date-editor, .tsscdatepicker')) continue;
    const ph = inp.getAttribute('placeholder') || '';
    if (!ph) continue;
    if ((phWant && ph.includes(phWant)) || (want && ph.includes(want))) return read(inp);
  }
  return '';
}'''


# Click / focus a control resolved by xpath (returns ok-xpath-smart when found).
_JS_LOCATE_BY_XPATH = r'''([xpath]) => {
  if (!xpath) return 'xpath-empty';
  const isVis = (el) => {
    if (!el || el.nodeType !== 1) return false;
    if (el.offsetParent === null && !el.closest('.el-table__fixed')) return false;
    const st = getComputedStyle(el);
    return st.display !== 'none' && st.visibility !== 'hidden';
  };
  const wrapVisible = (d) => {
    if (!d) return false;
    const wrap = d.closest && d.closest('.el-dialog__wrapper, .el-message-box__wrapper, .el-drawer__wrapper');
    if (wrap && getComputedStyle(wrap).display === 'none') return false;
    return isVis(d) || (wrap && isVis(wrap));
  };
  const lastVisibleHost = (drawer) => {
    const sel = drawer ? '.el-drawer' : '.el-dialog, .el-message-box';
    const all = [...document.querySelectorAll(sel)];
    for (let i = all.length - 1; i >= 0; i--) {
      if (wrapVisible(all[i])) return all[i];
    }
    return null;
  };
  const tryXp = (xp, root) => {
    let s = String(xp || '');
    if (!s) return false;
    try {
      const ctx = root || document;
      if (root && s.startsWith('//')) s = '.' + s;
      const snap = document.evaluate(s, ctx, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
      for (let i = snap.snapshotLength - 1; i >= 0; i--) {
        const n = snap.snapshotItem(i);
        if (n && isVis(n)) return true;
      }
    } catch (e) { /* ignore */ }
    return false;
  };
  if (tryXp(xpath, null)) return 'ok-xpath-smart';
  if (/el-dialog|el-message-box|el-drawer/.test(xpath) && /\[last\(\)\]/.test(xpath)) {
    const m = String(xpath).match(/\[last\(\)\](?:\/\/(.+))?$/);
    const local = m && m[1] ? m[1] : '';
    const dlg = /el-drawer/.test(xpath) ? lastVisibleHost(true) : lastVisibleHost(false);
    if (dlg && local && tryXp('.//' + local, dlg)) return 'ok-xpath-smart-vis-dlg';
  }
  return 'xpath-not-found';
}'''


# Count visible el-dialog / el-drawer / el-message-box overlays (idempotent close_dialog).
JS_COUNT_OVERLAYS = '''() => {
                            const isVis = (el) => {
                                if (el.offsetParent !== null) return true;
                                const st = getComputedStyle(el);
                                if (st.display === 'none' || st.visibility === 'hidden') return false;
                                const r = el.getBoundingClientRect();
                                return r.width > 0 && r.height > 0;
                            };
                            const d = [...document.querySelectorAll('.el-dialog')].filter(isVis).length;
                            const w = [...document.querySelectorAll('.el-drawer')].filter(isVis).length;
                            const m = [...document.querySelectorAll('.el-message-box')].filter(isVis).length;
                            return d + w + m;
                        }'''
