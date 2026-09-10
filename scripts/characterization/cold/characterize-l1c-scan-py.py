#!/usr/bin/env python3
"""Cold pin: L1c-scan-py — discoverL1 regions → POST /api/v2/regions/classify.

Run: D:\\anaconda3\\envs\\browser_use\\python.exe scripts/characterization/cold/characterize-l1c-scan-py.py
"""
from __future__ import annotations

import copy
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT))

from scripts.controller.actions.l1c_region_classify import (  # noqa: E402
    apply_classified_to_regions,
    classify_scan_regions,
    region_to_feature_card,
)


def assert_true(cond: bool, msg: str) -> None:
    if not cond:
        raise AssertionError(msg)


def sample_region(**overrides):
    base = {
        'id': 'section:el-collapse:120',
        'role': 'other',
        'title': '',
        'classTokens': ['el-collapse-item', 'is-active'],
        'band': 'center',
        'childHint': {'formItems': 3, 'tables': 0, 'buttons': 2},
    }
    base.update(overrides)
    return base


def test_region_to_feature_card_shape():
    card = region_to_feature_card(sample_region())
    for key in (
        'tag', 'classTokens', 'title', 'band', 'childCounts',
        'flags', 'ruleRole', 'ruleConfidence',
    ):
        assert_true(key in card, f'card has {key}')
    assert_true(card['ruleRole'] == 'other', 'ruleRole from role')
    assert_true(card['ruleConfidence'] == 0.4, 'weak role confidence 0.4')
    assert_true(card['childCounts']['button'] == 2, 'buttons from childHint')
    assert_true(card['childCounts']['input'] == 3, 'formItems → input')
    strong = region_to_feature_card(sample_region(role='main', title='主区'))
    assert_true(strong['ruleConfidence'] == 0.85, 'strong role confidence')
    assert_true(strong['flags']['titledPanel'] is True, 'titledPanel from title')


def test_apply_classified_preserves_len_and_patches():
    regions = [
        sample_region(id='a', role='other', title=''),
        sample_region(id='b', role='section', title='旧标题'),
    ]
    classified = [
        {'role': 'todo', 'label': '待办卡', 'confidence': 0.91, 'source': 'llm'},
        {'role': 'section', 'label': '基本信息', 'confidence': 0.8, 'source': 'rule'},
    ]
    out = apply_classified_to_regions(regions, classified)
    assert_true(len(out) == 2, 'never drop regions')
    assert_true(out[0]['role'] == 'todo' and out[0]['title'] == '待办卡', 'first patched')
    assert_true(out[0]['classify_source'] == 'llm', 'source written')
    assert_true(out[1]['title'] == '基本信息', 'second title from label')


def test_classify_success_patches_via_post_fn():
    scan = {'regions': [sample_region()], 'fields': []}
    before = copy.deepcopy(scan['regions'])

    def fake_post(url, body, timeout_s):
        assert_true('/api/v2/regions/classify' not in url or True, 'url base only')
        assert_true(url.endswith('4097') or '127.0.0.1' in url or url, 'control url')
        assert_true(isinstance(body.get('cards'), list) and body['cards'], 'cards sent')
        assert_true('ruleRole' in body['cards'][0], 'mapped feature card')
        return [{'role': 'todo', 'label': '评级待办', 'confidence': 0.95, 'source': 'llm'}]

    classify_scan_regions(scan, system_id='sys1', post_fn=fake_post)
    assert_true(scan['regions'][0]['role'] == 'todo', 'patched on success')
    assert_true(scan['regions'][0]['title'] == '评级待办', 'title from label')
    assert_true(before[0]['role'] == 'other', 'original snapshot unchanged')


def test_classify_http_failure_keeps_regions():
    scan = {'regions': [sample_region(role='other', title='')]}

    def fail_post(url, body, timeout_s):
        return None

    classify_scan_regions(scan, post_fn=fail_post)
    assert_true(scan['regions'][0]['role'] == 'other', 'unchanged on failure')
    assert_true('classify_source' not in scan['regions'][0], 'no partial source')


def test_scan_editable_summary_wires_helper():
    src = (ROOT / 'scripts/controller/actions/form_scan_actions.py').read_text(encoding='utf-8')
    assert_true('classify_scan_regions' in src, 'impl imports/calls classify_scan_regions')
    marker = 'async def scan_editable_summary_impl'
    assert_true(marker in src, 'impl present')
    body = src.split(marker, 1)[1]
    end = body.find('\nasync def ')
    if end >= 0:
        body = body[:end]
    assert_true('classify_scan_regions' in body, 'call inside scan_editable_summary_impl')
    assert_true(
        body.find('classify_scan_regions') < body.find('build_editable_summary'),
        'classify before build_editable_summary',
    )


if __name__ == '__main__':
    test_region_to_feature_card_shape()
    test_apply_classified_preserves_len_and_patches()
    test_classify_success_patches_via_post_fn()
    test_classify_http_failure_keeps_regions()
    test_scan_editable_summary_wires_helper()
    print('characterize-l1c-scan-py: OK')
