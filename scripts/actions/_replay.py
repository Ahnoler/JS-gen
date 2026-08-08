"""Compatibility shim — implementation moved to scripts.controller.actions._replay.py."""
from scripts.controller.actions._replay import *  # noqa: F401,F403
from scripts.controller.actions._replay import (  # noqa: F401
    JS_CHECK_LOADING, JS_CLICK_RADIO, JS_FILL_BY_XPATH, JS_FILL_DATE_FIELD,
    JS_FILL_FORM_FIELD, JS_FIND_LABELED_SELECT, JS_SELECT_OPTION, JS_SELECT_TREE_OPTION,
    JS_SELECT_TRIGGER_BY_XPATH, JS_SELECT_VALUE_BY_XPATH, JS_VERIFY_FORM_STRUCTURE, _ACTION_NAME_ALIASES,
    _CLICK_BY_INDEX, _FORM_ACTIONS, _JS_CLICK_DURABLE, _JS_EDIT_FORM_INPUT_VISIBLE,
    _JS_LOCATE_BY_XPATH, _JS_PAGE_BUSY, _JS_READ_VALUE_BY_XPATH, _SAVE_BUTTON_TEXTS,
    _annotate_label_result, _classify_fill_result, _element_xpath_full, _element_xpath_smart,
    _filter_callable_kwargs, _is_ok_result, _is_save_click_text, _is_trackable_request,
    _is_tree_node_entry, _locate_hint, _norm_replay_value, _normalize_params,
    _params_xpath_smart, _post_click_settle, _read_value_by_xpath, _replay_click_by_index,
    _replay_controller_action, _replay_form_action, _replay_goto, _replay_table_row_radio,
    _replay_verify_form_structure, _resolve_replay_xpath, _result_ok, _try_xpath_locate,
    _wait_after_save_page_idle, _wait_after_tree_node_for_form, _wait_if_loading, annotations,
    asyncio, inspect, json, normalize_action_name,
    re, relative_xpath_primary_enabled, replay_action_entries, sys,
    time,
)
