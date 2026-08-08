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
    test_resolve_infer_unique_and_longest()
    print("PASS characterize-phase-runtime")


if __name__ == "__main__":
    main()
