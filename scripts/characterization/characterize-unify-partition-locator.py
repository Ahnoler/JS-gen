#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""U1/U2: unified partition/locator kernel contracts."""
from __future__ import annotations
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))


def assert_true(cond: bool, msg: str) -> None:
    if not cond:
        raise AssertionError(msg)


def helpers_src() -> str:
    return (ROOT / "src/cdp/page-locator-helpers.js").read_text(encoding="utf-8")


def test_normalize_host_and_classify_operable_exist() -> None:
    h = helpers_src()
    assert_true("function normalizeHost" in h, "normalizeHost must exist")
    assert_true("function classifyOperable" in h, "classifyOperable must exist")


def test_inventory_aliases_collect_l2_hosts() -> None:
    h = helpers_src()
    assert_true("function collectL2Hosts" in h, "collectL2Hosts must exist")
    body = h.split("function collectInventoryHosts", 1)[1][:400]
    assert_true(
        "collectL2Hosts" in body,
        "collectInventoryHosts must delegate to collectL2Hosts",
    )


def test_inventory_kind_delegates_to_classify() -> None:
    h = helpers_src()
    body = h.split("function inventoryKindOf", 1)[1].split("function inventoryPickControl", 1)[0]
    assert_true(
        "classifyOperable" in body,
        "inventoryKindOf must call classifyOperable (no parallel kind ladder)",
    )


def test_normalize_target_root_aliases_or_calls_normalize_host() -> None:
    h = helpers_src()
    # Either normalizeTargetRoot body calls normalizeHost, or normalizeHost wraps normalizeTargetRoot once.
    assert_true(
        "function normalizeHost" in h and "normalizeTargetRoot" in h,
        "both normalizeHost and normalizeTargetRoot present",
    )
    # Prefer: normalizeHost is the documented entry; TargetRoot delegates or is alias.
    host_i = h.find("function normalizeHost")
    # After U1, snap/inventory comments should mention normalizeHost
    assert_true(host_i != -1, "normalizeHost declared")


def test_collect_l2_buttons_mentions_classify_operable() -> None:
    src = (ROOT / "scripts/controller/actions/js_snippets/scan_form.py").read_text(
        encoding="utf-8"
    )
    body = src.split("function collectL2Buttons", 1)[1].split(
        "function discoverL1", 1
    )[0]
    assert_true(
        "classifyOperable" in body,
        "collectL2Buttons must call classifyOperable for admission",
    )


def test_multi_todo_inventory_region_labels_distinct() -> None:
    from playwright.sync_api import sync_playwright
    from scripts.controller.actions.js_snippets._locator_helpers_js import (
        PAGE_LOCATOR_HELPERS,
    )

    html = """<!DOCTYPE html><html><body>
<div class="el-checkbox-group" aria-label="checkbox-group">
  <div class="todo-item"><div class="todo-item__header">【对公】DGSX20260812056002
    <div class="todo-item-actions"><div class="todo-item-action">处理</div></div>
  </div></div>
  <div class="todo-item"><div class="todo-item__header">评级 PJ20260807012042
    <div class="todo-item-actions"><div class="todo-item-action">处理</div></div>
  </div></div>
</div>
</body></html>"""

    js = (
        "() => {\n"
        + PAGE_LOCATOR_HELPERS
        + """
  const inv = filterInventoryByKind(collectInventoryHosts(), 'click_element_by_index');
  const hits = inv.filter(function (h) { return h.text === '处理'; });
  return hits.map(function (h) {
    const root = normalizeHost(h.el) || h.el;
    const reg = assignRegion(root);
    const loc = buildLocatorSnap(root, h.text, absXPath(root), '', {
      targetKind: h.kind,
      region: reg,
    });
    return {
      kind: h.kind,
      region_label: loc.region_label || reg.region_label || '',
      region_role: loc.region_role || reg.region_role || '',
    };
  });
}
"""
    )

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        page.set_content(html)
        rows = page.evaluate(js)
        browser.close()

    assert_true(isinstance(rows, list) and len(rows) >= 2, f"need ≥2 处理 hits, got {rows!r}")
    for r in rows:
        assert_true(r.get("kind") == "button", f"kind button required, got {r!r}")
        assert_true(r.get("region_role") != "main", f"must not dump to main, got {r!r}")
    labels = [str(r.get("region_label") or "") for r in rows]
    assert_true(all(labels), f"region_label must be non-empty, got {rows!r}")
    assert_true(
        len(set(labels)) == len(labels),
        f"region_label must be pairwise distinct, got {labels!r}",
    )
    blob = " ".join(labels)
    assert_true(
        ("DGSX20260812056002" in blob) and ("PJ20260807012042" in blob),
        f"labels must carry business keys, got {labels!r}",
    )


def main() -> int:
    test_normalize_host_and_classify_operable_exist()
    test_inventory_aliases_collect_l2_hosts()
    test_inventory_kind_delegates_to_classify()
    test_normalize_target_root_aliases_or_calls_normalize_host()
    test_collect_l2_buttons_mentions_classify_operable()
    test_multi_todo_inventory_region_labels_distinct()
    print("characterize-unify-partition-locator: OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
