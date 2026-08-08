"""Compatibility shim — implementation moved to scripts.controller.service.py."""
from scripts.controller.service import *  # noqa: F401,F403
from scripts.controller.service import (  # noqa: F401
    _ACTION_LOG, _register_case_data_actions, _register_form_actions, _register_misc_actions,
    _register_navigation_actions, _register_special_element_actions, _register_table_actions, _wrap_action_with_screenshots,
    build_controller, capture_page_png_b64, capture_screenshots_enabled, emit_step_screenshot,
    functools, inspect, should_skip_screenshot_action,
)
