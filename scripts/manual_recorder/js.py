"""Injected page script for manual DOM recording."""
from __future__ import annotations

from scripts.controller.actions._js_snippets import _JS_ICON_BUTTON_HELPERS
from scripts.controller.actions.js_snippets._locator_helpers_js import PAGE_LOCATOR_HELPERS
from .js_parts.a import JS_MANUAL_PART_A
from .js_parts.b import JS_MANUAL_PART_B

# ── Injected page script ───────────────────────────────────────────────────
# Emits console messages: __JSGEN_MANUAL__ + JSON payload
# Assembled from js_parts/ (byte-identical to the former single constant).
JS_MANUAL_RECORDER = JS_MANUAL_PART_A + PAGE_LOCATOR_HELPERS + _JS_ICON_BUTTON_HELPERS + JS_MANUAL_PART_B
