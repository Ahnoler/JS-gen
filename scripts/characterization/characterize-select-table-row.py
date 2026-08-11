#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Characterize TsscMultiSelect table-row options in JS_SELECT_OPTION / CTRL.

客户名称-style remote selects render ``tr.el-table__row`` inside the
el-select-dropdown (not ``.el-select-dropdown__item``). Without a table-row
fallback, select_option returns no-items and agents fall back to ephemeral
index clicks that cannot bind formData.
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


def main() -> int:
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
    print("characterize-select-table-row: OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
