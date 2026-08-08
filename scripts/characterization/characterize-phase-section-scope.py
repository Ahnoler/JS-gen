#!/usr/bin/env python3
"""Characterize phase↔section scope (LLM-declared section for gate/pending)."""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.agent_utils import build_agent_system_message  # noqa: E402
from scripts.actions._section_scope import (  # noqa: E402
    section_matches,
    pending_by_section,
    filter_pending_labels,
    requires_section_declaration,
    unique_button_section,
)
from scripts.controller.actions._form import _submit_ready_hint  # noqa: E402
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
    from scripts.controller.actions._phase_intent import check_pending_write_gate

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


def test_err_section_required_trigger_condition() -> None:
    """Behavioral gate: multi-section pending + empty section → err-section-required."""
    tl = TaskList(
        pending=[
            TaskItem(label="借款企业", kind="radio", section_title="征信信息", section_id="征信信息"),
            TaskItem(label="综合评价", kind="input", section_title="客户综合评价", section_id="客户综合评价"),
        ]
    )
    by = pending_by_section(tl)
    assert_true(len(by) >= 2, f"multi-section pending, got {by}")
    assert_true(requires_section_declaration(tl), "requires_section_declaration when ≥2 sections")
    all_labels = filter_pending_labels(tl, "")
    assert_true(
        "借款企业" in all_labels and "综合评价" in all_labels,
        f"unscoped filter sees both sections, got {all_labels}",
    )
    scoped = filter_pending_labels(tl, "客户综合评价")
    assert_true(
        scoped == ["综合评价"] and "借款企业" not in scoped,
        f"scoped filter excludes other section, got {scoped}",
    )
    assert_true(
        not requires_section_declaration(
            TaskList(
                pending=[
                    TaskItem(label="借款企业", kind="radio", section_title="征信信息", section_id="征信信息"),
                ]
            )
        ),
        "single-section pending does not require section declaration",
    )


def test_form_has_err_section_required() -> None:
    form = (
        (ROOT / "scripts/controller/actions/_form.py").read_text(encoding="utf-8")
        + (ROOT / "scripts/controller/actions/form_scan_utils.py").read_text(encoding="utf-8")
    )
    assert_true("err-section-required" in form, "click_save surfaces err-section-required")
    assert_true(
        "requires_section_declaration" in form,
        "click_save uses requires_section_declaration helper",
    )


def test_get_pending_signature() -> None:
    form = (
        (ROOT / "scripts/controller/actions/_form.py").read_text(encoding="utf-8")
        + (ROOT / "scripts/controller/actions/form_scan_utils.py").read_text(encoding="utf-8")
    )
    chunk = form.split("async def get_pending_tasks", 1)[1][:600]
    assert_true("section" in chunk, "get_pending_tasks accepts section")
    assert_true("pending_by_section" in form, "includes pending_by_section")


def test_submit_hint_section_scoped() -> None:
    from scripts.controller.actions._form import _submit_ready_hint

    tl = TaskList(
        pending=[
            TaskItem(label="借款企业", kind="radio", section_title="征信信息", section_id="征信信息"),
        ]
    )
    store = {"task_list": tl.to_store()}
    assert_true(_submit_ready_hint(store) == "", "global still has pending")
    cue = _submit_ready_hint(store, section="系统评级结论")
    assert_true("click_save" in cue, "empty section-local pending gets save cue")
    assert_true("section=" in cue or "section='" in cue, "scoped cue includes section=")


def test_run_form_assistant_section_signature() -> None:
    form = (
        (ROOT / "scripts/controller/actions/_form.py").read_text(encoding="utf-8")
        + (ROOT / "scripts/controller/actions/form_scan_utils.py").read_text(encoding="utf-8")
    )
    chunk = form.split("async def run_form_assistant", 1)[1][:800]
    assert_true("section" in chunk, "run_form_assistant accepts section")
    assert_true(
        "_assistant_section_filter" in form,
        "autofill path uses _assistant_section_filter",
    )


def test_run_form_assistant_autofill_section_filter() -> None:
    form = (
        (ROOT / "scripts/controller/actions/_form.py").read_text(encoding="utf-8")
        + (ROOT / "scripts/controller/actions/form_scan_utils.py").read_text(encoding="utf-8")
    )
    assert_true(
        "section_matches" in form.split("async def _auto_fill_pending", 1)[1]
        or "section_matches" in form.split("async def _execute_round", 1)[1],
        "autofill path filters by section_matches",
    )


def test_prompt_section_scope() -> None:
    prompt = build_agent_system_message(None)
    assert_true("err-section-required" in prompt, "prompt documents err-section-required")
    assert_true("section=" in prompt or "section='" in prompt, "prompt steers section=")
    assert_true(
        "唯一" in prompt,
        "prompt mentions unique-save auto section behavior",
    )


def test_unique_button_section() -> None:
    assert_true(
        unique_button_section(
            [{"label": "保存", "section_id": "系统评级结论", "section_title": "系统评级结论"}],
            "保存",
        )
        == "系统评级结论",
        "single save → that section",
    )
    assert_true(
        unique_button_section(
            [
                {"label": "保存", "section_id": "系统评级结论", "section_title": "系统评级结论"},
                {"label": "保存", "section_id": "客户综合评价", "section_title": "客户综合评价"},
            ],
            "保存",
        )
        is None,
        "two saves → no auto section",
    )
    assert_true(
        unique_button_section(
            [{"label": "暂存", "section_id": "评级等级测算", "section_title": "评级等级测算"}],
            "保存",
        )
        is None,
        "no matching save button",
    )


def test_submit_hint_includes_unique_save_section() -> None:
    tl = TaskList(pending=[], done=[TaskItem(label="理由说明", kind="input")])
    store = {
        "task_list": tl.to_store(),
        "_scan_buttons": [
            {"label": "保存", "section_id": "系统评级结论", "section_title": "系统评级结论"},
        ],
    }
    cue = _submit_ready_hint(store)
    assert_true("section=" in cue or "section='" in cue, f"hint must include section: {cue}")
    assert_true("系统评级结论" in cue, f"hint must name unique save section: {cue}")


def test_click_save_auto_section_from_unique_button() -> None:
    form = (
        (ROOT / "scripts/controller/actions/_form.py").read_text(encoding="utf-8")
        + (ROOT / "scripts/controller/actions/form_scan_utils.py").read_text(encoding="utf-8")
    )
    assert_true("unique_button_section" in form, "click_save uses unique_button_section")
    assert_true("auto section" in form or "auto_section" in form or "[click_save] auto" in form,
                "logs or marks auto section bind")
    # Regression: auto-bound `sec` must reach JS — not the empty param `section`
    assert_true(
        "JS_CLICK_SAVE_BUTTON, [button_text or '保存', sec]" in form
        or 'JS_CLICK_SAVE_BUTTON, [button_text or "保存", sec]' in form,
        "JS_CLICK_SAVE_BUTTON must receive auto-bound sec",
    )
    assert_true(
        "JS_CLICK_SAVE_BUTTON, [button_text or '保存', section or '']" not in form,
        "must not pass empty section param after auto-bind",
    )


def test_click_save_no_feedback_counts_as_success() -> None:
    """Silent SUT save (no toast) must set _last_save_ok and tell agent to done."""
    form = (
        (ROOT / "scripts/controller/actions/_form.py").read_text(encoding="utf-8")
        + (ROOT / "scripts/controller/actions/form_scan_utils.py").read_text(encoding="utf-8")
    )
    idx = form.find("SUCCESS via no-feedback")
    assert_true(idx > 0, "logs silent-save success")
    # Bindings are set just above the log line
    chunk = form[max(0, idx - 400) : idx + 500]
    assert_true("_last_save_ok" in chunk, "sets _last_save_ok on no-feedback")
    assert_true("record_success_token" in chunk, "records success token on no-feedback")
    assert_true("Call done(success=true)" in chunk, "instructs done after silent save")
    tools = (ROOT / "scripts/prompts/agent-tools-form.md").read_text(encoding="utf-8")
    assert_true("ok-save-no-feedback" in tools and "静默" in tools,
                "agent form tools treat no-feedback as success")


def test_force_refill_preserves_section_on_valued_fields() -> None:
    """force_refill must keep scan section_* — else valued fields fake __root__ and
    block click_save with err-section-required even when the phase only needs one block.
    """
    fields = [
        {
            "label": "此次评级建议等级",
            "kind": "select",
            "currentValue": "",
            "section_id": "系统评级结论",
            "section_title": "系统评级结论",
            "xpath_smart": "//sel",
        },
        {
            "label": "资产负债率",
            "kind": "input",
            "currentValue": "35%",
            "section_id": "评级等级测算",
            "section_title": "评级等级测算",
            "xpath_smart": "//ratio",
        },
        {
            "label": "综合评价",
            "kind": "input",
            "currentValue": "已有评价",
            "section_id": "客户综合评价",
            "section_title": "客户综合评价",
            "xpath_smart": "//eval",
        },
    ]
    tl = TaskList.from_scan(fields, force_refill=True)
    by = pending_by_section(tl)
    assert_true("__root__" not in by, f"valued force_refill must not invent __root__: {by}")
    assert_true("评级等级测算" in by and "资产负债率" in by["评级等级测算"], f"got {by}")
    assert_true("客户综合评价" in by and "综合评价" in by["客户综合评价"], f"got {by}")
    ratio = next(i for i in tl.pending if i.label == "资产负债率")
    assert_true(ratio.section_title == "评级等级测算", f"section_title={ratio.section_title!r}")
    assert_true(ratio.section_id == "评级等级测算", f"section_id={ratio.section_id!r}")

    # After writing the phase block, scoped gate must ignore other sections
    item = next(i for i in tl.pending if i.label == "此次评级建议等级")
    tl.mark_done("此次评级建议等级", value="未评级", xpath_smart=item.xpath_smart)
    assert_true(filter_pending_labels(tl, "系统评级结论") == [], "scoped pending empty after fill")
    assert_true(requires_section_declaration(tl), "other sections still pending → need section=")


def main() -> int:
    test_section_matches()
    test_filter_pending_excludes_other_section()
    test_gate_scoped_ignores_credit()
    test_multi_section_map()
    test_err_section_required_trigger_condition()
    test_form_has_err_section_required()
    test_get_pending_signature()
    test_submit_hint_section_scoped()
    test_run_form_assistant_section_signature()
    test_run_form_assistant_autofill_section_filter()
    test_unique_button_section()
    test_submit_hint_includes_unique_save_section()
    test_click_save_auto_section_from_unique_button()
    test_click_save_no_feedback_counts_as_success()
    test_prompt_section_scope()
    test_force_refill_preserves_section_on_valued_fields()
    print("characterize-phase-section-scope: OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
