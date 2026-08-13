#!/usr/bin/env python3
"""Characterize P2: chrome menu / decorative icon noise filter."""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

SCAN_FORM = ROOT / "scripts/controller/actions/js_snippets/scan_form.py"
UTILS = ROOT / "scripts/controller/actions/form_scan_utils.py"


def assert_true(cond: bool, msg: str) -> None:
    if not cond:
        raise AssertionError(msg)


def test_is_chrome_menu_label() -> None:
    from scripts.controller.actions.form_scan_utils import is_chrome_menu_label

    assert_true(is_chrome_menu_label("水平布局") is True, "布局")
    assert_true(is_chrome_menu_label("垂直布局") is True, "布局")
    assert_true(is_chrome_menu_label("白色主题") is True, "主题")
    assert_true(is_chrome_menu_label("关闭当前页签") is True, "关闭+页签")
    assert_true(is_chrome_menu_label("关闭其他页签") is True, "关闭+页签")
    assert_true(is_chrome_menu_label("关闭非固定页签") is True, "关页签")
    # P2-noise+: portal uses 标签 as synonym of 页签
    assert_true(is_chrome_menu_label("关闭所有标签(含固定)") is True, "关闭+标签")
    assert_true(is_chrome_menu_label("关闭其他标签") is True, "关闭+标签")
    assert_true(is_chrome_menu_label("固定标签") is True, "固定+标签")
    assert_true(is_chrome_menu_label("客户管理") is False, "business nav")
    assert_true(is_chrome_menu_label("新增") is False, "toolbar")
    assert_true(is_chrome_menu_label("标签页名称") is False, "business 标签 without close/fix")
    assert_true(is_chrome_menu_label("") is False, "empty")


def test_summary_skips_chrome_projected_buttons() -> None:
    from scripts.controller.actions.form_scan_utils import build_editable_summary

    scan = {
        "fields": [
            {
                "label": "水平布局",
                "kind": "menu_item",
                "xpath_smart": "//a[1]",
                "region_role": "shell-aside",
            },
            {
                "label": "关闭所有标签(含固定)",
                "kind": "menu_item",
                "xpath_smart": "//a[1b]",
                "region_role": "shell-header",
            },
            {
                "label": "客户管理",
                "kind": "menu_item",
                "xpath_smart": "//a[2]",
                "region_role": "shell-aside",
            },
            {
                "label": "新增",
                "kind": "icon",
                "xpath_smart": "//i[1]",
                "region_role": "main",
            },
        ],
        "buttons": [],
        "scope": "fullpage",
    }
    summary = build_editable_summary([scan], primary_container="main")
    texts = [b["text"] for b in summary["buttons"]]
    assert_true("水平布局" not in texts, "chrome excluded from buttons")
    assert_true("关闭所有标签(含固定)" not in texts, "标签 chrome excluded")
    assert_true("客户管理" in texts, "business menu kept")
    assert_true("新增" in texts, "named icon kept")


def test_js_noise_gate_cues() -> None:
    src = SCAN_FORM.read_text(encoding="utf-8")
    assert_true("CHROME_NOISE_FILTER" in src or "isChromeNoise" in src, "JS noise gate marker")
    assert_true("布局" in src or "主题" in src, "JS label seed present")
    assert_true("页签" in src and "标签" in src, "JS 页签/标签 synonym seed")
    assert_true(
        "isChromeNoise(el, 'menu_item', label)" in src,
        "menu_item collector calls isChromeNoise before pushField",
    )
    assert_true(
        "isChromeNoise(el, 'icon', label)" in src,
        "icon collector calls isChromeNoise before pushField",
    )

def main() -> int:
    try:
        test_is_chrome_menu_label()
        test_summary_skips_chrome_projected_buttons()
        test_js_noise_gate_cues()
    except Exception as exc:
        print(f"characterize-scan-fullpage-p2: FAIL {exc}")
        return 1
    print("characterize-scan-fullpage-p2: OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
