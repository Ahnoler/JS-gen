# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

本文件**只从 2026-08-03 开始记**，之前的 24 个迁移（2026-07-13 ~ 2026-08-02）不回填。
Python 控制面（`d:\dev\ui-auto-recording-agent-python`）以当前 `schemas/init.sql` 为基线对齐，历史迁移视为已同步。

## [Unreleased]

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
