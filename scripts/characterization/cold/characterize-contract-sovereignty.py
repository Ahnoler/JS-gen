#!/usr/bin/env python3
"""Cold pins: contract sovereignty authority APIs (Task 1 subset)."""
from __future__ import annotations
import sys
from pathlib import Path
ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT))
from scripts.controller.actions._phase_intent import (
    apply_phase_contract,
    get_active_contract,
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
    return 0

if __name__ == '__main__':
    raise SystemExit(main())
