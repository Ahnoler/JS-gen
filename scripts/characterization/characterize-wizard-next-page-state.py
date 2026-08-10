#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Wizard 下一步 must embed page-state in relative xpath_smart."""
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
from scripts.state import _element_identity  # noqa: E402


def assert_true(cond: bool, msg: str) -> None:
    if not cond:
        raise AssertionError(msg)


HTML_A = """<!DOCTYPE html><html><body>
<div class="wrap">
  <div class="el-steps">
    <div class="el-step is-process"><div class="el-step__title">基本信息</div></div>
    <div class="el-step"><div class="el-step__title">影像资料</div></div>
  </div>
  <form><button id="next-a">下一步</button></form>
</div>
</body></html>"""

HTML_B = """<!DOCTYPE html><html><body>
<div class="wrap">
  <div class="el-steps">
    <div class="el-step is-finish"><div class="el-step__title">基本信息</div></div>
    <div class="el-step is-process"><div class="el-step__title">影像资料</div></div>
  </div>
  <form><button id="next-b">下一步</button></form>
</div>
</body></html>"""

SNAP_JS = (
    "() => {\n"
    + PAGE_LOCATOR_HELPERS
    + """
  const host = document.querySelector('button');
  const abs = absXPath(host);
  return buildLocatorSnap(host, '下一步', abs, '', { targetKind: 'button' });
}
"""
)


def enrich(html: str) -> dict:
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        page.set_content(html)
        loc = page.evaluate(SNAP_JS)
        n = page.evaluate(
            """(xp) => {
              const snap = document.evaluate(xp, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
              return snap.snapshotLength;
            }""",
            (loc or {}).get("xpath_smart") or "",
        )
        browser.close()
    return {"loc": loc or {}, "eval_count": n}


def main() -> int:
    helpers = (ROOT / "src/cdp/page-locator-helpers.js").read_text(encoding="utf-8")
    assert_true("pageStateOf" in helpers, "canonical helpers define pageStateOf")
    assert_true("pageStateNavXPath" in helpers, "canonical helpers define pageStateNavXPath")
    assert_true("pageStateOf" in PAGE_LOCATOR_HELPERS, "Python mirror regenerated")

    a = enrich(HTML_A)
    b = enrich(HTML_B)
    sa = (a["loc"].get("xpath_smart") or "")
    sb = (b["loc"].get("xpath_smart") or "")
    assert_true(sa and sb, f"missing smart a={sa!r} b={sb!r}")
    assert_true("基本信息" in sa, f"A must anchor 基本信息: {sa!r}")
    assert_true("影像资料" in sb, f"B must anchor 影像资料: {sb!r}")
    assert_true(sa != sb, "page-state xpaths must differ")
    assert_true(sa != "//button[normalize-space()='下一步']", "A must not be bare next xpath")
    assert_true(sb != "//button[normalize-space()='下一步']", "B must not be bare next xpath")
    assert_true(
        a["eval_count"] == 1 and b["eval_count"] == 1,
        f"eval counts {a['eval_count']},{b['eval_count']}",
    )

    id_a = _element_identity(
        "click_element_by_index",
        {"text": "下一步"},
        {"xpath_smart": sa},
    )
    id_b = _element_identity(
        "click_element_by_index",
        {"text": "下一步"},
        {"xpath_smart": sb},
    )
    assert_true(id_a and id_b and id_a != id_b, f"identity must diverge: {id_a!r} vs {id_b!r}")

    print("characterize-wizard-next-page-state: OK")
    print(json.dumps({"a": sa, "b": sb}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
