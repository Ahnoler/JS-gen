#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
Characterization: format_special_element_hint enrichment (phaseDescription/remark).

Run:
  python scripts/characterization/characterize-special-element-hint.py
"""
from __future__ import annotations

import os
import sys

_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

from scripts.controller.actions._special_element import format_special_element_hint  # noqa: E402


def assert_true(cond: bool, msg: str) -> None:
    if not cond:
        raise AssertionError(msg)


def test_hint_includes_description_when_present() -> None:
    store = {
        "se-1": {
            "name": "法人引入",
            "dictLabel": "引入",
            "stepCount": 5,
            "matchReasons": ["标签匹配: 引入"],
            "phaseDescription": "法定代表人引入弹窗",
            "remark": "需先搜索客户",
        }
    }
    hint = format_special_element_hint(store)
    assert_true("法人引入" in hint, "name in hint")
    assert_true("法定代表人引入弹窗" in hint, "phaseDescription in hint")
    assert_true("需先搜索客户" in hint, "remark in hint")
    assert_true("use_special_element" in hint, "guidance present")
    assert_true("不要手写逐步引入" in hint, "no manual step guidance")


def test_hint_includes_step_summary_when_present() -> None:
    store = {
        "se-2": {
            "name": "选人",
            "stepSummary": [{"stepNumber": 1, "actionType": "click"}],
        }
    }
    hint = format_special_element_hint(store)
    assert_true("summary=" in hint, "stepSummary in hint")


def test_hint_match_reasons_limit_five() -> None:
    reasons = [f"r{i}" for i in range(7)]
    store = {"se-3": {"name": "x", "matchReasons": reasons}}
    hint = format_special_element_hint(store)
    assert_true("r5" not in hint, "matchReasons capped at 5")
    assert_true("r6" not in hint, "matchReasons capped at 5")
    assert_true("r0" in hint and "r4" in hint, "first 5 matchReasons present")


def test_hint_empty_store() -> None:
    assert_true(format_special_element_hint({}) == "", "empty dict")
    assert_true(format_special_element_hint(None) == "", "None store")


def main() -> None:
    test_hint_includes_description_when_present()
    test_hint_includes_step_summary_when_present()
    test_hint_match_reasons_limit_five()
    test_hint_empty_store()
    print("characterize-special-element-hint: OK")


if __name__ == "__main__":
    main()
