"""
JS code snippets injected into the browser via page.evaluate().

Canonical CTRL.* for replay/assemble lives in src/ctrl-actions.js
(window.CTRL via getInjectionCode). This module is the agent-side twin -
not byte-identical (more helpers than CTRL). Parity check:

    node scripts/characterization/characterize-ctrl.mjs

Implementation split into scripts/controller/actions/js_snippets/ by widget domain;
this module re-exports every constant so existing importers are unchanged.
"""

from .js_snippets.container import JS_GET_CONTAINER
from .js_snippets.base import JS_IDENTIFY_CONTAINER, JS_IS_QUERY_TOOLBAR, JS_WAIT_LOADING, JS_CHECK_LOADING, JS_LOCATOR, JS_SMART_LOCATOR, JS_FIELD_DISABLED
from .js_snippets.fill_core import JS_FILL_FORM_FIELD, JS_FILL_BY_XPATH, JS_CAPTURE_FROM_XPATH, JS_CLEAR_FIELD_VALUE
from .js_snippets.fill_date import JS_FILL_DATE_BY_XPATH, JS_CLICK_RADIO_BY_XPATH
from .js_snippets.select_trigger import (
    JS_FIND_LABELED_SELECT,
    JS_FIND_VISIBLE_DROPDOWN,
    JS_RESET_SELECT_UI,
    JS_SELECT_TRIGGER_BY_XPATH,
    JS_SELECT_VALUE_BY_XPATH,
)
from .js_snippets.select_option import JS_SELECT_OPTION, JS_READ_SELECT_OPTIONS
from .js_snippets.select_tree import JS_CLICK_RADIO, JS_SELECT_TREE_OPTION, JS_EXPAND_ALL_EL_TREE
from .js_snippets.scan_utils import JS_CLASSIFY_FIELD, JS_FIELD_REQUIRED, JS_READ_CURRENT_VALUE, JS_SECTION_ATTACH_BLOCK, JS_SCROLL_TO_FIRST_ERROR, JS_READ_REFERENCE_DATE, _JS_READ_CERT_TYPE, _JS_EXTRACT_ERROR_LABELS
from .js_snippets.scan_form import JS_SCAN_FORM_FIELDS, JS_CHECK_SINGLE_FIELD
from .js_snippets.save import JS_CLICK_SAVE_BUTTON, JS_SCAN_SAVE_OUTCOME, JS_WATCH_SAVE_NOTIFICATIONS
from .js_snippets.enrich import JS_ENRICH_CLICK_LOCATOR
from .js_snippets.icons import _JS_ICON_BUTTON_HELPERS, JS_STAMP_ICON_ARIA_LABELS, JS_COLLECT_ICON_BUTTONS, JS_CLICK_ICON_BUTTON
from .js_snippets.misc import JS_SCENARIO_PAGE_SNAPSHOT, JS_VERIFY_FORM_STRUCTURE, JS_CLICK_LOGIN_BUTTON, JS_CLICK_VERIFY_BUTTON
from .js_snippets.menu_scan import JS_SCAN_MENU_TREE
from .js_snippets.business_date import JS_READ_BUSINESS_DATE
from .js_snippets.picker_confirm import JS_PICKER_DIALOG_QUERY, JS_PICKER_DIALOG_SELECT
from .js_snippets.workspace_tabs import JS_WORKSPACE_TABS
from .js_snippets.todo_cards import JS_LIST_TODO_CARDS, JS_WF_SUBMIT_GUARD
from .js_snippets.tree_check import JS_TREE_CHECK_CONFIRM
from .js_snippets.tree_picker import JS_TREE_PICKER_CLICK
from .js_snippets.close_dialog import JS_CLOSE_VISIBLE_DIALOG
from .js_snippets.strip_dialogs import JS_STRIP_STALE_WRAPPERS
from .js_snippets.real_click import JS_REAL_CLICK_RECT, JS_REAL_CLICK_ECHO, JS_TREE_POPOVER_OPEN
from .js_snippets.semantic_snapshot import JS_SEMANTIC_SNAPSHOT
from .js_snippets.verify_context import JS_VERIFY_CONTEXT
from .js_snippets.page_id import JS_READ_PAGE_COMPONENT_CODE, JS_CLICK_MENU_XPATH, JS_FIND_MENU_DISMISS_POINT
from scripts.controller.actions.js_snippets._locator_helpers_js import PAGE_LOCATOR_HELPERS
