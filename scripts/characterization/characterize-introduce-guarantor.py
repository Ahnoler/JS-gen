# -*- coding: utf-8 -*-
"""Pin the introduce_guarantor composite action contract (引入保证人全序列
单调用封装 + 主列表后校验 + 幂等 dup 语义). Fails non-zero on mismatch."""

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
    ("scripts/controller/actions/js_snippets/guarantee_intro_snippet.py", (
        "JS_INTRODUCE_GUARANTOR_FILL",
        "JS_INTRODUCE_GUARANTOR_VERIFY",
        "引入保证人",
        "err-guarantee-dup-not-in-list",
        "err-guarantee-not-in-list:",
        "不可重复被引入",
        "与借款人关系",
        "担保金额",
        "异常信息",
        "el-select-dropdown__item",
        "HTMLInputElement.prototype",
        "客户编号",
        "el-pager",
    )),
    ("scripts/controller/actions/_table.py", (
        "introduce_guarantor",
        "JS_INTRODUCE_GUARANTOR_FILL",
        "JS_INTRODUCE_GUARANTOR_VERIFY",
        "_real_click_via_cdp",
        "_workspace_result",
        "dup:true",
        "err-guarantee-intro-failed",
    )),
    ("scripts/controller/actions/_js_snippets.py", ("guarantee_intro_snippet",)),
    ("scripts/prompts/agent-tools-table.md", (
        "introduce_guarantor(guarantor_key, relation, amount)",
        "dup:true",
        "err-guarantee-*",
    )),
    ("scripts/prompts/agent-tools-form.md", ("introduce_guarantor",)),
]


def main():
    failed = False
    for path, texts in checks:
        if not needle(path, *texts):
            failed = True
    if failed:
        print("FAIL characterize-introduce-guarantor")
        return 1
    print("OK characterize-introduce-guarantor: all %d files pinned" % len(checks))
    return 0


if __name__ == "__main__":
    sys.exit(main())
