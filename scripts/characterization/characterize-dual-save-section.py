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
    resolve_phase_section,
)
from scripts.controller.actions.form_scan_utils import _submit_ready_hint  # noqa: E402
from scripts.models.task import TaskItem, TaskList  # noqa: E402


def assert_true(cond: bool, msg: str) -> None:
    if not cond:
        raise AssertionError(msg)


def _dual_save_store() -> dict:
    buttons = [
        {"label": "保存", "section_id": "系统评级结论", "section_title": "系统评级结论"},
        {"label": "保存", "section_id": "客户综合评价", "section_title": "客户综合评价"},
    ]
    return {
        "_scan_buttons": buttons,
        "_phase_section": "系统评级结论",
        "task_list": TaskList(
            pending=[],
            done=[TaskItem(label="理由说明", kind="input", section_title="系统评级结论")],
        ).to_store(),
    }


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
    store = _dual_save_store()
    cue = preferred_submit_cue(store, section="")
    assert_true("Multiple" in cue, f"multi cue must say Multiple: {cue}")
    assert_true(
        "region=" in cue or "section=" in cue,
        f"multi cue must require region=/section=: {cue}",
    )
    assert_true("sticky" in cue.lower() or "ambiguous" in cue.lower(), f"warn sticky: {cue}")
    assert_true(
        "region='系统评级结论'" not in cue and "section='系统评级结论'" not in cue,
        f"must not inject sticky section: {cue}",
    )

    # Callers pass sticky via resolve_phase_section — gate must still fire
    sticky = resolve_phase_section(store)
    assert_true(sticky == "系统评级结论", f"fixture sticky: {sticky!r}")
    cue_sticky = preferred_submit_cue(store, section=sticky)
    assert_true("Multiple" in cue_sticky, f"sticky arg must not bypass gate: {cue_sticky}")
    assert_true(
        "region='系统评级结论'" not in cue_sticky and "section='系统评级结论'" not in cue_sticky,
        f"must not emit click_save with sticky section: {cue_sticky}",
    )


def test_submit_ready_hint_dual_save() -> None:
    store = _dual_save_store()
    hint = _submit_ready_hint(store)
    assert_true("Multiple" in hint, f"_submit_ready_hint must gate dual save: {hint}")
    assert_true(
        "region='系统评级结论'" not in hint and "section='系统评级结论'" not in hint,
        f"must not inject sticky section in hint: {hint}",
    )
    sticky = resolve_phase_section(store)
    hint_sticky = _submit_ready_hint(store, section=sticky)
    assert_true("Multiple" in hint_sticky, f"explicit sticky section must gate: {hint_sticky}")
    assert_true(
        "region='系统评级结论'" not in hint_sticky and "section='系统评级结论'" not in hint_sticky,
        f"must not pass sticky as section= in hint: {hint_sticky}",
    )


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


def test_click_save_records_section() -> None:
    """Source: successful click_save must persist section in recorded params."""
    form = (ROOT / "scripts/controller/actions/_form.py").read_text(encoding="utf-8")
    cs = form.find("async def click_save")
    assert_true(cs >= 0, "click_save present")
    end = form.find("    @controller.action", cs + 1)
    body = form[cs : end if end > cs else cs + 16000]
    rec = body.find("_record_action")
    assert_true(rec >= 0, "records action")
    rec_block = body[rec : rec + 600]
    assert_true("section" in rec_block, "params include section")


def main(include_form_wiring: bool = False) -> int:
    test_same_label_section_keys()
    test_preferred_submit_cue()
    test_submit_ready_hint_dual_save()
    test_click_save_records_section()
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
