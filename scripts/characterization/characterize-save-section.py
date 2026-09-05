"""Pin the save_section action contract (KB-I5 run12 缺口②): JS_SAVE_SECTION
snippet (标题→最小含保存容器→mousedown 链→2.5s→toast), action registration in
_form.py, aggregator import, prompt cues. Fails non-zero on mismatch."""

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
    ("scripts/controller/actions/js_snippets/save_section.py", (
        "JS_SAVE_SECTION",
        "err-section-not-found:",
        "mousedown",
        "el-message",
        "section_title",
        "2500",
        "saveBtnIn",
    )),
    ("scripts/controller/actions/_form.py", (
        "save_section",
        "JS_SAVE_SECTION",
        "err-save-button-not-found",
        "read_xhr_log(url_filter='saveOrUpdate')",
    )),
    ("scripts/controller/actions/_js_snippets.py", ("save_section",)),
    ("scripts/prompts/agent-tools-form.md", (
        'click_save(button_text="保存", region=',
        "err-save-button-not-found",
        "read_xhr_log(url_filter='saveOrUpdate')",
        '点"保存/提交"——click_button 现在会直接返回 err-use-click-save',
    )),
]


def main():
    failed = False
    for path, texts in checks:
        if not needle(path, *texts):
            failed = True
    if failed:
        print("FAIL characterize-save-section")
        return 1
    print("OK characterize-save-section: all %d files pinned" % len(checks))
    return 0


if __name__ == "__main__":
    sys.exit(main())
