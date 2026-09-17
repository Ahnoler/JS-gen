#!/usr/bin/env python3
"""Characterize sync_tasks_from_errors_impl tail intactness (source pin).

Pins that the "Auto-scroll to first error" + summary-message tail of
``sync_tasks_from_errors_impl`` lives INSIDE the impl function body (not
orphaned after ``_scan_visible_dom_fields`` by the 0fa6a8ee extraction cut).
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "scripts/controller/actions/form_scan_actions.py"


def assert_true(cond: bool, msg: str) -> None:
    if not cond:
        raise AssertionError(msg)


def _function_body(src: str, def_line: str) -> str:
    """Return the source slice of a top-level function body (def line included),
    ending right before the next top-level def/async def (or EOF)."""
    idx = src.index(def_line)
    nxt = re.search(r"^(?:async )?def ", src[idx + 1 :], re.MULTILINE)
    if nxt is None:
        return src[idx:]
    return src[idx : idx + 1 + nxt.start()]


def test_impl_has_full_tail() -> None:
    src = SRC.read_text(encoding="utf-8")
    body = _function_body(src, "async def sync_tasks_from_errors_impl(")
    assert_true(
        "return _ok(msg, include_in_memory=True)" in body,
        "impl returns the sync-errors summary message",
    )
    assert_true(
        "# Auto-scroll to first error" in body,
        "auto-scroll tail lives inside sync_tasks_from_errors_impl",
    )
    assert_true(
        "msg = f'sync-errors | retried:{len(retried)}'" in body,
        "summary message built inside impl",
    )


def test_tail_not_orphaned_after_scan_visible_dom_fields() -> None:
    src = SRC.read_text(encoding="utf-8")
    body = _function_body(src, "async def _scan_visible_dom_fields(")
    assert_true(
        "# Auto-scroll to first error" not in body,
        "auto-scroll tail no longer orphaned after _scan_visible_dom_fields",
    )
    assert_true("if retried:" not in body, "no orphan 'retried' block in _scan_visible_dom_fields")
    assert_true(
        "if intervene:" not in body, "no orphan 'intervene' block in _scan_visible_dom_fields"
    )


def test_head_definitions_present() -> None:
    src = SRC.read_text(encoding="utf-8")
    body = _function_body(src, "async def sync_tasks_from_errors_impl(")
    assert_true(
        "retried = tl.sync_from_errors(error_labels)" in body,
        "retried initialized in impl head",
    )
    assert_true(
        "intervene = [item for item in retried if item.needs_intervention]" in body,
        "intervene list built in impl head",
    )
    assert_true(
        "fillable = [item for item in retried if not item.needs_intervention]" in body,
        "fillable list built in impl head",
    )


def test_tail_ordering_inside_impl() -> None:
    src = SRC.read_text(encoding="utf-8")
    body = _function_body(src, "async def sync_tasks_from_errors_impl(")
    i_head = body.index("prefer special-element")
    i_tail = body.index("# Auto-scroll to first error")
    i_msg = body.index("msg = f'sync-errors | retried:{len(retried)}'")
    i_ret = body.index("return _ok(msg, include_in_memory=True)")
    assert_true(i_head < i_tail < i_msg < i_ret, "tail order: stderr -> scroll -> msg -> return")


def main() -> int:
    test_impl_has_full_tail()
    test_tail_not_orphaned_after_scan_visible_dom_fields()
    test_head_definitions_present()
    test_tail_ordering_inside_impl()
    print("characterize-sync-tasks-from-errors-intact: OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
