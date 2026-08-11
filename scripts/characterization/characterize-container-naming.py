#!/usr/bin/env python3
"""Characterization: overlay container trigger|title naming helpers."""
from __future__ import annotations
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.controller.actions.container_naming import (  # noqa: E402
    compose_overlay_container,
    overlay_title_from_container_id,
    normalize_trigger_button,
    remember_trigger_button,
    clear_trigger_button,
    resolve_display_container,
)
from scripts.controller.actions.form_scan_utils import _is_search_dialog  # noqa: E402


def assert_true(cond: bool, msg: str) -> None:
    if not cond:
        raise AssertionError(msg)


def test_compose_truth() -> None:
    assert_true(
        compose_overlay_container('dialog:新增客户校验', '新增') == 'dialog:新增|新增客户校验',
        'trigger + title',
    )
    assert_true(
        compose_overlay_container('dialog:unnamed', '新增') == 'dialog:新增|unnamed',
        'trigger + unnamed',
    )
    assert_true(
        compose_overlay_container('dialog:', '新增') == 'dialog:新增|unnamed'
        or compose_overlay_container('dialog:unnamed', '新增') == 'dialog:新增|unnamed',
        'empty title uses unnamed sentinel',
    )
    assert_true(
        compose_overlay_container('dialog:选择客户', '') == 'dialog:选择客户',
        'no trigger keeps raw',
    )
    assert_true(
        compose_overlay_container('dialog:unnamed', None) == 'dialog:unnamed',
        'no trigger unnamed',
    )
    assert_true(
        compose_overlay_container('main', '新增') == 'main',
        'main untouched',
    )
    assert_true(
        compose_overlay_container('drawer:unnamed', '筛选') == 'drawer:筛选|unnamed',
        'drawer compose',
    )


def test_title_extract() -> None:
    assert_true(
        overlay_title_from_container_id('dialog:新增|新增客户校验') == '新增客户校验',
        'pipe title',
    )
    assert_true(
        overlay_title_from_container_id('dialog:新增|unnamed') == 'unnamed',
        'pipe unnamed',
    )
    assert_true(
        overlay_title_from_container_id('dialog:选择客户') == '选择客户',
        'legacy title',
    )
    assert_true(
        overlay_title_from_container_id('dialog:unnamed') == 'unnamed',
        'legacy unnamed',
    )
    assert_true(
        overlay_title_from_container_id('dialog:新增') == '新增',
        'bare dialog:新增 is legacy title NOT empty',
    )


def test_normalize_and_remember() -> None:
    assert_true(normalize_trigger_button('') == '', 'empty')
    assert_true(normalize_trigger_button('  新增  ') == '新增', 'trim')
    assert_true(normalize_trigger_button('12') == '', 'day noise')
    assert_true(normalize_trigger_button('2024-01-01') == '', 'date noise')
    long = '法人投资' * 20
    assert_true(normalize_trigger_button(long) == '', 'too long')
    store: dict = {}
    remember_trigger_button(store, '新增')
    assert_true(store.get('_last_trigger_button') == '新增', 'remember')
    remember_trigger_button(store, '')
    assert_true(store.get('_last_trigger_button') == '新增', 'empty does not clear via remember')
    clear_trigger_button(store)
    assert_true('_last_trigger_button' not in store, 'clear trigger')
    assert_true('_overlay_container_alias' not in store, 'clear alias')


def test_search_dialog_title_parse() -> None:
    assert_true(
        not _is_search_dialog('dialog:引入|unnamed'),
        'trigger segment 引入 must not classify as search dialog',
    )
    assert_true(
        _is_search_dialog('dialog:选择客户'),
        'legacy title-only id still search dialog',
    )


def test_compose_no_double_pipe() -> None:
    raw = 'dialog:新增|unnamed'
    assert_true(
        compose_overlay_container(raw, '引入') == raw,
        'already-composed id must not double-pipe',
    )


def test_alias_freeze() -> None:
    store = {'_last_trigger_button': '新增'}
    a = resolve_display_container('dialog:unnamed', store)
    assert_true(a == 'dialog:新增|unnamed', f'first compose got {a}')
    store['_last_trigger_button'] = '引入'  # would wrongly change without freeze
    b = resolve_display_container('dialog:unnamed', store)
    assert_true(b == a, f'alias freeze got {b}')


def test_source_wires() -> None:
    misc = (ROOT / 'scripts/controller/actions/_misc.py').read_text(encoding='utf-8')
    form = (ROOT / 'scripts/controller/actions/_form.py').read_text(encoding='utf-8')
    scan = (ROOT / 'scripts/controller/actions/form_scan_utils.py').read_text(encoding='utf-8')
    table = (ROOT / 'scripts/controller/actions/_table.py').read_text(encoding='utf-8')
    assert_true('remember_trigger_button' in misc, 'misc remembers trigger')
    assert_true('clear_trigger_button' in misc, 'misc clears on close_dialog')
    assert_true('remember_trigger_button' in table, 'table remembers trigger')
    assert_true(
        'resolve_display_container' in form or 'resolve_display_container' in scan,
        'compose on scan/save path',
    )
    assert_true(
        'clear_trigger_button' in scan or 'clear_trigger_button' in form,
        'clear on main switch',
    )


def main() -> None:
    test_compose_truth()
    test_title_extract()
    test_normalize_and_remember()
    test_search_dialog_title_parse()
    test_compose_no_double_pipe()
    test_alias_freeze()
    test_source_wires()
    print('PASS characterize-container-naming')


if __name__ == '__main__':
    main()
