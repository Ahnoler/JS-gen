#!/usr/bin/env python3
"""Lightweight characterization for recorder done-accept reason labeling.

Bug: recorder_emitters picks introduce > save-ok regardless of the phase
contract, so a lingering _last_introduce_ok from an earlier introduce step
labels a create phase's toast_ok acceptance as "after introduce".
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.controller.actions.phase.intent_gates import done_accept_reason  # noqa: E402


def assert_true(cond: bool, msg: str) -> None:
    if not cond:
        raise AssertionError(msg)


def main() -> int:
    create = {'mode': 'create', 'success': {'kinds': ['toast_ok', 'url_change']}}
    introduce = {'mode': 'introduce_pick', 'success': {'kinds': ['confirm_click', 'picker_closed']}}
    query = {'mode': 'query', 'success': {'kinds': []}}

    assert_true(
        done_accept_reason(create, save_ok=True, introduce_ok=True) == 'save-ok',
        'create contract must label save-ok, not lingering introduce flag',
    )
    assert_true(
        done_accept_reason(create, save_ok=True, introduce_ok=True, navigated_ok=True) == 'navigation',
        'create contract with post-save URL change must label navigation',
    )
    assert_true(
        done_accept_reason(introduce, save_ok=False, introduce_ok=True) == 'introduce',
        'introduce contract must label introduce',
    )
    assert_true(
        done_accept_reason(None, save_ok=True, introduce_ok=True) == 'introduce',
        'no contract keeps legacy introduce-first priority',
    )
    assert_true(
        done_accept_reason(query, save_ok=True, introduce_ok=False) == 'save-ok',
        'query contract without save kinds keeps legacy fallback',
    )

    print('characterize-done-accept-reason: OK')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
