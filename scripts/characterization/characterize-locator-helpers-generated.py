#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
Characterization: PAGE_LOCATOR_HELPERS Python shim is generated, not hand-edited.

Run:
  python scripts/characterization/characterize-locator-helpers-generated.py
"""
from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def assert_true(cond: bool, msg: str) -> None:
    if not cond:
        raise AssertionError(msg)


def test_locator_helpers_py_is_generated() -> None:
    p = ROOT / "scripts/controller/actions/js_snippets/_locator_helpers_js.py"
    text = p.read_text(encoding="utf-8")
    assert_true("Auto-generated" in text, "header marks generated")
    assert_true("_gen_locator_helpers_py" in text, "points to regen script")


def main() -> None:
    test_locator_helpers_py_is_generated()
    print("ok: characterization locator helpers generated header")


if __name__ == "__main__":
    main()
