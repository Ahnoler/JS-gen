#!/usr/bin/env python3
"""Characterize el-select lazy-load before pick (JS_SELECT_OPTION)."""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from scripts.actions._js_snippets import JS_SELECT_OPTION


def assert_true(cond: bool, msg: str) -> None:
    if not cond:
        raise AssertionError(msg)


def main() -> int:
    js = JS_SELECT_OPTION
    assert_true(
        "async" in js and ("(arg)" in js or "arg" in js[:80]),
        "JS_SELECT_OPTION must be async evaluate body",
    )
    assert_true("el-select-dropdown__wrap" in js, "wrap selector")
    assert_true("el-scrollbar__wrap" in js, "scrollbar wrap fallback")
    assert_true("scrollHeight" in js, "stable load uses scrollHeight")
    assert_true(
        "SELECT_LAZY_LOAD" in js or "stableStreak" in js or "stable" in js.lower(),
        "stable-load marker / streak",
    )
    # Must not scroll before attempting first match — strategy B cue:
    # marker comment near miss path
    assert_true(
        "SELECT_LAZY_LOAD_ON_MISS" in js,
        "SELECT_LAZY_LOAD_ON_MISS marker on miss path only",
    )
    print("characterize-select-lazy-load: OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
