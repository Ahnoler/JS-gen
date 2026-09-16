#!/usr/bin/env python3
"""Pin phase-end stale-pending DOM refresh (ghost-prune pattern at quality gate).

弹窗/引入回填只记 evidence 不更新 task_list，收尾门禁纯内存读过期 pending 快照，
把 DOM 已有值的字段误判 pending_fields 质量失败。钉三件事：
1. service.py 收尾门禁首次不过 → refresh_pending_from_dom → 重跑 gate（顺序）；
2. pending_refresh.py 实读 DOM（JS_CHECK_SINGLE_FIELD）并 mark_done 写回真实值；
3. pending_fields:* 粘滞 reason 重生成发生在 QUALITY FAIL 输出之前，
   其余 reason（missing_success_token 等）不被重生成逻辑触碰。
"""

from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SERVICE = ROOT / "scripts/agent/service.py"
REFRESH = ROOT / "scripts/controller/actions/phase/pending_refresh.py"

GATE_CALL = "check_pending_write_gate(business_data_ref, section=_sec)"


def assert_true(cond: bool, msg: str) -> None:
    if not cond:
        raise AssertionError(msg)


def test_service_refresh_then_regate_order() -> None:
    src = SERVICE.read_text(encoding="utf-8")
    gate1 = src.find(GATE_CALL)
    assert_true(gate1 >= 0, "phase-end pending gate call present")
    refresh = src.find("refresh_pending_from_dom(")
    assert_true(refresh > gate1, "refresh called only after first gate run")
    guard = src[gate1:refresh]
    assert_true("not ok_pending" in guard, "refresh guarded by gate failure")
    regate = src.find(GATE_CALL, refresh)
    assert_true(regate > refresh, "gate re-run after DOM refresh")
    page_arg = src.find("browser_context=browser_context", regate)
    assert_true(page_arg > regate or "browser_context=browser_context" in src,
                "browser_context passed into _run_agent_step_post for page access")


def test_refresh_module_reads_dom_and_marks_done() -> None:
    assert_true(REFRESH.exists(), "pending_refresh.py exists")
    src = REFRESH.read_text(encoding="utf-8")
    assert_true(
        "from scripts.controller.actions.form_save import JS_CHECK_SINGLE_FIELD" in src,
        "reuses click_save ghost-prune JS_CHECK_SINGLE_FIELD (import-only)",
    )
    assert_true("filter_pending_labels" in src, "pending labels via filter_pending_labels")
    assert_true("label-not-found" in src, "not-found fields left untouched")
    assert_true("if not dom_value" in src, "empty DOM value left untouched")
    assert_true("mark_done(" in src, "DOM-verified fields written back via mark_done")
    assert_true("to_store()" in src, "corrected task_list persisted to store")


def test_reason_regen_before_quality_fail_output() -> None:
    src = SERVICE.read_text(encoding="utf-8")
    regen = src.find("regenerate_pending_field_reasons(")
    qf = src.find("QUALITY FAIL")
    assert_true(regen >= 0, "pending reason regeneration wired in service.py")
    assert_true(qf >= 0, "QUALITY FAIL output present")
    assert_true(regen < qf, "sticky reason regeneration precedes QUALITY FAIL output")
    mod = REFRESH.read_text(encoding="utf-8")
    assert_true("pending_fields:" in mod, "regenerator rewrites only pending_fields:*")
    assert_true(
        "missing_success_token" not in mod,
        "regenerator never touches non-pending reasons (missing_success_token intact)",
    )
    assert_true(
        "mark_quality_failed(business_data_ref, 'missing_success_token')" in src,
        "missing_success_token judgment unchanged in service.py",
    )


def main() -> int:
    test_service_refresh_then_regate_order()
    test_refresh_module_reads_dom_and_marks_done()
    test_reason_regen_before_quality_fail_output()
    print("characterize-phase-end-pending-refresh: OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
