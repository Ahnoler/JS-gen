#!/usr/bin/env python3
"""Pin click_save ghost-pending live-prune (scheme A / #614 法人机构)."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SCAN = (ROOT / "scripts/controller/actions/js_snippets/scan_form.py").read_text(encoding="utf-8")
SAVE = (ROOT / "scripts/controller/actions/form_save.py").read_text(encoding="utf-8")


def assert_true(cond: bool, msg: str) -> None:
    if not cond:
        raise AssertionError(msg)


def test_js_check_exposes_visible() -> None:
    start = SCAN.find("JS_CHECK_SINGLE_FIELD = ")
    assert_true(start >= 0, "JS_CHECK_SINGLE_FIELD defined")
    body = SCAN[start : start + 3500]
    assert_true("visible" in body, "CHECK_SINGLE returns/computes visible")
    assert_true("label-not-found" in body, "not-found sentinel preserved")
    assert_true("display" in body and "visibility" in body, "style-based visibility")
    assert_true("getBoundingClientRect" in body, "zero-rect visibility")
    assert_true("fieldVisible" in body, "named visibility helper")


def test_form_save_ghost_prune() -> None:
    assert_true("pruned disabled pending" in SAVE, "disabled prune log kept")
    assert_true("pruned ghost pending" in SAVE, "ghost prune log present")
    assert_true("label-not-found" in SAVE, "consumes not-found sentinel")
    assert_true("visible" in SAVE and "not-visible" in SAVE, "consumes visible===false")
    assert_true("check_pending_write_gate" in SAVE, "gate re-check after prune")


def main() -> int:
    test_js_check_exposes_visible()
    test_form_save_ghost_prune()
    print("characterize-ghost-pending-prune: OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
