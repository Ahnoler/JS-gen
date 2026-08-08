#!/usr/bin/env python3
"""Characterize tree-select classification vs bare page .el-tree.

Regression: product sidebars use .el-tree; form fields must not be forced to
tree-select unless TsscMultiTree markers / Vue ancestry match. Also ensure
select_tree_option does not latch onto the first page .el-tree.
"""
from __future__ import annotations

import asyncio
import sys

sys.path.insert(0, ".")

from playwright.async_api import async_playwright

from scripts.controller.actions._js_snippets import JS_CLASSIFY_FIELD, JS_SELECT_TREE_OPTION

HTML = """<!doctype html><html><body>
<aside class="sidebar">
  <div class="el-tree" id="sidebar-tree"><div class="el-tree-node">对公流贷(3)</div></div>
</aside>
<div class="el-dialog" style="display:block">
  <div class="el-form-item" id="fi-catalog">
    <label class="el-form-item__label">分类目录</label>
    <div class="el-form-item__content">
      <div class="el-input"><input class="el-input__inner" value="" /></div>
    </div>
  </div>
  <div class="el-form-item" id="fi-industry">
    <label class="el-form-item__label">行业代码</label>
    <div class="el-form-item__content">
      <span class="my-popover tsscmultitree">
        <div class="el-input"><input class="el-input__inner" value="" /></div>
        <div class="tree-popover" style="display:none"><div class="el-tree"></div></div>
      </span>
    </div>
  </div>
  <div class="el-form-item" id="fi-select">
    <label class="el-form-item__label">普通下拉</label>
    <div class="el-form-item__content">
      <div class="el-select"><div class="el-input"><input class="el-input__inner" readonly /></div></div>
    </div>
  </div>
</div>
</body></html>"""

SETUP_VUE = """() => {
  const host = document.querySelector('#fi-industry .my-popover');
  if (!host) return;
  // Minimal Vue-like chain: host → TsscMultiTree
  host.__vue__ = {
    $options: { name: 'TsscMultiTree' },
    $parent: null,
    data: [{ id: '1', label: '科技', children: [] }],
    treeData: [{ id: '1', name: '科技' }],
    handleHideClick() {},
    $emit() {},
  };
}"""


async def main() -> int:
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()
        await page.set_content(HTML)
        await page.evaluate(SETUP_VUE)

        kinds = await page.evaluate(
            """(classifySrc) => {
              const classify = eval('(' + classifySrc + ')');
              return {
                catalog: classify(document.querySelector('#fi-catalog')),
                industry: classify(document.querySelector('#fi-industry')),
                select: classify(document.querySelector('#fi-select')),
              };
            }""",
            JS_CLASSIFY_FIELD,
        )
        assert kinds["catalog"] == "input", kinds
        assert kinds["industry"] == "tree-select", kinds
        assert kinds["select"] == "select", kinds

        # Bare sidebar .el-tree must not satisfy select_tree_option for 分类目录
        result = await page.evaluate(JS_SELECT_TREE_OPTION, ["分类目录", "first"])
        assert str(result).startswith("no-tree-component"), result

        await browser.close()

    print("characterize-tree-select-classify: OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
