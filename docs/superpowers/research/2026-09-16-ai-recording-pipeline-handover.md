# AI 录制管线讲解材料（接手培训用）

> 2026-09-16 三路子智能体调研汇总，与《回放管线讲解材料》（2026-09-01）配套。所有结论带 file:line。
> 一句话总纲：**AI 录制 = prepare（起会话+挂实况+自动登录）→ record/start 按 phase 循环下发指令 → Python Agent（browser-use 循环 + LLM）自主操作被测系统 → 每个动作经 `_record_action` 记入 `_ACTION_LOG` 并实时增量上报 → Node 逐条落库 trajectory_step（含定位快照/截图）→ Phase Reviewer 质量门禁 → stop 后 recorded 待确认。**

---

## 1. 三层架构

```
控制面（src/，Express 4097）        生命周期编排 / 状态机 / MySQL 落库 / 前端 WS 广播
   │ /ws/executor
执行机（executor/，主动外连 WS）     slot 管理 / spawn Python / BiB 截屏桥（CDP screencast）
   │ stdin/stdout JSON 行协议（每 slot 一个子进程）
Python Agent（scripts/）            browser-use 驱动 Chrome / 动作日志 / 截图 / phase 评审
```

- executor 槽位：CDP 端口 = `19242 + slotIndex`（executor/config.js:232，session-slot.js:62）。
- spawn 链：`openSession`（executor-session-client.js:179）→ WS `session.open` → `SessionSlot.open`（session-slot.js:76）→ `spawnAgent`（spawn-agent.js:158：`python -m scripts.main --session --cdp-port …`，角色级 LLM env 一并注入）→ 等 `ready{cdp_port}` 90s → `confirmLease`。
- 协议：下行 `forwardStdin`（executor-session-client.js:379）；上行 Python `emit_json`（agent_utils.py:47）→ executor 逐行 parse → 控制面 session hub（executor-event-hub.js:35）→ 三类订阅者。

## 2. 生命周期与 API 语义（必考）

路由：`src/routes/v2/trajectory-record.js`。

| API | 语义 | 资源影响 |
|---|---|---|
| `POST /attach` | 获取 agent 会话 + 可选 BiB，可重复（reused:true） | 开 slot/Chrome/Python |
| `POST /record/prepare` | 一键进录制间，四阶段：session→browser→stream→login | 幂等，复用已有 runtime |
| `POST /record/start` | phase 循环 AI 录制（阻塞至全部完成/失败） | 占用会话（busy） |
| `POST /record/stop` | **终结录制不终结资源**：发 cancel_step，槽/Chrome/Python/BiB 全保留 | 状态落定 recorded/failed |
| `POST /stream/detach` | **只停推流**：remote_session→idle，agent/浏览器/槽全保留 | 可重新挂流 |
| `POST /detach` | **硬关**：杀 Chrome+Python、释放 slot | 不改 recordStatus（恢复持久基线） |
| `POST /confirm` | 交易级人工确认：true→completed，false→recorded | 不碰 step.confirmed |

**record/prepare 四阶段**（trajectory-attach-runner.js:66-299，进度经 `recording:prepare` 逐段广播）：
1. session/browser：清陈旧 runtime（trajectory-runtime.js:72）→ attach（起 Python + CDP）。
2. stream：挂 BiB 实况（失败只 degraded 不阻断主链路）→ `enterTransientRecording`（recordStatus→recording 临时态）。
3. **login 默认登录**（attach-runner.js:226-263）：冷启动重试包裹（prepare-login-retry.js:23，最多 3 次指数退避）→ `runDefaultLogin`（trajectory-record-lifecycle.js:333）四重防线：登录前探测已登录签名（跳过）→ 登录组件回放 → 硬编码序列（要求 ok≥2）→ 登录期 `suppressStepPersist` **绝不落步**。
4. 起点页面绑定 pageId（recording-page-bind.js:47，失败不阻断）。

**状态机**（models/constants.js:36-71）：`recording` 是临时态，持久态 = `draft|recorded|completed|failed`（`persistent_record_status` 基线列）。success→recorded（待确认）、failure→failed；非终结操作（detach/断连/回收）恢复基线不降级（trajectory-dao.js:473）。录制中信号的真实来源 = 存在 running phase（`isAiRecordingActive`）。

**record/start 主循环**（trajectory-recording-runner.js:341-1369）：双互斥（runtime.aiRecording + running phase）→ 每 phase 置 running + 10min 空闲看门狗（:824）→ `forwardStdin step{instruction, runId, all_phases, prior_outcome, business_data…}`（:1025）→ 等 `phase_done/phase_error` → `recordPhaseResult` 收尾（phase→completed + 阶段长图，phase-highlight-screenshot.js:132）→ **假成功防线 v3**：`phase_end.quality_failed` 捕获（:736）+ 0 落库步自报成功降级（:858）+ 90s 异步终局门闩 `finalizeGate`（:1061，双源复核 + CAS recorded→failed + 广播 `fake_success_detected`）。

## 3. Python Agent 引擎（智能在哪）

### 3.1 单步循环（观察→思考→行动）

循环本体用 pip 依赖 browser-use 的 `Agent`；本仓库做"每阶段组装 + 预算 + 钩子"：

```
step 事件（stdin）→ _run_step (session_runner.py:427)
  └ _run_agent_step (agent/service.py:721) 三段式：
     ① prepare (:124-516)：URL 预导航 → Phase Reviewer 契约（reviewer.py:456，
        输出 JSON 合约 mode/refill/submit/success/effort/estimated_steps，20s 硬超时）
        → KB 流程召回注入 → max_steps 预算解析 → 拼 agent_task（业务数据块+特殊元素+成功门闩）
     ② agent (:519-663)：构造 browser-use Agent（override_system_message=按合约裁剪的
        prompt 包、planner_llm 每 3 步复核、step/done 回调）→ agent.run(max_steps)
        → 预算续跑 ≤2 轮（reviewer.py:498 成本模型）
     ③ post (:666-718)：软质量门禁（pending 写入门闩/缺 success token → quality_failed）
        → emit phase_end
```

browser-use 每步：观察（`get_state` 补丁注入图标 aria-label，agent_utils.py:473）→ LLM 思考 → 动作执行（controller wrapper 自动截图）→ `_record_action` 落 `_ACTION_LOG` + 增量上报。停止：`_request_agent_stop`（cancel 文件 + stopped 标志）。

### 3.2 四个 LLM 角色（scripts/prompts/）

| 角色 | 职责 | 调用点 |
|---|---|---|
| 主 Agent | 观察思考行动；system prompt 按 phase 合约 mode 裁剪拼装（agent_utils.py:197-247：agent-core + agent-tools-common + table/form/tree/heal 分册） | 每步 |
| Phase Reviewer | **每阶段一次的预规划**（非逐步评审），出执行合约；`resolve_phase_max_steps` 公式（estimated+2/create+4/submit 下限 8） | service.py:256 |
| Form | 填表助手 LLM 值生成（手机号/身份证等确定性生成器在 form_rules.py，LLM 只补语义值） | autofill_round.py:269 |
| Scenario | 每 3 步注入 `[业务场景摘要]` 进上下文 | recorder.py:105 |

### 3.3 预算体系
- max_steps：Node 默认 40 → reviewer 按合约解析（phase/reviewer.py:49）；预算续跑 ≤2 轮。
- max_actions_per_step：mode 档位 create/modify=5，navigate/query/login=3（agent_utils.py:74）。
- 单动作时间预算 `ACTION_BUDGET_S`（replay_timing.py:36，默认 5s；save/login/tree 更长），超时语义=重观察再换定位。

### 3.4 纠偏体系（cue 注入）
cue = 注入 LLM 上下文的中文 HumanMessage；JS 观察（js_snippets/）→ Python 判定 → cue 进模型：
- 观察阶梯（prompt 规则，agent-tools-common.md:84）：定向探测 → verify_context → get_page_state → 全量扫描 → 截图，跳级需理由。
- 重复失败分级：同参连续失败 2 次 → `[纠偏]`（必须先重观察）；第 3 次 → `[重试已拒绝]` 三选一（recorder_emitters.py:142 + duplicate_failure_cue.py；flag `AI_DUP_FAILURE_CUE` 默认关）。
- on_step_end 确定性守卫（recorder.py:176-473）：空 act cue、导航 cue、页面通知扫描、过早 done 守卫、目标重复检测（连续 3 次同 goal 强停）、**动作循环检测**（指纹周期 2/3/4 注入恢复处方）、cssSelector 补抓。

### 3.5 表单自动填表与 CDP watcher
- autofill：`FormAutofillEngine.ensure_scanned`（form_autofill.py:89）touch 容器（dialog:/drawer: 优先最后可见 overlay）→ `tasklist_scan_mode` 防 overlay 外字段泄漏 → 三轮 cascade（autofill_pending.py:72，每轮重扫容器+LLM 规划+逐个执行）；合约 `allow_form_assistant=false` 时禁用。
- CDP watcher（session_runner.py:111）：进程内常驻任务，与 Agent **共享** browser_context/_ACTION_LOG；消费 `cdp_action` 队列（前端 BiB 工具条单步快速操作通道，watcher-actions.js:24），动作照常入轨迹，source='cdp'。旧 `scripts/cdp/watcher.py` 是历史遗留。

## 4. 数据采集与落库（一个点击的旅程）

```
[页面] 点击/填表
  → buildLocatorSnap() 定位快照（xpath_smart 消歧升级链：region→titlebox→page-state→[n]，
    page-locator-helpers.js:1572；manual/CDP 走 inspect-payload-script.js:219，
    agent 动作走 JS_ENRICH_CLICK_LOCATOR 实时富化 enrich.py:67）
  → _record_action (state.py:916)
      ActionEntry(UUID) + stamp（page_level_key/region_id/rect_norm 0..1 归一化）
      + coalesce：仅比较最后一条，字段类动作（fill/select/radio…）连续同元素保留后者、
        removedIds 带出（state.py:991）；非连续重复天然保留；CDP 快速动作不合并
  → emit action_log_sync（delta 每 50 条转 full，带 runId）+ step_screenshot（字节不进日志）
  → executor WS → 控制面三监听器（AI 录制专属 #3：trajectory-recording-runner.js:695，
    runId 归属过滤 + persist 串行 drain）
  → handleActionLogSync (:561)：removedIds→删步重排；新条目→三层幂等
    （内存 persistedActionIds → DB uk_traj_action 查询 → ER_DUP_ENTRY 兜底）
  → appendRecordedStep (form-snapshot-append.js:34) → trajectoryStepDao.batchSave
    （element_json 规范化：models/element.js:232，含 xpath_smart/full/candidates/
     locator_scope/occurrence/verified/strategy/region_*/rect_norm/attr/options）
  → flushPendingStepScreenshot → screenshot-service → MinIO（失败落本地 pending +
    后台补传 screenshot-pending-retry.js:27）→ broadcast action_persisted
```

**save_trajectory 双通道**：AI 录制是上面这条**实时逐条落库**；另有"保存轨迹"整体保存（trajectory-persist.js:22 → Python `_handle_save_trajectory` trajectory_store.py:22 写 action/log/form 文件 → Node 批量入库，`excludeActionIds` 防重复）——两条通道靠 action_id 幂等汇合。

**其他产物**：
- 表单快照：`_save_form_snapshot`（form_scan_utils.py:416）指纹新才发 checkpoint → Node 事务双写 trajectory_step(save_form_snapshot) + form_snapshot/snapshot_field（form-snapshot-append.js:156）；它是回放 Type B 结构自愈的检查点来源。
- 截图四类：步骤 before/after（uk step+kind）、弹窗图（kind=phase_highlight+metadata dialog）、页面/弹窗长图（kind=page_level，levelKey 树）、阶段长图（stitch_screenshot_id）。`storage_type` 只有 minio|local（legacy db 读取直接抛错）。
- 业务数据与凭据：业务 KV 走 business_data 通道注入 step payload（仅填表/引入/查询类阶段，recording-runner-business-data.js:44）；**登录凭据永不落 step params**——auth 录制写占位符 `__AUTH_USERNAME__/__AUTH_PASSWORD__`（auth-recording-service.js:285），回放前还原（trajectory-session-replay.js:268）。

## 5. 前端事件速查（讲解时对着界面讲）

`recording:prepare`（四阶段进度）、`action_log_sync`/`action_persisted`/`action_removed`（实时步骤列表）、`step_persist_failed`、`fake_success_detected`（假成功降级横幅）、`remote:status`/`remote:tabs`（实况）、RSCF 二进制帧（画面，ack 定速 30fps + 零观众停推，bib-bridge.js:241/270）、`batch:progress/done`。phase 生命周期事件（phase_start/done/end、phase_state_key、step_screenshot）是 session 内部事件，由 runner 消费转换后才广播。

## 6. 必讲坑与易混淆点

1. **两个同名 `_ACTION_LOG`**：`controller/__init__.py`（结构化 ActionEntry，录制真相）vs `recorder.py:36`（纯文本 LLM 上下文日志）。`_record_action` 只写前者。
2. **Phase Reviewer 是每阶段一次的预规划**，不是逐步评审；逐步的"评审感"来自 recorder 钩子的确定性守卫。
3. **record/stop ≠ detach**：stop 保留全部资源可立即重录；detach 杀进程释放槽。stream/detach 只停画面。
4. **recording 是临时态**：判定"正在录"看 running phase，别只看 recordStatus；控制面重启后 `persistent_record_status` 基线恢复，不丢终态。
5. **轨迹级 confirm 与步骤级 confirmed 是两回事**：前者 completed/recorded 流转；后者是回放成功标记。
6. **登录步不落库**（suppressStepPersist + markConsumedActionLog）；登录凭据只有占位符。
7. **manual 录制有日期噪音清理**（日期回声点击丢弃，state.py:950）；CDP 快速动作不参与 coalesce。
8. **trajectory-store.js 是 legacy 文件库**，MySQL 主链路在 dao 层；别被"保存轨迹"文件通道误导。
9. spawn 参数/角色 LLM env 注入点在 executor/session-slot.js:115-121；改 prompt 分册注意 mode 生效矩阵（agent_utils.py:225-244）。

## 7. 推荐阅读顺序（给接手人）

1. README「核心流程」AI 录制节（概览）
2. 路由入口 trajectory-record.js → attach-runner（prepare 四阶段）→ recording-runner（phase 循环 + 门闩）
3. Python 三入口：session_runner.py（事件循环）→ agent/service.py（三段式）→ recorder.py（钩子）
4. 数据面：state.py `_record_action` → form-snapshot-append.js → element.js（element_json 规范）
5. 坑史：本文 §6 + 回放材料 §5 + CHANGELOG
6. 演示：前端对一条轨迹 attach → prepare（看四阶段进度）→ 选阶段 record/start（看实时步骤流）→ stop → confirm
