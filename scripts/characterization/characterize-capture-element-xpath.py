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


def main() -> int:
    test_snippet_exported()
    print("characterize-capture-element-xpath: OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
