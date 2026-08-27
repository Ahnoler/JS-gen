#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Characterization: click_table_row_button toolbar-pattern fix (2026-08-27 incident).

Incident: 「对公客户管理」列表页表格行内只有 单选框 + 客户名称链接（查看），
真正的「修改」按钮在表格上方工具栏（选中行后点工具栏模式）。Agent 用
click_table_row_button(row_text="26082700011272705 璞真健康管理咨询中心",
button_text="修改") 两次失败：① row-not-found——agent 传的 row_text 是跨单元格
空格拼接文本，而 row.textContent 将相邻单元格无空格直接拼接，includes() 落空；
② 按名称命中行后行内无「修改」，旧逻辑盲点行内第一个可见按钮（客户名称链接）
并记为 ok-fallback 假成功。

Pins:
1. Row matching uses whitespace-stripped contains fallback (space-joined multi-cell
   row_text matches concatenated textContent) — _table.py button + radio, CTRL table.js.
2. No blind first-visible-button fallback — structured 'button-not-found-in-row'
   JSON with rowButtons/rowHasRadio + Python guidance to radio-select then toolbar.
3. Prompt documents the toolbar pattern and no longer advertises the blind fallback.

Run:
  python scripts/characterization/characterize-table-toolbar-pattern.py
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


def assert_true(cond: bool, msg: str) -> None:
    if not cond:
        raise AssertionError(msg)


TABLE_PY = ROOT / "scripts" / "controller" / "actions" / "_table.py"
CTRL_TABLE_JS = ROOT / "src" / "ctrl-actions" / "table.js"
CTRL_INDEX_JS = ROOT / "src" / "ctrl-actions" / "index.js"
PROMPT = ROOT / "scripts" / "prompts" / "agent-tools-table.md"
ICONS_JS = ROOT / "scripts" / "controller" / "actions" / "js_snippets" / "icons.py"
MISC_PY = ROOT / "scripts" / "controller" / "actions" / "_misc.py"
CTRL_NAV_JS = ROOT / "src" / "ctrl-actions" / "nav.js"


def test_click_button_reports_text_buttons_on_miss() -> None:
    """2026-08-27 toolbar 修改 cycle: icon-only tool could not see plain text
    buttons. Extended: after an icon miss it CLICKS a same-label visible text
    button ('ok-text:<label>') — one-step success instead of retry loops."""
    js = ICONS_JS.read_text(encoding="utf-8")
    assert_true(
        "ok-text:" in js,
        "JS_CLICK_ICON_BUTTON generalized fallback clicks the text button",
    )
    assert_true(
        "err-icon-label-ambiguous" in js and "'ambiguous'" in js.replace('"', "'"),
        "ambiguous same-label matches still return structured candidate list",
    )
    assert_true(
        ".el-table__body-wrapper')) continue" in js,
        "text-button probe excludes table-row affordances (row tools own those)",
    )
    assert_true(
        "pageLevel" in js or "!isOverlay(" in js,
        "page-level buttons preferred over overlay-scoped ones",
    )
    misc = MISC_PY.read_text(encoding="utf-8")
    assert_true(
        "startswith('err-icon-label-ambiguous:')" in misc,
        "Python wraps ambiguous err-icon-label-ambiguous with _err guidance",
    )
    ctrl_nav = CTRL_NAV_JS.read_text(encoding="utf-8")
    icon_fn = ctrl_nav.split("clickButton:")[1]
    assert_true(
        "ok-text:" in icon_fn and "err-icon-label-ambiguous" in icon_fn,
        "CTRL clickButton parity: text-button click + ambiguous structure",
    )
    idx = CTRL_INDEX_JS.read_text(encoding="utf-8")
    row = [ln for ln in idx.splitlines() if "clickButton" in ln and "|" in ln]
    assert_true(row and "ok-text" in row[0], "index.js doc line shows ok-text code")


def test_prompt_icon_vs_text_button_boundary() -> None:
    text = PROMPT.read_text(encoding="utf-8")
    assert_true(
        "通用" in text and "ok-text" in text,
        "prompt documents generalized label-click behavior with ok-text result",
    )
    assert_true(
        "新增一级分类" in text,
        "icon example retained (tooltip icons still matched first)",
    )
    assert_true(
        "click_table_row_button" in text,
        "row-affordance boundary retained",
    )


def test_row_matching_whitespace_normalized() -> None:
    src = TABLE_PY.read_text(encoding="utf-8")
    assert_true(
        src.count("replace(/\\\\s+/g, '')).includes(wantCompact)") >= 2,
        "_table.py button+radio both use whitespace-stripped contains fallback",
    )
    ctrl = CTRL_TABLE_JS.read_text(encoding="utf-8")
    # CTRL parity: clickTableRowButton whitespace-stripped row match
    btn_fn = ctrl.split("clickTableRowButton:")[1].split("clickTableRowRadio:")[0]
    assert_true(
        "wantCompact" in btn_fn and ").includes(wantCompact)" in btn_fn,
        "CTRL clickTableRowButton whitespace-stripped contains fallback",
    )
    radio_fn = ctrl.split("clickTableRowRadio:")[1]
    assert_true(
        "wantCompact" in radio_fn and ").includes(wantCompact)" in radio_fn,
        "CTRL clickTableRowRadio whitespace-stripped contains fallback",
    )


def test_no_blind_first_button_fallback() -> None:
    src = TABLE_PY.read_text(encoding="utf-8")
    btn_section = src.split("async def click_table_row_button")[1].split(
        "async def click_table_row_radio"
    )[0]
    assert_true(
        "ok-fallback" not in btn_section,
        "blind ok-fallback removed from click_table_row_button",
    )
    assert_true(
        "button-not-found-in-row:" in btn_section
        and "rowButtons" in btn_section
        and "rowHasRadio" in btn_section,
        "structured button-not-found-in-row JSON with row affordances",
    )
    assert_true(
        "click_table_row_radio" in btn_section.split("_err")[1] if "_err" in btn_section else False or "click_table_row_radio(row_text=" in btn_section,
        "guidance points agent at click_table_row_radio + toolbar path",
    )
    ctrl = CTRL_TABLE_JS.read_text(encoding="utf-8")
    btn_fn = ctrl.split("clickTableRowButton:")[1].split("clickTableRowRadio:")[0]
    assert_true(
        "ok-fallback" not in btn_fn,
        "CTRL clickTableRowButton no longer returns ok-fallback",
    )


def test_python_err_wrapper_and_import() -> None:
    src = TABLE_PY.read_text(encoding="utf-8")
    assert_true(
        "from ._helpers import _ok, _err, _is_ok_result, _enrich_click_element" in src,
        "_err imported from _helpers",
    )
    assert_true(
        "startswith('button-not-found-in-row')" in src,
        "Python wraps button-not-found-in-row with toolbar guidance (_err)",
    )


def test_ctrl_docs_updated() -> None:
    idx = CTRL_INDEX_JS.read_text(encoding="utf-8")
    row = [ln for ln in idx.splitlines() if "clickTableRowButton" in ln and "|" in ln]
    assert_true(row, "index.js doc table lists clickTableRowButton")
    assert_true(
        "ok-fallback" not in row[0],
        "doc line drops ok-fallback code",
    )
    assert_true(
        "button-not-found-in-row" in row[0],
        "doc line shows structured not-found code",
    )


def test_prompt_toolbar_pattern_guidance() -> None:
    text = PROMPT.read_text(encoding="utf-8")
    assert_true(
        "自动点击第一个可见按钮作为兜底" not in text,
        "prompt no longer advertises blind first-button fallback",
    )
    assert_true(
        "button-not-found-in-row" in text,
        "prompt explains structured not-found result",
    )
    assert_true(
        "click_table_row_radio" in text and "工具栏" in text,
        "prompt teaches radio-select → toolbar button pattern",
    )
    # Prompt still advertises the tool (navigate pack pins the name).
    assert_true(
        "click_table_row_button" in text,
        "tool name retained",
    )


def test_table_envelopes() -> None:
    src = (ROOT / "scripts/controller/actions/_table.py").read_text(encoding="utf-8")
    assert_true(src.count("err_with(") >= 2, "both actions envelope")
    assert_true("err-table-row-not-found" in src and "err-button-not-found-in-row" in src, "codes")
    assert_true("ok-fallback" not in src, "legacy blind fallback stays dead")
    prompt = (ROOT / "scripts/prompts/agent-tools-table.md").read_text(encoding="utf-8")
    assert_true("err-button-not-found-in-row" in prompt, "prompt updated")


def main() -> int:
    test_click_button_reports_text_buttons_on_miss()
    test_row_matching_whitespace_normalized()
    test_no_blind_first_button_fallback()
    test_python_err_wrapper_and_import()
    test_ctrl_docs_updated()
    test_prompt_toolbar_pattern_guidance()
    test_table_envelopes()
    print("characterize-table-toolbar-pattern: OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
