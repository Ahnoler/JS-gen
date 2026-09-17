"""Characterization: 按组件类型推荐动作（2026-09-17，用户定调「按钮→click，下拉→select」）。

Born from traj 840: the first cut of the wf_submit_guard opHint hardcoded the option
name (下一步) and the node role (发起节点) — too rigid. The rule is type-driven:
analyze the CARRIER COMPONENT of the target text and prescribe the matching action.

Two prescription sites, both pinned here:

1. ``JS_REAL_CLICK_RECT`` (real_click.py) — the text-target action classifies its
   carrier before doing anything:
   - carrier is an ``.el-select-dropdown__item`` → NO trusted click; return
     ``err-real-click-select-option`` + prescription ``select_option(label_text=<owner
     label derived live from aria-expanded/activeElement>, option_text=<text>)``
   - carrier is a disabled button (native disabled / aria-disabled) → NO silent
     no-op click; return ``err-real-click-disabled-button`` + prescription
   - no visible carrier at all → not-found + prescription teaching that unopened
     dropdown options are not in the DOM (real_click can never find them;
     select_option opens the dropdown itself)
   - enabled button → unchanged (click proceeds)
   ``_workspace.py`` surfaces the ``prescription`` field to the agent on failure.

2. ``JS_WF_SUBMIT_GUARD`` opHint (todo_cards.py) — field-type-driven, no hardcoded
   option/node names: select field → select_option(label_text=opLabel,
   option_text=<选项原文>); opOptions=[] only means the dropdown has not been
   opened; recheck opValue afterwards. ``_todo.py`` docstring matches (type-based).
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

def _read(rel: str) -> str:
    return (ROOT / rel).read_text(encoding="utf-8")

REAL_CLICK = _read("scripts/controller/actions/js_snippets/real_click.py")
WORKSPACE = _read("scripts/controller/actions/_workspace.py")
TODO_CARDS = _read("scripts/controller/actions/js_snippets/todo_cards.py")
TODO_ACTION = _read("scripts/controller/actions/_todo.py")

failures: list[str] = []


def need(src: str, needle: str, where: str) -> None:
    if needle not in src:
        failures.append(f"MISSING {where} :: {needle!r}")


def ban(src: str, needle: str, where: str) -> None:
    if needle in src:
        failures.append(f"FORBIDDEN {where} :: {needle!r} (硬编码名，应按组件类型表述)")


# ── real_click：组件类型分类器 ──────────────────────────────────────────────
need(REAL_CLICK, "el.closest('.el-select-dropdown__item')", "下拉选项载体识别")
need(REAL_CLICK, "error: 'err-real-click-select-option'", "选项→重定向错误码")
need(REAL_CLICK, "i.getAttribute('aria-expanded') === 'true'", "归属字段名从展开中的触发器现场推导")
need(REAL_CLICK, "select_option(label_text=\"' + (ownerLbl || '<字段名>')", "选项处方给 select_option")
need(REAL_CLICK, "option_text=\"' + txt + '\")", "选项处方带目标文本")
need(REAL_CLICK, "不要对选项做真实点击", "选项处方说明录制/回放都走 select_option")
need(REAL_CLICK, "error: 'err-real-click-disabled-button'", "禁用按钮→报错而非静默无效点击")
need(REAL_CLICK, "btnCarrier.disabled === true", "禁用判据=native disabled")
need(REAL_CLICK, "btnCarrier.getAttribute('aria-disabled') === 'true'", "禁用判据=aria-disabled")
need(REAL_CLICK, "弹层未展开时选项不在", "无载体处方点破：选项未展开不在 DOM")
need(REAL_CLICK, "err-real-click-target-not-found", "无载体仍返回原错误码（兼容）")

# ── _workspace：prescription 透出给 agent ───────────────────────────────────
need(WORKSPACE, "rect.get('prescription')", "失败时透出处方")

# ── guard opHint：字段类型驱动，无硬编码选项/节点名 ──────────────────────────
need(TODO_CARDS, "const opName = opLabel || '流程操作';", "opName 兜底")
need(TODO_CARDS, "let opHint = '';", "opHint 定义")
need(TODO_CARDS, "opHint: opHint,", "opHint 进入返回载荷")
need(TODO_CARDS, "按组件类型选择动作", "空值分支按类型表述")
need(TODO_CARDS, "select_option(label_text=\"' + opName + '\", option_text=<选项原文>)", "处方=select_option + 选项原文占位")
need(TODO_CARDS, "不代表没有选项", "点破 opOptions=[] 只因弹层未展开")
need(TODO_CARDS, "real_click 点不到未展开的选项", "点破 real_click 与未展开弹层的关系")
need(TODO_CARDS, "重跑本 guard 确认 opValue 已变化", "复核闭环")
# ban 只盯 JS 片段本体；模块 docstring 的 DOM 事实记录（「发起节点只有下一步」）
# 是实测知识，保留。
_GUARD_JS = TODO_CARDS.split("JS_WF_SUBMIT_GUARD = ")[1]
ban(_GUARD_JS, 'option_text="下一步")', "硬编码选项名 下一步")
ban(_GUARD_JS, "发起节点", "硬编码节点角色")

# ── _todo.py 提示词：类型制表述 ─────────────────────────────────────────────
need(TODO_ACTION, "match the action to the carrier component type", "提示词按载体组件类型")
need(TODO_ACTION, "a visible '\n        'enabled button → click_button", "按钮→click")
need(TODO_ACTION, "select_option(label_text=<field>, option_text=<option text>)", "下拉→select")
need(TODO_ACTION, "real_click cannot reach unopened options", "点破 real_click 够不到未展开选项")

if failures:
    for f in failures:
        print(f)
    sys.exit(1)

print("characterize-component-type-prescription: OK (button→click / select-option→select / disabled→err, all type-driven)")
