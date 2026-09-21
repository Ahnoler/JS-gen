# 录制状态与执行机资源连接流程（开发者指南）

> 面向后续开发者的流程说明。覆盖：交易 `record_status` 状态机、执行机资源的连接/复用/释放、前端录制页的进入与交互、WS 事件契约、以及需要特别小心的坑。
>
> 最后更新：2026-09-20（对应 JS-gen `uara_V2.0` / 前端另仓 `dev`）。状态流转口径 = **V4**。

## 1. 一句话总览

一个「交易（trajectory）」的录制状态由 `trajectory.record_status` 与 `trajectory.persistent_record_status` 两个字段共同表达；`recording` 是**临时态**，且**唯一含义是「正在录制」**，真正的持久态是 `draft/recorded/completed/failed`。执行机资源（Chrome + Python agent session + 槽位）由后端控制面按交易独占分配，前端只是「观众」，负责报备进出，**是否释放资源由后端决定**。

> **V4（2026-09-20）关键口径**：`recording` 只由 `record/start` 与「人工录制开启」进入；`prepare` 默认不再进入 `recording`；**非用户显式 `record/stop` 的资源释放一律标 `failed(中断)`**（含执行机离线/重启、无观众、空闲回收）。

## 2. 状态模型

### 2.1 字段与枚举

| 字段 | 取值 | 说明 |
|---|---|---|
| `record_status` | `draft` / `recording` / `failed` / `recorded` / `completed` | 对外的当前状态；`recording` 为临时态，仅表示「正在录制」 |
| `persistent_record_status` | `draft` / `recorded` / `completed` / `failed` | 持久基线；进入录制前记录，显式结束/中断时被改写 |

定义位置：`src/models/constants.js`（`TRAJECTORY_RECORD_STATUSES` / `PERSISTENT_RECORD_STATUSES` / `isPersistentRecordStatus` / `resolvePostRecordingStatus:67`）。

### 2.2 核心不变量

1. **`recording` 只由录制动作进入**：`record/start`、`POST /manual-record`（开启）会 `enterTransientRecording`；`prepare` 默认不会。
2. **进入录制前记基线**：`enterTransientRecording` 把当前持久态写入 `persistent_record_status`。
3. **显式结束才按用户选择改写**：`record/stop(success)` → `recorded`；`record/stop(!success)` → `failed`（原因 `user_marked_failed`）。
4. **非显式 stop 的释放一律 `failed(interrupted)`**：关浏览器 / 回收 / 控制面重启 / 执行机离线或重启 / 无观众 / 空闲回收，只要释放时是 `recording`，标 `failed` + `interrupted`，**不再恢复基线**。
5. **`failed_reason`**（`failed_kind/failed_reason/failed_at`）记录本轮首个失败原因（首次为准）；新一次进入录制/成功收官会清空。分类表见 `src/models/failure-reason.js`（V4 新增 kind `interrupted='录制中断'`）。

### 2.3 流转总表

| 触发 | 后端入口 | 状态结果 |
|---|---|---|
| `POST /record/prepare`（默认） | 不进入临时态 | 保持当前持久态不变（仅连资源/推流） |
| `POST /record/prepare`（`preserveRecordStatus=false`） | `enterTransientRecording` | `record_status=recording`，基线=当前持久态 |
| `POST /record/start` | `enterTransientRecording`；若基线=`completed` 先降为 `recorded` | `recording` |
| `POST /record/stop`（success=true） | `finishTransientRecording(tid,'success')` | `recorded`（待确认）；基线=`completed` 时保持 `completed` |
| `POST /record/stop`（success=false） | `finishTransientRecording(tid,'failure')` + `markFailedReason(user_marked_failed)` | `failed`（录制异常） |
| `POST /confirm?confirmed=true` | `setPersistentRecordStatus(tid,'completed')` | `completed`（双字段） |
| 取消确认（`confirmed=false`） | completed → `recorded`；recording → 仅基线回 `recorded` | 见下 |
| `POST /manual-record`（非 recording 状态上开启） | 先 `enterTransientRecording`；基线 `completed`→`recorded` | `recording`，停止/释放后回 `recorded`（需再次确认） |
| `POST /detach` / 回收 / 重启 / 执行机离线 / 无观众 / 空闲回收 | `markRecordingInterrupted` | 释放时处于 `recording` → `failed`（interrupted）；否则保持原状态 |
| `POST /stream/detach` | 不改状态 | **只断画面**，录制可在后台继续（保留 session/槽位） |

### 2.4 关键实现

- `enterTransientRecording`：`src/dao/trajectory-dao.js:439`
- `finishTransientRecording`：`src/dao/trajectory-dao.js:474`
- `restorePersistentRecordStatus`：`src/dao/trajectory-dao.js:539`（**V4 已无生产调用点**，仅兼容保留）
- `resolvePostRecordingStatus`（success→recorded / failure→failed）：`src/models/constants.js:67`
- 人工确认/取消确认：`src/services/trajectory/trajectory-meta-service.js:520`
- prepare 分流 + 录制中非破坏性守卫（`preserveRecordStatus` / `recordingInFlight`）：`src/services/trajectory/trajectory-attach-runner.js:69`、`:77`
- 录制中恢复已有会话：`recoverLiveSessionForTrajectory`：`src/services/trajectory/trajectory-attach-service.js:294`
- 非显式 stop 释放 → `failed(interrupted)`：`markRecordingInterrupted`：`src/services/trajectory/trajectory-attach-service.js:564`
- 人工录制状态收口：`src/services/trajectory/trajectory-manual-record.js:28`
- 重录启动进入 recording：`src/services/trajectory/trajectory-recording-runner.js:448`

## 3. 执行机资源：连接、复用、释放

### 3.1 资源是什么

一个交易同一时间最多占用**一个执行机 session + 一个槽位**：
- **控制面内存**：`trajectoryRuntimeMap`（`src/services/trajectory/trajectory-runtime.js`）按 `trajectoryId` 记录 `sessionId / executorNodeUuid / executorSlotIndex / remoteSessionId`；`state.sessions`（`src/state.js`）按 `sessionId` 记录会话元数据。
- **槽位租约**：`src/executor-slot-lease.js`，key 为 `nodeUuid:slotIndex`，并按 session/trajectory 反查。每个节点容量由 `EXECUTOR_CAPACITY` 决定。
- **BiB（Browser-in-Browser）推流绑定**：`remote_session` 表，1:1 挂到交易（`trajectory.remote_session_id`）。

### 3.2 连接（prepare/attach）怎么复用

`POST /api/v2/trajectories/:id/record/prepare` → `prepareTrajectoryRecording`（交易级锁串行）→ `attachTrajectoryLive`（`trajectory-attach-service.js:361`）：
1. `clearStaleTrajectoryRuntime` 校验已有 runtime 的 session 是否还活着（向执行机 `session.list` 核实），死了就清理。
2. 活着 → **复用**同一 session，必要时重新 attach BiB。
3. 否则 `openSession`（`preferIdleChrome: true`，优先复用执行机上的孤儿 CDP Chrome），登记 runtime、确认槽位租约、建立 BiB。

因此**多个前端页面/多台机器进入同一交易**时，`prepare` 会复用同一个执行机 session（不会各自开一个浏览器）。

### 3.2.1 录制中的非破坏性 prepare（V4 新增）

进入 `recording` 交易页会自动 `prepare`（见 4.1），因此 prepare **绝不能打断在录 agent**。当 `traj.recordStatus === 'recording'` 时：

- **不重新登录**：跳过 prepare-time 默认登录（`emitStage('login','skipped',{reason:'recording_in_flight'})`）。
- **不导航页面**：跳过 `bindRecordingPageId`（它会 `navigateToFunctionMenu` 点菜单 + `read_page_component_code` 可能开弹窗，直接打断录制）。
- **不新开浏览器**：内存 runtime 丢失（控制面重启）时，`recoverLiveSessionForTrajectory` 优先从 DB `remote_session` 恢复已有执行机会话（`registerTrajectorySession` + `confirmLease` + `bindTrajectoryManualPersist` + `restoreLiveBindingFromRow`，并置 `runtime.loginDone=true`）。三分支：
  - `recovered`：复用同一会话（正常连上看画面）；
  - `unreachable`（执行机 `session.list` 失败，无法确认）：返回 **503** 可重试，**绝不新开**；
  - `gone`（执行机可达但会话确不存在）：`markRecordingInterrupted` 标 `failed(中断)` + **409** 明确指引「点『重新录制』」——此时状态已非 `recording`，重录会正常开新会话，避免死锁。

### 3.3 释放的三种语义（务必区分）

| 操作 | 端点 | 效果 |
|---|---|---|
| 结束录制 | `POST /record/stop` | **不释放**执行机、不断流；只改状态 |
| 断流 | `POST /stream/detach` | 只断 BiB，Chrome/Python/slot 保留为 idle 可复用；**不改 record_status** |
| 释放浏览器 | `POST /detach` | 杀 Chrome + Python、释放槽位、删除 runtime；录制中 → `failed(interrupted)` |

`detachTrajectoryLive`：`src/services/trajectory/trajectory-attach-service.js:591`；`detachTrajectoryStream`：`:503`。

### 3.4 观众统计 → 无人观看自动释放（后端主导）

前端每个录制页标签页在进入时注册为「观众」，离开/关闭时注销：

- 服务：`src/services/trajectory/trajectory-viewer-service.js`
  - `enterViewer` / `leaveViewer` / `touchViewer` / `getViewerCount`
  - 心跳间隔 10s、30s 无心跳视为过期（覆盖崩溃/直接关页）
  - **观众数归零后延迟 5s**（`DETACH_GRACE_MS:21`）再释放，用于熬过页面刷新
  - **录制进行中不释放**：`isActivelyRecording`（`:153`）为真时改 15s 后再查（`RECORDING_RECHECK_MS:26`），避免打断录制
  - 期间若有新观众 `enterViewer`，取消排队释放
- 端点（`src/routes/v2/trajectory-record.js`）：`POST /viewers/enter|leave|heartbeat`
- 前端（`vue-project/src/composables/useRecordingStudio.ts`）：
  - `onMounted` **先 `enterViewer` 再 `doPrepare`**（顺序很关键，见第 7 节坑）
  - 路由离开 → `leaveViewer`
  - `beforeunload` → `navigator.sendBeacon` 注销（直接关标签页）

> 注意：观众计数是控制面**内存态**，控制面重启会清零；重启时资源本身也会走恢复链。

### 3.5 空闲回收（兜底）

`src/services/trajectory/trajectory-idle-reaper.js` 每 45s（`TICK_MS:22`）扫描：交易 **2 小时**（`IDLE_MS:21`）无新步骤、且 session 不 busy、不在人工录制中 → 自动 `detachTrajectoryLive(reason='idle')`（录制中 → `failed(interrupted)`）；并清理孤儿的 idle `remote_session`。

> 已知行为：idle-reaper **不感知 viewer 计数**。因此即使有人一直开着 `recorded/failed/completed` 的录制页，2 小时无步骤也会被回收、画面可能断开。若产品要求「页面在场豁免」，需把 `getViewerCount(tid)` 纳入其跳过条件。

### 3.6 执行机离线/重启 → 该节点录制中交易标 failed(interrupted)

执行机 WS 断连 grace 到期（`markOfflineAndCrash`）、周期 `sweepStale`、`unregister` 三条路径在 `crashActiveSessions` **之前**调用 `markNodeRecordingsInterrupted(nodeUuid, nodeId)`（`src/services/executor-node-service.js:54`）：收集该节点上绑定的交易（DB `remote_session.trajectory_id` + 内存 runtime `executorNodeUuid`，覆盖断流后 FK 已清的情况），逐个 `markRecordingInterrupted` → `failed(interrupted)` 并重置 running 阶段。

> 否则执行机中断/重启后，`recording` 交易会永久卡在录制中（`remote_session` 被置 crashed、内存 runtime 被清，却无人改 `record_status`）。
>
> 执行机 grace 内重连：`reconcileRemoteSessions` 对执行机已无的 session 走 `clearOwnershipOnClose` → `clearMountByRemoteSessionId` → `markRecordingInterrupted`。

## 4. 前端录制页流程

页面：`vue-project/src/views/ui-recording/detail/index.vue`（路由 `/ui-recording/detail/:id`，`meta.layout='recording'`）。

### 4.1 进入页面（`useRecordingStudio.onMounted`）

1. 初始化 WS、加载交易/登录上下文/轨迹树/执行机列表。
2. 注册观众 + 启动心跳 + `beforeunload` 注销。
3. 当状态为 **`draft` / `recording`** 时**自动 prepare**：`draft` 首次连资源；`recording` 表示后端已有录制会话在跑（含 batch 静默录制），需要自动连上看画面（由 3.2.1 保证非破坏性）。`failed/recorded/completed` 默认不连执行机，需用户手动点「准备会话」。
4. 启动 10s 轮询（轨迹树 + 执行机列表）。

### 4.2 三个按钮的行为

| 按钮 | 处理 | preserveRecordStatus |
|---|---|---|
| 准备会话 | `handleEnsureStream` → `doPrepare()` | **始终默认 `true`**（只连资源，绝不改状态） |
| 重新录制 | `handleReRecord`：未连接先 `doPrepare({preserveRecordStatus:false})` → 全选阶段 → 清空步骤 → `record/start` | prepare `false`（进入 recording）；`record/start` 再次进入 |
| 关闭浏览器 | `handleDetach` → `doDetach` → `POST /detach` | —（硬释放；录制中 → `failed(interrupted)`） |

> 「准备会话」只负责连资源/推流；进入 `recording` 只由「重新录制」/「开始录制」触发。

### 4.3 画面附着（canvas/WS）+ 残留 attached 自愈

- WS 客户端单例：`vue-project/src/composables/useWsClient.ts`，连 `ws://<host>/ws`，3s 自动重连（最多 20 次）。
- 画布：`vue-project/src/composables/useRemoteCanvas.ts`；`ensureStream` 流程 = 等 WS → 查 `live/status` → 必要时 `attach`（`POST /remote-sessions/attach-live`）→ `remote:subscribe`/`remote:start` → 等首帧（8s 超时）。
- **残留 attached 绑定自愈**：控制面 live 绑定可能残留 `attached:true` 但 BiB 实际已死（`restoreLiveBindingFromRow` 仅按 DB `status='active'` 乐观置位；无 BiB 死亡事件清除）。此时 `ensureStream` 默认拒绝重复 attach（防风暴），会导致永久「未推流」。自愈策略：绑定声称 attached 但连续无新帧时累加 `attachedNoFrameStreak`；达 `FORCE_REATTACH_AFTER(3)` 强制一次真正 `attach-live` 重建 BiB（每个 attach 周期只一次）；达 `GIVE_UP_AFTER(6)` 仍无帧则停止重连并提示重新准备；**仅当 `isWsConnected()` 为真才累计**（长时间断网不触发放弃，恢复后继续重连）。强制重连只复用同一 `sessionId`，不新增执行机资源。
- 组件：`detail/components/RemoteBrowser.vue`（占位文案、工具栏、附着状态）。

## 5. 主要 API 端点

前缀 `/api/v2/trajectories/:id`：

- `POST /record/prepare` body `{ preserveRecordStatus?: boolean }`（**默认 true**；超时 180s）
- `POST /record/start` body `{ phaseIds?: number[], accountId?: number }`
- `POST /record/stop` body `{ success?: boolean }`
- `POST /confirm` body `{ confirmed: boolean }`
- `POST /manual-record` body `{ enabled: boolean, phaseId?: number }`
- `POST /attach` / `POST /detach` / `POST /stream/detach`
- `POST /viewers/enter|leave|heartbeat` body `{ viewerId: string }`

其他相关：`POST /api/v2/remote-sessions/attach-live`（画面附着，复用同一 session，不新开）、`GET /api/v2/remote-sessions/live/status`。

契约唯一来源：`src/dashboard/api-docs/catalog.js`（产品文档 `/api/docs`）。

## 6. WS 事件（前端订阅）

| 事件 | 用途 |
|---|---|
| `recording:prepare` | prepare 四阶段进度（session/browser/stream/login）；录制中 login 阶段为 `skipped`（`reason='recording_in_flight'`） |
| `recording:detached` | 资源释放（含 `reason`、`sessionId`、`recordStatus`） |
| `recording:stream_detached` | 只断画面（保留 session，可重附着；不改状态） |
| `recording:llm_error` | 上游 LLM 网关失败（402/401/429/5xx） |
| `remote:status` / `remote:tabs` | 实况状态 / 地址栏跟随 |
| `action_log_sync` / `action_persisted` / `manual_action_persisted` | 步骤实时同步 |
| `fake_success_detected` | 零步骤假成功降级 |
| `replay:started` / `replay:step` / `replay:finished` | 回放进度 |

## 7. 坑与注意事项（血泪教训）

1. **详情页路由必须用 `:key` 隔离**
   `/ui-recording/detail/:id` 与 `/ui-recording/step-detail/:id` 共用一个组件。若 `Layout.vue` 的 `<router-view>` 不加 `:key`，detail→detail 跳转**复用同一实例**，上一交易的 `prepare/sessionId/remoteSessionId/画布 preferredSessionId` 会泄漏到新交易 → 表现为「进入录制页不连执行机、准备会话无效」。
   修复：录制布局用 `<router-view :key="route.path" />`（`vue-project/src/layouts/Layout.vue`）。新增同类「带参数的路由页面」时请同样处理。
2. **观众注册要早于 prepare**
   `onMounted` 必须先 `enterViewer` 再 `doPrepare`。否则上一次离开排出的「无观众 5s 延迟释放」可能在 prepare 完成后触发，把刚建立的 session 又 detach 掉。
3. **录制中进入页面自动 prepare 必须非破坏性**
   `recording` 状态进入页面会 `prepare`；prepare 绝不能重新登录、不能 `bindRecordingPageId` 导航页面、不能新开浏览器，否则会打断在录 agent（见 3.2.1）。修改 prepare 的登录/导航/attach 逻辑时务必保留 `recordingInFlight` 守卫。
4. **`recording` 是临时态且唯一含义是「正在录制」**
   `record_status==='recording'` 现在可直接表示正在录制；前端 `recordingActive` 仍保留 running 阶段等信号作为内部子状态。
5. **prepare 默认不会进入 `recording` 临时态**
   只有 `record/start` 和人工录制开启才会进入 `recording`；`prepare`（含「准备会话」按钮）只连接资源/推流，保持原持久态不变。
6. **非显式 stop 释放会标 `failed(interrupted)`**
   关浏览器/断网回收/控制面重启/执行机离线/无观众/空闲回收都会把 `recording` 标为 `failed`；不要期待释放后回到原基线（V3 的 restore 语义已废弃，`restorePersistentRecordStatus` 仅兼容保留）。
7. **执行机离线/重启必须标记该节点录制中交易**
   新增/修改执行机断连路径时，必须在 `crashActiveSessions` 之前调用 `markNodeRecordingsInterrupted`，否则会永久卡 `recording`（见 3.6）。
8. **idle-reaper 不感知观众**（见 3.5），长停留场景需注意。
9. **`failed_reason` 迁移与重启**：涉及 `failed_kind/failed_reason/failed_at` 的改动需先跑迁移 `20260918180000_trajectory_failed_reason` 并重启控制面。
10. **画面残留 attached 会永久「未推流」**
    控制面绑定可能残留 `attached:true` 而 BiB 已死；前端 `ensureStream` 默认不再重复 attach。修改附着逻辑时务必保留 `attachedNoFrameStreak` 受限自愈与 WS 守卫（见 4.3）。

## 8. 验证与门禁

- 状态机 characterization：`node scripts/characterization/characterize-record-status.mjs`（含 V4 非显式释放/录制中 prepare 守卫断言）。
- stop 语义：`node scripts/characterization/characterize-stop-semantics.mjs`（A/C/D 三实现与 D 的 `failed(interrupted)`）。
- 执行机断连/孤儿对账：`node scripts/characterization/characterize-executor-orphan-reconcile.mjs`。
- facade/契约：`node scripts/characterization/characterize-trajectory.mjs`。
- 会话生命周期：`node scripts/characterization/characterize-session-lifecycle.mjs`。
- LLM 失败分类：`node scripts/characterization/characterize-agent-llm-error.mjs`。
- 全量门禁：`bash scripts/refactor/verify-all.sh`（含 `npx eslint .`；本机无 bash 时按其他条目口径退化为 `npx eslint src/ executor/ scripts/`）。
- 前端：`cd vue-project && npx vue-tsc --noEmit`。
- 真机联调：控制面 `npm start`（4097）+ 执行机 `npm run executor`；接口文档 `http://localhost:4097/api/docs`。

## 9. 相关历史条目（agent-log）

- 2026-09-18 16:45 · OpenCode：执行机资源连接策略 + 录制状态流转收口 + 后端观众统计（JS-gen `79ee592c` / 前端 `a3d1a55`）
- 2026-09-18 19:38 · OpenCode：修复交易详情页切换串台导致连不上执行机（前端 `8bb8e03`）
- 2026-09-20 · OpenCode：方案 A —— `recording` 仅表示「正在录制」，非显式 stop 释放标 `failed(interrupted)`（JS-gen `78977233` / 前端 `579e140`）
- 2026-09-20 · OpenCode：恢复 `recording` 自动 prepare（修 batch 静默录制无推流）（JS-gen `bf239f03` / 前端 `41797a0`）
- 2026-09-20 · OpenCode：执行机中断/重启后录制中交易标 `failed(interrupted)`，不再永久卡 recording（JS-gen `bc31621d`）
- 2026-09-20 · OpenCode：画面永久「未推流」受限自愈（前端 `76d9ebc` / `c93b5a4` / `9598b04`）
- 2026-09-20 · OpenCode：进入 recording 页自动 prepare 不再重登录/导航/新开会话打断录制（JS-gen `df30e1a9`）
