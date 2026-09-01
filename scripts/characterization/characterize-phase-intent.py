#!/usr/bin/env python3
"""Lightweight characterization for Phase Intent Contract compiler and gates."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.controller.actions._phase_intent import (  # noqa: E402
    apply_phase_contract,
    apply_phase_intent,
    check_pending_write_gate,
    clear_phase_intent,
    compile_phase_intent,
    contract_allows_form_assistant,
    contract_force_refill,
    is_cycle_deviate_fingerprint,
    is_introduce_phase,
    overlay_blocks_done,
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

    # introduce — pure pick; mixed create+conditional introduce stays create
    c_intro = compile_phase_intent('点击引入按钮，选择客户后点确认')
    assert_true(is_introduce_phase(c_intro), 'introduce phase')
    assert_true(c_intro['submit']['via'] == 'any', 'introduce via any')
    assert_true('confirm_click' in c_intro['success']['kinds'], 'introduce confirm success')

    mixed = (
        '新增一个信贷潜在客户，点击保存。（如果出现法定代表人/负责人证件号码的引入按钮，'
        '那么该法定责任人的客户名称填写朱桂武，点击查询，选择一个客户，点击确认。'
        '预期结果：完成引入流程）预期结果：新增信贷潜在客户并保存成功。'
    )
    c_mixed = compile_phase_intent(mixed)
    assert_true(c_mixed['mode'] == 'create', 'mixed create+introduce → create')
    assert_true(c_mixed['refill'] == 'all_editable', 'mixed keeps all_editable')
    assert_true(not is_introduce_phase(c_mixed), 'mixed not introduce_pick')

    intro_fill = (
        '点击法定代表人/负责人证件号码的引入按钮，客户名称 填写 测试，'
        '点击查询，选择一个客户，点击确认。预期结果：完成引入流程。'
    )
    c_intro_fill = compile_phase_intent(intro_fill)
    assert_true(is_introduce_phase(c_intro_fill), 'introduce with 填写 picker field')
    assert_true(c_intro_fill['refill'] == 'none', 'introduce refill none')

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
        not should_block_index_submit(
            maintain, '确认', in_form_overlay=True, dialog_title='选择客户', is_picker_ui=False,
        ),
        'allow confirm in picker title',
    )
    assert_true(
        not should_block_index_submit(
            c_create, '确认', in_form_overlay=True, dialog_title='', is_picker_ui=True,
        ),
        'allow confirm on query-toolbar picker during create',
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

    # force_refill keeps this-session-filled fields in done, not pending
    fields2 = [{'label': '编号', 'kind': 'input', 'currentValue': 'X001', 'disabled': False,
                'required': True, 'options': [], 'placeholder': '', 'hasButton': ''}]
    tl2 = TaskList.from_scan(fields2, force_refill=True, session_filled_labels={'编号'})
    assert_true(len(tl2.done) == 1, 'session-filled label stays done under force_refill')
    assert_true(len(tl2.pending) == 0, 'session-filled label not requeued to pending')

    # atomic apply_phase_contract writer
    store3: dict = {}
    c_nav = {
        'mode': 'navigate',
        'allow_form_assistant': False,
        'refill': 'none',
        'goal': '进入列表页',
        'in_scope': ['打开菜单', '确认列表可见'],
        'out_of_scope': ['点击修改', '填写表单', '保存'],
        'done_when': '列表页已打开',
        'submit': {'required': False, 'via': 'any', 'button_text': ''},
        'success': {'kinds': [], 'evidence': []},
        'source': 'llm',
    }
    apply_phase_contract(store3, c_nav)
    assert_true(store3.get('_task_mode') == 'other', 'task_mode other')
    assert_true(store3.get('_force_refill_all') is False, 'no force refill')
    assert_true(store3.get('_phase_intent', {}).get('mode') == 'navigate', 'intent mode')
    assert_true(store3.get('_phase_boundary', {}).get('role') == 'navigate', 'boundary role')
    assert_true(contract_allows_form_assistant(store3) is False, 'assistant denied')
    assert_true('task_list' not in store3, 'navigate clears task_list')

    # open-page via apply_phase_intent → mode navigate
    store_nav: dict = {}
    c_open = apply_phase_intent(
        store_nav,
        '进入对公客户管理页面。预期结果：打开对公客户管理列表页面。',
    )
    assert_true(c_open and c_open.get('mode') == 'navigate', 'open-page intent mode navigate')

    assert_true(overlay_blocks_done(None) is True, 'no contract blocks')
    assert_true(
        overlay_blocks_done({'submit': {'required': True}, 'success': {'kinds': []}}) is True,
        'required=True blocks',
    )
    assert_true(
        overlay_blocks_done({'submit': {'required': False}, 'success': {'kinds': ['toast_ok']}}) is True,
        'non-empty kinds blocks',
    )
    assert_true(
        overlay_blocks_done({'submit': {'required': False}, 'success': {'kinds': []}}) is False,
        'required=false empty kinds allows',
    )
    assert_true(
        overlay_blocks_done({'mode': 'modify'}) is False,
        'mode-only contract allows (inverted default)',
    )
    assert_true(
        overlay_blocks_done({'submit': {'required': 'true'}, 'success': {'kinds': []}}) is True,
        'coerce_bool string true blocks',
    )
    assert_true(
        overlay_blocks_done({'submit': {'required': 'false'}, 'success': {'kinds': []}}) is False,
        'coerce_bool string false allows',
    )
    # Same predicate gates visible-errors hard-reject in recorder (contract-first).
    assert_true(
        overlay_blocks_done({'submit': {'required': False}, 'success': {'kinds': []}}) is False,
        'errors gate shares allow signal',
    )
    assert_true(
        overlay_blocks_done({'submit': {'required': True}, 'success': {'kinds': ['toast_ok']}}) is True,
        'errors gate shares block signal on save phases',
    )

    # Single-field phase: submit.required=false → must NOT nudge click_save
    from scripts.controller.actions._phase_boundary import next_action_hint
    from scripts.controller.actions._form import _submit_ready_hint, _with_submit_cue

    store_field: dict = {}
    apply_phase_contract(
        store_field,
        {
            'mode': 'modify',
            'refill': 'none',
            'allow_form_assistant': False,
            'goal': '选择对公客户类型为企业类',
            'in_scope': ['选择对公客户类型'],
            'out_of_scope': ['保存'],
            'done_when': '对公客户类型已选企业类',
            'submit': {'required': False, 'via': 'any', 'button_text': ''},
            'success': {'kinds': [], 'evidence': []},
            'source': 'llm',
        },
    )
    # Simulate one field written: empty pending task_list
    store_field['task_list'] = {'pending': [], 'done': [{'label': '对公客户类型', 'value': '企业类'}]}
    hint_field = next_action_hint(store_field)
    assert_true(
        'NEXT_ACTION: click_save()' not in hint_field,
        'single-field next_action no click_save',
    )
    assert_true('done(success=true)' in hint_field, 'single-field next_action nudges done')
    assert_true(
        'NEXT_ACTION: click_save()' not in _submit_ready_hint(store_field),
        'single-field submit hint no click_save',
    )
    cued = _with_submit_cue('ok | 企业类', store_field)
    assert_true('NEXT_ACTION: click_save()' not in cued, 'single-field with_submit_cue no click_save')
    assert_true(store_field.get('_submit_ready') is not True, 'single-field does not arm recorder save inject')

    store_save: dict = {}
    apply_phase_contract(
        store_save,
        {
            'mode': 'create',
            'refill': 'none',
            'allow_form_assistant': False,
            'goal': '点击保存',
            'in_scope': ['保存'],
            'out_of_scope': [],
            'done_when': '出现成功提示',
            'submit': {'required': True, 'via': 'click_save', 'button_text': '保存'},
            'success': {'kinds': ['toast_ok'], 'evidence': []},
            'source': 'llm',
        },
    )
    store_save['task_list'] = {'pending': [], 'done': [{'label': '客户名称', 'value': 'x'}]}
    assert_true(
        'NEXT_ACTION: click_save()' in next_action_hint(store_save),
        'save phase still nudges click_save',
    )
    # KB-I5 S3 (2026-09-02): watcher-mode seeded-intent exemption for the
    # form-assistant gate. Positive: seeded intent (no contract compile) with
    # mode create/modify + _phase_intent_flag_locked=True → allowed.
    store_seed: dict = {
        '_phase_intent': {'mode': 'create'},
        '_phase_intent_flag_locked': True,
    }
    assert_true(
        contract_allows_form_assistant(store_seed) is True,
        'seeded create intent with locked flag allows assistant',
    )
    store_seed_modify: dict = {
        '_phase_intent': {'mode': 'modify'},
        '_phase_intent_flag_locked': True,
    }
    assert_true(
        contract_allows_form_assistant(store_seed_modify) is True,
        'seeded modify intent with locked flag allows assistant',
    )
    # Negative: seeded mode but no locked flag → denied.
    store_seed_nolock: dict = {'_phase_intent': {'mode': 'create'}}
    assert_true(
        contract_allows_form_assistant(store_seed_nolock) is False,
        'seeded create intent without locked flag denied',
    )
    # Negative: locked flag but no mode → denied.
    store_seed_nomode: dict = {
        '_phase_intent': {},
        '_phase_intent_flag_locked': True,
    }
    assert_true(
        contract_allows_form_assistant(store_seed_nomode) is False,
        'seeded locked flag without mode denied',
    )
    # Negative: locked flag + non-phase mode (watcher never compiled intent) → denied.
    store_seed_query: dict = {
        '_phase_intent': {'mode': 'query'},
        '_phase_intent_flag_locked': True,
    }
    assert_true(
        contract_allows_form_assistant(store_seed_query) is False,
        'seeded query mode denied',
    )

    print('characterize-phase-intent: OK')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
