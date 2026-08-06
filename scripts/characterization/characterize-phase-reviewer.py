#!/usr/bin/env python3
"""Characterization for Phase Reviewer JSON normalize (no live LLM)."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.actions._phase_reviewer import normalize_reviewer_payload  # noqa: E402


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
    print('PASS characterize-phase-reviewer')


if __name__ == '__main__':
    main()
