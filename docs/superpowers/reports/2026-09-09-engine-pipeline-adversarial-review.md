# 引擎录制管线对抗性 review 报告（三路并行）

> 2026-09-09 · 用户指令「引擎管线重新 review，查看漏洞」产出
> 方式：3 路只读子智能体（JS 控制面 / Python 执行机 / 跨端 hub 消费者）+ 主会话疑点自查，审查基线 HEAD≈fcace582（runId 归属隔离 2a30fc6c + 33d892ea 落库 stamp 之后）。
> 行号以审查时点为准，后续提交可能平移。**结论先行：runId 归属隔离上线即失效（P0-1），stop→重录存在级联误杀（P0-2），90s 终局门闩对 detach→重附不设防（P0-3）。**

---

## P0（用户可见破坏，建议先修）

### P0-1 runId 从未到达 Python：整条归属过滤是死代码
- 发现：Python 路 reviewer（F1）与 JS 路 reviewer（H3）独立确证。
- 链路：runner 设置 `stepData.runId`（trajectory-recording-runner.js:899）→ **`src/executor-session-client.js:351-370` session.step 白名单无 runId** → **executor 侧 `executor/session-handler.js:74-104` 二次白名单再丢一次** → Python `data.get("runId")` 恒 None（session_runner.py:578）→ 所有回带（phase_done/phase_error/phase_state_key）与落库 stamp（state.py 三处）全部省略 runId → 控制面 `phaseEventOwnership` 判 legacy 全部放行。
- 后果：跨 run 串台修复（2a30fc6c + 33d892ea）在生产只剩 phaseNumber 窄化 + canceled 标记两个护栏；旧 run 僵尸事件的误吃窗口在兼容期名义下全部敞开。铁证：生产日志每条 phase_done 都打 `phase_done_missing_runid`。
- 为什么 verify-all 没抓到：两侧端点各有 pin（characterize-phase-done-runid.py / characterize-run-event-ownership.mjs），中间两跳白名单无任何 pin——**与 B1 arity 同型：接线层的接缝没有真实形状测试**。
- 修复方向：两处白名单补 `runId`（约 2 行）+ 新增端到端桥接 characterization（断言 step→Python→回带全链 runId 不丢）。

### P0-2 stop→重录级联误杀（三方共证，JS 路给出最完整爆炸半径）
- 时序：用户 stop（lifecycle.js:421-458 只设 abortRecording+发 cancel_step，**不 resolve 竞速**）→ Python agent 边界停下吐 `phase_done{canceled:true}` → owned 等待无条件忽略（run-event-ownership.js:63-66）→ runner 挂在 `Promise.race` 等 10 分钟 idleP。
- 分支 A（不重录）：10 分钟后 idleP 超时，stop 已写过终态所以无覆盖，但 `appendPhaseDoneLog` 往刚标完成的阶段写伪失败注记；期间 record/start 若挂着则 10 分钟后 500。
- 分支 B（10 分钟内重录，cascade）：新 run 复用**同一 runtime 对象**并重置 `userStop=null/abortRecording=false/_sentStepThisRun` → 旧循环 idleP 到点后走 catch：`runtime.userStop` 已被新 run 清空 → 误判自动失败 → `finishTransientRecording('failure')` 覆盖新 run 的 recording 态、`updateRunningStatus('failed')` 把**新 run 正在跑的阶段**标失败、失败文本写进新 run 的阶段日志（:1106-1122）；finally 再清掉 `session.busy/aiRecording/activePhaseId`（新 run 的 UI 锁当场掉线）并因 `_sentStepThisRun=true`（新 run 置位）补发 cancel_step → **新 run 当前 agent 被砍** → 新 run 的 done 也带 canceled → 同样挂 10 分钟 → 双录皆死、轨迹终态 failed。
- 根因三层：canceled 一律忽略使 stop 失去快速退出路径；catch/finally 的副作用只看共享 runtime 字段不看 run 归属；stop 不 resolve 竞速。
- 修复方向：①own-run canceled done 改为 resolve（循环继续走到 abort 检查点 :922 抛 Recording aborted，秒级退出且不按成功计——满足 spec 4.3.2「不计入阶段完成」）；或 stop 侧按 runId reject 竞速。②catch/finally 所有写库/清锁/发 cancel_step 前校验 `runtime.currentRunId === myRunId`。

### P0-3 90s 假成功终局门闩对 detach→重附不设防（跨端路 F-2）
- `gateRunId = runtime.currentRunId`（runner.js:945-947）比对的是**被捕获的旧 runtime 对象**——detach 删 runtime、重附建新对象后，旧 gate 的守卫恒真：90s 到点对**正在录制的 run N+1** 执行 `refreshTrajectoryCounts` → 双零时 `finishTransientRecording('failure')` + `fake_success_detected` 广播 + `clearActionLogCopy` 清掉新 run 的副本；per-run 零步降级分支读的也是旧对象的 phaseStepCounts。
- 同 runtime 重录场景守卫有效（currentRunId 在同一对象上被改写），洞口恰好只在 detach→re-attach。
- 修复方向：gate 内解析 live runtime 并要求三重条件 `getTrajectoryRuntime(tid) === runtime && state.sessions.has(sessionId) && !(await isAiRecordingActive(tid))`，写库前加 CAS（仅 recorded 态可降级）；顺带把 currentRunId 铸造提前到 enterTransientRecording 之前（JS 路 H5：登录窗口内 gate 有盲区）。

## P1（退化/数据正确性风险）

### P1-4 phase_error 的 phase 用了会话累计 step_idx（三方共证）
- service.py:647/:657 `"phase": step_index`（session 级计数器，跨阶段跨 run 永不复位，session_runner.py:402/:569）；owned 等待按 phaseNumber 过滤 → 首轮 phase 1 之外的一切 agent 异常都被当串台丢弃 → 不快速失败、真实错误信息丢失、挂满 10 分钟。重录越多 step_idx 越大，必错。
- 同源问题：phase_start/phase_end/phase_intent_obs/phase_boundary_obs 也用 step_idx（service.py:402/419/434/441/448/698/713），事件日志归属全错；`make_step_callback(step_index*100)` 进度步号同理。
- 修复方向：state.py 补 `get_current_phase()`（set_current_phase 已由 _run_step 每阶段正确调用，session_runner.py:429），service.py 全部事件改用它；`_run_step` 的早退/异常路径（output_path=None、BaseException→通用 error 事件，Python 路 F3）也必须吐 phase_error——目前这些路径既无 done 也无 error，同样挂看门狗。

### P1-5 record/start 并发无互斥 + batch 把 409 误判成无槽（JS 路 H4）
- 唯一并发闸是 DB `isAiRecordingActive`，而阶段置 running 在登录（可长达 ~4 分钟）之后 → 双击/批量+手工并发双 start 都过闸，双循环互砍同一 session。batch-record.js:177-179 把守卫 409 归类为无槽 → item 静默回 `waiting_executor` 重试 → **同一轨迹在批次里出现两次会被录两遍（步骤双写）**。
- 修复方向：startTrajectoryRecording 入口加 per-tid 内存互斥（同步 check-and-set `runtime.aiRecording`），batch 对 statusCode 409 改判「已在录，跳过该 item」。

### P1-6 replay_done 等待无关联 + Node 超时不叫停 Python（跨端路 F-4）
- replay-actions.js:47-85 / rerun-replay-service.js:73 按 (sessionId,type) 等待；长链超时后 Python 继续跑，随后 record/start 的登录 replay 的 doneP 可能被**旧 replay 的 done** 满足 → okCount 校验建立在陈旧计数上（lifecycle.js:377-379），登录实际未执行也放行录制。
- 修复方向：payload 带 replayId 全链回带过滤（照抄 runId 模式）+ 超时发 cancel_step。

### P1-7 skipDefaultLogin 路径不消费旧 _ACTION_LOG → 重附后旧步重录成新步（跨端路 F-5）
- `_ACTION_LOG` 跨 run 不清（仅 save/reset/seed replay 清），sync 是全量快照只 stamp 当前 runId；正常登录路径靠 `markConsumedActionLog` 预标 persistedActionIds 兜底，`runtime.skipDefaultLogin` 分支（runner.js:316-318）跳过了这步 → detach→重附（fresh runtime）后旧条目全部重持久化并归到新 run 阶段名下。
- 修复方向：skipDefaultLogin 分支进阶段循环前调 `markConsumedActionLog(runtime)`（或发 reset_trajectory）。

## P2（加固/ Cosmetic，择要）

1. phase_state_key 守卫复位依赖 runId 变化（session_runner.py:577-584）——runId 恒 None 时永不复位：部分重录首阶段号=上轮末阶段号时「阶段开始即采第一张」丢失（修好 P0-1 后自然缓解，建议改为按 step 到达复位）。
2. `bib_resolve_element_result` 等待不滤 requestId（lifecycle.js:611-626），并发/迟到 resolve 会拿错元素（executor 已回带 requestId，一行过滤可修）。
3. 跨 run 合并删除：`state.py:828-843` 新 run 首步对旧 run 末条目 coalesce，removedIds 把上轮已持久化步骤删掉；建议 ActionEntry stamp runId，跨 run 跳过 coalesce。
4. `bib_phase_highlight_capture_result`（phase-highlight-screenshot.js:92-103）无 requestId 过滤，done 高亮与组拍并发时交叉投递。
5. `manual_record_status`/`bib_ready`/`bib_error` 小竞态：快速 off→on 切换可能让 stop-ack 满足 start 等待；迟到的 bib_error 污染下一次 attach 状态。
6. finalize `fake_success_detected.failedPhases` 载荷报的是 phase **DB id** 而非 phaseNumber（:1070-1075 双键迭代+对象身份去重），前端诊断误导。
7. forwardStdin 同步抛错（executor 掉线）时该阶段 owned-wait 监听器泄漏到 hub 关闭为止（:908 在 try/finally 之外）；无 unhandledRejection（有预挂 catch）。
8. stop→detach 场景安全面已核：hub 移除静默清 waiter、executor Unknown session→session.error 无人消费、DAO 行仍在——无错误风暴，只剩 P0-2/P0-3 的覆盖风险；批量 item 租约 `BATCH_ITEM_LEASE_MS` 是否 ≥10 分钟需湿测确认（否则 item 双跑）。
9. toast 扫描游标跨导航/跨 run 污染（step_notice.py:106-119）：页面跳转后 `log_len < cursor` 不回卷 → 新页面前 N 条 toast 永久不可见 → success token 缺失误拒 done；`_step_notice_seen` 指纹跨 run 残留同效。建议 `log_len < cursor` 时重置游标、新 run 步开始清 seen/cursor。
10. `action_log_sync` 每动作全量重发（O(n²)）+ emit_json 同步写 stdout：大轨迹下管道背压会阻塞事件循环、拉长 cancel 处理窗口；建议增量/限频。legacy 兼容窗口（旧执行机无 runId → legacy 放行=原缺陷保留）按 spec 4.4 接受，以 `phase_done_missing_runid` 日志清零作为收敛信号。

## 已验证干净的面（免复查）

- 一 slot 一 Python 进程（executor/session-slot.js:2,113）：state.py 模块全局按会话隔离，跨会话 runId 互染不存在。
- 订阅生命周期：`_aiRecordUnsub` 每会话单实例、新 run 先退旧订；errP/cancel 语义、看门狗闭包、Promise 广播语义（无饥饿）、`list_result/list_cdp_result` requestId 作 hub key——均核净。
- 手工录制路径：三个落库 emitter 均 `rid is not None` 条件 stamp，无 runId 误伤。

## 建议修复顺序

1. **P0-1** 两处白名单补 runId + 端到端桥接 characterization（≈2 行改动，解锁其余全部；上线后 P2-1 同步复核）
2. **P0-2** canceled own-run done 改 resolve + catch/finally 按 runId 守卫（stop 秒退 + 级联根除）
3. **P1-4** state.get_current_phase() 统一事件归属 + `_run_step` 失败路径补发 phase_error
4. **P1-5** per-tid start 互斥 + batch 409 重归类
5. **P0-3** 90s gate 三重活性守卫 + CAS + runId 提前铸造
6. P1-6 / P1-7，再 P2 按需
7. 修复落地后按 spec §5 做真机湿测（注入伪造 done / 超时后重录 / stop 场景三件套），并补「stop→立即重录」压测用例——本轮三个 P0 全部位于现有 verify-all 盲区
