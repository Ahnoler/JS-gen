# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

本文件**只从 2026-08-03 开始记**，之前的 24 个迁移（2026-07-13 ~ 2026-08-02）不回填。
Python 控制面（`d:\dev\ui-auto-recording-agent-python`）以当前 `schemas/init.sql` 为基线对齐，历史迁移视为已同步。

## [Unreleased]

### Added

- 2026-08-07: **`POST /api/v2/trajectories/{id}/steps/move`**：拖拽改序 / 跨阶段移动单步；`beforeStepId` 省略或 null 表示目标阶段末尾；AI 录制 / 人工录制 / `session.busy` 时 409。
  影响范围：v2 trajectories API、step DAO、api-docs。
  文件：src/dao/trajectory-step-dao.js, src/services/trajectory-step-move.js, src/services/trajectory-step-service.js, src/services/trajectory-service.js, src/routes/v2/trajectory.js, src/dashboard/api-docs/catalog.js
  Python 同步提示：对齐 `POST .../steps/move` 请求体与 409 忙碌语义。

- 2026-08-07: Session Chrome 可选无头：`CHROME_HEADLESS=true`（config/.env 或 executor/.env）。无实体窗口，BiB 仍走 CDP screencast，便于规避最小化/失焦节流。
  影响范围：config、executor 子进程 env、Python 启动参数。
  文件：config/.env.example, executor/.env.example, executor/config.js, src/runtime/agent-process.js, scripts/session_runner.py
  Python 同步提示：无（仅 JS-gen Session Chrome 启动）。

### Changed

- 2026-08-07: 删除 `trajectory_step.is_replay` 列及 `idx_step_is_replay` 索引；列表/计数/组件签名不再按该列过滤。`POST .../steps/replay` 请求体 `isReplay` 仍为运行时抑制入库。
  影响范围：schema、trajectory step DAO/计数、operation-component 签名、api-docs。
  文件：migrations/20260807160000_drop_trajectory_step_is_replay.js, schemas/init.sql, src/dao/trajectory-step-dao.js, src/dao/trajectory-dao.js, src/services/trajectory-step-service.js, src/services/operation-component-signature.js, src/services/operation-component-service.js, src/services/trajectory-persist-service.js, src/dashboard/api-docs/catalog.js
  Python 同步提示：对齐 schema 删除 `is_replay`；勿再读写该列。

- 2026-08-07: AI 录制阶段结果 **`prior_outcome.success` 缺省改为未知（`null`）**，不再把「未收到明确 done(success)」当成成功。`phase_done` 无 outcome 时 Python 显式发 `success: null`；控制面仅在 `true`/`false` 时写入成败，文案走「未知」。
  影响范围：录制生命周期 prior 注入、session `phase_done`。
  文件：src/services/trajectory-record-lifecycle.js, scripts/session_runner.py
  Python 同步提示：对齐 prior_outcome.success 三态（true/false/null）；勿再 `?? true` / `!== false`。

- 2026-08-06: AI 录制 step instruction 增加 **`all_phases`**（当前录制集全量阶段 id/序号/标题/描述）与 **`prior_outcome`**（上一阶段一句结果）；不再依赖 prior 0–2 段全文注入执行 Agent。
  影响范围：录制生命周期 → Python session instruction。
  文件：src/services/trajectory-record-lifecycle.js, src/executor-session-client.js, executor/session-handler.js
  Python 同步提示：session step 消费 `all_phases` / `prior_outcome`（经 executor `session.step` 中继转发）；执行 Agent 用短目录，评审器用全文 description。

- 2026-08-06: 组件库列表展示 **入库人**（`created_by`，暂可空串显示「—」）；`special_element` 同步预留 `updated_by`。
  影响范围：schema、列表 UI。
  文件：migrations/20260806123000_library_created_by.js, schemas/init.sql, src/dao/operation-component-dao.js, src/models/entities.js
  Python 同步提示：对齐 `operation_component.created_by`、`special_element.created_by/updated_by`。

- 2026-08-06: 特殊元素库保留筛选：**入库说明 / 步骤说明 / 入库人**（与系统/模块/功能/入库时间并存）；后端支持 `keyword`/`stepDesc`/`createdBy`。
  影响范围：特殊元素列表 API、Vue UI。
  文件：src/dao/special-element-dao.js, src/services/special-element-service.js, src/dashboard/api-docs/catalog.js
  Python 同步提示：对齐 special-elements list 的 stepDesc/createdBy 查询参数。

- 2026-08-06: 组件库列表筛选对齐：`GET /api/v2/operation-components` 与 `GET /api/v2/special-elements` 支持 **systemId / moduleId / functionId** 三级联查 + **startTime/endTime**（按 created_at 入库时间）。moduleId 展开下属功能；functionId 优先。
  影响范围：列表 API 查询参数、api-docs、Vue UI资产库两 Tab。
  文件：src/dao/operation-component-dao.js, src/services/operation-component-service.js, src/dao/special-element-dao.js, src/services/special-element-service.js, src/dashboard/api-docs/catalog.js
  Python 同步提示：对齐 list 查询参数 moduleId/functionId/startTime/endTime。

### Added

- 2026-08-06: **操作步骤原子化组件库 Phase 1（沉淀）**：新建 `operation_component` / `operation_component_occurrence`；`trajectory_phase.component_id` 预留列（业务不写）。v2 API：`/api/v2/operation-components`（list/get/create/patch/confirm/deprecate/delete）+ `POST .../mine`（按 systemId/functionId/trajectoryIds 扫轨迹三表，签名含 label_text 等稳定语义；已存在组件只加 occurrence 不改文案）。api-docs 归入分组 **「组件库管理」**（`id: component-library`）。本阶段不碰 login、不接录制/回放引用。
  影响范围：MySQL schema、v2 API、api-docs。
  文件：migrations/20260806120000_operation_component.js, migrations/20260806120100_trajectory_phase_component_id.js, schemas/init.sql, src/dao/operation-component-dao.js, src/dao/operation-component-occurrence-dao.js, src/services/operation-component-signature.js, src/services/operation-component-service.js, src/services/operation-component-mine-service.js, src/routes/v2/operation-component.js, src/routes/v2/__init__.js, src/dashboard/api-docs/catalog.js, src/models/entities.js, src/models/constants.js, scripts/prompts/component-mine-prompt.md, scripts/characterization/characterize-operation-component.mjs
  Python 同步提示：对齐新表 schema + `/api/v2/operation-components*`；`trajectory_phase.component_id` 可空预留；mine/CRUD 语义见 CHANGELOG。

### Fixed

- 2026-08-06: **表单结构 Type B 护栏**：expected/actual 数量崩塌或 missing 过半（错容器扫描特征）时检查点失败，禁止删 missing 步骤、禁止改 form_snapshot；与 `container_not_found` 同路径。
  影响范围：live steps/replay Type B。
  文件：src/services/trajectory-session-replay.js, src/dashboard/api-docs/catalog.js
  Python 同步提示：对齐 Type B「unsafe diff 不删步/不改快照」语义。

- 2026-08-06: **表单结构校验按录制 container 选根**（实锤：main 检查点在抽屉仍开时用 getContainer 扫到抽屉 6 字段 → Type B 误删主表步骤）。`verifyFormStructure(fields, containerId)` / live `_replay_verify_form_structure` 传入 `main|drawer:…|dialog:…`；`main` 排除可见 overlay 内字段；容器找不到返回 `error:container_not_found` 且 Type B 不删步/不改 snapshot。
  影响范围：live steps/replay Type B、assemble 注入的 FORM-CHECK、CTRL.verifyFormStructure。
  文件：src/ctrl-actions.js, scripts/actions/_js_snippets.py, scripts/actions/_replay.py, scripts/script_assembler.py, src/services/trajectory-session-replay.js, src/dashboard/api-docs/catalog.js
  Python 同步提示：若镜像 verifyFormStructure / steps replay Type B，对齐按 container 选根与 container_not_found 失败语义。

- 2026-08-06: **action_log_sync 单条 entry 后处理抛错导致整批循环中断、录制步骤永久卡死**（实锤：交易 35 阶段 2 在 trajectory_step 第 118 行后不再前进，Python `_ACTION_LOG` 已到 337 条且 `done(success=true)`）。根因：`appendRecordedStep` 成功后 `flushPendingStepScreenshot` / `broadcast` 无 try/catch，异常冲出 `for (const entry of entries)` 循环，后续 entry 全部跳过；下一条全量快照在同一位置再次中断。修复：① 单条 entry 处理（含截图 flush / broadcast）包 try/catch 并打 `[record] action_log_sync entry failed` 日志，循环继续；② `resolvePhaseIdForPersist` 返回 `{ id, phaseNumber }` 消除 phase 重复查询；③ `trajectory_step.action_id` 列 + `(trajectory_id, action_id)` 唯一索引，`appendRecordedStep` 插入前查重（`ER_DUP_ENTRY` 兜底），控制面重启后 DB 级幂等。
  影响范围：录制落库管道（action_log_sync）、MySQL schema、appendRecordedStep。
  文件：src/services/trajectory-record-lifecycle.js, src/services/trajectory-persist-service.js, src/models/helpers.js, src/dao/trajectory-step-dao.js, migrations/20260806130000_trajectory_step_action_id.js, schemas/init.sql, scripts/smoke/smoke-trajectory-step-idempotent.mjs
  Python 同步提示：`trajectory_step` 新增可空列 `action_id VARCHAR(64)` + 唯一索引 `uk_traj_action (trajectory_id, action_id)`；Python 控制面（`d:\dev\ui-auto-recording-agent-python`）若镜像该表 schema 需同步加列与索引。NULL 不受唯一约束（历史行及 manual/cdp/special_element 来源保持 NULL）。

- 2026-08-06: **force_refill 重扫把本会话刚填字段打回 pending 导致整表重复填 3 遍**（实锤：交易 35 122 字段表单 337 条 auto-fill；法定代表人引入弹窗关闭后 stale 容器重扫 + agent 请求不存在字段「婚姻状况」触发未知 label 重扫）。根因：`TaskList.from_scan(force_refill=True)` 无差别把 DOM 有值字段打回 pending，值生成无缓存每次随机不同。修复：① `session_filled_labels` 豁免本会话已填字段；② `_task_done_impl` 记录 `_autofilled_labels` / `_generated_value_cache`；③ `_execute_round` 经 `commandValue` 复用缓存值；④ `_auto_fill_pending` 兜底过滤。
  影响范围：表单填写 agent（录制新增场景 auto-fill 状态机）
  文件：scripts/models/task.py, scripts/actions/_form.py, scripts/characterization/characterize-phase-intent.py
  Python 同步提示：无强 schema 变更；纯 agent 运行时状态机逻辑，Python 控制面若有独立镜像的表单填写状态机可参考同步。

- 2026-08-06: **click_save 非白名单 toast 被静默丢弃后误判失败**（实锤：交易 35 保存成功 toast「已提交创建！保存的客户，客户状态为【信贷正式客户】」无「成功」关键词，agent 连续点击保存 3 次）。toast 分类改为 fail 优先、其余默认 success；无 toast/校验/跳转反馈时降级为 `_ok` 提示 agent 自行二次确认，不再机械重试。
  影响范围：表单填写 agent（click_save 判定）
  文件：scripts/actions/_form.py, scripts/actions/_js_snippets.py, scripts/characterization/characterize-save-toast.mjs
  Python 同步提示：无强 schema 变更；纯 agent 运行时逻辑，Python 控制面若有独立镜像的 click_save 判定逻辑可参考同步。

- 2026-08-05: **导航阶段被【业务数据】误判为 form_fill 导致越界**（实锤：阶段「点击客户管理…抵达对公客户管理页面」却继续新增/保存/引入）。根因：每阶段挂业务数据 boilerplate 含「填写」，且「引入」关键值污染 classify；`抵达…页面` 未进 open_page 规则。修复：① classify/boundary/intent **先剥离【业务数据】**；② **仅填表/修改/引入**阶段注入业务数据（analyze append + record/start + Python hint）；③ open_page 支持「抵达/到达」。
  影响范围：阶段边界、录制注入、analyze phase 附文。
  文件：scripts/actions/_phase_context.py, _phase_boundary.py, _phase_intent.py, scripts/session_runner.py, src/services/trajectory-meta-service.js, src/services/trajectory-record-lifecycle.js
  Python 同步提示：对齐「业务数据仅填表/引入阶段注入；分类忽略业务数据后缀」。

- 2026-08-05: 案例数据注入链路二次修复（实锤：交易 35 重录后模型仍未拿到案例数据——phase 描述无【业务场景案例数据】块、case_data_entry 0 条、preamble 无【预设案例数据】）：① **恢复 `prepareCaseDataInjection` 调用**（V2.2 停用注释残留 `const caseData = null`，函数实现此前已恢复但调用点未恢复，案例数据从未注入）；② **task 兜底解析**：case_data_entry 为空时从 `trajectory.task` 的「关键数据」段规则解析（`extractCaseEntriesFromRequirement`）→ 落库 case_data_entry + 摄取 memory_fact（requirement/authoritative）→ 注入 Python store。不依赖前端透传 analyze caseEntries（外部 Vue 仓库未透传，Node 侧兜底保证权威值可达模型）。端到端验证：交易 35 task → `{"法定责任人引入":"朱桂武"}` 注入 + 落库 + 摄取全过。
  影响范围：录制注入链路（startTrajectoryRecording 的 case_data 准备）。
  文件：src/services/trajectory-record-lifecycle.js
  Python 同步提示：无强 schema；Python 控制面如镜像录制，可对齐「task 关键数据段 → 案例 KV 注入」语义。

- 2026-08-05: 案例数据「引入」类解析 + 注入链路修复（实锤：交易 35 需求"法定责任人引入 朱桂武"无冒号分隔，KV 解析不出 → 模型在客户放大镜反复用主表单值"测试科技发展有限公司"查询致循环）：① `extractCaseEntriesFromRequirement` 支持无冒号「引入」类格式（`法定责任人引入 朱桂武` / `引入 朱桂武` → KV）；② 修复 analyze 返回 `caseEntries` 误传 raw 文本块（`normalizeCaseEntries` 对非数组返回 []，P1 落库/摄取实际未生效）——改为 KV 数组；③ 恢复 `prepareCaseDataInjection`：case_data_entry KV 注入 Python store → preamble【预设案例数据】hint 生效，放大镜查询/填表优先权威值。
  影响范围：analyze API 返回、轨迹创建/录制注入、案例数据解析。
  文件：src/services/trajectory-meta-service.js, src/services/trajectory-record-lifecycle.js
  Python 同步提示：无强 schema；Python 控制面如镜像 analyze，可对齐「引入」类 KV 解析与 case_data 注入语义。

- 2026-08-05: 录制事件断线静默丢失（实锤：交易 35 只录到 step 127，Python `_ACTION_LOG` 已到 251——控制面/WS 断线后 executor `ws.send` 在 `readyState!==OPEN` 时 return false 静默丢弃，Python 子进程继续执行，后续动作/截图/phase_done 全部丢失，前端只显示到"实际控制企业证件号码"）。修复：① executor ws-client **断线缓冲**（`send` 断线入队，上限 32MB，溢出丢最旧+告警），重连注册成功后**按序重放**（`flushPending`）；② **断线超时看门狗**（`EXECUTOR_DISCONNECT_TIMEOUT_MS` 默认 30s，可配）：超时未恢复 → 杀全部 Python 会话（`killTree`）——宁可明确失败，不静默丢数据；重连成功即清除看门狗。覆盖短暂断线（缓冲重放，数据不丢）与长断线/控制面重启（杀会话，明确失败）两个场景。
  影响范围：executor 进程（ws-client / agent / config）。
  文件：executor/ws-client.js, executor/agent.mjs, executor/config.js, config/.env.example
  Python 同步提示：无（executor Node 侧）。

- 2026-08-06: **WS 半开连接静默丢事件完整修复**（实锤场景：100+ 表单项长阶段内表单填写助手一次 LLM 批量生成（`_llm_values.py` invoke）数十秒无 stdout → WS 空闲被 NAT/LB 静默掐断，executor `readyState` 仍 OPEN，事件进内核黑洞——不发送成功、不进断线缓冲、无任何报错；表单助手填表动作无法入库）。三层修复：
  ① **executor 主动侦测半开**：`EXECUTOR_HEARTBEAT_ACK_TIMEOUT_MS`（默认 40000 = 2×心跳间隔）未收到 `executor.heartbeat.ack` → console.error 明确报错 + `ws.terminate()` 强制触发 close → 复用断线缓冲/看门狗/重连路径，事件不再进黑洞；
  ② **服务端心跳加速 + 断线可见**：`src/executor-ws.js` ping 周期 30s → 10s（感知窗口缩到 ~10–20s），pong 缺失 terminate 时输出 `[executor-ws] half-open detected, terminated <nodeUuid>`（此前静默）；
  ③ **重连后快照补拉（恢复断线窗口数据）**：executor 重连注册成功后若断过线，对全部活跃 session 触发 `get_action_log`；`relayAgentEvent` 把 `get_action_log_result`（_ACTION_LOG 全量快照）同时以 `action_log_sync` 上送，控制面 `trajectory-record-lifecycle` 的 `persistedActionIds` 幂等消费**自动补写缺失步骤、不重复**；并发 `action_resync` 事件 → 控制面旁路落 `memory_event(connection_resync)` 审计（sessionId 自动关联 trajectory_id）。
  ④ **表单批量占位事件（源头缓解）**：`AI_FORM_BATCH_HEARTBEAT`（默认 on）——`_llm_values.py` 批量生成前发 `form_batch_started`、成功/异常两路径发 `form_batch_done`，LLM 长调用期间事件流不再静默。
  影响范围：executor 进程、控制面 WS、Python 表单值生成；无 schema 变更、无新依赖。
  文件：executor/ws-client.js, executor/agent.mjs, executor/config.js, executor/session-handler.js, executor/.env.example, src/executor-ws.js, scripts/actions/_llm_values.py, scripts/feature_flags.py, config/.env.example, scripts/smoke/smoke-executor-halfopen.mjs（新）, scripts/smoke/smoke-resync-log.mjs（新）
  Python 同步提示：对齐 `AI_FORM_BATCH_HEARTBEAT` 开关与 form_batch_started/done 事件（若 Python 控制面镜像表单助手）；executor/WS 侧为 Node 独有。

### Added

- 2026-08-06: 记忆 **P2-4 多模型对比报告**：`GET /api/v2/memory/compare?trajectoryIds=1,2,3` 对已录制交易汇总步骤数 / 成功状态 / 审计通过率 / 填表值一致性。formValues 仅 `source∈{llm,page,rule,agent,observer}`；consistency 用 entity **并集**分母（缺字段=不一致）；全部缺失 404、≥1 条 200、<2 条 `consistency=null`。无 token 字段（用 passRate + isSuccessful 代理）。烟测 `smoke-memory-compare.mjs` 19/19。
  影响范围：记忆 API / api-docs；不写库、不改 schema。
  文件：src/memory/memory-dao.js, src/memory/memory-service.js, src/routes/v2/memory.js, src/dashboard/api-docs/catalog.js, scripts/smoke/smoke-memory-compare.mjs
  Python 同步提示：对齐 `GET /api/v2/memory/compare` 响应契约（trajectories + consistency + missingIds）。

- 2026-08-05: 记忆 **P2-2 跨交易复用**：`POST /api/v2/memory/retrieve` 接受 `functionId`；`AI_MEMORY_HISTORY=true` 时，并入同 `function_id` 历史成功交易（`is_successful=1`，排除本交易，取最近 5 条）的当前版本事实——标记 `source=history, stance=inferred, weight×0.5`，排序自然靠后，**绝不覆盖本交易 requirement 事实**、不参与冲突 supersede。`protocol.js` 新增 `history` 到 FACT/EVENT sources；`weight-engine` 基准 0.4；`config` 新增 `AI_MEMORY_HISTORY`（默认 false）。录制链路 `trajectory-record-lifecycle` 传 `trajRow.functionId`。烟测：`scripts/smoke/smoke-memory-history.mjs`（子进程验证开关三态，12/12）。
  影响范围：Fact Pack 检索 / 录制阶段注入；向后兼容（不传 functionId 或开关关闭时行为不变）。
  文件：src/memory/protocol.js, src/memory/weight-engine.js, src/memory/memory-dao.js, src/memory/memory-service.js, src/routes/v2/memory.js, src/services/trajectory-record-lifecycle.js, config/config.js, config/.env.example, src/dashboard/api-docs/catalog.js, scripts/smoke/smoke-memory-history.mjs
  Python 同步提示：无 schema；对齐 retrieve 接受 functionId + AI_MEMORY_HISTORY 开关。

- 2026-08-05: 记忆 **P2-1 审计产品化**：① 决策覆盖扩展——`scenario_summary` LLM 摘要写 `decision_record`；回放自愈（healType step/form_structure）发起时记 `decisionType:'heal'`（确定性指令模板，model 留空）；**agent_step 决策不做**。② 决策详情回填——`GET /api/v2/memory/decisions/:id` 新增 `inputFacts`（按 `inputFactIds` 查 `memory_fact`，含被 supersede 版本）；`memory-service.ingestEvents` 在决策与事实同事件上报且未传 `inputFactIds` 时自动回填同事件事实 id。③ 审计汇总——`GET /api/v2/memory/audit/summary` 新增 `topReferencedFacts`（仅按 trajectoryId 聚合 Top10）。④ api-docs 补齐缺失的 memory 分组及新字段示例。
  影响范围：记忆决策 API / 审计汇总 / api-docs；外部 Vue 审计页据此渲染。
  文件：scripts/actions/_scenario_describer.py, src/services/trajectory-session-replay.js, src/memory/memory-dao.js, src/memory/memory-service.js, src/dashboard/api-docs/catalog.js
  Python 同步提示：无强 schema；对齐 decisions/:id 响应新增 inputFacts、audit/summary 新增 topReferencedFacts；decision 未传 inputFactIds 时自动回填同事件 facts。

- 2026-08-05: 新建 **system_ref_data / system_ref_entry**（方案 C：旧 `case_data` / `case_data_entry` 保留并标 legacy）。专存目标系统回写、经校验可复用的填表参考值（`source` / `verification_status`）；用户需求**业务数据**仍走 `trajectory.task`【业务数据】块，**禁止**把 analyze/`caseEntries` 写入 system_ref。本迭代提供 CRUD API 地基，录制暂不自动注入 system_ref。
  影响范围：MySQL schema、v2 API、api-docs。
  文件：migrations/20260805220000_system_ref_data.js, schemas/init.sql, src/dao/system-ref-dao.js, src/services/system-ref-service.js, src/routes/v2/system-ref-data.js, src/routes/v2/__init__.js, src/dashboard/api-docs/catalog.js, src/models/entities.js
  Python 同步提示：对齐新表 schema + `/api/v2/system-ref-data`、`/api/v2/trajectories/:id/system-ref-entries`；业务数据与系统参考值用语勿混。

- 2026-08-05: 记忆 P1 收尾：① **权重引擎完整版**（weight-engine.js）：时间衰减 `recencyFactor`（半衰期默认 1h，检索时动态计算）+ 冲突惩罚（superseded ×0.6）+ `computeWeight` 完整公式；摄取时**冲突版本化**——同 (trajectory, entity, attribute) 新值取代旧值：旧值 `superseded_by` + `disputed`（审计保留），新值 `version=旧.version+1`；检索按 `effectiveWeight`（存储权重×衰减）排序，Fact Pack 带出有效权重（Python fact_pack 同步读取）。② **action 打点 + `fill_before_save` 建模**：`writer.emit_memory_event` 支持 `facts` 参数；recorder 每步上报 `action` 事件（填写动作 label → `filled` 事实）；`phase_done` 补 `outcome` 事实；Node 摄取 phase_done 时对同阶段 filled 字段 × outcome 建 `fill_before_save` 关系（strength 1.0）。
  影响范围：记忆摄取（冲突/关系建模）、检索排序、Python agent 打点。
  文件：src/memory/weight-engine.js, src/memory/memory-dao.js, src/memory/memory-service.js, src/memory/fact-pack.js, src/memory/protocol.js, scripts/memory/writer.py, scripts/memory/fact_pack.py, scripts/recorder.py
  Python 同步提示：无强 schema；Python 控制面如镜像摄取，对齐冲突版本化（superseded_by/disputed/version）与 fill_before_save 关系语义。

- 2026-08-05: 记忆 P1——**analyze 结构化案例数据摄取**：`analyzeRequirementToPhases` 恢复返回结构化 KV（`caseEntries`，复用已有 `extractCaseDataBlock` 规则解析，非 LLM 拆解）；`createTransactionWithPhases` / `setTrajectoryCaseEntries` 落 case_data_entry 后同步摄取 `memory_fact`——`source=requirement`（新加入 EVENT/FACT_SOURCES）、`stance=authoritative`、权重 1.5（base 1.0 × stance 1.5），不可被 LLM 覆盖；空值/空白 label 过滤（与 extractCaseDataBlock 对齐）。配合已就位的事实包注入，模型填表优先采用需求里的权威值。
  影响范围：analyze API 返回（新增 caseEntries 非空）、轨迹创建/案例数据更新、记忆摄取、事实包内容。
  文件：src/services/trajectory-meta-service.js, src/memory/memory-service.js, src/memory/protocol.js
  Python 同步提示：无强 schema；Python 控制面如镜像 analyze，可对齐「案例数据 → 权威事实」语义（requirement/authoritative）。

- 2026-08-05: 记忆 P1 全量第一块：① **ContextCompiler v1**（`scripts/context_compiler.py`）：消息窗口裁剪逻辑从 `patch_message_manager` 内联抽取，每次裁剪产出结构化丢弃明细（index/role/preview），随 `context_drop` 事件上报（dropped_items），丢弃可见可审计；`AI_MEMORY_MAX_RECENT` 可配（默认 16 保持旧行为），compiler 异常回退旧内联逻辑。② **表单值决策记录**：`_llm_values.py` LLM 生成（成功/异常两条路径）写 `decision_record(form_value)`——记录模型、温度、输入字段、prompt 预览、输出 actions、parse 策略校验、audit_status；`writer.emit_memory_event` 扩展 `decision` 字段透传。回答「这个测试值是谁、依据什么生成的」。
  影响范围：Python agent 上下文管理 + 表单值生成、记忆摄取（决策类型 form_value 已有）。
  文件：scripts/context_compiler.py（新增）, scripts/agent_utils.py, scripts/actions/_llm_values.py, scripts/memory/writer.py
  Python 同步提示：无强 schema；Python 控制面如镜像决策摄取，事件内嵌 decision 对象即可落 decision_record。

- 2026-08-05: 记忆 P1 最小切片——**事实包注入**（`AI_MEMORY_FACT_PACK` 默认关，opt-in）：phase 开始前 Node 按 trajectory_id 检索 `memory_fact`（`retrieveFactPack`，含 P0 无归属 NULL 阶段事实），随 step 指令透传 `fact_pack` + `trajectory_id`（lifecycle → forwardStdin → session-handler → Python）；Python 在 preamble 后追加【记忆事实包】块（`scripts/memory/fact_pack.py` 格式化，权威值/已保存值带 stance/source/weight），替代「靠 MAX_RECENT 截断记忆猜」。另修复 `case_saved` 事件补传 `phase_number`（否则事实包按阶段检索不到），`listFacts` 放宽为「匹配阶段或 NULL」。
  影响范围：AI 录制链路（Node step 指令 + Python preamble）、记忆检索、feature flag、api-docs 无变更。
  文件：src/services/trajectory-record-lifecycle.js, src/executor-session-client.js, executor/session-handler.js, src/memory/memory-dao.js, scripts/session_runner.py, scripts/actions/_case_data.py, scripts/memory/fact_pack.py
  Python 同步提示：无强 schema；Python 控制面如镜像录制链路，step 指令需透传 trajectory_id / fact_pack，事件上报带 phase_number。

### Changed

- 2026-08-05: 步骤日志改为**每步一行紧凑格式**：`[step N] done=yes/no stopped=yes/no | goal=…(≤100字) | act=…(≤200字) | res=…(≤120字) err=…`——统一前缀可 grep，goal/actions/result 全截断防刷屏（此前 `[on_step_end]/[next_goal]/[actions]/[last_result]` 四行无前缀输出，`get_page_state` 长 JSON 每次全量刷屏）。完整 tool 结果仍在模型上下文内，日志侧只留关键信号。
  影响范围：Python agent stderr 日志。
  文件：scripts/recorder.py
  Python 同步提示：无（仅 JS-gen scripts）。

- 2026-08-05: 移除 `recorder.py` on_step_start 的逐步 `[on_step_start] n_steps=N` 冗余日志（每步刷屏，无信息增量；on_step_end 的状态日志与 5 步节流的 `[recorder] step N done` 保留）。
  影响范围：Python agent stderr 日志。
  文件：scripts/recorder.py
  Python 同步提示：无（仅 JS-gen scripts）。

- 2026-08-05: 文档修订：Codex × 浏览器 MCP 集成计划（v1.1）对内驱动由 chrome-devtools-mcp 改为 **Playwright MCP 为主**（`--cdp-endpoint` 附着现有 CDP 端口、a11y 快照、`browser_run_code` 执行现有 CTRL helpers、testing 断言做边界证据），chrome-devtools-mcp 降级为可选深度诊断；新增三个产品痛点（弹窗循环 / 任务边界漂移 / 人工辅助依赖）的方案归属——前两者主战场在记忆系统 P1 + 阶段边界合约，驱动层只提供确定性快照与断言证据。灰度测试开发计划同步更新（开关 `AI_MCP_PLAYWRIGHT_URL` / `AI_MCP_PLAYWRIGHT_CAPS`、`AGENT_DRIVER=playwright-mcp|browser-use`、P1 任务与矩阵）。
  影响范围：设计文档（未改动代码）。
  文件：docs/JS-gen学习Codex与ChromeDevTools集成计划.md, docs/JS-gen灰度测试开发计划.md
  Python 同步提示：无（纯文档）。Playwright MCP 接入后 Python 侧 session_runner 的 CDP 端口分配不变，agent 驱动切换在 Node 侧。

### Fixed

- 2026-08-05: 明确区分 **业务数据** vs **案例数据**：前者是用户需求里要使用的关键/场景说明（相对结构化 NL，容忍偏差，原文给 AI 判断）；后者是系统回写、由本项目落库的录制产物（`save_case_data` / form snapshot / case_data 表）。历史符号 `case_data_block` 等常承载业务数据，注释已标明勿混用。同步将 agent 提示头 /api-docs 改为【业务数据】。
  影响范围：设计口径 / agent preamble /api-docs / 工程师注释。
  文件：src/services/trajectory-record-lifecycle.js, src/services/trajectory-meta-service.js, scripts/actions/_case_data.py, scripts/session_runner.py, scripts/prompts/agent-prompt.md, src/dashboard/api-docs/catalog.js
  Python 同步提示：对齐「业务数据=用户需求；案例数据=系统回写」用语，避免文档/接口混称。

- 2026-08-05: 案例数据改为**原文提示给 AI 自行判断**，不再用 fieldKey↔表单 label 硬匹配驱动 autofill/`match_form_rule`（修复「法定责任人引入 朱桂武」注入后放大镜仍查主表「客户名称」的错配）。record/start 抽取 `case_data_block` 写入 phase instruction + Python `_case_scenario_text`；KV 仍可选透传供 `read_case_data`。设计前提：用户需求里的关键数据多为相对结构化表述（如「引入 / 法定责任人引入 朱桂武」），无法也不应要求严格 KV，需容忍措辞偏差——已在 lifecycle / `_case_data.py` / meta-service 注释写明。
  影响范围：录制注入、agent preamble、autofill。
  文件：src/services/trajectory-record-lifecycle.js, src/executor-session-client.js, executor/session-handler.js, scripts/actions/_case_data.py, scripts/actions/_form.py, scripts/session_runner.py, src/services/trajectory-meta-service.js
  Python 同步提示：step 指令可透传 case_data_block；勿再依赖 label 硬匹配灌值。

- 2026-08-05: 人工录制开/关：执行机未连接时 `forwardStdin` 改为明确 503；`manual_record_status` ack 等待 8s 后乐观回落，避免 HTTP 长时间挂起。Vue 侧 `manual-record` / `record/stop` / `detach` / `stream/detach` 显式加长超时。
  影响范围：manual-record API、产品前端录制超时。
  文件：src/services/trajectory-record-lifecycle.js（Vue 在 ui-auto-recording-agent-vue-master）
  Python 同步提示：可选对齐 manual-record ack 短等+乐观回落（无强 schema）。

- 2026-08-05: 记忆系统 P0 摄取层两处数据 bug（冒烟脚本实测暴露）：① `normalizeDecision` 的 `policyChecks` / `outputJson` / `finalAction` 未显式序列化——mysql2 会把数组参数展开为多值，`decision_record` 插入报 `Column count doesn't match value count`；现统一 `toJsonString` 序列化。② 多行 `INSERT` 仅返回单 insertId——`insertFacts` 返回值长度被当作事实计数（少计）且 `co_occur` 关系因 `ids[1]=undefined` 静默丢失；新增 `factIdsByEvent` 按 event_id 回查真实 id，关系建模基于真实 id。新增冒烟脚本 `scripts/smoke/smoke-memory-ingest.mjs`（摄取→检索→审计→统计→清理，23 项断言全过）。
  影响范围：记忆系统摄取（Node service/dao）、冒烟验证。
  文件：src/memory/memory-service.js, src/memory/memory-dao.js, scripts/smoke/smoke-memory-ingest.mjs
  Python 同步提示：无强 schema；Python 控制面如镜像决策摄取，注意 policy_checks 等 JSON 列需序列化后传输。

- 2026-08-05: `select_option` check 模式在 label 未匹配时无条件取**第一个可见 select** 的当前值（常是分页器 `10条/页`），误导模型跳过真实字段（自愈日志实锤：`ok-already:10条/页`）。现 fallback 仅认可 placeholder 或所属 form-item label 关联目标 label 的 select，否则返回 `not-found` → 走 `label-not-found` 报错。修复自愈链路 `select_option 模型名称/first` 错配为分页器。
  影响范围：Python agent 表单动作（select_option / check / replay fallback）。
  文件：scripts/actions/_js_snippets.py
  Python 同步提示：无（仅 JS-gen scripts 内嵌 JS 片段）。

- 2026-08-05: 无进展循环止损（自愈日志实锤：`get_page_state` 连发 3 次空转至 max_steps 后需人工）。`recorder.py` 指纹映射新增只读动作（`get_page_state` / `check_field_value` / `scan_form_fields` / `get_pending_tasks`），heal 模式新增「连续 ≥3 次相同只读动作 → 停止」检测（原 heal 分支完全跳过周期检测）。非 heal 模式的只读动作循环亦可被 cycle detect 捕获。
  影响范围：Python 录制/自愈止损。
  文件：scripts/recorder.py
  Python 同步提示：无（仅 JS-gen scripts）。

- 2026-08-05: `close_dialog` 回放幂等化：录制语义为「确保弹窗关闭」，回放时若前置动作（确定/下一步）已关掉弹窗/抽屉/message-box，不再报 `click-failed:not-found` 触发无效自愈，直接返回 `ok (no visible dialog/drawer — already closed)`。可见性检测用 offsetParent + getBoundingClientRect 兜底（对齐固定定位 drawer）。
  影响范围：live replay（scripts）。
  文件：scripts/actions/_replay.py
  Python 同步提示：无（仅 JS-gen scripts）。

- 2026-08-05: 记忆系统 P0 阻断项修复：`scripts/session_runner.py` 中 `from scripts.memory.writer import (` 首行丢失导致 IndentationError，且 `configure_memory_writer(session_id=session_id, …)` 在 `session_id` 赋值前调用（运行期 NameError）。现导入语句完整、`session_id` 先赋值再 configure；`recorder.py` 501 行 f-string 为单行无语法问题。Python 侧 9 个记忆相关文件 AST 全部通过，writer/store/fact_pack/feature_flags 导入验证通过。
  影响范围：Python agent 记忆旁路（P0，只写不读）。
  文件：scripts/session_runner.py
  Python 同步提示：无（仅 JS-gen scripts）。


- 2026-08-05: 「客户名称搜索为…，点击下一步」误判为 query（强制点查询收口）；现含「下一步/上一步」时退出 query，boundary `role=navigate` + 向导 hint；表单动词（新增/填写/修改…）优先于 wizard 关键词，向导表单步仍按 maintain 录制。
  影响范围：scripts 阶段分类 / agent preamble。
  文件：scripts/actions/_phase_context.py, scripts/actions/_phase_boundary.py, scripts/session_runner.py
  Python 同步提示：无（仅 Python 子进程 scripts）。

- 2026-08-05: 「点击评级申请。预期结果：打开…页面」类阶段此前为 `other` 无收口 cue，AI 打开页面后继续把弹窗流程走完；现识别为 boundary `role=navigate`（goal `open_page`）+【打开页面/导航】hint：页面/弹窗出现即 done，禁止在新页面内继续操作；agent-prompt 任务类型表与完成规则同步。
  影响范围：scripts 阶段分类 / agent preamble / agent prompt。
  文件：scripts/actions/_phase_context.py, scripts/actions/_phase_boundary.py, scripts/prompts/agent-prompt.md
  Python 同步提示：无（仅 Python 子进程 scripts）。

### Changed

- 2026-08-05: 稳健相对 xpath：录制生成不再写 dialog `[last()]`；树节点剥 `(n)`/`[V-x]` + 可选 parent_text；图标优先 `el-icon-*` class（tip 文案入 params）；无 label 时 placeholder 锚点。回放侧对旧 `[last()]` 改解析为最后可见 dialog/drawer，树/按钮全去空格匹配，图标 class+tooltip。
  影响范围：locator-candidates / inspect / live replay（scripts）/ api-docs 合同文案。
  文件：src/cdp/locator-candidates.js, src/cdp/inspect.js, scripts/actions/_replay.py, scripts/actions/_js_snippets.py, scripts/actions/_locator_helpers_js.py, src/dashboard/api-docs/catalog.js
  Python 同步提示：无强 schema；若 Python 控制面有 xpath_smart 生成/回放，对齐可见 dialog、树剥后缀、图标 class+tip、placeholder 兜底。

### Added

- 2026-08-05: AI 录制 **阶段边界合约**（`AI_PHASE_BOUNDARY` 默认 on，opt-out）：role/goals/证据收口替代散落 if；混合「新增+完成引入」须引入证据+保存证据；picker 确认写 `picker_closed` 并父 container `_form_stale` 重扫；`_task_lists_by_container` 按 `JS_IDENTIFY_CONTAINER` 分存；录制 `events[]` / SSE 含 `phase_boundary_obs`。
  影响范围：scripts 录制语义、record-lifecycle events、api-docs、feature flag。
  文件：scripts/actions/_phase_boundary.py, scripts/actions/_phase_intent.py, scripts/actions/_form.py, scripts/actions/_misc.py, scripts/feature_flags.py, scripts/session_runner.py, src/services/trajectory-record-lifecycle.js, src/dashboard/api-docs/catalog.js
  Python 同步提示：无强 schema；可选对齐 AI_PHASE_BOUNDARY 与 phase_boundary_obs 事件（不入 MySQL）。

- 2026-08-05: P1 干预通道清理：移除 `request_intervention` / `intervention_needed` SSE 与 STDIN `intervene` 映射；prompt 改为特殊元素 + `click_adjacent_button` + 人工录制；browser-session 转发 `phase_intent_obs` / `phase_boundary_obs`；case_data 跳过键对齐 phase 内部状态。
  影响范围：工程 session SSE、executor stdin 映射、case_data 持久化过滤、element locator 豁免表。
  文件：src/routes/browser-session/session-message.js, src/services/case-data-service.js, src/models/element.js, src/executor-session-client.js, scripts/prompts/*, scripts/actions/_scenario_describer.py
  Python 同步提示：不再发送/处理 `session.intervene` stdin；SSE 移除 intervention_* 事件；可选订阅 phase_intent_obs / phase_boundary_obs。

### Fixed

- 2026-08-05: create 阶段内客户放大镜「确认」死锁：`use-click-save` 禁索引确认，同时 `click_save(确认)` 被 query-toolbar 判为 not-form-save。现 picker UI 允许索引确认；query UI 上 `click_save(确认/确定)` 走引入确认；auto-fill 对 disabled+button 优先特殊元素/引入而非先 click_save。
  影响范围：Python agent actions（_misc / _form / _phase_intent）。
  文件：scripts/actions/_misc.py, scripts/actions/_form.py, scripts/actions/_phase_intent.py
  Python 同步提示：无（scripts 不迁）。

- 2026-08-04: 录制 `session.step` 透传丢弃 `special_element_candidates` / `prior_phases`，导致 agent 日志 `special_element_candidates loaded: 0`（库内已有「对公客户引入流程」仍无法 `use_special_element`）。`forwardStdin` + executor `session.step` 现完整转发。
  影响范围：executor WS 载荷、录制 step 注入。
  文件：src/executor-session-client.js, executor/session-handler.js, src/services/trajectory-record-lifecycle.js
  Python 同步提示：对齐 session.step 可选字段 specialElementCandidates、priorPhases（蛇形 special_element_candidates / prior_phases 亦可）。

- 2026-08-04: 阶段意图合约将「新增…如果出现引入按钮…」误判为 `introduce_pick`（`force_refill_all=False`）；现 create/modify 优先，纯引入阶段仍为 `introduce_pick`。另：`_query_ui` 不再跨弹窗粘性（放大镜关闭后可再 `click_save`）。特殊元素搜索归一「法定责任人/代表人」并加强引入语义加权。
  影响范围：Python agent 合约 / form 查询栏检测；搜索评分（控制面）。
  文件：scripts/actions/_phase_intent.py, scripts/actions/_form.py, scripts/actions/_phase_context.py, src/services/special-element-search-service.js, scripts/characterization/*
  Python 同步提示：无强 schema；若 Python 控制面有同名合约编译，对齐 introduce 不覆盖 create 的优先级。

### Added

- 2026-08-04: WS `remote:input` 文档化；`kind:'text'` 支持可选 `replace:true`（选中 activeElement 后 insertText，空 text 清空）。便于 SPA 透明 input IME 透传（中文 composition 在本机完成，确认后下发 text；控制键仍走 kind:key）。
  影响范围：WS 契约、CDP bridge（local + executor）、api-docs。
  文件：src/cdp/remote-bridge.js, executor/bib-bridge.js, src/dashboard/api-docs/catalog.js
  Python 同步提示：对齐 remote:input payload.replace；文档约定 IME 在 SPA 完成；控制面透传语义不变。

- 2026-08-04: `POST /api/v2/trajectories/:id/steps/replay/stop` — 用户可中断进行中的 steps/replay 自愈（Type A/B）；WS `replay:finished` 增加 `aborted`/`reason`（主动停止时 `error:null`）。
  影响范围：route、service（session-replay）、runtime flag、WS 契约、api-docs。
  文件：src/routes/v2/trajectory.js, src/services/trajectory-session-replay.js, src/services/trajectory-runtime.js, src/services/trajectory-recording-service.js, src/services/trajectory-service.js, src/dashboard/api-docs/catalog.js
  Python 同步提示：对齐新路由 POST .../steps/replay/stop；WS replay:finished 增加 aborted/reason 字段。

- 2026-08-04: 表单结构变化自愈（Type B）：`form_snapshot.trigger_step_id` 绑定 checkpoint `trajectory_step`；live 录制双写；`steps/replay` 遇 `save_form_snapshot` 校验结构并删 missing / 结构化插入 adding；WS `replay:form_structure` + `healType`。
  影响范围：schema、service（persist / session-replay / step）、WS 契约、api-docs。
  文件：migrations/20260804010000_form_snapshot_trigger_step.js, schemas/init.sql, src/dao/form-snapshot-dao.js, src/services/trajectory-persist-service.js, src/services/trajectory-session-replay.js, src/services/trajectory-step-service.js, src/routes/browser-session/heal-instruction.js, src/dashboard/api-docs/catalog.js
  Python 同步提示：同步 sql/init.sql 增加 form_snapshot.trigger_step_id（FK CASCADE UNIQUE）并将 trajectory_id 改为 ON DELETE CASCADE；对齐 WS replay:form_structure 与 healType 字段。

### Fixed

- 2026-08-04: 执行机 agent 在 `ready` 前崩溃后 slot 变成幽灵占用（`sessionId` 未清，下一次落到更高 slot）。现失败 open / process_exit 回收槽位，`_findFreeSlot` 也会回收无活进程的 ghost。
  影响范围：executor slot 生命周期。
  文件：executor/session-slot.js, executor/session-manager.js
  Python 同步提示：无（执行机本地；控制面 lease 本就不 confirm 未 ready 的会话）。

- 2026-08-04: BiB 默认视口/推流改为 **1600×900 / quality≈65**（相对 1080p 更流畅，相对 720p 显示更全）；去掉编码强制抬到 1080p，编码跟视口走（上限仍 1920×1080）；Chrome 不自动最大化。
  影响范围：executor bib-bridge、local remote-bridge、remote-session 默认值、prepare attach、session_runner 窗口、api-docs。
  文件：executor/bib-bridge.js, src/cdp/remote-bridge.js, src/services/remote-session-service.js, src/services/trajectory-attach-service.js, scripts/session_runner.py, src/dashboard/api-docs/catalog.js
  Python 同步提示：无（执行机/控制面推流默认；产品画布自适应显示不变）。

- 2026-08-04: `record/prepare` 在无在线执行机时改为 **409** + 中文 `无可用执行资源（没有在线执行机）` + `holders`（与槽位已满同形），避免英文 500 `No executor agent online` 导致前端无法提示。
  影响范围：executor 选节点、api-docs。
  文件：src/executor-slot-lease.js, src/executor-session-client.js, src/dashboard/api-docs/catalog.js
  Python 同步提示：对齐 prepare 无执行机时 409 与中文 message（与无槽位同形）。

- 2026-08-04: 修复 `trajectory.remote_session_id` 脏指针导致「2 个浏览器却显示多笔占用」：挂载时互斥清掉其他交易的同 rs FK；stream detach / close 扫清所有指向该 rs 的交易（live→draft）；启动时 reconcile 修复历史脏数据。
  影响范围：service（remote-session、trajectory-attach、idle-reaper）、dao、server 启动对账。
  文件：src/dao/trajectory-dao.js, src/services/remote-session-service.js, src/services/trajectory-attach-service.js, src/services/trajectory-idle-reaper.js, src/executor-ws.js, server.mjs
  Python 同步提示：无（控制面绑定语义；列表占用以 remote_session.status+trajectory_id 为准）。

- 2026-08-03: 同一 trajectory 重复 `record/prepare` 或控制面重启后，可能残留多条 `active` 的 `remote_session`，`trajectory.remote_session_id` 与 BiB 实际推流 UUID 不一致导致前端黑屏。
  影响范围：service（remote-session、trajectory-attach）、executor-ws 启动恢复。
  文件：src/dao/remote-session-dao.js, src/services/remote-session-service.js, src/services/trajectory-attach-service.js, src/executor-ws.js
  Python 同步提示：无（逻辑在 JS-gen 控制面/执行机桥接层）。
- 2026-08-04: 黑屏修复收紧：`supersede` 仅关闭非当前 agentSession/非 keepId 脏行；prepare 在 session 不匹配时强制 re-attach（不再沿用已关闭的 runtime.remoteSessionId）；`getLiveStatus` 优先 runtime.sessionId 一致的 attached binding 并回写 FK；执行机重连关闭同 traj 旧 active 行。
  影响范围：service（remote-session、trajectory-attach）、executor-ws。
  文件：src/services/remote-session-service.js, src/services/trajectory-attach-service.js, src/executor-ws.js
  Python 同步提示：无。

### Changed

- 2026-08-04: 案例数据 V2.2 口径落地：analyze 将「关键数据/案例数据」原文附到每个 phase（不拆 caseEntries）；`caseEntries` 仍可 POST/PATCH 入库但不注入录制；录制填表靠 phase 文本 + agent prompt 优先对齐场景值，autofill 继续随机补其余字段；报文捞取仅文档占位。
  影响范围：analyze、record/start 注入、api-docs、agent prompt。
  文件：src/services/trajectory-meta-service.js, src/services/trajectory-record-lifecycle.js, src/routes/v2/trajectory.js, src/dashboard/api-docs/catalog.js, scripts/prompts/agent-prompt.md
  Python 同步提示：对齐 agent-prompt 中【业务场景案例数据】优先规则；勿再依赖 record/start 注入 case_data。

- 2026-08-03: `trajectory_step.confirmed` 语义重定义：DEFAULT 0→1，注释"人工确认"→"回放确认"。
  影响范围：schema（DEFAULT + COMMENT）、Python 端 trajectory_step domain。
  文件：migrations/20260803110000_trajectory_step_confirmed_replay.js, migrations/20260803111500_trajectory_step_confirmed_comment.js
  Python 同步提示：更新 sql/init.sql trajectory_step.confirmed DEFAULT 1 + 注释；更新 uara/trajectory/domain/trajectory_step.py 注释 + default=1。

## 条目格式约定

每次修改本项目必追加到 `[Unreleased]` 区段（发版时再剪切到 `[x.y.z] - YYYY-MM-DD`）：

- 一级分类：`Added` / `Changed` / `Deprecated` / `Removed` / `Fixed` / `Security`
- 条目：`- YYYY-MM-DD: <简述>` + 换行 + `  影响范围：<schema/service/controller/WS/scripts/config>` + 换行 + `  文件：<相对路径列表>` + 换行 + `  Python 同步提示：<如适用，说明 Python 端需如何跟进>`

## 强制规则

本项目与 `d:\dev\ui-auto-recording-agent-python`（Python FastAPI 控制面）并行开发。Python 端对齐 JS-gen 的 schema / 接口 / WS 协议。

**涉及以下变更时必须写 CHANGELOG**：

- `migrations/` 新增或修改迁移（schema 变更）
- `src/routes/` 端点新增/删除/改路径/改响应格式
- `src/services/` 业务逻辑变更（影响 Python 对齐语义）
- `server.mjs` WebSocket 协议变更
- `config/` 配置项变更

仅改 `scripts/`（Python 子进程）可不写 CHANGELOG（Python 不迁 scripts）。
