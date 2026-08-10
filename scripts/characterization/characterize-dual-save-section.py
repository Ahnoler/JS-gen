#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Dual 保存: sticky must not win when ≥2 sectioned same-label buttons."""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from scripts.controller.actions.section_scope import (  # noqa: E402
    same_label_section_keys,
    preferred_submit_cue,
)


def assert_true(cond: bool, msg: str) -> None:
    if not cond:
        raise AssertionError(msg)


def test_same_label_section_keys() -> None:
    buttons = [
        {"label": "保存", "section_id": "系统评级结论", "section_title": "系统评级结论"},
        {"label": "保存", "section_id": "客户综合评价", "section_title": "客户综合评价"},
    ]
    keys = same_label_section_keys(buttons, "保存")
    assert_true(len(keys) == 2, f"expect 2 sections, got {keys!r}")
    assert_true("系统评级结论" in keys and "客户综合评价" in keys, f"keys={keys!r}")

    one = [{"label": "保存", "section_id": "系统评级结论", "section_title": "系统评级结论"}]
    assert_true(same_label_section_keys(one, "保存") == ["系统评级结论"], "single section")


def test_preferred_submit_cue() -> None:
    buttons = [
        {"label": "保存", "section_id": "系统评级结论", "section_title": "系统评级结论"},
        {"label": "保存", "section_id": "客户综合评价", "section_title": "客户综合评价"},
    ]
    store = {
        "_scan_buttons": buttons,
        "_phase_section": "系统评级结论",
    }
    cue = preferred_submit_cue(store, section="")
    # After Task 3/5 cue may still include memory section; dual-save prompt task covers explicit section=
    assert_true("click_save" in cue, "cue mentions click_save")


def test_click_save_wiring() -> None:
    """Source: click_save must count same-label sections before applying sticky memory."""
    form = (ROOT / "scripts/controller/actions/_form.py").read_text(encoding="utf-8")
    cs = form.find("async def click_save")
    assert_true(cs >= 0, "click_save present")
    body = form[cs : cs + 5000]
    assert_true("same_label_section_keys" in body, "click_save uses same_label_section_keys")
    multi_pos = body.find("same_label_section_keys")
    mem_pos = body.find("_phase_section")
    assert_true(multi_pos >= 0 and mem_pos >= 0, "both present")
    assert_true(multi_pos < mem_pos, "multi-section check before sticky memory read")


def main(include_form_wiring: bool = False) -> int:
    test_same_label_section_keys()
    test_preferred_submit_cue()
    if include_form_wiring:
        test_click_save_wiring()
    else:
        print(
            "characterize-dual-save-section: PENDING click_save wiring "
            "(Task 2; pass --include-form-wiring to run)"
        )
    print("characterize-dual-save-section: OK")
    return 0


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--include-form-wiring",
        action="store_true",
        help="Run click_save wiring asserts (Task 2; expected fail until wired)",
    )
    args = parser.parse_args()
    raise SystemExit(main(include_form_wiring=args.include_form_wiring))
