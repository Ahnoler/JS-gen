"""Compatibility shim — implementation moved to scripts/controller/actions/replay_wait.py."""
from scripts.controller.actions.replay_wait import *  # noqa: F401,F403
from scripts.controller.actions.replay_wait import (  # noqa: F401
    JS_CHECK_LOADING,
    _JS_EDIT_FORM_INPUT_VISIBLE,
    _JS_PAGE_BUSY,
    _SAVE_BUTTON_TEXTS,
    _is_save_click_text,
    _is_trackable_request,
    _is_tree_node_entry,
    _wait_after_save_page_idle,
    _wait_after_tree_node_for_form,
    _wait_if_loading,
)
