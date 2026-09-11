#!/usr/bin/env python3
"""Cold pins: contract sovereignty authority APIs (Task 1–3 subset)."""
from __future__ import annotations
import sys
from pathlib import Path
ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT))
from scripts.controller.actions._phase_intent import (
    apply_phase_contract,
    begin_recontract,
    get_active_contract,
    is_action_in_scope,
    should_block_index_submit,
    validate_done,
)

def main() -> int:
    bd: dict = {}
    c = {
        'mode': 'navigate',
        'allow_form_assistant': False,
        'refill': 'none',
        'goal': 'open list',
        'in_scope': ['open menu'],
        'out_of_scope': ['click edit'],
        'done_when': 'list visible',
        'submit': {'required': False, 'via': 'any', 'button_text': ''},
        'success': {'kinds': [], 'evidence': []},
    }
    apply_phase_contract(bd, c)
    active = get_active_contract(bd)
    assert active is not None, 'active contract missing'
    assert int(active.get('version', 0)) >= 1, 'version must be >= 1'
    assert get_active_contract({}) is None, 'empty bd -> None'
    print('characterize-contract-sovereignty Task1 OK')

    none_d = validate_done({})
    assert none_d.accepted is False, 'empty bd done must reject'
    assert 'no_contract' in none_d.reasons, 'empty bd -> no_contract'

    create_bd: dict = {}
    apply_phase_contract(create_bd, {
        'mode': 'create',
        'allow_form_assistant': True,
        'refill': 'all_editable',
        'goal': 'create row',
        'in_scope': ['fill form', 'save'],
        'out_of_scope': [],
        'done_when': 'saved',
        'submit': {'required': True, 'via': 'click_save', 'button_text': '保存'},
        'success': {'kinds': ['toast_ok'], 'evidence': []},
        'version': 1,
    })
    d = validate_done(create_bd)
    assert d.accepted is False, 'unfinished create must reject done'
    assert d.reasons == ('submit_required', 'success_unmet'), d.reasons
    assert d.missing_evidence == ('toast_ok',), d.missing_evidence
    assert d.remaining == (), d.remaining
    print('characterize-contract-sovereignty Task2 OK')

    save_params = {
        'btn_label': '保存',
        'in_form_overlay': False,
        'dialog_title': '',
    }
    ok_empty, code_empty = is_action_in_scope(
        {}, 'click_element_by_index', save_params,
    )
    assert ok_empty is True and code_empty == '', (ok_empty, code_empty)

    ok_heal, code_heal = is_action_in_scope(
        {'_heal_mode': 'step', '_heal_contract': {'mode': 'heal'}},
        'click_element_by_index',
        {'btn_label': '保存', 'in_form_overlay': True},
    )
    assert ok_heal is True and code_heal == '', (ok_heal, code_heal)

    contract = get_active_contract(create_bd)
    blocked = should_block_index_submit(
        contract, '保存',
        in_form_overlay=False, dialog_title='',
        business_data_store=create_bd,
    )
    assert blocked is True, 'create click_save via must block index 保存'
    ok, code = is_action_in_scope(create_bd, 'click_element_by_index', save_params)
    assert ok is False and code == 'submit_via_violation', (ok, code)
    ok_el, code_el = is_action_in_scope(create_bd, 'click_element', save_params)
    assert ok_el is False and code_el == 'submit_via_violation', (ok_el, code_el)
    ok_fill, code_fill = is_action_in_scope(create_bd, 'fill_form_field', save_params)
    assert ok_fill is True and code_fill == '', (ok_fill, code_fill)
    print('characterize-contract-sovereignty Task3 OK')

    hist_before = len(create_bd.get('_contract_history') or [])
    v1 = int(get_active_contract(create_bd).get('version') or 0)
    assert v1 == 1, v1
    bumped = begin_recontract(create_bd, {
        'mode': 'create',
        'allow_form_assistant': True,
        'refill': 'all_editable',
        'goal': 'create row recontract',
        'in_scope': ['fill form', 'save'],
        'out_of_scope': [],
        'done_when': 'saved',
        'submit': {'required': True, 'via': 'click_save', 'button_text': '保存'},
        'success': {'kinds': ['toast_ok'], 'evidence': []},
        'version': 1,
    })
    assert bumped is not None
    assert int(bumped.get('version') or 0) == 2, bumped.get('version')
    hist = create_bd.get('_contract_history') or []
    assert len(hist) == hist_before + 1, len(hist)
    assert int((hist[-1] or {}).get('version') or 0) == 1, hist[-1]

    empty_bd: dict = {}
    first = begin_recontract(empty_bd, {
        'mode': 'navigate',
        'allow_form_assistant': False,
        'refill': 'none',
        'goal': 'open list',
        'in_scope': ['open menu'],
        'out_of_scope': [],
        'done_when': 'list visible',
        'submit': {'required': False, 'via': 'any', 'button_text': ''},
        'success': {'kinds': [], 'evidence': []},
    })
    assert int((first or {}).get('version') or 0) == 1, first
    assert not (empty_bd.get('_contract_history') or []), 'no old contract → no history'

    from scripts.event_dispatch import apply_session_recontract
    trig_bd: dict = {}
    apply_phase_contract(trig_bd, {
        'mode': 'navigate',
        'allow_form_assistant': False,
        'refill': 'none',
        'goal': 'open list',
        'in_scope': ['open menu'],
        'out_of_scope': [],
        'done_when': 'list visible',
        'submit': {'required': False, 'via': 'any', 'button_text': ''},
        'success': {'kinds': [], 'evidence': []},
        'version': 1,
    })
    trig_bd['_planner_advice'] = {'next_steps': ['x']}
    emitted: list = []
    apply_session_recontract(
        trig_bd,
        {
            'mode': 'navigate',
            'allow_form_assistant': False,
            'refill': 'none',
            'goal': 'open list v2',
            'in_scope': ['open menu'],
            'out_of_scope': [],
            'done_when': 'list visible',
            'submit': {'required': False, 'via': 'any', 'button_text': ''},
            'success': {'kinds': [], 'evidence': []},
        },
        emit_fn=emitted.append,
        agent=None,
    )
    assert emitted and emitted[0].get('event') == 'recontract', emitted
    assert emitted[0]['data'].get('old_version') == 1, emitted[0]
    assert emitted[0]['data'].get('new_version') == 2, emitted[0]
    assert '_planner_advice' not in trig_bd, 'planner advisory buffer must clear'
    assert int(get_active_contract(trig_bd).get('version') or 0) == 2

    dispatch_src = (ROOT / 'scripts' / 'event_dispatch.py').read_text(encoding='utf-8')
    assert 'recontract' in dispatch_src and 'begin_recontract' in dispatch_src, (
        'explicit recontract trigger must live in event_dispatch'
    )
    assert 'build_agent_system_message' in dispatch_src, (
        'recontract must rebuild agent system message'
    )
    gates_src = (ROOT / 'scripts' / 'controller' / 'actions' / 'phase' / 'intent_gates.py').read_text(
        encoding='utf-8',
    )
    assert 'begin_recontract' not in gates_src, 'no auto recontract on done/scope gates'
    service_src = (ROOT / 'scripts' / 'agent' / 'service.py').read_text(encoding='utf-8')
    assert 'begin_recontract' not in service_src, 'no auto recontract in agent done loop'
    print('characterize-contract-sovereignty Task6 OK')
    return 0

if __name__ == '__main__':
    raise SystemExit(main())
