#!/usr/bin/env python3
"""Select option matching must not prefer shorter substring options.

Bug: 国民经济部门类别 want=其他非金融企业部门, options include 非金融企业部门 —
``o in want`` / fuzzy containment picked the short option. already-matched used
the same substring rule and skipped the real select.
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))


def assert_true(cond: bool, msg: str) -> None:
    if not cond:
        raise AssertionError(msg)


def test_match_prefers_exact_over_shorter_substring() -> None:
    from scripts.controller.actions.form_scan_utils import match_select_option_candidate

    opts = ["非金融企业部门", "其他非金融企业部门", "金融机构"]
    assert_true(
        match_select_option_candidate("其他非金融企业部门", opts) == "其他非金融企业部门",
        "exact long option must win",
    )
    assert_true(
        match_select_option_candidate("非金融企业部门", opts) == "非金融企业部门",
        "exact short option must win",
    )


def test_match_must_not_pick_shorter_contained_in_want() -> None:
    from scripts.controller.actions.form_scan_utils import match_select_option_candidate

    opts = ["非金融企业部门", "其他非金融企业部门"]
    # Historical bug: next(o for o in opts if want in o or o in want) → 非金融…
    assert_true(
        match_select_option_candidate("其他非金融企业部门", opts) != "非金融企业部门",
        "must not pick shorter option contained in want",
    )


def test_already_matched_requires_exact_or_sentinel() -> None:
    from scripts.controller.actions.form_scan_utils import select_option_already_matched

    assert_true(
        select_option_already_matched("其他非金融企业部门", "其他非金融企业部门"),
        "exact match is already-matched",
    )
    assert_true(
        select_option_already_matched("first", "非金融企业部门"),
        "sentinel first accepts any current",
    )
    assert_true(
        not select_option_already_matched("其他非金融企业部门", "非金融企业部门"),
        "substring current must NOT skip re-select",
    )
    assert_true(
        not select_option_already_matched("非金融企业部门", "其他非金融企业部门"),
        "substring request must NOT skip re-select",
    )


def test_form_select_uses_helpers() -> None:
    form = (ROOT / "scripts/controller/actions/_form.py").read_text(encoding="utf-8")
    assert_true("select_option_already_matched" in form, "select_option uses already-matched helper")
    assert_true("match_select_option_candidate" in form, "fuzzy path uses match helper")
    # Must not keep bare substring already-matched in select_option body
    idx = form.find("async def select_option(")
    end = form.find("async def click_adjacent_button", idx)
    body = form[idx:end]
    assert_true(
        "cur_val in option_text" not in body and "option_text in cur_val" not in body,
        "select_option must not use substring already-matched",
    )


def test_js_includes_prefers_shortest() -> None:
    from scripts.controller.actions.js_snippets.select_option import JS_SELECT_OPTION

    js = JS_SELECT_OPTION
    assert_true(
        "bestLen" in js or "shortest" in js.lower() or "lab.length" in js,
        "includes fuzzy must prefer shortest lab (非金融 over 其他非金融)",
    )


def main() -> int:
    test_match_prefers_exact_over_shorter_substring()
    test_match_must_not_pick_shorter_contained_in_want()
    test_already_matched_requires_exact_or_sentinel()
    test_form_select_uses_helpers()
    test_js_includes_prefers_shortest()
    print("characterize-select-option-substring: OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
