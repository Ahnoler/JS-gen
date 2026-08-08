"""Compatibility shim — implementation moved to scripts.controller.actions._form.py."""
from scripts.controller.actions._form import *  # noqa: F401,F403
from scripts.controller.actions._form import (  # noqa: F401
    FormScanResult, FormSnapshot, FormSnapshotCollection, JS_CHECK_SINGLE_FIELD,
    JS_CLICK_RADIO_BY_XPATH, JS_CLICK_SAVE_BUTTON, JS_FILL_BY_XPATH, JS_FILL_DATE_BY_XPATH,
    JS_FILL_FORM_FIELD, JS_FIND_LABELED_SELECT, JS_GET_CONTAINER, JS_IDENTIFY_CONTAINER,
    JS_IS_QUERY_TOOLBAR, JS_LOCATOR, JS_SCAN_FORM_FIELDS, JS_SCAN_SAVE_OUTCOME,
    JS_SCROLL_TO_FIRST_ERROR, JS_SELECT_OPTION, JS_SELECT_TREE_OPTION, JS_SELECT_TRIGGER_BY_XPATH,
    JS_SELECT_VALUE_BY_XPATH, Notification, ResolvedControl, ScannedButton,
    ScannedField, TaskItem, TaskList, _ACTION_LOG,
    _JS_EXTRACT_ERROR_LABELS, _JS_READ_CERT_TYPE, _QUERY_NEXT_HINT, _SEARCH_DIALOG_HINTS,
    _build_section_summary, _capture_element, _clear_field_value, _dedupe_needs_agent,
    _enrich_click_element, _err, _force_refill_flag, _gen_name,
    _is_ok_result, _is_query_mode, _is_search_dialog, _llm_generate_values,
    _mark_query_ui_if_needed, _merge_ax_text, _ok, _pack_select_record,
    _query_not_form_payload, _record_action, _register_form_actions, _resolve_control,
    _save_form_snapshot, _scan_buttons_from_result, _section_group_key, _skip_auto_fill,
    _submit_ready_hint, _switch_task_list_container, _task_done_impl, _task_xpath_smart,
    _wait_if_loading, _with_submit_cue, attach_select_options, capture_page_png_b64_from_page,
    dataclass, emit_json, get_has_button_keywords, json,
    match_cert_number, match_rule, options_from_scan_store, re,
    read_select_options, record_action_with_screenshots, refresh_scan_buttons, sys,
)
