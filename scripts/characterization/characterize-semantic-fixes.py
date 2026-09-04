# -*- coding: utf-8 -*-
"""Pin the three semantic fixes (matched_by fallback chain in table_cell,
verified_in='main-form' + header assertion in guarantee VERIFY,
{text, meaning} + semantic_summary in read_error_notify).
Fails non-zero on mismatch."""

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
        "matched_by",
        "'serial-tail'",
        "'serial-head'",
        "'prefix'",
        "row_text 优先用可见行文本（2608 前缀或企业名）",
    )),
    ("scripts/controller/actions/js_snippets/guarantee_intro_snippet.py", (
        "verified_in: 'main-form'",
        "担保金额",
    )),
    ("scripts/controller/actions/js_snippets/error_notify.py", (
        "meaning",
        "semantic_summary",
        "already-introduced",
        "module-unsaved",
        "required-missing",
    )),
]


def main():
    failed = False
    for path, texts in checks:
        if not needle(path, *texts):
            failed = True
    if failed:
        print("FAIL characterize-semantic-fixes")
        return 1
    print("OK characterize-semantic-fixes: all %d files pinned" % len(checks))
    return 0


if __name__ == "__main__":
    sys.exit(main())
