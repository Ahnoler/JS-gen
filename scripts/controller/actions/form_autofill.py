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
)
from ._llm_values import _llm_generate_values
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


class FormAutofillEngine:
    """Bundle the shared state used by the form auto-fill engine.

    The engine owns ensure_scanned (container touch + optional batch scan)
    and the three LLM fill rounds (_execute_round / _scan_new_fields /
    _auto_fill_pending), which the actions and run_form_assistant drive.
    """

    def __init__(self, browser_context, case_data_store, llm, button_keywords):
        self.browser_context = browser_context
        self.case_data_store = case_data_store
        self.llm = llm
        self.button_keywords = button_keywords

    async def ensure_scanned(self, label_text: str, *, allow_autofill: bool = False):
        """Container touch; optional batch scan + auto-fill.

        Single-field actions call with allow_autofill=False (default) — update
        container context / query detection. On first touch of a container
        (no ``_scan_fields`` yet) also scan + save_form_snapshot, without autofill.

        run_form_assistant calls with allow_autofill=True to batch-scan and
        auto-fill when the phase contract allows.

        Auto-fill skipped when:
        - query / search toolbar (有查询无保存)
        - form_modify partial — AI changes only task-named fields
        - _watcher_mode (CDP quick actions)
        """
        if self.case_data_store.get('_watcher_mode'):
            return  # CDP watcher: single-field action, no auto-scan
        page = await self.browser_context.get_current_page()
        container_id = await page.evaluate(JS_IDENTIFY_CONTAINER)
        from scripts.controller.actions.container_naming import (
            resolve_display_container,
            clear_trigger_button,
        )
        display_id = resolve_display_container(container_id, self.case_data_store)
        if display_id == 'main' or not str(display_id).startswith(('dialog:', 'drawer:')):
            if (self.case_data_store.get('_active_container') or '').startswith(('dialog:', 'drawer:')):
                clear_trigger_button(self.case_data_store)
        container_id = display_id

        # Remember parent before entering search/picker dialog
        if _is_search_dialog(container_id) or (
            container_id.startswith(('dialog:', 'drawer:'))
            and self.case_data_store.get('_active_container')
            and not str(self.case_data_store.get('_active_container')).startswith(('dialog:', 'drawer:'))
        ):
            if not self.case_data_store.get('_parent_container_before_picker'):
                self.case_data_store['_parent_container_before_picker'] = (
                    self.case_data_store.get('_active_container') or 'main'
                )

        _switch_task_list_container(self.case_data_store, container_id)

        async def _rebuild_task_list_from_dom(*, autofill: bool) -> None:
            # Overlay TaskList uses multi (not fullpage) so list/tree query noise
            # is not mixed into dialog/drawer pending — see tasklist_scan_mode.
            scan_mode = tasklist_scan_mode(container_id)
            raw = await page.evaluate(
                JS_SCAN_FORM_FIELDS,
                [False, self.button_keywords(), {'mode': scan_mode}],
            )
            try:
                result = _as_dict(raw)
                raw_fields = result.get('fields') if isinstance(result, dict) else result
            except Exception:
                return
            fillable = prepare_scan_fields_for_tasklist(raw_fields)
            dom_fields = [ScannedField(**f) if isinstance(f, dict) else f for f in fillable]
            raw_cid = result.get('container', container_id) if isinstance(result, dict) else container_id
            cid = resolve_display_container(raw_cid, self.case_data_store)
            _switch_task_list_container(self.case_data_store, cid)
            _save_form_snapshot(cid, [f.model_dump() for f in dom_fields], self.case_data_store)
            self.case_data_store['_scan_buttons'] = _scan_buttons_from_result(result)
            session_filled = set(self.case_data_store.get('_autofilled_labels') or [])
            tl = TaskList.from_scan(
                [f.model_dump() for f in dom_fields],
                force_refill=_force_refill_flag(self.case_data_store),
                session_filled_labels=session_filled,
            )
            self.case_data_store['task_list'] = tl.to_store()
            self.case_data_store['_scan_fields'] = [f.model_dump() for f in dom_fields]
            by = self.case_data_store.setdefault('_task_lists_by_container', {})
            if isinstance(by, dict):
                by[cid] = {
                    'task_list': self.case_data_store.get('task_list'),
                    '_scan_fields': self.case_data_store.get('_scan_fields'),
                }
            if autofill and tl.pending:
                await self._auto_fill_pending()
                tl_after = TaskList.from_store(self.case_data_store.get('task_list'))
                fillable_left = sum(1 for i in tl_after.pending if not i.needs_intervention)
                self.case_data_store['_autofill_summary'] = (
                    f'auto-fill-complete done={len(tl_after.done)} '
                    f'fillable_pending={fillable_left}'
                )
                if fillable_left == 0:
                    self.case_data_store['_submit_ready'] = True
                if isinstance(by, dict):
                    by[cid] = {
                        'task_list': self.case_data_store.get('task_list'),
                        '_scan_fields': self.case_data_store.get('_scan_fields'),
                    }

        # Force rescan when parent marked stale after picker close
        stale = self.case_data_store.get('_form_stale')
        if stale and stale == container_id:
            self.case_data_store.pop('_form_stale', None)
            sys.stderr.write(f'[form] force rescan stale container={container_id}\n')
            sys.stderr.flush()
            if not allow_autofill:
                await _rebuild_task_list_from_dom(autofill=False)
                return
            self.case_data_store.pop('task_list', None)
            self.case_data_store.pop('_scan_fields', None)

        is_query_ui = await _mark_query_ui_if_needed(page, self.case_data_store, container_id)
        if is_query_ui:
            # Introduce/picker/search still needs _scan_fields so fill_form_field
            # can resolve xpath (traj #38 phase 3: 客户名称 → xpath-not-found
            # when query-toolbar early-return skipped the inventory scan).
            # Never auto-fill query UI — agent chooses which filters to write.
            if not self.case_data_store.get('_scan_fields'):
                sys.stderr.write(
                    f'[form] first-touch query-ui scan container={container_id!r}\n'
                )
                sys.stderr.flush()
                await _rebuild_task_list_from_dom(autofill=False)
            return
        if not allow_autofill:
            # First touch of this container (fresh switch clears _scan_fields;
            # restored containers keep it) — scan + structure checkpoint only.
            if not self.case_data_store.get('_scan_fields'):
                sys.stderr.write(
                    f'[form] first-touch structure scan container={container_id!r}\n'
                )
                sys.stderr.flush()
                await _rebuild_task_list_from_dom(autofill=False)
            return
        if _skip_auto_fill(self.case_data_store):
            # form_modify partial (or query flagged without DOM yet)
            return

        tl = TaskList.from_store(self.case_data_store.get('task_list'))
        if tl.total > 0:
            pending_labels = {d.label for d in tl.pending}
            done_labels = {d.label for d in tl.done}
            if label_text in pending_labels or label_text in done_labels:
                return  # already scanned for this form

        sys.stderr.write(
            f'[form] rescan triggered label_text={label_text!r} container={container_id!r} '
            f'tl.total={tl.total} force_refill={_force_refill_flag(self.case_data_store)}\n'
        )
        sys.stderr.flush()
        await _rebuild_task_list_from_dom(autofill=True)


    async def _execute_round(self, page, items, label_kind, all_results, round_tag):
        """分组 → LLM 规划 → 逐个执行。round_tag: '' | 'round2 ' | 'round3 '"""
        from .section_scope import section_matches

        filt = (self.case_data_store.get('_assistant_section_filter') or '').strip()

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
            await page.wait_for_timeout(350)
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
            await page.wait_for_timeout(350)
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
            # Only fill gaps — never overwrite user case_data presets (commandValue).
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
                                    f'[cert-detect] keep case_data cert_number={d["commandValue"]!r}\n'
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
                                        f'[cert-detect] keep case_data name={d_name["commandValue"]!r}\n'
                                    )
                                    sys.stderr.flush()
                                else:
                                    d_name['commandValue'] = _name_ov
                                    sys.stderr.write(
                                        f'[cert-detect] cert_type="{_ct}" -> customer name: {_name_ov}\n'
                                    )
                                    sys.stderr.flush()
                                break

            cache = self.case_data_store.get('_generated_value_cache', {})
            for d in sub:
                lbl = d.get('label', '') or ''
                if lbl in cache and not (d.get('commandValue') and str(d.get('commandValue')).strip()):
                    d['commandValue'] = cache[lbl]

            actions, needs = _llm_generate_values(
                self.llm, sub, case_data_store=self.case_data_store, section=filt,
            )
            if idx == KIND_ORDER['select']:
                from .cascade_fill import append_select_first_fallbacks
                actions, needs = append_select_first_fallbacks(actions, needs, sub)
            if needs:
                self.case_data_store.setdefault('_assistant_needs_agent', []).extend(needs)
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
                    resolved = _resolve_control(self.case_data_store, label, '')
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
                                page, self.case_data_store, label, stamped, element,
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
                        label, self.case_data_store, value=value, xpath_smart=xp_inv,
                    )
                    # Phone verify: fill_input 成功后如果有"验证"按钮，自动点击
                    btn = has_button_map.get(label, '')
                    if '验证' in btn and kind in ('fill_input', 'fill', 'input'):
                        try:
                            await page.evaluate('''([lbl]) => {
                                const container = ''' + JS_GET_CONTAINER + ''';
                                for (const item of container.querySelectorAll('.el-form-item')) {
                                    const t = item.querySelector('.el-form-item__label')?.textContent?.trim() || '';
                                    if (!t.includes(lbl)) continue;
                                    for (const b of item.querySelectorAll('button')) {
                                        if (b.offsetParent !== null && b.textContent.includes('验证')) {
                                            b.click(); return 'ok-verify-clicked';
                                        }
                                    }
                                }
                                return 'no-verify-btn';
                            }''', [label])
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
                    _task_done_impl(label, self.case_data_store)
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

                await page.wait_for_timeout(500 if kind in ('select_option', 'select', 'option') else 300)

            await page.evaluate(
                's => console.log("[AI填表] 本组完成: " + s)',
                f'{total}个动作 | ok:{ok_in_group} failed:{fail_in_group}',
            )


    def _scan_new_fields(self, dom_fields, tl):
        """扫描新字段：差值过滤 + TaskItem 创建。返回 new_pending dicts。"""
        from .section_scope import section_matches

        filt = (self.case_data_store.get('_assistant_section_filter') or '').strip()
        known_labels = {d.label for d in tl.pending} | {d.label for d in tl.done}
        new_pending: list[dict] = []
        for f in dom_fields:
            if not f.label or f.label in known_labels or f.currentValue.strip():
                continue
            if filt and not section_matches(filt, f.section_id, f.section_title, getattr(f, 'region_label', '') or ''):
                continue
            if f.disabled:
                # Disabled / introduce (disabled+button) — not assistant pending.
                continue
            new_pending.append(f.model_dump())
        if new_pending:
            new_labels = [d.get('label', '') for d in new_pending]
            for d in new_pending:
                item = TaskItem(**{k: v for k, v in d.items() if k != 'commandValue'})
                item.needs_intervention = False
                tl.pending.append(item)
            self.case_data_store['task_list'] = tl.to_store()
            # Debug: verify store has the items
            verify = TaskList.from_store(self.case_data_store.get('task_list'))
            verify_labels = {i.label for i in verify.pending}
            sys.stderr.write(f'[auto-fill] _scan_new_fields: +{len(new_pending)} new={new_labels}, done={len(tl.done)} pending={len(tl.pending)}\n')
            sys.stderr.write(f'[auto-fill] _scan_new_fields verify: store pending has {len(verify.pending)} items, labels={list(verify_labels)[:3]}...\n')
            sys.stderr.flush()
        return new_pending


    async def _auto_fill_pending(self):
        from .section_scope import section_matches

        self.case_data_store['_assistant_needs_agent'] = []
        page = await self.browser_context.get_current_page()
        await _wait_if_loading(page)
        tl = TaskList.from_store(self.case_data_store.get('task_list'))
        autofilled = set(self.case_data_store.get('_autofilled_labels') or [])
        filt = (self.case_data_store.get('_assistant_section_filter') or '').strip()
        pending = [
            item for item in tl.pending
            if not item.needs_intervention
            and not (item.label in autofilled and (item.currentValue or '').strip())
            and section_matches(filt, item.section_id, item.section_title, getattr(item, 'region_label', '') or '')
        ]

        if not pending:
            return _ok('nothing-pending')

        # 构建待填字段列表（不再用案例 KV 硬匹配灌 commandValue；场景原文由 preamble 提示）
        pending_dicts: list[dict] = []
        for item in pending:
            d = item.model_dump()
            pending_dicts.append(d)

        label_kind: dict[str, str] = {item.label: item.kind for item in pending}

        # Extract reference date from page
        try:
            ref_date = await page.evaluate('''() => {
                const dateLabels = ['成立日期', '登记日期', '注册日期', '营业起始日期', '营业开始日期'];
                const items = document.querySelectorAll('.el-form-item');
                for (const el of items) {
                    const lbl = el.querySelector('.el-form-item__label');
                    if (!lbl) continue;
                    const t = lbl.textContent.trim();
                    if (dateLabels.some(d => t.includes(d))) {
                        const inp = el.querySelector('input');
                        if (inp && inp.value && /\\d{4}-\\d{2}-\\d{2}/.test(inp.value)) {
                            return inp.value;
                        }
                    }
                }
                return '';
            }''')
            if ref_date:
                self.case_data_store['_ref_date'] = ref_date
                await page.evaluate('s => console.log("[AI填表] 参考日期: " + s)', ref_date)
        except Exception:
            pass

        # 打印待填写统计
        kind_counts: dict[str, int] = {}
        for item in pending:
            k = item.kind
            kind_counts[k] = kind_counts.get(k, 0) + 1
        summary_parts = ' '.join(f'{k}:{v}' for k, v in sorted(kind_counts.items()))
        await page.evaluate(
            's => console.log("[AI填表] 预计填写: " + s)',
            f'{len(pending)}个字段 | {summary_parts}',
        )

        all_results = []
        await self._execute_round(page, pending_dicts, label_kind, all_results, '')

        async def _cascade_round(round_tag: str, console_label: str) -> None:
            """Wait → fullpage scan → new∪still-empty worklist → execute (may be empty)."""
            from .cascade_fill import (
                filled_ok_keys_from_results,
                merge_cascade_worklist,
                still_empty_pending_dicts,
            )

            try:
                await page.wait_for_timeout(700)
                await _wait_if_loading(page)
            except Exception:
                pass
            try:
                raw = await page.evaluate(
                    JS_SCAN_FORM_FIELDS,
                    [False, self.button_keywords(), {'mode': 'fullpage'}],
                )
                result = _as_dict(raw)
                raw_fields = result.get('fields') if isinstance(result, dict) else result
            except Exception:
                raw_fields = []
            fillable = prepare_scan_fields_for_tasklist(raw_fields)
            dom_fields = [ScannedField(**f) if isinstance(f, dict) else f for f in fillable]
            tl_c = TaskList.from_store(self.case_data_store.get('task_list'))
            new_pending = self._scan_new_fields(dom_fields, tl_c)
            # Refresh tl after _scan_new_fields may have mutated store
            tl_c = TaskList.from_store(self.case_data_store.get('task_list'))
            ok_keys = filled_ok_keys_from_results(all_results)
            still = still_empty_pending_dicts(
                tl_c.pending,
                section_filter=filt,
                filled_ok_keys=ok_keys,
            )
            work = merge_cascade_worklist(new_pending, still)
            sys.stderr.write(
                f'[auto-fill] {round_tag}cascade: new={len(new_pending)} '
                f'still_empty={len(still)} work={len(work)}\n'
            )
            sys.stderr.flush()
            if not work:
                await page.evaluate(
                    's => console.log("[AI填表] " + s)',
                    f'{console_label}: 0个字段（无新字段/无剩余空项）',
                )
                return
            await page.evaluate(
                's => console.log("[AI填表] " + s)',
                f'{console_label}: {len(work)}个字段 (new={len(new_pending)} retry={len(still)})',
            )
            lk = {d['label']: d.get('kind', 'input') for d in work}
            await self._execute_round(page, work, lk, all_results, round_tag)

        # Round 2 / 3: cascade — new DOM fields ∪ still-empty pending
        await _cascade_round('round2 ', '第二轮(联动)')
        await _cascade_round('round3 ', '第三轮(深层联动)')

        # ═══════════════════════════════════════════════════════════════════
        # Step 4-6: 完成、同步（introduce disabled+button 不再入 pending / 不滚动干预）
        # ═══════════════════════════════════════════════════════════════════
        ok_count = sum(1 for r in all_results if _is_ok_result(r['result']))
        failed_count = len(all_results) - ok_count
        await page.evaluate(
            'd => console.log("[AI填表] 执行完成 ======\\n" + JSON.stringify(d))',
            all_results,
        )

        # Step 6: full scan sync — 移除不在 DOM 的 pending 字段
        try:
            raw_sync = await page.evaluate(
                JS_SCAN_FORM_FIELDS,
                [False, self.button_keywords(), {'mode': 'fullpage'}],
            )
            sync_result = _as_dict(raw_sync)
            sync_fields = sync_result.get('fields') if isinstance(sync_result, dict) else sync_result
            sync_fields = prepare_scan_fields_for_tasklist(sync_fields)
            dom_labels = {f.get('label', '') for f in sync_fields}
        except Exception:
            dom_labels = set()

        if dom_labels:
            tl_sync = TaskList.from_store(self.case_data_store.get('task_list'))
            stale = [item for item in tl_sync.pending
                     if item.label not in dom_labels and not item.needs_intervention]
            for item in stale:
                tl_sync.pending.remove(item)
                sys.stderr.write(f'[auto-fill] Removed stale pending: "{item.label}" (not in DOM)\n')
            if stale:
                self.case_data_store['task_list'] = tl_sync.to_store()
                sys.stderr.flush()

        tl_debug = TaskList.from_store(self.case_data_store.get('task_list'))
        sys.stderr.write(f'[auto-fill] DEBUG done={len(tl_debug.done)} pending={len(tl_debug.pending)}\n')
        sys.stderr.flush()
        return _ok(f'auto-fill-done | ok:{ok_count} failed:{failed_count} | ' + json.dumps(all_results, ensure_ascii=False))
