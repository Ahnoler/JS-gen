# 合约主权 Task 8 湿测报告

> 日期：2026-09-11  
> 计划：[`plans/2026-09-11-contract-sovereignty-orchestration.md`](../plans/2026-09-11-contract-sovereignty-orchestration.md) Task 8  
> 规格验收 #4：湿测一条多阶段录制——阶段边界只出现 reviewer 立法；阶段中冲突只出现 gate 拒绝或 advisory 日志。

## 环境

| 项 | 值 |
|---|---|
| 控制面 | `npm start` → `http://0.0.0.0:4097`（本机 LMY） |
| 执行机 | `npm run executor` → node LMY `2f21bad1-…` **online** capacity=16 |
| 账号 | `systemAccountId=2`（701994） |
| 功能叶 | `functionId=9000000039` 客户信息查询 |
| 证据目录 | `tmp/contract-sovereignty-wet/` |

## 场景

多阶段 AI 录制（analyze → create → prepare → start → detach）：

1. 登录并打开客户信息查询  
2. 查询表单填写客户名称关键字「KB测客户」并点击查询  
3. 定位列表首行并记录客户号（无结果则如实结束）

**轨迹：** `#754`  
**阶段：** 3（phaseIds 1478 / 1479 / 1480）  
**终态：** `recordStatus=recorded`，`stepCount=8`，`isDone=1`，`isSuccessful=1`  
**会话：** `remoteSessionId=1542` → detach 200 ok

驱动脚本：`tmp/contract-sovereignty-wet/run-wet.mjs`（`record/start` HTTP 曾因 120s abort 断开客户端，服务端录制继续完成）。

## 清单对照

| 检查项 | 结果 | 证据 |
|---|---|---|
| 控制面 + executor 在线 | ✅ | CP listening :4097；executor `registered … status: 'online'` |
| 多阶段 AI 录制 + 表单操作 | ✅ | 3 phases；阶段2 `fill_form_field(客户名称)` + 多次点击查询；阶段3 列表出结果并记录客户号 |
| 阶段边界 reviewer 立法 | ✅ | 每阶段前 `phase_reviewer ok … phase_intent=True source=llm`（login / query / query） |
| 阶段中冲突仅 gate / advisory | ✅（接线+冷测；湿测见下） | 2026-09-12：`filter_planner_advice` 已挂入 `Agent._run_planner`；stderr `[planner] run|kept|discard`；冷 pin OK；湿测 traj **760** 见 `[planner] run`（接线），字面 discard 仍依赖 LLM 产出 incompatible 建议 |
| 过早 done → `done_rejected` / `missing_evidence` | ✅（r4） | 见专项 r4：默认 stderr + `events[]` |
| 无 recontract 时合约不静默改写 | ✅（负向） | 全程无 `recontract` 日志；无显式 version bump 行 |

## 关键日志摘录（executor）

```
Phase 1: … phase_reviewer ok … mode=login … phase_intent=True … source=llm
Phase 1 done
Phase 2: … phase_reviewer ok … mode=query … phase_intent=True …
[recorder] ⚠ Premature done() — visible errors at step 8: formErrors=['请选择客户类别'], forcing continue
Phase 2 done
Phase 3: … phase_reviewer ok … mode=query … phase_intent=True …
Phase 3 done
```

完整命中见 `tmp/contract-sovereignty-wet/executor-sovereignty-hits.txt`；终态 JSON：`final-detail.json`。

## 结论

- **Acceptance #4 主路径（多阶段 + 阶段边界 reviewer）PASS。**  
- **early-done / done_rejected：** 主跑曾落 recorder Premature；字面 gate 事件已由专项 r3/r4 钉死。  
- **Planner advisory：** 冷测 + 运行时接线已落地；湿测见下节。

## 补跑：planner advisory discard 接线（2026-09-12）

**缺口：** Task 4 交付了 `filter_planner_advice` + prompt 字段，但未挂入 browser-use `Agent._run_planner`，故早期湿测不可能看到丢弃日志。

**产品改动：**
- `patch_planner_advice_filter()` → 包装 `_run_planner`
- `apply_planner_advice_filter`：JSON（含 markdown fence）→ filter；stderr `[planner] run|kept|discard`；事件 `planner_advice_discarded`
- `session_runner` 安装补丁；`service.py` 挂 `agent._jsgen_business_data`
- recording runner / session-message 转发 `planner_advice_discarded`

**验收：**
| 项 | 结果 |
|---|---|
| `characterize-planner-advisory-filter` | ✅（含 discard/kept/fence/接线源码钉） |
| 湿测 traj **759** | ⚠️ 14 步；未见 discard（LLM 未产出 incompatible） |
| 湿测 traj **760** | ✅ 接线：`[planner] run`（session `547c35ee`）；未捕获字面 discard（探针过早 failed/1 步） |

证据：`tmp/contract-sovereignty-wet/planner-discard/`。字面 `compatible_with_contract=false` 丢弃路径以冷测为准；湿测确认 filter 已在 live planner 路径上执行。

## 补跑：done_rejected 专项（traj 755 / 756 / 757）

目标：诱导未保存成功即 `done()`，钉住字面 `done_rejected` + `missing_evidence`（`toast_ok`）。

| 跑次 | traj | 结果 |
|---|---|---|
| r1 | **755** | ❌ 全局「单元测试配置」弹窗挡住；阶段内零动作 done → `[recorder] done rejected: zero actions`；reviewer `submit.required=False success.kinds=[]`；`steps=0 recorded` |
| r2 | **756** | ⚠️ 合约形态已对齐，字面事件未捕获（见下） |
| r3 | **757** | ✅ 临时嗅探钉住字面 `done_rejected`（见下） |
| r4 | **758** | ✅ 默认可观测湿复验：stderr + `events[]`（无 sniff） |

### r2 关键证据（session `afa3aa80-…`）

1. **阶段2 合约（reviewer）已是目标形态：**  
   `mode=create` · `submit.required=True` · `success.kinds=['toast_ok']` · `phase_intent=True`  
   （`logs/agent-stderr/afa3aa80-51ed-4ff6-a684-dea1a9ad561e.log`）
2. Agent 实际走了填表 + `click_save`（未严格遵守「立刻 done 不保存」探针），后因校验/未填完字段触发：  
   `[recorder] ⚠ Premature done() — pending fields ['投资主体类型', '联网核查状态']`  
   随后 `[budget] extend round=1 +10 steps (introduce=1 pending=2)`
3. 终态：`recordStatus=failed`，`stepCount=27`，`isDone=0`
4. **字面 `done_rejected` / `missing_evidence`：** 在 executor stderr / agent-stderr / 控制面日志中 **均未检索到**。  
   原因：`evaluate_phase_done` 的 `done_rejected` 只经 **stdout JSON → WS 转发**，不写 stderr；本 harness 未订阅/落盘该事件流。budget extend 可由 pending 字段单独触发，**不能**当作 `done_rejected` 已发出的充分证据。

### r3 关键证据（session `9c17ae3f-…`，2026-09-12）

1. **探针：** 手写 2 阶段；阶段2「只点新增 → `done(success=false)`」；临时在 `executor/session-handler.js` `relayAgentEvent` tee `done_rejected` → `events.jsonl`（跑完已回滚，未入产品提交）。
2. **阶段2 合约（rules_fallback）：**  
   `mode=create` · `refill=all_editable` · `submit.required=True` · `success.kinds=['toast_ok','url_change']`
3. **路径：** 先有 recorder Premature（drawer 仍开）→ 后续 `done` 越过 recorder → `evaluate_phase_done` 发 stdout 事件。
4. **字面事件（嗅探落盘）：** `tmp/contract-sovereignty-wet/done-rejected-r3/events.jsonl`

```json
{"event":"done_rejected","session_id":"9c17ae3f-e9b1-4064-bfed-20c5652d3986","data":{"phase":2,"contract_version":1,"authority":"gate","reasons":["submit_required","success_unmet"],"remaining":[],"missing_evidence":["toast_ok","url_change"]}}
```

5. **终态：** `recordStatus=failed`，`stepCount=3`，detach 200。

### r4 关键证据（session `35bee0ee-…`，2026-09-12 上午）

目标：验证 `7a2315b5` 默认可观测（**无**临时 sniff）。

1. **探针：** 同 r3（新增 → `done(success=false)`）；服务重启后跑 `tmp/.../done-rejected-r4/run.mjs`
2. **stderr（产品路径）：** executor + `logs/agent-stderr/35bee0ee-….log`  
   `[phase_done] done_rejected authority=gate phase=2 contract_version=1 reasons=['submit_required', 'success_unmet'] remaining=[] missing_evidence=['toast_ok', 'url_change'].`
3. **`record/start` events[]：** 含一条 `type=done_rejected`（authority=gate，missing_evidence 含 toast_ok）— 见 `start-done-rejected-events.json`
4. **终态：** `recordStatus=failed`，`stepCount=2`，detach 200；harness `PASS=true`（stderr_obs + events_obs）

证据目录：`tmp/contract-sovereignty-wet/done-rejected/`（r1）、`…/done-rejected-r2/`（r2）、`…/done-rejected-r3/`（r3）、`…/done-rejected-r4/`（r4）。

### 专项结论

| 项 | 结果 |
|---|---|
| 诱导 create + `toast_ok` 合约 | ✅（r2 / r3 / r4） |
| recorder 过早 done 门闩（pending_write / overlay） | ✅（r2 / r3 / r4） |
| 字面 `done_rejected` / `missing_evidence` 湿测钉死 | ✅（r3 sniff；**r4 默认 stderr + events[]**） |

## 服务状态

r4 复验时控制面与 executor **已重启并保持运行**。默认可观测代码已在产品路径（`7a2315b5`），无需 sniff。
