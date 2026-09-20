#!/usr/bin/env python3
"""Characterization: phase done acceptance goes through evaluate_phase_done.

Task 5 of contract-sovereignty: service.py must not treat browser-use done as
phase success until validate_done accepts. On reject, emit done_rejected with
structured reasons and inject the same fields into the Executor observation.
Pure helper — no Agent spin-up.
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.controller.actions._phase_intent import (  # noqa: E402
    apply_phase_contract,
    evaluate_phase_done,
    get_active_contract,
)


CREATE_CONTRACT = {
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
}

NAV_CONTRACT = {
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


def main() -> int:
    create_bd: dict = {}
    apply_phase_contract(create_bd, CREATE_CONTRACT)
    accepted, event, obs = evaluate_phase_done(create_bd, phase=3)
    assert accepted is False, 'unfinished create must not accept done'
    assert event is not None and event.get('event') == 'done_rejected', event
    data = event.get('data') or {}
    assert data.get('phase') == 3, data.get('phase')
    assert data.get('authority') == 'gate', data.get('authority')
    version = data.get('contract_version')
    assert int(version or 0) >= 1, version
    assert get_active_contract(create_bd).get('version') == version
    reasons = list(data.get('reasons') or [])
    remaining = list(data.get('remaining') or [])
    missing = list(data.get('missing_evidence') or [])
    assert 'submit_required' in reasons, reasons
    assert 'success_unmet' in reasons, reasons
    assert 'toast_ok' in missing, missing
    assert remaining == list(remaining)
    assert 'toast_ok' in obs, obs
    assert 'submit_required' in obs or 'success_unmet' in obs, obs
    assert 'gate' in obs, obs
    assert create_bd.get('_done_rejected_observation') == obs

    none_ok, none_event, none_obs = evaluate_phase_done({}, phase=1)
    assert none_ok is False, 'empty store must reject'
    assert none_event and none_event.get('event') == 'done_rejected'
    assert 'no_contract' in list((none_event.get('data') or {}).get('reasons') or [])
    assert none_obs

    heal_bd = {'_heal_mode': True, '_heal_contract': {'mode': 'heal'}}
    heal_ok, heal_event, heal_obs = evaluate_phase_done(heal_bd, phase=2)
    assert heal_ok is True, 'heal-mode must bypass validate_done'
    assert heal_event is None
    assert heal_obs == ''

    nav_bd: dict = {}
    apply_phase_contract(nav_bd, NAV_CONTRACT)
    nav_ok, nav_event, nav_obs = evaluate_phase_done(nav_bd, phase=0)
    assert nav_ok is True, 'navigate with no submit/kinds must accept'
    assert nav_event is None
    assert nav_obs == ''

    src = (ROOT / 'scripts' / 'agent' / 'service.py').read_text(encoding='utf-8')
    assert 'evaluate_phase_done' in src, 'service.py must call evaluate_phase_done'
    assert 'done_rejected' in src, 'service.py must emit done_rejected'
    idx = src.find('evaluate_phase_done')
    chunk = src[idx:idx + 2800]
    assert 'emit_json' in chunk, 'reject path must emit via emit_json'
    assert 'HumanMessage' in chunk or '_add_message_with_tokens' in chunk, (
        'reject path must inject Executor observation'
    )
    assert 'planner_llm' not in chunk, 'done reject must not call Planner'
    assert 'filter_planner_advice' not in chunk, 'done reject must not re-litigate via Planner'
    print('characterize-phase-done-validate: OK')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
