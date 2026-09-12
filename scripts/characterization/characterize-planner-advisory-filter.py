#!/usr/bin/env python3
"""Characterization: planner advisory filter + compatible_with_contract prompt field.

Also pins live wiring: apply_planner_advice_filter discard logging and
session_runner calling patch_planner_advice_filter.
"""
from __future__ import annotations

import io
import json
import sys
from contextlib import redirect_stderr
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.agent_utils import (  # noqa: E402
    apply_planner_advice_filter,
    filter_planner_advice,
    planner_advice_discard_reason,
)


def main() -> int:
    c = {'out_of_scope': ['点修改'], 'version': 1}
    assert filter_planner_advice(
        {'compatible_with_contract': False, 'next_steps': ['x']}, c
    ) is None
    assert filter_planner_advice(
        {'compatible_with_contract': True, 'next_steps': ['调用 done() 结束']}, c
    ) is None
    kept = filter_planner_advice(
        {'compatible_with_contract': True, 'next_steps': ['填写字段'], 'challenges': []},
        c,
    )
    assert kept is not None

    assert filter_planner_advice(
        {'next_steps': ['填写字段']}, c
    ) is None, 'missing compatible_with_contract must discard'

    assert planner_advice_discard_reason(
        {'compatible_with_contract': False, 'next_steps': ['x']}
    ) == 'compatible_with_contract!=true'
    assert planner_advice_discard_reason(
        {'compatible_with_contract': True, 'next_steps': ['调用 done() 结束']}
    ) == 'next_steps_instruct_done'
    # task_done(...) must not trip the done()-instruction detector (r4 wet false positive).
    assert planner_advice_discard_reason(
        {
            'compatible_with_contract': True,
            'next_steps': ["task_done(label='客户状态') 清除 pending"],
        }
    ) is None
    assert filter_planner_advice(
        {
            'compatible_with_contract': True,
            'next_steps': ["task_done(label='客户状态') 清除 pending"],
            'challenges': [],
        },
        c,
    ) is not None

    bad = json.dumps(
        {
            'compatible_with_contract': False,
            'next_steps': ['点修改'],
            'challenges': ['out_of_scope'],
        },
        ensure_ascii=False,
    )
    err = io.StringIO()
    with redirect_stderr(err):
        out = apply_planner_advice_filter(bad, c)
    assert out is None, out
    err_text = err.getvalue()
    assert '[planner] discard' in err_text, err_text
    assert 'compatible_with_contract!=true' in err_text, err_text
    assert 'challenges' in err_text, err_text

    good = json.dumps(
        {'compatible_with_contract': True, 'next_steps': ['填写字段'], 'challenges': []},
        ensure_ascii=False,
    )
    kept_err = io.StringIO()
    with redirect_stderr(kept_err):
        kept_plan = apply_planner_advice_filter(good, c)
    assert kept_plan is not None
    assert '填写字段' in kept_plan
    assert '[planner] kept' in kept_err.getvalue(), kept_err.getvalue()

    # Markdown-fenced JSON still discarded
    fenced = '```json\n{"compatible_with_contract": false, "next_steps": ["x"], "challenges": []}\n```'
    fence_err = io.StringIO()
    with redirect_stderr(fence_err):
        assert apply_planner_advice_filter(fenced, c) is None
    assert '[planner] discard' in fence_err.getvalue(), fence_err.getvalue()

    # Non-JSON plans pass through
    assert apply_planner_advice_filter('not-json', c) == 'not-json'

    prompt = (ROOT / 'scripts' / 'prompts' / 'planner-prompt.md').read_text(encoding='utf-8')
    assert 'compatible_with_contract' in prompt, 'planner JSON schema must require compatible_with_contract'

    utils = (ROOT / 'scripts' / 'agent_utils.py').read_text(encoding='utf-8')
    assert 'def patch_planner_advice_filter' in utils
    assert 'filter_planner_advice' in utils
    runner = (ROOT / 'scripts' / 'session_runner.py').read_text(encoding='utf-8')
    assert 'patch_planner_advice_filter()' in runner, 'session must install planner filter patch'
    service = (ROOT / 'scripts' / 'agent' / 'service.py').read_text(encoding='utf-8')
    assert '_jsgen_business_data' in service, 'Agent must carry business_data for contract filter'

    print('characterize-planner-advisory-filter: OK')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
