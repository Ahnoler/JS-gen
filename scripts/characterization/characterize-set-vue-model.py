"""Pin the set_vue_model action contract (引擎最后一拍): Vue model direct-write
snippet, action registration in _form.py, aggregator import, prompt cues.
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
    ("scripts/controller/actions/js_snippets/vue_model.py", (
        "JS_SET_VUE_MODEL",
        "err-vue-model-not-found",
        "$forceUpdate",
        "el-form-item__label",
        "el-dialog, .el-drawer",
        "err-vue-model-label-not-found",
        "err-vue-model-write-unverified",
        "old_value",
    )),
    ("scripts/controller/actions/_form.py", (
        "set_vue_model",
        "JS_SET_VUE_MODEL",
        "err-vue-model-not-found",
        "_workspace_result",
    )),
    ("scripts/controller/actions/_js_snippets.py", ("vue_model",)),
    ("scripts/prompts/agent-tools-common.md", (
        "real_click(text=流程提交)",
        "看似已选实为空",
        "set_vue_model(label_text, field_name, value)",
    )),
    ("scripts/prompts/agent-tools-form.md", (
        "set_vue_model",
    )),
]


def main():
    failed = False
    for path, texts in checks:
        if not needle(path, *texts):
            failed = True
    if failed:
        print("FAIL characterize-set-vue-model")
        return 1
    print("OK characterize-set-vue-model: all %d files pinned" % len(checks))
    return 0


if __name__ == "__main__":
    sys.exit(main())
