#!/usr/bin/env python3
"""Characterize xpath-primary resolve gate + write hard-cut markers."""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.controller.actions._form import ResolvedControl, _resolve_control  # noqa: E402
from scripts.agent_utils import build_agent_system_message  # noqa: E402
from scripts.controller.actions._llm_values import (  # noqa: E402
    _enrich_llm_actions_xpath,
    _llm_generate_values,
)
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


def test_enrich_duplicate_label_omits_xpath() -> None:
    """Fix 1: same semantic label, ≥2 distinct xpaths → do not first-win bind."""
    fields = [
        {"label": "评级", "kind": "select", "xpath_smart": "//div[@id='a']//div[contains(@class,'el-select')]"},
        {"label": "评级", "kind": "select", "xpath_smart": "//div[@id='b']//div[contains(@class,'el-select')]"},
    ]
    # Non-1:1 action list (single action) → cannot index-match → omit
    llm_out = [{"action": "select_option", "label": "评级", "option": "AAA"}]
    enriched = _enrich_llm_actions_xpath(llm_out, fields)
    assert_true(len(enriched) == 1, "one action")
    assert_true(
        not (enriched[0].get("xpath_smart") or "").strip(),
        "ambiguous label must not inherit first xpath",
    )
    # Resolve path still reports ambiguous when xpath empty
    store = {
        "task_list": TaskList(
            pending=[
                TaskItem(label="评级", kind="select", xpath_smart=fields[0]["xpath_smart"]),
                TaskItem(label="评级", kind="select", xpath_smart=fields[1]["xpath_smart"]),
            ]
        ).to_store(),
        "_scan_fields": fields,
    }
    r = _resolve_control(store, "评级", "")
    assert_true(r.error == "ambiguous-label", "resolve still ambiguous without xpath")


def test_enrich_index_align_keeps_per_field_xpath() -> None:
    """1:1 LLM actions ↔ llm_fields → bind each action to its index xpath."""
    fields = [
        {"label": "评级", "kind": "select", "xpath_smart": "//div[@id='a']//select"},
        {"label": "评级", "kind": "select", "xpath_smart": "//div[@id='b']//select"},
    ]
    llm_out = [
        {"action": "select_option", "label": "评级", "option": "A"},
        {"action": "select_option", "label": "评级", "option": "B"},
    ]
    enriched = _enrich_llm_actions_xpath(llm_out, fields)
    assert_true(enriched[0]["xpath_smart"] == fields[0]["xpath_smart"], "index0 xpath")
    assert_true(enriched[1]["xpath_smart"] == fields[1]["xpath_smart"], "index1 xpath")


def test_enrich_keeps_existing_action_xpath() -> None:
    fields = [
        {"label": "评级", "kind": "select", "xpath_smart": "//div[@id='a']"},
        {"label": "评级", "kind": "select", "xpath_smart": "//div[@id='b']"},
    ]
    llm_out = [
        {"action": "select_option", "label": "评级", "option": "B", "xpath_smart": "//div[@id='b']"},
    ]
    enriched = _enrich_llm_actions_xpath(llm_out, fields)
    assert_true(enriched[0]["xpath_smart"] == "//div[@id='b']", "existing xpath kept")


def test_append_action_per_item_xpath() -> None:
    """P1/P2/_append_action keeps each field's own xpath (no by-label map)."""
    items = [
        {"label": "评级", "kind": "select", "options": ["A"], "commandValue": "A",
         "xpath_smart": "//div[@id='a']"},
        {"label": "评级", "kind": "select", "options": ["B"], "commandValue": "B",
         "xpath_smart": "//div[@id='b']"},
    ]
    out, _needs = _llm_generate_values(None, items)
    assert_true(len(out) == 2, "two P1 actions")
    assert_true(out[0]["xpath_smart"] == "//div[@id='a']", "first item xpath")
    assert_true(out[1]["xpath_smart"] == "//div[@id='b']", "second item xpath")


def test_execute_round_surfaces_ambiguous_label() -> None:
    """Fix 2: batch path must record resolve_error, not collapse to xpath-not-found."""
    form = (
        (ROOT / "scripts/controller/actions/_form.py").read_text(encoding="utf-8")
        + (ROOT / "scripts/controller/actions/form_scan_utils.py").read_text(encoding="utf-8")
    )
    assert_true(
        "resolve_error = resolved.error" in form,
        "plumb resolved.error into resolve_error",
    )
    assert_true(
        "result = resolve_error or 'xpath-not-found'" in form
        or 'result = resolve_error or "xpath-not-found"' in form,
        "batch uses resolve_error before xpath-not-found fallback",
    )
    # Ambiguous label must not first-win via field_dict label scan
    assert_true(
        "len(xps) <= 1" in form,
        "_field_dict_for_action skips ambiguous multi-xpath labels",
    )


def test_scan_display_label_markers() -> None:
    js = (
        (ROOT / "scripts/controller/actions/_js_snippets.py").read_text(encoding="utf-8")
        + "".join(
            p.read_text(encoding="utf-8")
            for p in sorted((ROOT / "scripts/controller/actions/js_snippets").glob("*.py"))
        )
    )
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
    form = (
        (ROOT / "scripts/controller/actions/_form.py").read_text(encoding="utf-8")
        + (ROOT / "scripts/controller/actions/form_scan_utils.py").read_text(encoding="utf-8")
    )
    assert_true(
        "ambiguous-label" in form and "xpath-not-found" in form,
        "write paths surface resolve errors",
    )
    assert_true("JS_FILL_BY_XPATH" in form, "xpath fill used")


def test_llm_actions_carry_xpath() -> None:
    src = (ROOT / "scripts/controller/actions/_llm_values.py").read_text(encoding="utf-8")
    assert_true("xpath_smart" in src, "_llm_values attaches xpath_smart to actions")
    assert_true(
        "def _enrich_llm_actions_xpath" in src,
        "enrich helper exists (no by_label first-wins)",
    )
    assert_true("by_label.setdefault" not in src, "first-wins by_label removed")


def test_phase_b_action_signatures() -> None:
    form = (
        (ROOT / "scripts/controller/actions/_form.py").read_text(encoding="utf-8")
        + (ROOT / "scripts/controller/actions/form_scan_utils.py").read_text(encoding="utf-8")
    )
    for name in ("fill_form_field", "fill_date_field", "select_option", "click_radio"):
        chunk = form.split(f"async def {name}", 1)[1][:400]
        assert_true("xpath_smart" in chunk, f"{name} accepts xpath_smart")


def test_agent_prompt_xpath_primary() -> None:
    prompt = build_agent_system_message(None)
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
    test_enrich_duplicate_label_omits_xpath()
    test_enrich_index_align_keeps_per_field_xpath()
    test_enrich_keeps_existing_action_xpath()
    test_append_action_per_item_xpath()
    test_execute_round_surfaces_ambiguous_label()
    test_scan_display_label_markers()
    test_phase_a_hardcut_markers()
    test_llm_actions_carry_xpath()
    test_phase_b_action_signatures()
    test_agent_prompt_xpath_primary()
    form = (
        (ROOT / "scripts/controller/actions/_form.py").read_text(encoding="utf-8")
        + (ROOT / "scripts/controller/actions/form_scan_utils.py").read_text(encoding="utf-8")
    )
    assert_true("def _resolve_control" in form, "_resolve_control defined")
    print("characterize-xpath-primary-ops: OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
