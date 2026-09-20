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
        mark_stc_flags_on_replay_ok,
        stc_satisfied,
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
    # Replay-side STC marking: deterministic replay must mark the same flags on the
    # shared store, otherwise the guard falsely blocks post-query row/tree clicks.
    rstore = {}
    mark_stc_flags_on_replay_ok(
        'fill_form_field', {'label_text': '搜索关键字'}, None, rstore)
    if not rstore.get(STC_SEARCH_FILLED):
        print("FAIL: replay fill on search label must mark search_filled")
        return 1
    mark_stc_flags_on_replay_ok(
        'click_button', {'button_text': '查询'}, None, rstore)
    if not rstore.get(STC_QUERY_CLICKED):
        print("FAIL: replay click 查询 must mark query_clicked")
        return 1
    block5, _ = should_block_locate(
        snapshot=SearchUiSnapshot(has_search_input=True, has_query_button=True),
        search_filled=bool(rstore.get(STC_SEARCH_FILLED)),
        query_clicked=bool(rstore.get(STC_QUERY_CLICKED)),
    )
    if block5:
        print("FAIL: replay fill+query marks must unblock the guard")
        return 1
    # Non-search labels/clicks must NOT mark (guard hint stays truthful).
    nstore = {}
    mark_stc_flags_on_replay_ok(
        'fill_form_field', {'label_text': '客户名称'}, None, nstore)
    mark_stc_flags_on_replay_ok(
        'click_button', {'button_text': '保存'}, None, nstore)
    mark_stc_flags_on_replay_ok('click_menu_item', {'menu_text': '查询'}, None, nstore)
    if nstore.get(STC_SEARCH_FILLED) or nstore.get(STC_QUERY_CLICKED):
        print("FAIL: non-search/unrelated actions must not mark STC flags")
        return 1
    # Element-dict placeholder fallback (search boxes often lack label_text).
    pstore = {}
    mark_stc_flags_on_replay_ok(
        'fill_form_field', {'label_text': '', 'value': 'x'},
        {'element': {'attributes': {'placeholder': '搜索关键字'}}}, pstore)
    if not pstore.get(STC_SEARCH_FILLED):
        print("FAIL: element placeholder fallback must mark search_filled")
        return 1
    intent_path = ROOT / "scripts/controller/actions/phase/intent_contract.py"
    intent_src = intent_path.read_text(encoding="utf-8")
    if "_stc_search_filled" not in intent_src and "clear_stc_flags" not in intent_src:
        print("FAIL: intent_contract missing stc clear wiring")
        return 1
    table_src = (ROOT / "scripts/controller/actions/_table.py").read_text(encoding="utf-8")
    engine_src = (
        ROOT / "scripts/controller/actions/click_action_engine.py"
    ).read_text(encoding="utf-8")
    misc_src = (ROOT / "scripts/controller/actions/_misc.py").read_text(encoding="utf-8")
    click_src = engine_src + misc_src
    if "guard_locate_or_err" not in table_src:
        print("FAIL: _table.py missing guard_locate_or_err wiring")
        return 1
    if table_src.count("guard_locate_or_err") < 2:
        print("FAIL: _table.py must gate click_table_row_radio and click_table_row_button")
        return 1
    if "guard_locate_or_err" not in click_src or "xpath_is_tree_node" not in click_src:
        print("FAIL: ClickEngine/_misc missing tree search-then-click gate wiring")
        return 1
    if "guard_locate_or_err" not in engine_src or "xpath_is_tree_node" not in engine_src:
        print("FAIL: click_action_engine.py missing tree search-then-click gate wiring")
        return 1
    replay_src = (ROOT / "scripts/controller/actions/_replay.py").read_text(encoding="utf-8")
    if "mark_stc_flags_on_replay_ok" not in replay_src:
        print("FAIL: _replay.py missing replay-side STC marking wiring")
        return 1
    # Record/replay symmetry: index-click on「查询」must mark query_clicked exactly
    # like click_button. Without it the guard deadlocks for the whole phase
    # (err-search-first:need-fill-and-query) → the phase fails → its leftover
    # actions get re-done and recorded under the NEXT phase.
    if "mark_query_clicked" not in engine_src:
        print("FAIL: click_action_engine.py must mark query_clicked on index-click 查询")
        return 1
    if "re.sub(r'\\s+', '', btn_label) == '查询'" not in engine_src:
        print("FAIL: index-click 查询 marking must be keyed on the normalized label")
        return 1
    # el-select trigger (closed dropdown) = transient open click: it must NOT be
    # recorded (junk 点击元素 whose text is the hidden option labels), must not be
    # remembered as a phase operation, and must not become the picker trigger button.
    if "kind: 'trigger'" not in engine_src:
        print("FAIL: click_action_engine.py missing el-select trigger surface classification")
        return 1
    if "'table-row' : (inItem ? 'option' : 'dropdown')" not in engine_src:
        print("FAIL: dropdown-surface kinds (table-row/option/dropdown) must stay blocked")
        return 1
    if "elif not select_trigger_click:" not in engine_src:
        print("FAIL: plain click_element_by_index record must be skipped for select triggers")
        return 1
    if "if not date_panel_click and not select_trigger_click:" not in engine_src:
        print("FAIL: select trigger click must not be remembered as a phase operation")
        return 1
    if engine_src.count("if not select_trigger_click:") < 2:
        print("FAIL: select trigger click must also be skipped for remember_trigger_button")
        return 1
    if "transient-select-open" not in engine_src:
        print("FAIL: suppressed trigger click must surface a transient-select-open hint")
        return 1
    if ".el-tree-node, .tree-popover" not in engine_src:
        print("FAIL: trigger classification must exclude nested tree/popover popper contents")
        return 1
    # stc_satisfied: has UI + not blocked
    snap_q = SearchUiSnapshot(has_search_input=True, has_query_button=True)
    if stc_satisfied({STC_QUERY_CLICKED: True}, snap_q) is not True:
        print("FAIL: stc_satisfied should be True after query click")
        return 1
    if stc_satisfied({}, snap_q) is not False:
        print("FAIL: stc_satisfied should be False before query")
        return 1
    snap_none = SearchUiSnapshot(has_search_input=False, has_query_button=False)
    if stc_satisfied({STC_QUERY_CLICKED: True}, snap_none) is not False:
        print("FAIL: no search UI → stc_satisfied False even if flags set")
        return 1
    # Task 3: STC-satisfied click_table_row_radio → first row + structural xpath
    if "stc_satisfied" not in table_src:
        print("FAIL: _table.py must use stc_satisfied for first-row record path")
        return 1
    if (
        "'row_text': 'first'" not in table_src
        and '"row_text": "first"' not in table_src
    ):
        print("FAIL: _table.py must record row_text=first when STC satisfied")
        return 1
    if (
        "_structural_first_row_radio_xpath" not in table_src
        and "el-table__body-wrapper" not in table_src
    ):
        print("FAIL: _table.py missing structural first-row xpath in STC branch")
        return 1
    if "stc-query-anchor" not in table_src and "query-button container anchor" not in table_src.lower():
        print("FAIL: _table.py missing TODO for query-button container anchor (§7.1)")
        return 1
    if "stc-query-anchor" not in engine_src and "query-button container anchor" not in engine_src.lower():
        print("FAIL: click_action_engine.py missing TODO near mark_query_clicked (§7.1)")
        return 1
    # Task 6: STC-satisfied tree click → first-leaf structural xpath
    if "stc_satisfied" not in engine_src:
        print("FAIL: click_action_engine.py must use stc_satisfied for first-leaf record path")
        return 1
    if (
        "_structural_first_leaf_tree_xpath" not in engine_src
        and "is-leaf" not in engine_src
    ):
        print("FAIL: click_action_engine.py missing structural first-leaf xpath in STC branch")
        return 1
    # Index-click → click_table_row_radio record override must also STC→first
    if "is_table_row_radio" not in engine_src:
        print("FAIL: click_action_engine.py must detect table row radio for record override")
        return 1
    if "record_row = 'first'" not in engine_src and "record_row='first'" not in engine_src:
        print("FAIL: index→table radio path must set record_row=first when STC satisfied")
        return 1
    if "_structural_first_row_radio_xpath" not in engine_src:
        print("FAIL: index→table radio STC path missing structural first-row xpath helper")
        return 1
    # Index-click on a table radio must hard-block before the DOM click, same as
    # click_table_row_radio. Record-override alone still persists a business key
    # when the agent clicks the row before 查询 (traj 905/907).
    guard_marker = "Table-radio index clicks share the dedicated action's STC hard guard"
    guard_at = engine_src.find(guard_marker)
    click_at = engine_src.find("await self.browser_context._click_element_node")
    if guard_at < 0 or click_at < 0 or guard_at > click_at:
        print("FAIL: table-radio index STC guard must run before _click_element_node")
        return 1
    guard_window = engine_src[guard_at:click_at]
    if "guard_locate_or_err" not in guard_window:
        print("FAIL: table-radio index path must call guard_locate_or_err before click")
        return 1
    if "table_radio_info.get('isRadio')" not in guard_window:
        print("FAIL: table-radio index STC guard must key off pre-click isRadio")
        return 1
    if (
        "'option_text': 'first'" not in engine_src
        and '"option_text": "first"' not in engine_src
        and "record_opt = 'first'" not in engine_src
    ):
        print("FAIL: click_action_engine.py must record option_text=first when STC satisfied")
        return 1
    if (
        "'text': 'first'" not in engine_src
        and '"text": "first"' not in engine_src
        and "record_text = 'first'" not in engine_src
    ):
        print("FAIL: click_action_engine.py must record text=first for generic tree STC clicks")
        return 1
    # Task 4: replay_table prefers structural xpath before semantic row_text
    replay_table_path = ROOT / "scripts/controller/actions/replay_table.py"
    replay_table_src = replay_table_path.read_text(encoding="utf-8")
    if "locate=xpath-first" not in replay_table_src:
        print("FAIL: replay_table.py missing locate=xpath-first marker (spec §6)")
        return 1
    click_idx = replay_table_src.find("await _replay_click_by_index")
    semantic_call_idx = replay_table_src.find("await _replay_controller_action(act")
    if click_idx < 0 or semantic_call_idx < 0 or click_idx > semantic_call_idx:
        print("FAIL: replay_table.py must call durable/xpath before semantic when smart xpath present")
        return 1
    print("OK search-then-click-guard")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
