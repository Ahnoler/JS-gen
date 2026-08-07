#!/usr/bin/env python3
"""Characterize xpath-primary resolve gate + write hard-cut markers."""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.actions._form import ResolvedControl, _resolve_control  # noqa: E402
from scripts.models.task import TaskItem, TaskList  # noqa: E402


def assert_true(cond: bool, msg: str) -> None:
    if not cond:
        raise AssertionError(msg)


def test_resolve_hint_wins() -> None:
    store = {"task_list": TaskList().to_store(), "_scan_fields": []}
    r = _resolve_control(store, "任意", xpath_hint="//div[@id='x']//input")
    assert_true(r.error == "" and r.xpath_smart.endswith("input"), "hint wins")
    assert_true(isinstance(r, ResolvedControl), "ResolvedControl type")


def test_resolve_unique_label() -> None:
    tl = TaskList(
        pending=[
            TaskItem(label="手机号", kind="input", xpath_smart="//form//input[1]"),
        ]
    )
    store = {"task_list": tl.to_store(), "_scan_fields": []}
    r = _resolve_control(store, "手机号")
    assert_true(r.error == "" and r.xpath_smart == "//form//input[1]", "unique ok")
    assert_true(r.label == "手机号", "label preserved")


def test_resolve_not_found() -> None:
    store = {"task_list": TaskList().to_store(), "_scan_fields": []}
    r = _resolve_control(store, "不存在")
    assert_true(r.error == "xpath-not-found", "missing → xpath-not-found")


def test_resolve_ambiguous() -> None:
    tl = TaskList(
        pending=[
            TaskItem(label="评级", kind="select", xpath_smart="//div[@id='a']//div[contains(@class,'el-select')]"),
            TaskItem(label="评级", kind="select", xpath_smart="//div[@id='b']//div[contains(@class,'el-select')]"),
        ]
    )
    store = {"task_list": tl.to_store(), "_scan_fields": []}
    r = _resolve_control(store, "评级")
    assert_true(r.error == "ambiguous-label", "dup labels → ambiguous-label")


def test_resolve_duplicate_same_xpath() -> None:
    xp = "//div[@id='same']//input"
    tl = TaskList(
        pending=[
            TaskItem(label="备注", kind="input", xpath_smart=xp),
            TaskItem(label="备注", kind="input", xpath_smart=xp),
        ]
    )
    store = {"task_list": tl.to_store(), "_scan_fields": []}
    r = _resolve_control(store, "备注")
    assert_true(r.error == "" and r.xpath_smart == xp, "identical xpath not ambiguous")


def test_scan_display_label_markers() -> None:
    js = (ROOT / "scripts/actions/_js_snippets.py").read_text(encoding="utf-8")
    assert_true(
        "const displayLabel = label || placeholder || ''" in js
        or "displayLabel = label || placeholder" in js,
        "Source A synthesizes displayLabel from placeholder",
    )
    assert_true(
        "buildTableDisplayName" in js and "placeholder" in js,
        "table display name can use placeholder",
    )


def test_phase_a_hardcut_markers() -> None:
    form = (ROOT / "scripts/actions/_form.py").read_text(encoding="utf-8")
    assert_true(
        "ambiguous-label" in form and "xpath-not-found" in form,
        "write paths surface resolve errors",
    )
    assert_true("JS_FILL_BY_XPATH" in form, "xpath fill used")


def test_llm_actions_carry_xpath() -> None:
    src = (ROOT / "scripts/actions/_llm_values.py").read_text(encoding="utf-8")
    assert_true("xpath_smart" in src, "_llm_values attaches xpath_smart to actions")


def test_phase_b_action_signatures() -> None:
    form = (ROOT / "scripts/actions/_form.py").read_text(encoding="utf-8")
    for name in ("fill_form_field", "fill_date_field", "select_option", "click_radio"):
        chunk = form.split(f"async def {name}", 1)[1][:400]
        assert_true("xpath_smart" in chunk, f"{name} accepts xpath_smart")


def test_agent_prompt_xpath_primary() -> None:
    prompt = (ROOT / "scripts/prompts/agent-prompt.md").read_text(encoding="utf-8")
    assert_true("xpath_smart" in prompt, "prompt mentions xpath_smart")
    assert_true(
        "ambiguous-label" in prompt or "相对 xpath" in prompt,
        "prompt steers Agent to xpath / ambiguity",
    )


def main() -> int:
    test_resolve_hint_wins()
    test_resolve_unique_label()
    test_resolve_not_found()
    test_resolve_ambiguous()
    test_resolve_duplicate_same_xpath()
    test_scan_display_label_markers()
    test_phase_a_hardcut_markers()
    test_llm_actions_carry_xpath()
    test_phase_b_action_signatures()
    test_agent_prompt_xpath_primary()
    form = (ROOT / "scripts/actions/_form.py").read_text(encoding="utf-8")
    assert_true("def _resolve_control" in form, "_resolve_control defined")
    print("characterize-xpath-primary-ops: OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
