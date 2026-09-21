#!/usr/bin/env python3
"""Characterize icon-button label resolution (no hover / no aria-describedby).

Uses a blank Playwright page with mocked ElTooltip hosts (__vue__.content).
Also covers manual recorder → mapper parity for click_button.
"""
from __future__ import annotations

import asyncio
import json
import sys

sys.path.insert(0, ".")

from playwright.async_api import async_playwright

from scripts.controller.actions._js_snippets import (
    JS_CLICK_ICON_BUTTON,
    JS_COLLECT_ICON_BUTTONS,
    JS_STAMP_ICON_ARIA_LABELS,
)
from scripts.controller.actions.js_snippets._locator_helpers_js import PAGE_LOCATOR_HELPERS
from scripts.manual_recorder.js import JS_MANUAL_RECORDER
from scripts.manual_recorder.mapper import _map_dom_event_to_action

# U+241F (symbol for unit separator) — locator-snapshot tail delimiter shared
# with JS_CLICK_ICON_BUTTON / _JS_CLICK_BUTTON_IN_CONTAINER / ClickEngine.
SEP = "␟"

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
        'kind': 'click_button',
        'button_text': '新增一级分类',
        'text': '新增一级分类',
        'tag': 'a',
        'attributes': {'class': 'el-tooltip el-icon-folder-add'},
        'xpath': '',
        'xpath_smart': '',
    })
    assert mapped is not None, mapped
    action, params, element = mapped
    assert action == 'click_button', action
    assert params == {'button_text': '新增一级分类'}, params
    assert element.get('target_kind') == 'icon', element
    assert 'aria-label' in (element.get('xpath_smart') or ''), element.get('xpath_smart')

    empty = _map_dom_event_to_action({
        'kind': 'click_button',
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
        # 尾段追加不改首段：ok␟{locator json}（原断言 r == "ok" 因尾段追加放宽为首段判定）
        assert r.startswith("ok"), r
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

        icon_events = [e for e in captured if e.get("kind") == "click_button"]
        assert icon_events, f"expected click_button emit, got {captured!r}"
        assert icon_events[0].get("button_text") == "新增一级分类", icon_events[0]

        mapped = _map_dom_event_to_action(icon_events[0])
        assert mapped is not None, icon_events[0]
        action, params, _element = mapped
        assert action == "click_button", action
        assert params.get("button_text") == "新增一级分类", params
        assert action != "click_element_by_index"

        # Noise header / plain button must not become click_button
        captured.clear()
        await page2.click("#noise")
        await page2.wait_for_timeout(50)
        assert not any(e.get("kind") == "click_button" for e in captured), captured

        captured.clear()
        await page2.click("button.el-button")
        await page2.wait_for_timeout(50)
        assert not any(e.get("kind") == "click_button" for e in captured), captured
        plain = [e for e in captured if e.get("kind") == "click"]
        assert plain, f"expected generic click for plain button, got {captured!r}"

        # ── 更多/展开 icon-only toggle fallback ─────────────────────────────
        # Real SUT markup: <span class="tsscBtn more-btn"><label><button
        # class="el-button ... is-plain"><i class="el-icon-caret-bottom"/></button></label></span>
        # 未展开 = caret-bottom（可点开）；已展开 = caret-top（勿点，否则收起）。
        more_html = """<!doctype html><html><head><style>
          button.el-button { display: inline-block; min-width: 24px; height: 24px; }
          span.tsscBtn.more-btn { display: inline-block; }
        </style></head><body>
        <div class="search-bar">
          <div class="el-form-item"><label>客户名称</label><input id="kw"></div>
          <button type="button" class="el-button">查询</button>
          <button type="button" class="el-button">重置</button>
          <span class="tsscBtn more-btn"><label><button id="more-icon" type="button"
            class="el-button disableBtn el-button--primary el-button--small is-plain">
            <i class="el-icon-caret-bottom"></i></button></label></span>
        </div></body></html>"""

        page3 = await browser.new_page()
        await page3.set_content(more_html)
        clicked3: list[str] = []
        await page3.expose_function("onMore3", lambda name: clicked3.append(name))
        await page3.evaluate(
            """() => {
              document.getElementById('more-icon')
                .addEventListener('click', () => window.onMore3('more-icon'));
            }"""
        )
        r3 = await page3.evaluate(JS_CLICK_ICON_BUTTON, "更多")
        assert r3.startswith("ok-more-toggle"), r3
        assert clicked3 == ["more-icon"], clicked3

        # Already-expanded (caret-top) must NOT be clicked (would collapse/hide fields).
        expanded_html = more_html.replace("el-icon-caret-bottom", "el-icon-caret-top")
        page3b = await browser.new_page()
        await page3b.set_content(expanded_html)
        clicked3b: list[str] = []
        await page3b.expose_function("onMore3b", lambda name: clicked3b.append(name))
        await page3b.evaluate(
            """() => {
              document.getElementById('more-icon')
                .addEventListener('click', () => window.onMore3b('more-icon'));
            }"""
        )
        r3b = await page3b.evaluate(JS_CLICK_ICON_BUTTON, "更多")
        assert r3b == "err-more-toggle-already-expanded", r3b
        assert clicked3b == [], clicked3b

        # aria-label/tooltip-only toggle (textless) also resolves.
        label_html = more_html.replace('class="tsscBtn more-btn"', 'class="tsscBtn"')
        label_html = label_html.replace(
            'class="el-button disableBtn el-button--primary el-button--small is-plain"',
            'class="el-button" aria-label="展开"',
        )
        page4 = await browser.new_page()
        await page4.set_content(label_html)
        clicked4: list[str] = []
        await page4.expose_function("onMore4", lambda name: clicked4.append(name))
        await page4.evaluate(
            """() => {
              document.getElementById('more-icon')
                .addEventListener('click', () => window.onMore4('more-icon'));
            }"""
        )
        r4 = await page4.evaluate(JS_CLICK_ICON_BUTTON, "更多")
        assert r4.startswith("ok-more-toggle"), r4
        assert clicked4 == ["more-icon"], clicked4

        # Ambiguous (two collapsed more-btn) → refuse to guess.
        ambig_html = more_html.replace(
            "</div></body>",
            '<span class="tsscBtn more-btn"><label><button type="button" class="el-button">'
            '<i class="el-icon-caret-bottom"></i></button></label></span></div></body>',
        )
        page5 = await browser.new_page()
        await page5.set_content(ambig_html)
        r5 = await page5.evaluate(JS_CLICK_ICON_BUTTON, "更多")
        assert r5.startswith("err-more-toggle-ambiguous"), r5

        # No candidate at all → keep the original miss result.
        miss_html = """<!doctype html><html><body>
          <div><button type="button" class="el-button">
            <i class="el-icon-caret-bottom"></i></button></div>
        </body></html>"""
        page6 = await browser.new_page()
        await page6.set_content(miss_html)
        r6 = await page6.evaluate(JS_CLICK_ICON_BUTTON, "更多")
        assert r6 == "err-icon-label-miss", r6

        # ── 实验 C（离线化）：more-btn 点击命中时刻定位快照——伪造场景全链护栏 ──
        # 生产定谳：click_button('更多') 落库 xpath 来自点击前的 _enrich_click_element
        # （includes 文本匹配取最后命中），实际点击走 JS_CLICK_ICON_BUTTON more-toggle
        # 兜底下钻内层 button——两链无一致性校验时，落库 xpath 可指向从未被点击的
        # 节点；纯图标无 tooltip 时 enrich null → 落库无定位 → 回放 not-found。
        # 此页注入可见假按钮 jsgen-forensic-fake + 真 more-toggle 结构，按 engine
        # click_button 顺序（stamp → enrich → JS click）跑，listener 记录实际被点节点。
        from scripts.controller.actions.click_action_engine import (
            _apply_click_locator_snapshot,
        )
        from scripts.controller.actions._helpers import _enrich_click_element

        forensic_html = """<!doctype html><html><head><style>
          button.el-button { display: inline-block; min-width: 24px; height: 24px; }
          span.tsscBtn.more-btn { display: inline-block; }
        </style></head><body>
        <div class="search-bar">
          <div class="el-form-item"><label>客户名称</label><input id="kw"></div>
          <button type="button" class="el-button">查询</button>
          <button type="button" class="el-button">重置</button>
          <span class="tsscBtn more-btn"><label><button id="more-icon" type="button"
            class="el-button disableBtn el-button--primary el-button--small is-plain">
            <i class="el-icon-caret-bottom"></i></button></label></span>
        </div>
        <div class="el-table">
          <div class="el-table__body-wrapper"><table><tbody><tr><td>
            <button id="jsgen-forensic-fake" type="button" class="el-button">更多操作</button>
          </td></tr></tbody></table></div>
        </div>
        </body></html>"""

        pageC = await browser.new_page()
        await pageC.set_content(forensic_html)
        clickedC: list[str] = []
        await pageC.expose_function("onForensic", lambda name: clickedC.append(name))
        # PAGE_LOCATOR_HELPERS 提供与 enrich 一致的 absXPath（被点节点身份比对）
        await pageC.evaluate(
            "(() => {" + PAGE_LOCATOR_HELPERS + " window.__absXPath = absXPath; })()"
        )
        await pageC.evaluate(
            """() => {
              document.getElementById('more-icon').addEventListener('click', () => {
                window.__clickedAbs = window.__absXPath(document.getElementById('more-icon'));
                window.onForensic('more-icon');
              });
              document.getElementById('jsgen-forensic-fake').addEventListener('click', () => {
                window.__clickedAbs = window.__absXPath(document.getElementById('jsgen-forensic-fake'));
                window.onForensic('jsgen-forensic-fake');
              });
            }"""
        )
        # engine click_button 顺序：stamp → enrich → JS click
        await pageC.evaluate(JS_STAMP_ICON_ARIA_LABELS)
        elementC = await _enrich_click_element(pageC, text='更多', target_kind='icon')
        # 前置（缺陷复现守卫）：enrich 产物必须落在假按钮上
        assert 'jsgen-forensic-fake' in str(elementC.get('xpath') or ''), (
            f"forensic precondition broken, enrich xpath={elementC.get('xpath')!r}"
        )
        resultC = await pageC.evaluate(JS_CLICK_ICON_BUTTON, "更多")
        assert resultC.startswith("ok-more-toggle"), resultC
        assert clickedC == ["more-icon"], clickedC

        # ① result 尾段可解析出 locator（U+241F 分隔，首段 ok-more-toggle 保持）
        assert SEP in resultC, f"result missing locator tail: {resultC[:120]!r}"
        locator = json.loads(resultC.split(SEP, 1)[1])
        assert locator.get("xpath"), locator

        # ② locator.xpath 在 DOM 命中，且命中节点 === listener 记录的被点节点
        hit_abs = await pageC.evaluate(
            """([xp]) => {
              const n = document.evaluate(xp, document, null,
                XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
              return n ? window.__absXPath(n) : '';
            }""",
            [locator["xpath"]],
        )
        assert hit_abs, f"locator.xpath命中为空: {locator['xpath']!r}"
        clicked_abs = await pageC.evaluate("() => window.__clickedAbs || ''")
        assert clicked_abs, "listener 未记录被点节点"
        assert hit_abs == clicked_abs, (
            f"落库定位命中 {hit_abs!r}，实际被点 {clicked_abs!r}——伪造未修复"
        )
        assert "jsgen-forensic-fake" not in hit_abs, hit_abs

        # ③ 最终落库 element（engine 经快照覆盖后）不含 fake 按钮 id
        merged = _apply_click_locator_snapshot(resultC, dict(elementC))
        assert "jsgen-forensic-fake" not in str(merged.get("xpath") or ""), merged.get("xpath")
        assert "jsgen-forensic-fake" not in str(merged.get("xpath_smart") or ""), (
            merged.get("xpath_smart")
        )
        assert merged.get("target_kind"), merged

        # ③b icon_class 链闭合（A 修）：more-btn 的 el-icon 类在子 <i> 上、
        # extractElIconClass 只看宿主 className 取不到——more-toggle 分支须显式
        # 把 more-btn 信号写进快照 icon_class，engine 直写 element['icon_class']
        # （不经 _element_info_from_locate），回放侧 replay_click 消费 el.icon_class。
        assert "more-btn" in str(merged.get("icon_class") or ""), (
            f"icon_class 链断裂: {merged.get('icon_class')!r}"
        )

        # ④ 纯图标（无 tooltip）场景快照非空
        assert locator.get("xpath_full"), locator
        assert str(locator.get("text") or "") == "更多", locator.get("text")

        # ⑤ 歧义守卫：两个同文本 icon 宿主 → err-icon-label-ambiguous（不盲点）
        ambig2_html = """<!doctype html><html><head><style>
          a.el-tooltip { display: inline-block; width: 24px; height: 24px; }
        </style></head><body>
        <a class="el-tooltip el-icon-delete" tabindex="0"></a>
        <a class="el-tooltip el-icon-delete" tabindex="0"></a>
        </body></html>"""
        pageC2 = await browser.new_page()
        await pageC2.set_content(ambig2_html)
        await pageC2.evaluate(
            """() => {
              for (const el of document.querySelectorAll('a.el-icon-delete')) {
                el.__vue__ = { content: '删除', $props: { content: '删除' } };
              }
            }"""
        )
        rC2 = await pageC2.evaluate(JS_CLICK_ICON_BUTTON, "删除")
        assert rC2.startswith("err-icon-label-ambiguous"), rC2

        await browser.close()

    print("characterize-icon-buttons: OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
