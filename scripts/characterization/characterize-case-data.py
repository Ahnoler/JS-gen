#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
Characterization: case data lookup / hint helpers.

Run:
  python scripts/characterize-case-data.py
"""
from __future__ import annotations

import os
import sys

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

from scripts.actions._case_data import (  # noqa: E402
    format_case_data_hint,
    iter_user_case_entries,
    lookup_case_value,
)
from scripts.actions._form import _is_search_dialog  # noqa: E402


def assert_true(cond: bool, msg: str) -> None:
    if not cond:
        raise AssertionError(msg)


def test_lookup_exact_and_fuzzy() -> None:
    store = {
        '客户名称': 'UI录制',
        '证件号码': 'XG123456',
        '证件类型': '港澳居民来往内地通行证',
        'task_list': {'pending': [], 'done': []},
        '_watcher_mode': False,
    }
    assert_true(lookup_case_value(store, '客户名称') == 'UI录制', 'exact name')
    assert_true(lookup_case_value(store, '证件号码') == 'XG123456', 'exact id')
    assert_true(lookup_case_value(store, '客户名称*') == 'UI录制', 'strip required mark')
    assert_true(lookup_case_value(store, '证件号码：') == 'XG123456', 'strip colon')
    assert_true(lookup_case_value(store, 'task_list') is None, 'reserved key ignored')
    assert_true(lookup_case_value(store, '不存在') is None, 'missing')


def test_hint_lists_user_keys_only() -> None:
    store = {
        '客户名称': 'UI录制',
        'form_snapshots': [],
        '_ref_date': '2020-01-01',
    }
    entries = iter_user_case_entries(store)
    assert_true(entries == [('客户名称', 'UI录制')], f'entries={entries}')
    hint = format_case_data_hint(store)
    assert_true('客户名称 = UI录制' in hint, 'hint body')
    assert_true('预设案例数据' in hint, 'hint header')
    assert_true(format_case_data_hint({}) == '', 'empty store')


def test_search_dialog_heuristic() -> None:
    assert_true(_is_search_dialog('dialog:客户查询') is True, 'query dialog')
    assert_true(_is_search_dialog('dialog:选择客户') is True, 'picker dialog')
    assert_true(_is_search_dialog('dialog:个人客户新增校验') is False, 'add dialog autofills')
    assert_true(_is_search_dialog('drawer:详情') is False, 'drawer not search')
    assert_true(_is_search_dialog('main') is False, 'main')


def main() -> None:
    test_lookup_exact_and_fuzzy()
    test_hint_lists_user_keys_only()
    test_search_dialog_heuristic()
    print('characterize-case-data: OK')


if __name__ == '__main__':
    main()
