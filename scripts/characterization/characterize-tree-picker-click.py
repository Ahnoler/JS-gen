"""Pin the tree_picker_click action contract (KB-I5 run4): snippet strings,
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
    ("scripts/controller/actions/js_snippets/tree_picker.py", (
        "JS_TREE_PICKER_CLICK",
        "err-tree-no-echo",
        "err-tree-node-not-found",
        "err-tree-label-not-found",
        "err-tree-trigger-not-found",
        "my-popover",
        "norm(c.textContent) === text",
        "mousedown",
        "mouseup",
        "el-tree-node__content",
    )),
    ("scripts/controller/actions/_tree.py", (
        "tree_picker_click",
        "JS_TREE_PICKER_CLICK",
        "path_texts",
        "label_text",
        "err-tree-no-echo",
    )),
    ("scripts/controller/actions/_js_snippets.py", ("tree_picker",)),
    ("scripts/prompts/agent-tools-tree.md", (
        "tree_picker_click(label_text, path_texts)",
        "err-tree-no-echo",
        "维护方案品种明细",
    )),
]

ok = all(needle(path, *texts) for path, texts in checks)
if not ok:
    print("FAILED: characterize-tree-picker-click")
    sys.exit(1)
print("ok: characterize-tree-picker-click (tree_picker_click pinned)")
