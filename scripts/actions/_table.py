"""Compatibility shim — implementation moved to scripts.controller.actions._table.py."""
from scripts.controller.actions._table import *  # noqa: F401,F403
from scripts.controller.actions._table import (  # noqa: F401
    _enrich_click_element, _is_ok_result, _ok, _record_action,
    _register_table_actions,
)
