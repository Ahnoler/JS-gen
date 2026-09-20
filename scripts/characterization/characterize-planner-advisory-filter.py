#!/usr/bin/env python3
"""Characterization: planner advisory filter + compatible_with_contract prompt field."""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.agent_utils import filter_planner_advice  # noqa: E402


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

    prompt = (ROOT / 'scripts' / 'prompts' / 'planner-prompt.md').read_text(encoding='utf-8')
    assert 'compatible_with_contract' in prompt, 'planner JSON schema must require compatible_with_contract'
    print('characterize-planner-advisory-filter: OK')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
