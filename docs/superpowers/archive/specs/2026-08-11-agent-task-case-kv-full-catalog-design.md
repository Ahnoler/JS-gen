# Agent task：案例 KV 文本注入 + 全量阶段目录

Date: 2026-08-11  
Status: approved (user「做」)

## Problem

1. AI 录制下拉忽略案例数据时，曾用 `case_data_store` → `commandValue` 硬绑；产品要求改为：案例 KV **只作为文本**挂在 `agent_task`，由 LLM 理解。
2. `【阶段目录】` 只展示本次勾选录制的阶段，缺少交易上其余阶段，上下文不完整。

## Decision

- **撤回** `apply_case_presets_to_fields` 硬绑（autofill 不再灌 select commandValue）。
- **`format_case_data_hint`**：`_case_scenario_text` 与扁平 KV **同时**附在 agent_task（改掉 `elif`）。
- **`stepData.all_phases`**：来自轨迹 `allPhases` 全量；执行循环仍用勾选 `phases`。
- Preamble 目录优先：提高/调整截断，避免长目录被 `_PREAMBLE_TOTAL_MAX` 裁掉关键阶段。

## Non-goals

- 不删除 `case_data_store` 运行时用途（task_list / save_case_data）。
- 不改变「只执行勾选阶段」的录制行为。
