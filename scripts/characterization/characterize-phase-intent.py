#!/usr/bin/env python3
"""Lightweight characterization for Phase Intent Contract compiler and gates."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.actions._phase_intent import (  # noqa: E402
    apply_phase_intent,
    check_pending_write_gate,
    clear_phase_intent,
    compile_phase_intent,
    contract_force_refill,
    is_cycle_deviate_fingerprint,
    is_introduce_phase,
    should_block_index_submit,
)
from scripts.models.task import TaskList  # noqa: E402


def assert_true(cond: bool, msg: str) -> None:
    if not cond:
        raise AssertionError(msg)


def main() -> int:
    # create / modify → all_editable by default (recording)
    c_create = compile_phase_intent('在核心产品管理页面新增一条记录并保存')
    assert_true(c_create['mode'] == 'create', 'create mode')
    assert_true(c_create['refill'] == 'all_editable', 'create all_editable')
    assert_true(c_create['submit']['via'] == 'click_save', 'create click_save')
    assert_true('toast_ok' in c_create['success']['kinds'], 'toast success')
    assert_true('url_change' in c_create['success']['kinds'], 'url success')

    c_modify = compile_phase_intent('选中一行点击修改，修改表单中所有字段后确认')
    assert_true(c_modify['mode'] == 'modify', 'modify mode')
    assert_true(c_modify['refill'] == 'all_editable', 'modify all_editable')
    assert_true(c_modify.get('explicit_all_fields') is True, 'explicit all fields synonym')

    # introduce
    c_intro = compile_phase_intent('点击引入按钮，选择客户后点确认')
    assert_true(is_introduce_phase(c_intro), 'introduce phase')
    assert_true(c_intro['submit']['via'] == 'any', 'introduce via any')
    assert_true('confirm_click' in c_intro['success']['kinds'], 'introduce confirm success')

    # query unchanged
    c_query = compile_phase_intent('查询产品信息')
    assert_true(c_query['mode'] == 'query', 'query mode')
    assert_true(c_query['refill'] == 'none', 'query no refill')

    # apply / clear lifecycle
    store: dict = {}
    apply_phase_intent(store, '新增客户并保存')
    assert_true(store.get('_phase_intent') is not None, 'intent written')
    assert_true(contract_force_refill(store) is True, 'force refill from contract')
    clear_phase_intent(store)
    assert_true('_phase_intent' not in store, 'intent cleared')

    # gate: maintain dialog blocks 确认, picker does not
    maintain = compile_phase_intent('修改客户信息并保存')
    assert_true(
        should_block_index_submit(maintain, '确认', in_form_overlay=True, dialog_title='客户维护'),
        'block confirm in maintain',
    )
    assert_true(
        not should_block_index_submit(c_intro, '确认', in_form_overlay=True, dialog_title='选择客户'),
        'allow confirm in picker',
    )
    assert_true(
        should_block_index_submit(maintain, '保存', in_form_overlay=False, dialog_title=''),
        'block 保存 always',
    )

    # pending write gate
    store2 = {'_phase_intent': c_create, '_force_refill_all': True, 'task_list': {
        'pending': [{'label': '产品编号', 'kind': 'input', 'currentValue': '', 'options': [],
                     'placeholder': '', 'disabled': False, 'required': True, 'hasButton': '',
                     'needs_intervention': False}],
        'done': [],
    }}
    ok, labels = check_pending_write_gate(store2)
    assert_true(not ok and '产品编号' in labels, 'pending gate blocks')

    # cycle deviate fingerprints
    assert_true(is_cycle_deviate_fingerprint('radio:某行'), 'radio deviate')
    assert_true(is_cycle_deviate_fingerprint('click:修改'), 'modify deviate')
    assert_true(not is_cycle_deviate_fingerprint('click:查询'), 'query not deviate')

    # TaskList force_refill keeps valued fields pending
    fields = [{'label': '编号', 'kind': 'input', 'currentValue': 'X001', 'disabled': False,
               'required': True, 'options': [], 'placeholder': '', 'hasButton': ''}]
    tl = TaskList.from_scan(fields, force_refill=True)
    assert_true(len(tl.pending) == 1, 'force_refill pending')
    assert_true(len(tl.done) == 0, 'no done under force_refill')

    print('characterize-phase-intent: OK')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
