# -*- coding: utf-8 -*-
"""Pin the fill_table_cell / select_table_cell action contract (KB-I5 run16
最后缺口：引入保证人弹窗行内输入). Fails non-zero on mismatch."""

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def needle(path, *texts):
    src = (ROOT / path).read_text(encoding="utf-8")
    for t in texts:
        if t not in src:
            print("MISSING %s :: %r" % (path, t))
            return False
    return True


checks = [
    ("scripts/controller/actions/js_snippets/table_cell.py", (
        "JS_FILL_TABLE_CELL",
        "el-select-dropdown__item",
        "err-table-cell-not-written",
        "el-table__fixed",
        "HTMLInputElement.prototype",
        "column_index=-1",
        "el-dialog",
    )),
    ("scripts/controller/actions/_table.py", (
        "fill_table_cell",
        "select_table_cell",
        "JS_FILL_TABLE_CELL",
        "_workspace_result",
        "err-table-cell-not-written",
    )),
    ("scripts/controller/actions/_js_snippets.py", ("table_cell",)),
    ("scripts/prompts/agent-tools-table.md", (
        "fill_table_cell(row_text, column_index, value)",
        "select_table_cell(row_text, column_index, value)",
        "引入保证人",
        "err-table-cell-not-written",
    )),
]


def main():
    failed = False
    for path, texts in checks:
        if not needle(path, *texts):
            failed = True
    if failed:
        print("FAIL characterize-table-cell")
        return 1
    print("OK characterize-table-cell: all %d files pinned" % len(checks))
    return 0


if __name__ == "__main__":
    sys.exit(main())
