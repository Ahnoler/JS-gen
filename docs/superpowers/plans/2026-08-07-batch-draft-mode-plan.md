# Batch Import Draft Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `mode=draft|record` to batch Excel import so the same dialog can stop after analyze→draft (radio + one submit) without executor, while record mode stays one-shot.

**Architecture:** Extend `batch_recording_job.mode` and item status `drafted`. Reuse analyze pump; branch in `createDraftFromAnalyzed` so draft jobs bind trajectory then terminate at `drafted`. Recording pump claims only `mode=record` jobs. Vue dialog adds `el-radio-group` and passes `mode` on import.

**Tech Stack:** Node.js Express + Knex/MySQL, Vue 3 + Element Plus + Pinia, characterization via `node scripts/characterization/*.mjs`.

**Spec:** `docs/superpowers/specs/2026-08-07-batch-draft-mode-design.md`

## Global Constraints

- `mode` values: exactly `record` | `draft`; default **`record`** when omitted; invalid mode → **HTTP 400** (no silent coerce).
- `mode=draft`: never require `USE_EXECUTOR`; never lease executor slots; never prepare/record/detach.
- `mode=record`: keep current `USE_EXECUTOR=true` or 503.
- Always require `functionId` + `systemAccountId` + `Idempotency-Key` + `.xlsx`.
- `request_hash` MUST include `mode`.
- Do not downgrade item statuses `recorded` or `drafted` on cancel.
- No batch「continue recording」API in this plan.
- Repos: control plane `D:/dev/JS-gen`; Vue `D:/dev/ui-auto-recording-agent-vue-master/vue-project`.

## File map

| File | Responsibility |
|------|----------------|
| `migrations/20260807120000_batch_job_mode_and_drafted.js` | Add job `mode`; extend item status enum with `drafted` |
| `src/models/constants.js` | `BATCH_ITEM_STATUSES` / `TERMINAL` + optional `BATCH_JOB_MODES` |
| `src/dao/batch-recording-dao.js` | Persist `mode`; `bindTrajectoryAsDrafted`; summary `drafted`; terminal success counts drafted; `claimNextItem` jobModes filter |
| `src/services/trajectory-batch-service.js` | Hash+import mode; draft gate; createDraft branch; record pump filter; views/WS `mode` |
| `src/routes/v2/trajectory-batch.js` | Pass `mode`; 503 only for record |
| `src/dashboard/api-docs/catalog.js` | Document mode / drafted |
| `scripts/characterization/characterize-batch-import.mjs` | Hash/mode/terminal/drafted constants |
| Vue `src/api/recording.ts` | `mode` on `importTrajectoryBatch` |
| Vue `src/stores/batchImport.ts` | Persist/display mode; pass through startBatch |
| Vue `src/views/ui-recording/components/BatchImportDialog.vue` | Radio + submit |

---

### Task 1: Migration + constants for `mode` and `drafted`

**Files:**
- Create: `migrations/20260807120000_batch_job_mode_and_drafted.js`
- Modify: `src/models/constants.js` (batch status blocks ~lines 66–110)

**Interfaces:**
- Produces: DB column `batch_recording_job.mode` (`record`|`draft`, default `record`); item enum includes `drafted`; `BATCH_ITEM_STATUSES` / `BATCH_ITEM_TERMINAL` include `drafted`; export `BATCH_JOB_MODES = Object.freeze(['record', 'draft'])`

- [ ] **Step 1: Extend characterization constants assertions (fail until constants updated)**

In `scripts/characterization/characterize-batch-import.mjs`, inside `testConstantsAndTerminal`, add:

```js
import { BATCH_JOB_MODES } from '../../src/models/constants.js';
// ...
assert.ok(BATCH_JOB_MODES.includes('draft'));
assert.ok(BATCH_JOB_MODES.includes('record'));
assert.ok(BATCH_ITEM_STATUSES.includes('drafted'));
assert.ok(BATCH_ITEM_TERMINAL.includes('drafted'));
```

Also extend `deriveJobTerminalStatus` cases once Task 2 lands (leave a comment `// drafted success — Task 2` if running Task 1 alone; prefer implementing Task 1+2 before expecting full green on drafted terminal).

- [ ] **Step 2: Run constants slice (expect fail on missing export)**

Run: `node scripts/characterization/characterize-batch-import.mjs`

Expected: FAIL mentioning `BATCH_JOB_MODES` or `drafted` not included.

- [ ] **Step 3: Write migration**

```js
/**
 * batch_recording_job.mode + batch_recording_item status `drafted`
 */
export async function up(knex) {
  await knex.schema.alterTable('batch_recording_job', (t) => {
    t.enu('mode', ['record', 'draft']).notNullable().defaultTo('record')
      .after('original_filename')
      .comment('record = analyze→draft→record; draft = analyze→draft only');
  });

  // MySQL: alter enum to add drafted (Knex enu alter is limited — use raw)
  await knex.raw(`
    ALTER TABLE batch_recording_item
    MODIFY COLUMN status ENUM(
      'pending','analyzing','analyzed','queued','waiting_executor',
      'preparing','recording','recorded','drafted','failed','rejected','cancelled'
    ) NOT NULL DEFAULT 'pending'
  `);
}

export async function down(knex) {
  await knex.raw(`
    UPDATE batch_recording_item SET status = 'recorded' WHERE status = 'drafted'
  `);
  await knex.raw(`
    ALTER TABLE batch_recording_item
    MODIFY COLUMN status ENUM(
      'pending','analyzing','analyzed','queued','waiting_executor',
      'preparing','recording','recorded','failed','rejected','cancelled'
    ) NOT NULL DEFAULT 'pending'
  `);
  await knex.schema.alterTable('batch_recording_job', (t) => {
    t.dropColumn('mode');
  });
}
```

- [ ] **Step 4: Update constants**

In `src/models/constants.js`:

```js
/** @typedef {'record'|'draft'} BatchJobMode */
export const BATCH_JOB_MODES = Object.freeze(['record', 'draft']);

/** @typedef {'pending'|...|'recorded'|'drafted'|...} BatchItemStatus */
export const BATCH_ITEM_STATUSES = Object.freeze([
  'pending', 'analyzing', 'analyzed', 'queued', 'waiting_executor',
  'preparing', 'recording', 'recorded', 'drafted',
  'failed', 'rejected', 'cancelled',
]);

export const BATCH_ITEM_TERMINAL = Object.freeze([
  'recorded', 'drafted', 'failed', 'rejected', 'cancelled',
]);
```

Keep `BATCH_ITEM_RESUMABLE` unchanged (do **not** include `drafted`).

- [ ] **Step 5: Apply migration locally**

Run: `npx knex migrate:latest`

Expected: migration applied without error.

- [ ] **Step 6: Commit**

```bash
git add migrations/20260807120000_batch_job_mode_and_drafted.js src/models/constants.js scripts/characterization/characterize-batch-import.mjs
git commit -m "feat(batch): add job mode column and drafted item status"
```

---

### Task 2: DAO — mode persistence, drafted bind, summary/terminal, claim filter

**Files:**
- Modify: `src/dao/batch-recording-dao.js`

**Interfaces:**
- Consumes: `drafted` in item enum; job `mode` column
- Produces:
  - `createJob` writes `mode: job.mode || 'record'`
  - `bindTrajectoryAsDrafted(itemId, trajectoryId, { version, trx })` → transition `analyzed` → `drafted` with `trajectoryId`
  - `summarizeJob` returns `drafted: counts.drafted || 0`
  - `deriveJobTerminalStatus`: `success = (recorded||0) + (drafted||0)`; unfinished must **not** count `drafted`
  - `claimNextItem({ ..., jobModes = null })` — when `jobModes` set, only claim items whose job.mode is in the list

- [ ] **Step 1: Extend characterization for hash+terminal (will fail until service hash in Task 3; terminal can pass after this task)**

Update `testConstantsAndTerminal` / add:

```js
assert.strictEqual(
  deriveJobTerminalStatus({
    accepted: 2, recorded: 0, drafted: 2, failed: 0, rejected: 0, cancelled: 0,
    pending: 0, analyzing: 0, analyzed: 0, queued: 0, waitingExecutor: 0,
    preparing: 0, recording: 0,
  }),
  'completed',
);
assert.strictEqual(
  deriveJobTerminalStatus({
    accepted: 2, recorded: 0, drafted: 1, failed: 1, rejected: 0, cancelled: 0,
    pending: 0, analyzing: 0, analyzed: 0, queued: 0, waitingExecutor: 0,
    preparing: 0, recording: 0,
  }),
  'completed_with_errors',
);
```

- [ ] **Step 2: Implement DAO changes**

`createJob` insert fields — add:

```js
mode: job.mode === 'draft' ? 'draft' : 'record',
```

Add:

```js
export async function bindTrajectoryAsDrafted(itemId, trajectoryId, {
  version,
  trx = null,
} = {}) {
  return transitionItem(itemId, ['analyzed'], 'drafted', {
    version,
    clearLease: true,
    extra: {
      trajectoryId: Number(trajectoryId),
      errorCode: null,
      errorMessage: null,
    },
    trx,
  });
}
```

`summarizeJob` return object — add `drafted: counts.drafted || 0`.

`deriveJobTerminalStatus`:

```js
const success = (summary.recorded || 0) + (summary.drafted || 0);
```

(keep unfinished list without drafted).

`claimNextItem` — after loading `job`, also:

```js
if (jobModes?.length) {
  const mode = job.mode || 'record';
  if (!jobModes.includes(mode)) continue;
}
```

Add param `jobModes = null` to the destructuring list.

- [ ] **Step 3: Run characterization**

Run: `node scripts/characterization/characterize-batch-import.mjs`

Expected: constants/terminal cases involving `drafted` PASS (request-hash mode may still be old until Task 3).

- [ ] **Step 4: Commit**

```bash
git add src/dao/batch-recording-dao.js scripts/characterization/characterize-batch-import.mjs
git commit -m "feat(batch): DAO support for mode, drafted bind, and terminal success"
```

---

### Task 3: Service + route — mode on import, draft pipeline stop, record pump filter

**Files:**
- Modify: `src/services/trajectory-batch-service.js`
- Modify: `src/routes/v2/trajectory-batch.js`

**Interfaces:**
- Consumes: `bindTrajectoryAsDrafted`, `claimNextItem` `jobModes`, `BATCH_JOB_MODES`
- Produces:
  - `buildRequestHash({ ..., mode = 'record' })` includes mode in digest
  - `importBatchFromExcel({ ..., mode })` validates mode; skips USE_EXECUTOR check when draft; persists mode; hash includes mode
  - `createDraftFromAnalyzed`: if `job.mode === 'draft'` → `bindTrajectoryAsDrafted` then `maybeFinalizeJob` (no `kickScheduler` record path required beyond finalize)
  - `pumpRecord` / any claim for recording: `jobModes: ['record']`
  - `getBatchJobView` / `emitProgress` / `batch:done` payloads include `mode`

- [ ] **Step 1: Failing hash test**

Replace/extend `testRequestHash` in characterize-batch-import.mjs:

```js
function testRequestHash() {
  const base = {
    fileBuffer: Buffer.from('abc'),
    functionId: 1,
    systemAccountId: 2,
    model: 'm',
  };
  const a = buildRequestHash({ ...base, mode: 'record' });
  const b = buildRequestHash({ ...base, mode: 'record' });
  const c = buildRequestHash({ ...base, mode: 'draft' });
  const d = buildRequestHash({ ...base }); // default record
  assert.strictEqual(a, b);
  assert.strictEqual(a, d);
  assert.notStrictEqual(a, c);
  ok('request hash stable + mode-sensitive');
}
```

Run: `node scripts/characterization/characterize-batch-import.mjs`  
Expected: FAIL (`a === d` or `a !== c` until hash updated).

- [ ] **Step 2: Update `buildRequestHash`**

```js
export function buildRequestHash({
  fileBuffer,
  functionId,
  systemAccountId,
  model = '',
  mode = 'record',
}) {
  const h = createHash('sha256');
  h.update(Buffer.isBuffer(fileBuffer) ? fileBuffer : Buffer.from(fileBuffer || ''));
  h.update('|');
  h.update(String(functionId));
  h.update('|');
  h.update(String(systemAccountId));
  h.update('|');
  h.update(String(model || ''));
  h.update('|');
  h.update(mode === 'draft' ? 'draft' : 'record');
  return h.digest('hex');
}
```

- [ ] **Step 3: Normalize + gate in `importBatchFromExcel`**

Near top of function (after USE_EXECUTOR check today):

```js
import { BATCH_JOB_MODES } from '../models/constants.js';

function normalizeBatchMode(raw) {
  if (raw == null || raw === '') return 'record';
  const m = String(raw).trim().toLowerCase();
  if (!BATCH_JOB_MODES.includes(m)) {
    const err = new Error('mode must be record or draft');
    err.statusCode = 400;
    throw err;
  }
  return m;
}
```

In `importBatchFromExcel`:

```js
const mode = normalizeBatchMode(arguments/options.mode); // from destructuring: mode

if (mode === 'record' && !USE_EXECUTOR) {
  const err = new Error('Batch import requires USE_EXECUTOR=true');
  err.statusCode = 503;
  throw err;
}
// Remove unconditional USE_EXECUTOR throw at top, or wrap it as above.
```

Include `mode` in `buildRequestHash(...)` and `batchDao.createJob({ ..., mode }, items)`.

- [ ] **Step 4: Branch `createDraftFromAnalyzed`**

After `createTransactionWithPhases` inside the transaction:

```js
if (job.mode === 'draft') {
  const bound = await batchDao.bindTrajectoryAsDrafted(item.id, trajId, {
    version: item.version,
    trx,
  });
  if (!bound) throw Object.assign(new Error('Lost CAS while binding trajectory'), { code: 'CAS' });
} else {
  const bound = await batchDao.bindTrajectoryAndQueue(item.id, trajId, {
    version: item.version,
    trx,
  });
  if (!bound) throw Object.assign(new Error('Lost CAS while binding trajectory'), { code: 'CAS' });
}
```

After successful draft bind (outside trx):

```js
const fresh = await batchDao.getItemById(item.id);
await emitProgress(item.batchId, fresh);
if (job.mode === 'draft') {
  await maybeFinalizeJob(item.batchId);
} else {
  kickScheduler();
}
```

- [ ] **Step 5: Filter record pump**

In `pumpRecord` `claimNextItem` call, add:

```js
jobModes: ['record'],
```

When claiming `analyzed` without trajectory for draft-create-from-pump: draft jobs are also claimed today via statuses including `analyzed`. Prefer claiming analyzed items **without** jobModes filter in a dedicated path, OR keep analyze→`createDraftFromAnalyzed` only from analyze pump (already calls `createDraftFromAnalyzed` at end of analyze). Safest change:

- Analyze worker already calls `createDraftFromAnalyzed` after analyze — draft completes there.
- In `pumpRecord`, when `item.status === 'analyzed' && !item.trajectoryId`, load job; if `job.mode === 'draft'` call `createDraftFromAnalyzed`, else same; **or** exclude draft jobs from record claim entirely and rely on analyze path only:

```js
jobModes: ['record'],  // on the main claim
```

And add a separate small claim/loop for `analyzed` orphans only if needed. Prefer: analyze path always creates draft; record pump with `jobModes: ['record']` never sees draft job items. Ensure analyze path always invokes `createDraftFromAnalyzed` (already does).

- [ ] **Step 6: Views / WS include mode**

`getBatchJobView` return add `mode: job.mode || 'record'`.

`emitProgress` / `batch:done` payloads include `mode` from job.

- [ ] **Step 7: Route**

In `src/routes/v2/trajectory-batch.js`:

```js
// Remove blanket USE_EXECUTOR 503 before service; let service decide.
const result = await batchService.importBatchFromExcel({
  fileBuffer: req.file.buffer,
  originalFilename: req.file.originalname || '',
  functionId: req.body?.functionId,
  systemAccountId: req.body?.systemAccountId ?? req.body?.accountId,
  model: req.body?.model || '',
  idempotencyKey,
  mode: req.body?.mode,
});
```

Delete the route-level:

```js
if (!USE_EXECUTOR) {
  return res.status(503).json({ error: 'Batch import requires USE_EXECUTOR=true' });
}
```

(so draft imports work when executor is off).

- [ ] **Step 8: Run characterization**

Run: `node scripts/characterization/characterize-batch-import.mjs`  
Expected: All passed.

- [ ] **Step 9: Commit**

```bash
git add src/services/trajectory-batch-service.js src/routes/v2/trajectory-batch.js scripts/characterization/characterize-batch-import.mjs
git commit -m "feat(batch): draft mode stops after analyze→draft; record keeps executor gate"
```

---

### Task 4: API docs catalog

**Files:**
- Modify: `src/dashboard/api-docs/catalog.js` (group `batch-import`)

**Interfaces:**
- Produces: documented `mode`, `drafted`, draft-mode no-executor note; resp examples include `mode` and summary.`drafted`

- [ ] **Step 1: Update batch-import endpoint notes**

For `POST .../batch/import`:

- reqExample include `mode=draft|record`
- notes: default record; draft skips USE_EXECUTOR; invalid mode 400; hash includes mode
- respExample add `mode: 'draft'`, summary `drafted`

For GET status notes: itemStatus list includes `drafted`.

WS notes: payload includes `mode`.

- [ ] **Step 2: Smoke-open docs locally (optional)**

Run server → open `/api/docs` → confirm「批量导入管理」shows mode.

- [ ] **Step 3: Commit**

```bash
git add src/dashboard/api-docs/catalog.js
git commit -m "docs(api): document batch import mode and drafted status"
```

---

### Task 5: Vue — radio mode + API/store wiring

**Files:**
- Modify: `D:/dev/ui-auto-recording-agent-vue-master/vue-project/src/api/recording.ts`
- Modify: `D:/dev/ui-auto-recording-agent-vue-master/vue-project/src/stores/batchImport.ts`
- Modify: `D:/dev/ui-auto-recording-agent-vue-master/vue-project/src/views/ui-recording/components/BatchImportDialog.vue`

**Interfaces:**
- Consumes: backend `mode` on import + status views
- Produces: `importTrajectoryBatch({ ..., mode?: 'record'|'draft' })`; store `startBatch({ ..., mode })`; dialog radio default `record`

- [ ] **Step 1: API**

```ts
export type BatchImportMode = 'record' | 'draft'

// importTrajectoryBatch data:
mode?: BatchImportMode

// in FormData:
form.append('mode', data.mode === 'draft' ? 'draft' : 'record')
```

Extend `BatchImportResult` / status types with `mode?: BatchImportMode` and summary `drafted?: number`.

- [ ] **Step 2: Store**

- `BatchTask` add `mode: BatchImportMode` (default `'record'`)
- `startBatch` accepts `mode` and passes to API; store returned `data.mode`
- Persist `mode` in localStorage snapshot
- `itemStatusText`: `drafted: '已存草稿'`
- Poll merge keeps `mode` from GET if present

- [ ] **Step 3: Dialog UI**

```vue
const importMode = ref<'record' | 'draft'>('record')

// in template, below upload / above submit:
<el-radio-group v-model="importMode" class="mode-radios">
  <el-radio value="draft">仅存草稿</el-radio>
  <el-radio value="record">存草稿并录制</el-radio>
</el-radio-group>

// hint under radios:
<p class="hint-mode">
  {{ importMode === 'draft'
    ? '将对每行分析并创建草稿交易，不会启动录制或占用执行机。'
    : '分析建草稿后自动准备并开始录制（需要执行机）。' }}
</p>

// handleSubmit:
await batchStore.startBatch({ ..., mode: importMode.value })
```

Task card: show badge `task.mode === 'draft' ? '草稿' : '录制'`.  
Summary line: show `drafted` when present.

Update dialog copy that currently says always「建草稿并录制」.

- [ ] **Step 4: Manual verify**

1. Select function + account, upload template xlsx, radio「仅存草稿」→ 开始导入 → task shows 草稿; items → 已存草稿; list shows draft trajectories; no executor needed.
2. Radio「存草稿并录制」with executor → same as before.
3. Same Idempotency-Key + file but switch mode → 409.

- [ ] **Step 5: Commit (Vue repo)**

```bash
cd D:/dev/ui-auto-recording-agent-vue-master/vue-project
git add src/api/recording.ts src/stores/batchImport.ts src/views/ui-recording/components/BatchImportDialog.vue
git commit -m "feat(batch): radio to choose draft-only vs record import"
```

---

## Spec coverage checklist

| Spec requirement | Task |
|------------------|------|
| Same dialog + radio + one submit | Task 5 |
| draft = analyze→draft only | Task 3 |
| record unchanged + USE_EXECUTOR | Task 3 |
| account still required | Task 5 (existing) + service validation |
| reuse template/idempotency/cancel/poll/WS | Tasks 3–5 (no new endpoints) |
| mode on POST import; default record; invalid 400 | Task 3 |
| draft no 503 | Task 3 route+service |
| job.mode column; hash includes mode | Tasks 1–3 |
| item `drafted` terminal | Tasks 1–2 |
| cancel does not downgrade drafted | Task 2 (`cancelOpenItems` open list excludes drafted) + verify |
| catalog + characterization | Tasks 1–4 |
| no continue-recording | (explicitly omitted) |

## Placeholder / consistency self-review

- No TBD steps; signatures use `bindTrajectoryAsDrafted`, `jobModes`, `BATCH_JOB_MODES`.
- `deriveJobTerminalStatus` success = recorded + drafted (Task 2) matches draft job completion.
- Route must not 503 before service (Task 3) or draft mode cannot be tested with USE_EXECUTOR=false.
