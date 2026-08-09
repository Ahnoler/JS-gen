#!/usr/bin/env python3
"""Characterize scan_editable_summary (T4-P0 read-only inventory action)."""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

FORM_PY = ROOT / "scripts/controller/actions/_form.py"
PROMPT_MD = ROOT / "scripts/prompts/agent-tools-form.md"


def assert_true(cond: bool, msg: str) -> None:
    if not cond:
        raise AssertionError(msg)


def _norm(s: str) -> str:
    return s.replace(" ", "").replace("\n", "")


def _scan_editable_summary_body(form_src: str) -> str:
    marker = "async def scan_editable_summary"
    assert_true(marker in form_src, "_form.py defines async def scan_editable_summary")
    return form_src.split(marker, 1)[1].split("\nasync def ", 1)[0]


def test_action_defined() -> None:
    form = FORM_PY.read_text(encoding="utf-8")
    assert_true(
        "async def scan_editable_summary" in form,
        "_form.py defines async def scan_editable_summary",
    )


def test_action_no_autofill() -> None:
    form = FORM_PY.read_text(encoding="utf-8")
    body = _scan_editable_summary_body(form)
    assert_true(
        "_auto_fill_pending" not in body,
        "scan_editable_summary must not call _auto_fill_pending",
    )
    assert_true(
        "allow_autofill=True" not in _norm(body),
        "scan_editable_summary must not pass allow_autofill=True",
    )


def test_action_no_store_writes() -> None:
    form = FORM_PY.read_text(encoding="utf-8")
    body = _scan_editable_summary_body(form)
    assert_true(
        "case_data_store['task_list']" not in body
        and 'case_data_store["task_list"]' not in body,
        "scan_editable_summary must not assign case_data_store['task_list']",
    )
    assert_true(
        "['_scan_fields']" not in body,
        "scan_editable_summary must not assign case_data_store['_scan_fields']",
    )


def test_summary_buttons_shape() -> None:
    form = FORM_PY.read_text(encoding="utf-8")
    body = _scan_editable_summary_body(form)
    assert_true(
        '"buttons"' in body or "'buttons'" in body,
        "summary construction includes buttons key",
    )
    assert_true(
        '"text"' in body or "'text'" in body,
        "buttons projection includes text",
    )
    assert_true(
        '"section"' in body or "'section'" in body,
        "buttons projection includes section",
    )
    buttons_idx = body.find("buttons")
    assert_true(buttons_idx >= 0, "buttons construction block present")
    buttons_block = body[buttons_idx : buttons_idx + 600]
    assert_true(
        '"kind"' not in buttons_block and "'kind'" not in buttons_block,
        "buttons must not project kind (text+section only)",
    )


def test_prompt_mentions_action() -> None:
    prompt = PROMPT_MD.read_text(encoding="utf-8")
    assert_true(
        "scan_editable_summary" in prompt,
        "agent-tools-form.md mentions scan_editable_summary",
    )


def test_aggregator_dedupe_by_xpath_smart() -> None:
    from scripts.controller.actions.form_scan_utils import build_editable_summary

    xp = "//input[@id='name']"
    scan_a = {
        'container': 'dialog:编辑',
        'fields': [
            {
                'label': '客户名称',
                'kind': 'input',
                'currentValue': '',
                'disabled': False,
                'xpath_smart': xp,
                'section_title': '基本信息',
            },
        ],
        'buttons': [],
    }
    scan_b = {
        'container': 'main',
        'fields': [
            {
                'label': '客户名称(duplicate)',
                'kind': 'input',
                'currentValue': 'filled',
                'disabled': False,
                'xpath_smart': xp,
                'section_title': '基本信息',
            },
        ],
        'buttons': [],
    }
    summary = build_editable_summary([scan_a, scan_b], primary_container='dialog:编辑')
    assert_true(summary['total'] == 1, 'dedupe by xpath_smart keeps first scan field')
    assert_true(summary['pending_labels'] == ['客户名称'], 'first field wins after dedupe')


def test_aggregator_pending_labels() -> None:
    from scripts.controller.actions.form_scan_utils import build_editable_summary

    scan = {
        'fields': [
            {
                'label': '资产负债率',
                'kind': 'input',
                'currentValue': '',
                'disabled': False,
                'xpath_smart': '//input[@id="a"]',
            },
            {
                'label': '内部评级',
                'kind': 'input',
                'currentValue': '',
                'disabled': True,
                'xpath_smart': '//input[@id="b"]',
            },
            {
                'label': '产品类型',
                'kind': 'select',
                'currentValue': '',
                'selected': True,
                'disabled': False,
                'xpath_smart': '//div[@id="c"]',
            },
            {
                'label': '备注',
                'kind': 'unknown',
                'currentValue': '',
                'disabled': False,
                'xpath_smart': '//input[@id="d"]',
            },
        ],
        'buttons': [],
    }
    summary = build_editable_summary([scan], primary_container='main')
    assert_true(
        summary['pending_labels'] == ['资产负债率'],
        'pending_labels: empty non-disabled known kinds only',
    )
    assert_true(summary['pending'] == 1, 'pending count matches pending_labels')
    assert_true(summary['total'] == 3, 'unknown kind excluded from total')


def test_aggregator_buttons_shape() -> None:
    from scripts.controller.actions.form_scan_utils import build_editable_summary

    scan = {
        'fields': [],
        'buttons': [
            {
                'label': '保存',
                'kind': 'button',
                'xpath_smart': '//button[1]',
                'section_title': '系统评级结论',
            },
            {
                'label': '暂存',
                'section_title': '评级等级测算',
            },
        ],
    }
    summary = build_editable_summary([scan], primary_container='dialog:评级')
    buttons = summary['buttons']
    assert_true(len(buttons) == 2, 'buttons merged from scan')
    assert_true(
        buttons[0] == {'text': '保存', 'section': '系统评级结论'},
        'button text from label, section from section_title',
    )
    assert_true('kind' not in buttons[0] and 'xpath_smart' not in buttons[0], 'no kind/xpath on buttons')
    assert_true(
        buttons[1] == {'text': '暂存', 'section': '评级等级测算'},
        'second button projected',
    )


def test_aggregator_scope_and_container() -> None:
    from scripts.controller.actions.form_scan_utils import build_editable_summary

    summary = build_editable_summary([{'fields': [], 'buttons': []}], primary_container='drawer:详情')
    assert_true(summary['container'] == 'drawer:详情', 'container from primary_container')
    assert_true(summary['scope'] == 'active+visible-overlays', 'scope constant present')
    assert_true('sections' in summary, 'sections key present')


def run_aggregator_tests() -> None:
    test_aggregator_dedupe_by_xpath_smart()
    test_aggregator_pending_labels()
    test_aggregator_buttons_shape()
    test_aggregator_scope_and_container()


def run_action_tests() -> None:
    test_action_defined()
    test_action_no_autofill()
    test_action_no_store_writes()
    test_summary_buttons_shape()
    test_prompt_mentions_action()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        '--aggregator-only',
        action='store_true',
        help='Run build_editable_summary unit tests only (Task 2 green path)',
    )
    args = parser.parse_args()

    run_aggregator_tests()
    if args.aggregator_only:
        print('characterize-scan-editable-summary (aggregator): OK')
        return 0

    try:
        run_action_tests()
    except AssertionError as exc:
        print(f'characterize-scan-editable-summary: action/prompt checks FAILED (expected until Task 3/4): {exc}')
        return 1

    print('characterize-scan-editable-summary: OK')
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
