#!/usr/bin/env python3
"""Characterize assistant mission context injection + needs_agent handoff."""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.actions._llm_values import (  # noqa: E402
    build_assistant_mission_context,
    format_assistant_human_message,
    parse_form_llm_response,
)


def assert_true(cond: bool, msg: str) -> None:
    if not cond:
        raise AssertionError(msg)


def test_build_context_includes_task_business_snapshot() -> None:
    store = {
        "_case_scenario_text": "关键数据\n系统评级等级应对齐",
        "_scan_fields": [
            {
                "label": "系统评级等级",
                "currentValue": "A",
                "disabled": True,
                "section_id": "系统评级结论",
                "section_title": "系统评级结论",
            },
            {
                "label": "此次评级建议等级",
                "currentValue": "",
                "disabled": False,
                "section_id": "系统评级结论",
                "section_title": "系统评级结论",
            },
            {
                "label": "资产负债率",
                "currentValue": "35%",
                "disabled": False,
                "section_id": "评级等级测算",
                "section_title": "评级等级测算",
            },
        ],
        "_phase_intent": {
            "goal": "在系统评级结论区域根据系统评级等级选择建议评级并保存",
            "task_text_excerpt": "根据系统评级等级选择建议评级",
        },
    }
    ctx = build_assistant_mission_context(store, section="系统评级结论")
    assert_true("系统评级" in (ctx.get("phase_task") or ""), f"phase_task={ctx.get('phase_task')!r}")
    assert_true("关键数据" in (ctx.get("business_data") or ""), "business_data")
    labels = [r["label"] for r in ctx.get("related_snapshot") or []]
    assert_true("系统评级等级" in labels, f"snapshot should include readonly 系统评级等级, got {labels}")
    assert_true("资产负债率" not in labels, "other section excluded when section filter set")
    assert_true("跳过" in (ctx.get("instruction") or "") or "不确定" in (ctx.get("instruction") or ""),
                "instruction must not be bare 生成合理的测试数据")


def test_parse_form_llm_response_split() -> None:
    actions, needs = parse_form_llm_response({
        "actions": [
            {"action": "select_option", "label": "理由说明", "option": "x"},
            {"action": "select_option", "label": "此次评级建议等级", "option": "AA"},
        ],
        "needs_agent": [
            {"label": "此次评级建议等级", "reason": "应对齐系统评级等级"},
        ],
    })
    labels = [a.get("label") for a in actions]
    assert_true("此次评级建议等级" not in labels, "needs_agent label must not remain in actions")
    assert_true(any(n.get("label") == "此次评级建议等级" for n in needs), "needs_agent kept")


def test_llm_generate_uses_mission_context_in_prompt() -> None:
    src = (ROOT / "scripts/actions/_llm_values.py").read_text(encoding="utf-8")
    assert_true("build_assistant_mission_context" in src, "wired")
    assert_true("format_assistant_human_message" in src, "wired")
    assert_true("parse_form_llm_response" in src or "needs_agent" in src, "needs_agent path")


def test_format_human_message_orders_context_before_fields() -> None:
    ctx = {
        "phase_task": "根据系统评级等级选择建议评级",
        "business_data": "关键数据\nX",
        "related_snapshot": [{"label": "系统评级等级", "value": "A", "disabled": True}],
        "instruction": "按任务背景填写；不确定则跳过并申报",
    }
    fields_block = '1. label: "此次评级建议等级", kind: select'
    msg = format_assistant_human_message(ctx, fields_block)
    i_task = msg.find("根据系统评级等级")
    i_fields = msg.find("此次评级建议等级")
    assert_true(0 <= i_task < i_fields, "mission context before field list")
    assert_true("系统评级等级" in msg and "A" in msg, "snapshot in message")


def main() -> int:
    test_build_context_includes_task_business_snapshot()
    test_parse_form_llm_response_split()
    test_llm_generate_uses_mission_context_in_prompt()
    test_format_human_message_orders_context_before_fields()
    print("characterize-assistant-mission-context: OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
