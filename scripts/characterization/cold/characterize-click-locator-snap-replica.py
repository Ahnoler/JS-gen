#!/usr/bin/env python3
"""Needle-style pin: locator-snapshot-at-click-hit-time pattern replicated to
the four sibling click chains (switch_tab / click_menu_item / close_dialog /
click_table_row_button / click_table_row_radio) + shared leaf module.

NO browser — pure source-substring/structure assertions (runs in verify-all).

Pins (mirror of the shipped icons.py more-btn fix, jsgen-forensic-fake 根因):
  1. Shared leaf module scripts/controller/actions/click_locator_tail.py:
     defines LOCATOR_TAIL_SEP / click_locator_tail / apply_click_locator_snapshot /
     split_locator_tail; imports ONLY stdlib + ._helpers (leaf constraint);
     click_action_engine re-exports the three legacy aliases and no longer
     duplicates the logic.
  2. Per-function JS: PAGE_LOCATOR_HELPERS joined, snapLocator/LOC_SEP present,
     tail appended at every success-click branch, and in every branch the
     snapshot line PRECEDES the click line (snapshot-before-fire is the
     load-bearing property — post-click sampling hits Vue-rebuilt nodes).
  3. Python wiring: apply_click_locator_snapshot called before _record_action
     in each chain; ' | loc:' suffix appends operate on the tail-stripped head;
     radio '|scope=' extraction runs on the head after tail-strip; force_first
     synthesized path passes the raw result through the merge (row_text='first'
     and target_kind stay durable).
  4. Registration: characterize-click-locator-snap-replica listed in BOTH
     PINS_CLICK and PINS_CORE of scripts/refactor/verify-all.sh (--changed
     maps _misc/_table/_navigation to core, so core registration makes it
     reachable; click domain is the semantic home).
"""
from __future__ import annotations

import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(
    os.path.abspath(__file__)))))
sys.path.insert(0, ROOT)

FAILURES: list[str] = []


def _read(relpath: str) -> str:
    with open(os.path.join(ROOT, relpath), 'r', encoding='utf-8') as f:
        return f.read()


def _check(cond: bool, msg: str) -> None:
    if not cond:
        FAILURES.append(msg)
        print('FAIL:', msg)


def _ordering(text: str, snapshot_needle: str, click_needle: str, label: str,
              start: int = 0, end: int | None = None) -> None:
    """Assert the snapshot line appears BEFORE the click line within [start, end)."""
    seg = text[start:end if end is not None else len(text)]
    si = seg.find(snapshot_needle)
    ci = seg.find(click_needle)
    _check(si >= 0, f'{label}: snapshot needle missing: {snapshot_needle!r}')
    _check(ci >= 0, f'{label}: click needle missing: {click_needle!r}')
    if si >= 0 and ci >= 0:
        _check(si < ci, f'{label}: snapshot must precede click '
                        f'(snap@{si} >= click@{ci})')


def main() -> int:
    # ── 1. Shared leaf module ────────────────────────────────────────────
    tail_path = 'scripts/controller/actions/click_locator_tail.py'
    tail_src = _read(tail_path)
    for name in ('LOCATOR_TAIL_SEP', 'click_locator_tail',
                 'apply_click_locator_snapshot', 'split_locator_tail'):
        _check(f'def {name}' in tail_src or f'{name} = ' in tail_src,
               f'{tail_path} defines {name}')
    _check("LOCATOR_TAIL_SEP = '␟'" in tail_src,
           'shared module pins U+241F LOCATOR_TAIL_SEP')
    # Leaf constraint: only stdlib + ._helpers imports.
    import_lines = [ln.strip() for ln in tail_src.splitlines()
                    if ln.startswith('import ') or ln.startswith('from ')]
    for ln in import_lines:
        _check(
            ln in ('import json', 'from ._helpers import _element_info_from_locate'),
            f'click_locator_tail stays a leaf: unexpected import {ln!r}',
        )
    _check(any('import json' in ln for ln in import_lines),
           'click_locator_tail imports json (stdlib)')

    engine_src = _read('scripts/controller/actions/click_action_engine.py')
    # Alias import present (legacy import path keeps working —
    # characterize-icon-buttons.py imports _apply_click_locator_snapshot from
    # click_action_engine).
    _check(
        'from .click_locator_tail import (' in engine_src
        and 'LOCATOR_TAIL_SEP as _CLICK_LOCATOR_TAIL_SEP' in engine_src
        and 'click_locator_tail as _click_locator_tail' in engine_src
        and 'apply_click_locator_snapshot as _apply_click_locator_snapshot' in engine_src,
        'click_action_engine re-exports the three legacy aliases',
    )
    # Logic no longer duplicated in the engine: the old def bodies are gone.
    _check('def _click_locator_tail(' not in engine_src,
           'engine no longer defines _click_locator_tail')
    _check('def _apply_click_locator_snapshot(' not in engine_src,
           'engine no longer defines _apply_click_locator_snapshot')
    _check("_CLICK_LOCATOR_TAIL_SEP = '␟'" not in engine_src,
           'engine no longer re-declares the separator constant')

    # ── 2+3. Per-function JS structure + Python wiring ──────────────────
    nav_src = _read('scripts/controller/actions/_navigation.py')
    misc_src = _read('scripts/controller/actions/_misc.py')
    table_src = _read('scripts/controller/actions/_table.py')

    JS_HELP = 'PAGE_LOCATOR_HELPERS'
    SNAP = 'snapLocator('

    # ── switch_tab ──
    _check(JS_HELP + " + '''" in nav_src or JS_HELP in nav_src,
           'switch_tab JS joins PAGE_LOCATOR_HELPERS')
    _check(nav_src.count("const LOC_SEP = '␟';") == 2,
           'switch_tab + click_menu_item both declare LOC_SEP (expect 2 in _navigation.py)')
    _check(nav_src.count(SNAP) == 3,
           f'switch_tab (1) + click_menu_item (directItem/target) snapshot at each '
           f'success branch (found {nav_src.count(SNAP)}, expect 3)')
    _ordering(nav_src, 'const tail = snapLocator(tab,', 'tab.click()',
              'switch_tab snapshot-before-click')
    _check("return 'ok' + tail;" in nav_src, 'switch_tab success returns ok+tail')
    # Python wiring: strip/merge BEFORE _record_action; persisted result = head.
    i_rec = nav_src.find("_record_action('switch_tab'")
    i_split = nav_src.find('split_locator_tail(result)')
    i_merge = nav_src.find('apply_click_locator_snapshot(result, element)')
    _check(i_split >= 0 and i_merge >= 0 and i_rec >= 0
           and i_split < i_rec and i_merge < i_rec,
           'switch_tab: split + snapshot-merge wired before _record_action')
    _check("_record_action('switch_tab', {'tab_name': tab_name}, head, element=element)"
           in nav_src, 'switch_tab persists head-only result')

    # ── click_menu_item ──
    _ordering(nav_src, 'const tail = snapLocator(directItem,', 'directItem.click()',
              'click_menu_item directItem snapshot-before-click')
    # Deferred-click branch: snapshot the resolved target BEFORE scheduling.
    i_snap = nav_src.find('const tail = snapLocator(target,')
    i_sched = nav_src.find('setTimeout(() => target.click(), 300)')
    _check(i_snap >= 0 and i_sched >= 0 and i_snap < i_sched,
           'click_menu_item ok-expanded: target snapshot precedes setTimeout schedule')
    _check("return 'ok-expanded' + tail;" in nav_src,
           'click_menu_item expanded branch returns ok-expanded+tail')
    # Intermediate submenu title.click() stays a bare success-less op (no tail).
    i_title_click = nav_src.find("title.click()")
    _check(i_title_click >= 0 and "snapLocator(title" not in nav_src,
           'click_menu_item: submenu title.click() carries no tail (not a success return)')
    i_rec2 = nav_src.find("_record_action('click_menu_item'")
    i_split2 = nav_src.find('split_locator_tail(result)', i_rec2 - 400 if i_rec2 > 400 else 0)
    i_merge2 = nav_src.find('apply_click_locator_snapshot(result, element)',
                            i_rec2 - 400 if i_rec2 > 400 else 0)
    _check(i_rec2 >= 0 and i_split2 >= 0 and i_merge2 >= 0
           and i_split2 < i_merge2 < i_rec2,
           'click_menu_item: split + snapshot-merge wired before _record_action')
    _check("_record_action('click_menu_item', {'menu_text': menu_text}, head, element=element)"
           in nav_src, 'click_menu_item persists head-only result')
    _check("head + ' | loc:menu:' + menu_text" in nav_src,
           'click_menu_item suffix appends on the tail-stripped head')

    # ── close_dialog ──
    _check('_PAGE_LOCATOR_HELPERS' in misc_src,
           'close_dialog region joins PAGE_LOCATOR_HELPERS (module alias)')
    # clickClose returns the selected btn (no click inside); three branches
    # snapshot btn then click it.
    _check('function clickClose(root, sels) {' in misc_src
           and 'return btn;' in misc_src
           and '{ btn.click(); return true; }' not in misc_src,
           'close_dialog clickClose returns the selected btn (click moved to caller)')
    for scope_sel in ('.el-dialog', '.el-drawer', '.el-message-box'):
        i_scope = misc_src.find(f"querySelectorAll('{scope_sel}')")
        i_sn = misc_src.find('snapLocator(btn', i_scope)
        i_ck = misc_src.find('btn.click()', i_scope)
        _check(i_scope >= 0 and i_sn >= 0 and i_ck >= 0 and i_sn < i_ck,
               f'close_dialog {scope_sel} branch: btn snapshot precedes click')
    _check(misc_src.count('snapLocator(btn') == 3,
           'close_dialog: exactly three btn snapshot sites (dialog/drawer/message-box)')
    i_rec3 = misc_src.find("_state._record_action('close_dialog'")
    i_split3 = misc_src.find('split_locator_tail(result)')
    i_merge3 = misc_src.find('apply_click_locator_snapshot(result, element)')
    _check(i_rec3 >= 0 and i_split3 >= 0 and i_merge3 >= 0
           and i_split3 < i_rec3 and i_merge3 < i_rec3,
           'close_dialog: split + snapshot-merge wired before _record_action')
    _check("_state._record_action('close_dialog', {}, head, element=element)" in misc_src,
           'close_dialog persists head-only result')
    _check('clear_trigger_button(business_data_store)' in misc_src,
           'close_dialog clear_trigger_button call preserved')
    _check('maybe_record_picker_closed(' in misc_src,
           'close_dialog maybe_record_picker_closed block preserved')

    # ── click_table_row_button ──
    _check(JS_HELP + " + '''" in table_src,
           'table row JS joins PAGE_LOCATOR_HELPERS')
    _check(table_src.count(SNAP) == 4,
           f'row_button (3) + row_radio (1 inside clickSel) — expect 4 snapLocator '
           f'call sites, found {table_src.count(SNAP)}')
    _ordering(table_src, 'const tail = snapLocator(btn,', 'btn.click()',
              'row_button btn snapshot-before-click')
    _ordering(table_src, 'const tail = snapLocator(editIcon,', 'editIcon.click()',
              'row_button editIcon snapshot-before-click')
    _ordering(table_src, 'const tail = snapLocator(delIcon,', 'delIcon.click()',
              'row_button delIcon snapshot-before-click')
    _check("return 'ok' + tail;" in table_src, 'row_button ok branch returns ok+tail')
    _check(table_src.count("return 'ok-icon' + tail;") == 2,
           'row_button both icon branches return ok-icon+tail')
    i_rec4 = table_src.find("_record_action(\n                'click_table_row_button'")
    i_split4 = table_src.find('split_locator_tail(result)', 0)
    i_merge4 = table_src.find('apply_click_locator_snapshot(result, element)')
    _check(i_rec4 >= 0 and i_split4 >= 0 and i_merge4 >= 0
           and i_split4 < i_rec4 and i_merge4 < i_rec4,
           'row_button: split + snapshot-merge wired before _record_action')
    _check("head + ' | loc:.el-table__row:has-text(\"' + row_text + '\")'" in table_src,
           'row_button suffix appends on the tail-stripped head')

    # ── click_table_row_radio ──
    i_clicksel = table_src.find('const clickSel = async (el) => {')
    i_target = table_src.find('const target = inner || el;', i_clicksel)
    i_snap5 = table_src.find('const tail = snapLocator(target, rowText);', i_clicksel)
    i_fire = table_src.find("fire('mousedown')", i_clicksel)
    _check(i_clicksel >= 0 and i_target >= 0 and i_snap5 >= 0 and i_fire >= 0
           and i_target < i_snap5 < i_fire,
           'row_radio clickSel: target chosen → snapshot BEFORE mousedown chain')
    _check("'ok|scope=' + scopeKind + (selTail || '')" in table_src,
           'row_radio single success return carries scope + tail')
    # scope extraction on the clean head AFTER tail-strip
    i_split6 = table_src.find('head, _ = split_locator_tail(result)')
    i_scope_x = table_src.find("if '|scope=' in head:")
    i_rec6 = table_src.find("_record_action(\n                'click_table_row_radio'")
    _check(i_split6 >= 0 and i_scope_x >= 0 and i_rec6 >= 0
           and i_split6 < i_scope_x < i_rec6,
           'row_radio: tail-strip first, |scope= extracted from clean head, before record')
    _check("if '|scope=' in result" not in table_src
           and "if '|scope=' in str(result)" not in table_src,
           'row_radio: |scope= extraction never reads the raw tailed result')
    # force_first path passes result through the merge (synthesized xpath_smart
    # overridden by the click-time snapshot).
    i_ff = table_src.find('if force_first:')
    i_merge6 = table_src.find('apply_click_locator_snapshot(result, element)', i_ff)
    _check(i_merge6 >= 0 and i_merge6 < i_rec6,
           'row_radio force_first: raw result passed through snapshot merge before record')
    _check("element['row_text'] = 'first'" in table_src,
           'row_radio force_first keeps row_text=first (search-then-click-guard pin)')
    _check("element['target_kind'] = 'table_row_radio'" in table_src,
           'row_radio force_first keeps durable target_kind after merge')
    _check("head + ' | loc:.el-table__row:has-text(\"' + loc_row + '\")'" in table_src,
           'row_radio suffix appends on the tail-stripped head')

    # ── 4. Registration in verify-all.sh ────────────────────────────────
    va_src = _read('scripts/refactor/verify-all.sh')
    i_click_dom = va_src.find("PINS_CLICK='" + '\n')
    i_core_dom = va_src.find("PINS_CORE='" + '\n')
    i_xpath_dom = va_src.find("PINS_XPATH='" + '\n')
    _check(va_src.count('characterize-click-locator-snap-replica|') == 2,
           'verify-all registers characterize-click-locator-snap-replica exactly twice '
           f'(found {va_src.count("characterize-click-locator-snap-replica|")})')
    _check(0 <= i_core_dom < i_click_dom < i_xpath_dom,
           'verify-all domain block order sanity (core < click < xpath)')
    _check(i_core_dom < va_src.find('characterize-click-locator-snap-replica|') < i_click_dom
           or i_click_dom < va_src.find('characterize-click-locator-snap-replica|') < i_xpath_dom,
           'registration sits inside a domain block (not trailing)')

    if FAILURES:
        print(f'FAILED ({len(FAILURES)})')
        return 1
    print('ok: characterize-click-locator-snap-replica '
          '(leaf module + 5-chain snap-before-click + python wiring + verify-all registration)')
    return 0


if __name__ == '__main__':
    sys.exit(main())
