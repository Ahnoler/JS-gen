"""Characterize AI-only phase element dedup and runtime query gate behavior."""

from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT))

from scripts.controller.actions.phase.element_guard import (  # noqa: E402
    duplicate_element_action,
    duplicate_phase_operation,
    duplicate_phase_operation_any,
    remember_successful_element_action,
    remember_successful_phase_operation,
    remember_phase_operation_aliases,
)
from scripts.controller.actions.phase.intent_contract import _clear_phase_form_state  # noqa: E402
from scripts.controller.actions.phase.classify import classify_task_mode  # noqa: E402
from scripts.controller.actions.phase.intent_gates import (  # noqa: E402
    check_pending_write_gate,
    has_contract_success,
)


class Result:
    def __init__(self, content: str, success=None):
        self.extracted_content = content
        self.success = success


def main() -> None:
    phase_four = (
        '在“审批状态”下拉框中选择“通过”，在“评级发生类型”下拉框中选择“新增”，'
        '在“申请日期”日期控件中分别选择开始日期和结束日期。预期结果：查询条件填写完成。'
    )
    assert classify_task_mode(phase_four) == 'query'

    store = {}
    remember_successful_element_action(store, '审批状态', 'select_option', Result('err-no-option', False))
    assert duplicate_element_action(store, '审批状态') == ''

    remember_successful_element_action(store, ' 审批 状态 ', 'select_option', Result('ok:通过'))
    assert duplicate_element_action(store, '审批状态') == 'select_option'
    remember_successful_element_action(store, '审批状态', 'fill_form_field', Result('ok:changed'))
    assert duplicate_element_action(store, '审批状态') == 'select_option'
    remember_successful_phase_operation(store, 'click://button[42]', 'click_element_by_index')
    assert duplicate_phase_operation(store, ' click://button[42] ') == 'click_element_by_index'
    remember_phase_operation_aliases(store, ['click://button[15]', 'button:查询'], 'click_element_by_index')
    assert duplicate_phase_operation_any(store, ['click://button[42]', 'button:查询']) == 'click_element_by_index'

    _clear_phase_form_state(store, mode='create', task_mode='form_fill')
    assert duplicate_element_action(store, '审批状态') == ''
    assert duplicate_phase_operation(store, 'click://button[42]') == ''

    query_store = {
        '_query_ui': True,
        '_phase_intent': {'mode': 'create', 'refill': 'all_editable'},
        '_phase_intent_flag_locked': True,
        '_phase_boundary': {
            'requires_write_all_editable': True,
            'success_when': ['toast_ok'],
        },
        '_phase_boundary_flag_locked': True,
        'task_list': {'pending': [{'label': '审批状态'}], 'done': []},
    }
    assert check_pending_write_gate(query_store) == (True, [])
    assert has_contract_success(query_store) is True

    picker_store = {
        '_query_ui': True,
        '_phase_intent': {
            'mode': 'introduce_pick',
            'refill': 'none',
            'success': {'kinds': ['picker_closed']},
        },
        '_phase_intent_flag_locked': True,
        '_phase_boundary': {'success_when': ['picker_closed']},
        '_phase_boundary_flag_locked': True,
    }
    assert has_contract_success(picker_store) is False
    print('characterize-ai-phase-element-guard: OK')


if __name__ == '__main__':
    main()
