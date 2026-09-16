# 上下文管理逻辑流程

> 日期：2026-09-16
> 用途：梳理控制面（Node.js）、执行器（Python Agent）、浏览器（Chrome CDP）三层之间的上下文生命周期，供开发人员快速理解系统状态流转。
> 本文档为只读架构说明，不涉及代码变更。

---

## 1. 一页心智模型

```
Frontend SPA ──HTTP/WS──→ Control Plane (:4097) ──WS──→ Executor (Python) ──CDP──→ Chrome
```

控制面是**所有权的唯一真相源**；执行器对持久化无感知，仅负责浏览器操作。

上下文分 **6 层**，从进程级到浏览器逐层嵌套：

| 层 | 职责 | 生命周期 |
|----|------|----------|
| 进程级全局状态 | 所有活跃会话的入口 | 进程存活期 |
| 槽位租约 | 执行器资源分配 + 容量控制 | 会话 open → close |
| 远程会话绑定 | 浏览器会话 ↔ 轨迹 ↔ 执行器的关联 | attach → detach（含 grace window） |
| 轨迹运行时 | 单条轨迹的内存热状态 | attach → detach |
| DB 持久化 | 轨迹/阶段/步骤/会话的持久记录 | 数据库生命周期 |
| Python 侧状态 | Agent 执行时的可变全局变量 | 单次 step 执行 |

---

## 2. 各层详解

### 2.1 进程级全局状态

**文件：** `src/state.js`

```javascript
state = {
  sessions: Map<sessionUUID, Session>,  // 所有活跃执行器会话
  globalBrowser: ...,                   // 遗留模式全局浏览器
  defaultModel: null,                   // 当前 LLM 模型
}
```

`Session` 对象关键字段：
- `stepIndex` — 当前步骤序号
- `trajectories[]` — 关联的轨迹列表
- `busy` / `aiRecording` — 互斥锁标志
- `cdpPort` — CDP 端口号
- `activePhaseId` — 当前激活的阶段
- `persistedActionIds: Set` — 已持久化的 action id

---

### 2.2 槽位租约（Slot Lease）

**文件：** `src/executor-slot-lease.js`

三重索引管理「谁占了哪个执行器的哪个槽位」：

```
bySlotKey:    `${nodeUuid}:${slotIndex}` → SlotLease    // 容量控制
bySessionId:  sessionUUID → SlotLease                   // 会话反查
byTrajectoryId: trajectoryDBId → SlotLease              // 轨迹反查
pendingByNode:  nodeUuid → count                        // 软预留（open 进行中）
```

**关键约束：**
- `EXECUTOR_CAPACITY` 限制每节点最大并发槽位数
- `withLeaseMutex()` 序列化 pick + reserve，防止并发双占最后一个空槽
- 每个槽位对应独立 CDP 端口：`9242 + slotIndex`

**流程：**
```
session.open → withLeaseMutex → countHardLeases(node) < CAPACITY?
  ├─ Yes → 软预留 pendingByNode++ → 创建 Chrome → 确认槽位 → pendingByNode--
  └─ No  → 返回 503
```

---

### 2.3 远程会话绑定（Live Binding）

**文件：** `src/services/remote-session-state.js`

```javascript
liveByRemoteSessionId = Map<remoteSessionId, LiveBinding>
trajLocks = Map<trajectoryId, Promise>  // per-trajectory 序列化锁
```

**LiveBinding 结构：**
```javascript
{
  remoteSessionId, remoteSessionUuid,
  trajectoryId,        // 关联的轨迹（可为 null）
  agentSessionId,      // Python Agent 会话 id
  nodeUuid,            // 执行器节点
  executorNodeId,
  viewportW, viewportH,
  attached,            // BiB 是否已连接
}
```

**解决优先链**（`resolveLiveBinding`）：
```
trajectoryId → remoteSessionId → remoteSessionUuid → agentSessionId → 单绑定兜底
```

**Trajectory Lock**（`withTrajectoryLock`）：
- Promise-chain 锁，序列化同一轨迹的 prepare / detach / release
- 超时返回 503 `traj_lock_wait_timeout`（默认 `TRAJ_LOCK_WAIT_TIMEOUT_MS`）
- 同一 async 链内可重入

---

### 2.4 轨迹运行时（Trajectory Runtime）

**文件：** `src/services/trajectory/trajectory-runtime.js`

```javascript
trajectoryRuntimeMap = Map<trajectoryDBId, TrajectoryRuntime>
```

**Runtime 结构：**
```javascript
{
  // 标识
  trajectoryId, sessionId, executorNodeUuid, executorSlotIndex, remoteSessionId,

  // 时间戳
  attachedAt, lastStepAt,

  // 录制上下文
  currentRunId,          // 当前 run 的 UUID（防跨 run 事件污染）
  aiRecording,           // AI 录制互斥锁
  persistedActionIds,    // Set<actionId> 已持久化集合

  // 终止信号
  abortRecording, abortReplay, userStop, bibError,

  // 登录上下文
  loginDone, loginAccountId, skipDefaultLogin,

  // 阶段统计
  selectedPhaseId,
  phaseOutcomes,         // {phaseId → 'completed'|'failed'}
  phaseStepCounts,       // {phaseId → number}
  phaseBusinessCounts,   // {phaseId → number}
  _phaseGroups,          // 每 phase 的状态组截图管理
  _pendingStepGroup,
}
```

仅当前进程有效；会话消失时清除。持久化数据留在 DAO。

---

### 2.5 DB 持久化上下文

| 表 | 关键列 | 作用 |
|----|--------|------|
| `remote_session` | id, session_uuid, status, trajectory_id, agent_session_id, executor_node_id, slot_index, grace_until | 浏览器会话所有权 |
| `trajectory` | id, remote_session_id, record_status, persistent_record_status, function_id, model, task | 轨迹元数据 |
| `trajectory_phase` | id, trajectory_id, phase_number, status, description | 每阶段状态 |
| `trajectory_step` | id, trajectory_id, trajectory_phase_id, action, element_json, step_number | 持久化操作步骤 |
| `business_data_entry` | trajectory_id, field_key, field_value | AI 业务上下文 KV |
| `system_ref_data` | trajectory_id, ... | 系统捕获的参考值 |

**Truth + Cache 三写模式**（`session-lifecycle.js:syncMount`）：
```
每次挂载同时写：
  1. DB（remote_sessionDao / trajectoryDao）     ← 真相源
  2. 内存 Map（liveByRemoteSessionId）            ← 热缓存
  3. Runtime（runtime.remoteSessionId）           ← 最热缓存
```

---

### 2.6 Python 侧上下文

**文件：** `scripts/state.py`

```python
_ACTION_LOG              = []      # 当前轨迹的完整动作日志
_ACTION_LOG_SYNCED_IDS   = set()   # 已同步的 id（delta 书签）
_CURRENT_PHASE           = 0       # 当前 phase 编号
_CURRENT_RUN_ID          = None    # 当前 run UUID（控制面下发）
_CURRENT_SOURCE          = 'agent' # 动作来源
_CAPTURE_SCREENSHOTS     = False   # 截图开关
_PAGE_LEVEL_SHOTS        = {}      # 页面级截图注册表
_CURRENT_PAGE_KEY        = ''      # 当前页面标识
_CURRENT_POPUP_KEY       = ''      # 当前弹窗标识
_CURRENT_PAGE_DIMS       = {}      # 文档尺寸（rect_norm 分母直通）
```

**LLM 上下文窗口裁剪**（`scripts/context_compiler.py`）：
```
compile_message_window(managed_list, max_recent=16)
  保留: 首条 system + keepalive + 最近 N 条 + tool 配对
  丢弃: 中间消息，产出 dropped_detail 审计明细
  上报: context_drop 事件（结构化审计）
```

---

## 3. 关键生命周期流程

### 3.1 Attach（建立上下文）

```
POST /api/v2/trajectory/:id/record/attach
  │
  ├─ withTrajectoryLock(tid)                    // 序列化锁
  │   ├─ supersedeStaleForTrajectory()          // 清理该轨迹的旧占用行
  │   ├─ openSession()                          // → executor WS: session.open
  │   │   └─ slotLease.withLeaseMutex()         //   槽位序列化
  │   │       └─ countInUse(node) < CAPACITY?   //   容量检查
  │   │
  │   ├─ create/update remote_session DB        // DB 记录
  │   ├─ registerTrajectorySession()            // 创建 TrajectoryRuntime
  │   ├─ liveByRemoteSessionId.set()            // 注册 LiveBinding
  │   ├─ syncMount()                            // DB + Memory + Runtime 三写
  │   │
  │   ├─ attach_bib → 等待 bib_ready            // BiB 流式画面连接
  │   └─ bindTrajectoryManualPersist()          // 订阅 action 事件（录制持久化）
```

### 3.2 录制（上下文流动）

```
POST /api/v2/trajectory/:id/record/start
  │
  ├─ lockAiRecording(runtime, session, true)    // 互斥锁
  ├─ runtime.currentRunId = uuid                // run 身份标识
  │
  ├─ Phase 循环:
  │   ├─ resolveRecordingSystemId()             // 系统层级上下文
  │   ├─ attachSpecialElementCandidates()       // 特殊元素提示注入
  │   ├─ prepareRecordingBusinessContext()      // 业务数据注入（fill/introduce 阶段）
  │   │
  │   ├─ stdin → executor: step {
  │   │     runId, action, factPack,
  │   │     healContract, businessDataBlock
  │   │   }
  │   │
  │   ├─ Python 侧:
  │   │   ├─ state.py: set_current_run_id(runId)
  │   │   ├─ state.py: set_current_phase(phaseNum)
  │   │   ├─ controller 执行动作
  │   │   │   └─ record_action() → _ACTION_LOG.append()
  │   │   └─ action_log_sync → 控制面（增量/全量）
  │   │
  │   ├─ 控制面接收:
  │   │   ├─ phaseEventOwnership(runId)         // runId 归属过滤
  │   │   ├─ applyActionLogSync()               // 增量持久化到 trajectory_step
  │   │   ├─ appendRecordedStep()
  │   │   └─ touchTrajectoryRuntimeActivity()   // 更新 lastStepAt
  │   │
  │   └─ phase_done → 统计 phaseOutcomes / phaseStepCounts / phaseBusinessCounts
  │
  └─ lockAiRecording(runtime, session, false)   // 释放互斥锁
```

**runId 归属过滤**：每次 step 下发控制面生成 `currentRunId`，Python 在 `phase_done` / `phase_error` 中回带，控制面用 `phaseEventOwnership` 过滤旧 run 的残留事件。

### 3.3 Detach（销毁上下文）

```
POST /api/v2/trajectory/:id/record/detach
  │
  ├─ withTrajectoryLock(tid)
  │   ├─ runtime.abortRecording = true
  │   │
  │   ├─ detachLive()                           // 停止 BiB 推流
  │   │   ├─ executor: session.detach_bib
  │   │   └─ streamDetachOwnership()            //   grace window 保持所有权
  │   │
  │   ├─ hardCloseRemoteSession()               // 清除 DB + 内存绑定
  │   ├─ execSession.closeSession()             // 杀 Chrome + Python 进程
  │   ├─ state.sessions.delete(sessionId)
  │   ├─ slotLease.releaseByTrajectory()        // 释放槽位
  │   └─ deleteTrajectoryRuntime()              // 清除 runtime
```

### 3.4 Grace Window（优雅重附）

```
streamDetachOwnership()
  └─ computeGraceUntil(now, GRACE_MINUTES)
      └─ remote_session.status = 'idle'
         但 grace_until 未过期
          └─ canClaimRemoteSession() = true
              → 重附时复用同一 Chrome，无需重新启动
```

**设计意图**：BiB 流断开后（如页面导航、网络抖动），在 grace 窗口内重附可避免重启 Chrome 的开销。超时后自动清理。

---

## 4. 事件路由

### 4.1 Executor Event Hub

**文件：** `src/executor-event-hub.js`

```
hubs = Map<sessionUUID, EventEmitter>
```

每个执行器会话一个独立 EventEmitter。控制面通过 `waitForSessionEvent(sessionId, eventName, timeout)` 等待一次性事件，支持 cancel 避免孤儿 Promise。

### 4.2 事件流向

```
Python Agent stdout/stdout
  │
  ▼
executor-ws.js (WS 端点)
  │
  ├─ action_log_sync    → action-log-copy.js → trajectory-step-dao
  ├─ phase_done         → recording-runner → phaseOutcomes 统计
  ├─ phase_error        → recording-runner → 错误处理
  ├─ session.bib_ready  → attach 流程继续
  ├─ session.bib_error  → attach 流程失败
  ├─ replay_done        → replay-actions.js → 回放结果处理
  └─ step_notice        → step-notice.js → 前端通知
```

### 4.3 Run 归属过滤

```
控制面下发 step { runId: "abc-123" }
  │
  Python 回带 phase_done { runId: "abc-123" }
  │
  控制面: phaseEventOwnership("abc-123")
    ├─ 匹配 → 处理事件
    └─ 不匹配 → 丢弃（旧 run 残留事件）
```

防止旧录制/回放 run 的延迟事件污染新 run。

---

## 5. 核心设计模式

| 模式 | 文件 | 作用 |
|------|------|------|
| **Trajectory Lock** | `remote-session-state.js:58` | Promise-chain 锁，序列化 prepare/detach |
| **Run 归属过滤** | `run-event-ownership.js` | runId 过滤，防跨 run 事件污染 |
| **Live Binding 解析** | `remote-session-state.js:223` | 5 级优先链定位绑定 |
| **Truth + Cache 三写** | `session-lifecycle.js:76` | DB + Memory + Runtime 同步 |
| **Grace Window** | `session-lifecycle-rules.js:14` | detach 后保留所有权，支持快速重附 |
| **Event Hub** | `executor-event-hub.js` | 每会话 EventEmitter，Promise one-shot |
| **Context Window 裁剪** | `context_compiler.py:63` | LLM 消息 budget 管理 + 丢弃审计 |
| **Slot Lease Mutex** | `executor-slot-lease.js:33` | 序列化槽位 pick，防并发双占 |

---

## 6. 数据流全景图

```
                        ┌──────────────────────────────────────────────┐
                        │            Frontend SPA (Dashboard)          │
                        └─────────┬──────────────┬────────────────────┘
                                  │ HTTP REST     │ WS (binary/JSON)
                        ┌─────────▼──────────────▼────────────────────┐
                        │        Control Plane (server.mjs:4097)       │
                        │                                              │
                        │  ┌────────────┐  ┌───────────────────────┐  │
                        │  │ state.js   │  │ executor-slot-lease.js │  │
                        │  │ .sessions  │  │ bySlotKey / bySession  │  │
                        │  └─────┬──────┘  └───────────┬───────────┘  │
                        │        │                     │               │
                        │  ┌─────▼─────────────────────▼───────────┐  │
                        │  │    remote-session-state.js             │  │
                        │  │    liveByRemoteSessionId (Map)         │  │
                        │  │    trajLocks (per-trajectory locks)    │  │
                        │  └─────┬─────────────────────────────────┘  │
                        │        │                                     │
                        │  ┌─────▼─────────────────────────────────┐  │
                        │  │   trajectory-runtime.js                │  │
                        │  │   trajectoryRuntimeMap (Map<tid,RT>)   │  │
                        │  └─────┬─────────────────────────────────┘  │
                        │        │                                     │
                        │  ┌─────▼─────────────────────────────────┐  │
                        │  │   session-lifecycle.js                 │  │
                        │  │   mount / grace / expire / close       │  │
                        │  └─────┬─────────────────────────────────┘  │
                        │        │                                     │
                        │  ┌─────▼──────────┐  ┌──────────────────┐  │
                        │  │ remote-session- │  │ trajectory-dao.js │  │
                        │  │ dao.js (DB)     │  │ trajectory table  │  │
                        │  └─────┬──────────┘  └────────┬─────────┘  │
                        └────────┼──────────────────────┼─────────────┘
                                 │ WS /ws/executor      │
                        ┌────────▼──────────────────────▼─────────────┐
                        │           Executor (Node.js WS client)       │
                        │  executor-event-hub.js (per-session hubs)    │
                        │  executor-session-client.js (stdin fwd)      │
                        └────────┬────────────────────────────────────┘
                                 │ WS messages
                        ┌────────▼────────────────────────────────────┐
                        │         Python Agent (session_runner.py)      │
                        │                                              │
                        │  state.py globals:                            │
                        │    _ACTION_LOG, _CURRENT_PHASE, _CURRENT_RUN_ID│
                        │  browser_context (Playwright BrowserContext)  │
                        │  business_data_store (dict)                  │
                        │  controller (action registry)                │
                        │  context_compiler.py (LLM window trimming)   │
                        └────────┬────────────────────────────────────┘
                                 │ CDP / Playwright
                        ┌────────▼────────────────────────────────────┐
                        │         Chrome Browser (per-slot)             │
                        │  CDP port: 9242 + slotIndex                  │
                        │  BiB screencast → remote-bridge → WS binary │
                        └─────────────────────────────────────────────┘
```

---

## 7. 关键文件索引

### 核心状态与基础设施
| 文件 | 职责 |
|------|------|
| `src/state.js` | 进程级状态单例 |
| `src/models/constants.js` | 状态枚举 + 状态机规则 |
| `src/executor-slot-lease.js` | 槽位租约管理 |
| `src/executor-event-hub.js` | 每会话事件路由 Hub |
| `src/executor-session-client.js` | 执行器 WS 客户端 |
| `src/ws-server.js` | Dashboard WS 服务（二进制帧广播） |

### 远程会话层
| 文件 | 职责 |
|------|------|
| `src/services/remote-session-state.js` | Live Binding + Trajectory Lock |
| `src/services/remote-session-service.js` | 会话生命周期（open/attach/detach/close） |
| `src/dao/remote-session-dao.js` | remote_session 表 DB 操作 |
| `src/services/session-lifecycle.js` | mount/grace/expire/close 所有权门闩 |
| `src/services/session-lifecycle-rules.js` | 纯所有权/grace 规则 |

### 轨迹上下文层
| 文件 | 职责 |
|------|------|
| `src/services/trajectory/trajectory-runtime.js` | 轨迹运行时注册表 |
| `src/services/trajectory/trajectory-attach-service.js` | Attach/Detach/Prepare 编排 |
| `src/services/trajectory/trajectory-attach-runner.js` | Prepare 内部流程（session/browser/stream/login） |
| `src/services/trajectory/trajectory-recording-runner.js` | AI 录制 phase 循环 + 事件处理 |
| `src/services/trajectory/recording-runner-step-context.js` | 系统解析 + 特殊元素注入 |
| `src/services/trajectory/recording-runner-business-data.js` | 业务数据上下文准备 |
| `src/services/trajectory/trajectory-record-lifecycle.js` | 登录、停止、元素解析 |
| `src/dao/trajectory-dao.js` | trajectory 表 DB 操作 |

### 回放上下文层
| 文件 | 职责 |
|------|------|
| `src/services/replay-actions.js` | 统一回放编排（replayId 归属） |
| `src/services/trajectory/replay-batch-runner.js` | 批量回放 + Heal（Type A/B） |

### Python 侧上下文层
| 文件 | 职责 |
|------|------|
| `scripts/state.py` | 共享可变状态（action log、phase、run context） |
| `scripts/session_runner.py` | 交互式会话主循环 |
| `scripts/context_compiler.py` | LLM 上下文窗口 budget 裁剪 |
| `scripts/controller/service.py` | Controller 构建（browser_context + actions） |
| `scripts/browser/factory.py` | 浏览器/上下文创建 |

---

## 8. 常见问题

**Q: 为什么 trajectory lock 要用 Promise-chain 而不是 Mutex？**
A: Node.js 单线程无真 Mutex；Promise-chain 利用微任务队列实现串行化，且支持同 async 链内重入。

**Q: grace window 期间能否操作轨迹？**
A: 可以。grace window 期间 remote_session 状态为 `idle` 但 `canClaimRemoteSession()` 返回 true，重附时复用已有 Chrome。超时后自动释放。

**Q: runId 过滤解决了什么问题？**
A: 旧录制/回放 run 的延迟事件（如 Python 侧慢处理的 phase_done）可能在新 run 启动后到达。runId 过滤确保事件只归属到产生它的那次 run。

**Q: Truth + Cache 三写为什么需要三处？**
A: DB 是持久化真相源；`liveByRemoteSessionId` 是跨请求的快速查询索引；`runtime` 是单请求内的最热缓存（避免每次都查 Map）。三处写入在同一 async 链内完成，保持一致性。

**Q: context_compiler 的 budget 裁剪会影响什么？**
A: 只影响发给 LLM 的消息窗口。保留首条 system prompt + keepalive 消息 + 最近 N 条（默认 16）+ tool 调用配对。丢弃的中间消息通过 `context_drop` 事件审计，不丢失 action_log 中的持久化记录。
