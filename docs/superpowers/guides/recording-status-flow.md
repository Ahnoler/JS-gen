# 录制状态与执行机资源连接流程（开发者指南）

> 面向后续开发者的流程说明。覆盖：交易 `record_status` 状态机、执行机资源的连接/复用/释放、前端录制页的进入与交互、WS 事件契约、以及需要特别小心的坑。
>
> 最后更新：2026-09-18（对应前端 `uara_V2.0.1` / JS-gen `uara_V2.0.1`）。

## 1. 一句话总览

一个「交易（trajectory）」的录制状态由 `trajectory.record_status` 与 `trajectory.persistent_record_status` 两个字段共同表达；`recording` 是**临时态**，且**唯一含义是「正在录制」**，真正的持久态是 `draft/recorded/completed/failed`。执行机资源（Chrome + Python agent session + 槽位）由后端控制面按交易独占分配，前端只是「观众」，负责报备进出，**是否释放资源由后端决定**。

## 2. 状态模型

### 2.1 字段与枚举

| 字段 | 取值 | 说明 |
|---|---|---|
| `record_status` | `draft` / `recording` / `failed` / `recorded` / `completed` | 对外的当前状态；`recording` 为临时态 |
| `persistent_record_status` | `draft` / `recorded` / `completed` / `failed` | 持久基线；非终结性释放时回落到这里 |

定义位置：`src/models/constants.js:36`（`TRAJECTORY_RECORD_STATUSES`）、`:42`（`PERSISTENT_RECORD_STATUSES`）、`:49`（`isPersistentRecordStatus`）。

### 2.2 核心不变量

1. **`recording` 不覆盖持久态**：进入录制会话前先把当前持久态记入 `persistent_record_status`（基线）。
2. **非终结性释放标为 `failed(interrupted)`**：关浏览器 / 断流 / 回收 / 控制面重启中断 / 无观众 / 空闲回收，只要释放时处于 `recording`，一律标为 `failed`，原因 `interrupted`（录制中断），不再恢复基线。
3. **显式结束才改写持久态**：用户明确「成功结束」→ `recorded`；「失败结束」→ `failed`。
4. **`failed_reason`**（`failed_kind/failed_reason/failed_at`）记录本轮首个失败原因；新一次进入录制/成功收官会清空。

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
| `POST /attach` / `POST /detach` / `POST /stream/detach` / 回收 / 重启 / 无观众 / 空闲回收 | `markRecordingInterrupted` | 若释放时处于 `recording` → `failed`（interrupted），否则保持原状态 |

关键实现：
- `enterTransientRecording`：`src/dao/trajectory-dao.js:424`
- `finishTransientRecording`：`src/dao/trajectory-dao.js:459`
- `markRecordingInterrupted`（非显式 stop 释放 → `failed(interrupted)`）：`src/services/trajectory/trajectory-attach-service.js`
- `resolvePostRecordingStatus`（success→recorded / failure→failed）：`src/models/constants.js:66`
- 人工确认/取消确认：`src/services/trajectory/trajectory-meta-service.js:520`
- prepare 分流（`preserveRecordStatus`）：`src/services/trajectory/trajectory-attach-runner.js:68`、`:224`
- 人工录制状态收口：`src/services/trajectory/trajectory-manual-record.js:48`
- 重录基线（completed→recorded）：`src/services/trajectory/trajectory-recording-runner.js:440`

## 3. 执行机资源：连接、复用、释放

### 3.1 资源是什么

一个交易同一时间最多占用**一个执行机 session + 一个槽位**：
- **控制面内存**：`trajectoryRuntimeMap`（`src/services/trajectory/trajectory-runtime.js`）按 `trajectoryId` 记录 `sessionId / executorNodeUuid / executorSlotIndex / remoteSessionId`；`state.sessions`（`src/state.js`）按 `sessionId` 记录会话元数据。
- **槽位租约**：`src/executor-slot-lease.js`，key 为 `nodeUuid:slotIndex`，并按 session/trajectory 反查。每个节点容量由 `EXECUTOR_CAPACITY` 决定。
- **BiB（Browser-in-Browser）推流绑定**：`remote_session` 表，1:1 挂到交易（`trajectory.remote_session_id`）。

### 3.2 连接（prepare/attach）怎么复用

`POST /api/v2/trajectories/:id/record/prepare` → `prepareTrajectoryRecording`（交易级锁串行）→ `attachTrajectoryLive`（`src/services/trajectory/trajectory-attach-service.js:287`）：
1. `clearStaleTrajectoryRuntime` 校验已有 runtime 的 session 是否还活着（向执行机 `session.list` 核实），死了就清理。
2. 活着 → **复用**同一 session，必要时重新 attach BiB。
3. 否则 `openSession`（`preferIdleChrome: true`，优先复用执行机上的孤儿 CDP Chrome），登记 runtime、确认槽位租约、建立 BiB。

因此**多个前端页面/多台机器进入同一交易**时，`prepare` 会复用同一个执行机 session（不会各自开一个浏览器）。

### 3.3 释放的三种语义（务必区分）

| 操作 | 端点 | 效果 |
|---|---|---|
| 结束录制 | `POST /record/stop` | **不释放**执行机、不断流；只改状态 |
| 断流 | `POST /stream/detach` | 只断 BiB，Chrome/Python/slot 保留为 idle 可复用 |
| 释放浏览器 | `POST /detach` | 杀 Chrome + Python、释放槽位、删除 runtime |

`detachTrajectoryLive`：`src/services/trajectory/trajectory-attach-service.js:469`；`detachTrajectoryStream`：`:406`。

### 3.4 观众统计 → 无人观看自动释放（后端主导）

前端每个录制页标签页在进入时注册为「观众」，离开/关闭时注销：

- 服务：`src/services/trajectory/trajectory-viewer-service.js`
  - `enterViewer` / `leaveViewer` / `touchViewer` / `getViewerCount`
  - 心跳间隔 10s、30s 无心跳视为过期（覆盖崩溃/直接关页）
  - **观众数归零后延迟 5s** 再 `detachTrajectoryLive(reason='no_viewers')`，用于熬过页面刷新
  - 期间若有新观众 `enterViewer`，取消排队释放
- 端点（`src/routes/v2/trajectory-record.js`）：`POST /viewers/enter|leave|heartbeat`
- 前端（`vue-project/src/composables/useRecordingStudio.ts`）：
  - `onMounted` **先 `enterViewer` 再 `doPrepare`**（顺序很关键，见第 7 节坑）
  - 路由离开 → `leaveViewer`
  - `beforeunload` → `navigator.sendBeacon` 注销（直接关标签页）

> 注意：观众计数是控制面**内存态**，控制面重启会清零；重启时资源本身也会走恢复链。

### 3.5 空闲回收（兜底）

`src/services/trajectory/trajectory-idle-reaper.js` 每 45s 扫描：交易 **2 小时**无新步骤、且 session 不 busy、不在人工录制中 → 自动 `detachTrajectoryLive(reason='idle')`；并清理孤儿的 idle `remote_session`。

> 已知行为：idle-reaper **不感知 viewer 计数**。因此即使有人一直开着 `recorded/failed/completed` 的录制页，2 小时无步骤也会被回收、画面可能断开。若产品要求「页面在场豁免」，需把 `getViewerCount(tid)` 纳入其跳过条件。

## 4. 前端录制页流程

页面：`vue-project/src/views/ui-recording/detail/index.vue`（路由 `/ui-recording/detail/:id`，`meta.layout='recording'`）。

### 4.1 进入页面（`useRecordingStudio.onMounted`）

1. 初始化 WS、加载交易/登录上下文/轨迹树/执行机列表。
2. 注册观众 + 启动心跳 + `beforeunload` 注销。
3. 仅当状态为 **`draft`** 时**自动 prepare**；`recording/failed/recorded/completed` 默认不连执行机，需用户点击「准备会话」。
4. 启动 10s 轮询（轨迹树 + 执行机列表）。

### 4.2 三个按钮的行为

| 按钮 | 处理 | preserveRecordStatus |
|---|---|---|
| 准备会话 | `handleEnsureStream` → `doPrepare` | 始终为 `true`（只连资源，prepare 不再进入 recording） |
| 重新录制 | `handleReRecord`：未连接先 prepare → 全选阶段 → 清空步骤 → `record/start` | prepare 为 `true`；`record/start` 进入 recording |
| 关闭浏览器 | `handleDetach` → `doDetach` → `POST /detach` | —（硬释放；录制中 → failed(interrupted)） |

### 4.3 画面附着（canvas/WS）

- WS 客户端单例：`vue-project/src/composables/useWsClient.ts`，连 `ws://<host>/ws`，3s 自动重连（最多 20 次）。
- 画布：`vue-project/src/composables/useRemoteCanvas.ts`；`ensureStream` 流程 = 等 WS → 查 `live/status` → 必要时 `attach` → `remote:subscribe`/`remote:start` → 等首帧（8s 超时）。
- 组件：`detail/components/RemoteBrowser.vue`（占位文案、工具栏、附着状态）。

## 5. 主要 API 端点

前缀 `/api/v2/trajectories/:id`：

- `POST /record/prepare` body `{ preserveRecordStatus?: boolean }`（超时 180s）
- `POST /record/start` body `{ phaseIds?: number[], accountId?: number }`
- `POST /record/stop` body `{ success?: boolean }`
- `POST /confirm` body `{ confirmed: boolean }`
- `POST /manual-record` body `{ enabled: boolean, phaseId?: number }`
- `POST /attach` / `POST /detach` / `POST /stream/detach`
- `POST /viewers/enter|leave|heartbeat` body `{ viewerId: string }`

契约唯一来源：`src/dashboard/api-docs/catalog.js`（产品文档 `/api/docs`）。

## 6. WS 事件（前端订阅）

| 事件 | 用途 |
|---|---|
| `recording:prepare` | prepare 四阶段进度（session/browser/stream/login） |
| `recording:detached` | 资源释放（含 `reason`、`sessionId`、`recordStatus`） |
| `recording:stream_detached` | 只断画面（保留 session，可重附着） |
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
3. **`recording` 是临时态且唯一含义是「正在录制」**
    `record_status==='recording'` 现在可直接表示正在录制；前端 `recordingActive` 仍保留 running 阶段等信号作为内部子状态。
4. **prepare 默认不会进入 `recording` 临时态**
    只有 `record/start` 和人工录制开启才会进入 `recording`；`prepare` 只连接资源/推流，保持原持久态不变。
5. **idle-reaper 不感知观众**（见 3.5），长停留场景需注意。
6. **`failed_reason` 迁移与重启**：涉及 `failed_kind/failed_reason/failed_at` 的改动需先跑迁移 `20260918180000_trajectory_failed_reason` 并重启控制面。

## 8. 验证与门禁

- 状态机 characterization：`node scripts/characterization/characterize-record-status.mjs`（钉死 `enter/finish/restore/setPersistent/updateMetaIf` 接线与 CAS）。
- facade/契约：`node scripts/characterization/characterize-trajectory.mjs`。
- LLM 失败分类：`node scripts/characterization/characterize-agent-llm-error.mjs`。
- 全量门禁：`bash scripts/refactor/verify-all.sh`（含 `npx eslint .`；本机无 bash 时按其他条目口径退化为 `npx eslint src/ executor/ scripts/`）。
- 前端：`cd vue-project && npx vue-tsc --noEmit`。
- 真机联调：控制面 `npm start`（4097）+ 执行机 `npm run executor`；接口文档 `http://localhost:4097/api/docs`。

## 9. 相关历史条目（agent-log）

- 2026-09-18 16:45 · OpenCode：执行机资源连接策略 + 录制状态流转收口 + 后端观众统计（JS-gen `79ee592c` / 前端 `a3d1a55`）
- 2026-09-18 19:38 · OpenCode：修复交易详情页切换串台导致连不上执行机（前端 `8bb8e03`）
