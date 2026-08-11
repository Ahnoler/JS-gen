#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
Characterization: scripts/controller/actions/form_rules.py (match_rule + generators).

Run:
  python scripts/characterization/characterize-form-rules.py
"""
from __future__ import annotations

import os
import re
import sys

_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

from scripts.controller.actions.form_rules import (  # noqa: E402
    FIELD_RULES,
    get_has_button_keywords,
    match_rule,
    match_cert_number,
)


def assert_true(cond: bool, msg: str) -> None:
    if not cond:
        raise AssertionError(msg)


def _idcard_checksum_ok(code: str) -> bool:
    """GB 11643-1999 check digit."""
    if not re.fullmatch(r'\d{17}[\dXx]', code):
        return False
    weights = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2]
    check_map = '10X98765432'
    total = sum(int(code[i]) * weights[i] for i in range(17))
    return check_map[total % 11] == code[-1].upper()


def test_match_rule_labels() -> None:
    cases = [
        ('手机号码', r'^1\d{10}$'),
        ('联系电话', r'^1\d{10}$'),
        ('身份证号', r'^\d{17}[\dXx]$'),
        ('统一社会信用代码', r'^[0-9A-Z]{18}$'),
        ('银行卡号', r'^\d{16,19}$'),
        ('电子邮箱', r'^[^@]+@[^@]+\.[^@]+$'),
        ('详细地址', r'.+'),
        ('姓名', r'^[\u4e00-\u9fff]{2,4}$'),
    ]
    for label, pattern in cases:
        val = match_rule(label)
        assert_true(val is not None, f'{label!r} should match a rule')
        assert_true(bool(re.search(pattern, str(val))), f'{label!r} → {val!r} vs {pattern}')


def test_idcard_checksum() -> None:
    for _ in range(5):
        val = match_rule('居民身份证')
        assert_true(val is not None, 'idcard should generate')
        assert_true(_idcard_checksum_ok(val), f'bad idcard checksum: {val}')


def test_unmatched_label() -> None:
    assert_true(match_rule('完全不存在的字段XYZ123') is None, 'unknown label → None')


def test_keyword_specificity() -> None:
    """Longer / higher-priority rules win for overlapping keywords."""
    # 「证件号码」is ambiguous — must use match_cert_number(cert_type)
    assert_true(match_rule('证件号码') is None, '证件号码 alone should not match a rule')
    id_val = match_cert_number('居民身份证')
    assert_true(_idcard_checksum_ok(id_val), f'居民身份证 → bad idcard: {id_val!r}')
    credit = match_cert_number('统一社会信用代码')
    assert_true(credit is not None and len(credit) == 18, f'信用代码 → {credit!r}')
    # Default (no type) → idcard
    default_val = match_cert_number('')
    assert_true(_idcard_checksum_ok(default_val), f'default → bad idcard: {default_val!r}')

    # False-positive guards from production logs
    admin = match_rule('行政区划编码')
    assert_true(admin is not None and admin.isdigit() and len(admin) == 6,
                f'行政区划编码 should be 6-digit code, got {admin!r}')
    work = match_rule('工作单位')
    assert_true(work is not None and '公司' in work, f'工作单位 → {work!r}')
    foreign = match_rule('外文名称')
    assert_true(foreign is not None and re.search(r'[A-Za-z]', foreign),
                f'外文名称 should be Latin text, got {foreign!r}')
    region = match_rule('工作单位区域')
    assert_true(region is not None and '区' in region and '公司' not in region,
                f'工作单位区域 → {region!r}')


def test_field_rules_registry_shape() -> None:
    assert_true(len(FIELD_RULES) >= 10, 'FIELD_RULES should be non-trivial')
    for rule in FIELD_RULES:
        assert_true(bool(rule.keywords), f'rule missing keywords: {rule}')
        assert_true(callable(rule.generator), f'rule generator not callable: {rule.keywords}')
        sample = rule.generator()
        assert_true(sample is not None and str(sample) != '', f'empty gen for {rule.keywords}')


def test_has_button_keywords() -> None:
    kws = get_has_button_keywords()
    assert_true(isinstance(kws, list) and len(kws) >= 3, f'keywords={kws!r}')
    for expected in ('选择', '引入'):
        assert_true(expected in kws, f'missing default keyword {expected!r}')


def main() -> None:
    test_match_rule_labels()
    test_idcard_checksum()
    test_unmatched_label()
    test_keyword_specificity()
    test_field_rules_registry_shape()
    test_has_button_keywords()
    print('ok: characterization form_rules')


if __name__ == '__main__':
    main()
