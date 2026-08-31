"""Scan / summary / task-list action implementations (extracted from _form.py —
Slice 4 of form-actions-split).

行为零 diff 搬迁：动作壳（@controller.action 注册与 docstring）留在 _form.py，
实现体移到这里，闭包捕获（browser_context / business_data_store / _button_keywords /
_ensure_scanned）改为显式参数注入。task_done / save_form_snapshot 已是
form_scan_utils 薄委托，仍留在 _form.py。
"""

import asyncio
import json
import sys

from ._helpers import (
    _ok, _err, _as_dict,
    _wait_if_loading, _merge_ax_text,
)
from ._js_snippets import (
    JS_IDENTIFY_CONTAINER, JS_SCAN_FORM_FIELDS, JS_CLEAR_FIELD_VALUE,
    JS_SCROLL_TO_FIRST_ERROR,
)
from ...models import (
    ScannedField, FormScanResult, Notification,
    TaskList,
)
from .form_scan_utils import (
    _force_refill_flag,
    _scan_buttons_from_result,
    _build_section_summary, build_editable_summary, _is_query_mode,
    _mark_query_ui_if_needed,
    prepare_scan_fields_for_tasklist,
    _dedupe_needs_agent,
    _JS_EXTRACT_ERROR_LABELS, _save_form_snapshot,
    _submit_ready_hint, _query_not_form_payload,
)
from ...models import TaskItem
from .result_protocol import recommend_action_for_kind


async def _clear_field_value(page, label_text):
    """Clear a form field's input value by label.

    Targets the input inside .el-form-item that matches the label,
    resets its value and dispatches input/change events so Vue picks it up.
    """
    try:
        await page.evaluate(JS_CLEAR_FIELD_VALUE, label_text)
    except Exception:
        sys.stderr.write("[clear-field] JS_CLEAR_FIELD_VALUE failed label={label_text!r}" + '\n')
        sys.stderr.flush()
        pass


async def scan_form_fields_impl(browser_context, business_data_store, button_keywords):
    page = await browser_context.get_current_page()
    await _wait_if_loading(page)
    container_id = await page.evaluate(JS_IDENTIFY_CONTAINER)
    if await _mark_query_ui_if_needed(page, business_data_store, container_id):
        return _query_not_form_payload(container_id)
    raw = await page.evaluate(
        JS_SCAN_FORM_FIELDS,
        [False, button_keywords(), {'mode': 'fullpage'}],
    )
    try:
        result = _as_dict(raw)
        raw_fields = result.get('fields') if isinstance(result, dict) else result
    except Exception:
        sys.stderr.write("[scan] parse JS_SCAN_FORM_FIELDS failed (raw passthrough)" + '\n')
        sys.stderr.flush()
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
        sys.stderr.write("[scan] aria_snapshot merge failed" + '\n')
        sys.stderr.flush()
        pass

    container_id = result.get('container', 'main') if isinstance(result, dict) else 'main'
    raw_notification = result.get('notification') if isinstance(result, dict) else None
    notification = Notification(**raw_notification) if raw_notification else None
    business_data_store['_scan_buttons'] = _scan_buttons_from_result(result)

    # Browse/list scan: task list only — do NOT save form structure checkpoint.
    # Structure is saved on: run_form_assistant, single-field first-touch
    # container scan, or explicit save_form_snapshot().

    # Build task list only — no auto-fill (avoids filling on browse/list pages).
    # Preserve existing done items — from_scan filters fields with values,
    # so mark_done() won't find them in pending. Create TaskItems directly.
    prev_tl = TaskList.from_store(business_data_store.get('task_list'))
    prev_done_labels = {d.label for d in prev_tl.done}
    prev_intervene = {item.label for item in prev_tl.pending if item.needs_intervention}

    session_filled = set(business_data_store.get('_autofilled_labels') or [])
    tl = TaskList.from_scan(
        [f.model_dump() for f in dom_fields],
        force_refill=_force_refill_flag(business_data_store),
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
                use=prev.use if prev else '',
                xpath_smart=prev.xpath_smart if prev else '',
                section_id=prev.section_id if prev else '',
                section_title=prev.section_title if prev else '',
                region_label=getattr(prev, 'region_label', '') if prev else '',
            ))
    # Restore needs_intervention flags on items that ended up in pending
    for item in tl.pending:
        if item.label in prev_intervene:
            item.needs_intervention = True
    business_data_store['task_list'] = tl.to_store()
    for f in dom_fields:
        f.use = recommend_action_for_kind(f.kind)
    business_data_store['_scan_fields'] = [f.model_dump() for f in dom_fields]

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
            business_data_store.get('_scan_buttons') or [],
            pending_labels=set(pending_labels),
        )
    )
    return json.dumps(summary, ensure_ascii=False)


async def scan_editable_summary_impl(browser_context, business_data_store, button_keywords):
    page = await browser_context.get_current_page()
    await _wait_if_loading(page)
    # Full-page L2 pool + L1 feature cards (shell included). See fullpage scan design.
    raw = await page.evaluate(
        JS_SCAN_FORM_FIELDS,
        [True, button_keywords(), {'mode': 'fullpage'}],
    )
    try:
        result = _as_dict(raw)
    except Exception:
        sys.stderr.write("[scan-editable] parse JS_SCAN_FORM_FIELDS failed (raw passthrough)" + '\n')
        sys.stderr.flush()
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
        sys.stderr.write("[scan-editable] emit_editable_summary_memory failed" + '\n')
        sys.stderr.flush()
        pass
    return json.dumps(summary, ensure_ascii=False)


async def run_form_assistant_impl(browser_context, business_data_store, _ensure_scanned, section: str = '', region: str = ''):
    from ._phase_intent import contract_allows_form_assistant
    if not contract_allows_form_assistant(business_data_store):
        return 'err-form-assistant-forbidden: phase contract allow_form_assistant=false'
    page = await browser_context.get_current_page()
    await _wait_if_loading(page)
    from .section_scope import resolve_scope, remember_phase_section
    sec = resolve_scope(region, section)
    if sec:
        remember_phase_section(business_data_store, sec)
        business_data_store['_assistant_section_filter'] = sec
    try:
        await _ensure_scanned('__run_form_assistant__', allow_autofill=True)
        tl = TaskList.from_store(business_data_store.get('task_list'))
        pending_labels = {item.label for item in tl.pending}
        payload = {
            'status': business_data_store.get('_autofill_summary') or 'auto-fill-complete',
            'section_filter': sec or None,
            'needs_agent': _dedupe_needs_agent(
                business_data_store.get('_assistant_needs_agent') or []
            ),
            **_build_section_summary(
                business_data_store.get('_scan_fields') or [],
                business_data_store.get('_scan_buttons') or [],
                pending_labels=pending_labels,
            ),
        }
        return _ok(json.dumps(payload, ensure_ascii=False))
    finally:
        business_data_store.pop('_assistant_section_filter', None)


async def scan_visible_fields_impl(browser_context, business_data_store, button_keywords):
    page = await browser_context.get_current_page()
    await _wait_if_loading(page)
    container_id = await page.evaluate(JS_IDENTIFY_CONTAINER)
    if await _mark_query_ui_if_needed(page, business_data_store, container_id):
        return _query_not_form_payload(container_id)
    raw = await page.evaluate(
        JS_SCAN_FORM_FIELDS,
        [True, button_keywords(), {'mode': 'fullpage'}],
    )
    try:
        result = _as_dict(raw)
        raw_fields = result.get('fields') if isinstance(result, dict) else result
    except Exception:
        sys.stderr.write("[scan-visible] parse JS_SCAN_FORM_FIELDS failed (raw passthrough)" + '\n')
        sys.stderr.flush()
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
        sys.stderr.write("[scan-visible] aria_snapshot merge failed" + '\n')
        sys.stderr.flush()
        pass

    tl = TaskList.from_store(business_data_store.get('task_list'))

    # ── 空壳粘性修复：抽屉刚打开 ~0.2s 内的首次 scan 可能命中未稳定 DOM，
    # 产出全空壳字段（xpath_smart / options 全空、kind 落成 input）并被写入
    # task_list / _scan_fields 后粘住，后续 get_pending_tasks 与 select_option
    # 一直拿到空壳。检测到疑似空壳且本次不是重扫时，延时 1.5s 重扫一次；
    # 重扫结果非空壳才替换本次结果并回填 store，仍空壳则照常返回（不递归）。
    if _scan_fields_are_stub(dom_fields) and not business_data_store.get('_scan_stub_rescan_inflight'):
        business_data_store['_scan_stub_rescan_inflight'] = True
        try:
            await asyncio.sleep(1.5)
            rescan_fields = await _scan_visible_dom_fields(browser_context, button_keywords)
            if not _scan_fields_are_stub(rescan_fields):
                dom_fields = rescan_fields
                business_data_store['_scan_fields'] = [f.model_dump() for f in dom_fields]
                rescan_by_label = {f.label: f for f in dom_fields}
                store_updated = False
                for item in tl.pending:
                    better = rescan_by_label.get(item.label)
                    if better is None or item.xpath_smart or item.options:
                        continue
                    item.kind = better.kind
                    item.options = list(better.options or [])
                    item.xpath_smart = better.xpath_smart or ''
                    item.placeholder = better.placeholder or ''
                    item.required = bool(better.required)
                    item.hasButton = better.hasButton or ''
                    store_updated = True
                if store_updated:
                    business_data_store['task_list'] = tl.to_store()
                sys.stderr.write('[scan-visible] stub scan detected → delayed rescan fixed fields\n')
                sys.stderr.flush()
        except Exception as _stub_rescan_exc:
            sys.stderr.write(f'[scan-visible] stub rescan failed: {_stub_rescan_exc!r}\n')
            sys.stderr.flush()
        finally:
            business_data_store.pop('_scan_stub_rescan_inflight', None)

    # ── 扫描校验错误：将报错字段从 done[] 移回 pending[]，清空值 ──
    try:
        error_labels = await page.evaluate(_JS_EXTRACT_ERROR_LABELS)
        error_labels_parsed = json.loads(error_labels) if isinstance(error_labels, str) else error_labels
    except Exception:
        sys.stderr.write("[scan-visible] _JS_EXTRACT_ERROR_LABELS parse failed" + '\n')
        sys.stderr.flush()
        error_labels_parsed = []
    if error_labels_parsed:
        retried = tl.sync_from_errors(error_labels_parsed)
        if retried:
            business_data_store['task_list'] = tl.to_store()
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
    cue = _submit_ready_hint(business_data_store)
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


def init_task_list_impl(business_data_store, fields_json: str):
    try:
        data = json.loads(fields_json) if isinstance(fields_json, str) else fields_json
    except Exception:
        sys.stderr.write("[init-task-list] json.loads fields_json failed" + '\n')
        sys.stderr.flush()
        return _err('invalid-json')
    fields = data.get('fields') if isinstance(data, dict) else data

    session_filled = set(business_data_store.get('_autofilled_labels') or [])
    tl = TaskList.from_scan(
        fields,
        force_refill=_force_refill_flag(business_data_store),
        session_filled_labels=session_filled,
    )
    business_data_store['task_list'] = tl.to_store()
    business_data_store['_scan_fields'] = fields
    pending_count = len(tl.pending)
    return _ok(f'task-list-init | pending:{pending_count}')


def get_pending_tasks_impl(business_data_store, section: str = '', region: str = ''):
    if _is_query_mode(business_data_store):
        return _ok(_query_not_form_payload(), include_in_memory=True)
    from .section_scope import section_matches, pending_by_section, pending_by_region, resolve_scope
    tl = TaskList.from_store(business_data_store.get('task_list'))
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
    cue = _submit_ready_hint(business_data_store, section=sec)
    if cue:
        if cue.startswith('NEXT_ACTION:'):
            result['NEXT_ACTION'] = cue.split('|', 1)[0].replace('NEXT_ACTION:', '').strip()
        result['hint'] = cue
        business_data_store['_submit_ready'] = True
        return _ok(json.dumps(result, ensure_ascii=False), include_in_memory=True)
    return json.dumps(result, ensure_ascii=False)


async def scroll_to_first_error_impl(browser_context):
    page = await browser_context.get_current_page()
    raw = await page.evaluate(JS_SCROLL_TO_FIRST_ERROR)
    try:
        info = _as_dict(raw)
    except Exception:
        sys.stderr.write("[scroll-to-error] parse JS_SCROLL_TO_FIRST_ERROR result failed" + '\n')
        sys.stderr.flush()
        return _ok('no-error-found')
    label = (info.get('label') or '').strip()
    error = (info.get('error') or '').strip()
    if not label and not error:
        return _ok('no-error-found')
    sys.stderr.write(f'[scroll-to-error] jumped to: "{label}" → {error}\n')
    sys.stderr.flush()
    return _ok(f'scrolled-to:{label} | {error}')


async def sync_tasks_from_errors_impl(browser_context, business_data_store):
    page = await browser_context.get_current_page()
    errors = await page.evaluate(_JS_EXTRACT_ERROR_LABELS)
    try:
        error_labels = json.loads(errors) if isinstance(errors, str) else errors
    except Exception:
        sys.stderr.write("[sync-errors] _JS_EXTRACT_ERROR_LABELS parse failed" + '\n')
        sys.stderr.flush()
        error_labels = []
    tl = TaskList.from_store(business_data_store.get('task_list'))
    retried = tl.sync_from_errors(error_labels)
    business_data_store['task_list'] = tl.to_store()

    # 分离 disabled+旁钮字段（靠特殊元素流程，不入干预队列）
    intervene = [item for item in retried if item.needs_intervention]
    fillable = [item for item in retried if not item.needs_intervention]
    if intervene:
        intervene_labels = [item.label for item in intervene]
        sys.stderr.write(
            f'[sync-errors] disabled+button fields (prefer special-element): {intervene_labels}\n'
        )
        sys.stderr.flush()


def _scan_fields_are_stub(fields) -> bool:
    """Return True when a scan result looks like a DOM-not-stable "stub" scan.

    A stub is a non-empty field list where ≥80% of fields have no xpath_smart,
    no options, no current value, and a generic kind (input/select) — the
    signature observed when scan_visible_fields runs right after a drawer opens
    (~0.2s) before Vue finishes mounting the dialog DOM. Empty field lists are
    NOT stubs (handled by the pending-tasks fallback path).
    """
    if not fields:
        return False

    def _is_stub_field(f):
        try:
            d = f.model_dump() if hasattr(f, 'model_dump') else dict(f)
        except Exception:
            return False
        if (d.get('xpath_smart') or '').strip():
            return False
        if d.get('options'):
            return False
        if (d.get('currentValue') or '').strip():
            return False
        return d.get('kind') in ('input', 'select', '', None)

    stub_count = sum(1 for f in fields if _is_stub_field(f))
    return stub_count / len(fields) >= 0.8


async def _scan_visible_dom_fields(browser_context, button_keywords):
    """Re-run the visible-fields DOM scan and return parsed ScannedField list.

    Used only by the stub-rescan path in scan_visible_fields_impl; mirrors the
    scan steps (JS_SCAN_FORM_FIELDS fullpage + aria_snapshot merge) without
    touching the store or the task list.
    """
    page = await browser_context.get_current_page()
    await _wait_if_loading(page)
    raw = await page.evaluate(
        JS_SCAN_FORM_FIELDS,
        [True, button_keywords(), {'mode': 'fullpage'}],
    )
    result = _as_dict(raw)
    raw_fields = result.get('fields') if isinstance(result, dict) else result
    fillable = prepare_scan_fields_for_tasklist(raw_fields)
    dom_fields = [
        ScannedField(**f) if isinstance(f, dict) else f
        for f in fillable
    ]
    try:
        ax_text = await page.aria_snapshot(mode='ai')
        if ax_text:
            _merge_ax_text(dom_fields, ax_text)
    except Exception:
        sys.stderr.write("[scan-visible] stub-rescan aria_snapshot merge failed" + '\n')
        sys.stderr.flush()
        pass
    return dom_fields

    # Auto-scroll to first error so agent can see and fix it immediately
    if retried:
        scroll_raw = await page.evaluate(JS_SCROLL_TO_FIRST_ERROR)
        try:
            scroll_info = json.loads(scroll_raw) if isinstance(scroll_raw, str) else scroll_raw
        except Exception:
            sys.stderr.write("[sync-errors] parse JS_SCROLL_TO_FIRST_ERROR result failed" + '\n')
            sys.stderr.flush()
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
