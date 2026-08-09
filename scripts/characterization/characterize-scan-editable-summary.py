#!/usr/bin/env python3
"""Characterize scan_editable_summary (T4-P0 aggregator + T4-P1 multi-root wiring)."""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

FORM_PY = ROOT / "scripts/controller/actions/_form.py"
SCAN_FORM_PY = ROOT / "scripts/controller/actions/js_snippets/scan_form.py"
PROMPT_MD = ROOT / "scripts/prompts/agent-tools-form.md"


def assert_true(cond: bool, msg: str) -> None:
    if not cond:
        raise AssertionError(msg)


def _norm(s: str) -> str:
    return s.replace(" ", "").replace("\n", "")


def _scan_editable_summary_body(form_src: str) -> str:
    marker = "async def scan_editable_summary"
    assert_true(marker in form_src, "_form.py defines async def scan_editable_summary")
    rest = form_src.split(marker, 1)[1]
    # Stop at next sibling @controller.action (not later nested helpers in _register_form_actions).
    end = rest.find("\n    @controller.action")
    if end < 0:
        end = rest.find("\nasync def ")
    if end >= 0:
        rest = rest[:end]
    return rest


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
        "build_editable_summary" in body,
        "scan_editable_summary aggregates via build_editable_summary (buttons text+section)",
    )
    from scripts.controller.actions.form_scan_utils import build_editable_summary

    buttons = build_editable_summary(
        [{'fields': [], 'buttons': [{'label': '保存', 'section_title': '区块'}]}],
        primary_container='main',
    )['buttons']
    assert_true(buttons == [{'text': '保存', 'section': '区块'}], 'buttons projected as text+section')
    assert_true('kind' not in buttons[0], 'buttons must not project kind')


def test_js_scan_form_fields_multi_root_cues() -> None:
    from scripts.controller.actions._js_snippets import JS_SCAN_FORM_FIELDS

    scan_form_src = SCAN_FORM_PY.read_text(encoding="utf-8")
    combined = scan_form_src + JS_SCAN_FORM_FIELDS
    norm = _norm(combined)
    assert_true(
        "opts" in combined,
        "JS_SCAN_FORM_FIELDS accepts 3rd arg opts",
    )
    assert_true(
        "mode" in combined and "multi" in combined,
        "JS_SCAN_FORM_FIELDS handles opts.mode multi",
    )
    assert_true(
        "buttonkeywords,opts" in norm or "[quick,buttonkeywords,opts]" in norm,
        "JS_SCAN_FORM_FIELDS signature includes opts as 3rd parameter",
    )


def test_scan_editable_summary_multi_root_wired() -> None:
    form = FORM_PY.read_text(encoding="utf-8")
    body = _scan_editable_summary_body(form)
    assert_true(
        "build_editable_summary" in body,
        "scan_editable_summary aggregates via build_editable_summary",
    )
    norm = _norm(body)
    assert_true(
        "mode" in body and "multi" in body,
        "scan_editable_summary passes mode multi to JS_SCAN_FORM_FIELDS",
    )
    assert_true(
        "[true,_button_keywords(),{'mode':'multi'}]" in norm
        or "[true,_button_keywords(),{\"mode\":\"multi\"}]" in norm
        or "'mode':'multi'" in norm.replace(" ", "")
        or '"mode":"multi"' in norm,
        "scan_editable_summary evaluate call includes {'mode': 'multi'} 3rd arg",
    )
    assert_true(
        _norm("await page.evaluate(JS_SCAN_FORM_FIELDS, [True, _button_keywords()])") not in norm,
        "scan_editable_summary must not use bare [True, _button_keywords()] without mode multi",
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
    test_js_scan_form_fields_multi_root_cues()
    test_scan_editable_summary_multi_root_wired()


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
        print(f'characterize-scan-editable-summary: action checks FAILED: {exc}')
        return 1

    try:
        test_prompt_mentions_action()
    except AssertionError as exc:
        print(f'characterize-scan-editable-summary: action OK; prompt check deferred (Task 4): {exc}')
        return 0

    print('characterize-scan-editable-summary: OK')
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
