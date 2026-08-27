#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Characterize: icon 工具错误码转正（2026-08-27 协议波）。
Run: ./python/python.exe scripts/characterization/characterize-icon-codes.py
"""
from __future__ import annotations
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

def assert_true(cond, msg):
    if not cond:
        raise AssertionError(msg)

MISC = ROOT / "scripts/controller/actions/_misc.py"
ICONS = ROOT / "scripts/controller/actions/js_snippets/icons.py"
IDX = ROOT / "src/ctrl-actions/index.js"

def test_codes():
    icons = ICONS.read_text(encoding="utf-8")
    misc = MISC.read_text(encoding="utf-8")
    idx = IDX.read_text(encoding="utf-8")
    assert_true("err-icon-label-ambiguous:" in icons, "JS ambiguous code")
    assert_true("err-icon-label-miss" in icons, "JS miss code")
    assert_true("ok-text:" in icons, "generalized text-button click intact")
    assert_true("not-found-text-button" not in icons and "not-found-text-button" not in misc,
                "legacy prefix fully retired")
    assert_true(misc.count("err_with(") >= 2, "both branches envelope")
    assert_true("err-icon-label-ambiguous" in idx and "err-icon-label-miss" in idx, "ctrl doc line")

def main() -> int:
    test_codes()
    print("characterize-icon-codes: OK")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
