#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Characterization: multi-save-button section semantics + disableBtn skip.

Pins two coupled fixes for collapse multi-section pages (e.g. 对公客户转正)
where each section has its own text-only '保存' button (class el-button--text
+ custom disableBtn class) with identical text "保存":

1. JS_CLICK_SAVE_BUTTON (save.py) disabled check must recognise the custom
   'disableBtn' class in addition to el.disabled / disabled attr / is-disabled,
   so such buttons are filtered out of the candidate matches (treated as
   un-clickable / skipped).
2. Prompts (form-prompt.md / agent-tools-form.md) must guide the AI to call
   click_save per section when multiple save buttons belong to different
   sections/forms — not record a single save operation.
3. form_save.py ambiguous branch must emit 'err-save-ambiguous'.

Run:
  python scripts/characterization/characterize-multi-save-sections.py
"""
from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def assert_true(cond: bool, msg: str) -> None:
    if not cond:
        raise AssertionError(msg)


# ── 1. JS_CLICK_SAVE_BUTTON disableBtn recognition ──────────────────────────

SAVE_PY = ROOT / "scripts" / "controller" / "actions" / "js_snippets" / "save.py"


def test_save_py_has_disablebtn_skip() -> None:
    js = SAVE_PY.read_text(encoding="utf-8")
    assert_true("disableBtn" in js, "save.py must reference disableBtn custom class")
    # The disabled check must include classList.contains('disableBtn').
    assert_true(
        "classList.contains('disableBtn')" in js,
        "disabled check uses classList.contains('disableBtn')",
    )
    # The disableBtn check must be in the same disabled-guard line as is-disabled
    # (i.e. it filters the candidate BEFORE scoreBtn / matches collection).
    assert_true(
        "el.classList.contains('is-disabled') || el.classList.contains('disableBtn')"
        in js,
        "disableBtn check is appended to the is-disabled disabled guard",
    )


# ── 2. Prompt multi-save section guidance ────────────────────────────────────

FORM_PROMPT = ROOT / "scripts" / "prompts" / "form-prompt.md"
AGENT_TOOLS_FORM = ROOT / "scripts" / "prompts" / "agent-tools-form.md"


def test_form_prompt_has_multi_save_section_rule() -> None:
    text = FORM_PROMPT.read_text(encoding="utf-8")
    assert_true(
        "多保存按钮分区语义" in text,
        "form-prompt.md has multi-save section semantic heading",
    )
    assert_true(
        "每个分区恰好保存一次" in text,
        "form-prompt.md requires exactly one save per section",
    )
    assert_true(
        "err-save-ambiguous" in text,
        "form-prompt.md mentions err-save-ambiguous retry guidance",
    )
    assert_true(
        "section='<分区名>'" in text or "section='<分区名>'" in text,
        "form-prompt.md instructs section= per region",
    )


def test_agent_tools_form_has_multi_save_section_rule() -> None:
    text = AGENT_TOOLS_FORM.read_text(encoding="utf-8")
    assert_true(
        "多保存按钮分区语义" in text,
        "agent-tools-form.md has multi-save section semantic heading",
    )
    assert_true(
        "每个分区恰好保存一次" in text,
        "agent-tools-form.md requires exactly one save per section",
    )
    assert_true(
        "err-save-ambiguous" in text,
        "agent-tools-form.md mentions err-save-ambiguous retry guidance",
    )
    assert_true(
        "region='<分区名>'" in text or "region='<分区名>'" in text,
        "agent-tools-form.md instructs region= per region",
    )


# ── 3. form_save.py ambiguous branch ─────────────────────────────────────────

FORM_SAVE = ROOT / "scripts" / "controller" / "actions" / "form_save.py"


def test_form_save_ambiguous_branch() -> None:
    text = FORM_SAVE.read_text(encoding="utf-8")
    assert_true(
        "err-save-ambiguous" in text,
        "form_save.py has err-save-ambiguous branch",
    )
    # The ambiguous branch must reference candidates and the region=/section= hint.
    amb_idx = text.find("err-save-ambiguous")
    assert_true(amb_idx > 0, "err-save-ambiguous present in form_save.py")
    body = text[amb_idx:amb_idx + 600]
    assert_true("candidates" in body, "ambiguous branch includes candidates")
    assert_true(
        "region=" in body or "section=" in body,
        "ambiguous branch hints region=/section= to disambiguate",
    )


def main() -> int:
    test_save_py_has_disablebtn_skip()
    test_form_prompt_has_multi_save_section_rule()
    test_agent_tools_form_has_multi_save_section_rule()
    test_form_save_ambiguous_branch()
    print("characterize-multi-save-sections: OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
