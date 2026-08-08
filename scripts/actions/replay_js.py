"""Compatibility shim — implementation moved to scripts/controller/actions/replay_js.py."""
from scripts.controller.actions.replay_js import *  # noqa: F401,F403
from scripts.controller.actions.replay_js import (  # noqa: F401
    _JS_CLICK_DURABLE,
    _JS_EDIT_FORM_INPUT_VISIBLE,
    _JS_LOCATE_BY_XPATH,
    _JS_PAGE_BUSY,
    _JS_READ_VALUE_BY_XPATH,
)
