#!/usr/bin/env python3
"""Recorded step params must omit xpath_smart (element carries locator)."""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))


def assert_true(cond: bool, msg: str) -> None:
    if not cond:
        raise AssertionError(msg)


def test_record_action_strips_params_xpath_smart() -> None:
    from scripts import state as S

    S._ACTION_LOG.clear()
    S._CURRENT_PHASE = 1
    S._CURRENT_SOURCE = "agent"
    element = {
        "xpath_smart": (
            "//div[contains(@class,'el-form-item')]"
            "[.//label[contains(.,'名称')]]//input"
        ),
        "tag": "input",
    }
    S._record_action(
        "fill_form_field",
        {
            "label_text": "核心产品名称",
            "value": "x",
            "xpath_smart": (
                "//div[contains(@class,'el-form-item')]"
                "[.//label[contains(.,'编号')]]//input"
            ),
        },
        "ok",
        element=element,
    )
    assert_true(len(S._ACTION_LOG) >= 1, "entry appended")
    entry = S._ACTION_LOG[-1]
    params = entry.get("params") or {}
    assert_true("xpath_smart" not in params, f"params must omit xpath_smart, got {params!r}")
    el = entry.get("element") or {}
    assert_true("名称" in str(el.get("xpath_smart") or ""), "element xpath preserved")


def main() -> int:
    test_record_action_strips_params_xpath_smart()
    print("characterize-record-params-no-xpath: OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
