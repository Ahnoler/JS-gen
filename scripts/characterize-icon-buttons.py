#!/usr/bin/env python3
"""Characterize icon-button label resolution (no hover / no aria-describedby).

Uses a blank Playwright page with mocked ElTooltip hosts (__vue__.content).
"""
from __future__ import annotations

import asyncio
import sys

sys.path.insert(0, ".")

from playwright.async_api import async_playwright

from scripts.actions._js_snippets import (
    JS_CLICK_ICON_BUTTON,
    JS_COLLECT_ICON_BUTTONS,
    JS_STAMP_ICON_ARIA_LABELS,
)

HTML = """<!doctype html><html><body>
<div class="button-group-left">
  <a class="el-tooltip el-icon-folder-add" tabindex="0"></a>
  <a class="el-tooltip el-icon-document-add" tabindex="0"></a>
  <a class="el-tooltip el-icon-delete" tabindex="0"></a>
</div>
<div id="noise" class="el-tooltip header__action-item search el-popover__reference"
     aria-describedby="el-popover-1">search</div>
<div id="el-popover-1" role="tooltip" class="el-tooltip__popper">huge menu dump a b c d e f g</div>
</body></html>"""

SETUP_VUE = """() => {
  const map = {
    'el-icon-folder-add': '新增一级分类',
    'el-icon-document-add': '新增产品',
    'el-icon-delete': '删除',
  };
  for (const [cls, content] of Object.entries(map)) {
    const el = document.querySelector('a.' + cls);
    if (!el) continue;
    el.__vue__ = { content, $props: { content } };
  }
}"""


async def main() -> int:
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()
        await page.set_content(HTML)
        await page.evaluate(SETUP_VUE)

        # Pre-hover: no aria-describedby / aria-label
        collect0 = await page.evaluate(JS_COLLECT_ICON_BUTTONS)
        texts0 = sorted(x["text"] for x in collect0)
        assert texts0 == ["删除", "新增一级分类", "新增产品"], texts0

        stamped = await page.evaluate(JS_STAMP_ICON_ARIA_LABELS)
        assert stamped == 3, stamped
        labels = await page.evaluate(
            """() => [...document.querySelectorAll('.button-group-left a')]
              .map(el => el.getAttribute('aria-label'))"""
        )
        assert sorted(labels) == ["删除", "新增一级分类", "新增产品"], labels

        # Click by Vue content (still no describedby required)
        clicked = []
        await page.expose_function("onIconClick", lambda name: clicked.append(name))
        await page.evaluate(
            """() => {
              for (const el of document.querySelectorAll('.button-group-left a')) {
                el.addEventListener('click', () => window.onIconClick(el.getAttribute('aria-label') || el.className));
              }
            }"""
        )
        r = await page.evaluate(JS_CLICK_ICON_BUTTON, "新增一级分类")
        assert r == "ok", r
        assert clicked == ["新增一级分类"], clicked

        # Noise header search must not appear
        assert all("huge" not in x["text"] for x in collect0)

        await browser.close()

    print("characterize-icon-buttons: OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
