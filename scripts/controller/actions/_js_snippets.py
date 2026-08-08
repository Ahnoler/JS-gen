"""
JS code snippets injected into the browser via page.evaluate().

Canonical CTRL.* for replay/assemble lives in src/ctrl-actions.js
(window.CTRL via getInjectionCode). This module is the agent-side twin -
not byte-identical (more helpers than CTRL). Parity check:

    node scripts/characterization/characterize-ctrl.mjs

Implementation split into scripts/actions/js_snippets/ by widget domain;
this module re-exports every constant so existing importers are unchanged.
"""

from .js_snippets.container import JS_GET_CONTAINER
from .js_snippets.base import JS_IDENTIFY_CONTAINER, JS_IS_QUERY_TOOLBAR, JS_WAIT_LOADING, JS_CHECK_LOADING, JS_NATIVE_SETTER, JS_LOCATOR, JS_SMART_LOCATOR, JS_FIELD_DISABLED
from .js_snippets.fill_core import JS_FILL_FORM_FIELD, JS_FILL_BY_XPATH, JS_CAPTURE_FROM_XPATH
from .js_snippets.fill_date import JS_FILL_DATE_BY_XPATH, JS_CLICK_RADIO_BY_XPATH, JS_FILL_DATE_FIELD
from .js_snippets.select_trigger import JS_FIND_LABELED_SELECT, JS_FIND_VISIBLE_DROPDOWN, JS_SELECT_TRIGGER_BY_XPATH, JS_SELECT_VALUE_BY_XPATH
from .js_snippets.select_option import JS_SELECT_OPTION, JS_READ_SELECT_OPTIONS, JS_FIND_OPTION
from .js_snippets.select_tree import JS_CLICK_RADIO, JS_SELECT_TREE_OPTION
from .js_snippets.scan_utils import JS_CLASSIFY_FIELD, JS_FIELD_REQUIRED, JS_READ_CURRENT_VALUE, JS_SECTION_ATTACH_BLOCK, JS_SCROLL_TO_FIRST_ERROR
from .js_snippets.scan_form import JS_SCAN_FORM_FIELDS, JS_CHECK_SINGLE_FIELD
from .js_snippets.save import JS_CLICK_SAVE_BUTTON, JS_SCAN_SAVE_OUTCOME
from .js_snippets.enrich import JS_ENRICH_CLICK_LOCATOR
from .js_snippets.icons import _JS_ICON_BUTTON_HELPERS, JS_STAMP_ICON_ARIA_LABELS, JS_COLLECT_ICON_BUTTONS, JS_CLICK_ICON_BUTTON
from .js_snippets.misc import JS_SCENARIO_PAGE_SNAPSHOT, JS_VERIFY_FORM_STRUCTURE
from scripts.actions._locator_helpers_js import PAGE_LOCATOR_HELPERS
