"""Auto-fill engine for form assistant (ensure-scanned + batch LLM fill rounds).

Extracted from _form.py to shrink the god module. Behavior-preserving:
``_register_form_actions`` instantiates ``FormAutofillEngine`` and aliases
``_ensure_scanned = engine.ensure_scanned`` so existing action bodies are
unchanged.
"""

import json
import sys

from scripts.state import (
    _ACTION_LOG,
    capture_page_png_b64_from_page,
    record_action_with_screenshots,
)
from ._helpers import (
    _as_dict,
    _ok,
    _is_ok_result,
    is_absent_field_result,
    absent_field_skip_result,
    should_record_result,
    _wait_if_loading,
    _capture_element,
    reset_select_ui,
    stamp_recorded_xpath_smart,
)
from ._js_snippets import (
    JS_GET_CONTAINER,
    JS_IDENTIFY_CONTAINER,
    JS_SCAN_FORM_FIELDS,
    JS_FILL_BY_XPATH,
    JS_FILL_DATE_BY_XPATH,
    JS_FIND_LABELED_SELECT,
    JS_SELECT_OPTION,
    JS_SELECT_TRIGGER_BY_XPATH,
    JS_SELECT_VALUE_BY_XPATH,
    JS_CLICK_RADIO_BY_XPATH,
    JS_SELECT_TREE_OPTION,
    JS_FILL_FORM_FIELD,
    JS_CLICK_VERIFY_BUTTON,
    JS_READ_REFERENCE_DATE,
)
from ._llm_values import _llm_generate_values
from .replay_timing import WAIT_300_MS, WAIT_350_MS, WAIT_500_MS
from ...models import ScannedField, TaskList, TaskItem
from .form_rules import (
    match_cert_number,
    _gen_name,
    normalize_lat_lng_value,
)
from .form_scan_utils import (
    _is_search_dialog,
    _force_refill_flag,
    _scan_buttons_from_result,
    _skip_auto_fill,
    _mark_query_ui_if_needed,
    prepare_scan_fields_for_tasklist,
    tasklist_scan_mode,
    _pack_select_record,
    resolve_recorded_option_text,
    select_option_already_matched,
    _JS_READ_CERT_TYPE,
    _save_form_snapshot,
    _resolve_control,
    _task_done_impl,
    _switch_task_list_container,
)


async def _execute_round_impl(self, page, items, label_kind, all_results, round_tag):
    """分组 → LLM 规划 → 逐个执行。round_tag: '' | 'round2 ' | 'round3 '"""
    from .section_scope import section_matches

    filt = (self.business_data_store.get('_assistant_section_filter') or '').strip()

    def _field_dict_for_action(sub, action, action_index):
        action_xp = (action.get('xpath_smart') or '').strip()
        if action_xp:
            for d in sub:
                if (d.get('xpath_smart') or '').strip() == action_xp:
                    return d
        if action_index < len(sub) and sub[action_index].get('label') == action.get('label'):
            return sub[action_index]
        label = action.get('label', '')
        matches = [d for d in sub if d.get('label') == label]
        if len(matches) == 1:
            return matches[0]
        if len(matches) > 1:
            xps = {
                (d.get('xpath_smart') or '').strip()
                for d in matches
                if (d.get('xpath_smart') or '').strip()
            }
            # Identical xpath (or none) → safe; ≥2 distinct → omit (ambiguous)
            if len(xps) <= 1:
                return matches[0]
            return {}
        return {}

    async def _select_by_xpath(page, value, xpath_smart, label=''):
        """Xpath-only select open+pick (Phase A hard-cut — no labeled fallback)."""
        xp = (xpath_smart or '').strip()
        if not xp:
            return 'xpath-not-found'
        hint = (label or '').strip()
        reset_diag = await reset_select_ui(page)
        if not reset_diag.get('closed', False):
            sys.stderr.write(
                f'[auto-fill] select preflight reset incomplete xpath={xp!r} reset={reset_diag}\n'
            )
            sys.stderr.flush()
            return 'no-items'
        already = await page.evaluate(JS_SELECT_VALUE_BY_XPATH, [xp, hint])
        if str(already).startswith('ok-already:'):
            cur_val = already.split(':', 1)[1]
            if select_option_already_matched(value, cur_val):
                return already
        trigger = await page.evaluate(JS_SELECT_TRIGGER_BY_XPATH, [xp, hint])
        if not str(trigger).startswith('ok'):
            diag = await reset_select_ui(page)
            sys.stderr.write(
                f'[auto-fill] select failure xpath={xp!r} result={trigger!r} reset={diag}\n'
            )
            sys.stderr.flush()
            return trigger
        await page.wait_for_timeout(WAIT_350_MS)
        result = await page.evaluate(JS_SELECT_OPTION, value)
        if str(result).startswith('option-not-found:'):
            result = await page.evaluate(JS_SELECT_OPTION, 'first')
        if str(result) == 'no-items':
            recheck = await page.evaluate(JS_SELECT_VALUE_BY_XPATH, [xp, hint])
            if str(recheck).startswith('ok-already:'):
                return recheck
        if not _is_ok_result(str(result)):
            diag = await reset_select_ui(page)
            sys.stderr.write(
                f'[auto-fill] select failure xpath={xp!r} result={result!r} reset={diag}\n'
            )
            sys.stderr.flush()
        return result

    async def _select_by_label_autofill(page, value, label):
        """Labeled select open+pick for tree-select xpath-less fallback."""
        reset_diag = await reset_select_ui(page)
        if not reset_diag.get('closed', False):
            sys.stderr.write(
                f'[auto-fill] select preflight reset incomplete label={label!r} reset={reset_diag}\n'
            )
            sys.stderr.flush()
            return 'no-items'
        sel_try = await page.evaluate(JS_FIND_LABELED_SELECT, [label, 'trigger'])
        if not sel_try or str(sel_try).startswith('label-not-found'):
            return sel_try or 'label-not-found'
        await page.wait_for_timeout(WAIT_350_MS)
        opt = value if (value or '').strip() and (value or '').strip().lower() != 'first' else 'first'
        sel_result = await page.evaluate(JS_SELECT_OPTION, opt)
        if not _is_ok_result(str(sel_result)):
            diag = await reset_select_ui(page)
            sys.stderr.write(
                f'[auto-fill] select failure label={label!r} result={sel_result!r} reset={diag}\n'
            )
            sys.stderr.flush()
        return sel_result

    KIND_ORDER = {'date': 0, 'select': 1, 'input': 2, 'radio': 3, 'checkbox': 4, 'tree-select': 5}
    groups: dict[int, list[dict]] = {}
    for d in items:
        if filt and not section_matches(filt, d.get('section_id', ''), d.get('section_title', ''), d.get('region_label', '')):
            continue
        # Skip needs_intervention — only auto-fill fillable fields
        if d.get('disabled') and d.get('hasButton'):
            continue
        idx = KIND_ORDER.get(label_kind.get(d['label'], 'input'), 99)
        groups.setdefault(idx, []).append(d)

    for idx in sorted(groups.keys()):
        sub = groups[idx]
        if not sub:
            continue
        kind_name = {0: 'date', 1: 'select', 2: 'input', 3: 'radio', 4: 'checkbox', 5: 'tree-select'}.get(idx, 'other')
        await page.evaluate(
            's => console.log("[AI填表] 分组 " + s)',
            f'{kind_name}: {len(sub)}个字段',
        )

        # ---- Cross-field: cert type -> cert number / customer name ----
        # Only fill gaps — never overwrite user business_data presets (commandValue).
        if idx == KIND_ORDER['input']:
            _has_cert_num = any(
                '证件号码' in (d.get('label', '') or '') or '证件号' in (d.get('label', '') or '')
                for d in sub
            )
            if _has_cert_num:
                try:
                    _ct = await page.evaluate(_JS_READ_CERT_TYPE, ['证件类型', '证照类型', '证件种类'])
                except Exception:
                    _ct = ''
                _ov = match_cert_number(_ct or '')
                for d in sub:
                    lbl = d.get('label', '') or ''
                    if '证件号码' in lbl or '证件号' in lbl:
                        if d.get('commandValue') and str(d.get('commandValue')).strip():
                            sys.stderr.write(
                                f'[cert-detect] keep business_data cert_number={d["commandValue"]!r}\n'
                            )
                            sys.stderr.flush()
                        else:
                            d['commandValue'] = _ov
                            sys.stderr.write(
                                f'[cert-detect] cert_type="{_ct}" -> cert_number override: {_ov}\n'
                            )
                            sys.stderr.flush()
                        break
                # ---- Cross-field: cert type -> customer name ----
                _has_cust_name = any(
                    '客户名称' in (d.get('label', '') or '') or '客户姓名' in (d.get('label', '') or '')
                    for d in sub
                )
                if _has_cust_name:
                    if _ct and ('统一社会信用代码' in _ct or '营业执照' in _ct):
                        _name_ov = '测试科技发展有限公司'
                    else:
                        _name_ov = _gen_name()
                    for d_name in sub:
                        nlbl = d_name.get('label', '') or ''
                        if '客户名称' in nlbl or '客户姓名' in nlbl:
                            if d_name.get('commandValue') and str(d_name.get('commandValue')).strip():
                                sys.stderr.write(
                                    f'[cert-detect] keep business_data name={d_name["commandValue"]!r}\n'
                                )
                                sys.stderr.flush()
                            else:
                                d_name['commandValue'] = _name_ov
                                sys.stderr.write(
                                    f'[cert-detect] cert_type="{_ct}" -> customer name: {_name_ov}\n'
                                )
                                sys.stderr.flush()
                            break

        cache = self.business_data_store.get('_generated_value_cache', {})
        for d in sub:
            lbl = d.get('label', '') or ''
            if lbl in cache and not (d.get('commandValue') and str(d.get('commandValue')).strip()):
                d['commandValue'] = cache[lbl]

        # C3: same-section field list for cross-field value↔option suggestion.
        cross_fields = [
            d for d in items
            if not filt or section_matches(filt, d.get('section_id', ''), d.get('section_title', ''), d.get('region_label', ''))
        ]
        actions, needs = _llm_generate_values(
            self.llm, sub, business_data_store=self.business_data_store, section=filt,
            cross_fields=cross_fields,
        )
        if idx == KIND_ORDER['select']:
            from .cascade_fill import append_select_first_fallbacks
            actions, needs = append_select_first_fallbacks(actions, needs, sub)
        if needs:
            self.business_data_store.setdefault('_assistant_needs_agent', []).extend(needs)
        await page.evaluate(
            'd => console.log("[AI填表] 所有动作(" + d.length + "): " + JSON.stringify(d.map(a => a.label + "=" + (a.value||a.option||""))))',
            actions,
        )

        # Build hasButton lookup for post-fill actions (e.g. phone verify)
        has_button_map = {d.get('label', ''): d.get('hasButton', '') for d in items}

        total = len(actions)
        ok_in_group = 0
        fail_in_group = 0
        for i, a in enumerate(actions):
            label = a.get('label', '')
            kind = (a.get('action') or '').lower().replace('-', '_')
            value = a.get('value', '') or a.get('option', '')
            field_kind = label_kind.get(label, kind)
            field_dict = _field_dict_for_action(sub, a, i)
            xpath_smart = (
                a.get('xpath_smart') or field_dict.get('xpath_smart') or ''
            ).strip()
            resolve_error = ''
            if not xpath_smart:
                resolved = _resolve_control(self.business_data_store, label, '')
                if not resolved.error:
                    xpath_smart = resolved.xpath_smart
                    if resolved.label:
                        label = resolved.label
                else:
                    # Plumb ambiguous-label / xpath-not-found (do not collapse)
                    resolve_error = resolved.error
            placeholder = field_dict.get('placeholder') or label
            step_num = i + 1
            value = normalize_lat_lng_value(label, value)
            # Pre-mutation locator snapshot (same contract as explicit fill/select/radio actions)
            if field_kind == 'radio' or kind in ('click_radio', 'radio'):
                capture_kind = 'form_radio'
            elif field_kind == 'tree-select' or kind in (
                'fill_tree', 'select_tree_option', 'tree_select', 'treeselect',
            ):
                capture_kind = 'form_tree_select'
            elif field_kind == 'date':
                capture_kind = 'form_date'
            elif kind in ('select_option', 'select', 'option'):
                capture_kind = 'form_select'
            else:
                capture_kind = 'form_input'
            element = await _capture_element(
                page, label, target_kind=capture_kind, xpath_smart=xpath_smart,
            )
            # before shot must precede DOM mutation (auto-fill bypasses controller.action wrap)
            before_b64 = None
            try:
                before_b64 = await capture_page_png_b64_from_page(page)
            except Exception:
                before_b64 = None
            try:
                is_tree = field_kind == 'tree-select' or kind in (
                    'fill_tree', 'select_tree_option', 'tree_select', 'treeselect',
                )
                if not xpath_smart and not is_tree:
                    result = resolve_error or 'xpath-not-found'
                elif kind in ('fill_input', 'fill', 'input'):
                    if field_kind == 'date':
                        result = await page.evaluate(
                            JS_FILL_DATE_BY_XPATH, [xpath_smart, value],
                        )
                    else:
                        result = await page.evaluate(
                            JS_FILL_BY_XPATH, [xpath_smart, value, placeholder],
                        )
                elif field_kind == 'radio' or kind in ('click_radio', 'radio'):
                    result = await page.evaluate(
                        JS_CLICK_RADIO_BY_XPATH, [xpath_smart, value],
                    )
                elif field_kind == 'checkbox' or kind == 'checkbox':
                    result = await page.evaluate(
                        JS_CLICK_RADIO_BY_XPATH, [xpath_smart, value],
                    )
                elif is_tree:
                    result = await page.evaluate(JS_SELECT_TREE_OPTION, [label, value])
                    # Non-Tssc "tree-looking" fields: prefer resolve+xpath when store has xpath
                    if not _is_ok_result(result) and str(result or '').startswith('no-tree-component'):
                        fill_val = (value or '').strip()
                        if fill_val and fill_val.lower() != 'first':
                            if xpath_smart:
                                fill_try = await page.evaluate(
                                    JS_FILL_BY_XPATH, [xpath_smart, fill_val, label],
                                )
                            else:
                                fill_try = await page.evaluate(JS_FILL_FORM_FIELD, [label, fill_val])
                            if _is_ok_result(fill_try):
                                result = fill_try
                                kind = 'fill_input'
                                field_kind = 'input'
                                capture_kind = 'form_input'
                                element = await _capture_element(
                                    page, label, target_kind='form_input',
                                    xpath_smart=xpath_smart,
                                )
                        if not _is_ok_result(result):
                            if xpath_smart:
                                sel_result = await _select_by_xpath(page, fill_val, xpath_smart, label)
                                if _is_ok_result(sel_result):
                                    result = sel_result
                                    kind = 'select_option'
                                    field_kind = 'select'
                                    capture_kind = 'form_select'
                                    element = await _capture_element(
                                        page, label, target_kind='form_select', xpath_smart=xpath_smart,
                                    )
                            else:
                                sel_result = await _select_by_label_autofill(page, fill_val, label)
                                if _is_ok_result(sel_result):
                                    result = sel_result
                                    kind = 'select_option'
                                    field_kind = 'select'
                                    capture_kind = 'form_select'
                                    element = await _capture_element(
                                        page, label, target_kind='form_select',
                                    )
                elif kind in ('select_option', 'select', 'option'):
                    result = await _select_by_xpath(page, value, xpath_smart, label)
                else:
                    result = f'unknown-action:{kind}'
            except Exception as e:
                result = f'error:{e}'

            ok = _is_ok_result(result)
            if is_absent_field_result(result):
                result = absent_field_skip_result()
                ok = True
            entry = {'index': step_num, 'action': kind, 'label': label, 'value': value, 'result': result}
            all_results.append(entry)

            if ok and should_record_result(result):
                ok_in_group += 1
                xp_inv = stamp_recorded_xpath_smart(element, xpath_smart)
                if field_kind == 'radio' or kind in ('click_radio', 'radio'):
                    await record_action_with_screenshots(
                        page,
                        'click_radio',
                        {
                            'label_text': label,
                            'option_text': value,
                        },
                        result,
                        element=element,
                        before_b64=before_b64,
                    )
                elif kind in ('fill_input', 'fill', 'input') and field_kind != 'tree-select':
                    await record_action_with_screenshots(
                        page,
                        'fill_form_field',
                        {
                            'label_text': label,
                            'value': value,
                        },
                        result,
                        element=element,
                        before_b64=before_b64,
                    )
                elif field_kind == 'tree-select' or kind in (
                    'fill_tree', 'select_tree_option', 'tree_select', 'treeselect',
                ):
                    await record_action_with_screenshots(
                        page,
                        'select_tree_option',
                        {'label_text': label, 'option_text': value},
                        result,
                        element=element,
                        before_b64=before_b64,
                    )
                elif kind in ('select_option', 'select', 'option'):
                    if field_kind == 'radio':
                        await record_action_with_screenshots(
                            page,
                            'click_radio',
                            {
                                'label_text': label,
                                'option_text': value,
                            },
                            result,
                            element=element,
                            before_b64=before_b64,
                        )
                    else:
                        # Stamp concrete option from result (ok:X / ok-already:X)
                        actual = ''
                        rs = str(result or '')
                        if rs.startswith('ok-already:'):
                            actual = rs.split(':', 1)[1].split('|', 1)[0].strip()
                        elif rs.startswith('ok:') or (rs.startswith('ok') and ':' in rs):
                            actual = rs.split(':', 1)[1].split('|', 1)[0].strip()
                        stamped = resolve_recorded_option_text(value, actual)
                        params, element = await _pack_select_record(
                            page, self.business_data_store, label, stamped, element,
                        )
                        params['option_text'] = stamped
                        await record_action_with_screenshots(
                            page,
                            'select_option',
                            params,
                            result,
                            element=element,
                            before_b64=before_b64,
                        )
                _task_done_impl(
                    label, self.business_data_store, value=value, xpath_smart=xp_inv,
                )
                # Phone verify: fill_input 成功后如果有"验证"按钮，自动点击
                btn = has_button_map.get(label, '')
                if '验证' in btn and kind in ('fill_input', 'fill', 'input'):
                    try:
                        await page.evaluate(JS_CLICK_VERIFY_BUTTON, [label])
                    except Exception:
                        pass
                prefix = f'[auto-fill] {round_tag}recorded:' if round_tag else '[auto-fill] recorded:'
                sys.stderr.write(f'{prefix} {kind} "{label}" = {value} (total: {len(_ACTION_LOG)})\n')
                sys.stderr.flush()
                status = 'ok' if ok else f'FAILED:{result}'
                await page.evaluate(
                    'o => console.log("[AI填表] 执行进度 ======\\n" + o)',
                    f'{step_num}/{total} {kind} "{label}" → {status}',
                )
            elif ok:
                # ok-skip:label-not-found — clear pending, do not write trajectory
                ok_in_group += 1
                _task_done_impl(label, self.business_data_store)
                sys.stderr.write(
                    f'[auto-fill] {round_tag}skip-absent: "{label}" ({result})\n'
                )
                sys.stderr.flush()
                await page.evaluate(
                    'o => console.log("[AI填表] 执行进度 ======\\n" + o)',
                    f'{step_num}/{total} {kind} "{label}" → skip-absent',
                )
            else:
                fail_in_group += 1
                await page.evaluate(
                    'o => console.log("[AI填表] FAIL: " + o)',
                    f'{step_num}/{total} {kind} "{label}" → {result}',
                )

            await page.wait_for_timeout(WAIT_500_MS if kind in ('select_option', 'select', 'option') else WAIT_300_MS)

        await page.evaluate(
            's => console.log("[AI填表] 本组完成: " + s)',
            f'{total}个动作 | ok:{ok_in_group} failed:{fail_in_group}',
        )



