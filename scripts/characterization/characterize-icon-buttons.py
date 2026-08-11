#!/usr/bin/env python3
"""Characterize icon-button label resolution (no hover / no aria-describedby).

Uses a blank Playwright page with mocked ElTooltip hosts (__vue__.content).
Also covers manual recorder → mapper parity for click_icon_button.
"""
from __future__ import annotations

import asyncio
import sys

sys.path.insert(0, ".")

from playwright.async_api import async_playwright

from scripts.controller.actions._js_snippets import (
    JS_CLICK_ICON_BUTTON,
    JS_COLLECT_ICON_BUTTONS,
    JS_STAMP_ICON_ARIA_LABELS,
)
from scripts.manual_recorder.js import JS_MANUAL_RECORDER
from scripts.manual_recorder.mapper import _map_dom_event_to_action

HTML = """<!doctype html><html><head>
<style>
  a.el-tooltip { display: inline-block; width: 24px; height: 24px; }
  button.el-button { display: inline-block; }
</style>
</head><body>
<div class="button-group-left">
  <a class="el-tooltip el-icon-folder-add" tabindex="0"></a>
  <a class="el-tooltip el-icon-document-add" tabindex="0"></a>
  <a class="el-tooltip el-icon-delete" tabindex="0"></a>
</div>
<div id="noise" class="el-tooltip header__action-item search el-popover__reference"
     aria-describedby="el-popover-1">search</div>
<div id="el-popover-1" role="tooltip" class="el-tooltip__popper">huge menu dump a b c d e f g</div>
<button type="button" class="el-button">普通按钮</button>
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


def _assert_mapper_payload() -> None:
    mapped = _map_dom_event_to_action({
        'kind': 'click_icon_button',
        'button_text': '新增一级分类',
        'text': '新增一级分类',
        'tag': 'a',
        'attributes': {'class': 'el-tooltip el-icon-folder-add'},
        'xpath': '',
        'xpath_smart': '',
    })
    assert mapped is not None, mapped
    action, params, element = mapped
    assert action == 'click_icon_button', action
    assert params == {'button_text': '新增一级分类'}, params
    assert element.get('target_kind') == 'icon', element
    assert 'aria-label' in (element.get('xpath_smart') or ''), element.get('xpath_smart')

    empty = _map_dom_event_to_action({
        'kind': 'click_icon_button',
        'button_text': '',
        'text': '',
        'tag': 'a',
        'attributes': {'class': 'el-tooltip el-icon-folder-add'},
    })
    assert empty is None, empty


async def main() -> int:
    _assert_mapper_payload()

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

        # ── Manual recorder parity ──────────────────────────────────────────
        # Fresh page so stamp/aria-label state doesn't mask Vue-content resolve.
        page2 = await browser.new_page()
        await page2.set_content(HTML)
        await page2.evaluate(SETUP_VUE)

        captured: list[dict] = []

        async def _capture(payload: dict) -> None:
            captured.append(payload)

        await page2.expose_function("__jsgenManualEmit", _capture)
        await page2.evaluate(JS_MANUAL_RECORDER)

        await page2.click("a.el-icon-folder-add")
        await page2.wait_for_timeout(100)

        icon_events = [e for e in captured if e.get("kind") == "click_icon_button"]
        assert icon_events, f"expected click_icon_button emit, got {captured!r}"
        assert icon_events[0].get("button_text") == "新增一级分类", icon_events[0]

        mapped = _map_dom_event_to_action(icon_events[0])
        assert mapped is not None, icon_events[0]
        action, params, _element = mapped
        assert action == "click_icon_button", action
        assert params.get("button_text") == "新增一级分类", params
        assert action != "click_element_by_index"

        # Noise header / plain button must not become click_icon_button
        captured.clear()
        await page2.click("#noise")
        await page2.wait_for_timeout(50)
        assert not any(e.get("kind") == "click_icon_button" for e in captured), captured

        captured.clear()
        await page2.click("button.el-button")
        await page2.wait_for_timeout(50)
        assert not any(e.get("kind") == "click_icon_button" for e in captured), captured
        plain = [e for e in captured if e.get("kind") == "click"]
        assert plain, f"expected generic click for plain button, got {captured!r}"

        await browser.close()

    print("characterize-icon-buttons: OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
