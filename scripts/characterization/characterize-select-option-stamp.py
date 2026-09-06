#!/usr/bin/env python3
"""Characterize: select_option must never persist option_text=first (replay contract)."""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


def assert_true(cond: bool, msg: str) -> None:
    if not cond:
        raise AssertionError(msg)


def test_resolve_recorded_option_text() -> None:
    from scripts.controller.actions.form_scan_utils import resolve_recorded_option_text

    assert_true(
        resolve_recorded_option_text("first", "信贷潜在客户") == "信贷潜在客户",
        "first + actual → stamp actual",
    )
    assert_true(
        resolve_recorded_option_text("FIRST", "A") == "A",
        "case-insensitive first",
    )
    assert_true(
        resolve_recorded_option_text("第一个", "营业执照") == "营业执照",
        "Chinese first synonym",
    )
    assert_true(
        resolve_recorded_option_text("any", "x") == "x",
        "any sentinel stamped",
    )
    assert_true(
        resolve_recorded_option_text("信贷正式客户", "信贷潜在客户") == "信贷正式客户",
        "concrete request kept (not overwritten by actual)",
    )
    assert_true(
        resolve_recorded_option_text("first", "") == "first",
        "no actual → keep requested (caller must not record if empty)",
    )
    assert_true(
        resolve_recorded_option_text("", "已选") == "已选",
        "empty request → fall back to actual",
    )


def test_select_option_already_matched_stamps_concrete() -> None:
    engines = (
        ROOT / "scripts/controller/actions/form_action_engines.py"
    ).read_text(encoding="utf-8")
    class_idx = engines.find("class SelectEngine")
    assert_true(class_idx >= 0, "SelectEngine class present")
    idx = engines.find("async def select_option(", class_idx)
    assert_true(idx >= 0, "select_option present in SelectEngine")
    # Through end of SelectEngine.select_option / start of the next engine class
    end = engines.find("class RadioEngine", idx)
    assert_true(end > idx, "RadioEngine boundary present after select_option")
    body = engines[idx:end]
    assert_true(
        "resolve_recorded_option_text" in body,
        "select_option uses resolve_recorded_option_text before record",
    )
    assert_true(
        "already-matched" in body and "resolve_recorded_option_text" in body,
        "already-matched path stamps via helper",
    )
    assert_true(
        "no-items-skip" in body,
        "no-items already path present",
    )
    # Stamp call appears near no-items-skip
    skip_pos = body.find("no-items-skip")
    assert_true(
        "resolve_recorded_option_text" in body[max(0, skip_pos - 400) : skip_pos + 80],
        "no-items-skip stamps concrete option_text",
    )


def main() -> int:
    test_resolve_recorded_option_text()
    test_select_option_already_matched_stamps_concrete()
    print("characterize-select-option-stamp: OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
