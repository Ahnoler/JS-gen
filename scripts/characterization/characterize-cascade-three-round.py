#!/usr/bin/env python3
"""Characterization: cascade round worklist + select-first fallback."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.controller.actions.cascade_fill import (  # noqa: E402
    append_select_first_fallbacks,
    filled_ok_keys_from_results,
    merge_cascade_worklist,
    still_empty_pending_dicts,
)
from scripts.models.task import TaskItem  # noqa: E402


def assert_true(cond: bool, msg: str) -> None:
    if not cond:
        raise AssertionError(msg)


def main() -> int:
    pending = [
        TaskItem(label="婚姻状况", kind="select", currentValue="已婚"),
        TaskItem(label="配偶姓名", kind="input", currentValue=""),
        TaskItem(label="配偶电话", kind="input", currentValue=""),
        TaskItem(
            label="实际控制人客户编号",
            kind="input",
            currentValue="",
            disabled=True,
            hasButton="引入",
        ),
    ]
    still = still_empty_pending_dicts(pending, filled_ok_keys={"婚姻状况"})
    labels = [d["label"] for d in still]
    assert_true(labels == ["配偶姓名", "配偶电话"], f"still_empty got {labels}")

    new = [{"label": "配偶证件号", "kind": "input", "xpath_smart": "//a"}]
    work = merge_cascade_worklist(new, still)
    assert_true(
        [d["label"] for d in work] == ["配偶证件号", "配偶姓名", "配偶电话"],
        f"merge order {work}",
    )
    # dedupe
    work2 = merge_cascade_worklist(
        [{"label": "配偶姓名", "kind": "input"}],
        [{"label": "配偶姓名", "kind": "input"}, {"label": "X", "kind": "input"}],
    )
    assert_true([d["label"] for d in work2] == ["配偶姓名", "X"], f"dedupe {work2}")

    actions, needs = append_select_first_fallbacks(
        [{"action": "select_option", "label": "国别", "option": "中国"}],
        [{"label": "企业规模", "reason": "不确定"}, {"label": "国别", "reason": "x"}],
        [
            {"label": "国别", "kind": "select"},
            {"label": "企业规模", "kind": "select", "xpath_smart": "//s"},
            {"label": "引入字段", "kind": "select", "hasButton": "引入"},
        ],
    )
    assert_true(any(a.get("label") == "企业规模" and a.get("option") == "first" for a in actions), actions)
    assert_true(not any(isinstance(n, dict) and n.get("label") == "企业规模" for n in needs), needs)
    assert_true(not any(a.get("label") == "引入字段" for a in actions), "skip hasButton")

    keys = filled_ok_keys_from_results(
        [
            {"label": "配偶姓名", "result": "ok-xpath-smart"},
            {"label": "坏", "result": "label-not-found"},
        ]
    )
    assert_true("配偶姓名" in keys and "坏" not in keys, keys)

    form = (ROOT / "scripts/controller/actions/_form.py").read_text(encoding="utf-8")
    assert_true("_cascade_round" in form, "wired cascade round helper")
    assert_true("append_select_first_fallbacks" in form, "select first fallback wired")
    assert_true("still_empty" in form or "still_empty_pending" in form, "still_empty wired")

    print("characterize-cascade-three-round: OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
