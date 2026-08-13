# Design: Batch row progress + phase done_logs (PR-BATCH, no user mgmt)

**Date:** 2026-08-13  
**Status:** Approved — plan at `docs/superpowers/plans/2026-08-13-batch-task-progress-phase-done.md`  
**Trigger:** 用户管理（PR-USER / PR-SSO）未做之前，PR-BATCH 仍可做：按行进度条、阶段 `done` 说明落库与展示。  
**Related:** [product brief](2026-08-12-product-requirements-miaoyi-brief.md) PR-BATCH ②③；[todo-list](../todo-list.md)；[batch draft mode](2026-08-07-batch-draft-mode-design.md)

## Problem

批量导入弹窗已有 job/item 状态文案，没有行进度条。Agent `done(text)` 已经出现在 `phase_done.data.text`，控制面只把 `trajectory_phase.status` 标成 `completed`，说明没有落库。`trajectory.trajectory_log` 是 agent 全文 LONGTEXT，不能改成数组。

## Goals

1. 每个 `trajectory_phase` 保存该阶段结束说明数组（追加、保留历史）。  
2. 批量导入每行展示进度条：管道状态打底；录制中用「已完成阶段 / 总阶段」往前推；行上显示当前阶段名 + 最近一条 done 摘要。  
3. 交易详情阶段列表展示该阶段 `doneLogs` 全文。  
4. 不引入用户隔离、不新增任务页、不改现有 URL。

## Non-goals

- PR-BATCH ①「每个用户只能看自己的任务」（等 PR-USER）。  
- 独立「任务管理」页 / 服务端列出全部 batch job。  
- `created_by` / 权限闸。  
- 按 agent 步数的更细进度。  
- 改 `trajectory.trajectory_log` 语义。  
- 默认登录 / `phase_number=0` 的 done 写入 phase 列。

## Locked decisions

| # | Decision |
|---|----------|
| 1 | 存储：`trajectory_phase.done_logs` JSON；`trajectory.trajectory_log` 不动。 |
| 2 | 条目：`{ text, at, source }`；`source` = `agent` \| `fail`。 |
| 3 | 重录：追加并保留历史；界面永远读最后一条。 |
| 4 | 空 `text` 不追加。失败走 `phase_error`/`error`，`source=fail`。 |
| 5 | 阶段打回 `pending`（含 `clearTrajectory`）时清空该阶段 `done_logs`。 |
| 6 | 进度在 `GET batch/:id` 与 WS `batch:progress` **计算**，不落 `batch_recording_item`。 |
| 7 | 任务列表仍是 Vue `BatchImportDialog` + localStorage。 |
| 8 | 详情展示全文；批量行展示最近一条摘要（Vue 截断约 80 字）。 |
| 9 | 失败/取消不显示 100：有轨迹按 recording 公式上限 90；无轨迹 record=10 / draft=40；rejected=0。 |

## Architecture

```text
Agent done(text)
  → stdout/WS event phase_done { text, success, phase, ... }
  → product record loop (trajectory-recording-runner)
       mark phase completed
       appendPhaseDoneLog(phaseId, { text, source: "agent" })  // skip if empty
       emitProgress(batchId) if item bound
  → engineering session-message.js: same helper on phase_done / phase_error

GET /trajectories/:id
  → phases[].doneLogs

GET /trajectories/batch/:id  +  WS batch:progress
  → items[] + progressPercent, phaseCompleted, phaseTotal, phaseName, lastDoneText
```

**写入主路径：** `src/services/trajectory/trajectory-recording-runner.js` 在已有 `donePayload.text` 解析之后调用共享 helper。  
**次路径：** `src/routes/browser-session/session-message.js` 的 `phase_done` / `phase_error` / `error`（有 `session.activePhaseId` 才写）。  
**禁止写入：** `runDefaultLogin`（`phase_number: 0`，无业务 phase 行）。

Helper 放 `src/services/trajectory-phase-service.js`：`appendPhaseDoneLog(phaseDbId, { text, source })`。失败软：写库失败只 warn，不让录制失败。

## Storage

### Column

```sql
ALTER TABLE `trajectory_phase`
  ADD COLUMN `done_logs` JSON NULL
    COMMENT '阶段结束说明 [{text, at, source}]；trajectory.trajectory_log 仍为 agent 全文';
```

`schemas/init.sql` 同步。历史行 = `NULL`（读作 `[]`）。

### Item shape

```json
{
  "text": "已保存客户信息并关闭弹窗",
  "at": "2026-08-13T03:12:00.000Z",
  "source": "agent"
}
```

| Field | Rule |
|-------|------|
| `text` | string；trim；最长 2000；超长截断。空串不追加。 |
| `at` | ISO-8601 UTC，追加时 `new Date().toISOString()`。 |
| `source` | 仅 `agent` 或 `fail`。非法值丢弃整条。 |

读：非法 JSON / 非数组 → `[]`。追加：读出 → concat → 写回 JSON。不重写历史项。

控制面给下一阶段的合成文案「见页面当前状态」**不**写入 `done_logs`，除非 agent 原文就是这句话。只持久化 `phase_done.data.text`（trim 后非空）。

`phase_done.success === false` 但仍有 `text`：仍 `source: "agent"`（这是模型的 done 说明，不是 transport 错误）。

## Read APIs（路径不变）

### Trajectory tree

`GET /api/v2/trajectories/:id`（`getTrajectoryTree`）每个 phase 增加：

```json
"doneLogs": [
  { "text": "...", "at": "2026-08-13T03:12:00.000Z", "source": "agent" }
]
```

camelCase。`NULL` → `[]`。其它 phase 字段不变。

### Batch job view

`GET /api/v2/trajectories/batch/:id` 每个 `items[]` 增加（计算字段，不落库）：

| Field | Type | Meaning |
|-------|------|---------|
| `progressPercent` | int 0–100 | 见下节公式 |
| `phaseCompleted` | int | `status=completed` 的阶段数；无轨迹则为 0 |
| `phaseTotal` | int | 阶段总数；无轨迹则为 0 |
| `phaseName` | string | 当前 `running` 的 `description`；否则最近一个 `completed` 的 description；否则 `""` |
| `lastDoneText` | string | 该轨迹所有 phase 的 `doneLogs` 中 `at` 最晚一条的 `text`（全文）；没有则为 `""` |

WS `batch:progress` 的当前 `item` 同样带这五个字段。

**何时查 phase：** item 有 `trajectoryId` 且 status ∈ `preparing` \| `recording` \| `recorded` \| `failed` \| `cancelled`。其它状态阶段字段为 0 / `""`，只按管道映射百分比。  
**查询：** `getBatchJobView` / `emitProgress` 对上述 item 的 `trajectory_id IN (...)` **一次**查出 phases（禁止每行一次 SQL）。

`trajectory.trajectoryLog` 响应语义不变。

## Progress formula

`progressPercent = clamp(round(n), 0, 100)`。纯函数，便于表征。

### `mode=record`

| item.status | percent |
|-------------|---------|
| pending | 0 |
| analyzing | 10 |
| analyzed | 20 |
| queued | 25 |
| waiting_executor | 30 |
| preparing | 40 |
| recording | `phaseTotal > 0` → `40 + 50 * (phaseCompleted / phaseTotal)`；否则 40 |
| recorded | 100 |
| drafted | 100 |
| failed / cancelled | 有 `trajectoryId` → 按 `recording` 公式但 **上限 90**（不显示 100）；无轨迹 → 10 |
| rejected | 0 |

不把失败行显示成 100。不另存「失败前 status」：用「有没有轨迹 / 阶段比」推断。

### `mode=draft`

| item.status | percent |
|-------------|---------|
| pending | 0 |
| analyzing | 40 |
| analyzed | 70 |
| drafted | 100 |
| failed / cancelled | 有 `trajectoryId` → 按 record 的 recording 公式上限 90；无轨迹 → 40 |
| rejected | 0 |

draft 无录制，`phaseCompleted`/`phaseTotal`/`phaseName`/`lastDoneText` 一般为 0 / `""`（用户后来从列表单独录制成功后，若 item 已 `drafted` 终态，本刀不回写 batch 行进度；以交易详情 `doneLogs` 为准）。

## Frontend (Vue)

根目录（本刀改这里，不在 JS-gen 里改 Vue）：

`D:\dev\ui-auto-recording-agent-vue-master\vue-project\src`

| 文件 | 改动 |
|------|------|
| `api/recording.ts` | `BatchImportItem` 加五个进度字段；`TrajectoryPhase` 加 `doneLogs?: PhaseDoneLog[]` |
| `stores/batchImport.ts` | 轮询/WS 把新字段写进 `BatchTask.items`（已有 3s poll，透传即可） |
| `views/ui-recording/components/BatchImportDialog.vue` | 展开明细行：进度条 + 阶段名 + done 摘要 |
| `views/ui-recording/detail/index.vue` | 把 `phases[].doneLogs` 传给步骤面板（已传 `:phases`） |
| `views/ui-recording/detail/components/StepsPanel.vue` | 阶段分组标题下展示该阶段 `doneLogs` |

### 类型

```ts
export interface PhaseDoneLog {
  text: string
  at: string
  source: 'agent' | 'fail'
}
```

### BatchImportDialog

- 展开明细每行：`el-progress`（`progressPercent`）+ 现有状态文案 + `phaseName` + `lastDoneText` 截断约 80 字（`el-tooltip` 全文）。  
- 终态颜色仍用现有 `taskTone` / item 失败红。  
- 仍 3s 轮询；store 若已接 `batch:progress` 则用 WS 覆盖该行字段。  
- 不新开任务页。

### Trajectory detail / StepsPanel

- 在 `step-group` 的 `group-title` 下方（步骤列表之上）展示该 `phases` 项的 `doneLogs`：时间、`source`（agent / 失败）、全文。  
- `doneLogs` 空或缺省：不占位。  
- 阶段标题仍用现有 `group.title`（description）；done 说明是附加信息，不替换标题。

## Errors

- `appendPhaseDoneLog` 失败：`console.warn`，录制继续。  
- 无 `activePhaseId` / 无效 phase id：跳过写入。  
- 登录 `phase_done`：不写。  
- 进度计算缺 phase 行：`recording` 视为 40%，不抛。

## Testing / docs

- Characterization：`appendPhaseDoneLog` 追加、空 text 跳过、非法 JSON 当 `[]`、clear 清空、text 截断 2000。  
- Characterization：`computeBatchItemProgress` 表格（含 recording 2/4 → 65、failed 停档、draft 映射）。  
- `GET` 树 / batch view fixture：phase 带 `doneLogs`；batch item 带五个计算字段。  
- `/api/docs` batch + trajectory phase 字段说明。  
- CHANGELOG `[Unreleased]`：迁移 + 响应字段；Python 同步提示：`trajectory_phase.done_logs`、GET 字段、`TrajectoryPhaseEntity`。

## Python 同步

- 迁移必须；Python 控面加列即可，**不**改 batch URL。  
- `scripts/` agent 已发 `phase_done.data.text`，本刀不改 Python agent 协议。

## Out of scope follow-ups

- 按登录人过滤 batch job / 交易列表。  
- 服务端任务中心。  
- draft 行在用户稍后手动录制完成后回写 batch 进度。
