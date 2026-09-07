#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Characterize preferred submit button (暂存 vs 保存) for section phases."""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from scripts.controller.actions.section_scope import (  # noqa: E402
    preferred_submit_button,
    preferred_submit_cue,
)


def assert_true(cond: bool, msg: str) -> None:
    if not cond:
        raise AssertionError(msg)


def main() -> int:
    store = {
        "_phase_section": "评级等级测算",
        "_scan_buttons": [
            {"label": "模拟", "section_id": "评级等级测算", "section_title": "评级等级测算"},
            {"label": "测算", "section_id": "评级等级测算", "section_title": "评级等级测算"},
            {"label": "暂存", "section_id": "评级等级测算", "section_title": "评级等级测算"},
            {"label": "保存", "section_id": "系统评级结论", "section_title": "系统评级结论"},
        ],
    }
    btn = preferred_submit_button(store, section="评级等级测算")
    assert_true(btn == "暂存", f"section 评级等级测算 prefers 暂存, got {btn!r}")

    cue = preferred_submit_cue(store, section="评级等级测算")
    assert_true("暂存" in cue, f"cue must mention 暂存: {cue}")
    assert_true("评级等级测算" in cue, f"cue must include section: {cue}")
    assert_true("click_save" in cue, f"cue must use click_save: {cue}")

    # No section filter: still prefer 暂存 if present in scan (phase memory)
    btn2 = preferred_submit_button(store)
    assert_true(btn2 == "暂存", f"phase memory section still prefers 暂存, got {btn2!r}")

    # Only 保存 available
    store2 = {
        "_scan_buttons": [
            {"label": "保存", "section_id": "基本信息", "section_title": "基本信息"},
        ],
    }
    assert_true(preferred_submit_button(store2) == "保存", "fallback 保存")

    print("characterize-preferred-submit: OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
