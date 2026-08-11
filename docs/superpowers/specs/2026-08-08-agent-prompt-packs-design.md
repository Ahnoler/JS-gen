# Agent prompt packs + special-element on-demand — Design

**Date:** 2026-08-08  
**Status:** Updated after conflict review (planner / fallback / hint JS / shim)  
**Note:** `docs/` is gitignored in this repo (local-only).  
**Trigger:** `agent-prompt.md` ~35KB / ~300 行常驻 system，规则重复、关键纪律被淹没；`agent-special-prompt.md` 把法人引入/手机验证焊死在 prompt，与特殊元素库按需复用冲突。

**Related:** assistant-mission-context；phase-section-scope；xpath-primary；`_special_element.py` / `format_special_element_hint`；phase intent contract.

## Decisions (locked)


| Topic | Choice |
| ----- | ------ |
| Approach | **B** — 核心 + 分册，按 `_phase_intent` 在创建 Agent 时装配 |
| Token + compliance | 两者兼顾：核心短且 CRITICAL 置顶；长尾按阶段挂载 |
| `introduce_pick` | 挂**完整** form 册（先简单，不做确认-only 精简） |
| tree 册 | create/modify **默认带上** |
| `agent-special-prompt.md` | **删除**；内容**不迁入**任何分册 |
| 特殊流程知识来源 | 特殊元素库命中候选 + 加厚的按需 hint；system 仅保留通用优先序 |
| 加厚 hint | **同份交付**（与分册同一设计/计划） |
| 无合约 / heal | 装配 **full**（全册拼接）兜底 |
| Planner 对齐 | **同份同步** `planner-prompt.md`：pending 空/错误清空后仍须先终检（若走过助手）再建议 `click_save`，删除「pending=[] → 立即保存」式裸催 |
| 兜底 | `contract is None` / 未知 mode / heal → **full**（非 core-only） |
| Hint 数据源 | **允许改 JS 透传**（`toDisplayCandidates` / 录制下发）补 `phaseDescription`/`remark`；CHANGELOG 按 `src/services` 规则记录 |
| `agent-prompt.md` | **保留薄 shim**：默认 = full 装配；旧表征/外部引用逐步迁移到 assembler |


## Goals

1. 降低每阶段 system prompt token（navigate/query 目标 ≤ 现全文 ~50%；create/modify ≤ ~70%）。
2. 提高遵守率：保存 / xpath / 助手终检 / 阶段边界 / section 在 core 置顶且各只写一次。
3. 去掉刚性「法人/手机」专项规则；复杂引入流程按阶段候选按需出现，提高 `use_special_element` 命中与理解。
4. 保持行为契约：助手草稿 → `needs_agent` → 终检 → `click_save`（来自既有 mission-context 设计）。


## Non-goals

- 改 `use_special_element` 执行语义或控制面 schema。
- 为 `introduce_pick` 单独做确认-only 精简册（可后续迭代）。
- 按关键词动态挂 tree（本期 create/modify 默认带）。
- Mid-run 热替换 system（每阶段已新建 Agent，装配一次即可）。
- 把 special-prompt 逐步流程抄进任务 hint（hint 描述候选，不教手搓放大镜步骤）。
- 全文重写 form-prompt / heal（heal 仅去掉对已删文件的依赖若有；heal 已有「有候选则 use_special_element」一句即可）。**Planner 例外**：见 Decisions — 本期同步 planner-prompt 的保存建议口径。


## Rationale — why delete `agent-special-prompt.md`

- 库内操作组才是流程真相；命中后 `use_special_element(id)` 执行步骤。
- 每阶段已通过 `format_special_element_hint` 注入【特殊元素库候选】（任务侧按需）。
- special-prompt 教手搓 `click_adjacent_button → fill → 查询 → radio`，与「优先复用库」抢注意力，并绑死标签/key。
- 删除后：未入库流程不再有 prompt 兜底 → 靠库覆盖或旁钮 + 人工（刻意取舍）。


## Pack layout


| File | Role |
| ---- | ---- |
| `scripts/prompts/agent-core.md` | 角色、JSON 响应、≤15 行 CRITICAL 清单、阶段边界、业务数据≠案例、完成规则、通用特殊元素优先序 |
| `scripts/prompts/agent-tools-common.md` | 通用动作一行签名 |
| `scripts/prompts/agent-tools-form.md` | fill/select/radio/date、assistant、`needs_agent`/终检、section、pending、保存错误码、短示例 |
| `scripts/prompts/agent-tools-table.md` | 表格行按钮/radio、图标按钮 |
| `scripts/prompts/agent-tools-tree.md` | `select_tree_option` 细节 |
| `scripts/prompts/agent-prompt.md` | **薄 shim**：内容 = full 装配结果（或等价 include 链），供旧表征与人工阅读；运行时以 `build_agent_system_message` 为准 |
| `scripts/prompts/agent-special-prompt.md` | **删除** |

**写法原则**

1. Core 开头 CRITICAL 清单置顶（click_save、xpath、助手草稿终检、阶段边界、section、特殊元素优先序）。
2. 工具册：签名 + 一行用途；细则只在一册出现一次。
3. 从现文件**去重迁移**，不发明新政策；mission-context 终检文案进 form 册 + core 一句。
4. 禁用+旁钮：有【特殊元素库候选】匹配 → `use_special_element`；否则 `click_adjacent_button`；禁止编造 id。


## Assembly matrix

`agent_utils.build_agent_system_message(contract=None) -> str`

| 条件 | Packs |
| ---- | ----- |
| `mode` ∈ login / navigate / query | core + tools-common + tools-table |
| `mode` = introduce_pick | core + common + table + **form（完整）** |
| `mode` ∈ create / modify（含 `allow_form_assistant`） | core + common + form + table + **tree** |
| heal / `contract is None` / 未知 mode | **full** = 上述全部册 |

`session_runner` 创建 `Agent` 时：

```text
override_system_message=build_agent_system_message(get_phase_intent(...))
```

保留 `OVERRIDE_SYSTEM_MESSAGE = build_agent_system_message(None)`（full）供非 session / 默认导入路径。


## Special-element hint enrichment（同份）

**现状：** hint 仅 `id / name / tag / steps / reasons`。

**目标：** 在**不教手搓步骤**的前提下，让模型理解「何时用哪个 id」。

**Hint 每条尽量包含（有则写、无则跳过）：**

| 字段 | 来源（候选 dict 已有或可透传） |
| ---- | ------------------------------ |
| id, name | 现有 |
| tag / dictLabel | 现有 |
| matchReasons | 现有（可略增条数上限，如 5） |
| stepCount | 现有 |
| phaseDescription / remark / stepSummary | 消费候选上已有字段；`toDisplayCandidates` 今日含 `stepSummary` 但**未**带 `phaseDescription` — **本期允许改 JS 透传**（`toDisplayCandidates` 或录制下发处）补上 `phaseDescription`/`remark`（无新表结构），以便 hint 加厚；CHANGELOG 按 `src/services` 规则记录 |
| 短引导句 | 固定文案：「页面状态匹配时优先 `use_special_element(id)`，不要手写逐步引入」 |

**仍禁止：** 在 hint 里展开逐步 click/fill 脚本（那是库执行的事）。

**表征：** 带 `phaseDescription`/`stepSummary`/`remark` 的假候选 → hint 含该文案；空 store → 空字符串；引导句存在。


## Code touch map


| Area | Change |
| ---- | ------ |
| `scripts/agent_utils.py` | `build_agent_system_message`；`{{include}}` 解析保持；导出 full 默认 |
| `scripts/session_runner.py` | 按合约装配传入 `override_system_message` |
| `scripts/actions/_special_element.py` | 加厚 `format_special_element_hint` |
| `scripts/prompts/planner-prompt.md` | 同步：终检后再保存；特殊元素优先序与 Agent 一致 |
| `src/services/special-element-search-service.js`（或录制下发处） | 透传 `phaseDescription`/`remark`（若缺） |
| `scripts/prompts/*` | 新分册；删 special；`agent-prompt.md` 薄 shim |
| `AGENTS.md` / `CLAUDE.md` | 提示词表更新 |
| Characterization | 新 packs + hint；旧读单文件测试改为装配结果或 core+form |
| `CHANGELOG.md` | Unreleased Changed；Python 同步提示：无（scripts） |


## Testing

1. `characterize-agent-prompt-packs.py`：装配长度门槛；navigate 不含助手长文/`needs_agent` 细则；form 装配含终检/`needs_agent`；full ⊇ 子集；无 `agent-special-prompt` 引用。
2. `characterize-special-element-hint.py`（或并入上者）：加厚字段与引导句。
3. 回归：mission-context、phase-section-scope、xpath-primary、form-assistant 全绿；planner 表征（若有）更新为「终检后保存」。
4. 可选：日志打印本阶段 pack 名与 char 长度，便于实跑对比。


## Success criteria

- navigate/query system 明显短于今日全文；create/modify 去重后短于今日且含终检契约。
- Repo 内无 `agent-special-prompt.md`；无 `{{prompts/agent-special-prompt.md}}`。
- 有候选时 hint 比今日更易理解「为何命中 / 何时调用」；模型仍被引导用 id 而非手搓。
- 既有表单/section/xpath/mission 表征通过。


## Rollout note

- 分册迁移易漏句：以「行为契约清单」对照现 `agent-prompt.md` 做一次 diff 审查（计划阶段 checklist）。
- 若实跑发现 introduce 缺树能力，再把 tree 扩到 introduce_pick（本期默认不带 tree 于 login/nav/query）。


## Open follow-ups (out of this delivery)

- introduce_pick 确认-only 精简 form 册。
- 若透传已含 description 仍理解差，再考虑 hint 模板实验（A/B），非本期。
- 旧表征完全迁离 `agent-prompt.md` 后，可再评估是否删 shim（本期保留）。
