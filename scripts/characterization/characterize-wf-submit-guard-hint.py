"""Characterization: wf_submit_guard 的 opHint 行动处方（traj 840，2026-09-17）。

Born from traj 840: at the wizard's final step the agent stalled — 「下一步」 there is
an OPTION of the 流程操作 el-select, not a button, yet nothing in the guard payload or
its prompt said so. The guard reported opValue=''/opOptions=[] (Element UI renders
options only after the first open; the guard deliberately never opens the dropdown),
which the agent read as "nothing to select", and it kept pattern-matching real_click
on the option name instead of using select_option.

Pinned here:
- the payload carries ``opHint`` (prescription) and keeps the rest of the shape;
- empty-opValue branch prescribes select_option(label_text=opLabel, option_text=…),
  explains opOptions=[] means "dropdown not opened yet", and forbids
  real_click/click_button on the option name (下一步 is an option, not a button);
- selected-opValue branch prescribes recheck-then-流程提交;
- the agent-facing action docstring (_todo.py) carries the same guidance.
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SNIPPET = (ROOT / "scripts/controller/actions/js_snippets/todo_cards.py").read_text(encoding="utf-8")
ACTION = (ROOT / "scripts/controller/actions/_todo.py").read_text(encoding="utf-8")

failures: list[str] = []


def need(src: str, needle: str, where: str) -> None:
    if needle not in src:
        failures.append(f"MISSING {where} :: {needle!r}")


# ── 载荷带 opHint，形状其余保持 ─────────────────────────────────────────────
need(SNIPPET, "const opName = opLabel || '流程操作';", "opName 兜底")
need(SNIPPET, "let opHint = '';", "opHint 定义")
need(SNIPPET, "opHint: opHint,", "opHint 进入返回载荷")

# ── 空值分支：select_option 处方 + 点破 opOptions 语义 + 禁止 real_click 选项 ──
need(SNIPPET, 'select_option(label_text="' + "' + opName + '", "空值分支 select_option 处方（label_text=opLabel）")
need(SNIPPET, 'option_text="下一步")', "空值分支给出 下一步 示例")
need(SNIPPET, "不代表没有选项", "点破 opOptions=[] 只因弹层未展开")
need(SNIPPET, "select_option 会自行展开弹层", "说明 select_option 自开弹层")
need(SNIPPET, "禁止对「下一步」这类名称做 real_click/click_button", "明令禁止对选项名 real_click/click_button")
need(SNIPPET, "是这个下拉的选项，不是按钮", "点破 下一步 是选项非按钮")
need(SNIPPET, "重跑本 guard 确认 opValue 已变化", "要求复核闭环")

# ── 已选分支：复核后提交 ───────────────────────────────────────────────────
need(SNIPPET, "流程操作已选「' + opValue + '」", "已选分支确认当前值")
need(SNIPPET, "click 流程提交", "已选分支指向流程提交")

# ── agent 面提示词同步（_todo.py action docstring）─────────────────────────
need(ACTION, "Act on its opHint:", "提示词指向 opHint")
need(ACTION, "select_option(label_text=opLabel, option_text=…, e.g. 下一步 at a", "提示词给 select_option 处方")
need(ACTION, "not a button.", "提示词点破 下一步 不是按钮")

if failures:
    for f in failures:
        print(f)
    sys.exit(1)

print("characterize-wf-submit-guard-hint: OK (opHint prescription pinned)")
