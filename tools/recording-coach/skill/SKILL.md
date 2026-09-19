---
name: ui-record-wet-test
description: >-
  Recording-coach wet-test operator: dispatch brief + business taskText
  separation, preflight gates, 60s poll watch, through-report + close.txt
  close contract. Use when the user asks for 湿测, 真机录制验收, UI录制贯通,
  STC/落库验收, or to run the recording-coach operator workflow.
---

# Recording Coach 湿测操作员

用 `tools/recording-coach` OpenCode 工具链代替手工点「分析→准备→录制」，验收引擎行为是否写进落库步骤。控制面默认 `http://localhost:4097`。设计见 `docs/superpowers/specs/2026-09-18-recording-coach-opencode-design.md`。行为对照见合约仓 `tmp/contract-wet7` 与 `wet8`，只读。

## 三个角色

| 角色 | 职责 |
|------|------|
| **编排者** | 用户提供验收目标、参考 traj、禁区与落库判据 |
| **操作员** | 本 coach 进程。只调工具、写证据目录；**不**打开浏览器做业务点击、**不** git commit、**不**改仓库 |
| **录制引擎** | 控制面 `record/start` 驱动的 Python executor，读 `task` 在真机执行 |

## 两份输入文本

用户意图须拆成两份，不可混写。

### taskText（给录制引擎）

经 `mark_inputs_ready` 写入 workflow。必须含 `【硬性成功门闩`、禁区、关键数据、编号步骤；**每阶段一个判据**。trim 后 ≥80 字。

**禁止**出现 `POST /api/v2`、`curl` 或任何 API 路径——那是操作员 runbook，录制引擎会把 curl 当页面操作。

### dispatch-brief.md（给操作员）

经 `save_dispatch_brief` 写入证据目录。正文须同时含五个标题（缺一不可）：

#### 固定参数

functionId、systemAccountId、参考 traj、证据目录路径等。勿猜 fid / stamp。

#### 业务目标

一句话验收目标 + **落库级**判据（动作名 + params/element 字段）。

#### 风险预告

禁入操作、遮挡弹窗、空查校验、`already-operated-this-phase`、假成功（全 phase_done 但 0 步）等。

#### 管线步骤

操作员工具调用顺序（见下节），可写 `/api/v2/` 路径与超时。

#### 产出契约

`through-report.md`、`close.txt` 及结论前缀（`CREATED_` / `REJECTED_` / `BLOCKED_` / `ERROR`）。

## 工具调用顺序（铁律）

严格按序；`create_trajectory` 的参数必须是 `{}`（inputs 已由 `mark_inputs_ready` 锁定）：

1. `save_dispatch_brief`
2. `mark_inputs_ready`
3. `preflight_readonly`
4. `analyze_trajectory`
5. `accept_phases`
6. `create_trajectory` `{}`
7. `prepare_record`（超时 **600** 秒）
8. `cdp_precheck`
9. `start_record`（值守上限 **40** 分钟）
10. `detach_trajectory`
11. `assert_steps`
12. `write_through_report`

不可跳过 `analyze_trajectory` → `accept_phases` 再 create。`acceptedPhases` 只用 analyze 结果，模型传入的 phases 忽略。

## 派发前核查

`preflight_readonly` 在开单前必须通过：

- 执行机槽位：`GET /api/v2/executors`，须有空闲 connected 槽。
- `probes` 每项 `{ label, path }`；`path` 必须以 `/api/v2/` 开头，仅 GET。
- 任务涉及**评级是否生效、在途授信、客户池**等前置时，设 `businessProbeRequired: true` 并给出对应 GET probe。
- 不知查哪条 API → **停**，结论 `BLOCKED_前置未核`，**禁止开单**。

## 值守与轮询

`start_record` 期间工具每 **60** 秒写 `poll-N.json` 并追加 `progress.log`。操作员**不在**轮询间隙改页面或改任务。单次录制总长 **40** 分钟封顶。

## 验收口径

| 看 | 不看 |
|----|------|
| `stepCount`、真实 `steps[]` | 仅 `recordStatus=recorded` |
| 目标 `actionType` + `paramsJson` / `elementJson` | 仅 `isSuccessful=1` |
| `doneLogs`、executor-main.log | 阶段全 completed 就当 PASS |

**假成功**：约 1 分钟内全 `phase_done` 且 0 步 → `BLOCKED`，勿报 DONE。

Agent 常走 `click_element_by_index` 再归一成表行/树动作；验收时看**最终落库动作名与字段**。

## 诚实失败

服务端拒绝（原文 + 流水号记在 `doneLogs`）是合法终局，结论前缀 `REJECTED_`。**禁止**再录一单，除非用户**本回合**明确要求重试。

湿测路径在 `assert_steps` / `write_through_report` 中默认开启 `honestReject`（`enabled: true`），除非调用方显式传入 `honestReject.enabled === false`。

## close.txt 收尾契约

`write_through_report` 写 `through-report.md` 与 `close.txt`。收工条件：

- 报告路径 + **三条证据**缺一不可。
- **最后一条助手消息必须与 `close.txt` 完全相同**（五行：结论 / 报告 / 证据1–3）。

结论前缀只允许 `CREATED_`、`REJECTED_`、`BLOCKED_` 或 `ERROR`；禁止用 `DONE` 作结论行。

示例 `close.txt` 形态：

```
结论：CREATED_click_table_row_radio_first
报告：tmp/recording-coach-…/through-report.md
证据1：traj-final.json id=… actions=click_table_row_radio
证据2：click_table_row_radio row_text=first
证据3：poll-1.json done=1/4
```

## STC 实证锚点

| 字段 | 值 |
|------|-----|
| functionId | `9000000011` |
| 客户 stamp | `26080511161570617` |
| 成功判据 | `click_table_row_radio` 且 `row_text=first`，`xpath_smart` 含结构首行（非业务键） |
| 参考 traj | #848（湿测 #857）；`systemAccountId` 通常 `2` |

查询类：先填条件再点**一次**查询；勿空查；本相勿反复点同一查询按钮。

## 失败再试

1. 遮挡弹窗 / 空查 / `already-operated-this-phase` → 改 `taskText` 后 `retry_new_traj`，须再次 `mark_inputs_ready`
2. 业务步对、落库字段错 → 引擎缺口；仅 Lead 明示允许改代码时最小修 + pin + 重录
3. 每轮保留 analyze/create/prepare/start JSON、`traj-*-final.json`、`poll-*.json`、日志摘录

## 何时用

- 新合入录制/回放行为要真机验（如 STC 首行、查询门闩）
- 用户说：湿测、真机录制、按某 traj 再录、验收落库字段
- 需要 recording-coach 操作员按派发草稿跑完整管线

除非用户明示，**不** commit/push。
