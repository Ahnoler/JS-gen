"""
JS snippet constants: _JS_ICON_BUTTON_HELPERS, JS_STAMP_ICON_ARIA_LABELS, JS_COLLECT_ICON_BUTTONS, JS_CLICK_ICON_BUTTON (extracted from _js_snippets.py).
Re-exported by scripts/controller/actions/_js_snippets.py for backward compat.
"""

_JS_ICON_BUTTON_HELPERS = r'''
function _iconNormText(s) { return (s || '').replace(/\s+/g, ' ').trim(); }
function _iconShortLabel(text) {
  const t = _iconNormText(text);
  // Icon tooltips are short labels (e.g. 「新增一级分类」); reject menu dumps.
  if (!t || t.length > 40 || t.split(/\s+/).length > 6) return '';
  return t;
}
function _iconHasIconClass(el) {
  const cls = typeof el.className === 'string' ? el.className : '';
  if (/(?:^|\s)el-icon-[\w-]+/.test(cls) || /(?:^|\s)el-icon(?:\s|$)/.test(cls)) return true;
  return !!el.querySelector('[class*="el-icon-"], i[class*="icon"]');
}
function _iconIsExcludedHost(el) {
  const cls = typeof el.className === 'string' ? el.className : '';
  if (/(?:^|\s)el-popover__reference(?:\s|$)/.test(cls)) return true;
  if (/(?:^|\s)el-dropdown(?:\s|$)/.test(cls)) return true;
  if (/(?:^|\s)el-submenu(?:\s|$)/.test(cls)) return true;
  if (/(?:^|\s)el-menu-item(?:\s|$)/.test(cls)) return true;
  if (/(?:^|\s)header__action-item(?:\s|$)/.test(cls)) return true;
  if (el.closest('.el-menu, .el-submenu, .el-dropdown-menu, .el-select-dropdown, .el-pagination')) return true;
  // Real icon buttons are textless (or nearly); hosts with own body text are menus/search.
  const own = _iconNormText(el.innerText || '');
  if (own.length > 8) return true;
  return false;
}
function _iconTooltipEl(el) {
  const id = el.getAttribute('aria-describedby');
  if (!id) return null;
  const tip = document.getElementById(id);
  if (!tip) return null;
  // Only accept Element UI tooltip poppers — not popover/menu panels.
  const role = (tip.getAttribute('role') || '').toLowerCase();
  const tipCls = typeof tip.className === 'string' ? tip.className : '';
  if (role === 'tooltip' || /(?:^|\s)el-tooltip__popper(?:\s|$)/.test(tipCls)) return tip;
  return null;
}
function _iconTooltipText(el) {
  const tip = _iconTooltipEl(el);
  if (!tip) return '';
  const clone = tip.cloneNode(true);
  clone.querySelectorAll('.popper__arrow,[x-arrow]').forEach(n => n.remove());
  return _iconShortLabel(clone.textContent);
}
function _iconVueContent(el) {
  // Element UI ElTooltip keeps `content` on the Vue instance even before first
  // hover (aria-describedby / popper may be absent until then).
  try {
    let cur = el;
    for (let i = 0; i < 3 && cur; i++) {
      const v = cur.__vue__;
      if (v) {
        const raw = (v.content != null) ? v.content
          : (v.$props && v.$props.content != null ? v.$props.content : null);
        const short = _iconShortLabel(typeof raw === 'string' ? raw : '');
        if (short) return short;
      }
      cur = cur.parentElement;
    }
  } catch (e) {}
  return '';
}
function _iconResolveLabel(el) {
  const fromAttr = _iconShortLabel(el.getAttribute('aria-label'))
    || _iconShortLabel(el.getAttribute('title'));
  if (fromAttr) return fromAttr;
  return _iconTooltipText(el) || _iconVueContent(el);
}
function _iconCandidates(root) {
  // Include el-tooltip+el-icon hosts even without aria-describedby (pre-hover).
  const sel = [
    '[aria-describedby][class*="el-icon"]',
    '[aria-describedby].el-tooltip',
    '.el-tooltip[class*="el-icon"]',
  ].join(', ');
  const out = [];
  const seen = new Set();
  for (const el of (root || document).querySelectorAll(sel)) {
    if (seen.has(el)) continue;
    seen.add(el);
    if (!_iconHasIconClass(el)) continue;
    if (_iconIsExcludedHost(el)) continue;
    out.push(el);
  }
  return out;
}
function _iconIsVisible(el) {
  return el.offsetParent !== null || !!el.closest('.el-table__fixed');
}
'''


JS_STAMP_ICON_ARIA_LABELS = r'''() => {
''' + _JS_ICON_BUTTON_HELPERS + r'''
  let n = 0;
  for (const el of _iconCandidates(document)) {
    const existing = _iconShortLabel(el.getAttribute('aria-label'))
      || _iconShortLabel(el.getAttribute('title'));
    if (existing) continue;
    const tip = _iconResolveLabel(el);
    if (!tip) continue;
    el.setAttribute('aria-label', tip);
    n++;
  }
  return n;
}'''

# Page toolbars (tree action icons etc.) live outside dialogs — always scan document.

JS_COLLECT_ICON_BUTTONS = r'''() => {
''' + _JS_ICON_BUTTON_HELPERS + r'''
  const iconButtons = [];
  const seen = new Set();
  for (const el of _iconCandidates(document)) {
    if (!_iconIsVisible(el)) continue;
    const text = _iconResolveLabel(el);
    if (!text) continue;
    const className = typeof el.className === 'string' ? el.className : '';
    const key = text + '|' + className;
    if (seen.has(key)) continue;
    seen.add(key);
    iconButtons.push({ text, className });
  }
  return iconButtons;
}'''


JS_CLICK_ICON_BUTTON = r'''(buttonText) => {
''' + _JS_ICON_BUTTON_HELPERS + r'''
  if (!buttonText) return 'button-text-empty';
  // ══ KB-I5 run5: 精确文本优先（原为 icon 宿主优先、文本兜底）══
  // 意见页「流程提交」「下一步」等是普通可见文本按钮——先在 button/文本元素中
  // 找归一化 innerText === 目标的元素（同文本取最内层 = document 顺序最后一个），
  // 命中即点；未命中再走 icon 宿主 → 包含式文本兜底（原路径，顺序后移）。
  const want0 = _iconNormText(buttonText);
  const isOverlay = (el) => !!el.closest('.el-dialog, .el-drawer, .el-message-box');
  const exact = [];
  const seenExact = new Set();
  for (const b of document.querySelectorAll(
      'button, .el-button, a, [role="button"], span, div')) {
    if (!_iconIsVisible(b)) continue;
    if (b.closest('.el-table__body-wrapper')) continue;
    const t = _iconNormText(b.innerText || b.textContent);
    if (!t || t.length > 40 || t !== want0) continue;
    const cls = typeof b.className === 'string' ? b.className.slice(0, 60) : '';
    const key = t + '|' + cls + '|' + b.tagName;
    if (seenExact.has(key)) continue;
    seenExact.add(key);
    exact.push({ el: b, text: t });
    if (exact.length >= 24) break;
  }
  if (exact.length) {
    // document order: ancestors precede descendants → last = innermost.
    const m = exact[exact.length - 1];
    m.el.scrollIntoView({ block: 'center', behavior: 'instant' });
    m.el.click();
    return 'ok-text:' + m.text;
  }
  for (const el of _iconCandidates(document)) {
    if (!_iconIsVisible(el)) continue;
    const label = _iconResolveLabel(el);
    if (label === buttonText || (label && label.includes(buttonText))) {
      el.scrollIntoView({ block: 'center', behavior: 'instant' });
      el.click();
      return 'ok';
    }
  }
  // Generalized fallback: click a visible PLAIN text button sharing the label.
  // Toolbar buttons like 查询/修改/新增 are ordinary <button>s, not tooltip
  // icons — after an icon miss, clicking them here succeeds in one step
  // instead of looping the agent through retries (2026-08-27 toolbar incident).
  const want = _iconNormText(buttonText);
  const seenB = new Set();
  const matches = [];
  for (const b of document.querySelectorAll('button, .el-button, a')) {
    if (!_iconIsVisible(b)) continue;
    if (b.closest('.el-table__body-wrapper')) continue; // row affordances → table tools
    const t = _iconNormText(b.innerText || b.textContent);
    if (!t || t.length > 40) continue;
    let hit = false;
    if (t === want) hit = true;
    else if (want && t.includes(want) && !want.includes(t)) hit = true;
    if (!hit) continue;
    const cls = typeof b.className === 'string' ? b.className.slice(0, 60) : '';
    const key = t + '|' + cls;
    if (seenB.has(key)) continue;
    seenB.add(key);
    matches.push({ el: b, text: t });
    if (matches.length >= 8) break;
  }
  if (matches.length) {
    // Prefer exact-label over contains; page-level (non-overlay) over overlay,
    // so a named toolbar button wins while a dialog is open.
    let pool = matches.filter((m) => m.text === want);
    if (pool.length === 0) {
      pool = matches.filter((m) => !want.includes(m.text));
    }
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
}'''

# Lightweight page snapshot for scenario describer (no iconButtons / no side effects).
