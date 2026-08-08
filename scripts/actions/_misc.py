"""Compatibility shim — implementation moved to scripts.controller.actions._misc.py."""
from scripts.controller.actions._misc import *  # noqa: F401,F403
from scripts.controller.actions._misc import (  # noqa: F401
    ActionFile, FormSnapshot, FormSnapshotCollection, JS_CHECK_LOADING,
    JS_CLICK_ICON_BUTTON, JS_COLLECT_ICON_BUTTONS, JS_STAMP_ICON_ARIA_LABELS, _GPS_LOADING_SPIN,
    _JS_VISIBLE_FORM_OVERLAY, _SCRIPTS_DIR, _SUBMIT_BTN_RE, _enrich_click_element,
    _err, _is_form_submit_label, _is_ok_result, _ok,
    _register_misc_actions, _state, _wait_if_loading, datetime,
    json, os, re, sys,
)
