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
function _isMoreLabel(text) {
  const t = _iconNormText(text);
  return t === '更多' || t === '展开' || t === '展开更多' || t === '更多条件'
    || t === '更多筛选' || t === '高级筛选' || t === '高级查询';
}
function _moreToggleLabelHit(el) {
  const lbl = _iconResolveLabel(el)
    || _iconShortLabel(el.getAttribute('aria-label'))
    || _iconShortLabel(el.getAttribute('title'))
    || '';
  return /更多|展开|高级/.test(lbl);
}
function _moreToggleExpanded(el) {
  // Real SUT toggle: <span class="tsscBtn more-btn"> > button.el-button > i.el-icon-caret-*.
  // 未展开 = caret/arrow DOWN，已展开 = caret/arrow UP（再点会收起，必须避免）。
  const icons = el.querySelectorAll('i[class*="el-icon-"]');
  for (const i of icons) {
    const cls = typeof i.className === 'string' ? i.className : '';
    if (/el-icon-caret-top|el-icon-arrow-up|el-icon-d-arrow-up/.test(cls)) return true;
    if (/el-icon-caret-bottom|el-icon-arrow-down|el-icon-d-arrow-down/.test(cls)) return false;
  }
  return false; // unknown direction → treat as collapsed (allow the try)
}
function _moreToggleInQueryBar(btn) {
  // Scope hint: an ancestor that also holds 查询/搜索/重置 toggles = query toolbar.
  let node = btn.parentElement;
  for (let i = 0; i < 5 && node; i++) {
    for (const b of node.querySelectorAll('button, .el-button, a')) {
      const t = _iconNormText(b.innerText || '');
      if (t === '查询' || t === '搜索' || t === '重置') return true;
    }
    node = node.parentElement;
  }
  return false;
}
function _moreToggleCandidates(root) {
  // 「更多/展开」常是纯图标按钮（无文字/无 tooltip，如 <span class="tsscBtn more-btn">
  // 内嵌 el-button + caret 图标）。仅在文本/图标标签都未命中时用于兜底。
  const scope = root || document;
  const out = [];
  const seen = new Set();
  const push = (el) => {
    if (!el || seen.has(el) || !_iconIsVisible(el)) return;
    if (el.closest('.el-table__body-wrapper')) return; // row affordances → table tools
    seen.add(el); out.push(el);
  };
  // 1) explicit class signal (e.g. tsscBtn more-btn)
  for (const host of scope.querySelectorAll(
      '[class*="more-btn"], [class*="moreBtn"], [class*="more_btn"],'
      + ' [class*="more-filter"], [class*="moreFilter"]')) {
    if (host.matches('button, .el-button, a, [role="button"]')) { push(host); continue; }
    push(host.querySelector('button, .el-button, a, [role="button"]'));
  }
  if (out.length) return out;
  // 2) tooltip/aria/title label carries 更多/展开/高级
  for (const b of scope.querySelectorAll('button, .el-button, a, [role="button"]')) {
    if (_iconIsVisible(b) && _moreToggleLabelHit(b)) push(b);
  }
  if (out.length) return out;
  // 3) textless caret-only button sitting in the query toolbar (查询/搜索/重置 siblings)
  for (const b of scope.querySelectorAll('button, .el-button')) {
    if (!_iconIsVisible(b) || !_moreToggleInQueryBar(b)) continue;
    if (_iconNormText(b.innerText || '').length > 2) continue;
    if (!b.querySelector('i[class*="el-icon-caret-"], i[class*="el-icon-arrow-"],'
        + ' i[class*="el-icon-d-arrow-"]')) continue;
    push(b);
  }
  return out;
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
  // 更多/展开 开关常为纯图标按钮（无文字/无 tooltip）——文本与图标标签都未命中时，
  // 在查询区内按启发式点开（尽力尝试，非必须；歧义时返回候选数不盲点）。
  if (_isMoreLabel(want0)) {
    const cands = _moreToggleCandidates(document);
    // 只点「未展开」的（caret/arrow down）；已展开的再点会收起、反而隐藏字段。
    const collapsed = cands.filter((el) => !_moreToggleExpanded(el));
    if (collapsed.length === 1) {
      const el = collapsed[0];
      el.scrollIntoView({ block: 'center', behavior: 'instant' });
      el.click();
      const cls = typeof el.className === 'string' ? el.className.slice(0, 60) : '';
      return 'ok-more-toggle:' + cls;
    }
    if (collapsed.length > 1) {
      return 'err-more-toggle-ambiguous:' + JSON.stringify({
        wanted: buttonText,
        reason: 'ambiguous',
        count: collapsed.length,
      });
    }
    if (cands.length) {
      // 命中的「更多」开关都已是展开态 → 目标字段本应可见，不要再点（会收起）。
      return 'err-more-toggle-already-expanded';
    }
  }
  return 'err-icon-label-miss';
}'''

# Lightweight page snapshot for scenario describer (no iconButtons / no side effects).
