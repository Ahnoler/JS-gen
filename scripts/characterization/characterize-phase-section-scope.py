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


def main() -> int:
    test_section_matches()
    test_filter_pending_excludes_other_section()
    print("characterize-phase-section-scope: OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
