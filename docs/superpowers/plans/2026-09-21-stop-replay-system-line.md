# 停止回放系统线缺陷修复计划（SDD）

Plan: docs/superpowers/plans/2026-09-21-stop-replay-system-line.md
来源：docs/reports/2026-09-21-stop-replay-defects-system-line.md（12 项）
分支：uara_V2.0 直接作业（共享主检出，主线程显式 pathspec 代提交，子智能体不 commit）
验收基线：全量 verify-all ALL GREEN（2026-09-21 44164f30 起 KNOWN_BASELINE_RED 清空）

## Global Constraints

- 只改 src/ 控制面侧 + 新 pin + verify-all.sh 注册行；**不碰 scripts/ 引擎侧**（_replay.py / replay_table.py / agent/ / session_runner.py 是引擎线 E1-E4 范围）。
- 不碰 D2 线文件：phase-done-evidence-gate.js、src/models/failure-reason.js、src/dashboard/api-docs/groups/trajectory.js、characterize-phase-done-evidence-gate / characterize-quality-final-gate / characterize-agent-llm-error 三枚 pin。
- 不碰 OpenCode 线刚交付的 redactSecrets / replay_plan / secret-redaction 逻辑（replay-batch-runner.js 内）。
- 每任务：实现 + pin（扩展既有或新增）+ 该 pin 单跑绿 + 改动文件 eslint 0 error；主线程代提交（中文 message、显式 pathspec）。
- 新 pin 登记 verify-all.sh 域注册表 executor 域（与 characterize-replay-batch 同域，参照 :84/:213-217 行式样）。
- JSDoc 规范：公开函数有 JSDoc；只插入不删改既有行（硬约定）；不引入新 eslint warning。
- 停止语义契约（api-docs recording.js:209-213）：stop 不改 recordStatus、不释放槽位——所有修复保持该边界。

## Task 1: #2 Type B 删步 abort 守卫（form-structure-heal.js）

form-structure-heal.js 删步段（removeById :330 / reorderByTrajectory :341）不读 runtime.abortReplay——用户 stop 后过时扫描结果仍永久删除已录 fill 步骤。修复：Type B 扫描（runReplayActions）返回后、进入 parse→safety→needsTypeB 判定**之前**检查 `runtime.abortReplay`，置位即按 user-abort 语义返回（对齐既有 userAbort 返回形状，replay-batch-runner.js 的 typeB.userAbort 分支 :171-181 会 emitReplayAborted 收敛）。同时删除/插入循环（:304-348 与 :394-403）每轮循环头加检查（防长删除列表中途 stop）。pin：扩展 characterize-stop-semantics.mjs 或新增断言——stub runtime.abortReplay=true 时 handleFormStructureCheckpoint 不调 removeById。

## Task 2: #3 agent_stopped reason 区分 + #11 heal 超时补发 cancel_step（replay-heal-shared.js）

#3：replay-heal-shared.js:143-149 的 `unsubStopped` 监听把任何 agent_stopped 一律当用户中断。Python 侧 data 带 reason（agent/service.py:78：'cancel_step' | 'new_step_arrived'）。修复：回调读 `payload?.reason`——'cancel_step' → 保持现状（abortReplay=true + USER_ABORT）；'new_step_arrived' → **不置 abortReplay**，reject 普通 Error（带 reason 信息），走 heal 失败重试路径。同步检查 api-docs/groups/recording.js:212-213 契约行是否需措辞更新（登记即可，若该行语义仍成立则不动）。
#11：replay-heal-shared.js:150-154 超时 reject 前补发 cancel_step（try/catch warn，对齐 replay-actions.js:177-189 的 fire-and-forget 模式）。
pin：断言 reason 分流 + 超时补发。

## Task 3: #4 超时竞态终态口径 + #12 中止步无终态（replay-batch-runner.js）

#4：单步 catch（abortReplay 读点列表之外，当前 catch 在 :296 附近——以 runtime.abortReplay grep 定位）不查 abortReplay，终态发 `replay:finished {error}`。修复：catch 内先查 `runtime.abortReplay` → 走 emitReplayAborted + buildPayload aborted 收敛，并把本步记入 failedStepIds 与 allResults（保持落库口径）。
#12：循环中止检查点（:342 附近，:258 旧号）丢弃当前步前补发 `emitReplay('replay:step', {status:'failed', error:'user_stop'})`（或专用 aborted 状态），使前端条目不悬挂。
pin：扩展 characterize-stop-semantics.mjs——超时+abort 竞态发 aborted 终态；中止分支当前步有终态事件。

## Task 4: #5 stop 诚实化 + #8 录制期拒绝 + #13 sync busy 泄漏（trajectory-session-replay.js + trajectory-runtime.js）

runtime 增 `replayRunning: false`（trajectory-runtime.js 默认字段）；runReplayBatch 开始置 true、finally 复位 false（replay-batch-runner.js，本任务只加这两行，与 Task 5 不冲突）。
stopTrajectoryStepsReplay（:179-197）：`replayRunning` 为 false → 直接返回 `{trajectoryId, trajectoryDbId, stopped:false, batchWasRunning:false, reason:'no_replay_batch_running'}`，**不置 abortReplay、不发 cancel_step**（同时解决 #16 空闲期残留与 #8 录制期误杀——录制时 replayRunning 必为 false）；为 true → 现行为 + 返回 `{stopped:true, batchWasRunning:true, cancelStepDelivered:<bool>}`。api-docs/groups/recording.js 的 stop 端点文档同步字段（注意只动 recording.js 的 stop 段，不碰 D2 线的 trajectory.js）。
#13：sync 路径 replayTrajectorySteps（:151-170）finally 空壳 → 补 catch 复位（对齐 accept 路径 :113-128 的复位字段集）。
pin：stop 幂等/诚实返回/录制期不发 cancel_step。

## Task 5: #6 busy 原子置位 + 世代令牌（trajectory-session-replay.js + replay-batch-runner.js）

#6：busy 检查（prepareReplayBatch :355）与置位（accept :93）之间隔 await continuation 调度，微任务级竞窗可双开 batch。修复：busy 检查通过后**同步立即置位**（同一同步段内 `if (session?.busy) throw; if (session) session.busy = true;`），prepare 后续 throw 路径在原地 try/catch 复位 busy 后 rethrow；accept 不再置位（保留幂等赋值亦可）。
世代令牌：runtime 增 `replayBatchSeq: 0`（trajectory-runtime.js）；accept/sync 起跑前 `runtime.replayBatchSeq = (runtime.replayBatchSeq || 0) + 1` 并把 seq 传给 runReplayBatch；finally 复位 abortReplay 等字段时仅当 `runtime.replayBatchSeq === seq`（防先结束批次复位后到批次的标志）。stop 语义不变（abortReplay 属于当前唯一在跑批次）。
pin：并发双 accept 仅一起跑（prepare busy 原子）+ finally 世代守卫。

## Task 6: #9 detach/整机失联终态事件（trajectory-attach-service.js + executor-node-service.js）

①detachTrajectoryLive（:640-676 区段，以实际 grep 为准）对在跑 batch（runtime.replayRunning）置 `runtime.abortReplay = true`，让批循环在步边界快速收敛（session 即将关闭，无需 cancel_step）。
②executor-node-service.js purgeNodeBindings（:23-48）/ markOfflineAndCrash（:140-145）：节点失联清绑定时不向 session hub emit 任何事件 → 4a282cbd 终态竞速在「执行机整机失联」路径等不到事件。修复：对每个被清除的 active session 向 hub emit `session.process_exit`（payload 对齐 executor-session-client 既有形态，带 sessionId/nodeUuid 与 reason:'node_offline'）——先读 executor-session-client.js / executor-event-hub.js 的事件注册形态再落笔，保持 payload 结构一致。
pin：purgeNodeBindings 触发 hub emit + detach 置 abortReplay。

## 收尾

- 全量 verify-all（合并后验收，硬约定）。
- agent-log 开工条目（现在写）+ 收工条目（全部完成后）。
- 报告/docs/reports/2026-09-21-stop-replay-defects-system-line.md 标注完成状态。
