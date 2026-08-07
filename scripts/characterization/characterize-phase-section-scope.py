#!/usr/bin/env python3
"""Characterize phase↔section scope (LLM-declared section for gate/pending)."""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.actions._section_scope import (  # noqa: E402
    section_matches,
    pending_by_section,
    filter_pending_labels,
)
from scripts.models.task import TaskItem, TaskList  # noqa: E402


def assert_true(cond: bool, msg: str) -> None:
    if not cond:
        raise AssertionError(msg)


def test_section_matches() -> None:
    assert_true(section_matches("", "征信信息", "征信信息"), "empty want matches all")
    assert_true(section_matches("系统评级结论", "系统评级结论", "系统评级结论"), "exact")
    assert_true(section_matches("系统评级结论", "系统评级结论#2", "系统评级结论"), "#n id")
    assert_true(not section_matches("系统评级结论", "征信信息", "征信信息"), "other section")


def test_filter_pending_excludes_other_section() -> None:
    tl = TaskList(
        pending=[
            TaskItem(label="借款企业", kind="radio", section_id="征信信息", section_title="征信信息"),
            TaskItem(label="法定代表人", kind="radio", section_id="征信信息", section_title="征信信息"),
            TaskItem(label="理由说明", kind="input", section_id="系统评级结论", section_title="系统评级结论"),
        ]
    )
    labels = filter_pending_labels(tl, "系统评级结论")
    assert_true(labels == ["理由说明"], f"got {labels}")
    by = pending_by_section(tl)
    assert_true("征信信息" in by and "借款企业" in by["征信信息"], "by_section map")


def test_gate_scoped_ignores_credit() -> None:
    from scripts.actions._phase_intent import check_pending_write_gate

    tl = TaskList(
        pending=[
            TaskItem(label="借款企业", kind="radio", section_title="征信信息", section_id="征信信息"),
            TaskItem(label="法定代表人", kind="radio", section_title="征信信息", section_id="征信信息"),
        ]
    )
    store = {"task_list": tl.to_store(), "_force_refill_all": True}
    ok, labels = check_pending_write_gate(store, section="系统评级结论")
    assert_true(ok and labels == [], f"scoped gate should pass, got {ok} {labels}")
    ok2, labels2 = check_pending_write_gate(store, section="")
    assert_true(not ok2 and set(labels2) == {"借款企业", "法定代表人"}, "unscoped sees 征信")


def test_multi_section_map() -> None:
    tl = TaskList(
        pending=[
            TaskItem(label="借款企业", kind="radio", section_title="征信信息", section_id="征信信息"),
            TaskItem(label="综合评价", kind="input", section_title="客户综合评价", section_id="客户综合评价"),
        ]
    )
    by = pending_by_section(tl)
    assert_true(len(by) >= 2, "multi-section pending")


def test_form_has_err_section_required() -> None:
    form = (ROOT / "scripts/actions/_form.py").read_text(encoding="utf-8")
    assert_true("err-section-required" in form, "click_save surfaces err-section-required")


def test_get_pending_signature() -> None:
    form = (ROOT / "scripts/actions/_form.py").read_text(encoding="utf-8")
    chunk = form.split("async def get_pending_tasks", 1)[1][:600]
    assert_true("section" in chunk, "get_pending_tasks accepts section")
    assert_true("pending_by_section" in form, "includes pending_by_section")


def test_submit_hint_section_scoped() -> None:
    from scripts.actions._form import _submit_ready_hint

    tl = TaskList(
        pending=[
            TaskItem(label="借款企业", kind="radio", section_title="征信信息", section_id="征信信息"),
        ]
    )
    store = {"task_list": tl.to_store()}
    assert_true(_submit_ready_hint(store) == "", "global still has pending")
    cue = _submit_ready_hint(store, section="系统评级结论")
    assert_true("click_save()" in cue, "empty section-local pending gets save cue")


def main() -> int:
    test_section_matches()
    test_filter_pending_excludes_other_section()
    test_gate_scoped_ignores_credit()
    test_multi_section_map()
    test_form_has_err_section_required()
    test_get_pending_signature()
    test_submit_hint_section_scoped()
    print("characterize-phase-section-scope: OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
