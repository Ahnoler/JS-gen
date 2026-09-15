#!/usr/bin/env python3
"""Date-range manual recording emits the complete start/end value."""
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
<div class="el-form-item"><label class="el-form-item__label">查询日期范围</label>
  <div class="el-date-editor el-range-editor">
    <input value=""><span>至</span><input value="">
  </div>
</div>
<div class="el-picker-panel"><table class="el-date-table"><tbody>
  <tr><td><span>1</span></td><td><span>2</span></td></tr>
</tbody></table></div>
</body></html>"""


async def main() -> None:
    captured: list[dict] = []

    async def capture(payload: dict) -> None:
        captured.append(payload)

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()
        await page.set_content(HTML)
        await page.expose_function("__jsgenManualEmit", capture)
        await page.evaluate(JS_MANUAL_RECORDER)
        await page.evaluate("""() => {
          const editor = document.querySelector('.el-date-editor');
          const inputs = editor.querySelectorAll('input');
          document.querySelectorAll('.el-date-table td')[0].addEventListener('click', () => {
            inputs[0].value = '2026-09-01';
          });
          document.querySelectorAll('.el-date-table td')[1].addEventListener('click', () => {
            inputs[1].value = '2026-09-30';
          });
        }""")
        await page.click('.el-date-table td:nth-child(1)')
        await page.wait_for_timeout(100)
        await page.click('.el-date-table td:nth-child(2)')
        await page.wait_for_timeout(100)
        await browser.close()

    dates = [event for event in captured if event.get("kind") == "fill_date"]
    assert len(dates) >= 2, captured
    assert dates[-1]["value"] == "2026-09-01 - 2026-09-30", dates
    action = _map_dom_event_to_action(dates[-1])
    assert action is not None
    assert action[0] == "fill_form_field"
    assert action[1]["value"] == "2026-09-01 - 2026-09-30"
    print("characterize-date-range-recording: OK")


if __name__ == "__main__":
    asyncio.run(main())
