"""Pin the read_error_notify action contract (error-surface listening, run22):
snippet strings, aggregator import. _observe no longer registers read_error_notify."""

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]


def needle(path, *texts):
    src = (ROOT / path).read_text(encoding="utf-8")
    for t in texts:
        if t not in src:
            print("MISSING %s :: %r" % (path, t))
            return False
    return True


def anti_needle(path, *texts):
    src = (ROOT / path).read_text(encoding="utf-8")
    for t in texts:
        if t in src:
            print("UNWANTED %s :: %r" % (path, t))
            return False
    return True


checks = [
    ("scripts/controller/actions/js_snippets/error_notify.py", (
        "JS_READ_ERROR_NOTIFY",
        "异常信息",
        "el-message",
        "el-notification",
        "errors",
    )),
    ("scripts/controller/actions/_js_snippets.py", ("error_notify",)),
]

ok = all(needle(path, *texts) for path, texts in checks)
ok = ok and anti_needle(
    "scripts/controller/actions/_observe.py",
    "async def read_error_notify",
)
if not ok:
    print("FAILED: characterize-error-notify")
    sys.exit(1)
print("ok: characterize-error-notify (read_error_notify pinned)")
