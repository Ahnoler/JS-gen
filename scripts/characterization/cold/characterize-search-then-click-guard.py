"""Pin search_then_click_guard: visible search → block locate until phase query done."""
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT))

def main() -> int:
    path = ROOT / "scripts/controller/actions/search_then_click_guard.py"
    if not path.is_file():
        print("FAIL: missing search_then_click_guard.py")
        return 1
    from scripts.controller.actions.search_then_click_guard import (
        SearchUiSnapshot,
        should_block_locate,
        build_err_search_first,
        is_search_field_label,
        mark_search_filled,
        mark_query_clicked,
        clear_stc_flags,
        detect_search_ui,
        xpath_is_tree_node,
        guard_locate_or_err,
        STC_SEARCH_FILLED,
        STC_QUERY_CLICKED,
    )
    for name, fn in (
        ("detect_search_ui", detect_search_ui),
        ("xpath_is_tree_node", xpath_is_tree_node),
        ("guard_locate_or_err", guard_locate_or_err),
    ):
        if not callable(fn):
            print(f"FAIL: missing async helper {name}")
            return 1
    err = build_err_search_first("need-fill")
    if not err.startswith("err-search-first:"):
        print(f"FAIL: bad err prefix {err!r}")
        return 1
    # no search → never block
    block, _ = should_block_locate(
        snapshot=SearchUiSnapshot(has_search_input=False, has_query_button=False),
        search_filled=False, query_clicked=False,
    )
    if block:
        print("FAIL: blocked with no search UI")
        return 1
    # search input only → need fill
    block, why = should_block_locate(
        snapshot=SearchUiSnapshot(has_search_input=True, has_query_button=False),
        search_filled=False, query_clicked=False,
    )
    if not block or why != "need-fill-search":
        print(f"FAIL: expected block need-fill-search, got {block!r} {why!r}")
        return 1
    block2, _ = should_block_locate(
        snapshot=SearchUiSnapshot(has_search_input=True, has_query_button=False),
        search_filled=True, query_clicked=False,
    )
    if block2:
        print("FAIL: should allow after fill when no query button")
        return 1
    # query button → need click even if filled
    block3, why3 = should_block_locate(
        snapshot=SearchUiSnapshot(has_search_input=True, has_query_button=True),
        search_filled=True, query_clicked=False,
    )
    if not block3 or why3 != "need-query-click":
        print(f"FAIL: expected need-query-click, got {block3!r} {why3!r}")
        return 1
    block4, _ = should_block_locate(
        snapshot=SearchUiSnapshot(has_search_input=True, has_query_button=True),
        search_filled=True, query_clicked=True,
    )
    if block4:
        print("FAIL: should allow after fill+query")
        return 1
    if not is_search_field_label("搜索关键字"):
        print("FAIL: is_search_field_label")
        return 1
    store = {}
    mark_search_filled(store)
    mark_query_clicked(store)
    if not store.get(STC_SEARCH_FILLED) or not store.get(STC_QUERY_CLICKED):
        print("FAIL: mark helpers")
        return 1
    clear_stc_flags(store)
    if store.get(STC_SEARCH_FILLED) or store.get(STC_QUERY_CLICKED):
        print("FAIL: clear_stc_flags")
        return 1
    intent_path = ROOT / "scripts/controller/actions/phase/intent_contract.py"
    intent_src = intent_path.read_text(encoding="utf-8")
    if "_stc_search_filled" not in intent_src and "clear_stc_flags" not in intent_src:
        print("FAIL: intent_contract missing stc clear wiring")
        return 1
    table_src = (ROOT / "scripts/controller/actions/_table.py").read_text(encoding="utf-8")
    misc_src = (ROOT / "scripts/controller/actions/_misc.py").read_text(encoding="utf-8")
    if "guard_locate_or_err" not in table_src:
        print("FAIL: _table.py missing guard_locate_or_err wiring")
        return 1
    if table_src.count("guard_locate_or_err") < 2:
        print("FAIL: _table.py must gate click_table_row_radio and click_table_row_button")
        return 1
    if "guard_locate_or_err" not in misc_src or "xpath_is_tree_node" not in misc_src:
        print("FAIL: _misc.py missing tree search-then-click gate wiring")
        return 1
    print("OK search-then-click-guard")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
