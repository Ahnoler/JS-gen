#!/usr/bin/env python3
"""Lightweight characterization for explicit run_form_assistant action."""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.controller.actions._phase_intent import (  # noqa: E402
    apply_phase_contract,
    contract_allows_form_assistant,
)


def assert_true(cond: bool, msg: str) -> None:
    if not cond:
        raise AssertionError(msg)


def main() -> int:
    store: dict = {}
    apply_phase_contract(store, {
        'mode': 'navigate',
        'allow_form_assistant': False,
        'refill': 'none',
        'goal': 'x',
        'in_scope': [],
        'out_of_scope': [],
        'done_when': '',
        'submit': {},
        'success': {},
        'source': 'llm',
    })
    assert_true(contract_allows_form_assistant(store) is False, 'nav denies assistant')

    store2: dict = {}
    apply_phase_contract(store2, {
        'mode': 'create',
        'allow_form_assistant': True,
        'refill': 'all_editable',
        'goal': '新增',
        'in_scope': [],
        'out_of_scope': [],
        'done_when': '',
        'submit': {},
        'success': {},
        'source': 'llm',
    })
    assert_true(contract_allows_form_assistant(store2) is True, 'create allows assistant')

    # Disabled+adjacent-button (introduce) must NOT enter assistant pending / intervene.
    from scripts.models.task import TaskItem, TaskList

    intro = TaskItem.from_scanned({
        'label': '法定代表人/负责人证件号码',
        'kind': 'input',
        'currentValue': '',
        'options': [],
        'placeholder': '',
        'disabled': True,
        'required': True,
        'hasButton': '引入',
    })
    assert_true(intro is None, 'introduce disabled+button skipped by from_scanned')

    tl = TaskList.from_scan([
        {
            'label': '客户名称',
            'kind': 'input',
            'currentValue': '',
            'options': [],
            'placeholder': '',
            'disabled': False,
            'required': True,
            'hasButton': '',
        },
        {
            'label': '法定代表人/负责人证件号码',
            'kind': 'input',
            'currentValue': '',
            'options': [],
            'placeholder': '',
            'disabled': True,
            'required': True,
            'hasButton': '引入',
        },
    ], force_refill=True)
    labels = [i.label for i in tl.pending]
    assert_true('客户名称' in labels, 'normal field still pending')
    assert_true('法定代表人/负责人证件号码' not in labels, 'introduce not in assistant pending')
    assert_true(all(not i.needs_intervention for i in tl.pending), 'no intervene flags on pending')

    form_py = (
        (ROOT / 'scripts/controller/actions/form_action_engines.py').read_text(encoding='utf-8')
        + (ROOT / 'scripts/controller/actions/_form.py').read_text(encoding='utf-8')
        + (ROOT / 'scripts/controller/actions/form_scan_actions.py').read_text(encoding='utf-8')
        + (ROOT / 'scripts/controller/actions/form_autofill.py').read_text(encoding='utf-8')
        + (ROOT / 'scripts/controller/actions/autofill_round.py').read_text(encoding='utf-8')
    )
    assert_true('async def run_form_assistant' in form_py, 'run_form_assistant action exists')
    assert_true(
        'allow_autofill: bool = False' in form_py,
        '_ensure_scanned has allow_autofill default False',
    )
    assert_true(
        re.search(
            r"await _ensure_scanned\('__run_form_assistant__', allow_autofill=True\)",
            form_py,
        ),
        'run_form_assistant triggers scan with allow_autofill=True',
    )
    assert_true(
        re.search(
            r"if not allow_autofill:\s*\n\s*await _rebuild_task_list_from_dom\(autofill=False\)",
            form_py,
        ),
        'stale container scan-only rebuild when allow_autofill=False',
    )
    # Single-field first touch of a new container must scan + save_form_snapshot
    # (via _rebuild autofill=False), not early-return with container touch only.
    assert_true(
        "first-touch structure scan" in form_py,
        'single-field path logs first-touch structure scan',
    )
    assert_true(
        form_py.count("await _rebuild_task_list_from_dom(autofill=False)") >= 3,
        'rebuild autofill=False used for stale + first-touch + query-ui paths',
    )
    for fn in ('fill_form_field', 'select_option', 'click_radio', 'select_tree_option'):
        m = re.search(rf'async def {fn}\(.*?\n(?:.*?\n)*?.*?await (?:self\.)?_ensure_scanned\(label_text\)', form_py)
        assert_true(m is not None, f'{fn} calls _ensure_scanned without allow_autofill=True')

    assert_true('JS_FILL_BY_XPATH' in form_py, 'auto-fill uses JS_FILL_BY_XPATH')
    assert_true(
        re.search(r'async def _execute_round\(.*?xpath_smart', form_py, re.S),
        'xpath_smart used in _execute_round',
    )

    # 228bb5c: overlay rebuild can mix list+dialog twins; one write clears every
    # same-label pending so click_save / done gates are not blocked by a sibling.
    # xpath_smart still selects which item is returned (and which xpath is preferred).
    tl_dup = TaskList()
    tl_dup.pending = [
        TaskItem(label='评级', kind='select', xpath_smart='//div[@id="a"]//div[contains(@class,"el-select")]'),
        TaskItem(label='评级', kind='select', xpath_smart='//div[@id="b"]//div[contains(@class,"el-select")]'),
        TaskItem(label='客户名称', kind='input', xpath_smart='//input[@id="name"]'),
    ]
    moved = tl_dup.mark_done('评级', value='AAA', xpath_smart='//div[@id="b"]//div[contains(@class,"el-select")]')
    assert_true(
        moved is not None and 'id="b"' in moved.xpath_smart,
        'mark_done matches by xpath_smart first',
    )
    assert_true(
        len(tl_dup.pending) == 1 and tl_dup.pending[0].label == '客户名称',
        'mark_done clears all same-label pending, keeps other labels',
    )
    assert_true(
        len(tl_dup.done) == 2
        and all(i.label == '评级' for i in tl_dup.done)
        and any('id="a"' in i.xpath_smart for i in tl_dup.done)
        and any('id="b"' in i.xpath_smart for i in tl_dup.done),
        'both duplicate-label items moved to done',
    )

    print('characterize-form-assistant: OK')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
