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
    from scripts.actions import _js_snippets as sn

    assert_true(hasattr(sn, "JS_CAPTURE_FROM_XPATH"), "JS_CAPTURE_FROM_XPATH exported")
    js = sn.JS_CAPTURE_FROM_XPATH
    assert_true("absXPath" in js or "xpath_full" in js, "computes xpath_full")
    assert_true("JS_SMART_LOCATOR" not in js, "snippet must not embed SMART_LOCATOR")
    # Returned object must not set xpath_abs key (absXPath function name is OK).
    assert_true("xpath_abs:" not in js.replace(" ", ""), "do not write xpath_abs")


def test_helpers_source_no_smart_on_xpath_path() -> None:
    src = (ROOT / "scripts/actions/_helpers.py").read_text(encoding="utf-8")
    # After rewrite: body must call JS_CAPTURE_FROM_XPATH; must not call JS_SMART_LOCATOR
    assert_true("JS_CAPTURE_FROM_XPATH" in src, "helpers uses CAPTURE_FROM_XPATH")
    assert_true(
        "JS_SMART_LOCATOR" not in src.split("async def _capture_element")[1].split("\nasync def ")[0],
        "_capture_element must not use JS_SMART_LOCATOR",
    )


def test_capture_signature_has_xpath_smart() -> None:
    import inspect

    from scripts.actions._helpers import _capture_element

    sig = inspect.signature(_capture_element)
    assert_true("xpath_smart" in sig.parameters, "xpath_smart kw-only param")


def main() -> int:
    test_snippet_exported()
    test_helpers_source_no_smart_on_xpath_path()
    test_capture_signature_has_xpath_smart()
    print("characterize-capture-element-xpath: OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
