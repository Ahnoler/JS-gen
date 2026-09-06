#!/usr/bin/env python3
"""Characterization: phase runtime hardening (section scope, empty buffer, empty-act)."""
from __future__ import annotations
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.controller.actions.section_scope import (  # noqa: E402
    remember_phase_section,
    clear_phase_section,
    resolve_phase_section,
)
from scripts.controller.actions.phase.reviewer import resolve_phase_max_steps  # noqa: E402


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
    from scripts.controller.actions._phase_intent import clear_phase_intent

    store = {"_phase_section": "系统评级结论", "_empty_act_streak": 2}
    clear_phase_intent(store)
    assert_true("_phase_section" not in store, "clear_phase_intent drops section")
    assert_true("_empty_act_streak" not in store, "clear_phase_intent drops empty streak")


def test_form_wires_remember() -> None:
    form = (
        (ROOT / "scripts/controller/actions/_form.py").read_text(encoding="utf-8")
        + (ROOT / "scripts/controller/actions/form_save.py").read_text(encoding="utf-8")
        + (ROOT / "scripts/controller/actions/form_scan_actions.py").read_text(encoding="utf-8")
        + (ROOT / "scripts/controller/actions/form_scan_utils.py").read_text(encoding="utf-8")
    )
    assert_true("remember_phase_section" in form, "form remembers section")


def test_submit_ready_hint_uses_resolve_phase_section() -> None:
    form = (
        (ROOT / "scripts/controller/actions/_form.py").read_text(encoding="utf-8")
        + (ROOT / "scripts/controller/actions/form_scan_utils.py").read_text(encoding="utf-8")
        + (ROOT / "scripts/controller/actions/task_completion.py").read_text(encoding="utf-8")
    )
    hint = form.find("def _submit_ready_hint")
    assert_true(hint >= 0, "_submit_ready_hint present")
    body = form[hint : hint + 2500]
    assert_true("resolve_phase_section" in body, "_submit_ready_hint uses resolve_phase_section")


def test_click_save_section_order_in_source() -> None:
    # form_save 在前：确保 find("async def click_save") 命中实现体而非 _form.py 薄委托
    form = (
        (ROOT / "scripts/controller/actions/form_save.py").read_text(encoding="utf-8")
        + (ROOT / "scripts/controller/actions/_form.py").read_text(encoding="utf-8")
    )
    cs = form.find("async def click_save")
    assert_true(cs >= 0, "click_save present")
    body = form[cs : cs + 5000]
    assert_true("same_label_section_keys" in body, "multi-section gate")
    assert_true("unique_button_section" in body, "unique path kept")
    multi_pos = body.find("same_label_section_keys")
    mem_pos = body.find('get("_phase_section")')
    uniq_pos = body.find("unique_button_section")
    assert_true(multi_pos < mem_pos, "multi check before sticky")
    assert_true(mem_pos < uniq_pos or uniq_pos > multi_pos, "unique still after gate")


def test_scoped_pending_gate_ignores_other_section() -> None:
    from scripts.models.task import TaskItem, TaskList
    from scripts.controller.actions._phase_intent import apply_phase_contract, check_pending_write_gate

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
    # Emission helpers moved to scripts/agent/recorder_emitters.py (recorder.py
    # keeps build_recording_hooks and calls them).
    rec = (ROOT / "scripts/agent/recorder_emitters.py").read_text(encoding="utf-8")
    assert_true("resolve_phase_section" in rec, "recorder uses resolve_phase_section")
    assert_true("is_empty_effective_actions" in rec, "recorder uses is_empty_effective_actions")
    assert_true("empty_act_prescription_message" in rec, "recorder uses empty_act_prescription_message")
    assert_true("_empty_act_streak" in rec, "recorder tracks _empty_act_streak")
    assert_true("_phase_max_steps" in rec, "recorder reads _phase_max_steps for last_step")
    assert_true(
        "from langchain_core.messages import HumanMessage" in rec,
        "empty-act emitter imports HumanMessage (NameError regression)",
    )
    fn = rec.find("def _emit_empty_act_cue")
    assert_true(fn >= 0, "_emit_empty_act_cue present")
    body = rec[fn : fn + 2800]
    assert_true("except Exception" in body, "empty-act cue swallows failures")
    assert_true("empty-act cue skipped" in body, "empty-act failures stay on stderr")
    hook = (ROOT / "scripts/recorder.py").read_text(encoding="utf-8")
    call = hook.find("_emit_empty_act_cue(")
    assert_true(call >= 0, "recorder calls _emit_empty_act_cue")
    wrap = hook[max(0, call - 120) : call + 200]
    assert_true("try:" in wrap and "except Exception" in wrap, "call site wraps empty-act")


def test_empty_effective_and_prescription() -> None:
    from scripts.controller.actions.section_scope import (
        is_empty_effective_actions,
        empty_act_prescription_message,
    )

    assert_true(is_empty_effective_actions([], next_goal="Execute AgentOutput"), "empty list")
    assert_true(
        "done(" in empty_act_prescription_message({"_last_save_ok": True}, last_step=False, save_ok=True),
        "save_ok → done",
    )
    assert_true(
        "done(" in empty_act_prescription_message({}, last_step=True, save_ok=False),
        "last_step → done only (DoneAgentOutput)",
    )
    msg = empty_act_prescription_message(
        {"_phase_section": "系统评级结论", "_phase_intent": {"submit": {"required": True}}},
        last_step=False,
        save_ok=False,
    )
    assert_true("click_save" in msg and "系统评级结论" in msg, f"scoped save cue: {msg}")
    # Last step remains done-only even when submit.required (schema has no click_save).
    assert_true(
        "click_save" not in empty_act_prescription_message(
            {"_phase_intent": {"submit": {"required": True}}},
            last_step=True,
            save_ok=False,
        ),
        "no click_save on last step even if submit.required",
    )
    # Penultimate / introduce-recovery: urgency cue must prescribe click_save.
    from scripts.controller.actions.section_scope import final_save_urgency_message

    urg = final_save_urgency_message(
        {
            "_phase_intent": {"submit": {"required": True}, "mode": "create"},
            "_phase_section": "",
        }
    )
    assert_true(urg and "click_save" in urg, f"near-last urgency → click_save: {urg}")
    assert_true(
        final_save_urgency_message({"_last_save_ok": True, "_phase_intent": {"submit": {"required": True}}})
        is None,
        "no urgency after save ok",
    )
    non_submit_msg = empty_act_prescription_message(
        {
            "_phase_intent": {
                "mode": "modify",
                "submit": {"required": False},
                "success": {"kinds": []},
            },
        },
        last_step=False,
        save_ok=False,
    )
    assert_true(
        "done(" in non_submit_msg
        and "NEXT_ACTION: click_save" not in non_submit_msg,
        f"non-submit phase → done not click_save: {non_submit_msg}",
    )
    scoped_msg = empty_act_prescription_message(
        {
            "_phase_section": "系统评级结论",
            "_phase_intent": {"submit": {"required": True}},
        },
        last_step=False,
        save_ok=False,
    )
    assert_true(
        "click_save" in scoped_msg and ("region=" in scoped_msg or "section=" in scoped_msg),
        f"submit required + section → scoped click_save: {scoped_msg}",
    )


def test_empty_act_cue_never_raises() -> None:
    """Empty-act steering must not abort on_step_end / surface to FE."""
    from scripts.agent.recorder_emitters import _emit_empty_act_cue

    class _BoomMM:
        def _add_message_with_tokens(self, _msg):
            raise RuntimeError("simulated inject failure")

    class _State:
        n_steps = 3

    class _Agent:
        state = _State()
        _message_manager = _BoomMM()

    store = {}
    # Empty effective actions → would inject cue → inject boom → must swallow
    _emit_empty_act_cue(store, _Agent(), [], "Execute AgentOutput")
    assert_true(store.get("_empty_act_streak") == 1, "streak set before inject attempt")


def test_session_runner_sets_phase_max_steps() -> None:
    # Per-phase agent execution lives in scripts/agent/service.py.
    sr = (ROOT / "scripts/agent/service.py").read_text(encoding="utf-8")
    assert_true("_phase_max_steps" in sr, "session runner sets _phase_max_steps")


def test_empty_act_buffer_on_submit_required() -> None:
    assert_true(
        resolve_phase_max_steps(30, {
            'estimated_steps': 4,
            'submit': {'required': True},
        }) == 11,
        'submit.required adds +3 empty-act buffer after floor',
    )
    assert_true(
        resolve_phase_max_steps(30, {'effort': 'short', 'submit': {'required': False}}) == 5,
        'no submit → no empty buffer',
    )


def test_session_runner_logs_empty_buffer() -> None:
    sr = (ROOT / "scripts/agent/service.py").read_text(encoding="utf-8")
    assert_true("empty_buffer=" in sr, "session runner logs empty_buffer=")


def test_quality_fail_logging_in_session_runner() -> None:
    src = (ROOT / "scripts/agent/service.py").read_text(encoding="utf-8")
    assert_true("QUALITY FAIL" in src, "stderr marker present")
    # introduce_ok must not waive missing_success_token when kinds need toast_ok
    assert_true(
        "has_contract_success" in src or "missing_success_token" in src,
        "phase-end quality uses success token check",
    )
    gate = (ROOT / "scripts/controller/actions/phase/intent_gates.py").read_text(encoding="utf-8")
    # Source cue: waive introduce_ok only when confirm kinds are accepted
    assert_true(
        "confirm_click" in gate and "picker_closed" in gate,
        "introduce token kinds are defined",
    )


def test_create_submit_budget_includes_recovery_buffer() -> None:
    """create+submit needs headroom for validation → introduce → final save."""
    base = resolve_phase_max_steps(
        30,
        {"estimated_steps": 12, "effort": "long", "submit": {"required": True}, "mode": "other"},
    )
    create = resolve_phase_max_steps(
        30,
        {"estimated_steps": 12, "effort": "long", "submit": {"required": True}, "mode": "create"},
    )
    assert_true(create > base, f"create recovery buffer: base={base} create={create}")
    assert_true(create <= 30, "still capped by ceiling")


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
    test_submit_ready_hint_uses_resolve_phase_section()
    test_click_save_section_order_in_source()
    test_scoped_pending_gate_ignores_other_section()
    test_recorder_wires_resolve_phase_section()
    test_empty_effective_and_prescription()
    test_empty_act_cue_never_raises()
    test_session_runner_sets_phase_max_steps()
    test_empty_act_buffer_on_submit_required()
    test_session_runner_logs_empty_buffer()
    test_quality_fail_logging_in_session_runner()
    test_create_submit_budget_includes_recovery_buffer()
    test_resolve_infer_unique_and_longest()
    print("PASS characterize-phase-runtime")


if __name__ == "__main__":
    main()
