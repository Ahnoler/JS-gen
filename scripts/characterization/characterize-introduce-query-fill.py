#!/usr/bin/env python3
"""Characterize introduce/query-UI fill path (traj #38 phase 3).

Query toolbar / 引入 picker used to early-return from _ensure_scanned without
building _scan_fields, so fill_form_field(客户名称) → xpath-not-found.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.controller.actions.form_scan_utils import (  # noqa: E402
    _is_search_dialog,
    _resolve_control,
    _is_query_mode,
)


def assert_true(cond: bool, msg: str) -> None:
    if not cond:
        raise AssertionError(msg)


def main() -> int:
    form_py = (
        (ROOT / 'scripts/controller/actions/_form.py').read_text(encoding='utf-8')
        + (ROOT / 'scripts/controller/actions/form_autofill.py').read_text(encoding='utf-8')
    )

    assert_true(
        'first-touch query-ui scan' in form_py,
        'query UI still runs first-touch inventory scan',
    )
    assert_true(
        re.search(
            r"is_query_ui = await _mark_query_ui_if_needed.*?first-touch query-ui scan",
            form_py,
            re.S,
        ),
        'query-ui branch scans before return',
    )
    assert_true(
        'use_label_fallback' in form_py and 'JS_FILL_FORM_FIELD' in form_py,
        'fill_form_field has label DOM fallback when xpath resolve fails',
    )
    # Must not return on query UI before the scan branch
    assert_true(
        form_py.count("await _rebuild_task_list_from_dom(autofill=False)") >= 3,
        'rebuild autofill=False covers stale + structure + query-ui first-touch',
    )

    assert_true(_is_search_dialog('dialog:引入客户') is True, '引入 dialog is search')
    assert_true(_is_search_dialog('dialog:选择客户') is True, '选择客户 dialog is search')
    assert_true(_is_search_dialog('drawer:新增客户校验') is False, 'maintain drawer not search')

    # After inventory exists, resolve must find 客户名称 (post-scan state)
    store = {
        '_query_ui': True,
        '_scan_fields': [
            {'label': '客户名称', 'kind': 'input', 'xpath_smart': '//dialog//客户名称'},
            {'label': '证件号码', 'kind': 'input', 'xpath_smart': '//dialog//证件号码'},
        ],
        'task_list': {
            'pending': [
                {'label': '客户名称', 'kind': 'input', 'xpath_smart': '//dialog//客户名称'},
            ],
            'done': [],
        },
    }
    assert_true(_is_query_mode(store) is True, 'picker marks query mode')
    r = _resolve_control(store, '客户名称', '')
    assert_true(not r.error and '客户名称' in r.xpath_smart, f'resolve after scan: {r}')

    empty = {'_query_ui': True, '_scan_fields': [], 'task_list': {'pending': [], 'done': []}}
    r2 = _resolve_control(empty, '客户名称', '')
    assert_true(r2.error == 'xpath-not-found', 'no inventory → xpath-not-found (fallback path)')

    print('characterize-introduce-query-fill: OK')
    return 0


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except AssertionError as e:
        print(f'FAIL: {e}', file=sys.stderr)
        raise SystemExit(1)
