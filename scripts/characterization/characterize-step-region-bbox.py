#!/usr/bin/env python3
"""Characterize step region/bbox persistence (recording-side region + coords)."""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))


def assert_true(cond: bool, msg: str) -> None:
    if not cond:
        raise AssertionError(msg)


def test_helpers_have_scroll_root_and_bbox() -> None:
    from scripts.controller.actions.js_snippets._locator_helpers_js import PAGE_LOCATOR_HELPERS

    assert_true("function pickScrollRoot" in PAGE_LOCATOR_HELPERS, "helpers embed pickScrollRoot")
    assert_true("scrollHeight > best.scrollHeight" in PAGE_LOCATOR_HELPERS, "generic tallest-container scan")
    assert_true("function stepBBoxOf" in PAGE_LOCATOR_HELPERS, "helpers embed stepBBoxOf")
    assert_true("root.scrollTop" in PAGE_LOCATOR_HELPERS, "bbox uses content coords (scrollTop offset)")


def test_phase_screenshot_collect_uses_helpers_root() -> None:
    # collect 表达式不得再内联 pickScrollRoot（与 helpers 重复定义会语法冲突）
    src = (ROOT / "src/cdp/phase-screenshot-page.js").read_text(encoding="utf-8")
    assert_true("PICK_SCROLL_ROOT_FN" in src, "scroll expression keeps its own root fn")
    collect = src.split("buildPhaseScreenshotCollectExpression", 1)[1]
    assert_true("PICK_SCROLL_ROOT_FN" not in collect, "collect must not inline PICK_SCROLL_ROOT_FN (helpers provide it)")


def test_capture_has_region_bbox() -> None:
    from scripts.controller.actions import _js_snippets as sn

    js = sn.JS_CAPTURE_FROM_XPATH
    assert_true("assignRegion(host)" in js, "capture computes region via assignRegion")
    assert_true("stepBBoxOf(host)" in js, "capture computes bbox")
    assert_true("region_id: reg.region_id" in js, "capture returns region_id")
    assert_true("layers: Array.isArray(reg.layers)" in js, "capture returns layers")
    assert_true("bbox: stepBBoxOf(host)" in js, "capture returns bbox")


def test_enrich_has_region_bbox() -> None:
    from scripts.controller.actions import _js_snippets as sn

    js = sn.JS_ENRICH_CLICK_LOCATOR
    assert_true("assignRegion(el)" in js, "enrich computes region via assignRegion")
    assert_true("stepBBoxOf(el)" in js, "enrich computes bbox")
    assert_true("region_id: reg.region_id" in js, "enrich returns region_id")
    assert_true("bbox: stepBBoxOf(el)" in js, "enrich returns bbox")


def test_helpers_passthrough_region_bbox() -> None:
    src = (ROOT / "scripts/controller/actions/_helpers.py").read_text(encoding="utf-8")
    # 注意：_helpers.py 现有 dict 用双引号风格
    assert_true('"region_id": info.get("region_id")' in src, "_capture_element passes region_id")
    assert_true('"bbox": info.get("bbox")' in src, "_capture_element passes bbox")
    assert_true('"layers": info.get("layers")' in src, "_capture_element passes layers")
    assert_true('"region_label": info.get("region_label")' in src, "_capture_element passes region_label")


def main() -> int:
    test_helpers_have_scroll_root_and_bbox()
    test_phase_screenshot_collect_uses_helpers_root()
    test_capture_has_region_bbox()
    test_enrich_has_region_bbox()
    test_helpers_passthrough_region_bbox()
    print("characterize-step-region-bbox: OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
