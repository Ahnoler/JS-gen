#!/usr/bin/env python3
"""Characterize inventory → memory helper (T4-P2)."""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

FORM_PY = ROOT / 'scripts/controller/actions/_form.py'
INVENTORY_EMIT_PY = ROOT / 'scripts/memory/inventory_emit.py'


def assert_true(cond: bool, msg: str) -> None:
    if not cond:
        raise AssertionError(msg)


def _fake_summary() -> dict:
    return {
        'container': 'dialog:编辑',
        'scope': 'active+visible-overlays',
        'total': 5,
        'filled': 2,
        'pending': 3,
        'pending_labels': ['名称', '类型', '备注'],
        'sections': [{'id': 's1', 'title': '基本信息', 'pending': 3}],
        'buttons': [
            {'text': '保存', 'section': 'footer'},
            {'text': '取消', 'section': 'footer'},
        ],
    }


def test_helper_exported() -> None:
    from scripts.memory import inventory_emit as mod

    assert_true(
        callable(getattr(mod, 'emit_editable_summary_memory', None)),
        'inventory_emit exports emit_editable_summary_memory',
    )
    assert_true(
        callable(getattr(mod, 'build_inventory_facts', None)),
        'inventory_emit exports build_inventory_facts',
    )
    assert_true(
        callable(getattr(mod, 'truncate_pending_labels', None)),
        'inventory_emit exports truncate_pending_labels',
    )
    assert_true(
        callable(getattr(mod, 'truncate_buttons', None)),
        'inventory_emit exports truncate_buttons',
    )


def test_truncation_constants() -> None:
    from scripts.memory.inventory_emit import (
        BUTTON_MAX_CHARS,
        BUTTON_MAX_ITEMS,
        PENDING_LABEL_MAX_CHARS,
        PENDING_LABEL_MAX_ITEMS,
    )

    assert_true(PENDING_LABEL_MAX_ITEMS == 20, 'PENDING_LABEL_MAX_ITEMS == 20')
    assert_true(PENDING_LABEL_MAX_CHARS == 500, 'PENDING_LABEL_MAX_CHARS == 500')
    assert_true(BUTTON_MAX_ITEMS == 15, 'BUTTON_MAX_ITEMS == 15')
    assert_true(BUTTON_MAX_CHARS == 400, 'BUTTON_MAX_CHARS == 400')


def test_build_inventory_facts_shape() -> None:
    from scripts.memory.inventory_emit import build_inventory_facts

    facts = build_inventory_facts(_fake_summary())
    assert_true(isinstance(facts, list) and len(facts) == 4, 'build_inventory_facts returns 4 facts')
    attrs = {f.get('attribute') for f in facts}
    assert_true(
        attrs == {'container', 'pending_count', 'pending_labels', 'buttons'},
        f'fact attributes are container/pending_count/pending_labels/buttons, got {attrs!r}',
    )
    for fact in facts:
        assert_true(fact.get('entity') == 'form_inventory', 'fact entity is form_inventory')
        assert_true(fact.get('source') == 'page', 'fact source is page')
        assert_true(fact.get('stance') == 'inferred', 'fact stance is inferred')
        assert_true(fact.get('factType') == 'page_state', 'fact factType is page_state')

    by_attr = {f['attribute']: f['value'] for f in facts}
    assert_true(by_attr['container'] == 'dialog:编辑', 'container fact value')
    assert_true(by_attr['pending_count'] == '3', 'pending_count fact is decimal string')
    assert_true(by_attr['pending_labels'] == '名称,类型,备注', 'pending_labels fact joined')
    assert_true(by_attr['buttons'] == '保存@footer,取消@footer', 'buttons fact compact')


def test_pending_labels_truncation() -> None:
    from scripts.memory.inventory_emit import (
        PENDING_LABEL_MAX_CHARS,
        PENDING_LABEL_MAX_ITEMS,
        join_pending_labels,
        truncate_pending_labels,
    )

    many = [f'label-{i}' for i in range(30)]
    truncated = truncate_pending_labels(many)
    assert_true(len(truncated) == PENDING_LABEL_MAX_ITEMS, 'pending labels capped at max items')

    long_labels = ['x' * 40 for _ in range(PENDING_LABEL_MAX_ITEMS)]
    joined = join_pending_labels(long_labels)
    assert_true(len(joined) <= PENDING_LABEL_MAX_CHARS, 'joined pending labels capped at max chars')


def test_buttons_truncation() -> None:
    from scripts.memory.inventory_emit import (
        BUTTON_MAX_CHARS,
        BUTTON_MAX_ITEMS,
        format_buttons_compact,
        truncate_buttons,
    )

    many = [{'text': f'btn-{i}', 'section': 's'} for i in range(30)]
    truncated = truncate_buttons(many)
    assert_true(len(truncated) == BUTTON_MAX_ITEMS, 'buttons capped at max items')

    long_buttons = [{'text': 'x' * 50, 'section': 's'} for _ in range(BUTTON_MAX_ITEMS)]
    compact = format_buttons_compact(long_buttons)
    assert_true(len(compact) <= BUTTON_MAX_CHARS, 'compact buttons capped at max chars')


def test_emit_uses_writer() -> None:
    src = INVENTORY_EMIT_PY.read_text(encoding='utf-8')
    assert_true(
        'emit_memory_event' in src,
        'inventory_emit.py calls emit_memory_event',
    )
    assert_true(
        "'form_state'" in src or '"form_state"' in src,
        'inventory_emit.py emits form_state event type',
    )


def test_form_wiring() -> None:
    form = (
        FORM_PY.read_text(encoding='utf-8')
        + (ROOT / 'scripts/controller/actions/form_scan_actions.py').read_text(encoding='utf-8')
    )
    assert_true(
        'emit_editable_summary_memory' in form,
        '_form.py calls emit_editable_summary_memory',
    )


def run_helper_tests() -> None:
    test_helper_exported()
    test_truncation_constants()
    test_build_inventory_facts_shape()
    test_pending_labels_truncation()
    test_buttons_truncation()
    test_emit_uses_writer()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        '--helper-only',
        action='store_true',
        help='Run helper unit tests only (Task 1 green path; wiring may fail until Task 2)',
    )
    args = parser.parse_args()

    run_helper_tests()
    if args.helper_only:
        print('characterize-inventory-memory (helper): OK')
        return 0

    try:
        test_form_wiring()
    except AssertionError as exc:
        print(f'characterize-inventory-memory: helper OK; wiring deferred (Task 2): {exc}')
        return 1

    print('characterize-inventory-memory: OK')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
