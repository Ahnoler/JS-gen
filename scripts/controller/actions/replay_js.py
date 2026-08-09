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
    const nodes = evalXpathAll(xp, root).filter(isVisible);
    if (!nodes.length) return null;
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

    const sel = 'button, a, .el-button, .el-menu-item, .el-submenu__title, [role="menuitem"], .el-tabs__item, li.menu-item, .menu-item, .el-tree-node__content, .plugin-nav-list, .plugin-nav-outer, .nav-content';
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



_JS_READ_VALUE_BY_XPATH = r'''([xpath]) => {
  if (!xpath) return '';
  const isVis = (el) => {
    if (!el || el.nodeType !== 1) return false;
    if (el.offsetParent === null && !el.closest('.el-table__fixed')) return false;
    const st = getComputedStyle(el);
    return st.display !== 'none' && st.visibility !== 'hidden';
  };
  const findNode = (xp, root) => {
    try {
      let s = String(xp || '');
      if (!s) return null;
      const ctx = root || document;
      if (root && s.startsWith('//')) s = '.' + s;
      const snap = document.evaluate(s, ctx, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
      for (let i = snap.snapshotLength - 1; i >= 0; i--) {
        const n = snap.snapshotItem(i);
        if (n && isVis(n)) return n;
      }
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
  const node = findNode(xpath, null);
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
      const scoped = findNode('.//' + local, dlg);
      if (scoped) return readControl(scoped);
    }
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
