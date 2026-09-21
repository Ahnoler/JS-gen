"""Persisted phase contract is applied without text recompilation."""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from scripts.controller.actions.phase.phase_contract_snapshot import (
    apply_persisted_phase_contract,
    normalize_phase_contract,
)


def check(cond, msg):
    if not cond:
        raise SystemExit(msg)


nav = {
    'v': 1, 'mode': 'navigate', 'refill': 'none', 'submitRequired': False,
    'successWhen': ['url_change', 'page_opened'], 'source': 'analyze',
}
assert normalize_phase_contract(nav)['mode'] == 'navigate'
assert normalize_phase_contract({**nav, 'mode': 'verify'}) is None

store = {}
contract = apply_persisted_phase_contract(store, nav)
check(contract and contract['mode'] == 'navigate', 'mode stayed navigate')
check(store['_phase_boundary']['source'] == 'persisted', 'boundary source persisted')
check(store['_phase_boundary']['success_when'] == ['url_change', 'page_opened'], 'kinds from snapshot')
check(store['_phase_boundary']['role'] == 'navigate', 'role mapped')
check(store['_phase_intent']['submit']['required'] is False, 'submit false')
check('compile_boundary' not in (store.get('_phase_boundary') or {}).get('source', ''), 'not rules')

fill = {
    'v': 1, 'mode': 'create', 'refill': 'all_editable', 'submitRequired': False,
    'successWhen': [], 'source': 'analyze',
}
store2 = {}
apply_persisted_phase_contract(store2, fill)
check(store2['_phase_intent']['submit']['required'] is False, 'fill-only no submit')
check(store2['_phase_boundary']['success_when'] == [], 'fill-only no kinds')
check(store2['_task_mode'] == 'form_fill', 'create maps to form_fill')

store3 = {'sentinel': 1}
check(apply_persisted_phase_contract(store3, {**nav, 'mode': 'nope'}) is None, 'invalid returns None')
check(store3 == {'sentinel': 1}, 'invalid does not write store')

from scripts.controller.actions.phase.phase_contract_snapshot import persisted_contract_from_instruction
check(persisted_contract_from_instruction({'phase_contract': nav}, True) is None, 'heal ignores snapshot')
check(persisted_contract_from_instruction({'phase_contract': nav}, False) == nav, 'non-heal returns raw')

svc = (ROOT / 'scripts/agent/service.py').read_text(encoding='utf-8')
check('apply_persisted_phase_contract' in svc, 'service dispatches persisted contract')
check('phase_contract=persisted' in svc, 'log line present')

print('characterize-persisted-phase-contract OK')
