"""Pin the unified-save contract: save_section action fully removed — JS snippet
file deleted, no registration in _form.py, no aggregator import, prompt no longer
suggests it; historical replay maps save_section → click_save. Fails non-zero."""

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


def anti_needle(path, *texts):
    src = (ROOT / path).read_text(encoding="utf-8")
    for t in texts:
        if t in src:
            print("FORBIDDEN %s :: %r (save_section must be fully removed)" % (path, t))
            return False
    return True


checks = [
    # 提示与注册：统一保存入口 click_save，分区保存 region=分区标题
    ("scripts/prompts/agent-tools-form.md", (
        'click_save(button_text="保存", region=',
        "err-save-button-not-found",
        "read_xhr_log(url_filter='saveOrUpdate')",
        '点"保存/提交"——click_button 现在会直接返回 err-use-click-save',
        "save_section",
    )),
    # 历史回放兼容：save_section → click_save 映射存在
    ("scripts/controller/actions/_replay.py", (
        "action_name == 'save_section'",
        "'button_text': '保存'",
        "section_title",
    )),
]

anti_checks = [
    # save_section 残留清零：JS 本体文件已删、注册/聚合器无残留
    ("scripts/controller/actions/_form.py", ("async def save_section", "JS_SAVE_SECTION")),
    ("scripts/controller/actions/_js_snippets.py", ("save_section", "JS_SAVE_SECTION")),
]

# save_section.py 本体必须不存在
gone = ROOT / "scripts" / "controller" / "actions" / "js_snippets" / "save_section.py"


def main():
    failed = False
    for path, texts in checks:
        if not needle(path, *texts):
            failed = True
    for path, texts in anti_checks:
        if not anti_needle(path, *texts):
            failed = True
    if gone.exists():
        print("FORBIDDEN js_snippets/save_section.py still exists")
        failed = True
    if failed:
        print("FAIL characterize-save-section")
        return 1
    print("OK characterize-save-section: unified click_save pinned, save_section removed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
