# 批量导入任务名称 + 轨迹列表统计 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给批量导入任务加「任务名称」（默认 `文件名_MMDD-HHmm`）、给 `trajectory` 加所属批量任务外键，并让 `GET /api/v2/trajectories` 支持 `batchTaskName` 模糊查询、返回每行 `batchTaskName` 与五档 `stats` 统计，同时修复 Vue 消息抽屉深链 bug。

**Architecture:** JS-gen（Node/Express + Knex + MySQL）侧：`batch_recording_job` 加 `name` 列（迁移+回填），`trajectory` 加 `batch_job_id`（UUID，可空，FK）；名称公式抽成纯函数供运行时与迁移共用；轨迹列表在 `trajectory-dao.js` 内 LEFT JOIN + 过滤 + GROUP BY stats。Vue 侧（另仓）：类型/API 层 + batchImport store 名称链 + 弹窗输入与任务卡展示 + messageDrawer 深链修复。

**Tech Stack:** Node ESM（`"type": "module"`）、Knex 3 / mysql2、Express、characterization 脚本（node assert，无测试框架）、Vue 3 + TS + Pinia + Element Plus。

**Spec:** `docs/superpowers/specs/2026-08-14-batch-task-name-trajectory-stats-design.md`（以该 spec 的 Locked decisions 为准）。

## Global Constraints

- API 字段一律 `batchTaskName`（camelCase）；DB 列名 `name` / `batch_job_id`。
- 默认名称公式：`stripExtension(originalFilename) + '_' + MMDD-HHmm`（服务器本地时区，创建时刻）；文件名为空兜底 `批量导入`；文件名部分截断 501。
- `sys_msg` 消息链路与 `scripts/characterization/characterize-sys-msg.mjs` **完全不动**；新 `name` 不进消息正文。
- `schemas/init.sql` 只补 `trajectory.batch_job_id` 列+索引；**不写 FK**（batch 表不在 init.sql）。
- 四件套：迁移 + init.sql + `CHANGELOG.md [Unreleased]`（Task 7 统一追加）+ Python 同步提示。
- 每任务结束必须 commit（JS-gen 与 Vue 仓各自 commit，**不 push**）。
- 并行执行时各任务文件集无交集；本计划任务按顺序执行时相邻任务可共享 `characterize-batch-task-name.mjs`。
- 不在本计划范围：轨迹 `record_status` 枚举演进（未录制/录制中/录制异常/待确认/已确认——见 spec Future work TODO）；轨迹列表「所属批量任务」前端展示列（后置可选）。

## File Structure

| 文件 | 职责 |
|------|------|
| `src/services/trajectory/batch-job-name.js`（新） | 纯函数：`stripExtension` / `formatMonthDayHourMinute` / `defaultJobName` / `BATCH_JOB_NAME_MAX_FILENAME` |
| `migrations/20260814100000_batch_job_name.js`（新） | `batch_recording_job.name VARCHAR(512)` + 存量回填 |
| `migrations/20260814110000_trajectory_batch_job.js`（新） | `trajectory.batch_job_id` + 索引 + FK |
| `schemas/init.sql` | trajectory 定义补 `batch_job_id`（无 FK） |
| `src/dao/batch-recording-dao.js` | `createJob` 持久化 `name` |
| `src/services/trajectory/trajectory-batch-service.js` | `importBatchFromExcel` 接受/生成 `name`；`getBatchJobView` 返回 `name` |
| `src/routes/v2/trajectory-batch.js` | import 路由透传 `name` |
| `src/dao/trajectory-dao.js` | `save` 写 `batchJobId`；`list`/`listByFunction` join + `batchTaskName` 过滤 + `stats`；新增 `countByRecordStatus` |
| `src/services/trajectory/trajectory-meta-service.js` | `createTransactionWithPhases` 接受 `batchJobId` |
| `src/services/trajectory/batch-analyze.js` | 批量轨迹壳创建时传 `batchJobId: job.id` |
| `src/routes/v2/trajectory.js` | 列表路由透传 `batchTaskName` |
| `src/dashboard/api-docs/groups/trajectory.js` | `/api/v2/trajectories` 契约更新 |
| `scripts/characterization/characterize-batch-task-name.mjs`（新） | 公式断言 + 源码子串 pin |
| `CHANGELOG.md` | `[Unreleased]` Added 条目 + Python 同步提示 |
| Vue（另仓）`api/recording.ts` / `stores/batchImport.ts` / `BatchImportDialog.vue` / `messageDrawer.vue` | 类型、store 名称链、输入框+任务卡、深链修复 |

---

### Task 1: 名称公式纯函数 + characterization（公式断言）

**Files:**
- Create: `src/services/trajectory/batch-job-name.js`
- Create: `scripts/characterization/characterize-batch-task-name.mjs`

**Interfaces:**
- Consumes: 无
- Produces: `stripExtension(filename)`, `formatMonthDayHourMinute(d)`, `defaultJobName(originalFilename, createdAt)`, `BATCH_JOB_NAME_MAX_FILENAME`（=501）。后续 Task 2/4 导入 `defaultJobName`。

- [ ] **Step 1: 写 characterization（先失败——被导入的模块还不存在）**

创建 `scripts/characterization/characterize-batch-task-name.mjs`：

```js
/**
 * Characterization smoke for batch task name（公式 / 迁移标记 / 列表统计）。
 * Usage: node scripts/characterization/characterize-batch-task-name.mjs
 */
import assert from 'assert';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import {
  stripExtension,
  formatMonthDayHourMinute,
  defaultJobName,
  BATCH_JOB_NAME_MAX_FILENAME,
} from '../../src/services/trajectory/batch-job-name.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

let failed = 0;
function ok(name) { console.log(`  ✓ ${name}`); }
function fail(name, err) { failed += 1; console.error(`  ✗ ${name}:`, err?.message || err); }

function run(name, fn) {
  try { fn(); ok(name); } catch (err) { fail(name, err); }
}

async function main() {
  run('default name 模板_0814-1251', () => {
    assert.strictEqual(
      defaultJobName('批量录制导入模板.xlsx', new Date(2026, 7, 14, 12, 51)),
      '批量录制导入模板_0814-1251',
    );
  });
  run('strip last extension only', () => {
    assert.strictEqual(stripExtension('a.b.xlsx'), 'a.b');
    assert.strictEqual(stripExtension('noext'), 'noext');
    assert.strictEqual(stripExtension('.xlsx'), '.xlsx');
  });
  run('empty filename falls back to 批量导入', () => {
    const out = defaultJobName('', new Date(2026, 7, 14, 12, 51));
    assert.ok(out.startsWith('批量导入_'), out);
  });
  run('truncates filename part to 501', () => {
    const long = 'x'.repeat(600) + '.xlsx';
    const out = defaultJobName(long, new Date(2026, 7, 14, 12, 51));
    assert.strictEqual(out.length, BATCH_JOB_NAME_MAX_FILENAME + '_0814-1251'.length);
    assert.ok(out.startsWith('x'.repeat(BATCH_JOB_NAME_MAX_FILENAME)));
  });
  run('formats MMDD-HHmm with zero padding', () => {
    assert.strictEqual(formatMonthDayHourMinute(new Date(2026, 0, 5, 8, 5)), '0105-0805');
  });

  const failedCount = failed;
  console.log(failedCount ? `\n${failedCount} failed` : '\nall ok');
  process.exit(failedCount ? 1 : 0);
}

main();
```

- [ ] **Step 2: 运行确认失败**

Run: `node scripts/characterization/characterize-batch-task-name.mjs`
Expected: 报错 `Cannot find module .../batch-job-name.js`（exit 1）

- [ ] **Step 3: 实现纯函数模块**

创建 `src/services/trajectory/batch-job-name.js`：

```js
/**
 * Batch job task name formula：文件名(去扩展名) + '_MMDD-HHmm'（服务器本地时区）。
 * 运行时创建与迁移回填共用，保持零依赖纯函数。
 */

/** 去掉最后一个扩展名；无点或点在首位（如 ".xlsx"）时原样返回。 */
export function stripExtension(filename) {
  const s = String(filename || '').trim();
  const idx = s.lastIndexOf('.');
  return idx > 0 ? s.slice(0, idx) : s;
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

/** 'MMDD-HHmm'，服务器本地时区。 */
export function formatMonthDayHourMinute(d) {
  const dt = d instanceof Date ? d : new Date(d);
  return `${pad2(dt.getMonth() + 1)}${pad2(dt.getDate())}-${pad2(dt.getHours())}${pad2(dt.getMinutes())}`;
}

/** 文件名部分最大长度（后缀 '_MMDD-HHmm' 共 10 字符 + 分隔符 1，512-11=501）。 */
export const BATCH_JOB_NAME_MAX_FILENAME = 501;

/**
 * defaultJobName('批量录制导入模板.xlsx', new Date(2026, 7, 14, 12, 51))
 *   → '批量录制导入模板_0814-1251'
 */
export function defaultJobName(originalFilename, createdAt) {
  const base = stripExtension(originalFilename) || '批量导入';
  return `${base.slice(0, BATCH_JOB_NAME_MAX_FILENAME)}_${formatMonthDayHourMinute(createdAt)}`;
}
```

- [ ] **Step 4: 运行确认通过**

Run: `node scripts/characterization/characterize-batch-task-name.mjs`
Expected: 5 条 ✓，`all ok`，exit 0

- [ ] **Step 5: 语法检查 + Commit**

Run: `node --check src/services/trajectory/batch-job-name.js && node --check scripts/characterization/characterize-batch-task-name.mjs`
Expected: 无输出、exit 0

```bash
git add src/services/trajectory/batch-job-name.js scripts/characterization/characterize-batch-task-name.mjs
git commit -m "feat: batch job name formula (defaultJobName) + characterization"
```

---

### Task 2: 迁移 1 — `batch_recording_job.name` + 存量回填

**Files:**
- Create: `migrations/20260814100000_batch_job_name.js`
- Modify: `scripts/characterization/characterize-batch-task-name.mjs`（追加迁移 pin）

**Interfaces:**
- Consumes: `defaultJobName`（Task 1）
- Produces: `batch_recording_job.name VARCHAR(512) NOT NULL DEFAULT ''`（Task 4/7 依赖）

- [ ] **Step 1: 写迁移**

创建 `migrations/20260814100000_batch_job_name.js`：

```js
/**
 * batch_recording_job.name — 任务名称（默认 文件名_MMDD-HHmm）。
 * 存量行按同一公式回填（与运行时创建共用 batch-job-name.js）。
 */
import { defaultJobName } from '../src/services/trajectory/batch-job-name.js';

export async function up(knex) {
  await knex.schema.alterTable('batch_recording_job', (t) => {
    t.string('name', 512).notNullable().defaultTo('')
      .after('original_filename')
      .comment('任务名称；默认 文件名_MMDD-HHmm');
  });

  const rows = await knex('batch_recording_job').select('id', 'original_filename', 'created_at');
  for (const row of rows) {
    const name = defaultJobName(row.original_filename, row.created_at);
    await knex('batch_recording_job').where({ id: row.id }).update({ name });
  }
}

export async function down(knex) {
  await knex.schema.alterTable('batch_recording_job', (t) => {
    t.dropColumn('name');
  });
}
```

- [ ] **Step 2: 语法与导入烟测**

Run:
```
node --check migrations/20260814100000_batch_job_name.js
node -e "import('./migrations/20260814100000_batch_job_name.js').then(m => { if (typeof m.up !== 'function' || typeof m.down !== 'function') throw new Error('bad exports'); console.log('migration module ok'); })"
```
Expected: 无错误，打印 `migration module ok`（仅加载模块，不连库）

- [ ] **Step 3: characterization 追加迁移 pin**

在 `characterize-batch-task-name.mjs` 的 `main()` 里（`formatMonthDayHourMinute` 用例之后、`failedCount` 之前）追加：

```js
  run('migration 1: name column + backfill via shared formula', () => {
    const mig = readFileSync(join(ROOT, 'migrations', '20260814100000_batch_job_name.js'), 'utf8');
    assert.ok(mig.includes("t.string('name', 512)"), 'name VARCHAR(512)');
    assert.ok(mig.includes('defaultJobName(row.original_filename, row.created_at)'), 'backfill formula');
    assert.ok(mig.includes("from '../src/services/trajectory/batch-job-name.js'"), 'shared module import');
  });
```

- [ ] **Step 4: 运行 characterization 确认通过**

Run: `node scripts/characterization/characterize-batch-task-name.mjs`
Expected: 6 条 ✓，exit 0

- [ ] **Step 5: （可选，有本地 MySQL 时）执行迁移**

Run: `npx knex migrate:latest --knexfile config/knexfile.js`
Expected: 迁移列表含 `20260814100000_batch_job_name.js` 且 Batch 1 执行成功；再查 `SELECT name FROM batch_recording_job LIMIT 5;` 旧行 name 非空。
若无本地 MySQL，跳过并如实注明「未跑迁移」。

- [ ] **Step 6: Commit**

```bash
git add migrations/20260814100000_batch_job_name.js scripts/characterization/characterize-batch-task-name.mjs
git commit -m "feat: batch_recording_job.name migration with backfill"
```

---

### Task 3: 迁移 2 — `trajectory.batch_job_id` + init.sql

**Files:**
- Create: `migrations/20260814110000_trajectory_batch_job.js`
- Modify: `schemas/init.sql`（trajectory 表定义，约 L103 / L109 处）
- Modify: `scripts/characterization/characterize-batch-task-name.mjs`（追加 pin）

**Interfaces:**
- Consumes: `batch_recording_job` 表（迁移 20260802140000）
- Produces: `trajectory.batch_job_id VARCHAR(36) NULL` + `idx_batch_job_id` + FK `fk_traj_batch_job`（Task 5/6 依赖）

- [ ] **Step 1: 写迁移**

创建 `migrations/20260814110000_trajectory_batch_job.js`：

```js
/**
 * trajectory.batch_job_id — 所属批量导入任务（batch_recording_job.id，UUID）。
 * NULL = 用户手动创建。job.id 是 VARCHAR(36)，列类型必须一致。
 */
export async function up(knex) {
  await knex.schema.alterTable('trajectory', (t) => {
    t.string('batch_job_id', 36).nullable()
      .comment('所属批量导入任务（batch_recording_job.id，UUID）；NULL=手动创建');
    t.index(['batch_job_id'], 'idx_batch_job_id');
  });
  await knex.raw(`
    ALTER TABLE trajectory
      ADD CONSTRAINT fk_traj_batch_job
      FOREIGN KEY (batch_job_id) REFERENCES batch_recording_job (id)
      ON DELETE SET NULL
  `);
}

export async function down(knex) {
  await knex.raw('ALTER TABLE trajectory DROP FOREIGN KEY fk_traj_batch_job');
  await knex.schema.alterTable('trajectory', (t) => {
    t.dropIndex('idx_batch_job_id');
    t.dropColumn('batch_job_id');
  });
}
```

- [ ] **Step 2: init.sql 同步（只加列+索引，不加 FK）**

在 `schemas/init.sql` 的 trajectory 表定义中：
- `remote_session_id` 行（L103）之后插入：

```sql
  `batch_job_id`       VARCHAR(36) DEFAULT NULL COMMENT '所属批量导入任务（batch_recording_job.id，UUID）；NULL=手动创建',
```

- `KEY `idx_remote_session_id` (`remote_session_id`),` 行（L109）之后插入：

```sql
  KEY `idx_batch_job_id` (`batch_job_id`),
```

- **不得**在 init.sql 添加任何 `batch_recording_job` 外键（batch 表不在 init.sql，写 FK 会导致新库初始化失败）。

- [ ] **Step 3: characterization 追加 pin**

在 `main()` 追加：

```js
  run('migration 2: trajectory.batch_job_id (UUID, FK) + init.sql column only', () => {
    const mig = readFileSync(join(ROOT, 'migrations', '20260814110000_trajectory_batch_job.js'), 'utf8');
    assert.ok(mig.includes("t.string('batch_job_id', 36)"), 'batch_job_id VARCHAR(36)');
    assert.ok(mig.includes('fk_traj_batch_job'), 'FK constraint');
    assert.ok(mig.includes('ON DELETE SET NULL'), 'FK on delete set null');
    const init = readFileSync(join(ROOT, 'schemas', 'init.sql'), 'utf8');
    assert.ok(init.includes('`batch_job_id`       VARCHAR(36)'), 'init.sql column');
    assert.ok(init.includes('KEY `idx_batch_job_id`'), 'init.sql index');
    assert.ok(!init.includes('fk_traj_batch_job'), 'init.sql must NOT contain the FK');
  });
```

- [ ] **Step 4: 语法检查 + 运行 characterization**

Run:
```
node --check migrations/20260814110000_trajectory_batch_job.js
node scripts/characterization/characterize-batch-task-name.mjs
```
Expected: 7 条 ✓，exit 0

- [ ] **Step 5: （可选，有本地 MySQL 时）执行迁移**

Run: `npx knex migrate:latest --knexfile config/knexfile.js`
Expected: `20260814110000_trajectory_batch_job.js` 执行成功；`SHOW CREATE TABLE trajectory` 含 `batch_job_id` 与 `fk_traj_batch_job`。
若无本地 MySQL，跳过并如实注明。

- [ ] **Step 6: Commit**

```bash
git add migrations/20260814110000_trajectory_batch_job.js schemas/init.sql scripts/characterization/characterize-batch-task-name.mjs
git commit -m "feat: trajectory.batch_job_id FK migration + init.sql column"
```

---

### Task 4: 创建链 — 路由透传 / service 生成 / DAO 落库 / job 视图返回 name

**Files:**
- Modify: `src/routes/v2/trajectory-batch.js`（import 路由，约 L49-57）
- Modify: `src/services/trajectory/trajectory-batch-service.js`（`importBatchFromExcel` L227-323、`getBatchJobView` L194-225）
- Modify: `src/dao/batch-recording-dao.js`（`createJob` L37-52）
- Modify: `scripts/characterization/characterize-batch-task-name.mjs`（追加 pin）

**Interfaces:**
- Consumes: `defaultJobName`（Task 1）
- Produces: `POST /v2/trajectories/batch/import` 可选 FormData 字段 `name`；`GET /v2/trajectories/batch/{batchId}` 响应顶层 `name`（Task 9 Vue 消费）

- [ ] **Step 1: DAO `createJob` 落库 name**

`src/dao/batch-recording-dao.js` `createJob` 的 insert 字段里，`originalFilename: job.originalFilename || '',` 之后加：

```js
      name: job.name || '',
```

- [ ] **Step 2: service `importBatchFromExcel` 生成/透传 name**

`src/services/trajectory/trajectory-batch-service.js`：
1. 文件顶部 import 区（`decodeUploadFilename` 之后）加：

```js
import { defaultJobName } from './batch-job-name.js';
```

2. `importBatchFromExcel` 解构参数加 `name: rawName = '',`（加在 `mode: rawMode,` 之后）：

```js
export async function importBatchFromExcel({
  fileBuffer,
  originalFilename = '',
  functionId,
  systemAccountId,
  model = '',
  idempotencyKey,
  mode: rawMode,
  name: rawName = '',
} = {}) {
```

3. `const mode = normalizeBatchMode(rawMode);` 之后加：

```js
  const taskName = String(rawName || '').trim()
    || defaultJobName(originalFilename, new Date());
```

4. `batchDao.createJob({ ... })` 调用里，`originalFilename: decodeUploadFilename(originalFilename),` 之后加：

```js
      name: taskName,
```

- [ ] **Step 3: 路由透传 name**

`src/routes/v2/trajectory-batch.js` import 路由的 `importBatchFromExcel({...})` 参数里，`mode: req.body?.mode,` 之后加：

```js
          name: req.body?.name,
```

- [ ] **Step 4: `getBatchJobView` 返回 name**

`src/services/trajectory/trajectory-batch-service.js` `getBatchJobView` 返回对象里，`batchId: job.id,` 之后加：

```js
    name: job.name || '',
```

- [ ] **Step 5: characterization 追加 pin**

`main()` 追加：

```js
  run('creation chain: route param / service formula / dao persist / view field', () => {
    const route = readFileSync(join(ROOT, 'src', 'routes', 'v2', 'trajectory-batch.js'), 'utf8');
    assert.ok(route.includes('name: req.body?.name'), 'route passes name');
    const svc = readFileSync(join(ROOT, 'src', 'services', 'trajectory', 'trajectory-batch-service.js'), 'utf8');
    assert.ok(svc.includes('defaultJobName(originalFilename, new Date())'), 'service default formula');
    assert.ok(svc.includes("import { defaultJobName } from './batch-job-name.js'"), 'service import');
    assert.ok(svc.includes('name: job.name || \'\''), 'job view returns name');
    const dao = readFileSync(join(ROOT, 'src', 'dao', 'batch-recording-dao.js'), 'utf8');
    assert.ok(dao.includes('name: job.name || \'\''), 'dao persists name');
  });
```

- [ ] **Step 6: 语法检查 + 全量验证**

Run:
```
node --check src/routes/v2/trajectory-batch.js
node --check src/services/trajectory/trajectory-batch-service.js
node --check src/dao/batch-recording-dao.js
node scripts/characterization/characterize-batch-task-name.mjs
node scripts/characterization/characterize-batch-import.mjs
node scripts/characterization/characterize-batch-task-progress.mjs
node scripts/characterization/characterize-sys-msg.mjs
```
Expected: 全部 exit 0（sys-msg 回归必须保持通过）

- [ ] **Step 7: Commit**

```bash
git add src/routes/v2/trajectory-batch.js src/services/trajectory/trajectory-batch-service.js src/dao/batch-recording-dao.js scripts/characterization/characterize-batch-task-name.mjs
git commit -m "feat: batch import accepts name, persists it, returns it in job view"
```

---

### Task 5: 批量轨迹壳绑定 `batch_job_id`

**Files:**
- Modify: `src/services/trajectory/trajectory-meta-service.js`（`createTransactionWithPhases` L191-237）
- Modify: `src/dao/trajectory-dao.js`（`save` L68-84）
- Modify: `src/services/trajectory/batch-analyze.js`（L176-186）
- Modify: `scripts/characterization/characterize-batch-task-name.mjs`（追加 pin）

**Interfaces:**
- Consumes: `trajectory.batch_job_id` 列（Task 3）
- Produces: `createTransactionWithPhases({ ..., batchJobId })` → `trajectoryDao.save({ ..., batchJobId })`（手动创建不传 → NULL）

- [ ] **Step 1: `trajectoryDao.save` 落库 batchJobId**

`src/dao/trajectory-dao.js` `save` 的 insert 字段里，`remoteSessionId: trajectory.remoteSessionId ?? null,` 之后加：

```js
      batchJobId: trajectory.batchJobId ?? null,
```

- [ ] **Step 2: `createTransactionWithPhases` 接受 batchJobId**

`src/services/trajectory/trajectory-meta-service.js`：
1. 函数解构参数里 `requireFunctionId = false,` 之后加：

```js
  batchJobId = null,
```

2. `trajectoryDao.save({...})` 字段里 `recordStatus: 'draft',` 之后加：

```js
      batchJobId: batchJobId ?? null,
```

- [ ] **Step 3: batch-analyze 传 job.id**

`src/services/trajectory/batch-analyze.js` 的 `createTransactionWithPhases({...})` 调用里，`systemAccountId: Number(job.systemAccountId),` 之后加：

```js
        batchJobId: job.id,
```

- [ ] **Step 4: characterization 追加 pin**

`main()` 追加：

```js
  run('batch trajectory binding: batchJobId through save chain', () => {
    const meta = readFileSync(join(ROOT, 'src', 'services', 'trajectory', 'trajectory-meta-service.js'), 'utf8');
    assert.ok(meta.includes('batchJobId = null,'), 'meta accepts batchJobId');
    const dao = readFileSync(join(ROOT, 'src', 'dao', 'trajectory-dao.js'), 'utf8');
    assert.ok(dao.includes('batchJobId: trajectory.batchJobId ?? null'), 'dao save batchJobId');
    const analyze = readFileSync(join(ROOT, 'src', 'services', 'trajectory', 'batch-analyze.js'), 'utf8');
    assert.ok(analyze.includes('batchJobId: job.id'), 'analyze passes job.id');
  });
```

- [ ] **Step 5: 语法检查 + 运行 characterization**

Run:
```
node --check src/dao/trajectory-dao.js
node --check src/services/trajectory/trajectory-meta-service.js
node --check src/services/trajectory/batch-analyze.js
node scripts/characterization/characterize-batch-task-name.mjs
node scripts/characterization/characterize-trajectory.mjs
```
Expected: 全部 exit 0

- [ ] **Step 6: Commit**

```bash
git add src/dao/trajectory-dao.js src/services/trajectory/trajectory-meta-service.js src/services/trajectory/batch-analyze.js scripts/characterization/characterize-batch-task-name.mjs
git commit -m "feat: bind batch-created trajectories to batch_job_id"
```

---

### Task 6: 轨迹列表 join / 模糊过滤 / 五档 stats + 路由参数 + api-docs

**Files:**
- Modify: `src/dao/trajectory-dao.js`（`applyListFilters`、`SORT_COL_MAP`、`list`、`listByFunction`、新增 `applyBatchTaskNameFilter` 与 `countByRecordStatus`）
- Modify: `src/routes/v2/trajectory.js`（L57-92）
- Modify: `src/dashboard/api-docs/groups/trajectory.js`（GET `/api/v2/trajectories` 条目，L42-65）
- Modify: `scripts/characterization/characterize-batch-task-name.mjs`（追加 pin）

**Interfaces:**
- Consumes: `trajectory.batch_job_id` / `batch_recording_job.name`（Task 2/3）
- Produces: `GET /api/v2/trajectories?batchTaskName=`；响应行 `batchTaskName: string|null`；响应 `stats: { total, draft, live, recording, recorded, completed }`

- [ ] **Step 1: 限定列名（防 join 后二义）+ SORT_COL_MAP 加表前缀**

`src/dao/trajectory-dao.js`：
1. `applyListFilters` 改为限定列名：

```js
function applyListFilters(query, { keyword, recordStatus } = {}) {
  if (keyword && String(keyword).trim()) {
    const kw = `%${String(keyword).trim()}%`;
    query.where(function () {
      this.where('t.name', 'like', kw).orWhere('t.task', 'like', kw);
    });
  }
  const statuses = parseRecordStatuses(recordStatus);
  if (statuses) {
    query.whereIn('t.record_status', statuses);
  }
  return query;
}
```

2. `SORT_COL_MAP` 全部值加 `t.` 前缀：

```js
const SORT_COL_MAP = {
  created_at: 't.created_at',
  createdAt: 't.created_at',
  updated_at: 't.updated_at',
  updatedAt: 't.updated_at',
  name: 't.name',
  step_count: 't.step_count',
  stepCount: 't.step_count',
  phase_count: 't.phase_count',
  phaseCount: 't.phase_count',
  record_status: 't.record_status',
  recordStatus: 't.record_status',
};
```

- [ ] **Step 2: 新增 `applyBatchTaskNameFilter` 与 `countByRecordStatus`**

在 `applyListFilters` 之后加：

```js
function applyBatchTaskNameFilter(query, batchTaskName) {
  const v = batchTaskName == null ? '' : String(batchTaskName).trim();
  if (v) {
    query.where('bj.name', 'like', `%${v}%`);
  }
  return query;
}

const RECORD_STATUS_STATS = ['draft', 'live', 'recording', 'recorded', 'completed'];

/**
 * 五档统计：与行查询同基准过滤（functionId/keyword/batchTaskName），忽略 recordStatus。
 * @returns {Promise<{ total: number, draft: number, live: number, recording: number, recorded: number, completed: number }>}
 */
export async function countByRecordStatus({ functionId = null, keyword = null, batchTaskName = null } = {}) {
  const db = getDB();
  const base = db({ t: TABLE })
    .leftJoin({ bj: 'batch_recording_job' }, 'bj.id', 't.batch_job_id');
  if (functionId != null && Number.isFinite(Number(functionId))) {
    base.where('t.function_id', Number(functionId));
  }
  applyListFilters(base, { keyword, recordStatus: null });
  applyBatchTaskNameFilter(base, batchTaskName);
  const rows = await base
    .select('t.record_status as recordStatus')
    .count('* as cnt')
    .groupBy('t.record_status');
  const stats = { total: 0 };
  for (const s of RECORD_STATUS_STATS) stats[s] = 0;
  for (const r of rows) {
    const key = String(r.recordStatus);
    const n = Number(r.cnt) || 0;
    stats.total += n;
    if (key in stats) stats[key] = n;
  }
  return stats;
}
```

- [ ] **Step 3: 重写 `listByFunction`（join + select + stats）**

`src/dao/trajectory-dao.js` 的 `listByFunction` 整体替换为：

```js
export async function listByFunction(functionId, {
  page = 1, pageSize = 20, keyword, sortBy, order, recordStatus, batchTaskName = null,
} = {}) {
  const db = getDB();
  const offset = (page - 1) * pageSize;
  const base = db({ t: TABLE })
    .leftJoin({ bj: 'batch_recording_job' }, 'bj.id', 't.batch_job_id')
    .where('t.function_id', functionId);
  const query = applyListFilters(base, { keyword, recordStatus });
  applyBatchTaskNameFilter(query, batchTaskName);

  const sortCol = SORT_COL_MAP[sortBy] || 't.created_at';
  const sortOrder = String(order).toLowerCase() === 'asc' ? 'asc' : 'desc';

  const [{ total }] = await query.clone().count('* as total');
  const rows = await query.clone()
    .select('t.*', 'bj.name as batchTaskName')
    .orderBy(sortCol, sortOrder)
    .limit(pageSize)
    .offset(offset);
  const entities = fromDbRows(rows);

  // Attach phase counts for hierarchy UI
  for (const e of entities) {
    e.isExport = Number(e.isExport) ? 1 : 0;
    const [{ phases }] = await db('trajectory_phase')
      .where({ trajectory_id: e.id })
      .count('* as phases');
    e.phaseCount = Number(phases) || 0;
  }
  const stats = await countByRecordStatus({ functionId, keyword, batchTaskName });
  return { rows: entities, total, page, pageSize, stats };
}
```

- [ ] **Step 4: 重写 `list`（无 functionId 过滤）**

`src/dao/trajectory-dao.js` 的 `list` 整体替换为：

```js
export async function list({
  page = 1, pageSize = 20, keyword, sortBy, order, recordStatus, batchTaskName = null,
} = {}) {
  const db = getDB();
  const offset = (page - 1) * pageSize;
  const base = db({ t: TABLE })
    .leftJoin({ bj: 'batch_recording_job' }, 'bj.id', 't.batch_job_id');
  const query = applyListFilters(base, { keyword, recordStatus });
  applyBatchTaskNameFilter(query, batchTaskName);

  const sortCol = SORT_COL_MAP[sortBy] || 't.created_at';
  const sortOrder = String(order).toLowerCase() === 'asc' ? 'asc' : 'desc';

  const [{ total }] = await query.clone().count('* as total');
  const rows = await query.clone()
    .select('t.*', 'bj.name as batchTaskName')
    .orderBy(sortCol, sortOrder)
    .limit(pageSize)
    .offset(offset);
  const entities = fromDbRows(rows);
  for (const e of entities) {
    e.isExport = Number(e.isExport) ? 1 : 0;
    const [{ phases }] = await db('trajectory_phase')
      .where({ trajectory_id: e.id })
      .count('* as phases');
    e.phaseCount = Number(phases) || 0;
  }
  const stats = await countByRecordStatus({ keyword, batchTaskName });
  return { rows: entities, total, page, pageSize, stats };
}
```

- [ ] **Step 5: 路由透传 batchTaskName**

`src/routes/v2/trajectory.js`：
1. 解构查询参数处（`status,` 之后）加：

```js
        batchTaskName,
```

2. `pagination` 对象里（`recordStatus: statusRaw,` 之后）加：

```js
        batchTaskName: batchTaskName ?? null,
```

（`listByFunction` 与 `list` 均从 pagination 读取该字段，无需改 `trajectory-query-service.js`。）

- [ ] **Step 6: api-docs 契约更新**

`src/dashboard/api-docs/groups/trajectory.js` 的 `GET /api/v2/trajectories` 条目：
1. `params` 数组里 `order` 参数之后加：

```js
          { name: 'batchTaskName', type: 'string', in: 'query', desc: '按所属批量导入任务名模糊筛选（空=不过滤；LIKE %值%）', example: '批量录制导入模板' },
```

2. `respExample` 替换为：

```js
        respExample: J({
          rows: [{
            id: 42, name: '开户交易', task: '需求描述',
            recordStatus: 'draft', isExport: 0, stepCount: 0, phaseCount: 3,
            functionId: 3, systemAccountId: 10, model: 'deepseek-v4-flash',
            batchTaskName: '批量录制导入模板_0814-1251',
          }],
          total: 42, page: 1, pageSize: 20,
          stats: { total: 42, draft: 8, live: 2, recording: 5, recorded: 20, completed: 7 },
        }),
```

- [ ] **Step 7: characterization 追加 pin**

`main()` 追加：

```js
  run('trajectory list: join / fuzzy filter / stats', () => {
    const dao = readFileSync(join(ROOT, 'src', 'dao', 'trajectory-dao.js'), 'utf8');
    assert.ok(dao.includes("leftJoin({ bj: 'batch_recording_job' }, 'bj.id', 't.batch_job_id')"), 'left join');
    assert.ok(dao.includes("query.where('bj.name', 'like', `%${v}%`)"), 'fuzzy filter');
    assert.ok(dao.includes("select('t.*', 'bj.name as batchTaskName')"), 'row field');
    assert.ok(dao.includes('countByRecordStatus({ functionId, keyword, batchTaskName })'), 'stats by function');
    assert.ok(dao.includes('countByRecordStatus({ keyword, batchTaskName })'), 'stats without function');
    assert.ok(dao.includes("const stats = { total: 0 };"), 'stats shape');
    const route = readFileSync(join(ROOT, 'src', 'routes', 'v2', 'trajectory.js'), 'utf8');
    assert.ok(route.includes('batchTaskName: batchTaskName ?? null'), 'route passes param');
    const docs = readFileSync(join(ROOT, 'src', 'dashboard', 'api-docs', 'groups', 'trajectory.js'), 'utf8');
    assert.ok(docs.includes("name: 'batchTaskName', type: 'string'"), 'api-docs param');
    assert.ok(docs.includes('batchTaskName: \'批量录制导入模板_0814-1251\''), 'api-docs example');
  });
```

- [ ] **Step 8: 语法检查 + 回归**

Run:
```
node --check src/dao/trajectory-dao.js
node --check src/routes/v2/trajectory.js
node --check src/dashboard/api-docs/groups/trajectory.js
node scripts/characterization/characterize-batch-task-name.mjs
node scripts/characterization/characterize-trajectory.mjs
node scripts/characterization/characterize-dedup.mjs
```
Expected: 全部 exit 0

- [ ] **Step 9: Commit**

```bash
git add src/dao/trajectory-dao.js src/routes/v2/trajectory.js src/dashboard/api-docs/groups/trajectory.js scripts/characterization/characterize-batch-task-name.mjs
git commit -m "feat: trajectories list batchTaskName fuzzy filter + five-state stats"
```

---

### Task 7: 回归验证 + CHANGELOG（四件套收尾）

**Files:**
- Modify: `CHANGELOG.md`（`[Unreleased]` 下 `### Added` 区顶部）
- 无代码改动

**Interfaces:**
- Consumes: Task 1-6 全部产物
- Produces: CHANGELOG 条目（含 Python 同步提示）

- [ ] **Step 1: 全量 characterization + 重构门禁**

Run:
```
node scripts/characterization/characterize-batch-task-name.mjs
node scripts/characterization/characterize-batch-import.mjs
node scripts/characterization/characterize-batch-task-progress.mjs
node scripts/characterization/characterize-sys-msg.mjs
node scripts/characterization/characterize-trajectory.mjs
node scripts/characterization/characterize-dedup.mjs
node scripts/characterization/characterize-ctrl.mjs
bash scripts/refactor/verify-all.sh
```
Expected: 全部通过（含 `characterize-ctrl.mjs` CTRL parity）。`verify-all.sh` 在 Windows 需 git-bash。

- [ ] **Step 2: CHANGELOG [Unreleased] 追加 Added 条目**

在 `CHANGELOG.md` 的 `## [Unreleased]` 下第一个 `### Added` 区（现有 2026-08-14 layers 条目之前）插入：

```markdown
- 2026-08-14: **批量导入任务名称 + 轨迹列表统计**：`batch_recording_job` 加 `name VARCHAR(512)`（默认 `文件名_MMDD-HHmm`，存量回填）；`trajectory` 加 `batch_job_id`（VARCHAR(36)，可空，FK→`batch_recording_job.id`，NULL=手动创建；init.sql 只同步列与索引，FK 仍只在迁移）。`POST /v2/trajectories/batch/import` 可选表单字段 `name`（缺省按公式生成）；`GET /v2/trajectories/batch/{batchId}` 响应加 `name`。`GET /api/v2/trajectories` 新增查询参数 `batchTaskName`（模糊），每行返回 `batchTaskName`，响应新增 `stats`（total/draft/live/recording/recorded/completed，与行查询同基准过滤、忽略 recordStatus）。sys_msg 消息链路不变。
  影响范围：schema（两迁移）、batch import/view、轨迹列表 API、api-docs。
  文件：migrations/20260814100000_batch_job_name.js, migrations/20260814110000_trajectory_batch_job.js, schemas/init.sql, src/services/trajectory/batch-job-name.js, src/dao/batch-recording-dao.js, src/dao/trajectory-dao.js, src/services/trajectory/trajectory-batch-service.js, src/services/trajectory/trajectory-meta-service.js, src/services/trajectory/batch-analyze.js, src/routes/v2/trajectory-batch.js, src/routes/v2/trajectory.js, src/dashboard/api-docs/groups/trajectory.js, scripts/characterization/characterize-batch-task-name.mjs
  Python 同步提示：对齐 `batch_recording_job.name` 与 `trajectory.batch_job_id`（UUID，可空，FK SET NULL）；`/v2/trajectories` 透传 `batchTaskName`（模糊）与 `stats`（五档同基准）；批量导入创建时 name 缺省按 `文件名_MMDD-HHmm` 生成；消息正文不含任务名。
```

- [ ] **Step 3: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs: changelog 批量任务名称 + 轨迹列表统计（含 Python 同步提示）"
```

---

### Task 8: Vue 类型与 API 层（另仓 `D:\dev\ui-auto-recording-agent-vue-master\vue-project`）

**Files:**
- Modify: `src/api/recording.ts`

**Interfaces:**
- Consumes: 后端 Task 4/6 的新响应字段
- Produces: `BatchImportResult.name?` / `BatchImportStatusResult.name?` / `Trajectory.batchTaskName?` / `TrajectoryListResult.stats?` / `TrajectoryStats` / `importTrajectoryBatch({ name? })` / `getTrajectoryList({ batchTaskName? })`（Task 9 消费）

- [ ] **Step 1: 类型补充**

`src/api/recording.ts`：
1. `Trajectory` 接口 `recordStatus: RecordStatus` 之后加：

```ts
  /** 所属批量导入任务名；null/缺省 = 手动创建 */
  batchTaskName?: string | null
```

2. `TrajectoryListResult` 之后新增并引用：

```ts
export interface TrajectoryStats {
  total: number
  draft: number
  live: number
  recording: number
  recorded: number
  completed: number
}

export interface TrajectoryListResult {
  rows: Trajectory[]
  total: number
  page: number
  pageSize: number
  stats?: TrajectoryStats
}
```

3. `BatchImportResult` 接口加 `name?: string`（`summary` 之前）；`BatchImportStatusResult` 接口加 `name?: string`（`summary?` 之前）。

- [ ] **Step 2: 请求函数改造**

`src/api/recording.ts`：
1. `importTrajectoryBatch` 的 `data` 参数加 `name?: string`，`form.append('mode', ...)` 之后加：

```ts
  if (data.name) form.append('name', data.name)
```

2. `getTrajectoryList` 的 params 加：

```ts
  batchTaskName?: string
```

- [ ] **Step 3: 类型检查**

Run（vue-project 目录）: `npx vue-tsc --noEmit`
Expected: 无新增错误。若该仓无 vue-tsc，退而按 `package.json` scripts 运行 `type-check`（或 `build`）并如实报告所用命令。

- [ ] **Step 4: Commit（Vue 仓）**

```bash
git add src/api/recording.ts
git commit -m "feat: types for batch task name / trajectory batchTaskName + stats"
```

---

### Task 9: Vue batchImport store 名称链 + BatchImportDialog 输入与展示（另仓）

**Files:**
- Modify: `src/stores/batchImport.ts`
- Modify: `src/views/ui-recording/components/BatchImportDialog.vue`

**Interfaces:**
- Consumes: Task 8 类型与 `name` 请求参数
- Produces: `BatchTask.name: string`；`startBatch({ name? })`；任务卡显示 `task.name || task.functionName`

- [ ] **Step 1: store 类型与持久化**

`src/stores/batchImport.ts`：
1. `BatchTask` 接口 `jobStatus: string` 之后加：

```ts
  name: string
```

2. `PersistedBatchTask` 接口 `functionName: string` 之后加：

```ts
  name?: string
```

3. `persist()` 的 payload 映射里 `functionName: t.functionName,` 之后加：

```ts
      name: t.name,
```

- [ ] **Step 2: `startBatch` 传名并回填**

`src/stores/batchImport.ts`：
1. `startBatch(opts: {...})` 参数加 `name?: string`（`mode?: BatchImportMode` 之后）；`importTrajectoryBatch({...})` 调用加：

```ts
        name: opts.name,
```

2. 返回构造的 `task` 对象里 `functionName: opts.functionName,` 之后加：

```ts
        name: String(data.name || opts.name || ''),
```

- [ ] **Step 3: 轮询 / openExisting / resume / 通知文案**

`src/stores/batchImport.ts`：
1. `pollOnce` 里 `const mode = data.mode ?? current.mode` 之后加：

```ts
      const name = String(data.name || current.name || '')
```

并在 `patchTask(batchId, {...})` 的 patch 里（`mode,` 之后）加：

```ts
        name,
```

2. `openExisting` 的 `task: BatchTask = {...}` 对象里 `functionName: String(...)` 之后加：

```ts
        name: String(data.name || existing?.name || ''),
```

3. `resume()` 的 persisted map 里 `functionName: p.functionName,` 之后加：

```ts
        name: p.name || '',
```

以及 `resume()` 刷新循环的 `patchTask(entry.batchId, {...})` 里（`mode,` 之后）加：

```ts
          name: String(data.name || entry.name || ''),
```

4. `notifyTerminal` 的 `ElNotification({...})` 的 `message` 改为：

```ts
      message: `${task.name || task.functionName}（${shortBatchId(task.batchId)}）${summaryText ? `：${summaryText}` : ''}`,
```

（旧 localStorage 数据无 `name` → `|| ''` 兜底，不破坏老数据恢复。）

- [ ] **Step 4: 弹窗输入框 + 提交传名 + 任务卡展示**

`src/views/ui-recording/components/BatchImportDialog.vue`：
1. script 里 `const importMode = ref<'record' | 'draft'>('record')` 之后加：

```ts
const taskNameInput = ref('')
```

2. `handleSubmit` 里 `batchStore.startBatch({...})` 参数加：

```ts
      name: taskNameInput.value.trim() || undefined,
```

并在成功后（`file.value = null` 之前）加：

```ts
    taskNameInput.value = ''
```

3. 模板 toolbar `</div>`（约 L177）与 `<el-upload`（约 L179）之间插入：

```html
      <el-input
        v-model="taskNameInput"
        class="task-name-input"
        placeholder="任务名称（选填，默认 文件名_月日-时分）"
        maxlength="200"
        clearable
      />
```

4. 任务卡标题（约 L237）改为：

```html
              <span class="task-fn">{{ task.name || task.functionName }}</span>
```

- [ ] **Step 5: 类型检查 + 构建冒烟**

Run（vue-project 目录）: `npx vue-tsc --noEmit`（无 vue-tsc 则按 package.json scripts 的 type-check/build）
Expected: 无新增错误。

- [ ] **Step 6: Commit（Vue 仓）**

```bash
git add src/stores/batchImport.ts src/views/ui-recording/components/BatchImportDialog.vue
git commit -m "feat: batch task name input + display (fallback functionName)"
```

---

### Task 10: Vue messageDrawer 深链修复（另仓）

**Files:**
- Modify: `src/components/Header/components/messageDrawer.vue`

**Interfaces:**
- Consumes: 无
- Produces: 消息相对 `linkUrl`（`/ui-recording?batchId=<uuid>`）点击可正常提取 batchId 并 `openExisting`。**不得改动** `msgContent`（v-html）、`linkUrl`、`belongItemName`、`msgStatus`、`createTime/createBy` 的现有语义。

- [ ] **Step 1: 定义本地 `batchIdFromLink`**

`src/components/Header/components/messageDrawer.vue` 的 `<script setup>` 里，`handleMessageClick` 之前加：

```ts
/** 从相对 linkUrl（如 /ui-recording?batchId=<uuid>）提取 batchId */
function batchIdFromLink(url: string): string | null {
  try {
    return new URL(url, window.location.origin).searchParams.get('batchId') || null
  } catch {
    return null
  }
}
```

（修复 `messageDrawer.vue:80` 引用未定义函数导致的 ReferenceError；`handleMessageClick` 其余逻辑不动。）

- [ ] **Step 2: 类型检查**

Run（vue-project 目录）: `npx vue-tsc --noEmit`（无 vue-tsc 则按 package.json scripts）
Expected: 无新增错误。

- [ ] **Step 3: Commit（Vue 仓）**

```bash
git add src/components/Header/components/messageDrawer.vue
git commit -m "fix: message drawer batch deep link (define batchIdFromLink)"
```

---

## 收尾（主线程）

- [ ] 重跑：`node scripts/characterization/characterize-batch-task-name.mjs`、`characterize-sys-msg.mjs`、`characterize-trajectory.mjs`、`bash scripts/refactor/verify-all.sh`
- [ ] 审查：CHANGELOG 条目格式与是否覆盖用户未提交条目；Vue 仓三处 commit 无越界改动（尤其 messageDrawer 只加了函数定义）
- [ ] 手工冒烟（有环境时）：起服务 → 带/不带 `name` 各导入一次 → job 视图 `name` 正确；`GET /api/v2/trajectories?batchTaskName=模板` 模糊命中且 `stats` 五档求和 = total；消息抽屉点击深链不再报错

## 已知待定（不影响本计划执行）

- 需求清单第 3 条 = **轨迹状态二次开发 TODO**（用户已确认）：`record_status` 五态 → 未录制/录制中/录制异常/待确认/已确认；具体流转需求在实际开发时阐明，本次沿用现有流转。见 spec Future work。收到后另立 spec/plan。
