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


def _read(rel: str) -> str:
    return (ROOT / rel).read_text(encoding="utf-8")

failures = 0


def check(cond, msg):
    global failures
    if cond:
        print(f'  ok: {msg}')
    else:
        failures += 1
        print(f'  FAIL: {msg}')


def test_rect_norm_pins():
    """Pin the page-level dims + rect_norm normalization wiring in scripts/state.py.

    Covers: capture_page_dims_from_page (document scrollWidth/Height),
    register_page_screenshot_if_changed before_dims param (before-leave dims capture),
    register_current_page_screenshot dims persistence in meta,
    _stamp_rect_norm (page_bbox -> rect_norm 0..1, popup startswith fallback).
    Source-substring pins (mirrors characterize-before-close-screenshots.py style).
    """
    src = _read("scripts/state.py")

    check("def capture_page_dims_from_page" in src, "state.py defines capture_page_dims_from_page")
    # dims captured into meta
    check("'contentWidth'" in src and "'contentHeight'" in src, "meta carries contentWidth/contentHeight")

    # before-leave branch: register_page_screenshot_if_changed gains before_dims param
    # signature spans multiple lines up to the closing `) ->` — slice to the return annotation.
    after_def = src.split("def register_page_screenshot_if_changed", 1)[1]
    sig_end = after_def.find(") ->")
    sig_text = after_def[: sig_end] if sig_end >= 0 else after_def[:400]
    check("before_dims" in sig_text, "register_page_screenshot_if_changed signature has before_dims")
    check("before_dims" in src, "register_page_screenshot_if_changed writes before_dims to meta")

    # _stamp_rect_norm presence + behavior markers
    check("def _stamp_rect_norm" in src, "state.py defines _stamp_rect_norm")
    body = src.split("def _stamp_rect_norm", 1)[1]
    # cut to next top-level def
    import re
    m = re.search(r"\n(?=(async def |def ))", body)
    body = body[: m.start()] if m else body
    check("page_bbox" in body, "_stamp_rect_norm reads page_bbox")
    check("el['rect_norm']" in body, "_stamp_rect_norm writes el['rect_norm']")
    check("startswith(pkey)" in body, "_stamp_rect_norm registry lookup uses startswith fallback (@@anchor)")
    check("contentWidth" in body and "contentHeight" in body, "_stamp_rect_norm normalizes by page dims")


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

    test_rect_norm_pins()

    if failures:
        print(f'characterize-page-level-python: {failures} FAILURE(S)')
        raise SystemExit(1)
    print('characterize-page-level-python: OK')


if __name__ == '__main__':
    main()
