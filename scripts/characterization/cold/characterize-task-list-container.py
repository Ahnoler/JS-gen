#!/usr/bin/env python3
"""Characterize task_list persistence across container switch + mark_done.

Reproduces traj #38 phase 2: drawer first-touch scan, then select/fill marks
done, then another _ensure_scanned-equivalent same-container switch must NOT
restore the pre-write snapshot (else click_save sees err-pending-fields).
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.controller.actions.form_scan_utils import (  # noqa: E402
    _switch_task_list_container,
    _task_done_impl,
)
from scripts.controller.actions.phase.intent_gates import (  # noqa: E402
    check_pending_write_gate,
)
from scripts.controller.actions._phase_intent import apply_phase_contract  # noqa: E402


def assert_true(cond: bool, msg: str) -> None:
    if not cond:
        raise AssertionError(msg)


def _drawer_store() -> dict:
    """Simulate first-touch scan of drawer:新增客户校验 with force_refill.

    Apply contract first (it clears container slots via clear_phase_boundary),
    then seed the post-scan flat + per-container snapshot.
    """
    store: dict = {}
    apply_phase_contract(store, {
        'mode': 'create',
        'allow_form_assistant': True,
        'refill': 'all_editable',
        'goal': '新增客户并保存',
        'in_scope': [],
        'out_of_scope': [],
        'done_when': '',
        'submit': {'required': True},
        'success': {'kinds': ['toast_ok']},
        'source': 'llm',
    })
    scan_fields = [
        {'label': '客户状态', 'kind': 'select', 'xpath_smart': '//xp1'},
        {'label': '对公客户类型', 'kind': 'select', 'xpath_smart': '//xp2'},
        {'label': '客户名称', 'kind': 'input', 'xpath_smart': '//xp3'},
    ]
    # Stale slot: pre-write snapshot (all pending). Flat view starts equal,
    # then mark_done replaces flat with a new dict — slot must not win later.
    stale_tl = {
        'pending': [
            {'label': '客户状态', 'kind': 'select', 'xpath_smart': '//xp1'},
            {'label': '对公客户类型', 'kind': 'select', 'xpath_smart': '//xp2'},
            {'label': '客户名称', 'kind': 'input', 'xpath_smart': '//xp3'},
        ],
        'done': [],
    }
    store['_active_container'] = 'drawer:新增客户校验'
    store['_scan_fields'] = scan_fields
    store['task_list'] = {
        'pending': [dict(p) for p in stale_tl['pending']],
        'done': [],
    }
    store['_task_lists_by_container'] = {
        'drawer:新增客户校验': {
            'task_list': stale_tl,
            '_scan_fields': scan_fields,
        },
    }
    return store


def main() -> int:
    store = _drawer_store()

    # Same-container switch must not clobber live mark_done progress
    _task_done_impl('客户状态', store, value='信贷潜在客户', xpath_smart='//xp1')
    assert_true(
        len(store['task_list']['done']) == 1
        and store['task_list']['done'][0]['label'] == '客户状态',
        'mark_done moves 客户状态',
    )
    _switch_task_list_container(store, 'drawer:新增客户校验')
    assert_true(
        len(store['task_list']['done']) == 1
        and len(store['task_list']['pending']) == 2,
        'same-container switch keeps mark_done (no stale restore)',
    )

    _task_done_impl('对公客户类型', store, value='企业类', xpath_smart='//xp2')
    _task_done_impl('客户名称', store, value='测试', xpath_smart='//xp3')
    _switch_task_list_container(store, 'drawer:新增客户校验')
    ok, pending = check_pending_write_gate(store)
    assert_true(ok is True and pending == [], f'gate open after all written, pending={pending}')

    # Cross-container: leave drawer → main, then return → keep drawer progress
    store2 = _drawer_store()
    _task_done_impl('客户状态', store2, value='信贷潜在客户', xpath_smart='//xp1')
    _switch_task_list_container(store2, 'main')
    assert_true(store2.get('_active_container') == 'main', 'switched to main')
    _switch_task_list_container(store2, 'drawer:新增客户校验')
    assert_true(
        len(store2['task_list']['done']) == 1
        and store2['task_list']['done'][0]['label'] == '客户状态',
        'return to drawer restores post-mark_done slot',
    )

    print('characterize-task-list-container: OK')
    return 0


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except AssertionError as e:
        print(f'FAIL: {e}', file=sys.stderr)
        raise SystemExit(1)
