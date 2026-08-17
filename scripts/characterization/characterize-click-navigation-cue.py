#!/usr/bin/env python3
"""Characterization for click navigation cue (E5).

Pure helpers only (message injection wiring verified by unit-style fake in Task 3).
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.controller.actions.click_navigation_cue import (  # noqa: E402
    goal_loop_nav_hint_message,
    navigation_changed,
    navigation_cue_message,
)


def assert_true(cond: bool, msg: str) -> None:
    if not cond:
        raise AssertionError(msg)


def main() -> int:
    assert_true(navigation_changed('a', 'b'), 'different url → changed')
    assert_true(not navigation_changed('a', 'a'), 'same url → not changed')
    assert_true(not navigation_changed('', 'b'), 'empty before → not changed')
    assert_true(not navigation_changed(None, None), 'both none → not changed')

    msg = navigation_cue_message('http://x/old', 'http://x/new')
    assert_true(msg.startswith('[导航]'), 'nav cue prefix')
    assert_true('页面已跳转' in msg and 'http://x/new' in msg, 'nav cue content')
    assert_true('停止' in msg and 'click_save' in msg, 'nav cue instructs stop+proceed')

    hint = goal_loop_nav_hint_message()
    assert_true(hint.startswith('[导航]') and 'URL' in hint and '停止' in hint, 'goal loop hint')

    print('characterize-click-navigation-cue: OK')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())


class _FakeMM:
    def __init__(self):
        self.messages = []

    def _add_message_with_tokens(self, msg):
        self.messages.append(msg)


class _FakeAgent:
    def __init__(self):
        self._message_manager = _FakeMM()


def main() -> int:
    # --- pure helpers ---
    assert_true(navigation_changed('a', 'b'), 'different url → changed')
    assert_true(not navigation_changed('a', 'a'), 'same url → not changed')
    assert_true(not navigation_changed('', 'b'), 'empty before → not changed')
    assert_true(not navigation_changed(None, None), 'both none → not changed')

    msg = navigation_cue_message('http://x/old', 'http://x/new')
    assert_true(msg.startswith('[导航]'), 'nav cue prefix')
    assert_true('页面已跳转' in msg and 'http://x/new' in msg, 'nav cue content')
    assert_true('停止' in msg and 'click_save' in msg, 'nav cue instructs stop+proceed')

    hint = goal_loop_nav_hint_message()
    assert_true(hint.startswith('[导航]') and 'URL' in hint and '停止' in hint, 'goal loop hint')

    # --- emitter wiring (flag -> HumanMessage) ---
    from scripts.agent.recorder_emitters import _emit_navigation_cue

    store = {'_last_click_navigated': {'from': 'http://x/a', 'to': 'http://x/b'}}
    ag = _FakeAgent()
    _emit_navigation_cue(store, ag)
    assert_true(
        len(ag._message_manager.messages) == 1
        and str(ag._message_manager.messages[0].content).startswith('[导航]'),
        'emitter injected nav cue',
    )
    assert_true('_last_click_navigated' not in store, 'flag cleared after injection')

    ag2 = _FakeAgent()
    _emit_navigation_cue({}, ag2)
    assert_true(len(ag2._message_manager.messages) == 0, 'no nav flag → no cue')

    print('characterize-click-navigation-cue: OK')
    return 0
