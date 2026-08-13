"""Action-name canonicalization for replay (extracted verbatim from _replay.py)."""

import re


# Form actions that auto-fill owns — replay via JS, not controller (avoids _ensure_scanned).
_FORM_ACTIONS = {
    'fill_form_field',
    'select_option',
    'select_tree_option',
    'click_radio',
}

# Historical / LLM / CTRL aliases → canonical controller action names
_ACTION_NAME_ALIASES = {
    'treeSelect': 'select_tree_option',
    'selectTreeOption': 'select_tree_option',
    'tree_select': 'select_tree_option',
    'treeselect': 'select_tree_option',
    'fill_tree': 'select_tree_option',
    'fillTree': 'select_tree_option',
    'fillFormField': 'fill_form_field',
    'fill_date_field': 'fill_form_field',
    'fillDateField': 'fill_form_field',
    'selectOption': 'select_option',
    'clickRadio': 'click_radio',
    'clickMenuItem': 'click_menu_item',
    'clickTableRowButton': 'click_table_row_button',
    'clickTableRowRadio': 'click_table_row_radio',
    'clickAdjacentButton': 'click_adjacent_button',
    'clickIconButton': 'click_icon_button',
    'closeDialog': 'close_dialog',
    'waitForLoading': 'wait_for_loading',
    'goToUrl': 'go_to_url',
    'clickElementByIndex': 'click_element_by_index',
}


def normalize_action_name(action_name: str) -> str:
    """Map aliases (camelCase / LLM kinds) to canonical snake_case action names."""
    raw = str(action_name or '').strip()
    if not raw:
        return ''
    if raw in _ACTION_NAME_ALIASES:
        return _ACTION_NAME_ALIASES[raw]
    # kebab / mixed → snake
    snake = raw.replace('-', '_')
    if snake in _ACTION_NAME_ALIASES:
        return _ACTION_NAME_ALIASES[snake]
    lower = snake.lower()
    if lower in _ACTION_NAME_ALIASES:
        return _ACTION_NAME_ALIASES[lower]
    # camelCase → snake_case (selectTreeOption → select_tree_option)
    camel_to_snake = re.sub(r'([a-z0-9])([A-Z])', r'\1_\2', raw).replace('-', '_').lower()
    if camel_to_snake in _FORM_ACTIONS or camel_to_snake in _ACTION_NAME_ALIASES.values():
        return camel_to_snake
    if camel_to_snake in _ACTION_NAME_ALIASES:
        return _ACTION_NAME_ALIASES[camel_to_snake]
    return raw
