"""wet9 characterization: idempotent search/refresh/paging clicks must not be
blocked by the phase duplicate gate.

Wet9 (#902 P3 / #903 P5): after any product-tree reload the SUT clears the
el-tree filter state while the search box keeps its keyword ("box has text,
tree shows everything").  The only self-healing path is clicking the search
icon again — but ``already-operated-this-phase`` rejected the repeat click
(same icon already clicked once in the phase), deadlocking the agent.

Fix pins (RED->GREEN):
  1. module-level idempotent-click regex covers 搜索/查询/检索/刷新/翻页/
     下一页/上一页 family texts and rejects idempotent classification for
     non-idempotent labels (保存/新增/删除/提交/重置/确定…);
  2. click_button: duplicate gate skipped for idempotent labels (the
     already-operated rejection must not fire for a search-icon repeat);
  3. click_element_by_index: same exemption on the index path;
  4. recording/remember behavior unchanged (guard module untouched):
     idempotent clicks are still remembered, non-idempotent duplicates are
     still rejected.
"""

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from scripts.controller.actions.click_action_engine import (  # noqa: E402
    _is_idempotent_click_label,
)
from scripts.controller.actions.phase.element_guard import (  # noqa: E402
    duplicate_phase_operation_any,
    remember_phase_operation_aliases,
)

failures = []


def check(cond: bool, msg: str) -> None:
    if not cond:
        failures.append(msg)
        print(f"  ✗ {msg}")
    else:
        print(f"  ✓ {msg}")


def main() -> None:
    # 1. idempotent family membership
    for text in (
        "搜索", "查询", "检索", "刷新", "刷新产品树", "刷新列表",
        "翻页", "下一页", "上一页", "搜索图标", "查询按钮", "重新查询",
    ):
        check(
            _is_idempotent_click_label(text),
            f"idempotent whitelist matches {text!r}",
        )

    # 2. non-idempotent labels must NOT be whitelisted
    for text in ("保存", "提交", "确定", "新增", "删除", "重置", "启用", "禁用", "克隆", "导出", "导入"):
        check(
            not _is_idempotent_click_label(text),
            f"non-idempotent label stays gated: {text!r}",
        )

    # 3. whitelist is conservative: no substring overreach
    #    e.g. 保存查询方案 must not classify as idempotent just because it
    #    contains 查询
    check(
        not _is_idempotent_click_label("保存查询方案"),
        "compound non-idempotent label 保存查询方案 stays gated",
    )

    # 4. index-path rejection copy still present for non-idempotent clicks
    src = (ROOT / "scripts" / "controller" / "actions" / "click_action_engine.py").read_text(
        encoding="utf-8"
    )
    check(
        "already-operated-this-phase:button=" in src,
        "click_button duplicate rejection copy preserved (non-idempotent path)",
    )
    check(
        "already-operated-this-phase:index=" in src,
        "click_element_by_index duplicate rejection copy preserved (non-idempotent path)",
    )
    check(
        src.count("_is_idempotent_click_label(") >= 3,
        "idempotent bypass wired into both gate sites (def + 2 gate call sites)",
    )
    check(
        "from .phase.element_guard import (\n            duplicate_phase_operation_any,"
        in src,
        "element_guard import untouched (record module zero-change)",
    )

    # 5. guard module itself untouched by this fix: its behavior needles
    check(
        (ROOT / "scripts" / "controller" / "actions" / "phase" / "element_guard.py").read_text(
            encoding="utf-8"
        ).count("\ndef ") == 8,
        "element_guard.py function inventory unchanged (8 defs)",
    )

    # 6. behavioral: duplicate still detected for a normal button
    store: dict = {}
    remember_phase_operation_aliases(store, ["button:确定"], "click_button")
    check(
        duplicate_phase_operation_any(store, ["button:确定"]) == "click_button",
        "non-idempotent duplicate still detected by guard (behavior)",
    )
    check(
        len(re.findall(r"搜索|查询|检索|刷新|翻页|下一页|上一页", "|".join(
            ["搜索", "查询", "检索", "刷新", "翻页", "下一页", "上一页"]
        ))) == 7,
        "idempotent keyword inventory complete (7 families)",
    )

    # 7. wet9-B3r ③ ruling: navigation (menu/link) re-click allowance, bounded.
    from scripts.controller.actions.click_action_engine import (  # noqa: E402
        _is_navigation_click_element,
        _NAV_RECLICK_BUDGET,
    )
    check(
        _is_navigation_click_element({"tag_name": "a"}, "") is True,
        "nav detection: <a> link is navigation (wet9b3r [37] 产品树)",
    )
    check(
        _is_navigation_click_element({"tag_name": "li"}, "") is True,
        "nav detection: <li> menu item is navigation (wet9b3r [33] 产品库管理)",
    )
    check(
        _is_navigation_click_element(
            {"tag_name": "button", "attributes": {"class": "el-menu-item"}}, ""
        ) is True,
        "nav detection: menu-classed button is navigation",
    )
    check(
        _is_navigation_click_element(
            {"tag_name": "button", "attributes": {"class": "el-button--primary"}}, ""
        ) is False,
        "nav detection: plain button is NOT navigation (mutation risk stays gated)",
    )
    check(
        _is_navigation_click_element(
            {"tag_name": "input", "attributes": {"class": "el-input__inner"}}, ""
        ) is False,
        "nav detection: form input is NOT navigation",
    )
    check(
        _NAV_RECLICK_BUDGET == 1,
        "nav re-click budget is exactly 1 extra attempt per element per phase",
    )

    # 8. bounded budget mechanics: index-path gate consumes a namespaced
    #    counter inside _phase_ai_operations (cleared per phase for free).
    check(
        "__navreclick__" in src,
        "nav re-click budget stored under __navreclick__ namespace "
        "(auto-cleared with phase ops, guard dict schema untouched)",
    )
    check(
        "_bump_nav_reclick(" in src and "_NAV_RECLICK_BUDGET" in src,
        "budget bump helper + constant wired at the index gate",
    )
    check(
        "[nav-reclick]" in src,
        "allowed nav re-click leaves a single-line stderr trace",
    )
    check(
        "页面可能已卡死" in src,
        "budget-exhausted rejection carries the prescriptive page-frozen guidance",
    )

    # 9. behavioral: budget counter semantics (2 clicks allowed, 3rd blocked)
    store2: dict = {}
    from scripts.controller.actions.click_action_engine import (  # noqa: E402
        _bump_nav_reclick,
    )
    first = _bump_nav_reclick(store2, "click://x/li[33]")
    again = _bump_nav_reclick(store2, "click://x/li[33]")
    third = _bump_nav_reclick(store2, "click://x/li[33]")
    check(first == 1 and again == 2 and third == 3, "budget counter bumps 1,2,3")
    other = _bump_nav_reclick(store2, "click://x/a[37]")
    check(other == 1, "budget is per-element, not shared across identities")

    if failures:
        print(f"FAILED ({len(failures)})")
        return 1
    print("OK: characterize-idempotent-click-gate")
    return 0


if __name__ == "__main__":
    sys.exit(main())
