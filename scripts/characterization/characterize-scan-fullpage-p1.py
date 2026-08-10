#!/usr/bin/env python3
"""Characterize P1: form scan/assistant use fullpage L2; shell excluded from fillable."""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

FORM_PY = ROOT / "scripts/controller/actions/_form.py"


def assert_true(cond: bool, msg: str) -> None:
    if not cond:
        raise AssertionError(msg)


def _norm(s: str) -> str:
    return s.replace(" ", "").replace("\n", "")


def test_filter_fillable_excludes_shell() -> None:
    from scripts.controller.actions.form_scan_utils import filter_fillable_scan_fields

    fields = [
        {"label": "客户名称", "kind": "input", "region_role": "main", "disabled": False},
        {"label": "系统管理", "kind": "menu_item", "region_role": "shell-aside"},
        {"label": "设置", "kind": "icon", "region_role": "shell-header"},
        {"label": "顶栏输入", "kind": "input", "region_role": "shell-header", "disabled": False},
        {"label": "侧栏搜索", "kind": "input", "region_role": "shell-aside", "disabled": False},
    ]
    out = filter_fillable_scan_fields(fields)
    labels = [f["label"] for f in out]
    assert_true(labels == ["客户名称"], f"fillable must exclude shell/menu/icon, got {labels}")


def test_form_scan_callers_use_fullpage_mode() -> None:
    form = FORM_PY.read_text(encoding="utf-8")
    norm = _norm(form)
    # Product paths: scan_editable_summary + scan_form_fields + rebuild/assistant
    # Match evaluate(JS_SCAN_FORM_FIELDS, [..., {'mode':'fullpage'}]) style
    pattern = re.compile(
        r"page\.evaluate\(\s*JS_SCAN_FORM_FIELDS\s*,\s*\[[^\]]*'mode'\s*:\s*'fullpage'[^\]]*\]",
        re.DOTALL,
    )
    # Also allow double quotes / True/False variants after norm
    hits = []
    # Count distinct function bodies that pass fullpage to JS_SCAN_FORM_FIELDS
    for m in re.finditer(
        r"JS_SCAN_FORM_FIELDS[\s\S]{0,200}?mode['\"]?\s*:\s*['\"]fullpage['\"]",
        form,
    ):
        hits.append(m.start())
    assert_true(
        len(hits) >= 3,
        f"expected >=3 JS_SCAN_FORM_FIELDS call sites with mode fullpage "
        f"(summary + scan_form_fields + rebuild/assistant), got {len(hits)}",
    )
    assert_true(
        "async def scan_form_fields" in form,
        "scan_form_fields must exist",
    )
    # scan_form_fields body must include fullpage near its evaluate
    body = form.split("async def scan_form_fields", 1)[1]
    end = body.find("\n    @controller.action")
    if end < 0:
        end = body.find("\n    async def ")
    body = body[: end if end >= 0 else 2500]
    assert_true(
        "fullpage" in body,
        "scan_form_fields must pass mode fullpage",
    )
    assert_true(
        "filter_fillable_scan_fields" in form,
        "_form.py must call filter_fillable_scan_fields before TaskList",
    )


def test_rebuild_or_assistant_uses_fullpage() -> None:
    form = FORM_PY.read_text(encoding="utf-8")
    assert_true(
        "_rebuild_task_list_from_dom" in form or "run_form_assistant" in form,
        "rebuild or assistant path present",
    )
    if "async def _rebuild_task_list_from_dom" in form:
        chunk = form.split("async def _rebuild_task_list_from_dom", 1)[1][:2500]
        # Overlay TaskList uses tasklist_scan_mode (multi for dialog/drawer;
        # fullpage only for main). Summary/scan_form_fields stay fullpage.
        assert_true(
            "tasklist_scan_mode" in chunk and "prepare_scan_fields_for_tasklist" in chunk,
            "_rebuild_task_list_from_dom must use tasklist_scan_mode + fillable prepare",
        )
    if "async def run_form_assistant" in form:
        chunk = form.split("async def run_form_assistant", 1)[1]
        end = chunk.find("\n    @controller.action")
        chunk = chunk[: end if end >= 0 else 4000]
        # Assistant batches via _ensure_scanned → _rebuild; body may not re-evaluate.
        assert_true(
            "_ensure_scanned" in chunk or "tasklist_scan_mode" in chunk or "filter_fillable_scan_fields" in chunk,
            "run_form_assistant must go through _ensure_scanned (scoped rebuild) or scan itself",
        )


def main() -> int:
    try:
        test_filter_fillable_excludes_shell()
    except Exception as exc:
        print(f"characterize-scan-fullpage-p1: FAIL filter: {exc}")
        return 1
    try:
        test_form_scan_callers_use_fullpage_mode()
        test_rebuild_or_assistant_uses_fullpage()
    except Exception as exc:
        print(f"characterize-scan-fullpage-p1: FAIL wiring: {exc}")
        return 1
    print("characterize-scan-fullpage-p1: OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
