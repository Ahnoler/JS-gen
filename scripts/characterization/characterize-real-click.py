"""Pin the real_click CDP trusted-event channel (KB-I5 run7): locator snippet,
CDP dispatch strings, action registration + fallback wiring into
tree_picker_click, aggregator import, prompt line. Fails non-zero on mismatch."""

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
    ("scripts/controller/actions/js_snippets/real_click.py", (
        "JS_REAL_CLICK_RECT",
        "err-real-click-target-not-found",
        "getBoundingClientRect",
        "span.el-tooltip.my-popover.item",
    )),
    ("scripts/controller/actions/_workspace.py", (
        "JS_REAL_CLICK_RECT",
        "new_cdp_session",
        "Input.dispatchMouseEvent",
        "mousePressed",
        "mouseReleased",
        "clickCount",
        "ok-real-click",
        "err-real-click-fail",
        "real_click",
    )),
    ("scripts/controller/actions/_tree.py", (
        "_real_click_via_cdp",
        "fallback=real-click",
        "err-tree-node-not-found",
    )),
    ("scripts/controller/actions/_js_snippets.py", (
        "from .js_snippets.real_click import JS_REAL_CLICK_RECT",
    )),
    ("scripts/controller/actions/replay_timing.py", (
        '"tree_picker_click": 20',
        '"real_click": 8',
    )),
    ("scripts/prompts/agent-tools-common.md", (
        "real_click",
    )),
]

failed = False
for path, texts in checks:
    if not needle(path, *texts):
        failed = True

if failed:
    sys.exit(1)
print("characterize-real-click: all pins OK")
