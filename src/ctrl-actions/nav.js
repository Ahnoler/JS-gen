/**
 * CTRL_OBJECT part: clickMenuItem / closeDialog / checkFieldValue / clickAdjacentButton / clickIconButton.
 * Concatenated with sibling parts into CTRL_OBJECT in index.js —
 * do not change indentation, braces, or the trailing comma; the
 * assembled string must stay byte-identical (characterize-ctrl.mjs).
 */
export const CTRL_PART_NAV = `  clickMenuItem: (text) => {
    const d = [...document.querySelectorAll('.el-menu-item')].find(el => el.textContent.trim()===text && el.offsetParent!==null);
    if (d) { d.scrollIntoView({ block: 'center', behavior: 'instant' }); d.click(); return 'ok'; }
    for (const sm of document.querySelectorAll('.el-submenu')) {
      if ([...sm.querySelectorAll('.el-menu-item')].some(i => i.textContent.trim()===text)) {
        if (!sm.classList.contains('is-opened')) sm.querySelector('.el-submenu__title')?.click();
        setTimeout(() => { const t = [...sm.querySelectorAll('.el-menu-item')].find(i => i.textContent.trim()===text); if (t) { t.scrollIntoView({ block: 'center', behavior: 'instant' }); t.click(); } }, 300);
        return 'ok-expanded';
      }
    }
    return 'not-found';
  },
  closeDialog: () => {
    const n = document.querySelector('.el-notification');
    if (n && n.offsetParent!==null) { n.scrollIntoView({ block: 'center', behavior: 'instant' }); const cb = n.querySelector('.el-notification__closeBtn'); if (cb) cb.click(); return 'ok-notification'; }
    for (const d of [...document.querySelectorAll('.el-dialog')].reverse()) {
      if (d.offsetParent!==null) { d.scrollIntoView({ block: 'center', behavior: 'instant' }); const cb = d.querySelector('.el-dialog__headerbtn .el-dialog__close,.el-dialog__headerbtn .el-icon-close'); if (cb) { cb.click(); return 'ok'; } const cb2 = d.querySelector('.el-dialog__footer .el-button--default'); if (cb2) { cb2.click(); return 'ok-cancel'; } return 'no-close-button'; }
    }
    for (const d of [...document.querySelectorAll('.el-drawer')].reverse()) { if (d.offsetParent!==null) { d.scrollIntoView({ block: 'center', behavior: 'instant' }); const cb = d.querySelector('.el-drawer__close-btn,.el-drawer__header .el-icon-close'); if (cb) { cb.click(); return 'ok'; } return 'no-close-button'; } }
    return 'no-overlay-open';
  },
  checkFieldValue: (label) => {
    for (const item of CTRL.getContainer().querySelectorAll('.el-form-item')) {
      const lbl = item.querySelector('.el-form-item__label');
      if (!lbl || !lbl.textContent.trim().includes(label)) continue;
      item.scrollIntoView({ block: 'center', behavior: 'instant' });
      const input = item.querySelector('input:not([type="hidden"]),textarea,.el-select .el-input__inner');
      if (!input) return 'no-input';
      return (input.value||'').trim() || 'empty';
    }
    return 'label-not-found';
  },
  clickAdjacentButton: (label) => {
    for (const item of CTRL.getContainer().querySelectorAll('.el-form-item')) {
      if (!(item.querySelector('.el-form-item__label')?.textContent?.trim()||'').includes(label)) continue;
      item.scrollIntoView({ block: 'center', behavior: 'instant' });
      const input = item.querySelector('.el-input__inner');
      if (input && input.value && input.value.trim()!=='') return 'already-filled';
      const btn = item.querySelector('button.el-button--primary.is-plain,button.el-button--primary');
      if (btn && btn.offsetParent!==null) { btn.click(); return 'ok-clicked'; }
      return 'no-button-found';
    }
    return 'label-not-found';
  },
  clickIconButton: (buttonText) => {
    if (!buttonText) return 'button-text-empty';
    const norm = (s) => (s || '').replace(/\\s+/g, ' ').trim();
    const shortLabel = (text) => {
      const t = norm(text);
      if (!t || t.length > 40 || t.split(/\\s+/).length > 6) return '';
      return t;
    };
    const hasIconClass = (el) => {
      const cls = typeof el.className === 'string' ? el.className : '';
      if (/(?:^|\\s)el-icon-[\\w-]+/.test(cls) || /(?:^|\\s)el-icon(?:\\s|$)/.test(cls)) return true;
      return !!el.querySelector('[class*=\"el-icon-\"], i[class*=\"icon\"]');
    };
    const isExcluded = (el) => {
      const cls = typeof el.className === 'string' ? el.className : '';
      if (/(?:^|\\s)el-popover__reference(?:\\s|$)/.test(cls)) return true;
      if (/(?:^|\\s)el-dropdown(?:\\s|$)/.test(cls)) return true;
      if (/(?:^|\\s)el-submenu(?:\\s|$)/.test(cls)) return true;
      if (/(?:^|\\s)el-menu-item(?:\\s|$)/.test(cls)) return true;
      if (/(?:^|\\s)header__action-item(?:\\s|$)/.test(cls)) return true;
      if (el.closest('.el-menu, .el-submenu, .el-dropdown-menu, .el-select-dropdown, .el-pagination')) return true;
      return norm(el.innerText || '').length > 8;
    };
    const tipEl = (el) => {
      const id = el.getAttribute('aria-describedby');
      if (!id) return null;
      const tip = document.getElementById(id);
      if (!tip) return null;
      const role = (tip.getAttribute('role') || '').toLowerCase();
      const tipCls = typeof tip.className === 'string' ? tip.className : '';
      if (role === 'tooltip' || /(?:^|\\s)el-tooltip__popper(?:\\s|$)/.test(tipCls)) return tip;
      return null;
    };
    const tipText = (el) => {
      const tip = tipEl(el);
      if (!tip) return '';
      const clone = tip.cloneNode(true);
      clone.querySelectorAll('.popper__arrow,[x-arrow]').forEach(n => n.remove());
      return shortLabel(clone.textContent);
    };
    const vueContent = (el) => {
      try {
        let cur = el;
        for (let i = 0; i < 3 && cur; i++) {
          const v = cur.__vue__;
          if (v) {
            const raw = (v.content != null) ? v.content
              : (v.$props && v.$props.content != null ? v.$props.content : null);
            const short = shortLabel(typeof raw === 'string' ? raw : '');
            if (short) return short;
          }
          cur = cur.parentElement;
        }
      } catch (e) {}
      return '';
    };
    const resolveLabel = (el) => {
      const fromAttr = shortLabel(el.getAttribute('aria-label')) || shortLabel(el.getAttribute('title'));
      if (fromAttr) return fromAttr;
      return tipText(el) || vueContent(el);
    };
    // Page toolbars sit outside dialogs — scan document, not getContainer().
    const sel = '[aria-describedby][class*=\"el-icon\"], [aria-describedby].el-tooltip, .el-tooltip[class*=\"el-icon\"]';
    const seen = new Set();
    for (const el of document.querySelectorAll(sel)) {
      if (seen.has(el)) continue;
      seen.add(el);
      if (el.offsetParent === null && !el.closest('.el-table__fixed')) continue;
      if (!hasIconClass(el) || isExcluded(el)) continue;
      const label = resolveLabel(el);
      if (label === buttonText || (label && label.includes(buttonText))) {
        el.scrollIntoView({ block: 'center', behavior: 'instant' });
        el.click();
        return 'ok';
      }
    }
    // Generalized fallback: click a visible plain text button sharing the label
    // (toolbar buttons like 查询/修改 are ordinary <button>s, not tooltip icons).
    const want = norm(buttonText);
    const isOverlay = (el) => !!el.closest('.el-dialog, .el-drawer, .el-message-box');
    const seenB = new Set();
    const matches = [];
    for (const b of document.querySelectorAll('button,.el-button,a')) {
      if (b.offsetParent === null && !b.closest('.el-table__fixed')) continue;
      if (b.closest('.el-table__body-wrapper')) continue;
      const t = norm(b.innerText || b.textContent);
      if (!t || t.length > 40) continue;
      let hit = false;
      if (t === want) hit = true;
      else if (want && t.includes(want) && !want.includes(t)) hit = true;
      if (!hit) continue;
      const key = t + '|' + (typeof b.className === 'string' ? b.className.slice(0,60) : '');
      if (seenB.has(key)) continue;
      seenB.add(key);
      matches.push({ el: b, text: t });
      if (matches.length >= 8) break;
    }
    if (matches.length) {
      let pool = matches.filter((m) => m.text === want);
      if (pool.length === 0) pool = matches.filter((m) => !want.includes(m.text));
      if (pool.length === 0) pool = matches;
      const pageLevel = pool.filter((m) => !isOverlay(m.el));
      if (pageLevel.length >= 1) pool = pageLevel;
      if (pool.length === 1) {
        const m = pool[0];
        m.el.scrollIntoView({ block: 'center', behavior: 'instant' });
        m.el.click();
        return 'ok-text:' + m.text;
      }
      return 'err-icon-label-ambiguous:' + JSON.stringify({
        wanted: buttonText,
        reason: 'ambiguous',
        textButtons: pool.map((m) => ({ text: m.text, tag: m.el.tagName.toLowerCase() })),
      });
    }
    return 'err-icon-label-miss';
  },
`;
