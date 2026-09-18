# stop 双实现 + 零步门禁三代杂交——收敛专项调研地图（2026-09-18）

> 产线：引擎管线（worktree `D:\dev\JS-gen-engine`，分支 `engine/pipeline-20260918`）。只读调研，本报告为挂账专项「stop 双实现 / 零步门禁三代」的实施前地图；B-1/B-2/B-3 修复设计见 `specs/2026-09-18-engine-pipeline-b123-fix-design.md`（本专项本批不实施）。
> 路径均相对 `D:\dev\JS-gen-engine`（基点 `5956ab7a`）。

## 结论先行

1. **stop 双实现**：同一「用户停止」语义两套落地——`trajectory-record-lifecycle.js` 的「路由级联版」`stopTrajectoryRecording`（L458，一次性发四条 stdin + 同步写终态）与 `trajectory-recording-runner.js` 的「响应式状态机」（读 `runtime.userStop/abortRecording` 标志、异常驱动、归属守卫、finally 补发 cancel_step）；batch 另有第三变体 `stopTrajectoryRecordingSafe`（L538，CAS-only）。
2. **零步门禁三代杂交**：v1 阶段级内联降级（recordPhaseResult L867-916）+ v1.5 total==0 异步兜底（L1200-1216）+ v2 按阶段双源（L1149-1199）+ v3 per-run 真源（L1217-1247）+ v3 同步终局（L1260-1296）同时活在 `trajectory-recording-runner.js`；G3 模块 `phase-done-evidence-gate.js` 只在 v3 per-run 分支与聚合处被调用。Python 侧另有 v1 零动作门（二次放行）与 G3 零业务步门（无限拒）两代 done 拦截并存。

## 一、stop 双实现行为差异表

| # | 实现 | 位置 | 触发入口 | cancel_step | 终态写入 | 关键差异 |
|---|------|------|----------|-------------|----------|----------|
| A | `stopTrajectoryRecording`（路由级联版） | `trajectory-record-lifecycle.js:458-528`（cancel_step L475-481；manual_record_stop L488-495；capture_screenshots off L496-503；finishTransientRecording L508-511；isDone/isSuccessful L512-515） | HTTP `POST :id/record/stop`（`src/routes/v2/trajectory-record.js:82-90`） | 发 | **无条件覆写** success/failure | 不检查当前 recordStatus；不释放槽位不 detach |
| B | runner 内部 abort 状态机 | `trajectory-recording-runner.js:953-956, 1051-1054` 检查点、`1297-1332` catch（L1310 userStopPath）、`1333-1364` finally（L1349 补发 cancel_step） | 读 A/detach 置的 `runtime.userStop/abortRecording` | 幂等补发 | userStop 时尊重 A 已写终态（L1325）；非 userStop 才写 failure | 归属守卫 `runStillOwnsRuntime`（L1301） |
| C | `stopTrajectoryRecordingSafe`（batch） | `trajectory-record-lifecycle.js:538-605`（CAS L582-596） | 仅 batch cancel（`trajectory-batch-service.js:523`） | 发 | **CAS-only**：仅 recording 时写；**不发 capture_screenshots off** | A 的分叉参数化候选 |
| D | `detachTrajectoryLive`（硬停） | `trajectory-attach-service.js:469-588`（L483-484 置标志；L538 closeSession） | `POST :id/detach`、batch cancel、idle reaper | 不发（靠杀进程） | 不写 recordStatus | 杀 Chrome+Python+槽位；90s 门闩被活性守卫跳过（runner L1083-1097） |
| E | steps/replay/stop（自愈停） | `trajectory-session-replay.js:171-193` | HTTP `POST :id/steps/replay/stop` | 发 | 不改 recordStatus | 自愈链唯一消费 `agent_stopped`（`replay-heal-shared.js:143-149`） |

**Python 侧（cancel_step 单入口、双消费路径）**：stdin 快路径 `_request_agent_stop`（`scripts/agent/service.py:43-78`，`Stop requested (cancel_step)` 日志在 L76，emit `agent_stopped` L78）；隐式 stop（新 step 到达，`scripts/session_runner.py:97-98`）；canceled 检测慢路径（`session_runner.py:508-537`，每阶段清 cancel_flag L470-475）；CancelledError → phase_error（`service.py:652-663`）。Node 侧仅消费 own-run `phase_done.canceled`（`run-event-ownership.js:62-79`）；legacy 无 runId 的 canceled 永远忽略。

**「双实现」判定**：A=命令式级联，B=响应式状态机，靠 `runtime.userStop/abortRecording` 弱耦合；C 是 A 的 CAS 分叉；D 是复用 B 标志的第三写法。A↔B 是挂账主体。

## 二、零步门禁三代对照表（Node 侧，均在 trajectory-recording-runner.js）

| 代 | 定义 | 触发 | 动作 | 调用点 | 演进 |
|----|------|------|------|--------|------|
| v1 阶段级 | `runtime.phaseStepCounts`（L827） | `phaseStepCount===0 && explicitSuccess`（L873-875） | 同步降级 `success→null` + `[0步完成]` + 登记 perRun 嫌疑 | recordPhaseResult | aab83b68 |
| v1.5 异步 total==0 兜底 | 90s finalizeGate（L1075，unref L1252） | `copySteps===0 && dbSteps===0`（L1200） | CAS recorded→failed + `fake_success_detected` | v2 嫌疑空时 fallback | f178411a |
| v2 按阶段双源 | `runtime.phaseBusinessCounts`（L829，快照 L886-892） | 嫌疑阶段副本与 DB 双源仍 0（L1152-1176） | 同上，payload 带 `zeroStepPhases` | finalize | 5d6a829a（#612/#614） |
| v3 per-run 真源 | `perRunZeroSuccessPhases`（L825）+ 复读 phaseStepCounts | `applyZeroStepFakeSuccessGate` 仍 rejected（L1222-1227） | 同上，payload 带 `perRunZeroPhases` | L1217-1247 | 7d505102 |
| v3 同步终局 | `phaseQualityFails`（L749-756）+ `aggregateTrajectorySuccessful`（L1270） | 任一阶段 success===false | 同步 `finishTransientRecording('failure')` | L1260-1296 | 7d505102 |
| G3 模块 | `phase-done-evidence-gate.js:29-50/59-68` | `stepCount===0 && success===true` → rejectedZeroStep | 拒绝 + `zero_step_rejected:` 文案 | **仅** v3 per-run L1223 与聚合 L1270（杂交核心：recordPhaseResult 内联三代不经它） | 8c07eff9；c0cfa03e 合并孤儿 `gated` → 全轨死事故，pin=`characterize-record-phase-finalize.mjs` |

Python 双门（`scripts/agent/recorder_emitters.py`，总闸 `_guard_done_on_step_end` L996-1049）：v1 零动作门 `_guard_done_reject_zero_actions` L593-627（**第二次 0 动作 done 放行**，防 max_steps 死锁）；G3 零业务步门 L381-419（`_boundary_requires_evidence` 才生效，**无限拒**）。

## 三、交互风险 Top3

1. **stop(success) 通道完全绕过全部零步门禁（当前最大假成功复活口）**：lifecycle A 无条件写 `recorded + isSuccessful=1`，不消费任何一个门；且 90s 门闩只在 phase 循环自然走完后 arm（L1075 在 try 内），stop 路径 throw `'Recording aborted'` 跳过创建——0 步录制 + 用户点 stop(success) → recorded 待确认，永久假绿（重录场景 v1.5 total==0 兜底也被旧步掩蔽）。
2. **recordPhaseResult 是关键路径，gate 抛错会伪装成「停止级联」**：c0cfa03e 合并孤儿事故即此形态（ReferenceError → 循环 abort → finally 补发 cancel_step → 整轨 failed）。三代判定顺序耦合（`success→null` 先于 v2 快照、perRun 登记依赖 v1），移动顺序会改变 `phaseOutcomes` 与下游聚合。
3. **cancel 信号三源两消费，legacy 兼容窗口是盲区**：`phase_done.canceled`（仅 own-run）/ `phase_error 'Agent run cancelled'` / `agent_stopped`（仅 heal/replay 消费）；误点 record/stop 的 cancel_step 会打进自愈链被视为用户中断（api-docs recording.js:209）；stop 成功落 recorded 后 90s 内已 armed 的门闩会用 CAS 把用户显式成功的 recorded 降级 failed——该优先级从未被 pin 固化。

## 四、收敛路线图（目标：单 gate 模块 + 单 stop 状态机）

- **Step 0（低风险先做）**：补 `characterize-stop-semantics.mjs`——钉 A/C/D 的 cancel_step/终态/CAS 差异与「stop 路径不 arm 90s 门闩」现状（现无任何 pin，只有 api-docs 文字 `api-docs/groups/recording.js:80-89,208-209`）。
- **Step 1（纯 Node 重构，micro-step）**：三代判定收进 `phase-done-evidence-gate.js` 单模块（`evaluatePhaseOutcome` + `evaluateFinalizeGate`），runner 只留 CAS+broadcast；v1.5 total==0 分支保留不删（重录掩蔽兜底）。pin：`characterize-phase-done-evidence-gate.mjs`（新）+ `characterize-record-phase-finalize.mjs`/`characterize-g3-runner-seam.mjs`/`characterize-quality-final-gate.mjs`（抽取时同步 needle）。
- **Step 2（中风险，需湿测）**：Python 双零步门收敛（`recorder_emitters.py` L593-627 v1 vs L381-419 G3）——G3 为权威，v1 收窄为无 boundary 场景降级闸；「二次 done 放行」去留需产品决策。pin=`characterize-g3-done-gate-live.py`/`characterize-phase-runtime.py`。
- **Step 3（高风险，湿测配合）**：stop 状态机单点化（A/C 合并为 `stopTrajectoryRecording(tid,{success,casOnly})`）+ 门禁覆盖 stop 通道（建议不在 stop 同步路径拦，而是 abort 路径也 arm finalize 门闩）。pin=`characterize-record-status.mjs` 等 + 新 stop×gate 交互 pin。湿测清单：stop→立即重录 race、batch cancel 中途、录制中 detach、自愈中误点 record/stop。

**顺序**：Step 0 → 1 → 2 → 3；Step 1 可立即做（有 pin 保护），Step 3 放最后（门禁语义无杂交后再单点化 stop）。
