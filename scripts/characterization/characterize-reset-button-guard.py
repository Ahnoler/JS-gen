#!/usr/bin/env python3
"""Characterization: reset/clear button click guard in ClickEngine.

Incident: during AI recording of query/filter phases the agent occasionally
fills search fields, then clicks the "重置" button, then clicks "查询" — the
reset wipes the just-filled conditions and the query returns nothing, blocking
the rest of the flow.

Pin: clicking a reset/clear button is only allowed when the current phase
description explicitly asks for it (contains 重置/清空/恢复默认).  Query and
form-fill phases without such wording must block the click.
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.controller.actions.click_action_engine import (  # noqa: E402
    _is_reset_button_label,
    _phase_text_excerpt,
    _reset_click_allowed,
)


def assert_true(cond: bool, msg: str) -> None:
    if not cond:
        raise AssertionError(msg)


def test_reset_button_label_recognition() -> None:
    # Core reset/clear labels
    for label in ('重置', '清空', '清除', '恢复默认', '全部清空', '清空条件',
                  '清空筛选', '清除条件', '清除筛选'):
        assert_true(
            _is_reset_button_label(label),
            f"'{label}' should be recognized as reset/clear button label",
        )
    # Variant spacing
    assert_true(_is_reset_button_label(' 重置 '), "spaced 重置 should match")
    assert_true(_is_reset_button_label('清 空'), "spaced 清空 should match")

    # Non-reset labels must not match
    for label in ('查询', '搜索', '保存', '提交', '确认', '新增', '修改',
                  '重置密码', '清空缓存', '恢复出厂设置'):
        assert_true(
            not _is_reset_button_label(label),
            f"'{label}' should NOT be recognized as reset/clear button label",
        )


def test_phase_text_excerpt_source() -> None:
    store: dict = {}
    assert_true(_phase_text_excerpt(store) == '', "empty store gives empty excerpt")

    store['_phase_intent'] = {'task_text_excerpt': 'intent excerpt'}
    assert_true(_phase_text_excerpt(store) == 'intent excerpt',
                "should read task_text_excerpt from _phase_intent")

    store['_phase_boundary'] = {'task_text_excerpt': 'boundary excerpt'}
    assert_true(_phase_text_excerpt(store) == 'intent excerpt',
                "_phase_intent should take precedence over _phase_boundary")

    store.pop('_phase_intent')
    assert_true(_phase_text_excerpt(store) == 'boundary excerpt',
                "should fall back to _phase_boundary when _phase_intent absent")


def test_reset_allowed_only_when_phase_asks() -> None:
    # Explicit reset phase
    reset_phase = {'_phase_boundary': {'task_text_excerpt': '点击重置按钮，清空所有查询条件并恢复默认状态。'}}
    assert_true(
        _reset_click_allowed(reset_phase, '重置'),
        "phase explicitly asking for reset must allow reset click",
    )

    # Explicit clear phase
    clear_phase = {'_phase_intent': {'task_text_excerpt': '清空筛选条件。'}}
    assert_true(
        _reset_click_allowed(clear_phase, '清空'),
        "phase explicitly asking for clear must allow clear click",
    )

    # Compound query+reset phase
    compound_phase = {
        '_phase_boundary': {
            'task_text_excerpt': '填写查询条件并点击查询，然后点击重置按钮恢复默认。'
        }
    }
    assert_true(
        _reset_click_allowed(compound_phase, '重置'),
        "compound phase with reset wording must allow reset click",
    )

    # Pure query phase must NOT allow reset
    query_phase = {'_phase_boundary': {'task_text_excerpt': '在查询条件中输入编号并点击查询。'}}
    assert_true(
        not _reset_click_allowed(query_phase, '重置'),
        "pure query phase must NOT allow reset click",
    )

    # Form fill phase must NOT allow reset
    fill_phase = {'_phase_intent': {'task_text_excerpt': '新增客户信息，填写所有必填字段后保存。'}}
    assert_true(
        not _reset_click_allowed(fill_phase, '重置'),
        "form fill phase must NOT allow reset click",
    )

    # Open page / navigate phase must NOT allow reset
    nav_phase = {'_phase_boundary': {'task_text_excerpt': '点击客户管理菜单，打开客户列表页面。'}}
    assert_true(
        not _reset_click_allowed(nav_phase, '重置'),
        "open-page phase must NOT allow reset click",
    )

    # No phase contract -> conservative deny
    assert_true(
        not _reset_click_allowed({}, '重置'),
        "no phase contract must conservatively deny reset click",
    )


def main() -> int:
    test_reset_button_label_recognition()
    test_phase_text_excerpt_source()
    test_reset_allowed_only_when_phase_asks()
    print("characterize-reset-button-guard: all passed")
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
