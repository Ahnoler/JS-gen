#!/usr/bin/env python3
"""Pin same-family fill/select dispatch: resolve_same_family_target."""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.controller.actions.same_family import resolve_same_family_target  # noqa: E402

FIELDS = [
    {'label': '保证金比例', 'kind': 'input', 'field_slot': 'A', 'xpath_smart': '(//input)[1]'},
    {'label': '保证金比例', 'kind': 'tssc-multi-select', 'field_slot': 'A', 'xpath_smart': '(//select)[1]'},
    {'label': '保证金比例', 'kind': 'tssc-multi-select', 'field_slot': 'B', 'xpath_smart': '(//select)[2]'},
    {'label': '保证金比例', 'kind': 'input', 'field_slot': 'B', 'xpath_smart': '(//input)[2]'},
    {'label': '业务产品编号', 'kind': 'input', 'field_slot': '', 'xpath_smart': '//input[@id="biz"]'},
]


def assert_true(cond: bool, msg: str) -> None:
    if not cond:
        raise AssertionError(msg)


def main() -> int:
    fill_a = resolve_same_family_target(
        FIELDS, label='保证金比例', xpath_smart='(//input)[1]', action='fill',
    )
    assert_true(fill_a.get('kind') == 'input', f'fill A kind, got {fill_a!r}')

    select_a = resolve_same_family_target(
        FIELDS, label='保证金比例', xpath_smart='(//select)[1]', action='select',
    )
    assert_true(select_a.get('field_slot') == 'A', f'select A slot, got {select_a!r}')

    amb = resolve_same_family_target(
        FIELDS, label='保证金比例', xpath_smart='', action='fill',
    )
    assert_true(amb.get('ok') is False, f'empty xpath must be ambiguous, got {amb!r}')
    assert_true(
        amb.get('error') == 'err-ambiguous-field-slot',
        f'error code, got {amb!r}',
    )
    assert_true(len(amb.get('candidates') or []) == 2, f'candidates len, got {amb!r}')

    unique = resolve_same_family_target(
        FIELDS, label='业务产品编号', xpath_smart='', action='fill',
    )
    assert_true(unique.get('ok') is True, f'unique ok, got {unique!r}')
    assert_true(
        unique.get('xpath_smart') == '//input[@id="biz"]',
        f'unique xpath, got {unique!r}',
    )

    missing = resolve_same_family_target(
        FIELDS, label='保证金比例', xpath_smart='(//input)[99]', action='fill',
    )
    assert_true(missing.get('ok') is False, f'missing xpath must be ambiguous, got {missing!r}')
    assert_true(
        missing.get('error') == 'err-ambiguous-field-slot',
        f'missing xpath error, got {missing!r}',
    )

    print('ok: characterize-same-family-resolve')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
