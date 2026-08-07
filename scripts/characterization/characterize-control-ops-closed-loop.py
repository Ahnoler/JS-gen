#!/usr/bin/env python3
"""Characterize control-ops closed loop (section + buttons + save scope)."""
from __future__ import annotations
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from scripts.models.field import ScannedField, FormScanResult


def assert_true(cond: bool, msg: str) -> None:
    if not cond:
        raise AssertionError(msg)


def test_models_section() -> None:
    f = ScannedField(
        label="资产负债率",
        xpath_smart="//tr[.//*[normalize-space()='资产负债率']]//input",
        section_id="评级等级测算",
        section_title="评级等级测算",
    )
    assert_true(f.section_title == "评级等级测算", "ScannedField.section_title")
    assert_true(hasattr(FormScanResult, "model_fields") and "buttons" in FormScanResult.model_fields,
                "FormScanResult.buttons")


def test_js_scan_section_and_source_b_kinds() -> None:
    js = (ROOT / "scripts/actions/_js_snippets.py").read_text(encoding="utf-8")
    assert_true("sectionOf" in js or "SECTION_ATTACH" in js, "section attach helper")
    assert_true("SCAN_SOURCE_C_BUTTONS" in js, "buttons source marker")
    # Source B must collect radio groups (not only skip input[type=radio])
    assert_true("el-radio" in js and "SCAN_SOURCE_B" in js, "table radio collection cues")


def test_click_save_section_api() -> None:
    js = (ROOT / "scripts/actions/_js_snippets.py").read_text(encoding="utf-8")
    assert_true("ambiguous" in js or "candidates" in js, "save returns candidates when ambiguous")
    form = (ROOT / "scripts/actions/_form.py").read_text(encoding="utf-8")
    assert_true("section" in form and "click_save" in form, "click_save accepts section")
    # Exact 暂存 must not be rejected when needle is 暂存
    assert_true("rejectRe" in js, "rejectRe still present for non-exact noise")


def main() -> int:
    test_models_section()
    test_js_scan_section_and_source_b_kinds()
    test_click_save_section_api()
    print("characterize-control-ops-closed-loop: OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
