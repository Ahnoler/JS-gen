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
  if (window.__jsgenManualInstalled) {
    window.__jsgenManualEnabled = true;
    return 'already';
  }
  window.__jsgenManualInstalled = true;
  window.__jsgenManualEnabled = true;

  const PREFIX = '__JSGEN_MANUAL__';
  let lastSig = '';
  let lastTs = 0;

  function emit(payload) {
    if (!window.__jsgenManualEnabled) return;
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

  function visibleText(el) {
    if (!el) return '';
    return (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 80);
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
    const meta = {
      xpath: bu || abs,
      bu_xpath: bu,
      xpath_abs: abs,
      tag: (el.tagName || '').toLowerCase(),
      attributes: attrs(el),
      text: t,
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

  // --- clicks ---
  document.addEventListener('click', (ev) => {
    if (!window.__jsgenManualEnabled) return;
    let el = ev.target;
    if (!el) return;
    if (el.nodeType !== 1) el = el.parentElement;
    if (!el || !el.closest) return;

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
      const row = rowBtn.closest('tr');
      const rowText = row ? visibleText(row).slice(0, 40) : '';
      const buttonText = visibleText(rowBtn);
      emit(Object.assign({
        kind: 'click_table_row_button',
        row_text: rowText,
        button_text: buttonText,
      }, elMeta(rowBtn, buttonText)));
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
      const text = shortLabel(btn) || (btn.getAttribute && (btn.getAttribute('aria-label') || btn.getAttribute('title'))) || '';
      emit(Object.assign({ kind: 'click' }, elMeta(btn, text)));
      return;
    }

    // tree node
    const tree = el.closest('.el-tree-node__content');
    if (tree) {
      emit(Object.assign({ kind: 'click' }, elMeta(tree)));
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
  }, true);

  // --- input / change (form fields) ---
  function emitFill(el) {
    if (!window.__jsgenManualEnabled) return;
    if (!el || isInIgnore(el)) return;
    if (el.type === 'hidden' || el.type === 'password' && false) { /* allow password */ }
    const tag = (el.tagName || '').toLowerCase();
    if (tag !== 'input' && tag !== 'textarea') return;
    if (el.closest('.el-select')) return; // select handled via option click
    const label = formItemLabel(el);
    const value = el.value || '';
    const kind = el.closest('.el-date-editor') ? 'fill_date' : 'fill';
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

  document.addEventListener('change', (ev) => {
    const el = ev.target;
    if (el && el.matches && el.matches('input, textarea')) emitFill(el);
  }, true);

  document.addEventListener('blur', (ev) => {
    const el = ev.target;
    if (el && el.matches && el.matches('input, textarea')) emitFill(el);
  }, true);

  return 'installed';
})()'''


def _map_dom_event_to_action(payload: dict) -> Optional[tuple[str, dict, Optional[dict]]]:
    """
    Map a DOM event payload to (action_name, params, element_info).
    Returns None if the event should be ignored.

    Manual click_element_by_index always uses index=-1; locate via xpath/text.
    """
    kind = (payload.get('kind') or '').strip()
    attrs = payload.get('attributes') or {}
    text = payload.get('text') or attrs.get('title') or ''
    element = {
        # Prefer bu_xpath for assembler (same shape as agent recordings)
        'xpath': payload.get('bu_xpath') or payload.get('xpath') or '',
        'bu_xpath': payload.get('bu_xpath') or '',
        'xpath_abs': payload.get('xpath_abs') or payload.get('xpath') or '',
        'tag_name': payload.get('tag') or '',
        'css_selector': '',
        'attributes': attrs,
        'text': text,
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
        value = payload.get('value') or ''
        if not label:
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
            await page.evaluate('() => { window.__jsgenManualEnabled = true; }')
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
