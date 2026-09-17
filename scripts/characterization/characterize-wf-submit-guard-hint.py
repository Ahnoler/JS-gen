"""Characterization: wf_submit_guard 只报事实（组件类型），动作由 agent 选（traj 840）。

Born from traj 840: at the wizard's final step the agent stalled — the guard
returned opValue='' / opOptions=[] and the agent read that as "nothing to select"
(Element UI renders a select's options only after the dropdown first opens, and
this guard deliberately never opens it).

Two rejected shapes are pinned out here, both by user verdict 2026-09-17:
  - a prescription that names the action (and worse, the option name / node role):
    the Agent must pick the action from the component type, per its own tool
    guidance (agent-tools-form.md already carries the EL-SELECT rule: an el-select
    is filled with select_option, never a click);
  - pushing that classification into the click family (real_click's resolver,
    click_button's not-found): a click-family action must not take over
    select-family operations, and an action must not be broadened to other
    scenarios. Both were written and reverted in this session.

What the engine owes the agent is therefore the FACT it was missing: the field's
component type (opKind), plus an honest account of what opOptions contains.
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
TODO_CARDS = (ROOT / "scripts/controller/actions/js_snippets/todo_cards.py").read_text(encoding="utf-8")
TODO_ACTION = (ROOT / "scripts/controller/actions/_todo.py").read_text(encoding="utf-8")
REAL_CLICK = (ROOT / "scripts/controller/actions/js_snippets/real_click.py").read_text(encoding="utf-8")
CLICK_ENGINE = (ROOT / "scripts/controller/actions/click_action_engine.py").read_text(encoding="utf-8")
WORKSPACE = (ROOT / "scripts/controller/actions/_workspace.py").read_text(encoding="utf-8")

failures: list[str] = []


def need(src: str, needle: str, where: str) -> None:
    if needle not in src:
        failures.append(f"MISSING {where} :: {needle!r}")


def ban(src: str, needle: str, where: str) -> None:
    if needle in src:
        failures.append(f"FORBIDDEN {where} :: {needle!r}")


# ── 载荷：报事实（组件类型），不给处方 ──────────────────────────────────────
need(TODO_CARDS, "let opKind = null;", "opKind 定义")
need(TODO_CARDS, "opItem.querySelector('.el-select') ? 'el-select'", "类型取自现场 DOM=el-select")
need(TODO_CARDS, "opKind: opKind,", "opKind 进入返回载荷")
ban(TODO_CARDS, "opHint", "不给行动处方（动作由 agent 按组件类型选）")

# ── 语义诚实：只列已渲染选项，空列表≠没有选项 ──────────────────────────────
need(TODO_CARDS, "只列", "docstring 说明 opOptions 只含已渲染项")
need(TODO_CARDS, "不等于「没有", "docstring 点破空列表 ≠ 没有选项")
need(TODO_CARDS, "选哪个动作由 agent 按其工具规则决定", "docstring 明确动作归 agent")
need(TODO_ACTION, "opKind reports the ", "动作面 docstring 说明 opKind")
need(TODO_ACTION, "component type, and opOptions lists only ", "动作面 docstring 说明类型 + 已渲染语义")
need(TODO_ACTION, "Pick the action for that ", "动作面 docstring 明确由 agent 选")
need(TODO_ACTION, "component type yourself (see the el-select rules", "动作面 docstring 指向 agent 自身的规则")

# ── 知识单一来源：类型→动作的族规住在 agent 指引里，不在引擎 ────────────────
# 边界措辞（禁点下拉选项，且现在按行为覆盖 real_click/click_button）由
# characterize-real-click.py 单点钉住——本 pin 不重复同一断言。

# ── 防回潮：click 族不得接管 select 族，动作不得被拓宽到别的场景 ────────────
for src, where in ((REAL_CLICK, "real_click"), (CLICK_ENGINE, "click_button"),
                   (WORKSPACE, "_workspace")):
    for bad in ("JS_TEXT_CARRIER_PRESCRIPTION", "err-real-click-select-option",
                "err-real-click-disabled-button", "err-real-click-fail:' + reason + ' | '"):
        ban(src, bad, where)

if failures:
    for f in failures:
        print(f)
    sys.exit(1)

print("characterize-wf-submit-guard-hint: OK (facts-only opKind; action choice stays with the agent)")
