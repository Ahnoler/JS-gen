"""Lightweight Python characterization for page-level screenshot helpers.

No browser / DB required.
"""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from scripts.state import (
    _ACTION_LOG,
    _is_overlay_region,
    _last_anchor_xpath_for_overlay,
    page_level_key_from_url,
    reset_page_level_shots,
)

failures = 0


def check(cond, msg):
    global failures
    if cond:
        print(f'  ok: {msg}')
    else:
        failures += 1
        print(f'  FAIL: {msg}')


def main():
    check(
        page_level_key_from_url('http://test.example.com/#/home?part=home&t=1')
        == 'page:http://test.example.com#/home',
        'SPA hash route keeps fragment, in-fragment query dropped (volatile + VARCHAR(512) overflow)',
    )
    check(
        page_level_key_from_url('http://test.example.com/path?q=1#/route')
        == 'page:http://test.example.com/path#/route',
        'query string dropped, fragment kept',
    )
    check(
        page_level_key_from_url('http://test.example.com/path#/route')
        == 'page:http://test.example.com/path#/route',
        'query-less fragment unchanged',
    )

    reset_page_level_shots()

    check(_is_overlay_region('page:http://x|overlay:地址选择器') is not None, 'overlay segment after page key')
    check(not _is_overlay_region('page:http://x|card:产品目录'), 'card region is not overlay')

    _ACTION_LOG.clear()
    _ACTION_LOG.extend([
        {
            'action': 'click_element_by_index',
            'element': {'xpath_smart': '//button[normalize-space()="选择"]', 'region_id': 'page:http://x|card:产品目录'},
        },
        {
            'action': 'select_option',
            'element': {'xpath_smart': '//input[1]', 'region_id': 'page:http://x|overlay:地址选择器'},
        },
    ])
    anchor = _last_anchor_xpath_for_overlay()
    check(anchor == '//button[normalize-space()="选择"]', f'anchor inferred from previous click step ({anchor})')
    _ACTION_LOG.clear()

    if failures:
        print(f'characterize-page-level-python: {failures} FAILURE(S)')
        raise SystemExit(1)
    print('characterize-page-level-python: OK')


if __name__ == '__main__':
    main()
