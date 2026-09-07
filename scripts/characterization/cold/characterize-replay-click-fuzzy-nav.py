#!/usr/bin/env python3
"""
Characterize durable click: absolute xpath /html/body prefix + nav text
candidates + no short substring fuzzy (测算 ⊂ 评级等级测算).
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
JS = (ROOT / "scripts/controller/actions/replay_js.py").read_text(encoding="utf-8")


def assert_true(cond: bool, msg: str) -> None:
    if not cond:
        raise AssertionError(msg)


def _durable_blob() -> str:
    m = re.search(r"_JS_CLICK_DURABLE = r'''(.*?)'''", JS, re.S)
    assert_true(m is not None, "_JS_CLICK_DURABLE blob present")
    return m.group(1)


def test_xpath_tries_html_body_prefix() -> None:
    blob = _durable_blob()
    assert_true(
        "/html/body" in blob,
        "durable xpath eval must retry with /html/body prefix for body-relative abs paths",
    )


def test_text_candidates_include_plugin_nav() -> None:
    blob = _durable_blob()
    assert_true(
        "plugin-nav-list" in blob or "plugin-nav" in blob,
        "text locate must consider plugin-nav nav items (right-rail section jump)",
    )


def test_fuzzy_rejects_short_substring_of_want() -> None:
    """
    Regression: want='3.评级等级测算' must not click button text='测算'
    via want.includes(n) shortest-wins.
    """
    blob = _durable_blob()
    # Locate the fuzzy scoring block near ok-text-fuzzy
    idx = blob.find("ok-text-fuzzy")
    assert_true(idx > 0, "ok-text-fuzzy marker present")
    # Look back ~800 chars for the match condition
    window = blob[max(0, idx - 900) : idx]
    # Must NOT have bare want.includes(n) without a length/ratio guard nearby
    bare = re.search(r"want\.includes\(\s*n\s*\)", window)
    if bare:
        # Guard must exist in same window: length ratio or min length vs want
        guarded = (
            "n.length" in window
            and (
                "want.length" in window
                or "wantBase.length" in window
                or "minLen" in window
                or "minSubLen" in window
                or "MIN_" in window
            )
        )
        assert_true(
            guarded,
            "want.includes(n) fuzzy must be length-guarded so short substrings "
            "(测算) cannot beat full nav labels (3.评级等级测算)",
        )


def main() -> int:
    test_xpath_tries_html_body_prefix()
    test_text_candidates_include_plugin_nav()
    test_fuzzy_rejects_short_substring_of_want()
    print("characterize-replay-click-fuzzy-nav: OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
