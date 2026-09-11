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
| 阶段中冲突仅 gate / advisory | ⚠️ 部分 | 本跑未观察到 planner `compatible_with_contract=false` 丢弃日志；见下行 early-done |
| 过早 done → `done_rejected` / `missing_evidence` | ⚠️ 部分 | 阶段2 step 8：`[recorder] ⚠ Premature done() — visible errors … formErrors=['请选择客户类别'], forcing continue`。走 **recorder 可见校验错误门闩** 并强制继续，**未**在 stderr 见到字面 `done_rejected` / `missing_evidence`（与冷测 pin 的 `validate_done` 事件路径不同） |
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
- **early-done 门闩有真机触发**，但主跑落到 recorder「可见表单错误 → forcing continue」，**未能**用湿测钉住字面 `done_rejected` / `missing_evidence` 观测字段。  
- **Planner advisory discard** 本跑无触发样本。  
- **done_rejected 专项**见下节（2026-09-11 晚补跑）。

## 补跑：done_rejected 专项（traj 755 / 756 / 757）

目标：诱导未保存成功即 `done()`，钉住字面 `done_rejected` + `missing_evidence`（`toast_ok`）。

| 跑次 | traj | 结果 |
|---|---|---|
| r1 | **755** | ❌ 全局「单元测试配置」弹窗挡住；阶段内零动作 done → `[recorder] done rejected: zero actions`；reviewer `submit.required=False success.kinds=[]`；`steps=0 recorded` |
| r2 | **756** | ⚠️ 合约形态已对齐，字面事件未捕获（见下） |
| r3 | **757** | ✅ 临时嗅探钉住字面 `done_rejected`（见下） |

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

证据目录：`tmp/contract-sovereignty-wet/done-rejected/`（r1）、`…/done-rejected-r2/`（r2）、`…/done-rejected-r3/`（r3）。

### 专项结论

| 项 | 结果 |
|---|---|
| 诱导 create + `toast_ok` 合约 | ✅（r2 / r3） |
| recorder 过早 done 门闩（pending_write / overlay） | ✅（r2 / r3） |
| 字面 `done_rejected` / `missing_evidence` 湿测钉死 | ✅（r3，`authority=gate`，`missing_evidence` 含 `toast_ok`） |

## 服务状态

湿测与补跑结束后控制面与 executor **仍保持运行**（未在本报告中停止）。r3 后嗅探补丁已回滚；executor 需重启一次以丢掉内存中的临时 tee（可选）。
