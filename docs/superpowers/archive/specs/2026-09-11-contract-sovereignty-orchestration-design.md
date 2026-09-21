# Design: 合约主权编排（Planner / Executor / Reviewer）

**Date:** 2026-09-11  
**Status:** approved (user 2026-09-11)  
**Problem focus:** planner / executor / reviewer 结论冲突、谁说了算不清  
**Chosen model:** A — 合约主权（Contract Sovereignty）

## Problem

JS-gen Python Agent 已具备三层编排：

1. **阶段评审员**（scripts/prompts/phase-reviewer-prompt.md）在阶段前产出执行合约 JSON；
2. **执行 Agent**（browser-use + scripts/controller）按合约操作页面并录制轨迹；
3. **内置 Planner**（planner_interval=3 + scripts/prompts/planner-prompt.md 补丁）在步间给出高层建议。

另有硬门闩：has_contract_success、pending write gate、max_steps / effort 截断等。

痛点不是「没有编排」，而是三层几乎平权：Planner 建议可与合约打架，Executor 的 done() 语义与 Reviewer 的 done_when / success 不对齐，冲突时缺少单一权威链。结果是阶段越界、提前结束、或「看似成功但证据不足」难以归因。

## Goals

- 钉死权威优先级，消除三角色平权冲突。
- done() 只由硬门闩+合约证据裁定，不由 Planner 文案裁定。
- 阶段中默认不改合约；改法只走显式 
econtract。
- 最小侵入：落在现有 _phase_intent / gent/service.py / planner prompt / 工具入口，不重写 browser-use loop。

## Non-goals

- 替换 browser-use 为自研 agent loop。
- 大改轨迹存储 schema、KB 召回、BiB / executor 槽位模型。
- 本设计不改变「Run All Phases」跨阶段产品语义（只规定阶段内权威）。
- 默认开启自动 recontract（可选，默认关）。

## Doctrine（权威链）

**优先级（冲突时）：**  
硬门闩证据 > 合约 JSON > Executor 本步决策 > Planner 建议

| 角色 | 权力 | 不能做 |
|---|---|---|
| **Reviewer（阶段评审员）** | 阶段开始前立法：产出/修订执行合约（mode、in_scope、out_of_scope、done_when、submit、success、effort、estimated_steps） | 阶段中途静默改合约；不调浏览器工具 |
| **Executor（执行 Agent）** | 阶段内唯一行动权：选工具、观察、写轨迹；唯一可*发起* done() 的角色 | 自行扩大 scope；用 planner 意见覆盖合约 |
| **Planner** | 只读顾问：对照合约+历史给 next_steps / 警告 | 裁定阶段结束；改 done_when / out_of_scope；强制换 mode |
| **硬门闩（代码）** | 最终裁判：scope 拒绝、has_contract_success、pending write gate、max_steps | 不做自然语言「再商量一次」 |

铁律：

- Planner 输出若与合约冲突 → 丢弃冲突部分，只保留合约兼容建议（或整段丢弃）。
- Executor 选 out_of_scope 动作 → **工具层直接拒绝**并要求重选，不询问 Planner「行不行」。
- Planner 文本「我觉得可以结束」**永远不算完成**。

## Conflict detection

可机器判定的三类信号（进观测，不自动改合约）：

1. **Planner ⇄ 合约**：建议动作落在 out_of_scope；或建议结束但 done_when / submit.required 未满足；或 progress 声称完成但硬门闩未过。
2. **Executor ⇄ 合约**：工具调用被 scope 拒绝；连续同参重试；对 submit.via 以外的保存路径（如 index 点「保存」）。
3. **证据 ⇄ 成功契约**：Executor 调了 done()，但 has_contract_success / pending write gate 失败；或 success.kinds 要求的证据缺失。

观测建议统一字段：phase_state、contract_version、uthority（gate|contract|executor|planner_advisory）、conflict_code（可选）、
emaining[] / missing_evidence[]。

可扩展现有 phase_intent_obs；新增 conflict / done_rejected / 
econtract 事件供 Dashboard 展示（展示≠裁决）。

## done() arbitration

`	ext
Executor 发起 done()
        │
        ▼
硬门闩栈（按序，全过才算阶段成功）
  1. scope：本阶段 in_scope 关键项未勾销？→ 拒绝，返回 remaining[]
  2. submit：submit.required 且未走规定 via/button_text？→ 拒绝
  3. pending write gate：还有未落盘的写操作？→ 拒绝
  4. success 证据：has_contract_success(kinds/evidence)？→ 否则拒绝并带回缺哪类证据
        │
   全过 ──▶ 阶段成功收口（写轨迹边界、发 phase complete）
   拒绝 ──▶ 不结束；把拒绝原因注入 Executor 下一轮观察（结构化，不经 Planner 转述）
`

要点：**拒绝 done 不召开 Planner 复审**。Planner 最多在下个 planner_interval 看到「仍被拒绝」后给兼容合约的 
ext_steps。

## Recontract（唯一改法入口）

默认阶段中 **不改合约**。

| 触发 | 条件 | 结果 |
|---|---|---|
| 人工 / 控制面 | 用户点「重审本阶段」或下发指令 | Reviewer 用同一阶段任务 + 最新页面摘要 + 旧合约重出合约；version +1 |
| 自动（可选，**默认关**） | 同一种硬拒绝连续 ≥N 次（建议 N=2），且拒绝码 ∈ {scope_impossible, success_unreachable} | 同上 |

旧合约进入 contract_history；Executor 立即只认新版本。Planner 上下文清空到「新合约摘要」，避免旧建议残留打架。

## Phase state machine

`	ext
idle
  │ 控制面下发本阶段任务
  ▼
reviewing          ← phase-reviewer 出合约 v1（或 fallback intent）
  │
  ▼
executing          ← Executor 独享行动权；Planner 仅 advisory
  │
  ├─ tool_rejected（scope/路径违规）→ 仍留 executing，注入拒绝原因
  ├─ done_rejected（门闩未过）    → 仍留 executing，注入 remaining/缺证
  ├─ recontract（显式/可选自动）  → reviewing（合约 vN+1）
  ├─ cancelled / budget_exhausted → terminal_failed
  └─ done_accepted（门闩全过）    → terminal_success
`

跨阶段：	erminal_success → 下一阶段 
eviewing。失败是否续跑由控制面既有策略决定。

## Planner demotion (concrete)

- 可保留 planner_interval=3，但输出增加强制字段：compatible_with_contract: bool。
- 运行时若 compatible_with_contract=false，或建议触碰 out_of_scope → **整段建议丢弃**，仅 challenges 可进日志。
- 禁止 Planner 文案把「调用 done() / 结束阶段」写成可执行指令；若出现，归一成警告：「尚不满足 done 门闩：…」。
- Executor system 明确：忽略与合约冲突的 planner 段落。
- 更新 scripts/prompts/planner-prompt.md 与 PLANNER_SYSTEM_PROMPT 补丁语义：从「可执行纠偏」改为「只读顾问」。

## Code landing (minimal)

| 落点 | 现状 | 改动 |
|---|---|---|
| scripts/controller/actions/_phase_intent.py | apply/get contract、success/gate | 收口为唯一权威 API：get_active_contract()、alidate_done(contract, state) -> Accept\|Reject(reasons)、is_action_in_scope(...)；合约带 ersion |
| scripts/agent/service.py | 阶段前 reviewer → Agent；续跑看 gate | done 回调只走 alidate_done；拒绝原因写入下一步观察；recontract 时重建 system/contract，不热改半套 |
| scripts/agent_utils.py + prompts/planner-prompt.md | Planner 补丁偏可执行纠偏 | 强制 compatible_with_contract；冲突建议丢弃；去掉可执行「建议 done」语气 |
| scripts/controller/service.py + actions 入口 | 工具直接执行 | 写路径/导航类动作前 is_action_in_scope；click_save 对齐 submit.via；违规 → 结构化拒绝（不调 LLM） |
| 控制面 / WS | phase_intent_obs 等 | 增补 conflict / done_rejected / 
econtract；Dashboard 只展示 |

## Acceptance

1. Planner 建议 out_of_scope 动作时，执行路径零采纳（冷表征可钉）。
2. Executor done() 在缺 success 证据时必拒，且下一轮观察含结构化 missing_evidence。
3. 无 
econtract 事件时，阶段中合约字节不变（version 单调）。
4. 湿测一条多阶段录制：阶段边界只出现 reviewer 立法；阶段中冲突只出现 gate 拒绝或 advisory 日志。

## Risks

- Planner 降权后，中途纠偏变弱 → 依赖更好的阶段合约与工具级拒绝文案。
- in_scope 勾销若过于字面，可能误拒合法完成 → alidate_done 需与现有 done_when / success kinds 对齐，避免双重标准。
- 工具入口全面加 scope 检查可能误伤 heal 模式 → heal 路径显式 bypass 或独立 contract（沿用现有 heal_mode 分支）。

## Open questions (resolved in brainstorm)

- 权威模型：选 A 合约主权（非 B 仲裁器 / 非 C 纯事后评审）。
- 自动 recontract：默认关。
- done 拒绝后：不召开 Planner 复审。

## Implementation note

本文件仅设计定稿候选。用户审阅通过后，再按 docs/superpowers/plans/ 惯例拆实现计划（TDD / characterization pins 优先）。
