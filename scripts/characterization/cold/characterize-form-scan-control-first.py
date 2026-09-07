#!/usr/bin/env python3
"""Characterize control-first form scan (xpath on models + scan cues)."""
from __future__ import annotations
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from scripts.models.field import ScannedField
from scripts.models.form_snapshot import FormSnapshot
from scripts.models.task import TaskItem, TaskList


def assert_true(cond: bool, msg: str) -> None:
    if not cond:
        raise AssertionError(msg)


def test_js_scan_cues() -> None:
    js = (
        (ROOT / "scripts/controller/actions/_js_snippets.py").read_text(encoding="utf-8")
        + "".join(
            p.read_text(encoding="utf-8")
            for p in sorted((ROOT / "scripts/controller/actions/js_snippets").glob("*.py"))
        )
    )
    assert_true("el-table" in js and "xpath_smart" in js, "scan references el-table and xpath_smart")
    assert_true("COLLECT_L2_TABLE" in js, "COLLECT_L2_TABLE marker")
    assert_true("SCAN_DEDUP_BY_XPATH" in js, "SCAN_DEDUP_BY_XPATH marker")


def test_l2_table_empty_leading_row_cues() -> None:
    from scripts.controller.actions._js_snippets import JS_SCAN_FORM_FIELDS
    js = JS_SCAN_FORM_FIELDS
    assert_true("COLLECT_L2_TABLE" in js, "COLLECT_L2_TABLE marker")
    assert_true(
        "row#" in js,
        "synthetic row#N cue present for empty-leading rows",
    )
    assert_true(
        "COLLECT_L2_TABLE_EMPTY_LEADING" in js,
        "COLLECT_L2_TABLE_EMPTY_LEADING marker on empty-leading path",
    )
    assert_true(
        "COLLECT_L2_TABLE_ROW_INDEX_XPATH" in js,
        "COLLECT_L2_TABLE_ROW_INDEX_XPATH marker for synthetic row xpath",
    )


def test_fingerprint_distinguishes_same_label() -> None:
    a = FormSnapshot.from_scan_fields("main", [
        {"label": "保存", "required": False, "xpath_smart": "//div[@id='a']//button"},
        {"label": "保存", "required": False, "xpath_smart": "//div[@id='b']//button"},
    ])
    assert_true(len(a.fields) == 2, "same-label fields with distinct xpath both kept")
    assert_true(
        a.fields_fingerprint[0] != a.fields_fingerprint[1],
        "fields_fingerprint distinguishes same label by xpath_smart",
    )


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
    test_js_scan_cues()
    test_l2_table_empty_leading_row_cues()
    test_fingerprint_distinguishes_same_label()
    print("characterize-form-scan-control-first: OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
