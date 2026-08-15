"""Task completion + submit cue helpers (extracted from form_scan_utils.py).

form_scan_utils.py re-exports these names for backward compatibility.
"""

import json
import sys

from ...models import TaskList


def _task_xpath_smart(case_data_store, label_text: str, xpath_hint: str = "") -> str:
    """Compat wrapper — prefer _resolve_control; returns xpath or '' (not error codes)."""
    # Late import: form_scan_utils.py imports this module back at module level.
    from .form_scan_utils import _resolve_control
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
    # Late import: form_scan_utils.py imports this module back at module level.
    from .form_scan_utils import _is_query_mode
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
    # Write-through active container slot so same/cross-container switch
    # does not restore a pre-mark_done snapshot.
    active = case_data_store.get('_active_container')
    if active:
        by = case_data_store.setdefault('_task_lists_by_container', {})
        if isinstance(by, dict):
            by[active] = {
                'task_list': case_data_store.get('task_list'),
                '_scan_fields': case_data_store.get('_scan_fields'),
            }
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
    # Late import: form_scan_utils.py imports this module back at module level.
    from .form_scan_utils import _is_query_mode
    if _is_query_mode(case_data_store):
        return ''
    try:
        from scripts.controller.actions._phase_boundary import next_action_hint, phase_boundary_active
        if phase_boundary_active(case_data_store):
            cue = next_action_hint(case_data_store)
            if cue:
                return cue
    except Exception:
        pass
    tl = TaskList.from_store(case_data_store.get('task_list'))
    from scripts.controller.actions.section_scope import resolve_phase_section, section_matches
    sec = (section or '').strip()
    fillable = [
        i for i in tl.pending
        if not i.needs_intervention
        and section_matches(sec, i.section_id, i.section_title, getattr(i, 'region_label', '') or '')
    ]
    if fillable:
        return ''
    # Legacy needs_intervention pending (old stores): do not block save cues —
    # introduce is agent/special-element/manual, not assistant intervene.
    if tl.total > 0:
        c = case_data_store.get('_phase_intent')
        if isinstance(c, dict):
            try:
                from scripts.controller.actions.phase.reviewer import coerce_bool
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
        # Auto-bind section when not explicitly scoped: memory/infer then unique save button
        from scripts.controller.actions.section_scope import (
            preferred_submit_button,
            preferred_submit_cue,
            same_label_section_keys,
            unique_button_section,
        )
        try:
            btn = preferred_submit_button(case_data_store, section=sec)
        except Exception:
            btn = '保存'
        keys = same_label_section_keys(case_data_store.get('_scan_buttons'), btn)
        if len(keys) >= 2:
            return f'NEXT_ACTION: {preferred_submit_cue(case_data_store, section="")}'
        if not sec:
            try:
                auto_sec = resolve_phase_section(case_data_store)
                if not auto_sec:
                    prefer = preferred_submit_button(case_data_store, section='')
                    auto_sec = unique_button_section(
                        case_data_store.get('_scan_buttons'), prefer,
                    ) or unique_button_section(
                        case_data_store.get('_scan_buttons'), '保存',
                    )
                if auto_sec:
                    sec = auto_sec
            except Exception:
                pass
        # Prefer region= (section= still accepted) so caller passes scope to click_save
        from scripts.controller.actions.section_scope import scope_kw_cue

        sec_part = scope_kw_cue(sec)
        return (
            f"NEXT_ACTION: click_save(button_text='{btn}'{sec_part}) | fillable pending=0. "
            f"Call click_save(button_text='{btn}'{sec_part}) NOW "
            f"(auto-finds {btn}, scrolls into view). "
            f'Do NOT scroll_down / click_element_by_index to hunt for {btn}. '
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
    # Same container: keep live flat view (mark_done progress). Do not
    # restore a stale first-touch snapshot from the slot.
    if active and active == container_id:
        by[container_id] = {
            'task_list': case_data_store.get('task_list'),
            '_scan_fields': case_data_store.get('_scan_fields'),
        }
        return
    if active and active != container_id:
        # Save current flat view
        by[active] = {
            'task_list': case_data_store.get('task_list'),
            '_scan_fields': case_data_store.get('_scan_fields'),
        }
    prev = active
    case_data_store['_active_container'] = container_id
    if (
        prev
        and str(prev).startswith(('dialog:', 'drawer:'))
        and not str(container_id).startswith(('dialog:', 'drawer:'))
    ):
        from scripts.controller.actions.container_naming import clear_trigger_button
        clear_trigger_button(case_data_store)
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
    # Late import: form_scan_utils.py imports this module back at module level.
    from .form_scan_utils import _is_query_mode
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
    # Late import: form_scan_utils.py imports this module back at module level.
    from .form_scan_utils import _QUERY_NEXT_HINT
    return json.dumps({
        'not_form_fill': True,
        'mode': 'query_filter',
        'container': container_id or '',
        'hint': _QUERY_NEXT_HINT,
    }, ensure_ascii=False)



