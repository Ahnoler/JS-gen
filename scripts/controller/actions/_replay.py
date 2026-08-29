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
    is_absent_field_result,
    absent_field_skip_result,
    reset_select_ui,
)
from ._js_snippets import (
    JS_CHECK_LOADING,
    JS_FILL_FORM_FIELD,
    JS_FILL_BY_XPATH,
    JS_FIND_LABELED_SELECT,
    JS_SCAN_MENU_TREE,
    JS_READ_PAGE_COMPONENT_CODE,
    JS_CLICK_MENU_XPATH,
    JS_SELECT_OPTION,
    JS_SELECT_TRIGGER_BY_XPATH,
    JS_SELECT_VALUE_BY_XPATH,
    JS_SELECT_TREE_OPTION,
    JS_CLICK_RADIO,
    JS_VERIFY_FORM_STRUCTURE,
)
from scripts.feature_flags import relative_xpath_primary_enabled

from .replay_js import (  # noqa: F401  (re-exported for compat)
    _JS_CLICK_DURABLE,
    _JS_EDIT_FORM_INPUT_VISIBLE,
    _JS_LOCATE_BY_XPATH,
    _JS_PAGE_BUSY,
    JS_COUNT_OVERLAYS,
    _JS_READ_VALUE_BY_XPATH,
    _JS_READ_VALUE_BY_LABEL,
)
from .replay_names import (  # noqa: F401  (re-exported for compat)
    _ACTION_NAME_ALIASES,
    _FORM_ACTIONS,
    normalize_action_name,
)
from .replay_wait import (  # noqa: F401  (re-exported for compat)
    _SAVE_BUTTON_TEXTS,
    _is_save_click_text,
    _is_trackable_request,
    _is_tree_node_entry,
    _wait_after_save_page_idle,
    _wait_after_tree_node_for_form,
)

from .replay_click import _post_click_settle, _replay_click_by_index
from .replay_form_action import _replay_form_action
from .replay_table import _replay_table_row_radio
_CLICK_BY_INDEX = 'click_element_by_index'


def _normalize_params(action_name: str, params: dict | None) -> dict:
    """Accept recorded aliases (value/option/label) into controller param names."""
    p = dict(params or {})
    label = p.get('label_text') or p.get('label') or ''
    if label and 'label_text' not in p:
        p['label_text'] = label

    if action_name == 'fill_form_field':
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
    ``label-not-found`` / ``ok-skip:label-not-found`` = cascade field absent → skip OK
    (do not fail replay / do not enter heal).
    Checkpoint verify (`save_form_snapshot`) returns JSON; transport always ok when
    evaluate succeeded (prefix `form-structure:`).
    """
    if not isinstance(result, str) or not result:
        return False
    if action_name == 'save_form_snapshot' and result.startswith('form-structure:'):
        return True
    if is_absent_field_result(result):
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
        if _is_ok_result(head) or is_absent_field_result(head):
            return True
    return False


async def _replay_verify_form_structure(page, params: dict) -> str:
    """Run verifyFormStructure; always return form-structure:<json> on success.

    Passes recorded ``container`` (main / drawer:… / dialog:…) so scan does not
    prefer an unrelated visible overlay via getContainer().
    """
    await _wait_if_loading(page)
    fields = params.get('fields') if isinstance(params, dict) else None
    if not isinstance(fields, list):
        fields = []
    container = 'main'
    if isinstance(params, dict) and params.get('container') not in (None, ''):
        container = str(params.get('container')).strip() or 'main'
    # Single Playwright arg: { fields, container } — do NOT wrap fields as [fields].
    raw = await page.evaluate(
        JS_VERIFY_FORM_STRUCTURE,
        {'fields': fields, 'container': container},
    )
    if isinstance(raw, dict):
        return 'form-structure:' + json.dumps(raw, ensure_ascii=False)
    if isinstance(raw, str) and raw.startswith('{'):
        return 'form-structure:' + raw
    return 'form-structure:' + str(raw or '{}')


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


def _resolve_replay_xpath(entry, params) -> tuple[str, str]:
    """Pick replay xpath: element.xpath_smart → xpath_full.

    ``params.xpath_smart`` is intentionally ignored (abandoned for locate).
    Dirty/wrong params historically beat correct ``element_json`` under
    params-first (traj 130 step 23: label 名称, params pointed at 编号).
    """
    if not relative_xpath_primary_enabled():
        full = _element_xpath_full(entry)
        return (full, 'full') if full else ('', '')
    ex = _element_xpath_smart(entry)
    if ex:
        return ex, 'element'
    full = _element_xpath_full(entry)
    if full:
        return full, 'full'
    return '', ''


def _norm_replay_value(s) -> str:
    """Strip all whitespace for read-back compare."""
    return re.sub(r'\s+', '', str(s or '').strip())


def _classify_fill_result(action_ok: bool, expected: str, actual: str) -> str:
    if not action_ok:
        return 'xpath_miss:action-failed'
    from scripts.controller.actions.form_scan_utils import field_values_equivalent

    if field_values_equivalent(actual, expected):
        return 'ok'
    exp = _norm_replay_value(expected)
    act = _norm_replay_value(actual)
    if exp == act:
        return 'ok'
    return f'false_ok:expected={exp},actual={act}'


async def _read_value_by_xpath(page, xpath: str, label_hint: str = '') -> str:
    if not xpath:
        return ''
    result = await page.evaluate(_JS_READ_VALUE_BY_XPATH, [xpath, label_hint or ''])
    return str(result or '').strip()


async def _read_value_by_label(page, label: str, placeholder: str = '') -> str:
    """Read a value by el-form-item label / placeholder (mirror of the
    JS_FILL_BY_XPATH placeholder branch). Used when a fill fell back to the
    placeholder path because the recorded xpath was stale."""
    result = await page.evaluate(_JS_READ_VALUE_BY_LABEL, [label or '', placeholder or ''])
    return str(result or '').strip()


async def _try_xpath_locate(page, xpath: str) -> bool:
    if not xpath:
        return False
    result = await page.evaluate(_JS_LOCATE_BY_XPATH, [xpath])
    return isinstance(result, str) and result.startswith('ok')


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


def _xpath_literal(text: str) -> str:
    """XPath 1.0 string literal — mirrors JS xpathLiteral in PAGE_LOCATOR_HELPERS."""
    t = str(text or '')
    if "'" not in t:
        return "'" + t + "'"
    if '"' not in t:
        return '"' + t + '"'
    parts = t.split("'")
    return "concat(" + ", '\"', ".join("'" + p + "'" for p in parts) + ")"


async def _replay_table_row_button_anchor(page, row_text: str, btn_text: str) -> str:
    """Row-anchor xpath first try for click_table_row_button.

    Locate //tr[.//*[normalize-space()=<row_text>]]//button[normalize-space()=<btn_text>]
    and click the first visible match. Returns an ok* string or '' when no match.
    Falls back to el-button/a hosts (same leaf set as buildLocatorSnap table_row_button).
    """
    if not row_text or not btn_text:
        return ''
    row_lit = _xpath_literal(row_text)
    btn_lit = _xpath_literal(btn_text)
    xp = (
        "//tr[.//*[normalize-space()=" + row_lit + "]]"
        + "//*[self::button or self::a or contains(concat(' ',normalize-space(@class),' '),' el-button ')]"
        + "[normalize-space()=" + btn_lit + "]"
    )
    try:
        result = await page.evaluate(
            '''(xp) => {
                try {
                    const snap = document.evaluate(xp, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
                    for (let i = 0; i < snap.snapshotLength; i++) {
                        const el = snap.snapshotItem(i);
                        if (el && el.offsetParent !== null) { el.click(); return 'ok-row-anchor'; }
                    }
                } catch (e) {}
                return '';
            }''',
            [xp],
        )
        return str(result or '')
    except Exception:
        return ''


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
    business_data_store: dict | None = None,
    emit=None,
    stop_on_fail: bool = False,
) -> dict:
    """
    Replay recorded steps sequentially (auto-fill style orchestration).

    When stop_on_fail=True, break after the first failed step (still emit replay_step).

    Returns {count, ok, failed, results, stoppedAt?}.
    """
    store = business_data_store if business_data_store is not None else {}
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

            _scan_menu_payload = None
            _page_id_payload = None
            try:
                if action_name == 'go_to_url':
                    result = await _replay_goto(page, params)
                elif action_name == 'scan_menu_tree':
                    scan_payload = await page.evaluate(JS_SCAN_MENU_TREE)
                    result = 'ok'
                    _scan_menu_payload = scan_payload.get('menus', []) if isinstance(scan_payload, dict) else []
                    _scan_diag = scan_payload.get('diag') if isinstance(scan_payload, dict) else None
                    sys.stderr.write(f'[replay] scan_menu_tree menus={len(_scan_menu_payload)} diag={json.dumps(_scan_diag, ensure_ascii=False)}\n')
                    sys.stderr.flush()
                elif action_name == 'read_page_component_code':
                    page_id_payload = await page.evaluate(JS_READ_PAGE_COMPONENT_CODE)
                    result = 'ok'
                    _page_id_payload = page_id_payload if isinstance(page_id_payload, dict) else {}
                    sys.stderr.write(f'[replay] read_page_component_code code={_page_id_payload.get("componentCode", "")} reason={_page_id_payload.get("reason", "")} diag={json.dumps(_page_id_payload.get("diag"), ensure_ascii=False)}\n')
                    sys.stderr.flush()
                elif action_name == 'click_menu_xpath':
                    click_xpath = params.get('xpath') or (entry.get('element') or {}).get('xpath_full') or ''
                    result = await page.evaluate(JS_CLICK_MENU_XPATH, click_xpath)
                    await page.wait_for_timeout(600)
                elif action_name == 'save_form_snapshot':
                    result = await _replay_verify_form_structure(page, params)
                elif action_name == _CLICK_BY_INDEX:
                    result = await _replay_click_by_index(page, entry, params)
                elif action_name in (
                    'click_menu_item',
                    'click_button',
                    'click_adjacent_button',
                    'click_table_row_button',
                    'switch_tab',
                    'close_dialog',
                ):
                    # Idempotent close: if no visible dialog/drawer/message-box
                    # remains, the overlay is already gone (a preceding
                    # 确定/下一步 may have navigated or closed it). Treat as
                    # success instead of failing the replay and forcing a heal
                    # step every time the recorded close lands after the dialog
                    # was already dismissed.
                    result = None
                    if action_name == 'close_dialog':
                        overlay_count = await page.evaluate(JS_COUNT_OVERLAYS)
                        if overlay_count == 0:
                            result = 'ok (no visible dialog/drawer — already closed)'
                            sys.stderr.write('[replay] close_dialog idempotent ok (no visible overlay)\n')
                            sys.stderr.flush()
                    if result is None:
                        # Prefer recorded xpath_smart via durable click path; fall back to controller.
                        click_params = {**params}
                        if action_name == 'click_menu_item':
                            click_params['text'] = params.get('menu_text') or params.get('text') or ''
                        elif action_name == 'click_button':
                            click_params['text'] = params.get('button_text') or params.get('text') or ''
                        elif action_name == 'switch_tab':
                            click_params['text'] = params.get('tab_name') or params.get('text') or ''
                        elif action_name == 'click_table_row_button':
                            click_params['text'] = params.get('button_text') or params.get('text') or ''
                        elif action_name == 'click_adjacent_button':
                            click_params['text'] = params.get('text') or params.get('label_text') or ''
                        # click_table_row_button: try row-anchor xpath first (unique-key
                        # row text disambiguates same-named rows), then durable fallback.
                        if action_name == 'click_table_row_button':
                            _row_t = str(params.get('row_text') or '').strip()
                            _btn_t = str(params.get('button_text') or params.get('text') or '').strip()
                            if _row_t and _btn_t:
                                anchor = await _replay_table_row_button_anchor(page, _row_t, _btn_t)
                                if _result_ok(action_name, anchor):
                                    result = anchor
                                    sys.stderr.write(
                                        f'[replay] click_table_row_button row-anchor ok '
                                        f'(row={_row_t!r} btn={_btn_t!r})\n'
                                    )
                                    sys.stderr.flush()
                        if result is None and (_element_xpath_smart(entry) or click_params.get('text')):
                            result = await _replay_click_by_index(page, entry, click_params)
                            # close_dialog: dialog-scoped xpath often misses drawers
                            # (Element UI reuses i.el-dialog__close inside drawer).
                            # Fall back to CTRL/controller close which handles drawer.
                            if (
                                action_name == 'close_dialog'
                                and not _result_ok(action_name, result)
                            ):
                                act = (controller_actions or {}).get(action_name)
                                if act:
                                    fb = await _replay_controller_action(act, params)
                                    await page.wait_for_timeout(400)
                                    await _wait_if_loading(page)
                                    if _result_ok(action_name, fb):
                                        sys.stderr.write(
                                            f'[replay] close_dialog ctrl-fallback ok '
                                            f'(xpath failed: {result})\n'
                                        )
                                        sys.stderr.flush()
                                        result = fb
                        else:
                            act = (controller_actions or {}).get(action_name)
                            if not act:
                                result = f'unknown-action:{action_name}'
                            else:
                                result = await _replay_controller_action(act, params)
                                await page.wait_for_timeout(400)
                                await _wait_if_loading(page)
                elif action_name == 'click_table_row_radio':
                    # Prefer semantic row match (handles Element UI fixed-column radios).
                    # Durable xpath often requires name+radio in the same <tr> and fails.
                    result = await _replay_table_row_radio(
                        page, entry, params, controller_actions=controller_actions,
                    )
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
            if action_name == 'scan_menu_tree' and _scan_menu_payload is not None:
                row['menus'] = _scan_menu_payload
            if action_name == 'read_page_component_code' and _page_id_payload is not None:
                row['pageCode'] = _page_id_payload
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
