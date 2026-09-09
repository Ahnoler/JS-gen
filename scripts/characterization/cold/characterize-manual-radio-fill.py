#!/usr/bin/env python3
"""Manual recorder: Element UI radio click must not also emit fill with code value.

Bug: click on .el-radio emits click_radio, then native input[type=radio] change/blur
runs emitFill → fill_form_field with value="0"/"1". Duplicate of the radio click.
"""
from __future__ import annotations

import asyncio
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT))

from playwright.async_api import async_playwright

from scripts.manual_recorder.js import JS_MANUAL_RECORDER
from scripts.manual_recorder.mapper import _map_dom_event_to_action

HTML = """<!doctype html><html><body>
<div class="el-form-item">
  <label class="el-form-item__label">社团标志</label>
  <div class="el-form-item__content">
    <div class="el-radio-group" role="radiogroup" aria-label="radio-group">
      <label class="el-radio is-checked">
        <span class="el-radio__input is-checked">
          <input class="el-radio__original" name="club-flag" checked type="radio" value="1">
          <span class="el-radio__inner"></span>
        </span>
        <span class="el-radio__label">是</span>
      </label>
      <label class="el-radio">
        <span class="el-radio__input">
          <input class="el-radio__original" name="club-flag" type="radio" value="0">
          <span class="el-radio__inner"></span>
        </span>
        <span class="el-radio__label">否</span>
      </label>
    </div>
  </div>
</div>
</body></html>"""


def assert_true(cond: bool, msg: str) -> None:
    if not cond:
        raise AssertionError(msg)


def test_emit_fill_source_skips_radio() -> None:
    src = (ROOT / "scripts/manual_recorder/js_parts/b.py").read_text(encoding="utf-8")
    emit_fill = src.split("function emitFill", 1)[1].split("window.__jsgenManualOnChange", 1)[0]
    assert_true(
        ".el-select" in emit_fill,
        "emitFill already skips el-select inner input",
    )
    assert_true(
        "type === 'radio'" in emit_fill or 'type === "radio"' in emit_fill
        or ".el-radio" in emit_fill,
        "emitFill must skip native radio / .el-radio (click_radio already recorded)",
    )


async def test_click_radio_does_not_emit_fill() -> None:
    captured: list[dict] = []

    async def _capture(payload: dict) -> None:
        captured.append(payload)

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()
        await page.set_content(HTML)
        await page.expose_function("__jsgenManualEmit", _capture)
        await page.evaluate(JS_MANUAL_RECORDER)

        await page.click("label.el-radio:nth-of-type(2)")
        await page.evaluate(
            """() => {
              const inp = document.querySelector('label.el-radio:nth-of-type(2) input');
              inp.checked = true;
              inp.dispatchEvent(new Event('change', { bubbles: true }));
              inp.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
            }"""
        )
        await page.wait_for_timeout(80)
        await browser.close()

    kinds = [e.get("kind") for e in captured]
    radio_events = [e for e in captured if e.get("kind") == "click_radio"]
    fill_events = [e for e in captured if e.get("kind") in ("fill", "fill_date")]
    assert_true(radio_events, f"expected click_radio, got {kinds!r}")
    assert_true(
        radio_events[0].get("option_text") == "否"
        or "否" in str(radio_events[0].get("text") or ""),
        radio_events[0],
    )
    assert_true(
        not fill_events,
        f"radio change/blur must not emit fill (code value); got {fill_events!r}",
    )
    mapped = _map_dom_event_to_action(radio_events[0])
    assert_true(mapped is not None, radio_events[0])
    action, params, _el = mapped
    assert_true(action == "click_radio", action)
    assert_true(params.get("label_text") == "社团标志", params)
    assert_true(params.get("option_text") == "否" or "否" in str(params.get("option_text") or ""), params)


def main() -> int:
    test_emit_fill_source_skips_radio()
    asyncio.run(test_click_radio_does_not_emit_fill())
    print("characterize-manual-radio-fill: OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
