#!/usr/bin/env python3
"""Characterization for Phase Reviewer JSON normalize (no live LLM)."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.actions._phase_reviewer import (  # noqa: E402
    contract_debug_line,
    normalize_reviewer_payload,
    resolve_phase_max_steps,
    sanitize_contract_for_mode,
)
from scripts.actions._phase_intent import (  # noqa: E402
    apply_phase_contract,
    has_contract_success,
)


def main() -> None:
    raw = '''```json
{"mode":"navigate","allow_form_assistant":false,"refill":"none",
 "goal":"打开列表","in_scope":["进菜单"],"out_of_scope":["点修改"],
 "done_when":"列表可见","submit":{"required":false,"via":"any","button_text":""},
 "success":{"kinds":[],"evidence":[]}}
```'''
    c = normalize_reviewer_payload(raw)
    assert c and c['mode'] == 'navigate' and c['allow_form_assistant'] is False
    assert normalize_reviewer_payload(
        '{"mode":"create","allow_form_assistant":"false","refill":"all_editable",'
        '"goal":"","in_scope":[],"out_of_scope":[],"done_when":"",'
        '"submit":{"required":true,"via":"click_save","button_text":"保存"},'
        '"success":{"kinds":[],"evidence":[]}}'
    )['allow_form_assistant'] is False
    assert normalize_reviewer_payload('not json') is None
    assert normalize_reviewer_payload('{"mode":"nope"}') is None  # invalid mode

    # LLM invents maintain tokens on login → sanitize clears them
    polluted = normalize_reviewer_payload(
        '{"mode":"login","allow_form_assistant":true,"refill":"all_editable",'
        '"goal":"登录","in_scope":[],"out_of_scope":[],"done_when":"进入首页",'
        '"submit":{"required":true,"via":"any","button_text":""},'
        '"success":{"kinds":["toast_ok","url_change"],"evidence":[]}}'
    )
    assert polluted is not None
    assert polluted['submit']['required'] is False
    assert polluted['success']['kinds'] == []
    assert polluted['allow_form_assistant'] is False
    assert polluted['refill'] == 'none'

    store = {}
    apply_phase_contract(store, {
        'mode': 'login',
        'allow_form_assistant': True,
        'refill': 'all_editable',
        'goal': '登录',
        'in_scope': [],
        'out_of_scope': [],
        'done_when': '进入首页',
        'submit': {'required': True, 'via': 'any', 'button_text': ''},
        'success': {'kinds': ['toast_ok', 'url_change'], 'evidence': []},
        'source': 'llm',
    })
    assert store['_phase_intent']['submit']['required'] is False
    assert store['_phase_intent']['success']['kinds'] == []
    assert store['_phase_boundary']['success_when'] == []
    assert has_contract_success(store) is True
    assert 'submit.required=False' in contract_debug_line(store['_phase_intent'])
    assert 'success.kinds=[]' in contract_debug_line(store['_phase_intent'])

    # create keeps submit tokens
    kept = sanitize_contract_for_mode({
        'mode': 'create',
        'submit': {'required': True, 'via': 'click_save', 'button_text': '保存'},
        'success': {'kinds': ['toast_ok'], 'evidence': []},
        'refill': 'all_editable',
        'allow_form_assistant': True,
    })
    assert kept['submit']['required'] is True
    assert kept['success']['kinds'] == ['toast_ok']

    # force-cap: effort buckets / estimated_steps+buffer=2, never above ceiling
    assert resolve_phase_max_steps(30, {'effort': 'short'}) == 5
    assert resolve_phase_max_steps(30, {'effort': 'medium'}) == 15
    assert resolve_phase_max_steps(30, {'effort': 'long'}) == 30
    assert resolve_phase_max_steps(10, {'effort': 'long'}) == 10
    assert resolve_phase_max_steps(30, {'estimated_steps': 2}) == 4  # 2+2 buffer
    assert resolve_phase_max_steps(30, {'estimated_steps': 4}) == 6
    assert resolve_phase_max_steps(30, {'estimated_steps': 4, 'effort': 'long'}) == 6  # int wins
    assert resolve_phase_max_steps(30, {}) == 30
    assert resolve_phase_max_steps(30, None) == 30

    raw_plan = (
        '{"mode":"navigate","allow_form_assistant":false,"refill":"none",'
        '"goal":"进列表","in_scope":[],"out_of_scope":[],"done_when":"列表可见",'
        '"submit":{"required":false,"via":"any","button_text":""},'
        '"success":{"kinds":[],"evidence":[]},"effort":"short",'
        '"brief_plan":["点客户管理","点对公客户管理","确认列表"]}'
    )
    c_plan = normalize_reviewer_payload(raw_plan)
    assert c_plan and c_plan.get('effort') == 'short' and len(c_plan.get('brief_plan') or []) == 3

    # missing brief_plan → backfill from goal
    c2 = normalize_reviewer_payload(
        '{"mode":"navigate","allow_form_assistant":false,"refill":"none",'
        '"goal":"打开新增抽屉","in_scope":[],"out_of_scope":[],"done_when":"抽屉可见",'
        '"submit":{"required":false,"via":"any","button_text":""},'
        '"success":{"kinds":[],"evidence":[]},"effort":"short"}'
    )
    assert c2 and c2['brief_plan'] == ['打开新增抽屉']

    print('PASS characterize-phase-reviewer')


if __name__ == '__main__':
    main()
