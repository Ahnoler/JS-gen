# Agent 协作日志

## 2026-09-11 00:05 · Cursor Lead — 收工：done_rejected 专项补跑（回链 23:32）

- 完成：r1 traj **755**（弹窗挡/零动作）；r2 traj **756** 阶段2 合约已 `create`+`submit.required=True`+`toast_ok`；触发 Premature done pending_fields + budget extend；终态 failed/27 步
- 验收：**字面 `done_rejected` 未捕获**（事件只走 stdout JSON/WS，stderr 无）；报告已增补专项节
- 遗留：若要钉字面事件，需订阅 agent stdout 事件流（或另刀 stderr echo）

## 2026-09-11 23:32 · Cursor Lead — 开工：合约主权 done_rejected 专项湿测

- 进行中：2026-09-11 23:32；验收=stderr 出现字面 `done_rejected authority=gate` + `missing_evidence`（或 `success_unmet`/`submit_required`）
- 范围：录制 API、报告增补、本文件；不改运行时代码
- 方式：对公客户管理多阶段；阶段指令诱导未保存即 done；盯 executor 日志

## 2026-09-11 23:20 · Cursor Lead — 收工：合约主权 Task 8 湿测（回链 23:10 开工）

- 完成：启控制面+LMY executor；traj **754** 三阶段 AI 录制（客户信息查询+表单填查）→ `recorded` 8 步；detach ok；报告 `docs/superpowers/reports/2026-09-11-contract-sovereignty-wet.md`；todo 挂起条收口
- 验收：阶段边界 `phase_reviewer ok … phase_intent=True` ×3；阶段2 Premature done（formErrors 请选择客户类别）forcing continue；**未**见字面 `done_rejected`/planner discard
- 遗留：若要钉 `done_rejected`/`missing_evidence` 字面观测，另跑缺 success 证据的 done；服务仍在跑（未停）

## 2026-09-11 23:10 · Cursor Lead — 开工：合约主权 Task 8 湿测

- 进行中：2026-09-11 23:10；验收=多阶段 AI 录制 + form save；阶段边界 reviewer version；冲突仅 advisory/gate；报告 `docs/superpowers/reports/2026-09-11-contract-sovereignty-wet.md`
- 范围：启停控制面/执行机日志、录制 API 调用、湿测报告、todo-list 挂起条、本文件；**不改**运行时代码
- 禁入区：`classify.py`、他线 WIP、合约主权实现代码回改
- 方式：启动服务 → prepare/start 多阶段录制 → 查日志/obs → 写报告


## 2026-09-11 15:50 · Cursor Lead — 收工：remove local BiB mount (SDD)（回链 15:25 开工）

- 完成：`1455185c` RED pin → `8ee479ed` 删 `ensureGlobalBrowser` → `2a9a7e3e` 本地 CDP attach 掏空 + phase-highlight 去 `getAttachedCdpClient` + pin slicer 修 → `99d91f8b` docs；plan `2026-09-11-remove-local-bib-mount`
- 验收：冷 pin `characterize-remove-local-bib-mount` + `characterize-executor-only-bib` **GREEN**；各任务 SDD review ✅
- 湿测：本机控制面在线但 executor `2f21bad1-…` **not connected** → resolve 678 500；移交：重启 `npm run executor` 后复验 prepare/attach/resolve
- 遗留 minor：`persist-live.js` 仍写 global-browser stdout fan-out（注释）

## 2026-09-11 15:25 · Cursor Lead — 开工：remove local BiB mount (SDD)

- 进行中：2026-09-11 15:25；验收=冷 pin GREEN + ensureGlobalBrowser/本地 CDP attach 物理删除；executor BiB 仍可用
- 范围：`src/routes/browser-session/global-browser.js`、`register.js`、`src/cdp/remote-bridge/index.js`、`phase-highlight-screenshot.js`、cold pins、`characterize-llm-role-env.py`、page-level screenshot pin、verify-all（仅本 pin 行）、todo-list、README、本文件；plan `docs/superpowers/plans/2026-09-11-remove-local-bib-mount.md`
- 禁入区：`classify.py`、他线 verify-all WIP、整删 `remote-bridge/`、`state.globalBrowser` 字段迁移、`.cursor/`
- 方式：SDD Task1–5；子智能体不 commit，主会话审查后代提交

## 2026-09-11 · Cursor Subagent — 收工：挂载功能列 docs 收口（Vue `90ee152` · `2750958` · `477db1d`）

- 完成：JS-gen mount-function spec/plan 标已实现 + §6 勾选；`2026-09-09` §6.4 spec 交叉引用 overrides 改由挂载列
- 遗留：4097 重启 + product-mgmt 湿测（多行不同挂载 overrides）

## 2026-09-11 09:10 · Cursor — 收工：合约主权 Task 7（verify-all 注册）（回链 09:00 开工）
- 完成：`verify-all.sh` 在 `characterize-phase-reviewer-flow` 旁登记 `characterize-contract-sovereignty` / `characterize-planner-advisory-filter` / `characterize-phase-done-validate`；spec 仍为 `approved`（未改 spec 正文）；todo-list 挂起表加 `contract-sovereignty-wet` 指向 plan / PR #34
- 提交：`b5b7b3c5` `test: register contract-sovereignty characterization in verify-all`（开工 `631c8252`）
- 验收：三 pin python3 均 OK；`bash -n scripts/refactor/verify-all.sh` OK；未跑全量 verify-all
- 注意：未动 verify-all 他线 WIP；未做 Task 8 湿测
- 遗留移交：Task 8 湿测清单（执行机 + 多阶段录制 + `docs/superpowers/reports/2026-09-11-contract-sovereignty-wet.md`）

## 2026-09-11 09:00 · Cursor — 开工：合约主权 Task 7（verify-all 注册）
- 进行中：2026-09-11 09:00。执行 plan Task 7 only（回链 Task 6 收工 `7b809bdc` / PR #34）
- 范围：`scripts/refactor/verify-all.sh`（注册 sovereignty / planner-advisory / phase-done-validate pins）、本文件；可选 `docs/superpowers/todo-list.md` 短挂起条；确认 spec status=approved（不改 spec 正文）
- 禁入区：Task 8 湿测；verify-all 他线 WIP 行；运行时代码
- 方式：登记门禁 → python3 跑新 pin + `bash -n`；同分支 `cursor/contract-version-sovereignty-70c5`

## 2026-09-11 08:50 · Cursor — 收工：合约主权 Task 6（explicit recontract）（回链 08:35 开工）
- 完成：`begin_recontract` 落在 `intent_contract.py`（有旧约则 history+1、version+1；无旧约则 `ensure_contract_version`）；`clear_planner_advisory_buffer`；显式触发 `scripts/event_dispatch.py` `event=recontract`（亦接受无 event 时 `type=recontract`）→ emit `recontract` old/new version、清 planner buffer、`build_agent_system_message` 重建并补丁 live Agent
- 提交：`7b809bdc` `feat(phase): explicit recontract bumps contract version and history`（开工 `35e8092a`）
- 验收：`characterize-contract-sovereignty.py` Task1–3+Task6 OK；`characterize-phase-done-validate.py` OK；`characterize-planner-advisory-filter.py` OK；`characterize-phase-runtime.py` / `characterize-phase-reviewer.py` PASS；stdin `_dispatch_event` 烟测 emit `{"old_version":1,"new_version":2}`
- 注意：未开自动 recontract（done/scope/service 续跑不调用 `begin_recontract`）；未改 heal 写入路径；未注册 verify-all（Task 7）
- 遗留移交：Tasks 7–8（verify-all 注册 sovereignty + planner-advisory pins / wet）

## 2026-09-11 08:35 · Cursor — 开工：合约主权 Task 6（explicit recontract）
- 进行中：2026-09-11 08:35。执行 plan Task 6 only（回链 Task 5 收工 `5c30372b` / PR #34）
- 范围：`scripts/controller/actions/phase/intent_contract.py`（`begin_recontract`）、`phase/intent.py` / `_phase_intent.py`（re-export）、`scripts/event_dispatch.py`（显式 `event=recontract` 触发）、`scripts/characterization/cold/characterize-contract-sovereignty.py`（Task6 pin）、本文件
- 禁入区：Tasks 7–8（verify-all / wet）；自动 recontract（重复拒绝不触发）；browser-use 重写；heal-mode 写入路径；他线 WIP
- 方式：TDD fail-first 冷测 version 1→2 + history +1 → helper + 一条 stdin 显式触发；同分支 `cursor/contract-version-sovereignty-70c5`

## 2026-09-11 08:25 · Cursor — 收工：合约主权 Task 5（validate_done wiring + done_rejected）（回链 08:15 开工）
- 完成：`evaluate_phase_done` 纯 helper 落在 `intent_gates.py`（heal bypass + `validate_done`）；拒绝发 `done_rejected`（authority=gate + reasons/remaining/missing_evidence）；观察串复用 `recovery_prescription_message` 并写入 `_done_rejected_observation`；`service.py` 续跑循环 done 接受只走 helper，拒绝不结束、注入 HumanMessage、不召开 Planner
- 提交：`5c30372b` `feat(agent): route phase done through validate_done; emit done_rejected`（开工 `b0d535c7`）
- 验收：`characterize-phase-done-validate.py` OK；`characterize-contract-sovereignty.py` Task1–3 OK；`characterize-planner-advisory-filter.py` OK；`characterize-phase-runtime.py` PASS；`characterize-phase-reviewer.py` PASS；`characterize-phase-intent.py` OK；`characterize-budget-extend.py` OK
- 注意：未重写 browser-use；phase_end 软质量门仍用 `has_contract_success`/`missing_success_token`（runtime pin）；Recorder 既有 premature-done 守卫未改
- 遗留移交：Tasks 6–8 未做（recontract / verify-all / wet）

## 2026-09-11 08:15 · Cursor — 开工：合约主权 Task 5（validate_done wiring + done_rejected）
- 进行中：2026-09-11 08:15。执行 plan Task 5 only（回链 Task 4 收工 `57d1dbd8` / PR #34）
- 范围：`scripts/controller/actions/phase/intent_gates.py`（`evaluate_phase_done` 纯 helper）、`scripts/controller/actions/phase/intent.py` / `_phase_intent.py`（re-export）、`scripts/agent/service.py`（done 接受接线）、`scripts/characterization/characterize-phase-done-validate.py`（新建）、本文件
- 禁入区：Tasks 6–8（recontract / verify-all / wet）；browser-use 重写；heal-mode 写入路径；他线 WIP
- 方式：TDD fail-first pin → helper + service 接线；拒绝发 `done_rejected`、注入 Executor 观察、不召开 Planner；同分支 `cursor/contract-version-sovereignty-70c5`

## 2026-09-11 07:55 · Cursor — 收工：合约主权 Task 4（Planner advisory + filter）（回链 07:45 开工）
- 完成：`filter_planner_advice` 入 `agent_utils.py`；`planner-prompt.md` JSON 强制 `compatible_with_contract`，done/save 口气改为 advisory warning；pin `characterize-planner-advisory-filter.py`
- 提交：`57d1dbd8` `feat(agent): demote planner to advisory with compatible_with_contract filter`（开工 `96439bf9`）
- 验收：`characterize-planner-advisory-filter.py` OK；`characterize-contract-sovereignty.py` Task1–3 OK；`characterize-agent-prompt-packs.py` OK；`characterize-phase-intent.py` OK
- 注意：browser-use 不暴露 planner JSON 消费点，本刀未改 `agent/service.py` 运行时丢弃（避免重写 browser-use）。未来接线点=`scripts/agent/service.py` `Agent(..., extend_planner_system_message=PLANNER_SYSTEM_PROMPT)` 旁，若库侧出现 planner 输出回调再 `filter_planner_advice(advice, get_active_contract(bd))`
- 遗留移交：Tasks 5–8 未做

## 2026-09-11 07:45 · Cursor — 开工：合约主权 Task 4（Planner advisory + filter）
- 进行中：2026-09-11 07:45。执行 plan Task 4 only（回链 Task 3 收工 `5b86d6b1` / PR #34）
- 范围：`scripts/prompts/planner-prompt.md`、`scripts/agent_utils.py`（`filter_planner_advice`）、`scripts/characterization/characterize-planner-advisory-filter.py`（新建）、本文件
- 禁入区：Tasks 5–8（service done 接线 / recontract / verify-all / wet）；browser-use 重写；heal-mode；他线 WIP
- 方式：TDD fail-first pin → filter + prompt 降权；同分支 `cursor/contract-version-sovereignty-70c5`

## 2026-09-11 07:40 · Cursor — 收工：合约主权 Task 3（is_action_in_scope submit-via）（回链 07:30 开工）
- 完成：`is_action_in_scope` 落在 `intent_gates.py`，拒绝码 `submit_via_violation` 与 `should_block_index_submit` 同判定；`click_action_engine.click_element_by_index` 实接线；re-export `_phase_intent.py`；冷测 pin 扩 Task3
- 提交：`5b86d6b1` `feat(phase): is_action_in_scope gate for submit-via violations`（开工 `d06adc87`）
- 验收：`characterize-contract-sovereignty.py` Task1+Task2+Task3 OK；`characterize-phase-intent.py` OK；`characterize-phase-reviewer.py` PASS
- 注意：无合约 / `_heal_mode` 或 `_heal_contract.mode==heal` → 放行；未改 heal-mode 写入路径；未做 out_of_scope NLP
- 遗留移交：Tasks 4–8 未做

## 2026-09-11 07:30 · Cursor — 开工：合约主权 Task 3（is_action_in_scope submit-via）
- 进行中：2026-09-11 07:30。执行 plan Task 3 only（回链 Task 2 收工 `f1008153` / PR #34）
- 范围：`scripts/controller/actions/phase/intent_gates.py`、`scripts/controller/actions/phase/intent.py`、`scripts/controller/actions/_phase_intent.py`、`scripts/controller/actions/click_action_engine.py`（一处实调）、`scripts/characterization/cold/characterize-contract-sovereignty.py`、本文件
- 禁入区：Tasks 4–8；heal-mode 行为改写（仅允许 heal 合约放行）；NLP out_of_scope；KB；browser-use 重写；他线 WIP
- 方式：TDD fail-first → wrap `should_block_index_submit` → click 路径接线；同分支 `cursor/contract-version-sovereignty-70c5`

## 2026-09-11 07:25 · Cursor — 收工：合约主权 Task 2（validate_done 硬门闩栈）（回链 07:16 开工）
- 完成：`DoneDecision` + `validate_done` 落在 `intent_gates.py`，包裹现有 `overlay_blocks_done` / `has_contract_success` / `check_pending_write_gate` / submit.required；re-export `_phase_intent.py`；冷测 pin 扩 Task1+Task2
- 提交：`f1008153` `feat(phase): validate_done authority stack for contract sovereignty`（开工 `8f683003`）
- 验收：`characterize-contract-sovereignty.py` Task1+Task2 OK；`characterize-phase-intent.py` OK；`characterize-phase-reviewer.py` PASS
- 稳定拒绝码（未完成 create）：`reasons=('submit_required','success_unmet')`，`missing_evidence=('toast_ok',)`
- 注意：`remaining=()` — 代码库没有 in_scope 勾销清单，本刀不另造 checklist；`index_submit_blocked` 需要 click 上下文（btn/overlay），`validate_done` 不发明；`overlay_blocks` 仅当 store 已有 overlay/error 快照（live overlay 仍由 recorder 探 DOM）
- 遗留移交：Tasks 3–8 未做

## 2026-09-11 07:16 · Cursor — 开工：合约主权 Task 2（validate_done 硬门闩栈）
- 进行中：2026-09-11 07:16。执行 plan Task 2 only（回链 Task 1 收工 / PR #34）
- 范围：`scripts/controller/actions/phase/intent_gates.py`、`scripts/controller/actions/phase/intent.py`、`scripts/controller/actions/_phase_intent.py`、`scripts/characterization/cold/characterize-contract-sovereignty.py`、本文件
- 禁入区：Tasks 3–8（is_action_in_scope / planner demotion / service wiring / recontract / verify-all / wet）；heal-mode；KB；browser-use 重写；他线 WIP
- 方式：TDD 冷测 fail-first → wrap 现有 gates → pin PASS；同分支 `cursor/contract-version-sovereignty-70c5`

## 2026-09-11 06:35 · Cursor — 收工：合约主权 Task 1（version + get_active_contract）（回链 06:20 开工）
- 完成：冷测 pin `scripts/characterization/cold/characterize-contract-sovereignty.py`；`get_active_contract` / `ensure_contract_version` / `append_contract_history` 落在 `intent_contract.py`；`apply_phase_contract` 与 reviewer `normalize_reviewer_payload` 盖 `version>=1`；存储键仍为 `_phase_intent`；re-export `_phase_intent.py` + `phase/intent.py`
- 提交：`bfe0336d` `feat(phase): contract version + get_active_contract for sovereignty`（回链开工 `66bac2f0`）
- 验收：`python3 scripts/characterization/cold/characterize-contract-sovereignty.py` → Task1 OK；`python3 scripts/characterization/cold/characterize-phase-intent.py` → OK；`characterize-phase-reviewer.py` / `characterize-phase-save-cue-promote.py` PASS
- 遗留移交：Tasks 2–8 未做（validate_done / scope / planner demotion / service wiring / recontract / verify-all / wet）
- 注意：未改 heal-mode、未碰他线 WIP、未重建 CHANGELOG.md

## 2026-09-11 06:20 · Cursor — 开工：合约主权 Task 1（version + get_active_contract）
- 进行中：2026-09-11 06:20。执行 `docs/superpowers/plans/2026-09-11-contract-sovereignty-orchestration.md` **仅 Task 1**
- 范围：`scripts/characterization/cold/characterize-contract-sovereignty.py`（新建）、`scripts/controller/actions/phase/intent_contract.py`、`scripts/controller/actions/_phase_intent.py`、`scripts/controller/actions/phase/intent.py`（re-export）、必要时 `scripts/controller/actions/phase/reviewer.py`（normalize 盖 version）、本文件
- 禁入区：Tasks 2–8（validate_done / is_action_in_scope / planner demotion / service wiring / recontract / verify-all / wet）；heal-mode；他线 WIP（classify.py、verify-all form-engine-scope-audit、browser-use 重写）
- 方式：TDD 冷测 fail-first → 最小 API → pin PASS；子智能体不派发


## 2026-09-11 · Grok Bot · 开场+收工：合约主权编排实现计划

- 范围：新建 docs/superpowers/plans/2026-09-11-contract-sovereignty-orchestration.md；spec 状态 → approved；**不改**运行时代码
- 结论：用户审阅通过 design spec，按 writing-plans 拆 Task1–8（version / validate_done / scope / planner demotion / service wiring / recontract / verify-all / wet）
- 他线 WIP 未携带
- 下一步：用户选 subagent-driven 或 inline 执行计划


## 2026-09-11 约 06:00 · Grok Bot · 开场+收工：合约主权编排 design spec

- 范围：docs/superpowers/specs/2026-09-11-contract-sovereignty-orchestration-design.md（新建）；本刀**不改** scripts/ / src/ 运行时
- 结论：用户确认权威模型 A（合约主权）及三段设计（权威边界 / 冲突与 done 仲裁 / 状态机与落点）；写成 draft spec 待用户审阅
- 方式：对话定稿 → 写 spec → 本条目；他线 WIP 未携带
- 状态：等待用户 review spec；通过后再写 plans/


## 2026-09-11 10:40 · Cursor Lead — 收工：resolve placeholder-only「搜索关键字」(SDD)（回链 10:22 开工）

- 完成：`228d2b62` 红测 pin + verify-all 注册 → `6c77c363` inventory bare placeholder（`page-locator-helpers.js` + gen `_locator_helpers_js.py`）→ `1bbfb9ef` needle placeholder fallback（`resolve-by-label.js`）
- 验收：`node scripts/characterization/cold/characterize-resolve-placeholder-search.mjs` **GREEN**（4/4）；`characterize-resolve-inventory.mjs` OK；verify-all 含 `characterize-resolve-placeholder-search` 行（`form-engine-scope-audit` WIP 行保留）
- 遗留：**湿测需执行机 restart** 加载新 JS——重启前 traj 678 resolve 仍返回旧「找不到」；重启后复验 sidebar「搜索关键字」inventory/needle
- 文档：todo-list 挂起表 `resolve-placeholder-search` → P3 已闭；本条收工

## 2026-09-11 11:05 · ZCode 引擎线 — 报告增补 §9 湿测收尾门 + tssc 分形态复核（回链 09:30）

- 用户两项指示落档：①tssc_multi_select 复核=字典形态✅（handle_select_click 零改动可跑）/远程表格形态❌（面板只等 .el-select-dropdown__item 10s 超时，须移植 JS_TSSC_MULTI_SELECT 过滤静置）——矩阵行更正+批 4 加 tssc 表格分支（857f16df）；②报告新增 §9 真实业务场景端到端湿测=**本线验收收尾门**：L1 每批收尾即跑（18 操作单操作 payloadJson 场景清单+判据=业务结果成立），L2 端到端全链（录制→推送 ATP→下发→执行→整案 paas，18 操作各至少一次）；执行纪律五条（就地归因/同事主干只记录/平台未就绪须降级标注/产物落 tmp/tansun-wet/审批推进须授权）
- 本单元只提交 agent-log+报告两文件，tansun 仓未动；他线 WIP 未触碰

## 2026-09-11 09:30 · ZCode 引擎线 — 同事新提交重评估，周末实装计划同步更新（回链 00:05 改期）

- 完成：同事已推送 1bf04f0「补充操作事件」（+1385 行：radio.py 206 行/select_tree.py 918 行/click.py 重写+248 行/enums+payload+registry）+5e12ff1「修改配置」（config 默认值=同事环境，勿动）——逐文件审阅后报告新增 §8 重评估：radio（双注册+object_value or value+absent=skip+布尔伪成功已堵）/select_tree 三 event（`_EVENT_ALIASES` 把 select:tree 归一到 select_tree_option）/click 兜底三层（G1+icon+ambiguous 防盲点）全落地；全量 pytest 216 passed（test_agent_e2e 4 errors=本机缺浏览器非代码）
- 计划变化（§8.3）：原批 2/3 click 子路由**取消**（同事已做）；批 1 收窄重定义=前缀 helper 四处接线（click button_text/radio label/select_tree label/input hint）+input 值字段；新批 2=七前缀子路径（关闭弹窗/展开树/页签：/表格：/树选：/邻钮：/菜单：，独立 click_subroutes.py，miss 落回同事兜底链）；批 4 不变（date event+select:click 行选——两者仍缺）；批 5 升级=真实 V3 报文打样验证（radio/树三兄弟/alias 桥接）；**硬前提=tree_picker_click 的 path 须 JSON 数组字符串进 objectValue（推送侧 P1 从建议变硬前提）**
- 基线变更：2b22613 → TY_UI_ENGINE_1.0.0（5e12ff1）；实装排期不变（周末），本单元只读调研未动 tansun 仓；只提交 JS-gen agent-log+报告两文件，他线 WIP 未触碰

## 2026-09-11 10:22 · Cursor Lead — 开工：resolve placeholder-only「搜索关键字」(SDD)

- 进行中：2026-09-11 10:22；验收=inventory+needle 命中裸 placeholder input；冷测 GREEN
- 范围：`src/cdp/page-locator-helpers.js`、`src/cdp/resolve-by-label.js`、gen `_locator_helpers_js.py`、cold pin、verify-all（仅本 pin 行）、todo-list、本文件；plan `docs/superpowers/plans/2026-09-11-resolve-placeholder-search.md`
- 禁入区：`classify.py`、他线 verify-all WIP（form-engine-scope-audit）、`.cursor/`、物理删 remote-bridge
- 方式：SDD Task1 红测 → Task2 inventory → Task3 needle → Task4 文档；子智能体不 commit

## 2026-09-11 10:12 · Cursor Lead — 收工：executor-only BiB 1+2+3 门闩（回链 10:05 / `72a35f70`）

- 完成（待用户许可再 commit 代码）：`USE_EXECUTOR` 默认 `true`；resolve 删除本地 `remoteBridge` 分支，false→503；attach/prepare、`attachLive`/`detachLive`/`getLiveStatus`、`POST /api/browser/session` 同门闩；README/.env.example/api-docs 改口径；冷测 `characterize-executor-only-bib.mjs` + verify-all 注册
- 验收：`node scripts/characterization/cold/characterize-executor-only-bib.mjs` → OK；touched files `node --check` 通过
- 遗留：①物理删除 `ensureGlobalBrowser` / 本机 remote-bridge 挂载实现（本刀仅 503，文件仍在）②「搜索关键字」placeholder inventory 缺口（另刀）③代码 commit 待用户一声

## 2026-09-11 10:05 · Cursor Lead — 开工：executor-only BiB（1+2 resolve 门闩 → 3 attach/session 门闩）

- 进行中：2026-09-11 10:05；验收=`USE_EXECUTOR` 默认 true + resolve/attach/session 在 false 时 503；true 路径行为不变
- 范围：`config/config.js`、`.env.example`、`trajectory-record-lifecycle.js`、`trajectory-attach-runner.js`、`remote-session-service.js`、`register.js`、README/api-docs、spec/plan、cold pin、本文件
- 禁入区：`classify.py` / `verify-all.sh` WIP、placeholder「搜索关键字」修复（另刀）、物理删除 remote-bridge
- 方式：TDD 冷测 → 1+2 → 3 门闩 → 验收

## 2026-09-11 09:47 · Cursor Lead — 收工：L1c-wet L1C_LLM=true 湿测 PASS

- 完成：回链开工 `f7533a74`；`.env` 开 `L1C_LLM=true` 并重启控制面；classify 低置信 `source=llm` / 二次 `l1d` / 高置信 `rule`；BiB resolve traj 678 inventory 60 hits（本页仅高置信分区）
- 验收：`node tmp/l1c-wet/wet-classify.mjs` exit 0；报告 `docs/superpowers/reports/2026-09-11-l1c-wet.md`
- 遗留：`.env` 现保持 `L1C_LLM=true`（不需要可改回 false 重启）；本页无 other 区故 BiB 未再打出 llm——以共用 classify 服务为准

## 2026-09-11 09:43 · Cursor Lead — 开工：L1c-wet L1C_LLM=true 湿测

- 进行中：2026-09-11 09:43；验收=`L1C_LLM=true` 下低置信 feature card `source=llm`；执行机 LMY online
- 范围：`config/.env`（开 L1C）、`tmp/l1c-wet/` 报告、todo-list、本文件；不改 classify.py / verify-all WIP
- 禁入区：fill/select、`.cursor/`、他线 WIP
- 方式：开 env → 重启控制面 → API classify 对照 → BiB/resolve 或 scan 路径证据 → 收工

## 2026-09-11 06:45 · Zcode — 收工：KB 价值 A/B 全线 T0–T5 完成（回链 02:35 开工；结论=③证据不足 +8.3pp）

- **完成（提交链）**：pilot 4/4（`ea5d04c9` 含天花板触发→manifest v1.1 难度锚重冻）→ **正式 24 run（727–750）全落地** → T2/T3 证据+引擎+门禁（`cf1751e6`）→ lint 清零（`c1ef3ad7`）→ runlog 收尾（`5af3ab23`）→ 清理终局（`e82bad07`）→ **T4 报告+P5/P6 修复（`9bda883c`）** → 本条 T5
- **验收证据**：正式批 A 5/12（41.7%，Wilson [0.193,0.680]）vs B 6/12（50.0%，[0.254,0.746]），差 +8.3pp；配对结局 A 独赢 2 / B 独赢 3 / 双成 3 / 双败 4；n=12/臂按冻结口径只接受大效应（≥30pp）→ **结论三类之③「证据不足」**，要下 ±20pp 结论需 n≥40/臂。门禁 `characterize-kb-ab` **GREEN**（形状/配对 12/12/臂平衡/无跨臂污染 ④纯度断言逐字/收数完备 24/24；不设成功率 floor）；证伪×2 各红一次（臂互换→④红、删需求→②红）已贴 `cf1751e6` commit message；`kb-ab-eval` 连跑两次 `cmp` 逐位一致（eval-final/e2 冻结快照入库）；**`src/**` 零改动复核**（`git diff ea5d04c9..HEAD -- src/` = 0 行）
- **B 臂价值形态**（供 KB 线决策）：不是省步数也不是更贴卡（P5 两臂对称：A 48/57 vs B 44/57 按钮命中），而是**把预算内做不完的多腿链路做完**——B 独赢 3 对全是多腿任务（R02 33 步/N02 39 步 vs A 预算耗尽）；单腿任务两臂等价。下一轮若扩 n≥40/臂，建议只留 5 个多腿锚
- **干扰项如实登记**（报告 §6）：744 质量门伪失败（reviewer kinds url_change+toast_ok vs legacy token saved_navigation，legacy `has_contract_success` 缺 boundary 别名表——引擎侧已知 artifact，红线内未改 src）；733/741/742 零步异步降级；739/740 SUT NPE、749/750 评级在途墙=paired 同墙有效对照；747 attempt1 executor WS 1006 半开（aborted 留痕，无副作用非按结果剔除）；731/729/745 HeadersTimeout 已改 fire-and-poll 驱动
- **清理终局**：8 笔新建客户全为「信贷预客户」（SUT 删除入口仅对草稿客户开放，09-07 R1 先例）→ 无法经 UI 删除，留证移交 `cleanup-ledger.jsonl`（custNo 已回填/纠错 746=26091105094428662）+ manifest cleanupLog 终局条目；他人 `KB测…` 零触碰；executor 槽位全释放（remote_session 37 closed+6 crashed 无 live）
- **遗留移交**：①730 墙钟 2143s（卡臂录制长但预算内完成 vs 729 预算 23/23 失败——成本结论依赖卡不是提速）②引擎侧两个候选修复（kind 别名表/零步 navigate 豁免）已写报告 §8 归引擎线排期 ③证伪钩子 `--falsify-arm/--falsify-pair` 保留可复用 ④memory 已更新

## 2026-09-11 02:35 · Zcode — 开工：KB 价值 A/B（方向 2，spec `e6abfdc2`；真机对照实验）+ 覆盖线 E-commit

- **先收覆盖线尾巴**：G-recheck `4baffd25` 判 PASS pending E-commit——E1（`nodeCoverage`→`pageKeyOnCardRate`+退化条件注记：实测 18/18 单 key 构造性退化）+ E3（门禁锁 `fixture.contentSha256===baseline.fixtureSha256`，证伪红/还原绿）+ E4（报告注明 tmp 取证快照非门禁输入）→ `e6bde302`，覆盖线关线
- **A/B 线开工**：spec [`2026-09-11-kb-value-ab-design.md`](specs/2026-09-11-kb-value-ab-design.md) + plan `e6abfdc2`——12 需求×2 臂配对交替录制，测【流程卡模板】提示的价值；自变量唯一（卡由 T0 冻结映射给定，不经召回）；门禁只保协议不设成功率 floor；统计口径 n=12/臂只接受大效应（≥30pp）
- 工作范围：`scripts/kb/kb-ab-manifest.v1.json`、`scripts/kb/kb-ab-setup.mjs`、`scripts/kb/kb-ab-eval.mjs`、`scripts/characterization/characterize-kb-ab.mjs`、`docs/superpowers/reports/2026-09-11-kb-ab-*.md`、`docs/superpowers/todo-list.md`、本文件、`tmp/kb-ab/**`（runlog/证据）；**T0 只读导库**
- 禁入区：`src/**` 零改动、v2 评测集需求（物理隔离）、`data/kb/req/**`、评测集/阈值/`verify-all.sh`、他线 WIP（工作区 Cursor 未提交改动不碰）、库里他人 `KB测…` 遗留数据
- 执行方式：T0→T5 一 Task 一 commit；SUT 写入一律 `KBAB<runId>-` 前缀+只做可回滚操作+逐条清理留证；单条串行固定账号；失败不重试（异常标 `aborted`/`retryOf` 全记录）；臂标记只进 `name` 不进 description；证伪×2 贴 commit message；LLM 走 .env 既有网关
- 风险预告：T2 跑批需起 4097+executor+Chrome 真机——**会先核对 4097 无他线在途录制再起**（记忆红线：engine-wet-trio 未做但那是主链录制前置，本线是独立 A/B 录制不受影响；若 4097 已被占用则顺延并上报）

## 2026-09-11 02:05 · Zcode — 收工：覆盖回溯 T5 小迭代（回链 01:20 开工 `ed2ef2cb`；G 判决 `38e0ef7d` 七项全处置）

- 完成：`ed2ef2cb` 开工 → **`996163e0` D1+D5**：`redactPageKey()` 结构键免 40 守卫（只留 `host#/route`，剥 scheme/page: 前缀+query+dialog/anchor 后缀）+ `extractStructural` 不再截断 + `createdDate`→ISO；fixture 重冻 **v1.1**（sha `33ad3e617280d07f`，key 28 轨迹/110 region 非空=reviewer DB 真值；**回库 314/314 原值 reduce 落入 fixture key 集合**）；门禁 +D1 恢复 pin（≥20 轨迹带 key+key 无 `?`；region.key 免长文本断言）→ **`93c848a5` D3+D2+D4**：primaryCard 改链优先级（`primaryCardMisaligned=24` 与复核数逐位一致）+ 头注释对齐；M5 重建=visited 页面 key↔primary 卡 ROUTE-chain markers 同类比较（`node.enter` 是中文菜单描述非路由、`node.page` 是显示名，均不可比——orderAgreement 废除换 `entryOnCardRate`；上限=`m5.ceiling`）；v2 基线 n=18：**1.000/1.000/0.000/上限 1.000（9 个去重路由的小样本面事实，非 matcher 伪影）**；M5 两项出 floor（engine+gate FLOORS 同步，INFO 行打印；基线 v1.1 `floorPolicy` 记录）→ **`bf2dade8` D6+D8+报告三处必改**：§1 M5 行 v2 重写、D6 ROUTE 精度区间标注（5 泛化片段 ≥10 页，只作模块级归因）、§4 头条**撤回「补 rating 码」**（评级族 6 条 ROUTE 6/6 已映射）换真实缺口（智能控制执行日志 ×3 补 1 marker/查询交易信息 ×2/对私用信 ×2/AILZ ×18）、§6 结论改写（M5 旧「系统性脱节 0.835」=label 词表伪影；轨迹反哺卡节点须待 page_level_key 落值面扩大后重新论证）、§7 复核入口刷新、§8 七项处置台账
- 验收：`characterize-kb-coverage` **4 passed**（shape/脱敏硬断言/M1-M3 floor/D1 恢复 pin）；引擎连跑两次逐位一致（data plane）；`--baseline` exit 0；他线 WIP（verify-all.sh/classify.py/plans 归档）零触碰；红线零违反（src/** 零改动、SELECT only、评测集/阈值/verify-all/data/kb/req 零改动）
- 提交链：`ed2ef2cb` → `996163e0` → `93c848a5` → `bf2dade8` → 本 commit
- 遗留移交（等 reviewer 三验后关线）：①D1 恢复证据=门禁第 4 pin（28 轨迹）+回库 314/314 ②新 M5 上限分析=`metrics.m5.ceiling`（=1.000，小样本面事实已写入报告 §1/§8）③D8 订正=报告 §4+§8。**实质遗留（Lead/卡治理）**：`page_level_key` 落值面只有产品管理族（录制端结构键铺开另议）；M5 门槛等样本面扩大再议

## 2026-09-11 01:20 · Zcode — 开工：覆盖回溯 T5 小迭代（G 判决 `38e0ef7d` D1/D2/D3/D8 必改 + D4/D5 警告）

- 判决要点：数据面与门禁通过（M1/M2/M3/M4/M6 可用作决策）；M5 作废待重建——D1 根因=40 字守卫误伤结构键 `page_level_key`（库里 47–135 字全被剥成 null，fixture 2408 region key 全空）；D2=M5 饱和（上限 0.1424 的 91.9%）量的是词表非行为；D3=primaryCard 字母序非链优先级（24/69 错配）；D8=报告 §4「补 rating 码」头条是事实错误（那 6 条 ROUTE 链 6/6 已映射）
- 工作范围（T5 五小步，一 commit 一改）：`scripts/kb/coverage-snapshot.mjs`（D1 结构键免守卫+key 剥 query 存 `host#/route`；D5 createdDate→toISOString）→ 重冻 `scripts/characterization/fixtures/kb-coverage.v1.json` + 基线（**回库验证 key 非空比例**，预期覆盖 28 轨迹）→ `scripts/kb/kb-coverage.mjs`（D3 primaryCard 链优先级+重建 M5=page_level_key 页面序列↔卡 nodes[].page 同类比较+上限分析+卡外页面清单）→ `scripts/characterization/characterize-kb-coverage.mjs`（D4：M5 两项出 floor 改 informational）→ `docs/superpowers/reports/2026-09-11-kb-coverage-retro.md` 三处必改（§1 M5 行/§4 头条换真实缺口族/§6.3 改写）+ D6 ROUTE 精度标注 + `docs/superpowers/todo-list.md` + 本文件 + `tmp/kb-coverage/**`
- 禁入区：他线 WIP（工作区有 Cursor 未提交改动：`scripts/refactor/verify-all.sh`、`scripts/controller/actions/phase/classify.py`、plans/specs 归档移动等——**不碰不混 commit**）、`src/**` 零改动、评测集/阈值/`verify-all.sh`、`data/kb/req/**`、写库（SELECT only）
- 执行方式：DB 走既有隧道 127.0.0.1:13306（reviewer 后台 job 仍开）；重冻 fixture changeLog 记版本；新 M5 不复用旧数字、上限分析随交付；门禁证伪钩子保留可复用；改完回 reviewer hash 等三验（key 非空比例/新 M5 上限分析/D8 订正）

## 2026-09-11 00:52 · Zcode — 收工：KB 覆盖回溯 T3 报告+T4 台账（回链 00:26 开工 `ca4763b6`）

- 完成：T3（`5b05c5d8`）基线报告 [`reports/2026-09-11-kb-coverage-retro.md`](reports/2026-09-11-kb-coverage-retro.md)——M1–M6 全表（含分母）+ 12 无码卡 + 57 死卡 + 38 陈旧卡清单 + Top20 缺口与页面族 + 结论（KB=少数高频交易深知识非广覆盖；投资方向=做准 27 张活卡+按真实频次补缺口，评级申请族×6 补 rating 卡 ZJJK 码为性价比最高单点）；T4（本 commit）台账：todo-list 新线状态 + 本条收工
- 验收：**报告数值与引擎输出逐位一致**（`node scripts/kb/kb-coverage.mjs --json` 复核 M1 72/84、M2 69/335、M3 27/84 dead 57、M4 266/263、M5 0.131/0.012/0.835 n=64、M6 33/132 stale 38、chains ZJJK 58/FS 0/ROUTE 58、ambiguity 0.101）；`characterize-kb-coverage` **3 passed**（脱敏硬断言+floor lockstep+证伪钩子）；红线零违反（src/** 零改动、SELECT only、评测集/阈值/verify-all/data/kb/req 零改动）
- 提交链：`ca4763b6` 开工 → `8612b6c4` T0 快照 → `c52b929c` sha 确定性修正（capturedAt 剔出内容哈希）→ `dfa3a1c2` T1 引擎 → `d5de67dc` T2 门禁+双重证伪 → `5b05c5d8` T3 报告 → 本 commit
- 遗留移交（reviewer 清单四项，数据均已备齐）：①抽 10 条 fixture 回库比对（白名单字段级）②独立复算 M1/M2/M3/M6（纯离线：fixture+data/kb/flows）③亲手证伪脱敏断言与 floor 各一次（`KB_COVERAGE_FIXTURE`/`KB_COVERAGE_BASELINE` env 钩子，指向 tmp/ 不动冻结件）④确认未用 task 文本匹配、未拿 function_id 当卡片映射。补码/建卡处置归 Lead（属卡治理，非本线）

## 2026-09-11 00:26 · Zcode — 开工：KB 覆盖回溯（方向 A，spec+plan `ecfc4ab6`；只读零产品改动）

- **隧道实证**：本机 13306 已 LISTENING（reviewer 后台 job 同机）且 SELECT COUNT(trajectory)=416 成功——口令问题消解，走标准路径：实施方自产 fixture（reviewer 按抽检流程查），无需 Lead 定口令归属
- 工作范围（**只新增**）：`scripts/kb/coverage-snapshot.mjs`、`scripts/kb/kb-coverage.mjs`、`scripts/characterization/fixtures/kb-coverage.v1.json`、`scripts/characterization/characterize-kb-coverage.mjs`、`docs/superpowers/reports/2026-09-11-kb-coverage-retro.md`、`docs/superpowers/todo-list.md`、本文件、`tmp/kb-coverage/**`（证据）
- 禁入区：`src/**` 零改动（尤其 `flow-card-guided-propose` 在途线）、`data/kb/req/**`、评测集/阈值/`verify-all.sh`、写库（SELECT only）、浏览器/SUT、他线 WIP
- 脱敏铁律：fixture 白名单（spec §3）外键 0、>40 字自由文本 0；`task`/`name`/URL query/`element_json.text`/`params.value`/`extracted_content`/客户名证件号**禁止入库**；`task` 文本不作匹配依据、`function_id` 不作卡片映射
- 执行方式：T0→T4 一 Task 一 commit；映射三链（ZJJK/FS/路由片段）记命中来源；M1–M6 离线可复算+确定性（连跑两次逐位一致）；floor 只升不降（初始 margin 0.05）；脱敏断言与 floor 各证伪一次留痕

## 2026-09-11 00:12 · Zcode — 收工：colloquial-bridge 收尾 F-2/F-5/R-1/台账（回链 00:04 开工 `72691662`；Lead 裁定 `dc31f756`）

- 完成：Task 0（`e4be6513`）F-2 `T2-bridge.txt` 修正入库（+1/−1）+ F-5 生成脚本幂等化（table 字面量对齐 archived 态、两注记原样复制、头注释警示；**幂等以真跑+空 diff 证明**，`entries` sha256 `eb4ec272…` 67 条逐位不变）→ Task 1（`96d12712`）R-1 最小留痕：`readSynonymsAssetStatus()`（未声明→null，历史产物形状不变）+ CLI `result.synonyms.status` 记录 + 非 active stderr 一行告警（**loader 仍不过滤**，加载条数/metrics/阈值/exit code 全未动）+ pin「status is provenance only」三态断言（临时资产写 tmp/）→ Task 2（本 commit）台账对齐：报告 §8 F-2/F-4 行补记 + todo 置 **CLOSED（FAIL，不计成果；F-1/F-3/F-4 关闭，F-2/F-5/R-1 已收口；R-2 词面桥关闭/R-3 BLOCKED/R-4 押后）**
- 验收：`characterize-kb-recall-eval` **6 passed**；`characterize-flow-card-recall` **26 passed**；`--baseline` exit 0；`--synonyms data/kb/colloquial-bridge.json` 复跑六项指标与 `T3-on.json` **逐位相同**（差异仅 generatedAt/gitHead/新增 status 字段/延迟计时；stderr 告警一行留痕 `T3-on.after.stderr.txt`）；铁律零违反（未过滤/未动 metrics/未动 synonyms.json/未动 entries）
- 遗留移交：R-3 数据源在 Lead（可达只读端点或导出样本 ≥500 条/≥5 模块，spec §4.3；go/no-go=配对 ≥200+≥3 模块+盲抽 20 条 ≥60% 口语判真）；无其他

## 2026-09-11 00:04 · Zcode — 开工：colloquial-bridge 收尾（Lead 裁定 `dc31f756`，F-2/F-5/R-1/台账 三 commit）

- 工作范围：`tmp/kb-bridge/T2-bridge.txt`（F-2 入库，force-add）、`tmp/kb-bridge/t2-build-table.mjs`（F-5 幂等化）、`scripts/kb/recall-eval.mjs` + `scripts/characterization/characterize-kb-recall-eval.mjs`（R-1 留痕+pin，**扩围**——不在 23:23 原声明内，特此声明）、`docs/superpowers/reports/2026-09-10-colloquial-bridge-report.md`（§8 对账）、`docs/superpowers/todo-list.md`、本文件、`tmp/kb-bridge/T3-on.after.json`（等价性证据）
- 禁入区：评测集 v1/v2、`data/kb/synonyms.json`、`data/kb/colloquial-bridge.json` 的 `entries`（sha256 `eb4ec272…` 逐位不变铁律）、`verify-all.sh`、`data/kb/req/**`、阈值/loader 过滤、他线 WIP（Cursor L1c-scan-py 线刚收工）
- 执行方式：一 Task 一 commit；R-1 仅留痕+stderr 告警（不改加载条数/metrics/exit code）；pin 临时资产写 tmp/ 不落 data/；幂等性以真跑+空 diff 证明

## 2026-09-10 23:44 · Cursor Lead — 收工：L1c-scan-py scan 接 regions/classify

- 完成：回链开工 `1dc516b4`；新建 `l1c_region_classify.py`（map/apply/HTTP fail-soft）；`scan_editable_summary_impl` 在 `build_editable_summary` 前调用；只写回 `regions[]`
- 验收：`characterize-l1c-scan-py.py` OK；`characterize-scan-editable-summary.py` OK
- 遗留：`L1c-wet` 仍挂（`L1C_LLM=true` + BiB）；冷 pin 未入 verify-all（WIP）；fields `region_*` 不跟 classify（assignRegion id 异源）

## 2026-09-10 23:42 · Cursor Lead — 开工：L1c-scan-py scan 接 regions/classify

- 进行中：2026-09-10 23:42；根因=`scan_editable_summary` 从不调 classify，与 resolve 双消费者规格缺口
- 范围：`scripts/controller/actions/l1c_region_classify.py`（新）、`form_scan_actions.py`、冷 pin、todo-list、本文件
- 禁入区：classify.py、verify-all WIP、fill/select、`.cursor/`、discoverL1 JS
- 方式：map+HTTP fail-soft → 只写回 regions[] → 绿 pin → 收工（L1c-wet 另排）

## 2026-09-10 23:41 · Zcode — 收工：recall-colloquial-bridge G 复核响应（回链 23:23 开工 `d41cb787`；reviewer 判决 `666e0215`）

- 复核结论：**FAIL 成立、处置合规**，2 必改+1 观察+1 Lead 项——收尾 commit `598df438` 逐项落实：F-1 报告改「A 源按抽取规则只取子串对」（规则产物非语料事实，438 对非子串 alias↔alias 普查已登记）；F-2 两裁决脚本 `git add -f` 入库+指向改「汇总原则」；F-3 裁决口径如实记录（规则批量+快速人工 ~7 分钟，B 类 10 条仅 4 条真词法同义=增量 0 部分成因，复用须收紧词法变体）；F-4 表补 `archivedSemantics` 注记（loader 加 status 过滤=口径变更留 Lead，本线零代码改动）
- 验收：pin 归档态复跑 26 passed；判决不变门禁未重跑（5 passed 当前态）；只 stage 本线 4 文件，他线 WIP 未携带
- 遗留：F-4 loader status 过滤 → Lead 决策项；无其他

## 2026-09-10 23:32 · Zcode — 收工：recall-colloquial-bridge T0–T3 未达标按计划归档（回链 23:23 开工 `d41cb787`）

- 完成：T0 基线复现逐位一致+三类素材实证（`024af5bb`）→ T1 抽取器零 import（`3c802f3d`，池 409=卡面 131+需求文档 255+湿测 drift 23）→ T2 双向校验+人工裁决+落表（`3ea6bab5`：**67 条=card 49+req-doc 10+drift 8，A+B 88.1%≥60%/C 11.9%≤40%**，grounding 断言强制回溯 T2-verified 池、drift 全引模块+叶号；+3 pin 后 `characterize-flow-card-recall` **26 passed**）→ T3 on/off 度量（`824967d1`：ON 与 OFF **逐位相同** 0.600/0.725/0.653/0.667/拒答 0.382，**翻转 0 条→全新地面增量 0<4 FAIL；E 层 0.100<0.25 FAIL**；护栏面全绿=零新增 FP/A/B/C/D 不掉/门禁 5 passed/--baseline exit 0）
- 结构性归因：E 层 50 条 query **0 条含任何桥接 term**——语料三类素材全是「领域词↔领域词」措辞变体，E 层是「口语↔领域词」零词面重叠；机制点火已证（A-015/C-013 尾部 top5 收窄、gold top1 不变），但 top1 零翻转
- 处置（按计划未达标路径）：**跳过 T4，`propose.js` 零改动；`data/kb/colloquial-bridge.json` 置 `status:"archived"`**（归档后 pin 仍 26 passed，资产无害保留可续建）；报告 [`reports/2026-09-10-colloquial-bridge-report.md`](reports/2026-09-10-colloquial-bridge-report.md)（漏斗 409→183→44→67 + on/off 全表 + 结构性归因 + 方向 5 净结论：E 层正解=回收口语语料（生产轨迹 LLM 意图描述）或 embedding 立项）
- 遗留：无红线违规（建表期零读评测文件/零 import/零依赖/verify-all.sh 与 data/kb/req 未动/不接线）；scope 门控机制 pin 与 B5 证明保留（将来接线时直接复用）；**本版不计成果**

## 2026-09-10 23:23 · Zcode — 开工：recall-colloquial-bridge 口语桥接（方向 5 重定位实施，B1–B5 已批）

- 工作范围：`scripts/kb/build-colloquial-bridge.mjs`（新建）、`data/kb/colloquial-bridge.json`（新建）、`scripts/characterization/characterize-flow-card-recall.mjs`（+3 pin）、`docs/superpowers/reports/2026-09-10-colloquial-bridge-report.md`（新建）、`docs/superpowers/todo-list.md`、`docs/superpowers/agent-log.md`、`tmp/kb-bridge/**`（证据）；**条件性**含 `src/services/req-draft-traj/propose.js`（仅 T3 五判据全过后的 T4 接线，独立 commit）
- 禁入区：`kb-recall-eval.v2.json` 与 `kb-recall-failures.v1.json`（**建表期物理隔离**，G2 专查）、`data/kb/synonyms.json`（不复活不照抄）、`verify-all.sh`、`data/kb/req/**`（只读素材）、`.cursor/`；工作区他线 WIP 12 项不触碰不携带
- 执行方式：主线程单线 T0→T5 一 Task 一 commit；建表脚本与召回模块零 import；双向校验纯语料 grep 禁跑匹配器；零依赖（不引 BM25/embedding/新包）；只认 v2-new 全新地面增量；未达标→资产 archived 不计成果不接线

## 2026-09-10 23:59 · Zcode — 收工：recall-eval-v2 评测集扩版+门禁切换+T3 重评（回链 22:58 开工 `6e2ceeb7`）

- 完成：T0 盘点+配额表（`d30f273f`）→ T1 v2 骨架脚本搬运 130 条 verbatim（`db4c1582`，保真 diffs=0 130/130 全字段深校验）→ T2 新增 115 条独立标注（`3bc31e8f`：A15/B15/C5/D5/E50/N25，语料出发零匹配器，E 层全词 ban-check，盲态第二标注人复核 E-019/N-034 换靶+9 消歧 note）→ T3 冻结+G1 盲判抽检（`16e6bab0`+`de4ee6a3`：**15 条分歧 1=6.7% ≤10% PASS**，先盲判后对照）→ T4 门禁切换独立 commit（`8f906527`：显式读 v2、runner DEFAULT 保持 v1、结构断言升级 spec §7、floor=新基线−不变 margins、**A 层 ≥0.95 断言**；`33d28f12` 对跑表+阈值提案+证伪自证：+0.2 必红/还原 5 passed 字节一致）→ T5 T3 重评（`939e61a6`：**DoD 字面 PASS**——六项聚合全上行 acc1+0.032/B+5/E+1/零丢失零新增 FP/拒答不变/A 不掉；**归因如实拆解：5 条 B 增量=建表集自身（记忆一致性），全新地面增量=+1/115（E-030 桥「用款→用信」）**——解除停用并接线 propose.js 与否移交 Lead，本线红线未接线）→ T6 报告+台账
- 验收：门禁 5 passed exit 0；`--baseline tmp/kb-eval-v2/T4-v2.json` exit 0；v1 保真三轮全字段 diffs=0；`recall-eval.mjs` DEFAULT_FIXTURE 未动（v1 历史对跑零成本）；data/kb/synonyms.json 本线零改动（建表隔离）；不接线 propose.js；红线全守（未动 v1 文件/failures/verify-all/data/kb/req）
- v2 新基线：**0.600/0.725/0.653/0.667/拒答 0.382/噪声 0.600；A 1.00 · B 0.400 · C 0.900 · D 0.900 · E 0.100**
- 遗留移交：Lead=①T3 处置裁定（解除停用+接线 vs 维持停用）②阈值提案追认（六项+A 层 0.95）③D-017 下划线流程码分词桥接缺口（新发现）；reviewer=C 层加抽建议；方向 5=E 层 45 miss+近域 24 FP 靶区；N-002 维持移交
- 注意：工作区他线 WIP 12 项未触碰未携带；本线 10 commits 一 Task 一 commit（T4 拆切换/证据两笔系独立 commit 红线要求）

## 2026-09-10 22:58 · Zcode — 开工：recall-eval-v2 评测集扩版+门禁切换+T3 重评（spec+plan 已批 A1–A6）

- 工作范围：`scripts/characterization/fixtures/kb-recall-eval.v2.json`（新建）、`scripts/characterization/fixtures/kb-recall-v2-quota.md`（新建）、`scripts/characterization/characterize-kb-recall-eval.mjs`（T4 门禁切换）、`docs/superpowers/reports/2026-09-10-recall-eval-v2-report.md`（新建）、`docs/superpowers/todo-list.md`、`docs/superpowers/agent-log.md`、`tmp/kb-eval-v2/**`（证据）
- 禁入区：`propose.js`、`kb-recall-eval.v1.json`（冻结一字不改）、`kb-recall-failures.v1.json`（只读建表集）、`data/kb/req/**`（只读）、`scripts/refactor/verify-all.sh`、`.cursor/`；工作区他线 WIP 12 项（agent-log archive 两删/plans 三改/classify.py/verify-all.sh/archive/logs 等不触碰不携带）
- 执行方式：主线程单线推进 T0→T6 一 Task 一 commit；标注纪律=禁跑匹配器、gold 只从语料（84 卡+through-chains+湿测叶名）出发；建表隔离=词表/阈值构建期物理排除 v2；不引依赖、不改召回算法；阈值先测后定待 Lead 批

## 2026-09-10 22:50 · Zcode — 收工：recall-p0 closeout G3 收尾四项（回链 22:32 开工 `62fca4c5`）

- 完成：依据 G3 结论 + Lead 裁定第三条路（机制保留/词表停用/不接线/T3 不计成果）落收尾四项——
  ①`data/kb/synonyms.json` 顶层 +`status:"unvalidated"`+statusNote（entries 16 条程序校验未动）；
  ②报告 [`reports/2026-09-10-recall-p0-report.md`](reports/2026-09-10-recall-p0-report.md) 口径更正六处：头部口径块 + 结果总览改四列（**+T2 列=生产 0.740/0.847/0.784/0.798/0.633，B 0.233**；+T3 列标注 offline only 存档）+ Task 表 T3「FAIL→停用待评测集 v2 重评」+ T3 章节裁定块 + 回退/门禁/遗留/复现命令段同步；
  ③补 pin `node-ratio denominator ignores card-level-only tokens`（hash_markers 独占码场景钉住 bestNodeIdFor 分母=nodeEligibleScore；**证伪实证：临时还原旧分母 cardScore → 新 pin 与存量 pin 一起转红 → 还原 23 passed、源文件与 HEAD 字节一致**——与 T2 存量 convert pin 构成同场景双保险）；
  ④todo-list 线状态同步关闭 + 本收工条目
- 验收：`characterize-flow-card-recall` **23 passed**（22+1）；生产口径门禁 `recall-eval.mjs --baseline` **exit 0**（0.740/0.847/0.784/0.798/0.633/0.740 全高于 floor）；py 契约 ok；lint 新增 0
- 红线遵守：未 revert `2ae8e4e1`；未接线 `propose.js`；未删词表；未再跑 T3 度量当成果；`kb-recall-eval.v1.json`/门禁阈值/`verify-all.sh`/`data/kb/req/**` 未动
- 遗留移交：**T3 重评前置=评测集 v2 扩版（≥100 条独立新查询，另立项）→ v2 建表验证独立正增量 → 通过后接线 propose 并计成果（同一套 G1/G2/G3）**；移交 Lead：N-002 存量 FP（地板收紧须批）；证据 `tmp/kb-p0/closeout/`
- 工作区他线 WIP（agent-log archive 两删/classify.py/verify-all.sh 等 12 项）全程未触碰未携带

## 2026-09-10 22:32 · Zcode — 开工：recall-p0 closeout G3 收尾四项

- 进行中：2026-09-10 22:32；依据=G3 结论（T0/T1a/T2/T4 PASS、T1b FAIL 已正确回退、**T3 FAIL**=verify 独立增量 0+未接线）+ Lead 裁定第三条路：**机制保留、词表停用、不接线、T3 不计成果**；生产口径统一为 T2 链态 0.740/0.847/0.784/0.798
- 范围：`data/kb/synonyms.json`（仅加顶层 status 字段，不动 entries）、`docs/superpowers/reports/2026-09-10-recall-p0-report.md`（口径更正）、`scripts/characterization/characterize-flow-card-recall.mjs`（**唯一允许动代码文件**：补 bestNodeIdFor 分母 pin）、todo-list、本文件、tmp/kb-p0/closeout/
- 禁入区：`propose.js`（裁定不接线）、`kb-recall-eval.v1.json`（冻结）、门禁阈值/`verify-all.sh`（本线禁改且他线 WIP）、`data/kb/req/**`（只读）、`.cursor/`、他线 WIP 12 项（agent-log archive 两删/classify.py/verify-all.sh 等）
- 方式：开工 commit → 词表标注 → 报告口径更正 → 补 pin（TDD 红→绿验证防伪）→ 台账收工 commit；不 revert `2ae8e4e1`、不删词表、不再跑 T3 度量当成果

## 2026-09-10 00:05 · ZCode 引擎线 — 回滚+改期：tansun 兼容实装延至周末（回链 23:55 开工）

- 用户指示：同事还在调试，等他调整完最后一版，**周末再做兼容**；改动全部回滚，虚拟环境保留
- 回滚：tansun_ui_engine 切回 main（工作区 0 改动）、compat/js-gen-operations 分支删除、未提交两文件（data_name.py helper+单测）删除——仓内已无本线痕迹；`.venv` 保留且 dev 依赖装齐（test_select_click+test_payload_adapter 18 passed 实证）；未派任何子智能体
- 待命：周末开工前置=git fetch 确认同事最后一版（radio/select:tree 若在其中则批 5 复验替代快照基线）→ 重建分支 → 按报告 §7 五批+§7.1 格式核对执行；排期与回滚态已入记忆 tansun-scope-operations-only

## 2026-09-10 23:55 · ZCode 引擎线 — 开工：tansun 引擎 18 操作兼容实装（回链 23:40 格式核对/23:10 词表冻结）

- 工作范围：D:\dev\tansun_ui_engine 新建分支 compat/js-gen-operations——ui_execute/engine/data_name.py(新)/action_registry.py、ui_execute/engine/actions/{input_action.py, click.py, replay_adapter.py(仅 hint 归一), select_click.py, date_action.py(新), click_subroutes.py(新)}、ui_execute/models/{enums.py, payload.py}、docs/EXECUTION_PAYLOAD_MIGRATION.md、tests/{test_input_action.py, test_click_subroutes.py, test_date_action.py, test_select_click_rowselect.py}(新)+.venv(本地依赖, gitignore 意);JS-gen 仓仅 docs/superpowers/agent-log.md
- 禁入区：JS-gen 主仓 src//scripts/（他线 12 项 WIP 热区）；tansun_ui_engine 其余全部（scheduler/executor/locator/models 其余/tests 存量 16 件）
- 执行方式：主会话先落 data_name 前缀解析 helper（路由键+labelHint 剥前缀），随后 3 并行子智能体——A=input 值字段(object_value or val)+hint 剥前缀；B=click dataName 前缀子路由（关闭弹窗/展开树/页签：/表格：/树选：/邻钮：/菜单：,JS 从 JS-gen js_snippets 移植,miss 落回原链）；C=date event 六处清单+select:click「弹窗选择：」行选分支——子智能体不 commit 不写本文件,主会话 pytest 全量+diff 审查后代提交；radio/select:tree 等同事推送后复验（批 5,不在本次）；不动 JS-gen 推送链

## 2026-09-10 23:40 · ZCode 引擎线 — 推送接口数据格式核对（回链 23:10）

- 用户要求重看推送接口数据格式——全链路重读：JS-gen 侧 transaction-export.js（importDemand 报文：transcationEventTypeList→transcationProperties，六 type=eventTypeName/eventTypeValue）与同事引擎侧两套接收（V2/V3 structured：scheduler/payload.py:105→ExecutionPayload→_step_to_transaction 压平 transaction JSON；V1 老格式：ExecuteRequest+transactionList 直收，payload.py:164 id>0 硬校验）逐字段对齐
- 关键事实：①objectValue 双写位确认（payload.py:374 xpathObjectValue+:380 objectValue），批 4 行选读 object_value 前提成立；②V3 通道 primaryLocator.method+value 双非空硬校验（payload.py:333-334）——elementType 空步骤不是静默 skip 而是**整单拒**，比 v1 响；③**前缀路由新增上游验证点**：dataName 来自 step.name，ATP 组装 payloadJson 时 propertiesName（裸名词）是否保前缀待联调实证——若平台剥前缀，引擎子路径路由退化为主路径+labelHint 兜底；④引擎已自带 component.menuXPath 逐级菜单点击注入（payload.py:385-416 菜单切换-N），与映射表「菜单：」并存不冲突；⑤新增 §7.1 全量字段核对表+报文样例入报告
- 验收：全部结论带 file:line（payload.py:318-382/323-325/331-341/385-416、scheduler/payload.py:105-154、case_executor.py:428/394、transaction-export.js:126-139）；本单元只提交 agent-log + 报告两文件，他线 WIP 未触碰

## 2026-09-10 23:10 · ZCode 引擎线 — 词表冻结（回链 22:45）：六 type 支撑 18 操作

- 用户定盘："不改变这六个推送 type，这六个操作类型要支持我们的18个操作"——type 词表=click/input/select:click/select:tree/radio/date 共六个**不新增第七种**；18 操作全部在六 type 内表达（click=10/input=2/select:click=2/select:tree=1/radio=2/date=fill 日期升格），dataName 前缀=type 内子操作路由键，处理三层模型=type 定 handler→前缀定子路径→剥前缀文本作 labelHint
- 落档：报告 §7 重写为词表冻结版五批蓝图（原"date 依赖 P2 接线空转"边界降为推送侧事实备案：引擎照做，步骤到达与否属推送侧行为）；记忆 tansun-scope-operations-only 同步三轮定盘语义
- 本单元只提交 agent-log + 报告两文件，他线 WIP 未触碰；实装开工待用户发令

## 2026-09-10 22:45 · ZCode 引擎线 — 范围二次澄清（回链 22:20）：推送操作兼容

- 用户澄清："推送的操作，同事引擎无法正确处理，所以需要进行兼容"——22:20"只补全操作"被误读为收窄，实际语义=**在 tansun_ui_engine 侧做兼容使 18 映射操作全部正确执行**：①补缺失 handler；②修已接收操作错误处理（值字段分流 object_value or val、dataName 前缀=操作语义通道：路由读前缀+labelHint 剥前缀）
- 落档：报告新增 §7 兼容实装蓝图五批（批1 值字段+前缀解析→批2/3 click 族前缀子路由：关弹窗/页签/展开树/表格行/树选/邻钮/菜单→批4 date event+弹窗行选→批5 radio/select:tree 合入后复验）；分支 compat/js-gen-operations；仍不做=JS-gen 推送链 P1-P6/打磨项/无关 bug/radio·select:tree 快照重复实现
- 已知边界已言明：date 行依赖推送侧 P2 接线、展开树行依赖录制端 P3 落步骤（均超范围）——handler 照做但空转，是否连带解决待用户裁决
- 本单元只提交 agent-log + 报告两文件，他线 WIP 未触碰；实装开工待用户发令

## 2026-09-10 22:20 · ZCode 引擎线 — 范围指示（记住）：只补全操作

- 用户指示："我们只补全操作。不需要做别的事情。"——tansun_ui_engine 集成只新增映射表要求的缺失操作类型/handler 使 18 动作可执行；对方引擎其余代码/架构/bug（如 checkSelect 布尔伪成功）不动；JS-gen 推送侧 P1-P6（报告 §4）与消歧/沉降/absent=skip 等打磨项（报告 §5 尾步）均超出范围，勿再主动提议
- 落档：报告头部新增范围约定（§4/§5 超出项仅作参考存档）+ 记忆 feedback:tansun-scope-operations-only；本单元只提交 agent-log + 报告两文件，他线 WIP 未触碰

## 2026-09-10 22:05 · ZCode 引擎线 — 更正：18 动作矩阵 radio/select:tree 状态（用户确认）

- 完成：用户确认 radio / select:tree **已在同事引擎最新（未推送）版本实现**——本仓克隆仅含远端唯一提交 2b22613。报告 `2026-09-10-tansun-engine-18-action-mapping-audit.md` 全线更正：矩阵 #14/#15 ❌→「待复验」（复验清单：event 字面量/object_value 读取/absent=skip/布尔伪成功）；§0/§2（仅剩 date）/§5（路线图 7 步重排）/§4 P5/§6 横切 1 同步改写；date（fill 日期升格）用户未提及，仍按缺失对待
- 验收：git fetch 确认远端仅 2b22613（chore: initialize UI execution engine），无未拉取分支；更正逐条落档
- 遗留移交：①同事推送后按矩阵 #14/#15 对齐清单复验；②date event 是否同步实现待确认；③JS-gen 侧 P1-P6 修复清单不变待开工；④本单元只提交 agent-log + 报告两文件，他线 WIP 未触碰未携带

## 2026-09-10 20:40 · ZCode 引擎线 — 开工+收工：18 动作映射支持矩阵调研（4 路并行子智能体，只读）

- 完成：用户拉同事引擎仓 D:\dev\tansun_ui_engine 到本地，要求按 18 动作映射表（click/input/select:click/radio/select:tree + 前缀操作名样式）确保全部可执行——派 4 路只读子智能体（click 族 10 动作 / input-radio 族 6 动作 / 报文入口与执行链路 / JS-gen 推送侧转换器核对）调研完毕，汇总矩阵入库 `docs/superpowers/reports/2026-09-10-tansun-engine-18-action-mapping-audit.md`
- 核心发现：①引擎白名单只有 click/input/select:click 可跑，**radio/select:tree/date 三 event 不存在**——v3 整包拒/v1 静默丢；②操作名前缀样式只在 JS-gen 传统 5 字段导出，V3 推送=裸名词，且引擎 dataName 前缀会污染 label 精确匹配（建议推送侧维持裸名词+引擎 norm 剥前缀）；③值字段分流=引擎 input/checkSelect 只读 val 不读 objectValue，radio 短平快=走 checkSelect+值写 operation.value；④select_option 承载最完整✅，picker_dialog_select 语义不符（强依赖 .el-select）❌；⑤JS-gen 推送侧 4 个坑：tree_picker_click path_texts 不进 objectValue / fill 日期升格未接 V3 链（恒 input）/ expand_all_el_tree 录制端不落步骤 / workspace_tabs 不采集 element
- 验收：矩阵 18 动作逐一带 file:line 双仓定位；新增 event 六处改动面（enums/payload 白名单/handler/registry/docs/tests）+ handler 约定（status=ok/skip/error，error=整案终止）已写明；报告含同事侧实施优先级 6 步+联调横切提醒 4 条
- 遗留移交：①报告 §5 六步给同事排期（或经用户拍板我方直接在 tansun_ui_engine 实装）；②JS-gen 侧 P1-P6 修复清单（报告 §4）待开工；③radio 过渡方案（checkSelect 通道）需与同事约定后启用；④子智能体由本会话代声明，只读未 commit 未写本文件
- 注意：工作区他线 WIP（archive 两删/plans 改/classify.py/verify-all.sh 等）未触碰未携带；本单元只提交 agent-log + 报告两个文件

## 2026-09-10 20:00 · ZCode 引擎线 — 开工+收工：click_button 交接包（纯文档+zip 单元）

- 完成：同事执行引擎缺 click button 操作类型——按 radio/tree 同模式产出：spec `docs/superpowers/specs/2026-09-10-click-button-operation-spec.md`（录制 G1 容器优先三层=z-index 最高 overlay+popper 补扫+label 开 trigger；JS_CLICK_ICON_BUTTON 三级=精确文本>icon 宿主>泛化文本兜底含池化消歧；回放 durable 链=xpath_smart→弹窗修正→Playwright .last 兜底+分类沉降；**硬门槛=保存/提交/确认类改道 click_save**；同名消歧/点击前采集/.last 纪律等集成注意六条）+ 交付包 `C:/Users/water/Desktop/click-button-handover.zip`（15 文件 80KB：py/ 源码 14 含 form_save.py 附带参考 + spec，zip 完整性 OK）
- 验收：spec 全部代码坐标现场核对（click_action_engine.py:29 录制编排/:480 两个 for_replay 入口/replay_click.py:19 durable 链/:127 分类沉降/_misc.py:67 容器优先/icons.py:133 三级点击）；契约对齐 engine-actions-contract §2.3 与 2026-09-10-click-record-replay-unify-design.md（已落地态）；纯文档+Desktop 产物，无代码改动
- 遗留移交：click_table_row_button/click_menu_xpath/real_click（CDP trusted）不在本包（分别在 table 族/mega-menu 交接文档/radio-tree 包）；同事侧如需保存链完整契约（分区保存/双保存）另出 click_save 专包
- 注意：工作区他线 WIP 未触碰未携带；本单元只提交 agent-log + spec 两个文件；tmp 临时打包脚本已删

## 2026-09-10 19:30 · ZCode 引擎线 — 开工+收工：click_radio 交接包（纯文档+zip 单元）

- 完成：同事执行引擎缺 radio 操作类型——按 select:tree 同模式产出：spec `docs/superpowers/specs/2026-09-10-radio-operation-spec.md`（双 JS 路=xpath 版 JS_CLICK_RADIO_BY_XPATH 弹窗感知+`[last()]` 隐藏弹窗修正，label 版补扫 dialog/drawer；RadioEngine 录放同体 absent=skip OK 级联语义；autofill/_llm_values 消费面；集成注意五条）+ 交付包 `C:/Users/water/Desktop/radio-handover.zip`（14 文件 58KB：py/ 源码 13 + spec，zip 完整性 OK）
- 验收：spec 全部代码坐标现场核对（radio_engine.py 74-81 双路编排/select_tree.py:8 label 版/fill_date.py:165 xpath 版/replay_form_action.py:124 接线/_helpers.py:218 absent 语义）；契约对齐 engine-actions-contract §2.4 与 2026-09-09-radio-record-replay-unify-design.md（已落地态）；纯文档+Desktop 产物，无代码改动
- 遗留移交：`click_table_row_radio`（表格行 radio，replay_table 族）不在本包，同事如需表格列场景另议；他侧 SUT 组件若非 Element UI 同构需按 DOM 回传适配
- 注意：工作区他线 WIP 未触碰未携带；本单元只提交 agent-log + spec 两个文件；tmp 临时打包脚本已删

## 2026-09-10 19:00 · ZCode 引擎线 — 开工+收工：select:tree 树形选择器交接包（纯文档+zip 单元）

- 完成：同事执行引擎缺树形选择器实现——按上次 select:click 交接模式产出：spec `docs/superpowers/specs/2026-09-10-select-tree-operation-spec.md`（TsscMultiTree DOM/Vue 链定案 + `$emit('input',code)` 唯一正确 API 坑史表 + select_tree_option P0→P1→P2 三段式 + tree_check_confirm 真实 check 事件契约 + tree_picker_click CDP real-click 兜底 + 结果协议/别名归一/集成注意五条）+ 交付包 `C:/Users/water/Desktop/select-tree-handover.zip`（18 文件 60KB：py/ 源码 17 个 + spec，zip 完整性 OK）
- 验收：spec 内全部代码坐标经现场核对（tree_engine.py/select_dispatch.py:59-73/replay_form_action.py:89/select_engine.py:550 fall-through 注释/replay_names.py 别名表）；zip testzip 通过；纯文档+Desktop 产物，无代码改动
- 遗留移交：同事侧集成后如有形态不匹配（他们 SUT 树组件非 TsscMultiTree 系）需回传组件 DOM 结构再适配；select_option 的 tree path fall-through 现状已在 spec §7.2 言明
- 注意：工作区他线 WIP 12 项（agent-log archive 两删/plans 改/classify.py/verify-all.sh/kb recall 线在途）未触碰未携带；本单元只提交 agent-log + spec 两个文件；tmp 临时打包脚本已删

## 2026-09-10 21:10 · Zcode — 收工：recall-p0-three-levers KB 召回 P0 三杠杆（回链 18:36 开工 `1e047cc6`）

- 完成：T0 失败清单冻结+build/verify 五五划分（`06dbe12d`，B 12/11·D 5/5·C 1/1 机械交替）；T1a 血缘资产 mapped 72/84=85.7% + unmapped 12/ambiguous 1 显式 + promote_draft 补写 moduleKey（`b0e0e534`）；**T1b 作用域 FAIL 整体回退**（保守 1.15/.92 与授权上限 1.30/.85 均 2/11 转正<6，9 条余项中 7 条 gold raw=0=词面鸿沟非排序问题——已向 T3 归类建议，无代码残留）；T2 camelCase/ASCII 分词 D 层 0.333→**0.933**、9/9 null 转正、修复死 FS/ZJJK token 与 node-ratio 分母（`01572239`）；T3 受控词表 16 词条只据 build 集建表、B 层 0.233→**0.400**、build 0→10/18 上行、FP 零新增（`2ae8e4e1`）；T4 报告入库
- 验收：终态六项 acc1 **0.790**/rec5 **0.917**/mrr 0.843/ndcg 0.860/拒答 0.633 不变/噪声 0.790（A 1.00 保持·C 不动）；`recall-eval.mjs --synonyms --baseline` exit=0；`characterize-kb-recall-eval` 4 passed（floor 只升不降）；`characterize-flow-card-recall` 22 passed（存量 17+新增 5）；py 契约 ok；lint 新增 warning=0（16 条存量同规则仅行号平移）；verify-all.sh/kb-recall-eval.v1.json/data/kb/req/** 均未动
- 遗留移交：①reviewer 三 gate 待跑（G1 血缘+词表抽检 / G2 划分与冻结未动确认 / G3 独立复算+pin 证伪+反作弊）；②**裁量点已披露**：T3 词表对 verify 独立增量=0（verify +4 全归因 T2 分词），若 reviewer 判「词表自身须 verify 增量>0」则按 A4 词表单项回退至 `01572239` 链态；③移交 Lead：N-002 计算2加3→collection_scorecard 系基线存量 FP，回 null 须收紧覆盖率地板=改口径（须批）或 embedding（另立项）；④propose.js A5 放行但最终未触碰（作用域回退后 moduleKey 注入无消费者，产品侧 synonyms 装配另立任务）；⑤作用域杠杆归类偏差（11 靶中 7 条实为词面鸿沟）建议下版评审重归类
- 证据：tmp/kb-p0/（T0-failures/T1-lineage/T1b-verdict+after+exp/T2-verdict+after/T3-verdict+after+build-set/T4-verify-perentry/gate）；报告 docs/superpowers/reports/2026-09-10-recall-p0-report.md
- 工作区他线 WIP（verify-all/classify.py/agent-log archive 等 12 项）全程未触碰未携带

## 2026-09-10 18:36 · Zcode — 开工：recall-p0-three-levers KB 召回 P0 三杠杆

- 进行中：2026-09-10 18:36；目标=按已确认 spec（决策 A1–A5 已裁定）用三条零依赖杠杆提召回分：血缘作用域三态 / camelCase·ASCII 分词 / 受控词表扩展；冻结基线 Acc@1 0.650·Recall@5 0.757·MRR@5 0.694·nDCG@5 0.708·拒答 0.633·噪声 0.650 不得回退
- 范围：`scripts/characterization/fixtures/kb-recall-failures.v1.json`（新）、`scripts/kb/build-flow-lineage.mjs`（新）、`data/kb/flow_lineage.json`（新）、`data/kb/synonyms.json`（新）、`src/services/req-draft-traj/flow-card-recall.js`、**`src/services/req-draft-traj/propose.js`（仅注入 moduleKey/_modules 参数，不改既有语义——A5 已放行）**、`scripts/kb/promote_draft.mjs`、`scripts/characterization/characterize-flow-card-recall.mjs`（既有 17 pin 不动）、`docs/superpowers/reports/2026-09-10-recall-p0-report.md`（新）、tmp/kb-p0/**、todo-list、本文件
- 禁入区：`scripts/refactor/verify-all.sh`（本线禁改且现为他线 WIP）、`scripts/characterization/fixtures/kb-recall-eval.v1.json`（冻结）、`data/kb/req/**`（只读）、`.cursor/`、`scripts/controller/actions/phase/classify.py`（他线 WIP）、fill/select/radio/click 引擎热区
- 方式：T0（基线复现逐位一致 + 35 失败清单冻结 + build/verify 五五划分落盘）→ T1a 血缘资产 → T1b 作用域三态（pin 先行）→ T2 分词（pin 先行）→ T3 词表（只据 build 集建表，verify 禁看）→ T4 报告；一任务一 commit、证据落 tmp/kb-p0/&lt;task-id&gt;/、不达标单项回退；工作区 12 项他线 WIP 全部避开不携带

## 2026-09-10 18:35 · ZCode 引擎线 — 开工+收工：mega-menu 不收起交接文档（纯文档单元）

- 完成：同事侧执行引擎反馈「子菜单出现后不再隐藏」——按本仓真机定案（probe-menu-close-v2.py 单变量实证：关=面板外真实 mousedown，hover/Escape/合成点击全无效；合成 el.click() 可开）写排查四步+修复三件套配方，交接文档入库 `docs/superpowers/guides/menu-nav-megamenu-close-handover.md`
- 验收：文档内配方均带本仓代码坐标（page_id.py:190/164、_replay.py:194/216）与双菜单 DOM 实证（tmp/menu_crawl/verify-report.md：li[data-id] 恒隐藏 386/410，可见分支=li.submenu-item[data-url]）；纯文档无代码改动
- 遗留移交：打包交付同事方式待定（上次 select:click 走 zip，本次先落仓内文档可直接转发）；同事引擎若需移植，配方含 Playwright page.mouse 与裸 CDP Input.dispatchMouseEvent 两版
- 注意：工作区 12 项他线 WIP（agent-log archive 两删/plans 三改/classify.py/verify-all.sh 等，dedup 删除线与 form-engine 拆分线在途）**全部未触碰未携带**；本单元只提交 agent-log + 新 guides 文档两个文件

## 2026-09-10 18:21 · Cursor Lead — 收工：dedup-deletion 删装配期死 dedup

- 完成：回链开工 `1ac49e6f`；删 `src/dedup.js` + `characterize-dedup.mjs`；AGENTS 改为指向 `state.py` 录制 coalesce；CLAUDE/README/jsdoc/verify-all 去门禁
- 验收：`rg` 生产侧无 `dedup.js` import；活录 coalesce 仍在 `scripts/state.py`
- 遗留：他线 `verify-all` 的 form-engine-scope-audit 行未纳入本 commit（工作区还原）；下一可排 screenshot-quality / PR-BATCH 小缺口

## 2026-09-10 18:20 · Cursor Lead — 开工：dedup-deletion 删装配期死 dedup

- 进行中：2026-09-10 18:20；根因=`src/dedup.js` 生产零引用（装配管线已删），仅 `characterize-dedup` 门禁消费；活录 coalesce 仍在 `state.py`
- 范围：删 `src/dedup.js` + `characterize-dedup.mjs`；AGENTS/CLAUDE/README/jsdoc/verify-all（仅去 dedup 行，保留他线 WIP）；todo-list、本文件
- 禁入区：classify.py、fill/select、`.cursor/`、他线 verify-all 新增 pin 行
- 方式：零引用复核 → 删源+门禁+文档 → 收工（用户选定待裁=产品授权砍）

## 2026-09-10 18:09 · Cursor Lead — 收工：p2-async-actionlog 增量 sync

- 完成：回链开工 `8f3de3b1`；Python `_emit_action_log_sync` 默认 delta + 孤儿/周期(50) full；Node `applyActionLogSync`；runner 接线
- 验收：`characterize-action-log-sync-delta.py/.mjs` OK；`characterize-recorder-phase-reset` PASS
- 遗留：`emit_json` 仍同步 flush（增量后载荷已小）；冷 pin 未入 verify-all（WIP）；执行机+控制面需同版本；下一挂起可排 `dedup-deletion`（待裁）/ PR-BATCH 小缺口

## 2026-09-10 18:07 · Cursor Lead — 开工：p2-async-actionlog 增量 sync

- 进行中：2026-09-10 18:07；根因=每步全量 `entries` + `emit_json` flush → O(n²) 管道字节与背压拉长 cancel
- 范围：`scripts/state.py`、`src/services/trajectory/action-log-copy.js`、`trajectory-recording-runner.js`、冷 pin、todo-list、本文件
- 禁入区：classify/verify-all WIP、fill/select、`.cursor/`
- 方式：TDD `syncMode=delta|full` + 副本 merge；周期 full 兜底；讲解原理后绿 pin 收工

## 2026-09-10 18:01 · Cursor Lead — 收工：p2-batch-lease 录制期续租

- 完成：回链开工 `17d7185c`；DAO `renewItemLease`（CAS worker_token + preparing|recording）；`runRecord` 经 `startItemLeaseRenewal` 周期续租（lease/3，下限 30s，`finally` 停表）
- 验收：`node scripts/characterization/cold/characterize-batch-item-lease-renew.mjs` OK
- 遗留：冷 pin 未入 verify-all（WIP）；控制面重启后生效；下一 P3 可排 `p2-async-actionlog` / `stop-busy-race`（后者文案已注明 finally 无害化）

## 2026-09-10 17:59 · Cursor Lead — 开工：p2-batch-lease 录制期续租

- 进行中：2026-09-10 17:59；根因=`BATCH_ITEM_LEASE_MS=600000` 录制中不续租，长跑 item 过期可被二次 claim
- 范围：`src/dao/batch-recording-dao.js`、`src/services/trajectory/batch-record.js`、冷 pin、todo-list、本文件
- 禁入区：classify/verify-all WIP、fill/select、`.cursor/`
- 方式：TDD 加 `renewItemLease` + runRecord 周期续租（lease/3）→ 绿 pin → 收工

## 2026-09-10 17:57 · Cursor Lead — 收工：login-retry-heuristic 事件沉降 + 指数退避

- 完成：回链开工 `0c697eba`；新建 `prepare-login-retry.js`；attach-runner 失败后 `wait_for_loading` settle + 指数退避（替代固定 8s）
- 验收：`characterize-prepare-login-retry.mjs` OK
- 遗留：冷 pin 未入 verify-all（WIP）；控制面重启后生效；下一 P3 可排 `p2-batch-lease`

## 2026-09-10 17:56 · Cursor Lead — 开工：login-retry-heuristic 事件沉降 + 指数退避

- 进行中：2026-09-10 17:56；根因=prepare 登录失败固定睡 8s 再试，慢环境误判/快环境空等
- 范围：`src/services/trajectory/prepare-login-retry.js`（新建）、`trajectory-attach-runner.js`、冷 pin、todo-list、本文件
- 禁入区：classify/verify-all WIP、fill/select、`.cursor/`
- 方式：TDD 纯重试器（settle + 指数退避 + budget）→ attach-runner 接线 wait_for_loading settle → 绿 pin → 收工

## 2026-09-10 17:51 · Cursor Lead — 收工：p2-toast-cursor 导航/跨页 notify 游标回卷

- 完成：回链开工 `f3b9e1a7`；`rewind_notify_cursor_if_shrunk` + scan shrink 后 cursor=0 重扫；清 `_step_notice_seen`
- 验收：`characterize-step-notice-scan.py` OK
- 遗留：无（未改 js_snippets）；下一 P3 可排 `login-retry-heuristic` / `p2-batch-lease`

## 2026-09-10 17:50 · Cursor Lead — 开工：p2-toast-cursor 导航/跨页 notify 游标回卷

- 进行中：2026-09-10 17:50；根因=`log_len < cursor` 时不回卷 → 新页前 N 条 toast 永久跳过；seen 残留同效
- 范围：`scripts/agent/step_notice.py`、`scripts/characterization/cold/characterize-step-notice-scan.py`、todo-list、本文件
- 禁入区：js_snippets/fill/select 热区（本修仅 Python 游标/seen，不改 JS 片段）、classify/verify-all WIP
- 方式：TDD 抽 `rewind_notify_cursor_if_shrunk` → scan 路径 shrink 时重扫 cursor=0 → 绿 pin → 收工

## 2026-09-10 17:15 · Cursor Lead — 收工：p1-6 replayId 全链过滤 + 超时 cancel_step

- 完成：回链开工 `6e84fa6b`；`runReplayActions` 铸造 replayId → Python `replay_done` 回带 → `waitForOwnedReplayDone` 过滤；超时发 `cancel_step`；rerun executor 路改走 helper（`seedActionLog`）
- 验收：`characterize-replay-id` / special-element / replay-batch / page-bind / menu-scan OK
- 遗留：冷 pin 未入 verify-all（该文件他线 WIP）；legacy 无 replayId 仍放行并打 `replay_done_missing_replayid`

## 2026-09-10 17:12 · Cursor Lead — 开工：p1-6 replayId 全链过滤 + 超时 cancel_step

- 进行中：2026-09-10 17:12；根因=`replay_done` 仅按 sessionId 等待，旧 replay 迟到 done 可误满足新登录等待；超时不叫停 Python
- 范围：`src/services/replay-actions.js`、`scripts/event_dispatch.py`、`src/services/rerun-replay-service.js`、冷 pin、todo-list、本文件
- 禁入区：`classify.py` / `verify-all.sh` WIP / fill·click 引擎 / `.cursor/`
- 方式：TDD 冷 pin（ownership + helper 接线）→ 改 helper/Python 回带 → 超时发 cancel_step → 绿 pin → 收工

## 2026-09-10 17:01 · Cursor Lead — 收工：engine-wet-trio ②③ 真机湿测 PASS

- 完成：回链开工 `78dd209d`；重启控制面加载 `0421744b`；湿测 traj **720/721**
- ③ 并发 start：**PASS**（200 + 409 `Recording already in progress`）
- ② detach→重附门闩：**PASS**——控制面日志 `async gate skipped for traj=721: live state changed (runtimeReplaced=true sessionGone=true …)`；N+1 未假失败；报告 `tmp/engine-wet-trio/report.md`
- 顺带：`RECORD_FINALIZE_GATE_MS` 环境变量（默认 90000）便于门闩湿测缩窗
- 遗留：无（engine-wet-trio 闭环）；下一优先挂起项见 todo `p1-6-replayid`

## 2026-09-10 16:53 · Cursor Lead — 开工：engine-wet-trio ②③ 真机湿测

- 进行中：2026-09-10 16:53；验收=② detach→重附后旧 90s 门闩不得误伤新 run；③ 并发 start 第二路 409
- 范围：tmp 湿测脚本/报告、todo-list/agent-log；**重启控制面**加载 `0421744b`；用一次性 draft 轨迹
- 禁入区：他线 WIP（classify/verify-all/plans）、生产主链轨迹不乱录
- 方式：重启 4097 → 建湿测 traj → ③ 并发 start → ② finalize 后门闩窗口内 detach/prepare/start 并等门闩日志

## 2026-09-10 16:53 · ZCode — 线关闭确认：KB 召回评测常态化 G3 PASS（回链 T0 09-09 22:44 / T4 09-10 13:44）

- G3 终局 **PASS**（reviewer 结论 `reports/2026-09-09-kb-recall-eval-g3.md`，commit `13abd9a2`）：三 gate 全过，反作弊六项零触发，冻结文件改动实证内容零漂移，分摊口径重算逐位一致；**本线正式关闭**
- 遗留三条归属（均无需本线动手）：①A 层第七项下限（建议 A≥0.95）待 Lead 批；②`entries.length >= 130` → `=== 130` 留下次动文件时顺手改；③冻结文件批准人追认待 Lead 在 todo 补一句
- 方向 5（混合检索）接口约定已由 reviewer 成文于 G3 报告 §三：改 `flow-card-recall.js` 同 commit 附评测复跑；floor 只升不降（下调须 Lead 批+绊线同 commit）；冻结文件 v2 走 changeLog；分摊口径=契约；py 收敛另开任务
- 本条目仅确认关闭，无代码改动；`verify-all` 注册行现为 `:159`（他线追加所致，行号随他线漂移）

## 2026-09-10 16:43 · Cursor Lead — 收工：P1-5 per-tid record/start 内存互斥

- 完成：回链开工 `1fe635f2`；`startTrajectoryRecording` 入口同步 claim `runtime.aiRecording`（先于异步点）；早退路径释放；冷 pin `characterize-record-start-mutex.mjs`；todo `engine-wet-trio` ③ 代码侧闭合
- 验收：`node scripts/characterization/cold/characterize-record-start-mutex.mjs` OK；`characterize-record-status-v2.mjs` all ok
- 遗留：`engine-wet-trio` ② detach→重附 90s 门闩湿测、③ 并发 start 湿测仍待；控制面须重启才加载本互斥

## 2026-09-10 16:40 · Cursor Lead — 开工：P1-5 per-tid record/start 内存互斥

- 进行中：2026-09-10 16:40；根因=`isAiRecordingActive` 依赖 phase=running，登录窗口内双 start 均可过闸；对抗 review P1-5 互斥未做
- 范围：`src/services/trajectory/trajectory-recording-runner.js`、`scripts/characterization/cold/characterize-record-start-mutex.mjs`（新建）、todo-list `engine-wet-trio`、本文件
- 禁入区：`classify.py` / `verify-all.sh` WIP / fill·click 引擎 / KB / `.cursor/`
- 方式：TDD 冷 pin（入口同步 claim `runtime.aiRecording` 先于任何 await）→ 改 runner → 绿 pin → 收工

## 2026-09-10 16:09 · Cursor Lead — 收工：is_weak 分档——唯一 placeholder 可入库

- 完成：回链开工 `e6b9127c`；改动 `is_weak_xpath_smart` 分档（搜索/过滤 cue + 请输入XXX 可 stamp；请输入[1]/??? 仍弱）
- 验收：`D:\anaconda3\envs\browser_use\python.exe scripts/characterization/characterize-capture-element-xpath.py` → OK
- 遗留：无（本单元）；库存 stamp 后 resolve 仍依赖 label 对齐——另线

## 2026-09-10 16:06 · Cursor Lead — 开工：is_weak 分档——唯一 placeholder 可入库

- 进行中：2026-09-10 16:06；根因=`is_weak_xpath_smart` 凡含 placeholder 且无 el-form-item 一律弱，导致搜索关键字等唯一 cue 无法 stamp 进 task_list
- 范围：`scripts/controller/actions/_helpers.py`、`scripts/characterization/characterize-capture-element-xpath.py`（pin）、本文件
- 禁入区：fill_engine / locator-builders / classify / KB / `.cursor/`
- 方式：TDD 先扩 pin（请输入[1] 仍弱；搜索关键字 contains 可 stamp）→ 改 is_weak → 绿 pin → 收工

## 2026-09-10 15:17 · Cursor Lead — 收工：placeholder-only 搜索框抓取/回放定位修复（回链 15:12）

- 完成：离线 `buildXPathSmart/enrichLocatorFields` 对 placeholder-only（含搜索关键字）优先/纠偏为 placeholder xpath；回放 `strict-locator-not-found` 软继续 + `fill_dispatch` label==ph 仍发 by_xpath 空 xpath；录制 label 兜底后 DOM 发现再 capture
- 验收：`characterize-locator-candidates` / `characterize-fill-dispatch` / `characterize-xpath-fill-select` / `characterize-replay-params-xpath` / `characterize-capture-element-xpath` GREEN；smoke invent → `//input[contains(@placeholder,'搜索关键字')]`
- 遗留：存量步骤若 element 已写死错误 xpath，直接回放靠软继续+placeholder 兜底即可；重新保存步骤会 heal；活 Python 须 detach 重挂才加载 fill_engine 新逻辑

## 2026-09-10 15:12 · Cursor Lead — 开工：placeholder-only 搜索框抓取/回放定位修复

- 进行中：2026-09-10 15:12；根因=无 label 仅 placeholder 的 fill 落库时 `enrichLocatorFields/buildXPathSmart` 用 label_text 臆造 el-form-item+label xpath；回放 `strict-locator-not-found` 短路不走 placeholder 兜底
- 范围：`src/cdp/locator-builders/{dispatcher,candidates}.js`、`scripts/controller/actions/{fill_engine,fill_dispatch}.py`、表征 pin（locator-candidates / fill-dispatch / 新 cold pin）、本文件
- 禁入区：`classify.py` / analyze / KB / `.cursor/` / click 引擎热区；他线 WIP 文件不相交
- 方式：TDD 先红 pin → 离线 invent 优先 placeholder + 回放严格未命中继续尝试 + 录制 label 兜底补抓 → 绿 pin → 收工

# Agent 协作日志

## 2026-09-10 14:55 · Cursor Lead — 收工：#676 搜索保留用户目标 + query 注入业务数据（回链 14:45）

- 完成：`needs_business_data_context` / `phaseNeedsBusinessData` 对 query/search 改为注入；analyze 规则 7/8 改为「关键数据整段不抄、步骤内目标名必须原样保留」；STC prompt pin + phase-boundary + analyze-case-data 表征更新；spec §5.2 一句
- 验收：`characterize-phase-boundary` / `characterize-search-then-click-prompts` / `characterize-analyze-case-data` / `characterize-case-data` GREEN
- 遗留：#676 须 **重新 analyze** 再录 Phase1（旧 phase 描述仍是泛化「关键字」）；活会话 Python 须 detach 重挂才能加载 classify 新逻辑

## 2026-09-10 14:45 · Cursor Lead — 开工：#676 搜索阶段保留用户目标 + query 注入业务数据

- 进行中：14:45；根因=analyze 规则 7/8 抹掉步骤内目标名 + query 阶段 `needs_business_data_context=False` 跳过业务数据 hint，Agent 用 DOM/KB 示例「贷款」填搜索
- 范围：`scripts/controller/actions/phase/classify.py`、`src/services/trajectory/trajectory-text-extract.js`、`src/services/trajectory/trajectory-meta-service.js`（analyze prompt 规则 7/8）、`scripts/characterization/cold/characterize-phase-boundary.py`、`scripts/characterization/cold/characterize-search-then-click-prompts.py`、`scripts/characterization/cold/characterize-analyze-case-data.mjs`（若需 pin）、本文件；可选 spec 一句
- 禁入区：`propose.js`、`data/kb/**` 只读、fill/select/radio engine 拆分热区、`.cursor/`、他线 verify-all 大段冲突时只追加不动他人行
- 方式：TDD 先红 pin → 改 classify/JS inject + analyze 文案 → 绿 pin → 收工

## 2026-09-10 14:40 · ZCode — 收工：拆分回归修复落地（回链 13:58）

- 完成：**4 文件补 import**（`824bd428`，只插行：fill=+json/re/sys+_replay 三兄弟、select/radio=+_replay 三兄弟、login=+JS_FILL_FORM_FIELD）+ **防再犯护栏** `characterize-form-engine-scope-audit.py`（AST 未解析名审计：函数体内每个 Name Load 须解析到模块/自身/祖先闭包作用域，star-import 文件拒审，lazy annotation 剪枝；verify-all 已注册，独立 commit `593f721a`）
- 验收：**红绿自证三段式**（绿→stash 摘修复 exit=1 精确点名 re/sys/json+_replay 族→指名 pop 恢复绿）；离线 stub 调三处 `*_for_replay` 入口全执行到底；wiring/select×3/tree-select/xpath-fill-select/login-action 7 pin 全绿；verify-all 4 红全为既有基线（step-highlight/layer-tree/export-v3/confirm-notification）零新增；**真机湿测 PASS**：新进程+产品同路径 `replay_action_entries` 打真实 SUT 登录页，用户名/密码 fill 全 ok-label:placeholder，回读 701994 落框（`tmp/wet-login-replay-fix.py`）
- 遵守：修复只插 import 行；Cursor 线热区（replay_form_action/click_action_engine/_misc）零触碰；用户活会话（remote_session 1480 / PID 29624）未动
- 遗留移交：**用户当前会话 1480 的 Python 进程（13:50 起）内存里仍是旧模块——重试登录组件回放前须先 detach 重挂（或重启 executor 重建槽位），修复才能生效**；dry-run 中 `wait_for_loading unknown-action` 为自建条目缺元数据所致非回归；login_engine 的 `login` 动作靠本修复排掉一颗未来雷（旧代码一跑登录即 NameError）
- 提交本文件顺带携带他线条目：无

## 2026-09-10 13:58 · ZCode — 开工：form_action_engines 拆分回归修复（NameError 三连）

- 进行中：13:58；用户报真机回放 `fill_form_field → NameError: _replay_engine_store`。根因=昨日拆分（dbcc329b）fill/select/radio 三文件的 `*_for_replay` 包装用了 `_replay_engine_store/_ReplayPageAdapter/_ReplayAutofillStub` 而 tree_engine 才补了 import；另发现 login_engine 缺 `JS_FILL_FORM_FIELD`、fill_engine 缺 `import re/sys/json`——call-time 才爆，import 级 wiring 测不出的哑雷
- 范围：`scripts/controller/actions/{fill_engine,select_engine,radio_engine,login_engine}.py`（只加 import 行）、`scripts/characterization/characterize-form-engine-scope-audit.py`（新建 AST 作用域审计，防再犯护栏）、`scripts/refactor/verify-all.sh`（追加一行，独立 commit）、tmp/engine-scope-audit.py（草稿）、本文件
- 禁入区：他线 5 红（step-highlight/layer-tree/export-v3/confirm-notification/network-capture）不修；Cursor 线热区 `replay_form_action.py`/`click_action_engine.py`/`_misc.py`；`.cursor/`；`data/kb/**` 只读
- 方式：AST 作用域审计枚举全部哑雷 → 一次性补 import（只插行不删改）→ 真机验证登录组件回放 → 审计沉淀入门禁 → 收工


- 完成：**T4 全链**——门禁 `characterize-kb-recall-eval.mjs`（4 断言：结构/lockstep 防漂移绊线/六项批准 floor+退化明细/延迟预算，单一指标引擎=复用 runner 的 runRecallEval+compareWithBaseline，`71c24fa7`）；verify-all 追加一行独立 commit（`8ae492ed`，gate 内 `ok: characterize-kb-recall-eval`）；**自证三段式** 提交态绿 exit0 → 阈值+0.2 六项全红 exit1 → 还原绿 exit0（`tmp/kb-eval/T4-selfproof.txt`）；**reviewer 三建议落地**（`56b52af3`）：①多 gold 分摊口径入 JSDoc（0.757/0.708 vs 二值 0.760/0.711 差异显式化）②30 条种子统一 `seed:true`（行级手术编辑+changeLog 记批准来源，冻结文件审计 diff 最小）③`metrics.byTier` 每次运行输出（A 层第七项下限未捆绑加，留 Lead 单独批）；报告 T4 章节+结论翻转+todo ⑧ 状态行（本 commit）
- 验收：门禁 4 passed / runner Acc@1 0.65 不变 / T1 结构自检 OK / runner+门禁 lint 0 warning（characterization 目录在 eslint ignore=按 AGENTS 绕过区）/ verify-all 注册行生效
- 遵守：reviewer 更正未改任何代码（execSync EPERM 沙箱问题）；他线 5 红未碰；评测集仅元数据级 seed 字段，query/gold/条目数零改动
- 遗留移交：**G3 终局结论待 reviewer**（材料齐：本 commit + selfproof + 报告 §T4）；A 层独立下限待 Lead 单独批准；算法缺口另立项
- 提交本文件顺带携带他线条目：无

## 2026-09-10 13:44 · ZCode — 开工：KB 召回评测 T4 门禁写入（G1/G2 已 PASS）

- 进行中：13:44；G1 PASS（reviewer 11/11 新标一致 0 分歧）+ G2 PASS（阈值无条件批准，见 `reports/2026-09-09-kb-recall-eval-g1-g2.md`）→ T4 放行
- 范围：`scripts/characterization/characterize-kb-recall-eval.mjs`（新建门禁）、`scripts/kb/recall-eval.mjs`（仅 JSDoc 口径说明+byTier 输出，算法不动）、`scripts/characterization/fixtures/kb-recall-eval.v1.json`（仅 seed 字段统一，条目/gold 不动）、`scripts/refactor/verify-all.sh`（**只追加一行，独立 commit**）、本文件
- 禁入区：他线 5 红（step-highlight/layer-tree/export-v3/confirm-notification/network-capture）**不修**；`propose.js`；`data/kb/**` 只读；`.cursor/`；fill/select/radio/stc 热区；评测集条目与 gold 不动（reviewer 更正：runner `execSync` EPERM 系其沙箱所致，撤回阻断项，不为此改代码）
- 方式：门禁复用 runner 指标引擎（runRecallEval/compareWithBaseline 单一算法源）→ 自证阈值+0.2 必红→还原绿 → verify-all 注册行独立 commit → 三条非阻塞建议顺手落地 → T4 报告交 G3

## 2026-09-10 11:00 · Cursor Lead — 收工：legacy tssc_multi_select 经 SelectEngine（回链 10:58）

- 完成：`replay_form_action` 历史分支 → `SelectEngine.select_option_for_replay`；移除直调 `JS_TSSC`；升级 `characterize-select-replay-engine`；契约 §2.4 + select unify 兼容注
- 验收：select-replay-engine / select-dispatch / tssc-multi-select **GREEN**
- 遗留：无

## 2026-09-10 10:58 · Cursor Lead — 开工：legacy tssc_multi_select 回放经 SelectEngine

- 进行中：10:58；历史 `action_name=tssc_multi_select` 禁直调 JS_TSSC，改经 `SelectEngine.select_option_for_replay`
- 范围：`replay_form_action.py`、`characterize-select-replay-engine.py`、select unify / contract 短注、本文件
- 禁入区：click 族、fill、`.cursor/`、他线 WIP
- 方式：薄接线 + 升级 cold pin；不另开大 plan

## 2026-09-10 10:12 · Cursor Subagent — 收工：click index+button unify SDD close（回链 09:59）

- 完成：契约 §2.2 `click_button` / §2.3 `click_element_by_index` 经 `ClickEngine`；AGENTS 一句；verify-all 注册 `characterize-click-replay-engine`；click design 已落地；fill §8 index+button done；Task 5 文档/门禁收尾（**未 commit**，待主会话验收）
- 验收：`characterize-click-replay-engine` GREEN；click+radio cold pins GREEN
- 遗留：主会话 `git add` + commit `docs: Phase B click index+button record/replay unify close`

## 2026-09-10 09:59 · Cursor Lead — 开工：click index+button 录放统一 SDD 实现

- 进行中：09:59；用户选 Subagent-Driven；plan `2026-09-10-click-record-replay-unify.md` T1–T5
- 范围：`characterize-click-replay-engine.py`、`click_action_engine.py`、`_replay.py`、`_misc.py`、契约/AGENTS/verify-all、design 状态、本文件；ledger `.superpowers/sdd/2026-09-10-click-record-replay-unify/`
- 禁入区：menu/close 内核迁入；fill/select/radio；search-then-click 语义改动；`.cursor/`；他线 WIP
- 方式：SDD 每任务子智能体实现（不 commit）→ 主会话验收后提交

## 2026-09-10 09:56 · Cursor Lead — 收工：click index+button unify plan（回链 09:46）

- 完成：plan `docs/superpowers/plans/2026-09-10-click-record-replay-unify.md`（T1 pin → T2 ClickEngine for_replay → T3 `_replay` 接线 → T4 record 薄委托 → T5 契约/verify-all）；spec 链 plan
- 验收：plan 覆盖 C1–C4 / O1–O3；menu/close Out；与 radio Phase B 同形
- 遗留：用户选 Subagent-Driven 或 Inline 后开实现开工条目

## 2026-09-10 09:46 · Cursor Lead — 开工：click index+button 录放统一 design（直接 Phase B）

- 进行中：09:46；用户选范围 A（index+button）+ 深度 B（跳过 click_dispatch，经 ClickEngine）
- 范围：`docs/superpowers/specs/2026-09-10-click-record-replay-unify-design.md`；fill/radio §8 路线图指针；本文件
- 禁入区：实现代码、menu/close、`.cursor/`、他线 WIP（flow-card plan 等）
- 方式：落盘 design → 用户审阅 spec → writing-plans；本单元不写引擎代码

## 2026-09-10 09:50 · ZCode — 收工：phase-done 湿测①标记 PASS + spec 收尾（文档零代码）

- 完成：用户确认**重新录制已无问题**（误弹「AI 录制结束」不复现，控制面 20260909-1956 上服后实测）——`engine-wet-trio` 挂起表①stop→立即重录压测标记湿测 PASS（②③仍待测）；todo-list §⑥ 对应行同步；gitignored 本地件 spec 横幅补湿测状态；plans/2026-09-07-phase-done-cross-run-fix.md 头部加状态横幅。前端仓库的 spec 副本（vue-project docs/）已删（后端副本为唯一真源）。
- 注意：本条纯文档标记（todo-list/agent-log/两份本地件），零代码改动，未 commit（等用户指令）。

## 2026-09-10 00:55 · Cursor Lead — 收工：search-then-click SDD close（回链 09-09 22:02）

- 完成：Tasks 1–7 — `88b0772e`（guard+cold pin）/ `20fad726`+`1f9b053a`（phase mark/clear）/ `ffa9cb9f`（gate table+tree）/ `376fbce8`（dup-failure）/ `b7bd4a1d`（prompts+analyze）/ `1ae7f055`（KB+SKILL）；spec 状态→已实现
- 验收：`characterize-search-then-click-guard` OK / `characterize-search-then-click-prompts` OK；verify-all 内 STC 两 pin 绿；全 gate 6 红与他线/存量无关（xpath-fill-select、form-assistant、tree-select-record、step-highlight、layer-tree、export-v3）
- 遗留：湿测可选（#709 步序：盲树点→`err-search-first`；填搜索关键字→再点树→ok）；Task 3 fail-open vs fail-closed、need-fill-and-query pin 等 minor 登记 ledger 待后续

## 2026-09-09 · Cursor Subagent — Task 4：card-guided deterministic fallback + docs close-out

- 完成：`buildCardGuidedFallbackAtoms`（persist 边界合并 + flowRef）；characterize pin 61 passed；spec/agent-log 交叉引用更新

> **协议（2026-09-05 定稿，AGENTS.md 同步）**：任何会话**动代码前**在本块之下顶部插入**开工条目**——时刻 + 范围（文件/目录清单）+ 禁入区 + 方式，并立即 commit；**任务单元结束**插入**收工条目**回链开工条目——完成（含 commit hash）/ 验收证据 / 遗留移交，状态以收工条目为准。条目格式 `## 日期 · 工具/角色 — 标题`，要点用 完成/进行中/注意 前缀。文件集须与所有在途声明及工作区未提交改动不相交；子智能体由主会话代为声明、不直接写本文件、不 commit。提交本文件若顺带携带他线条目，commit message 注明。
> **归档**：2026-09-06（含）及更早条目已分流至 [agent-log-archive-2026-09-06.md](agent-log-archive-2026-09-06.md)（2026-09-09 归档）；更早历史见 [agent-log-archive-2026-09-05.md](agent-log-archive-2026-09-05.md)。**本文件只保留最近 3 天条目**——历史不删只归档。
## 2026-09-10 10:26 · ZCode — 微任务开工+收工：restart-local 日志可视性修复（开工申报与收工合并，本条随树内待下位提交者携带）

- 完成：`config/restart-local.cmd` 一处——server/executor 启动重定向由 stdout/stderr 双文件改为单文件合并（`> log 2>&1`），新增两个**可见 tail 观察窗**（`Get-Content -Wait -Tail 40 -Encoding UTF8`，/MIN 服务窗保持不变）；EADDRINUSE 检查与提示文案同步改读合并文件。根因=服务起在最小化窗且输出进文件，用户反馈「窗口看不到日志」
- 验收（无头验证，**未真跑 restart-local**——会杀在跑 4097 与他线工作）：①cmd 脚本内合并重定向 stdout+stderr 同文件落盘 ✓；②多文件 `Get-Content -Wait` 实测卡死首文件、后续文件饿死（故观察窗走单文件合并方案）；③单文件 -Wait 追加流式 + UTF8 中文 ✓；观察窗进程树 taskkill 清理 ✓。`.err.log` 消费方全仓仅本脚本自身，约定变更无外溢
- 注意：每次 restart 会开**新**观察窗，旧窗不自动关（手动关闭）；proxy 观察窗未加（日志在根目录 logs-executor-server-proxy.log，低频）；本条未单独 commit（agent-log 有他线未提交收工条目在树，不做共享文件竞写），restart-local.cmd 由本会话单独 commit
## 2026-09-10 00:50 · ZCode — 收工：本周收尾——结构梳理+文档+死代码+漏洞（回链 00:10 开工 fe7a500c）

- 完成（6 commits，三路 Explore 研究→五路子智能体并行实施→主线程验收代提交）：
  - **漏洞**（09-09 对抗 review P0×3+P1×4 离线修复，报告=reports/2026-09-09-engine-pipeline-adversarial-review.md）：`583ddeb0` P0-1 runId 两跳白名单透传+新端到端门禁 characterize-runid-bridge（已入 verify-all）；`9eb94716` P0-2 own-run canceled 改 settle+catch/finally runId 归属守卫、P0-3 90s 门闩三重活性+CAS+runId 提前铸造、P2#2 requestId 过滤/P2#6 failedPhases 报 phaseNumber/P2#7 forwardStdin 泄漏、P1-7 skipDefaultLogin 消费旧 _ACTION_LOG；`239711cf` P1-4 state.get_current_phase 统一事件归属+两条静默路径补发 phase_error；`1eecf87` P1-5 batch 409「已在录」重归类（per-tid 互斥未做）
  - **死代码第三轮**：`74f8829a` 18 死符号/17 文件净 -427 行（截图删除族/会话生命周期死方法/config 孤儿常量/form_rules 备用生成器），B 组 3 符号连同 4 个 pin 同步删针；**src/dedup.js 生产零引用仅门禁消费——删除待产品侧确认，登记 dedup-deletion**
  - **文档**：`125c426e` CLAUDE/README 死命令修正+结构树补全、package.json description 去 assemble、api-docs 补登记 5 个真实端点+`{param}` 占位符统一（app.js Try-it 只认花括号）、superpowers 第三波归档 7 篇+批次索引；gitignored 本地件 AI记忆方案/phase-done spec 已加状态横幅（不入库）
- 验收：合并工作区复跑关键 pin 16 套全绿（runid-bridge 4 passed / run-event-ownership / owned-wait-shape 5/5 / quality-final-gate 4/4 / record-status / trajectory / phase-done-runid / recorder-phase-reset 39 / form-rules / batch-import / heal-locate 39 / dedup / 4 个删针 pin）；`verify-all` 132 ok / 6 failed 全为存量（xpath-fill-select/form-assistant/tree-select-record/step-highlight/layer-tree/export-v3，源+pin 与 HEAD 逐字节一致=文本断言过期+DB 数据漂移，**零新增红**）；`npm run lint` 0 error / 65 warning 与基线持平
- 注意：①并行 Cursor 线 flow-card-guided-propose / search-then-click 在本线执行期间收工（`b927a170`/`88b0772e` 等），文件集零交集；flow-card spec 状态行编辑（未提交）仍留工作区，本线未携带未动。②修复的**真机湿测未做**——挂起表新增 `engine-wet-trio`（P1）等 6 行移交。③4097 控制面仍运行旧代码，**需择机重启加载本批修复**（涉及录制管线，重启前勿跑主链录制）
- 遗留移交：engine-wet-trio（真机三件套）/ p1-6-replayid / p2-batch-lease / p2-toast-cursor（js_snippets 副本在他线热区）/ dedup-deletion / p2-async-actionlog，均已入 todo-list 挂起表

## 2026-09-10 00:10 · ZCode — 开工：本周收尾——结构梳理 + 文档更新 + 死代码清理 + 漏洞处理（agent team 连续执行）

- 进行中：00:10；用户指令「本周收尾：项目结构梳理、更新文档、清理死代码、处理程序漏洞，带 agent team，连续执行」
- 范围（子智能体由本会话代为声明，文件集按路不相交）：①结构+文档路（只读研究→实施改 `README.md`、`docs/superpowers/**`、`src/dashboard/api-docs/catalog.js` 不一致项）；②死代码路（全库扫描→实施移除 `src/**`、`executor/**`、`scripts/**` 非热区符号/文件，含 pin 同步）；③漏洞路（核实 09-09 对抗 review P0×3/P1×4 现状→实施修复：`src/executor-session-client.js`、`executor/session-handler.js`（P0-1 runId 白名单+桥接表征）、`trajectory-recording-runner.js`/`trajectory-record-lifecycle.js`/`run-event-ownership.js`（P0-2/P0-3 竞速守卫）、Python `state.py`/`service.py`/`session_runner.py`（P1-4 事件归属））
- 共享文件**仅主线程改**：`scripts/refactor/verify-all.sh`、`package.json`、`AGENTS.md`、`todo-list.md`、本文件；子智能体一律不 commit
- 禁入区：`.cursor/` 与未跟踪 `plans/2026-09-09-flow-card-guided-propose.md`（他线 WIP）；fill/select/radio/tssc/search-then-click 热区（`scripts/controller/actions/*.py` 近三日他线改动文件只读不写）；`data/kb/**` 只读；安全 P1/P2 项（用户已明确不做勿再提）；不重启 4097/执行机、不动在途录制与执行机槽位
- 方式：三路 Explore 并行研究（结构文档/死代码/漏洞核实）→ 主线程定清单 → 并行 general-purpose 实施（各带自包含 prompt+验证命令）→ 主线程验收 + `verify-all` 与 HEAD 基线比对 + lint 0 新增 → 分单元 commit → 收工回报

## 2026-09-10 00:45 · ZCode — 收工：KB 召回评测常态化 T0–T3/T5/T6/T7（回链 09-09 22:44）

- 完成：**T0** 基线复现 6/6 精确 MATCH（`55a558ab` 声明）；**T1** 130 条评测集冻结（A40/B30/C15/D15/N30，62 卡覆盖，excluded 4，盲态子智能体复核 15/15 零分歧，`0e8a9f64`）；**T2** `rankFlowCards` + 2 pin=17 passed、重构后基线仍 6/6（`5acbbbe4`）；**T3** `scripts/kb/recall-eval.mjs` 真实排序指标运行器 + hold-out 对账 Δ全0 + `--baseline` 双向验收（`7543157e`）；**T5** PY agreement 62/100 非阻塞登记（`1e487ca4`）；**T6** 基线报告+阈值提案（`1be0ac8b`）；**T7** AGENTS 职责分离一句 + todo-list ⑧ 一行（本 commit）
- 验收：`characterize-flow-card-recall` 17 passed / `characterize-kb-recall` 24 契约+5 分歧绿 / v1 指标确定性稳定；**v1 基线 Acc@1 0.65**（Wilson [0.553,0.736]），分层 A 1.00 / C 0.87 / D 0.33 / B 0.23——B 层同义词鸿沟与 D 层 ASCII 短码分词缺口首次被独立评测集量化（旧 24 条 16/24 自 pin 掩盖）；证据 `tmp/kb-eval/`（baseline/T1-struct/T1-blind-review/T2/T3/T5/gate/v1-run1.json）
- 注意（并行线）：①「flow-card-guided-propose」线在本线执行期间开工且**未写开工条目**，其 WIP=改 `characterize-req-draft-traj.mjs`（flowGuided/PROPOSE_CACHE_VERSION=2 红 pin）+ duplicate-failure-cue 两文件 + 未跟踪 spec/plan；曾致 req-draft-traj 一度过红（本轮 verify-all 时已回绿）；该线若改 `flow-card-recall.js` 须以本线 `rankFlowCards`（`5acbbbe4`）为基线。②本轮 `verify-all` 7 红（capture-element-xpath/xpath-fill-select/form-assistant/tree-select-record/step-highlight/layer-tree/export-v3）经依赖检查对本线文件**零依赖**=他线热区 WIP+存量红，本线三套件在 gate 内全绿
- 遗留：**T4 门禁写入（`characterize-kb-recall-eval.mjs` + verify-all 一行 + 自证红/绿）等 G1（reviewer 抽检 15 条）与 G2（Lead 批阈值：Acc 0.600/Rec 0.707/MRR 0.614/nDCG 0.628/拒答 0.583/噪声 0.55 + 热50ms/冷200ms）后执行**；算法缺口（同义词桥/ASCII 短码/FP 覆盖率地板）另立项；评测集 v1 冻结只读，变更须 Lead 批准 + changeLog

## 2026-09-09 23:06 · Cursor Subagent — 收工：有 xpath 的 uml_ecd 唯一 SDD close（回链 22:08）

- 完成：Tasks 1–5：`f3d1c9cf`（红 pin）/ `ceb72223`（guard）/ `a9919634`（迁移 uk_uml_ecd_nav）/ `b7aa21db`（接线）/ `cd6f285b`（docs close）
- 验收：`node scripts/characterization/characterize-menu-uml-ecd-nav-guard.mjs` OK
- 遗留：湿环境须跑迁移 `20260909220000_system_uml_ecd_nav_unique.js`（他库若有双 xpath 同 uml 会先硬失败）；radio / search-then-click 他线 WIP 与本线无关

## 2026-09-09 22:47 · Cursor Lead — 收工：click_radio 录放统一 SDD close（回链 22:01）

- 完成：契约 §2.4 `click_radio` 经 `RadioEngine`；AGENTS 一句；verify-all 注册 `characterize-radio-replay-engine`；radio design 已落地；fill §8 `click_radio` done；Tasks 1–4 文档/门禁收尾（**未 commit**，待主会话验收）
- 验收：`characterize-radio-replay-engine` GREEN；fill/select/radio cold pins GREEN
- 遗留：主会话 `git add` + commit `docs: Phase B radio record/replay unify close + verify-all pin`

## 2026-09-09 22:44 · ZCode — 开工：KB 召回评测常态化（方向 3，T0–T7）

- 进行中：22:44；spec/plan/handoff 已确认（`specs/2026-09-09-kb-recall-eval-design.md` §13 D1–D12、`plans/2026-09-09-kb-recall-eval.md`、`plans/2026-09-09-kb-recall-eval-handoff.md`）
- 范围：`scripts/characterization/fixtures/kb-recall-eval.v1.json`（新建评测集）、`scripts/kb/recall-eval.mjs`（新建运行器）、`scripts/characterization/characterize-kb-recall-eval.mjs`（新建门禁）、`scripts/characterization/characterize-kb-recall.py`（T5 一致性）、`scripts/characterization/characterize-flow-card-recall.mjs`（T2 +2 pin）、`src/services/req-draft-traj/flow-card-recall.js`（T2 rankFlowCards）、`scripts/refactor/verify-all.sh`（**只追加一行**，独立 commit）、`AGENTS.md`+`docs/superpowers/todo-list.md`（T7 各一句）、`docs/superpowers/specs/2026-09-09-kb-recall-eval-design.md`（附录回填）、`docs/superpowers/reports/2026-09-09-kb-recall-eval-baseline.md`（T6）、本文件；证据落 `tmp/kb-eval/**`（不入库）
- 禁入区：`src/services/req-draft-traj/propose.js`（他线 entry-only atom 折叠，虽已收工仍不碰）；`data/kb/**` 只读；`.cursor/`；`config/update-db-whitelist.ps1`；`scripts/controller/actions/**`；fill/select/radio/search-then-click 热区；不调 `prepare`/`record/start`/`detach`；不改召回算法
- 方式：T0（基线复现→tmp）→T1 评测集 130 条（标注禁跑匹配器）→T2 ranked→T3 运行器→T4 阈值提案（**等 Lead 批准后写入**）→T5 PY 一致性→T6 报告→T7 文档；一个 Task 一个 commit；标注/复核需子智能体时由本会话代为声明

## 2026-09-09 22:20 · Cursor Lead — 收工：原子化入口步骤并入下一写（回链 22:11）

- 完成：`isEntryOnlyStep`（打开抽屉/向导且无保存）→ 当导航；LLM `foldEntryOnlyLlmAtoms`；prompt 禁单独入口 atom；表征 +2（fallback/LLM fold）；`characterize-req-draft-traj` **OK 55**
- 验收：customer-corp 样例「点【新增】打开向导抽屉」+「…【保存】」→ 1 个 write atom，taskDraft 含两步
- 遗留：用户需对 customer-corp **重新生成候选**（旧 propose 缓存会保留拆开的两笔）；重启 4097 加载新 propose.js

## 2026-09-09 22:11 · Cursor Lead — 开工：原子化入口步骤并入下一写（打开抽屉≠交易）

- 进行中：22:11；用户确认「打开向导抽屉」不得单独成 atom，应并入下一保存原子
- 范围：`scripts/prompts/req-draft-traj-atomize-prompt.md`、`src/services/req-draft-traj/propose.js`、`scripts/characterization/characterize-req-draft-traj.mjs`、本文件
- 禁入区：fill/select/radio/search-then-click/uml_ecd 他线 WIP；`data/kb/req/**` 语料不手改；Vue；whitelist
- 方式：isEntryOnlyStep + prompt + LLM 折叠 + 表征；主会话实现

## 2026-09-09 22:08 · Cursor Lead — 开工：有 xpath 的 uml_ecd 唯一 SDD 实现

- 进行中：22:08；用户选 Subagent-Driven；plan `docs/superpowers/plans/2026-09-09-uml-ecd-nav-unique.md`
- 范围：迁移、`menu-uml-ecd-nav-guard.js`、`menu-scan-apply`/`menu-json-import` 接线、表征 pin、api-docs 一句、本文件；ledger `.superpowers/sdd/2026-09-09-uml-ecd-nav-unique/`
- 禁入区：radio unify / search-then-click 热区与其 WIP（`search_then_click_guard.py`、radio cold pin、他线正在改的 `verify-all.sh` 大段）；fill/select；`.cursor/`
- 方式：SDD Task 1–5；子智能体不 commit，主会话验收后代提交；verify-all 注册时只追加本 pin 一行，避开他线冲突

## 2026-09-09 22:02 · Cursor Lead — 收工：有 xpath 的 uml_ecd 唯一 implementation plan（回链 21:57）

- 完成：plan `docs/superpowers/plans/2026-09-09-uml-ecd-nav-unique.md`（T1 红 pin → T2 guard → T3 迁移 → T4 接线 → T5 docs）；spec 链 plan（`1bb8c592`）
- 验收：覆盖表对照 spec §1–§4；冲突拒绝；wiring 可延到 T4
- 遗留：用户选 Subagent-Driven 或 Inline 后实现；与 radio / search-then-click SDD 文件集不相交

## 2026-09-09 22:01 · Cursor Lead — 开工：click_radio 录放统一 SDD 实现（回链 plan）

- 进行中：22:01；用户选 Subagent-Driven；plan `2026-09-09-radio-record-replay-unify.md` T1–T4
- 范围：`scripts/characterization/cold/characterize-radio-replay-engine.py`、`form_action_engines.py`（RadioEngine）、`replay_form_action.py`、契约/AGENTS/verify-all、radio/fill design 状态、本文件；ledger `.superpowers/sdd/2026-09-09-radio-record-replay-unify/`
- 禁入区：search-then-click / uml_ecd unique 他线；autofill 直调；点击族；`click_table_row_radio`；`.cursor/`；whitelist/kb
- 方式：SDD 每任务子智能体实现（不 commit）→ 主会话验收后提交；子智能体禁入他线文件

## 2026-09-09 21:57 · Cursor Lead — 开工：有 xpath 的 uml_ecd 唯一设计

- 进行中：21:57；用户选 A（生成列 UNIQUE + 写入拒绝）；冲突拒绝已确认
- 范围：`docs/superpowers/specs/2026-09-09-uml-ecd-nav-unique-design.md`、本文件；通过后 writing-plans
- 禁入区：整表 UNIQUE(uml_ecd)；自动合并节点；search-then-click / radio unify 他线；fill/select；`.cursor/`
- 方式：brainstorming 落盘 → 请用户审 spec

## 2026-09-09 22:02 · Cursor Lead — 开工：search-then-click SDD 实现

- 进行中：22:02；用户选 Subagent-Driven；plan `docs/superpowers/plans/2026-09-09-search-then-click.md`
- 范围：`search_then_click_guard.py`、`_table`/`_misc`/`intent_contract`/`form_action_engines`、dup-failure、prompts、analyze、KB flows、verify-all、本文件；ledger `.superpowers/sdd/2026-09-09-search-then-click/`
- 禁入：radio unify；`.cursor/`；新复合动作；改回放 actionType
- 方式：SDD Task 1–7；子智能体不 commit，主会话验收后代提交

## 2026-09-09 21:55 · Cursor Lead — 开工：树/列表「先查再点」implementation plan

- 进行中：21:55；writing-plans；spec 已批
- 范围：`docs/superpowers/plans/2026-09-09-search-then-click.md`、spec 状态行、本文件
- 禁入区：本单元不写护栏实现代码；radio unify；`.cursor/`
- 方式：落盘 plan → 请用户选 Subagent-Driven / Inline

## 2026-09-09 21:46 · Cursor Lead — 开工：树/列表「先查再点」design

- 进行中：21:46；用户批准 C + 护栏 A + 已查询 A + 路径 1；§1–§4 已口头 OK
- 范围：`docs/superpowers/specs/2026-09-09-search-then-click-design.md`、本文件
- 禁入区：引擎实现直至 writing-plans；radio unify 线；`.cursor/`；无关 KB 大改
- 方式：落盘 design → 用户审阅 spec → writing-plans；本单元不写护栏代码

## 2026-09-09 21:58 · Cursor Lead — 收工：click_radio unify plan（回链 19:56）

- 完成：plan `docs/superpowers/plans/2026-09-09-radio-record-replay-unify.md`（T1 pin → T2 RadioEngine → T3 replay 接线 → T4 契约/verify-all）；spec 链 plan
- 验收：plan 自检覆盖 R1–R4 / O1–O3；无 radio_dispatch；与 fill/select Phase B 同形
- 遗留：用户选 Subagent-Driven 或 Inline 后开实现开工条目

## 2026-09-09 19:56 · Cursor Lead — 开工：click_radio 录放统一 design（直接 Phase B）

- 进行中：19:56；用户选 B（跳过 radio_dispatch，经 RadioEngine mode=replay）
- 范围：`docs/superpowers/specs/2026-09-09-radio-record-replay-unify-design.md`；fill unify §8 路线图指针；本文件
- 禁入区：实现代码、whitelist、kb、`.cursor/`、菜单 umlEcd / 产品草稿他线
- 方式：落盘 design → 用户审阅 spec → writing-plans；本单元不写引擎代码

## 2026-09-09 18:55 · Cursor Lead — 收工：tssc P1 搜索竞态 + 回放 mismatch（回链 18:45）

- 完成：P1 `pollMatchingRow`（等行文案含 option）；回放 tssc 经 `_map_engine_select_result` + `_echo_from_select_ok`；注释写入 2026-09-09 Playwright 湿测结论
- 验收：tssc / select-dispatch / select-replay-engine / state-boundary / stamp **GREEN**
- 遗留：重启 executor 后复放「要素名称→服务ID」；用户自行 push

## 2026-09-09 18:45 · Cursor Lead — 开工：tssc P1 搜索竞态 + 回放 mismatch

- 进行中：18:45；Playwright 湿测：`pollRows` 见旧列表即点首行 → `ok-p1:部署方式` 而 want=`服务ID`；回放 tssc 经 `_with_xpath_first` 跳过 option-mismatch
- 范围：`scripts/controller/actions/js_snippets/tssc_multi_select.py`、`replay_form_action.py`、cold pin、本文件
- 禁入区：whitelist、kb、`.cursor/`、无关 partner WIP
- 方式：P1 等行文案含 option 再点；tssc 回放走 `_map_engine_select_result` + 正确 echo 解析

## 2026-09-09 18:04 · DSH — 收工：agent-log 归档分流完成（回链 18:03 开工）

- 完成：`agent-log.md` 1717→1724（开工条目 +7）→ 切分后主文件 1045 行；2026-08-24 ~ 2026-09-06 共 690 行条目原样分流至 `agent-log-archive-2026-09-06.md`（沿 09-05 归档先例命名）；主文件现仅含协议头 + 归档指针 + 09-07 ~ 09-09 条目
- 冲突修正（保留区内，仅结构归位、不改任何条目文字）：①删 bib-bridge 09-09 10:36 重复空开工头（正文完整版在同日条目区，收工回链不变）；②deadcode CAUTION ×9 开工正文（开工/范围/禁入区/方式 4 行）自收工条目块归位至开工头之下
- 归档头部已登记冲突链：09-06 23:29「重启加载他线未提交改动」被 23:32 更正；09-06 23:5x「P6 计划待批准」已被 09-07 00:02 获批落地；09-06 SKILL 第 3/4 轮修订被同日第 6 轮（v7）取代
- 验收：切分边界 grep 复验——主文件无 09-06 及更早条目头、归档区无 09-07+ 条目头（均 0 命中）；行数对账 1034+690=1724；UTF-8 无 BOM、换行风格不变
- 注意：工作区另有他线在途 M 改动（`scripts/characterization/characterize-menu-scan-uml-adopt.mjs`、`src/services/menu-scan-uml-adopt.js`）与 untracked `.cursor/`、`CHANGELOG.md`——均非本线产物，未纳入提交
- 遗留：无（历史查询走归档文件 + git log）；本条 + 归档文件一并 commit

## 2026-09-09 18:03 · DSH — 开工：agent-log 归档分流（主文件保留近 3 天）

- 开工：18:03（以 commit 为准）。用户派单：日志已超 1500 行，归档过期条目，主文件只保留最近三天（09-07 ~ 09-09）
- 范围：`docs/superpowers/agent-log.md`（归档切分 + 保留区两处结构冲突修正 + 顶部本组条目）、新建 `docs/superpowers/agent-log-archive-2026-09-06.md`（承接 09-06 及更早条目，沿 09-05 归档先例命名）；不碰其他任何文件
- 禁入区：全部代码/规格/语料/迁移；工作区 untracked `CHANGELOG.md`（09-04 已裁撤勿重建）与 `.cursor/` 不动不顺带；Cursor 17:20 在途线（产品库/要素库原子草稿）之 spec/tmp 文件
- 注意：本条与 17:20 Cursor 开工条目同以本文件为声明面，存在顶部追加交叠——本单元仅做归档切分与冲突修正，不改写他线条目内容；该线后续插入条目请基于本 commit 之后的文件
- 方式：开工 commit → pwsh 行级切分（分界 1027/1028 已 grep 校验干净）→ 修正保留区两处结构冲突（bib-bridge 重复空头、deadcode 开工正文错位）→ 收工条目一并提交

## 2026-09-09 21:57 · Cursor Lead — 开工：有 xpath 的 uml_ecd 唯一设计

- 进行中：21:57；用户选 A（生成列 UNIQUE + 写入拒绝）；冲突拒绝已确认
- 范围：`docs/superpowers/specs/2026-09-09-uml-ecd-nav-unique-design.md`、本文件；通过后 writing-plans
- 禁入区：整表 UNIQUE(uml_ecd)；自动合并节点；fill/select；`.cursor/`
- 方式：brainstorming 落盘 → 请用户审 spec

## 2026-09-09 17:30 · Cursor Subagent — 收工：菜单活动级 umlEcd adopt SDD 实现（回链 17:08）

- 完成：T1–T5 SDD 全链；关键 commits `043db591` / `132ce54a` / `150829a8` / `04524603` + docs `619a8cbe`（`docs: close menu activity umlEcd adopt design`）
- 验收：`characterize-menu-scan-uml-adopt.mjs` OK；`characterize-system-import-json.mjs` OK
- 遗留（湿测）：部署迁移 → `systemId=1` 再导入同份建模 JSON → 触发扫描 apply 或调用 `adoptModelingUmlEcdUnderSystem` → 核对产品四叶表（spec §4.2）；同事已手工改码可作对照

## 2026-09-09 17:20 · Cursor Lead — 开工：产品库/要素库 修改+删除原子草稿与补录
- 开工：17:20。范围 A 修改 + Del-A 删除；四笔原子草稿；fill 统一已收工可补录
- 范围：`docs/superpowers/specs/2026-09-09-product-mod-del-atomic-draft-design.md`、`tmp/product-mgmt/draft-mod-del/**`、本文件；补录成功后可回写 flows source（另注）
- 禁入：菜单 umlEcd adopt SDD 热区、fill/select 重构、`.cursor/`、他线 WIP
- 方式：先落设计+任务文案 → analyze/create → prepare/start（需 online+connected 执行机）

## 2026-09-09 17:08 · Cursor Lead — 开工：菜单活动级 umlEcd adopt SDD 实现

- 进行中：17:08；用户选 Subagent-Driven；按 `docs/superpowers/plans/2026-09-09-menu-activity-uml-adopt.md`
- 范围：迁移、`system-page-dao`、`menu-json-import`、`menu-scan-uml-adopt`、`menu-scan-apply`、表征、本文件；ledger `.superpowers/sdd/2026-09-09-menu-activity-uml-adopt/`
- 禁入区：按活动拆导航叶；fill/select；`.cursor/`；Vue/partner-platform
- 方式：SDD Task 1–5；子智能体不 commit，主会话验收后代提交

## 2026-09-09 17:02 · Cursor Lead — 收工：菜单活动级 umlEcd implementation plan（回链 16:58）

- 完成：plan `docs/superpowers/plans/2026-09-09-menu-activity-uml-adopt.md`（T1 红 pin → T2 迁移/DAO → T3 collectPages → T4 adopt 绿 → T5 docs）；spec 链 plan
- 验收：覆盖表对照 spec §1–§4；1:N clear 写进 collectPages
- 遗留：用户选 Subagent-Driven 或 Inline 后实现

## 2026-09-09 17:02 · Cursor Lead — 开工：菜单活动级 umlEcd implementation plan

- 进行中：17:02；用户审过 design「继续」；writing-plans，不实现
- 范围：plan 文件、spec 状态行、本文件
- 禁入区：实现代码直至用户选执行方式
- 方式：writing-plans → 请用户选执行方式

## 2026-09-09 16:58 · Cursor Lead — 开工：菜单活动级 umlEcd 回填设计

- 进行中：16:58；用户确认方案 1 + 1:N 仅唯一；同事已手工纠产品四叶
- 范围：`docs/superpowers/specs/2026-09-09-menu-activity-uml-adopt-design.md`、本文件；通过后 writing-plans → 实现（迁移 / import / uml-adopt / 表征）
- 禁入区：按活动拆导航叶；fill/select 录放线；`.cursor/`；他线 Vue/partner-platform
- 方式：brainstorming 落盘 → 请用户审 spec

## 2026-09-09 16:15 · Cursor Lead — 收工：fill 录放统一 SDD A→B（回链 15:40）

- 完成：Phase A（`fill_dispatch` + 双接线 + 契约）+ Phase B（`FillEngine.mode=replay` + `fill_form_field_for_replay`）；关键 commits `471b42d3` / `741e57cc` / `cee9519d` / `f991f2a8` / `739bd35a` / `c763511e`；verify-all 注册 fill-dispatch + fill-replay-engine
- 验收：fill-dispatch / fill-replay-engine / xpath-fill-select / select-dispatch / select-replay-engine **GREEN**
- 遗留：湿测 fill；点击族 / radio 另开；login 内 fill 直调未动；SDD workspace 可删

## 2026-09-09 16:05 · Cursor Subagent — 收工：§6.4 功能候选下拉 Vue 实现 + docs 收口（回链 15:48 设计 / 15:50 plan）

- 完成：Vue `a1ac7d1`（`FunctionIdCandidate` + `fn-pick.ts` + selfcheck）→ `587f30c`（表列功能下拉、`fnPickByAtomKey`、`canCreate` 不依赖左侧、`runCommit` 按行 overrides）；JS-gen spec 标已实现 + §6 代码项勾选 + todo §6.4 前端派单关闭
- 验收：fn-pick selfcheck ok；静态清单 3/3 PASS（无 left-nav 统一 override 循环 / `canCreate` 无 `hasSelectedFunction` / 无 validate·paasUserId·truncated）
- 注意：Out 仍 Out — validate 端点、truncated 条、paasUserId、JS-gen propose/commit、SSE、`kind` 列；`canProposeAtoms` 既有逻辑未改
- 遗留：湿测 = 重启控制面 4097 + product-mgmt 向导勾选多行绑不同功能 → commit body overrides 两键两值与 UI 一致

## 2026-09-09 15:50 · Cursor Lead — 收工：§6.4 功能候选下拉 implementation plan（回链设计 15:48）

- 完成：`docs/superpowers/plans/2026-09-09-req-draft-wizard-function-candidates.md`（T1 helpers → T2 表列/canCreate/commit → T3 docs）
- 验收：覆盖表对照 spec §3–§6；无 validate/paasUserId
- 遗留：用户选 Subagent-Driven 或 Inline 后实现

## 2026-09-09 15:48 · Cursor Lead — 收工：§6.4 功能候选下拉设计稿（回链开工同批）

- 完成：`docs/superpowers/specs/2026-09-09-req-draft-wizard-function-candidates-design.md`（表列下拉；overrides 按行；Out validate/truncated/paasUserId）
- 验收：用户选范围 A + 确认推荐方案 1
- 遗留：用户审阅 spec → writing-plans；尚未实现

## 2026-09-09 15:48 · Cursor Lead — 开工：§6.4 功能候选下拉设计稿

- 进行中：2026-09-09 15:48；用户「下一步」→ 范围 A → 确认表列方案
- 范围：本 spec、本文件
- 禁入区：Vue 实现本单元不改；JS-gen 运行时；whitelist；select/fill 录放线
- 方式：brainstorming 落盘 → 请用户审文件

## 2026-09-09 15:40 · Cursor Lead — 开工：fill 录放统一 SDD 实现（A→B）

- 进行中：15:40；按 `docs/superpowers/plans/2026-09-09-fill-record-replay-unify.md` Subagent-Driven；子智能体不 commit
- 范围：`fill_dispatch.py`、`form_action_engines.py`（FillEngine）、`replay_form_action.py` fill 分支、cold pins、contract/AGENTS/verify-all、本文件；ledger `.superpowers/sdd/2026-09-09-fill-record-replay-unify/`
- 禁入区：点击族、login 内 fill、whitelist、kb、`.cursor/`、select_dispatch（除非共享 helper）
- 方式：SDD Task 1–9；主会话 commit

## 2026-09-09 15:35 · Cursor Lead — 收工：fill 录放统一 implementation plan（回链 15:30）

- 完成：`docs/superpowers/plans/2026-09-09-fill-record-replay-unify.md`（Task 1–9：A 红 pin→fill_dispatch→双接线→契约；B 红 pin→FillEngine mode→replay 调引擎→verify-all）；spec 链 plan
- 验收：覆盖表对照 fill spec；对齐 select unify 样板；login/点击族明确不动
- 遗留：用户选 Subagent-Driven 或 Inline 后实现

## 2026-09-09 15:30 · Cursor Lead — 开工：fill 录放统一 implementation plan

- 进行中：15:30；用户「继续」；writing-plans，不实现
- 范围：plan 文件、spec 状态行、本文件
- 禁入区：实现代码、点击族、whitelist、kb、`.cursor/`
- 方式：writing-plans → 请用户选执行方式

## 2026-09-09 15:25 · Cursor Lead — 收工：fill 录放统一设计稿 A→B（回链 15:22）

- 完成：`docs/superpowers/specs/2026-09-09-fill-record-replay-unify-design.md`（对齐 select A→B；点击族仅路线图）
- 验收：用户确认方向 A + 落盘「可以」
- 遗留：用户审阅本 spec → 通过后 writing-plans；**尚未实现**

## 2026-09-09 15:22 · Cursor Lead — 开工：fill 录放统一设计稿

- 进行中：15:22；用户确认先 fill、深度 A→B；只写 spec
- 范围：`docs/superpowers/specs/2026-09-09-fill-record-replay-unify-design.md`、本文件
- 禁入区：实现代码、点击族实现、whitelist、kb、`.cursor/`
- 方式：brainstorming 落盘 → 请用户审文件

## 2026-09-09 15:30 · Cursor Lead — 收工：select 录放统一 SDD A→B（回链 14:35）

- 完成：Phase A（`select_dispatch` + 双接线 + 契约）+ Phase B（`mode=replay` + replay 调 `select_option_for_replay` / tree）；主线 commits `814595f7`…`44384ace`（见 ledger）；verify-all 注册 select-dispatch + select-replay-engine
- 验收：`characterize-select-dispatch` / `select-replay-engine` / `tssc-multi-select` / `select-state-boundary` / `select-option-stamp` **GREEN**
- 遗留：湿测复放「要素名称→部署方式」；全量 verify-all 或有环境噪；SDD workspace 可删；他线 `partner-platform.js` / `.env.example` 未动

## 2026-09-09 14:35 · Cursor Lead — 开工：select 录放统一 SDD 实现（A→B）

- 进行中：14:35；按 `docs/superpowers/plans/2026-09-09-select-record-replay-unify.md` Subagent-Driven；子智能体不 commit，主会话验收后代提交
- 范围：`scripts/controller/actions/select_dispatch.py`、`form_action_engines.py`、`replay_form_action.py`、cold pins（select-dispatch / tssc / Phase B）、`engine-actions-contract`、`AGENTS.md`、verify-all、本文件；ledger `.superpowers/sdd/2026-09-09-select-record-replay-unify/`
- 禁入区：`config/update-db-whitelist.ps1`；kb drafts；`src/services/partner-platform.js`（他线 WIP）；`.cursor/`；fill 全双线重写
- 方式：SDD Task 1–9；主会话 commit

## 2026-09-09 14:20 · Cursor Lead — 收工：select 录放统一 implementation plan（回链 14:15）

- 完成：`docs/superpowers/plans/2026-09-09-select-record-replay-unify.md`（Task 1–9：A 红 pin→dispatch→双接线→契约；B 红 pin→engine mode→replay 调引擎→verify-all）；spec 标已批准
- 验收：覆盖表对照 spec §3–§8；无 TBD 占位
- 遗留：用户选 Subagent-Driven 或 Inline 后实现；本单元未改 `scripts/controller/actions/**` 实现

## 2026-09-09 14:15 · Cursor Lead — 开工：select 录放统一 implementation plan

- 进行中：14:15；spec 已批准（用户「继续」）；writing-plans，不实现
- 范围：`docs/superpowers/plans/2026-09-09-select-record-replay-unify.md`、spec 状态行、本文件
- 禁入区：实现代码、kb、whitelist、`.cursor/`
- 方式：writing-plans → 请用户选执行方式

## 2026-09-09 14:10 · Cursor Lead — 收工：select 录放统一设计稿 A→B（回链 14:08）

- 完成：`docs/superpowers/specs/2026-09-09-select-record-replay-unify-design.md`（Phase A 共享 router → Phase B 回放复用 SelectEngine）；用户口头批准方向后落盘
- 验收：自检无占位矛盾；链 D6 / engine-actions-contract / hotfix `84a320a2`
- 遗留：用户审阅本 spec → 通过后 writing-plans；**尚未实现**

## 2026-09-09 14:08 · Cursor Lead — 开工：select 录放统一设计稿

- 进行中：14:08；用户选 A→B；只写 spec，不写代码/plan
- 范围：`docs/superpowers/specs/2026-09-09-select-record-replay-unify-design.md`、本文件
- 禁入区：`scripts/controller/actions/**`（本单元不改实现）、kb、whitelist、`.cursor/`
- 方式：brainstorming 落盘 → 请用户审文件

## 2026-09-09 14:05 · Cursor Lead — 收工：回放 select_option→tssc 路由（回链 13:55）

- 完成：`replay_form_action` 在 `select_option` 分支按 `target_kind=form_tssc_multi_select` 或 live `.tssc-multi-select` 转 `JS_TSSC_MULTI_SELECT`；cold pin 增补；代码提交 **`84a320a2`**
- 验收：`characterize-tssc-multi-select` / `characterize-select-state-boundary` / `characterize-select-option-stamp` **GREEN**
- 遗留：重启 executor 后复放「要素名称→部署方式」；用户自行 push

## 2026-09-09 13:55 · Cursor Lead — 开工：回放 select_option→tssc 路由缺口

- 进行中：13:55；`log.txt` 要素名称 `select_option(部署方式)` → `option-not-found:deplMod,…`；自愈走引擎 handoff `ok-p1` 证明 JS v2 正常，缺口在 `replay_form_action`
- 范围：`scripts/controller/actions/replay_form_action.py`、`scripts/characterization/cold/characterize-tssc-multi-select.py`、本文件
- 禁入区：`config/update-db-whitelist.ps1`；kb drafts；`.cursor/`；无关 KB 线
- 方式：metadata `form_tssc_multi_select` + live `.tssc-multi-select` 探测 → `JS_TSSC_MULTI_SELECT`；pin → 验收

## 2026-09-09 12:50 · DSH reviewer — 收工：KB 加固验收修复（回链 12:24）

- 完成：验收结论 **PASS**（初次 DONE_WITH_CONCERNS → 修复后复验全绿）；修复 6 项 — F-A 新增 lint warning×3、F-B 观测落盘隔离（`KB_STAGING_DIR`）+清污（**保留 4 条真实 py 召回**，测试行归档 `tmp/review-observability-archive/`）、F-C `matchFlowForAtom` 返回 `score`、F-D 金样例 note 事实更正、R-3 py 绊线改「不得有已收敛却仍登记的分歧」、R-4 出处列入 api-docs
- 验收：全量门禁 **ALL GREEN exit=0**；基线 req-draft **OK 53** / flow-card-recall **15 passed** / fk-guard 11/11 / kb-req-modules 11 / py golden 24+5div；lint **68→65（0 errors）**；DB Batch 42/43/44 + `traj_req_atom_uq` 唯一索引核实；探针 15 断言；报告 `docs/superpowers/reports/2026-09-09-kb-remediation-reviewer-verdict.md`
- 提交：**`0b8cc0e2`**（代码+pin，7 files，+66/−17）/ **`c3c01cd1`**（报告+台账+本文件，3 files，+103）；提交前沙箱禁止写 `.git/` 曾阻塞，经用户批准升级沙箱后由本会话提交；工作区仅余他线 `?? .cursor/`（未纳入）
- 遗留移交：R-1 生产库迁移演练（回填+唯一索引联合路径未行使，生产若存在 F-01 漂移会按设计中止）；R-2 真实 LLM 路径未湿测；R-5 前端 §6.4 派单

## 2026-09-09 12:24 · DSH reviewer — 开工：KB 加固验收修复（F-A~F-D + R-3/R-4）

- 进行中：2026-09-09 12:24。reviewer 验收结论 DONE_WITH_CONCERNS（3 必须修复 + 4 登记风险），本轮只修不扩范围
- 范围：`src/services/req-draft-traj/flow-card-recall.js`（F-A/F-C）、`src/services/req-draft-traj/propose.js`（F-B 观测隔离）、`scripts/characterization/fixtures/kb-recall-golden.json`（F-D note）、`scripts/characterization/characterize-kb-recall.py`（R-3 绊线）、`scripts/characterization/characterize-req-draft-traj.mjs` / `characterize-flow-card-recall.mjs`（F-B pin）、`src/dashboard/api-docs/groups/trajectory.js`（R-4 出处列）、`data/kb/staging/*.jsonl`（清污）、`docs/superpowers/reports/2026-09-09-kb-remediation-reviewer-verdict.md`、本文件
- 禁入区：`config/update-db-whitelist.ps1`；`.cursor/`；tssc 线文件（`scripts/controller/actions/**`、`form_action_engines.py`、`_form.py`、tssc prompts）；`data/kb/req/**`、`data/kb/flows/**`（不改语料）
- 方式：逐项修复 → 复跑 lint 归因 + 五条基线 + 全量 gate → 出 reviewer 结论文档 → 收工条目

## 2026-09-09 12:00 · Cursor Lead — 收工：tssc v2 实现 Subagent-Driven（回链 11:07）

- 完成：T1–T4 落地 — commits `02f6d1f6..32c1352d`（pin → JS P0–P2 → 引擎录 `select_option` → D6 反注册+prompt/autofill/wizard/_llm_values）；`characterize-tssc-multi-select` / `select-option-stamp` / `agent-prompt-packs` **GREEN**
- 验收：核心 cold pin 全绿；`bash scripts/refactor/verify-all.sh` 本轮 **FAILED**（与本线无关环境噪：`characterize-step-highlight` / `layer-tree` MySQL `ETIMEDOUT`；`network-capture` WSL 临时路径 python probe）——tssc 相关步骤在同次 gate 内为 ok
- 遗留：重启 executor 后湿测要素名称/客户名称；verify-all 环境噪可另开；SDD workspace `.superpowers/sdd/2026-09-09-tssc-multi-select-v2/` 可删

## 2026-09-09 11:07 · Cursor Lead — 开工：tssc v2 实现（Subagent-Driven T1–T5）

- 进行中：11:07；按 `docs/superpowers/plans/2026-09-09-tssc-multi-select-v2.md` 派子智能体逐任务；子智能体不 commit，主会话验收后代提交；子智能体不写 agent-log
- 范围：`scripts/controller/actions/js_snippets/tssc_multi_select.py`、`form_action_engines.py`、`_form.py`、`autofill_round.py`、prompts（form/tssc/agent-prompt/agent_utils）、characterization pins、verify-all 若需、agent-log 由主会话收工
- 禁入区：`config/update-db-whitelist.ps1`；kb drafts；deadcode/引擎 P0 修复线；`.cursor/`
- 方式：SDD ledger `.superpowers/sdd/2026-09-09-tssc-multi-select-v2/progress.md`

## 2026-09-09 11:05 · Cursor Lead — 收工：tssc v2 implementation plan（回链 11:02）

- 完成：`docs/superpowers/plans/2026-09-09-tssc-multi-select-v2.md`（T1–T5）；spec 标已批准；plan commit `5b6c7773`
- 验收：D1–D6 覆盖表齐全
- 遗留：用户选 Subagent-Driven 或 Inline 后实现

## 2026-09-09 11:02 · Cursor Lead — 开工：tssc v2 implementation plan

- 进行中：11:02；spec 已批准（含 D6）；写 plan，不实现
- 范围：docs/superpowers/plans/2026-09-09-tssc-multi-select-v2.md；agent-log
- 禁入区：snippet/引擎本单元不改；whitelist；他线 bib-bridge 已收工
- 方式：writing-plans → 用户选执行方式后再实现

## 2026-09-09 10:50 · ZCode 引擎线 — 收工：bib-bridge 地址栏跳转补丁 PASS（回链 10:36）

- 完成：`executor/bib-bridge.js` navigate 分支补 `action==='url'` → `Page.navigate`（trim 后空 url 拒绝 `empty_url`；`Page.enable` 已在 _bindPageTarget 开启）——commit `c8573939`
- 验收：新增冷区行为 pin `scripts/characterization/cold/characterize-bib-navigate-input.mjs`（stub CDP client 六例：url 跳转/空 url 拒绝/reload/back/forward/unknown_navigate_action 不回归），注册 verify-all 后全量 **ALL GREEN**，ok 行 124→**125**（唯一增量=本 pin）；`executor/bib-bridge.js` 单文件 eslint 0 问题
- 遗留移交：**执行机重启待协调**（4097 进程仍跑旧代码，需不打断在途录制时重启 server+executor——先 server 后 executor）；真机湿测=前端录制详情页地址栏输 URL 回车页面跳转；前端无需改动（800ms 后自动拉 tabs 刷新地址栏）；未触碰他线 `config/update-db-whitelist.ps1`（M 态 WIP 未携带）

## 2026-09-09 10:36 · ZCode 引擎线 — 开工：bib-bridge 地址栏跳转补丁（navigate action=url）

- 进行中：10:36。前端线已定位：地址栏回车 `remote:input {kind:'navigate',action:'url'}` → 控制面 ws-router 转发正常 → `executor/bib-bridge.js` handleInput navigate 分支只实现 reload/back/forward，`action==='url'` 落 441 行 `unknown_navigate_action` 静默丢弃（前端/控制面/入口三环均无恙）
- 范围：`executor/bib-bridge.js`（navigate 分支加 url case，约 5 行）、`scripts/characterization/cold/characterize-bib-navigate-input.mjs`（新建行为 pin：stub client 断言 url→Page.navigate/空 url 拒绝/reload+back+forward+unknown 不回归）、`scripts/refactor/verify-all.sh`（注册一行）、agent-log 本文件
- 禁入区：`config/update-db-whitelist.ps1`（他线 M 态）、`.cursor/`、Cursor tssc_multi_select v2 线文件（10:31/10:32 声明）、`scripts/controller/**`、`src/services/trajectory/**`、引擎 P0/P1 修复线（报告已入库待用户拍板，另开工）
- 方式：主线程直接实施（小改动不派子智能体）；验证=新冷区行为 pin + verify-all + lint；执行机重启需协调（不打断在途录制），本单元只交付代码不改运行进程

## 2026-09-09 10:55 · Cursor Lead — 收工：修订 tssc v2 spec D6（回链 10:54）

- 完成：`2026-09-09-tssc-multi-select-v2-design.md` 增补 §2.1 / D6——agent 只调 `select_option`；controller 不向 agent 注册 `tssc_multi_select`；handoff 录制改记 `select_option`；失败文案禁止引导直调；spec commit `470b50e9`
- 验收：用户口述裁决已写入决议表 D6 与 In/Out/Prompt/验收 C6–C7
- 遗留：用户终审后 writing-plans → 实现（含反注册 + JS v2）
- 注意：本收工条目提交若工作区含他线已写入未入本 commit 的 agent-log 行，message 注明；bib-bridge 线条目为他线已提交内容

## 2026-09-09 10:54 · Cursor Lead — 开工：修订 tssc v2 spec（select_option 唯一对外面）

- 进行中：10:54；用户裁决——agent 不直接调 tssc_multi_select；controller 不向 agent 注册该动作；一律 select_option 转调内部实现
- 范围：仅 `docs/superpowers/specs/2026-09-09-tssc-multi-select-v2-design.md` + agent-log
- 禁入区：snippet/引擎实现本单元不改；whitelist / kb / 死代码线
- 方式：改 spec + commit；实现另开

## 2026-09-09 10:32 · Cursor Lead — 收工：tssc_multi_select v2 设计 spec（回链 10:31）

- 完成：湿测拍板写入 `docs/superpowers/specs/2026-09-09-tssc-multi-select-v2-design.md`；v1 spec 加 v2 指针；决议 D1–D5（P2 兜底任意首项 / 无文案跳过 P1 / 仅 table / 单次 JS / P1 关精确查询）
- 验收：用户已确认方案 1 + A + 跳过 P1 + table-only；spec 自检无 TBD 矛盾
- 遗留：用户审阅本 spec 后 → writing-plans → 实现；浏览器会话可继续湿测

## 2026-09-09 10:31 · Cursor Lead — 开工：tssc_multi_select v2 设计文档

- 进行中：10:31；Playwright 湿测后写 design spec（不实现）
- 范围：`docs/superpowers/specs/2026-09-09-tssc-multi-select-v2-design.md`；可选回链改 `2026-09-08-tssc-multi-select-action-design.md`；agent-log
- 禁入区：`scripts/controller/actions/js_snippets/tssc_multi_select.py` 本单元不改；`config/update-db-whitelist.ps1`；kb draft；死代码/引擎 P0 修复线
- 方式：brainstorming → 用户确认 → 写 spec + commit；实现另开单元

## 2026-09-09 · ZCode 死代码清理线 — 开工：CAUTION 待裁 9 项执行移除（用户裁决）

- 开工：09-09（时刻以 commit 为准）。用户裁决首轮清理的 CAUTION ×9（生产零引用但被 pin）执行移除：①executor-registry.clearAll ②③screenshot-pending-store getPendingDir/listPendingFiles ④screenshot-service findPhaseGroupByStateGroup ⑤screenshot-service listPageLevelScreenshotsByTrajectory ⑥constants 4 状态表 ⑦memory-dao deleteByTrajectory ⑧protocol.KNOWN_EVENT_TYPES ⑨runtime/script-runner.js 整文件——每项同 commit 同步改 pin
- 范围：src/services/executor-registry.js、src/services/screenshot-pending-store.js、src/services/screenshot-service.js、src/models/constants.js、src/memory/memory-dao.js、src/memory/protocol.js、src/runtime/script-runner.js（删）、对应 pin：scripts/characterization/characterize-replay-batch*、cold/screenshot-pending*、phase-group-shot.py、page-level-screenshot*、record-status-v2/trajectory/batch-import 相关、smoke-memory-ingest、network-capture、characterize-dedup；agent-log 本文件
- 禁入区：引擎 review 热区（src/services/trajectory/**、scripts/session_runner.py、scripts/state.py、scripts/agent/service.py、src/executor-event-hub.js、remote-session-service/replay-actions/form-structure-heal/auth-recording/trajectory-manual-record/phase-highlight-screenshot——三路只读 review 在途）；人工 CLI ×11（api-capture 报文捞取线资产）不动；migrations/** 不动；config/update-db-whitelist.ps1 他线 WIP
- 方式：worktree 独立分支 `cleanup/deadcode-caution-20260909`（D:\dev\JS-gen-deadcode，junction+.env 模板法）；先逐项复核 09-08 后仍零引用，再删+改 pin+原子 commit；worktree verify-all 比对基线（network-capture 探针 worktree 环境特异红除外）→ 合并回 uara_V1.2 主检出终验 ALL GREEN；只读侦查/审查子智能体由本会话代声明

## 2026-09-09 · ZCode 死代码清理线+引擎review线 — 收工：CAUTION ×9 全删（-233 行）+ 三路对抗 review 漏洞报告入库（回链开工）

- **deadcode 收工**：8 原子 commit（d9f76259→23a90df2）ff 合入 uara_V1.2，17 文件 +20/−233，整文件删 src/runtime/script-runner.js；每单元同 commit 改 pin（replay-batch teardown 行/cold screenshot-pending/phase-group-shot cue/page-level 断言/trajectory+batch-import+cold record-status-v2 三处收窄/smoke-memory-ingest 内联 knex 清理 23/23 过/network-capture step1/dedup replay-marker 段）。验收=主检出 verify-all 前后基线比对：124 ok 行全同（唯一差异=dedup 日志文案有意改）；worktree 法全程（junction 先摘非递归删、branch 已删、主检出 node_modules 完好 278 项）。教训两笔：①smoke 目录 gitignore 但文件被跟踪——git add 须 -f；②amend 落错 HEAD（叠到后一笔上）——soft reset 重排两笔修复；C6 曾漏删 dao 函数本体，分支级零引用复核抓到
- **引擎 review 交付**：三路只读子智能体（JS 管线/Python 执行机/跨端 hub）对抗审查完毕，合并去重后 **P0×3 + P1×4 + P2×10**，全部带 file:line 与失效时序，报告入库 `docs/superpowers/reports/2026-09-09-engine-pipeline-adversarial-review.md`。头条：**runId 在 executor-session-client.js 与 executor/session-handler.js 两道字段白名单被丢，runId 归属隔离上线即失效（生产全走 legacy 路径）**；stop→重录级联误杀（stale runner 10min 后写 failure+砍新 agent）；90s 终局门闩对 detach→重附场景守卫失效。子智能体由本会话代声明，未写本文件未 commit（read-only）
- 遗留移交：报告内 P0/P1 修复排序建议待用户拍板后实施；旧 execute-env 红的 worktree 判据不变

## 2026-09-08 23:59 · ZCode KB 加固线 — 收工：KB 链路加固 Task 0+四线 13 任务全落地，verify-all ALL GREEN（回链 23:10）

- 完成：Task 0 门禁（`38142025` kb-staging/kb-promote 移到横幅前+自证故意失败 exit=1）；A 线 T1 稳定 atomKey+回填迁移（`9ca808f3`，dev 库 0 行存量=No-op）、T2 幂等全状态+req_atom_seq 唯一索引（`55bce80c`，真库 ER_DUP_ENTRY 实证）、T9 validate 端点+paasUserId（`e04c72ec`）；B 线 T3 缓存 cacheVersion/sourceHash/原子写+gitignore（`f09635e7`，10 个盘上缓存保留判过期）、T4 propose 4xx 语义（`712e40fd`，4098 独立实例 HTTP 实证）、T8 functionIdCandidates（`941b00b2`，product-mgmt 28/28=100%）、T13 reference_step+truncated（`4e13dd98`，chain-b:4/c:2 出局）；C 线 T6 召回 idf 重写（`359809cb`，800 字 2ms 基线 654ms；金样例 24/24；provenance 具名权重+章节 mtime+size 缓存）、T7 跨语言金样例契约（`4cf1827f`，py 19/24 直配+5 条 divergenceAccepted 登记；AGENTS.md 补唯一跨语言契约行）；D 线 T5 出处锚点 req_source_hash/req_chunk_id+commit 回查（`f6f34f54`）、T10 观测 JSONL+propose-stats（`d967367b`）、T11 source 上传复用 multer（`35a0fbe1`，HTTP 端到端 sourceDoc=副本相对路径）、T12 promotedAt 打标（`dbe12376`，沙箱实证）、T14 F-15 登记（`4693e5cb`）
- 验收：终轮 `bash scripts/refactor/verify-all.sh` **ALL GREEN**（tmp/kb-remediation/gate-final.txt）；spec §9 逐条——§9.2 门禁自证（D0/gate-selfproof-fail exit=1）、§9.3 金样例两侧断言入 verify-all、§9.4 product-mgmt 副本两次 propose 26/26 键全同（final/probe-spec9-out.txt）+同键重复由 T2 真库唯一索引拦截；characterize-req-draft-traj 26→**52**、flow-card-recall 12→**14**（金样例+性能断言）；lint 全程 0 新增 warning（存量 23 条未动）；三笔迁移已 apply（Batch 42/43/44）；全程零 prepare/record/start/detach
- 注意：⑧ 线 API 契约有增量（validate 端点/functionIdCandidates/kind/truncated/stale 语义），**前端仓库待派单**：向导禁用条件改 `canProposeAtoms` + 候选下拉（spec §6.4，本线未动前端仓）；py 召回 5 条分歧在 fixture 内登记待 D3 另议收敛；`data/kb/staging/*.jsonl` 观测已 gitignore
- 遗留移交：①spec §6.4 前端派单（上）；②F-15 readonly-partial 待 Lead 批准（todo ⑧′ 已登记）；③服务器库迁移部署时须跑三笔新迁移（20260908231500/233000/2350000）；④propose 真实 LLM 路径湿测未跑（本线全离线桩/4098 隔离实例，避免网关挂起）；⑤观察 `data/kb/staging/recall-events.jsonl` py 侧运行期增长
- 状态：本线全部任务闭环，状态以本条目为准；工作区仅剩他线 `config/update-db-whitelist.ps1`（M 态，未触碰）

## 2026-09-08 23:10 · ZCode KB 加固线 — 开工：KB 链路加固 Task 0 + 四线（A/B/C/D）连续执行

- 进行中：23:10。按已批准 spec（`specs/2026-09-08-kb-remediation-design.md`）+ plan（`plans/2026-09-08-kb-remediation.md`）实施 Task 0→A(1/2/9)→B(3/4/8/13)→C(6/7)→D(5/10/11/12/14 连续执行)。开工本条目顺带把 spec/plan 两份未入库文档 carry 进 commit
- 范围：`scripts/refactor/verify-all.sh`、`src/services/req-draft-traj/**`（parse-through-chains/propose/propose-cache/commit/provenance/flow-card-recall/atom-keydata）、`src/dao/trajectory-dao.js`、`src/services/trajectory/trajectory-meta-service.js`、`src/routes/v2/kb.js`、`src/dashboard/api-docs/groups/kb.js`、`src/http/upload-xlsx.js`（只读复用）、`migrations/`（新增三笔）、`.gitignore`、`scripts/characterization/characterize-req-draft-traj.mjs|characterize-flow-card-recall.mjs|characterize-kb-recall.py|fixtures/kb-recall-golden.json`、`scripts/kb/recall.py|promote_draft.mjs|propose-stats.mjs`、`scripts/prompts/skills/req-doc-to-kb/SKILL.md`（仅登记）、`AGENTS.md`（跨语言单源补一行）、`data/kb/staging/`（运行期 JSONL）；本文件
- 禁入区：`config/update-db-whitelist.ps1`（他线 M 态）、`data/kb/req/**/.draft-traj-propose.json`（禁止手改，Task 3 只加 gitignore）、`data/kb/flows/**`（禁止手改）、`src/services/trajectory/**` 除 `trajectory-meta-service.js` 一处透传、`scripts/controller/**`（引擎热区）、其余他线 WIP
- 方式：主会话连续执行（不派子智能体改文件）；每 Task 先 pin 后实现后复跑 verify-all；全程禁 `prepare`/`record/start`/`detach`；迁移 up/down 成对 + hasColumn 守卫；api-docs 同步每笔

## 2026-09-08 23:00 · Cursor Lead — 收工：轻量每步末扫通知（回链 22:50）

- 完成：AI_STEP_NOTICE_SCAN（默认开）；JS_SCAN_STEP_NOTICES；on_step_end 注入【页面通知】去重 cue；成功 toast 顺带 toast_ok；复用既有 JS_NOTIFY_HOOK 兜底短命通知
- 验收：characterize-step-notice-scan PASS
- 遗留：重启 executor；可用 AI_STEP_NOTICE_SCAN=off 关闭

## 2026-09-08 22:50 · Cursor Lead — 开工：轻量每步末扫通知注入 agent

- 进行中：22:50。用户选定轻量方案：每步末扫可见 toast/error（非常驻业务 hook），塞进 agent 观察；可复用 __notify_log
- 范围：feature_flags、js snippet、recorder on_step_end cue、characterize pin；本文件
- 禁入：whitelist / draft-traj / kb-remediation / 常驻 MutationObserver 新架构
- 方式：TDD pin → step_end 扫+去重注入 HumanMessage；成功文案顺带 toast_ok → 收工

## 2026-09-08 22:55 · Cursor Lead — 收工：introduce_pick 成功令牌（回链 22:45）

- 完成：sanitize introduce_pick 合并 toast_ok/dialog_close/picker_closed；click_save toast+确定 补记 picker_closed/dialog_close；phase_done_ok 关闭类别名；pin characterize-introduce-dialog-close + verify-all
- 验收：characterize-introduce-dialog-close / phase-boundary / phase-reviewer / done-accept-reason PASS
- 遗留：重启 executor 后重录；全局通知 hook 不做

## 2026-09-08 22:45 · Cursor Lead — 开工：introduce_pick 成功令牌（dialog_close vs toast_ok）

- 进行中：22:45。sid 0975ed13：click_save 已 ok-save-success/toast_ok，但 success_when=[dialog_close] 反复 Premature done 空转
- 范围：form_save.py（toast 路径补记 picker_closed）、phase/boundary_gates.py 或 reviewer sanitize、characterize；本文件
- 禁入：whitelist / draft-traj / kb-remediation / tssc 无关改动
- 方式：TDD — introduce_pick 合并成功 kinds（含 toast_ok/dialog_close）；toast+确定 补记关闭证据 → 收工

## 2026-09-08 22:40 · Cursor Lead — 收工：tssc 推送并进 select:click + first 打戳（回链 22:35）

- 完成：442665eb — ACTION_TO_ENGINE_TYPE tssc_multi_select→select:click；成功路径 resolve_recorded_option_text(ok-first 回显)；pin legacy/transaction/stamp/tssc；spec/plan 备注
- 验收：characterize-tssc-multi-select / characterize-select-option-stamp / characterize-legacy-engine-export / characterize-transaction-export PASS
- 遗留：重启 executor 后重录才有具体 option_text；存量 first 步需重录或手工改库

## 2026-09-08 22:35 · Cursor Lead — 开工：tssc_multi_select 推送并进 select:click + first 落库打戳

- 进行中：22:35。用户裁定：导出映射并进 select:click（不再 select:tssc-multi）；落库时将 ok-first:回显 打成具体 option_text
- 范围：legacy-engine-export.js、form_action_engines.py tssc_multi_select 成功路径、characterize pin/export、spec/plan 备注、本文件
- 禁入：whitelist / draft-traj-propose / kb-remediation WIP
- 方式：改 ACTION_TO_ENGINE_TYPE；成功路径 resolve_recorded_option_text(option, echo)；pin → 收工

## 2026-09-08 22:25 · Cursor Lead — 收工：tssc_multi_select 字典 el-option 回退（回链 22:15）

- 完成：84db48e5 — 无 select-table 行时回退 el-option；统一匹配/点击/回显；精确 OFF 仅 table；prompt/pin；策略统一 first
- 验收：characterize-tssc-multi-select + characterize-agent-prompt-packs PASS。收工时 CDP 19242 ECONNREFUSED（浏览器已关），湿测未复跑；先前同会话已证手点 option 可回显
- 遗留：重启 executor 后重录要素类型用 tssc_multi_select(..., first|原文)；选项窥探不做，统一 first

## 2026-09-08 22:15 · Cursor Lead — 开工：tssc_multi_select 支持字典 el-option（要素类型）

- 进行中：22:15。CDP 19242 实证：「要素类型」亦为 TsscMultiSelect，但弹层是 el-option（下拉数据字典/阈值）非 `.select-table`；现片段只收集表行 → no-items；点 el-option 可选中
- 范围：`scripts/controller/actions/js_snippets/tssc_multi_select.py`、prompt/pin、本文件
- 禁入：whitelist / draft-traj-propose / 他线 WIP
- 方式：无表行时回退 `.el-select-dropdown__item`；CDP 已验证点选项可回显

## 2026-09-08 22:05 · Cursor Lead — 收工：修 tssc_multi_select fill 退化（回链 21:55）

- 完成：fill 拒写 tssc/tree；option-not-found 禁 fill/精确查询并指引 `first`；搜索强制精确 OFF；affordances/prompt/pin
- 验收：`characterize-tssc-multi-select` + `characterize-agent-prompt-packs` PASS；根因 sid `5b463582` step3→fill 链
- 遗留：需重启 executor 后重录 #696；任务文案勿把 stamp 当数据项名

## 2026-09-08 21:55 · Cursor Lead — 开工：修 tssc_multi_select 录制退化为 fill（sid 5b463582）

- 进行中：21:55。用户反馈 #696 类录制「不好用」：日志 step3 `tssc_multi_select(要素名称, 20260908-elem)`→option-not-found 后反复 `fill_form_field` 假成功 + 误开精确查询 → 无匹配数据
- 范围：`scripts/controller/actions/form_action_engines.py`（fill 门禁）、`js_snippets/tssc_multi_select.py`（精确查询启发式）、`result_protocol.py` affordances、`agent-tools-tssc-multi-select.md`、characterize pin；本文件
- 禁入：whitelist / draft-traj-propose / trajectory-dao / 死代码清理已合入区无关改动
- 方式：fill 拒写 tssc-multi-select → 强化 option-not-found 指引 → 禁止搜索时强开精确 → pin → 收工

## 2026-09-08 19:42 · ZCode 死代码清理线 — 收工：全仓死代码清理 534 行落库，verify-all ALL GREEN（回链 18:55）

- 完成：10 个原子 commit（`376fa2b1`→`9440dae8`）fast-forward 合入 uara_V1.2，31 文件 **+1/−534**。C1 整文件孤儿 ×6（models/index barrel、models/sys-msg shim、services/sys-msg/index barrel、playwright-runner/lib/helpers.js、scripts/count_steps.py、scripts/tools/_gen_locator_helpers_py.mjs 过期副本）；C2-C9 零引用符号 ×30 + 死转发行 ×11 组（trajectory-store ×4 含传导死亡 getTrajectoryRecord、ws 层 ×3、remote-session/state ×4、杂项导出 ×7、hierarchy 模板+转发行 ×6、locator-candidates ×3、constants ×7、DAO 方法 ×9）
- 验收：①worktree 干净基线 vs 编辑后 verify-all ok 行逐一相同（115 ok，唯一红=characterize-network-capture 的 Python 探针 import，实证为 worktree 环境特异性、主检出绿）；②合并后主检出 **verify-all ALL GREEN 120 项零失败**；③5 个只读子智能体全程（侦查 ×3、kill list 对抗复核 ×1〔37 项 36 确认 1 修正〕、分支 diff 审查 ×1〔PASS：无裹挟删除、36 被删符号 HEAD 零引用、保留项 REMOTE_SESSION_OCCUPIED/EVENT_SOURCES/isGeneratedId 等全部完好〕）
- 遗留移交：CAUTION（生产零引用但被 pin，删除须同步改 pin）×9 清单在清理报告（clearAll、screenshot-pending ×2、findPhaseGroupByStateGroup、listPageLevelScreenshotsByTrajectory、constants 4 个状态表、memory deleteByTrajectory、KNOWN_EVENT_TYPES、runtime/script-runner.js 整文件）；人工 CLI CAUTION ×11 未动（api-capture 是报文捞取线资产明示保留）；DANGER 零项未删。发现：`src/dao/trajectory-dao.js:630` 存量 18 条 jsdoc warning（1ad954fe 引入，主检出现存，宜由该线补 @param）；pack-control-plane.sh 打包缺 executor/（运维不一致）；「export 收窄」候选清单在报告
- 注意：worktree D:\dev\JS-gen-deadcode 已拆除（node_modules junction 先摘再删，防递归误删主检出依赖），分支 cleanup/dead-code-20260908 已合并删除；本线全程未触碰禁入区与他线 WIP

## 2026-09-08 18:55 · ZCode 死代码清理线 — 开工：全仓死代码清理（用户模板任务）

- 开工：18:55。用户下发死代码清理流程：SAFE 直接删、CAUTION/DANGER 只报告不动代码
- 范围（预计改动集，侦查已毕）：src/{models/index.js、models/sys-msg.js、services/sys-msg/index.js、playwright-runner/lib/helpers.js、trajectory-store.js、executor-ws.js、ws-server.js、services/remote-session-service.js、cdp/remote-bridge/state.js、services/screenshot-service.js、services/sso/paas-client.js、services/hierarchy-excel.js、services/hierarchy-service.js、services/agent-stderr-log-service.js、cdp/locator-candidates.js、dao/ 若干文件、models/constants.js、http/api-response.js、memory/memory-dao.js、memory/protocol.js、runtime/agent-process.js、routes/browser-session/executor-events.js}、scripts/count_steps.py、scripts/tools/_gen_locator_helpers_py.mjs；另 agent-log 本文件
- 禁入区：config/update-db-whitelist.ps1、scripts/characterization/characterize-req-draft-traj.mjs、src/dashboard/api-docs/groups/kb.js、src/services/req-draft-traj/**、data/kb/req/**（⑧线 WIP）；src/services/trajectory/**、src/services/transaction-export*、legacy-engine-export.js、src/dedup.js、src/models/action-name.js、src/models/element.js、scripts/controller/actions/**（引擎/TsscMultiSelect/伙伴导出线热区）；migrations/**（有意保留的一次性归档）
- 方式：worktree 独立分支 `cleanup/dead-code-20260908`（D:\dev\JS-gen-deadcode，不切共享检出分支、不碰他线 WIP）；只删全仓零引用 SAFE 项（含 characterization pin 复核），逐单元 commit+验证，收工合并回 uara_V1.2 后 verify-all 终验；Explore 子智能体只读侦查/审查由本会话代声明（不写本文件、不 commit）

## 2026-09-08 18:50 · Cursor Subagent — 收工：关键数据分层 + 候选假流式 UX（回链 16:05）

- 完成：Tasks 1–5 绿；plan `docs/superpowers/plans/2026-09-08-req-draft-keydata-and-streaming-ux.md`（`5ac588bf`）；spec 状态 → 已实现；docs 收工（本 commit）
- 验收：characterize-atom-keydata OK；characterize-req-draft-traj OK（pageCodes + sanitize pin）；Vue `vue-tsc` OK
- JS-gen：`475328d4` prompt · `af756fa4` atom-keydata · `01794542` propose wire
- Vue dev：`8788ee9` atom-display/types · `00c62ca` 3-step fake-stream wizard
- 湿测：SKIP — 待用户重启 4097 + 冒烟录制向导（product-mgmt 生成 → 勾选 → 创建）

## 2026-09-08 18:45 · Cursor Subagent — 收工：TsscMultiSelect 专用动作实现线（回链 17:42）

- 完成：Tasks 1–5 绿；spec 状态 → 已实现；docs 收工（本 commit）
- 验收：`characterize-tssc-multi-select.py` PASS（dry）
- 实现 commits：`9ac615a8` pin · `2c19b731` JS snippet · `0a2de736` scan · `b303394b` engine/registries · `93cd430f` replay/heal · `ba63c84c` prompts/autofill
- 注意：`effdc8fb` 为 keydata restore，与本线无关
- 遗留：#695/#696 重录；`introduce_pick` toast_ok vs dialog_close 门闩（spec Out，另案）
- 湿测：SKIP（本 session 未验控制面 4097 + 选择要素弹窗）

## 2026-09-08 17:50 · Cursor Lead — 进度：TsscMultiSelect 设计已批，实现计划已落盘（回链 17:42）

- 进行中：spec 已批准；plan `docs/superpowers/plans/2026-09-08-tssc-multi-select-action.md`（Task1 pin → JS → scan → engine → prompts/autofill → 收工）
- 注意：代码尚未动；等用户选 Subagent-Driven 或 Inline 执行
- 禁入：同 17:42

## 2026-09-08 17:42 · Cursor Lead — 开工：TsscMultiSelect 专用动作设计（对标 select_tree_option）

- 进行中：17:42。用户确认专用动作，并要求契约参考已注册 tree-select 族
- 范围：`docs/superpowers/specs/2026-09-08-tssc-multi-select-action-design.md`；本文件；审过后再写 plan / 动 `scripts/controller/actions/**`、prompts、characterize（未开工代码）
- 禁入：遗留 #61/#66/#503；`config/update-db-whitelist.ps1`；`data/kb/req/**/.draft-traj-propose.json`；trajectory-dao 他线 WIP；不改 introduce_pick 门闩
- 方式：spec → 用户审文件 → writing-plans → 实现；扫描分流须在 `.el-select` 之前；匹配键修「只认第一列英文」

## 2026-09-08 17:21 · Cursor Lead — 收工：产品要素库原子重录湿测（回链 16:10 / 16:28 / 16:40 / 16:45）

- 完成：T2 #694 recorded PASS；T3 #695 / T4 #696 业务有保存成功证据但轨迹 failed；T1 #693 废止；顺带修 page-bind 关窗 `93112677` + idleP 竞态 `a01b7461`
- 验收：报告 `tmp/product-element/through-report.md`；#694 stderr `SUCCESS: 操作成功` + stamp 类型；#695/#696 亦有 save success，但 P3/premature-done/idle timeout 拖状态
- 遗留移交：T3/T4 是否清后重录或只认业务；T4 `introduce_pick` 门闩 toast_ok vs dialog_close；核实要素是否挂在 stamp 组件下

## 2026-09-08 16:45 · Cursor Lead — 开工：修 record idleP 解构竞态 + 重录 #694

- 开工：16:45。用户纠正天元应关闭后已修 page-bind（`93112677`）；重录仍假完成：根因 `const { idleP } = startPhaseWatchdog()` 解构错误 → Promise.race 立即 resolve → 阶段空跑 + new_step_arrived 互砍
- 范围：`src/services/trajectory/trajectory-recording-runner.js`（+characterize 若有）、重启控制面后 clear/prepare/start #694、本文件
- 禁入：遗留 61/66/503；他线 trajectory-dao WIP
- 方式：改 `const idleP = startPhaseWatchdog(...)` → pin → 重启 4097 → 重录

## 2026-09-08 16:40 · Cursor Lead — 开工：page-bind empty-config 关天元弹窗 + 重录 #694

- 开工：16:40。用户纠正：导航后天元应自行关闭；根因=prepare `read_page_component_code` 在 `empty-config`/`timeout` 早退未点确定关窗，agent 见可见弹窗按 prompt 暂停
- 范围：`scripts/controller/actions/js_snippets/page_id.py`、characterize-page-bind（若加固）、`tmp/product-element/` 重录、spec/plan/task 去掉等 C 文案、本文件
- 禁入：遗留 61/66/503；trajectory-dao 他线 WIP；不改 agent-tools-common 全局纪律（修源头关窗即可）
- 方式：补关窗 → pin → clear/prepare/start #694→695→696

## 2026-09-08 16:35 · Cursor Lead — #694 误判等 C（已由 16:40 纠正）

- 现象：A 已落地（`da1d081e`）；#694 prepare+start 后 agent 自停；`steps=0`（已 clear→draft）；session `08369de8`
- 误判：当成需授权关窗；实为 page-bind 读码早退未关窗

## 2026-09-08 16:28 · Cursor Lead — 修订：废 T1（方案 A），续录 T2=#694

- 修订：16:28。用户选 A；#693 failed（天元弹窗 pause + zero-actions done 拒）；独立进入原子废止
- 范围：同 16:10；改 `task-T2`/`specs|plans/*product-element-atomic*`；串行 **694→695→696**
- 禁入：重录 #693；擅自关「天元相关配置」（未授权 C）；遗留 61/66/503；他线 WIP
- 方式：PATCH #694 任务+phases → prepare/start/detach；T3/T4 依赖 T2 stamp 类型

## 2026-09-08 16:10 · Cursor Lead — 开工：产品要素库原子交易重切湿测（参考 #61/#66/#503）

- 开工：16:10。用户确认方案 B；仅以 #61/#66/#503 为参考；spec `2026-09-08-product-element-atomic-rerecord-design.md`
- 范围：`tmp/product-element/`（task/analyze/create/prepare/start/through-report）、`docs/superpowers/specs|plans/*product-element-atomic*`、本文件；建 draft 挂 **9000000468**
- 禁入：改/删遗留 61/66/503；产品库侧 688/689/670 要素配置录制；引擎大改；trajectory-dao 等他线 WIP
- 方式：T1→T4 串行 analyze/create → prepare/start/detach；stamp `20260908-elem`；account=2（**已由 16:28 修订为 T2→T4**）

## 2026-09-08 16:05 · Cursor — 开工+收工：关键数据分层 + 候选假流式 UX 设计

- 完成：用户认可方向；spec → `docs/superpowers/specs/2026-09-08-req-draft-keydata-and-streaming-ux-design.md`（关键数据 A/B/C 分层；向导三步合并勾选；假流式非 SSE）
- 验收：设计自检覆盖 prompt/UI/兼容旧缓存；真流式明确 Out
- 遗留：用户审阅后 writing-plans + 实现
- 注意：仅文档；未动 Vue/propose 代码

## 2026-09-08 15:31 · Cursor — 收工：人工录制 el-radio 去掉码值 fill 重复步（回链 15:16 开工）

- 完成：`emitFill` 跳过 native radio/checkbox 与 `.el-radio`/`.el-switch` 容器；点单选只记 `click_radio`（`567312e0`）
- 验收：`characterize-manual-radio-fill` OK；用户湿测通过
- 遗留：无

## 2026-09-08 15:31 · Cursor — 收工：批量推送业务对象名去掉动词（回链 15:00 开工）

- 完成：`propertiesName` 改为字段名（`buildBusinessObjectName`）；不再拼填写/选择/点击；legacy-engine 操作名未改（`f1728b38`）
- 验收：characterize-transaction-export / export-region / export-v3 / legacy-engine-export OK；用户湿测通过
- 遗留：无

## 2026-09-08 15:16 · Cursor — 开工：人工录制 el-radio 去掉码值 fill 重复步

- 进行中：点 Element UI radio 只记 click_radio，不再因原生 input change/blur 多记 fill（码值 0/1）
- 范围：`scripts/manual_recorder/js_parts/b.py`（`emitFill`）；characterization `characterize-manual-radio-fill.py`
- 禁入：V3 导出 / transaction-export.js 动词名改动；Python RadioEngine 回放路径
- 方式：TDD 先红后绿；根因=emitFill 已跳过 .el-select 未跳过 .el-radio
- 注意：已收工，见上方 15:31 条目

## 2026-09-08 15:00 · Cursor — 开工：批量推送业务对象名去掉动词

- 进行中：伙伴 `propertiesName` 改为字段名（与真实名称对齐），不再拼「填写/选择/点击」等动词
- 范围：`src/services/transaction-export.js`；characterization `characterize-transaction-export.mjs` + `characterize-transaction-export-region.mjs`
- 禁入：legacy-engine `buildOperationName`（操作名仍带动词）；V3 截图/分区组装；Vue SPA
- 方式：TDD 改 characterization 期望 → 改 `mapStepToTransactionEvent`；V2/V3 推送共用此函数
- 注意：已收工，见上方 15:31 条目

## 2026-09-10 · ZCode 重构线 — 收工：form_action_engines.py 按引擎拆分完成（回链开工条目）

- 完成：2329 行单文件拆为 7 件——form_engine_base(48)/login_engine(190)/fill_engine(717)/select_engine(1129)/radio_engine(109)/tree_engine(161)/barrel(25行纯re-export)。commit 链：73ae1dcc(spec/plan)→03d18a4f(S1 pin拼接)→fc094dd7(S2 base)→S3(login)→dbf0dc43(S4 fill)→dd7bba38(S5 select)→496e7510(S6 radio)→dfb2740a(S7 tree+barrel终态)
- 验收：每步 verify-all 与基线一致（4 存量红 step-highlight/layer-tree/export-v3/confirm-notification，均他线数据漂移/pin 过期，零新增红）；25 个 read_text pin 经"顺序保真拼接读取"全存活；4 个 cold 脚本单独跑 PASS；barrel 身份检查 5/5；顺带修绿 3 个存量红 pin（tree-select-record/xpath-fill-select/form-assistant）
- 关键教训（已写回 plan）：①搬运序必须严格等于拼接序（radio 先行实测 select 系 chunk 切空变红，回退重排）；②6 个 cold 脚本中 6 个实际有 6 个在门禁内——调研修正假设；③S7 barrel 终态曾因 IndentationError 半途未生效致双类并存，靠 barrel is 身份检查抓出
- 遗留：confirm-notification 存量红（_misc.py pin 漂移，属 click 线热区，未代修）；dst 桌面 select-click-handover 包中的 form_action_engines.py 现已过时（不影响规格正确性，py 参考以 select_engine.py 为准）
- 注意：本轮文件集=scripts/controller/actions/{form_action_engines,form_engine_base,login_engine,fill_engine,select_engine,radio_engine,tree_engine}.py + 25 characterization 脚本 + 本条 docs；未触碰 src/ 与他线 WIP

## 2026-09-10 · ZCode 重构线 — 开工：form_action_engines.py 按引擎拆分

- 范围：scripts/controller/actions/form_action_engines.py（拆为 5 引擎文件+base+barrel）+ 新建 form_engine_base/login/fill/select/radio/tree_engine.py；特征化 pin 迁移（25 个 read_text 脚本，逐批改读新路径）；docs/superpowers/{specs,plans}/2026-09-10-form-action-engines-split-*.md
- 禁入区：他线 WIP（session_runner.py、kb-flow-cards/req-draft-traj/propose-cache、Cursor 未提交的 specs/plans/docs）；src/ 下任何文件（本轮不触碰）
- 方式：先调研（2 个 Explore 子智能体并行：pin 清单+依赖图）→ spec+plan 落盘 commit → 逐引擎微步搬运（barrel 保持 import 兼容）→ 每步 verify-all；子智能体不 commit，主会话验收代提交

## 2026-09-08 · ZCode V3导出线 — 收工：弹窗与触发行同层级（2475f9fb）

- 完成：弹窗 propertiesPID 改指触发 ele 的父节点（同级展示）+ reorderPopupSubtrees 弹窗子树移到触发行后并重编 ID；layer-tree 工具交错渲染同步
- 验收：verify-all ALL GREEN；traj 499 顺序/挂载正确（图标→弹窗同级相邻，字段嵌弹窗下）；桌面 transaction-499-push.json + layer-tree.html 已刷新
- 遗留：伙伴平台需确认同级渲染效果；4097 重启生效
- 注意：文件集 = transaction-export-v3{,-properties}.js + scripts/tools/layer-tree-from-properties.mjs

## 2026-09-08 · ZCode V3导出线 — 收工：V3 推送白名单扩容（32578e3d）

- 完成：ACTION_TO_ENGINE_TYPE 新增 picker_dialog_query→input / picker_dialog_select→select:click / workspace_tabs→click / tree_picker_click→click；workspace_tabs 仅放行 activate；Node 别名 click_icon_button→click_button；操作名/取值（弹窗查询:/弹窗选择:/树选:/页签:）
- 验收：verify-all ALL GREEN；traj 201 实测新增条目正确（弹窗查询 value=公司、页签、图标）；存量 14 步 click_icon_button 已 DB 订正为 click_button（traj 56/61/68）
- 遗留：引擎专用动作（picker/tree/workspace）录制时 element_json 无定位信息→推送 locator=null，需 Python `_record_action` 补元素采集；partner 侧需确认 select:click 的 objectValue=row_text 语义；4097 重启生效
- 注意：文件集 = src/models/action-name.js + src/services/{legacy-engine-export,transaction-export}.js，与他线不相交

## 2026-09-08 11:52 · Cursor Lead — 收工：SDD atom-record flow-card recall 实施闭环（回链 10:07 开工）

- 完成：Task 1–7 全落地——`1ad954fe` migrate/DAO、`b96d5840` recall helpers、`5430cb68` propose suggest、`b7274dff` commit 落库、`0b450207` prepare 注入、`5cca1e8d` preview API；docs close-out 见本 commit
- 验收：characterize-flow-card-recall **11 OK**；spec 标已实现并链计划 `docs/superpowers/plans/2026-09-08-atom-record-flow-card-recall.md`
- 遗留：migrate + 4097 重启 + 湿测（prepare 见 `【流程卡模板】`、GET `/api/v2/trajectories/:id/flow-template-hint`）；Task 4 前 commit 的 traj 无 `kbFlowRef` 需重 commit
- 注意：未做 Vue 手改 flowRef UI；未 commit propose-cache JSON；与 V3 导出线文件集不相交

## 2026-09-08 11:10 · ZCode V3导出线 — 收工补充三：人工录制接入页面级截图（03e5254d）
- 完成：trajectory-attach-service.js bindTrajectoryManualPersist 订阅补 page_level_screenshot 分支 → applyPageLevelScreenshot。根因实证：产品人工链只消费 manual_action_recorded，Python wrap 器发的页面/弹窗截图事件无人接（traj 677 stamps 在而 screenshots=0；组件录制 668/671 走 listener #3 有 page_level 行佐证管线可用）。
- 验收：eslint 0、模块 import ok；效果=人工重录后弹窗有真实截图（coverageMode=page_level），8e76fde8 合成兜底转存量。
- 遗留：①manual 链 step_screenshot（before/after）**用户裁决不做**——人工录制不需要每步截图，页面/弹窗级（页面切换+弹窗开关时机）仅服务 V3 导出；②需重启 4097 server 生效。

## 2026-09-08 10:40 · ZCode V3导出线 — 收工补充二：人工录制弹窗合成（8e76fde8）
- 完成：transaction-export-v3-screenshot.js legacy 链尾部——按步骤 stamp 的 popup_level_key（含 @@anchor）分组合成 popup 条目（父=page、无截图空数组、regionId=key），挂载复用触发链。人工录制不发页面级截图事件（traj 677 screenshots=0）的兜底。
- 验收：traj 677 重建 payload——popup 产品 ← 图标新增产品、序号/产品名称/产品描述/确定 ← popup；popupTriggerLinked=1；eslint 0；五篇 characterize 全绿。注意：characterize-partner-platform.mjs 已被他线 fa2e5be9 移除，回归清单剩五篇。
- 遗留：与 Cursor 10:07 SDD 计划文件集（kb-flow-cards/req-draft-traj）不相交，无冲突。

## 2026-09-08 10:07 · Cursor Lead — 开工：SDD 执行 atom-record flow-card recall 计划（用户选 Subagent-Driven）

- 进行中：计划 `docs/superpowers/plans/2026-09-08-atom-record-flow-card-recall.md`；workspace `.superpowers/sdd/2026-09-08-atom-record-flow-card-recall/`；Task 1→7
- 范围：migrations + trajectory-dao/meta + kb-flow-cards + req-draft-traj recall/propose/commit + prepare inject + preview API + docs
- 禁入：轨迹查询 WIP、Vue RecordingDialog/vite WIP、propose-cache JSON、未批准不 migrate/重启
- 方式：每 Task 子代理实现 + 任务审查；本文件仅声明

## 2026-09-08 10:03 · Cursor — 开工+收工：原子录制召回流程卡实现计划

- 完成：用户 OK spec；计划 → `docs/superpowers/plans/2026-09-08-atom-record-flow-card-recall.md`（7 Task：migrate/DAO → recall helpers → propose suggest → commit 落库 → prepare 注入 → preview API → docs）
- 验收：计划对照 spec §5–§12 覆盖自检通过；禁入轨迹查询 WIP / Vue 手改 UI
- 遗留：待用户选 Subagent-Driven 或 Inline 执行
- 注意：仅文档；未动业务代码

## 2026-09-08 09:53 · Cursor — 开工+收工：原子录制召回流程卡设计（方案 A 落库列）

- 完成：用户确认注入时机=prepare/record；落库=trajectory 新列 `kb_flow_ref`/`kb_flow_node_id`。spec → `docs/superpowers/specs/2026-09-08-atom-record-flow-card-recall-design.md`（待用户审阅后再 writing-plans）
- 验收：设计与既有 req 出处列风格对齐；明确 propose 不写长前置、无命中不挡录制
- 遗留：用户审阅 §5/§8/§9 后出实现计划
- 注意：未动业务代码；勿与轨迹查询 WIP / V3 导出线交叉

## 2026-09-08 10:00 · ZCode V3导出线 — 收工补充：人工录制 select_option 分层修复（18b0a2b8）
- 完成：①录制侧 js_parts/b.py——el-select 下拉面板挂 body（popper），人工录制存 option 面板元素致 region=other、导出脱离 tab 分层；改为与 AI 同形态存页面内 .el-select 容器（is-focus 定位），option 文本走参数。②导出侧 transaction-export-v3-properties.js——分区段仅为 other 的步骤沿用前序分区段（存量人工数据兜底）。
- 验收：traj 679（人工）重建 payload「选择额度类型」← tab基本信息；assembled manual JS 含补丁（30480 字节）；eslint 0；characterize-export-v3/pid/layer-tree 全绿。
- 注意：需执行机重启生效（嵌入 Python）；traj 679 步骤 9-12 为用户 UI 手删（级联删截图已随 197ea073 生效）。
- 遗留：date-picker/cascader 面板元素同为 body 挂载，若后续暴露同类分层问题按同思路修。

## 2026-09-08 04:45 · Cursor — 开工+收工：listReqModules 提前标 canProposeAtoms（散文主链不可选）

- 完成：`f8e8bc43` 根因=多数 through-chains.md 为 `##`/有序步骤列表，解析后无表格步骤 → propose 0 原子。导出 `hasProposeableChainSteps`；`listReqModules` 增 `canProposeAtoms`；api-docs + characterize；propose 空数组走 fallback；guide `through-chains-proposeable-format.md` 交 Zcode 改写文档。vue：`faf94fc` 禁用+hover+step2 上一步
- 验收：`characterize-kb-req-modules-list.mjs` OK 3；实扫仅 `product-mgmt` canPropose=true
- 遗留：P0 文档改写 customer-corp/rating（见 guide）；勿提交 `.draft-traj-propose.json`
- 注意：未触轨迹查询 WIP；vue 另仓 `faf94fc`
## 2026-09-08 04:30 · Zcode 闲时审查 — 开工+收工：闲时审查触发方式纠偏（定时任务已删，约束固化进 guide）

- 完成（用户纠偏）：上午建的 automation-cb2a608d 是**定时任务**（cron 固定触发），不是用户要的**闲时任务管线**——已 CronDelete 删除。正确形态=guide 即 dispatch 产物：`docs/superpowers/guides/idle-review-prompt.md` 已固化四项——①头部管线说明（只走闲时管线，频次由派发方定）；②花销约束节（严格 3 子智能体/P1 主线程直改优先/禁真机湿测与写库冒烟/单轮完成）；③下轮复查入口台账（quality-final-gate / recorder-phase-reset / req-draft-fk-guard / owned-wait-shape / 先行护栏，每轮先跑确认仍绿）；④回归验证更新（verify-all 基线=ALL GREEN，红先归因形状漂移 vs 回归；离线 characterization 禁触真实 DB + 注入桩要求）
- 验收：CronList 无该 automation；guide 改动为纯文档增补（头部/新增两节/回归节），不影响任何代码与门禁
- 遗留：无。后续要跑闲时审查=向闲时会话派发该 guide 的提示词正文即可
- 注意：本条为文档+调度面小单元，走「开工+收工」合并条目（沿 09-07 15:10 先例）

## 2026-09-08 04:28 · Zcode 闲时审查 — 收工：sso-auth pin 回调完成，verify-all ALL GREEN（回链 04:20 开工）

- 完成：`b99e61b2` characterize-sso-auth 两条断言按 17b4a512 新形状重写——①listByFunction 改钉「薄壳转发契约」（正则钉 `listByFunctionIds([functionId], options)` 转发 + `listByFunctionIds` 解构 `paasUserId = null`）；②stats 透传文本改钉 `countByRecordStatus({ functionIds: ids, …, paasUserId, isExport })`。**改 pin 前已核功能完好**：paasUserId 过滤与 stats 隔离在新函数体内完整在位（纯形状失配，非行为回归）
- 验收：sso-auth 单跑 all ok；verify-all 全量 **ALL GREEN（117 ok / 0 failed）**——自门禁诞生以来首次全绿收官（此前的轨迹查询 WIP 红与 17b4a512 形状红均已清零）
- 遗留移交：无新增。既有在案项不变：menu-nine-rules 期望更新（菜单线）、stop-busy-race 重评估（挂起表 P3）、门闩 v3 实战验证待下次真实录制
- 注意：全程只动了 characterization 断言，未触碰轨迹查询线任何文件；每周一 03:30 的闲时审查定时任务（automation-cb2a608d）下轮起会自动盯住此类形状漂移

## 2026-09-08 04:20 · Zcode 闲时审查 — 开工：收尾轨迹查询线 17b4a512 的 sso-auth pin 回调（用户委托）

- 开工：04:20。用户确认轨迹查询线按需求改动（17b4a512 listByFunction→listByFunctionIds 重构），委托收尾遗留问题
- 范围：仅 `scripts/characterization/characterize-sso-auth.mjs` 两条过期断言（:209 listByFunction 形状 / :221 stats 透传文本）改为新形状；本文件。**不动 trajectory-dao 等业务代码**（已核功能完好：薄壳转发 options 透传、listByFunctionIds 完整处理 paasUserId 过滤+stats，纯 pin 形状失配）
- 禁入：src/dao/trajectory-dao.js 及轨迹查询线全部文件（只读）；其余沿用上轮禁入区
- 方式：改断言 → sso-auth 单跑绿 → verify-all 全量（预期全绿）→ 收工

## 2026-09-08 04:18 · Zcode 闲时审查 — 收工：数据清洗 + 门闩残余批次 + 闲时审查定时化（回链 04:05 开工）

- 完成：用户五项批复执行完毕——①**存量假成功数据清洗**（已批准③）：只读盘点 359 条 recorded/completed+is_successful=1，其中 **24 条业务步=0 的铁板假成功**（KB-I5 探针 + 09-06 晚 KB贯通批量）已置 is_successful=0，record_status 未动；#612（16 业务步）/#614（26 业务步）已被真实重录覆盖不在清洗范围；剩余 335 条均有业务步，无法离线判定者不盲目清洗。DB 动作无 repo commit，脚本与输出在 tmp/idle-review/。②**门闩残余批次**（④核可后实施）3 commits：`8e235709`+`6bd37373` runHealStep 归属修复——手搓等待换 waitForSessionEventOwned（runId 过滤+canceled 丢弃+legacy 放行），heal step 盖 healRunId，success=false 显式拒收（Type A 不再无证据标 healed-by-ai）+ 新护栏 characterize-owned-wait-shape.mjs（真实 hub+3 参 arity 钉，补 2a30fc6c 自身测试的形状缺口）；`816765ab` session_runner runId 变化复位 `_last_phase_state_key_phase`（新 run 首阶段不再漏发开组事件）；`b24580b5` 登录重试时延 env 化 `PREPARE_LOGIN_RETRY_DELAY_MS`（挂起项事件驱动重设计维持缓行）。③**定时化**（⑤考虑花销）：CronCreate automation-cb2a608d「闲时教训驱动代码审查·每周一凌晨3点半」，prompt 含花销约束（严格 3 子智能体/P1 主线程直改/禁真机湿测写库冒烟/冲突可缩范围）
- 环境核验（①重启+②重录确认）：4097 PID 23824 StartTime 03:54:46 > 最新代码提交 03:26:57（新代码已加载，无旧实例）；轨迹查询 WIP 四文件已提交（17b4a512），工作区干净；库中 #614 updated 09-07 22:50=昨晚 22:40 那次真实录制，重启后无新轨迹——**门闩 v3 实战验证（failure/广播语义）待下一次真实录制观察**
- 验收：node --check/eslint ×3、py_compile+AST ×1；characterize-owned-wait-shape 4/4；heal 三套件（locate 39/mode/decision）全绿；verify-all 全量 112 ok / 1 红——红=sso-auth 两断言，**新归因：17b4a512 把 listByFunction 重构为 listByFunctionIds 转发薄壳，pin 断言的源码形状失配，期望过期非回归**（本会话 03:57 曾单跑绿=当时旧形状尚在，17b4a512 落于其后）
- 遗留移交：①**sso-auth pin 回调归轨迹查询线**（禁入区+其改法已定：pin 改为断言转发薄壳存在+listByFunctionIds 内部实现，或按其最终形状重写；见其 03:45 收工条预留约定）；②stop-busy-race 维持挂起且风险面已变——executor 侧 runId 批次已升级 cancel 处理（步边界判定+强停），原「不等 busy 发取消」注释描述的场景需按新语义重新评估后再动；③memory few-shot 若仍见噪声，下一批可考虑给 listFactsByFunctionHistory 加 stepCount>0 门槛（本轮以数据清洗为先，代码不加双保险避免过度设计）
- 注意：wizard 线（03:25-04:10）与本批文件集全程不相交，verify-all.sh 编辑前已重读防撞；新录制/回放类验证一律未做（不占槽）

## 2026-09-08 04:10 · Cursor Subagent — 收工：SDD req-draft-wizard UI Task 9 冒烟 + 关闭 ⑧ SPA（回链 03:25 Lead 开工）

- 完成：Task 9 E2E 冒烟清单执行完毕；todo ⑧ SPA 勾选项标为已交付；SDD 向导线（Task 1–9）文档收口
- JS-gen 代码：`aa4ca8a8`（`hasThroughChains` + characterize OK 3）——本轮仅 docs commit
- vue-project（他仓，子智能体已提交）：`37b5219` api/kb → `ecfef3b` 路由壳 → `21a4ef5` step1 → `ab5eab5` step2 → `ebbca9b` step3 → `d63cfd7` step4 → `6346e1c` 列表入口「需求生成草稿」
- 验收证据：控制面 4097 UP；`GET /api/v2/kb/req-modules` 30 行均含 `hasThroughChains`；`POST product-mgmt/draft-traj/propose` 9 atoms/0 rejected（概述挂载 0）；`characterize-kb-req-modules-list.mjs` OK 3；`req-draft-wizard` 静态 grep 无 prepare/record；报告 `tmp/req-draft-traj/through-report-wizard-ui.md` + `.superpowers/sdd/.../task-9-report.md`（均 gitignored）
- 遗留移交：可选 polish = 前端 dev 四步 UI 湿测 + DevTools 无录制 API；commit API 本轮未再 POST（687–689 湿测仍有效）
- 注意：未触轨迹查询 WIP 四文件；tmp/ 不入库

## 2026-09-08 04:05 · Zcode 闲时审查 — 开工：存量假成功数据清洗 + 门闩残余批次 + 闲时审查定时化

- 开工：04:05。用户五项批复的执行单：③存量假成功清洗（已批准）+④门闩残余（「先看可否进行」——已核：Cursor wizard 线范围 kb-req-modules/api-docs/前端仓与本批不相交，轨迹查询 WIP 已提交，session_runner 解冻，执行机空闲）+⑤闲时审查定时化（考虑花销，低频）
- 范围：DB 数据修复（trajectory.is_successful 置 0，24 条 biz=0 存量假成功，不动 record_status）；`src/services/trajectory/replay-heal-shared.js`（runHealStep 补 canceled 过滤+success 检查+runId）；`scripts/session_runner.py`（`_last_phase_state_key_phase` 随 runId 切换复位）；`src/services/trajectory/attach-runner.js`（登录重试时延 env 化）；`scripts/characterization/characterize-owned-wait-shape.mjs`（新，生产形状 smoke）；`scripts/refactor/verify-all.sh`（注册 smoke，提交前重读防撞 wizard 线）；本文件。record-lifecycle stop-busy-race 先读后定（语义敏感可移交）
- 禁入：Cursor wizard 线文件集（`src/services/kb-req-modules.js`、api-docs、前端仓、其 characterization 新文件）；`data/kb/**`；record/prepare/start（不占槽不发起录制）；不重启服务；trajectory-dao/trajectory.js/trajectory-service/trajectory-query-service
- 方式：数据修复带前后对照清单；代码改动逐条过 node --check/eslint/py_compile + 新 smoke；verify-all 全量收尾；CronCreate 定时任务（仓库外动作，收工条注明）

## 2026-09-08 03:25 · Cursor Lead — 开工：SDD 执行 req-draft-wizard UI 计划（用户选 Subagent-Driven）

- 开工：03:25。计划 `docs/superpowers/plans/2026-09-08-req-draft-wizard-ui.md`（9 Task）；规格已确认
- 范围：Task1=`src/services/kb-req-modules.js` + api-docs + characterization；Task2+=`D:/dev/ui-auto-recording-agent-vue-master/vue-project`（api/kb.ts、router、req-draft-wizard、录制列表入口）；本文件 / todo ⑧；SDD ledger `.superpowers/sdd/2026-09-08-req-draft-wizard-ui/`
- 禁入：轨迹查询 WIP 四文件；系统树配置页；prepare/record；不改 draft-traj 核心（除 list 字段）
- 方式：主会话代声明；子智能体实现+commit（各仓分开）；Task 间审查；连续执行不中途问人

## 2026-09-08 04:00 · Zcode 闲时 — 收工：MySQL 白名单同步脚本入库（回链 03:55 开工）

- 完成：`26211d5b` 跟踪 `config/update-db-whitelist.cmd`（10 分钟循环包装）+ `update-db-whitelist.ps1`（服务端 dmesg LOG 规则观测真实出口 IP→白名单更新）；`.gitignore` 增 `config/.db-whitelist-lastip` 一行——更正开工条：`.db-whitelist-sync.log` 已被既有 `*.log` 规则覆盖，无需新增
- 验收证据：提交后 `git status` 中 whitelist 相关条目清零（仅剩他线轨迹 WIP 四文件 + draft-traj 缓存 json）；暂存区核对仅含上述三文件
- 注意：LF→CRLF warning 为 autocrlf 常规提示；ps1 带 BOM 属 PowerShell 正常；脚本无密钥（SSH key 认证）
- 遗留：无（03:45 遗留①就此关闭）

## 2026-09-08 03:55 · Zcode 闲时 — 开工：入库 MySQL 白名单同步脚本（用户拍板）

- 开工：03:55。用户指令「config/update-db-whitelist.cmd/.ps1 提交」；回链 03:45 收工条遗留①
- 范围：新增跟踪 `config/update-db-whitelist.cmd`、`config/update-db-whitelist.ps1`；`.gitignore` 增两行（`config/.db-whitelist-lastip`、`config/.db-whitelist-sync.log`，ps1 的运行时状态/日志不入库）；本文件
- 禁入：轨迹查询未提交 WIP；capture 在途线文件；`data/kb/**`；R1-R6 在途交易；不重启控制面/执行机
- 方式：已读两脚本全文确认无密钥（SSH key 认证，服务器 IP 本已在 README 等公开文档）；提交前核暂存区仅含上述文件

## 2026-09-08 03:45 · Zcode 闲时 — 收工：文档清理批次二（回链 03:20 开工）

- 完成：四 commit——`9b324c94` 归档第二波（specs×24 + plans×18 + todos 目录 3 篇，git mv 保留历史；活目录仅留 capture 族/req-to-draft-traj 线/orchestration/engine-actions-contract/phase-done(湿测§5 未闭)/kb-i5/backfill-assessment 等 31 篇在途未闭集合）+ archive/README 重建批次索引；`22610514` 入库 untracked 的 unify-save-action 计划与 replay-pipeline-handover 调研；`daba1e87` docs/README 标注 830 已收官/报文捞取已搁置；另两份散文档（gitignore 本地件）已加状态横幅不入库
- 验收证据：移动后 ls 核对（archive/specs=86、archive/plans=85、todos=3）；活文档断链扫描（todo-list/guides/AGENTS/docs-README 对 10 个归档名零引用；agent-log 命中均为历史条目记录，不改写）；`rm` 后 ls 确认 `rate-save-after.yml`、`step2.yml`、`docs/reasonix/` 均不存在；每 commit 暂存区均不含他线文件
- 遗留移交：①`config/update-db-whitelist.cmd/.ps1` + `.db-whitelist-lastip` 归属未拍板（NAT 白名单运维脚本），留 untracked 待定入库或注明；②散文档横幅为本地件（docs/* 仅白名单入库），换机即失，若需持久须扩白名单；③docs/ 天阳需求文档等原始材料目录仍未入 docs/README 索引（未核实内容，不猜述）；④archive 内约 129 篇旧存档的文内相对链接未逐一修复（README 已有「以本目录实际路径为准」通则）

## 2026-09-08 03:08 · Zcode 闲时审查 — 收工：characterization 目录瘦身（回链 02:58 开工）

- 完成：孤儿对账落地四步，4 commits——①`a1d9416f` 删 4 个死/过期孤儿（agent-stderr-log 钉已删除的 executor/stderr-prefix.js[18d9b585 删]、batch-task-name 钉已不存在 batch-job-name.js、l2-todo-region/partition-compose 期望过期于语义变更）；②`f95e7a06` 收编 6 个高价值孤儿入 verify-all（save-section 负向 pin 守恢复禁令 / phase-reviewer+flow [reviewer.py 合约热区，过往「PASS」实为手动跑] / real-click / tree-check-confirm / session-lifecycle）；③`97fcad54` 其余 67 个绿孤儿 `git mv` 至 `scripts/characterization/cold/` + 路径深度 codemod（parents[2]→[3]、'../..'→'../../..'、import 前缀、单 '..' join×4 手补）+ cold/README.md（分层/运行约定/收编政策）；④menu-nine-rules **只读归因未改**：09-04 18/18 后菜单扫描/导入被 intermediate_flag 语义线改动 6 commit（ed0a8c7b→85b7533c，叶子一律 intermediate/扫描跳过），FAIL 5/18 判**期望过期非回归**（该检查写库，未复跑确认），移交菜单线更新期望
- 验收：67 个移动脚本自仓库根全量重跑 **67/67 PASS=移动前基线**（中途一次假红系 shell cwd 停在 scripts/ 的相对路径事故，非脚本问题）；verify-all 全量 **111 ok / 1 红**——唯一红=characterize-sso-auth（轨迹查询线 WIP 已知存量红，独立复现），零劣化；门禁条目 96→102，注册项抽样零死 pin（region-tree 的 assembleRegionTree 等均为现行函数）；全套墙钟 106s，性能不构成瘦身动因
- 遗留移交：①menu-import-nine-rules.mjs 期望需按 intermediate 新语义更新（归属：菜单线，写库检查勿入 verify-all）；②l2-todo-region/partition-compose 若语义仍有消费方可按新期望重写后再收编（当前判过期删除）；③cold/ 目录脚本路径已改深度，**回门禁时须移回上级并还原相对深度**（README 已写）；④「新 characterization 必须注册」政策已写进 cold/README，未做成硬约束（可下轮加 pin：目录清单 vs verify-all diff 检查）
- 注意：本轮全程未触轨迹查询 WIP 四文件与 req-draft-traj services（Cursor 线 02:55 刚收工）；characterization/** 免 lint（pre-commit 的 ignore 提示为既有噪音）

## 2026-09-08 03:20 · Zcode 闲时 — 开工：文档清理批次二（归档积压 + 未入库文档 + 状态横幅 + 杂物移除）

- 开工：03:20。用户三项拍板（归档批次按工作线 / 根目录 yml 移除 / reasonix 删除）；承接 00:55 审计线收工条目的清理建议
- 范围：①`docs/superpowers/specs|plans` 42 篇已闭环工作线文件 `git mv` 至 `archive/specs|plans`（830 冲刺/xpath 统一/菜单切换推送链/Z1-Z8/KB 战役/auth-recording/ghost-pending-prune）+ `todos/` 3 篇 Done 移 `archive/todos/`；②重建 `archive/README.md` 批次索引；③入库 untracked 的 `plans/2026-09-05-unify-save-action.md`、`research/2026-09-01-replay-pipeline-handover.md`；④`docs/报文日志捞取接口设计.md` 加搁置横幅、`docs/830格式对齐改造spec.md` 加收官横幅、`docs/README.md` 对应标注；⑤移除 untracked 杂物：根目录 `rate-save-after.yml`、`step2.yml`（Playwright aria 快照残留）、`docs/reasonix/`（gitignored，被 superpowers/plans 取代）
- 禁入：capture 在途线文件（api-capture.mjs / network_capture.py / session_runner.py / memory\* / system-ref-\* / 其 plans×3 + sut-three-interfaces 等 capture 族 specs 留活区）；轨迹查询未提交 WIP；`data/kb/**`；`docs/report/**`；`config/update-db-whitelist.*`（归属未拍板，不动）；R1-R6 在途交易
- 方式：git mv 保留历史；归档批次单独 commit，入库 commit、横幅 commit 分开；untracked 删除无 git 记录，以收工条 + ls 为证；每批 commit 前核暂存区不含他线文件

## 2026-09-08 03:10 · Cursor Reviewer — 收工：接 Zcode 质量复测回执并裁定（无代码改动）

- 完成：复核报告 `tmp/req-draft-traj/through-report-quality-rerun.md` + GET **687/688/689**（draft / `03-配置产品信息` / task 无占位）与 **681/682**（task 仍含占位，属旧标准）；确认 `fa2e5be9` 收工与 todo ⑧ PASS 口径一致
- Lead 裁定：① **同意并已执行清理 681/682**（DELETE 200，GET 404；687 仍在）；② **余 6 atoms 不批量 commit**，等 SPA/业务勾选
- 范围：仅 `docs/superpowers/todo-list.md` + 本文件；DB 仅删旧标准 draft 681/682
- 遗留：⑧ 非阻塞项=SPA 勾选；全库重跑仍不开放，待 SPA 或业务点名模块

## 2026-09-08 03:05 · Zcode — 收工：draft-traj 质量复测 PASS（回链 10:35 开工；本条及该条钟点为手写误差，机器真实时刻 02:xx-03:05，以 git 时间为准）

- 完成：**DoD 6/6 PASS**——characterize OK 25；重启 4097 加载 `b0c7118c`（旧进程 02:31 早于修复提交，实测确证移交单第 1 条必要；重启后 LMY 自动重连 online）；propose chain-a **9 atoms/0 rejected**；**概述章挂载 0**（排序/启用/公共要素等上轮错挂全修）、**占位符残留 0**（task「来源：」行为真实路径）、**fnId 9/9=null**（FK guard 生效无幻觉码）、个性化要素由 rejected 转 atoms=改善
- commit：force:true 勾 5/7/8 三条 → **traj 687/688/689** 全 draft，GET 验 provenance 四字段+无占位+非概述章全过；681/682 保留对照
- 验收证据：`tmp/req-draft-traj/through-report-quality-rerun.md` + quality-rerun-propose/commit.json
- 遗留移交：无阻塞；681/682 旧标准草稿清理与否待 Lead 定；余 6 atoms 待 SPA 勾选入口
- 注意：本轮 agent-log 早前数条手写钟点偏移（把机器凌晨写成上午），后续条目一律先 `date` 取真实时刻

## 2026-09-08 10:35 · Zcode — 开工：draft-traj 质量修复复测（执行 Cursor 09-08 移交单）

- 开工：10:35。执行 `plans/2026-09-08-req-draft-traj-quality-rerun-handoff.md`（`b0c7118c` 修复后 LLM propose 路径复测）
- 范围：重启控制面 4097（实测进程 02:31 启动早于修复提交，旧代码——移交单第 1 条授权）；`tmp/req-draft-traj/`（quality-rerun-* 证据+报告）；本文件、todo ⑧；不改任何代码
- 禁入：不 prepare/record/start/detach；不清/重录 R1-R6 与 #614（681/682 保留对照）；轨迹查询 WIP 四文件；session_runner/主链引擎；characterization 目录（闲时审查瘦身线在途，勿触碰）；不为过 DoD 手改 propose cache
- 方式：characterize OK 25 已过 → 重启 4097（先 server 后查 executor 重连）→ propose{maxAtoms:12,chainIds:[chain-a]} → 逐 atom 质量清单（禁概述章/无占位符/fnId 非幻觉）→ 勾 2~3 条（排序/公共要素优先）force:true commit → GET 核对 → 报告 `through-report-quality-rerun.md`

## 2026-09-08 02:58 · Zcode 闲时审查 — 开工：characterization 目录瘦身（删死孤儿 / 收编高价值 / cold 归档）

- 开工：02:58。承接上轮审查的孤儿对账结论（78 未注册孤儿：73 绿 5 红），经用户批准执行四步
- 范围：`scripts/characterization/**`（删 4 个死/过期孤儿：agent-stderr-log、batch-task-name、l2-todo-region、partition-compose；收编 6 个高价值入 verify-all：save-section、phase-reviewer、phase-reviewer-flow、session-lifecycle、real-click、tree-check-confirm；其余 67 个 `git mv` 至 `scripts/characterization/cold/` + 相对深度 codemod + README）；`scripts/refactor/verify-all.sh`（+6 注册）；本文件
- 禁入：轨迹查询未提交 WIP 四文件；`src/services/req-draft-traj/**`（Cursor 线刚收工 02:55，只消费不修改）；`characterize-menu-import-nine-rules.mjs` 只读归因不修改（其归属线=菜单线）；`data/kb/**`；前端仓库；不重启控制面/执行机
- 方式：删/移/注册后全量重跑被移动脚本对照基线（73 绿零劣化）+ verify-all 全量（预期仅 sso-auth 存量红）；codemod 只动路径深度（parents[2]→[3]、'../..'→'../../..'、import 前缀），重跑不绿即人工修或回退该文件

## 2026-09-08 02:55 · Cursor Reviewer — 收工：req-draft-traj 质量修复 + Zcode 复测移交（回链 02:50）

- 完成：`extractZjjkCodes` + 多命中评分（概述降权 / 复用降权 / hint·action 加权）；占位 ZJJK（`—`/`主页`）忽略改走 hint；`fillTaskDraftProvenancePlaceholders` 在 materialize 替换；characterize **OK 25**；离线 product-mgmt chain-a 步 5/7/8/9 均 → `03-配置产品信息`；移交 [`plans/2026-09-08-req-draft-traj-quality-rerun-handoff.md`](plans/2026-09-08-req-draft-traj-quality-rerun-handoff.md)；todo ⑧ 已更新
- 验收：`node scripts/characterization/characterize-req-draft-traj.mjs` → OK 25；未触轨迹查询 WIP / 未 record
- 遗留移交：Zcode 按复测移交单重跑 propose/commit（**须重启控制面**）；旧 681/682 task 仍含占位符属历史数据，不回溯改库；businessEntries 的 `- ` key 前缀属 analyze 解析，本轮未动

## 2026-09-08 02:50 · Cursor Reviewer — 开工：req-draft-traj 原子草稿质量修复（回链湿测质量审）

- 开工：02:50。用户要求 reviewer 修一轮后出报告，交 Zcode 复跑 product-mgmt propose/commit
- 范围：`src/services/req-draft-traj/provenance.js`、`propose.js`（必要时 `index.js`）、`scripts/characterization/characterize-req-draft-traj.mjs`（+fixture 若需）、`docs/superpowers/plans/` 复测移交单、本文件 / todo ⑧ 一句；只读对照 `data/kb/req/product-mgmt/`
- 禁入：轨迹查询 WIP 四文件；`session_runner` / 主链引擎；R1–R6 轨迹；不 prepare/record；不重切全库 docx
- 方式：修多 ZJJK/占位解析 + taskDraft `<sourceDoc>`/`<sourceChapter>` 替换 + 概述章降权；characterize 加断言；离线对 product-mgmt 写步骤 resolve 自检；写 Zcode 复测 handoff；本条立即 commit

## 2026-09-08 10:15 · Zcode 夜班续 — 更正：报文捞取 MVP 实为**搁置**非收官（回链 09:55，用户亲口纠正）

- 完成：todo ② 与 memory 已按用户口径改写——**MVP 搁置，原因=被测系统开发无法提供三接口**（页面元素定义/接口结构定义/日志文件获取）；用户 09-08 所说「已验证」=**调研可行性验证成立**（ELK 实测 2186 条 0 失败、saveCustCorporat 122/122 prop 映射、回填潜力 92%——拿到接口信息即可捞到对应数据），非 live 管线验证
- 注意：**已落地代码全保留为资产**——elk-msg-extract CLI + Tasks 7-9 被动捕获框架（network_capture.py 走录制时被动监听，**不依赖 SUT 三接口**）；若接口到位或重启此线，框架零改造可用；check-capture.mjs 备查
- 影响：后续会话勿再把 ② 当活跃线或当「已上线验证」线引用；触发条件=SUT 排期提供接口

## 2026-09-08 09:55 · Zcode 夜班续 — 收工：Task 9 live 冒烟按用户确认关闭（回链 09:40）

- 完成：用户指示「报文捞取 MVP 已经验证过了」——**live 验证以用户 09-08 确认为准**，本会话不再重复跑录制冒烟；todo ② 已更新为收官态
- 注意（证据面如实记录）：本机只读探针 09:50 时点=system_ref_data 无 system_capture 行、今日无新轨迹、`tmp/server-main.log` 无 network_captured 行（该日志 mtime 停在 02:31，用户重启若走其他启动方式则日志在别处）——验证证据可能在服务器侧/用户侧，行级核验工具保留：`node tmp/capture-live-smoke/check-capture.mjs`（只读，随时可复查）
- 顺带核实：湿测遗留① suggestedFunctionId 越界已由闲时审查线修复（`3b03e231` propose 侧 systemDao 校验+commit 侧干净 skip，引用本线湿测报告）；todo ⑧ 同步更新——两份移交单（`req-draft-traj-wet-handoff` / `req-to-draft-traj-wet-test-handoff`）范围内事项**全部闭环**，仅剩 SPA 勾选入口（前端仓库，非本仓）
- 遗留移交：② 剩非消费型过滤/四边界场景兜底（设计决策待输入，非阻塞）

## 2026-09-08 09:40 · Zcode 夜班续 — 开工：Task 9 报文捕获 live 冒烟（用户已重启控制面）

- 开工：09:40。执行 `tmp/capture-live-smoke/README.md` 交棒包——验 `network_captured → system_ref_data` 全链落表
- 范围：`tmp/product-mgmt/`（本次冒烟 analyze/create/start 证据）、`tmp/capture-live-smoke/`、本文件、todo ②；**不改任何引擎/业务代码**
- 禁入：不 clear/不重录 #614 及 R1-R6 主链轨迹；不抢他线槽（先 GET executors 核空闲）；轨迹查询 WIP 四文件；data/kb/**；detach 只对本次新建 traj
- 方式：functionId=9000000740 account=2；最小任务（进产品库→新增一级分类 stamp `20260908-capture-smoke`→保存）保证至少一条 save POST；start 用后台轮询防网关挂起；PASS 判据=check-capture.mjs 见 system_capture 行且 entries 非空

## 2026-09-08 01:00 · Zcode 闲时审查 — 收工：教训驱动两阶段审查+修复落地（回链 23:31 开工）

- 完成：**阶段一**3 子智能体并行只读审查（Node A 假成功+D 时序 / Python B 接线+A-py 门闩 / 横切 C 静默+E 进程+F 对账），主线程对全部 P0/P1 逐一 Read 核实（防假完成/误报）；报告 `tmp/idle-review/2026-09-07-report.md`（P0×1 确认 + P1×7 + P2×12 疑似/移交 + F 对账 10 项）。**阶段二 8 commits**：
  - `7d505102` runner 终局门闩 v3——phase_end.quality_failed 捕获（原零消费）+ phaseOutcomes success=false 终局消费 + perRunZero 真源复核（堵重录累积口径掩护）+ 90s 门闩 runId 归属守卫（旧 timer 不再覆写新 run 基线）；#612/#614/19:55「QUALITY FAIL 后不应标成功」收官
  - `3d4189e9` batch 收敛——recordStatus=failed → markItemFailed（RECORD_QUALITY_GATE），job 不再假绿
  - `3b03e231` propose/commit FK 双防御（draft-traj 遗留①）——越界 id propose 置 null / commit skip `unknown_function_id`；`functionIdExists` 注入修复离线 characterization 触真实 DB 挂起（fixture id → knex 池不退，EXIT=124 复现实证）
  - `7144a9c2` recorder 六拒绝分支 `return True`（6aeedcb0 搬迁回归：recorder.py:214 真值检查曾是死代码，被拒 done 继续后半段致 goal-loop 误强停）
  - `769e6964` 阶段边界清 `_last_save_ok`/`_success_tokens`/`_url_before_save`（跨阶段 save_ok 串台假成功）
  - `33d892ea` state.py 三发射器盖 runId——2a30fc6c 留下的「死过滤器」激活（spec 4.1.4 两侧闭环；None 省略保 legacy 兼容）
  - `930f026f` attach 失败清理去静默（remote-session/attach-service，ghost mount 风险可见化）
  - `e444037a` verify-all 注册三新门闩
- 验收：verify-all **104 ok / 1 红**——唯一红 `characterize-sso-auth` 两断言=轨迹查询线未提交 WIP 重构 `listByFunction`→`listByFunctionIds` 破 pin（夜班 02:10 收工独立同判，随其提交自愈）；node --check ×6、eslint 0 新 warning、py_compile ×3；子智能体（FK 修复 / Python 三修）产物 diff 主线程逐行复核，均零删除行、未 commit
- 护栏落点（下轮闲时复查入口）：`characterize-quality-final-gate.mjs`（含「降级判定先于 success 写」顺序 pin + batch 收敛 pin）/ `characterize-recorder-phase-reset.py`（39 checks：6×return True + 三键清理 + runId 携带/省略）/ `characterize-req-draft-fk-guard.mjs`（11 pin）+ characterize-req-draft-traj +2 行为断言（null-on-unknown / skip 且 analyze 不被调）
- 遗留移交（P2，详见报告「疑似/需人工判断」表）：①form_save 静默分支伪 toast_ok 令牌（需裁决兼容面：独立 kind + 契约 kinds 采认）②phase_*_obs 用 step_index 当 phase 号（service.py 改用 _CURRENT_PHASE）③`_last_phase_state_key_phase` 跨 run 不复位（session_runner 当时禁入未修）④`_CURRENT_POPUP_KEY` 弹窗关闭不清 ⑤runHealStep 缺 canceled 过滤+success 检查（与 runId 遗留同刀修）⑥owned-wait 接线缺生产形状 smoke ⑦广播族静默 catch / 批量取消 detach 无日志 ⑧`String(failResult)` 疑似对象 ⑨restart-local.cmd 只清 19242 ⑩phaseCompleted 虚高（与 P0-1 同根的显示面）⑪manual ack 8s 乐观置位阻断 reaper ⑫lease 对账静默；另 network_capture 三点形状备注（asyncio.run 兜底/新 tab 不附着/mem persist 归属）移交报文捞取线，AGENTS.md `start.ps1` 失效移交文档线
- 注意：**生效需重启**——控制面 4097 加载 runner/batch/Node 侧改动；executor Python（state.py/recorder_emitters/intent_contract）随下次会话加载；新旧双向兼容（payload 无 runId→legacy 放行，不阻塞）。本轮未动 todo-list（避让并行文档线，移交已全量落本条）；工作区仅剩轨迹查询线四 WIP 文件（未触碰）；memory few-shot 污染面（is_successful=1 选历史）随 P0-1 落地收敛

## 2026-09-08 02:10 · Zcode 夜班 — 收工：报文捞取 Tasks 7-9 落地（回链 00:25 开工）

- 完成：Task 7 `api-capture.mjs`（`2e359ef6`+JSDoc `a5620ee0`，子智能体验证+本地 smoke 2 captures，修 URL 遮蔽真 bug）；Task 8 `network_capture.py`（`314be568`，11/11 断言+便携 python 真实 import）；Task 9 接线持久化（`f2cbc9f3`，session_runner attach/finally-cleanup 全 try/except + protocol 事件类型 + memory-service 摄取分支 + system-ref findByUrlPattern/persistCapturedInterface + characterize-network-capture）；verify-all 注册 `7bb59b8c`。Task 10 CHANGELOG 段按 09-04 约定废止未执行
- 验收：eslint 0/0；characterize-network-capture OK 6 已入 verify-all；全量 verify-all 仅 `characterize-sso-auth` 2 断言红——根因=轨迹查询线**未提交 WIP** 把 `listByFunction` 重构为 `listByFunctionIds` 破坏源码 pin（trajectory-dao.js diff 实证），非本单回归；子智能体编队 A（Task7 验证）/B（Task8 实现）/C（Task9 实现，白名单 6 文件 120+ 行 0 删除），主会话验收代提交
- 注意（事故记录）：本轮一次 `git commit --amend` 与文档审计线并发提交相撞，把 api-capture JSDoc 修复混进其开工条提交 `aa33aa29`（该 commit 故保留不重写，内容在树正确；新线=闲时审查 `0807a847` 起正常）。教训：活跃多会话期禁用 amend
- 遗留移交：①**live 管线未验**——Task 9 只到形状级，Node 侧（memory-service/protocol）须重启控制面加载，Python 侧随下次录制会话加载；建议白天做一次真实录制冒烟验证 `network_captured → system_ref_data` 落表（顺路=挂起表「录制链路报文抓取接入」实证）②非消费型过滤/四边界场景兜底未做（设计决策需输入）③sso-auth 存量红随轨迹查询 WIP 提交后自愈，若其改法不定需回调 pin

## 2026-09-08 01:20 · Zcode 闲时 — 收工：文档一致性审计（回链 00:55 开工）

- 完成：5 文件最小修订，全部为代码/配置/提交记录可直接证实的不一致——①`README.md`：环境要求 MySQL 8.0+→5.7+（迁移 99606717/7b56f4d8 已移除 5.7 不支持的 utf8mb4_0900_ai_ci）+ 根路径行为改为「直接返回 api-docs.html」（server.mjs:40 现为 sendFile，非跳转）；②`docs/README.md`：索引重建——CHANGELOG 引用改 git commit 历史（23eed6d0 已删档），清除 8 处死链（backlog-visible-editable-controls/superpowers-README/T4-P0 spec+plan/5 个战略文档均已不在盘上），活文档表改指现存 todo-list/agent-log/guides/jsdoc-convention；③`docs/superpowers/todo-list.md` 头部：CHANGELOG 引用修正 + 删除 backlog 死链行；④`docs/superpowers/archive/README.md`：活待办死链改指 `../todo-list.md`；⑤`docs/jsdoc-convention.md`：5 处示例引用漂移修正——checkScriptErrors/executeScript 已随组装引擎移除不存在（全仓 grep 证实），模板 A/B/C 示例换为现存真实代码（broadcasts.js:12 / llm-utils.js:15-20 / executor-session-client.js:312-320），模板 D 与路由示例行号更新（trajectory-dao.js:91-103 / trajectory.js:15，附 asyncHandler 实形）
- 验收证据：核对未改动的声明均通过——package.json scripts/依赖、characterization 四命令+verify-all、requirements.txt、config/.env.example 与 config/config.js+database.js 逐键一致（BATCH_*/LLM_TIMEOUT_MS=120000/DB_POOL_MAX=10/EXECUTOR_DISCONNECT_TIMEOUT_MS 在 executor/config.js:207）、executor/.env.example 与 executor 实现一致（CDP 19242/node-uuid/心跳 ack）、record_status 五值与 remote_session 四值与迁移一致、v2 路由与 410/301 行为与 README 表一致；行号引用逐一 sed 复核
- 遗留移交：①`reasonix/`、`830需求文档+原型：菜单分级/` 等目录未入索引（内容未核实，不猜述）；②docs/ 其余历史文档（设计/归档）未逐链接核对，仅覆盖用户面文档；③并行闲时审查线 23:31 开工声明将本线文件集列为禁入，两线无交集，本收工不携带其条目

## 2026-09-07 23:31 · Zcode 闲时审查 — 开工：教训驱动定向代码审查（两阶段：报告 → 实施优化）

- 开工：23:31（本机真实时刻，git 时间为证；上方条目标签时刻为该线时钟读数）。执行 `guides/idle-review-prompt.md`（六族检查单 + 3 子智能体并行审查 + 阶段二修复带防再犯护栏）
- 范围：阶段一=全仓只读审查（3 子智能体：Node A 假成功+D 时序 / Python B 接线+A-py 门闩 / 横切 C 静默兜底+E 进程+F 遗留对账），报告落 `tmp/idle-review/2026-09-07-report.md`；阶段二预计修复面=`src/services/trajectory/**`（query-service 除外）、`src/services/req-draft-traj/**`、`src/routes/v2/**`（trajectory.js 除外）、`scripts/agent/**`、`scripts/controller/actions/**`（network_capture.py 除外）、`scripts/state.py`、`server.mjs`、新增 characterization + verify-all 注册
- 禁入：报文捞取 Task9 在途文件集（`scripts/tools/api-capture.mjs`、`scripts/controller/actions/network_capture.py`、`scripts/session_runner.py`、`src/memory/**`、`src/dao/system-ref-dao.js`、`src/services/system-ref-service.js`）；轨迹查询未提交 WIP 四文件（trajectory-dao / v2 trajectory / trajectory-service / trajectory-query-service）；`data/kb/**`；前端仓库；文档一致性审计线文件集（README/docs 用户文档/.env.example）；不重启控制面/执行机；不碰 R1-R6 在途轨迹数据
- 方式：子智能体只读审查（不编辑不 commit，主会话代为声明）→ 主线程抽查核实防假完成/误报 → P0 主线程修+护栏、P1 派发、P2 移交收工条目（不动 todo-list 挂起区，避让文档审计线）；每修复独立 commit 引用教训来源

## 2026-09-08 00:55 · Zcode 闲时 — 开工：文档一致性审计（README/docs/配置说明/使用示例）

- 开工：00:55。用户指令：基于当前代码与最近提交核查 README、docs、配置说明与使用示例是否过时，只改能从代码/配置/提交记录直接确认的内容，不改结构/术语/文风
- 范围：`README.md`、`docs/README.md`、`docs/jsdoc-convention.md`、`.env.example`、`executor/.env.example`、docs/ 内面向使用者的说明文档；只读核对 `src/routes/v2/*`、`package.json`、`eslint.config.js`、`server.mjs`（不修改业务代码）
- 禁入：轨迹查询未提交 WIP（trajectory-dao / v2 trajectory / trajectory-service / trajectory-query-service）；capture 工具线文件（api-capture.mjs / network_capture.py / session_runner.py / memory\* / system-ref-\*）；`data/kb/**`；`docs/superpowers/` 过程文档（除本文件与 todo 头部纠错）
- 方式：先读文档全文 → 逐条对照代码/路由/配置取证据 → 只落已证实的最小修订 → 每处修订在收工条列出依据 → commit

## 2026-09-08 00:25 · Zcode 夜班 — 开工：报文捞取 Tasks 7-10（capture + persistence，回链 23:05 湿测已收口）

- 开工：00:25。draft-traj 湿测已收口（见 00:05 收工条）；候补任务按 todo ② 执行 `plans/2026-08-25-capture-persistence.md`（Task 7-9；Task 10 CHANGELOG 段废止不执行）
- 范围：新建 `scripts/tools/api-capture.mjs`、`scripts/controller/actions/network_capture.py`；修改 `scripts/session_runner.py`（try/except 包裹的 attach+cleanup）、`src/memory/protocol.js`、`src/memory/memory-service.js`、`src/dao/system-ref-dao.js`、`src/services/system-ref-service.js`、characterization、本文件、todo ②
- 禁入：轨迹查询未提交 WIP（trajectory-dao / v2 trajectory / trajectory-service / trajectory-query-service）；`data/kb/flows/**`；R1-R6 主链交易；不重启控制面/执行机
- 方式：Task 7/8 纯新增先落地+commit；Task 9 接线改动按 09-07 教训须**真实形状 smoke**（module 级真实 import + hub 事件形状对拍）+ attach 全程 try/except 防炸录制；每 task 一 commit

## 2026-09-08 00:05 · Zcode 夜班 — 收工：draft-traj 湿测 PASS（回链 23:05 开工）

- 完成：**首通 PASS，DoD 6/6**——characterize OK 19；migrate 无需执行（四列已在库）；product-mgmt propose 8 atoms+1 rejected（出处全非空、粒度原子）；commit traj **681/682** draft + provenance 四字段 GET 验证过；负例 duplicate_draft / unknown_or_stale_atom / 无-cache 400 三发全过；todo ⑧ 已勾销湿测段
- 验收证据：`tmp/req-draft-traj/through-report-wet.md`（+wet-propose-night / wet-commit-night{,2}.json）
- 遗留移交：①**propose suggestedFunctionId 越界真 bug**（90000107304 非 system.id → commit FK 拒，需 propose 侧校验后置 null，改 src/services/req-draft-traj 需另开工）；②Git Bash 中文 JSON 内联变 GBK → 必须 --data-binary @file（假负例教训已写报告）；③负例 3 body code=500 与 HTTP 400 不一致（低优）；④SPA 勾选入口/⑧′ 组件扫描仍未来
- 注意：全程未调用 record/prepare/start，未占执行机槽，未动 R1-R6 在途交易与轨迹查询 WIP

## 2026-09-07 23:05 · Zcode 夜班 — 开工：draft-traj 湿测移交单（migrate + propose→commit）

- 开工：23:05。执行 `plans/2026-09-07-req-draft-traj-wet-handoff.md`（+复检 `2026-09-07-req-to-draft-traj-wet-test-handoff.md`）；⑧ 线遗留「需本机 migrate + 湿测 propose→勾选→commit」
- 范围：`tmp/req-draft-traj/**`（报告+JSON 证据）、DB 迁移执行（`knex migrate:latest`，不改迁移文件）、本文件、todo ⑧ 勾销
- 禁入：轨迹查询未提交 WIP（trajectory-dao / v2 trajectory / trajectory-service / trajectory-query-service）；`session_runner.py`；`data/kb/flows/**` promote；R1-R6 主链在途交易；不调用 record/prepare/start；不重启控制面/执行机
- 方式：先 characterize OK≥19 门闩 → migrate → propose product-mgmt → 勾 1~2 commit → GET provenance → 负例幂等 → 报告 `tmp/req-draft-traj/through-report-wet.md`；提前完成则候补 ② 报文捞取 Tasks 7-10（届时另开工声明）

## 2026-09-07 22:50 · Cursor Lead — 收工：#614 湿测 PASS（ghost prune 生效，回链 22:40）

- 完成：stamp `20260907-2240` session `e35683db`；p2/p3 序号=1；p4 stderr **`pruned ghost pending: ['法人机构:not-visible']` → `SUCCESS: 操作成功`**；p4/p5 outcome success=True；detach 200；报告 `tmp/product-mgmt/through-report-basicinfo-rerecord-2240.md`
- 验收：tree 含序号 fill + select_option×5 + p4 `ok-clicked-save:保存` + stamp 2240；不认仅 isSuccessful
- 遗留：方案 B 扫描准入；多线 NAT 白名单需跟新 IP（本轮 `113.246.107.11`）；KB source 可另补

## 2026-09-07 22:40 · Cursor Lead — 开工：#614 湿测重录（ghost-pending prune 后）

- 开工：22:40。方案 A 已合入 `00c5f1bf`；本单清空 #614 用新 stamp 重录，验收 stderr `pruned ghost pending` + p4 保存 toast
- 范围：`tmp/product-mgmt/`（task/patch/clear/prepare/start/through-report）、本文件；不改引擎
- 禁入：trajectory-dao 等未提交 WIP；session_runner；方案 B/C
- 方式：fid=9000000740 account=2；stamp `20260907-2240`；控制面已带新代码；执行机 LMY 本地重连

## 2026-09-07 21:50 · Cursor Lead — 收工：click_save 幽灵 pending 活体剪枝（回链 21:35）

- 完成：`JS_CHECK_SINGLE_FIELD` +`visible`；`form_save` prune `not-found`/`not-visible` + stderr `pruned ghost pending`；characterize-ghost-pending-prune + verify-all 注册；plan `docs/superpowers/plans/2026-09-07-ghost-pending-prune.md`
- 验收：`characterize-ghost-pending-prune: OK`；verify-all 见本收工 commit 证据
- 遗留移交：#614 湿测重录另开；方案 B 扫描准入 / isSuccessful 假成功未做

## 2026-09-07 21:35 · Cursor Lead — 开工：click_save 幽灵 pending 活体剪枝（方案 A）

- 开工：21:35。用户确认方案 A；先落 spec，审阅通过后写 plan 再改代码
- 范围：`docs/superpowers/specs/2026-09-07-ghost-pending-prune-design.md`；随后 `scripts/controller/actions/js_snippets/scan_form.py`（`JS_CHECK_SINGLE_FIELD`+visible）、`form_save.py`（ghost prune）、相关 characterization、本文件
- 禁入：session_runner WIP；轨迹查询未提交改动（trajectory-dao / v2 trajectory / trajectory-service / trajectory-query-service）；方案 B/C；isSuccessful 假成功；本单不重录 #614
- 方式：spec → 用户审阅 → writing-plans → TDD pin + 实现 + verify-all；证据锚 #614 stderr `e72482e4`（法人机构）

## 2026-09-07 20:45 · Cursor Lead — 收工：req→draft-traj SDD 六任务落地（回链 20:08）

- 完成：`propose`/`commit` API + provenance 四字段 + propose cache + characterize OK 19；终审 Important 已修（`c044387f`）；提交链 `a029bb03..c044387f`
- 验收：characterization OK 19；终审 r2 Approved；verify-all 已注册 characterize-req-draft-traj；**需本机 `knex migrate:latest` 落 provenance 列**
- 遗留：湿测 propose→勾选→commit 未跑；commit 对未登记 module 仍 400（非 404）；⑧′ 组件扫描/推送仍未来

## 2026-09-07 20:08 · Cursor Lead — 开工：req→draft-traj SDD 实施（6 tasks）

- 开工：20:08。执行 `plans/2026-09-07-req-to-draft-traj.md`；Subagent-Driven；工作区本仓 `uara_V1.2`（非 main）
- 范围：migration provenance、`src/services/req-draft-traj/**`、`src/routes/v2/kb.js`、api-docs kb、characterize-req-draft-traj、verify-all、trajectory-dao/meta-service；本文件
- 禁入：session_runner WIP；save_section 恢复；组件扫描/批量推送改造（⑧′）；勿抢他线 busy 槽
- 方式：每 task 子智能体实现+主会话验收代提交；ledger `.superpowers/sdd/2026-09-07-req-to-draft-traj/`

## 2026-09-07 20:00 · Cursor Lead — 收工：req→draft-traj 实现计划（回链 19:47 spec）

- 完成：writing-plans → `docs/superpowers/plans/2026-09-07-req-to-draft-traj.md`（6 tasks：迁移/解析/propose+cache/commit/路由+docs/读回）；todo ⑧ 挂计划
- 验收：对照 spec 覆盖 propose/commit、出处四字段、人勾选、禁录制、characterization；commit 靠 `.draft-traj-propose.json` 缓存对齐 atomKeys
- 遗留：待用户选 Subagent-Driven 或 Inline 开工实现

## 2026-09-07 19:47 · Cursor Lead — 收工：需求→原子草稿交易设计 spec（回链本条开工）

- 完成：brainstorming 拍板方案 1；规格 `docs/superpowers/specs/2026-09-07-req-to-draft-traj-design.md`；todo ⑧ 本版 + ⑧′ 未来（组件扫描/推送改推组件）
- 验收：四节设计用户确认「可以写 spec」；硬约束=草稿出处（文档+章节）+ 人勾选后才建 draft + 本版不录制
- 遗留：待用户审 spec 后写 implementation plan（writing-plans）；实现未开工

## 2026-09-07 19:47 · Cursor Lead — 开工：需求切片→草稿交易 brainstorming→spec

- 开工：19:47。用户要「需求文档+KB 生成交易」免手工新增；粒度原子化；先草稿不录制
- 范围：`docs/superpowers/specs/2026-09-07-req-to-draft-traj-design.md`、`docs/superpowers/todo-list.md`、本文件；**不改引擎/业务代码**
- 禁入：session_runner WIP；V3/auth 他线；勿恢复 save_section
- 方式：brainstorming 对话定案后写 spec + commit；不写计划直至用户审过 spec

## 2026-09-07 19:55 · Cursor Lead — 收工：#614 重录部分通过（回链 19:26）

- 完成：stamp `20260907-1926` 重录 session `e72482e4`；p2/p3 **序号=1 已落库**（create 合约修复湿测成立）；p4 有 select_option×5 + 日期/描述 stamp，但 **QUALITY FAIL：pending_fields=法人行社 + missing_success_token**，无基本信息保存 toast；轨迹仍标 `recorded/isSuccessful=1`（不可信）
- 验收证据：`tmp/product-mgmt/through-report-basicinfo-rerecord-1926.md`、`steps-614-1926.json`、stderr `e72482e4-*.log`；已 detach
- 遗留移交：①法人行社硬门 vs optional 需产品/引擎裁决后再清 #614 重录；②QUALITY FAIL 后不应标成功；③本轮不写 KB；SUT 留 stamp 1926 节点可清
- 注意：未改引擎/KB；控制面曾因 arity fix 重启（PID 39220）

## 2026-09-07 19:26 · Cursor Lead — 开工：引擎 create 合约硬矫正后重录 #614

- 开工：19:26。用户确认引擎已修好（sanitize create→assistant=true/all_editable；#499 拆单 675/676/678 已湿测序号）；本单对 #614 清空后重录验收
- 范围：`tmp/product-mgmt/`（clear/prepare/start/through-report）、`docs/superpowers/agent-log.md`；必要时 `data/kb/flows/product_library.json` source/rules；不改引擎
- 禁入：session_runner 他线 WIP；auth-recording；V3 导出线；phase_done runId 刚合入段只读；save_section 恢复禁令
- 方式：fid=9000000740 account=2；stamp `20260907-1926`；验收认 p2/p3 含 fill 序号 + p4 select_option + toast/stamp，不认仅 phase_done
## 2026-09-07 18:50 · Cursor Lead — 收工：#499 新粒度三笔串行录制 PASS（回链 18:35）

- 完成：stamp `20260907-1835` 三笔串行均 `recorded`+成功——**675** 一级分类（5 步，名称+序号）/ **676** 子分类（6 步，点「新增分类」非一级）/ **678** 产品（8 步，名称+序号+描述）；砍启用核对方
- 验收：tree 含序号 fill；T2 按钮文案=`新增分类`；证据 `tmp/product-mgmt/split-499/`；KB `product_library.json` source 已追加 I2b
- 遗留：SUT 留 stamp 1835 节点可清；旧 #499 单交易未动；本单未做回放

## 2026-09-07 18:35 · Cursor Lead — 开工：#499 新粒度串行录制（一级分类/子分类/产品 三交易）

- 开工：18:35。PM：#499 粒度过大——前三阶段拆成三笔串行交易，第四阶段（核对启用）不做；引擎 create 合约硬矫正已合入，本单湿测
- 范围：`tmp/product-mgmt/split-499/`（task/analyze/create/through-report）、`docs/superpowers/agent-log.md`；必要时 `data/kb/flows/product_library.json` source 回写；**不改引擎**
- 禁入：`scripts/session_runner.py` 他线 WIP；V3 导出线刚改文件；auth-recording；`save_section.py` 恢复禁令；不抢他线 busy 槽
- 方式：fid=9000000740 account=2；子分类按钮用「新增分类」（禁「新增子分类」）；每笔 analyze→create→prepare→start→detach；验收认 stepCount+序号步+业务 stamp
## 2026-09-08 00:15 · ZCode V3导出线 — 开工声明：V3 弹窗触发链挂载（popup 父改挂触发对象 + trigger 最晚者优先归属）
- 开工：00:15。承接交易 499 三次重录验证：双断裂修复（305d6c7b state.py / 15e5048c element.js）已生效（stamp 带 @@anchor），但导出侧仍有 2 步错位（填表早于弹窗截图注册→无 anchor 步 / _CURRENT_POPUP_KEY 滞后→旧 anchor 步）。实施导出侧规则：popup 归属=同页面同标题弹窗中触发步骤（点击 anchor 元素的 click 步）最晚且 ≤ 当前步骤者；popup propertiesPID 改挂触发图标对象节点（用户期望：弹窗挂在对应图标按钮后面）。
- 范围：`src/services/transaction-export-v3-properties.js`、`src/services/transaction-export-v3.js`（stats 透传，如有）、`scripts/characterization/characterize-export-v3.mjs`（如断言需扩）、`tmp/*.mjs`（一次性验证脚本）、本文件、桌面产物（C:/Users/water/Desktop/transaction-499-*）
- 禁入：`scripts/session_runner.py`（他线 probe WIP）、run-event-ownership 文件集（引擎线 23:10 在途）、`scripts/state.py`/`src/models/element.js`（本线已收口段，本轮不动）、前端仓库
- 方式：主线程直接改（小改动）→ node 重建 499 payload 验证树 → lint + characterize-export-v3 回归 → commit + 收工

## 2026-09-08 00:40 · ZCode V3导出线 — 收工：popup 触发链挂载落地（回链 00:15 开工）
- 完成（90cc6f1a + 补丁 c33b764c→a7c04d47→03e574e6）：transaction-export-v3-properties.js 触发链规则（anchor↔步骤元素匹配、同页同标题弹窗 trigger 最晚且 ≤ stepIdx 优先，精确 key 链回退保存量兼容）+ popup propertiesPID 挂触发对象节点 + stats.popupTriggerLinked 双级透传；transaction-export-v3.js 解构/stats 汇总接线。**类型对齐两连改：控件节点 type object→element→ele**（同事实测伙伴格式；校验器/特征化 6 篇/layer-tree+lightup 工具同步）。**03e574e6：残留弹窗清理**——页面级截图行按 level_key upsert 致旧录制弹窗行留存，同页同标题组内 anchor 无触发步骤者跳过不导出（全组无触发则保留不误删）。
- 验收：traj 499 重建 payload 树全对——popup 产品←图标新增一级分类、popup 产品3←图标新增产品、残留弹窗「产品2」已剔除（截图 4→3）、各弹窗内容对象归位、行内编辑留 page；popupTriggerLinked=2；18 控件全 type=ele；eslint exit 0；characterize 六篇全绿（115/115 rect 三形态）。
- 交付：C:/Users/water/Desktop/transaction-499-push.json（internal_v3+partner_wire，type=ele）、transaction-499-layer-tree.html（分层静态页，可交互树）。
- 遗留移交：①伙伴平台侧「前端不显示产品内部数据」解析问题+token 过期（401）待同事换 token 联调；②tmp/build-499-*.mjs、check-499-mount.mjs 一次性验证脚本留 tmp/。
- **追加（197ea073）：清空步骤级联删除截图**——clearTrajectory 全清删该轨迹全部 screenshot 行（含 page_level），phaseIds 局部清级联删被删步骤/阶段绑定行；removeTrajectoryStep 顺路级联删单步截图。用户裁决：残留弹窗根因在清空步骤不动截图，录制侧修（本条）为主，导出侧清理（03e574e6）留作纵深防御。范围外注意：本次未动 `trajectory-steps.js` 路由层。



## 2026-09-07 23:59 · ZCode Lead — 收工：auth 交易禁跑 Type B 表单自愈 + 重录 job27 修复「只剩登录步」（回链 22:30 收工）
- 完成（5602b3b6）：排查用户报告「登录演练只剩 1 步」——根因是我方验证回放触发 Type B 表单结构自愈：点完登录页跳 #/home 后 verifyFormStructure 报 用户名/密码 字段 missing，自愈将 traj 668 两条 fill 步删除。双防护落地：① registerAuthComponent 注册时从组件快照剔除 save_form_snapshot；② prepareReplayBatch 对 auth_kind 轨迹剔除 save_form_snapshot 元步（Type B 永不触发）。
- 重录：job27 success（系统1，账号 2）——traj 671 登录 3 步（fill账号/fill密码/点击登录，密码已掩码 __AUTH_PASSWORD__）、traj 672 登出 3 步（672.step_count 字段漏刷已修正=3）；组件 57（login，paramSchema username=1/password=3）与 58（logout）confirmed。
- 验收：回放 671 accepted 仅含 3 真实步（快照步被剔除✓）、凭据经 system_account 解析注入真实值、登录达 #/home、全部步保留无一删除；record/stop 后 671 恢复 recorded。
- 注意：4097 控制面已带新代码重启（PID 5336），孤儿 CDP Chrome(19242) 已清；点步 confirmed 状态（fill=1/click=0）为回放侧标记，待用户 UI 确认流程处置。
- 遗留移交：SPA 侧 authKind 徽标+推送确认入口（前次移交不变）；终审 minors m2/m5 不变。

## 2026-09-08 01:10 · ZCode 引擎线 — 收工：phase_done 跨 run 串台修复 6 任务全部落地（回链 23:10 开工）
- **终审整改（2a30fc6c）**：整分支终审判 FIX-FIRST——B1（blocker）：owned 等待 addListener 直传 3 参 onSessionEvent，实参错位 TypeError 会令**所有 AI 录制阶段 1 即失败**（离线测试用的是本步 addListener 故未抓到）；已改为绑定 runtime.sessionId 的 lambda 并加 arity 回归 pin。M1（major）：phase 校验移到 legacy 放行前，堵住旧执行机僵尸 done（无 runId+错阶段）兼容期复活原缺陷 B。观察日志标签带事件类型。复验：characterization PASS（含新 pin）+ verify-all ALL GREEN + 真实 hub 3 参 smoke 通过。**教训：接线层改动必须有真实形状（3 参 hub）的 smoke，文本 pin 抓不住 arity。**
- 完成（SDD 6 任务全 commit，review 全 ✅）：Task1 归属纯函数模块 `src/services/trajectory/run-event-ownership.js`（c3388e86：phaseEventOwnership accept/ignore/**legacy** 三态+waitForSessionEventOwned，spec 4.4 兼容——payload 无 runId 按旧行为放行）；Task2 runner 接线（1a6e34cd：runtime.currentRunId=randomUUID、stepData.runId 下发、phase_done/phase_error 改 owned 等待）；Task3 订阅过滤+finally cancel_step（700d0da7：action_log_sync/step_screenshot/page_level_screenshot 按 runId 过滤落库，finally 补发 cancel_step 杀僵尸，幂等）；Task4 执行机回带（9d208326：state.py _CURRENT_RUN_ID、session_runner 存 runId+phase_done/phase_state_key 回带+canceled 双信号判定+_stdin_reader 新 step 强停旧 agent（new_step_arrived）、service.py phase_error 回带；**携带他线未提交 probe 行并扩展 runId 字段**）；Task5 verify-all 注册（e5867e3a）
- 验收：`characterize-run-event-ownership.mjs` 4/4 PASS、`characterize-phase-done-runid.py` 7 pin PASS；verify-all **ALL GREEN（103 ok，含两个新条目）**；eslint 0 warning；四任务子智能体 review 全 Approved（TDD 红绿证据齐）
- 湿测移交（需真机执行机）：spec §5 验收 1-3——①录制中注入伪造 phase_done（旧 run 阶段号/无 runId）控制面应忽略不弹「AI 录制结束」；②run N 空闲超时/phase_error 结束后立即重录 run N+1，旧 agent 事件不被消费；③stop 后 agent 在 step 边界停且不再吐有效 done。观察：控制面 `phase_done_missing_runid`/`phase_done_ignored_*`/`persist_event_ignored_*` 日志 + 执行机 `[probe] emit phase_done … runId=…`
- 遗留移交：①spec P2：replay-heal-shared.js:124 heal 等待带标记（当前 UI 不允许并发，风险低）；②订阅回调中 phase_state_key/phase_*_obs 未按 runId 过滤（Task3 review residual，观察后再议）；③执行机（含服务器/第二执行机）需更新到本提交后 Python 才回带 runId——控制面对旧执行机 legacy 放行不阻塞
- 争议裁决存档：Task1 brief 源码与测试两处矛盾以测试为准（legacy 仅控制面无 runId 时放行；cancel settle undefined）——已由 Task2/3 消费方确认安全

## 2026-09-07 23:10 · ZCode 引擎线 — 开工声明：phase_done 跨 run 串台修复实施（runId 归属隔离）
- 开工：23:10。承接 reviewer 检出的 `docs/spec-phase-done-cross-run-fix.md`（录制中误弹「AI 录制结束」），实施计划已产出：`docs/superpowers/plans/2026-09-07-phase-done-cross-run-fix.md`（6 任务 TDD：归属纯函数模块 → runner runId 下发+owned 等待 → 订阅过滤+finally cancel_step → Python 回带/canceled/new-step 叫停 → verify-all 注册 → 湿测移交）
- 范围：`src/services/trajectory/run-event-ownership.js`（新）、`trajectory-recording-runner.js`（runId 接线段）、`scripts/state.py`、`scripts/session_runner.py`（main loop/_run_step/_stdin_reader）、`scripts/agent/service.py`（phase_error emit 两处）、`scripts/characterization/characterize-run-event-ownership.mjs` + `characterize-phase-done-runid.py`（新）、`scripts/refactor/verify-all.sh`、本文件
- 禁入：前端仓库、`data/kb/**`、`src/executor-event-hub.js` 既有导出签名（13 处既有消费点不动）、门闩 v2/合约矫正已提交段、他线 WIP（session_runner.py 本计划要改，执行前须确认他线 probe 改动已收口）、auth-recording SDD 文件集
- 方式：TDD（Task 1/4 先失败测试）；verify-all 收尾必须 ALL GREEN；子智能体不 commit，主会话验收代提交

## 2026-09-07 22:30 · ZCode Lead — 收工补充：终审 FIX-FIRST 整改完成，凭据不落库双验证（回链 13:05 开工）

- **完成**：whole-branch 终审（0020bbe..HEAD，22 commits）判 FIX-FIRST（C1=明文密码落库 trajectory.task 可被轨迹搜索 API 读出）。整改提交链 ebadece→b75dbe4→7b56f4d→4e53d56：①canonical task 不再内嵌账密，真实值播种 business_data_entry，agent 走 read_business_data 通道；②组件注册后掩码源轨迹步骤 params（password→__AUTH_PASSWORD__，解析对象精确值匹配）；③Node 侧「业务数据」放行收窄为凭据键共现；④inline 头词表/无 url 系统跳过触发/组件回放 ok>=1 三个 minor。
- **验收**：湿测 job20 全 PASS（4098）——登录组件+登出组件注册 confirmed、traj recorded；**task 无凭据 + 步骤 params password=__AUTH_PASSWORD__ + 组件快照掩码三重不落库实证**；eslint 0 errors、characterize 全过。湿测数据（9000001715 全套）清理清零，库内无凭据残留。
- **坑**：4098 重启时旧进程未死致 EADDRINUSE，job15/16 曾被旧代码实例服务——重启后必须核 grep EADDRINUSE；mysql2 对 JSON 列返回对象，String() 掩码曾空转。
- **注意**：主控制面 4097/主执行机 LMY/第二执行机 proxy 已恢复（用户会话中断后重启过）；4098 湿测实例仍在跑，可停。

## 2026-09-07 17:40 · ZCode Lead — 收工：登录/登出自动化录制全链完成（回链 13:05 开工）

- **完成**：T1-T9 全部落地，提交链 0020bbe→c6aa33c8（迁移/T2 store/T3 prompts/T4 组件注册/T5 service/T6 路由+文档/T7 运行时组件登录/T8 dashboard/湿测修复 r1-r9）。**湿测 job13 全 PASS**：登录组件（1 步 login 单步落库，param_schema 记注入步号）+ 登出组件（3 步：点头像→退出→确定）注册成功，traj recorded 待人工确认；**job14 运行时验证**：组件已注册的系统再触发，登录段走组件路径（server log `auth component hit`），同名幂等复用无重复行。
- **验收证据**：verify-all ALL GREEN（101 ok）；eslint 0 errors、本分支 0 新 warning；SDD ledger `.superpowers/sdd/2026-09-07-auth-recording/progress.md` 含 9 轮湿测根因链与 job13/14 实证。
- **湿测修复要点（最后一轮）**：①executor 侧 `classify.py` login 阶段按凭据键（含中文别名）放行业务数据（0c649bd0）②Node 侧 `trajectory-text-extract.js` 头词表补「业务数据」+ 显式业务数据引用优先于 login/query 闸（c6aa33c8）——双闸齐修后 agent 才能经 read_business_data 拿到注入账密。
- **移交（产品 SPA 侧，非本仓）**：①系统详情 authKind 徽标、推送列表人工确认入口需在 SPA 落地；②交易状态 recorded=待确认，用户确认（→completed）后方可手动勾选推送，推送闸门既有语义不变。
- **湿测数据**：已清理（系统 9000001712/挂载节点/junk 轨迹/组件/jobs 清零；主体疑似用户产品侧手动级联删除，我方复核收尾）。
- **注意**：4098 湿测实例与独立 executor 仍在跑（tmp/auth-wet-*.log），确认无用后可停；4097 共享实例未动。

## 2026-09-07 15:10 · ZCode 引擎线 — 开工+收工：create 弹窗合约矛盾矫正（#614 二次移交，回链本条=开工）

- **开工**：15:10。范围=`scripts/controller/actions/phase/reviewer.py`（sanitize 矫正）+ `scripts/characterization/characterize-phase-reviewer.py`（断言）+ 本文件；禁入=session_runner.py（他线 WIP）/data/kb/**/产品线文件/auth-recording SDD 九文件集。
- **根因（Phase 1 实证）**：#614 阶段 2 stderr `e468a25a` 合约 `mode=create allow_assistant=False refill=touched`——reviewer 把「只点名字段」判成部分点名语义；`sanitize_contract_for_mode` 对 create/modify 提前 return 不矫正；落地链 `refill=touched`→boundary `requires_write_all_editable=False`→pending-write 门闩失效，且 `allow_form_assistant=False` 直接封 run_form_assistant（form_scan_actions.py:208）——agent 只填名称即点确定，序号漏填。
- **修复（reviewer.py sanitize_contract_for_mode）**：create 一律强制 `allow_form_assistant=True + refill=all_editable`（与 phase-reviewer-prompt 规则 2/3 对齐）；modify 仅在矛盾组合（touched+assistant=false）时矫正；submit/success 令牌原样保留。TDD：先加失败断言再修；旧断言「create+"false"字符串透传」与硬规则冲突，改用 modify+all_editable 显式组合承载 coerce_bool 测试意图。
- **验收**：characterize-phase-reviewer PASS、save-cue-promote PASS、**verify-all ALL GREEN**。
- **「清空步骤(5)」排查结论（另报项，非缺陷）**：与 `POST /clear` 无耦合——路径=编辑弹窗 AI 重分析把阶段置为全新列表（`RecordingDialog.vue:163` 注释明示「无 phaseId → 保存时删除旧阶段及步骤」）→ `PUT /phases` → `syncTrajectoryPhaseDescriptions`（trajectory-phase-service.js:292-305）删除不在清单中的阶段及其步骤。前端有意设计；产品线若嫌突兀应在重分析时提示「将作废已录步骤」，引擎侧不动。
- **移交**：引擎改动无需重启 Python（合约每阶段经 reviewer 重新生成+sanitize）；产品线可清空重录 #614 湿测验收（验收口径：任务只点名分类名称时落库须出现序号填写步/助手等价写入，且弹窗关闭后不得点主区保存）。

## 2026-09-07 13:05 · ZCode Lead — 开工声明：登录/登出自动化录制实施（SDD 9 任务）
- **范围（本任务单元）**：migrations/20260907000000_auth_recording.js（新）、src/services/auth-recording/（新）、src/services/operation-component-service.js、src/services/trajectory/trajectory-record-lifecycle.js + trajectory-recording-runner.js + trajectory-dao.js、src/routes/v2/auth-recording.js（新）+ __init__.js + hierarchy.js（系统创建钩子）、src/dashboard/api-docs/catalog.js、src/dashboard/ 系统详情与推送列表组件、scripts/prompts/auth-*-prompt.md（新）。
- **禁入区**：引擎线热区（product_library.json 卡面、tmp/product-mgmt、save_section.py、recorder_emitters/recording-runner 的引擎线改动段——我方仅插登录准备段且另行协调）、scripts/session_runner.py（他线 WIP）、共享文件（package.json、_locator_helpers_js.py）。
- **方式**：subagent-driven-development，每任务子智能体实现+主会话验收代提交+任务评审。spec=docs/superpowers/specs/2026-09-07-auth-recording-design.md，plan=f34e34c。
- **协调**：trajectory-recording-runner.js 与引擎线都在改——我方改动限于 runDefaultLogin/登录准备段（:305-321 一带），开工时若该段有引擎线未提交改动则先等再改。

## 2026-09-07 12:55 · Cursor Lead — 收工：核收门闩 v2 后 #614 清空重录 PASS（回链 12:35）

- **核收**：引擎 `5d6a829a`（form_errors 不再被 save_ok 豁免 + 按阶段终局降级）——本轮湿测见效：首击保存 `err-save-validation:序号` 后补填再存，未在校验红字下假绿
- **完成**：#614 clear → 因 SUT 已删「测试产品A」改为新建 `测试一级分类B/测试产品B-20260907-1235` → 基本信息保存；`recorded` stepCount=**22**；`select_option`×3；stderr toast **操作成功**；p5 核对未启用+stamp
- **验收**：`tmp/product-mgmt/through-report-basicinfo-rerecord.md` + `_tree614-r3.json`；`product_library.json` source/rule 已回写 stamp 1235
- **注意**：①中间一次以旧目标重录曾 p2 失败且控制面过早 recorded（并行观察）；②征信组别小类日志 ok-already 未重复落库；③未碰 session_runner / 未恢复 save_section
## 2026-09-07 12:35 · Cursor Lead — 开工：核收假成功门闩 v2 后清空 #614 并重录

- 开工：12:35。核收引擎线 `5d6a829a`（form_errors 不再被 save_ok 豁免 + 按阶段终局降级）；用户已在 SUT 清理首录相关记录，本单对 #614 清空步骤后重录验证门闩
- 范围：`tmp/product-mgmt/`（clear/prepare/start/through-report）、`docs/superpowers/agent-log.md`；必要时 `data/kb/flows/product_library.json` source/rules 回写；不改引擎
- 禁入：`scripts/session_runner.py` 他线 WIP；`save_section.py` 恢复禁令；R5/R6 在途 traj；引擎线刚改文件（recorder_emitters / recording-runner / action-log-copy）只读核收
- 方式：POST `/clear` → 更新 stamp 任务文案 → prepare → record/start → 验收认 stepCount + select_option + toast/stamp，不认仅 phase_done
## 2026-09-07 13:20 · ZCode 引擎线 — 开工声明：record 假成功根因排查+门闩修复（#612/#614 移交）
- 开工：13:20。承接产品线移交：#612/#614 record/start 假成功（必填 el-select 跳过+关键写阶段 0 步仍 recorded/isSuccessful=1）；Phase 1 根因已定位（零动作门闩二次放行 + 服务端终局仅判总数 0 + 错误门闩 save_ok 放行），进入修复
- 范围：`scripts/agent/recorder_emitters.py`（错误门闩）、`src/services/trajectory/trajectory-recording-runner.js`（终局门闩按阶段降级）、必要时 `src/services/trajectory/action-log-copy.js`（按阶段计数 helper）、`docs/superpowers/agent-log.md`、`tmp/` 验证产物
- 禁入：`scripts/session_runner.py`（他线未提交 probe 改动在身）、`data/kb/**`、产品线文件（tmp/product-mgmt 只读）、R4-R6 在途 traj、`config/.env*`
- 方式：systematic-debugging 四阶段；修后跑 `bash scripts/refactor/verify-all.sh`（注意 3 存量红基线）；子智能体不 commit，主会话验收后代提交

## 2026-09-07 14:05 · ZCode 引擎线 — 收工：假成功门闩 v2 落地（回链 13:20 开工条目）
- **根因（Phase 1 实证）**：三层门闩各有一个洞，#612/#614 打穿路径=「2 步树点击过零动作门闩 → 写阶段跳过必填 el-select 直接点保存 → form_save 无反馈分支记 save_ok → 错误门闩被 save_ok 豁免 → 终局门闩只卡全轨总数 0」：
  1. **Python 零动作门闩**（recorder_emitters.py:411）：拒绝 1 次后二次 done 放行——几步树点击即绕过；
  2. **错误门闩 save_ok 豁免**（recorder_emitters.py:646 原判据）：save_ok=True（含 form_save.py:479 静默保存分支：无 toast/无报错/无跳转一律记成功）时页面校验红字完全不拦；
  3. **服务端终局门闩**（trajectory-recording-runner.js:914 原行）：仅全轨总数 0 才降级——#612 总步 1、#614 总步 2，直接 `isSuccessful:1`。
- **修复（三处，均最小改动）**：
  - `src/services/trajectory/action-log-copy.js`：新增 `countBusinessStepsByPhase(tid, phaseNumber)`（副本按阶段业务步计数）；
  - `src/services/trajectory/trajectory-recording-runner.js`：①recordPhaseResult 对自报 success=true 阶段快照其业务步数（`runtime.phaseBusinessCounts`）；②终局门闩新增按阶段降级——0 步嫌疑阶段双源（副本+DB `trajectory_phase_id` 复核）仍 0 → 整轨 failure + `fake_success_detected` 广播（带 zeroStepPhases），原总数降级分支保留；
  - `scripts/agent/recorder_emitters.py`：`_guard_done_reject_errors` 拆判据——**form_errors（.el-form-item__error 校验红字）不再被 save_ok/introduce_ok 豁免**（未跳转时必拒，契约宽松也拦）；error_notifs 维持原语义。
- **验收**：node --check ×2 + ast.parse ×1 过；countBusinessStepsByPhase 模块级 import 冒烟（5 断言）过；eslint 0；`verify-all.sh` **ALL GREEN**。
- **零动作门闩（移交 C 项）维持现状**：二次放行防 max_steps 死循环保留；服务端 v2 按阶段降级已覆盖同模式。
- **遗留移交**：①「跳过必填 el-select 直接保存」的行为面根治（done 前 DOM 回读必填空）未做，属 B 层；产品线按移交验收口径 1-2 复录验证本轮门闩是否足够；②控制面/执行机重启后生效（.env 无需改）；③#612/#614 仍须修后重录（本轮只保未来轨迹）。

## 2026-09-07 12:10 · ZCode Lead — R4 全部达成（606/607/608 三轨迹）+ G5 派发（R5 批复查看+R6 用信打包棒）
- **G4 完成（R4 棒 2，主链审批段闭环）**：①WN0001 账号补建（systemAccountId=26）②traj 607=评级二次调查录制，**PJ20260907016009 状态=通过（评级生效，bsnSt=5）**③traj 608=授信二次调查录制，**DGSX20260907056033 通过（applyState=5）→批复自动生成 DGSXPF20260907020005 已生效**（R5 对象）。注意：评级/授信列表按经办人数据域强过滤（WN0001 名下恒 0 条），pageBsnInf 等 API 可按 bsnNo 直查；curl 中文 body 须 UTF-8 文件 --data-binary。
- **G5 已派发（R5+R6 打包棒，进行中）**：R5=批复查看录制（fid=9000000057，DGSXPF20260907020005 要素核对，只读）；R6=对公用信申请录制（批复 DGSXPF20260907020005→方案品种命中分项→10 万/12 月→保证+引入保证人→利率→提交→黄亮；credit_usage 卡配方 P3-B 实证）。
- 主链计分板：R1 ✅ → R2 ✅（评级生效）→ R3 ✅ → R4 ✅（606/607/608）→ **R5+R6 进行中** → R7 合同（批复生效后主合同自动创建，签订止于已保存态=产品裁定）。
- G4 坑位沉淀（后续轨迹通用）：阶段 1 必须显式「关闭天元相关配置欢迎弹窗（点确定）」；record/start 过早返回 recorded——detach 前盯 agent-stderr session-end 或 stepCount 连续稳定；stepCount 口径以 recordStatus+isSuccessful+tree 为准。

## 2026-09-07 11:35 · Cursor Lead — 收工：产品库基本信息保存补录（回链 11:15）
- 完成：PM 缺口「基本信息填写并保存」——交易 **#614**（fid=0740）；业务门闩经 CDP 达成（toast「操作成功」+ 描述 stamp `20260907-1130`）；#499 仍覆盖新增一级分类+新增产品
- 验收：`tmp/product-mgmt/through-report-basicinfo.md`；`_cdp614_basicinfo.json/.png`；`product_library.json` 已回写 source/rule
- 注意：#612 假成功作废；#614 AI 保存阶段 steps=0（record/start 假成功复现）→ **DONE_WITH_CONCERNS**；强步骤数验收需引擎修后重录
- 禁入遵守：未碰 session_runner 等他线 WIP；未恢复 save_section

## 2026-09-07 12:40 · ZCode Lead — R5 批复查看 PASS（traj 613）+ R6 单据生成（YXPC20260907012045 待发起）+ G6 续棒派发
- **G5 完成**：①R5 批复查看录制 PASS（traj 613 recorded，4 步落库，查看页要素全核对：DGSXPF20260907020005/100 万/生效/关联额度 EDBH20260905080002）②R6 用信：第 1 轮选错客户撞盛达草稿（立即 stop 止损）→第 2 轮（traj 616，recorded，98 步）**YXPC20260907012045 生成（待发起）**，卡三点：利率档次/LPR disabled+required 字段名未命中 Vue model（run26e 配方字段名不匹配）、保证人引入 0 候选（190416/瑞昇均查不到）、省份下拉 value-mismatch。
- **G6 已派发（R6 续棒，进行中）**：利率字段名深扫（枚举 form model 键名）→直写；保证人改盛达/MBP 重试（或切信用方式）；省份真实 click；提交→黄亮→审批中。
- businessEntries 必须带客户编号+客户名称（否则放大镜模糊选客翻车——615 教训，616 补齐后全程锁定正确客户）。
- 主链计分板：R1-R4 ✅ → R5 ✅（613）→ **R6 单据已生成待收口**（G6）→ R7 合同。

## 2026-09-07 13:05 · ZCode Lead — R6 深坑全修+流程提交止于 SUT 角色配置卡点（非我方可修），主链收敛报告
- **G6 完成（R6 续棒 254 工具调用）**：三缺口全修——①利率区块真实 model 名 intrtLvl/lprIntrt+配套 intrtTp/intadjMod/intrtMdfEffMod+window.i18n 桩，保存成功；②保证人=盛达建筑工程有限公司引入成功（saveOrUpdateCrutWithCltlRel+NextCheck 通过）；③行政区划 $emit 给 value 码（110101）、行业投向 treeData id（E47）。全区块保存成功，向导推进到意见。
- **流程提交止于 SUT 卡点**：选人后服务端拒「下一节点没有可处理的用户，请配置[客户经理]角色的用户！」——wf_usecredit_001_002 节点 nextCandidateRoles=[X0018] 角色人员配置漂移（P3-B 时代可通）。3 种 payload 变体均拒，非客户端可修——**需 SUT 管理员给 X0018 角色配用户（如 WN0001）**。单据 YXPC20260907012045 停待发起（无脏提交）。
- **credit_usage 卡 +4 规则（71612302 已推送）**：利率字段真实名/保证人候选/行政区划 value 码/角色配置卡点。配方文档 tmp/kb-mainchain/R6-usage-apply/rate-field-recipe.md。
- **主链终盘（本轮）**：R1 客户新增 ✅ → R2 评级 ✅（生效）→ R3 授信 ✅ → R4 审批 ✅（606/607/608）→ R5 批复查看 ✅（613）→ **R6 用信：录制管线全绿+98+57 步落库+全区块保存成功，业务闭环 BLOCKED@SUT 角色配置** → R7 合同（等 R6）。
- **待用户/SUT 管理员**：给 X0018（客户经理）角色配置用户（建议 WN0001）后，R6 v2 一棒收尾（单子待发起可续）→ R6 审批段 → R7。
- 配方资产沉淀：rating+4/credit_usage+4/credit_application+2/customer_onboarding+1 共 11 条实证规则本轮落卡；3 份配方文档 tmp/kb-mainchain/。

## 2026-09-07 14:20 · ZCode Lead — 收工回报：主链 R1-R5 PASS + R6/R7 挂起（用户拍板），todo-list 落档
- **用户拍板**：被测系统暂时不能提供账号支持（X0018 角色配用户）——R6/R7 **暂时搁置**；todo-list ⑤ 已改写为「完成矩阵（R1-R5 全 PASS 双证）+R6 挂起项（阻塞点/恢复条件/一棒收尾续接步骤）」。
- **主链最终战报**：R1 客户新增（595）→ R2 评级（604+607，生效）→ R3 授信（605+608，通过）→ R4 审批（606/607/608，WN0001 id=26）→ R5 批复查看（613）→ R6 用信（616+续棒：YXPC20260907012045 待发起，三深坑全修，流程提交止于 SUT 角色配置）。合计 11 条录制轨迹、300+ 步落库、11 条实证规则落卡（rating+4/credit_usage+4/credit_application+2/customer_onboarding+1）、3 份配方文档 tmp/kb-mainchain/。
- **本轮全部推送**：最新 4ac2e28e→e9648bfb（含 G1-G6 子代理产物与全部阶段回报）。另：DB 直连方案（用户解决）替代 SSH 隧道=落库延迟真凶根治；并行会话 auth-recording spec 线条目已随 commit 携带。
- **挂起移交**：R6/R7 等 SUT 管理员给 X0018 角色配用户（建议 WN0001）；恢复即 R6 v2 一棒收尾→审批段→R7→T3.1 heal live→P6-4 终验。

## 2026-09-08 10:50 · ZCode Lead — R6 卡点验证定案：切角色不能绕过（G7 判定 b），搁置维持+规则补强（ad342594）
- 用户发现 701994 可切换角色（截图）→ Lead 实测切换到「客户经理」角色成功 → G7 验证：G6 confirmSubmit 直调法复现成功（Vue2 el.__vue__+$children BFS 定位意见组件 ZJJK00068204→formData.pcsMnpltCd=nextTask+nextNodeAprvPsn=WN0001-9881-X0018→i18n 桩→直调），submitProcess HTTP 200 发出，**服务端拒单逐字一致**（「请配置[客户经理]角色的用户」）。
- 旁证：workflowTree API 返回「下一步审批人员为空，下一步：{}」——租户 9881 下 X0018 角色无人员映射。
- **定论**：流程引擎节点候选解析与提交人会话激活角色无关（按租户级角色-用户映射查），切角色不能绕过；credit_usage 卡「用信提交角色配置卡点」规则已补强验证结论（ad342594）。R6/R7 搁置维持，恢复条件不变（SUT 管理员配 X0018 候选用户，含数字用户 ID 映射）。
- 配方资产：G6/G7 两棒验证的 confirmSubmit 直调法+意见组件定位法已完整记录（rate-field-recipe.md 第 5 节+卡面），恢复后直接可用。

## 2026-09-07 11:15 · Cursor Lead — 开工声明：产品库「基本信息保存」补录
- 开工：11:15。补 PM 验收缺口：在 #499（一级分类+新增产品）之外，录一条「选中未启用产品 → 基本信息填写 → 保存」贯通交易
- 范围：`tmp/product-mgmt/`（任务/analyze/create/through-report）、`data/kb/flows/product_library.json`（仅 source/rules 回写）、本文件
- 禁入：他线 WIP（`scripts/session_runner.py` 等）、R4 审批棒占用的 traj/卡、`save_section.py` 恢复、引擎大改
- 方式：主会话按 `guides/ui-record-through-line-agent-prompt.md`；fid=9000000740；account=2；不抢已 busy 的 slot1/2/3 会话本体（新 prepare 另占空闲槽）

## 2026-09-07 10:35 · ZCode Lead — R4 棒 1 完成（traj 606）+ G4 棒 2 派发（WN0001 双二次调查）
- **G3 完成（R4 棒 1）**：traj 606 recorded（fid=9000000269 待办任务叶子，5 步：待办定位+任务详情翻页），DGSX20260907056033 流转至 002 二次调查（WN0001 待处理）——**门闩达成**。G3 诚实标注：流程轨迹处理时间（09:51:49）早于轨迹创建（09:54:38），同意动作疑由更早在途会话完成、本次录制只录到定位+翻页。坑位：待办真实路由 #/portal/wfPendTask（#/index/todoTask 404）；detach 后立即断言 stepCount 会读 0（异步持久化+副本 TTL）。
- **WN0001 账号解锁**：SUT 测试环境统一密码=1（MCP 实测 WN0001/1 登录成功进首页）；控制面 system-accounts 无 WN0001 条目。
- **G4 已派发（R4 棒 2，进行中）**：①控制面补建 WN0001 账号（POST /systems/1/accounts）②轨迹 A=评级二次调查 PJ20260907016009 同意（评级生效）③轨迹 B=授信二次调查 DGSX20260907056033 同意（授信通过→**批复自动生成核验，R5 输入**）。

## 2026-09-07 11:00 · ZCode Lead — 收工回报：登录/登出自动化录制 spec 已产出（回链 11:00 开工条目）
- **完成**：spec `docs/superpowers/specs/2026-09-07-auth-recording-design.md`（brainstorming 五决策点定案：agent 自主演练录制 / 替换 runDefaultLogin / 双载体轨迹+组件 / 单账号一套组件 / 推送不自动走既有链路；含数据模型 1 新表+3 列、job 编排、运行时注入账密、验收标准 6 条、边界 4 条）。
- **验收证据**：spec 自审通过（无占位/一致/无歧义）；本任务单元未动任何代码，改动面仅在文档。
- **遗留移交**：待用户评审 spec → 评审通过后走 writing-plans 出实施计划；实施时需与引擎线协调 `trajectory-record-lifecycle.js`/`trajectory-recording-runner.js` 改造窗口（引擎线 R4 审批棒在途）。

## 2026-09-07 11:00 · ZCode Lead — 开工声明：登录/登出自动化录制 spec 设计（brainstorming）
- **范围（本任务单元）**：仅 `docs/superpowers/specs/2026-09-07-auth-recording-design.md`（新建）+ 本日志条目。设计与方案文档，**不动任何代码**。
- **禁入区**：他线热区（R4 审批棒在途、rating/credit_application 卡面、tmp/kb-mainchain）、工作区 WIP（scripts/session_runner.py 修改属他线）。
- **方式**：brainstorming 流程，澄清问答已毕（录制=A agent 自主演练、运行时=A 替换 runDefaultLogin、载体=A 双载体轨迹+组件、账号=单账号一套组件、推送=A 不自动走既有链路）。产出 spec 后提交，待用户评审。

## 2026-09-07 10:20 · ZCode Lead — R3 授信业务闭环 PASS（G1 救援完成）+ G2 卡面回写已提交（ccc0c2ca）+ G3 审批棒派发
- **G1 完成（R3=PASS）**：DGSX20260907056033 走完向导（影像跳过/风险阻断通过/意见/流程提交/选人黄亮）→**审批中**（经办日期 2026-09-07）。树选择配方实证：**有效搜索框=树 popover 自带搜索框+【查询】按钮（两段式非实时过滤）**，「流动资金贷款」叶子名实为「流动资金贷款额度」；分项「已在列表中」报错=服务端查重（前次手工已落库，前端列表回显缺陷）。配方文档 tmp/kb-mainchain/R3-credit/picker-recipe.md（tmp 短寿命，精华已入 credit_application 卡）。
- **G2 完成（ccc0c2ca 已推送）**：customer_onboarding +预客户缺口规则+建档 pendingStep；credit_application +分项品种树缺口/方案自动保存 2 规则。JSON 校验通过。
- **G3 已派发（R4 审批棒，进行中）**：产品管线录制「授信审批任务页操作」——待办任务定位 DGSX20260907056033 信贷调查→同意→流程提交→核验流转；附加侦查 system-accounts 清单（棒 2 需 WN0001 账号身份录制评级二次调查 PJ20260907016009）。
- 主链计分板：R1 ✅（595）→ R2 ✅（604，审批中）→ R3 ✅（DGSX…033，审批中）→ **R4 进行中** → R5 批复 → R6 用信 → R7 合同。
- G1/G2 均未 commit（纪律），Lead 代提交：ccc0c2ca（G2 卡面）；G1 产物在 tmp（不入库）。

## 2026-09-07 09:55 · ZCode Lead — 派工声明：R3 授信救援+卡面回写（两子代理并行，Lead 只编排）
- **G1（general-purpose，MCP 浏览器）**：救援授信单 DGSX20260907056033（贯通验证企业190416，待发起）——分项品种树定位「流动资金贷款」→填分项（100 万/否/人民币）→保存→向导提交→选人黄亮→核验审批中；产出树选择配方 tmp/kb-mainchain/R3-credit/picker-recipe.md。背景：traj 605 实证标准动作集无法操作 TsscMultiTree 品种树（115 节点，树内中文搜索无效）。
- **G2（general-purpose，文本）**：customer_onboarding.json 补「信贷预客户不在评级/授信可选范围」+完整建档 pendingSteps；credit_application.json 补「品种树缺口」+「方案保存即生成 DGSX 号」两条实证规则。文件集：仅此两卡。
- 禁入（全体）：commit、他线 WIP、其他客户单据、影像/OCR。
- Lead 后续：G1 回报后验收配方文档+单据状态→commit 卡面与文档→R4 审批分段派发。

## 2026-09-07 09:30 · ZCode Lead — R2 评级业务闭环成功（traj 604/599/603 四轮配方收敛全记录）
- **R2 = 业务闭环达成（traj 604）**：【修改】进入 PJ20260907016009 待发起单→测算核对→系统评级结论维护（建议等级 B/期限 12 月）→末步流程提交→选人黄亮→**「流程提交成功！」**→**列表回显状态=审批中**（outcome 原文）。27 步落库（副本即时）。
- **配方收敛链共 8 轮（596-604）**，产出 rating.json 卡面 +4 规则（b84fe923）：①客户综合评价区块（20+ 指标清单）②评级测算暂存（测算区块自身【暂存】非结论区【保存】）③评级等级测算指标表（25 项=7 数值+18 下拉，全维护才能测算）④模拟≠测算（模拟仅预览）。手工探通用 Playwright MCP 实测（saveScor 200 rtgScor=51.4/rtgGrd=36）。
- 主链进度：R1 客户新增 PASS（595）→**R2 评级 PASS（604，PJ20260907016009 审批中）**。R3 授信（190416 正式客户+评级已生效前置满足，credit_application 卡+分项额度配方）→R4 审批分段（WN0001/黄亮）→R5 批复→R6 用信→R7 合同。
- 注意：604 回放验证跳过（27 步含流程提交，回放会重复提交对审批中单子无效操作）——回放能力由 R1（11/12 confirmed）背书；R2 的业务核验=PJ 状态审批中（更强证据）。
- 提交：b84fe923 已推送。

## 2026-09-07 07:04 · ZCode Lead — 阶段回报：sync 延迟真因改写（SSH 隧道）+R2 六轮收敛至按钮级缺口，卡面 +2 规则（4ac2e28e）
- **产品级结论改写（重要）**：昨日「action_log_sync 端到端分钟级延迟」真因=**本地开发的 DB 走 127.0.0.1:13306 SSH 隧道，隧道不稳定导致 DB 写入排队/丢包**（今日 server-err ECONNREFUSED 实锤；588「detach 疏通」=进程退出强制重连）。**生产部署（控制面与 DB 同机房）无此问题**——削 RTT/副本两套优化仍然有效且必要（副本=展示即时性，削 RTT=持久化成本）。DB 依赖重操作前先确认隧道存活（netstat :13306）。
- **R2 评级六轮收敛链（596→601）**：①596/597 预客户不在评级可选范围（主链前置缺口：R1 需完整建档转正）→②598 严格查询文案修正偏航→③599 严格查询+选中+评级重评成功，PJ20260907016009 生成，提交被「请先维护客户综合评价」拦→④600 续操作（【修改】进待发起单配方实证），综合评价区块维护通过（配方补丁生效），又拦「请先进行测算」→⑤601 文案显式顺序仍拦——agent 自诊断=**测算已执行且指标有值，但误点「系统评级结论」区块的【保存】，应用测算区块自身【暂存】**。
- **卡面 +2 规则（4ac2e28e）**：rating.json「客户综合评价」区块（20+ 定性指标清单，599 form_snapshot main#2 46 字段实证）+「评级测算暂存」（测算区块自身【暂存】，非结论区【保存】）。R2 收敛至**按钮级缺口**：v7 文案按「测算→暂存→末步提交」一次可收；PJ20260907016009 待发起单仍在可续。
- **R2 期间管线健康度**：600/601 分别 57/36 步全落库、副本即时、门闩放行正确——昨日修复三件套（副本+削RTT+异步门闩）在 DB 稳定环境下全部工作正常。
- 下一步：R2 v7（文案带「测算后点测算区块【暂存】」）收尾→R3 授信（用 190416 正式客户，credit_application 卡+分项额度配方）→R4 审批分段→R5-R7；T3.1 heal live 插棒。测试数据残留清单：KB主链R1-* 客户×3+测试科技发展有限公司+PJ20260907016009 待发起单（口径=引擎线业务数据，保留）。
- 提交：4ac2e28e 已推送。

## 2026-09-07 03:30 · ZCode Lead — 阶段回报：副本方案实施+R1 三证 PASS+R2 深入实证（配方缺口定位），收口待续
- **副本方案实施完成（e0420001/bb01f05a，用户设计批准）**：action-log-copy.js（快照覆盖+业务步计数排除 meta/engineering 双类+30min TTL）；handleActionLogSync 到达即覆盖副本；异步门闩判定源切副本计数（即时）；getTrajectoryWithPhases 副本优先覆盖 stepCount（stepCountSource 字段标识）。verify-all EXIT=0。
- **削 RTT（3488d03c）**：每步 persist 7-9 远程往返→1-2（步号内存化/幂等查短路/trustPhaseId/batchSave 返回 insertIds 免回查/counts 延迟阶段收尾）；顺带修门闩误读 `.steps`（应为 `.stepCount`，594 误降级根因）。
- **R1 客户新增=三证 PASS（traj 595）**：recorded+副本即时 stepCount、回放 11/12 confirmed（1 环境条件步=弹窗关闭）、stamp「KB主链R1-20260907-0545」+客户编号 26090701521085645 落库（stamp 跨轮保持修复实证生效）。
- **R2 评级 4 轮（596-599）深入实证**：①596/597 卡「选择客户」抽屉——根因=**R1 建的是信贷预客户，不在评级可选范围**（需完整建档转正=主链前置缺口）；②598 偏航操作 MBP 客户撞「已有待发起评级流程」风险阻断（未落库无脏数据），严格查询文案（v4）后修正；③**599 深入 90%**：重评向导→大页面（**PJ20260907016009** 生成）→测算→结论→签署→流程提交，被「请先进行测算」「请先维护客户综合评价」两道业务闸门拦——**配方缺口=评级大页面「客户综合评价」区块**（section 结构 wizard:基本信息|section:客户综合评价|titlebox:股东信息，rating 卡无此 cue）。R2=BLOCKED（配方缺口），录制管线本身全绿（39 步落库+副本即时+门闩正确放行）。
- 下轮移交：①从 599 form_snapshot 挖综合评价区块字段清单→补 rating.json 配方→v5 重跑（PJ20260907016009 待发起单还在可续操作）；②R1 建档链扩展（预客户→正式客户）补 R1 卡 pendingSteps；③R2 过后 R3-R7 顺序不变；④大页面区块多时 save_form_snapshot 密集（599 共 7 个），落库体积可观察。
- 提交：3488d03c/e0420001/bb01f05a/136221e9 已推送；本轮 detach+验证为主，无新代码。

## 2026-09-07 01:16 · ZCode Lead — 阶段回报：P6-0 修路完成（三 commits）+ R1 跑车 8 轮实证，sync 管道产品级缺陷定性，收口待用户定夺
- **P6-0 交付（aab83b68/795be5ee/f178411a，已推送）**：①假成功硬门闩三版迭代——最终形态=异步终局化（start 立即 recorded，后台 90s 二次 resync+DB 复核，0 业务步降级 failed+广播 fake_success_detected，594 实证全链工作）；②每阶段步数计数（persisted.trajectoryPhaseId 真归属）；③落库失败重试+step_persist_failed 广播；④填充校验对称（false_ok actual=空 时 label 回读升级 ok:label-readback）；⑤零动作 done 门禁（首次拒绝+二次放行，recorder_emitters._guard_done_reject_zero_actions）；⑥auto-fill stamp 跨轮保持（businessEntries 平铺键防 cert-detect 默认值覆盖——590 实证 stamp 被覆盖为「测试科技发展有限公司」）
- **P6-1 交付（9037f514）**：3 张主链卡晋升 flows 82→84（批复查看 new/审批任务页 new/评级申请链 merge rating.json+14 节点）；promote_draft.mjs 加 curation.include gate 豁免（Steps 零 blocked 的 partial 主链卡）
- **产品级发现（新）**：**action_log_sync 端到端延迟可达分钟级**（588 detach flush +8 步、592/593 resync 回包跨窗、594 复核 0 步）——逐环节排查（Python emit 有 flush/executor 转发无过滤/ws OPEN 直发/hub 无缓冲，探针脚本全在库）均无显式缓冲，端到端却分钟级——**结构性修复（Python 直推 HTTP/DB）超出 P6-0 范围，建议上报产品组**； tonight 修复是在此约束下的最大达成：门闩永不误放假绿（宁可 failed+事后可回滚）
- **R1 客户新增（8 轮 583-593）**：业务侧**客户确实建成**（589/590：客户编号 26090700580316743，traj 588 stepCount=10）——但三证未齐：stamp 被覆盖（已修待复验）+sync 延迟致步骤不全（产品级）。**R1=DONE_WITH_CONCERNS**。R2-R7 未开始（等 sync 缺陷裁决：修通道 or 带缺陷验收）
- **环境**：控制面+executor 带日志重启流水化（tmp/logs/server-*.log、executor-*.log）；分析/创建/录制脚本模式 tmp/kb-mainchain/R1-customer/
- **遗留移交**：①sync 管道修复方案（Python HTTP 直推）待拍板；②R1 复验（stamp 修复+新门闩）一轮即收；③R2-R7 全量待跑；④T3.1 heal live 验收未动；⑤测试数据残留：SUT 多笔测试客户（KB测客户系列/测试科技发展有限公司/KB主链R1-*）待清理清单
- 提交：b3d4b974→f178411a 7 commits 已推送

## 2026-09-07 01:57 · ZCode Lead — 阶段回报：用户副本方案评估批准并实施完成 + R1 三证 PASS（回链 00:02 开工）
- 完成：**用户设计的「服务器端 action_log 副本」方案评估=可行，经批准已实施（e0420001/bb01f05a）**：①新模块 `action-log-copy.js`（按 trajectoryId 的内存副本，action_log_sync 全量快照覆盖，countBusinessSteps 排除 meta+engineering 双类对齐产品 stepCount 口径，30min TTL）；②recording-runner handleActionLogSync 到达即覆盖副本；异步门闩判定源切副本计数（即时），DB 复核保留作最终一致+counts 刷新；③getTrajectoryWithPhases 副本优先覆盖 stepCount（stepCountSource='action-log-copy'），副本缺席回退 DB。
- **R1 客户新增三证 PASS（traj 595）**：①录制 recorded，副本即时 stepCount=8（finalize 时 copy=8/db=7）；②回放 11/12 confirmed（唯一 false=step1 弹窗关闭点击——回放会话弹窗未出现，环境条件性步骤，正是 P6-3 容错的靶场景）；③**stamp 落库**：客户名称=KB主链R1-20260907-0545、客户编号 26090701521085645（stamp 跨轮保持修复实证生效；证件号码 X 尾冲突 agent 自主改 Y 尾重存=智能行为）。
- 配套（3488d03c）：每步 persist DB 往返 7-9→1-2（步号内存化/幂等查短路/phaseId 信任/batchSave 返回 insertIds 免回查/counts 延迟到阶段收尾）；修 async gate 误读 `.steps`（应为 `.stepCount`）导致 594 误降级。
- **用户拍板（本段）**：①Python HTTP 直推否决——部署架构=被测系统在用户内网，执行机出站 WS 向服务器注册，用户经服务器间接操作（架构注释已入库 server.mjs+executor/ws-client.js 顶部）；②服务器端 action_log 副本方案批准并已实施。
- 状态：R1 DONE（带 1 环境条件步 note）。下一步：R2 评级→R3 授信→R4 审批（分段）→R5 批复→R6 用信→R7 合同→T3.1 heal live→P6-4 终验。
- 提交：3488d03c/e0420001/bb01f05a 已推送。

## 2026-09-07 00:02 · ZCode Lead — 开工声明：P6 连续执行启动（用户已批准计划+六项拍板）
- 用户拍板（2026-09-07 00:00 前后）：①R4 审批=分段录制+单号衔接，接受主链轨迹非单条；②P6-0 直接动他线热文件；③合同止于已保存态 OK；④多角色账号暂无法提供，R4 按已实证配方（701994/WN0001/黄亮）跑，缺角色再回报；⑤上传封死维持绕行；⑥假成功本仓先修+方案同步产品组
- 范围：P6-0 代码修复（src/services/trajectory/trajectory-recording-runner.js、form-snapshot-append.js 等+Python scripts/agent/recorder_emitters.py、填充回读侧——动手前先查 characterization pin）；P6-1 KB 补卡（data/kb/req/credit-corp/drafts/ 新草稿卡×2+rating 增强，由 general-purpose 子代理产出、Lead 晋升）；随后 P6-2 R1-R7 跑车（tmp/kb-mainchain/、flows 卡 source 回写）+P6-3 容错+P6-4 终验
- 方式：**连续执行模式**（用户明示授权：一直做、遇阻塞再问）；P6-1 子代理代声明（不 commit 不写 flows，产出 drafts 由 Lead 验收晋升）；P6-0 主线程亲自改（行为变更非机械改，每步 verify-all+特征化回归）
- 禁入：`config/.env*`、影像/OCR/文件上传场景、删除 SUT 既有数据；他线 gates 链（b5399d63）代码语义不改只叠加
- 计划文本：`docs/superpowers/research/2026-09-06-mainchain-p6-plan.md`（b3d4b974）

