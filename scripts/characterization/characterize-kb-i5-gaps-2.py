#!/usr/bin/env python3
"""Characterization pins: KB-I5 wet-test gap round 2 (N1 + N2 + N3).

read_text source-substring pins (same style as characterize-kb-i5-gaps.py /
characterize-click-scope-picker-login.py):

- N1 select_option filterable-typed fallback: form_action_engines.py must
  carry the filterable typing fallback (JS_SELECT_FILTERABLE_TYPED /
  ok-filterable-typed) AND keep the original option-not-found success/failure
  path strings (fuzzy match + err-select-option-unresolved) unchanged.
- N2 click_table_row_radio zero-row false positive: _table.py must contain
  the explicit err-no-row-match failure and the rowVisible filter, and keep
  the original hit-branch strings (ok / radio-not-found-in-row /
  err-table-row-not-found).
- N3 picker el-drawer support: js_snippets/picker_confirm.py findDialog must
  probe .el-dialog, .el-drawer (header title) and readUnderlyingForm must
  treat a visible drawer as an overlay; original dialog-not-found /
  refill-verify strings stay intact.
"""
from __future__ import annotations

import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, ROOT)

ENGINES = os.path.join(ROOT, "scripts", "controller", "actions", "form_action_engines.py")
TABLE = os.path.join(ROOT, "scripts", "controller", "actions", "_table.py")
PICKER = os.path.join(ROOT, "scripts", "controller", "actions", "js_snippets", "picker_confirm.py")

FAILURES = []


def _pin(label, path, needles):
    with open(path, "r", encoding="utf-8") as f:
        text = f.read()
    for needle in needles:
        if needle not in text:
            FAILURES.append(f"{label}: {os.path.basename(path)} missing {needle!r}")


def main():
    # N1: filterable-typed fallback present in the select engine...
    _pin("N1-new", ENGINES, [
        "JS_SELECT_FILTERABLE_TYPED",
        "filterable-typed",
        "ok-filterable-typed",
        "filterable-typed-no-match",
        "setNativeValue(trigger, '')",
        "setTimeout(resolve, 300)",  # round-3: 600ms one-shot read → 300ms poll
        "Date.now() + 1800",  # round-3: poll window 1.8s (fits 5s action budget)
    ])
    # ...and the original select_option paths are untouched.
    _pin("N1-orig", ENGINES, [
        "select_result.startswith('option-not-found:')",
        "match_select_option_candidate(want, stored)",
        "fuzzy-matched-from:",
        "err-select-option-unresolved",
        "JS_SELECT_TRIGGER_BY_XPATH, [xp, label_text]",
    ])
    # N4: paged-traverse fallback for paginated el-select (round-5).
    _pin("N4-new", ENGINES, [
        "JS_SELECT_PAGED_TRAVERSE",
        "ok-select-paged",
        "select-paged-no-match",
        "select-paged-no-pagination",
        "wrap.scrollTop = 0",
        "budget_for('select_option')",
    ])
    # N2: explicit zero-row failure + visibility filter in the radio engine...
    _pin("N2-new", TABLE, [
        "err-no-row-match",
        "rowVisible",
        "matchedCount",
    ])
    # ...and the original hit / failure branches remain.
    _pin("N2-orig", TABLE, [
        "clickSel(radio);",
        "return 'ok';",
        "radio-not-found-in-row",
        "err-table-row-not-found",
        "button-not-found-in-row",
    ])
    # N3: findDialog probes dialog OR drawer...
    _pin("N3-new", PICKER, [
        "'.el-dialog, .el-drawer'",
        "containerTitle",
        ".el-drawer__header",
        "n.classList.contains('el-drawer')",
    ])
    # ...and the original dialog path / refill verification stay intact.
    _pin("N3-orig", PICKER, [
        "dialog-not-found",
        ".el-dialog__title",
        "refill_verified",
        "refill-not-observed",
    ])

    if FAILURES:
        for line in FAILURES:
            print("FAIL:", line)
        return 1
    print("ok: characterize-kb-i5-gaps-2 (N1 filterable-typed + N2 err-no-row-match + N3 el-drawer, original paths pinned)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
