#!/usr/bin/env python3
"""国民经济部门 vs 国民经济部门类别 — select must not prefer the longer sibling.

JS_FIND_LABELED_SELECT pass-2 historically skipped exact labels
(``if (lbl === label || !lbl.includes(label)) continue``) so when pass-1
exact failed (e.g. label text ``*国民经济部门``), only ``国民经济部门类别`` matched.
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

from scripts.controller.actions.js_snippets.select_trigger import (  # noqa: E402
    JS_FIND_LABELED_SELECT,
    JS_SELECT_TRIGGER_BY_XPATH,
)


def assert_true(cond: bool, msg: str) -> None:
    if not cond:
        raise AssertionError(msg)


FIXTURE = """<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>dept select</title>
<style>
  .el-form-item { display:flex; gap:8px; margin:8px 0; }
  .el-form-item__label { width:180px; }
  .el-select { border:1px solid #ccc; padding:2px 6px; }
</style></head><body>
<div class="el-form-item">
  <label class="el-form-item__label">*国民经济部门</label>
  <div class="el-select"><input id="dept" class="el-input__inner" readonly value="" /></div>
</div>
<div class="el-form-item">
  <label class="el-form-item__label">国民经济部门类别</label>
  <div class="el-select"><input id="dept-type" class="el-input__inner" readonly value="" /></div>
</div>
</body></html>
"""

AMBIG_XP = (
    "//div[contains(@class,'el-form-item')]"
    "[.//label[contains(normalize-space(.),'国民经济部门')]]"
    "//div[contains(@class,'el-select')]"
)


def test_find_labeled_select_source_uses_norm_exact() -> None:
    js = JS_FIND_LABELED_SELECT
    assert_true(
        "normFormLab" in js or "normalizeFormLabel" in js or "labN" in js,
        "FIND_LABELED_SELECT must normalize labels before exact match",
    )


async def _run_live() -> None:
    from playwright.async_api import async_playwright

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()
        await page.set_content(FIXTURE)

        # Label-path trigger (auto-fill / agent select_option without xpath)
        r = await page.evaluate(JS_FIND_LABELED_SELECT, ["国民经济部门", "trigger"])
        assert_true(r == "ok-triggered", f"labeled trigger got {r!r}")
        which = await page.evaluate(
            """() => {
              const t = window.__last_select_trigger;
              return t ? t.id : null;
            }"""
        )
        assert_true(
            which == "dept",
            f"must open 国民经济部门 (id=dept), not 类别; got id={which!r}",
        )

        # Historical contains() xpath + label hint
        r2 = await page.evaluate(
            JS_SELECT_TRIGGER_BY_XPATH, [AMBIG_XP, "国民经济部门"]
        )
        assert_true(str(r2).startswith("ok"), f"xpath trigger got {r2!r}")
        which2 = await page.evaluate(
            """() => {
              const t = window.__last_select_trigger;
              return t ? t.id : null;
            }"""
        )
        assert_true(
            which2 == "dept",
            f"xpath+hint must open dept, got id={which2!r}",
        )
        await browser.close()


def test_live_dept_select_prefers_exact() -> None:
    asyncio.run(_run_live())


def main() -> int:
    test_find_labeled_select_source_uses_norm_exact()
    test_live_dept_select_prefers_exact()
    print("characterize-prefix-label-select: OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
