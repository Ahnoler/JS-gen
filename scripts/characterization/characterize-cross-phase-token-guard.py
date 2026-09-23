"""Cross-phase token ownership guard (P4/P6/P7 overrun fix).

Pins the 2026-09-21 contract changes: open-picker-only stages must be navigate
(not introduce_pick), fill-only stages must not require save token, and the
save/confirm token belongs to the phase that actually performs the terminal action.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

# Force boundary on for this smoke
os.environ['AI_PHASE_BOUNDARY'] = '1'


def assert_true(cond, msg):
    if not cond:
        raise AssertionError(msg)


def main() -> int:
    from scripts.controller.actions.phase.boundary_contract import (
        apply_phase_boundary,
        boundary_to_legacy_intent,
        compile_boundary,
    )
    from scripts.controller.actions._phase_boundary import (
        get_phase_boundary,
        phase_done_ok,
    )
    from scripts.controller.actions._phase_intent import (
        apply_phase_intent,
        get_phase_intent,
    )
    from scripts.controller.actions.phase.intent_contract import apply_phase_contract

    all_phases = [
        {'phaseNumber': 1, 'description': '点击客户名称右侧的【引入】按钮。预期结果：打开客户选择窗口。'},
        {'phaseNumber': 2, 'description': '在客户选择窗口中搜索并选中目标客户，点击【确定】。预期结果：客户信息自动回填。'},
        {'phaseNumber': 3, 'description': '填写"证件到期日"与"授权日期"，选择"客户类型"与"客户等级"。预期结果：表单字段填写完成。'},
        {'phaseNumber': 4, 'description': '点击【确认】按钮。预期结果：保存客户信息并返回列表。'},
    ]

    # P4-like open-picker-only stage → navigate, no token.
    p4_text = all_phases[0]['description']
    b4 = compile_boundary(p4_text, all_phases=all_phases, current_phase_number=1)
    assert_true(b4['role'] == 'navigate', f'P4 open-picker role navigate, got {b4["role"]}')
    assert_true(set(b4['success_when']) == {'url_change', 'page_opened'}, f'P4 success_when page_opened/url_change, got {b4["success_when"]}')
    assert_true(b4['requires_write_all_editable'] is False, 'P4 no write-all')

    # Direct boundary application yields same shape.
    store4: dict = {}
    apply_phase_intent(store4, p4_text, all_phases=all_phases, current_phase_number=1)
    assert_true(get_phase_boundary(store4)['role'] == 'navigate', 'apply_phase_boundary P4 navigate')
    c4 = get_phase_intent(store4)
    assert_true(c4 and c4['mode'] == 'navigate', 'intent P4 navigate')
    assert_true(c4 and not c4['submit']['required'], 'intent P4 no submit')

    # P5 confirm stage → introduce, token required.
    p5_text = all_phases[1]['description']
    b5 = compile_boundary(p5_text, all_phases=all_phases, current_phase_number=2)
    assert_true(b5['role'] == 'introduce', f'P5 introduce role, got {b5["role"]}')
    assert_true('picker_closed' in b5['success_when'], f'P5 wants picker_closed, got {b5["success_when"]}')

    # P6 fill-only stage → maintain, refill all_editable, but NO save token.
    p6_text = all_phases[2]['description']
    b6 = compile_boundary(p6_text, all_phases=all_phases, current_phase_number=3)
    assert_true(b6['role'] == 'maintain', f'P6 maintain role, got {b6["role"]}')
    assert_true(b6['requires_write_all_editable'] is True, 'P6 all_editable')
    assert_true(b6['success_when'] == [], f'P6 empty success_when, got {b6["success_when"]}')

    store6: dict = {}
    apply_phase_intent(store6, p6_text, all_phases=all_phases, current_phase_number=3)
    c6 = get_phase_intent(store6)
    assert_true(c6 and c6['mode'] in ('create', 'modify'), f'P6 intent mode create/modify, got {c6}')
    assert_true(c6 and not c6['submit']['required'], 'P6 intent no submit required')
    assert_true(c6 and c6['success']['kinds'] == [], 'P6 intent empty success kinds')

    # P7 save stage: LLM-reviewed create contract with save terminal must keep
    # submit requirement (terminal action is actually in this phase).
    p7_text = all_phases[3]['description']
    store7: dict = {}
    create_save_contract = {
        'mode': 'create',
        'refill': 'none',
        'submit': {'required': True, 'via': 'click_save', 'button_text': '保存'},
        'success': {'kinds': ['toast_ok', 'saved_navigation'], 'evidence': []},
        'task_text_excerpt': p7_text,
        'source': 'llm',
    }
    boundary7 = compile_boundary(p7_text, all_phases=all_phases, current_phase_number=4)
    apply_phase_contract(
        store7,
        create_save_contract,
        boundary_override=boundary7,
        all_phases=all_phases,
        current_phase_number=4,
    )
    c7 = get_phase_intent(store7)
    assert_true(c7 and c7['submit']['required'], 'P7 create contract keeps submit required')
    assert_true(c7 and 'toast_ok' in c7['success']['kinds'], 'P7 keeps toast_ok success kind')

    # Cross-phase guard: if an LLM mistakenly returns introduce_pick for the
    # open-picker stage, apply_phase_contract downgrades it.
    store_llm: dict = {}
    fake_llm_contract = {
        'mode': 'introduce_pick',
        'refill': 'none',
        'submit': {'required': True, 'via': 'any', 'button_text': '确认'},
        'success': {'kinds': ['confirm_click', 'picker_closed'], 'evidence': []},
        'task_text_excerpt': p4_text,
        'source': 'llm',
    }
    from scripts.controller.actions.phase.intent_contract import apply_phase_contract
    from scripts.controller.actions._phase_boundary import boundary_to_legacy_intent
    boundary4 = compile_boundary(p4_text, all_phases=all_phases, current_phase_number=1)
    apply_phase_contract(
        store_llm,
        fake_llm_contract,
        boundary_override=boundary4,
        all_phases=all_phases,
        current_phase_number=1,
    )
    c_llm = get_phase_intent(store_llm)
    assert_true(c_llm and c_llm['mode'] == 'navigate', 'LLM introduce misclass downgraded to navigate')
    assert_true(c_llm and not c_llm['submit']['required'], 'downgraded contract no submit')

    # Without all_phases catalog, open-only is still recognized by text alone.
    b4_solo = compile_boundary(p4_text)
    assert_true(b4_solo['role'] == 'navigate', 'P4 navigate even without all_phases')

    print('characterize-cross-phase-token-guard: OK')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
