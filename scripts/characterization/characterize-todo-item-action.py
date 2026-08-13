#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Characterize todo-card action recording / replay (待办「处理」).

Portal wfPendTask cards use ``div.todo-item-action`` (cursor:pointer) — not
button / a / role=button. Manual recorder previously dropped these clicks
(无法入库); durable replay text path also skipped them → 假成功/未点到.
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from scripts.manual_recorder.mapper import _map_dom_event_to_action  # noqa: E402


def assert_true(cond: bool, msg: str) -> None:
    if not cond:
        raise AssertionError(msg)


def test_manual_recorder_emits_todo_item_action() -> None:
    b = (ROOT / "scripts/manual_recorder/js_parts/b.py").read_text(encoding="utf-8")
    assert_true(".todo-item-action" in b, "manual click path must mention todo-item-action")
    click = b.split("window.__jsgenManualOnClick", 1)[1]
    # Prefer the dedicated branch marker over last-resort class*="todo-item-action"
    branch = click.find("const todoAction = el.closest('.todo-item-action')")
    generic = click.find("// generic button / link / clickable")
    assert_true(branch != -1, "dedicated todoAction closest branch")
    assert_true(generic != -1, "generic button marker")
    assert_true(branch < generic, "todo-item-action branch must run before generic button filter")
    assert_true("parent_text" in b, "elMeta must stamp parent_text for card scope")


def test_mapper_keeps_parent_text_on_click() -> None:
    mapped = _map_dom_event_to_action(
        {
            "kind": "click",
            "text": "处理",
            "tag": "div",
            "attributes": {"class": "todo-item-action"},
            "xpath_smart": "//div[contains(@class,'todo-item-action') and normalize-space()='处理']",
            "xpath_abs": "/html/body/div[1]/div[1]",
            "parent_text": "PJ20260807012042",
        }
    )
    assert_true(mapped is not None, "click on todo-item-action must map")
    action, params, element = mapped
    assert_true(action == "click_element_by_index", f"action={action}")
    assert_true(params.get("text") == "处理", f"params.text={params.get('text')!r}")
    assert_true(
        params.get("parent_text") == "PJ20260807012042",
        f"params.parent_text={params.get('parent_text')!r}",
    )
    assert_true(
        (element or {}).get("parent_text") == "PJ20260807012042",
        "element.parent_text stamped",
    )


def test_replay_durable_includes_todo_item_action() -> None:
    js = (ROOT / "scripts/controller/actions/replay_js.py").read_text(encoding="utf-8")
    chunk = js.split("_JS_CLICK_DURABLE", 1)[1].split("_JS_READ_VALUE_BY_XPATH", 1)[0]
    assert_true(".todo-item-action" in chunk, "durable click must query todo-item-action")
    assert_true("ok-todo-action" in chunk, "must return ok-todo-action marker")
    assert_true(
        "ok-todo-action-scoped" in chunk,
        "must support parent_text card scoping",
    )


def test_scan_admits_todo_item_action_buttons() -> None:
    """Auto-grab / scan_editable_summary must inventory 处理 as a button via L2."""
    scan = (ROOT / "scripts/controller/actions/js_snippets/scan_form.py").read_text(
        encoding="utf-8"
    )
    assert_true(".todo-item-action" in scan, "scan must mention .todo-item-action")
    assert_true("collectL2" in scan and ".todo-item-action" in scan, "L2 admits todo-item-action")


def test_assign_region_knows_todo_item() -> None:
    helpers = (ROOT / "src/cdp/page-locator-helpers.js").read_text(encoding="utf-8")
    body = helpers.split("function assignRegion", 1)[1][:3500]
    assert_true(".todo-item" in body, "assignRegion must partition .todo-item cards")
    assert_true("业务主键" in body or "header_title" in body or "todo-item__header" in body,
                "todo region extracts card header / 业务主键")
    assert_true("human" in body or "Chinese" in body or "bizKey" in body,
                "todo region prefers human title over bare biz key")


def test_l1_partitions_todo_item_via_assign_region() -> None:
    """Each card is its own region (业务主键 / title), not dumped into main."""
    helpers = (ROOT / "src/cdp/page-locator-helpers.js").read_text(encoding="utf-8")
    assert_true("function assignRegion" in helpers, "assignRegion exists")
    body = helpers.split("function assignRegion", 1)[1][:3000]
    assert_true(".todo-item" in body, "assignRegion knows .todo-item")
    scan = (ROOT / "scripts/controller/actions/js_snippets/scan_form.py").read_text(
        encoding="utf-8"
    )
    assert_true("assignRegion(" in scan, "scan stamps regions via assignRegion")


def test_xpath_smart_leaf_for_todo_item_action() -> None:
    helpers = (ROOT / "src/cdp/page-locator-helpers.js").read_text(encoding="utf-8")
    assert_true(
        "todo-item-action" in helpers,
        "page-locator-helpers must know todo-item-action",
    )
    # Must not force button[normalize-space] for these divs
    assert_true(
        "classTokenPred('todo-item-action')" in helpers
        or 'classTokenPred("todo-item-action")' in helpers
        or "todo-item-action" in helpers.split("function xpathSmartOf", 1)[-1][:2500],
        "xpathSmartOf must emit class-based leaf for todo-item-action",
    )


def test_resolve_by_label_includes_todo_item_action() -> None:
    resolve = (ROOT / "src/cdp/resolve-by-label.js").read_text(encoding="utf-8")
    assert_true(
        ".todo-item-action" in resolve,
        "resolve-element auto-grab must include .todo-item-action",
    )


def test_fullpage_l1_includes_todo_item_region() -> None:
    scan = (ROOT / "scripts/controller/actions/js_snippets/scan_form.py").read_text(
        encoding="utf-8"
    )
    assert_true(
        "{ sel: '.todo-item', role: 'section' }" in scan
        or '{ sel: ".todo-item", role: "section" }' in scan,
        "fullpage L1 candSels must include .todo-item cards",
    )
    assert_true(
        "todo-item-action').length" in scan
        or "todo-item-action\").length" in scan
        or ".todo-item-action').length" in scan,
        "L1 childHint buttons count includes todo-item-action",
    )


def test_normalize_target_root_prefers_todo_action_over_checkbox_group() -> None:
    """Portal 待办 list wraps cards in el-checkbox-group — must not steal host."""
    helpers = (ROOT / "src/cdp/page-locator-helpers.js").read_text(encoding="utf-8")
    body = helpers.split("function normalizeTargetRoot", 1)[1].split(
        "function detectTargetKind", 1
    )[0]
    todo_i = body.find("closest('.todo-item-action')")
    if todo_i < 0:
        todo_i = body.find('closest(".todo-item-action")')
    cb_i = body.find(".el-checkbox-group")
    assert_true(todo_i != -1, "normalizeTargetRoot must closest('.todo-item-action')")
    assert_true(cb_i != -1, "normalizeTargetRoot still knows checkbox-group")
    assert_true(
        todo_i < cb_i,
        "todo-item-action must be resolved BEFORE el-checkbox-group "
        "(else xpath becomes //div[@aria-label='checkbox-group'] → false ok-xpath-smart)",
    )


def test_inventory_kind_todo_action_not_form_checkbox() -> None:
    """待办 list 在 el-checkbox-group 内时，处理 must stay button kind for auto-grab."""
    helpers = (ROOT / "src/cdp/page-locator-helpers.js").read_text(encoding="utf-8")
    body = helpers.split("function inventoryKindOf", 1)[1].split(
        "function inventoryPickControl", 1
    )[0]
    todo_i = body.find("closest('.todo-item-action')")
    if todo_i < 0:
        todo_i = body.find('closest(".todo-item-action")')
    cb_i = body.find("closest('.el-checkbox-group")
    if cb_i < 0:
        cb_i = body.find('closest(".el-checkbox-group')
    assert_true(todo_i != -1, "inventoryKindOf must special-case todo-item-action")
    assert_true(cb_i != -1, "inventoryKindOf still classifies form checkbox-group")
    assert_true(
        todo_i < cb_i,
        "todo-item-action kind check must run BEFORE el-checkbox-group "
        "(else kind=form_checkbox → filtered out of click_element inventory)",
    )


def test_inventory_collects_todo_item_action() -> None:
    helpers = (ROOT / "src/cdp/page-locator-helpers.js").read_text(encoding="utf-8")
    body = helpers.split("function collectL2Hosts", 1)[1][:1200]
    assert_true(
        ".todo-item-action" in body,
        "auto-grab inventory must query .todo-item-action (处理)",
    )


def test_checkbox_group_wrap_snap_and_durable_click() -> None:
    """Runtime: snap must keep todo-item-action; durable must not false-ok on group xpath."""
    from playwright.sync_api import sync_playwright
    from scripts.controller.actions.js_snippets._locator_helpers_js import (
        PAGE_LOCATOR_HELPERS,
    )
    from scripts.controller.actions.replay_js import _JS_CLICK_DURABLE

    html = """<!DOCTYPE html><html><body>
<div class="el-checkbox-group" aria-label="checkbox-group">
  <div class="todo-item">
    <div class="todo-item__header">PJ20260807012042 评级
      <div class="todo-item-actions">
        <div class="todo-item-action" id="act" style="cursor:pointer">处理</div>
      </div>
    </div>
  </div>
</div>
<script>
window.__clicked=[];
document.getElementById('act').addEventListener('click',()=>window.__clicked.push('act'));
document.querySelector('.el-checkbox-group').addEventListener('click',(e)=>{
  if (e.target===document.querySelector('.el-checkbox-group')) window.__clicked.push('group');
});
</script>
</body></html>"""

    snap_js = (
        "() => {\n"
        + PAGE_LOCATOR_HELPERS
        + """
  const el = document.getElementById('act');
  const host = normalizeTargetRoot(el);
  const abs = absXPath(host);
  const loc = buildLocatorSnap(host, '处理', abs, '', { targetKind: 'button' });
  return {
    hostClass: String(host && host.className || ''),
    hostId: host && host.id,
    xpath_smart: loc.xpath_smart || '',
  };
}
"""
    )

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        page.set_content(html)
        snap = page.evaluate(snap_js)
        assert_true(
            snap.get("hostId") == "act" or "todo-item-action" in str(snap.get("hostClass")),
            f"host must stay todo-item-action, got {snap!r}",
        )
        smart = str(snap.get("xpath_smart") or "")
        assert_true(
            "checkbox-group" not in smart,
            f"xpath_smart must not be checkbox-group aria, got {smart!r}",
        )
        assert_true(
            "todo-item-action" in smart
            or "处理" in smart
            or "id='act'" in smart
            or 'id="act"' in smart
            or "@id=" in smart,
            f"xpath_smart should target the action host, got {smart!r}",
        )

        # Bad recorded xpath (regression): must NOT report ok-xpath-smart on the group
        page.evaluate("() => { window.__clicked = []; }")
        how = page.evaluate(
            _JS_CLICK_DURABLE,
            ["处理", "", "", "//div[@aria-label='checkbox-group']", {"parentText": "PJ20260807012042"}],
        )
        clicked = page.evaluate("() => window.__clicked.slice()")
        assert_true(
            how in ("ok-todo-action-scoped", "ok-todo-action", "ok-text-exact")
            or (isinstance(how, str) and how.startswith("ok") and "xpath-smart" not in how),
            f"must not false-ok via checkbox-group xpath_smart, how={how!r} clicked={clicked!r}",
        )
        assert_true(
            "act" in clicked,
            f"must click todo action, got how={how!r} clicked={clicked!r}",
        )

        # Auto-grab inventory: kind must be button (not form_checkbox) so click_element keeps it
        inv = page.evaluate(
            "() => {\n"
            + PAGE_LOCATOR_HELPERS
            + """
  const hosts = collectInventoryHosts();
  const hit = hosts.find(function (h) {
    return h && h.el && h.el.id === 'act';
  });
  const kinds = kindsForAction('click_element_by_index');
  return {
    found: !!hit,
    kind: hit && hit.kind,
    text: hit && hit.text,
    allowed: !!(hit && kinds && kinds[hit.kind]),
  };
}
"""
        )
        assert_true(inv.get("found"), f"inventory must include todo action, got {inv!r}")
        assert_true(
            inv.get("kind") == "button",
            f"inventory kind must be button (not form_checkbox), got {inv!r}",
        )
        assert_true(
            inv.get("allowed") is True,
            f"click_element inventory filter must keep 处理, got {inv!r}",
        )
        assert_true(
            "处理" in str(inv.get("text") or ""),
            f"inventory text must be 处理, got {inv!r}",
        )
        browser.close()


def main() -> int:
    test_manual_recorder_emits_todo_item_action()
    test_mapper_keeps_parent_text_on_click()
    test_replay_durable_includes_todo_item_action()
    test_scan_admits_todo_item_action_buttons()
    test_assign_region_knows_todo_item()
    test_l1_partitions_todo_item_via_assign_region()
    test_xpath_smart_leaf_for_todo_item_action()
    test_resolve_by_label_includes_todo_item_action()
    test_fullpage_l1_includes_todo_item_region()
    test_normalize_target_root_prefers_todo_action_over_checkbox_group()
    test_inventory_collects_todo_item_action()
    test_inventory_kind_todo_action_not_form_checkbox()
    test_checkbox_group_wrap_snap_and_durable_click()
    print("characterize-todo-item-action: OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
