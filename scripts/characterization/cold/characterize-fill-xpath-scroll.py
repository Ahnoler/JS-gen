#!/usr/bin/env python3
"""Characterize scrollIntoView behavior in JS_FILL_BY_XPATH (xpath-first fill path).

The label path (JS_FILL_FORM_FIELD) already scrolls the form-item into view before
filling (fill_core.py line ~29). The xpath-first main path (JS_FILL_BY_XPATH) had
no scroll, so before/after PNG captures never showed the filled result because the
target stayed offscreen. This script pins that scrollFillTarget is defined and
called at the placeholder branch (ok-placeholder) and the main xpath-smart path
(ok-xpath-smart), and that the label path scroll remains in place.
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.controller.actions.js_snippets.fill_core import (  # noqa: E402
    JS_FILL_BY_XPATH,
    JS_FILL_FORM_FIELD,
)


def assert_true(cond: bool, msg: str) -> None:
    if not cond:
        raise AssertionError(msg)


def test_fill_by_xpath_defines_scroll_helper() -> None:
    assert_true(
        "scrollFillTarget" in JS_FILL_BY_XPATH,
        "JS_FILL_BY_XPATH defines scrollFillTarget helper",
    )
    assert_true(
        "const scrollFillTarget = (el)" in JS_FILL_BY_XPATH,
        "scrollFillTarget is a const arrow function in JS_FILL_BY_XPATH",
    )
    assert_true(
        ".el-form-item" in JS_FILL_BY_XPATH.split("scrollFillTarget", 1)[1].split("}", 1)[0],
        "scrollFillTarget scrolls the .el-form-item (or element) into view",
    )
    assert_true(
        "scrollIntoView" in JS_FILL_BY_XPATH,
        "scrollFillTarget calls scrollIntoView",
    )
    assert_true(
        "block: 'center'" in JS_FILL_BY_XPATH,
        "scrollFillTarget uses block: 'center' (aligns with label path)",
    )


def test_fill_by_xpath_scroll_calls_present() -> None:
    """scrollFillTarget must be CALLED at >=2 setFn sites (placeholder + xpath-smart)."""
    # ok-placeholder branch: scrollFillTarget call precedes the setFn that returns ok-placeholder.
    placeholder_chunk = JS_FILL_BY_XPATH.split("return 'ok-placeholder';", 1)[0]
    assert_true(
        "scrollFillTarget(target)" in placeholder_chunk,
        "scrollFillTarget(target) called before setFn in ok-placeholder branch",
    )
    # Main xpath-smart branch: scrollFillTarget call after the not-found guard, before isDate.
    main_chunk = JS_FILL_BY_XPATH.split("return 'ok-xpath-smart';", 1)[0]
    assert_true(
        "scrollFillTarget(target)" in main_chunk,
        "scrollFillTarget(target) called in main xpath-smart branch before setFn",
    )
    # >=2 call sites total.
    call_count = JS_FILL_BY_XPATH.count("scrollFillTarget(target)")
    assert_true(call_count >= 2, f"scrollFillTarget(target) called >=2 times (found {call_count})")


def test_label_path_still_scrolls() -> None:
    """JS_FILL_FORM_FIELD (label path) must still scroll form-item (block: 'center')."""
    assert_true(
        "scrollIntoView" in JS_FILL_FORM_FIELD,
        "JS_FILL_FORM_FIELD still calls scrollIntoView (label path)",
    )
    assert_true(
        "block: 'center'" in JS_FILL_FORM_FIELD,
        "JS_FILL_FORM_FIELD scroll uses block: 'center'",
    )


def main() -> int:
    test_fill_by_xpath_defines_scroll_helper()
    test_fill_by_xpath_scroll_calls_present()
    test_label_path_still_scrolls()
    print("characterize-fill-xpath-scroll: OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
