#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Characterize: Agent result protocol (三段式 err 结果 · use 推荐 · 记账).

Spec: docs/superpowers/specs/2026-08-27-agent-result-protocol-design.md
Run: ./python/python.exe scripts/characterization/characterize-result-protocol.py
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

MOD = ROOT / "scripts" / "controller" / "actions" / "result_protocol.py"


def assert_true(cond, msg):
    if not cond:
        raise AssertionError(msg)


def test_err_with_three_sections():
    from scripts.controller.actions.result_protocol import err_with
    r = err_with("select-option-unresolved", "下拉中没有精确或相近的选项",
                 observed="options=法人投资,自然人投资",
                 next_action='select_option(label_text="投资主体类型", option_text="法人投资")')
    t = str(r.extracted_content)
    assert_true(t.startswith("err-select-option-unresolved | "), "must start with hyphen code")
    assert_true("| 原因:" in t and "| 现场:" in t and "| 下一步:" in t, "three sections present")
    # 空段省略
    r2 = err_with("icon-label-miss", "没有匹配标签")
    assert_true("| 现场:" not in str(r2.extracted_content), "empty observed omitted")
    assert_true(str(r2.error).startswith("err-icon-label-miss"), "error attr mirrors code")


def test_validate_protocol():
    from scripts.controller.actions.result_protocol import validate_protocol
    good = ("err-x | 原因:a | 现场:b | 下一步:c")
    assert_true(validate_protocol(good) == [], f"good rejected: {validate_protocol(good)}")
    assert_true(any("原因" in v for v in validate_protocol("err-x | 现场:b")), "missing reason flagged")
    assert_true(validate_protocol("not-err | 原因:a") != [], "non err- prefix flagged")
    assert_true(validate_protocol("err-X! | 原因:a") != [], "bad code charset flagged")


def test_recommend_action_for_kind():
    from scripts.controller.actions.result_protocol import recommend_action_for_kind as rec
    assert_true(rec("select").startswith("select_option"), "select -> select_option")
    assert_true(rec("date").startswith("fill_form_field") and "YYYY-MM-DD" in rec("date"), "date hint")
    assert_true(rec("tree-select").startswith("select_tree_option"), "tree-select")
    assert_true(rec("radio") == "click_radio", "radio")


def test_affordances_source_shape():
    js_src = MOD.read_text(encoding="utf-8")
    assert_true("async def affordances(page" in js_src, "async affordances present")
    assert_true(".el-select-dropdown__item" in js_src, "reads select options")
    assert_true(".el-table__body-wrapper" in js_src and "buttons" in js_src,
                "button probe excludes table rows")
    assert_true("el-form-item__label" in js_src, "label scoping present")


def fill_all():
    p = (ROOT / "scripts/controller/actions/form_action_engines.py").read_text(encoding="utf-8")
    return p.split("class FillEngine", 1)[1].split("class SelectEngine", 1)[0]


def test_final_review_fixes():
    src_all = MOD.read_text(encoding="utf-8")
    adj = (ROOT / "scripts/controller/actions/form_action_engines.py").read_text(encoding="utf-8")
    sv = (ROOT / "scripts/controller/actions/form_save.py").read_text(encoding="utf-8")
    dupe = (ROOT / "scripts/controller/actions/duplicate_failure_cue.py").read_text(encoding="utf-8")
    form_prompt = (ROOT / "scripts/prompts/agent-tools-form.md").read_text(encoding="utf-8")
    assert_true("err-no-adjacent-button" in adj and "'err-no-adjacent-button'" in dupe, "C1 wired+prescribed")
    assert_true("err_with(" in sv.split("CHAIN RISK")[1], "I1 envelope after risk comment")
    assert_true("err-field-disabled" in form_prompt, "I2 prompt synced")
    assert_true('replace("|"' in src_all.replace("\\\\", "\\"), "I3 pipe escape in sections")
    assert_true("_field_disabled_hint" not in fill_all(), "sanity: legacy helper stays retired")


def main() -> int:
    test_err_with_three_sections()
    test_validate_protocol()
    test_recommend_action_for_kind()
    test_affordances_source_shape()
    test_final_review_fixes()
    print("characterize-result-protocol: OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
