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
        STC_SEARCH_FILLED,
        STC_QUERY_CLICKED,
    )
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
    print("OK search-then-click-guard")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
