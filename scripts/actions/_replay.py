"""
Sequential action replay — mirrors auto-fill orchestration in `_form.py`.

Key lessons from `_auto_fill_pending` / `_execute_round`:
  1. Execute one recorded action at a time (no scan/auto-fill side effects).
  2. Form ops use the same JS snippets as auto-fill (fill / select / date / tree / radio).
  3. Between steps: `_wait_if_loading` + short timeout (300ms input / 500ms select),
     never `networkidle` (SPA keep-alives hang forever).

For click_element_by_index: highlight `index` is ephemeral — relocate by text/menu/xpath
(same idea as script_assembler N-tier click).
"""

from __future__ import annotations

import asyncio
import inspect
import re
import sys

from ._helpers import _wait_if_loading, _is_ok_result
from ._js_snippets import (
    JS_FILL_FORM_FIELD,
    JS_FILL_DATE_FIELD,
    JS_FIND_LABELED_SELECT,
    JS_SELECT_OPTION,
    JS_SELECT_TREE_OPTION,
    JS_CLICK_RADIO,
)


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

# Locate + click by durable cues (text / menu / xpath). Index is last resort only.
_JS_CLICK_DURABLE = r'''async ([text, xpath, tagHint]) => {
  const norm = (s) => (s || '').replace(/\s+/g, '').trim();
  const want = norm(text);
  const clickEl = (el, how) => {
    if (!el) return null;
    el.scrollIntoView({ block: 'center', behavior: 'instant' });
    el.click();
    return how;
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // 1) Element UI menu
  if (want) {
    const menuItems = [...document.querySelectorAll('.el-menu-item')];
    const direct = menuItems.find(el => norm(el.textContent) === want && el.offsetParent !== null);
    if (direct) return clickEl(direct, 'ok-menu-item');

    for (const sm of document.querySelectorAll('.el-submenu')) {
      const title = sm.querySelector(':scope > .el-submenu__title');
      const titleText = norm(title?.textContent || '');
      // Parent submenu title (e.g. 客户管理)
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

  // 2) XPath from recording
  if (xpath) {
    let xp = String(xpath);
    if (xp && !xp.startsWith('/') && !xp.startsWith('(')) xp = '/' + xp;
    try {
      const el = document.evaluate(xp, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
      if (el) {
        el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
        return 'ok-xpath';
      }
    } catch (e) {}
  }

  // 3) Exact / fuzzy text on common clickables
  if (want) {
    const sel = 'button, a, span, li, label, .el-button, .el-menu-item, .el-submenu__title, [role="menuitem"], .el-tabs__item';
    const candidates = [...document.querySelectorAll(sel)].filter(el => el.offsetParent !== null);
    const exact = candidates.find(el => norm(el.textContent) === want);
    if (exact) return clickEl(exact, 'ok-text-exact');
    let best = null;
    let bestLen = Infinity;
    for (const el of candidates) {
      const t = norm(el.textContent);
      if (!t || t.length > 40) continue;
      if (t.includes(want) || want.includes(t)) {
        if (t.length < bestLen) { best = el; bestLen = t.length; }
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
    """
    if not isinstance(result, str) or not result:
        return False
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


async def _replay_click_by_index(page, entry: dict, params: dict) -> str:
    """
    Replay click_element_by_index without relying on ephemeral highlight index.

    Same idea as script_assembler N-tier relocate: text → menu → xpath → Playwright text.
    """
    await _wait_if_loading(page)
    text = str(params.get('text') or params.get('menu_text') or entry.get('description') or '').strip()
    xpath = str(
        entry.get('target')
        or params.get('xpath')
        or (entry.get('attributes') or {}).get('xpath')
        or ''
    ).strip()
    tag_hint = str(params.get('tag_name') or entry.get('tagName') or '').strip()

    result = await page.evaluate(_JS_CLICK_DURABLE, [text, xpath, tag_hint])
    if isinstance(result, str) and result.startswith('ok'):
        wait_ms = 600 if ('expand' in result or 'submenu' in result) else 400
        await page.wait_for_timeout(wait_ms)
        await _wait_if_loading(page)
        return result

    # Playwright text click (still durable; never trust highlight index)
    if text:
        try:
            await page.get_by_text(text, exact=True).first.click(timeout=3000)
            await page.wait_for_timeout(400)
            await _wait_if_loading(page)
            return 'ok-playwright-text'
        except Exception:
            try:
                await page.locator(f'text={text}').first.click(timeout=3000)
                await page.wait_for_timeout(400)
                return 'ok-playwright-text-loose'
            except Exception:
                pass

    index = params.get('index')
    return (
        f'click-failed:index={index} (ephemeral; text/xpath not found: {text!r})'
        if index is not None
        else f'click-failed:not-found text={text!r} xpath={xpath!r}'
    )


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


async def _replay_form_action(page, action_name: str, params: dict) -> str:
    """One form field op using the same JS path as `_execute_round`."""
    label = str(params.get('label_text') or '')
    value = str(params.get('value') or params.get('option_text') or '')

    await _wait_if_loading(page)

    if action_name == 'fill_form_field':
        result = await page.evaluate(JS_FILL_FORM_FIELD, [label, value])
        await page.wait_for_timeout(300)
        return str(result)

    if action_name == 'fill_date_field':
        result = await page.evaluate(JS_FILL_DATE_FIELD, [label, value])
        await page.wait_for_timeout(300)
        return str(result)

    if action_name == 'select_tree_option':
        result = await page.evaluate(JS_SELECT_TREE_OPTION, [label, value])
        await page.wait_for_timeout(500)
        return str(result)

    if action_name == 'click_radio':
        result = await page.evaluate(JS_CLICK_RADIO, [label, value])
        await page.wait_for_timeout(300)
        return str(result)

    if action_name == 'select_option':
        already = await page.evaluate(JS_FIND_LABELED_SELECT, [label, 'check'])
        if isinstance(already, str) and already.startswith('ok-already:'):
            cur_val = already.split(':', 1)[1]
            if cur_val == value or value in cur_val or cur_val in value:
                await page.wait_for_timeout(200)
                return already

        await page.evaluate(JS_FIND_LABELED_SELECT, [label, 'trigger'])
        await page.wait_for_timeout(350)
        result = await page.evaluate(JS_SELECT_OPTION, value)
        if isinstance(result, str) and result.startswith('option-not-found:'):
            result = await page.evaluate(JS_SELECT_OPTION, 'first')
        if isinstance(result, str) and result.startswith('ok'):
            confirmed = await page.evaluate(JS_FIND_LABELED_SELECT, [label, 'confirm'])
            if not (isinstance(confirmed, str) and confirmed.startswith('ok-confirmed:')):
                await page.evaluate(JS_FILL_FORM_FIELD, [label, value])
                await page.wait_for_timeout(200)
                confirmed2 = await page.evaluate(JS_FIND_LABELED_SELECT, [label, 'confirm'])
                if isinstance(confirmed2, str) and confirmed2.startswith('ok-confirmed:'):
                    result = confirmed2
        await page.wait_for_timeout(500)
        return str(result)

    return f'unknown-form-action:{action_name}'


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
) -> dict:
    """
    Replay recorded steps sequentially (auto-fill style orchestration).

    Returns {count, ok, failed, results}.
    """
    store = case_data_store if case_data_store is not None else {}
    prev_watcher = store.get('_watcher_mode')
    store['_watcher_mode'] = True

    results = []
    ok_count = 0
    fail_count = 0
    total = len(entries)

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
                elif action_name == _CLICK_BY_INDEX:
                    result = await _replay_click_by_index(page, entry, params)
                elif action_name == 'click_menu_item':
                    menu_params = {
                        **params,
                        'text': params.get('menu_text') or params.get('text') or '',
                    }
                    result = await _replay_click_by_index(page, entry, menu_params)
                elif action_name in _FORM_ACTIONS:
                    result = await _replay_form_action(page, action_name, params)
                else:
                    act = (controller_actions or {}).get(action_name)
                    if not act:
                        result = f'unknown-action:{action_name}'
                    else:
                        result = await _replay_controller_action(act, params)
                        await page.wait_for_timeout(400)
                        await _wait_if_loading(page)
            except Exception as e:
                result = f'error:{e}'

            ok = _result_ok(action_name, result)
            if ok:
                ok_count += 1
            else:
                fail_count += 1

            row = {
                'index': step_num,
                'action': action_name,
                'params': params,
                'result': result,
                'ok': ok,
            }
            results.append(row)
            sys.stderr.write(
                f'[replay] [{step_num}/{total}] {"OK" if ok else "FAIL"} → {result}\n'
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
                            'id': entry.get('id'),
                        },
                    })
                except Exception:
                    pass

            try:
                page = await browser_context.get_current_page()
            except Exception:
                pass

            await asyncio.sleep(0)

        sys.stderr.write(f'[replay] Done: {total} actions | ok:{ok_count} failed:{fail_count}\n')
        sys.stderr.flush()
        error = None
        if fail_count > 0:
            failed_rows = [r for r in results if not r.get('ok')]
            first = failed_rows[0] if failed_rows else {}
            error = (
                f"{fail_count}/{total} steps failed"
                + (f"; first: {first.get('action')} → {first.get('result')}" if first else '')
            )
        return {
            'count': total,
            'ok': ok_count,
            'failed': fail_count,
            'error': error,
            'results': results,
        }
    finally:
        if prev_watcher is None:
            store.pop('_watcher_mode', None)
        else:
            store['_watcher_mode'] = prev_watcher
