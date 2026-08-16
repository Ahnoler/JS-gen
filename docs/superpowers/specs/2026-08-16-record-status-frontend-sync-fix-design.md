# Design: 前后端状态流转冲突修复（record_status v2 前端同步补丁）

**Date:** 2026-08-16
**Status:** Approved — 待实现计划
**Trigger:** 前后端一致性核查发现 4 个前端冲突 + 3 处后端错文案 + 2 个闸门语义疑点（两份 Explore 报告：`docs/superpowers/sdd/2026-08-14-trajectory-record-status-v2/progress.md` 相关轮次产出）。根因：前端 UI 状态机（`RecordingStatus` 四态 + `recordStatusToUi` 折叠映射）未跟上 v2 五态的两个关键区分——`recording` 的「AI 活跃 vs 纯观看占位」、`recorded` 独立于 `draft`。
**Related:** [record_status v2 spec](2026-08-14-trajectory-record-status-v2-design.md)；Vue `vue-project/src`（另仓）

## Problem

1. **冲突 1（高）**：纯观看占位（recordStatus=recording 且非 AI 活跃）被 UI 一律当「录制中」——进详情页自动 prepare 后常态触发，「开始录制」按钮消失（`trajectory-tree.ts:148`、`useRecordingStudio.ts:89-98`、`RemoteBrowser.vue:281-299`）。后端实际允许纯观看占位直接 record/start。
2. **冲突 2（高）**：`recorded`（待确认）折叠进 UI draft（`trajectory-tree.ts:153`）→ 显示「重新录制/开始录制」，点击必 409（后端 recorded/completed → 409）。
3. **冲突 3（中）**：`doStopRecord`（`useRecordingStudio.ts:395-401`）只刷新 tree、不同步 `traj.value.recordStatus` → failed 后「人工确认」仍显示（StepsPanel `isFailed` 读旧值），点击 409。
4. **冲突 4（低）**：`api/recording.ts:393` 注释「false → draft」（实为 recorded）、`useRecordingStudio.ts:346` toast「AI 录制完成」、`StepsPanel.vue:494`「已确认（录制完成）」。
5. **后端闸门语义疑点**：步骤移动闸 `recordStatus==='recording'`→409 会锁死纯观看占位（与 record/start「AI 活跃才 409」哲学不一致）；清空步骤后端无闸但前端 recording 时禁用。
6. **后端 3 处错文案**：`api-docs/groups/recording.js:77`、`routes/v2/trajectory-record.js:71`（stop `false → draft`，实为 failed）；`:85`（confirm `false → draft`，实为 recorded）。

## Goals

1. 前端 UI 状态机升级为六态映射，一处根治冲突 1/2；`recorded` 无「重新录制」死路。
2. `doStopRecord` 同步 `traj.recordStatus`，failed 确认按钮即时隐藏（冲突 3）。
3. 后端步骤移动闸对齐「AI 活跃才 409」；纯观看占位可移动/清空。
4. 清理冲突 4 文案、后端 3 处错文案、死代码 `useRecordingState.ts`；v2 spec 回放闸条目勘正。
5. 不破坏：后端 v2 契约其它部分、batch 枚举、`manual_record_status` WS、未提交的他方工作区改动。

## Non-goals

- 不新增后端 API 字段（不提供 `aiRecordingActive` 下发——前端从 tree.phases 推导）。
- 不改确认闸语义（recording/failed → 409 维持；draft 可确认维持——Q2 拍板「维持现状」）。
- 不收紧/放开 record/start、push、confirm 的任何契约（只修 step-move）。
- 不把其它会话的未提交改动（StepsPanel 空阶段入口等）并入本次提交。
- 不重做 v2 枚举/迁移/统计（上一特性已交付）。

## Locked decisions（用户拍板）

| # | Decision |
|---|----------|
| 1 | 纯观看占位放开移动/清空：后端 step-move 闸改 `isAiRecordingActive`；前端 clear/拖拽仅 AI 活跃锁定（Q1=A）。 |
| 2 | draft 维持显示「人工确认」（后端本就允许 draft→completed），UI 不隐藏（Q2=B）。 |
| 3 | 修复方案 1：前端 UI 状态集六态 + `aiActive` 推导（phases running）+ 后端闸门对齐。 |
| 4 | 附加项纳入：后端 3 处错文案、v2 spec 回放闸勘正、删 `useRecordingState.ts`。 |
| 5 | 他方未提交工作区改动（StepsPanel/detail-index 空阶段入口）不随本次提交：作为基线保留，主线程 hunk 级选择性 staging；若无法干净分离，提交前再征询用户。 |
| 6 | `aiActive` 信号 = `tree.phases.some(p => p.status === 'running')`（持久、跨会话准确）；record/start 后的毫秒级推导窗口由后端 409 兜底。 |

## Architecture

```text
后端 record_status 五态: draft / recording / failed / recorded / completed
                         ↓ recordStatusToUi(recordStatus, aiActive)
前端 UI 六态:   draft(未录制) / occupy(纯观看占位) / recording(AI录制中)
               / recorded(待确认) / confirmed(已确认) / failed(录制异常) / idle(未知兜底)

映射:  aiActive → 'recording'
      recording + !aiActive → 'occupy'
      draft→'draft'; failed→'failed'; recorded→'recorded'; completed→'confirmed'; 其它→'idle'

aiActive = tree.phases.some(p => p?.status === 'running')   （useRecordingStudio computed）
```

## Component rules（按 UI 态）

| UI 态 | StepsPanel | RemoteBrowser |
|---|---|---|
| recording | 全锁（勾选/步骤操作/清空） | 「录制中」+「取消录制」 |
| occupy | 可清空/可编辑；「重新录制」；无人工确认 | 「开始录制」+ 结束观看（attach 状态区入口） |
| draft | 清空 + 重新录制 + 人工确认（维持现状） | 「开始录制」 |
| failed | 清空 + 重新录制；**无人工确认** | 「开始录制」 |
| recorded | **人工确认 + 清空**；无重新录制/开始录制 | 状态标签「待确认」（无开始按钮） |
| confirmed | 取消确认 | 状态标签「已确认」 |

- 所有 `isRecording`/`clearDisabled`/拖拽挡条件从 `status==='recording'` 改为 `ui==='recording'`（仅 AI 活跃锁定）。

## Data flow（冲突 3 修法）

- `doStopRecord` 成功后 `traj.value.recordStatus = res.recordStatus`（对齐 doConfirm/doClearSteps 既有模式）→ StepsPanel `isFailed` 即时生效。

## Backend changes

1. `src/services/trajectory/trajectory-step-service.js`（move 步骤闸，约 L237-251）：`recordStatus === 'recording'` → `await isAiRecordingActive(id)`（文件顶部 import `isAiRecordingActive`；错误文案「Cannot move steps while AI recording」不变）。
2. 错文案：`src/dashboard/api-docs/groups/recording.js:77` 与 `src/routes/v2/trajectory-record.js:71`：「false → draft」→「false → failed」；`trajectory-record.js:85`：「false → draft」→「false → recorded」。
3. 钉子：`scripts/characterization/characterize-step-move.mjs` 相关断言随闸门改写；`scripts/characterization/characterize-record-status-v2.mjs` 追加 step-move 闸 pin（断言 `isAiRecordingActive` 调用存在于 move 闸）。

## Docs & cleanup

- v2 spec 勘正（`docs/superpowers/specs/2026-08-14-trajectory-record-status-v2-design.md`）：回放闸条目（assembled replay 已删，现行 steps/replay 无 recordStatus 闸）；step-move 闸条目改为「AI 活跃 → 409」。
- 删除 `vue-project/src/composables/useRecordingState.ts`（全仓无 import 的死代码，含旧「回草稿」语义）。

## Verification

- 前端：`npx vue-tsc --noEmit`（exit 0）+ 手工冒烟清单（占位→「开始录制」；开始→全锁；失败→failed 无确认按钮；待确认→无重新录制；取消确认→待确认；占位态清空/移动放开；AI 录制中全锁）。
- 后端：`node --check`；`characterize-step-move.mjs` / `characterize-record-status-v2.mjs` / `characterize-trajectory.mjs` / `characterize-batch-task-progress.mjs` 回归；`bash scripts/refactor/verify-all.sh` ALL GREEN。
- CHANGELOG：本特性跨 `src/routes/`、`src/services/`、api-docs 与 Vue——JS-gen 侧变更在 `[Unreleased]` 补一条（含 Python 同步提示：无 HTTP/schema 变化，step-move 闸语义提示）。

## Implementation split（multi-agent，文件集无交集）

| 分工 | 文件集 |
|---|---|
| A 后端闸门+文案+钉子 | `trajectory-step-service.js`、`recording.js`、`trajectory-record.js`、`characterize-step-move.mjs`、`characterize-record-status-v2.mjs`、`CHANGELOG.md` |
| B 前端状态核心 | `types/index.ts`、`trajectory-tree.ts`、`useRecordingStudio.ts`（含 doStopRecord 同步） |
| C 前端组件渲染 | `StepsPanel.vue`、`RemoteBrowser.vue`、`detail/index.vue` |
| D 清理+文档 | 删 `useRecordingState.ts`、v2 spec 勘正 |

B 定义 UI 态接口后 C 消费（C 的 prompt 携带完整映射表，可与 B 同轮）；A/D 独立并行。
