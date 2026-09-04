"""Pin the read_xhr_log action contract (KB-I5 run12 缺口①): XHR/fetch hook
snippet, window.__xhr_log buffer, action registration in _observe.py,
aggregator import. Fails non-zero on mismatch."""

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
    ("scripts/controller/actions/js_snippets/xhr_log.py", (
        "JS_XHR_HOOK",
        "JS_XHR_RECENT",
        "window.__xhr_log",
        "__xhr_log_installed",
        "XMLHttpRequest.prototype.send",
        "XMLHttpRequest.prototype.open",
        "window.fetch",
        "MAX = 20",
        "BODY_LIMIT = 2048",
        "loadend",
        "historyTraced",
        "urlFilter",
        "requestBody",
    )),
    ("scripts/controller/actions/_observe.py", (
        "read_xhr_log",
        "JS_XHR_HOOK",
        "JS_XHR_RECENT",
        "add_init_script",
        "__xhr_log_installed",
        "historyTraced",
        "url_filter",
    )),
    ("scripts/controller/actions/_js_snippets.py", ("xhr_log",)),
    ("scripts/prompts/agent-tools-common.md", (
        "read_xhr_log(url_filter='NextCheck')",
        "historyTraced",
        "saveOrUpdate",
    )),
]


def main():
    failed = False
    for path, texts in checks:
        if not needle(path, *texts):
            failed = True
    if failed:
        print("FAIL characterize-xhr-log")
        return 1
    print("OK characterize-xhr-log: all %d files pinned" % len(checks))
    return 0


if __name__ == "__main__":
    sys.exit(main())
