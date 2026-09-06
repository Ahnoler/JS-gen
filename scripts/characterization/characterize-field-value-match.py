#!/usr/bin/env python3
"""Characterize: amount display format must match bare filled numbers."""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))


def assert_true(cond: bool, msg: str) -> None:
    if not cond:
        raise AssertionError(msg)


def test_field_values_equivalent_amount() -> None:
    from scripts.controller.actions.form_scan_utils import field_values_equivalent

    assert_true(
        field_values_equivalent("2,026.00", "2026"),
        "2,026.00 ≡ 2026",
    )
    assert_true(
        field_values_equivalent("2026", "2,026.00"),
        "2026 ≡ 2,026.00",
    )
    assert_true(
        field_values_equivalent("1,000.50", "1000.5"),
        "1,000.50 ≡ 1000.5",
    )
    assert_true(
        field_values_equivalent("碧蓝美容有限公司", "碧蓝美容有限公司"),
        "exact text still matches",
    )
    assert_true(
        not field_values_equivalent("2,026.00", "2027"),
        "2,026.00 ≢ 2027",
    )
    assert_true(
        not field_values_equivalent("1,234.00", "12"),
        "1,234.00 ≢ 12 (no digit substring across commas)",
    )
    assert_true(
        field_values_equivalent("张三（已认证）", "张三"),
        "non-numeric containment still ok",
    )


def test_verify_uses_field_values_equivalent() -> None:
    form = (
        (ROOT / "scripts/controller/actions/form_action_engines.py").read_text(encoding="utf-8")
        + "\n"
        + (ROOT / "scripts/controller/actions/_form.py").read_text(encoding="utf-8")
    )
    chunk = form.split("async def verify_field_value", 1)[1].split(
        "async def scan_form_fields", 1
    )[0]
    assert_true(
        "field_values_equivalent" in chunk,
        "verify_field_value must use field_values_equivalent",
    )


def test_check_field_enriches_match_hint() -> None:
    """check_field_value JSON should help agent when display is amount-formatted."""
    form = (
        (ROOT / "scripts/controller/actions/form_action_engines.py").read_text(encoding="utf-8")
        + "\n"
        + (ROOT / "scripts/controller/actions/_form.py").read_text(encoding="utf-8")
    )
    chunk = form.split("async def check_field_value", 1)[1].split(
        "async def verify_field_value", 1
    )[0]
    assert_true(
        "field_values_equivalent" in chunk
        or "normalizedValue" in chunk
        or "valueNote" in chunk
        or "enrich_field_value_check" in chunk,
        "check_field_value must enrich / note amount display vs filled bare number",
    )


def test_prompts_mention_amount_display() -> None:
    common = (ROOT / "scripts/prompts/agent-tools-common.md").read_text(encoding="utf-8")
    assert_true(
        "千分位" in common and ("2,026" in common or "格式化" in common or "normalizedValue" in common),
        "agent-tools-common must warn amount display ≠ wrong fill",
    )
    scen = (ROOT / "scripts/prompts/scenario-describer-prompt.md").read_text(encoding="utf-8")
    assert_true(
        "千分位" in scen or "2,026" in scen,
        "scenario-describer must not treat amount format as fill failure",
    )


def main() -> int:
    try:
        test_field_values_equivalent_amount()
        test_verify_uses_field_values_equivalent()
        test_check_field_enriches_match_hint()
        test_prompts_mention_amount_display()
    except Exception as exc:
        print(f"characterize-field-value-match: FAIL {exc}")
        return 1
    print("characterize-field-value-match: OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
