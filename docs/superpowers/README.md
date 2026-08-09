# superpowers：规格与计划索引

> 状态以表为准。已落地文档在 [`archive/`](archive/README.md)。  
> 活待办：[`backlog-visible-editable-controls.md`](backlog-visible-editable-controls.md)

## 当前主线（勿归档）

| 项 | Spec | Plan | Status |
|----|------|------|--------|
| T4-P0 `scan_editable_summary` | [spec](specs/2026-08-09-scan-editable-summary-design.md) | [plan](plans/2026-08-09-scan-editable-summary.md) | **Approved — ready to implement** |

## 已归档 Implemented（`archive/`）

详见 [`archive/README.md`](archive/README.md)：form-scan / control-ops / select-lazy / xpath-primary / params-replay / capture(T3)。

## 仍开放（留在 `specs/` / `plans/`，勿当 T4）

| Spec | 备注 |
|------|------|
| phase-reviewer / max-steps / overlay-done-gate / visible-errors | 阶段收口 |
| batch-draft-mode / trajectory-step-reorder | 批处理 / 步骤重排 |
| agent-prompt-packs / assistant-mission-context / phase-section-scope / phase-runtime-hardening | Prompt / 阶段作用域 |

对应 plan 若存在，仍在 `plans/`。

## 已废止表述

| 旧说法 | 现说法 |
|--------|--------|
| 「主 Agent 要看见全 DOM」 | **α 业务控件全集**（T4） |
| form-scan Future TODO「full-page Agent DOM」 | **T4-P0…P4**（已归档文内已改指针） |
| 「录制 element 双写未修」 | **T3 Implemented**（archive） |
| 「清单触发 auto-fill」 | **永不**；主 Agent 控制 |
