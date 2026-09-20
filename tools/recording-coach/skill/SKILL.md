---
name: ui-record-wet-test
description: >-
  Recording-coach wet-test operator: dispatch brief + business taskText
  separation, preflight gates, 60s poll watch, through-report + close.txt
  close contract. Short铁律 here; long-form runbook in references/ and
  templates/; scaffolds in scripts/. Use when the user asks for 湿测,
  真机录制验收, UI录制贯通, STC/落库验收, or recording-coach operator workflow.
---

# Recording Coach 湿测操作员

用 `tools/recording-coach` OpenCode 工具链代替手工点「分析→准备→录制」，验收引擎行为是否写进落库步骤。控制面默认 `http://localhost:4097`。设计见 `docs/superpowers/specs/2026-09-18-recording-coach-opencode-design.md`。

## 三个角色

| 角色 | 职责 |
|------|------|
| **编排者** | 用户提供验收目标、参考 traj、禁区与落库判据 |
| **操作员** | 本 coach 进程。只调工具、写证据目录；**不**打开浏览器做业务点击、**不** git commit、**不**改仓库 |
| **录制引擎** | 控制面 `record/start` 驱动的 Python executor，读 `task` 在真机执行 |

变体（同骨架换步骤，**不**新工具名）：**只读核查员**只查 DB/API/KB、零录制；**取证员**用 CDP 截图 + `doneLogs` 残尾反推。自包含任务书 + 证据落盘 + 不提交 + 主线程复核不变。

## 两份输入

用户意图须拆成两份，不可混写。模板见 `templates/dispatch-brief.md` 与 `templates/task-text.md`。

- **taskText**（给录制引擎）：经 `mark_inputs_ready` 写入 workflow；须含 `【硬性成功门闩`、禁区、编号步骤（trim 后 ≥80 字）；**禁止** `POST /api/v2` / `curl`。骨架与规则见 `templates/task-text.md`（断言实现 `src/task-text.mjs`）。落库验收口径见 `references/acceptance.md`。
- **dispatch-brief.md**（给操作员）：经 `save_dispatch_brief` 写入证据目录；正文须含五个固定标题。详见 `templates/dispatch-brief.md`。

## 工具调用顺序（铁律）

严格按序；`create_trajectory` 的参数必须是 `{}`（inputs 已由 `mark_inputs_ready` 锁定）：

| # | 工具 |
|---|------|
| 1 | `save_dispatch_brief` |
| 2 | `mark_inputs_ready` |
| 3 | `preflight_readonly` |
| 4 | `analyze_trajectory` |
| 5 | `accept_phases` |
| 6 | `create_trajectory` `{}` |
| 7 | `prepare_record`（超时 **600** 秒） |
| 8 | `cdp_precheck` |
| 9 | `start_record`（值守上限 **40** 分钟） |
| 10 | `detach_trajectory` |
| 11 | `assert_steps` |
| 12 | `write_through_report` |

不可跳过 `analyze_trajectory` → `accept_phases` 再 create。  
`accept_phases` **之前**须按 `references/phase-granularity.md` 做阶段粒度速查（过碎必合 / 过粗必拆 / 描述可执行；**禁止**把已修复的引擎规避升格为粒度铁律）。管线坑位（phaseIds、CDP、槽位、doneLogs 截断等）详见 `references/pipeline-pits.md`。

## 派发前核查

`preflight_readonly` 在开单前必须通过：执行机有空闲 connected 槽；`probes` 每项 `path` 以 `/api/v2/` 开头且仅 GET；涉及评级/在途授信等前置时设 `businessProbeRequired: true`。不知查哪条 API → 停，结论 `BLOCKED_前置未核`，禁止开单。详见 `references/pipeline-pits.md`。

## 值守与轮询

`start_record` 期间工具每 **60** 秒写 `poll-N.json` 并追加 `progress.log`；操作员不在轮询间隙改页面；单次录制总长 **40** 分钟封顶。详见 `references/pipeline-pits.md`。

## 验收口径

看 `stepCount`、真实 `steps[]` 与目标 `actionType` + 字段；不看仅 `recordStatus=recorded`。约 1 分钟内全 `phase_done` 且 0 步 → `BLOCKED_` 假成功。详见 `references/acceptance.md`。

## 诚实失败

服务端拒绝（原文 + 流水号记在 `doneLogs`）是合法终局，结论前缀 `REJECTED_`。**禁止**再录一单，除非用户本回合明确要求重试。湿测默认开启 `honestReject`。详见 `references/acceptance.md`。

## close.txt 收尾契约

`write_through_report` 写 `through-report.md` 与 `close.txt`；报告路径 + 三条证据缺一不可；**最后一条助手消息必须与 `close.txt` 完全相同**（五行：结论 / 报告 / 证据1–3）。结论前缀只允许 `CREATED_`、`REJECTED_`、`BLOCKED_` 或 `ERROR`。形态见 `templates/close.txt`。

## 失败再试

1. 遮挡弹窗 / 空查 / `already-operated-this-phase` → 改 `taskText` 后 `retry_new_traj`，须再次 `mark_inputs_ready`
2. 业务步对、落库字段错 → 引擎缺口；仅 Lead 明示允许改代码时最小修 + pin + 重录
3. 每轮保留 analyze/create/prepare/start JSON、`traj-*-final.json`、`poll-*.json`、日志摘录

详见 `references/pipeline-pits.md` 与 `references/acceptance.md`。

## STC 实证锚点

functionId、客户 stamp、参考 traj 等示例参数见 `references/stc-anchors.md`（**示例，非万能 stamp**）。

## 何时用

- 新合入录制/回放行为要真机验（如 STC 首行、查询门闩）
- 用户说：湿测、真机录制、按某 traj 再录、验收落库字段
- 需要 recording-coach 操作员按派发草稿跑完整管线

脚手架：`node skill/scripts/init-evidence.mjs`、`scaffold-brief.mjs`、`preflight-probes.mjs`。除非用户明示，**不** commit/push。
