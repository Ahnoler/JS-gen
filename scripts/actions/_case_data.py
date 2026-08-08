"""Compatibility shim — implementation moved to scripts.controller.actions._case_data.py."""
from scripts.controller.actions._case_data import *  # noqa: F401,F403
from scripts.controller.actions._case_data import (  # noqa: F401
    _RESERVED_CASE_KEYS, _err, _normalize_label, _ok,
    _register_case_data_actions, emit_memory_event, format_case_data_hint, iter_user_case_entries,
    lookup_case_value,
)
