#!/usr/bin/env python3
"""Characterize scan_editable_summary (T4-P0 read-only inventory action)."""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

FORM_PY = ROOT / "scripts/controller/actions/_form.py"
PROMPT_MD = ROOT / "scripts/prompts/agent-tools-form.md"


def assert_true(cond: bool, msg: str) -> None:
    if not cond:
        raise AssertionError(msg)


def _norm(s: str) -> str:
    return s.replace(" ", "").replace("\n", "")


def _scan_editable_summary_body(form_src: str) -> str:
    marker = "async def scan_editable_summary"
    assert_true(marker in form_src, "_form.py defines async def scan_editable_summary")
    return form_src.split(marker, 1)[1].split("\nasync def ", 1)[0]


def test_action_defined() -> None:
    form = FORM_PY.read_text(encoding="utf-8")
    assert_true(
        "async def scan_editable_summary" in form,
        "_form.py defines async def scan_editable_summary",
    )


def test_action_no_autofill() -> None:
    form = FORM_PY.read_text(encoding="utf-8")
    body = _scan_editable_summary_body(form)
    assert_true(
        "_auto_fill_pending" not in body,
        "scan_editable_summary must not call _auto_fill_pending",
    )
    assert_true(
        "allow_autofill=True" not in _norm(body),
        "scan_editable_summary must not pass allow_autofill=True",
    )


def test_action_no_store_writes() -> None:
    form = FORM_PY.read_text(encoding="utf-8")
    body = _scan_editable_summary_body(form)
    assert_true(
        "case_data_store['task_list']" not in body
        and 'case_data_store["task_list"]' not in body,
        "scan_editable_summary must not assign case_data_store['task_list']",
    )
    assert_true(
        "['_scan_fields']" not in body,
        "scan_editable_summary must not assign case_data_store['_scan_fields']",
    )


def test_summary_buttons_shape() -> None:
    form = FORM_PY.read_text(encoding="utf-8")
    body = _scan_editable_summary_body(form)
    assert_true(
        '"buttons"' in body or "'buttons'" in body,
        "summary construction includes buttons key",
    )
    assert_true(
        '"text"' in body or "'text'" in body,
        "buttons projection includes text",
    )
    assert_true(
        '"section"' in body or "'section'" in body,
        "buttons projection includes section",
    )
    buttons_idx = body.find("buttons")
    assert_true(buttons_idx >= 0, "buttons construction block present")
    buttons_block = body[buttons_idx : buttons_idx + 600]
    assert_true(
        '"kind"' not in buttons_block and "'kind'" not in buttons_block,
        "buttons must not project kind (text+section only)",
    )


def test_prompt_mentions_action() -> None:
    prompt = PROMPT_MD.read_text(encoding="utf-8")
    assert_true(
        "scan_editable_summary" in prompt,
        "agent-tools-form.md mentions scan_editable_summary",
    )


def main() -> int:
    test_action_defined()
    test_action_no_autofill()
    test_action_no_store_writes()
    test_summary_buttons_shape()
    test_prompt_mentions_action()
    print("characterize-scan-editable-summary: OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
