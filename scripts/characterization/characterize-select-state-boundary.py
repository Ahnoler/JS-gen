#!/usr/bin/env python3
from __future__ import annotations

import asyncio
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


def assert_true(cond: bool, msg: str) -> None:
    if not cond:
        raise AssertionError(msg)


def test_reset_js_contract() -> None:
    from scripts.controller.actions._js_snippets import JS_RESET_SELECT_UI

    js = JS_RESET_SELECT_UI
    assert_true("KeyboardEvent" in js and "Escape" in js, "non-business Escape reset")
    assert_true("bubbles: false" in js, "Escape must not bubble to dialog manager")
    assert_true("blur()" in js, "trigger blur")
    assert_true("mousedown" in js and "mouseup" in js, "Element UI clickoutside events")
    assert_true("document.body.click()" not in js, "must not issue business click")
    assert_true("window.__last_select_trigger = null" in js, "stale trigger cleared")
    assert_true("await sleep" in js, "condition polling")


def test_python_reset_wrapper() -> None:
    from scripts.controller.actions._helpers import reset_select_ui
    from scripts.controller.actions._js_snippets import JS_RESET_SELECT_UI

    class FakePage:
        async def evaluate(self, js):
            assert js == JS_RESET_SELECT_UI
            return {"before": 1, "after": 0, "closed": True}

    result = asyncio.run(reset_select_ui(FakePage()))
    assert_true(result == {"before": 1, "after": 0, "closed": True}, "wrapper result")


def test_reset_retries_once_when_first_closed_false() -> None:
    from scripts.controller.actions._helpers import reset_select_ui
    from scripts.controller.actions._js_snippets import JS_RESET_SELECT_UI

    calls: list[str] = []

    class FakePage:
        async def evaluate(self, js):
            calls.append(js)
            assert js == JS_RESET_SELECT_UI
            if len(calls) == 1:
                return {"before": 2, "after": 1, "closed": False}
            return {"before": 1, "after": 0, "closed": True}

    result = asyncio.run(reset_select_ui(FakePage()))
    assert_true(len(calls) == 2, "reset retries once on closed=False")
    assert_true(result == {"before": 1, "after": 0, "closed": True}, "second reset result")


def test_reset_persistent_false_after_both_attempts() -> None:
    from scripts.controller.actions._helpers import reset_select_ui
    from scripts.controller.actions._js_snippets import JS_RESET_SELECT_UI

    calls: list[str] = []

    class FakePage:
        async def evaluate(self, js):
            calls.append(js)
            assert js == JS_RESET_SELECT_UI
            return {"before": 2, "after": 1, "closed": False}

    result = asyncio.run(reset_select_ui(FakePage()))
    assert_true(len(calls) == 2, "persistent false still uses two evaluations")
    assert_true(result.get("closed") is False, "persistent false returns closed=False")


def test_direct_persistent_reset_gates_before_resolve() -> None:
    form = (
        (ROOT / "scripts/controller/actions/form_action_engines.py").read_text(encoding="utf-8")
        + "\n"
        + (ROOT / "scripts/controller/actions/_form.py").read_text(encoding="utf-8")
    )
    direct = form.split("async def select_option(", 1)[1].split(
        "async def click_adjacent_button", 1
    )[0]

    reset_diag_pos = direct.find("reset_diag = await reset_select_ui")
    gate_pos = direct.find("if not reset_diag.get('closed', False):")
    resolve_pos = direct.find("_resolve_control")
    capture_pos = direct.find("_capture_element")
    already_pos = direct.find("JS_SELECT_VALUE_BY_XPATH")
    trigger_pos = direct.find("JS_SELECT_TRIGGER_BY_XPATH")

    assert_true(reset_diag_pos != -1, "direct reset_diag assignment present")
    assert_true(gate_pos != -1 and gate_pos > reset_diag_pos, "direct closed gate present")
    assert_true(
        gate_pos < resolve_pos,
        "direct persistent gate before _resolve_control",
    )
    assert_true(
        "no-items" in direct[gate_pos:resolve_pos],
        "direct persistent gate returns no-items",
    )
    assert_true(
        gate_pos < capture_pos,
        "direct persistent gate before _capture_element",
    )
    assert_true(
        gate_pos < already_pos,
        "direct persistent gate before already-read",
    )
    assert_true(
        gate_pos < trigger_pos,
        "direct persistent gate before trigger",
    )
    assert_true(
        "xpath_for_log" in direct.split("async def _final_select_failure", 1)[1].split(
            "reset_diag = await reset_select_ui", 1
        )[0],
        "direct _final_select_failure does not close over xp",
    )


def test_replay_persistent_reset_gates_before_pick_validation() -> None:
    replay = (
        (ROOT / "scripts/controller/actions/_replay.py").read_text(encoding="utf-8")
        + "\n"
        + (ROOT / "scripts/controller/actions/replay_form_action.py").read_text(
            encoding="utf-8"
        )
    )
    replay_select = replay.split("if action_name == 'select_option':", 1)[1].split(
        "return f'unknown-form-action", 1
    )[0]

    pick_pos = replay_select.find("pick = str(value")
    branch_reset_pos = replay_select.find("branch_reset_diag = await reset_select_ui")
    gate_pos = replay_select.find("if not branch_reset_diag.get('closed', False):")
    missing_pos = replay_select.find("if not pick:")
    bad_sentinel_pos = replay_select.find("if pick.lower() in _SENT")
    if bad_sentinel_pos == -1:
        bad_sentinel_pos = replay_select.find("if pick.lower() in ('first'")
    final_fail_pos = replay_select.find("_replay_select_final_failure('no-items')")

    assert_true(pick_pos != -1, "replay pick assigned before helpers")
    assert_true(branch_reset_pos != -1, "replay branch reset retained")
    assert_true(gate_pos != -1 and gate_pos > branch_reset_pos, "replay branch gate present")
    assert_true(
        pick_pos < branch_reset_pos,
        "replay pick before branch reset for helper logging",
    )
    assert_true(
        gate_pos < missing_pos,
        "replay persistent gate before missing-option check",
    )
    assert_true(
        gate_pos < bad_sentinel_pos,
        "replay persistent gate before bad-sentinel check",
    )
    assert_true(
        final_fail_pos != -1 and final_fail_pos < missing_pos,
        "replay persistent gate returns no-items via final-failure before validation",
    )
    assert_true(
        "option={pick!r}" in replay_select.split("async def _replay_select_final_failure", 1)[1].split(
            "branch_reset_diag = await reset_select_ui", 1
        )[0],
        "replay final-failure helper defined after pick",
    )


def test_replay_branch_reset_before_pick_validation() -> None:
    replay = (
        (ROOT / "scripts/controller/actions/_replay.py").read_text(encoding="utf-8")
        + "\n"
        + (ROOT / "scripts/controller/actions/replay_form_action.py").read_text(
            encoding="utf-8"
        )
    )
    replay_select = replay.split("if action_name == 'select_option':", 1)[1].split(
        "return f'unknown-form-action", 1
    )[0]

    branch_reset_pos = replay_select.find("branch_reset_diag = await reset_select_ui")
    if branch_reset_pos == -1:
        branch_reset_pos = replay_select.find("reset_select_ui")
    pick_pos = replay_select.find("pick = str(value")
    missing_pos = replay_select.find("if not pick:")
    bad_sentinel_pos = replay_select.find("if pick.lower() in _SENT")
    if bad_sentinel_pos == -1:
        bad_sentinel_pos = replay_select.find("if pick.lower() in ('first'")

    assert_true(branch_reset_pos != -1, "replay branch reset present")
    assert_true(pick_pos != -1, "replay pick assignment present")
    assert_true(
        pick_pos < branch_reset_pos,
        "replay pick before branch reset for helper logging",
    )
    gate_pos = replay_select.find("if not branch_reset_diag.get('closed', False):")
    assert_true(
        gate_pos != -1 and gate_pos < missing_pos,
        "replay branch reset gate before missing-option check",
    )
    assert_true(
        gate_pos < bad_sentinel_pos,
        "replay branch reset gate before bad-sentinel check",
    )

    xpath_fn = replay_select.split("async def _select_by_xpath", 1)[1].split(
        "async def _select_by_label", 1
    )[0]
    already_pos = xpath_fn.find("JS_SELECT_VALUE_BY_XPATH")
    inner_reset_pos = xpath_fn.find("reset_select_ui")
    assert_true(
        inner_reset_pos != -1
        and already_pos != -1
        and inner_reset_pos < already_pos,
        "replay xpath path reset before already-read",
    )


def test_direct_reset_before_resolve_and_gates_trigger() -> None:
    form = (
        (ROOT / "scripts/controller/actions/form_action_engines.py").read_text(encoding="utf-8")
        + "\n"
        + (ROOT / "scripts/controller/actions/_form.py").read_text(encoding="utf-8")
    )
    direct = form.split("async def select_option(", 1)[1].split(
        "async def click_adjacent_button", 1
    )[0]

    resolve_pos = direct.find("_resolve_control")
    reset_pos = direct.find("reset_select_ui")
    gate_pos = direct.find("if not reset_diag.get('closed', False):")
    trigger_pos = direct.find("JS_SELECT_TRIGGER_BY_XPATH")

    assert_true(reset_pos != -1 and resolve_pos != -1, "direct reset and resolver present")
    assert_true(
        reset_pos < resolve_pos,
        "direct preflight reset before _resolve_control",
    )
    assert_true(
        gate_pos != -1 and gate_pos < resolve_pos,
        "direct closed gate before _resolve_control",
    )

    gate_pos = direct.find("closed", reset_pos)
    assert_true(
        gate_pos != -1 and gate_pos < trigger_pos,
        "direct reset-failure gate before trigger",
    )
    assert_true(
        "no-items" in direct[reset_pos:trigger_pos],
        "direct reset gate returns no-items vocabulary",
    )


def test_autofill_and_replay_gate_trigger_on_reset_failure() -> None:
    form = (
        (ROOT / "scripts/controller/actions/form_action_engines.py").read_text(encoding="utf-8")
        + "\n"
        + (ROOT / "scripts/controller/actions/_form.py").read_text(encoding="utf-8")
    )
    autofill_src = (
        (ROOT / "scripts/controller/actions/form_autofill.py").read_text(encoding="utf-8")
        + "\n"
        + (ROOT / "scripts/controller/actions/autofill_round.py").read_text(encoding="utf-8")
    )
    replay = (
        (ROOT / "scripts/controller/actions/_replay.py").read_text(encoding="utf-8")
        + "\n"
        + (ROOT / "scripts/controller/actions/replay_form_action.py").read_text(
            encoding="utf-8"
        )
    )

    autofill = autofill_src.split("async def _select_by_xpath", 1)[1].split("KIND_ORDER", 1)[0]
    replay_select = replay.split("if action_name == 'select_option':", 1)[1].split(
        "return f'unknown-form-action", 1
    )[0]

    for name, block, trigger_needle in (
        ("autofill xpath", autofill, "JS_SELECT_TRIGGER_BY_XPATH"),
        (
            "autofill label",
            autofill_src.split("async def _select_by_label_autofill", 1)[1].split(
                "KIND_ORDER", 1
            )[0],
            "JS_FIND_LABELED_SELECT",
        ),
        (
            "replay xpath retrigger",
            replay_select.split("async def _select_by_xpath", 1)[1].split("async def _select_by_label", 1)[0],
            "JS_SELECT_TRIGGER_BY_XPATH",
        ),
        (
            "replay label retrigger",
            replay_select.split("async def _select_by_label", 1)[1].split("xp, src = _resolve_replay_xpath", 1)[0],
            "JS_FIND_LABELED_SELECT",
        ),
    ):
        trigger_pos = block.rfind(trigger_needle)
        assert_true(trigger_pos != -1, f"{name} trigger present")
        gate_chunk = block[:trigger_pos]
        assert_true(
            "closed" in gate_chunk and "no-items" in gate_chunk,
            f"{name} gates trigger when reset not closed",
        )


def test_recording_and_replay_use_reset_boundary() -> None:
    form = (
        (ROOT / "scripts/controller/actions/form_action_engines.py").read_text(encoding="utf-8")
        + "\n"
        + (ROOT / "scripts/controller/actions/_form.py").read_text(encoding="utf-8")
    )
    autofill_src = (
        (ROOT / "scripts/controller/actions/form_autofill.py").read_text(encoding="utf-8")
        + "\n"
        + (ROOT / "scripts/controller/actions/autofill_round.py").read_text(encoding="utf-8")
    )
    replay = (
        (ROOT / "scripts/controller/actions/_replay.py").read_text(encoding="utf-8")
        + "\n"
        + (ROOT / "scripts/controller/actions/replay_form_action.py").read_text(
            encoding="utf-8"
        )
    )

    direct = form.split("async def select_option(", 1)[1].split(
        "async def click_adjacent_button", 1
    )[0]
    autofill = autofill_src.split("async def _select_by_xpath", 1)[1].split(
        "KIND_ORDER", 1
    )[0]
    replay_select = replay.split("if action_name == 'select_option':", 1)[1].split(
        "return f'unknown-form-action", 1
    )[0]

    assert_true("reset_select_ui" in direct, "direct recording reset")
    assert_true("reset_select_ui" in autofill, "autofill reset")
    assert_true("reset_select_ui" in replay_select, "replay reset")
    assert_true("_JS_CLOSE_SELECT_POPPERS" not in replay_select, "remove CSS-only replay close")
    assert_true("dd.style.display = 'none'" not in direct, "remove CSS-only recording close")

    direct_reset_pos = direct.find("reset_select_ui")
    resolve_pos = direct.find("_resolve_control")
    direct_already_pos = direct.find("JS_SELECT_VALUE_BY_XPATH")
    assert_true(
        direct_reset_pos != -1
        and resolve_pos != -1
        and direct_reset_pos < resolve_pos,
        "direct preflight reset before resolver",
    )
    assert_true(
        direct_reset_pos != -1
        and direct_already_pos != -1
        and direct_reset_pos < direct_already_pos,
        "direct preflight reset before already-read",
    )

    trigger_fail = autofill.split("if not str(trigger).startswith('ok')", 1)[1].split(
        "await page.wait_for_timeout(350)", 1
    )[0]
    assert_true("reset_select_ui" in trigger_fail, "autofill trigger failure resets")
    assert_true(
        trigger_fail.find("reset_select_ui") < trigger_fail.find("return trigger"),
        "autofill trigger failure reset before return",
    )

    assert_true("_select_by_label_autofill" in autofill, "label autofill wrapper")

    assert_true("_replay_select_final_failure" in replay_select, "replay final failure helper")
    assert_true(
        "return await _replay_select_final_failure(f'option-mismatch" in replay_select,
        "replay option-mismatch resets",
    )
    assert_true(
        "return await _replay_select_final_failure(classified)" in replay_select,
        "replay false_ok resets",
    )


def test_prompt_serializes_select_and_forbids_invented_xpath() -> None:
    prompt = (ROOT / "scripts/prompts/agent-tools-form.md").read_text(encoding="utf-8")
    assert_true("每步最多 1 个 select_option" in prompt, "one select per step")
    assert_true(
        "禁止自造任何 `xpath_smart`" in prompt,
        "no invented xpath_smart (incl. dialog/drawer)",
    )
    assert_true("禁止用 `click_element_by_index` 点 el-option" in prompt, "no index option")
    assert_true(
        "重新 `scan_visible_fields` / `get_pending_tasks`" in prompt,
        "rescan after no-items or xpath-not-found",
    )
    assert_true(
        "最多再调用一次 `select_option`" in prompt,
        "one retry after rescan",
    )
    assert_true(
        "省略 hint 让工具自行解析" in prompt,
        "xpath-not-found omit hint fallback",
    )
    assert_true(
        "下拉列表为空（无级联数据）。**立即跳过。**" not in prompt,
        "no immediate skip on first no-items",
    )


def test_direct_select_wires_runtime_fallback_only() -> None:
    form = (
        (ROOT / "scripts/controller/actions/form_action_engines.py").read_text(encoding="utf-8")
        + "\n"
        + (ROOT / "scripts/controller/actions/_form.py").read_text(encoding="utf-8")
    )
    utils = (ROOT / "scripts/controller/actions/form_scan_utils.py").read_text(
        encoding="utf-8"
    )
    direct = form.split("async def select_option(", 1)[1].split(
        "async def click_adjacent_button", 1
    )[0]
    assert_true("resolve_select_fallback" in direct, "direct select fallback")
    assert_true("trigger_result == 'xpath-not-found'" in direct, "runtime-miss gate")
    assert_true("def resolve_select_fallback" in utils, "pure fallback helper")


def main() -> int:
    test_reset_js_contract()
    test_python_reset_wrapper()
    test_reset_retries_once_when_first_closed_false()
    test_reset_persistent_false_after_both_attempts()
    test_replay_persistent_reset_gates_before_pick_validation()
    test_direct_persistent_reset_gates_before_resolve()
    test_replay_branch_reset_before_pick_validation()
    test_direct_reset_before_resolve_and_gates_trigger()
    test_autofill_and_replay_gate_trigger_on_reset_failure()
    test_recording_and_replay_use_reset_boundary()
    test_prompt_serializes_select_and_forbids_invented_xpath()
    test_direct_select_wires_runtime_fallback_only()
    print("characterize-select-state-boundary: OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
