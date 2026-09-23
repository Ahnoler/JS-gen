#!/usr/bin/env python3
"""Action-clause priority, with next-phase handoff only when this phase is silent.

Field names that contain 查询 are not a denylist. A dropdown operation is not a
query; 「按查询类型筛选」still is. The same rule covers save, next-step, login,
and introduce: an explicit action in this phase stays, and a token is handed to
the next catalog phase only when this phase never performs that action.
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.controller.actions.phase.boundary_contract import (  # noqa: E402
    compile_boundary,
)
from scripts.controller.actions.phase.boundary_gates import phase_done_ok  # noqa: E402
from scripts.controller.actions.phase.classify import (  # noqa: E402
    classify_task_mode,
    is_query_task,
)
from scripts.controller.actions.phase.intent_contract import (  # noqa: E402
    apply_phase_intent,
    compile_phase_intent,
)

PHASE6 = (
    '在“证件到期日”日期控件中选择一个日期，在“授权日期”日期控件中选择一个日期，'
    '点击“查询事由”下拉框选择查询事由值，点击“查询类型”下拉框选择查询类型值。'
    '预期结果：表单字段填写完成。'
)
PHASE7 = (
    '点击【确认】按钮。预期结果：保存新增的征信查询客户信息并抵达征信查询客户列表。'
)
PHASE6_NO_WIDGET = (
    '选择查询事由和查询类型的值。预期结果：表单字段填写完成。'
)


def assert_true(cond: bool, msg: str) -> None:
    if not cond:
        raise AssertionError(msg)


def _intent(text: str, phases: list, number: int) -> dict:
    store: dict = {}
    contract = apply_phase_intent(store, text, all_phases=phases, current_phase_number=number)
    assert_true(contract is not None, 'contract')
    boundary = store.get('_phase_boundary') or {}
    return {
        'mode': contract.get('mode'),
        'role': boundary.get('role'),
        'success': list(boundary.get('success_when') or []),
        'submit': bool((contract.get('submit') or {}).get('required')),
        'button': (contract.get('submit') or {}).get('button_text'),
        'query_task': store.get('_query_task'),
        'task_mode': store.get('_task_mode'),
    }


def main() -> int:
    # 控件结构遮罩：阶段 6 不靠字段名黑名单，也不靠目录。
    assert_true(is_query_task(PHASE6) is False, 'phase6 widget ops are not a query')
    assert_true(classify_task_mode(PHASE6) == 'form_fill', f'phase6 mode {classify_task_mode(PHASE6)}')
    b6 = compile_boundary(PHASE6)
    assert_true(b6['role'] == 'maintain' and b6['success_when'] == [], f'phase6 boundary {b6["role"]} {b6["success_when"]}')
    ok6, missing6 = phase_done_ok({'_phase_boundary': b6, '_evidence_observed': []})
    assert_true(ok6 and missing6 == [], f'phase6 done {missing6}')

    # 没有「下拉框」时，目录里下一阶段的确认把查询令牌拿走。
    catalog = [
        {'phaseNumber': 6, 'description': PHASE6_NO_WIDGET},
        {'phaseNumber': 7, 'description': PHASE7},
    ]
    handed = _intent(PHASE6_NO_WIDGET, catalog, 6)
    assert_true(handed['role'] == 'maintain', f'ambiguous fill handed off {handed}')
    assert_true(handed['success'] == [], f'ambiguous fill has no token {handed}')
    assert_true(handed['submit'] is False, 'ambiguous fill does not submit')
    assert_true(handed['query_task'] is False, 'query flag cleared')

    # 按查询类型筛选，下一阶段是修改：仍然是查询。
    query_catalog = [
        {'phaseNumber': 1, 'description': '按查询类型筛选待发起记录。预期结果：列表只显示待发起。'},
        {'phaseNumber': 2, 'description': '选中首条记录，点击【修改】。预期结果：进入详情。'},
    ]
    stayed = _intent(query_catalog[0]['description'], query_catalog, 1)
    assert_true(stayed['role'] == 'query', f'查询类型 as a filter stays query {stayed}')
    assert_true(stayed['success'] == ['query_clicked'], f'filter keeps query_clicked {stayed}')

    # 本阶段写了点击查询，下一阶段是修改，不能改判。
    click_catalog = [
        {'phaseNumber': 1, 'description': '点击【查询】按钮。预期结果：列表刷新。'},
        {'phaseNumber': 2, 'description': '选中首条记录，点击【修改】。'},
    ]
    clicked = _intent(click_catalog[0]['description'], click_catalog, 1)
    assert_true(clicked['success'] == ['query_clicked'], f'explicit 点击查询 stays {clicked}')

    # 本阶段只设查询类型，下一阶段才点击查询。
    setup_catalog = [
        {'phaseNumber': 1, 'description': '选择查询类型为对公。预期结果：条件已设置。'},
        {'phaseNumber': 2, 'description': '点击【查询】按钮。预期结果：列表展示对公客户。'},
    ]
    setup = _intent(setup_catalog[0]['description'], setup_catalog, 1)
    assert_true(setup['success'] == [], f'setup must not demand query_clicked {setup}')
    assert_true(setup['query_task'] is False, 'setup is not a query task')

    # 阶段 7 的确认仍要保存，按钮是确认。征信查询在预期结果里不是查询。
    assert_true(is_query_task(PHASE7) is False, 'phase7 result text is not a query')
    b7 = compile_boundary(PHASE7)
    assert_true(b7['role'] == 'maintain', f'phase7 role {b7["role"]}')
    assert_true('toast_ok' in b7['success_when'], f'phase7 tokens {b7["success_when"]}')
    assert_true(b7['submit_button'] == '确认', f'phase7 button {b7["submit_button"]}')
    i7 = compile_phase_intent(PHASE7)
    assert_true(i7['submit']['button_text'] == '确认', f'intent button {i7["submit"]}')
    kept = _intent(PHASE7, catalog, 7)
    assert_true(kept['submit'] is True and kept['button'] == '确认', f'phase7 keeps confirm {kept}')

    # 保存只写在预期里，下一阶段才点击保存。
    save_catalog = [
        {'phaseNumber': 1, 'description': '填写证件到期日。预期结果：保存成功。'},
        {'phaseNumber': 2, 'description': '填写备注并点击【保存】按钮。预期结果：回到列表。'},
    ]
    early = _intent(save_catalog[0]['description'], save_catalog, 1)
    assert_true(early['submit'] is False and early['success'] == [], f'save click stays on next phase {early}')
    own = _intent(save_catalog[1]['description'], save_catalog, 2)
    assert_true(own['submit'] is True and own['button'] == '保存', f'next phase still saves {own}')

    # 本阶段写了点击保存，不能被下一阶段拿走。
    both_save = [
        {'phaseNumber': 1, 'description': '填写后点击保存。预期结果：保存成功。'},
        {'phaseNumber': 2, 'description': '点击【保存】按钮。'},
    ]
    mine = _intent(both_save[0]['description'], both_save, 1)
    assert_true(mine['submit'] is True, f'explicit save stays {mine}')

    # 下一步写在下一阶段。
    step_catalog = [
        {'phaseNumber': 1, 'description': '设置评级条件。预期结果：进入下一步。'},
        {'phaseNumber': 2, 'description': '点击【下一步】按钮。预期结果：进入风险阻断。'},
    ]
    step = _intent(step_catalog[0]['description'], step_catalog, 1)
    assert_true('nav_next_clicked' not in step['success'], f'next click not required here {step}')
    step2 = _intent(step_catalog[1]['description'], step_catalog, 2)
    assert_true('nav_next_clicked' in step2['success'], f'explicit next stays {step2}')

    # 打开登录页，登录在下一阶段。
    login_catalog = [
        {'phaseNumber': 1, 'description': '打开登录页面。预期结果：抵达登录页面。'},
        {'phaseNumber': 2, 'description': '输入账号和密码，点击登录。预期结果：进入首页。'},
    ]
    login_open = compile_boundary(login_catalog[0]['description'], all_phases=login_catalog, current_phase_number=1)
    assert_true(login_open['role'] == 'navigate', f'open login page is navigate {login_open["role"]}')
    assert_true(classify_task_mode('登录系统。预期结果：进入首页。') == 'login', '登录系统 stays login')
    assert_true(classify_task_mode('使用账号登录系统') == 'login', '账号登录 stays login')

    # 客户类型下拉不是引入；选人确定仍是引入。
    dropdown = compile_boundary('点击“客户类型”下拉框选择客户类型值。预期结果：客户类型已选择。')
    assert_true(dropdown['role'] != 'introduce', f'客户类型 dropdown is not introduce {dropdown["role"]}')
    pick = compile_boundary('在客户选择窗口中搜索并选中目标客户，点击【确定】。预期结果：客户信息自动回填。')
    assert_true(pick['role'] == 'introduce', f'picker confirm stays introduce {pick["role"]}')

    # 修改必须在动作子句里。预期里的填写完成不把阶段改成修改。
    assert_true(classify_task_mode(PHASE6) == 'form_fill', 'phase6 is fill, not modify')
    assert_true(classify_task_mode('修改客户状态为潜在') == 'form_modify', 'explicit modify stays')

    # 真查询不放宽。
    assert_true(is_query_task('在查询条件中选择查询类型后点击查询') is True, '点击查询 stays query')
    assert_true(is_query_task('查询产品信息') is True, '查询产品信息 stays query')
    assert_true(
        compile_boundary('新增客户并点击保存。预期结果：保存成功。')['submit_button'] == '保存',
        'create 点击保存 stays 保存',
    )

    print('characterize-query-field-not-query: OK')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
