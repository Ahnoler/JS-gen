"""Replay one form-field op using the same JS path as auto-fill.

Extracted from _replay.py. _replay.py re-exports _replay_form_action for compat.
"""

import sys

from scripts.feature_flags import relative_xpath_primary_enabled
from ._helpers import (
    _wait_if_loading,
    absent_field_skip_result,
    is_absent_field_result,
    reset_select_ui,
)
from ._js_snippets import (
    JS_FIND_LABELED_SELECT,
    JS_SELECT_VALUE_BY_XPATH,
    JS_TSSC_MULTI_SELECT,
)
from .form_action_engines import FillEngine, RadioEngine, SelectEngine, TreeEngine
from .replay_js import _JS_LOCATE_BY_XPATH, _JS_READ_VALUE_BY_XPATH
from .replay_timing import WAIT_200_MS, WAIT_300_MS, WAIT_400_MS, WAIT_500_MS
from .select_dispatch import resolve_select_dispatch


async def _replay_form_action(page, action_name: str, params: dict, entry: dict | None = None) -> str:
    """One form field op using the same JS path as `_execute_round`.

    Locator order when RELATIVE_XPATH_PRIMARY:
      1) element.xpath_smart (params.xpath_smart ignored for locate)
      2) label/semantic
      3) xpath_full
      (+ placeholder when no form-item label)
    """
    # Late import: _replay.py imports this module back at module level.
    from ._replay import (
        _annotate_label_result,
        _classify_fill_result,
        _element_xpath_full,
        _element_xpath_smart,
        _read_value_by_label,
        _read_value_by_xpath,
        _resolve_replay_xpath,
        _try_xpath_locate,
    )
    label = str(params.get('label_text') or '')
    value = str(params.get('value') or params.get('option_text') or '')
    el = entry.get('element') if isinstance(entry, dict) and isinstance(entry.get('element'), dict) else {}
    placeholder = str(
        params.get('placeholder')
        or el.get('placeholder')
        or (el.get('attributes') or {}).get('placeholder')
        or ''
    ).strip()
    # Search boxes often have only placeholder (e.g. 搜索关键字) and no el-form-item label
    if not placeholder and label and ('搜索' in label or '关键字' in label or '请输入' in label):
        placeholder = label
    use_relative = relative_xpath_primary_enabled()
    xpath_smart = _element_xpath_smart(entry) if use_relative else ''
    xpath_full = _element_xpath_full(entry) if use_relative else ''

    await _wait_if_loading(page)

    if action_name == 'fill_form_field':
        xp, _src = _resolve_replay_xpath(entry, params)
        return await FillEngine.fill_form_field_for_replay(
            page,
            label,
            value,
            xpath_smart=xp or '',
            element=el,
            placeholder=placeholder,
        )

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

    if action_name == 'select_tree_option':
        async def _tree():
            r = await TreeEngine.select_tree_option_for_replay(
                page, label, value, xpath_smart=xpath_smart or '',
            )
            await page.wait_for_timeout(WAIT_500_MS)
            return r
        return await _with_xpath_first(_tree)

    if action_name == 'tssc_multi_select':
        dispatch = await resolve_select_dispatch(label=label, element=el, force_path='tssc')
        sys.stderr.write(
            f'[replay-select] dispatch path={dispatch.path} reason={dispatch.reason}\n'
        )
        sys.stderr.flush()

        async def _tssc():
            r = await page.evaluate(JS_TSSC_MULTI_SELECT, [label, value])
            await page.wait_for_timeout(WAIT_500_MS)
            return r
        return await _with_xpath_first(_tssc)

    if action_name == 'click_radio':
        async def _radio():
            r = await RadioEngine.click_radio_for_replay(
                page,
                label,
                value,
                xpath_smart=xpath_smart or '',
            )
            await page.wait_for_timeout(WAIT_300_MS)
            return r
        return await _with_xpath_first(_radio)

    if action_name == 'select_option':
        # Recorded selection is authoritative — replay MUST pick the same option_text.
        # params.options / element.options are inventory for export & downstream products
        # (reference only; never used to substitute a different value).
        element_xp = _element_xpath_smart(entry) if use_relative else ''
        pick = str(value or '').strip()

        async def _replay_select_final_failure(result_text: str) -> str:
            if is_absent_field_result(result_text):
                sys.stderr.write(
                    f'[replay-select] skip absent label={label!r} option={pick!r}\n'
                )
                sys.stderr.flush()
                return absent_field_skip_result()
            diag = await reset_select_ui(page)
            sys.stderr.write(
                f'[replay-select] final failure label={label!r} option={pick!r} '
                f'result={result_text!r} reset={diag}\n'
            )
            sys.stderr.flush()
            return str(result_text)

        _SENT = frozenset({'first', 'any', 'random', '1st', '第一个', '第一项'})

        def _echo_from_select_ok(result: str) -> str:
            """Strip ok-p1:/ok-p2:/ok: prefixes so mismatch compares display text."""
            s = str(result or '').strip()
            for prefix in (
                'ok-already:', 'ok-p1:', 'ok-p2:', 'ok-first:', 'ok-echo:',
                'ok-confirmed:', 'ok:',
            ):
                if s.startswith(prefix):
                    return s[len(prefix):].strip()
            if s.startswith('ok-') and ':' in s:
                return s.split(':', 1)[1].strip()
            return ''

        async def _map_engine_select_result(
            raw, locate_src: str | None = None, xpath: str = '',
        ) -> str:
            result = str(raw)
            if is_absent_field_result(result):
                return await _replay_select_final_failure(result)
            if result.startswith('ok-already:'):
                cur = _echo_from_select_ok(result)
                if cur:
                    await page.wait_for_timeout(WAIT_200_MS)
                    if locate_src:
                        return f'ok-already:{cur}|locate={locate_src}'
                return result
            if result.startswith('ok'):
                got = _echo_from_select_ok(result)
                # Recorded option_text is authoritative (except sentinel first/any).
                if (
                    got
                    and got != pick
                    and pick.lower() not in _SENT
                    and pick not in _SENT
                ):
                    return await _replay_select_final_failure(
                        f'option-mismatch:want={pick}|got={got}'
                    )
                if xpath and locate_src:
                    actual = await _read_value_by_xpath(page, xpath, label)
                    classified = _classify_fill_result(True, pick, actual)
                    await page.wait_for_timeout(WAIT_500_MS)
                    if classified.startswith('false_ok'):
                        return await _replay_select_final_failure(classified)
                    return f'ok:locate={locate_src}'
                await page.wait_for_timeout(WAIT_500_MS)
                return _annotate_label_result(result)
            return await _replay_select_final_failure(result)

        # D6: select_option + form_tssc_multi_select → JS_TSSC (not el-select).
        # Wet 2026-09-09: do NOT return via bare _with_xpath_first — it annotated
        # ok-p1:部署方式 as OK without option-mismatch when want was 服务ID.
        dispatch = await resolve_select_dispatch(
            label=label,
            element=el,
            field_kind=None,
            page=page,
        )
        sys.stderr.write(
            f'[replay-select] dispatch path={dispatch.path} reason={dispatch.reason} '
            f'label={label!r} option={pick!r}\n'
        )
        sys.stderr.flush()
        if dispatch.path == "tssc":
            if pick == '':
                return 'error:missing-option_text'
            located_smart = (
                await _try_xpath_locate(page, xpath_smart) if xpath_smart else False
            )
            raw = await SelectEngine.select_option_for_replay(
                page, label, pick, xpath_smart=element_xp or '', element=el,
            )
            locate_src = 'element' if located_smart else None
            mapped = await _map_engine_select_result(
                raw, locate_src, element_xp if located_smart else '',
            )
            if (
                located_smart
                and isinstance(mapped, str)
                and mapped.startswith('ok')
                and not mapped.startswith('ok:locate=')
                and not mapped.startswith('ok-skip')
            ):
                echo = _echo_from_select_ok(str(raw))
                if str(raw).startswith('ok-p1:'):
                    return f'ok-xpath-smart:p1:{echo}'
                if str(raw).startswith('ok-p2:'):
                    return f'ok-xpath-smart:p2:{echo}'
                return (
                    f'ok-xpath-smart:{mapped[3:]}'
                    if mapped.startswith('ok-')
                    else 'ok-xpath-smart'
                )
            return mapped

        branch_reset_diag = await reset_select_ui(page)
        if not branch_reset_diag.get('closed', False):
            sys.stderr.write(
                f'[replay-select] branch preflight reset incomplete label={label!r} reset={branch_reset_diag}\n'
            )
            sys.stderr.flush()
            return await _replay_select_final_failure('no-items')

        if not pick:
            return 'error:missing-option_text'
        # Legacy dirty steps may still store option_text=first (recording used to skip
        # stamping). "first" meant "any existing value is fine" — if the control already
        # has a value, accept ok-already. Never invent options[0]. Empty → still fail.
        if pick.lower() in _SENT or pick in _SENT:
            xp_s, src_s = _resolve_replay_xpath(entry, params)
            if xp_s:
                already = await page.evaluate(JS_SELECT_VALUE_BY_XPATH, [xp_s, label])
                if isinstance(already, str) and already.startswith('ok-already:'):
                    cur = already.split(':', 1)[1].strip()
                    if cur:
                        await page.wait_for_timeout(WAIT_200_MS)
                        return f'ok-already:{cur}|locate={src_s}|legacy-sentinel:{pick}'
            if label:
                already = await page.evaluate(JS_FIND_LABELED_SELECT, [label, 'check'])
                if isinstance(already, str) and already.startswith('ok-already:'):
                    cur = already.split(':', 1)[1].strip()
                    if cur:
                        await page.wait_for_timeout(WAIT_200_MS)
                        return f'ok-already:{cur}|locate=label|legacy-sentinel:{pick}'
            return f'bad_option_text:{pick}'

        _XPATH_MISS = frozenset({
            'xpath-not-found', 'xpath-empty', 'label-not-found', 'no-select-found',
        })

        async def _select_by_xpath(xpath: str, locate_src: str) -> str | None:
            reset_diag = await reset_select_ui(page)
            if not reset_diag.get('closed', False):
                sys.stderr.write(
                    f'[replay-select] xpath preflight reset incomplete xpath={xpath!r} reset={reset_diag}\n'
                )
                sys.stderr.flush()
                return await _replay_select_final_failure('no-items')

            already = await page.evaluate(JS_SELECT_VALUE_BY_XPATH, [xpath, label])
            if isinstance(already, str) and already.startswith('ok-already:'):
                cur_val = already.split(':', 1)[1].strip()
                if cur_val == pick:
                    await page.wait_for_timeout(WAIT_200_MS)
                    return f'ok-already:{pick}|locate={locate_src}'

            raw = await SelectEngine.select_option_for_replay(
                page, label, pick, xpath_smart=xpath, element=el, exact_option=True,
            )
            raw_s = str(raw)
            if raw_s in _XPATH_MISS or raw_s.startswith('xpath-not-found'):
                return None
            return await _map_engine_select_result(raw, locate_src, xpath)

        async def _select_by_label() -> str:
            reset_diag = await reset_select_ui(page)
            if not reset_diag.get('closed', False):
                sys.stderr.write(
                    f'[replay-select] label preflight reset incomplete label={label!r} reset={reset_diag}\n'
                )
                sys.stderr.flush()
                return await _replay_select_final_failure('no-items')

            already = await page.evaluate(JS_FIND_LABELED_SELECT, [label, 'check'])
            if isinstance(already, str) and already.startswith('ok-already:'):
                cur_val = already.split(':', 1)[1].strip()
                if cur_val == pick:
                    await page.wait_for_timeout(WAIT_200_MS)
                    return already

            raw = await SelectEngine.select_option_for_replay(
                page, label, pick, xpath_smart='', element=el, exact_option=True,
            )
            return await _map_engine_select_result(raw)

        xp, src = _resolve_replay_xpath(entry, params)
        if xp:
            xpath_result = await _select_by_xpath(xp, src)
            if xpath_result is not None:
                return xpath_result

        label_result = await _select_by_label()
        if isinstance(label_result, str) and label_result.startswith('ok'):
            if element_xp:
                actual = await _read_value_by_xpath(page, element_xp, label)
                classified = _classify_fill_result(True, pick, actual)
                if classified.startswith('false_ok'):
                    return await _replay_select_final_failure(classified)
                if classified == 'ok':
                    return 'ok:locate=label'
            return _annotate_label_result(label_result)

        xpath_full = _element_xpath_full(entry) if use_relative else ''
        if xpath_full and xpath_full != xp:
            xpath_result = await _select_by_xpath(xpath_full, 'full')
            if xpath_result is not None:
                return xpath_result

        return _annotate_label_result(label_result)

    return f'unknown-form-action:{action_name}'



