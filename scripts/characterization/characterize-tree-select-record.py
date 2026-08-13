#!/usr/bin/env python3
"""Characterize AI recording of form tree-select (行业代码) as select_tree_option.

Bug: steps land as tree_node clicks / wrong target_kind instead of
select_tree_option + form_tree_select on the field control.
"""
from __future__ import annotations

import asyncio
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))


def assert_true(cond: bool, msg: str) -> None:
    if not cond:
        raise AssertionError(msg)


def _norm(s: str) -> str:
    return " ".join((s or "").split())


def test_select_tree_option_resolves_and_captures_xpath() -> None:
    form = (ROOT / "scripts/controller/actions/_form.py").read_text(encoding="utf-8")
    chunk = form.split("async def select_tree_option", 1)[1].split("async def ", 1)[0]
    norm = _norm(chunk)
    assert_true("_resolve_control" in chunk, "select_tree_option must resolve control xpath")
    assert_true(
        "xpath_smart=xp" in norm or "xpath_smart = xp" in norm,
        "select_tree_option capture must pass resolved xpath (xp)",
    )
    assert_true(
        "target_kind='form_tree_select'" in chunk
        or 'target_kind="form_tree_select"' in chunk,
        "capture target_kind must be form_tree_select",
    )


def test_prepare_element_infers_form_tree_select() -> None:
    """Offline prepare must stamp form_tree_select for select_tree_option."""
    # Source contract (element.js) — avoid Node import in pure Python char.
    src = (ROOT / "src/models/element.js").read_text(encoding="utf-8")
    # The inferredKind chain must map select_tree_option → form_tree_select
    # (not form_input).
    assert_true(
        "select_tree_option" in src and "form_tree_select" in src,
        "element.js must mention form_tree_select for tree select",
    )
    # Crude but stable: form_input inference must not be the only branch for select_tree_option
    idx = src.find("select_tree_option")
    assert_true(idx > 0, "select_tree_option referenced in element.js")
    window = src[max(0, idx - 200) : idx + 200]
    assert_true(
        "form_tree_select" in window
        or "form_tree_select" in src[src.find("inferredKind") : src.find("inferredKind") + 800],
        "inferredKind for select_tree_option must be form_tree_select",
    )


def test_helpers_remap_popover_tree_to_form_tree_select() -> None:
    helpers = (
        ROOT / "scripts/controller/actions/js_snippets/_locator_helpers_js.py"
    ).read_text(encoding="utf-8")
    assert_true(
        "resolveFormTreeSelectHostFromPopoverTree" in helpers
        or "form_tree_select" in helpers.split("function detectTargetKind", 1)[1][:1200],
        "detectTargetKind / normalizeTargetRoot must remap form tree-select popover nodes",
    )
    assert_true(
        "resolveFormTreeSelectHostFromPopoverTree" in helpers,
        "helper resolveFormTreeSelectHostFromPopoverTree must exist",
    )


def test_manual_mapper_select_tree_option() -> None:
    from scripts.manual_recorder.mapper import _map_dom_event_to_action

    action, params, element = _map_dom_event_to_action(
        {
            "kind": "select_tree_option",
            "label_text": "行业代码",
            "option_text": "计算机、通信和其他电子设备制造业",
            "xpath_smart": "//div[contains(@class,'el-form-item')][.//label[normalize-space(.)='行业代码']]//span[contains(@class,'my-popover')]",
            "xpath_abs": "/html/body/div[1]/span",
            "tag": "span",
            "target_kind": "form_tree_select",
            "attributes": {"class": "my-popover tsscmultitree"},
            "text": "计算机、通信和其他电子设备制造业",
        }
    )
    assert_true(action == "select_tree_option", f"action={action}")
    assert_true(params.get("label_text") == "行业代码", params)
    assert_true(
        params.get("option_text") == "计算机、通信和其他电子设备制造业",
        params,
    )
    assert_true(
        (element or {}).get("target_kind") == "form_tree_select",
        element,
    )


HTML = """<!doctype html><html><body>
<div class="el-dialog" style="display:block">
  <div class="el-form-item" id="fi-industry">
    <label class="el-form-item__label">行业代码</label>
    <div class="el-form-item__content">
      <span class="my-popover tsscmultitree" id="tree-host">
        <div class="el-input"><input class="el-input__inner" value="" /></div>
      </span>
    </div>
  </div>
</div>
<div class="tree-popover" id="pop" style="display:block">
  <div class="el-tree">
    <div class="el-tree-node">
      <div class="el-tree-node__content" id="leaf">
        <span class="el-tree-node__label">计算机、通信和其他电子设备制造业</span>
      </div>
    </div>
  </div>
</div>
<aside class="sidebar"><div class="el-tree"><div class="el-tree-node">
  <div class="el-tree-node__content" id="sidebar-leaf"><span class="el-tree-node__label">侧栏节点</span></div>
</div></div></aside>
</body></html>"""

SETUP_VUE = """() => {
  const host = document.querySelector('#tree-host');
  const tree = document.querySelector('#pop .el-tree');
  if (!host || !tree) return;
  const vm = {
    $options: { name: 'TsscMultiTree' },
    $parent: null,
    $el: host,
    data: [],
    treeData: [],
  };
  host.__vue__ = vm;
  tree.__vue__ = { $options: { name: 'ElTree' }, $parent: vm, $el: tree };
}"""


async def test_live_classify_popover_tree() -> None:
    from playwright.async_api import async_playwright
    from scripts.controller.actions.js_snippets._locator_helpers_js import (
        PAGE_LOCATOR_HELPERS,
    )

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()
        await page.set_content(HTML)
        await page.evaluate(SETUP_VUE)
        # Indirect eval → function decls become page globals
        await page.evaluate("(src) => { (0, eval)(src); }", PAGE_LOCATOR_HELPERS)
        kinds = await page.evaluate(
            """() => {
              const leaf = document.querySelector('#leaf');
              const side = document.querySelector('#sidebar-leaf');
              const hostLeaf = resolveFormTreeSelectHostFromPopoverTree(leaf);
              const hostSide = resolveFormTreeSelectHostFromPopoverTree(side);
              return {
                leafKind: detectTargetKind(normalizeTargetRoot(leaf) || leaf),
                sideKind: detectTargetKind(normalizeTargetRoot(side) || side),
                hostOk: !!(hostLeaf && hostLeaf.id === 'tree-host'),
                sideNull: hostSide == null,
              };
            }"""
        )
        await browser.close()

    assert_true(kinds["hostOk"], f"popover leaf must resolve to tree-host: {kinds}")
    assert_true(kinds["sideNull"], f"sidebar leaf must not upgrade: {kinds}")
    assert_true(
        kinds["leafKind"] == "form_tree_select",
        f"popover leaf kind={kinds['leafKind']}",
    )
    assert_true(kinds["sideKind"] == "tree_node", f"sidebar kind={kinds['sideKind']}")


def main() -> int:
    test_select_tree_option_resolves_and_captures_xpath()
    test_prepare_element_infers_form_tree_select()
    test_helpers_remap_popover_tree_to_form_tree_select()
    test_manual_mapper_select_tree_option()
    asyncio.run(test_live_classify_popover_tree())
    print("characterize-tree-select-record: OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
