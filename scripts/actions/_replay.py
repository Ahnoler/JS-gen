"""
Sequential action replay — mirrors auto-fill orchestration in `_form.py`.

Key lessons from `_auto_fill_pending` / `_execute_round`:
  1. Execute one recorded action at a time (no scan/auto-fill side effects).
  2. Form ops use the same JS snippets as auto-fill (fill / select / date / tree / radio).
  3. Between steps: `_wait_if_loading` + short timeout (300ms input / 500ms select),
     never Playwright `networkidle` as the sole gate (SPA keep-alives hang forever).
  4. After 保存/提交: wait for **page idle** (loading masks / button spinners / in-flight
     xhr|fetch quiet) — not tree-specific. SPA often clears panels while APIs reload.
  5. After el-tree node click: wait until the right-side edit form input is visible
     before the next fill step.

For click_element_by_index: highlight `index` is ephemeral — relocate by
xpath_smart / drawer-dialog text / xpath (same idea as script_assembler).
"""

from __future__ import annotations

import asyncio
import inspect
import json
import re
import sys
import time

from ._helpers import (
    _wait_if_loading,
    _is_ok_result,
)
from ._js_snippets import (
    JS_CHECK_LOADING,
    JS_FILL_FORM_FIELD,
    JS_FILL_DATE_FIELD,
    JS_FIND_LABELED_SELECT,
    JS_SELECT_OPTION,
    JS_SELECT_TREE_OPTION,
    JS_CLICK_RADIO,
    JS_VERIFY_FORM_STRUCTURE,
)
from scripts.feature_flags import relative_xpath_primary_enabled

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

_SAVE_BUTTON_TEXTS = frozenset({'保存', '提交'})


def _is_save_click_text(text: str) -> bool:
    t = re.sub(r'\s+', '', str(text or '').strip())
    return t in _SAVE_BUTTON_TEXTS


def _is_tree_node_entry(entry: dict | None, xpath_smart: str = '', xpath: str = '') -> bool:
    el = entry.get('element') if isinstance(entry, dict) and isinstance(entry.get('element'), dict) else {}
    if str(el.get('target_kind') or '') == 'tree_node':
        return True
    blob = ' '.join(
        str(x or '')
        for x in (
            xpath_smart,
            xpath,
            el.get('xpath_smart'),
            el.get('xpath'),
            el.get('cssSelector'),
            (el.get('attributes') or {}).get('class') if isinstance(el.get('attributes'), dict) else '',
        )
    )
    return 'el-tree-node__content' in blob or 'el-tree-node__label' in blob


def _is_trackable_request(request) -> bool:
    """XHR/fetch only — skip documents/assets; keep-alives are handled via soft timeout."""
    try:
        return request.resource_type in ('xhr', 'fetch')
    except Exception:
        return False


async def _wait_after_save_page_idle(
    page,
    *,
    timeout_ms: int = 10000,
    quiet_ms: int = 500,
) -> None:
    """After 保存/提交: wait until the page looks idle (DOM busy cues + xhr/fetch quiet).

    Broader than tree-reload detection: any save-triggered list/form/dialog refresh.
    Soft-exits if DOM is idle but a long-lived request never finishes (SPA poll).
    """
    inflight: set = set()

    def _on_request(req):
        if _is_trackable_request(req):
            inflight.add(req)

    def _on_done(req):
        inflight.discard(req)

    page.on('request', _on_request)
    page.on('requestfinished', _on_done)
    page.on('requestfailed', _on_done)
    try:
        # Let save XHR / loading mask have a moment to appear.
        await page.wait_for_timeout(200)
        await _wait_if_loading(page)

        deadline = time.monotonic() + timeout_ms / 1000.0
        quiet_since: float | None = None
        dom_idle_since: float | None = None

        while time.monotonic() < deadline:
            try:
                busy = str(await page.evaluate(_JS_PAGE_BUSY) or '')
            except Exception:
                busy = ''
            try:
                loading_mask = bool(await page.evaluate(JS_CHECK_LOADING))
            except Exception:
                loading_mask = False
            if loading_mask and not busy:
                busy = 'mask'

            net_busy = len(inflight) > 0

            if busy:
                if loading_mask or busy == 'mask':
                    await _wait_if_loading(page)
                quiet_since = None
                dom_idle_since = None
                await page.wait_for_timeout(100)
                continue

            # DOM idle
            now = time.monotonic()
            if dom_idle_since is None:
                dom_idle_since = now

            if net_busy:
                # Soft: if DOM stayed idle long enough, don't hang on keep-alive/poll.
                if (now - dom_idle_since) >= max(quiet_ms / 1000.0, 0.8) * 3:
                    break
                quiet_since = None
                await page.wait_for_timeout(100)
                continue

            if quiet_since is None:
                quiet_since = now
            elif (now - quiet_since) >= quiet_ms / 1000.0:
                break

            await page.wait_for_timeout(100)

        await page.wait_for_timeout(120)
        await _wait_if_loading(page)
    finally:
        try:
            page.remove_listener('request', _on_request)
            page.remove_listener('requestfinished', _on_done)
            page.remove_listener('requestfailed', _on_done)
        except Exception:
            pass


async def _wait_after_tree_node_for_form(page, *, timeout_ms: int = 5000) -> bool:
    """After tree node click: wait until right-side edit form input is visible.

    Soft wait — returns False on timeout without failing the click itself.
    """
    await _wait_if_loading(page)
    deadline = time.monotonic() + timeout_ms / 1000.0
    while time.monotonic() < deadline:
        try:
            if await page.evaluate(_JS_EDIT_FORM_INPUT_VISIBLE):
                await page.wait_for_timeout(120)
                return True
        except Exception:
            pass
        try:
            if await page.evaluate(JS_CHECK_LOADING):
                await _wait_if_loading(page)
        except Exception:
            pass
        await page.wait_for_timeout(100)
    return False

# Fill an input/textarea resolved by relative xpath (native setter for Element UI).
_JS_FILL_BY_XPATH = r'''([xpath, val]) => {
  if (!xpath) return 'xpath-empty';
  let snap;
  try {
    snap = document.evaluate(xpath, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
  } catch (e) {
    return 'xpath-invalid';
  }
  const setFn = (t, v) => {
    const TagProto = t.tagName === 'TEXTAREA' ? HTMLTextAreaElement : HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(TagProto.prototype, 'value').set;
    setter.call(t, v);
    t.setAttribute('value', v);
    t.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: v }));
    t.dispatchEvent(new Event('change', { bubbles: true }));
    t.dispatchEvent(new Event('blur', { bubbles: true }));
  };
  const isVis = (el) => {
    if (!el || el.nodeType !== 1) return false;
    if (el.offsetParent === null && !el.closest('.el-table__fixed')) return false;
    const st = getComputedStyle(el);
    return st.display !== 'none' && st.visibility !== 'hidden';
  };
  let target = null;
  for (let i = snap.snapshotLength - 1; i >= 0; i--) {
    const n = snap.snapshotItem(i);
    if (!n || !isVis(n)) continue;
    // If xpath hit el-select / date wrapper, prefer inner input.
    const inner = (n.matches && (n.matches('input, textarea') ? n : null))
      || n.querySelector?.('input:not([type="hidden"]), textarea');
    target = inner || n;
    break;
  }
  if (!target) return 'xpath-not-found';
  if (target.disabled || target.readOnly) return 'field-disabled';
  if (target.tagName !== 'INPUT' && target.tagName !== 'TEXTAREA') return 'xpath-not-input';
  setFn(target, val == null ? '' : String(val));
  return 'ok-xpath-smart';
}'''


# Form actions that auto-fill owns — replay via JS, not controller (avoids _ensure_scanned).
_FORM_ACTIONS = {
    'fill_form_field',
    'fill_date_field',
    'select_option',
    'select_tree_option',
    'click_radio',
}

# Historical / LLM / CTRL aliases → canonical controller action names
_ACTION_NAME_ALIASES = {
    'treeSelect': 'select_tree_option',
    'selectTreeOption': 'select_tree_option',
    'tree_select': 'select_tree_option',
    'treeselect': 'select_tree_option',
    'fill_tree': 'select_tree_option',
    'fillTree': 'select_tree_option',
    'fillFormField': 'fill_form_field',
    'fillDateField': 'fill_date_field',
    'selectOption': 'select_option',
    'clickRadio': 'click_radio',
    'clickMenuItem': 'click_menu_item',
    'clickTableRowButton': 'click_table_row_button',
    'clickTableRowRadio': 'click_table_row_radio',
    'clickAdjacentButton': 'click_adjacent_button',
    'clickIconButton': 'click_icon_button',
    'closeDialog': 'close_dialog',
    'waitForLoading': 'wait_for_loading',
    'goToUrl': 'go_to_url',
    'clickElementByIndex': 'click_element_by_index',
}


def normalize_action_name(action_name: str) -> str:
    """Map aliases (camelCase / LLM kinds) to canonical snake_case action names."""
    raw = str(action_name or '').strip()
    if not raw:
        return ''
    if raw in _ACTION_NAME_ALIASES:
        return _ACTION_NAME_ALIASES[raw]
    # kebab / mixed → snake
    snake = raw.replace('-', '_')
    if snake in _ACTION_NAME_ALIASES:
        return _ACTION_NAME_ALIASES[snake]
    lower = snake.lower()
    if lower in _ACTION_NAME_ALIASES:
        return _ACTION_NAME_ALIASES[lower]
    # camelCase → snake_case (selectTreeOption → select_tree_option)
    camel_to_snake = re.sub(r'([a-z0-9])([A-Z])', r'\1_\2', raw).replace('-', '_').lower()
    if camel_to_snake in _FORM_ACTIONS or camel_to_snake in _ACTION_NAME_ALIASES.values():
        return camel_to_snake
    if camel_to_snake in _ACTION_NAME_ALIASES:
        return _ACTION_NAME_ALIASES[camel_to_snake]
    return raw


_CLICK_BY_INDEX = 'click_element_by_index'

# Locate + click by durable cues (xpath_smart → drawer/dialog text → xpath → text).
# Prefer last visible match — Element UI keeps leftover overlays with same button text.
_JS_CLICK_DURABLE = r'''async ([text, xpath, tagHint, xpathSmart]) => {
  const norm = (s) => (s || '').replace(/\s+/g, '').trim();
  const want = norm(text);
  const isVisible = (el) => {
    if (!el) return false;
    const st = getComputedStyle(el);
    const box = el.getBoundingClientRect();
    if (st.display === 'none' || st.visibility === 'hidden' || box.width < 1 || box.height < 1) return false;
    return true;
  };
  const clickEl = (el, how) => {
    if (!el) return null;
    el.scrollIntoView({ block: 'center', behavior: 'instant' });
    el.click();
    return how;
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const evalXpathAll = (xp) => {
    let s = String(xp || '');
    if (!s) return [];
    if (!s.startsWith('/') && !s.startsWith('(')) s = '/' + s;
    try {
      const snap = document.evaluate(s, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
      const out = [];
      for (let i = 0; i < snap.snapshotLength; i++) out.push(snap.snapshotItem(i));
      return out;
    } catch (e) {
      return [];
    }
  };
  const clickLastVisibleXpath = (xp, how) => {
    const nodes = evalXpathAll(xp).filter(isVisible);
    if (!nodes.length) return null;
    return clickEl(nodes[nodes.length - 1], how);
  };

  // 0) xpath_smart (drawer/dialog scoped text xpath)
  if (xpathSmart) {
    const hit = clickLastVisibleXpath(xpathSmart, 'ok-xpath-smart');
    if (hit) return hit;
  }

  // 1a) Custom app menu (tssc / non-ElementUI): li.menu-item — often NO role=menuitem
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

  // 1c) Icon / tree / aria-label (click_icon_button replay often stores button_text only)
  if (want) {
    const ariaHits = [...document.querySelectorAll('[aria-label], [title], [aria-describedby]')].filter(isVisible).filter((el) => {
      const a = norm(el.getAttribute('aria-label') || '');
      const t = norm(el.getAttribute('title') || '');
      return a === want || t === want;
    });
    if (ariaHits.length) return clickEl(ariaHits[ariaHits.length - 1], 'ok-aria-label');

    const treeHits = [...document.querySelectorAll('.el-tree-node__content, .el-tree-node__label')].filter(isVisible).filter((el) => {
      const t = norm(el.innerText || el.textContent);
      return t === want || t.startsWith(want);
    });
    if (treeHits.length) return clickEl(treeHits[treeHits.length - 1], 'ok-tree-content');

    // ElTooltip icon anchors (a.el-tooltip.el-icon-*) — tip text only after hover
    const tipAnchors = [...document.querySelectorAll(
      'a.el-tooltip, .el-tooltip[class*="el-icon"], a[class*="el-icon-"], i.el-tooltip, .el-tooltip.item'
    )].filter(isVisible);
    for (const el of tipAnchors) {
      el.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
      await sleep(80);
      const poppers = [...document.querySelectorAll('.el-tooltip__popper, [role="tooltip"]')].filter((p) => {
        const st = getComputedStyle(p);
        return st.display !== 'none' && st.visibility !== 'hidden' && (p.offsetWidth > 0 || p.offsetHeight > 0);
      });
      const hit = poppers.find((p) => norm(p.textContent) === want);
      if (hit) {
        el.click();
        return 'ok-tooltip-icon';
      }
      el.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
    }
  }

  // 2) Absolute / recorded xpath (fragile body>div[N] — last resort before text)
  if (xpath) {
    const hit = clickLastVisibleXpath(xpath, 'ok-xpath');
    if (hit) return hit;
  }

  // 3) Text: prefer last drawer → last dialog → page; buttons only (not span wrappers)
  if (want) {
    const drawers = [...document.querySelectorAll('.el-drawer')].filter(isVisible);
    const dialogs = [...document.querySelectorAll('.el-dialog, .el-message-box')].filter(isVisible);
    const scopes = [];
    if (drawers.length) scopes.push({ el: drawers[drawers.length - 1], how: 'ok-text-drawer' });
    if (dialogs.length) scopes.push({ el: dialogs[dialogs.length - 1], how: 'ok-text-dialog' });
    scopes.push({ el: document, how: 'ok-text-exact' });

    const btnSel = 'button, button.el-button, a.el-button, a[role="button"], .el-button';
    for (const { el: scope, how } of scopes) {
      const hits = [...scope.querySelectorAll(btnSel)].filter(isVisible).filter((el) => {
        const t = norm(el.innerText || el.textContent || '');
        return t === want;
      });
      if (hits.length) return clickEl(hits[hits.length - 1], how);
    }

    // Broader fuzzy fallback (still prefer last match) — include custom .menu-item
    const sel = 'button, a, .el-button, .el-menu-item, .el-submenu__title, [role="menuitem"], .el-tabs__item, li.menu-item, .menu-item, .el-tree-node__content';
    const candidates = [...document.querySelectorAll(sel)].filter(isVisible);
    const exact = candidates.filter(el => norm(el.innerText || el.textContent) === want);
    if (exact.length) return clickEl(exact[exact.length - 1], 'ok-text-exact');
    let best = null;
    let bestLen = Infinity;
    for (const el of candidates) {
      const t = norm(el.innerText || el.textContent);
      if (!t || t.length > 40) continue;
      if (t.includes(want) || want.includes(t)) {
        if (t.length <= bestLen) { best = el; bestLen = t.length; }
      }
    }
    if (best) return clickEl(best, 'ok-text-fuzzy');
  }

  return 'not-found';
}'''


def _normalize_params(action_name: str, params: dict | None) -> dict:
    """Accept recorded aliases (value/option/label) into controller param names."""
    p = dict(params or {})
    label = p.get('label_text') or p.get('label') or ''
    if label and 'label_text' not in p:
        p['label_text'] = label

    if action_name in ('fill_form_field', 'fill_date_field'):
        if not p.get('value'):
            p['value'] = p.get('option_text') or p.get('option') or p.get('text') or ''
    elif action_name in ('select_option', 'select_tree_option', 'click_radio'):
        if not p.get('option_text'):
            p['option_text'] = p.get('value') or p.get('option') or p.get('text') or ''
    return p


def _filter_callable_kwargs(fn, params: dict) -> dict:
    """Keep only kwargs accepted by the action function signature."""
    try:
        sig = inspect.signature(fn)
        names = {
            name
            for name, p in sig.parameters.items()
            if name != 'self' and p.kind in (
                inspect.Parameter.POSITIONAL_OR_KEYWORD,
                inspect.Parameter.KEYWORD_ONLY,
            )
        }
        if any(p.kind == inspect.Parameter.VAR_KEYWORD for p in sig.parameters.values()):
            return dict(params)
        return {k: v for k, v in params.items() if k in names}
    except (TypeError, ValueError):
        return dict(params)


def _result_ok(action_name: str, result: str) -> bool:
    """Unified success check: recordable/successful CTRL results use ``ok`` prefix.

    ``already-filled`` (skip) intentionally does NOT start with ``ok``.
    Checkpoint verify (`save_form_snapshot`) returns JSON; transport always ok when
    evaluate succeeded (prefix `form-structure:`).
    """
    if not isinstance(result, str) or not result:
        return False
    if action_name == 'save_form_snapshot' and result.startswith('form-structure:'):
        return True
    if result.startswith('error:') or result.startswith('unknown-') or result.startswith('err'):
        return False
    if result.startswith('click-failed') or result == 'not-found':
        return False
    if _is_ok_result(result):
        return True
    # Compound messages from ActionResult wrappers: "ok-login | …"
    if ' | ' in result and not result.lower().startswith('fail'):
        head = result.split(' | ', 1)[0].strip()
        if _is_ok_result(head):
            return True
    return False


async def _replay_verify_form_structure(page, params: dict) -> str:
    """Run verifyFormStructure; always return form-structure:<json> on success."""
    await _wait_if_loading(page)
    fields = params.get('fields') if isinstance(params, dict) else None
    if not isinstance(fields, list):
        fields = []
    raw = await page.evaluate(JS_VERIFY_FORM_STRUCTURE, [fields])
    if isinstance(raw, dict):
        return 'form-structure:' + json.dumps(raw, ensure_ascii=False)
    return 'form-structure:' + str(raw or '{}')


async def _replay_click_by_index(page, entry: dict, params: dict) -> str:
    """
    Replay click_element_by_index without relying on ephemeral highlight index.

    Prefer xpath_smart / drawer-scoped text (same idea as script_assembler).
    """
    await _wait_if_loading(page)
    el = entry.get('element') if isinstance(entry.get('element'), dict) else {}
    text = str(
        params.get('text')
        or params.get('menu_text')
        or el.get('text')
        or ''
    ).strip()
    cands = el.get('candidates') if isinstance(el.get('candidates'), list) else []

    def _cand(ctype: str) -> str:
        for c in cands:
            if isinstance(c, dict) and c.get('type') == ctype and c.get('value'):
                return str(c['value'])
        return ''

    xpath_smart = str(
        el.get('xpath_smart')
        or _cand('xpath_smart')
        or ''
    ).strip()
    # If primary target is already a smart-style xpath, treat it as smart
    target = str(entry.get('target') or el.get('xpath') or '').strip()
    if not xpath_smart and target.startswith('//'):
        xpath_smart = target
    xpath_full = str(
        el.get('xpath_full')
        or el.get('xpath_abs')
        or _cand('xpath_full')
        or params.get('xpath')
        or (entry.get('attributes') or {}).get('xpath')
        or ''
    ).strip()
    # Absolute xpath only as fallback (avoid using smart twice)
    xpath = xpath_full
    if not xpath and target and not target.startswith('//'):
        xpath = target
    tag_hint = str(params.get('tag_name') or entry.get('tagName') or el.get('tag') or '').strip()

    result = await page.evaluate(_JS_CLICK_DURABLE, [text, xpath, tag_hint, xpath_smart])
    if isinstance(result, str) and result.startswith('ok'):
        await _post_click_settle(page, entry, text, xpath_smart, xpath, result)
        return result

    # Playwright text click — prefer last visible button (overlay remounts)
    if text:
        try:
            loc = page.get_by_role('button', name=text, exact=True).last
            await loc.click(timeout=3000)
            await _post_click_settle(page, entry, text, xpath_smart, xpath, 'ok-playwright-role-last')
            return 'ok-playwright-role-last'
        except Exception:
            pass
        try:
            await page.get_by_text(text, exact=True).last.click(timeout=3000)
            await _post_click_settle(page, entry, text, xpath_smart, xpath, 'ok-playwright-text-last')
            return 'ok-playwright-text-last'
        except Exception:
            try:
                await page.locator(f'text={text}').last.click(timeout=3000)
                await _post_click_settle(page, entry, text, xpath_smart, xpath, 'ok-playwright-text-loose')
                return 'ok-playwright-text-loose'
            except Exception:
                pass

    index = params.get('index')
    return (
        f'click-failed:index={index} (ephemeral; text/xpath not found: {text!r})'
        if index is not None
        else f'click-failed:not-found text={text!r} xpath={xpath_smart or xpath!r}'
    )


async def _post_click_settle(
    page,
    entry: dict | None,
    text: str,
    xpath_smart: str,
    xpath: str,
    click_result: str,
) -> None:
    """Post-click waits: save→tree reload settle; tree node→edit form visible; else short pause."""
    if _is_save_click_text(text):
        await _wait_after_save_page_idle(page)
        return
    if _is_tree_node_entry(entry, xpath_smart, xpath):
        await page.wait_for_timeout(300)
        await _wait_if_loading(page)
        appeared = await _wait_after_tree_node_for_form(page)
        if not appeared:
            sys.stderr.write('[replay] tree-node click: edit form input not visible within timeout\n')
            sys.stderr.flush()
        return
    wait_ms = 600 if ('expand' in click_result or 'submenu' in click_result) else 400
    await page.wait_for_timeout(wait_ms)
    await _wait_if_loading(page)


async def _replay_goto(page, params: dict) -> str:
    """Navigate via Playwright — same role as assemble_script page.goto header."""
    url = str(params.get('url') or '').strip()
    if not url:
        return 'error:missing-url'
    await _wait_if_loading(page)
    try:
        await page.goto(url, wait_until='networkidle', timeout=60000)
    except Exception:
        try:
            await page.goto(url, wait_until='load', timeout=30000)
        except Exception as e:
            return f'error:goto:{e}'
    await page.wait_for_timeout(400)
    await _wait_if_loading(page)
    return 'ok'


def _element_xpath_smart(entry: dict | None) -> str:
    """Prefer relative xpath_smart from recorded element / candidates / target."""
    el = entry.get('element') if isinstance(entry, dict) and isinstance(entry.get('element'), dict) else {}
    cands = el.get('candidates') if isinstance(el.get('candidates'), list) else []

    def _cand(ctype: str) -> str:
        for c in cands:
            if isinstance(c, dict) and c.get('type') == ctype and c.get('value'):
                return str(c['value']).strip()
        return ''

    smart = str(el.get('xpath_smart') or _cand('xpath_smart') or '').strip()
    if smart.startswith('//') or smart.startswith('('):
        return smart
    target = str((entry or {}).get('target') or el.get('xpath') or '').strip()
    if target.startswith('//') or target.startswith('('):
        return target
    return ''


def _annotate_label_result(result: str) -> str:
    """Make label-based success self-describing in replay logs."""
    if not isinstance(result, str) or not result:
        return result
    if result == 'ok':
        return 'ok-label'
    if result.startswith('ok-') and 'label' not in result and 'xpath' not in result:
        # ok-date / ok-placeholder / ok-already:… → keep suffix, mark label path
        return f'ok-label:{result[3:]}' if result.startswith('ok-') else result
    return result


def _element_xpath_full(entry: dict | None) -> str:
    """Absolute xpath fallback from recorded element / candidates."""
    el = entry.get('element') if isinstance(entry, dict) and isinstance(entry.get('element'), dict) else {}
    cands = el.get('candidates') if isinstance(el.get('candidates'), list) else []

    def _cand(ctype: str) -> str:
        for c in cands:
            if isinstance(c, dict) and c.get('type') == ctype and c.get('value'):
                return str(c['value']).strip()
        return ''

    full = str(el.get('xpath_full') or el.get('xpath_abs') or _cand('xpath_full') or '').strip()
    if full.startswith('/') or full.startswith('('):
        return full
    return ''


# Click / focus a control resolved by xpath (returns ok-xpath-smart when found).
_JS_LOCATE_BY_XPATH = r'''([xpath]) => {
  if (!xpath) return 'xpath-empty';
  let snap;
  try {
    snap = document.evaluate(xpath, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
  } catch (e) {
    return 'xpath-invalid';
  }
  const isVis = (el) => {
    if (!el || el.nodeType !== 1) return false;
    if (el.offsetParent === null && !el.closest('.el-table__fixed')) return false;
    const st = getComputedStyle(el);
    return st.display !== 'none' && st.visibility !== 'hidden';
  };
  for (let i = snap.snapshotLength - 1; i >= 0; i--) {
    const n = snap.snapshotItem(i);
    if (n && isVis(n)) return 'ok-xpath-smart';
  }
  return 'xpath-not-found';
}'''


async def _try_xpath_locate(page, xpath: str) -> bool:
    if not xpath:
        return False
    result = await page.evaluate(_JS_LOCATE_BY_XPATH, [xpath])
    return isinstance(result, str) and result.startswith('ok')


async def _replay_form_action(page, action_name: str, params: dict, entry: dict | None = None) -> str:
    """One form field op using the same JS path as `_execute_round`.

    Locator order when RELATIVE_XPATH_PRIMARY:
      1) xpath_smart
      2) label/semantic
      3) xpath_full
    """
    label = str(params.get('label_text') or '')
    value = str(params.get('value') or params.get('option_text') or '')
    use_relative = relative_xpath_primary_enabled()
    xpath_smart = _element_xpath_smart(entry) if use_relative else ''
    xpath_full = _element_xpath_full(entry) if use_relative else ''

    await _wait_if_loading(page)

    if action_name == 'fill_form_field':
        if xpath_smart:
            result = await page.evaluate(_JS_FILL_BY_XPATH, [xpath_smart, value])
            if isinstance(result, str) and result.startswith('ok'):
                await page.wait_for_timeout(300)
                return str(result)
        result = await page.evaluate(JS_FILL_FORM_FIELD, [label, value])
        if isinstance(result, str) and result.startswith('ok'):
            await page.wait_for_timeout(300)
            return _annotate_label_result(str(result))
        if xpath_full:
            result = await page.evaluate(_JS_FILL_BY_XPATH, [xpath_full, value])
            if isinstance(result, str) and result.startswith('ok'):
                await page.wait_for_timeout(300)
                return 'ok-xpath-full'
        return _annotate_label_result(str(result))

    # Widget ops: prefer confirming xpath_smart host, then label JS, then xpath_full confirm.
    async def _with_xpath_first(label_js_coro):
        located_smart = await _try_xpath_locate(page, xpath_smart) if xpath_smart else False
        result = await label_js_coro()
        if isinstance(result, str) and result.startswith('ok'):
            if located_smart:
                # Prefer truthful xpath_smart when the stored locator still resolves
                return 'ok-xpath-smart' if result == 'ok' else f'ok-xpath-smart:{result[3:]}'
            return _annotate_label_result(str(result))
        if xpath_full and await _try_xpath_locate(page, xpath_full):
            result2 = await label_js_coro()
            if isinstance(result2, str) and result2.startswith('ok'):
                return 'ok-xpath-full' if result2 == 'ok' else f'ok-xpath-full:{result2[3:]}'
        return _annotate_label_result(str(result))

    if action_name == 'fill_date_field':
        async def _date():
            r = await page.evaluate(JS_FILL_DATE_FIELD, [label, value])
            await page.wait_for_timeout(300)
            return r
        return await _with_xpath_first(_date)

    if action_name == 'select_tree_option':
        async def _tree():
            r = await page.evaluate(JS_SELECT_TREE_OPTION, [label, value])
            await page.wait_for_timeout(500)
            return r
        return await _with_xpath_first(_tree)

    if action_name == 'click_radio':
        async def _radio():
            r = await page.evaluate(JS_CLICK_RADIO, [label, value])
            await page.wait_for_timeout(300)
            return r
        return await _with_xpath_first(_radio)

    if action_name == 'select_option':
        # Recorded selection is authoritative — replay MUST pick the same option_text.
        # params.options / element.options are inventory for export & downstream products
        # (reference only; never used to substitute a different value).
        pick = str(value or '').strip()

        async def _select():
            if not pick:
                return 'error:missing-option_text'

            already = await page.evaluate(JS_FIND_LABELED_SELECT, [label, 'check'])
            if isinstance(already, str) and already.startswith('ok-already:'):
                cur_val = already.split(':', 1)[1].strip()
                # Exact match only — do not accept a different label as "already done"
                if cur_val == pick:
                    await page.wait_for_timeout(200)
                    return already

            # Close leftover poppers (same as live select_option)
            await page.evaluate('''() => {
                document.querySelectorAll('.el-select-dropdown:not(.is-hidden)').forEach(dd => {
                    dd.style.display = 'none';
                    dd.classList.add('is-hidden');
                });
                document.body.click();
            }''')
            await page.wait_for_timeout(100)

            trigger_result = await page.evaluate(JS_FIND_LABELED_SELECT, [label, 'trigger'])
            if trigger_result in ('label-not-found', 'no-select-found', 'select-disabled'):
                return str(trigger_result)

            # Wait for dropdown items (remote dict / drawer mount); still pick `pick` only
            result = 'no-items'
            for attempt in range(3):
                await page.wait_for_timeout(500 if attempt == 0 else 400)
                result = await page.evaluate(JS_SELECT_OPTION, [pick, True])
                if isinstance(result, str) and result.startswith('ok'):
                    break
                if isinstance(result, str) and result.startswith('option-not-found:'):
                    break
                if result != 'no-items':
                    break
                await page.evaluate(JS_FIND_LABELED_SELECT, [label, 'trigger'])

            if isinstance(result, str) and result.startswith('ok'):
                got = result.split(':', 1)[1].strip() if ':' in result else ''
                # JS_SELECT_OPTION may includes()-match; reject drift from recorded value
                if got and got != pick:
                    return f'option-mismatch:want={pick}|got={got}'
                confirmed = await page.evaluate(JS_FIND_LABELED_SELECT, [label, 'confirm'])
                if isinstance(confirmed, str) and confirmed.startswith('ok-confirmed:'):
                    cur = confirmed.split(':', 1)[1].strip()
                    if cur and cur != pick:
                        return f'option-mismatch:want={pick}|got={cur}'
                elif not (isinstance(confirmed, str) and confirmed.startswith('ok-confirmed:')):
                    # Force native path with exact recorded text, then re-check
                    await page.evaluate(JS_FILL_FORM_FIELD, [label, pick])
                    await page.wait_for_timeout(200)
                    confirmed2 = await page.evaluate(JS_FIND_LABELED_SELECT, [label, 'confirm'])
                    if isinstance(confirmed2, str) and confirmed2.startswith('ok-confirmed:'):
                        cur = confirmed2.split(':', 1)[1].strip()
                        if cur != pick:
                            return f'option-mismatch:want={pick}|got={cur}'
                        result = confirmed2
                    else:
                        return f'option-not-synced:want={pick}|confirm={confirmed2}'
            # no-items / option-not-found / other → fail as-is (never pick "first")
            await page.wait_for_timeout(500)
            return result
        return await _with_xpath_first(_select)

    return f'unknown-form-action:{action_name}'


def _locate_hint(result: str) -> str:
    """Human-readable locate strategy for replay stderr logs."""
    r = str(result or '')
    if 'xpath-smart' in r or r.startswith('ok-xpath-smart'):
        return 'xpath_smart'
    if 'xpath-full' in r or r.startswith('ok-xpath-full'):
        return 'xpath_full'
    if r.startswith('ok-playwright'):
        return 'playwright'
    if r.startswith('ok-label') or r.startswith('ok-already') or r.startswith('ok-confirmed'):
        return 'label'
    if r.startswith('ok-menu') or r.startswith('ok-submenu') or 'menu' in r:
        return 'semantic'
    if r.startswith('ok-aria') or r.startswith('ok-tree') or r.startswith('ok-tooltip'):
        return 'semantic'
    if r.startswith('ok-text') or 'text' in r:
        return 'semantic'
    if r.startswith('ok'):
        return 'ok'
    return 'n/a'

async def _replay_controller_action(act, params: dict) -> str:
    """Non-form actions via controller registry (menu/table/dialog/login/…)."""
    kwargs = _filter_callable_kwargs(act.function, params)
    result = await act.function(**kwargs)
    extracted = getattr(result, 'extracted_content', None)
    return str(extracted if extracted is not None else result)


async def replay_action_entries(
    browser_context,
    entries: list[dict],
    *,
    controller_actions: dict | None = None,
    case_data_store: dict | None = None,
    emit=None,
    stop_on_fail: bool = False,
) -> dict:
    """
    Replay recorded steps sequentially (auto-fill style orchestration).

    When stop_on_fail=True, break after the first failed step (still emit replay_step).

    Returns {count, ok, failed, results, stoppedAt?}.
    """
    store = case_data_store if case_data_store is not None else {}
    prev_watcher = store.get('_watcher_mode')
    store['_watcher_mode'] = True

    results = []
    ok_count = 0
    fail_count = 0
    total = len(entries)
    stopped_at = None

    try:
        page = await browser_context.get_current_page()
        await _wait_if_loading(page)

        for i, entry in enumerate(entries):
            action_name = normalize_action_name(entry.get('action') or '')
            params = _normalize_params(action_name, entry.get('params'))
            step_num = i + 1
            sys.stderr.write(f'[replay] [{step_num}/{total}] {action_name} {params}\n')
            sys.stderr.flush()

            try:
                if action_name == 'go_to_url':
                    result = await _replay_goto(page, params)
                elif action_name == 'save_form_snapshot':
                    result = await _replay_verify_form_structure(page, params)
                elif action_name == _CLICK_BY_INDEX:
                    result = await _replay_click_by_index(page, entry, params)
                elif action_name in (
                    'click_menu_item',
                    'click_icon_button',
                    'click_adjacent_button',
                    'click_table_row_button',
                    'click_table_row_radio',
                    'switch_tab',
                    'close_dialog',
                ):
                    # Prefer recorded xpath_smart via durable click path; fall back to controller.
                    click_params = {**params}
                    if action_name == 'click_menu_item':
                        click_params['text'] = params.get('menu_text') or params.get('text') or ''
                    elif action_name == 'click_icon_button':
                        click_params['text'] = params.get('button_text') or params.get('text') or ''
                    elif action_name == 'switch_tab':
                        click_params['text'] = params.get('tab_name') or params.get('text') or ''
                    elif action_name == 'click_table_row_button':
                        click_params['text'] = params.get('button_text') or params.get('text') or ''
                    elif action_name == 'click_adjacent_button':
                        click_params['text'] = params.get('text') or params.get('label_text') or ''
                    if _element_xpath_smart(entry) or click_params.get('text'):
                        result = await _replay_click_by_index(page, entry, click_params)
                    else:
                        act = (controller_actions or {}).get(action_name)
                        if not act:
                            result = f'unknown-action:{action_name}'
                        else:
                            result = await _replay_controller_action(act, params)
                            await page.wait_for_timeout(400)
                            await _wait_if_loading(page)
                elif action_name in _FORM_ACTIONS:
                    result = await _replay_form_action(page, action_name, params, entry)
                else:
                    act = (controller_actions or {}).get(action_name)
                    if not act:
                        result = f'unknown-action:{action_name}'
                    else:
                        result = await _replay_controller_action(act, params)
                        await page.wait_for_timeout(400)
                        await _wait_if_loading(page)
                        if action_name == 'click_save' and _result_ok(action_name, result):
                            await _wait_after_save_page_idle(page)
            except Exception as e:
                result = f'error:{e}'

            ok = _result_ok(action_name, result)
            if ok:
                ok_count += 1
            else:
                fail_count += 1

            locate = _locate_hint(result)
            row = {
                'index': step_num,
                'action': action_name,
                'params': params,
                'result': result,
                'ok': ok,
                'locate': locate,
            }
            if entry.get('id') is not None:
                row['id'] = entry.get('id')
            results.append(row)
            sys.stderr.write(
                f'[replay] [{step_num}/{total}] {"OK" if ok else "FAIL"} → {result} | locate={locate}\n'
            )
            sys.stderr.flush()

            if emit:
                try:
                    emit({
                        'event': 'replay_step',
                        'data': {
                            'index': step_num,
                            'total': total,
                            'action': action_name,
                            'params': params,
                            'result': result,
                            'ok': ok,
                            'locate': locate,
                            'id': entry.get('id'),
                        },
                    })
                except Exception:
                    pass

            if not ok and stop_on_fail:
                stopped_at = step_num
                sys.stderr.write(
                    f'[replay] stop_on_fail: halted at step {step_num}/{total}\n'
                )
                sys.stderr.flush()
                break

            try:
                page = await browser_context.get_current_page()
            except Exception:
                pass

            await asyncio.sleep(0)

        ran = len(results)
        sys.stderr.write(
            f'[replay] Done: {ran}/{total} actions | ok:{ok_count} failed:{fail_count}'
            + (f' stoppedAt:{stopped_at}' if stopped_at else '')
            + '\n'
        )
        sys.stderr.flush()
        error = None
        if fail_count > 0:
            failed_rows = [r for r in results if not r.get('ok')]
            first = failed_rows[0] if failed_rows else {}
            error = (
                f"{fail_count}/{ran} steps failed"
                + (f"; first: {first.get('action')} → {first.get('result')}" if first else '')
            )
        out = {
            'count': ran,
            'ok': ok_count,
            'failed': fail_count,
            'error': error,
            'results': results,
        }
        if stopped_at is not None:
            out['stoppedAt'] = stopped_at
        return out
    finally:
        if prev_watcher is None:
            store.pop('_watcher_mode', None)
        else:
            store['_watcher_mode'] = prev_watcher
