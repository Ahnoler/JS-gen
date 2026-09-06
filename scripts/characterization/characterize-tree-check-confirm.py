"""Pin the tree_check_confirm action contract (KB-I5 round-8): snippet strings,
action docstring, aggregator import, prompt section. Fails non-zero on mismatch."""

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
    ("scripts/controller/actions/js_snippets/tree_check.py", (
        "JS_TREE_CHECK_CONFIRM",
        "err-tree-node-not-found",
        "err-tree-check-unverified",
        "checked_count",
        "handleCheckClick",
        "preset-checked",
        "err-tree-label-not-found",
    )),
    ("scripts/controller/actions/_tree.py", (
        "tree_check_confirm",
        "err-tree-check-unverified",
        "JS_TREE_CHECK_CONFIRM",
        "label_text",
        "node_text",
    )),
    ("scripts/controller/actions/_js_snippets.py", ("tree_check",)),
    ("scripts/controller/service.py", ("_register_tree_actions",)),
    ("scripts/prompts/agent-tools-tree.md", (
        "tree_check_confirm(label_text, node_text)",
        "err-tree-check-unverified",
        "单选叶子树（行业代码等）=select_tree_option；多选勾选树（选人/目录）=tree_check_confirm",
    )),
]

ok = all(needle(path, *texts) for path, texts in checks)
if not ok:
    print("FAILED: characterize-tree-check-confirm")
    sys.exit(1)
print("ok: characterize-tree-check-confirm (tree_check_confirm pinned)")
