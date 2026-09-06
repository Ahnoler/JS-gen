#!/usr/bin/env python3
"""Characterize JS_IS_QUERY_TOOLBAR wizard-exclusion fix (S2 / G2).

A stepped wizard drawer (e.g. credit application Step1: 查询/重置/下一步/返回, no save)
was misclassified as a query toolbar (有查询无保存), blocking scan / form-assistant /
click_save behind the query-UI guard.

Pins (read_text style, no browser needed):
  1. base.py snippet text carries the three wizard signals:
     - step bar selector '.el-steps, .el-step';
     - stepper nav combo 「下一步」 + 「上一步」;
     - approval buttons 「流程提交」/「流程撤销」 or text containing 「意见」.
  2. Call sites still exist: form_scan_utils.py evaluates JS_IS_QUERY_TOOLBAR
     (the is_qt detection) and form_save.py rechecks it in click_save.
  3. A simplified replica of the decision semantics:
     {查询, 下一步, 上一步} → non-query (False);
     {查询, 重置} → query toolbar (True);
     {查询, 保存} → non-query (False, original rule).
"""
from __future__ import annotations

import re
import sys

sys.path.insert(0, ".")

BASE = "scripts/controller/actions/js_snippets/base.py"
SCAN_UTILS = "scripts/controller/actions/form_scan_utils.py"
FORM_SAVE = "scripts/controller/actions/form_save.py"


def _read(path: str) -> str:
    with open(path, "r", encoding="utf-8") as f:
        return f.read()


def _pin_wizard_signals_in_base() -> None:
    src = _read(BASE)
    # Signal 1: step bar selector present and used to bail out as non-query
    assert "querySelector('.el-steps, .el-step')" in src, (
        "base.py: wizard signal 1 (.el-steps/.el-step step bar selector) missing"
    )
    # Signal 2: stepper nav combo 下一步 + 上一步
    assert "上一步" in src and "下一步" in src, (
        "base.py: wizard signal 2 (下一步 + 上一步 stepper nav) missing"
    )
    assert "hasPrev" in src and "hasNext" in src, (
        "base.py: stepper nav flags (hasPrev/hasNext) missing"
    )
    # Signal 3: approval / flow buttons
    assert "流程提交" in src and "流程撤销" in src and "意见" in src, (
        "base.py: wizard signal 3 (流程提交/流程撤销/意见) missing"
    )
    # Original query semantics preserved
    assert "hasQuery && !hasSave" in src, "base.py: original query rule (hasQuery && !hasSave) missing"
    assert "JS_IS_QUERY_TOOLBAR" in src, "base.py: JS_IS_QUERY_TOOLBAR constant missing"
    print("[pin] base.py wizard signals present: el-steps/el-step, 下一步+上一步, 流程提交/流程撤销/意见")


def _pin_call_sites() -> None:
    scan = _read(SCAN_UTILS)
    # form_scan_utils.py: query-toolbar detection still evaluates the snippet
    assert "is_qt = bool(await page.evaluate(JS_IS_QUERY_TOOLBAR))" in scan, (
        "form_scan_utils.py: is_qt evaluate(JS_IS_QUERY_TOOLBAR) call missing"
    )
    save = _read(FORM_SAVE)
    # form_save.py: click_save recheck after picker confirm still present
    assert "still_query = bool(await page.evaluate(JS_IS_QUERY_TOOLBAR))" in save, (
        "form_save.py: still_query evaluate(JS_IS_QUERY_TOOLBAR) recheck missing"
    )
    print("[pin] call sites present: form_scan_utils.py is_qt detection, form_save.py still_query recheck")


def _is_query_toolbar(buttons: list[str], *, has_step_bar: bool = False) -> bool:
    """Simplified replica of JS_IS_QUERY_TOOLBAR decision semantics.

    Mirrors the snippet: query toolbar = has 查询/搜索 AND no 保存/提交 AND no wizard signal.
    Wizard signals (any one → non-query):
      1. visible .el-steps/.el-step step bar;
      2. both 下一步 and 上一步 buttons;
      3. 流程提交 / 流程撤销 / button text containing 意见.
    """
    if has_step_bar:
        return False  # wizard signal 1
    has_query = any(re.fullmatch(r"查询|搜索|查找", t) for t in buttons)
    has_save = any(t in ("保存", "提交") for t in buttons)
    has_prev = "上一步" in buttons
    has_next = "下一步" in buttons
    has_flow = any(t in ("流程提交", "流程撤销") or "意见" in t for t in buttons)
    if (has_prev and has_next) or has_flow:
        return False  # wizard signals 2 & 3
    return has_query and not has_save


def _pin_decision_semantics() -> None:
    # Wizard drawer (credit Step1: 查询/重置/下一步/返回) → NOT a query toolbar
    assert _is_query_toolbar(["查询", "下一步", "上一步"]) is False, (
        "semantics: {查询,下一步,上一步} must be non-query (wizard signal 2)"
    )
    # Same wizard with a visible step bar → non-query via signal 1
    assert _is_query_toolbar(["查询", "重置", "下一步", "返回"], has_step_bar=True) is False, (
        "semantics: step bar presence must force non-query (wizard signal 1)"
    )
    # Pure query toolbar (查询/重置, no wizard signals) → still a query toolbar
    assert _is_query_toolbar(["查询", "重置"]) is True, (
        "semantics: {查询,重置} must remain query toolbar"
    )
    # 保存/提交 present → non-query (original rule untouched)
    assert _is_query_toolbar(["查询", "保存"]) is False, (
        "semantics: {查询,保存} must be non-query (original rule)"
    )
    # Approval form → non-query via signal 3
    assert _is_query_toolbar(["查询", "流程提交"]) is False, (
        "semantics: {查询,流程提交} must be non-query (wizard signal 3)"
    )
    # 返回 alone is not a wizard signal (query drawers also have 返回)
    assert _is_query_toolbar(["查询", "重置", "返回"]) is True, (
        "semantics: 返回 alone must NOT signal wizard"
    )
    print("[pin] decision semantics verified: wizard → non-query; pure query → query; 保存 → non-query; 返回 → not a signal")


def main() -> None:
    _pin_wizard_signals_in_base()
    _pin_call_sites()
    _pin_decision_semantics()
    print("OK: characterize-query-toolbar-snippet all pins passed")


if __name__ == "__main__":
    main()
