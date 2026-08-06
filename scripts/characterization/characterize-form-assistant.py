#!/usr/bin/env python3
"""Lightweight characterization for explicit run_form_assistant action."""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.actions._phase_intent import (  # noqa: E402
    apply_phase_contract,
    contract_allows_form_assistant,
)


def assert_true(cond: bool, msg: str) -> None:
    if not cond:
        raise AssertionError(msg)


def main() -> int:
    store: dict = {}
    apply_phase_contract(store, {
        'mode': 'navigate',
        'allow_form_assistant': False,
        'refill': 'none',
        'goal': 'x',
        'in_scope': [],
        'out_of_scope': [],
        'done_when': '',
        'submit': {},
        'success': {},
        'source': 'llm',
    })
    assert_true(contract_allows_form_assistant(store) is False, 'nav denies assistant')

    store2: dict = {}
    apply_phase_contract(store2, {
        'mode': 'create',
        'allow_form_assistant': True,
        'refill': 'all_editable',
        'goal': '新增',
        'in_scope': [],
        'out_of_scope': [],
        'done_when': '',
        'submit': {},
        'success': {},
        'source': 'llm',
    })
    assert_true(contract_allows_form_assistant(store2) is True, 'create allows assistant')

    form_py = (ROOT / 'scripts/actions/_form.py').read_text(encoding='utf-8')
    assert_true('async def run_form_assistant' in form_py, 'run_form_assistant action exists')
    assert_true(
        'allow_autofill: bool = False' in form_py,
        '_ensure_scanned has allow_autofill default False',
    )
    assert_true(
        re.search(
            r"await _ensure_scanned\('__run_form_assistant__', allow_autofill=True\)",
            form_py,
        ),
        'run_form_assistant triggers scan with allow_autofill=True',
    )
    for fn in ('fill_form_field', 'fill_date_field', 'select_option', 'click_radio', 'select_tree_option'):
        m = re.search(rf'async def {fn}\(.*?\n(?:.*?\n)*?.*?await _ensure_scanned\(label_text\)', form_py)
        assert_true(m is not None, f'{fn} calls _ensure_scanned without allow_autofill=True')

    print('characterize-form-assistant: OK')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
