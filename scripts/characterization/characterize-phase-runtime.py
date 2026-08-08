#!/usr/bin/env python3
"""Characterization: phase runtime hardening (section scope, empty buffer, empty-act)."""
from __future__ import annotations
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.actions._section_scope import (  # noqa: E402
    remember_phase_section,
    clear_phase_section,
    resolve_phase_section,
)
from scripts.actions._phase_reviewer import resolve_phase_max_steps  # noqa: E402


def assert_true(cond: bool, msg: str) -> None:
    if not cond:
        raise AssertionError(msg)


def test_remember_and_resolve_memory() -> None:
    store: dict = {}
    remember_phase_section(store, "系统评级结论")
    assert_true(store.get("_phase_section") == "系统评级结论", "remember writes")
    assert_true(resolve_phase_section(store) == "系统评级结论", "resolve prefers memory")
    clear_phase_section(store)
    assert_true(not store.get("_phase_section"), "clear removes")


def test_clear_phase_intent_clears_section() -> None:
    from scripts.actions._phase_intent import clear_phase_intent

    store = {"_phase_section": "系统评级结论", "_empty_act_streak": 2}
    clear_phase_intent(store)
    assert_true("_phase_section" not in store, "clear_phase_intent drops section")
    assert_true("_empty_act_streak" not in store, "clear_phase_intent drops empty streak")


def test_form_wires_remember() -> None:
    form = (ROOT / "scripts/actions/_form.py").read_text(encoding="utf-8")
    assert_true("remember_phase_section" in form, "form remembers section")


def test_scoped_pending_gate_ignores_other_section() -> None:
    from scripts.models.task import TaskItem, TaskList
    from scripts.actions._phase_intent import apply_phase_contract, check_pending_write_gate

    tl = TaskList(
        pending=[
            TaskItem(
                label="理由说明",
                kind="input",
                section_title="系统评级结论",
                section_id="系统评级结论",
            ),
            TaskItem(
                label="综合评价",
                kind="input",
                section_title="客户综合评价",
                section_id="客户综合评价",
            ),
        ],
        done=[],
    )
    store = {
        "task_list": tl.to_store(),
        "_force_refill_all": True,
        "_phase_section": "系统评级结论",
    }
    apply_phase_contract(
        store,
        {
            "mode": "modify",
            "allow_form_assistant": True,
            "refill": "all_editable",
            "goal": "系统评级结论",
            "in_scope": [],
            "out_of_scope": [],
            "done_when": "",
            "submit": {"required": True, "via": "click_save", "button_text": "保存"},
            "success": {"kinds": ["toast_ok"], "evidence": []},
            "source": "test",
        },
    )
    store["_phase_section"] = "系统评级结论"  # re-set after apply clears
    tl2 = TaskList.from_store(store["task_list"])
    tl2.mark_done("理由说明", value="x")
    store["task_list"] = tl2.to_store()
    sec = resolve_phase_section(store)
    ok, labels = check_pending_write_gate(store, section=sec)
    assert_true(ok and labels == [], f"scoped gate ok got {ok} {labels}")


def test_recorder_wires_resolve_phase_section() -> None:
    rec = (ROOT / "scripts/recorder.py").read_text(encoding="utf-8")
    assert_true("resolve_phase_section" in rec, "recorder uses resolve_phase_section")


def test_resolve_infer_unique_and_longest() -> None:
    store = {
        "_phase_intent": {
            "goal": "在系统评级结论区域选择建议评级并保存",
            "in_scope": ["填写理由说明"],
            "submit": {"required": True},
        },
        "_scan_buttons": [
            {"label": "保存", "section_title": "系统评级结论", "section_id": "系统评级结论"},
            {"label": "保存", "section_title": "客户综合评价", "section_id": "客户综合评价"},
        ],
    }
    assert_true(
        resolve_phase_section(store, task_text="") == "系统评级结论",
        f"unique title in goal → {resolve_phase_section(store)!r}",
    )
    store2 = {
        "_phase_intent": {"goal": "保存全部", "in_scope": [], "submit": {"required": True}},
        "_scan_buttons": store["_scan_buttons"],
    }
    assert_true(resolve_phase_section(store2) == "", "ambiguous / no unique → empty")


def main() -> None:
    test_remember_and_resolve_memory()
    test_clear_phase_intent_clears_section()
    test_form_wires_remember()
    test_scoped_pending_gate_ignores_other_section()
    test_recorder_wires_resolve_phase_section()
    test_resolve_infer_unique_and_longest()
    print("PASS characterize-phase-runtime")


if __name__ == "__main__":
    main()
