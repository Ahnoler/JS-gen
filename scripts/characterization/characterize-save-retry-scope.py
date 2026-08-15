#!/usr/bin/env python3
"""Lightweight characterization for click_save stale-scope self-heal.

Bug: click_save scope resolution uses sticky _phase_section memory; when the
remembered section no longer exists the JS returns not-found with candidates
that point at the real region. The tool surfaced an err to the agent instead
of retrying the unique candidate region.
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.controller.actions.section_scope import save_retry_scope  # noqa: E402


def assert_true(cond: bool, msg: str) -> None:
    if not cond:
        raise AssertionError(msg)


def main() -> int:
    cand_main = [{'section_title': '主区', 'section_id': 'main', 'text': '保存'}]

    assert_true(
        save_retry_scope('not-found', cand_main, explicit_scope=False) == '主区',
        'unique candidate region must be returned for non-explicit scope',
    )
    assert_true(
        save_retry_scope('not-found', cand_main, explicit_scope=True) == '',
        'explicit region= must never be auto-overridden',
    )
    assert_true(
        save_retry_scope('ambiguous', cand_main, explicit_scope=False) == '',
        'only not-found triggers self-heal',
    )
    assert_true(
        save_retry_scope('not-found', [], explicit_scope=False) == '',
        'empty candidates → no retry scope',
    )
    assert_true(
        save_retry_scope(
            'not-found',
            [
                {'section_title': '主区', 'section_id': 'main', 'text': '保存'},
                {'section_title': '侧区', 'section_id': 'side', 'text': '保存'},
            ],
            explicit_scope=False,
        ) == '',
        'ambiguous candidates → no auto pick',
    )
    assert_true(
        save_retry_scope(
            'not-found',
            [{'section_id': 'main', 'text': '保存'}],
            explicit_scope=False,
        ) == 'main',
        'section_id fallback when section_title missing',
    )

    print('characterize-save-retry-scope: OK')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
