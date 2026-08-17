#!/usr/bin/env python3
"""Characterization for duplicate-failure steering cue (E3).

Contract: two consecutive steps with identical action signatures and err-
results must produce one [纠偏] prescription per phase per signature.
"""

from __future__ import annotations

import sys
from pathlib import Path
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.controller.actions.duplicate_failure_cue import (  # noqa: E402
    duplicate_failure_prescription,
    is_duplicate_failure,
    result_error_text,
    step_failed,
)


def assert_true(cond: bool, msg: str) -> None:
    if not cond:
        raise AssertionError(msg)


def _res(text: str = '', error: str = '') -> SimpleNamespace:
    return SimpleNamespace(extracted_content=text, error=error)


def main() -> int:
    a1 = ['{"click_save": {"button_text": "保存", "section": "", "region": ""}}']
    a2 = ['{"click_save": {"button_text": "保存", "section": "", "region": "主区"}}']

    # 1. step_failed / result_error_text
    assert_true(step_failed([_res(text='err-save-button-not-found:保存 region=')]), 'err- content → failed')
    assert_true(step_failed([_res(error='err-pending-fields:[x]')]), 'err- error attr → failed')
    assert_true(not step_failed([_res(text='ok-save-success:操作成功')]), 'ok content → not failed')
    assert_true(not step_failed([_res()]), 'empty → not failed')
    assert_true(step_failed([_res(text='ok-a'), _res(text='err-b')]), 'any err in batch → failed')
    assert_true(
        result_error_text([_res(text='ok-a'), _res(text='err-save-ambiguous:x')]) == 'err-save-ambiguous:x',
        'first err text extracted',
    )

    # 2. streak: cue exactly once per phase+signature
    store: dict = {}
    assert_true(not is_duplicate_failure(store, a1, failed=True)[0], 'first failure → no cue')
    assert_true(is_duplicate_failure(store, a1, failed=True)[0], 'second identical failure → cue')
    assert_true(not is_duplicate_failure(store, a1, failed=True)[0], 'same signature cued once only')
    assert_true(not is_duplicate_failure(store, a1, failed=False)[0], 'ok step resets streak (no cue)')
    assert_true(not is_duplicate_failure(store, a1, failed=True)[0], 'post-ok failure still cued (once per phase per signature)')
    assert_true(not is_duplicate_failure(store, a1, failed=True)[0], 'post-ok second failure still cued')
    assert_true(not is_duplicate_failure(store, a2, failed=True)[0], 'different signature → no cue')
    store2: dict = {}
    assert_true(not is_duplicate_failure(store2, [], failed=True)[0], 'empty actions → no cue')

    # 3. prescription mapping (approved table)
    p1 = duplicate_failure_prescription('err-save-button-not-found:保存 candidates=[主区]')
    assert_true(p1.startswith('[纠偏] ') and 'candidates' in p1 and 'region=' in p1, 'button-not-found mapping')
    p2 = duplicate_failure_prescription('err-save-ambiguous:保存')
    assert_true(p2.startswith('[纠偏] ') and 'region=' in p2, 'ambiguous mapping')
    p3 = duplicate_failure_prescription('err-region-required pending_by_region={}')
    assert_true('pending_by_region' in p3 and 'region=' in p3, 'region-required mapping')
    p4 = duplicate_failure_prescription('err-pending-fields:[a]')
    assert_true('pending' in p4 and 'click_save' in p4, 'pending-fields mapping')
    p5 = duplicate_failure_prescription('err-save-validation:[x]')
    assert_true('修复' in p5 and 'click_save' in p5, 'validation mapping')
    p6 = duplicate_failure_prescription('err-save-notification:y')
    assert_true('修复' in p6 and 'click_save' in p6, 'notification mapping')
    p8 = duplicate_failure_prescription('err-notification:实际控制人和所选配偶的性别相同，引入失败！')
    assert_true(p8.startswith('[纠偏] ') and '报错' in p8 and '禁止' in p8, 'err-notification mapping')
    p7 = duplicate_failure_prescription('err-unknown-thing')
    assert_true(p7.startswith('[纠偏] ') and '原样重试' in p7, 'generic fallback')

    print('characterize-duplicate-failure-cue: OK')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
