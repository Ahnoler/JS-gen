#!/usr/bin/env python3
"""Field labels that contain 查询 must not sign a fill phase as query.

Incident sid 6038ecfa phase 6: 「选择证件到期日/授权日期，点击查询事由、查询类型。
预期结果：表单字段填写完成。」 matched is_query_task via 查询事由/查询类型.
success_when=['query_clicked'] rejected done() twice; phase 7 「点击【确认】」
never ran, so the confirm click was never recorded.

Pin: that fill phase is maintain with empty success_when (done while the dialog
stays open). The following confirm phase names button 确认 (not the create
default 保存) and still requires a save token. A real 「点击查询」 stays query.
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.controller.actions.phase.boundary_contract import (  # noqa: E402
    boundary_to_legacy_intent,
    compile_boundary,
    contract_summary_hint_boundary,
)
from scripts.controller.actions.phase.boundary_gates import phase_done_ok  # noqa: E402
from scripts.controller.actions.phase.classify import (  # noqa: E402
    classify_task_mode,
    is_query_task,
)
from scripts.controller.actions.phase.intent_contract import compile_phase_intent  # noqa: E402

PHASE6 = (
    '在“证件到期日”日期控件中选择一个日期，在“授权日期”日期控件中选择一个日期，'
    '点击“查询事由”下拉框选择查询事由值，点击“查询类型”下拉框选择查询类型值。'
    '预期结果：表单字段填写完成。'
)
PHASE7 = (
    '点击【确认】按钮。预期结果：保存新增的征信查询客户信息并抵达征信查询客户列表。'
)


def assert_true(cond: bool, msg: str) -> None:
    if not cond:
        raise AssertionError(msg)


def main() -> int:
    assert_true(is_query_task(PHASE6) is False, 'phase6 field labels are not a query')
    assert_true(classify_task_mode(PHASE6) == 'form_fill', f'phase6 mode {classify_task_mode(PHASE6)}')
    b6 = compile_boundary(PHASE6)
    assert_true(b6['role'] == 'maintain', f"phase6 role {b6['role']}")
    assert_true(b6['success_when'] == [], f"phase6 success_when {b6['success_when']}")
    assert_true('save_form' not in b6['goals'], 'phase6 must not require save')
    assert_true(b6['submit_button'] == '', 'phase6 has no submit button')
    hint6 = contract_summary_hint_boundary(b6)
    assert_true('不要点确认' in hint6, 'phase6 hint must forbid confirm')
    assert_true('保存成功' not in hint6, 'phase6 hint must not demand save success')
    c6 = boundary_to_legacy_intent(b6)
    assert_true(c6['submit']['required'] is False, 'phase6 submit not required')
    assert_true(c6['success']['kinds'] == [], 'phase6 legacy kinds empty')
    store6 = {'_phase_boundary': b6, '_evidence_observed': [
        'dialog_confirmed', 'introduced_backfilled', 'picker_closed',
    ]}
    ok6, missing6 = phase_done_ok(store6)
    assert_true(ok6 and missing6 == [], f'phase6 done must pass with dialog still open: {missing6}')
    i6 = compile_phase_intent(PHASE6)
    assert_true(i6['mode'] == 'create' and i6['submit']['required'] is False, 'intent phase6 fill-only')

    assert_true(is_query_task(PHASE7) is False, 'phase7 征信查询 in the result is not a query')
    b7 = compile_boundary(PHASE7)
    assert_true(b7['role'] == 'maintain', f"phase7 role {b7['role']}")
    assert_true('toast_ok' in b7['success_when'], f"phase7 tokens {b7['success_when']}")
    assert_true(b7['submit_button'] == '确认', f"phase7 button {b7['submit_button']}")
    c7 = boundary_to_legacy_intent(b7)
    assert_true(c7['submit']['required'] is True, 'phase7 must submit')
    assert_true(c7['submit']['button_text'] == '确认', f"phase7 legacy button {c7['submit']}")
    assert_true('click_save(button_text="确认")' in c7['recovery']['next_action'], 'phase7 recovery names 确认')
    i7 = compile_phase_intent(PHASE7)
    assert_true(i7['submit']['button_text'] == '确认', f"intent phase7 button {i7['submit']}")

    real = '在查询条件中选择查询类型后点击查询'
    assert_true(is_query_task(real) is True, 'selecting 查询类型 then 点击查询 stays query')
    br = compile_boundary(real)
    assert_true(br['success_when'] == ['query_clicked'], f"real query tokens {br['success_when']}")

    save_create = compile_boundary('新增客户并点击保存。预期结果：保存成功。')
    assert_true(save_create['submit_button'] == '保存', 'create 点击保存 stays 保存')
    save_modify = compile_boundary('修改客户名称后点击保存。预期结果：保存成功。')
    assert_true(save_modify['submit_button'] == '保存', 'modify 点击保存 follows the action clause')

    print('characterize-query-field-not-query: OK')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
