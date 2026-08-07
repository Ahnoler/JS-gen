#!/usr/bin/env python3
"""Characterize control-first form scan (xpath on models + scan cues)."""
from __future__ import annotations
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from scripts.models.field import ScannedField
from scripts.models.task import TaskItem, TaskList


def assert_true(cond: bool, msg: str) -> None:
    if not cond:
        raise AssertionError(msg)


def main() -> int:
    f = ScannedField(label="请输入账号", xpath_smart="//input[@placeholder='请输入账号']")
    assert_true(hasattr(f, "xpath_smart") and f.xpath_smart.startswith("//"), "ScannedField.xpath_smart")
    item = TaskItem.from_scanned({
        "label": "请输入账号",
        "kind": "input",
        "currentValue": "",
        "disabled": False,
        "required": False,
        "hasButton": "",
        "placeholder": "请输入账号",
        "xpath_smart": "//input[@placeholder='请输入账号']",
    })
    assert_true(item is not None and item.xpath_smart.startswith("//"), "TaskItem carries xpath_smart")
    print("characterize-form-scan-control-first models: OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
