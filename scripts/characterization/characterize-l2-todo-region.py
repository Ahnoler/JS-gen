#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""P0: 待办「处理」enters L2 buttons with card region_label (PJ…), not main."""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from playwright.sync_api import sync_playwright  # noqa: E402
from scripts.controller.actions._js_snippets import JS_SCAN_FORM_FIELDS  # noqa: E402


def assert_true(cond: bool, msg: str) -> None:
    if not cond:
        raise AssertionError(msg)


HTML = """<!DOCTYPE html><html><body>
<div class="el-main">
  <div class="todo-item">
    <div class="todo-item__header">
      <span>PJ20260807012042 对公客户评级</span>
      <div class="todo-item-actions">
        <div class="todo-item-action" style="cursor:pointer">处理</div>
      </div>
    </div>
  </div>
  <div class="todo-item">
    <div class="todo-item__header">
      <span>PJ99999999999999 另一笔</span>
      <div class="todo-item-actions">
        <div class="todo-item-action" style="cursor:pointer">处理</div>
      </div>
    </div>
  </div>
</div>
</body></html>"""


def main() -> int:
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        page.set_content(HTML)
        raw = page.evaluate(
            JS_SCAN_FORM_FIELDS,
            [True, ["处理", "保存"], {"mode": "fullpage"}],
        )
        browser.close()

    data = raw if isinstance(raw, dict) else json.loads(raw)
    buttons = data.get("buttons") or []
    hits = [b for b in buttons if (b.get("label") or "") == "处理"]
    assert_true(len(hits) >= 2, f"expected ≥2 处理 buttons, got {buttons!r}")
    for b in hits:
        label = b.get("region_label") or ""
        assert_true(
            label.startswith("PJ"),
            f"处理 must have card region_label PJ…, got {b!r}",
        )
        assert_true(
            label != "主区" and (b.get("region_role") or "") != "main",
            f"处理 must not dump into main, got {b!r}",
        )
    print("characterize-l2-todo-region: OK")
    print(json.dumps({"buttons": hits}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
