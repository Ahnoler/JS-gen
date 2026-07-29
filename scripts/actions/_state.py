"""
Shared mutable state for the controller module.

Holds _ACTION_LOG and _TRAJECTORY_URL. All internal reads/writes
go through this module. The controller.py facade re-exports these
for external callers (session_runner, recorder, agent_utils).
"""

from ..models import ActionEntry
import re

_ACTION_LOG: list[dict] = []
_TRAJECTORY_URL: str | None = None
_CURRENT_PHASE: int = 0
_CURRENT_SOURCE: str = 'agent'

# Action → old-format command mapping (legacy, mirrors models/action.py:ACTION_TO_COMMAND)
_ACTION_TO_COMMAND = {
    'fill_form_field': 'input', 'fill_date_field': 'input',
    'select_option': 'select', 'select_tree_option': 'select',
    'click_element_by_index': 'click', 'click_menu_item': 'click',
    'click_table_row_button': 'click', 'click_table_row_radio': 'click',
    'click_adjacent_button': 'click', 'click_radio': 'click',
    'click_icon_button': 'click',
    'switch_tab': 'tab', 'close_dialog': 'close',
    'wait_for_loading': 'wait', 'go_to_url': 'navigate',
    'expand_all_el_tree': 'expand',
}


def set_current_phase(n: int):
    """Set the current phase number. Called by session_runner before each step."""
    global _CURRENT_PHASE
    _CURRENT_PHASE = n


def set_current_source(source: str):
    """Set recording source for subsequent _record_action calls (agent|manual|cdp)."""
    global _CURRENT_SOURCE
    _CURRENT_SOURCE = source if source in ('agent', 'manual', 'cdp') else 'agent'


def _emit_action_log_sync():
    """Push the full _ACTION_LOG to the Dashboard."""
    try:
        from ..agent_utils import emit_json
        emit_json({"event": "action_log_sync", "data": {
            "entries": list(_ACTION_LOG),
            "count": len(_ACTION_LOG),
        }})
    except ImportError:
        pass


def _record_action(action_name, params, result, element=None, source=None):
    """Record a controller action call using ActionEntry model."""
    global _TRAJECTORY_URL
    params_dict = dict(params) if params else {}
    resolved_source = source or _CURRENT_SOURCE or 'agent'

    entry = ActionEntry.from_record(
        action_name, params_dict,
        str(result) if result else '',
        element,
        phase=_CURRENT_PHASE,
        source=resolved_source,
    )

    dumped = entry.model_dump()

    # Manual only: drop date-picker reopen clicks that echo the just-selected date
    # (CDP quick actions record as-is — no coalesce / noise filter)
    if (
        resolved_source == 'manual'
        and action_name == 'click_element_by_index'
        and _ACTION_LOG
    ):
        click_text = str(params_dict.get('text') or '').strip()
        last = _ACTION_LOG[-1]
        if last.get('action') == 'fill_date_field' and last.get('source') in ('manual', None):
            last_val = str((last.get('params') or {}).get('value') or '').strip()
            if click_text and (click_text == last_val or re.match(r'^\d{4}-\d{2}-\d{2}$', click_text)):
                return None  # skip reopen noise; do not append / emit

    # Manual only: before coalescing fills, drop a junk click left from date-picker UI
    if (
        resolved_source == 'manual'
        and action_name == 'fill_date_field'
        and _ACTION_LOG
    ):
        last = _ACTION_LOG[-1]
        if last.get('action') == 'click_element_by_index' and last.get('source') in ('manual', None):
            last_text = str((last.get('params') or {}).get('text') or '').strip()
            date_val = str(params_dict.get('value') or '').strip()
            if (
                (last_text.isdigit() and 1 <= int(last_text) <= 31)
                or bool(re.match(r'^\d{4}-\d{2}-\d{2}$', last_text))
                or (date_val and last_text == date_val)
            ):
                _ACTION_LOG.pop()

    # Manual only: coalesce consecutive fills on the same field → keep last only
    if (
        resolved_source == 'manual'
        and action_name in ('fill_form_field', 'fill_date_field')
        and _ACTION_LOG
    ):
        last = _ACTION_LOG[-1]
        if last.get('action') == action_name and last.get('source') in ('manual', None):
            last_params = last.get('params') or {}
            same_label = bool(params_dict.get('label_text')) and (
                last_params.get('label_text') == params_dict.get('label_text')
            )
            last_el = last.get('element') if isinstance(last.get('element'), dict) else {}
            last_xpath = (last_el or {}).get('xpath') or last.get('target') or ''
            new_xpath = ''
            if isinstance(element, dict):
                new_xpath = element.get('xpath') or element.get('bu_xpath') or ''
            same_xpath = bool(new_xpath) and bool(last_xpath) and last_xpath == new_xpath
            if same_label or same_xpath:
                _ACTION_LOG.pop()

    # Do NOT drop a preceding click when recording select_option — that click is often
    # 「新增」/导航等真实步骤。Opening the dropdown is skipped at capture time instead.

    _ACTION_LOG.append(dumped)
    if action_name == 'go_to_url' and params_dict.get('url'):
        _TRAJECTORY_URL = params_dict['url']

    _emit_action_log_sync()
    return dumped
