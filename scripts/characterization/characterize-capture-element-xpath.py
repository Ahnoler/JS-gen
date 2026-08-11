#!/usr/bin/env python3
"""Characterize capture-from-xpath (no JS_SMART_LOCATOR on xpath path)."""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))


def assert_true(cond: bool, msg: str) -> None:
    if not cond:
        raise AssertionError(msg)


def test_snippet_exported() -> None:
    from scripts.controller.actions import _js_snippets as sn

    assert_true(hasattr(sn, "JS_CAPTURE_FROM_XPATH"), "JS_CAPTURE_FROM_XPATH exported")
    js = sn.JS_CAPTURE_FROM_XPATH
    assert_true("absXPath" in js or "xpath_full" in js, "computes xpath_full")
    assert_true("JS_SMART_LOCATOR" not in js, "snippet must not embed SMART_LOCATOR")
    # Returned object must not set xpath_abs key (helpers may reference xpath_abs internally).
    tail = js.split("node = drillWriteHit", 1)[-1] if "node = drillWriteHit" in js else js
    assert_true("xpath_abs:" not in tail.replace(" ", ""), "capture return must not write xpath_abs")


def test_capture_snippet_rebuilds_not_echo() -> None:
    from scripts.controller.actions import _js_snippets as sn

    js = sn.JS_CAPTURE_FROM_XPATH
    assert_true("PAGE_LOCATOR_HELPERS" in js or "formFieldXpathSmartOf" in js, "helpers embedded for rebuild")
    assert_true("formFieldXpathSmartOf" in js, "rebuild via formFieldXpathSmartOf")
    assert_true(
        "xpath_smart: smart" in js.replace(" ", "")
        or "xpath_smart:smart" in js.replace(" ", "")
        or "xpath_smart: rebuilt" in js.replace(" ", "")
        or "xpath_smart:rebuilt" in js.replace(" ", ""),
        "return rebuilt smart, not echo xp alone",
    )


def test_capture_snippet_drills_form_input() -> None:
    from scripts.controller.actions import _js_snippets as sn

    js = sn.JS_CAPTURE_FROM_XPATH
    norm = _norm(js)
    assert_true("target_kind" in norm, "capture snippet reads target_kind")
    assert_true("form_input" in js, "form_input branch for write-hit drill")
    assert_true(
        "input:not([type=\"hidden\"]), textarea" in js or "input, textarea" in js,
        "drills to input/textarea like findInputFromSnap",
    )
    assert_true(
        "form_date" in js,
        "form_date branch for date write-hit drill",
    )


def test_helpers_source_no_smart_on_xpath_path() -> None:
    src = (ROOT / "scripts/controller/actions/_helpers.py").read_text(encoding="utf-8")
    # After rewrite: body must call JS_CAPTURE_FROM_XPATH; must not call JS_SMART_LOCATOR
    assert_true("JS_CAPTURE_FROM_XPATH" in src, "helpers uses CAPTURE_FROM_XPATH")
    assert_true(
        "JS_SMART_LOCATOR" not in src.split("async def _capture_element")[1].split("\nasync def ")[0],
        "_capture_element must not use JS_SMART_LOCATOR",
    )


def test_capture_signature_has_xpath_smart() -> None:
    import inspect

    from scripts.controller.actions._helpers import _capture_element

    sig = inspect.signature(_capture_element)
    assert_true("xpath_smart" in sig.parameters, "xpath_smart kw-only param")


def _norm(s: str) -> str:
    return s.replace(" ", "").replace("\n", "")


def test_form_fill_passes_xpath_to_capture() -> None:
    form = (ROOT / "scripts/controller/actions/_form.py").read_text(encoding="utf-8")
    chunk = form.split("async def fill_form_field", 1)[1].split("async def fill_date_field", 1)[0]
    assert_true(
        "xpath_smart=resolved.xpath_smart" in _norm(chunk),
        "fill_form_field passes resolved xpath into capture",
    )


def test_form_date_passes_xpath_to_capture() -> None:
    form = (ROOT / "scripts/controller/actions/_form.py").read_text(encoding="utf-8")
    chunk = form.split("async def fill_date_field", 1)[1].split(
        "async def check_field_value", 1
    )[0]
    assert_true(
        "xpath_smart=resolved.xpath_smart" in _norm(chunk),
        "fill_date_field passes resolved xpath into capture",
    )


def test_select_option_passes_xpath_to_capture() -> None:
    form = (ROOT / "scripts/controller/actions/_form.py").read_text(encoding="utf-8")
    chunk = form.split("async def select_option(", 1)[1].split("async def click_adjacent_button", 1)[0]
    assert_true(
        "xpath_smart=resolved.xpath_smart" in _norm(chunk)
        or "xpath_smart=xp" in _norm(chunk),
        "select_option passes xpath into capture",
    )


def test_click_radio_passes_xpath_to_capture() -> None:
    form = (ROOT / "scripts/controller/actions/_form.py").read_text(encoding="utf-8")
    chunk = form.split("async def click_radio", 1)[1].split("async def ", 1)[0]
    assert_true(
        "xpath_smart=resolved.xpath_smart" in _norm(chunk),
        "click_radio passes resolved xpath into capture",
    )


def test_execute_round_passes_xpath_to_capture() -> None:
    form = (ROOT / "scripts/controller/actions/_form.py").read_text(encoding="utf-8")
  # _execute_round body: first capture after capture_kind assignment
    idx = form.find("capture_kind = 'form_input'")
    assert_true(idx >= 0, "_execute_round capture_kind block found")
    chunk = form[idx:idx + 800]
    assert_true(
        "xpath_smart=xpath_smart" in _norm(chunk),
        "_execute_round passes round xpath into capture",
    )


def test_tree_fallback_xpath_captures_pass_xpath() -> None:
    form = (ROOT / "scripts/controller/actions/_form.py").read_text(encoding="utf-8")
    # xpath branch fill fallback capture (_execute_round)
    idx = form.find("JS_FILL_BY_XPATH, [xpath_smart, fill_val, label]")
    assert_true(idx >= 0, "tree fill xpath branch found")
    chunk = form[idx:idx + 1200]
    assert_true(
        "xpath_smart=xpath_smart" in _norm(chunk),
        "tree fill fallback capture passes xpath_smart",
    )
    # tree ? select fallback re-captures with xpath_smart=
    idx2 = form.find("sel_result = await _select_by_xpath(page, fill_val, xpath_smart)")
    assert_true(idx2 >= 0, "tree select xpath branch found")
    chunk2 = form[idx2:idx2 + 900]
    assert_true(
        "xpath_smart=xpath_smart" in _norm(chunk2),
        "tree select fallback capture passes xpath_smart",
    )


def test_select_tree_option_fill_fallback_xpath_parity() -> None:
    form = (ROOT / "scripts/controller/actions/_form.py").read_text(encoding="utf-8")
    chunk = form.split("async def select_tree_option", 1)[1].split("async def ", 1)[0]
    norm = _norm(chunk)
    assert_true(
        "no-tree-component" in chunk,
        "select_tree_option no-tree fallback block present",
    )
    assert_true(
        "JS_FILL_BY_XPATH" in chunk and "fill_xpath" in chunk,
        "no-tree fill fallback writes via JS_FILL_BY_XPATH when fill_xpath set",
    )
    assert_true(
        "xpath_smart=fill_xpath" in norm,
        "no-tree fill fallback capture passes fill_xpath",
    )
    assert_true(
        "'xpath_smart':fill_xpath" in norm or "'xpath_smart': fill_xpath" in chunk,
        "no-tree fill fallback records xpath_smart in params",
    )
    assert_true(
        "JS_FILL_FORM_FIELD" in chunk,
        "no-tree fill fallback still has label fill when no xpath",
    )


def main() -> int:
    test_snippet_exported()
    test_helpers_source_no_smart_on_xpath_path()
    test_capture_signature_has_xpath_smart()
    test_form_fill_passes_xpath_to_capture()
    test_form_date_passes_xpath_to_capture()
    test_select_option_passes_xpath_to_capture()
    test_click_radio_passes_xpath_to_capture()
    test_execute_round_passes_xpath_to_capture()
    test_tree_fallback_xpath_captures_pass_xpath()
    test_capture_snippet_rebuilds_not_echo()
    test_capture_snippet_drills_form_input()
    test_select_tree_option_fill_fallback_xpath_parity()
    print("characterize-capture-element-xpath: OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
