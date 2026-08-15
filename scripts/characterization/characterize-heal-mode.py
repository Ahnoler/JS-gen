#!/usr/bin/env python3
"""Characterize Python heal contract parsing + heal prompt pack assembly."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.agent_utils import build_agent_system_message  # noqa: E402
from scripts.controller.actions.phase.prompts import (  # noqa: E402
    apply_heal_mode,
    detect_heal_mode,
    is_heal_mode,
)

HEAL_CONTRACT = {
    "mode": "heal",
    "scope": "step",
    "strategy": "visibility_recovery",
    "reason": {
        "category": "not_visible",
        "confidence": 0.75,
        "evidence": ["error=xpath-not-found", "action=fill_form_field"],
        "suggestedAction": "heal",
    },
    "target": {
        "action": "fill_form_field",
        "label": "客户名称",
        "xpath_smart": "//div[contains(@class,'el-form-item')]//input",
        "option_text": "",
    },
    "runtime": {"retry_count": 1, "max_steps": 12},
}


def assert_true(cond: bool, msg: str) -> None:
    if not cond:
        raise AssertionError(msg)


def test_detect_contract_step_scope() -> None:
    instruction = {"heal_contract": HEAL_CONTRACT}
    assert_true(detect_heal_mode(instruction, "") == "step", "step scope from contract")
    assert_true(
        instruction.get("_parsed_heal_contract") is HEAL_CONTRACT,
        "parsed contract cached on instruction",
    )


def test_detect_contract_form_structure_scope() -> None:
    instruction = {"heal_contract": {**HEAL_CONTRACT, "scope": "form_structure"}}
    assert_true(
        detect_heal_mode(instruction, "") == "form_structure",
        "form_structure scope from contract",
    )


def test_detect_contract_beats_legacy_fields() -> None:
    instruction = {
        "heal_contract": {**HEAL_CONTRACT, "scope": "form_structure"},
        "heal_type": "step",
        "healType": "step",
    }
    assert_true(detect_heal_mode(instruction, "") == "form_structure", "contract wins")


def test_detect_legacy_fields_still_work() -> None:
    assert_true(detect_heal_mode({"heal_type": "form_structure"}, "") == "form_structure", "heal_type form_structure")
    assert_true(detect_heal_mode({"healType": "step"}, "") == "step", "healType step")
    assert_true(detect_heal_mode({"heal_type": "structure"}, "") == "form_structure", "structure alias")


def test_detect_text_fallback_still_works() -> None:
    assert_true(
        detect_heal_mode(None, "当前为步骤回放失败后的单步自愈阶段") == "step",
        "Type A text fallback",
    )
    assert_true(
        detect_heal_mode(None, "当前为【表单结构变化自愈】阶段（healType=form_structure）")
        == "form_structure",
        "Type B text fallback",
    )


def test_detect_invalid_contract_clears_cache_and_falls_back() -> None:
    instruction = {"heal_contract": {"mode": "create"}, "heal_type": "step"}
    assert_true(detect_heal_mode(instruction, "") == "step", "non-heal contract falls back")
    assert_true("_parsed_heal_contract" not in instruction, "stale parsed contract cleared")


def test_apply_heal_mode_writes_and_clears_contract() -> None:
    store: dict = {}
    assert_true(apply_heal_mode(store, "step", HEAL_CONTRACT) == "step", "apply returns mode")
    assert_true(store.get("_heal_mode") == "step", "_heal_mode legacy string kept")
    assert_true(store.get("_heal_contract") is HEAL_CONTRACT, "_heal_contract written")
    assert_true(is_heal_mode(store), "is_heal_mode true")
    apply_heal_mode(store, None)
    assert_true("_heal_mode" not in store, "_heal_mode cleared")
    assert_true("_heal_contract" not in store, "_heal_contract cleared")
    assert_true(not is_heal_mode(store), "is_heal_mode false")


def test_apply_heal_mode_without_contract_clears_stale() -> None:
    store: dict = {}
    apply_heal_mode(store, "step", HEAL_CONTRACT)
    apply_heal_mode(store, "step")
    assert_true(store.get("_heal_mode") == "step", "legacy mode still set")
    assert_true("_heal_contract" not in store, "stale contract cleared on legacy path")


def test_heal_prompt_pack_selection() -> None:
    msg = build_agent_system_message({"mode": "heal", "heal": HEAL_CONTRACT})
    assert_true("恢复模式（Heal）规则" in msg, "heal pack included")
    assert_true("你当前处于【恢复模式】" in msg, "heal mode marker included")
    assert_true("表单填写助手（CRITICAL" not in msg, "form pack excluded")
    assert_true("点击 el-table 行中的操作按钮" not in msg, "table pack excluded")
    assert_true("仅用于真正的 TsscMultiTree" not in msg, "tree pack excluded")
    assert_true(len(msg) < len(build_agent_system_message(None)), "heal pack is narrower than full")


def test_heal_prompt_pack_matches_file() -> None:
    pack = (ROOT / "scripts/prompts/agent-tools-heal.md").read_text(encoding="utf-8")
    assert_true("visibility_recovery" in pack and "structure_repair" in pack, "strategies documented")
    assert_true("sync_tasks_from_errors" in pack, "auto-fill ban documented")
    assert_true("done(success=true)" in pack, "done contract documented")


def test_service_uses_heal_contract_for_prompt() -> None:
    src = (ROOT / "scripts/agent/service.py").read_text(encoding="utf-8")
    assert_true("'_heal_contract'" in src, "service reads _heal_contract")
    assert_true(
        "contract = {'mode': 'heal', 'heal': case_data_ref['_heal_contract']}" in src
        or "contract = {'mode': 'heal', 'heal': case_data_ref['_heal_contract']}" in src.replace('"', "'"),
        "service wraps heal contract for prompt assembly",
    )


def main() -> int:
    test_detect_contract_step_scope()
    test_detect_contract_form_structure_scope()
    test_detect_contract_beats_legacy_fields()
    test_detect_legacy_fields_still_work()
    test_detect_text_fallback_still_works()
    test_detect_invalid_contract_clears_cache_and_falls_back()
    test_apply_heal_mode_writes_and_clears_contract()
    test_apply_heal_mode_without_contract_clears_stale()
    test_heal_prompt_pack_selection()
    test_heal_prompt_pack_matches_file()
    test_service_uses_heal_contract_for_prompt()
    print("characterize-heal-mode: OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
