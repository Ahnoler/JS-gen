"""Compatibility shim — implementation moved to scripts.controller.actions._special_element.py."""
from scripts.controller.actions._special_element import *  # noqa: F401,F403
from scripts.controller.actions._special_element import (  # noqa: F401
    _err, _ok, _record_action, _register_special_element_actions,
    annotations, format_special_element_hint, replace_special_element_candidates,
)
