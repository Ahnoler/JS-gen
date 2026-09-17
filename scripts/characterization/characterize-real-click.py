"""Pin the real_click CDP trusted-event channel (KB-I5 run7): locator snippet,
CDP dispatch strings, action registration + fallback wiring into
tree_picker_click, aggregator import, prompt line. Fails non-zero on mismatch.

Also pins the CHANNEL'S SCOPE (2026-09-17, traj-840 follow-up): the family
boundary must be written by BEHAVIOUR, not by tool name. The option-click
prohibition used to name `click_element` / `click_element_by_index` only, so
`real_click` / `click_button` were never excluded — while the trusted-channel
section advertised real_click as "what to use when synthetic clicks fail". An
agent needing to look at an el-select therefore had a click-family move and no
rule against using it. Pinned here: any click tool is excluded from dropdown
options, the trusted channel declares its scope, the "read the options first"
demand names its read channel (scan field.options, Vue-read, no open), and the
engine's own "open the dropdown first" invitation is gone."""

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
        # 边界按行为写：任何 click 工具都不得点下拉选项（原措辞只排除 click_element）
        "任何 click 类工具（click_element / click_element_by_index / click_button / real_click）"
        "都不得点击 el-select 选项或下拉行，选项只能由 select_option 选择",
        # 信任通道宣告适用范围，堵住"real_click 什么都能点"的外推
        "不得用于选择下拉选项**——下拉选项只能由 select_option 选择",
        # 「必须先读选项再选」必须给出读通道，否则 agent 只能去点开下拉
        "读法：用 scan_visible_fields / scan_form_fields 读该字段的 field.options"
        "（从 Vue 实例读，不打开下拉）",
        "无需先点开下拉",
        # 合法用法必须原样保留（防误伤）
        "real_click(text=流程提交)",
        "TsscMultiTree tree-popover、el-cascader 等",
    )),
    ("scripts/prompts/agent-tools-form.md", (
        "绝不使用任何 click 类工具（`click_element` / `click_element_by_index` / "
        "`click_button` / `real_click`）点击下拉选项",
        "禁止**用任何 click 类工具（含 `real_click` / `click_button`）点 el-option 或下拉行",
        "改用 `real_click` 点**触发器**展开，选项仍用 `select_option` 选择",
    )),
    ("scripts/controller/actions/_todo.py", (
        # 引擎侧改为给出读通道，不再教 agent「先点开下拉」
        "full option set with scan_visible_fields / scan_form_fields",
        "it does not open the dropdown",
    )),
]

failed = False
for path, texts in checks:
    if not needle(path, *texts):
        failed = True

if failed:
    sys.exit(1)
print("characterize-real-click: all pins OK")
