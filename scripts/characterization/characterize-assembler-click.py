#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
Characterization: click_element_by_index button vs menu vs absolute-xpath branching.

Run:
  python scripts/characterization/characterize-assembler-click.py
  # or from repo root with PYTHONPATH=.
  PYTHONPATH=. python scripts/characterization/characterize-assembler-click.py
"""
from __future__ import annotations

import os
import sys

# Allow `python scripts/characterization/characterize-assembler-click.py` from repo root
_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

from scripts.script_assembler import _click_kind, _generate_action_code  # noqa: E402


def assert_true(cond: bool, msg: str) -> None:
    if not cond:
        raise AssertionError(msg)


DRAWER_SMART = (
    "(//div[contains(@class,'el-drawer')])[last()]"
    "//button[normalize-space()='保存']"
)
MENU_XPATH = '/html/body/div[1]/div/section/div[1]/nav/ul/li[3]'


def test_click_kind_classification() -> None:
    assert_true(
        _click_kind(
            'li',
            {'class': 'el-menu-item'},
            '',
            MENU_XPATH,
            '',
        )
        == 'menu',
        'nav li.el-menu-item should be menu',
    )
    assert_true(
        _click_kind('button', {'class': 'el-button'}, DRAWER_SMART, '/html/body/div[5]/button', '')
        == 'button',
        'drawer button should be button',
    )
    assert_true(
        _click_kind('button', {'class': 'el-button el-button--primary'}, '', '', '') == 'button',
        'primary el-button should be button',
    )
    assert_true(
        _click_kind('div', {}, '', '/html/body/div[1]/div/span[2]', '') == 'generic',
        'plain div xpath should be generic',
    )


def test_menu_assemble_avoids_button_role() -> None:
    code = _generate_action_code(
        {
            'action': 'click_element_by_index',
            'params': {'index': 10, 'text': '客户管理', 'tag_name': 'li'},
            'target': MENU_XPATH,
            'tagName': 'li',
            'attributes': {'class': 'el-menu-item'},
            'element': {
                'tag': 'li',
                'xpath': MENU_XPATH,
                'xpath_full': MENU_XPATH,
                'text': '客户管理',
                'attributes': {'class': 'el-menu-item'},
            },
        },
        2,
        'http://example.com',
    )
    assert_true('getByRole' not in code, 'menu click must not use getByRole(button)')
    assert_true('text_btn' not in code, 'menu click must not use text_btn chain')
    assert_true('el-menu-item' in code, 'menu click should target .el-menu-item')
    assert_true('(menu)' in code, 'log should mark kind=menu')
    assert_true(MENU_XPATH in code or 'xpath=' in code, 'menu click should keep absolute xpath')


def test_button_assemble_keeps_smart_role() -> None:
    code = _generate_action_code(
        {
            'action': 'click_element_by_index',
            'params': {'index': 5, 'text': '保存', 'tag_name': 'button'},
            'target': DRAWER_SMART,
            'tagName': 'button',
            'element': {
                'tag': 'button',
                'xpath_smart': DRAWER_SMART,
                'xpath': DRAWER_SMART,
                'text': '保存',
                'attributes': {'class': 'el-button'},
                'candidates': [
                    {'type': 'xpath_smart', 'value': DRAWER_SMART},
                    {'type': 'xpath_full', 'value': '/html/body/div[5]/button[1]'},
                ],
            },
        },
        3,
        'http://example.com',
    )
    assert_true("getByRole('button'" in code, 'button click should use getByRole')
    assert_true('(button)' in code, 'log should mark kind=button')
    assert_true('xpath_smart' in code or 'el-drawer' in code, 'button should keep xpath_smart')


def test_absolute_xpath_only_still_assembles() -> None:
    xp = '/html/body/div[1]/div/section/div[3]/button[1]'
    code = _generate_action_code(
        {
            'action': 'click_element_by_index',
            'params': {'index': 2, 'text': '', 'tag_name': 'button'},
            'target': xp,
            'tagName': 'button',
            'element': {
                'tag': 'button',
                'xpath': xp,
                'xpath_full': xp,
                'text': '',
                'attributes': {'class': 'el-button'},
            },
        },
        4,
        'http://example.com',
    )
    assert_true(code.strip() != '', 'absolute xpath-only click must produce code')
    assert_true('xpath=' in code or xp in code, 'must include xpath locator')
    assert_true('_clicked4' in code, 'must emit click degradation flag')
    assert_true('getByRole' not in code, 'no text → no getByRole')


def main() -> None:
    test_click_kind_classification()
    test_menu_assemble_avoids_button_role()
    test_button_assemble_keeps_smart_role()
    test_absolute_xpath_only_still_assembles()
    print('ok: characterization assembler click (menu/button/xpath)')


if __name__ == '__main__':
    main()
