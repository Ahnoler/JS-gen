#!/usr/bin/env python3
"""Characterize el-select lazy-load before pick (JS_SELECT_OPTION)."""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from scripts.controller.actions._js_snippets import JS_SELECT_OPTION


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

    # 2026-08-27 record-run race: settling after 2 stable rounds (~500ms) let a
    # slow lazy chunk (screenshot/CPU load) look like end-of-list, and the fuzzy
    # fallback picked 中国香港特别行政区 for want=中国. Patience must be explicit:
    # several stable rounds AND a minimum travelled distance.
    assert_true(
        "MAX_LOOPS" in js and "STREAK_LIMIT" in js,
        "python JS names patience constants MAX_LOOPS/STREAK_LIMIT",
    )
    assert_true(
        "MIN_ROUNDS_BEFORE_STABLE" in js,
        "min travelled distance before accepting stable end",
    )
    ctrl = (ROOT / "src" / "ctrl-actions" / "select.js").read_text(encoding="utf-8")
    assert_true(
        "MAX_ROUNDS" in ctrl and "STREAK_LIMIT" in ctrl,
        "CTRL select.js mirrors patience constants",
    )
    assert_true("round >= 4" in ctrl, "CTRL stable break requires min rounds")

    ctrl_path = ROOT / "src" / "ctrl-actions" / "select.js"
    assert_true(
        "SELECT_LAZY_LOAD_ON_MISS" in ctrl,
        "CTRL select.js must include SELECT_LAZY_LOAD_ON_MISS",
    )
    assert_true(
        "el-select-dropdown__wrap" in ctrl or "el-scrollbar__wrap" in ctrl,
        "CTRL lazy-load finds dropdown wrap",
    )
    assert_true(
        "stableStreak" in ctrl or "scrollHeight" in ctrl,
        "CTRL lazy-load uses stable scroll cues",
    )
    print("characterize-select-lazy-load: OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
