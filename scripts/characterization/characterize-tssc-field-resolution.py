"""Characterization: TsscMultiSelect 字段解析精确优先守卫（2026-09-16）。

Born from 选择要素弹窗错位缺陷：字段查找用 `l === label || l.includes(label)`
首个命中，弹窗上方「组件要素编码/组件要素名称」查询字段的标签**包含**目标标签
（'组件要素名称'.includes('要素名称') === true）且 DOM 序在前——找「要素名称」
错位命中「组件要素名称」，select_option 打开别的字段的弹层、对着空表格报
err-no-options（19242 活页面 + 引擎原版匹配逻辑实证）。

Guard: the field finder must resolve EXACT label matches first (visible
preferred), fall back to an includes match ONLY when it is globally unique,
and return an ``ambiguous-label:`` error listing candidates when the fuzzy
match is multi-hit. Both finder call sites (container + dialog fallback) must
use the same resolver.
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SRC = (ROOT / "scripts/controller/actions/js_snippets/tssc_multi_select.py").read_text(encoding="utf-8")
PROMPT = (ROOT / "scripts/prompts/agent-tools-form.md").read_text(encoding="utf-8")

failures: list[str] = []


def need(needle: str, where: str) -> None:
    if needle not in SRC:
        failures.append(f"MISSING {where} :: {needle!r}")


def ban(needle: str, where: str) -> None:
    if needle in SRC:
        failures.append(f"FORBIDDEN {where} :: {needle!r} (旧式首中即返的包含匹配)")


# ── 解析器存在且结构正确 ─────────────────────────────────────────────────────
need("const findFieldItem = (root, label) => {", "finder 定义")
# 精确匹配优先，可见优先、隐藏兜底
need("if (l === label) {", "exact 匹配分支")
need("exactVisible", "可见精确命中桶")
need("exactAny", "隐藏精确命中桶")
need("if (exactVisible.length) return { item: exactVisible[0], via: 'exact' };", "可见精确优先返回")
# 包含匹配只在唯一时兜底
need("if (fuzzy.length === 1) return { item: fuzzy[0].item, via: 'includes-unique' };",
     "包含唯一兜底")
# 多命中必须报歧义而不是静默取第一个
need("if (fuzzy.length > 1) {", "歧义分支")
need("'ambiguous-label:' + label + ' | 候选: ' + hit.ambiguous.join(' / ')",
     "歧义返回文案（主循环）")
need("ambiguous-label", "歧义返回（dialog 兜底也应出现 ≥1 处）")
# 两个调用点都必须走新解析器；旧式内联首中即返必须消失
need("const hit = findFieldItem(container, label);", "主循环调用点")
need("const hit = findFieldItem(dlg, label);", "dialog 兜底调用点")
ban("if (l === label || l.includes(label)) { fieldItem = item; break; }", "旧式内联匹配")

# ── 提示词同步：字段歧义错误码对上层可见 ────────────────────────────────────
need("ambiguous-label", "agent-tools-form.md 歧义错误码提示")
if failures:
    for f in failures:
        print(f)
    sys.exit(1)

print("characterize-tssc-field-resolution: OK (exact-first + unique-fuzzy + ambiguous pinned)")
