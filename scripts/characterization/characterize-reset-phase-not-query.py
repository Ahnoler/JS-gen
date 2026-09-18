#!/usr/bin/env python3
"""Lightweight characterization: reset/clear phases are NOT query phases.

Real-run incident 2026-09-17 (对公客户评级 phase 3, done rejected 6x + budget
extend +42): task text 「点击【重置】按钮。预期结果：清空所有查询条件字段并恢复
默认状态。」 matched is_query_task purely because 预期结果 mentions 查询条件 —
the boundary compiled to role='query' with success_when=['query_clicked'], a
token a reset action can never produce (only clicking 查询/搜索 records it), so
every done() was rejected forever while the reviewer had correctly said
mode=other with no token required.

Pin: reset/clear wording excludes a phase from the query contract (falls back
to role='other', success_when=[] → done freely allowed), while genuine query
phases keep the query_clicked token (G3 hardened, no loosening there).
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.controller.actions.phase.boundary_contract import compile_boundary  # noqa: E402
from scripts.controller.actions.phase.classify import is_query_task  # noqa: E402

INCIDENT_TEXT = "点击【重置】按钮。预期结果：清空所有查询条件字段并恢复默认状态。"


def assert_true(cond: bool, msg: str) -> None:
    if not cond:
        raise AssertionError(msg)


def main() -> int:
    # Incident text (and its culprit 预期结果 fragment) must not be a query task.
    assert_true(not is_query_task(INCIDENT_TEXT), "incident reset phase must not classify as query")
    assert_true(
        not is_query_task("清空所有查询条件字段并恢复默认状态"),
        "clear-conditions wording alone must not classify as query",
    )
    # Trajectory-title style (#831 「2 查询条件重置」).
    assert_true(not is_query_task("查询条件重置"), "reset-titled phase must not classify as query")

    # The incident boundary compiles to role=other with NO success token.
    b = compile_boundary(INCIDENT_TEXT)
    assert_true(b["role"] == "other", f"incident boundary role must be other, got {b['role']!r}")
    assert_true(
        b["success_when"] == [],
        f"incident boundary success_when must be empty, got {b['success_when']!r}",
    )

    # Genuine query phases keep the hardened contract (no loosening here).
    assert_true(is_query_task("查询产品信息"), "genuine query task must stay query")
    assert_true(
        is_query_task("在查询条件中输入编号并点击查询"),
        "query-condition fill+search must stay query",
    )
    bq = compile_boundary("在查询条件中输入编号并点击查询")
    assert_true(bq["role"] == "query", "genuine query boundary role must stay query")
    assert_true(
        bq["success_when"] == ["query_clicked"],
        f"genuine query boundary must still demand query_clicked, got {bq['success_when']!r}",
    )

    print("characterize-reset-phase-not-query: all passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
