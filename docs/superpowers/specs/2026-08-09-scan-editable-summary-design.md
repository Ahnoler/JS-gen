# Design: `scan_editable_summary`（T4-P0 — 业务控件视野）

**Date:** 2026-08-09  
**Status:** Implemented (P0 — single-root via `JS_GET_CONTAINER`; multi-root overlay merge → T4-P1)  
**Backlog:** T4（拆为 P0–P4；本 spec = **P0**）  
**Related:** [archive form-scan](../archive/specs/2026-08-07-form-scan-control-first-design.md) Source A/B/C；[xpath-primary](../archive/specs/2026-08-07-xpath-primary-control-ops-design.md)；[T3 capture](../archive/specs/2026-08-08-capture-element-from-xpath-design.md)；记忆系统；三大问题分析；MCP/灰度计划

## Problem

Agent 缺少**只读、摘要化**的「当前业务表面上可见可编辑控件」清单：现有 `scan_form_fields` / `run_form_assistant` 会写 `task_list` 或触发 auto-fill，在大表单上放大重复填写与入库压力（见 `docs/AI录制三大问题分析.md`）。「看见全 DOM」字面目标不必要且有害；真正需要的是 **α：业务控件全集视野 + 主 Agent 决定写操作**。

## Goals（产品定稿）

1. **α 业务控件全集**：基于 Source A/B/C（+ 后续扩展），不是裸 HTML DOM，也不是第一刀就上 MCP a11y 主路径。
2. **可操作边界**：仅已分类控件 — `input` / `select` / `date` / `radio` / `checkbox` / `button` / `tree`（tree 以扫描能分类到的为准；写仍走既有 tree/fill 工具）。
3. **壳层不进清单**：侧栏菜单 / 顶栏导航不进摘要（导航另用菜单类工具）。
4. **清单永不触发填写**：不写 `task_list` / 不调用 auto-fill；填写由主 Agent 控制。
5. **消费者 C**：第一刀 Agent 工具；记忆 Fact Pack 旁路为后续阶段（P2）。

## Non-goals（本 spec / P0）

- 字面全 DOM / 原始 HTML 树作为 Agent 主输入
- Playwright MCP `browser_snapshot` 替换 Element 扫描（属 T4-P4 灰度）
- 记忆 Fact Pack 接线（T4-P2）
- T5 非 el-table 网格、T6 空行首命名、unknown 控件入库
- 修改全局 `JS_GET_CONTAINER` 语义（仅新 action 自带根集合）
- 改回放读序 / DB schema

## Decisions (locked)

| Topic | Choice |
|-------|--------|
| 空间 | 活动容器 ∪ 可见 dialog/drawer/message-box；无 overlay 时主内容区（去壳） |
| 返回 | 仅摘要；`buttons: [{text, section}]`（无 `kind`） |
| 实现 | 新 action `scan_editable_summary`；Python 聚合复用现有 A/B/C 扫描 |
| 扫描可见性 | `quick=true`（可见优先） |
| Auto-fill | 永不触发 |
| Store | 不写 `task_list` / `_scan_fields`（只读） |

## Architecture

```
scan_editable_summary()
    → build root set R (visible overlays ∪ main content sans shell)
    → for each root: evaluate JS_SCAN_FORM_FIELDS(quick=true)  # Source A/B/C
    → merge/dedupe by xpath_smart
    → Python aggregate summary JSON
    → return to Agent (no store write, no autofill)
```

### Summary shape

```json
{
  "container": "dialog:…|drawer:…|main",
  "scope": "active+visible-overlays",
  "total": 0,
  "filled": 0,
  "pending": 0,
  "pending_labels": ["…"],
  "sections": [{ "id": "", "title": "", "pending": 0 }],
  "buttons": [{ "text": "保存", "section": "系统评级结论" }]
}
```

- `text` ← Source C `label`
- `section` ← Source C `section_title`（无则 `""`）
- pending = 未填且未 disabled；disabled 计入 `total` 但不进 `pending_labels`

### Tool boundaries

| Tool | Role |
|------|------|
| `scan_editable_summary` | 只读视野摘要 |
| `scan_form_fields` | 建/刷新 task_list + snapshot |
| `run_form_assistant` | 合约允许时的批量填（与清单解耦） |
| fill/select/date/radio/tree/click_* | 实际写操作 |

## Phasing (T4 全景)

| Phase | Deliverable | Status |
|-------|-------------|--------|
| **P0** | `scan_editable_summary` + prompt + 表征（本 spec） | **已实施**（单根；多根 → P1） |
| **P1** | 多 overlay 合并去重做实；主内容去壳根加固；可选活页冒烟 | 后续 |
| **P2** | 摘要旁路 → memory / Fact Pack（不阻塞主录制） | 后续 |
| **P3** | T5/T6 + 分类扩展；写路径残余（T1r/T8）扩大「可操作∩已分类」 | 后续 |
| **P4** | Playwright MCP a11y 对照/诊断（灰度开关，不替换主路径） | 后续 |

## Prompt

- 填表/找按钮前可先 `scan_editable_summary`
- 用 `pending_labels` + `buttons[{text,section}]` 决策
- 禁止当作 auto-fill 入口
- 壳层导航不依赖本清单

## Verification (P0)

- Characterization: action 存在；不写 task_list / 不调 auto-fill；buttons 形为 text+section
- 既有 form-scan / control-ops / xpath / capture 表征回归 OK
- Optional CDP 活页：有会话再补

## Errors

| Case | Result |
|------|--------|
| 根内无控件 | 合法空摘要 `total=0` |
| evaluate 异常 | 可识别 err 字符串；不改 store |
