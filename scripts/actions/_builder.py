"""
Controller builder: factory function that assembles all action groups
into a single browser_use Controller instance.
"""

from ._case_data import _register_case_data_actions
from ._form import _register_form_actions
from ._navigation import _register_navigation_actions
from ._table import _register_table_actions
from ._misc import _register_misc_actions


def build_controller(browser_context, form_rules, case_data_store=None,
                     llm=None, exclude_actions=None):
    """Build and return a browser_use Controller with all custom actions registered."""
    from browser_use import Controller
    if exclude_actions is None:
        exclude_actions = ['input_text', 'select_dropdown_option']
    controller = Controller(exclude_actions=exclude_actions)

    if case_data_store is None:
        case_data_store = {}
    _register_case_data_actions(controller, case_data_store)
    _register_form_actions(controller, browser_context, form_rules, case_data_store, llm)
    _register_navigation_actions(controller, browser_context)
    _register_table_actions(controller, browser_context)
    _register_misc_actions(controller, browser_context, case_data_store)

    return controller
