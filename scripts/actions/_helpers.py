"""Compatibility shim — implementation moved to scripts/controller/actions/_helpers.py."""
from scripts.controller.actions._helpers import *  # noqa: F401,F403
from scripts.controller.actions._helpers import (  # noqa: F401
    ActionResult,
    JS_CHECK_LOADING,
    JS_ENRICH_CLICK_LOCATOR,
    JS_READ_SELECT_OPTIONS,
    JS_WAIT_LOADING,
    ScannedField,
    _SELECT_OPTION_PLACEHOLDERS,
    _capture_element,
    _enrich_click_element,
    _err,
    _is_ok_result,
    _merge_ax_text,
    _ok,
    _wait_if_loading,
    attach_select_options,
    dismiss_https_first_interstitial,
    normalize_select_options,
    options_from_scan_store,
    read_select_options,
    resolve_option_against_list,
)
