# Report: executor LB spec 证据核验与设计切面（评审支持材料）

**日期**：2026-09-17
**目的**：为 `docs/superpowers/specs/2026-09-17-executor-lb-design.md`（草案，待控制面负责同事评审）提供证据核验与设计切面补充——供评审人快速判断 spec 断言真伪、并看到 spec 未覆盖的设计考量。
**方式**：主会话派发 3 个只读 Explore 子智能体并行调研（域 A 控制面调度内核 / 域 B 执行机侧与节点生命周期 / 域 C 入口·数据面·API 契约），文件集互不相交；全部结论基于实读源码，未运行任何门禁。主会话对 4 条最载重断言做了抽查复核（§3.1/§4.1/§4.5/§5.2 对应项），全部属实。
**基线**：分支 `uara_V1.2` @ `d48fcc3d`（spec 本体自 `9f4c1fd0` 交付后无代码变更，行号锚点有效）。

---

## 1. 总体结论

1. **spec 现状速查表与缺口 G1–G11 的 file:line 断言全部核实**。三条链路级断言逐行实证成立：
   - **G2**：`probed.sort` 第一排序键是 warm Chrome（`browser.cdpWsUrl` 有无），`inUse` 仅第二键——"15/16+warm 先于 2/16" 成立（`src/executor-session-client.js:99-103`）。
   - **G3**：执行机 `session.error` 回发（`executor/agent.mjs:181-184`）→ 控制面 `routeExecutorInbound` 投递到 hub（`src/executor-ws.js:142` → `src/executor-event-hub.js:35-41`）→ **openSession 未监听该类型，零监听 emit 被 EventEmitter 静默丢弃**；超时文本 `Timeout waiting for session.ready`（`executor-event-hub.js:91-93`）不匹配 409 映射三式正则（`executor-session-client.js:238-242`）→ 无 `statusCode` → `sendErr` fallback 500（`src/routes/v2/trajectory-record.js:54` → `src/routes/v2/trajectory-shared.js:20-22`）。
   - **G6/G9**：labels/agentVersion 入库后调度零消费（全仓 grep 实证）；heartbeat payload 为空对象 `{}`（`executor/ws-client.js:253-255`），控制面不读 payload（`src/executor-ws.js:115-118`）。
2. **3 处量化/边界漂移**需修 spec 表述（§3）：G5 的"互斥内 O(N×probe)"失真（探测是 `Promise.all` 并行）；sweep 间隔实为 22.5s 而非"45s 每 ≥15s 扫"的下限口径；CDP 端口 +20 扫描全忙时 fallback 返回 preferred 可能撞端口。
3. **最重要的三个评审输入**（spec 未覆盖）：
   - **T7 亲和的数据存活窗口被高估**：`remoteSessionDao.close()` 对 closed 与 crashed 都清 `trajectory_id`（`src/dao/remote-session-dao.js:227-234`）→ detach 后重 prepare 查无行，sticky 只在占用/宽限窗口内有效——恰是丢 warm Chrome 的主场景（隔天重录）。
   - **T9 适用面比 spec 划分窄**：批量录制已有 DB 级队列与 409→`waiting_executor` 自动重试（`src/services/trajectory/batch-record.js:258-279`），真痛点是重试放大 reconcile+探测（G5），不是缺队列。
   - **drain 状态机双向漂移且无完成信号**：agent 侧 draining 永不复位、无 undrain 端点；每次 WS 重连重发 register → DB 无条件翻回 `online`（`src/dao/executor-node-dao.js:47-55`）而 agent 仍拒 open——T2 修复后表现为持续毫秒级 409 的"永远拒绝"节点。T11 前提"机制已就绪"不完全成立。
4. **5 项需在实现前钉死的缺陷/竞态**（§4）：失败 open 泄漏 session hub 条目（T6 放大 3 倍）、T2 error 监听必须先于 sendToExecutor 注册、confirmLease 静默抢占他人租约（T6 僵尸 open 晚到 ready）、T5 labels 值类型与覆盖语义未定义、T8 openFailures 计数不存在且依赖 T2 先落地。

---

## 2. 核验明细

### 2.1 域 A：控制面调度内核（`src/executor-*`）

| # | spec 断言 | 判定 | 证据 |
|---|---|---|---|
| A1 | pickExecutorNode 在 `:23`；选点与 IO 同函数耦合无纯函数切入点（G1） | 证实 | `src/executor-session-client.js:23`（签名）、`:26`（DB）、`:40,71`（registry）、`:54,88-98`（CDP 探测）、`:79`（租约计数）、`:82,99-103`（排序内联 comparator） |
| A2 | warm Chrome 无条件凌驾负载（G2） | 证实 | `:99-103`：`aIdle - bIdle || a.inUse - b.inUse || localeCompare`——第一键 `browser.cdpWsUrl` 有无 |
| A3 | G3 链条：error 不被消费→120s→正则不匹配→500 | 证实 | 事件链 `agent.mjs:181-184` → `executor-ws.js:142` → `executor-event-hub.js:26-29,35-41`；监听缺口 `executor-session-client.js:209`（`waitForSessionEvent(sessionId,'session.ready',120000)`）；hub 单类型签名 `executor-event-hub.js:74,95`（`hub.once(type, …)`，但 emit 侧类型不受限）；超时文本 `:91-93`；409 正则 `executor-session-client.js:238-242` 与 `trajectory-attach-service.js:344-352` 两处同款；500 包装 `trajectory-record.js:54` → `trajectory-shared.js:20-22` |
| A4 | 每次 open 全候选并行 list_cdp 8s、在全局租约互斥内（G5） | 证实（量化有漂移，见 §3.1） | 互斥=进程级单 Promise 链（`executor-slot-lease.js:26,33-37`，模块级 `mutexTail`，非按 key 分把）；pick 含探测整体在临界区内（`executor-session-client.js:193-206`）；探测 `Promise.all` 并行、单节点 8000ms（`:91`、`:54`） |
| A5 | 满载立即 409 `{error,holders}`、无排队（G8） | 证实 | `executor-slot-lease.js:214-219,225-230`（noFreeSlotsError/noExecutorOnlineError）、`:127-134`（holders 元素 `{trajectoryId,executorNodeUuid,slotIndex,sessionId}`）；通读无队列/重试结构 |
| A6 | 租约三索引 + per-node pending；ready 携自报 slotIndex confirm | 证实 | `executor-slot-lease.js:17-24`（索引）、`:67-69`（countInUse=hard+pending）、`:142-165`（confirmLease）；`executor-session-client.js:220-226`；执行机侧来源 `executor/session-manager.js:144,151-155` |
| A7 | pending 释放路径在 catch（T6 复用点） | 证实 | `executor-session-client.js:205`（reservePending）、`:227`（成功释放）、`:236-237`（catch 释放） |

### 2.2 域 B：执行机侧与节点生命周期（`executor/*`、node-service、server、config）

| # | spec 断言 | 判定 | 证据 |
|---|---|---|---|
| B1 | register 负载七字段（`:103`） | 证实 | `executor/agent.mjs:103-112`；控制面解构 `src/executor-ws.js:52` |
| B2 | drain 后拒新 session.open（`:115`） | 证实（含状态机缺口，见 §3.4） | `agent.mjs:115-121`（`session.error{error:'executor is draining'}`）；置位 `executor/ws-client.js:142-145` |
| B3 | `session.error` 触发路径（`:181`） | 证实，共 2 发送点 | ① drain 拒绝 `agent.mjs:116-119`；② handleSession catch `:181-184`。throw 来源：槽满 `session-manager.js:145`（`'No free executor slots'`）、slot 已有活会话 `session-slot.js:78`、spawn 失败 `spawn-agent.js:117,138`、forward 未知会话 `session-manager.js:173`、未 ready 写 stdin `:251`、sessionId 缺失 `session-handler.js:15`（此时报文无 sessionId，hub 不可路由）、未知命令 `session-handler.js:125`、attachBib 失败 `session-manager.js:327-329,360-372` |
| B4 | `_findFreeSlot` 最终守门；CDP 端口 19242+slot、+20 扫描 | 证实（边界修正见 §3.3） | `executor/session-manager.js:61-76,144-145`；`executor/session-slot.js:35-40`（`preferred..preferred+20`）；发现跨度 `max(40, capacity*20)`（`session-manager.js:105-108`）；ghost 回收 `:61-76` |
| B5 | heartbeat 20s / ack 40s terminate / 看门狗 30s / 服务端 ping 10s | 证实 | `executor/config.js:234-249`；terminate `ws-client.js:259-266`；看门狗+杀会话 `ws-client.js:213-223` + `agent.mjs:64-73`；ping `src/executor-ws.js:341-358` |
| B6 | G9：heartbeat payload 零健康信号 | 证实 | `ws-client.js:253-255`：`this.send('executor.heartbeat', {})`——空对象；控制面不读 payload（`executor-ws.js:115-118`） |
| B7 | grace 45s → offline + crash + 清租约；sweep 每 ≥15s | 证实（间隔实值 22.5s，见 §3.2） | `config/config.js:155-162`（`EXECUTOR_HEARTBEAT_TIMEOUT_MS` 45000、grace 取同值）；回调+清租约 `executor-node-service.js:96-100,122-131,:23`；定时 `server.mjs:165-176`（`Math.max(15000, 45000/2)`） |
| B8 | labels=buildLabels；agentVersion 来源 | 证实 | `executor/config.js:255-270`：`{os, headed: !headless, ...EXECUTOR_LABELS_JSON}`——**spread 在后可覆盖内置键**；`EXECUTOR_AGENT_VERSION` 默认 `0.1.0`、与 package.json 无关联，现网未设 → 全节点 0.1.0 |
| B9 | G6：labels/agentVersion 零调度消费 | 证实 | 写入链 `executor-ws.js:52,64` → `src/dao/executor-node-dao.js:11-26,52-53,67`；读点仅展示 `src/routes/v2/executor.js:17-38`；pick 路径只读 status/capacity/nodeUuid |
| B10 | reconcileRemoteSessions：session.list 权威 + 孤儿收敛 keepBrowser | 证实 | `executor-node-service.js:201-256`（miss→crashed close `:227`；hit→confirmLease `:279-284` + 重挂 BiB `:241-249`）；孤儿收敛 `executor-orphan-session-service.js:36-72`（只收 `ready===true` 的孤儿 `:22-29`，防误杀 in-flight open） |
| B11 | SessionManager.list() 派生 T8 四字段 | 部分现成 | `session-manager.js:248-256`：freeSlots/sessionCount 现成可派生（全槽含空闲）；**openFailures 无任何现成统计**（executor/ 全目录无失败计数）；agentUptimeSec=`process.uptime()` 现成未透出。ghost 槽在回收前计为占用 → 自报 freeSlots 偏小（保守方向，安全） |
| B12 | session.error 报文形状（T2 契约） | 证实 | `{type:'session.error', payload:{sessionId, error}}`，error 恒纯字符串（`'executor is draining'`/`'No free executor slots'`/`'Timeout waiting for Python agent ready'`/`'Python agent exited with code N before ready'`），无 code/holders/retryable；hub 仅当 sessionId 存在才 emit（`executor-event-hub.js:35-41`）——**session.error 不保证可路由** |

### 2.3 域 C：入口链路与数据面（routes、attach、dao、migrations、api-docs）

| # | spec 断言 | 判定 | 证据 |
|---|---|---|---|
| C1 | record/prepare 入口链（route:49 → attach → openSession:338） | 证实（中间多一环 attach-runner） | `src/routes/v2/trajectory-record.js:49` → `trajectory-attach-runner.js:108` → `trajectory-attach-service.js:338` |
| C2 | G7：三列存在、调度零消费、client_key 无供数 | 证实+细化 | `src/models/entities.js:77`、`migrations/20260716150632_executor_node.js:32-34`、`remote-session-service.js:74,344`；细化：`POST /api/v2/remote-sessions` 把 `req.body` 原样透传（`src/routes/v2/remote-session.js:66`）→ **HTTP 层技术上已可写 client_key，缺的是调用方生态** |
| C3 | T7 亲和可查"最近一行非 crashed" | **漂移（重大）** | DAO 方法存在（`getByTrajectory` `src/dao/remote-session-dao.js:45`），但 `close()` 对 **closed 与 crashed 都置 `trajectoryId: null`**（`:227-234`；`crashOccupiedOnOfflineNodes` `:240-259` 同）→ detach 后查无行，见 §3.4 |
| C4 | reconcile 仅 attach 路径全 live 节点触发（`:327`） | 证实 | `trajectory-attach-service.js:327-330`；全仓无其他调用点。注意 batch/auth-recording 也走 prepareTrajectoryRecording → 批量放大已在对账负载内 |
| C5 | assertNoForeignGraceOnNodeSlot（`:91`） | 证实 | `trajectory-attach-service.js:91`，调用点 `:369` |
| C6 | /api/v2/executors 四端点 + slot-monitor 字段 | 证实 | `src/routes/v2/executor.js:17,27,41,55`；slot-monitor 消费 capacity/slots/connected/status 等（`slot-monitor.js:70-198`），**不消费 labels/agentVersion** |
| C7 | 409 形状、503、队列表 | 证实+漂移 | 409 形状与 holders 透传（`src/http/app-error.js:91`）；**503 已有既存语义**（`traj_lock_wait_timeout`，`remote-session-state.js:38-43`）——T9 的 503 是新子语义非首个；**"DB 无队列表"前提不成立**：`batch_recording_jobs` 已存在（migration `20260802140000`，itemStatus 含 queued/waiting_executor），只是无"执行机槽位队列" |
| C8 | G10：无租户配额 | 证实 | 全仓 grep quota/tenant/rateLimit 零命中 |

---

## 3. 需修正/精化的 spec 表述（漂移清单）

1. **G5/T3 量化失真**：探测是 `Promise.all` **并行**，单次 open 的互斥临界区耗时 ≈ max(单探测) ≤ 8s，**不随节点数线性增长**；随 N 增长的是互斥排队中后续 open 的等待时长。spec"互斥内耗时从 O(N×probe) 降为 O(1)"表述失真；T3 钉位应度量"互斥占用时长/排队深度"，否则钉不出行为差异。另：preferred（指定节点）路径的单节点探测也进全局互斥（`executor-session-client.js:193`）——一个慢节点会拖住所有指定选点。
2. **§1.2 sweep 间隔**：实值 = `Math.max(15000, EXECUTOR_HEARTBEAT_TIMEOUT_MS/2)` = 默认 **22.5s**；"每 ≥15s 扫"是下限口径不是实值。
3. **§1.1 端口扫描**：+20 全忙时 fallback **返回 preferred（可能撞已占端口）**，仅靠 Python ready 回报的 `cdp_port` 事后纠正（`session-slot.js:39,172-174`）。多机化后孤儿 Chrome 增多会放大该边界——与 Q6 相关。
4. **T7 数据存活窗口**（高优先）：`remoteSessionDao.close()` 对 closed 与 **crashed** 均清 `trajectory_id`（`remote-session-dao.js:227-234`）→ spec"查最近一行非 crashed 的 remote_session"在 detach 后查无行。sticky 实际只在占用/宽限窗口内有效。候选修法：a) 查询放宽为"最近一行（含 closed，仅取 executor_node_id）"——零迁移；b) `trajectory` 表加 `last_executor_node` 列——**需迁移，与 spec"P0/P1 无 DB 迁移"冲突，需评审拍板**。
5. **§7 契约同步面**：实际端点契约文件是 `src/dashboard/api-docs/groups/recording.js`（prepare `:30-55`、attach `:222-231`）与 `groups/remote.js`（attach-live `:36-45`）；`catalog.js` 仅聚合导入（`:14-30`）。T5 的同步清单应为"groups 两处 + catalog 流程文案"；T14 另需 `groups/recording.js:373-381` executors respExample 与 slot-monitor `buildViewModel`。
6. **T9 前提修正**：批量录制已有 DB 队列（`batch_recording_jobs`）+ 409 自动重回 `waiting_executor` 重试（`batch-record.js:258-279`），且入口限流用 `computeClusterFreeSlots()`——批量对 T9 的边际需求比 Q2 假设小；真实痛点是重试反复触发全节点 reconcile + 全候选探测（G5 放大）。T9 的 503 亦非首个 503（`traj_lock_wait_timeout` 先例，body 风格应带 `code` 对齐）。
7. **T11 前提修正**：drain/重注册/对账机制"已就绪"不完全成立——无 undrain 端点、drain 无完成信号、重连重注册把 DB 翻回 online（见 §4.3）。
8. **T11 版本供给**：`EXECUTOR_AGENT_VERSION` 默认 `0.1.0`、与 package.json 无关联、现网 executor/.env 未设 → 全部节点同版本。版本灰度（T11）开工前需先修版本供给链，否则分组视图无意义。
9. **现网实配与 Q6**：`executor/.env` 实配 `EXECUTOR_CAPACITY=4`（代码默认 16）、`CHROME_HEADLESS=true`（→ label `headed:false`）。每槽常驻不止 Python+Chrome（BiB 桥、attach 锁、stderr 缓冲，`session-manager.js:50-54`）；capacity 上限同时受 CDP 端口段与发现跨度 `max(40, capacity*20)` 约束。

---

## 4. 设计切面：spec 未覆盖项（评审重点）

### 4.1 失败 open 泄漏 session hub 条目，T6 放大 3 倍
`getSessionHub` 首次访问即向模块级 `hubs` Map 插条目（`executor-event-hub.js:13-18`）；`removeSessionHub` 全仓仅两个调用点（`closeSession` `executor-session-client.js:336`、`browser-session/step-execution.js:104`）。openSession 的 catch（`:236-247`）只释放 pending **不摘 hub** → 每次 120s 超时/失败永久泄漏一个 EventEmitter；T6 每请求最多 3 次尝试，泄漏线性放大。**T6 失败清理清单应补"removeSessionHub 失败 attempt 的 sessionId"**。（抽查证实）

### 4.2 T2 的 Promise.race 存在"监听注册晚于发送"的间歇性回归窗口
现状 ready 不丢事件是因为监听注册（`:209`）**先于** `sendToExecutor`（`:218`）；`session.error` 在收到执行机消息的同一 tick emit，零监听即静默丢。spec T2 只说"Promise.race"，未明文要求 **error 监听必须先于 sendToExecutor 注册**——毫秒级快拒场景下注册晚一拍 = 回到 120s 挂起。T2 钉位应补对抗用例（error 先于监听到达也不挂起）。

### 4.2b `session.error` 不止 open 会发——监听器生命周期必须钉死
agent 侧 catch 包住**全部** `session.*` 命令（step 失败、close 异常、BiB 错误都走 session.error，`agent.mjs:113-186`）。T2 race 到 ready 后必须注销 error 监听，否则同 sessionId 后续 step 的 error 被误消费。缓解：sessionId 每次 randomUUID + `waitForSessionEvent` 单次消费自动解绑（`executor-event-hub.js:84`）。

### 4.3 drain 状态机：重连翻转、无 undrain、无完成信号
- agent 侧 `draining` 置 true 后**永不复位**（`ws-client.js:56,142-145`），唯一退出是进程重启；
- 每次 connect 成功重发 register（`ws-client.js:86-90`）→ `upsertByUuid` 无条件 `status:'online'`（`executor-node-dao.js:47-55`）→ **WS 抖动一次，DB 就翻回 online 而 agent 仍拒 open**。T2 后表现为持续毫秒级 409 的"永远拒绝"节点，无摘除机制；
- drain 只拦 `session.open`，对已开会话零干预；无"槽清空→自动下线"路径；drain 完成（freeSlots==capacity）无事件无信号。
**T11 必须先定义**：re-register 对 drain 状态的语义（register 时查 DB 回发 drain 指令）+ undrain 端点 + 完成判据（T8 的 `sessionCount===0` 是天然信号）。

### 4.4 confirmLease 静默抢占 + T6 僵尸 open 晚到 ready
`confirmLease` 发现槽位冲突时**无告警地释放对方租约**（`executor-slot-lease.js:148-151`）。T6 超时后 best-effort `session.close` 失败的僵尸 open 稍后仍会完成并回 ready → 晚到 confirm 可能抢走重试会话或第三方的租约。T6 每次重选换新 sessionId 是**必要**条件（hub 以 sessionId 为 key，复用会让第二次 attempt 消费第一次的迟到事件）——spec 已写 randomUUID 但未写"为什么必须换"，建议把依据写死防实现者"优化"掉。

### 4.5 T9 需要显式 opt-in，auth-recording 不宜进队列
openSession 真实调用方 4 处（§5.1），批量场景（batch-record、auth-recording、menu-scan×2）全都不在 HTTP 请求线程上等 409，且 batch 已自带 waiting_executor 重试。**T9"仅批量入口使用"在代码上意味着 openSession 需新增显式 opt-in 参数（如 `queueEligible`），而非按入口自动判别**；auth-recording（人值守两段式演练）语义接近交互式，不宜进队列。

### 4.6 T6 与 preferIdleChrome 的交互未定义
record/prepare 的 `preferIdleChrome:true` 路径上，open 失败重选意味着**放弃已探测到的孤儿 Chrome**：T6 需规定重选时是否重探（T3 缓存 miss 节点的 warm 信息丢失 → 可能回落冷节点新开 Chrome，与"孤儿复用优先"承诺冲突）。另：attach-live 不开新会话（`remote-session-service.js:298-306`）、menu-scan `preferIdleChrome:false`（`menu-scan-session.js:63`）→ 两者 failover 无害。

### 4.7 T8：metrics 落内存 registry 而非心跳 DB 写路径；openFailures 不存在且依赖 T2
- 每次 heartbeat 都触发 DB UPDATE（`executor-node-service.js:68-72`）；控制面不读 payload。metrics 应扩展内存 RegistryEntry（`src/executor-registry.js:6` typedef 无 metrics 字段），**不要写 executor_node 行**（每节点每 20s 一次远程写，65ms RTT 教训）。
- `openFailures` 执行机侧无任何现成统计，需新增；且执行机"open 失败"有两类——同步 throw（session.error，毫秒级）与 ready 后 process_exit（spawn 慢失败最长 90s）→ **EWMA 熔断依赖 T2 先落地**（快速失败才能快速累计样本）。Q7 顺序 T2 优先恰好覆盖，建议 T8 一节显式回指该依赖。
- 漂移检测的活性源有三个（heartbeat 20s / 服务端 pong 10s / 任意消息 touch），窗口选择需明确。

### 4.8 T5 labels 比较语义未定义
buildLabels 产出混合类型（`headed` boolean、`os` 字符串），且 `EXECUTOR_LABELS_JSON` spread 在后**可覆盖内置键**（`executor/config.js:265-269`）。T5 的"节点 labels ⊇ opts.labels"需明确 boolean/字符串比较（HTTP 传 `"headed":"true"` vs 节点 `headed:true` 是否匹配）与覆盖行为是否预期。另：preferred（指定 nodeUuid）路径绕过一切候选过滤（`executor-session-client.js:39-68`）——"指定节点 + labels 不匹配"的语义（409 还是忽略）spec 未定义。

### 4.9 `localeCompare` 非字节序，与"确定性优先"有裂缝
`:82` 与 `:102` 的 `nodeUuid.localeCompare` 无 locale 参数、依赖运行时 ICU——T1 抽纯函数时建议改码点比较（`a.nodeUuid < b.nodeUuid`）或显式 locale，并把选择写进 spec，否则"重复执行同序"钉位只钉住了进程内确定性。

### 4.10 现存超时常量全为内联 magic number
`120000` 双写（client `:209` + hub `:74` 默认）、`8000` 双写（`:54,:91`）、`15000/10000`（`:275,:325,:257`）。T2/T3/T6 恰好都要触碰这些行——建议实施约定补一句"被触碰行内的裸超时提取为具名常量或 env"，防 120000 与 hub 默认值漂移。

### 4.11 T2 × batch 重试循环的耦合
T2 落地后 batch 的 409→waiting_executor 重试从"120s+500"变"毫秒 409+重试"，重试频率上升 → 每次重试都触发全节点 reconcile（`trajectory-attach-service.js:327`）+ 全候选探测。T2/T3 的 characterization 应补批量场景钉位，否则调度延迟劣化在批量下先暴露。

### 4.12 超时时间线：120s（控制面）> 90s（执行机 spawn ready）
执行机 spawn ready 超时 90s 自会 killTree 并回 `session.process_exit`（`session-slot.js:171,186-198`）；控制面 ready 超时 120s > 90s → T6 担心的"ready 超时后 agent 仍起 Chrome"窗口主要只剩"spawn 未到 90s 而控制面先超时"场景。spec 风险表建议写明这两个超时的相对大小。

### 4.13 pick 的 draining/offline 过滤基于 DB 快照
pick 与 send 之间（互斥退出后）节点可能已 draining，执行机侧拒因文案是 `'executor is draining'`（非容量文案）——**T6 的失败分类应显式涵盖"draining 拒绝"子类**，否则重选分类漏项。

---

## 5. 关键新实锤

### 5.1 openSession 调用方普查（T5/T6/T9 影响面）
定义：`src/executor-session-client.js:179`。注意 `src/services/remote-session-service.js:61` 的同名函数只是 DB 行创建，不触发执行机 open。**全仓没有任何调用方指定 nodeUuid——T6 failover 覆盖全部现网路径**。

| 调用点 | 入口链 | nodeUuid | preferIdleChrome | 场景 | T9 队列 | T5 labels |
|---|---|---|---|---|---|---|
| `trajectory-attach-service.js:338` | record/prepare（trajectory-record.js:49）、attach（:13）、批量录制 batch-record.js:170、登录录制 auth-recording-service.js:458、slot-monitor 推流按钮（POST /:id/attach） | 不传 | true | ①②⑤ 交互式 / ③④ 批量 | 仅批量候选；交互式必须 409 | prepare/attach 走 route 可扩 body（**prepare 路由现不读 body**，需四层穿透）；batch/auth 为函数调用加 opts |
| `routes/browser-session/register.js:74` | POST /api/browser/session（调试） | 不传 | 默认 true | 交互式 | 不适用 | 无 body 透传链 |
| `menu-scan-session.js:63` | scan-menu（202 异步 job） | 不传 | false | 批量后台 | 候选 | T12 天然消费者（扫描目标绑定站点） |
| `menu-scan-session.js:189` | fill-pageid（202 异步 job） | 不传 | false | 批量后台 | 候选 | 同上 |

### 5.2 门禁落点现状（T1 前置）
`pickExecutorNode` / `executor-slot-lease` / `openSession` **现有零 characterization 门禁**，T1 的 `characterize-executor-pick.mjs` 是全新落点。verify-all.sh 最近邻注册区：`:159-160`（executor-orphan-reconcile / executor-only-bib）；`:66` session-lifecycle；`:128,:153` 的 picker 系是 UI picker 与节点选点无关。

### 5.3 其他
- preferred 路径探测失败静默降级为按冷算（`executor-session-client.js:64-66` console.warn 后裸返回）——T3 缓存可依托该宽容语义。
- 同 uuid 双活拒绝 close 4001 / 同 pid 顶替 4000（`src/executor-registry.js:43,53`）；agent 本机互斥含 Windows pid cmdline 核验（`executor/config.js:142-206`）。
- 执行机 graceful shutdown：先关全部会话再 unregister（`agent.mjs:196-207`）。
- batch item 状态机已占用 `queued/waiting_executor` 术语（`catalog.js:88-89`）——T9 队列深度观测需区分口径。

---

## 6. 对开放问题 Q1–Q7 的证据补强

- **Q2（T9 队列是否值得做）**：批量录制已有 DB 队列 + 409 自动重试 + 集群空槽限流（`batch-record.js:73-80,258-279`），T9 的边际需求主要剩 menu-scan 两个异步 job；若做，需 openSession 显式 `queueEligible` opt-in（§4.5），且 503 body 风格对齐 `traj_lock_wait_timeout`。
- **Q3（client_key 谁供数）**：两个候选落点——a) HTTP 通道现成：`POST /api/v2/remote-sessions` 已透传 body（`remote-session.js:66`），缺的是调用方生态与 catalog 注册；b) **放弃 client_key 改 per-systemAccountId 配额**：`resolveTrajectoryAccount` 出的 accountId 在 attach-runner 已可得（`trajectory-attach-runner.js:67`），无需新增供数链。
- **Q6（capacity 16 是否合适）**：现网实配 4；上限另受 CDP 端口段（19242+capacity、+20 扫描、发现跨度 `max(40, capacity*20)`）与全忙 fallback 撞端口边界约束；每槽常驻不止 Chrome+Python（BiB 桥/attach 锁/stderr 缓冲）。
- **Q7（发布顺序）**：证据支持 T2 早于 T8（openFailures EWMA 依赖 session.error 毫秒级到达）；T7 排期前需先裁决亲和数据落点（含 closed 行查询 vs 新列迁移——后者与"P0/P1 无迁移"冲突）；T6 需求侧无"指定 nodeUuid"现网调用方，但 preferred 路径与 T5 labels 匹配语义需先定（§4.8）。
- Q1（W_COLD 取值）/Q4（SUT 站点）/Q5（HA 非目标）：本轮无新证据。

---

*产出方式：3 个并行只读 Explore 子智能体（控制面调度内核 / 执行机侧与生命周期 / 入口与数据面），主会话抽查 4 条载重断言后汇编。未改动任何产品代码。*
