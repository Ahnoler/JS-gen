#!/usr/bin/env python3
"""Characterization for per-phase agent prompt pack assembly."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.agent_utils import build_agent_system_message  # noqa: E402


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


def main() -> int:
    test_build_agent_system_message_assembles_by_mode()
    test_navigate_shorter_than_full()
    test_no_special_prompt_references()
    test_introduce_pick_includes_full_form()
    print("characterize-agent-prompt-packs: OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
