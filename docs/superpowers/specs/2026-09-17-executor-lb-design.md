# Design: 执行机多节点负载均衡（executor LB）

**日期**：2026-09-17
**状态**：**草案，待控制面负责同事评审** —— 评审通过前不落任何实现
**作者**：DSH（用户委托，基于 2026-09-17 上午的全量源码调研成文；所有 file:line 锚点均实读核实）
**影响面**：控制面调度内核（`src/executor-*`、`src/services/executor-node-service.js`）；执行机侧仅 heartbeat 负载增量字段；P0/P1 无 DB 迁移；HTTP API 仅新增可选字段
**协作约定**：遵循 `AGENTS.md`（开工/收工声明、JSDoc 规范、characterization 门禁、`src/dashboard/api-docs/catalog.js` 为唯一前端契约）

---

## 1. 背景与现状速查

### 1.1 拓扑

- **控制面**（`server.mjs`，4097，单进程）：注册表、槽位租约、调度选点、对账、观测。**永不出拨**，只持有执行机入站 WS。
- **执行机**（`npm run executor` → `executor/agent.mjs`）：出站 WS 注册；持有 `EXECUTOR_CAPACITY`（默认 16）个槽位，每槽 = 1 个 Python agent 子进程 + 1 个 CDP Chrome（端口 `EXECUTOR_CDP_PORT_BASE(19242)+slotIndex`，满则 +20 内扫描）。
- 身份：`nodeUuid` 持久化于 `executor/.node-uuid`；register 负载 `{nodeUuid,name,host,capacity,labels,agentVersion,pid}`（`executor/agent.mjs:103`）；同 uuid 本机启动互斥锁（Windows pid 复用有 cmdline 核验）。

### 1.2 现状速查表（file:line 锚点）

| 关注点 | 现状 | 锚点 |
|---|---|---|
| 注册 | 出站 WS `/ws/executor` token 校验 → `executor_node` upsert → 内存注册表；同 uuid 异 pid 双活拒绝（close 4001），同 pid 重连顶替（4000） | `src/executor-ws.js`、`src/executor-registry.js` |
| 注册后对账 | `reconcileRemoteSessions`（执行机 `session.list` 为权威）+ 孤儿会话收敛（keepBrowser=true → 可复用孤儿 CDP） | `src/services/executor-node-service.js` |
| 心跳 | 服务端 ping 10s；执行机 heartbeat 20s / ack 超时 40s（半开主动 terminate）/ 断线看门狗 30s 杀会话 | `src/executor-ws.js`、`executor/ws-client.js` |
| 下线 | 断线 grace 45s → offline + crash active/idle 会话 + 清租约；心跳 sweep 45s 每 ≥15s 扫 | `src/services/executor-node-service.js`、`server.mjs:165-176`、`config/config.js:155-161` |
| drain | HTTP 手动触发 → 状态 draining + WS 通知；执行机拒新 `session.open`；调度器跳过 draining/offline | `src/routes/v2/executor.js`、`executor/agent.mjs:115` |
| **选点** | 最少占用（inUse 升序，uuid 字典序 tiebreak）+ 孤儿 Chrome 优先（全候选并行 `session.list_cdp` 8s，**凌驾负载规则**）；全局租约互斥内 pick + pending 软预留 | `src/executor-session-client.js:23`（pick）、`:179`（openSession） |
| 租约 | 控制面内存三索引（slotKey/sessionId/trajectoryId）+ 每节点 pending；`session.ready` 携执行机自报 slotIndex 时 confirm；**执行机侧 `_findFreeSlot` 是容量最终守门**（防超分双保险） | `src/executor-slot-lease.js`、`executor/session-manager.js` |
| 入口 | `POST /api/v2/trajectories/:id/record/prepare` → attach → `openSession`；另有 attach-live / menu-scan / browser-session 等入口 | `src/routes/v2/trajectory-record.js:49`、`src/services/trajectory/trajectory-attach-service.js:338` |
| 亲和数据 | `remote_session` 已有 `executor_node_id`/`slot_index`/`client_key` 列，**调度器一个都没消费** | `migrations/20260716150632_executor_node.js`、`src/models/entities.js:77` |
| 满载语义 | 立即 409 附 holders（`noFreeSlotsError`/`noExecutorOnlineError`）；无队列无等待 | `src/executor-slot-lease.js` |
| 观测 | `/api/v2/executors`（list/detail/drain/孤儿会话关闭）+ slot-monitor 面板 | `src/routes/v2/executor.js`、`src/dashboard/api-docs/slot-monitor.js` |

### 1.3 多机现状结论

注册/心跳/对账/槽位守门/断线恢复**已多机安全**（注册按 uuid 独立 upsert；CDP 端口每机本地；执行机侧准入兜底）。短板集中在**选点策略与调度语义**（下节 G 清单），不在于基础设施。

---

## 2. 缺口清单（G1–G11，供任务反查）

| # | 缺口 | 证据 |
|---|---|---|
| G1 | 选点逻辑内嵌在 `executor-session-client.js`（DAO/registry/CDP 探测耦合），无法对"打分"做纯函数 characterization | `src/executor-session-client.js:23` |
| G2 | 孤儿 Chrome 优先**无条件凌驾负载**：15/16 但有 warm Chrome 的节点先于 2/16 空载节点 → 多机负载倾斜 | `src/executor-session-client.js` probed.sort（idleChrome 先于 inUse） |
| G3 | **执行机侧拒绝慢失败**：执行机回 `session.error`（槽满/draining，`executor/agent.mjs:181`），但控制面 `openSession` 只 `waitForSessionEvent('session.ready', 120000)`（`src/executor-event-hub.js:74` 只等单一事件类型）→ 拒绝退化为 **120s 挂起 + 超时消息不匹配 409 正则 → 以 500 抛出** | `src/executor-session-client.js:179-240` |
| G4 | open 失败无 failover：任一节点级失败 → 整单失败（不重选其他节点） | 同上 |
| G5 | 每次 open 对全部候选并行 `list_cdp`（8s 超时）且在**全局**租约互斥内 → 调度延迟随节点数增长 | `src/executor-session-client.js` + `withLeaseMutex` |
| G6 | `labels`/`agentVersion` 已入库不参与调度（无能力路由、无版本灰度挂钩） | `executor/config.js` buildLabels、DAO |
| G7 | 轨迹亲和缺失：重 prepare 不保证回原节点（丢 warm Chrome/登录态）；`client_key` 无任何调用方供数 | `remote-session-service.js:344` 附近不传 clientKey |
| G8 | 满载即 409，无排队语义（交互式合理，批量回放/批量推送不适） | `noFreeSlotsError` |
| G9 | 心跳只带活性无健康信号；无节点级熔断/降级 | `executor/ws-client.js` heartbeat |
| G10 | 无租户配额（单 clientKey 可占满集群） | — |
| G11 | SUT 可达性未建模：不同执行机可达不同内网/不同 SUT 实例，调度无硬过滤前提 | 架构事实（`executor/ws-client.js` 头注释部署定案） |

---

## 3. 设计原则与总览

**原则**

1. **执行机侧 `_findFreeSlot` 是容量最终守门**。控制面的一切视图（租约、健康分、自报空槽）只允许影响"选哪个节点"，不允许绕过执行机准入——防超分是既有双保险，不得弱化。
2. **确定性优先**：同输入同选点；`nodeUuid` 字典序保留为终局 tiebreak；所有权重/阈值 env 可调；每个行为变更配 characterization 钉位。
3. **协议只增不改**：WS heartbeat 增量字段对旧 agent 缺省安全；HTTP 仅新增可选字段；409 `{error,holders}` 形状不动。
4. **内存态够用**：租约/队列/健康分全放控制面内存（与现状一致；重启靠执行机重连重注册 + DB `remote_session` 对账恢复，机制已在）。不引入分布式存储，不做控制面 HA（见 Q5）。

**阶段**：P0 调度内核（T1–T6，纯控制面、每项独立可发布）→ P1 调度语义（T7–T10：亲和/健康/队列/配额）→ P2 运维规模化（T11–T14：版本灰度/SUT 站点/对账常态化/决策留痕）。

---

## 4. P0 — 调度内核（T1–T6）

### T1 选点核抽纯函数（前置，无行为变更）

新 `src/executor-pick.js`：
- `buildCandidates({ dbNodes, live, leases, pending })` —— 过滤 connected、非 draining/offline、`inUse < capacity`；
- `scoreAndSort(candidates, weights)` —— **纯函数**（同输入同输出，无 IO）。

`pickExecutorNode` 退化为编排器（IO + 全局互斥 + pending 预留），行为逐位不变。

**理由**：G1——现状打分与 IO 耦合，T4/T5/T7 的 characterization 无落点；先抽纯函数是其余任务的钉位前提。

**钉位**：新 `scripts/characterization/characterize-executor-pick.mjs`（负载序、uuid tiebreak、warm 奖励、labels 过滤、确定性=重复执行同序）。注意 `scripts/refactor/verify-all.sh` 为跨线热文件，注册动作需与在途线协调（门禁文件先保持独立可运行）。

### T2 `session.error` 快速失败（修 G3，小而独立）

现状：执行机侧拒绝（槽满/draining/open 异常）→ `session.error {sessionId,error}` 回发（`executor/agent.mjs:181`），但 `openSession` 的 `waitForSessionEvent(sessionId,'session.ready',120000)` 不监听 `session.error` → **120s 挂起**，超时消息 `Timeout waiting for session.ready` 不匹配 409 正则 → **500**（丢失真实原因与 holders 语义）。

**设计**：`openSession` 内以 `Promise.race` 竞争 `session.ready` 与 `session.error`（同 sessionId 的 hub 事件，`src/executor-event-hub.js`）：`session.error` 到达 → 立即 reject（错误信息透传 executor 原文），保留现有 409 映射正则（`No free executor slots` → `noFreeSlotsError` 形状）。ready 竞争失败方照旧 no-op 消费（防 unhandledRejection，沿 2026-08-29 事故口径）。

**钉位**：executor 回 error → 毫秒级失败且 409 形状正确；无 error 时行为逐位不变。

### T3 孤儿 Chrome 探测缓存（修 G5）

现状：每次 open 对全部候选并行 `session.list_cdp`（每节点 8s 超时）且在全局租约互斥内执行。

**设计**：per-node 探测缓存，TTL 8s；失效事件（本节点）：`session.ready` / `session.closed` / `session.process_exit`。缓存 miss 且在线节点数 ≤3 时维持直探（精度不降）；>3 时只用缓存（无 warm 信息按冷算）。互斥内耗时从 O(N×probe) 降为 O(1)。

**防误复用**：缓存只可能把"孤儿 Chrome 已被占"看错成"仍空闲"——由既有 `assertNoForeignGraceOnNodeSlot`（`trajectory-attach-service.js:91`）+ 执行机侧 `--cdp-url` 复用的进程互斥兜底；事件失效已覆盖主要窗口。

**钉位**：缓存命中不再重复 `list_cdp`（可注入假时钟）；`session.closed` 后缓存立即失效。

### T4 打分选点（修 G2，泛化"最少占用+warm"）

```
score(node) = W_LOAD × inUse/capacity + (hasWarmChrome ? 0 : W_COLD) + healthPenalty(T8，默认 0) − affinityBonus(T7，默认 0)
```

低者胜；tiebreak `nodeUuid` 字典序（确定性）。默认 `W_LOAD=10`、`W_COLD=3`（warm Chrome ≈ 0.3 个槽位），env `EXECUTOR_LB_W_LOAD`/`EXECUTOR_LB_W_COLD` 可调。**单节点行为逐位不变**；多节点消除"warm 无条件凌驾负载"的倾斜（G2）。

**钉位**：T1 纯函数上断言——warm 奖励可被 ≥0.3 槽位的负载差逆转；满载临界下不再选出 15/16+warm 而弃 2/16 无 warm。

### T5 labels 必需匹配过滤（修 G6 前半）

`pickExecutorNode(opts.labels)`：候选须 `node.labels ⊇ opts.labels`（子集匹配；节点无 labels 视为空 map，仅当 `opts.labels` 为空时可选）。HTTP：`record/prepare` 与 `attach-live` body 增**可选** `labels`；`/api/docs` `catalog.js` 同步（唯一前端契约义务）。

首批用途：`headed`、`os`；未来 SUT 站点（T12）的地基。

### T6 open 失败 failover 重选（修 G4）

仅限**未指定 nodeUuid** 的全局调度路径（指定节点的调用方语义维持"指定即所求"）：

- 失败分类与动作：
  - 执行机 409-容量（T2 快速失败后为毫秒级；执行机真值纠正了控制面视图）→ 重选并**排除该节点**；
  - `sendToExecutor` 同步抛 not-connected（节点恰好断开）→ 重选排除；
  - `session.ready` 超时 → 先 best-effort `session.close`（防 Python 僵尸起 Chrome），再重选排除；
- **有界**：最多额外 2 次重选或候选耗尽；每次重选 `sessionId` 重新 randomUUID（无碰撞）；全失败抛最后一次错误（409/500 语义不变）；
- pending 预留在每次失败时释放（现有 catch 已做，重选路径复用）。

**钉位**：排除已败节点、重选上限、成功即停、409 形状透传。

---

## 5. P1 — 调度语义（T7–T10）

### T7 轨迹亲和 sticky node（修 G7）

数据已在：`remote_session.executor_node_id`（持久）。选点前查该 trajectory 最近一行非 crashed 的 `remote_session` → 其节点作为 sticky 候选，打分减 `W_AFFINITY`（默认 5 = 盖过 warm 缺失、盖不过约半载）；节点 offline/draining/满 → 自然回落全局打分（T4 公式）。`client_key` 粘性**暂缓**（供数链路缺失，见 Q3）。

**钉位**：sticky 命中（节点健康有余量）/ 回落（节点离线或满）两分支。

### T8 心跳健康信号 + 熔断（修 G9）

执行机 `executor.heartbeat` payload 增**可选** `metrics`：`{ freeSlots, sessionCount, openFailures, agentUptimeSec }`（`SessionManager.list()` 派生；旧 agent 缺省 → 中性，双向兼容）。控制面 per-node 维护：

- 自报 `freeSlots` 与租约计数漂移超阈 → 触发 `reconcileLeasesWithExecutor`（现仅在每次 record/prepare 时对全部 live 节点触发，`trajectory-attach-service.js:327`）；
- open 失败率 EWMA 超阈 → 熔断：节点从候选摘除 cooldown（默认 60s），API 标 `degraded:true`。**红线：熔断只影响选点，不触碰在跑会话与对账**。

### T9 批量准入队列（修 G8；env 门，默认关）

仅新增**批量入口**使用（回放/批量推送）；交互式 record/prepare 维持立即 409。新 `src/executor-queue.js`：全局 FIFO（上限 2×集群总槽位）+ 条目 TTL（默认 5min，超时 503 带 `{queued:true,dropped:'ttl'}`）；槽位释放事件唤醒出队；出队后走正常 pick（可携 labels）。队列条目**不占租约**。

**钉位**：FIFO 序、TTL 超时、释放唤醒、门关时直通 409（现行为）。

### T10 租户配额（修 G10；**依赖 Q3，未决不排期**）

per `client_key` 并发槽位上限（env，默认不限）；准入口径 = 内存租约 + DB active/idle 计数；超限 409 附 holders 与 `reason='tenant_quota'`。

---

## 6. P2 — 运维与规模（T11–T14）

- **T11 版本灰度编排（G6 后半）**：`agentVersion` 分组视图 + 批量 drain 端点/脚本；drain/重注册/对账机制已就绪，只差编排与操作文档。
- **T12 SUT 站点硬过滤（修 G11；依赖 Q4）**：`labels.sut` 声明节点可达站点；选点第一道硬过滤、第二道组内打分。无 `sut` 标签的节点 = 万能（向后兼容：现单站点部署零配置不受影响）。
- **T13 容量对账常态化**：周期（默认 60s）对 connected 节点 `reconcileLeasesWithExecutor` + T8 漂移触发，替代"仅 prepare 时全节点对账"。
- **T14 决策留痕 + 集群观测**：env 门控单行日志 `[executor-pick] traj=… chosen=… candidates=[{uuid,inUse,cap,warm,score}]`（调参依据）；slot-monitor 增队列深度/`degraded`/健康分；api-docs 同步。

---

## 7. 兼容性与契约义务

| 面 | 变更 | 兼容性 |
|---|---|---|
| WS `executor.heartbeat` | payload 增可选 `metrics`（T8） | 旧 agent/旧控制面双向缺省安全 |
| WS `session.error` | 不改报文，只改控制面消费方式（T2） | 纯控制面行为修复 |
| HTTP prepare/attach-live | body 增可选 `labels`（T5） | 旧前端不传 = 现行为 |
| 409 | 形状不变（`error`+`holders`）；T2 修复后槽满从"120s+500"归位为"毫秒+409" | 语义修正，形状不变 |
| 503（T9 新） | 队列满 / TTL 超时，仅批量入口 | 新语义 |
| `/api/docs` | 任何 HTTP 增量必须同步 `src/dashboard/api-docs/catalog.js` | AGENTS.md 唯一前端契约 |
| 工程约定 | 新公开函数必须 JSDoc（`@param`/`@returns`）；零新增 lint warning；不手改生成物 | AGENTS.md 硬约定 |

---

## 8. 风险与回退

| 风险 | 缓解 | 回退 |
|---|---|---|
| 权重失谐（冷启动风暴 / 负载倾斜） | env 可调 + T14 决策日志调参 | 权重设回默认即等价旧行为；单节点逐位不变是回归底线 |
| failover 僵尸 Python（ready 超时后 agent 仍起 Chrome） | 重选前 best-effort `session.close`；漏网由孤儿对账（注册时 + T13 周期）兜底 | T6 独立发布可单独 revert |
| 探测缓存陈旧误复用 | TTL 8s + 三事件失效 + 既有 `assertNoForeignGraceOnNodeSlot` 守卫 | 关缓存 = 现状 |
| 全局互斥仍串行 pick | T3 后互斥内 O(1)；p99 劣化再评估 per-node mutex（另立项） | — |
| `session.error` 竞争引入误杀（error 与 ready 乱序竞态） | error 仅在该 sessionId 的 hub 上；ready 已到则 error 忽略（race 单胜者） | T2 独立 revert |
| verify-all.sh 跨线热文件冲突 | 注册动作协调或延后；门禁文件保持独立可运行 | — |

---

## 9. 明确不做（Out of scope）

- 控制面 HA / 分布式租约存储（内存 + 重连对账已闭环，见 Q5）；
- 执行机自动扩缩容与供给流水线；
- 跨控制面集群调度；
- 改变槽位模型（1 slot = 1 Python agent + 1 CDP Chrome）；
- per-node token / mTLS（记安全 backlog）。

---

## 10. 给评审人的开放问题

- **Q1** `W_COLD=3`（warm ≈ 0.3 槽位）默认是否合适？建议多节点实测后按 T14 决策日志调参。
- **Q2** 批量回放/批量推送的并发量级目标——T9 队列是否值得做？上限/TTL 取值？
- **Q3** `client_key` 谁供数？当前全链路无调用方传入（`remote-session-service.js:344` 不传）；T10 依赖此项。
- **Q4** SUT 站点规划：几个站点？`labels.sut` 由谁维护？轨迹如何声明目标站点？（T12 依赖）
- **Q5** 控制面 HA 确认为非目标？
- **Q6** `EXECUTOR_CAPACITY` 默认 16/节点是否符合目标硬件画像（每槽 ≈ 1 Chrome + 1 Python 常驻内存）？
- **Q7** 发布顺序建议 **T1→T2→T3→T4→T5→T6**（T2 语义修复最优先、最小；T6 最后因涉及错误路径），有无异议？

---

## 11. 实施约定（给实现同事）

- 每个任务独立 commit + 独立可发布；发布前 `bash scripts/refactor/verify-all.sh` 与**改动前基线**对比（近期基线为既有 4 红：step-highlight / layer-tree / confirm-notification / network-capture，以实跑为准），不得新增红。
- 每个行为变更同 commit 附 characterization 钉位（证伪自证：钉必须能红）。
- 公开函数 JSDoc 齐备；`npm run lint` 零新增 warning。
- 动工前按 `AGENTS.md` 在 `docs/superpowers/agent-log.md` 插开工声明并 commit+push。
