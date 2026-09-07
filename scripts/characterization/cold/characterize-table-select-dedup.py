#!/usr/bin/env python3
"""Characterize Source B table control collection — no double-count el-select."""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


def assert_true(cond: bool, msg: str) -> None:
    if not cond:
        raise AssertionError(msg)


def _collect_table_controls_input_loop(js: str) -> str:
    """Extract the input-for loop body inside collectTableControls."""
    # Start at the inputs query inside Source B collectTableControls.
    m = re.search(
        r"const inputs = cell\.querySelectorAll\('input:not\(\[type=\"hidden\"\]\)'\);(.*?)"
        r"const textareas = cell\.querySelectorAll\('textarea'\);",
        js,
        re.S,
    )
    assert_true(m is not None, "could not locate table input→textarea loop slice")
    return m.group(1)


def test_table_collect_skips_select_inner_input() -> None:
    """collectTableControls must not push .el-select's inner input as a separate control.

    Otherwise occurrence=2 invents fake (...el-select)[2] xpaths while the DOM
    has only one select — Agent select_option then returns xpath-not-found.
    """
    js = (
        (ROOT / "scripts/controller/actions/_js_snippets.py").read_text(encoding="utf-8")
        + "".join(
            p.read_text(encoding="utf-8")
            for p in sorted((ROOT / "scripts/controller/actions/js_snippets").glob("*.py"))
        )
    )
    loop = _collect_table_controls_input_loop(js)
    assert_true(
        "el-date-editor" in loop and "el-pagination" in loop,
        "expected date/pagination skips in input loop",
    )
    assert_true(
        re.search(r"closest\(['\"]\.el-select['\"]\)", loop) is not None,
        "input loop must continue when input.closest('.el-select') "
        "(do not double-count select trigger)",
    )


def test_no_fake_occurrence_comment_or_marker() -> None:
    """Sanity: select push still exists after input loop."""
    js = (
        (ROOT / "scripts/controller/actions/_js_snippets.py").read_text(encoding="utf-8")
        + "".join(
            p.read_text(encoding="utf-8")
            for p in sorted((ROOT / "scripts/controller/actions/js_snippets").glob("*.py"))
        )
    )
    assert_true(
        "cell.querySelectorAll('.el-select')" in js
        or 'cell.querySelectorAll(".el-select")' in js,
        "el-select collection retained",
    )


def main() -> int:
    test_table_collect_skips_select_inner_input()
    test_no_fake_occurrence_comment_or_marker()
    print("characterize-table-select-dedup: OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
