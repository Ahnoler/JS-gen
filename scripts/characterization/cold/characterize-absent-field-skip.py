#!/usr/bin/env python3
"""Characterization: label-not-found → absent skip (replay ok, no record)."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.controller.actions._helpers import (  # noqa: E402
    absent_field_skip_result,
    is_absent_field_result,
    should_record_result,
    _is_ok_result,
)
from scripts.controller.actions._replay import _result_ok  # noqa: E402


def assert_true(cond: bool, msg: str) -> None:
    if not cond:
        raise AssertionError(msg)


def main() -> int:
    assert_true(is_absent_field_result("label-not-found"), "raw absent")
    assert_true(is_absent_field_result("label-not-found|x"), "prefix absent")
    skip = absent_field_skip_result()
    assert_true(skip.startswith("ok-skip:label-not-found"), skip)
    assert_true(_is_ok_result(skip), "ok-skip is ok-prefix")
    assert_true(not should_record_result(skip), "ok-skip must not record")
    assert_true(should_record_result("ok-xpath-smart"), "normal ok records")

    assert_true(_result_ok("fill_form_field", "label-not-found"), "replay treats raw as ok")
    assert_true(_result_ok("fill_form_field", skip), "replay treats ok-skip as ok")
    assert_true(_result_ok("select_option", "label-not-found"), "select absent ok")
    assert_true(not _result_ok("fill_form_field", "xpath-not-found"), "xpath-miss still fail")
    assert_true(not _result_ok("fill_form_field", "false_ok:expected=a,actual=b"), "false_ok fail")

    print("characterize-absent-field-skip: OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
