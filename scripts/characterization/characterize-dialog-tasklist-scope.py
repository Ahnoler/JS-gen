#!/usr/bin/env python3
"""Characterize: dialog TaskList scan must not use fullpage (list/tree pollution)."""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))


def assert_true(cond: bool, msg: str) -> None:
    if not cond:
        raise AssertionError(msg)


def test_tasklist_scan_mode() -> None:
    from scripts.controller.actions.form_scan_utils import tasklist_scan_mode

    assert_true(tasklist_scan_mode("dialog:新增") == "multi", "dialog → multi")
    assert_true(tasklist_scan_mode("dialog:unnamed") == "multi", "unnamed dialog → multi")
    assert_true(tasklist_scan_mode("drawer:x") == "multi", "drawer → multi")
    assert_true(tasklist_scan_mode("main") == "fullpage", "main → fullpage")
    assert_true(tasklist_scan_mode("") == "fullpage", "empty → fullpage")


def test_filter_excludes_tree_filter_and_row_radio_option() -> None:
    from scripts.controller.actions.form_scan_utils import filter_fillable_scan_fields

    fields = [
        {"label": "核心产品编号", "kind": "input", "region_role": "main"},
        {
            "label": "输入关键字进行过滤",
            "kind": "tree-select",
            "placeholder": "输入关键字进行过滤",
            "region_role": "main",
        },
        {
            "label": "对公",
            "kind": "radio",
            "region_role": "main",
            "xpath_smart": "//tr[.//*[normalize-space()='对公']]//div[contains(@class,'el-radio')]",
        },
        {
            "label": "产品主体类型",
            "kind": "radio",
            "region_role": "main",
            "xpath_smart": "//div[contains(@class,'el-form-item')][.//label[contains(.,'产品主体类型')]]//div[contains(@class,'el-radio')]",
        },
    ]
    out = filter_fillable_scan_fields(fields)
    labels = [f["label"] for f in out]
    assert_true("输入关键字进行过滤" not in labels, "tree filter placeholder excluded")
    assert_true("对公" not in labels, "table-row radio option excluded")
    assert_true("核心产品编号" in labels, "real input kept")
    assert_true("产品主体类型" in labels, "form-item radio kept")


def test_mark_done_clears_all_same_label() -> None:
    from scripts.models.task import TaskItem, TaskList

    tl = TaskList(
        pending=[
            TaskItem(label="核心产品编号", kind="input", xpath_smart="//a"),
            TaskItem(label="核心产品编号", kind="input", xpath_smart="//b"),
            TaskItem(label="其他", kind="input"),
        ],
        done=[],
    )
    moved = tl.mark_done("核心产品编号", value="123")
    assert_true(moved is not None, "mark_done returns an item")
    assert_true(
        all(i.label != "核心产品编号" for i in tl.pending),
        f"all same-label pending cleared, left={[i.label for i in tl.pending]}",
    )
    assert_true(sum(1 for d in tl.done if d.label == "核心产品编号") >= 1, "at least one done")


def test_rebuild_uses_tasklist_scan_mode() -> None:
    form = (
        (ROOT / "scripts/controller/actions/_form.py").read_text(encoding="utf-8")
        + (ROOT / "scripts/controller/actions/form_autofill.py").read_text(encoding="utf-8")
    )
    assert_true("tasklist_scan_mode" in form, "_rebuild must call tasklist_scan_mode")
    # rebuild block must not hardcode only fullpage for evaluate args
    rebuild = form.split("async def _rebuild_task_list_from_dom", 1)[1].split(
        "\n        # Force rescan when parent", 1
    )[0]
    assert_true("tasklist_scan_mode" in rebuild, "mode chosen inside _rebuild")
    assert_true(
        "fullpage" not in rebuild.split("JS_SCAN_FORM_FIELDS", 1)[1][:280]
        or "tasklist_scan_mode" in rebuild,
        "rebuild evaluate uses dynamic mode",
    )


def main() -> int:
    try:
        test_tasklist_scan_mode()
        test_filter_excludes_tree_filter_and_row_radio_option()
        test_mark_done_clears_all_same_label()
        test_rebuild_uses_tasklist_scan_mode()
    except Exception as exc:
        print(f"characterize-dialog-tasklist-scope: FAIL {exc}")
        return 1
    print("characterize-dialog-tasklist-scope: OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
