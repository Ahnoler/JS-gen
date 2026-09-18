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

2026-09-18 冲突普查扩展（S1/S2/S2b/S3 同族「done 被拒死循环」隐患一并钉死）：
- S1 条件路径硬排除词表缺 新增/录入/维护（条件路径先于 _QUERY_EXCLUDE_RE 生效）；
- S2 查询词只落在预期结果子句（名词性观察描述，动作子句无查询语义）；
- S2b 动作子句为「打开…页面」导航、页面名恰好含查询词（落 open_page/navigate）；
- S3 查询排除词表缺 维护/更新/变更（维护族被误判 query，is_modify_task 被先否决）。
真查询反例（动作子句含查询词）必须仍判 query 且合同仍 ['query_clicked']。
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.controller.actions.phase.boundary_contract import compile_boundary  # noqa: E402
from scripts.controller.actions.phase.classify import (  # noqa: E402
    classify_task_mode,
    is_query_task,
)

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

    # Compound query+reset phases keep the query contract: the flow genuinely
    # clicks 查询 so query_clicked is producible — the reset exclusion must
    # only fire when no explicit query action is present (otherwise such texts
    # fall through to a maintain contract whose toast/url tokens a query-reset
    # flow can never produce — a fresh done-loop of the same family).
    compound = "填写查询条件并点击查询，然后点击重置按钮恢复默认。"
    assert_true(
        is_query_task(compound),
        "compound fill+query+reset must stay query when an explicit query action is present",
    )
    bc = compile_boundary(compound)
    assert_true(bc["role"] == "query", f"compound boundary role must be query, got {bc['role']!r}")
    assert_true(
        bc["success_when"] == ["query_clicked"],
        f"compound boundary must keep query_clicked, got {bc['success_when']!r}",
    )
    assert_true(
        is_query_task("点击查询执行检索，再点击重置。"),
        "query-then-reset compound must stay query",
    )

    # ------------------------------------------------------------------
    # 2026-09-18 冲突普查：S1/S2/S2b/S3 四族「query 合同 done 死循环」隐患。
    # 案例文本必须不判 query；真查询反例（动作子句含查询词）必须仍判 query
    # 且合同仍 ['query_clicked']（防过度排除）。

    # S1:「新增/录入/维护 + 查询条件」复合阶段 — 条件路径（classify.py，先于
    # _QUERY_EXCLUDE_RE 生效）的硬排除词表缺 新增/录入/维护，曾误判 query。
    s1_text = "新增评级申请后，在查询条件中输入客户名称并点击查询。"
    assert_true(
        not is_query_task(s1_text),
        "S1 新增+查询条件 复合阶段不得判 query",
    )

    # S2: 查询词只出现在预期结果子句（名词性观察描述；真实 few-shot 文本
    # src/services/trajectory/trajectory-meta-service.js:242）——动作子句无任何
    # 查询语义，不构成 query。
    s2_text = "点击【更多】按钮。预期结果：查询条件字段展开。"
    assert_true(
        not is_query_task(s2_text),
        "S2 查询词仅在预期结果子句不得判 query",
    )
    b_s2 = compile_boundary(s2_text)
    assert_true(
        b_s2["role"] != "query",
        f"S2 boundary role must not be query, got {b_s2['role']!r}",
    )

    # S2b: 动作子句为「打开…页面」导航、页面名恰好含查询词——落 open_page/
    # navigate 管辖（url_change/page_opened 令牌可产出），不签 query 合同。
    s2b_text = "打开查询中心页面。预期结果：抵达查询中心页面"
    assert_true(
        not is_query_task(s2b_text),
        "S2b 开页型导航（页面名含查询词）不得判 query",
    )
    b_s2b = compile_boundary(s2b_text)
    assert_true(
        b_s2b["role"] != "query",
        f"S2b boundary role must not be query, got {b_s2b['role']!r}",
    )

    # S3: 维护族文本 — _QUERY_EXCLUDE_RE 缺 维护/更新/变更，曾被判 query 且
    # is_modify_task 被 is_query_task 先否决。（普查原例「维护客户信息：查询
    # 定位后修改」因含 修改 已被既有词表排除；此处钉 真隐患变体 维护/更新。）
    s3_text = "维护客户信息，查询定位后更新联系人资料。"
    assert_true(
        not is_query_task(s3_text),
        "S3 维护族阶段不得判 query",
    )
    assert_true(
        classify_task_mode(s3_text) == "form_modify",
        f"S3 维护族文本应分类 form_modify, got {classify_task_mode(s3_text)!r}",
    )

    # 反例（防过度排除）：动作子句含查询词的真查询文本必须仍判 query，
    # 合同仍 ['query_clicked']——预期结果子句是名词性列表描述，不触发排除。
    # 矩阵③回归（2026-09-18 全量 verify-all 抓到）：查询工具栏填条件、无显式
    # 查询动作——查询词仅落在预期结果子句，动作子句的「新增」只是下拉框取值。
    # 曾因 fill 词表命中「新增」误落 form_fill/maintain（toast/save 保存合同在
    # 查询工具栏永不可满足=死循环同族）；is_fill_task 的查询条件排除后须落
    # other 免令牌（pin cold/characterize-ai-phase-element-guard 同文本同步修订）。
    toolbar_fill = (
        "在“审批状态”下拉框中选择“通过”，在“评级发生类型”下拉框中选择“新增”，"
        "在“申请日期”日期控件中分别选择开始日期和结束日期。预期结果：查询条件填写完成。"
    )
    assert_true(
        classify_task_mode(toolbar_fill) == "other",
        f"查询工具栏填条件（无显式查询动作）应落 other, got {classify_task_mode(toolbar_fill)!r}",
    )
    b_tf = compile_boundary(toolbar_fill)
    assert_true(
        b_tf["role"] == "other" and b_tf["success_when"] == [],
        f"查询工具栏填条件合同应为 other/无令牌, got {b_tf['role']!r}/{b_tf['success_when']!r}",
    )

    for genuine in (
        "按客户名称查询。预期结果：列表展示匹配客户。",
        "查询客户信息。预期结果：列表出现该客户。",
        '在客户名称搜索框中输入"测试客户"进行搜索。预期结果：显示搜索结果列表。',
    ):
        assert_true(
            is_query_task(genuine),
            f"genuine query (action clause has query verb) must stay query: {genuine}",
        )
        b_genuine = compile_boundary(genuine)
        assert_true(
            b_genuine["role"] == "query",
            f"genuine query boundary role must stay query: {genuine} -> {b_genuine['role']!r}",
        )
        assert_true(
            b_genuine["success_when"] == ["query_clicked"],
            f"genuine query boundary must keep query_clicked: {genuine} -> {b_genuine['success_when']!r}",
        )

    print("characterize-reset-phase-not-query: all passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
