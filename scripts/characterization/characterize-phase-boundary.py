#!/usr/bin/env python3
"""Characterization for Phase Boundary contract (AI_PHASE_BOUNDARY)."""

from __future__ import annotations

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

# Force boundary on for this smoke
os.environ['AI_PHASE_BOUNDARY'] = '1'

from scripts.actions._phase_boundary import (  # noqa: E402
    apply_phase_boundary,
    compile_boundary,
    is_picker_context,
    maybe_record_picker_closed,
    phase_done_ok,
    record_evidence,
    should_block_index_submit_boundary,
)
from scripts.actions._phase_intent import (  # noqa: E402
    apply_phase_intent,
    check_pending_write_gate,
    has_contract_success,
    should_block_index_submit,
)


def assert_true(cond: bool, msg: str) -> None:
    if not cond:
        raise AssertionError(msg)


def main() -> int:
    b = compile_boundary('进入对公客户管理页面。预期结果：打开对公客户管理列表页面。')
    assert_true(b.get('role') == 'navigate', 'boundary navigate for open-page')
    assert_true(b.get('requires_write_all_editable') is False, 'no write-all on navigate')

    mixed = (
        '新增一个信贷潜在客户，点击保存。（如果出现法定代表人/负责人证件号码的引入按钮，'
        '那么该法定责任人的客户名称填写朱桂武，点击查询，选择一个客户，点击确认。'
        '预期结果：完成引入流程）预期结果：新增信贷潜在客户并保存成功。'
    )
    b_mixed = compile_boundary(mixed)
    assert_true(b_mixed['role'] == 'maintain', 'mixed → maintain')
    assert_true(b_mixed['requires_introduce_then_save'] is True, 'mixed needs intro+save')
    assert_true(b_mixed['requires_write_all_editable'] is True, 'mixed refill')
    assert_true(b_mixed['picker_allowed'] is True, 'mixed picker allowed')

    store: dict = {}
    apply_phase_boundary(store, mixed)
    ok, missing = phase_done_ok(store)
    assert_true(not ok and 'introduce_evidence' in missing and 'save_evidence' in missing,
                f'mixed done blocked initially: {missing}')

    record_evidence(store, 'picker_closed', 'test')
    ok2, missing2 = phase_done_ok(store)
    assert_true(not ok2 and 'save_evidence' in missing2, 'intro alone not enough')
    record_evidence(store, 'toast_ok', '操作成功')
    ok3, missing3 = phase_done_ok(store)
    assert_true(ok3 and not missing3, 'intro+save enough')

    # Pure introduce
    intro = '点击法定代表人引入按钮，客户名称填写测试，点击查询，选择客户后确认。预期结果：完成引入流程。'
    b_intro = compile_boundary(intro)
    assert_true(b_intro['role'] == 'introduce', 'pure introduce role')
    store_i: dict = {}
    apply_phase_boundary(store_i, intro)
    record_evidence(store_i, 'picker_closed', 'x')
    ok_i, _ = phase_done_ok(store_i)
    assert_true(ok_i, 'introduce done on picker_closed')

    # Index submit rules
    assert_true(
        not should_block_index_submit_boundary(
            b_mixed, '确认', in_form_overlay=True, query_ui=True,
        ),
        'allow confirm on picker during maintain',
    )
    assert_true(
        should_block_index_submit_boundary(
            b_mixed, '保存', in_form_overlay=True, query_ui=True,
        ),
        'block 保存 on picker/query UI',
    )
    assert_true(
        should_block_index_submit_boundary(
            b_mixed, '保存', in_form_overlay=False, query_ui=False,
        ),
        'block 保存 on maintain via index',
    )

    assert_true(is_picker_context(query_ui=True), 'query_ui is picker')
    assert_true(
        is_picker_context(container_id='dialog:选择客户', dialog_title='选择客户'),
        'dialog title picker',
    )

    # picker_closed + stale parent
    store2: dict = {'_parent_container_before_picker': 'main', '_phase_boundary': b_mixed}
    assert_true(
        maybe_record_picker_closed(store2, still_query_ui=False, parent_container='main'),
        'record picker closed',
    )
    assert_true(store2.get('_form_stale') == 'main', 'parent stale')

    # apply_phase_intent adapter path
    store3: dict = {}
    c = apply_phase_intent(store3, mixed)
    assert_true(c and c.get('mode') == 'create', 'adapter create mode')
    assert_true(store3.get('_phase_boundary') is not None, 'boundary written')
    assert_true(c.get('_from_boundary') is True, 'from boundary flag')

    # Write gate via adapter
    store3['task_list'] = {
        'pending': [{'label': '客户名称', 'kind': 'input', 'currentValue': '', 'options': [],
                     'placeholder': '', 'disabled': False, 'required': True, 'hasButton': '',
                     'needs_intervention': False}],
        'done': [],
    }
    ok_g, labels = check_pending_write_gate(store3)
    assert_true(not ok_g and '客户名称' in labels, 'write gate blocks')

    # has_contract_success uses boundary
    store3['_evidence_observed'] = [
        {'kind': 'picker_closed'},
        {'kind': 'toast_ok'},
    ]
    assert_true(has_contract_success(store3), 'has_contract_success via boundary')

    # Legacy should_block with case_data_store
    assert_true(
        not should_block_index_submit(
            c, '确认', in_form_overlay=True, is_picker_ui=True, case_data_store=store3,
        ),
        'legacy wrapper allow picker confirm',
    )

    wizard = (
        '对公客户评级申请界面客户名称搜索为（恒通商贸有限公司），点击下一步。'
        '预期结果：成功进入下一步。'
    )
    b_wiz = compile_boundary(wizard)
    assert_true(b_wiz['role'] == 'navigate', 'wizard 搜索+下一步 → navigate')
    assert_true('click_next' in b_wiz['goals'], 'wizard goals click_next')
    assert_true(b_wiz['forbid_index_submit'] is False, 'wizard allow index next')

    # Maintain verbs must win over wizard keywords (wizard form steps keep refill semantics)
    b_form_wiz = compile_boundary('新增评级申请，填写基本信息，点击下一步，最后保存。')
    assert_true(b_form_wiz['role'] == 'maintain', 'form wizard step → maintain not navigate')
    b_mod_wiz = compile_boundary('修改客户信息，点击下一步。')
    assert_true(b_mod_wiz['role'] == 'maintain', 'modify+下一步 → maintain')

    # Open-page navigate:「点击评级申请。预期结果：打开评级申请相关页面」→ open_and_done
    open_t = (
        '进入评级管理-对公客户评级，选中客户名称（恒通商贸有限公司），点击评级申请。'
        '预期结果：打开评级申请相关页面。'
    )
    b_open = compile_boundary(open_t)
    assert_true(b_open['role'] == 'navigate', 'open-page → navigate role')
    assert_true('open_page' in b_open['goals'], 'open-page goal open_page')
    assert_true(b_open['forbid_index_submit'] is False, 'open-page allow index clicks')

    # 「抵达…页面」+ 【业务数据】suffix must NOT become form_fill / maintain
    from scripts.actions._phase_context import (
        classify_task_mode,
        is_open_page_task,
        needs_business_data_context,
        strip_business_data_block,
    )
    nav_biz = (
        '点击客户管理，点击对公客户管理。预期结果：抵达对公客户管理页面。\n\n'
        '【业务数据 — 来自用户需求（非系统回写案例数据）；填表时参考理解，按场景填写关键字段】\n'
        '关键数据\n对公客户基本信息\n        法定责任人引入 朱桂武'
    )
    assert_true(classify_task_mode(nav_biz) == 'other', 'nav+业务数据 → other not form_fill')
    assert_true(is_open_page_task(nav_biz), '抵达…页面 → open_page')
    b_nav = compile_boundary(nav_biz)
    assert_true(b_nav['role'] == 'navigate', 'nav+业务数据 → navigate role')
    assert_true('open_page' in b_nav['goals'], 'nav+业务数据 → open_page goal')
    assert_true(not needs_business_data_context(nav_biz), 'nav phase skips 业务数据 hint')
    assert_true('法定责任人' not in strip_business_data_block(nav_biz), 'strip removes value block')

    fill_biz = (
        '新增一个信贷潜在客户，点击保存。预期结果：跳转到基本信息页。\n\n'
        '【业务数据 — x】\n关键数据\n法定责任人引入 朱桂武'
    )
    assert_true(classify_task_mode(fill_biz) == 'form_fill', 'fill+业务数据 still form_fill')
    assert_true(needs_business_data_context(fill_biz), 'fill phase keeps 业务数据')

    # Customer-picker dialog (评级申请选客户) → introduce, not bare other
    pick_t = '在客户选择弹窗中选择目标对公客户。预期结果：选中目标客户并进入评级申请流程。'
    b_pick = compile_boundary(pick_t)
    assert_true(b_pick['role'] == 'introduce', '客户选择弹窗 → introduce')
    assert_true(b_pick['picker_allowed'] is True, 'picker allowed')

    # Maintain with「打开详情页面」expectation stays maintain
    b_m_open = compile_boundary('新增客户并保存。预期结果：保存成功后打开客户详情页面。')
    assert_true(b_m_open['role'] == 'maintain', 'maintain + open expectation → maintain')
    # Query with「打开…页面」expectation stays query
    b_q_open = compile_boundary('按客户名称查询。预期结果：打开查询结果页面。')
    assert_true(b_q_open['role'] == 'query', 'query + open expectation → query')
    # Save-to-open keeps 'other' (prompt rule 3: click_save → navigation → done)
    b_save_open = compile_boundary('确认信息无误，点击保存。预期结果：保存成功并进入列表页面。')
    assert_true(b_save_open['role'] == 'other', 'save-to-open → other not open_page')

    print('characterize-phase-boundary: OK')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
