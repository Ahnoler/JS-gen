#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
Characterization: case data lookup / task-mode helpers.

Run:
  python scripts/characterization/characterize-case-data.py
"""
from __future__ import annotations

import json
import os
import sys

_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

from scripts.controller.actions._business_data import (  # noqa: E402
    format_business_data_hint,
    iter_user_business_entries,
    lookup_business_value,
)
from scripts.controller.actions._form import (  # noqa: E402
    _is_query_mode,
    _is_search_dialog,
    _query_not_form_payload,
    _skip_auto_fill,
    _submit_ready_hint,
    _task_done_impl,
    _with_submit_cue,
)
from scripts.controller.actions._phase_context import (  # noqa: E402
    apply_task_mode,
    classify_task_mode,
    force_refill_all_required,
    format_phase_catalog,
    format_phase_preamble,
    format_prior_outcome_line,
    is_open_page_task,
    is_query_task,
    task_mode_hint,
)


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
    assert_true(lookup_business_value(store, '客户名称') == 'UI录制', 'exact name')
    assert_true(lookup_business_value(store, '证件号码') == 'XG123456', 'exact id')
    assert_true(lookup_business_value(store, '客户名称*') == 'UI录制', 'strip required mark')
    assert_true(lookup_business_value(store, '证件号码：') == 'XG123456', 'strip colon')
    assert_true(lookup_business_value(store, 'task_list') is None, 'reserved key ignored')
    assert_true(lookup_business_value(store, '不存在') is None, 'missing')


def test_hint_includes_block_and_flat_kv() -> None:
    """agent_task 业务数据：原文 block 与扁平 KV 同时附上（不再 elif 互斥）。"""
    store = {
        '_case_scenario_text': '关键数据\n法定责任人引入 朱桂武',
        '客户类型': '正式客户',
        '证件类型': '营业执照',
    }
    hint = format_business_data_hint(store)
    assert_true('法定责任人引入 朱桂武' in hint, 'prose block present')
    assert_true('客户类型：正式客户' in hint or '客户类型' in hint, 'flat KV key')
    assert_true('正式客户' in hint, 'flat KV value')
    assert_true('营业执照' in hint, 'second KV')
    assert_true('业务数据' in hint, 'header')


def test_auto_fill_does_not_hard_bind_case_presets() -> None:
    """Product: case KV is agent_task text only — not commandValue hard-bind."""
    from pathlib import Path
    form = (Path(_ROOT) / 'scripts/controller/actions/_form.py').read_text(encoding='utf-8')
    case = (Path(_ROOT) / 'scripts/controller/actions/_business_data.py').read_text(encoding='utf-8')
    assert_true(
        'apply_case_presets_to_fields' not in form,
        '_form must not hard-bind case presets',
    )
    assert_true(
        'def apply_case_presets_to_fields' not in case,
        'apply_case_presets_to_fields removed',
    )


def test_hint_lists_user_keys_only() -> None:
    store = {
        '客户名称': 'UI录制',
        'form_snapshots': [],
        '_ref_date': '2020-01-01',
    }
    entries = iter_user_business_entries(store)
    assert_true(entries == [('客户名称', 'UI录制')], f'entries={entries}')
    hint = format_business_data_hint(store)
    assert_true('客户名称：UI录制' in hint or '客户名称' in hint, 'hint body')
    assert_true('业务数据' in hint, 'hint header')
    assert_true(format_business_data_hint({}) == '', 'empty store')

    # Prefer raw scenario text; flat KV still listed alongside when present
    with_block = {
        '_case_scenario_text': '关键数据\n法定责任人引入 朱桂武',
        '客户名称': '测试科技发展有限公司',
    }
    hint2 = format_business_data_hint(with_block)
    assert_true('法定责任人引入 朱桂武' in hint2, 'block text in hint')
    assert_true('自行判断' in hint2, 'AI-judge cue')
    assert_true('必须优先使用这些值' not in hint2, 'no hard-match mandate')
    assert_true('测试科技发展有限公司' in hint2, 'flat KV alongside block')


def test_search_dialog_heuristic() -> None:
    assert_true(_is_search_dialog('dialog:客户查询') is True, 'query dialog')
    assert_true(_is_search_dialog('dialog:选择客户') is True, 'picker dialog')
    assert_true(_is_search_dialog('dialog:个人客户新增校验') is False, 'add dialog autofills')
    assert_true(_is_search_dialog('drawer:详情') is False, 'drawer not search')
    assert_true(_is_search_dialog('main') is False, 'main')


def test_three_task_modes() -> None:
    login_text = (
        'Navigate to http://test.creditv5p2.tansun.com.cn/#/login\n'
        'Enter username: 701994'
    )
    assert_true(classify_task_mode(login_text) == 'login', 'login url+user')
    assert_true(classify_task_mode('使用账号登录系统') == 'login', 'login cn')
    assert_true(classify_task_mode('查询产品信息') == 'query', 'query')
    assert_true(classify_task_mode('按条件搜索客户') == 'query', 'search')
    assert_true(classify_task_mode('新增个人客户并保存') == 'form_fill', 'fill')
    assert_true(classify_task_mode('录入产品基本信息') == 'form_fill', 'entry')
    assert_true(classify_task_mode('修改客户状态为潜在') == 'form_modify', 'partial modify')
    assert_true(classify_task_mode('编辑产品名称') == 'form_modify', 'edit')
    assert_true(classify_task_mode('修改表单中所有字段') == 'form_modify', 'modify all')
    assert_true(classify_task_mode('选中节点后点击删除') == 'other', 'delete → other')
    assert_true(force_refill_all_required('修改表单中所有字段') is True, 'force all')
    assert_true(force_refill_all_required('修改客户状态为潜在') is False, 'not force')
    assert_true(is_query_task('查询后新增客户并保存') is False, 'mixed not pure query')
    assert_true(classify_task_mode('查询后新增客户并保存') == 'form_fill', 'mixed → fill')
    wizard = (
        '对公客户评级申请界面客户名称搜索为（恒通商贸有限公司），点击下一步。'
        '预期结果：成功进入下一步。'
    )
    assert_true(is_query_task(wizard) is False, 'wizard 搜索+下一步 not query')
    assert_true(classify_task_mode(wizard) == 'other', 'wizard → other')

    # 业务数据 boilerplate must not flip navigate → form_fill
    nav_polluted = (
        '点击客户管理，点击对公客户管理。预期结果：抵达对公客户管理页面。\n\n'
        '【业务数据 — 来自用户需求；按场景填写关键字段】\n关键数据\n法定责任人引入 朱桂武'
    )
    assert_true(classify_task_mode(nav_polluted) == 'other', 'nav polluted → other')
    assert_true(is_query_task('按客户名称搜索，点击查询') is True, 'pure search+查询 still query')

    nav = '进入对公客户管理页面。预期结果：打开对公客户管理列表页面。'
    assert_true(classify_task_mode(nav) == 'other', 'open-page → other not form_modify')
    assert_true(is_open_page_task(nav) is True, 'open-page detect')
    assert_true(classify_task_mode('修改客户状态为潜在') == 'form_modify', 'partial modify still')
    # 「维护」triggers modify today; open-page expect must win
    nav_maintain = '进入客户信息维护列表。预期结果：打开客户信息维护列表页面。'
    assert_true(is_open_page_task(nav_maintain), 'open-page with 维护 in title')
    assert_true(classify_task_mode(nav_maintain) == 'other', 'open-page wins over 维护 keyword')

    q = {}
    assert_true(apply_task_mode(q, '查询产品信息') == 'query', 'apply query')
    assert_true(q['_task_mode'] == 'query' and q['_query_task'] is True, 'query flags')
    assert_true(_skip_auto_fill(q) is True, 'query no autofill')
    assert_true('查询' in task_mode_hint('query'), 'query hint')

    lg = {}
    assert_true(apply_task_mode(lg, login_text) == 'login', 'apply login')
    assert_true(_skip_auto_fill(lg) is True, 'login no autofill')
    assert_true('登录' in task_mode_hint('login'), 'login hint')
    assert_true(task_mode_hint('other') == '', 'other no form hint')

    f = {}
    assert_true(apply_task_mode(f, '新增客户') == 'form_fill', 'apply fill')
    assert_true(f['_force_refill_all'] is True, 'fill force refill for recording')
    assert_true(_skip_auto_fill(f) is False, 'fill allows assistant autofill')
    assert_true('表单填写' in task_mode_hint('form_fill'), 'fill hint')

    mp = {}
    assert_true(apply_task_mode(mp, '修改客户状态为潜在') == 'form_modify', 'apply partial')
    assert_true(mp['_force_refill_all'] is False, 'partial no force without keywords')
    assert_true(_skip_auto_fill(mp) is True, 'partial no autofill without force')
    assert_true('表单修改' in task_mode_hint('form_modify', force_refill_all=False), 'modify hint')

    ma = {}
    assert_true(apply_task_mode(ma, '修改表单中所有字段') == 'form_modify', 'apply all')
    assert_true(ma['_force_refill_all'] is True, 'all force')
    assert_true(_skip_auto_fill(ma) is False, 'all allows assistant autofill')
    assert_true('全部字段' in task_mode_hint('form_modify', force_refill_all=True), 'all hint')

    store = {
        '_task_mode': 'query',
        '_query_task': True,
        '_query_ui': True,
        'task_list': {'pending': [{'label': '产品名称'}], 'done': []},
        '_autofill_summary': 'auto-fill-complete done=4 fillable_pending=0',
    }
    assert_true(_is_query_mode(store) is True, 'query mode')
    assert_true(_submit_ready_hint(store) == '', 'no form submit cue')
    assert_true(_with_submit_cue('ok', store) == 'ok', 'no autofill/submit append')
    _task_done_impl('产品名称', store, value='x')
    assert_true(len((store.get('task_list') or {}).get('pending') or []) == 1, 'no task_done')
    payload = json.loads(_query_not_form_payload('main'))
    assert_true(payload.get('not_form_fill') is True and payload.get('mode') == 'query_filter', 'payload')

    save_store = {'task_list': {'pending': [], 'done': [{'label': '客户名称', 'value': 'x'}]}}
    assert_true('click_save' in _submit_ready_hint(save_store), 'save cue')


def test_phase_preamble_catalog_and_prior() -> None:
    cat = format_phase_catalog([
        {'phaseNumber': 1, 'title': '登录'},
        {'phaseNumber': 2, 'title': '进入对公客户管理'},
    ], 2)
    assert_true('【阶段目录】' in cat, 'catalog header')
    assert_true('2. 进入对公客户管理 ←当前' in cat, 'catalog marks current')

    prior = format_prior_outcome_line({
        'phaseNumber': 1,
        'success': True,
        'text': '已登录系统',
    })
    assert_true('【上一阶段结果】阶段1：成功 — 已登录系统' == prior, 'prior line')
    prior_unknown = format_prior_outcome_line({
        'phaseNumber': 3,
        'success': None,
        'text': '见页面当前状态',
    })
    assert_true(
        '【上一阶段结果】阶段3：未知 — 见页面当前状态' == prior_unknown,
        'prior unknown when success is null',
    )
    prior_fail = format_prior_outcome_line({
        'phaseNumber': 2,
        'success': False,
        'text': '未选中字段',
    })
    assert_true(
        '【上一阶段结果】阶段2：失败 — 未选中字段' == prior_fail,
        'prior failure line',
    )

    preamble = format_phase_preamble(
        current_phase=2,
        current_task='打开客户列表',
        prior_phases=None,
        business_data_store=None,
        all_phases=[
            {'phaseNumber': 1, 'title': '登录'},
            {'phaseNumber': 2, 'title': '进入对公客户管理'},
        ],
        prior_outcome={'phaseNumber': 1, 'success': True, 'text': '已登录系统'},
    )
    assert_true('【阶段目录】' in preamble, 'preamble has catalog')
    assert_true('【上一阶段结果】' in preamble, 'preamble has prior')
    assert_true('【当前任务 — 阶段2】' in preamble, 'preamble has current task')
    assert_true('打开客户列表' in preamble, 'preamble keeps task text')
    assert_true('【业务场景】' not in preamble, 'no legacy scenario dump')

    # Full trajectory catalog (not only selected recording subset)
    full = format_phase_preamble(
        current_phase=3,
        current_task='新增客户',
        prior_phases=None,
        business_data_store=None,
        all_phases=[
            {'phaseNumber': 1, 'title': '登录系统'},
            {'phaseNumber': 2, 'title': '进入客户管理'},
            {'phaseNumber': 3, 'title': '新增客户'},
            {'phaseNumber': 4, 'title': '保存校验'},
        ],
        prior_outcome={'phaseNumber': 2, 'success': True, 'text': '已打开列表'},
    )
    assert_true('1. 登录系统' in full, 'catalog phase 1')
    assert_true('2. 进入客户管理' in full, 'catalog phase 2')
    assert_true('3. 新增客户 ←当前' in full, 'catalog marks current')
    assert_true('4. 保存校验' in full, 'catalog includes unselected later phase')


def test_recording_runner_all_phases_from_full_trajectory() -> None:
    """Source: stepData.all_phases maps allPhases, not filtered phases."""
    from pathlib import Path
    src = (Path(_ROOT) / 'src/services/trajectory/trajectory-recording-runner.js').read_text(
        encoding='utf-8',
    )
    assert_true(
        'const all_phases = allPhases.map' in src.replace('\r\n', '\n'),
        'all_phases must map from allPhases (full trajectory)',
    )
    assert_true(
        'const all_phases = phases.map' not in src.replace('\r\n', '\n'),
        'must not map filtered phases into catalog',
    )


def main() -> None:
    test_lookup_exact_and_fuzzy()
    test_hint_includes_block_and_flat_kv()
    test_auto_fill_does_not_hard_bind_case_presets()
    test_hint_lists_user_keys_only()
    test_search_dialog_heuristic()
    test_three_task_modes()
    test_phase_preamble_catalog_and_prior()
    test_recording_runner_all_phases_from_full_trajectory()
    print('characterize-case-data: OK')


if __name__ == '__main__':
    main()
