# 轨迹状态枚举 v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `trajectory.record_status` 从旧五态（draft/live/recording/recorded/completed）改为新五态（draft=未录制 / recording=录制中 / failed=录制异常 / recorded=待确认 / completed=已确认），重写全部流转写入点与闸门，同步 stats/api-docs/Vue/钉子。

**Architecture:** 单一枚举五态（live 行数据迁入 recording）；「AI 录制活跃」用 `trajectory_phase.status='running'` 推导（`hasRunningPhase` + `isAiRecordingActive` 包装），替换所有旧 `=== 'live'` / `!== 'recording'` 判定；流转矩阵与中文文案以 `constants.js` 的 `TRAJECTORY_RECORD_STATUS_LABELS` 为单一事实源。

**Tech Stack:** Node ESM、Knex/MySQL、characterization 断言脚本（无测试框架）、Vue 3 + TS。

**Spec:** `docs/superpowers/specs/2026-08-14-trajectory-record-status-v2-design.md`（13 条 Locked decisions 为准）。

## Global Constraints

- 新枚举值（逐字）：`'draft','recording','failed','recorded','completed'`；文案：draft=未录制、recording=录制中、failed=录制异常、recorded=待确认、completed=已确认。
- 存量数据：`live` 行迁入 `recording`；down 有损（failed→draft）。
- 流转矩阵（spec Transition matrix）：失败/中断→failed；纯观看结束→draft；取消确认 completed→recorded；record/start 允许自 draft/failed，recording→409，recorded/completed→409；confirm 闸 recording/failed→409。
- 推送闸：`PUSHABLE_RECORD_STATUSES = ['completed']`（仅已确认）。
- 降级守卫统一规则：所有 demote/sweep 只作用于 `record_status='recording'` 的行——AI 活跃→failed，非活跃→draft；`failed/recorded/completed` 一律不碰；sweep 不碰 AI 活跃行。
- 禁区：batch item/job 枚举与 summary 键、`manual_record_status` WS 事件、sys_msg 链路一字不动。
- 四件套：迁移 + init.sql + `CHANGELOG.md [Unreleased]`（Task 6 统一）+ Python 同步提示。
- 每任务 commit 由主线程执行（实现子智能体不提交 git）。
- 并行任务文件集无交集；本计划按顺序执行，相邻任务可共享 `characterize-record-status-v2.mjs`。

## File Structure

| 文件 | 职责 |
|------|------|
| `migrations/20260814120000_trajectory_record_status_v2.js`（新） | live→recording 数据迁移 + 枚举 MODIFY |
| `schemas/init.sql` | trajectory 枚举与注释同步 |
| `src/models/constants.js` | `TRAJECTORY_RECORD_STATUSES` 新五值 + typedef + `TRAJECTORY_RECORD_STATUS_LABELS` |
| `src/dao/trajectory-dao.js` | `hasRunningPhase`；demote 两处新守卫；`RECORD_STATUS_STATS` |
| `src/services/trajectory/trajectory-status-utils.js`（新） | `isAiRecordingActive` 包装 |
| `trajectory-recording-runner.js` / `trajectory-record-lifecycle.js` / `trajectory-meta-service.js` / `trajectory-batch-service.js` | 录制流转写入点 |
| `trajectory-attach-runner.js` / `trajectory-attach-service.js` / `trajectory-manual-record.js` | 占用/清理路径 |
| `export-push-gate.js` / `replay-service.js` / `export-mgmt.js` / `api-docs/*` | 闸门与契约 |
| Vue 另仓 6 文件 | 类型/文案/筛选/样式 |
| `characterize-*` / `smoke/*` / `CHANGELOG.md` | 钉子与四件套 |

---

### Task 1: 枚举底座 — 迁移 + init.sql + constants + hasRunningPhase + 新 characterize

**Files:**
- Create: `migrations/20260814120000_trajectory_record_status_v2.js`
- Modify: `schemas/init.sql`（L105 枚举行）
- Modify: `src/models/constants.js`（L13 typedef、L58-59 数组）
- Modify: `src/dao/trajectory-dao.js`（新增 `hasRunningPhase`）
- Create: `src/services/trajectory/trajectory-status-utils.js`
- Create: `scripts/characterization/characterize-record-status-v2.mjs`

**Interfaces:**
- Consumes: 无
- Produces: `TRAJECTORY_RECORD_STATUSES`（新五值）、`TRAJECTORY_RECORD_STATUS_LABELS`、`trajectoryDao.hasRunningPhase(trajectoryId)`、`isAiRecordingActive(trajectoryId)`（Task 2/3 消费）

- [ ] **Step 1: 写新 characterize（先失败——常量还是旧值）**

创建 `scripts/characterization/characterize-record-status-v2.mjs`：

```js
/**
 * Characterization for trajectory record_status v2（枚举/文案/迁移/活跃判定）。
 * Usage: node scripts/characterization/characterize-record-status-v2.mjs
 */
import assert from 'assert';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import {
  TRAJECTORY_RECORD_STATUSES,
  TRAJECTORY_RECORD_STATUS_LABELS,
} from '../../src/models/constants.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

let failed = 0;
function ok(name) { console.log(`  ✓ ${name}`); }
function fail(name, err) { failed += 1; console.error(`  ✗ ${name}:`, err?.message || err); }
function run(name, fn) { try { fn(); ok(name); } catch (err) { fail(name, err); } }

async function main() {
  run('five values, no live', () => {
    assert.deepStrictEqual(
      [...TRAJECTORY_RECORD_STATUSES],
      ['draft', 'recording', 'failed', 'recorded', 'completed'],
    );
  });
  run('chinese labels', () => {
    assert.deepStrictEqual(TRAJECTORY_RECORD_STATUS_LABELS, {
      draft: '未录制',
      recording: '录制中',
      failed: '录制异常',
      recorded: '待确认',
      completed: '已确认',
    });
  });
  run('migration: live→recording + enum', () => {
    const mig = readFileSync(join(ROOT, 'migrations', '20260814120000_trajectory_record_status_v2.js'), 'utf8');
    assert.ok(mig.includes("SET record_status = 'recording' WHERE record_status = 'live'"), 'live rows merged');
    assert.ok(mig.includes("ENUM('draft','recording','failed','recorded','completed')"), 'new enum');
    assert.ok(mig.includes('draft=未录制; recording=录制中; failed=录制异常; recorded=待确认; completed=已确认'), 'new comment');
  });
  run('init.sql enum sync', () => {
    const init = readFileSync(join(ROOT, 'schemas', 'init.sql'), 'utf8');
    assert.ok(init.includes("ENUM('draft','recording','failed','recorded','completed') NOT NULL DEFAULT 'draft'"), 'init enum');
    assert.ok(init.includes('draft=未录制'), 'init comment');
    assert.ok(!init.includes("'live'"), 'no live in init.sql record_status');
  });
  run('hasRunningPhase + isAiRecordingActive', () => {
    const dao = readFileSync(join(ROOT, 'src', 'dao', 'trajectory-dao.js'), 'utf8');
    assert.ok(dao.includes("status: 'running'"), 'hasRunningPhase running filter');
    assert.ok(dao.includes('export async function hasRunningPhase'), 'hasRunningPhase export');
    const utils = readFileSync(join(ROOT, 'src', 'services', 'trajectory', 'trajectory-status-utils.js'), 'utf8');
    assert.ok(utils.includes('export async function isAiRecordingActive'), 'wrapper export');
    assert.ok(utils.includes('trajectoryDao.hasRunningPhase(trajectoryId)'), 'wrapper delegates');
  });

  console.log(failed ? `\n${failed} failed` : '\nall ok');
  process.exit(failed ? 1 : 0);
}

main();
```

- [ ] **Step 2: 运行确认失败**

Run: `node scripts/characterization/characterize-record-status-v2.mjs`
Expected: 失败（常量还是旧五值 / 文件不存在），exit 1

- [ ] **Step 3: constants 换新枚举 + 文案**

`src/models/constants.js`：
1. L13 typedef 整行替换：

```js
/** @typedef {'draft'|'recording'|'failed'|'recorded'|'completed'} TrajectoryRecordStatus */
```

2. L59 数组替换：

```js
export const TRAJECTORY_RECORD_STATUSES = Object.freeze(['draft', 'recording', 'failed', 'recorded', 'completed']);
```

3. L59 之后新增：

```js
/** 轨迹状态中文文案（产品/文档/Vue 对齐的单一事实源） */
export const TRAJECTORY_RECORD_STATUS_LABELS = Object.freeze({
  draft: '未录制',
  recording: '录制中',
  failed: '录制异常',
  recorded: '待确认',
  completed: '已确认',
});
```

- [ ] **Step 4: 迁移 + init.sql**

创建 `migrations/20260814120000_trajectory_record_status_v2.js`：

```js
/**
 * trajectory.record_status v2：draft=未录制 / recording=录制中 / failed=录制异常 / recorded=待确认 / completed=已确认。
 * live（推流占用）并入 recording；down 有损（failed→draft，recording 无法拆回 live/recording）。
 */
export async function up(knex) {
  await knex.raw(`
    UPDATE trajectory SET record_status = 'recording' WHERE record_status = 'live'
  `);
  await knex.raw(`
    ALTER TABLE trajectory MODIFY COLUMN record_status
      ENUM('draft','recording','failed','recorded','completed') NOT NULL DEFAULT 'draft'
      COMMENT 'draft=未录制; recording=录制中; failed=录制异常; recorded=待确认; completed=已确认'
  `);
}

export async function down(knex) {
  await knex.raw(`
    UPDATE trajectory SET record_status = 'draft' WHERE record_status = 'failed'
  `);
  await knex.raw(`
    ALTER TABLE trajectory MODIFY COLUMN record_status
      ENUM('draft','live','recording','recorded','completed') NOT NULL DEFAULT 'draft'
      COMMENT 'draft=空闲; live=推流占用; recording=AI录制中; recorded=录制完成; completed=人工确认'
  `);
}
```

`schemas/init.sql` L105 整行替换：

```sql
  `record_status`     ENUM('draft','recording','failed','recorded','completed') NOT NULL DEFAULT 'draft' COMMENT 'draft=未录制; recording=录制中; failed=录制异常; recorded=待确认; completed=已确认',
```

- [ ] **Step 5: hasRunningPhase + 包装**

`src/dao/trajectory-dao.js`（`getExistingPhaseNumbers` 函数之后）新增：

```js
/**
 * AI 录制是否活跃：任一阶段 status='running'（录制 runner 每阶段维护）。
 * 占用中并入录制中后，用它在 demote/sweep 中区分「真正在录」与「只是观看占用」。
 */
export async function hasRunningPhase(trajectoryId) {
  const row = await getDB()('trajectory_phase')
    .where({ trajectory_id: Number(trajectoryId), status: 'running' })
    .first('id');
  return !!row;
}
```

创建 `src/services/trajectory/trajectory-status-utils.js`：

```js
/**
 * 轨迹状态判定助手（record_status v2）。零依赖、可被服务与 runner 安全引用。
 */
import * as trajectoryDao from '../../dao/trajectory-dao.js';

/** AI 录制是否活跃（单一事实源：phase.status='running'）。 */
export async function isAiRecordingActive(trajectoryId) {
  return trajectoryDao.hasRunningPhase(trajectoryId);
}
```

- [ ] **Step 6: 运行 characterize 通过 + 语法检查**

Run:
```
node scripts/characterization/characterize-record-status-v2.mjs
node --check src/models/constants.js
node --check src/dao/trajectory-dao.js
node --check src/services/trajectory/trajectory-status-utils.js
node --check migrations/20260814120000_trajectory_record_status_v2.js
```
Expected: 5 条 ✓ + 全部 exit 0

- [ ] **Step 7: （可选，本地 MySQL 可用时）执行迁移**

Run: `npx knex migrate:latest --knexfile config/knexfile.js`；再只读验证：
`node -e "import('./config/database.js').then(async ({getDB}) => { const db = getDB(); const [r] = await db.raw('SHOW CREATE TABLE trajectory'); console.log(r[1]['Create Table'].split('\n').find(l => l.includes('record_status'))); const live = await db('trajectory').where({ record_status: 'live' }).count('* as c'); console.log('live rows:', live[0].c); await db.destroy(); })"`
Expected: 新枚举行；live 行数 0。DB 不可用则跳过并注明。

- [ ] **Step 8: 报告**

报告写入 `.superpowers/sdd/2026-08-14-trajectory-record-status-v2/task-1-report.md`（主线程会先建该目录）：每步做了什么、命令原始输出、迁移执行与否、偏差。最终消息：状态/文件/测试一句话/疑虑。

---

### Task 2: 录制流转写入点（runner / lifecycle / confirm / batch recovery）

**Files:**
- Modify: `src/services/trajectory/trajectory-recording-runner.js`（L62-94 加闸；L446-451 失败分支）
- Modify: `src/services/trajectory/trajectory-record-lifecycle.js`（L340-345、L400-419）
- Modify: `src/services/trajectory/trajectory-meta-service.js`（L348-376 confirm）
- Modify: `src/services/trajectory/trajectory-batch-service.js`（recovery INTERRUPTED 分支，约 L442-452）

**Interfaces:**
- Consumes: 新枚举（Task 1）
- Produces: record/start 允许 draft/failed；失败落 failed；confirm(false) 落 recorded（Task 4/6 断言）

- [ ] **Step 1: record/start 状态闸**

`trajectory-recording-runner.js` 的 `startTrajectoryRecording`，在 `if (!traj) { 404 }` 块（L71-75）之后、`const allPhases = ...`（L76）之前插入：

```js
  if (traj.recordStatus === 'recording') {
    const err = new Error('Recording already in progress');
    err.statusCode = 409;
    throw err;
  }
  if (traj.recordStatus === 'recorded' || traj.recordStatus === 'completed') {
    const err = new Error('Trajectory already recorded — clear it to record again');
    err.statusCode = 409;
    throw err;
  }
```

- [ ] **Step 2: AI 失败/中止 → failed**

`trajectory-recording-runner.js` L446-451 的 catch 开头替换（删 `const aborted = ...` 与三元，保留后续 failText/appendPhaseDoneLog/notify 不变）：

```js
  } catch (err) {
    await trajectoryDao.updateMeta(tid, {
      recordStatus: 'failed',
      isDone: false,
      isSuccessful: false,
    });
```

- [ ] **Step 3: record/stop 与 stopSafe**

`trajectory-record-lifecycle.js`：
1. L340 替换：

```js
  const recordStatus = success ? 'recorded' : 'failed';
```

2. L405-409 success CAS 的 `recordStatusIn: ['live', 'recording', 'draft']` 替换为：

```js
    }, { recordStatusIn: ['draft', 'recording', 'failed'] });
```

3. L412-416 !success 分支替换：

```js
  } else {
    const n = await trajectoryDao.updateMetaIf(tid, {
      recordStatus: 'failed',
      isDone: false,
      isSuccessful: false,
    }, { recordStatusIn: ['recording', 'failed'] });
```

4. L356-359 函数注释「never downgrade recorded/completed back to draft」改为「never downgrade recorded/completed; failed only retries via record/start」。

- [ ] **Step 4: confirm 闸与取消确认**

`trajectory-meta-service.js`：
1. L348-356 闸门替换：

```js
  if (traj.recordStatus === 'recording' || traj.recordStatus === 'failed') {
    const err = new Error(
      traj.recordStatus === 'recording'
        ? 'Cannot confirm while recording'
        : 'Cannot confirm a failed trajectory — retry or reset first',
    );
    err.statusCode = 409;
    throw err;
  }
```

2. L365-370 取消确认分支的 `recordStatus: 'draft',` 替换为 `recordStatus: 'recorded',`（isDone/isSuccessful 仍置 null）。

3. L376 `(want ? 'completed' : 'draft')` 替换为 `(want ? 'completed' : 'recorded')`。

- [ ] **Step 5: 批次恢复 INTERRUPTED → failed**

`trajectory-batch-service.js` 恢复循环（recoverBatchJobsOnStartup）的 INTERRUPTED 分支：在 `cleanupPersistedTrajectoryResources(tid, { demoteLive: true, ... })` 调用之后、`markItemFailed(...)` 之前插入：

```js
        await trajectoryDao.updateMetaIf(tid, {
          recordStatus: 'failed',
          isDone: false,
          isSuccessful: false,
        }, { recordStatusIn: ['recording'] });
```

并把该处 `errorMessage: 'Interrupted by control-plane restart — draft retained for manual review'` 替换为 `errorMessage: 'Interrupted by control-plane restart — trajectory marked failed (录制异常), retry via record/start'`。

- [ ] **Step 6: 语法检查 + 已有 characterize 回归（预期钉子仍断，先记录）**

Run:
```
node --check src/services/trajectory/trajectory-recording-runner.js
node --check src/services/trajectory/trajectory-record-lifecycle.js
node --check src/services/trajectory/trajectory-meta-service.js
node --check src/services/trajectory/trajectory-batch-service.js
node scripts/characterization/characterize-record-status-v2.mjs
node scripts/characterization/characterize-trajectory.mjs
```
Expected: `node --check` 全过；characterize-record-status-v2 全过；**characterize-trajectory 预期失败**（旧五值钉子，Task 6 更新）——报告里如实记录失败输出，不视为阻塞。

- [ ] **Step 7: 报告**

报告写入 `.superpowers/sdd/2026-08-14-trajectory-record-status-v2/task-2-report.md`。最终消息：状态/文件/测试一句话/疑虑。

---

### Task 3: 占用/清理路径（prepare / detach / sweep / manual-record 闸）

**Files:**
- Modify: `src/services/trajectory/trajectory-attach-runner.js`（L164-167、L194）
- Modify: `src/services/trajectory/trajectory-attach-service.js`（L446-452 detach demote、L549-553 cleanup demote）
- Modify: `src/dao/trajectory-dao.js`（L215-217 clearMountByRemoteSessionId demote、L259 repairStaleRemoteMounts demote）
- Modify: `src/services/trajectory/trajectory-manual-record.js`（L29-33）

**Interfaces:**
- Consumes: `isAiRecordingActive` / `hasRunningPhase`（Task 1）
- Produces: demote 统一守卫（recording & AI 活跃→failed；recording & 非活跃→draft；其它不碰）

- [ ] **Step 1: prepare 防打回**

`trajectory-attach-runner.js`：
1. 顶部 import 区加：`import { isAiRecordingActive } from './trajectory-status-utils.js';`
2. L164-167 替换：

```js
    if (!(await isAiRecordingActive(tid))) {
      await trajectoryDao.updateMeta(tid, { recordStatus: 'recording' }).catch(() => {});
    }
```

（删除 `currentStatus` 变量。）
3. L194 `recordStatus: fresh?.recordStatus || (streamOk ? 'live' : traj?.recordStatus) || null,` 中的 `'live'` 改为 `'recording'`。

- [ ] **Step 2: detach / cleanup demote**

`trajectory-attach-service.js`：
1. 顶部加：`import { isAiRecordingActive } from './trajectory-status-utils.js';`
2. L446-452 的 demote 块（detach：`updateMetaIf` + `recordStatusIn:['live','recording']` → draft）替换为：

```js
  if (traj.recordStatus === 'recording') {
    const aiActive = await isAiRecordingActive(tid);
    await trajectoryDao.updateMetaIf(tid, {
      recordStatus: aiActive ? 'failed' : 'draft',
    }, { recordStatusIn: ['recording'] });
  }
```

（保留原块的 recorded/completed 不覆盖注释与守卫；`traj`/`tid` 沿用该函数既有变量名——动手前 read L420-460 确认。）
3. L549-553 的 cleanupPersistedTrajectoryResources demote 块同样替换（变量名以实际代码为准）。

- [ ] **Step 3: DAO sweep demote（两处）**

`src/dao/trajectory-dao.js`：
1. `clearMountByRemoteSessionId`（约 L173-181）循环内的：

```js
    const fields = { remoteSessionId: null };
    if (demoteLive && row.record_status === 'live') {
      fields.recordStatus = 'draft';
    }
```

替换为：

```js
    const fields = { remoteSessionId: null };
    if (demoteLive && row.record_status === 'recording'
        && !(await hasRunningPhase(row.id))) {
      fields.recordStatus = 'draft';
    }
```

2. `repairStaleRemoteMounts`（约 L218-224）里同样的 `row.recordStatus === 'live'` 条件做相同替换（`hasRunningPhase` 同文件内函数，直接调用）。

- [ ] **Step 4: 人工录制闸**

`trajectory-manual-record.js`：
1. 顶部加：`import { isAiRecordingActive } from './trajectory-status-utils.js';`
2. L29-33 替换：

```js
  if (enabled && (await isAiRecordingActive(tid))) {
    const err = new Error('AI recording in progress');
    err.statusCode = 409;
    throw err;
  }
```

- [ ] **Step 5: 语法检查 + 相关 characterize**

Run:
```
node --check src/services/trajectory/trajectory-attach-runner.js
node --check src/services/trajectory/trajectory-attach-service.js
node --check src/dao/trajectory-dao.js
node --check src/services/trajectory/trajectory-manual-record.js
node scripts/characterization/characterize-record-status-v2.mjs
node scripts/characterization/characterize-batch-task-progress.mjs
```
Expected: 全过；**characterize-batch-task-progress 预期失败**（`:140` 子串 `/currentStatus !== 'recording'/` 已被删除——Task 6 更新，如实记录不阻塞）。

- [ ] **Step 6: 报告**

报告写入 `.superpowers/sdd/2026-08-14-trajectory-record-status-v2/task-3-report.md`。

---

### Task 4: 闸门 + stats 键名 + api-docs

**Files:**
- Modify: `src/services/export-push-gate.js`（L6）
- Modify: `src/services/replay-service.js`（L36-45）
- Modify: `src/routes/v2/export-mgmt.js`（L306-316）
- Modify: `src/dao/trajectory-dao.js`（L58 `RECORD_STATUS_STATS`）
- Modify: `src/dashboard/api-docs/catalog.js`（L51、L63-72）
- Modify: `src/dashboard/api-docs/groups/recording.js`（L27,33,46-47,57,81,89,93,149,226,231,238,241,254,287,368）
- Modify: `src/dashboard/api-docs/groups/trajectory.js`（L50-53,66）
- Modify: `src/dashboard/api-docs/groups/websocket.js`（L50,65）
- Modify: `src/dashboard/api-docs/app.js`（L67-68）
- Modify: `src/dashboard/api-docs/slot-monitor.js`（L131,156,180-189）

**Interfaces:**
- Consumes: 新枚举/文案常量（Task 1）
- Produces: PUSHABLE=completed；回放闸只挡 recording；stats 新五档键名；api-docs 与常量对齐

- [ ] **Step 1: 推送闸**

`export-push-gate.js` L6 替换：

```js
export const PUSHABLE_RECORD_STATUSES = Object.freeze(['completed']);
```

- [ ] **Step 2: 回放闸**

`replay-service.js` L36-45：把条件里的 `'live'` 判断删除——只保留 `recordStatus === 'recording'` 时 409（failed 可回放）。保持其余结构不变。

- [ ] **Step 3: 批量推送跳过列表**

`export-mgmt.js` L306-316：把跳过状态列表 `['draft','live','recording']` 替换为 `['draft','recording','failed']`（先 read 确认原数组写法，只换数组字面量）。

- [ ] **Step 4: stats 键名**

`trajectory-dao.js` L58：

```js
const RECORD_STATUS_STATS = ['draft', 'recording', 'failed', 'recorded', 'completed'];
```

- [ ] **Step 5: api-docs 文案与示例（逐处替换）**

1. `catalog.js` L51 ENUMS 行：`recordStatus: draft / live / recording / recorded / completed` → `recordStatus: draft(未录制) / recording(录制中) / failed(录制异常) / recorded(待确认) / completed(已确认)`。
2. `catalog.js` L63-72 RECORDING_FLOW：`confirm（人工确认 → completed；取消 → draft）` → `confirm（人工确认 → completed；取消 → recorded）`；其它行中「live（占用）」表述改为「recording（录制中，含推流占用）」。
3. `groups/recording.js`：全文「占用中」→「录制中」；`recordStatus:'live'` 示例 → `'recording'`；prepare 说明「recordStatus 置为 live（占用，非 AI 录制）」→「recordStatus 置为 recording（录制中；纯推流占用，非 AI 录制）」；`record/start → recording；stop → recorded；stream/detach(live) → draft；detach(live|recording) → draft` → `record/start(draft|failed) → recording；stop(success) → recorded；stop(!success)/失败/中断 → failed；detach/stream-detach（非 AI 录制）→ draft；detach（AI 录制中）→ failed`；manual-record 说明「recordStatus=recording 时开启 409」→「AI 录制活跃时开启 409」。
4. `groups/trajectory.js` L50-53 参数说明：`draft | live | recording | recorded | completed` → `draft | recording | failed | recorded | completed`；L66 stats 示例 `{ total: 42, draft: 8, live: 2, recording: 5, recorded: 20, completed: 7 }` → `{ total: 42, draft: 8, recording: 7, failed: 0, recorded: 20, completed: 7 }`（求和=42）。
5. `groups/websocket.js` L50,65：payload 示例 `recordStatus:'draft'` 保留，注释「live 降级」改「录制中(非AI)降级」。
6. `app.js` L67-68：`stream/detach live→draft` → `stream/detach（非 AI 录制中）recording→draft`。
7. `slot-monitor.js` L131,156,180-189：徽标 `rec · live` → `rec · recording`（或「占用」字样改「录制中」）。

- [ ] **Step 6: 验证**

Run:
```
node --check src/services/export-push-gate.js
node --check src/services/replay-service.js
node --check src/routes/v2/export-mgmt.js
node --check src/dao/trajectory-dao.js
node --check src/dashboard/api-docs/catalog.js
node --check src/dashboard/api-docs/groups/recording.js
node --check src/dashboard/api-docs/groups/trajectory.js
node --check src/dashboard/api-docs/groups/websocket.js
node --check src/dashboard/api-docs/app.js
node --check src/dashboard/api-docs/slot-monitor.js
node scripts/characterization/characterize-record-status-v2.mjs
```
Expected: 全过。（characterize-export-push-gate 预期失败——Task 6 更新，如实记录。）

- [ ] **Step 7: 报告**

报告写入 `.superpowers/sdd/2026-08-14-trajectory-record-status-v2/task-4-report.md`。

---

### Task 5: Vue 另仓（`D:\dev\ui-auto-recording-agent-vue-master\vue-project`）

**Files:**
- Modify: `src/api/recording.ts`（L10、L141-148）
- Modify: `src/utils/trajectory-tree.ts`（L147-161）
- Modify: `src/views/ui-recording/index.vue`（L40-47、L271-274）
- Modify: `src/composables/useRecordingStudio.ts`（L94-95、L401、L675、L826）
- Modify: `src/views/ui-recording/detail/index.vue`（L152）
- Modify: `src/utils/recording-mapper.ts`（L29-30）

**Interfaces:**
- Consumes: 新枚举 + 中文文案（后端 Task 1 常量）
- Produces: 前端类型/文案/筛选与后端对齐（含修复历史缺 live 的类型缺口）

- [ ] **Step 1: 类型与 stats**

`src/api/recording.ts`：
1. L10 替换：

```ts
export type RecordStatus = 'draft' | 'recording' | 'failed' | 'recorded' | 'completed'
```

2. L141-148 `TrajectoryStats` 五档键替换：

```ts
export interface TrajectoryStats {
  total: number
  draft: number
  recording: number
  failed: number
  recorded: number
  completed: number
}
```

- [ ] **Step 2: 文案映射**

`src/utils/trajectory-tree.ts`：
1. L156-161 `RECORD_STATUS_LABEL` 替换：

```ts
export const RECORD_STATUS_LABEL: Record<string, string> = {
  draft: '未录制',
  recording: '录制中',
  failed: '录制异常',
  recorded: '待确认',
  completed: '已确认',
}
```

（先 read 该文件确认现有类型注解写法，保留 Record 注解风格。）
2. L147-153 `recordStatusToUi`：`failed` 映射到 UI 的 `'draft'`（未录制样式）并加注释 `// 录制异常按未录制样式展示，文案用 RECORD_STATUS_LABEL`；删除对 `'live'` 的分支（若有）。

- [ ] **Step 3: 列表筛选与样式**

`src/views/ui-recording/index.vue`：
1. L40-47 statusOptions 替换为五档：

```ts
const statusOptions = [
  { value: 'completed', label: '已确认' },
  { value: 'recorded', label: '待确认' },
  { value: 'recording', label: '录制中' },
  { value: 'failed', label: '录制异常' },
  { value: 'draft', label: '未录制' },
]
```

（先 read L35-50，保留数组现有结构风格，只换 value/label 集合。）
2. L271-274 `recordStatusClass`：`completed|recorded→success`、`recording→abandoned` 保留；删除 `|live`；新增 `failed→danger`（以文件实际写法为准，给出等价映射）。

- [ ] **Step 4: 直显枚举值改文案**

1. `useRecordingStudio.ts` L401 `` `录制已结束：${data.recordStatus}` `` → `` `录制已结束：${RECORD_STATUS_LABEL[data.recordStatus] || data.recordStatus}` ``（文件顶部 import `RECORD_STATUS_LABEL`；L675/L826 的回写值 'draft'/'recorded' 等按新枚举不变——'recorded' 仍是回写值）。
2. `detail/index.vue` L152「确认后交易状态将变为『录制完成』(completed)」→「确认后交易状态将变为『已确认』(completed)」。
3. `recording-mapper.ts` L29-30 的状态文案改用 `RECORD_STATUS_LABEL`（import 自 trajectory-tree.ts；保持函数签名不变）。

- [ ] **Step 5: 类型检查**

Run（vue-project 目录）: `npx vue-tsc --noEmit`
Expected: exit 0 无新增错误（该仓工作区另有 4 个既有未提交文件，不碰不 stage）。

- [ ] **Step 6: 报告**

报告写入 `.superpowers/sdd/2026-08-14-trajectory-record-status-v2/task-5-report.md`。

---

### Task 6: 钉子/smoke 更新 + CHANGELOG + 全量回归

**Files:**
- Modify: `scripts/characterization/characterize-trajectory.mjs`（L53-54、L167-169）
- Modify: `scripts/characterization/characterize-export-push-gate.mjs`（L13-35）
- Modify: `scripts/characterization/characterize-batch-task-progress.mjs`（L140）
- Modify: `scripts/smoke/accept-recording-apis.mjs`（约 10 处）
- Modify: `scripts/smoke/accept-multi-traj-lifecycle.mjs`（L126）
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: Task 1-5 全部
- Produces: 全量回归绿 + CHANGELOG 四件套

- [ ] **Step 1: characterize-trajectory 钉子**

1. L53-54 五值断言：把数组断言改为 `['draft','recording','failed','recorded','completed']`（先 read L45-60 确认现有断言结构，只换值列表）。
2. L167-169 源码子串正则：`recordStatus\s*=\s*success\s*\?\s*'recorded'\s*:\s*'draft'` → `recordStatus\s*=\s*success\s*\?\s*'recorded'\s*:\s*'failed'`。

- [ ] **Step 2: characterize-export-push-gate 钉子**

L13 断言 `PUSHABLE_RECORD_STATUSES === ['recorded','completed']` → `['completed']`；L15-35 各单值断言改为：completed→true 可推、recorded/failed/draft/recording→false 并 409（先 read 全文，按现有断言结构逐条改写，保留 409 code/recordStatus 字段断言）。

- [ ] **Step 3: characterize-batch-task-progress 钉子**

L140 子串 `/currentStatus !== 'recording'/` → `/isAiRecordingActive\(tid\)/`（读 `trajectory-attach-runner.js`）。

- [ ] **Step 4: smoke 更新**

`accept-recording-apis.mjs`：先 read 全文，按新枚举改写：
- 创建后断言 `recordStatus === 'draft'`（不变）；
- record/start 前手工 `UPDATE record_status='live'` 的测试行 → `'recording'`；
- stop 后 `'recorded'` 断言不变；
- 失败路径断言 `'draft'` → `'failed'`；
- L394-402 列存在性断言不变。
`accept-multi-traj-lifecycle.mjs` L126：stream/detach 后 `recordStatus` 断言 `'draft'` → `'draft'`（占用=录制中、非 AI → detach 回未录制，预期仍是 draft，如语义不同按实际输出修正并说明）。

- [ ] **Step 5: CHANGELOG [Unreleased] Added 条目**

在 `CHANGELOG.md` `## [Unreleased]` 第一个 `### Added` 区顶部插入：

```markdown
- 2026-08-14: **轨迹状态枚举 v2**：`trajectory.record_status` 由旧五态改为 `ENUM('draft','recording','failed','recorded','completed')`（未录制/录制中/录制异常/待确认/已确认）；`live`（推流占用）并入 `recording`（存量迁移）。录制失败/中断/批次恢复 INTERRUPTED → `failed`（重录走 record/start 或 clear 重置）；取消确认 completed→recorded；推送闸仅 `completed`；`isAiRecordingActive`（phase.status='running'）替换全部旧 live 判定；stats 五档键名与 api-docs/Vue 文案同步。
  影响范围：schema（迁移+init.sql）、录制/占用/清理全部写入点、export push gate、轨迹列表 stats、api-docs。
  文件：migrations/20260814120000_trajectory_record_status_v2.js, schemas/init.sql, src/models/constants.js, src/dao/trajectory-dao.js, src/services/trajectory/trajectory-status-utils.js, trajectory-recording-runner.js, trajectory-record-lifecycle.js, trajectory-meta-service.js, trajectory-batch-service.js, trajectory-attach-runner.js, trajectory-attach-service.js, trajectory-manual-record.js, src/services/export-push-gate.js, src/services/replay-service.js, src/routes/v2/export-mgmt.js, src/dashboard/api-docs/*, scripts/characterization/characterize-record-status-v2.mjs, characterize-trajectory.mjs, characterize-export-push-gate.mjs, characterize-batch-task-progress.mjs, scripts/smoke/accept-recording-apis.mjs, accept-multi-traj-lifecycle.mjs
  Python 同步提示：无状态值跨仓透传；Python 端若展示轨迹状态按新五档文案（未录制/录制中/录制异常/待确认/已确认）；`manual_record_status` 事件不变；stats 键名改为 draft/recording/failed/recorded/completed。
```

- [ ] **Step 6: 全量回归**

Run:
```
node scripts/characterization/characterize-record-status-v2.mjs
node scripts/characterization/characterize-trajectory.mjs
node scripts/characterization/characterize-export-push-gate.mjs
node scripts/characterization/characterize-batch-task-progress.mjs
node scripts/characterization/characterize-batch-import.mjs
node scripts/characterization/characterize-sys-msg.mjs
node scripts/characterization/characterize-batch-task-name.mjs
node scripts/smoke/accept-replay-apis.mjs
& "C:\Program Files\Git\bin\bash.exe" scripts/refactor/verify-all.sh
```
Expected: **全部 exit 0**（verify-all ALL GREEN）。任何失败先修再报。

- [ ] **Step 7: 报告**

报告写入 `.superpowers/sdd/2026-08-14-trajectory-record-status-v2/task-6-report.md`。

---

## 收尾（主线程）

- [ ] 审查 CHANGELOG 格式与越界；重跑 verify-all.sh
- [ ] 手工冒烟（有环境时）：create→prepare(录制中)→record/start→模拟失败(failed)→重录→recorded→confirm(completed)→取消确认(recorded)→clear(draft)；`?recordStatus=failed` 与 stats 五档
- [ ] Vue 仓提交与 JS-gen 提交各自只含任务文件（勿混入工作区他方改动：todo-list.md、heal-locate plan、Vue 4 个既有修改）
