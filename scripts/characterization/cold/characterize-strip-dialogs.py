"""Pin the strip_stale_dialogs action contract (KB-I5 run6): snippet strings,
action registration, wiring into tree_picker_click / click_button /
click_table_row_radio, aggregator import, prompt section. Fails non-zero on
mismatch."""

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
    ("scripts/controller/actions/js_snippets/strip_dialogs.py", (
        "JS_STRIP_STALE_WRAPPERS",
        "pointerEvents",
        "el-dialog__wrapper",
        "el-message-box__wrapper",
        "tsscMutilDialog",
        "dialog__wrapper",
        "offsetParent",
        "stripCount",
    )),
    ("scripts/controller/actions/_workspace.py", (
        "strip_stale_dialogs",
        "JS_STRIP_STALE_WRAPPERS",
    )),
    ("scripts/controller/actions/_tree.py", (
        "JS_STRIP_STALE_WRAPPERS",
    )),
    ("scripts/controller/actions/_misc.py", (
        "JS_STRIP_STALE_WRAPPERS",
    )),
    ("scripts/controller/actions/_table.py", (
        "JS_STRIP_STALE_WRAPPERS",
    )),
    ("scripts/controller/actions/_js_snippets.py", (
        "from .js_snippets.strip_dialogs import JS_STRIP_STALE_WRAPPERS",
    )),
    ("scripts/prompts/agent-tools-common.md", (
        "strip_stale_dialogs",
    )),
]

failed = False
for path, texts in checks:
    if not needle(path, *texts):
        failed = True

if failed:
    sys.exit(1)
print("characterize-strip-dialogs: all pins OK")
