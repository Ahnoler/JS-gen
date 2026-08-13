#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Characterize TsscMultiSelect table-row options in JS_SELECT_OPTION / CTRL.

客户名称-style remote selects render ``tr.el-table__row`` inside the
el-select-dropdown (not ``.el-select-dropdown__item``). Without a table-row
fallback, select_option returns no-items and agents fall back to ephemeral
index clicks that cannot bind formData.

Also lock the click_element_by_index hard-gate (use-select-option) so those
index clicks are rejected and never recorded as 点击元素.
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from scripts.controller.actions._js_snippets import JS_SELECT_OPTION  # noqa: E402


def assert_true(cond: bool, msg: str) -> None:
    if not cond:
        raise AssertionError(msg)


def test_select_option_table_row_js() -> None:
    js = JS_SELECT_OPTION
    assert_true("el-select-dropdown__item" in js, "keeps standard option path")
    assert_true(
        "el-table__row" in js,
        "JS_SELECT_OPTION must collect tr.el-table__row for TsscMultiSelect table dropdowns",
    )
    assert_true(
        "SELECT_TABLE_ROW_OPTIONS" in js,
        "SELECT_TABLE_ROW_OPTIONS marker required for table-in-select fallback",
    )
    # Matching must use cell label so exact option_text '国讯网络有限公司'
    # hits row text '国讯网络有限公司260807…'
    assert_true(
        "optionLabel" in js or "tableRowLabel" in js or "rowLabel" in js,
        "must define a row/cell label helper for match + ok: return text",
    )

    ctrl = (ROOT / "src" / "ctrl-actions" / "select.js").read_text(encoding="utf-8")
    assert_true(
        "el-table__row" in ctrl,
        "CTRL select.js must also pick el-table__row in open dropdown",
    )
    assert_true(
        "SELECT_TABLE_ROW_OPTIONS" in ctrl,
        "CTRL select.js must include SELECT_TABLE_ROW_OPTIONS marker",
    )


def test_click_index_gates_select_dropdown() -> None:
    """AI must not record 点击元素 for dropdown option / table-in-select rows."""
    misc = (ROOT / "scripts/controller/actions/_misc.py").read_text(encoding="utf-8")
    click = misc.split("async def click_element_by_index", 1)[1].split(
        "async def scroll_down", 1
    )[0]
    assert_true("use-select-option" in click, "hard gate code use-select-option")
    assert_true(
        ".el-select-dropdown" in click,
        "gate must detect el-select-dropdown ancestry",
    )
    assert_true(
        "table-row" in click and "el-table__row" in click,
        "gate must cover table-in-select rows",
    )
    assert_true(
        "select_option(label_text=" in click,
        "error must redirect agent to select_option",
    )
    # Gate before the real click / record path
    assert_true(
        click.find("use-select-option") < click.find("_click_element_node"),
        "gate must run before _click_element_node",
    )
    assert_true(
        click.find("use-select-option")
        < click.find("_state._record_action('click_element_by_index'"),
        "gate must run before recording click_element_by_index",
    )

    prompt = (ROOT / "scripts/prompts/agent-tools-form.md").read_text(encoding="utf-8")
    assert_true(
        "远程表格型下拉" in prompt and "select_option" in prompt,
        "prompt must forbid index-click on table-in-select",
    )


def main() -> int:
    test_select_option_table_row_js()
    test_click_index_gates_select_dropdown()
    print("characterize-select-table-row: OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
