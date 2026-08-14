# Design: 新版轨迹状态枚举与状态流转（record_status v2）

**Date:** 2026-08-14
**Status:** Approved — 待实现计划
**Trigger:** 产品需求（上一特性 spec 的 Future work TODO，用户确认第 3 条需求）：轨迹 `record_status` 由旧五态改为新五态——**未录制 / 录制中 / 录制异常 / 待确认 / 已确认**，并重写状态流转规则。
**Related:** [batch task name + stats](2026-08-14-batch-task-name-trajectory-stats-design.md)（其 stats 五档与 Vue 映射将随本枚举调整）；`docs/superpowers/todo-list.md`；Vue `vue-project/src`（另仓）

## Problem

1. 旧五态（`draft` 空闲 / `live` 推流占用 / `recording` AI录制中 / `recorded` 录制完成 / `completed` 人工确认）与产品语言脱节：「占用中」不是产品概念，「录制完成」与「人工确认」语义重叠。
2. 录制失败/中止没有独立状态：`recording → draft`（`trajectory-recording-runner.js:447-451` 两分支同值），失败痕迹丢失，无法区分「从未录过」与「录挂了」。
3. 「占用中(live)」承载了大量内部逻辑（占槽推流、人工录制入口、grace 归属、idle/crash sweep），产品却不需要它单独可见。

## Goals

1. DB 枚举改为 `ENUM('draft','recording','failed','recorded','completed')`，中文语义：未录制 / 录制中 / 录制异常 / 待确认 / 已确认；存量 `live` 行迁入 `recording`。
2. 重写全部状态流转写入点，落实新流转矩阵（见下），失败/中断落「录制异常」。
3. 引入 `isAiRecordingActive`（phase.status='running' 推导）替换所有旧 `=== 'live'` / `!== 'recording'` 判定。
4. stats 五档键名、api-docs、Vue 文案/类型随新枚举同步。
5. 不破坏：sys_msg、batch 枚举（重名勿动）、`manual_record_status` WS 事件。

## Non-goals

- 不新增任何列（不引入显式「录制活跃」标记）。
- 不改 batch item/job 状态枚举与 batch summary 键。
- 不改 `manual_record_status` WS 事件名与语义。
- 不做「待确认打回重录」（流转最小闭环，用户拍板）。
- 不提供「已确认→未录制」的直接回退（取消确认只回待确认）。

## Locked decisions（用户拍板，逐条）

| # | Decision |
|---|----------|
| 1 | 旧→新映射：`draft`→未录制；`live`+`recording`→录制中（都占用执行资源）；`recorded`→待确认；`completed`→已确认；新增 `failed`=录制异常。 |
| 2 | DB 枚举代码沿用旧名：`ENUM('draft','recording','failed','recorded','completed')`；`live` 行数据迁入 `recording`、枚举删 `live`；不做全量重命名。 |
| 3 | 流转主干（最小闭环）：未录制→录制中→待确认→已确认；录制中失败/中断→录制异常→（重试）→录制中；纯观看占用结束/取消（未在 AI 录制）→未录制。 |
| 4 | 取消确认保留：`confirm(false)` → 已确认→待确认（不回未录制）。 |
| 5 | 失败/中断→录制异常；纯观看结束→未录制（以「AI 录制是否活跃」区分）。 |
| 6 | 录制异常可再次 `record/start` 直接重录（→录制中），也可重置（POST clear）回未录制。 |
| 7 | 推送闸：仅 `completed`（已确认）可推送（`PUSHABLE_RECORD_STATUSES = ['completed']`）。 |
| 8 | 技术方案 A：五态单枚举 + `isAiRecordingActive` 用 `trajectory_phase.status='running'` 推导（不加列）。 |
| 9 | `confirm(true)` 对 `draft` 的行为保持现状（可确认），本次不收紧为「仅待确认可确认」。 |
| 10 | down 迁移有损：`failed→draft` 归并、`recording` 无法拆回 live/recording（如实记录）。 |
| 11 | sweep 清理路径不碰「AI 录制活跃」的行（维持录制 runner / batch recovery 收口）。 |

## Architecture

```text
record_status: draft(未录制) / recording(录制中) / failed(录制异常) / recorded(待确认) / completed(已确认)

准备/观看占用:  prepare 推流成功  draft ──▶ recording        （占用中并入录制中）
AI 录制开始:    record/start     draft|failed ──▶ recording
录制完成:       AI 全阶段完成 / record/stop success   recording ──▶ recorded
录制失败/中断:  AI 失败/中止 / stop !success / 录制中被打断 / 批次 INTERRUPTED
                                 recording ──▶ failed
重试:           record/start     failed ──▶ recording
重置:           POST clear       any ──▶ draft
确认:           confirm(true)    recorded|draft ──▶ completed
取消确认:       confirm(false)   completed ──▶ recorded
观看结束/取消:  stream/detach/idle/crash sweep（非 AI 录制活跃）
                                 recording ──▶ draft
闸门:           推送=completed only；回放/步骤移动=recording 409；confirm=recording|failed 409
```

`isAiRecordingActive(trajId)` = `EXISTS(trajectory_phase WHERE trajectory_id=? AND status='running')`
（录制 runner 已在每阶段置 running/completed，持久、单一事实源）。

## Data model

### 迁移 `20260814120000_trajectory_record_status_v2`

```sql
-- up
UPDATE trajectory SET record_status = 'recording' WHERE record_status = 'live';
ALTER TABLE trajectory MODIFY COLUMN record_status
  ENUM('draft','recording','failed','recorded','completed') NOT NULL DEFAULT 'draft'
  COMMENT 'draft=未录制; recording=录制中; failed=录制异常; recorded=待确认; completed=已确认';
-- down（有损）
UPDATE trajectory SET record_status = 'draft' WHERE record_status = 'failed';
ALTER TABLE trajectory MODIFY COLUMN record_status
  ENUM('draft','live','recording','recorded','completed') NOT NULL DEFAULT 'draft'
  COMMENT 'draft=空闲; live=推流占用; recording=AI录制中; recorded=录制完成; completed=人工确认';
```

- `schemas/init.sql:105` 同步新枚举与注释（四件套）。
- 常量 `src/models/constants.js`：`TRAJECTORY_RECORD_STATUSES = ['draft','recording','failed','recorded','completed']`；新增
  `TRAJECTORY_RECORD_STATUS_LABELS = { draft:'未录制', recording:'录制中', failed:'录制异常', recorded:'待确认', completed:'已确认' }`（文案单一事实源）。

## Transition matrix（旧→新，逐写入点）

| 触发 | 旧流转 | 新流转 | 证据（旧） |
|---|---|---|---|
| 创建轨迹 | →draft | →draft | trajectory-meta-service.js:180,236 |
| prepare 推流成功（未在 AI 录制） | →live | →recording | trajectory-attach-runner.js:164-167 |
| record/start | live→recording | draft/failed→recording；**AI 录制中（recording 且 AI 活跃）→409**；recorded/completed→409；纯观看占位（recording 且非 AI 活跃）→可开始 | trajectory-recording-runner.js:77 |
| AI 全阶段完成 | recording→recorded | recording→recorded | trajectory-recording-runner.js:440-444 |
| AI 失败/中止（aborted 与否） | →draft | →failed | trajectory-recording-runner.js:447-451 |
| record/stop success | any→recorded | →recorded | trajectory-record-lifecycle.js:340-345,404-410 |
| record/stop !success | →draft | →failed | trajectory-record-lifecycle.js:412-416 |
| 观看占用结束（非 AI 活跃） | live→draft | recording→draft | attach-service.js:446-452,549-553; session-lifecycle.js:102; dao.js:215-217,259 |
| AI 录制中被 detach/清理打断 | live\|recording→draft | recording→failed | 同上 |
| 批次取消/恢复中断（INTERRUPTED） | →draft | →failed | trajectory-batch-service.js:447-451 |
| confirm(true) | →completed | recorded/draft→completed；completed 幂等 | trajectory-meta-service.js:359-364 |
| confirm(false) | completed→draft | completed→recorded | trajectory-meta-service.js:366-370 |
| POST clear | →draft | →draft | trajectory-phase-service.js:144-153 |
| 推送闸 | recorded/completed | **completed only** | export-push-gate.js:6,22-32 |
| 回放闸 | live/recording 409 | recording 409（failed 可回放） | replay-service.js:36-45 |
| 步骤移动闸 | recording 409 | recording 409 | trajectory-step-service.js:237 |
| confirm 闸 | live/recording 409 | recording/failed 409 | trajectory-meta-service.js:348-356 |
| 人工录制闸 | recording+enabled 409 | isAiRecordingActive+enabled 409 | trajectory-manual-record.js:29 |

## isAiRecordingActive 与清理路径重写

- 新 DAO 助手：`hasRunningPhase(trajectoryId)`（`EXISTS(phase.status='running')`，放 `src/dao/trajectory-phase-dao.js`）；服务层包装 `isAiRecordingActive`。
- **降级守卫（统一规则）**：所有 demote 路径（detach / cleanup / stream-detach 缓存清理 / sweep）只作用于 `record_status='recording'` 的行；`failed/recorded/completed` 一律不碰（对齐旧代码「recorded/completed 不覆盖」的守卫，failed 为新增保护）。作用于 recording 时：AI 活跃 → failed（打断）；非活跃 → draft（观看结束）。
- 替换点：
  1. **prepare 防打回**（attach-runner.js:165）：`!isAiRecordingActive` 才置占用（recording）。
  2. **detach / cleanupPersistedTrajectoryResources**（attach-service.js:446-452,549-553）：AI 活跃 → failed；否则 → draft。
  3. **stream/detach 缓存清理 + sweep**（session-lifecycle.js:102,58-61,76-79,115,129,142；dao.js clearMountByRemoteSessionId/repairStaleRemoteMounts；idle-reaper）：只降级「非 AI 活跃」的 recording 占用行 → draft；**AI 活跃行 sweep 不碰**。
  4. **batch recovery**（INTERRUPTED）→ failed。
- 行为保持承诺：sweep「不误杀 AI 录制」语义显式化（比现状只认 live 更精确）；grace 归属/多槽并行逻辑不变（只改状态判定条件）。

## API / 契约

- `GET /api/v2/trajectories`：400 校验 `allowed` 换新五值（constants 驱动）；`status` 别名不变；`stats` 键名换 `draft/recording/failed/recorded/completed`（`RECORD_STATUS_STATS` 同步），中文文案跟 LABELS。
- api-docs 更新：`catalog.js` ENUMS/RECORDING_FLOW；`groups/recording.js` 约 20 处文案（「占用中」→「录制中」）；`groups/trajectory.js` stats 示例换键、query 参数说明；`groups/websocket.js` payload 说明；`app.js` 关键语义；`slot-monitor.js` 徽标。
- 兼容决定：`confirm(true)` 对 draft 保持现状可确认（决策 9）。

## Vue 另仓改动清单

1. `api/recording.ts:10`：`RecordStatus = 'draft'|'recording'|'failed'|'recorded'|'completed'`（顺带修复历史缺 `live` 的类型缺口）；`TrajectoryStats` 键名换新五档。
2. `utils/trajectory-tree.ts:147-161`：`recordStatusToUi` 增 failed 映射；`RECORD_STATUS_LABEL` 换五档文案（删「占用中」）。
3. `views/ui-recording/index.vue:40-47,271-274`：statusOptions 五档新文案；`recordStatusClass` 增 failed 样式。
4. `composables/useRecordingStudio.ts:94-95,401,675,826` 与 `detail/index.vue:152`、`StepsPanel.vue`、`RemoteBrowser.vue`：直显枚举值处改走文案映射。
5. `utils/recording-mapper.ts:29-30` 文案同步。

## characterization / smoke 钉子更新

- `characterize-trajectory.mjs:53-54,167-169`（五值断言 + `success ? 'recorded' : 'draft'` 子串 → `'failed'`）。
- `characterize-export-push-gate.mjs:13-35`（PUSHABLE 仅 completed）。
- `characterize-batch-task-progress.mjs:140`（`/currentStatus !== 'recording'/` 子串 → 新判定写法）。
- `scripts/smoke/accept-recording-apis.mjs`（约 10 处）、`accept-multi-traj-lifecycle.mjs:126`。
- 新增 `scripts/characterization/characterize-record-status-v2.mjs`：断言迁移 SQL、LABELS、流转关键子串、stats 键名。
- 禁区：batch 枚举断言（characterize-batch-import / batch-task-progress / sys-msg）与 `manual_record_status` 相关代码一字不动。

## Python 侧

`scripts/` 零 record_status 引用（Explore 已证）。CHANGELOG Python 同步提示：无状态值跨仓透传；Python 端若展示轨迹状态按新五档文案；`manual_record_status` 事件不变。

## Verification

- `node --check` 全部改动文件；新 characterize + 更新后的钉子全绿；`bash scripts/refactor/verify-all.sh`。
- 迁移在本地 MySQL 实际执行（live→recording 行数抽查；枚举 SHOW CREATE TABLE）。
- 手工冒烟：创建→prepare（占用=录制中）→record/start→模拟失败→failed→重试→recorded→confirm→completed→取消确认→recorded→clear→draft；`?recordStatus=failed` 筛选与 stats 五档。

## Implementation split（multi-agent，文件集无交集）

| 分工 | 文件集 |
|------|--------|
| A：迁移 + init.sql + constants | `migrations/20260814120000_trajectory_record_status_v2.js`、`schemas/init.sql`、`src/models/constants.js` |
| B：录制流转 | `trajectory-recording-runner.js`、`trajectory-record-lifecycle.js`、`trajectory-meta-service.js`（confirm 双分支）、`trajectory-batch-service.js`（recovery INTERRUPTED） |
| C：占用/清理 + 助手 | `trajectory-phase-dao.js`（hasRunningPhase）、`trajectory-attach-runner.js`、`trajectory-attach-service.js`、`session-lifecycle.js`、`trajectory-dao.js`（sweep 降级）、`trajectory-idle-reaper.js`、`trajectory-manual-record.js` |
| D：闸门 + 路由 + stats + api-docs | `export-push-gate.js`、`replay-service.js`、`trajectory-step-service.js`、`routes/v2/trajectory.js`、`dao/trajectory-dao.js`（RECORD_STATUS_STATS）、`dashboard/api-docs/*` |
| E：Vue 另仓 | `api/recording.ts`、`utils/trajectory-tree.ts`、`views/ui-recording/index.vue`、`composables/useRecordingStudio.ts`、`detail/*`、`utils/recording-mapper.ts` |
| F：钉子 + smoke + CHANGELOG | `characterize-trajectory.mjs`、`characterize-export-push-gate.mjs`、`characterize-batch-task-progress.mjs`、`smoke/*`、新 `characterize-record-status-v2.mjs`、`CHANGELOG.md` |

A–F 无交集可并行；主线程收尾：verify-all.sh、CHANGELOG 审查、Python 提示核对。
