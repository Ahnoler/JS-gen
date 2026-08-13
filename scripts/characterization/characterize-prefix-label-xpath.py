#!/usr/bin/env python3
"""Prefix form labels must not steal sibling fields (财务部联系人 → 手机号码).

Root cause (traj 33 / slot1):
  element.xpath_smart uses contains(label) → multi-hit
  JS_FILL_BY_XPATH LABEL_HINT used lab.includes(want) from the end → wrote last sibling
  _JS_READ_VALUE_BY_XPATH took last visible → empty / wrong readback
"""
from __future__ import annotations

import asyncio
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

os.environ.setdefault(
    "PLAYWRIGHT_BROWSERS_PATH",
    str(Path(os.environ.get("LOCALAPPDATA", "")) / "ms-playwright"),
)

from scripts.controller.actions.js_snippets.fill_core import JS_FILL_BY_XPATH  # noqa: E402
from scripts.controller.actions.replay_js import _JS_READ_VALUE_BY_XPATH  # noqa: E402


def assert_true(cond: bool, msg: str) -> None:
    if not cond:
        raise AssertionError(msg)


FIXTURE = """<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>prefix label</title>
<style>
  .el-form-item { display:flex; gap:8px; margin:8px 0; }
  .el-form-item__label { width:220px; }
</style></head><body>
<div class="el-form-item"><label class="el-form-item__label">财务部联系人</label>
  <input id="contact" class="el-input__inner" value="周伟刚" /></div>
<div class="el-form-item"><label class="el-form-item__label">财务部联系人身份证号码</label>
  <input id="idcard" class="el-input__inner" value="" /></div>
<div class="el-form-item"><label class="el-form-item__label">财务部联系人手机号归属人关系类型</label>
  <input id="rel" class="el-input__inner" value="" /></div>
<div class="el-form-item"><label class="el-form-item__label">财务部联系人手机号码（短信通知）</label>
  <input id="phone" class="el-input__inner" value="" /></div>
</body></html>
"""

# Historical contains() xpath as stored on traj 33
AMBIG_XP = (
    "//div[contains(@class,'el-form-item')]"
    "[.//label[contains(normalize-space(.),'财务部联系人')]]//input"
)


def test_fill_snippet_prefers_exact_label() -> None:
    """Static contract: includes-only match is insufficient for prefix labels."""
    js = JS_FILL_BY_XPATH
    assert_true("LABEL_HINT_DISAMBIG" in js, "fill keeps LABEL_HINT_DISAMBIG marker")
    # Must prefer exact normalized equality, not only lab.includes(want)
    assert_true(
        "exactMatch" in js or "labExact" in js or "=== want" in js or "=== wantN" in js
        or "labN === wantN" in js.replace(" ", ""),
        "fill-by-xpath must prefer exact label equality over includes()",
    )


def test_read_snippet_accepts_label_hint() -> None:
    js = _JS_READ_VALUE_BY_XPATH
    assert_true(
        "labelHint" in js or "formLabel" in js or "want" in js,
        "read-by-xpath must accept a label hint for multi-match disambiguation",
    )


async def _run_live() -> None:
    from playwright.async_api import async_playwright

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()
        await page.set_content(FIXTURE)

        fill = await page.evaluate(JS_FILL_BY_XPATH, [AMBIG_XP, "杨芳刚", "财务部联系人"])
        assert_true(str(fill).startswith("ok"), f"fill should ok, got {fill!r}")

        vals = await page.evaluate(
            """() => ({
              contact: document.getElementById('contact').value,
              idcard: document.getElementById('idcard').value,
              rel: document.getElementById('rel').value,
              phone: document.getElementById('phone').value,
            })"""
        )
        assert_true(
            vals["contact"] == "杨芳刚",
            f"must write 财务部联系人, got {vals!r}",
        )
        assert_true(
            vals["phone"] == "",
            f"must NOT write into 手机号码 sibling, got {vals!r}",
        )

        # Replay verify path: read with label hint (new signature [xpath, labelHint])
        read = await page.evaluate(_JS_READ_VALUE_BY_XPATH, [AMBIG_XP, "财务部联系人"])
        assert_true(
            read == "杨芳刚",
            f"read-back with label hint must return contact value, got {read!r}",
        )
        await browser.close()


def test_live_prefix_label_fill_and_read() -> None:
    asyncio.run(_run_live())


def main() -> int:
    test_fill_snippet_prefers_exact_label()
    test_read_snippet_accepts_label_hint()
    test_live_prefix_label_fill_and_read()
    print("characterize-prefix-label-xpath: OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
