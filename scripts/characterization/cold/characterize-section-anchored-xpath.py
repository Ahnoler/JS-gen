#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Exported xpath_smart must region-anchor duplicate buttons (xpath 消歧; Playwright-only locate)."""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from playwright.sync_api import sync_playwright  # noqa: E402
from scripts.controller.actions.js_snippets._locator_helpers_js import (  # noqa: E402
    PAGE_LOCATOR_HELPERS,
)


def assert_true(cond: bool, msg: str) -> None:
    if not cond:
        raise AssertionError(msg)


HTML = """<!DOCTYPE html><html><body>
<div class="el-collapse-item">
  <div class="el-collapse-item__header">系统评级结论</div>
  <div class="el-collapse-item__wrap"><button>保存</button></div>
</div>
<div class="el-collapse-item">
  <div class="el-collapse-item__header">客户综合评价</div>
  <div class="el-collapse-item__wrap"><button id="target">保存</button></div>
</div>
</body></html>"""

SNAP_JS = (
    "() => {\n"
    + PAGE_LOCATOR_HELPERS
    + """
  const host = document.getElementById('target');
  const abs = absXPath(host);
  return buildLocatorSnap(host, '保存', abs, '', { targetKind: 'button' });
}
"""
)


def main() -> int:
    helpers = (ROOT / "src/cdp/page-locator-helpers.js").read_text(encoding="utf-8")
    assert_true("regionAnchorXPath" in helpers, "canonical helpers define regionAnchorXPath")
    assert_true("regionAnchorOf" in helpers, "canonical helpers define regionAnchorOf")
    assert_true("xpath 消歧" in helpers, "regionAnchor comments document xpath 消歧")
    assert_true("regionAnchorXPath" in PAGE_LOCATOR_HELPERS, "Python mirror regenerated")
    assert_true(
        "function sectionAnchorOf" not in helpers,
        "sectionAnchorOf alias removed",
    )
    assert_true(
        "function sectionAnchorXPath" not in helpers,
        "sectionAnchorXPath alias removed",
    )
    assert_true(
        "function sectionAnchorOf" not in PAGE_LOCATOR_HELPERS,
        "sectionAnchorOf alias removed from Python mirror",
    )
    assert_true(
        "function sectionAnchorXPath" not in PAGE_LOCATOR_HELPERS,
        "sectionAnchorXPath alias removed from Python mirror",
    )

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        page.set_content(HTML)
        loc = page.evaluate(SNAP_JS)
        browser.close()

    smart = (loc or {}).get("xpath_smart") or ""
    assert_true(smart, f"xpath_smart missing: {loc!r}")
    assert_true(
        "el-collapse-item" in smart and "客户综合评价" in smart,
        f"must region-anchor 客户综合评价, got {smart!r}",
    )
    assert_true(
        "[1]" not in smart and "[2]" not in smart,
        f"must not use occurrence pin, got {smart!r}",
    )

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        page.set_content(HTML)
        n = page.evaluate(
            """(xp) => {
              const snap = document.evaluate(xp, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
              return snap.snapshotLength;
            }""",
            smart,
        )
        hit = page.evaluate(
            """(xp) => {
              const node = document.evaluate(xp, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
              return node && node.id === 'target';
            }""",
            smart,
        )
        browser.close()

    assert_true(n == 1, f"evaluate count must be 1, got {n} for {smart!r}")
    assert_true(hit, f"must hit #target, xpath={smart!r}")
    print("characterize-section-anchored-xpath: OK")
    print(json.dumps({"xpath_smart": smart}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
