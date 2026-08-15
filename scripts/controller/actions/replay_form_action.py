"""Replay one form-field op using the same JS path as auto-fill.

Extracted from _replay.py. _replay.py re-exports _replay_form_action for compat.
"""

import sys

from scripts.feature_flags import relative_xpath_primary_enabled
from ._helpers import (
    _is_ok_result,
    _wait_if_loading,
    absent_field_skip_result,
    is_absent_field_result,
    reset_select_ui,
)
from ._js_snippets import (
    JS_CLICK_RADIO,
    JS_FILL_BY_XPATH,
    JS_FILL_FORM_FIELD,
    JS_FIND_LABELED_SELECT,
    JS_SELECT_OPTION,
    JS_SELECT_TRIGGER_BY_XPATH,
    JS_SELECT_VALUE_BY_XPATH,
    JS_SELECT_TREE_OPTION,
)
from .replay_js import _JS_LOCATE_BY_XPATH, _JS_READ_VALUE_BY_XPATH


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
        ph = placeholder
        element_xp = _element_xpath_smart(entry) if use_relative else ''

        async def _try_xpath_fill(xpath: str, locate_src: str) -> str | None:
            # Prefer label_text so shared placeholder xpaths disambiguate form-items
            # (traj 130: //input[@placeholder='请输入'][1] + last-visible → 名称).
            # Also exact-match prefix labels (财务部联系人 vs …手机号码).
            hint = label or ph
            result = await page.evaluate(JS_FILL_BY_XPATH, [xpath, value, hint])
            action_ok = isinstance(result, str) and result.startswith('ok')
            actual = await _read_value_by_xpath(page, xpath, hint) if xpath else ''
            classified = _classify_fill_result(action_ok, value, actual)
            if classified == 'ok':
                await page.wait_for_timeout(300)
                return f'ok:locate={locate_src}'
            if classified.startswith('false_ok'):
                await page.wait_for_timeout(300)
                return classified
            return None

        xp, src = _resolve_replay_xpath(entry, params)
        if xp:
            xpath_result = await _try_xpath_fill(xp, src)
            if xpath_result:
                return xpath_result

        result = await page.evaluate(JS_FILL_FORM_FIELD, [label, value])
        if isinstance(result, str) and result.startswith('ok'):
            await page.wait_for_timeout(300)
            if element_xp:
                actual = await _read_value_by_xpath(page, element_xp, label)
                classified = _classify_fill_result(True, value, actual)
                if classified.startswith('false_ok'):
                    return classified
                if classified == 'ok':
                    return 'ok:locate=label'
            return _annotate_label_result(str(result))
        if placeholder and placeholder != label:
            result = await page.evaluate(JS_FILL_FORM_FIELD, [placeholder, value])
            if isinstance(result, str) and result.startswith('ok'):
                await page.wait_for_timeout(300)
                if element_xp:
                    actual = await _read_value_by_xpath(page, element_xp, label)
                    classified = _classify_fill_result(True, value, actual)
                    if classified.startswith('false_ok'):
                        return classified
                    if classified == 'ok':
                        return 'ok:locate=label'
                return _annotate_label_result(str(result))
        if not label and placeholder:
            result = await page.evaluate(JS_FILL_BY_XPATH, ['', value, placeholder])
            if isinstance(result, str) and result.startswith('ok'):
                await page.wait_for_timeout(300)
                return str(result)
        xpath_full = _element_xpath_full(entry) if use_relative else ''
        if xpath_full and xpath_full != xp:
            xpath_result = await _try_xpath_fill(xpath_full, 'full')
            if xpath_result:
                return xpath_result
        final = _annotate_label_result(str(result))
        if is_absent_field_result(final) or is_absent_field_result(result):
            sys.stderr.write(
                f'[replay-fill] skip absent label={label!r} result={result!r}\n'
            )
            sys.stderr.flush()
            return absent_field_skip_result()
        return final

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
        _SENT = frozenset({'first', 'any', 'random', '1st', '第一个', '第一项'})
        if pick.lower() in _SENT or pick in _SENT:
            xp_s, src_s = _resolve_replay_xpath(entry, params)
            if xp_s:
                already = await page.evaluate(JS_SELECT_VALUE_BY_XPATH, [xp_s, label])
                if isinstance(already, str) and already.startswith('ok-already:'):
                    cur = already.split(':', 1)[1].strip()
                    if cur:
                        await page.wait_for_timeout(200)
                        return f'ok-already:{cur}|locate={src_s}|legacy-sentinel:{pick}'
            if label:
                already = await page.evaluate(JS_FIND_LABELED_SELECT, [label, 'check'])
                if isinstance(already, str) and already.startswith('ok-already:'):
                    cur = already.split(':', 1)[1].strip()
                    if cur:
                        await page.wait_for_timeout(200)
                        return f'ok-already:{cur}|locate=label|legacy-sentinel:{pick}'
            return f'bad_option_text:{pick}'

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
                    await page.wait_for_timeout(200)
                    return f'ok-already:{pick}|locate={locate_src}'

            trig = await page.evaluate(JS_SELECT_TRIGGER_BY_XPATH, [xpath, label])
            if not _is_ok_result(str(trig)):
                return None

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
                if result == 'no-items' and attempt < 2:
                    reset_diag = await reset_select_ui(page)
                    if not reset_diag.get('closed', False):
                        sys.stderr.write(
                            f'[replay-select] retrigger reset incomplete xpath={xpath!r} reset={reset_diag}\n'
                        )
                        sys.stderr.flush()
                        result = 'no-items'
                        break
                    retrigger = await page.evaluate(JS_SELECT_TRIGGER_BY_XPATH, [xpath, label])
                    if not _is_ok_result(str(retrigger)):
                        result = str(retrigger)
                        break

            if isinstance(result, str) and result.startswith('ok'):
                got = result.split(':', 1)[1].strip() if ':' in result else ''
                if got and got != pick:
                    return await _replay_select_final_failure(f'option-mismatch:want={pick}|got={got}')
                actual = await _read_value_by_xpath(page, xpath, label)
                classified = _classify_fill_result(True, pick, actual)
                await page.wait_for_timeout(500)
                if classified.startswith('false_ok'):
                    return await _replay_select_final_failure(classified)
                return f'ok:locate={locate_src}'

            return await _replay_select_final_failure(str(result))

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
                    await page.wait_for_timeout(200)
                    return already

            trigger_result = await page.evaluate(JS_FIND_LABELED_SELECT, [label, 'trigger'])
            if trigger_result in ('label-not-found', 'no-select-found', 'select-disabled'):
                return await _replay_select_final_failure(str(trigger_result))

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
                if result == 'no-items' and attempt < 2:
                    reset_diag = await reset_select_ui(page)
                    if not reset_diag.get('closed', False):
                        sys.stderr.write(
                            f'[replay-select] retrigger reset incomplete label={label!r} reset={reset_diag}\n'
                        )
                        sys.stderr.flush()
                        result = 'no-items'
                        break
                    retrigger = await page.evaluate(JS_FIND_LABELED_SELECT, [label, 'trigger'])
                    if not _is_ok_result(str(retrigger)):
                        result = str(retrigger)
                        break

            if isinstance(result, str) and result.startswith('ok'):
                got = result.split(':', 1)[1].strip() if ':' in result else ''
                if got and got != pick:
                    return await _replay_select_final_failure(f'option-mismatch:want={pick}|got={got}')
                confirmed = await page.evaluate(JS_FIND_LABELED_SELECT, [label, 'confirm'])
                if isinstance(confirmed, str) and confirmed.startswith('ok-confirmed:'):
                    cur = confirmed.split(':', 1)[1].strip()
                    if cur and cur != pick:
                        return await _replay_select_final_failure(f'option-mismatch:want={pick}|got={cur}')
                elif not (isinstance(confirmed, str) and confirmed.startswith('ok-confirmed:')):
                    await page.evaluate(JS_FILL_FORM_FIELD, [label, pick])
                    await page.wait_for_timeout(200)
                    confirmed2 = await page.evaluate(JS_FIND_LABELED_SELECT, [label, 'confirm'])
                    if isinstance(confirmed2, str) and confirmed2.startswith('ok-confirmed:'):
                        cur = confirmed2.split(':', 1)[1].strip()
                        if cur != pick:
                            return await _replay_select_final_failure(f'option-mismatch:want={pick}|got={cur}')
                        result = confirmed2
                    else:
                        return await _replay_select_final_failure(
                            f'option-not-synced:want={pick}|confirm={confirmed2}'
                        )
            await page.wait_for_timeout(500)
            if isinstance(result, str) and result.startswith('ok'):
                return str(result)
            return await _replay_select_final_failure(str(result))

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



