"""
Form-related actions: scan, fill, select, task list, validation.

The largest action group — registers 22 controller actions for
Element UI form interaction.
"""

import json
import re
import sys
from dataclasses import dataclass

from ...agent_utils import emit_json
from scripts.state import _record_action
from ._helpers import (
    _as_dict, _ok, _err, _is_ok_result,
    is_absent_field_result, absent_field_skip_result, should_record_result,
    _wait_if_loading, _capture_element, _merge_ax_text,
    _enrich_click_element,
    attach_select_options, options_from_scan_store, read_select_options,
    reset_select_ui,
    stamp_recorded_xpath_smart,
)
from ._js_snippets import (
    JS_GET_CONTAINER, JS_IDENTIFY_CONTAINER, JS_IS_QUERY_TOOLBAR,
    JS_CHECK_SINGLE_FIELD, JS_SCAN_FORM_FIELDS,
    JS_FILL_FORM_FIELD, JS_FILL_BY_XPATH,
    JS_CLEAR_FIELD_VALUE,
    JS_SELECT_OPTION,
    JS_SELECT_TRIGGER_BY_XPATH, JS_SELECT_VALUE_BY_XPATH, JS_LOCATOR,
    JS_CLICK_RADIO_BY_XPATH,
    JS_SELECT_TREE_OPTION, JS_EXPAND_ALL_EL_TREE,
    JS_SCROLL_TO_FIRST_ERROR,
    JS_CLICK_SAVE_BUTTON, JS_SCAN_SAVE_OUTCOME, JS_WATCH_SAVE_NOTIFICATIONS,
    JS_CLICK_LOGIN_BUTTON,
)
from ...models import (
    ScannedField, FormScanResult, Notification,
    FormSnapshot, FormSnapshotCollection,
    TaskItem, TaskList,
)
from ...models.field import ScannedButton
from .form_rules import (
    match_rule, match_cert_number, get_has_button_keywords,
    normalize_lat_lng_value,
)

from .form_scan_utils import (
    _SEARCH_DIALOG_HINTS, _QUERY_NEXT_HINT, _is_search_dialog, _force_refill_flag,
    _scan_buttons_from_result, refresh_scan_buttons, _section_group_key, _dedupe_needs_agent,
    _build_section_summary, build_editable_summary, _is_query_mode, _skip_auto_fill,
    _mark_query_ui_if_needed,
    filter_fillable_scan_fields, prepare_scan_fields_for_tasklist, tasklist_scan_mode,
    field_values_equivalent, enrich_field_value_check,
    _pack_select_record, resolve_recorded_option_text, select_option_already_matched,
    match_select_option_candidate,
    _JS_READ_CERT_TYPE, _JS_EXTRACT_ERROR_LABELS, _save_form_snapshot,
    ResolvedControl, _resolve_control, resolve_select_fallback, _task_xpath_smart, _task_done_impl,
    _submit_ready_hint, _switch_task_list_container, _with_submit_cue, _query_not_form_payload,
)

from .form_autofill import FormAutofillEngine
from .form_action_engines import (
    FillEngine, LoginEngine, RadioEngine, SelectEngine, TreeEngine,
)

async def _clear_field_value(page, label_text):
    """Clear a form field's input value by label.

    Targets the input inside .el-form-item that matches the label,
    resets its value and dispatches input/change events so Vue picks it up.
    """
    try:
        await page.evaluate(JS_CLEAR_FIELD_VALUE, label_text)
    except Exception:
        pass


def _register_form_actions(controller, browser_context, case_data_store, llm=None):
    # Lazily read hasButton keywords — supports runtime override via case_data_store
    def _button_keywords():
        return get_has_button_keywords(case_data_store)

    engine = FormAutofillEngine(browser_context, case_data_store, llm, _button_keywords)
    _ensure_scanned = engine.ensure_scanned
    _login_engine = LoginEngine(browser_context, case_data_store, engine)
    _fill_engine = FillEngine(browser_context, case_data_store, engine, _button_keywords)
    _select_engine = SelectEngine(browser_context, case_data_store, engine)
    _radio_engine = RadioEngine(browser_context, case_data_store, engine)
    _tree_engine = TreeEngine(browser_context, case_data_store, engine)

    @controller.action('Expand ALL el-tree nodes recursively (up to 10 rounds).')
    async def expand_all_el_tree():
        return await _tree_engine.expand_all_el_tree()

    @controller.action('Login to the system. Fills username + password (+ optional captcha/sms), clicks login button, waits for navigation. Use this instead of manually filling login fields one by one.')
    async def login(username: str, password: str, captcha: str = '', sms_code: str = ''):
        return await _login_engine.login(username, password, captcha, sms_code)

    @controller.action('Get a value for a form field by its label using form rules. For 证件号码, reads 证件类型 from the page and generates the matching format (身份证 → ID card, 统一社会信用代码/营业执照 → credit code). Prefers case_data_store presets when present.')
    async def match_form_rule(label_text: str):
        return await _fill_engine.match_form_rule(label_text)

    @controller.action('Fill a form field using Element UI native DOM setter. Works for text inputs AND date pickers (commits Vue v-model, including TsscMultiDatePicker).')
    async def fill_form_field(label_text: str, value: str, xpath_smart: str = ""):
        return await _fill_engine.fill_form_field(label_text, value, xpath_smart)

    @controller.action('Check the current value of a single form field by its label. Returns JSON with label/kind/currentValue/placeholder/disabled/selected/required. Use this to verify a field was filled correctly by checking currentValue.')
    async def check_field_value(label_text: str):
        return await _fill_engine.check_field_value(label_text)

    @controller.action('Verify that a form field has an expected value. Calls check_field_value and compares currentValue with expected. Returns ok if match, err if mismatch. Use this to confirm a field was filled correctly.')
    async def verify_field_value(label_text: str, expected: str):
        return await _fill_engine.verify_field_value(label_text, expected)

    @controller.action('Full scan: ALL form fields in the current dialog/drawer regardless of visibility. Builds task list + form snapshot only — does NOT auto-fill (use run_form_assistant for batch auto-fill). Returns summary {total, filled, pending, ...}.')
    async def scan_form_fields():
        page = await browser_context.get_current_page()
        await _wait_if_loading(page)
        container_id = await page.evaluate(JS_IDENTIFY_CONTAINER)
        if await _mark_query_ui_if_needed(page, case_data_store, container_id):
            return _query_not_form_payload(container_id)
        raw = await page.evaluate(
            JS_SCAN_FORM_FIELDS,
            [False, _button_keywords(), {'mode': 'fullpage'}],
        )
        try:
            result = _as_dict(raw)
            raw_fields = result.get('fields') if isinstance(result, dict) else result
        except Exception:
            return raw

        fillable = prepare_scan_fields_for_tasklist(raw_fields)
        dom_fields: list[ScannedField] = [
            ScannedField(**f) if isinstance(f, dict) else f
            for f in fillable
        ]

        try:
            ax_text = await page.aria_snapshot(mode='ai')
            if ax_text:
                _merge_ax_text(dom_fields, ax_text)
        except Exception:
            pass

        container_id = result.get('container', 'main') if isinstance(result, dict) else 'main'
        raw_notification = result.get('notification') if isinstance(result, dict) else None
        notification = Notification(**raw_notification) if raw_notification else None
        case_data_store['_scan_buttons'] = _scan_buttons_from_result(result)

        # Browse/list scan: task list only — do NOT save form structure checkpoint.
        # Structure is saved on: run_form_assistant, single-field first-touch
        # container scan, or explicit save_form_snapshot().

        # Build task list only — no auto-fill (avoids filling on browse/list pages).
        # Preserve existing done items — from_scan filters fields with values,
        # so mark_done() won't find them in pending. Create TaskItems directly.
        prev_tl = TaskList.from_store(case_data_store.get('task_list'))
        prev_done_labels = {d.label for d in prev_tl.done}
        prev_intervene = {item.label for item in prev_tl.pending if item.needs_intervention}

        session_filled = set(case_data_store.get('_autofilled_labels') or [])
        tl = TaskList.from_scan(
            [f.model_dump() for f in dom_fields],
            force_refill=_force_refill_flag(case_data_store),
            session_filled_labels=session_filled,
        )
        # Restore previously-done items — add directly to done since they won't be in pending.
        # from_scan now puts pre-filled fields in done[], so check both lists to avoid duplicates.
        # Preserve currentValue from prior done items so re-scan summaries stay accurate.
        new_pending_labels = {item.label for item in tl.pending}
        new_done_labels = {item.label for item in tl.done}
        prev_done_by_label = {d.label: d for d in prev_tl.done}
        for label in prev_done_labels:
            if label not in new_pending_labels and label not in new_done_labels:
                prev = prev_done_by_label.get(label)
                tl.done.append(TaskItem(
                    label=label,
                    kind=prev.kind if prev else 'input',
                    currentValue=prev.currentValue if prev else '',
                    options=list(prev.options) if prev else [],
                    placeholder=prev.placeholder if prev else '',
                    disabled=prev.disabled if prev else False,
                    required=prev.required if prev else False,
                    hasButton=prev.hasButton if prev else '',
                    xpath_smart=prev.xpath_smart if prev else '',
                    section_id=prev.section_id if prev else '',
                    section_title=prev.section_title if prev else '',
                    region_label=getattr(prev, 'region_label', '') if prev else '',
                ))
        # Restore needs_intervention flags on items that ended up in pending
        for item in tl.pending:
            if item.label in prev_intervene:
                item.needs_intervention = True
        case_data_store['task_list'] = tl.to_store()
        case_data_store['_scan_fields'] = [f.model_dump() for f in dom_fields]

        # Annotate fields so agent knows which were handled
        done_labels = {d.label for d in tl.done}
        for f in dom_fields:
            f.filled = f.label in done_labels

        # Build summary instead of returning all fields (~40KB → <1KB)
        pending_labels = [item.label for item in tl.pending]
        intervene = [item.label for item in tl.pending if item.needs_intervention]
        summary = {
            'container': container_id,
            'total': len(dom_fields),
            'filled': len(done_labels),
            'filled_fields': {item.label: item.currentValue for item in tl.done},
            'pending': len(pending_labels),
            'pending_labels': pending_labels,
        }
        if intervene:
            summary['disabled_button_fields'] = intervene
        if notification:
            summary['notification'] = {'visible': notification.visible, 'text': (notification.text or '')[:200]}
        summary.update(
            _build_section_summary(
                [f.model_dump() for f in dom_fields],
                case_data_store.get('_scan_buttons') or [],
                pending_labels=set(pending_labels),
            )
        )
        return json.dumps(summary, ensure_ascii=False)

    @controller.action(
        'Read-only summary of visible classified operable controls (quick full-page scan). '
        'Returns {container, scope, total, filled, pending, pending_labels, pending_items'
        '[{label, xpath_smart, kind, section}], readonly_labels, readonly_items[…], '
        'sections, buttons[{text, region_label, section, xpath_smart}], regions?}. '
        'Use xpath_smart from pending_items/buttons on fill/select/click — do not re-scan for locator. '
        'readonly_items = disabled known-kind fields for reference (do not fill). '
        'Includes shell nav when present. Does NOT build task_list, auto-fill, or run form assistant.'
    )
    async def scan_editable_summary():
        page = await browser_context.get_current_page()
        await _wait_if_loading(page)
        # Full-page L2 pool + L1 feature cards (shell included). See fullpage scan design.
        raw = await page.evaluate(
            JS_SCAN_FORM_FIELDS,
            [True, _button_keywords(), {'mode': 'fullpage'}],
        )
        try:
            result = _as_dict(raw)
        except Exception:
            return raw
        if not isinstance(result, dict):
            return _err('invalid-scan-result')
        primary_container = (result.get('container') or 'main').strip() or 'main'
        # build_editable_summary → buttons[{text, section}] (no kind/xpath).
        summary = build_editable_summary([result], primary_container=primary_container)
        try:
            from ...state import _CURRENT_PHASE
            from scripts.memory.inventory_emit import emit_editable_summary_memory
            emit_editable_summary_memory(
                summary,
                phase_number=_CURRENT_PHASE if _CURRENT_PHASE else None,
            )
        except Exception:
            pass
        return json.dumps(summary, ensure_ascii=False)

    @controller.action(
        'Batch-scan and auto-fill editable form fields in the current container. '
        'Call only when the phase contract allows form assistant (create / full modify). '
        'Do not use on navigate/query phases.'
    )
    async def run_form_assistant(section: str = '', region: str = ''):
        from ._phase_intent import contract_allows_form_assistant
        if not contract_allows_form_assistant(case_data_store):
            return 'err-form-assistant-forbidden: phase contract allow_form_assistant=false'
        page = await browser_context.get_current_page()
        await _wait_if_loading(page)
        from .section_scope import resolve_scope, remember_phase_section
        sec = resolve_scope(region, section)
        if sec:
            remember_phase_section(case_data_store, sec)
            case_data_store['_assistant_section_filter'] = sec
        try:
            await _ensure_scanned('__run_form_assistant__', allow_autofill=True)
            tl = TaskList.from_store(case_data_store.get('task_list'))
            pending_labels = {item.label for item in tl.pending}
            payload = {
                'status': case_data_store.get('_autofill_summary') or 'auto-fill-complete',
                'section_filter': sec or None,
                'needs_agent': _dedupe_needs_agent(
                    case_data_store.get('_assistant_needs_agent') or []
                ),
                **_build_section_summary(
                    case_data_store.get('_scan_fields') or [],
                    case_data_store.get('_scan_buttons') or [],
                    pending_labels=pending_labels,
                ),
            }
            return _ok(json.dumps(payload, ensure_ascii=False))
        finally:
            case_data_store.pop('_assistant_section_filter', None)

    @controller.action('Visible scan: only visible form fields (offsetParent !== null). Use this for ALL subsequent checks — much smaller output, saves context. Excludes fields already filled by auto-fill. Returns {fields: [...], notification: {visible, text}|null}.')
    async def scan_visible_fields():
        page = await browser_context.get_current_page()
        await _wait_if_loading(page)
        container_id = await page.evaluate(JS_IDENTIFY_CONTAINER)
        if await _mark_query_ui_if_needed(page, case_data_store, container_id):
            return _query_not_form_payload(container_id)
        raw = await page.evaluate(
            JS_SCAN_FORM_FIELDS,
            [True, _button_keywords(), {'mode': 'fullpage'}],
        )
        try:
            result = _as_dict(raw)
            raw_fields = result.get('fields') if isinstance(result, dict) else result
        except Exception:
            return raw

        fillable = prepare_scan_fields_for_tasklist(raw_fields)
        dom_fields: list[ScannedField] = [
            ScannedField(**f) if isinstance(f, dict) else f
            for f in fillable
        ]

        try:
            ax_text = await page.aria_snapshot(mode='ai')
            if ax_text:
                _merge_ax_text(dom_fields, ax_text)
        except Exception:
            pass

        tl = TaskList.from_store(case_data_store.get('task_list'))

        # ── 扫描校验错误：将报错字段从 done[] 移回 pending[]，清空值 ──
        try:
            error_labels = await page.evaluate(_JS_EXTRACT_ERROR_LABELS)
            error_labels_parsed = json.loads(error_labels) if isinstance(error_labels, str) else error_labels
        except Exception:
            error_labels_parsed = []
        if error_labels_parsed:
            retried = tl.sync_from_errors(error_labels_parsed)
            if retried:
                case_data_store['task_list'] = tl.to_store()
                for item in retried:
                    await _clear_field_value(page, item.label)
                sys.stderr.write(f'[scan-visible] Validation errors: {error_labels_parsed} → retried {len(retried)} field(s)\n')
                sys.stderr.flush()

        # Only show fields that still need filling (pending) — keeps failed/error fields.
        # Also keeps fields not yet tracked (safe default for dynamically shown fields).
        pending_labels = {d.label for d in tl.pending}
        done_labels = {d.label for d in tl.done}
        intervene_labels = {d.label for d in tl.pending if d.needs_intervention}
        filtered = []
        for f in dom_fields:
            if f.label in done_labels and f.label not in pending_labels:
                continue
            # Drop optional disabled fields with no adjacent button (内部评级等只读噪音)
            if f.disabled and not f.hasButton and not f.required:
                continue
            # Drop disabled fields that already have a value and no button
            if f.disabled and not f.hasButton and (f.currentValue or '').strip():
                continue
            filtered.append(f)
        dom_fields = filtered

        # If DOM quick-scan returned nothing but pending tasks exist (e.g. drawer
        # visibility quirks), surface pending items so the agent can still act.
        if not dom_fields and tl.pending:
            dom_fields = [
                ScannedField(
                    label=item.label,
                    kind=item.kind or 'input',
                    currentValue='',
                    options=list(item.options or []),
                    placeholder=item.placeholder or '',
                    disabled=bool(item.disabled),
                    required=True,
                    hasButton=item.hasButton or '',
                )
                for item in tl.pending
                if not item.needs_intervention
            ]

        container_id = result.get('container', 'main') if isinstance(result, dict) else 'main'
        raw_notification = result.get('notification') if isinstance(result, dict) else None
        notification = Notification(**raw_notification) if raw_notification else None
        payload = FormScanResult(
            container=container_id,
            fields=dom_fields,
            notification=notification,
        ).model_dump()
        if intervene_labels:
            payload['disabled_button_fields'] = sorted(intervene_labels)
        fillable = [f['label'] for f in payload['fields'] if not f.get('disabled')]
        cue = _submit_ready_hint(case_data_store)
        if cue:
            payload['NEXT_ACTION'] = cue.split('|', 1)[0].replace('NEXT_ACTION:', '').strip()
            payload['hint'] = cue
        else:
            payload['hint'] = (
                f'fillable:{len(fillable)} pending:{len(pending_labels)} '
                f'disabled_button:{len(intervene_labels)} — do NOT re-select already-filled fields; '
                f'handle disabled+button via click_adjacent_button / special-element candidates'
            )
        # Required disabled "联网核查" with empty value — nudge button click before save
        for f in payload.get('fields') or []:
            if (
                f.get('required') and f.get('disabled') and not (f.get('currentValue') or '').strip()
                and ('核查' in (f.get('label') or '') or '联网' in (f.get('label') or ''))
            ):
                payload['hint'] = (
                    f'Click adjacent 联网核查 button for "{f.get("label")}", wait_for_loading, '
                    f'then click 保存. ' + payload.get('hint', '')
                )
                break
        return json.dumps(payload, ensure_ascii=False, indent=2)

    @controller.action('Rebuild the task list from scan results (utility — does not auto-fill).')
    async def init_task_list(fields_json: str):
        try:
            data = json.loads(fields_json) if isinstance(fields_json, str) else fields_json
        except Exception:
            return _err('invalid-json')
        fields = data.get('fields') if isinstance(data, dict) else data

        session_filled = set(case_data_store.get('_autofilled_labels') or [])
        tl = TaskList.from_scan(
            fields,
            force_refill=_force_refill_flag(case_data_store),
            session_filled_labels=session_filled,
        )
        case_data_store['task_list'] = tl.to_store()
        case_data_store['_scan_fields'] = fields
        pending_count = len(tl.pending)
        return _ok(f'task-list-init | pending:{pending_count}')

    @controller.action('Save form structure snapshot for replay validation. Call after init_task_list. Records per-field metadata (label + is_required) with separate required/optional counts so assembled scripts can grade changes by severity.')
    async def save_form_snapshot():
        page = await browser_context.get_current_page()
        container_id = await page.evaluate(JS_IDENTIFY_CONTAINER)
        from scripts.controller.actions.container_naming import resolve_display_container
        container_id = resolve_display_container(container_id, case_data_store)
        fields = case_data_store.get('_scan_fields', [])

        snap = _save_form_snapshot(container_id, fields, case_data_store)
        return _ok(f'form-snapshot | container:{container_id} | count:{snap.count}')

    @controller.action('Mark a form field as completed in the task list. Use this after successfully filling a field.')
    async def task_done(label_text: str):
        _task_done_impl(label_text, case_data_store)
        tl = TaskList.from_store(case_data_store.get('task_list'))
        return _ok(f'task-done:{label_text} | remaining:{len(tl.pending)}')

    @controller.action('Get the current pending task list. Returns {"pending": [...], NEXT_ACTION}. When pending is empty, NEXT_ACTION tells you to click 保存 — do not re-fill fields.')
    async def get_pending_tasks(section: str = '', region: str = ''):
        if _is_query_mode(case_data_store):
            return _ok(_query_not_form_payload(), include_in_memory=True)
        from .section_scope import section_matches, pending_by_section, pending_by_region, resolve_scope
        tl = TaskList.from_store(case_data_store.get('task_list'))
        sec = resolve_scope(region, section)
        pending_items = [
            i for i in tl.pending
            if not i.needs_intervention
            and section_matches(sec, i.section_id, i.section_title, getattr(i, 'region_label', '') or '')
        ]
        pending_payload = [i.model_dump() for i in pending_items]
        by_region = pending_by_region(tl)
        sys.stderr.write(
            f'[get-pending] done={len(tl.done)} pending={len(tl.pending)} region={sec!r}\n'
        )
        sys.stderr.flush()
        result = {
            'pending': pending_payload,
            'done': len(tl.done),
            'pending_by_region': by_region,
            'pending_by_section': pending_by_section(tl),  # legacy alias
            'region_filter': sec or None,
            'section_filter': sec or None,  # legacy alias
        }
        cue = _submit_ready_hint(case_data_store, section=sec)
        if cue:
            if cue.startswith('NEXT_ACTION:'):
                result['NEXT_ACTION'] = cue.split('|', 1)[0].replace('NEXT_ACTION:', '').strip()
            result['hint'] = cue
            case_data_store['_submit_ready'] = True
            return _ok(json.dumps(result, ensure_ascii=False), include_in_memory=True)
        return json.dumps(result, ensure_ascii=False)

    @controller.action(
        'Find the 保存/提交/确认/确定 button, scroll it into view, click it, wait for loading, '
        'then scan the whole page for .el-form-item__error and success/error notifications. '
        'Prefer this over scroll_down + click_element_by_index for form submit (including '
        'maintain/edit dialog 确认). '
        'Optional region= scopes to a collapse/tab/card / L1 block when multiple同名按钮 exist '
        '(section= is a deprecated alias). '
        'Returns ok-save-success when 操作成功 toast appears, ok-save-navigation when URL changes, '
        'or ok-save-no-feedback when the click completes with no toast/error/navigation '
        '(silent save — still success). On validation errors returns err-save-validation.'
    )
    async def click_save(button_text: str = '保存', section: str = '', region: str = ''):
        from ._phase_intent import check_pending_write_gate, contract_force_refill, record_success_token
        from .section_scope import (
            clear_phase_section,
            remember_phase_section,
            resolve_scope,
            save_retry_scope,
        )

        page = await browser_context.get_current_page()
        container_id = await page.evaluate(JS_IDENTIFY_CONTAINER)
        compact_btn = re.sub(r'\s+', '', (button_text or '保存').strip()) or '保存'
        # LEGACY_SECTION_RETIRE: region= preferred; section= kept for compat.
        sec = resolve_scope(region, section)
        explicit_sec = bool(sec)
        # Resolve: explicit → multi-save gate → sticky memory → unique → ""
        if not sec and not explicit_sec:
            try:
                await refresh_scan_buttons(page, case_data_store)
            except Exception:
                pass
            try:
                from .section_scope import same_label_section_keys, norm_sec
                keys = same_label_section_keys(
                    case_data_store.get("_scan_buttons"), compact_btn
                )
                if len(keys) >= 2:
                    sys.stderr.write(
                        f'[click_save] skip sticky; multi-section {compact_btn!r} keys={keys!r}\n'
                    )
                    sys.stderr.flush()
                    # leave sec empty → JS_CLICK_SAVE_BUTTON returns ambiguous
                else:
                    mem = norm_sec(str(case_data_store.get("_phase_section") or ""))
                    if mem:
                        sec = mem
                        sys.stderr.write(f'[click_save] phase section={sec!r} from memory\n')
                        sys.stderr.flush()
                    if not sec:
                        from .section_scope import unique_button_section
                        auto_sec = unique_button_section(
                            case_data_store.get("_scan_buttons"), compact_btn
                        )
                        if auto_sec:
                            sec = auto_sec
                            sys.stderr.write(
                                f'[click_save] auto region={auto_sec!r} from unique button\n'
                            )
                            sys.stderr.flush()
            except Exception:
                pass
        if sec:
            from .section_scope import remember_phase_section
            remember_phase_section(case_data_store, sec)
        # 确认/确定 = dialog/picker confirm (never treat as form-save blocked by query toolbar)
        is_picker_confirm = bool(
            compact_btn.startswith(('确认', '确定'))
            or ('确认' in compact_btn)
            or ('确定' in compact_btn)
        )
        query_ui = await _mark_query_ui_if_needed(page, case_data_store, container_id)
        sys.stderr.write(
            f'[click_save] enter button={button_text!r} section={sec!r} compact={compact_btn!r} '
            f'query_ui={query_ui} picker_confirm={is_picker_confirm}\n'
        )
        sys.stderr.flush()
        if query_ui and not is_picker_confirm:
            return _err(
                'not-form-save | query/filter UI — NOT a form-fill submit. '
                'Click 查询 via click_element_by_index; '
                'for picker 确认 use click_element_by_index or click_save(button_text="确认").',
                include_in_memory=True,
            )
        if is_picker_confirm and query_ui:
            # Magnifier/picker: 确认 is introduce confirm, not maintain click_save.
            sys.stderr.write(
                f'[click_save] picker confirm via click_save({button_text!r}) on query UI\n'
            )
            sys.stderr.flush()
            gate_ok, pending_labels = True, []
        else:
            if not is_picker_confirm:
                from ._phase_boundary import phase_boundary_active, get_phase_boundary
                from .section_scope import pending_by_region, requires_region_declaration

                needs_gate = False
                if phase_boundary_active(case_data_store):
                    b = get_phase_boundary(case_data_store) or {}
                    needs_gate = bool(b.get("requires_write_all_editable"))
                else:
                    needs_gate = contract_force_refill(case_data_store)
                if needs_gate and not sec:
                    tl0 = TaskList.from_store((case_data_store or {}).get("task_list"))
                    by = pending_by_region(tl0)
                    if requires_region_declaration(tl0):
                        return _err(
                            "err-region-required | pending_by_region="
                            + json.dumps(by, ensure_ascii=False)
                            + " | Pass region= for the phase block "
                            "(judge from 阶段任务 / 阶段目录 / region_label).",
                            include_in_memory=True,
                        )

            gate_ok, pending_labels = check_pending_write_gate(case_data_store, section=sec)
        if not gate_ok:
            # Live-prune: fields wrongly left in pending because scan missed Vue disabled
            btn_kw = _button_keywords()
            tl = TaskList.from_store((case_data_store or {}).get('task_list'))
            kept = []
            pruned = []
            for item in list(tl.pending):
                if item.needs_intervention:
                    kept.append(item)
                    continue
                try:
                    raw = await page.evaluate(JS_CHECK_SINGLE_FIELD, [item.label, btn_kw])
                    info = json.loads(raw) if isinstance(raw, str) and raw.startswith('{') else {}
                except Exception:
                    info = {}
                if info.get('disabled') and not info.get('hasButton'):
                    item.disabled = True
                    tl.done.append(item)
                    pruned.append(item.label)
                    continue
                kept.append(item)
            if pruned:
                tl.pending = kept
                if case_data_store is not None:
                    case_data_store['task_list'] = tl.to_store()
                sys.stderr.write(f'[click_save] pruned disabled pending: {pruned}\n')
                sys.stderr.flush()
                gate_ok, pending_labels = check_pending_write_gate(case_data_store, section=sec)
        if not gate_ok:
            return _err(
                f'err-pending-fields:{json.dumps(pending_labels[:12], ensure_ascii=False)} | '
                f'All editable fields must be written before submit (recording contract). '
                f'Fill remaining fields then click_save() again.',
                include_in_memory=True,
            )
        url_before = page.url
        if case_data_store is not None:
            case_data_store['_url_before_save'] = url_before
            case_data_store['_last_save_ok'] = False

        # Capture short-lived success toasts that may vanish between polls
        await page.evaluate(JS_WATCH_SAVE_NOTIFICATIONS)

        raw = await page.evaluate(JS_CLICK_SAVE_BUTTON, [button_text or '保存', sec])
        try:
            info = json.loads(raw) if isinstance(raw, str) else (raw or {})
        except Exception:
            info = {}
        retry_scope = ''
        if not info.get('ok'):
            retry_scope = save_retry_scope(
                str(info.get('reason') or ''),
                info.get('candidates') or [],
                explicit_scope=explicit_sec,
            )
            if retry_scope:
                clear_phase_section(case_data_store)
                sys.stderr.write(
                    f'[click_save] stale scope {sec!r} (not-found) → retry region={retry_scope!r}\n'
                )
                sys.stderr.flush()
                raw = await page.evaluate(JS_CLICK_SAVE_BUTTON, [button_text or '保存', retry_scope])
                try:
                    info = json.loads(raw) if isinstance(raw, str) else (raw or {})
                except Exception:
                    info = {}
                if info.get('ok'):
                    sec = retry_scope
                    remember_phase_section(case_data_store, retry_scope)
        if not info.get('ok'):
            try:
                await page.evaluate('() => { try { window.__saveWatchObs?.disconnect(); } catch(e) {} }')
            except Exception:
                pass
            reason = info.get('reason') or 'button-not-found'
            needle = info.get('needle') or (button_text or '保存')
            candidates = info.get('candidates') or []
            cand_json = json.dumps(candidates[:12], ensure_ascii=False)
            sys.stderr.write(
                f'[click_save] NOT CLICKED: "{needle}" reason={reason} section={sec!r} '
                f'candidates={cand_json[:200]}\n'
            )
            sys.stderr.flush()
            if reason == 'ambiguous':
                return _err(
                    f'err-save-ambiguous:{needle} | candidates={cand_json} | '
                    f'Multiple visible "{needle}" buttons — pass region= (or section=) to click_save '
                    f'(region_label / collapse/tab/card title from scan).',
                    include_in_memory=True,
                )
            sec_hint = f' region={sec!r}' if sec else ''
            stale_hint = (
                f' | stale scope memory retried region={retry_scope!r} and still missed'
                if retry_scope else ''
            )
            return _err(
                f'err-save-button-not-found:{needle}{sec_hint}. '
                f'candidates={cand_json}. '
                f'Close interfering dialogs (查询/返回) with close_dialog, '
                f'or pass region= for scoped save.{stale_hint}',
                include_in_memory=True,
            )

        btn_text = info.get('text') or (button_text or '保存')
        xpath = info.get('xpath') or ''
        tag_name = info.get('tag') or 'button'
        element_info = await _enrich_click_element(
            page, xpath=xpath, text=btn_text, tag_name=tag_name, attributes={},
        )
        _record_action(
            'click_element_by_index',
            {
                'index': -1,
                'tag_name': (element_info or {}).get('tag_name') or tag_name,
                'text': btn_text,
                'section': sec or info.get('section') or '',
            },
            f'ok-clicked-save:{btn_text}',
            element=element_info,
        )
        sys.stderr.write(f'[click_save] clicked "{btn_text}" xpath={xpath[:80]}\n')
        sys.stderr.flush()

        await page.wait_for_timeout(150)
        await _wait_if_loading(page)

        # Poll briefly — success toasts auto-dismiss in ~2–3s
        outcome = {'formErrors': [], 'successNotifs': [], 'errorNotifs': [], 'url': page.url}
        for _ in range(20):  # ~3s at 150ms
            scanned = await page.evaluate(JS_SCAN_SAVE_OUTCOME)
            if isinstance(scanned, str):
                try:
                    scanned = json.loads(scanned)
                except Exception:
                    scanned = {}
            watched = await page.evaluate('() => window.__saveWatch || {successNotifs:[], errorNotifs:[]}')
            outcome = scanned or outcome
            # Merge watcher captures (may include dismissed toasts)
            for t in (watched or {}).get('successNotifs') or []:
                if t not in (outcome.get('successNotifs') or []):
                    outcome.setdefault('successNotifs', []).append(t)
            for t in (watched or {}).get('errorNotifs') or []:
                if t not in (outcome.get('errorNotifs') or []):
                    outcome.setdefault('errorNotifs', []).append(t)
            if outcome.get('formErrors'):
                break
            if outcome.get('successNotifs'):
                break
            if outcome.get('errorNotifs'):
                break
            await page.wait_for_timeout(150)
            await _wait_if_loading(page)

        try:
            await page.evaluate('() => { try { window.__saveWatchObs?.disconnect(); } catch(e) {} }')
        except Exception:
            pass

        form_errors = outcome.get('formErrors') or []
        success_notifs = outcome.get('successNotifs') or []
        error_notifs = outcome.get('errorNotifs') or []

        if form_errors:
            labels = [e.get('label') or e.get('error') for e in form_errors[:8]]
            # Re-queue validation errors into task list when possible
            try:
                error_labels = await page.evaluate(
                    '''() => {
                      const out = [];
                      for (const el of document.querySelectorAll('.el-form-item__error')) {
                        const r = el.getBoundingClientRect();
                        if (r.width <= 0 || r.height <= 0) continue;
                        const t = (el.textContent || '').trim();
                        if (!t) continue;
                        const item = el.closest('.el-form-item');
                        const label = (item && item.querySelector('.el-form-item__label')
                          ? item.querySelector('.el-form-item__label').textContent : '').trim();
                        if (label) out.push(label);
                      }
                      return out;
                    }'''
                )
                if error_labels:
                    tl = TaskList.from_store(case_data_store.get('task_list'))
                    tl.sync_from_errors(error_labels)
                    case_data_store['task_list'] = tl.to_store()
            except Exception:
                pass
            try:
                await page.evaluate(JS_SCROLL_TO_FIRST_ERROR)
            except Exception:
                pass
            msg = (
                f'err-save-validation:{json.dumps(form_errors[:8], ensure_ascii=False)} | '
                f'Fix fields {labels} then call click_save() again. '
                f'Do NOT call done(success=true).'
            )
            sys.stderr.write(f'[click_save] validation errors: {labels}\n')
            sys.stderr.flush()
            return _err(msg, include_in_memory=True)

        if success_notifs:
            if case_data_store is not None:
                case_data_store['_last_save_ok'] = True
                case_data_store.pop('_submit_ready', None)
            record_success_token(case_data_store, 'toast_ok', success_notifs[0])
            toast = success_notifs[0]
            sys.stderr.write(f'[click_save] SUCCESS: {toast[:80]}\n')
            sys.stderr.flush()
            return _ok(
                f'ok-save-success:{toast} | '
                f'Save confirmed (操作成功). Call done(success=true) if phase goal is save.',
                include_in_memory=True,
            )

        if error_notifs:
            toast = error_notifs[0]
            sys.stderr.write(f'[click_save] error notification: {toast[:80]}\n')
            sys.stderr.flush()
            return _err(
                f'err-save-notification:{toast} | '
                f'Fix the reported issue then click_save() again. Do NOT treat as success.',
                include_in_memory=True,
            )

        url_after = outcome.get('url') or page.url
        url_changed = bool(url_before and url_after and url_before != url_after)
        if url_changed:
            if case_data_store is not None:
                case_data_store['_last_save_ok'] = True
                case_data_store.pop('_submit_ready', None)
            record_success_token(case_data_store, 'url_change', url_after)
            sys.stderr.write(
                f'[click_save] SUCCESS via navigation {url_before[:60]} -> {url_after[:60]}\n'
            )
            sys.stderr.flush()
            return _ok(
                f'ok-save-navigation:{url_after[:120]} | '
                f'Save confirmed (post-save navigation). Call done(success=true) if phase goal is save.',
                include_in_memory=True,
            )

        # Picker confirm: no toast expected — dialog close counts as success
        if is_picker_confirm and query_ui:
            still_query = False
            try:
                still_query = bool(await page.evaluate(JS_IS_QUERY_TOOLBAR))
            except Exception:
                still_query = False
            if not still_query:
                record_success_token(case_data_store, 'confirm_click', button_text or '确认')
                try:
                    from ._phase_boundary import maybe_record_picker_closed, record_evidence
                    parent = (case_data_store or {}).get('_parent_container_before_picker') or 'main'
                    maybe_record_picker_closed(
                        case_data_store,
                        still_query_ui=False,
                        parent_container=parent,
                    )
                    # Best-effort backfill check on parent form disabled fields
                    btn_kw = _button_keywords()
                    backfilled = []
                    try:
                        raw = await page.evaluate(JS_SCAN_FORM_FIELDS, [False, btn_kw])
                        result = _as_dict(raw)
                        fields = result.get('fields') if isinstance(result, dict) else result
                        for f in fields or []:
                            if not isinstance(f, dict):
                                continue
                            if f.get('disabled') and (f.get('currentValue') or '').strip():
                                backfilled.append(f.get('label') or '')
                    except Exception:
                        pass
                    if backfilled:
                        record_evidence(
                            case_data_store,
                            'introduced_backfilled',
                            ','.join(backfilled[:6]),
                        )
                except Exception as e:
                    sys.stderr.write(f'[click_save] picker_closed helper: {e}\n')
                    sys.stderr.flush()
                    if case_data_store is not None:
                        case_data_store.pop('_query_ui', None)
                sys.stderr.write('[click_save] SUCCESS picker confirm (dialog closed)\n')
                sys.stderr.flush()
                if case_data_store is not None:
                    # Parent form still needs final 保存 after introduce (toast_ok).
                    case_data_store['_submit_ready'] = True
                    case_data_store.pop('_query_ui', None)
                return _ok(
                    'ok-introduce-confirm | Picker confirmed; introduce fields should be backfilled. '
                    'Call click_save(button_text="保存") NOW on the parent form. '
                    'Do NOT only check_field_value.',
                    include_in_memory=True,
                )

        # Silent save: button clicked, no validation errors, no error toast, no URL
        # change — some SUTs (e.g. section 保存) persist without 操作成功 toast.
        if case_data_store is not None:
            case_data_store['_last_save_ok'] = True
            case_data_store.pop('_submit_ready', None)
        record_success_token(case_data_store, 'toast_ok', 'ok-save-no-feedback')
        sys.stderr.write('[click_save] SUCCESS via no-feedback (silent save)\n')
        sys.stderr.flush()
        return _ok(
            'ok-save-no-feedback: save click completed with no toast, form error, or navigation. '
            'Treated as save success (silent persist). Call done(success=true) if phase goal is save. '
            'Do NOT retry click_save() on this result.',
            include_in_memory=True,
        )

    @controller.action('Scroll to the first visible form validation error (.el-form-item.is-error or .el-form-item__error). Returns {label, error} so agent knows which field to fix next. Call after a failed submit or when form errors are visible.')
    async def scroll_to_first_error():
        page = await browser_context.get_current_page()
        raw = await page.evaluate(JS_SCROLL_TO_FIRST_ERROR)
        try:
            info = _as_dict(raw)
        except Exception:
            return _ok('no-error-found')
        label = (info.get('label') or '').strip()
        error = (info.get('error') or '').strip()
        if not label and not error:
            return _ok('no-error-found')
        sys.stderr.write(f'[scroll-to-error] jumped to: "{label}" → {error}\n')
        sys.stderr.flush()
        return _ok(f'scrolled-to:{label} | {error}')

    @controller.action('Sync task list from current page validation errors. Reads .el-form-item__error text, extracts field labels (strips 请选择/请输入/请上传 prefix), re-adds them to pending. Also scrolls to first error. Call this after a failed submit attempt.')
    async def sync_tasks_from_errors():
        page = await browser_context.get_current_page()
        errors = await page.evaluate(_JS_EXTRACT_ERROR_LABELS)
        try:
            error_labels = json.loads(errors) if isinstance(errors, str) else errors
        except Exception:
            error_labels = []
        tl = TaskList.from_store(case_data_store.get('task_list'))
        retried = tl.sync_from_errors(error_labels)
        case_data_store['task_list'] = tl.to_store()

        # 分离 disabled+旁钮字段（靠特殊元素流程，不入干预队列）
        intervene = [item for item in retried if item.needs_intervention]
        fillable = [item for item in retried if not item.needs_intervention]
        if intervene:
            intervene_labels = [item.label for item in intervene]
            sys.stderr.write(
                f'[sync-errors] disabled+button fields (prefer special-element): {intervene_labels}\n'
            )
            sys.stderr.flush()

        # Auto-scroll to first error so agent can see and fix it immediately
        if retried:
            scroll_raw = await page.evaluate(JS_SCROLL_TO_FIRST_ERROR)
            try:
                scroll_info = json.loads(scroll_raw) if isinstance(scroll_raw, str) else scroll_raw
            except Exception:
                scroll_info = {}
            jumped_label = (scroll_info.get('label') or '').strip()
            jumped_error = (scroll_info.get('error') or '').strip()
            if jumped_label:
                sys.stderr.write(f'[sync-errors] auto-scrolled to: "{jumped_label}" → {jumped_error}\n')
                sys.stderr.flush()

        # 构建返回消息
        msg = f'sync-errors | retried:{len(retried)}'
        if fillable:
            msg += ' | fillable:' + json.dumps([item.label for item in fillable], ensure_ascii=False)
        if intervene:
            msg += ' | disabled_button_fields:' + json.dumps(
                [item.label for item in intervene], ensure_ascii=False
            )
        return _ok(msg, include_in_memory=True)

    @controller.action('Select an option in an el-select dropdown by label and option text.')
    async def select_option(label_text: str, option_text: str, xpath_smart: str = ""):
        return await _select_engine.select_option(label_text, option_text, xpath_smart)

    @controller.action('Click an adjacent button (选择/引入/上传) to fill a field, but only if the field is empty. Returns "already-filled" (non-ok skip) if field has value.')
    async def click_adjacent_button(label_text: str):
        return await _fill_engine.click_adjacent_button(label_text)

    @controller.action('Click a radio option by label text and radio option text.')
    async def click_radio(label_text: str, option_text: str, xpath_smart: str = ""):
        return await _radio_engine.click_radio(label_text, option_text, xpath_smart)

    @controller.action('Select a tree-select option by label and option text. For custom TsscMultiTree components (e.g. 行业代码). Opens popover, searches tree data by label, selects matching node, closes popover. If result starts with no-tree-component, do NOT retry — use fill_form_field with a concrete value (not "first") or select_option.')
    async def select_tree_option(label_text: str, option_text: str, xpath_smart: str = ""):
        return await _tree_engine.select_tree_option(label_text, option_text, xpath_smart)
