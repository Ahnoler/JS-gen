#!/usr/bin/env python3
"""Manual recorder: dialog table row radio must not be silently dropped.

Bug: tableRadio branch returned early when tableRowIdentityText was empty
(common for radio-only / fixed columns in dialogs), so no step was emitted.
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))


def assert_true(cond: bool, msg: str) -> None:
    if not cond:
        raise AssertionError(msg)


def test_mapper_accepts_table_row_radio() -> None:
    from scripts.manual_recorder.mapper import _map_dom_event_to_action

    action, params, _el = _map_dom_event_to_action(
        {
            "kind": "click_table_row_radio",
            "row_text": "国讯网络有限公司",
            "xpath_smart": "//tr[.//*[normalize-space()='国讯网络有限公司']]",
            "xpath_abs": "/html/body/div/tr",
            "tag": "label",
            "target_kind": "table_row_radio",
            "attributes": {"class": "el-radio"},
            "text": "国讯网络有限公司",
        }
    )
    assert_true(action == "click_table_row_radio", action)
    assert_true(params.get("row_text") == "国讯网络有限公司", params)


def test_manual_js_does_not_silent_drop_empty_row() -> None:
    src = (ROOT / "scripts/manual_recorder/js_parts/b.py").read_text(encoding="utf-8")
    # Old bug: if (!rowText) return;  — drops the click entirely
    assert_true(
        "if (!rowText) return;" not in src
        and "if(!rowText)return;" not in src.replace(" ", ""),
        "table radio must not silent-return on empty rowText",
    )
    assert_true(
        "data-row-key" in src or "rowKey" in src or "row-index" in src,
        "must fall back to data-row-key / index when cell text missing",
    )


def test_table_row_identity_helper_mentions_dialog() -> None:
    # Identity helper lives in part A
    src = (ROOT / "scripts/manual_recorder/js_parts/a.py").read_text(encoding="utf-8")
    assert_true("function tableRowIdentityText" in src, "tableRowIdentityText present")


def main() -> int:
    test_mapper_accepts_table_row_radio()
    test_manual_js_does_not_silent_drop_empty_row()
    test_table_row_identity_helper_mentions_dialog()
    print("characterize-manual-table-radio: OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
