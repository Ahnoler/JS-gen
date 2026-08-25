#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Login-page locator fallback: label-less form fields must fall back to
name/placeholder xpath; XPath-like corrupt labels must be ignored.
"""
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
<div class="el-form-item">
  <input id="u" name="username" placeholder="请输入您的用户名">
</div>
<div class="el-form-item">
  <input id="p" name="password" placeholder="请输入您的密码">
</div>
<div class="el-form-item">
  <label>用户名</label>
  <input id="u2" name="username2">
</div>
</body></html>"""


def _snap(expr: str) -> str:
    return "() => {\n" + PAGE_LOCATOR_HELPERS + "\n" + expr + "\n}"


def main() -> int:
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        page.set_content(HTML)

        # 1) label-less username: hint '用户名' -> must fall back to name/placeholder
        loc1 = page.evaluate(_snap(
            "const h=document.getElementById('u'); const abs=absXPath(h);"
            "return buildLocatorSnap(h, h.value||'', abs, '用户名');"
        ))
        smart1 = (loc1 or {}).get('xpath_smart') or ''
        assert_true(smart1, f'no smart for label-less: {loc1!r}')
        assert_true("'username'" in smart1 or "请输入您的用户名" in smart1,
                    f'smart should use name/placeholder, got: {smart1}')
        cnt1 = page.evaluate("(xp)=>document.evaluate(xp,document,null,XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,null).snapshotLength", smart1)
        assert_true(cnt1 == 1, f'label-less smart count={cnt1}')

        # 2) corrupt XPath-like label: must be ignored and fall back
        loc2 = page.evaluate(_snap(
            "const h=document.getElementById('p'); const abs=absXPath(h);"
            "return buildLocatorSnap(h, h.value||'', abs, '/div[1]/div[1]/div[1]/div[1]/div[1]/div[2]/form[1]');"
        ))
        smart2 = (loc2 or {}).get('xpath_smart') or ''
        assert_true(smart2, f'no smart for corrupt label: {loc2!r}')
        assert_true("'password'" in smart2 or "请输入您的密码" in smart2,
                    f'smart should ignore corrupt label, got: {smart2}')
        cnt2 = page.evaluate("(xp)=>document.evaluate(xp,document,null,XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,null).snapshotLength", smart2)
        assert_true(cnt2 == 1, f'corrupt-label smart count={cnt2}')

        # 3) real label present: label-based xpath must still work
        loc3 = page.evaluate(_snap(
            "const h=document.getElementById('u2'); const abs=absXPath(h);"
            "return buildLocatorSnap(h, h.value||'', abs, '用户名');"
        ))
        smart3 = (loc3 or {}).get('xpath_smart') or ''
        assert_true(smart3, f'no smart for labeled: {loc3!r}')
        assert_true('.//label' in smart3 and '用户名' in smart3,
                    f'labeled field should keep label-based smart, got: {smart3}')
        cnt3 = page.evaluate("(xp)=>document.evaluate(xp,document,null,XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,null).snapshotLength", smart3)
        assert_true(cnt3 == 1, f'labeled smart count={cnt3}')

        browser.close()

    print('characterize-login-locator-fallback: OK')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
