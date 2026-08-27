#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Characterization: select_option 值↔选项错配的「建议字段」确定性重定向（C 方案）。

Pins the source-fix for business-data values mapped to the wrong select field
(e.g. 信贷潜在客户 assigned to 对公客户类型 — it belongs to 客户状态):

1. suggest_field_for_value (select_match.py) — candidate fields whose
   options contain the wanted value (exact → shortest containment); the
   reversed 'o in want' direction (部门类别 ← 非金融企业部门 trap) is
   forbidden.
2. _select_failure_next_action (form_action_engines.py) — all 5
   err-select-option-unresolved branches route next_action through it;
   the A+B guard "fallback-first" in str(select_result) is retained.
3. _guard_select_plan_values (_llm_values.py) — post-parse guard wired
   before _enrich_llm_actions_xpath; cross_fields plumbing present.
4. C1 prompt wording in agent-core.md / agent-tools-form.md / form-prompt.md.

Run:
  python scripts/characterization/characterize-select-option-suggest-field.py
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.controller.actions.select_match import (  # noqa: E402
    match_select_option_candidate,
    suggest_field_for_value,
)

SELECT_MATCH = ROOT / "scripts" / "controller" / "actions" / "select_match.py"
FORM_ENGINE = ROOT / "scripts" / "controller" / "actions" / "form_action_engines.py"
LLM_VALUES = ROOT / "scripts" / "controller" / "actions" / "_llm_values.py"
AGENT_CORE = ROOT / "scripts" / "prompts" / "agent-core.md"
AGENT_TOOLS_FORM = ROOT / "scripts" / "prompts" / "agent-tools-form.md"
FORM_PROMPT = ROOT / "scripts" / "prompts" / "form-prompt.md"


def assert_true(cond: bool, msg: str) -> None:
    if not cond:
        raise AssertionError(msg)


# ── 1. select_match.py — read_text markers ─────────────────────────────────

def test_select_match_static_markers() -> None:
    body = SELECT_MATCH.read_text(encoding="utf-8")
    assert_true(
        "def suggest_field_for_value(" in body,
        "suggest_field_for_value defined",
    )
    assert_true(
        "def match_select_option_candidate" in body,
        "match_select_option_candidate still present",
    )
    sug_start = body.find("def suggest_field_for_value(")
    sug_body = body[sug_start:]
    # The forbidden direction is 'o in want' — never any 'in want' idiom.
    assert_true(
        "in want" not in sug_body,
        "suggest function body has no o-in-want trap direction",
    )
    assert_true(
        "'label': label" in sug_body and "'option': matched" in sug_body,
        "suggest returns dict with label/option",
    )


# ── 2. select_match.py — functional ordering ───────────────────────────────

def test_suggest_unique_candidate() -> None:
    cands = suggest_field_for_value(
        "信贷潜在客户",
        [
            {"label": "对公客户类型", "options": ["企业类", "事业类"]},
            {"label": "客户状态", "options": ["信贷正式客户", "信贷潜在客户"]},
        ],
        exclude_label="对公客户类型",
    )
    labels = [c["label"] for c in cands]
    assert_true(
        "客户状态" in labels,
        "unique candidate found (客户状态)",
    )
    assert_true(
        cands[0]["option"] == "信贷潜在客户",
        "option is the original snapshot string",
    )


def test_suggest_multiple_candidates_sorted() -> None:
    cands = suggest_field_for_value(
        "潜在客户",
        [
            {"label": "客户类型A", "options": ["信贷潜在客户"]},
            {"label": "客户类型B", "options": ["潜在客户"]},
        ],
    )
    assert_true(len(cands) == 2, "two candidate fields")
    assert_true(cands[0]["label"] == "客户类型B", "exact match first")
    assert_true(cands[1]["label"] == "客户类型A", "containment match second")


def test_suggest_no_candidate() -> None:
    cands = suggest_field_for_value(
        "信贷潜在客户",
        [
            {"label": "对公客户类型", "options": ["企业类", "事业类"]},
            {"label": "客户状态", "options": ["正常", "注销"]},
        ],
    )
    assert_true(cands == [], "no candidate returns []")


def test_suggest_exclude_label() -> None:
    cands = suggest_field_for_value(
        "潜在客户",
        [
            {"label": "客户状态", "options": ["信贷潜在客户"]},
            {"label": "客户类型", "options": ["潜在客户"]},
        ],
        exclude_label="客户类型",
    )
    labels = [c["label"] for c in cands]
    assert_true("客户类型" not in labels, "excluded label skipped")
    assert_true(labels == ["客户状态"], "only non-excluded candidate remains")


def test_suggest_trap_direction_forbidden() -> None:
    # Old trap: option ⊆ want (部门类别 / 非金融企业部门) must yield nothing.
    cands = suggest_field_for_value(
        "部门类别",
        [{"label": "国民经济部门", "options": ["非金融企业部门"]}],
    )
    assert_true(cands == [], "o-in-want direction rejected (部门类别 / 非金融企业部门)")
    # Legal direction: want ⊆ option.
    cands2 = suggest_field_for_value(
        "非金融企业部门",
        [{"label": "国民经济部门类别", "options": ["其他非金融企业部门", "公司"]}],
    )
    assert_true(len(cands2) == 1, "w-in-o direction accepted")
    assert_true(
        cands2[0]["option"] == "其他非金融企业部门",
        "contained option returned",
    )


def test_suggest_exact_priority() -> None:
    cands = suggest_field_for_value(
        "信贷潜在客户",
        [{"label": "客户状态", "options": ["信贷潜在客户", "潜在客户"]}],
    )
    assert_true(len(cands) == 1, "exact candidate only")
    assert_true(
        cands[0]["option"] == "信贷潜在客户",
        "exact original string returned",
    )
    # The underlying matcher keeps the exact→shortest-contained order.
    assert_true(
        match_select_option_candidate("潜在客户", ["信贷潜在客户", "潜在客户"]) == "潜在客户",
        "match_select_option_candidate exact-first unchanged",
    )


# ── 3. form_action_engines.py — C2 wiring markers ─────────────────────────

def test_form_engine_next_action_wiring() -> None:
    text = FORM_ENGINE.read_text(encoding="utf-8")
    assert_true(
        "def _select_failure_next_action(" in text,
        "_select_failure_next_action defined",
    )
    assert_true(
        text.count("_select_failure_next_action(") >= 6,
        "next_action routed in all 5 failure branches (def + 5 call sites)",
    )
    assert_true(
        "'fallback-first' in str(select_result)" in text,
        "A+B fallback-first guard retained",
    )


# ── 4. _llm_values.py — C3 wiring markers ─────────────────────────────────

def test_llm_values_c3_wiring() -> None:
    text = LLM_VALUES.read_text(encoding="utf-8")
    assert_true(
        "suggest_field_for_value" in text,
        "suggest imported/used in _llm_values",
    )
    assert_true(
        "def _guard_select_plan_values(" in text,
        "guard function defined",
    )
    assert_true(
        "_guard_select_plan_values(llm_actions" in text,
        "post-parse guard wired at call site",
    )
    assert_true("cross_fields" in text, "cross_fields plumbing present")
    after_call = text.split("_guard_select_plan_values(llm_actions", 1)[1][:400]
    assert_true(
        "_enrich_llm_actions_xpath" in after_call,
        "guard runs before _enrich_llm_actions_xpath",
    )


# ── 5. Prompts — C1 wording ────────────────────────────────────────────────

def test_prompts_c1_wording() -> None:
    assert_true(
        "候选字段，如 信贷潜在客户 → 客户状态" in AGENT_CORE.read_text(encoding="utf-8"),
        "agent-core.md has 建议字段 redirect rule",
    )
    assert_true(
        "候选字段即为建议字段" in AGENT_TOOLS_FORM.read_text(encoding="utf-8"),
        "agent-tools-form.md has candidate-field guidance",
    )
    assert_true(
        "值不在选项内（跨字段建议）" in FORM_PROMPT.read_text(encoding="utf-8"),
        "form-prompt.md has cross-field value rule",
    )


def main() -> int:
    test_select_match_static_markers()
    test_suggest_unique_candidate()
    test_suggest_multiple_candidates_sorted()
    test_suggest_no_candidate()
    test_suggest_exclude_label()
    test_suggest_trap_direction_forbidden()
    test_suggest_exact_priority()
    test_form_engine_next_action_wiring()
    test_llm_values_c3_wiring()
    test_prompts_c1_wording()
    print("characterize-select-option-suggest-field: OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
