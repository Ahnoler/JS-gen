#!/usr/bin/env python3
"""Date fill is merged into fill_form_field (same Vue commit as fill_date_field).

TsscMultiDatePicker (class tsscdatepicker) is not ElDatePicker — native input
set without Vue commit leaves form.model empty → save '请选择' and click clears.
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.controller.actions.js_snippets.fill_core import JS_FILL_BY_XPATH, JS_FILL_FORM_FIELD
from scripts.controller.actions.js_snippets.fill_date import (
    JS_COMMIT_DATE_VUE_BODY,
    JS_FILL_DATE_BY_XPATH,
    JS_FILL_DATE_FIELD,
)


def assert_true(cond: bool, msg: str) -> None:
    if not cond:
        raise AssertionError(msg)


def test_commit_helper_covers_tssc() -> None:
    body = JS_COMMIT_DATE_VUE_BODY
    assert_true("commitDateVue" in body, "shared commitDateVue helper")
    assert_true("TsscMultiDatePicker" in body, "must stop at TsscMultiDatePicker")
    assert_true("ElDatePicker" in body, "must still handle ElDatePicker")
    assert_true("tsscdatepicker" in body, "closest includes tsscdatepicker")
    assert_true("el.form.change" in body or "form.model" in body, "form.model fallback")


def test_fill_by_xpath_commits_date_host() -> None:
    js = JS_FILL_BY_XPATH
    assert_true("commitDateVue" in js, "xpath fill uses commitDateVue")
    assert_true("ok-date" in js, "date host returns ok-date")
    assert_true("readOnly && !isDate" in js.replace(" ", "") or "readOnly&&!isDate" in js.replace(" ", ""),
                "date host must not treat readOnly as field-disabled")


def test_fill_form_field_and_date_share_commit() -> None:
    assert_true("commitDateVue" in JS_FILL_FORM_FIELD, "label fill commits date Vue")
    assert_true("commitDateVue" in JS_FILL_DATE_BY_XPATH, "date-by-xpath commits Vue")
    assert_true("commitDateVue" in JS_FILL_DATE_FIELD, "legacy JS_FILL_DATE_FIELD commits Vue")
    assert_true("TsscMultiDatePicker" in JS_FILL_DATE_BY_XPATH, "xpath date fill knows Tssc")


def test_fill_date_field_is_alias_only() -> None:
    form = (ROOT / "scripts/controller/actions/_form.py").read_text(encoding="utf-8")
    assert_true("async def fill_date_field" not in form, "fill_date_field controller action removed")

    from scripts.controller.actions.replay_names import normalize_action_name
    assert_true(
        normalize_action_name("fill_date_field") == "fill_form_field",
        "Python alias maps fill_date_field → fill_form_field",
    )
    assert_true(
        normalize_action_name("fillDateField") == "fill_form_field",
        "Python alias maps fillDateField → fill_form_field",
    )

    replay = (ROOT / "scripts/controller/actions/_replay.py").read_text(encoding="utf-8")
    fn = replay.split("async def _replay_form_action", 1)[1]
    assert_true(
        "action_name == 'fill_date_field'" not in fn.split("async def _replay_controller_action", 1)[0],
        "replay must not special-case fill_date_field after alias normalize",
    )

    names = (ROOT / "src/models/action-name.js").read_text(encoding="utf-8")
    assert_true("fill_date_field: 'fill_form_field'" in names, "JS alias maps fill_date_field")
    assert_true("'fill_date_field'" not in names.split("CANONICAL", 1)[1].split("export function", 1)[0],
                "fill_date_field is not canonical")


def test_ctrl_form_commits_tssc_date() -> None:
    src = (ROOT / "src/ctrl-actions/form.js").read_text(encoding="utf-8")
    assert_true("TsscMultiDatePicker" in src, "CTRL fillFormField walks Tssc date picker")
    assert_true("tsscdatepicker" in src, "CTRL closest includes tsscdatepicker")


def test_prompts_unified_fill() -> None:
    text = (ROOT / "scripts/prompts/agent-tools-form.md").read_text(encoding="utf-8")
    assert_true("fill_form_field" in text and "日期" in text, "prompt still documents date via fill_form_field")
    assert_true(
        "现在支持日期字段 — 直接设置值" not in text,
        "must not claim native-only date set",
    )


def main() -> int:
    test_commit_helper_covers_tssc()
    test_fill_by_xpath_commits_date_host()
    test_fill_form_field_and_date_share_commit()
    test_fill_date_field_is_alias_only()
    test_ctrl_form_commits_tssc_date()
    test_prompts_unified_fill()
    print("characterize-date-fill-merge: OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
