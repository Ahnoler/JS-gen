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


def main() -> int:
    test_models_section()
    print("characterize-control-ops-closed-loop models: OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
