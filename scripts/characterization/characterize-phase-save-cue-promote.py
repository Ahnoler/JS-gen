#!/usr/bin/env python3
"""Characterization for Phase Reviewer save-cue misclassification promotion.

D1 gate: promote_contract_for_save_cues must upgrade LLM contracts that
degraded navigate/query/other to create/modify when the deterministic
classifier says form_fill/form_modify and the task text carries a save cue.
D2 gate: prompt rules 2/8 carry the anti-navigate trap wording. No live LLM.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.controller.actions.phase.reviewer import (  # noqa: E402
    promote_contract_for_save_cues,
)

REVIEWER_PY = ROOT / 'scripts' / 'controller' / 'actions' / 'phase' / 'reviewer.py'
PROMPT_MD = ROOT / 'scripts' / 'prompts' / 'phase-reviewer-prompt.md'


def _check(cond: bool, msg: str) -> None:
    if not cond:
        raise AssertionError(msg)


def main() -> None:
    reviewer_body = REVIEWER_PY.read_text(encoding='utf-8')
    prompt_body = PROMPT_MD.read_text(encoding='utf-8')

    # Static pins: D1 gate survives; call site wraps normalize.
    _check('def promote_contract_for_save_cues(' in reviewer_body,
           'promote_contract_for_save_cues def missing')
    _check('_SAVE_CUE_RE' in reviewer_body, '_SAVE_CUE_RE missing')
    _check('promote_contract_for_save_cues(normalize_reviewer_payload' in reviewer_body,
           'call site does not wrap normalize_reviewer_payload')
    _check('classify_task_mode' in reviewer_body,
           'classify lazy import missing')
    _check('def sanitize_contract_for_mode' in reviewer_body,
           'sanitize_contract_for_mode removed')
    _check('narrative=derived' in reviewer_body,
           'stderr narrative=derived suffix missing')
    _check('llm+guard' in reviewer_body, 'llm+guard source marker missing')

    # Static pins: D2 prompt trap rules.
    _check('禁止 navigate/query' in prompt_body, 'rule 8 anti-navigate wording missing')
    _check('saved_navigation' in prompt_body, 'saved_navigation missing in prompt')
    _check('mode=create' in prompt_body, 'rule 2 example mode=create missing')
    _check('submit.required=true' in prompt_body, 'rule 2 example submit.required=true missing')

    # Functional pins: promotion only fires on save cue + deterministic.
    base = {
        'mode': 'navigate', 'allow_form_assistant': False, 'refill': 'none',
        'goal': '点击新增按钮以进入...', 'in_scope': [], 'out_of_scope': [],
        'done_when': '...',
        'submit': {'required': False, 'via': 'any', 'button_text': ''},
        'success': {'kinds': [], 'evidence': []}, 'source': 'llm',
    }

    # A) incident text (2026-08-27 d3943e89): LLM said navigate -> promote create.
    task_a = (
        '新增一个信贷潜在客户辰瀚投资控股集团有限公司，点击保存。'
        '预期结果：页面跳转至客户基本信息填写页或提示保存成功。'
    )
    a = promote_contract_for_save_cues(dict(base), task_a)
    assert a is not None
    assert a['mode'] == 'create', a['mode']
    assert a['submit']['required'] is True
    assert a['success']['kinds'] == ['toast_ok', 'url_change', 'saved_navigation']
    assert a['allow_form_assistant'] is True
    assert a['refill'] == 'all_editable'

    # E(derive) gate: narrative fields re-derived from task text + det template.
    assert a['goal'] == task_a[:300], f'A goal not derived from task text: {a["goal"]!r}'
    assert '保存' in a['done_when'], 'A done_when must mention 保存'
    assert '校验' in a['done_when'], 'A done_when must mention 校验'
    assert any('保存' in x for x in a['in_scope']), 'A in_scope must mention 保存'
    assert '后续阶段' in a['out_of_scope'][0], 'A out_of_scope[0] must mention 后续阶段'
    assert not any(
        '不办理' in x or '只打开' in x for x in a['out_of_scope']
    ), 'A out_of_scope must not carry navigation-template residue'
    assert (
        '不办理' not in a['done_when'] and '只打开' not in a['done_when']
    ), 'A done_when must not carry navigation-template residue'
    assert a['source'] == 'llm+guard', f'A source must be llm+guard: {a["source"]!r}'
    assert any('保存' in x for x in a['brief_plan']), 'A brief_plan must mention 保存'

    # B) pure open-page navigate: no save cue, deterministic=other -> unchanged.
    b = promote_contract_for_save_cues(
        dict(base), '点击客户管理，点击对公客户管理。预期结果：进入对公客户管理页面。'
    )
    assert b is not None
    assert b['mode'] == 'navigate'
    assert b['submit']['required'] is False
    assert b['allow_form_assistant'] is False
    assert b['refill'] == 'none'
    assert b['goal'] == base['goal'], 'B no-promote: goal must stay LLM navigation goal'
    assert b['source'] == 'llm', 'B no-promote: source must stay llm'

    # C) pure query: deterministic=query -> unchanged.
    c = promote_contract_for_save_cues(dict(base), '查询产品信息')
    assert c is not None
    assert c['mode'] == 'navigate'
    assert c['submit']['required'] is False
    assert c['goal'] == base['goal'], 'C no-promote: goal must stay unchanged'
    assert c['source'] == 'llm', 'C no-promote: source must stay llm'

    # D) create without save cue -> unchanged (form_fill but no _SAVE_CUE_RE hit).
    d = promote_contract_for_save_cues(dict(base), '新增一个客户基本档案。')
    assert d is not None
    assert d['mode'] == 'navigate'
    assert d['submit']['required'] is False
    assert d['goal'] == base['goal'], 'D no-promote: goal must stay unchanged'
    assert d['source'] == 'llm', 'D no-promote: source must stay llm'

    # E) modify + save cue -> promote modify.
    e = promote_contract_for_save_cues(dict(base), '修改客户状态为潜在并点击保存。')
    assert e is not None
    assert e['mode'] == 'modify'
    assert e['submit']['required'] is True
    assert e['success']['kinds'] == ['toast_ok', 'url_change', 'saved_navigation']

    # F) None / non-dict contract pass through untouched.
    assert promote_contract_for_save_cues(None, '任何文本') is None
    assert promote_contract_for_save_cues('not-a-dict', '任何文本') == 'not-a-dict'

    # G) create/modify contracts are never touched by the guard.
    g = promote_contract_for_save_cues(
        dict(base, mode='create', submit={'required': True, 'via': 'click_save', 'button_text': '保存'},
             success={'kinds': ['toast_ok'], 'evidence': ['x']}),
        '新增一个信贷潜在客户，点击保存。',
    )
    assert g is not None
    assert g['mode'] == 'create'
    assert g['submit']['required'] is True
    assert g['submit']['via'] == 'click_save'
    assert g['success']['kinds'] == ['toast_ok']
    assert g['success']['evidence'] == ['x']

    # H) derived narrative carries no navigation-template residue
    #    (进入…页面 / 打开页面) in in_scope / out_of_scope.
    nav_residue = re.compile(r'进入[^，。；]*页面|打开页面')
    for item in a['in_scope']:
        assert not nav_residue.search(item), f'H in_scope nav residue: {item!r}'
    for item in a['out_of_scope']:
        assert not nav_residue.search(item), f'H out_of_scope nav residue: {item!r}'

    print('PASS characterize-phase-save-cue-promote')


if __name__ == '__main__':
    main()
