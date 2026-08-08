#!/usr/bin/env python3
"""Characterization for per-phase agent prompt pack assembly."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.agent_utils import (  # noqa: E402
    _resolve_directives,
    build_agent_system_message,
)


def assert_true(cond: bool, msg: str) -> None:
    if not cond:
        raise AssertionError(msg)


def test_build_agent_system_message_assembles_by_mode() -> None:
    nav = build_agent_system_message({"mode": "navigate"})
    assert_true(
        "表单填写助手（CRITICAL — 草稿协作" not in nav,
        "navigate should not include form assistant pack",
    )
    assert_true("click_save" in nav, "core must keep click_save rule")
    assert_true("click_table_row_button" in nav, "navigate should include table tools")

    form = build_agent_system_message({"mode": "create", "allow_form_assistant": True})
    assert_true("run_form_assistant" in form, "create must include form assistant")
    assert_true("needs_agent" in form, "create must include needs_agent")
    assert_true("select_tree_option" in form, "create must include tree")

    full = build_agent_system_message(None)
    assert_true(
        "run_form_assistant" in full and "select_tree_option" in full,
        "full fallback",
    )


def test_navigate_shorter_than_full() -> None:
    nav = build_agent_system_message({"mode": "navigate"})
    full = build_agent_system_message(None)
    assert_true(len(nav) < len(full), "navigate assembly should be shorter than full")


def test_no_special_prompt_references() -> None:
    for mode in (None, {"mode": "navigate"}, {"mode": "create", "allow_form_assistant": True}):
        msg = build_agent_system_message(mode)
        assert_true("agent-special-prompt" not in msg, f"no special-prompt ref for {mode}")


def test_introduce_pick_includes_full_form() -> None:
    intro = build_agent_system_message({"mode": "introduce_pick"})
    assert_true("run_form_assistant" in intro, "introduce_pick gets full form pack")
    assert_true("needs_agent" in intro, "introduce_pick gets needs_agent rules")


def test_agent_prompt_shim_is_full_assembly() -> None:
    raw = (ROOT / "scripts/prompts/agent-prompt.md").read_text(encoding="utf-8")
    assert_true("agent-special-prompt" not in raw, "no special-prompt include in shim")
    shim = _resolve_directives(raw).strip()
    full = build_agent_system_message(None)
    assert_true("run_form_assistant" in shim, "shim must include form assistant")
    assert_true("select_tree_option" in shim, "shim must include tree")
    assert_true(len(shim) >= len(full) * 0.9, "shim approximates full assembly")


def test_special_prompt_deleted() -> None:
    assert_true(
        not (ROOT / "scripts/prompts/agent-special-prompt.md").exists(),
        "special prompt deleted",
    )


def test_planner_synced_with_final_check() -> None:
    p = (ROOT / "scripts/prompts/planner-prompt.md").read_text(encoding="utf-8")
    assert_true(
        "终检" in p or "最终检查" in p or "final check" in p.lower(),
        "planner mentions final check",
    )
    assert_true("needs_agent" in p, "planner documents needs_agent")
    signal3 = p.split("### Signal 3:")[1].split("### Signal 4:")[0]
    assert_true(
        "终检" in signal3 or "最终检查" in signal3 or "final check" in signal3.lower(),
        "signal 3 mentions final check",
    )
    assert_true(
        "immediately" not in signal3.lower(),
        "signal 3 no bare immediate click_save after pending empty",
    )


def test_session_runner_uses_contract_assembly() -> None:
    src = (ROOT / "scripts/session_runner.py").read_text(encoding="utf-8")
    assert_true("build_agent_system_message" in src, "session_runner imports assembler")
    assert_true("get_phase_intent" in src, "session_runner reads phase intent")
    agent_block = src.split("agent = Agent(", 1)[1][:500]
    assert_true(
        "OVERRIDE_SYSTEM_MESSAGE" not in agent_block,
        "Agent uses contract assembly",
    )


def main() -> int:
    test_build_agent_system_message_assembles_by_mode()
    test_navigate_shorter_than_full()
    test_no_special_prompt_references()
    test_introduce_pick_includes_full_form()
    test_agent_prompt_shim_is_full_assembly()
    test_special_prompt_deleted()
    test_planner_synced_with_final_check()
    test_session_runner_uses_contract_assembly()
    print("characterize-agent-prompt-packs: OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
