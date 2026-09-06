"""Pin the close_visible_dialog action contract (KB-I5 run5): snippet strings,
action registration, aggregator import, prompt section. Fails non-zero on mismatch."""

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
    ("scripts/controller/actions/js_snippets/close_dialog.py", (
        "JS_CLOSE_VISIBLE_DIALOG",
        "err-dialog-not-closable",
        "err-dialog-not-found",
        "取消",
        "确 定",
        "el-dialog__headerbtn",
        "disableBtn",
    )),
    ("scripts/controller/actions/_workspace.py", (
        "close_visible_dialog",
        "JS_CLOSE_VISIBLE_DIALOG",
        "dialog_title",
        "err-dialog-not-closable",
    )),
    ("scripts/controller/actions/_js_snippets.py", ("close_dialog",)),
    ("scripts/prompts/agent-tools-common.md", (
        "close_visible_dialog",
        "err-dialog-not-closable",
    )),
]

ok = all(needle(path, *texts) for path, texts in checks)
if not ok:
    print("FAILED: characterize-close-dialog")
    sys.exit(1)
print("ok: characterize-close-dialog (close_visible_dialog pinned)")
