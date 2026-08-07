#!/usr/bin/env python3
"""Characterize shared xpath fill/select JS snippets in _js_snippets.py."""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.actions._js_snippets import (  # noqa: E402
    JS_FILL_BY_XPATH,
    JS_SELECT_TRIGGER_BY_XPATH,
)


def assert_true(cond: bool, msg: str) -> None:
    if not cond:
        raise AssertionError(msg)


def test_snippet_markers() -> None:
    js = (ROOT / "scripts/actions/_js_snippets.py").read_text(encoding="utf-8")
    assert_true("JS_FILL_BY_XPATH" in js, "JS_FILL_BY_XPATH exported in _js_snippets.py")
    assert_true("JS_SELECT_TRIGGER_BY_XPATH" in js, "JS_SELECT_TRIGGER_BY_XPATH exported")
    assert_true("el-table__fixed" in JS_FILL_BY_XPATH, "fill-by-xpath handles fixed table columns")
    assert_true("__last_select_trigger" in JS_SELECT_TRIGGER_BY_XPATH, "select trigger sets global for JS_SELECT_OPTION")


def main() -> int:
    test_snippet_markers()
    print("characterize-xpath-fill-select: OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
