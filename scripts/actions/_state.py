"""
Shared mutable state for the controller module.

Holds _ACTION_LOG and _TRAJECTORY_URL. All internal reads/writes
go through this module. The controller.py facade re-exports these
for external callers (session_runner, recorder, agent_utils).
"""

from ..models import ActionEntry

_ACTION_LOG: list[dict] = []
_TRAJECTORY_URL: str | None = None

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


def _record_action(action_name, params, result, element=None):
    """Record a controller action call using ActionEntry model."""
    global _TRAJECTORY_URL
    params_dict = dict(params) if params else {}

    entry = ActionEntry.from_record(action_name, params_dict, str(result) if result else '', element)

    _ACTION_LOG.append(entry.model_dump())
    # Capture URL from go_to_url action
    if action_name == 'go_to_url' and params_dict.get('url'):
        _TRAJECTORY_URL = params_dict['url']
