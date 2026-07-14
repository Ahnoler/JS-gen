"""
Shared mutable state for the controller module.

Holds _ACTION_LOG and _TRAJECTORY_URL. All internal reads/writes
go through this module. The controller.py facade re-exports these
for external callers (session_runner, recorder, agent_utils).
"""

from ..models import ActionEntry

_ACTION_LOG: list[dict] = []
_TRAJECTORY_URL: str | None = None
_CURRENT_PHASE: int = 0
_CURRENT_SOURCE: str = 'agent'

# Action → old-format command mapping (legacy, mirrors models/action.py:ACTION_TO_COMMAND)
_ACTION_TO_COMMAND = {
    'fill_form_field': 'input', 'fill_date_field': 'input',
    'select_option': 'select',
    'click_element_by_index': 'click', 'click_menu_item': 'click',
    'click_table_row_button': 'click', 'click_table_row_radio': 'click',
    'click_adjacent_button': 'click', 'click_radio': 'click',
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
    _ACTION_LOG.append(dumped)
    if action_name == 'go_to_url' and params_dict.get('url'):
        _TRAJECTORY_URL = params_dict['url']

    _emit_action_log_sync()
    return dumped
