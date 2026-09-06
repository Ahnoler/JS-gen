# 浏览器与会话生命周期 / 调用关系梳理（2026-09-05）

> 只读调研产出。三路并行 Explore（Node 控制面会话层 / 轨迹录制回放链 / Python agent 侧）+ 主线程交叉验证。
> 所有 file:line 均可核对；个别未逐行核实处已标注。**本文是"现行为真"的描述，不含改造建议。**

## 0. 一句话全景

```
前端/SSE/WS ──HTTP──▶ 控制面 Express(4097, server.mjs)
    │ 轨迹/会话/租约（DB + 内存）
    └──WS /ws/executor──▶ executor 节点(agent.mjs，主动外连，控制面从不回拨)
          │ 槽位/锁/端口（Node 单头管理）
          ├─ session-slot ──spawn──▶ python -m scripts.main --session --cdp-port <base+slot>
          │                            └─ Playwright(browser_use) + 裸 CDP(real_click) ──▶ Chromium
          └─ bib-bridge ──CDP(screencast, 直连 slot.cdpPort)──▶ Chromium   ← BiB 画布不经 Python
```

进程树：**Node(executor) → Python → Chromium**，一槽 = 一 Python = 一 Chrome = 一 agentSessionId（1:1）。

## 1. 谁管什么（双头归属裁决）

| 资源 | 管理方 | 依据 |
|---|---|---|
| executor 节点注册/心跳/下线 | 控制面（executor-ws.js:305 注册、心跳 20s、45s 断线 grace、10s sweep 过期置 offline+crash 活跃会话） | executor-node-service.js:114,172 |
| 槽位分配/回收 | executor 本地 SessionManager/SessionSlot；控制面持**内存租约**（executor-slot-lease.js 三 Map + promise 互斥，非持久） | executor-session-client.js:179 |
| CDP 端口 | **Node 单头**：`EXECUTOR_CDP_PORT_BASE` 默认 **19242**（executor/config.js:193），每槽 `base+slotIndex`，冲突向上扫 20；Python 侧 9242（factory.py:335）仅在独立裸跑 Python 时生效——**9242 不是产品端口段** | session-slot.js:35,62 |
| 进程互斥锁 | `.node-uuid.lock`（wx 独占+死 pid 接管）；多实例共存靠 `EXECUTOR_NODE_UUID` env 隔离 | executor/config.js:113-143 |
| Python 进程 | executor spawn/kill（killTree + killListenerOnPort 兜底）；cancel 信号经 `%TEMP%/browser_use_cancel_<sid>` 临时文件（唯一 Python 自有"锁"） | spawn-agent.js:158, session-slot.js:263-304 |
| 登录态 | Chrome profile 复用（`%TEMP%/jsgen-chrome-profiles/<session_id>`）+ 动作级 `login()` 探 `_usertoken`/hash（form_action_engines.py:202，同用户 reuse / 异用户 clear+reload） | factory.py:342 |

## 2. remote_session 状态机（DB，constants.js:33）

`active | idle | closed | crashed`（occupied = active+idle）；**无 draft/live**——那是 trajectory.record_status 的概念。

```
新建 ──openSession/attach──▶ active
active ──stream/detach 或 detachLive(非crashed)──▶ idle (+grace_until=+15min, 保留归属)
idle ──同 agentSession 重 attach──▶ active（跨轨迹认领受 grace_owned 409 拦截）
idle ──grace 过期(idle-reaper)──▶ 清 ownership+FK（行本身由孤儿回收处置）
active/idle ──close/crash──▶ closed|crashed（trajectory_id 置 null）
```

grace 语义：stream/detach 后 15 分钟内原 trajectory 可无争议重 attach（`canClaimRemoteSession`，session-lifecycle-rules.js:33）；他人抢占 fail-closed 409 `grace_owned`。**chunk 记忆「live→draft」是 trajectory.record_status 的 demote（demoteLive：非 AI 录制中的 recording→draft），不是 remote_session 状态。**

## 3. trajectory.record_status 与挂载

- 状态集：`draft | recording | failed | recorded | completed`（constants.js:59）；**recording 是临时态**，持久基线写 `persistent_record_status`（migration 20260818120000；写失败仅 warn 降级 = PERSIST-FAILED 坑）。
- 挂载：1:1 trajectory ↔ remote_session ↔ agent session；`syncMount`（session-lifecycle.js:64）双向写 FK 并清其它 trajectory 的挂载。
- record/stop → `recorded`/`failed`，**不动 BiB、不释放槽**；stream/detach → idle+grace，**槽保留**；detach（硬）→ `closed` + closeSession(keepBrowser:false) 杀 Python+Chrome + 释放租约，record_status 恢复持久基线。三分语义与既有认知一致。

## 4. 关键时序（产品主链，executor 模式）

**prepare**（trajectory-record.js:49 → attach-runner.js:31，`withTrajectoryLock` 串行）：
1. `openSession(preferIdleChrome:true)` → executor 找空闲槽（或复用孤儿 Chrome 走 cdp-url）→ spawn Python → Python `_build_browser`（factory.py:319）显式 exe 启动 Chromium + `--remote-debugging-port` → emit `ready`（90s 超时，超时 killTree+杀端口）。
2. `assertNoForeignGraceOnNodeSlot`：同槽他人 grace-owned → 409（attach-service.js:90）。
3. `attachLive`（remote-session-service.js:306）：supersede 旧行 → 建/复用 remote_session(active) → `syncMount` → `session.attach_bib` 等 `bib_ready`（45s；超时 close(crashed)+清 FK 防 ghost mount）。
4. `enterTransientRecording`：record_status→recording（基线入 persistent 列）。
5. `runDefaultLogin` 走回放通道（stopOnFail:true，`suppressStepPersist=true` 不落步骤；失败等 8s 重试一次）+ `bindRecordingPageId`（绝不阻断）。

**start**（recording-runner.js:266）：AI 锁 → 逐 phase 置 running → `forwardStdin {event:'step'}` → Python LLM 循环，动作经 `action_log_sync` 回推 `appendRecordedStep` 写 trajectory_step；人工动作走 `manual_action_recorded` 独立落表（source=manual/cdp 在 action_log_sync 中跳过防双写）。10 分钟无 action_log_sync 的阶段看门狗判失败。成功 `finishTransientRecording('success')`→recorded。

**stop / stream/detach / detach**：见 §3。

**replay**（trajectory-steps.js:20 → trajectory-session-replay.js:53，202 后台跑）：
`prepareReplayBatch`（读 trajectory_step，busy 时 409）→ `runReplayBatch`（replay-batch-runner.js:78）→ 菜单导航 → 逐步 `runReplayActions`（replay-actions.js:36：先挂 `replay_done` 等待+孤儿 rejection 免疫，再 `forwardStdin {event:'replay_actions', stop_on_fail:true}`）→ Python `_replay.py replay_action_entries`（直派表+save_form_snapshot+durable click，locator 链=xpath_smart → Playwright role/text 兜底 → xpath_full）→ 失败走 Type A heal（skip/retry/AI heal）与 Type B 表结构软检查点。**回放与录制共用同一 Chrome/BiB 页面**；不共用：持久化开关（isReplay 不落步骤表）与录制订阅（replay 期 action_log_sync 被拦）。

**batch**（batch-record.js:41 `pumpRecord`）：按 `capacity - slotLease.countInUse` 起 worker；无槽 409 → item 回 `waiting_executor`；单条完成即 `detachTrajectoryLive(batch_complete)` 释放槽。

**崩溃恢复**：executor 重连 `onRegistered` 拉全量 action log 补 `action_log_sync`（断线窗口不丢步骤）；孤儿会话 reconcile keepBrowser=true 变可复用孤儿；控制面启动 `recoverBatchJobsOnStartup` + 凭 DB 绑定 close(crashed) 回收。

## 5. 遗留坑位清单（代码实证）

1. PERSIST-FAILED：persistent 基线列写失败静默降级（trajectory-dao.js:392）。
2. bib_ready 超时不清 FK = ghost mount → perpetual 409 occupancy（remote-session-service.js:450 注释）。
3. grace 槽位 fail-closed：slotIndex 未知时同样拒绝（attach-service.js:43-79）。
4. supersede 只关 rs 行不关旧 Python 会话 → 旧 Chrome 成不可达孤儿（remote-session-service.js:272 注释）。
5. `_aiRecordUnsub` detach 时故意不退订（等最终截图），泄漏风险依赖 closeSession 必达（attach-service.js:471）。
6. userStop vs abort 竞态：runner catch 须查 runtime.userStop 防覆盖终态（recording-runner.js:792）。
7. record/stop 不等 busy（可能 stale）直接 cancel_step（record-lifecycle.js:321）。
8. login 冷启动 8s 重试是启发式非事件驱动（attach-runner.js:197）。
9. withTrajectoryLock 跨请求排队而非快速失败（超时上限未核实）。
10. Phase 空闲看门狗 10min；phase_done 本身无固定超时。

## 6. 未核实遗留

- Python agent 精确 spawn 时点在 executor session-manager 内部（行为已确认，行号未钉）。
- `rerun-replay-service.js` 的触发端点未核实（工程调试面）。
- executor WS 半开检测的具体超时参数（config.js:199-210 有配置项，ws-client 未逐行读）。
