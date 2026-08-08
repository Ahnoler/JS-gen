#!/usr/bin/env python3
"""Characterize shared xpath fill/select JS snippets in _js_snippets.py."""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.actions import _js_snippets as sn  # noqa: E402
from scripts.actions._js_snippets import (  # noqa: E402
    JS_FILL_BY_XPATH,
    JS_SELECT_TRIGGER_BY_XPATH,
    JS_SELECT_VALUE_BY_XPATH,
)


def assert_true(cond: bool, msg: str) -> None:
    if not cond:
        raise AssertionError(msg)


def test_snippet_markers() -> None:
    js = (ROOT / "scripts/actions/_js_snippets.py").read_text(encoding="utf-8")
    assert_true("JS_FILL_BY_XPATH" in js, "JS_FILL_BY_XPATH exported in _js_snippets.py")
    assert_true("JS_SELECT_TRIGGER_BY_XPATH" in js, "JS_SELECT_TRIGGER_BY_XPATH exported")
    assert_true("JS_SELECT_VALUE_BY_XPATH" in js, "JS_SELECT_VALUE_BY_XPATH exported")
    assert_true("el-table__fixed" in JS_FILL_BY_XPATH, "fill-by-xpath handles fixed table columns")
    assert_true("__last_select_trigger" in JS_SELECT_TRIGGER_BY_XPATH, "select trigger sets global for JS_SELECT_OPTION")
    assert_true(
        "ok-already:" in JS_SELECT_VALUE_BY_XPATH and "empty" in JS_SELECT_VALUE_BY_XPATH,
        "value-by-xpath returns ok-already / empty without click",
    )
    assert_true(
        ".click(" not in JS_SELECT_VALUE_BY_XPATH and "dispatchEvent" not in JS_SELECT_VALUE_BY_XPATH,
        "JS_SELECT_VALUE_BY_XPATH must not click/open dropdown",
    )
    # el-select inner input is often readOnly while still editable — must not treat as disabled
    # (table Source B selects have no .el-form-item; xpath path is the only open path).
    assert_true(
        "trigger.readOnly" not in JS_SELECT_TRIGGER_BY_XPATH,
        "JS_SELECT_TRIGGER_BY_XPATH must not treat trigger.readOnly as field-disabled",
    )


def test_fill_by_xpath_rejects_empty_placeholder_match() -> None:
    js = JS_FILL_BY_XPATH
    assert_true("want.includes(ph)" not in js, "must not use want.includes(ph) (empty ph false ok)")
    assert_true(
        "ph.includes(want)" in js,
        "placeholder match must use ph.includes(want)",
    )


def test_xpath_date_radio_helpers() -> None:
    assert_true(hasattr(sn, "JS_FILL_DATE_BY_XPATH"), "JS_FILL_DATE_BY_XPATH")
    assert_true(hasattr(sn, "JS_CLICK_RADIO_BY_XPATH"), "JS_CLICK_RADIO_BY_XPATH")
    form = (ROOT / "scripts/actions/_form.py").read_text(encoding="utf-8")
    assert_true("JS_FILL_DATE_BY_XPATH" in form, "fill_date uses xpath helper")
    assert_true("JS_CLICK_RADIO_BY_XPATH" in form, "click_radio uses xpath helper")
    assert_true("JS_SELECT_TRIGGER_BY_XPATH" in form, "select uses xpath trigger")
    assert_true("JS_SELECT_VALUE_BY_XPATH" in form, "select already-matched via xpath value read")
    assert_true("_resolve_control" in form, "write paths resolve via _resolve_control")
    # Hard-cut: select_option must not call labeled locate/check
    select_fn = form.split("async def select_option", 1)[1].split("async def click_adjacent_button", 1)[0]
    assert_true(
        "evaluate(JS_FIND_LABELED_SELECT" not in select_fn,
        "select_option must not evaluate JS_FIND_LABELED_SELECT",
    )
    assert_true(
        "JS_SELECT_VALUE_BY_XPATH" in select_fn and "already-matched" in select_fn,
        "select_option restores xpath already-matched skip",
    )


def main() -> int:
    test_snippet_markers()
    test_fill_by_xpath_rejects_empty_placeholder_match()
    test_xpath_date_radio_helpers()
    print("characterize-xpath-fill-select: OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
