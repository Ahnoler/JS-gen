# Archive — Implemented specs & plans

已落地、不再作为当前实施入口的设计/计划。**保留作决策记录**；活待办见 [`../todo-list.md`](../todo-list.md)，当前实施入口见 [`../specs/`](../specs/) 与 [`../plans/`](../plans/)。

目录结构：`specs/`（规格）、`plans/`(实施计划)、`todos/`（已完成的单点 TODO）。文件按日期命名；本 README 只索引代表性批次，未列出的条目按文件名日期检索。

## 归档批次索引

| 批次 | 工作线 | 条目（specs ↔ plans 同名成对，少数仅单边） |
|------|--------|------|
| 第一波（2026-08-09 迁入） | 控件视野 T3/T4 等早期线 | 见下方成对明细表 |
| 第二波（2026-09-08 迁入） | 830 冲刺与格式对齐 | week-sprint、partition-via-pid |
| | xpath 三源统一 | xpath-unify |
| | 菜单切换与推送链 | menu-switching、menu-landing-pageid、menu-push-d1-d2、ai-menu-pageid-writeback、scan-menu-pageid-capture、intermediate-promote-on-scan、intermediate-menu-activity-split、menu-intermediate-e2e、product-mgmt-flat-mount |
| | Z1-Z8 借鉴收口 | borrow-zcode-browser、batched-actions、dynamic-phase-step-budget、grounding-fallback、screenshot-before-transition |
| | KB 战役（切片→晋升→贯通） | credit-knowledge-base、product-mgmt-kb、customer-mgmt-kb、customer-query-kb、req-doc-kb-import、kb-insights、drafts-promote（plan） |
| | 收官单线 | auth-recording、ghost-pending-prune |
| todos（2026-09-08 移入） | 已完成单点 TODO | auto-grab-fullpage-same-name、remove-legacy-section-chunking、split-form-actions |
| 第三波（2026-09-10 迁入） | 早期已收官：agent 结果协议（引用已删 ctrl-actions 树） | agent-result-protocol（plan） |
| | 早期已收官：消息捕获 MVP 与持久化、JS/Python 改名 | message-capture-mvp（spec）、capture-persistence（plan）、rename-js-python（plan） |
| | 已落地：系统账号同名唯一提示 UX | system-account-name-unique-ux（spec+plan） |
| | 已落地：需求草稿关键数据与流式 UX（引用已删 script-runner.js） | req-draft-keydata-and-streaming-ux（plan） |

## 第一波成对明细

| Spec | Plan | Topic |
|------|------|--------|
| [form-scan-control-first](specs/2026-08-07-form-scan-control-first-design.md) | [plan](plans/2026-08-07-form-scan-control-first.md) | Source B 表格扫描 |
| [control-ops-section-closed-loop](specs/2026-08-07-control-ops-section-closed-loop-design.md) | [plan](plans/2026-08-07-control-ops-section-closed-loop.md) | 分块 + 写闭环 |
| [select-dropdown-lazy-load](specs/2026-08-07-select-dropdown-lazy-load-design.md) | [plan](plans/2026-08-07-select-dropdown-lazy-load.md) | 产品 JS select 懒加载 |
| [xpath-primary-control-ops](specs/2026-08-07-xpath-primary-control-ops-design.md) | [plan](plans/2026-08-08-xpath-primary-control-ops.md) | xpath-primary |
| [xpath-params-replay-audit](specs/2026-08-08-xpath-params-replay-audit-design.md) | [plan](plans/2026-08-08-xpath-params-replay-audit.md) | 回放 params-first |
| [capture-element-from-xpath](specs/2026-08-08-capture-element-from-xpath-design.md) | [plan](plans/2026-08-08-capture-element-from-xpath.md) | T3 element≡params |

文内相对链接若仍写 `docs/superpowers/plans/...`（未带 `archive/`），以本目录实际路径为准。
