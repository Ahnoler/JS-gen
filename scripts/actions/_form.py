"""
Form-related actions: scan, fill, select, task list, validation.

The largest action group — registers 18 controller actions for
Element UI form interaction.
"""

import json
import re
import sys
from dataclasses import dataclass

from ..agent_utils import emit_json
from ._state import (
    _ACTION_LOG,
    _record_action,
    capture_page_png_b64_from_page,
    record_action_with_screenshots,
)
from ._helpers import (
    _ok, _err, _is_ok_result,
    _wait_if_loading, _capture_element, _merge_ax_text,
    _enrich_click_element,
    attach_select_options, options_from_scan_store, read_select_options,
)
from ._js_snippets import (
    JS_GET_CONTAINER, JS_IDENTIFY_CONTAINER, JS_IS_QUERY_TOOLBAR,
    JS_CHECK_SINGLE_FIELD, JS_SCAN_FORM_FIELDS,
    JS_FILL_FORM_FIELD, JS_FILL_BY_XPATH,
    JS_FILL_DATE_BY_XPATH,
    JS_FIND_LABELED_SELECT, JS_SELECT_OPTION,
    JS_SELECT_TRIGGER_BY_XPATH, JS_SELECT_VALUE_BY_XPATH, JS_LOCATOR,
    JS_CLICK_RADIO_BY_XPATH,
    JS_SELECT_TREE_OPTION,
    JS_SCROLL_TO_FIRST_ERROR,
    JS_CLICK_SAVE_BUTTON, JS_SCAN_SAVE_OUTCOME,
)
from ._llm_values import _llm_generate_values
from ..models import (
    ScannedField, FormScanResult, Notification,
    FormSnapshot, FormSnapshotCollection,
    TaskItem, TaskList,
)
from ..models.field import ScannedButton
from .form_rules import (
    match_rule, match_cert_number, get_has_button_keywords,
    _gen_name,
)

# Search/picker dialogs — agent must control which query fields to fill.
# Data-entry dialogs (新增/编辑/校验…) still get auto-fill + case data.
_SEARCH_DIALOG_HINTS = ('查询', '搜索', '查找', '选择客户', '选择法人', '引入', '挑选')

_QUERY_NEXT_HINT = (
    'NOT_FORM_FILL | mode=query_filter | '
    'Search/filter UI — not a data-entry form. '
    'Do NOT use task_list / auto-fill / click_save. '
    'Set filters named by the task, then click 查询 via click_element_by_index.'
)


def _is_search_dialog(container_id: str) -> bool:
    if not (container_id or '').startswith('dialog:'):
        return False
    title = container_id[7:]
    return any(h in title for h in _SEARCH_DIALOG_HINTS)


def _force_refill_flag(case_data_store: dict | None) -> bool:
    from ._phase_intent import contract_force_refill
    return contract_force_refill(case_data_store)


def _scan_buttons_from_result(result) -> list[dict]:
    """Parse standalone buttons from JS_SCAN_FORM_FIELDS JSON (not TaskList fields)."""
    if not isinstance(result, dict):
        return []
    raw = result.get('buttons') or []
    out: list[dict] = []
    for b in raw:
        if isinstance(b, dict):
            out.append(ScannedButton(**b).model_dump())
        elif isinstance(b, ScannedButton):
            out.append(b.model_dump())
    return out


async def refresh_scan_buttons(page, case_data_store) -> list[dict]:
    """Rescan DOM buttons into ``case_data_store['_scan_buttons']``; return button list."""
    raw = await page.evaluate(JS_SCAN_FORM_FIELDS, [False, get_has_button_keywords(case_data_store)])
    try:
        result = json.loads(raw) if isinstance(raw, str) else raw
    except Exception:
        return list(case_data_store.get('_scan_buttons') or [])
    buttons = _scan_buttons_from_result(result)
    case_data_store['_scan_buttons'] = buttons
    return buttons


def _section_group_key(section_id: str, section_title: str) -> str:
    sid = (section_id or '').strip()
    if sid:
        return sid
    title = (section_title or '').strip()
    if title:
        return title
    return '__root__'


def _dedupe_needs_agent(needs: list) -> list:
    """Dedupe needs_agent entries by label; last reason wins."""
    by_label: dict[str, dict] = {}
    order: list[str] = []
    for n in needs or []:
        if not isinstance(n, dict):
            continue
        label = (n.get('label') or '').strip()
        if not label:
            continue
        if label in by_label:
            order.remove(label)
        order.append(label)
        by_label[label] = n
    return [by_label[lbl] for lbl in order]


def _build_section_summary(
    fields: list[dict],
    buttons: list[dict],
    pending_labels: set[str] | list[str] | None = None,
) -> dict:
    """Group scan fields/buttons by section for model-facing summaries.

    fields_sample: up to 5 labels per section (pending first).
    fields_total / fields_editable_pending: per-section counts (pending ∩ labels, disabled-aware).
    ambiguous_buttons: same label in >=2 distinct section_id groups.
    """
    pending = set(pending_labels or [])
    order: list[str] = []
    by_key: dict[str, dict] = {}

    def _ensure(section_id: str, section_title: str) -> dict:
        key = _section_group_key(section_id, section_title)
        if key not in by_key:
            by_key[key] = {
                'section_id': (section_id or '').strip() or key,
                'section_title': (section_title or '').strip(),
                'fields_sample': [],
                'buttons': [],
                '_field_entries': [],
            }
            order.append(key)
        return by_key[key]

    for f in fields:
        if not isinstance(f, dict):
            continue
        sec = _ensure(f.get('section_id') or '', f.get('section_title') or '')
        label = (f.get('label') or '').strip()
        if label:
            sec['_field_entries'].append({
                'label': label,
                'disabled': bool(f.get('disabled')),
            })

    for b in buttons:
        if not isinstance(b, dict):
            continue
        sec = _ensure(b.get('section_id') or '', b.get('section_title') or '')
        label = (b.get('label') or '').strip()
        if label and label not in sec['buttons']:
            sec['buttons'].append(label)

    for key in order:
        sec = by_key[key]
        entries = sec.pop('_field_entries')
        label_meta: dict[str, bool] = {}
        for entry in entries:
            lbl = entry['label']
            dis = entry['disabled']
            if lbl not in label_meta:
                label_meta[lbl] = dis
            else:
                label_meta[lbl] = label_meta[lbl] and dis
        labels = list(label_meta.keys())
        sec['fields_total'] = len(label_meta)
        sec['fields_editable_pending'] = sum(
            1 for lbl, dis in label_meta.items() if lbl in pending and not dis
        )
        seen: set[str] = set()
        sample: list[str] = []
        for label in labels:
            if label in pending and label not in seen:
                seen.add(label)
                sample.append(label)
                if len(sample) >= 5:
                    break
        if len(sample) < 5:
            for label in labels:
                if label not in seen:
                    seen.add(label)
                    sample.append(label)
                    if len(sample) >= 5:
                        break
        sec['fields_sample'] = sample

    label_sections: dict[str, dict[str, dict]] = {}
    for b in buttons:
        if not isinstance(b, dict):
            continue
        text = (b.get('label') or '').strip()
        if not text:
            continue
        sid = (b.get('section_id') or '').strip()
        title = (b.get('section_title') or '').strip()
        key = _section_group_key(sid, title)
        if text not in label_sections:
            label_sections[text] = {}
        label_sections[text][key] = {
            'section_id': sid or key,
            'section_title': title,
        }

    ambiguous_buttons = [
        {'text': text, 'sections': list(sec_map.values())}
        for text, sec_map in label_sections.items()
        if len(sec_map) >= 2
    ]

    out: dict = {'sections': [by_key[k] for k in order]}
    if ambiguous_buttons:
        out['ambiguous_buttons'] = ambiguous_buttons
    return out


def _is_query_mode(case_data_store: dict | None) -> bool:
    """True when this phase/UI is query-filter (no form-save / no auto-fill)."""
    if not case_data_store:
        return False
    if case_data_store.get('_task_mode') == 'query':
        return True
    return bool(
        case_data_store.get('_query_task')
        or case_data_store.get('_query_ui')
    )


def _skip_auto_fill(case_data_store: dict | None) -> bool:
    """True when run_form_assistant auto-fill must not run.

    Auto-fill only for form_fill and form_modify+force_refill_all.
    login / query / other / partial modify → skip.
    """
    if not case_data_store:
        return True
    if _is_query_mode(case_data_store):
        return True
    mode = case_data_store.get('_task_mode')
    if mode == 'form_fill':
        return False
    if mode == 'form_modify' and _force_refill_flag(case_data_store):
        return False
    return True


async def _mark_query_ui_if_needed(page, case_data_store, container_id: str = '') -> bool:
    """Detect query/filter UI; set _query_ui. Returns True if search context.

    Re-evaluates on every call — do not sticky-keep ``_query_ui`` after a picker
    dialog closes (that blocked click_save on the parent maintain form).
    Phase-level ``_query_task`` / task_mode=query still forces query semantics.
    """
    if case_data_store is None:
        return _is_search_dialog(container_id)
    if case_data_store.get('_query_task') or case_data_store.get('_task_mode') == 'query':
        case_data_store['_query_ui'] = True
        return True
    if _is_search_dialog(container_id):
        case_data_store['_query_ui'] = True
        return True
    is_qt = False
    try:
        is_qt = bool(await page.evaluate(JS_IS_QUERY_TOOLBAR))
    except Exception as e:
        sys.stderr.write(f'[form] query-toolbar detect failed: {e}\n')
        sys.stderr.flush()
    case_data_store['_query_ui'] = is_qt
    if is_qt:
        sys.stderr.write('[form] Detected query toolbar (有查询无保存) — skip save cues\n')
        sys.stderr.flush()
    return is_qt


async def _pack_select_record(page, case_data_store, label_text, option_text, element):
    """Build select_option params/element.

    - option_text: the value actually selected (replay contract — must stay exact)
    - options: full dropdown inventory for export / downstream products (reference)
    """
    opts = options_from_scan_store(case_data_store, label_text)
    live = await read_select_options(page, label_text)
    if live:
        # Prefer live (more complete after dropdown open); keep scan extras
        merged = list(live)
        for o in opts:
            if o not in merged:
                merged.append(o)
        opts = merged
    if option_text and option_text not in opts and option_text not in ('first', '1st', '第一个', '第一项'):
        opts = list(opts) + [option_text]
    params = {'label_text': label_text, 'option_text': option_text}
    return attach_select_options(params, element, opts)


# Read current 证件类型 / 证照类型 display value from the open form.
_JS_READ_CERT_TYPE = '''(kw) => {
    const items = document.querySelectorAll('.el-form-item');
    for (const item of items) {
        const lbl = item.querySelector('.el-form-item__label');
        if (!lbl) continue;
        if (kw.some(k => lbl.textContent.trim().includes(k))) {
            const inp = item.querySelector('input:not([type="hidden"])');
            if (inp && inp.value) return inp.value;
            const inner = item.querySelector('.el-input__inner');
            if (inner && inner.value) return inner.value;
            const selected = item.querySelector('.el-select__tags-text, .el-radio.is-checked');
            if (selected && selected.textContent) return selected.textContent.trim();
        }
    }
    return '';
}'''

# Extract validation-error field labels from parent .el-form-item (not error text).
_JS_EXTRACT_ERROR_LABELS = '''() => {
    const container = ''' + JS_GET_CONTAINER + ''';
    const items = [];
    const seen = new Set();
    for (const el of container.querySelectorAll('.el-form-item__error')) {
        const raw = (el.textContent || '').trim();
        if (!raw) continue;
        const formItem = el.closest('.el-form-item');
        let label = (formItem && formItem.querySelector('.el-form-item__label')
            ? formItem.querySelector('.el-form-item__label').textContent.trim()
            : '');
        if (!label) {
            // Fallback: strip imperative prefix from error message
            label = raw.replace(/^(请选择|请?输入|请上传|填写|完善)/, '').replace(/[：:]/g, '').trim();
        }
        if (label && label.length > 0 && label.length < 40 && !seen.has(label)) {
            seen.add(label);
            items.push(label);
        }
    }
    return JSON.stringify(items);
}'''


def _save_form_snapshot(container: str, scan_fields: list[dict], case_data_store: dict, *, emit_checkpoint: bool = True):
    """Persist form structure snapshot to case_data_store; optionally emit ACTION_LOG checkpoint.

    Builds a FormSnapshot from scan fields, upserts into the collection
    (always append in memory), and updates both form_snapshots (array) and
    form_snapshot (latest single entry) in the store.

    When emit_checkpoint is True and the fingerprint is new for this root
    container, also _record_action('save_form_snapshot') for live MySQL dual-write.
    Identical fingerprint for the same root container → memory refresh only.
    """
    snapshot = FormSnapshot.from_scan_fields(
        container=container,
        scan_fields=scan_fields,
        action_index=len(_ACTION_LOG),
    )
    existing = case_data_store.get('form_snapshots') or []
    root = FormSnapshot._root_container(snapshot.container)
    fp = snapshot.fields_fingerprint
    already = False
    for s in existing:
        prev = FormSnapshot(**s) if isinstance(s, dict) else s
        if FormSnapshot._root_container(prev.container) == root and prev.fields_fingerprint == fp:
            already = True
            break

    if already:
        # Same structure already captured — refresh latest pointer only; no new ACTION_LOG
        case_data_store['form_snapshot'] = snapshot.model_dump()
        return snapshot

    coll = FormSnapshotCollection(list(existing))
    coll.upsert(snapshot)
    case_data_store['form_snapshots'] = coll.to_dicts()
    case_data_store['form_snapshot'] = snapshot.model_dump()

    if emit_checkpoint:
        params = snapshot.model_dump()
        params['fields'] = [
            {'label': f.label, 'is_required': f.is_required}
            for f in snapshot.fields
        ]
        _record_action('save_form_snapshot', params, f'form-snapshot|{snapshot.container}|{snapshot.count}')

    return snapshot


@dataclass(frozen=True)
class ResolvedControl:
    xpath_smart: str
    label: str
    error: str = ""


def _resolve_control(case_data_store, label_text: str, xpath_hint: str = "") -> ResolvedControl:
    label = (label_text or "").strip()
    hint = (xpath_hint or "").strip()
    if hint:
        resolved_label = label
        for f in case_data_store.get("_scan_fields") or []:
            if isinstance(f, dict) and (f.get("xpath_smart") or "").strip() == hint:
                resolved_label = (f.get("label") or label).strip() or label
                break
        if resolved_label == label:
            tl = TaskList.from_store(case_data_store.get("task_list"))
            for item in list(tl.pending) + list(tl.done):
                if (item.xpath_smart or "").strip() == hint and (item.label or "").strip():
                    resolved_label = item.label.strip()
                    break
        return ResolvedControl(xpath_smart=hint, label=resolved_label or label, error="")

    matches: list[tuple[str, str]] = []
    seen_xp: set[str] = set()
    tl = TaskList.from_store(case_data_store.get("task_list"))
    for item in list(tl.pending) + list(tl.done):
        if item.label == label_text and (item.xpath_smart or "").strip():
            xp = item.xpath_smart.strip()
            if xp not in seen_xp:
                seen_xp.add(xp)
                matches.append((xp, item.label))
    for f in case_data_store.get("_scan_fields") or []:
        if not isinstance(f, dict):
            continue
        if f.get("label") != label_text:
            continue
        xp = (f.get("xpath_smart") or "").strip()
        if xp and xp not in seen_xp:
            seen_xp.add(xp)
            matches.append((xp, str(f.get("label") or label_text)))

    if not matches:
        return ResolvedControl(xpath_smart="", label=label_text or "", error="xpath-not-found")
    if len(matches) == 1:
        xp, lab = matches[0]
        return ResolvedControl(xpath_smart=xp, label=lab, error="")
    return ResolvedControl(xpath_smart="", label=label_text or "", error="ambiguous-label")


def _task_xpath_smart(case_data_store, label_text: str, xpath_hint: str = "") -> str:
    """Compat wrapper — prefer _resolve_control; returns xpath or '' (not error codes)."""
    r = _resolve_control(case_data_store, label_text, xpath_hint)
    return r.xpath_smart if not r.error else ""


def _task_done_impl(label_text, case_data_store, value=None, xpath_smart=""):
    """Mark a field as completed in the task list.

    Extracted from closure so the form module can share it internally
    and future split modules can import it.

    ``value`` is the value that was just written (fill/select). Stored on
    TaskItem.currentValue so scan_form_fields summaries are not empty after
    auto-fill.

    When ``xpath_smart`` is set, disambiguates duplicate labels in mark_done.

    Query/filter UI is not form-fill — skip task_list tracking entirely.
    """
    if _is_query_mode(case_data_store):
        return
    xp = _task_xpath_smart(case_data_store, label_text, xpath_smart)
    tl = TaskList.from_store(case_data_store.get('task_list'))
    found = tl.mark_done(label_text, value=value, xpath_smart=xp)
    if found is not None:
        sys.stderr.write(f'[task-done] OK: "{label_text}" → done={len(tl.done)}\n')
    else:
        already = tl.find_done(label_text)
        if already is None and xp:
            already = next((d for d in tl.done if d.xpath_smart == xp), None)
        if already is None:
            sys.stderr.write(f'[task-done] NOT FOUND: "{label_text}"\n')
        else:
            sys.stderr.write(f'[task-done] ALREADY: "{label_text}"\n')
    case_data_store['task_list'] = tl.to_store()
    if value is not None and str(value).strip():
        labels = case_data_store.setdefault('_autofilled_labels', [])
        if label_text not in labels:
            labels.append(label_text)
        case_data_store.setdefault('_generated_value_cache', {})[label_text] = str(value)


def _submit_ready_hint(case_data_store: dict, section: str = '') -> str:
    """Return a short NEXT_ACTION cue when fillable pending is empty.

    Query/filter UI is never form-fill — no click_save / pending-form cues.
    Prefers PhaseBoundary.next_action_hint when active.
    """
    if _is_query_mode(case_data_store):
        return ''
    try:
        from ._phase_boundary import next_action_hint, phase_boundary_active
        if phase_boundary_active(case_data_store):
            cue = next_action_hint(case_data_store)
            if cue:
                return cue
    except Exception:
        pass
    tl = TaskList.from_store(case_data_store.get('task_list'))
    from ._section_scope import section_matches
    sec = (section or '').strip()
    fillable = [
        i for i in tl.pending
        if not i.needs_intervention
        and section_matches(sec, i.section_id, i.section_title)
    ]
    if fillable:
        return ''
    # Legacy needs_intervention pending (old stores): do not block save cues —
    # introduce is agent/special-element/manual, not assistant intervene.
    if tl.total > 0:
        c = case_data_store.get('_phase_intent')
        if isinstance(c, dict):
            try:
                from ._phase_reviewer import coerce_bool
                submit = c.get('submit') if isinstance(c.get('submit'), dict) else {}
                kinds = (c.get('success') or {}).get('kinds') or []
                if not isinstance(kinds, (list, tuple)):
                    kinds = []
                if not coerce_bool(submit.get('required')) and len(kinds) == 0:
                    return (
                        'NEXT_ACTION: done(success=true) | this phase does not require save. '
                        'Do NOT call click_save(). Confirm the field change then done().'
                    )
            except Exception:
                pass
        # Auto-bind unique save section when not explicitly scoped
        if not sec:
            try:
                from ._section_scope import unique_button_section
                auto_sec = unique_button_section(case_data_store.get('_scan_buttons'), '保存')
                if auto_sec:
                    sec = auto_sec
            except Exception:
                pass
        # Include section= when scoped so caller can pass it through to click_save
        sec_part = f", section='{sec}'" if sec else ''
        return (
            f'NEXT_ACTION: click_save(button_text=\'保存\'{sec_part}) | fillable pending=0. '
            'Call click_save() NOW (auto-finds 保存/提交, scrolls into view). '
            'Do NOT scroll_down / click_element_by_index to hunt for 保存. '
            'Do NOT re-fill or re-select already-filled fields.'
        )
    return ''


def _switch_task_list_container(case_data_store: dict, container_id: str) -> None:
    """Persist/restore task_list keyed by JS_IDENTIFY_CONTAINER id."""
    by = case_data_store.setdefault('_task_lists_by_container', {})
    if not isinstance(by, dict):
        by = {}
        case_data_store['_task_lists_by_container'] = by
    active = case_data_store.get('_active_container')
    if active and active != container_id:
        # Save current flat view
        by[active] = {
            'task_list': case_data_store.get('task_list'),
            '_scan_fields': case_data_store.get('_scan_fields'),
        }
    case_data_store['_active_container'] = container_id
    saved = by.get(container_id)
    if isinstance(saved, dict):
        if saved.get('task_list') is not None:
            case_data_store['task_list'] = saved['task_list']
        if saved.get('_scan_fields') is not None:
            case_data_store['_scan_fields'] = saved['_scan_fields']
    elif active != container_id:
        # Fresh container — clear flat view so scan runs
        case_data_store.pop('task_list', None)
        case_data_store.pop('_scan_fields', None)
        case_data_store.pop('_autofill_summary', None)
        case_data_store.pop('_submit_ready', None)


def _with_submit_cue(result: str, case_data_store: dict) -> str:
    """Append auto-fill / submit-ready cue — skipped entirely for query/filter UI."""
    if _is_query_mode(case_data_store):
        case_data_store.pop('_autofill_summary', None)
        case_data_store.pop('_submit_ready', None)
        case_data_store.pop('_query_ready', None)
        return result
    parts = [result]
    summary = case_data_store.pop('_autofill_summary', None)
    if summary:
        parts.append(summary)
    cue = _submit_ready_hint(case_data_store)
    if cue:
        parts.append(cue)
        # Only arm recorder's click_save HumanMessage inject for real save cues.
        if 'NEXT_ACTION: click_save()' in cue:
            case_data_store['_submit_ready'] = True
        else:
            case_data_store.pop('_submit_ready', None)
    return ' | '.join(parts)


def _query_not_form_payload(container_id: str = '') -> str:
    """JSON payload telling the agent this UI is not form-fill."""
    return json.dumps({
        'not_form_fill': True,
        'mode': 'query_filter',
        'container': container_id or '',
        'hint': _QUERY_NEXT_HINT,
    }, ensure_ascii=False)


async def _clear_field_value(page, label_text):
    """Clear a form field's input value by label.

    Targets the input inside .el-form-item that matches the label,
    resets its value and dispatches input/change events so Vue picks it up.
    """
    try:
        await page.evaluate('''(label) => {
            const items = document.querySelectorAll('.el-form-item');
            for (const item of items) {
                const lbl = item.querySelector('.el-form-item__label');
                if (!lbl || !lbl.textContent.trim().includes(label)) continue;
                const trigger = item.querySelector('input, .el-input__inner, textarea');
                if (!trigger) continue;
                // Clear via native setter so Vue reacts
                Object.getOwnPropertyDescriptor(
                    HTMLInputElement.prototype, 'value'
                ).set.call(trigger, '');
                trigger.dispatchEvent(new Event('input', { bubbles: true }));
                trigger.dispatchEvent(new Event('change', { bubbles: true }));
                trigger.setAttribute('value', '');
                return 'cleared';
            }
            return 'not-found';
        }''', label_text)
    except Exception:
        pass


def _register_form_actions(controller, browser_context, case_data_store, llm=None):
    # Lazily read hasButton keywords — supports runtime override via case_data_store
    def _button_keywords():
        return get_has_button_keywords(case_data_store)

    async def _ensure_scanned(label_text: str, *, allow_autofill: bool = False):
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
        if case_data_store.get('_watcher_mode'):
            return  # CDP watcher: single-field action, no auto-scan
        page = await browser_context.get_current_page()
        container_id = await page.evaluate(JS_IDENTIFY_CONTAINER)

        # Remember parent before entering search/picker dialog
        if _is_search_dialog(container_id) or (
            container_id.startswith(('dialog:', 'drawer:'))
            and case_data_store.get('_active_container')
            and not str(case_data_store.get('_active_container')).startswith(('dialog:', 'drawer:'))
        ):
            if not case_data_store.get('_parent_container_before_picker'):
                case_data_store['_parent_container_before_picker'] = (
                    case_data_store.get('_active_container') or 'main'
                )

        _switch_task_list_container(case_data_store, container_id)

        async def _rebuild_task_list_from_dom(*, autofill: bool) -> None:
            raw = await page.evaluate(JS_SCAN_FORM_FIELDS, [False, _button_keywords()])
            try:
                result = json.loads(raw) if isinstance(raw, str) else raw
                raw_fields = result.get('fields') if isinstance(result, dict) else result
            except Exception:
                return
            dom_fields = [ScannedField(**f) if isinstance(f, dict) else f for f in raw_fields]
            cid = result.get('container', container_id) if isinstance(result, dict) else container_id
            _switch_task_list_container(case_data_store, cid)
            _save_form_snapshot(cid, [f.model_dump() for f in dom_fields], case_data_store)
            case_data_store['_scan_buttons'] = _scan_buttons_from_result(result)
            session_filled = set(case_data_store.get('_autofilled_labels') or [])
            tl = TaskList.from_scan(
                [f.model_dump() for f in dom_fields],
                force_refill=_force_refill_flag(case_data_store),
                session_filled_labels=session_filled,
            )
            case_data_store['task_list'] = tl.to_store()
            case_data_store['_scan_fields'] = [f.model_dump() for f in dom_fields]
            by = case_data_store.setdefault('_task_lists_by_container', {})
            if isinstance(by, dict):
                by[cid] = {
                    'task_list': case_data_store.get('task_list'),
                    '_scan_fields': case_data_store.get('_scan_fields'),
                }
            if autofill and tl.pending:
                await _auto_fill_pending()
                tl_after = TaskList.from_store(case_data_store.get('task_list'))
                fillable_left = sum(1 for i in tl_after.pending if not i.needs_intervention)
                case_data_store['_autofill_summary'] = (
                    f'auto-fill-complete done={len(tl_after.done)} '
                    f'fillable_pending={fillable_left}'
                )
                if fillable_left == 0:
                    case_data_store['_submit_ready'] = True
                if isinstance(by, dict):
                    by[cid] = {
                        'task_list': case_data_store.get('task_list'),
                        '_scan_fields': case_data_store.get('_scan_fields'),
                    }

        # Force rescan when parent marked stale after picker close
        stale = case_data_store.get('_form_stale')
        if stale and stale == container_id:
            case_data_store.pop('_form_stale', None)
            sys.stderr.write(f'[form] force rescan stale container={container_id}\n')
            sys.stderr.flush()
            if not allow_autofill:
                await _rebuild_task_list_from_dom(autofill=False)
                return
            case_data_store.pop('task_list', None)
            case_data_store.pop('_scan_fields', None)

        if await _mark_query_ui_if_needed(page, case_data_store, container_id):
            return  # query/filter UI
        if not allow_autofill:
            # First touch of this container (fresh switch clears _scan_fields;
            # restored containers keep it) — scan + structure checkpoint only.
            if not case_data_store.get('_scan_fields'):
                sys.stderr.write(
                    f'[form] first-touch structure scan container={container_id!r}\n'
                )
                sys.stderr.flush()
                await _rebuild_task_list_from_dom(autofill=False)
            return
        if _skip_auto_fill(case_data_store):
            # form_modify partial (or query flagged without DOM yet)
            return

        tl = TaskList.from_store(case_data_store.get('task_list'))
        if tl.total > 0:
            pending_labels = {d.label for d in tl.pending}
            done_labels = {d.label for d in tl.done}
            if label_text in pending_labels or label_text in done_labels:
                return  # already scanned for this form

        sys.stderr.write(
            f'[form] rescan triggered label_text={label_text!r} container={container_id!r} '
            f'tl.total={tl.total} force_refill={_force_refill_flag(case_data_store)}\n'
        )
        sys.stderr.flush()
        await _rebuild_task_list_from_dom(autofill=True)

    @controller.action('Expand ALL el-tree nodes recursively (up to 10 rounds).')
    async def expand_all_el_tree():
        page = await browser_context.get_current_page()
        total = 0
        for _ in range(10):
            clicked = await page.evaluate('''() => {
                const tree = document.querySelector('.el-tree');
                if (!tree) return -1;
                let n = 0;
                tree.querySelectorAll('.el-tree-node:not(.is-expanded)').forEach(node => {
                    const icon = node.querySelector(':scope > .el-tree-node__content > .el-tree-node__expand-icon');
                    if (icon) { icon.click(); n++; }
                });
                return n;
            }''')
            if clicked == -1:
                return _err('no-el-tree-found')
            if clicked == 0:
                break
            total += clicked
            await page.wait_for_timeout(500)
        return _ok(f'ok-expanded-{total}-nodes')

    @controller.action('Login to the system. Fills username + password (+ optional captcha/sms), clicks login button, waits for navigation. Use this instead of manually filling login fields one by one.')
    async def login(username: str, password: str, captcha: str = '', sms_code: str = ''):
        page = await browser_context.get_current_page()
        await _wait_if_loading(page)

        results = []

        # Fill username (try common labels)
        u_r = await page.evaluate(JS_FILL_FORM_FIELD, ['用户名', username])
        if u_r == 'label-not-found':
            u_r = await page.evaluate(JS_FILL_FORM_FIELD, ['账号', username])
        results.append(f'user:{u_r}')

        # Fill password
        p_r = await page.evaluate(JS_FILL_FORM_FIELD, ['密码', password])
        results.append(f'pass:{p_r}')

        # Optionally fill captcha
        if captcha:
            c_r = await page.evaluate(JS_FILL_FORM_FIELD, ['验证码', captcha])
            if c_r == 'label-not-found':
                c_r = await page.evaluate(JS_FILL_FORM_FIELD, ['图形验证码', captcha])
            results.append(f'captcha:{c_r}')

        # Optionally fill SMS code
        if sms_code:
            s_r = await page.evaluate(JS_FILL_FORM_FIELD, ['短信验证码', sms_code])
            if s_r == 'label-not-found':
                s_r = await page.evaluate(JS_FILL_FORM_FIELD, ['手机验证码', sms_code])
            results.append(f'sms:{s_r}')

        # Click login button
        clicked = await page.evaluate('''() => {
            const container = ''' + JS_GET_CONTAINER + ''';
            for (const btn of container.querySelectorAll('button')) {
                const t = btn.textContent.trim().replace(/\\s/g, '');
                if ((t === '登录' || t === '登錄' || t === 'Login') && btn.offsetParent !== null && !btn.disabled) {
                    btn.click();
                    return 'ok';
                }
            }
            return 'not-found';
        }''')
        results.append(f'btn:{clicked}')

        # Wait for post-login navigation
        await page.wait_for_timeout(3000)
        _record_action('login', {'username': username, 'password': password, 'captcha': captcha, 'sms_code': sms_code}, 'ok-login')
        return _ok('ok-login | ' + ' '.join(results), include_in_memory=True)

    @controller.action('Get a value for a form field by its label using form rules. For 证件号码, reads 证件类型 from the page and generates the matching format (身份证 → ID card, 统一社会信用代码/营业执照 → credit code). Prefers case_data_store presets when present.')
    async def match_form_rule(label_text: str):
        # 业务数据（用户需求）仅作原文提示给 AI；不用 label↔key 硬匹配灌值
        t = (label_text or '').replace(' ', '')
        if '证件号码' in t or (t.endswith('证件号') and '类型' not in t):
            page = await browser_context.get_current_page()
            try:
                cert_type = await page.evaluate(_JS_READ_CERT_TYPE, ['证件类型', '证照类型', '证件种类'])
            except Exception:
                cert_type = ''
            val = match_cert_number(cert_type or '')
            sys.stderr.write(f'[match-form-rule] cert_type={cert_type!r} → {val}\n')
            sys.stderr.flush()
            return val
        val = match_rule(label_text)
        return val if val else 'NO-RULE'

    @controller.action('Fill a form field using Element UI native DOM setter. Works for text inputs AND date fields (sets value directly).')
    async def fill_form_field(label_text: str, value: str, xpath_smart: str = ""):
        page = await browser_context.get_current_page()
        await _wait_if_loading(page)
        await _ensure_scanned(label_text)
        resolved = _resolve_control(case_data_store, label_text, xpath_smart)
        if resolved.error:
            return resolved.error
        element = await _capture_element(page, resolved.label, target_kind='form_input')
        result = await page.evaluate(JS_FILL_BY_XPATH, [resolved.xpath_smart, value, resolved.label])
        if _is_ok_result(result):
            _record_action(
                'fill_form_field',
                {'label_text': resolved.label, 'value': value, 'xpath_smart': resolved.xpath_smart},
                result,
                element=element,
            )
            if not _is_query_mode(case_data_store):
                _task_done_impl(
                    resolved.label, case_data_store, value=value, xpath_smart=resolved.xpath_smart,
                )
            return _ok(_with_submit_cue(result, case_data_store))
        return _with_submit_cue(result, case_data_store)

    @controller.action('Fill an Element UI date picker by label text. Value should be in YYYY-MM-DD format.')
    async def fill_date_field(label_text: str, value: str, xpath_smart: str = ""):
        page = await browser_context.get_current_page()
        await _wait_if_loading(page)
        await _ensure_scanned(label_text)
        resolved = _resolve_control(case_data_store, label_text, xpath_smart)
        if resolved.error:
            return resolved.error
        element = await _capture_element(page, resolved.label, target_kind='form_date')
        result = await page.evaluate(JS_FILL_DATE_BY_XPATH, [resolved.xpath_smart, value])
        if _is_ok_result(result):
            _record_action(
                'fill_date_field',
                {'label_text': resolved.label, 'value': value, 'xpath_smart': resolved.xpath_smart},
                result,
                element=element,
            )
            if not _is_query_mode(case_data_store):
                _task_done_impl(
                    resolved.label, case_data_store, value=value, xpath_smart=resolved.xpath_smart,
                )
            return _ok(_with_submit_cue(result, case_data_store))
        return _with_submit_cue(result, case_data_store)

    @controller.action('Check the current value of a single form field by its label. Returns JSON with label/kind/currentValue/placeholder/disabled/selected/required. Use this to verify a field was filled correctly by checking currentValue.')
    async def check_field_value(label_text: str):
        page = await browser_context.get_current_page()
        return await page.evaluate(JS_CHECK_SINGLE_FIELD, [label_text, _button_keywords()])

    @controller.action('Verify that a form field has an expected value. Calls check_field_value and compares currentValue with expected. Returns ok if match, err if mismatch. Use this to confirm a field was filled correctly.')
    async def verify_field_value(label_text: str, expected: str):
        page = await browser_context.get_current_page()
        raw = await page.evaluate(JS_CHECK_SINGLE_FIELD, [label_text, _button_keywords()])
        if raw == 'label-not-found':
            return _err('label-not-found')
        try:
            info = json.loads(raw)
        except Exception:
            return raw
        current = info.get('currentValue', '')
        if current and (current == expected or expected in current or current in expected):
            return _ok(f'verified:{current}')
        return _err(f'mismatch | current:{current} | expected:{expected}')

    @controller.action('Full scan: ALL form fields in the current dialog/drawer regardless of visibility. Builds task list + form snapshot only — does NOT auto-fill (use run_form_assistant for batch auto-fill). Returns summary {total, filled, pending, ...}.')
    async def scan_form_fields():
        page = await browser_context.get_current_page()
        await _wait_if_loading(page)
        container_id = await page.evaluate(JS_IDENTIFY_CONTAINER)
        if await _mark_query_ui_if_needed(page, case_data_store, container_id):
            return _query_not_form_payload(container_id)
        raw = await page.evaluate(JS_SCAN_FORM_FIELDS, [False, _button_keywords()])
        try:
            result = json.loads(raw) if isinstance(raw, str) else raw
            raw_fields = result.get('fields') if isinstance(result, dict) else result
        except Exception:
            return raw

        dom_fields: list[ScannedField] = [
            ScannedField(**f) if isinstance(f, dict) else f
            for f in raw_fields
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
        'Batch-scan and auto-fill editable form fields in the current container. '
        'Call only when the phase contract allows form assistant (create / full modify). '
        'Do not use on navigate/query phases.'
    )
    async def run_form_assistant(section: str = ''):
        from ._phase_intent import contract_allows_form_assistant
        if not contract_allows_form_assistant(case_data_store):
            return 'err-form-assistant-forbidden: phase contract allow_form_assistant=false'
        page = await browser_context.get_current_page()
        await _wait_if_loading(page)
        sec = (section or '').strip()
        if sec:
            from ._section_scope import remember_phase_section
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
        raw = await page.evaluate(JS_SCAN_FORM_FIELDS, [True, _button_keywords()])
        try:
            result = json.loads(raw) if isinstance(raw, str) else raw
            raw_fields = result.get('fields') if isinstance(result, dict) else result
        except Exception:
            return raw

        dom_fields: list[ScannedField] = [
            ScannedField(**f) if isinstance(f, dict) else f
            for f in raw_fields
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
        fields = case_data_store.get('_scan_fields', [])

        snap = _save_form_snapshot(container_id, fields, case_data_store)
        return _ok(f'form-snapshot | container:{container_id} | count:{snap.count}')

    # 内部函数 — 由 run_form_assistant → _ensure_scanned(allow_autofill=True) 触发自动填；
    # 单字段 first-touch / stale 仅走 _rebuild(autofill=False) 落结构。
    # 按 kind 分组（date→select→input→radio→checkbox→tree-select）多次调用 LLM，
    # 失败字段保留在 pending 供 agent 手动处理，成功字段记录 action + task_done。
    # ── 辅助闭包（共享 page / llm / case_data_store）──
    #
    # _execute_round: 分组 → LLM → 逐个执行，三轮回合共用。
    # _scan_new_fields: 全量扫描 → 差值过滤 → TaskItem 创建，Round 2/3 共用。

    async def _execute_round(page, items, label_kind, all_results, round_tag):
        """分组 → LLM 规划 → 逐个执行。round_tag: '' | 'round2 ' | 'round3 '"""
        from ._section_scope import section_matches

        filt = (case_data_store.get('_assistant_section_filter') or '').strip()

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

        async def _select_by_xpath(page, value, xpath_smart):
            """Xpath-only select open+pick (Phase A hard-cut — no labeled fallback)."""
            xp = (xpath_smart or '').strip()
            if not xp:
                return 'xpath-not-found'
            _FIRST = ('first', '1st', '第一个', '第一项')
            already = await page.evaluate(JS_SELECT_VALUE_BY_XPATH, [xp])
            if str(already).startswith('ok-already:'):
                cur_val = already.split(':', 1)[1]
                if (
                    (value or '').strip().lower() in _FIRST
                    or cur_val == value
                    or value in cur_val
                    or cur_val in value
                ):
                    return already
            trigger = await page.evaluate(JS_SELECT_TRIGGER_BY_XPATH, [xp])
            if not str(trigger).startswith('ok'):
                return trigger
            await page.wait_for_timeout(350)
            result = await page.evaluate(JS_SELECT_OPTION, value)
            if str(result).startswith('option-not-found:'):
                result = await page.evaluate(JS_SELECT_OPTION, 'first')
            if str(result) == 'no-items':
                recheck = await page.evaluate(JS_SELECT_VALUE_BY_XPATH, [xp])
                if str(recheck).startswith('ok-already:'):
                    return recheck
            return result

        KIND_ORDER = {'date': 0, 'select': 1, 'input': 2, 'radio': 3, 'checkbox': 4, 'tree-select': 5}
        groups: dict[int, list[dict]] = {}
        for d in items:
            if filt and not section_matches(filt, d.get('section_id', ''), d.get('section_title', '')):
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

            cache = case_data_store.get('_generated_value_cache', {})
            for d in sub:
                lbl = d.get('label', '') or ''
                if lbl in cache and not (d.get('commandValue') and str(d.get('commandValue')).strip()):
                    d['commandValue'] = cache[lbl]

            actions, needs = _llm_generate_values(
                llm, sub, case_data_store=case_data_store, section=filt,
            )
            if needs:
                case_data_store.setdefault('_assistant_needs_agent', []).extend(needs)
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
                    resolved = _resolve_control(case_data_store, label, '')
                    if not resolved.error:
                        xpath_smart = resolved.xpath_smart
                        if resolved.label:
                            label = resolved.label
                    else:
                        # Plumb ambiguous-label / xpath-not-found (do not collapse)
                        resolve_error = resolved.error
                placeholder = field_dict.get('placeholder') or label
                step_num = i + 1
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
                element = await _capture_element(page, label, target_kind=capture_kind)
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
                                    )
                            if not _is_ok_result(result):
                                if xpath_smart:
                                    sel_try = await page.evaluate(
                                        JS_SELECT_TRIGGER_BY_XPATH, [xpath_smart],
                                    )
                                    if str(sel_try).startswith('ok'):
                                        await page.wait_for_timeout(350)
                                        opt = fill_val if fill_val and fill_val.lower() != 'first' else 'first'
                                        sel_result = await page.evaluate(JS_SELECT_OPTION, opt)
                                        if _is_ok_result(sel_result):
                                            result = sel_result
                                            kind = 'select_option'
                                            field_kind = 'select'
                                            capture_kind = 'form_select'
                                            element = await _capture_element(
                                                page, label, target_kind='form_select',
                                            )
                                else:
                                    sel_try = await page.evaluate(JS_FIND_LABELED_SELECT, [label, 'trigger'])
                                    if sel_try and not str(sel_try).startswith('label-not-found'):
                                        await page.wait_for_timeout(350)
                                        opt = fill_val if fill_val and fill_val.lower() != 'first' else 'first'
                                        sel_result = await page.evaluate(JS_SELECT_OPTION, opt)
                                        if _is_ok_result(sel_result):
                                            result = sel_result
                                            kind = 'select_option'
                                            field_kind = 'select'
                                            capture_kind = 'form_select'
                                            element = await _capture_element(
                                                page, label, target_kind='form_select',
                                            )
                    elif kind in ('select_option', 'select', 'option'):
                        result = await _select_by_xpath(page, value, xpath_smart)
                    else:
                        result = f'unknown-action:{kind}'
                except Exception as e:
                    result = f'error:{e}'

                ok = _is_ok_result(result)
                entry = {'index': step_num, 'action': kind, 'label': label, 'value': value, 'result': result}
                all_results.append(entry)

                if ok:
                    ok_in_group += 1
                    if field_kind == 'radio' or kind in ('click_radio', 'radio'):
                        await record_action_with_screenshots(
                            page,
                            'click_radio',
                            {
                                'label_text': label,
                                'option_text': value,
                                'xpath_smart': xpath_smart,
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
                                'xpath_smart': xpath_smart,
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
                                    'xpath_smart': xpath_smart,
                                },
                                result,
                                element=element,
                                before_b64=before_b64,
                            )
                        else:
                            params, element = await _pack_select_record(
                                page, case_data_store, label, value, element,
                            )
                            if xpath_smart:
                                params['xpath_smart'] = xpath_smart
                            await record_action_with_screenshots(
                                page,
                                'select_option',
                                params,
                                result,
                                element=element,
                                before_b64=before_b64,
                            )
                    _task_done_impl(
                        label, case_data_store, value=value, xpath_smart=xpath_smart,
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

    def _scan_new_fields(dom_fields, tl):
        """扫描新字段：差值过滤 + TaskItem 创建。返回 new_pending dicts。"""
        from ._section_scope import section_matches

        filt = (case_data_store.get('_assistant_section_filter') or '').strip()
        known_labels = {d.label for d in tl.pending} | {d.label for d in tl.done}
        new_pending: list[dict] = []
        for f in dom_fields:
            if not f.label or f.label in known_labels or f.currentValue.strip():
                continue
            if filt and not section_matches(filt, f.section_id, f.section_title):
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
            case_data_store['task_list'] = tl.to_store()
            # Debug: verify store has the items
            verify = TaskList.from_store(case_data_store.get('task_list'))
            verify_labels = {i.label for i in verify.pending}
            sys.stderr.write(f'[auto-fill] _scan_new_fields: +{len(new_pending)} new={new_labels}, done={len(tl.done)} pending={len(tl.pending)}\n')
            sys.stderr.write(f'[auto-fill] _scan_new_fields verify: store pending has {len(verify.pending)} items, labels={list(verify_labels)[:3]}...\n')
            sys.stderr.flush()
        return new_pending

    # ═══════════════════════════════════════════════════════════════════════
    # Round 1: 初始 pending → 分组 → LLM → 执行
    # ═══════════════════════════════════════════════════════════════════════
    async def _auto_fill_pending():
        from ._section_scope import section_matches

        case_data_store['_assistant_needs_agent'] = []
        page = await browser_context.get_current_page()
        await _wait_if_loading(page)
        tl = TaskList.from_store(case_data_store.get('task_list'))
        autofilled = set(case_data_store.get('_autofilled_labels') or [])
        filt = (case_data_store.get('_assistant_section_filter') or '').strip()
        pending = [
            item for item in tl.pending
            if not item.needs_intervention
            and not (item.label in autofilled and (item.currentValue or '').strip())
            and section_matches(filt, item.section_id, item.section_title)
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
                case_data_store['_ref_date'] = ref_date
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
        await _execute_round(page, pending_dicts, label_kind, all_results, '')

        # ═══════════════════════════════════════════════════════════════════
        # Round 2: 级联扫描 — select 赋值后可能 reveal 新字段
        # ═══════════════════════════════════════════════════════════════════
        round1_count = len(all_results)
        try:
            raw2 = await page.evaluate(JS_SCAN_FORM_FIELDS, [False, _button_keywords()])
            result2 = json.loads(raw2) if isinstance(raw2, str) else raw2
            raw_fields2 = result2.get('fields') if isinstance(result2, dict) else result2
        except Exception:
            raw_fields2 = []
        dom_fields2 = [ScannedField(**f) if isinstance(f, dict) else f for f in raw_fields2]
        tl = TaskList.from_store(case_data_store.get('task_list'))
        new_pending2 = _scan_new_fields(dom_fields2, tl)
        if new_pending2:
            await page.evaluate(
                's => console.log("[AI填表] 第二轮(联动): " + s)',
                f'{len(new_pending2)}个新字段',
            )
            label_kind2 = {d['label']: d.get('kind', 'input') for d in new_pending2}
            await _execute_round(page, new_pending2, label_kind2, all_results, 'round2 ')

        # ═══════════════════════════════════════════════════════════════════
        # Round 3: 深层联动扫描
        # ═══════════════════════════════════════════════════════════════════
        round2_count = len(all_results)
        try:
            raw3 = await page.evaluate(JS_SCAN_FORM_FIELDS, [False, _button_keywords()])
            result3 = json.loads(raw3) if isinstance(raw3, str) else raw3
            raw_fields3 = result3.get('fields') if isinstance(result3, dict) else result3
        except Exception:
            raw_fields3 = []
        dom_fields3 = [ScannedField(**f) if isinstance(f, dict) else f for f in raw_fields3]
        tl = TaskList.from_store(case_data_store.get('task_list'))
        new_pending3 = _scan_new_fields(dom_fields3, tl)
        if new_pending3:
            await page.evaluate(
                's => console.log("[AI填表] 第三轮(深层联动): " + s)',
                f'{len(new_pending3)}个新字段',
            )
            label_kind3 = {d['label']: d.get('kind', 'input') for d in new_pending3}
            await _execute_round(page, new_pending3, label_kind3, all_results, 'round3 ')

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
            raw_sync = await page.evaluate(JS_SCAN_FORM_FIELDS, [False, _button_keywords()])
            sync_result = json.loads(raw_sync) if isinstance(raw_sync, str) else raw_sync
            sync_fields = sync_result.get('fields') if isinstance(sync_result, dict) else sync_result
            dom_labels = {f.get('label', '') for f in sync_fields}
        except Exception:
            dom_labels = set()

        if dom_labels:
            tl_sync = TaskList.from_store(case_data_store.get('task_list'))
            stale = [item for item in tl_sync.pending
                     if item.label not in dom_labels and not item.needs_intervention]
            for item in stale:
                tl_sync.pending.remove(item)
                sys.stderr.write(f'[auto-fill] Removed stale pending: "{item.label}" (not in DOM)\n')
            if stale:
                case_data_store['task_list'] = tl_sync.to_store()
                sys.stderr.flush()

        tl_debug = TaskList.from_store(case_data_store.get('task_list'))
        sys.stderr.write(f'[auto-fill] DEBUG done={len(tl_debug.done)} pending={len(tl_debug.pending)}\n')
        sys.stderr.flush()
        return _ok(f'auto-fill-done | ok:{ok_count} failed:{failed_count} | ' + json.dumps(all_results, ensure_ascii=False))

    @controller.action('Mark a form field as completed in the task list. Use this after successfully filling a field.')
    async def task_done(label_text: str):
        _task_done_impl(label_text, case_data_store)
        tl = TaskList.from_store(case_data_store.get('task_list'))
        return _ok(f'task-done:{label_text} | remaining:{len(tl.pending)}')

    @controller.action('Get the current pending task list. Returns {"pending": [...], NEXT_ACTION}. When pending is empty, NEXT_ACTION tells you to click 保存 — do not re-fill fields.')
    async def get_pending_tasks(section: str = ''):
        if _is_query_mode(case_data_store):
            return _ok(_query_not_form_payload(), include_in_memory=True)
        from ._section_scope import section_matches, pending_by_section
        tl = TaskList.from_store(case_data_store.get('task_list'))
        sec = (section or '').strip()
        pending_items = [
            i for i in tl.pending
            if not i.needs_intervention
            and section_matches(sec, i.section_id, i.section_title)
        ]
        pending_payload = [i.model_dump() for i in pending_items]
        sys.stderr.write(
            f'[get-pending] done={len(tl.done)} pending={len(tl.pending)} section={sec!r}\n'
        )
        sys.stderr.flush()
        result = {
            'pending': pending_payload,
            'done': len(tl.done),
            'pending_by_section': pending_by_section(tl),
            'section_filter': sec or None,
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
        'Optional section scopes to a collapse/tab/card block when multiple同名按钮 exist. '
        'Returns ok-save-success when 操作成功 toast appears, ok-save-navigation when URL changes, '
        'or ok-save-no-feedback when the click completes with no toast/error/navigation '
        '(silent save — still success). On validation errors returns err-save-validation.'
    )
    async def click_save(button_text: str = '保存', section: str = ''):
        from ._phase_intent import check_pending_write_gate, contract_force_refill, record_success_token

        page = await browser_context.get_current_page()
        container_id = await page.evaluate(JS_IDENTIFY_CONTAINER)
        compact_btn = re.sub(r'\s+', '', (button_text or '保存').strip()) or '保存'
        sec = (section or "").strip()
        explicit_sec = bool((section or "").strip())
        # Resolve section: explicit → _phase_section memory → rescan+unique → ""
        if not sec:
            try:
                from ._section_scope import norm_sec
                mem = norm_sec(str(case_data_store.get("_phase_section") or ""))
                if mem:
                    sec = mem
                    sys.stderr.write(f'[click_save] phase section={sec!r} from memory\n')
                    sys.stderr.flush()
            except Exception:
                pass
        if not sec and not explicit_sec:
            try:
                await refresh_scan_buttons(page, case_data_store)
                from ._section_scope import unique_button_section
                auto_sec = unique_button_section(case_data_store.get('_scan_buttons'), compact_btn)
                if auto_sec:
                    sec = auto_sec
                    sys.stderr.write(f'[click_save] auto section={auto_sec!r} from unique button\n')
                    sys.stderr.flush()
            except Exception:
                pass
        if sec:
            from ._section_scope import remember_phase_section
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
                from ._section_scope import pending_by_section, requires_section_declaration

                needs_gate = False
                if phase_boundary_active(case_data_store):
                    b = get_phase_boundary(case_data_store) or {}
                    needs_gate = bool(b.get("requires_write_all_editable"))
                else:
                    needs_gate = contract_force_refill(case_data_store)
                if needs_gate and not sec:
                    tl0 = TaskList.from_store((case_data_store or {}).get("task_list"))
                    by = pending_by_section(tl0)
                    if requires_section_declaration(tl0):
                        return _err(
                            "err-section-required | pending_by_section="
                            + json.dumps(by, ensure_ascii=False)
                            + " | Pass section= for the phase block (judge from 阶段任务 / 阶段目录).",
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
        await page.evaluate(r'''() => {
          const successRe = /操作成功|保存成功|提交成功|新建成功|修改成功|删除成功/;
          const failRe = /失败|错误|异常|不能|不允许|已存在|重复|校验|必填|不通过/;
          window.__saveWatch = { successNotifs: [], errorNotifs: [] };
          const take = (el) => {
            const t = (el.textContent || '').replace(/\s+/g, ' ').trim();
            if (!t) return;
            if (failRe.test(t) || /el-notification--error|el-message--error/.test(el.className || ''))
              window.__saveWatch.errorNotifs.push(t.slice(0, 160));
            else
              window.__saveWatch.successNotifs.push(t.slice(0, 160));
          };
          for (const el of document.querySelectorAll('.el-notification, .el-message')) take(el);
          const obs = new MutationObserver((muts) => {
            for (const m of muts) {
              for (const n of m.addedNodes || []) {
                if (!n || n.nodeType !== 1) continue;
                if (n.matches && (n.matches('.el-notification, .el-message') || n.querySelector?.('.el-notification, .el-message'))) {
                  if (n.matches?.('.el-notification, .el-message')) take(n);
                  for (const el of (n.querySelectorAll?.('.el-notification, .el-message') || [])) take(el);
                }
              }
            }
          });
          obs.observe(document.body, { childList: true, subtree: true });
          window.__saveWatchObs = obs;
        }''')

        raw = await page.evaluate(JS_CLICK_SAVE_BUTTON, [button_text or '保存', sec])
        try:
            info = json.loads(raw) if isinstance(raw, str) else (raw or {})
        except Exception:
            info = {}
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
                    f'Multiple visible "{needle}" buttons — pass section= to click_save '
                    f'(collapse/tab/card title from scan sections).',
                    include_in_memory=True,
                )
            sec_hint = f' section={sec!r}' if sec else ''
            return _err(
                f'err-save-button-not-found:{needle}{sec_hint}. '
                f'candidates={cand_json}. '
                f'Close interfering dialogs (查询/返回) with close_dialog, or pass section= for scoped save.',
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
                        result = json.loads(raw) if isinstance(raw, str) else raw
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
                return _ok(
                    'ok-introduce-confirm | Picker confirmed; introduce fields should be backfilled. '
                    'Continue filling remaining form fields then click_save(button_text="保存").',
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
            info = json.loads(raw) if isinstance(raw, str) else raw
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
        page = await browser_context.get_current_page()
        await _wait_if_loading(page)
        await _ensure_scanned(label_text)
        resolved = _resolve_control(case_data_store, label_text, xpath_smart)
        if resolved.error:
            return resolved.error
        xp = resolved.xpath_smart
        label_text = resolved.label or label_text

        element = await _capture_element(page, label_text, target_kind='form_select')

        # Xpath-only already-matched (no JS_FIND_LABELED_SELECT).
        already = await page.evaluate(JS_SELECT_VALUE_BY_XPATH, [xp])
        if str(already).startswith('ok-already:'):
            cur_val = already.split(':', 1)[1]
            _FIRST = ('first', '1st', '第一个', '第一项')
            # "first" means "any existing value is fine" — do NOT re-open the
            # dropdown (re-selecting first can cascade-reset dependent fields).
            if (
                (option_text or '').strip().lower() in _FIRST
                or cur_val == option_text
                or option_text in cur_val
                or cur_val in option_text
            ):
                params, element = await _pack_select_record(
                    page, case_data_store, label_text, option_text, element,
                )
                params['xpath_smart'] = xp
                _record_action('select_option', params, already, element=element)
                _task_done_impl(
                    label_text, case_data_store, value=cur_val or option_text, xpath_smart=xp,
                )
                streak = int(case_data_store.get('_already_matched_streak', 0) or 0) + 1
                case_data_store['_already_matched_streak'] = streak
                return _ok(_with_submit_cue(
                    already + ' | already-matched | SKIP — field already set; do not re-select',
                    case_data_store,
                ))

        case_data_store['_already_matched_streak'] = 0

        # Close any leftover open dropdowns before opening the target select
        await page.evaluate('''() => {
            document.querySelectorAll('.el-select-dropdown:not(.is-hidden)').forEach(dd => {
                dd.style.display = 'none';
                dd.classList.add('is-hidden');
            });
            document.body.click();
        }''')
        await page.wait_for_timeout(100)

        trigger_result = await page.evaluate(JS_SELECT_TRIGGER_BY_XPATH, [xp])
        if trigger_result in ('label-not-found', 'no-select-found', 'select-disabled', 'xpath-not-found', 'xpath-empty', 'field-disabled'):
            if trigger_result == 'no-select-found':
                return _err('no-select-found | field may be radio — use click_radio')
            return trigger_result

        await page.wait_for_timeout(500)

        # Capture full option list while dropdown is open (before pick)
        params, element = await _pack_select_record(
            page, case_data_store, label_text, option_text, element,
        )
        params['xpath_smart'] = xp

        select_result = await page.evaluate(JS_SELECT_OPTION, option_text)
        if _is_ok_result(select_result):
            matched_text = select_result.split(':', 1)[1] if ':' in select_result else select_result
            case_data_store.pop(f'_sel_retry_{label_text}', None)
            params['option_text'] = matched_text or option_text
            params, element = attach_select_options(params, element, params.get('options'))
            params['xpath_smart'] = xp
            _record_action('select_option', params, matched_text, element=element)
            _task_done_impl(
                label_text, case_data_store, value=matched_text or option_text, xpath_smart=xp,
            )
            return _ok(_with_submit_cue(f'ok | {matched_text}', case_data_store))
        elif select_result == 'no-items':
            # Xpath recheck — treat already-set field as success (no labeled JS).
            recheck = await page.evaluate(JS_SELECT_VALUE_BY_XPATH, [xp])
            if str(recheck).startswith('ok-already:'):
                cur = recheck.split(':', 1)[1]
                _task_done_impl(label_text, case_data_store, value=cur, xpath_smart=xp)
                _record_action('select_option', params, recheck, element=element)
                return _ok(_with_submit_cue(recheck + ' | already-matched | no-items-skip', case_data_store))
            return _err('no-items')
        elif select_result.startswith('option-not-found:'):
            # Fuzzy: pick listed option that contains / is contained by option_text
            listed = [x.strip() for x in select_result.split(':', 1)[1].split(',') if x.strip()]
            # Prefer union of live dropdown preview + stored options
            stored = list(params.get('options') or [])
            for x in listed:
                if x not in stored:
                    stored.append(x)
            params, element = attach_select_options(params, element, stored)
            params['xpath_smart'] = xp
            want = (option_text or '').strip()
            fuzzy = next((o for o in stored if want and (want in o or o in want)), None)
            # Common alias: 中国 → 中华人民共和国
            if not fuzzy and want in ('中国', '中国大陆'):
                fuzzy = next((o for o in stored if '中国' in o), None)
            if fuzzy:
                fuzzy_result = await page.evaluate(JS_SELECT_OPTION, fuzzy)
                if _is_ok_result(fuzzy_result):
                    matched_text = fuzzy_result.split(':', 1)[1] if ':' in fuzzy_result else fuzzy_result
                    case_data_store.pop(f'_sel_retry_{label_text}', None)
                    params['option_text'] = matched_text
                    params['xpath_smart'] = xp
                    _record_action('select_option', params, matched_text, element=element)
                    _task_done_impl(label_text, case_data_store, value=matched_text, xpath_smart=xp)
                    return _ok(_with_submit_cue(f'ok | {matched_text} | fuzzy-matched-from:{want}', case_data_store))
            retry_key = f'_sel_retry_{label_text}'
            retries = case_data_store.get(retry_key, 0) + 1
            case_data_store[retry_key] = retries
            if retries >= 3:
                first_result = await page.evaluate(JS_SELECT_OPTION, 'first')
                if _is_ok_result(first_result):
                    matched_text = first_result.split(':', 1)[1] if ':' in first_result else first_result
                    case_data_store.pop(f'_sel_retry_{label_text}', None)
                    params['option_text'] = matched_text or option_text
                    params['xpath_smart'] = xp
                    _record_action('select_option', params, matched_text, element=element)
                    _task_done_impl(
                        label_text, case_data_store, value=matched_text or option_text, xpath_smart=xp,
                    )
                    return _ok(_with_submit_cue(f'ok | {matched_text}', case_data_store))
                return _err(first_result)
            return _err(select_result)
        else:
            return _err(select_result)

    # ── Adjacent button / radio (moved from misc for logical grouping) ──

    @controller.action('Click an adjacent button (选择/引入/上传) to fill a field, but only if the field is empty. Returns "already-filled" (non-ok skip) if field has value.')
    async def click_adjacent_button(label_text: str):
        page = await browser_context.get_current_page()
        await _wait_if_loading(page)
        # First check if field already has a value — skip if so
        check_info = await page.evaluate(JS_CHECK_SINGLE_FIELD, [label_text, _button_keywords()])
        if check_info != 'label-not-found':
            try:
                info = json.loads(check_info)
                if (info.get('currentValue', '').strip() != '' or info.get('selected', False)) and label_text not in ('查询', '搜索', '确定', '提交', '保存'):
                    # Non-recordable skip — must NOT use ok prefix
                    return _ok(f'already-filled | {info.get("currentValue", "")}')
            except Exception:
                pass
        # Snapshot the adjacent button (not the input) before click
        element = await _enrich_click_element(
            page, text='', form_label=label_text, target_kind='adjacent_button',
        )
        result = await page.evaluate('''([label]) => {
            const container = ''' + JS_GET_CONTAINER + ''';
            const items = container.querySelectorAll('.el-form-item');
            for (const item of items) {
                const lbl = item.querySelector('.el-form-item__label')?.textContent?.trim() || '';
                if (!lbl.includes(label)) continue;
                item.scrollIntoView({ block: 'center', behavior: 'instant' });
                for (const tag of ['el-button', 'button', 'a']) {
                    const btns = item.querySelectorAll(tag);
                    for (const btn of btns) {
                        if (btn.offsetParent === null) continue;
                        const t = btn.textContent.trim();
                        if (t && (t.includes('选择') || t.includes('引入') || t.includes('上传') || t.includes('添加') || t.includes('导入') || t.includes('新增'))) {
                            btn.click(); return 'ok-clicked';
                        }
                    }
                }
                for (const tag of ['el-button', 'button', 'a']) {
                    const btns = item.querySelectorAll(tag);
                    for (const btn of btns) {
                        if (btn.offsetParent === null) continue;
                        btn.click(); return 'ok-clicked';
                    }
                }
                return 'no-adjacent-button-found';
            }
            return 'label-not-found';
        }''', [label_text])
        if _is_ok_result(result):
            _record_action(
                'click_adjacent_button',
                {'label_text': label_text},
                result,
                element=element,
            )
            return _ok(result)
        return result

    @controller.action('Click a radio option by label text and radio option text.')
    async def click_radio(label_text: str, option_text: str, xpath_smart: str = ""):
        page = await browser_context.get_current_page()
        await _wait_if_loading(page)
        await _ensure_scanned(label_text)
        resolved = _resolve_control(case_data_store, label_text, xpath_smart)
        if resolved.error:
            return resolved.error
        element = await _capture_element(page, resolved.label, target_kind='form_radio')
        result = await page.evaluate(JS_CLICK_RADIO_BY_XPATH, [resolved.xpath_smart, option_text])
        if _is_ok_result(result):
            _record_action(
                'click_radio',
                {
                    'label_text': resolved.label,
                    'option_text': option_text,
                    'xpath_smart': resolved.xpath_smart,
                },
                result,
                element=element,
            )
            _task_done_impl(
                resolved.label, case_data_store, value=option_text, xpath_smart=resolved.xpath_smart,
            )
            return _ok(result)
        return result

    @controller.action('Select a tree-select option by label and option text. For custom TsscMultiTree components (e.g. 行业代码). Opens popover, searches tree data by label, selects matching node, closes popover. If result starts with no-tree-component, do NOT retry — use fill_form_field with a concrete value (not "first") or select_option.')
    async def select_tree_option(label_text: str, option_text: str):
        page = await browser_context.get_current_page()
        await _wait_if_loading(page)
        await _ensure_scanned(label_text)
        element = await _capture_element(page, label_text, target_kind='form_tree_select')
        result = await page.evaluate(JS_SELECT_TREE_OPTION, [label_text, option_text])
        # P0/P1/P2 success codes all use ok prefix → recordable via _is_ok_result
        if _is_ok_result(result):
            _record_action('select_tree_option', {'label_text': label_text, 'option_text': option_text}, result, element=element)
            _task_done_impl(label_text, case_data_store, value=option_text)
            return _ok(result)
        res_s = str(result or '')
        if res_s == 'disabled' or res_s.startswith('disabled'):
            return (
                f'disabled | Field "{label_text}" is read-only '
                f'(TsscMultiTree/component disabled; e.g. 分类目录 prefilled from sidebar). '
                f'Do NOT retry select_tree_option or fill_form_field — skip this field.'
            )
        # Misclassified / non-Tssc field: concrete values often work via native fill
        if res_s.startswith('no-tree-component'):
            fill_val = (option_text or '').strip()
            if fill_val and fill_val.lower() != 'first':
                fill_el = await _capture_element(page, label_text, target_kind='form_input')
                fill_result = await page.evaluate(JS_FILL_FORM_FIELD, [label_text, fill_val])
                if _is_ok_result(fill_result):
                    _record_action(
                        'fill_form_field',
                        {'label_text': label_text, 'value': fill_val},
                        fill_result,
                        element=fill_el,
                    )
                    _task_done_impl(label_text, case_data_store, value=fill_val)
                    return _ok(
                        f'ok-fill-fallback:{fill_val} | was no-tree-component; '
                        f'recorded as fill_form_field (do not retry select_tree_option)'
                    )
                return (
                    f'{res_s} | fill_form_field also failed ({fill_result}). '
                    f'Do NOT retry select_tree_option on this field.'
                )
            return (
                f'{res_s} | option_text="first" cannot fill. '
                f'Do NOT retry select_tree_option. '
                f'Call fill_form_field("{label_text}", concreteValue) '
                f'or select_option if the field is an el-select.'
            )
        return result
