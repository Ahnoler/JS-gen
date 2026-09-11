#!/usr/bin/env python3
"""Cold pins: contract sovereignty authority APIs (Task 1–2 subset)."""
from __future__ import annotations
import sys
from pathlib import Path
ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT))
from scripts.controller.actions._phase_intent import (
    apply_phase_contract,
    get_active_contract,
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
    return 0

if __name__ == '__main__':
    raise SystemExit(main())
