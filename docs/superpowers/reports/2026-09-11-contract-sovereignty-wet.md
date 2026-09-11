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
- **early-done 门闩有真机触发**，但本跑落到 recorder「可见表单错误 → forcing continue」，**未能**用湿测钉住字面 `done_rejected` / `missing_evidence` 观测字段。  
- **Planner advisory discard** 本跑无触发样本。  

### 建议（非本 Task 必做）

若要补齐 checklist 字面项：另开一跑刻意诱导 `validate_done` 拒绝（缺 success evidence 的 done），并抓 stderr `done_rejected authority=gate`；或在观测通道把 recorder Premature done 与 `done_rejected` 事件对齐。

## 服务状态

湿测结束后控制面与 executor **仍保持运行**（未在本报告中停止）。
