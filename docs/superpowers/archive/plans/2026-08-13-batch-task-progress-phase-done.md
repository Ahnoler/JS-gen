# Batch Row Progress + Phase done_logs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist per-phase Agent `done` text as `trajectory_phase.done_logs`, expose it on the trajectory tree and batch item rows, and show a per-row progress bar (pipeline + phase ratio) in the Vue batch dialog plus full logs on the detail phase list.

**Architecture:** Pure helpers parse/append done-log entries and compute progress. Control plane appends on product `phase_done` / `phase_error` (not login). Batch GET/WS compute progress from item status + one IN-query of phases. Vue consumes new fields; no new URLs.

**Tech Stack:** Node ESM, Knex/MySQL, Vue 3 + Element Plus (`D:\dev\ui-auto-recording-agent-vue-master\vue-project\src`), characterization `node scripts/characterization/*.mjs`.

**Spec:** `docs/superpowers/specs/2026-08-13-batch-task-progress-phase-done-design.md`

## Global Constraints

- Do not change `trajectory.trajectory_log` semantics (still agent full-text LONGTEXT).
- Do not add user isolation, `created_by`, or a server-side job list page.
- Do not persist `progressPercent` on `batch_recording_item`.
- Empty `phase_done.data.text` → skip append. Do **not** persist synthetic「见页面当前状态」unless that exact string came from the agent.
- `runDefaultLogin` / `phase_number: 0` must not write `done_logs`.
- `appendPhaseDoneLog` failure = `console.warn`; recording continues.
- Schema / routes / services → `CHANGELOG.md` `[Unreleased]` with Python 同步提示.
- Vue lives in `D:\dev\ui-auto-recording-agent-vue-master\vue-project\src` (separate git repo).
- **Commit only when the user explicitly asks.** Do not commit secrets. JS-gen and Vue are separate commits if asked.

## File map

| File | Role |
|------|------|
| `src/models/phase-done-logs.js` | `parseDoneLogs`, `appendDoneLogEntry` |
| `src/services/trajectory/batch-item-progress.js` | `computeBatchItemProgress`, `summarizePhases` |
| `migrations/20260813120000_phase_done_logs.js` | `trajectory_phase.done_logs` JSON |
| `schemas/init.sql` | Same column for greenfield |
| `src/dao/trajectory-phase-dao.js` | Parse `doneLogs`; `listByTrajectoryIds` |
| `src/dao/batch-recording-dao.js` | `findItemByTrajectoryId` |
| `src/services/trajectory-phase-service.js` | `appendPhaseDoneLog`; clear resets logs |
| `src/services/trajectory-service.js` | Re-export `appendPhaseDoneLog` |
| `src/services/trajectory/trajectory-recording-runner.js` | Append on phase_done / fail; notify batch |
| `src/routes/browser-session/session-message.js` | Secondary append path |
| `src/services/trajectory/batch-progress-notify.js` | Dynamic-import `emitProgress` (no cycle) |
| `src/services/trajectory/trajectory-batch-service.js` | Enrich items in GET + WS |
| `src/dashboard/api-docs/groups/trajectory.js` | Contract notes |
| `scripts/models/entity/trajectory_phase_entity.py` | Optional `done_logs` |
| `scripts/characterization/characterize-batch-task-progress.mjs` | Pure-function + source-cue suite |
| `CHANGELOG.md` | Unreleased |
| Vue `api/recording.ts` | Types |
| Vue `views/ui-recording/components/BatchImportDialog.vue` | Row progress UI |
| Vue `views/ui-recording/detail/components/StepsPanel.vue` | Phase `doneLogs` list |

```text
phase_done.text → appendPhaseDoneLog → phase.done_logs[]
GET tree → phases[].doneLogs
GET/WS batch → computeBatchItemProgress(item, phases)
Vue dialog row ← progressPercent / phaseName / lastDoneText
Vue StepsPanel ← phases[].doneLogs
```

---

### Task 1: Pure helpers + characterization (TDD)

**Files:**
- Create: `src/models/phase-done-logs.js`
- Create: `src/services/trajectory/batch-item-progress.js`
- Create: `scripts/characterization/characterize-batch-task-progress.mjs`

**Interfaces:**
- Consumes: N/A
- Produces:
  - `parseDoneLogs(raw) → Array<{ text: string, at: string, source: 'agent'|'fail' }>`
  - `appendDoneLogEntry(existing, { text, source, at? }, now?) → array` (skip empty text / bad source; text max 2000)
  - `summarizePhases(phases) → { phaseCompleted, phaseTotal, phaseName, lastDoneText }`
  - `computeBatchItemProgress({ status, mode, trajectoryId, phases }) → { progressPercent, phaseCompleted, phaseTotal, phaseName, lastDoneText }`

- [ ] **Step 1: Write the failing characterization**

Create `scripts/characterization/characterize-batch-task-progress.mjs`:

```javascript
/**
 * Characterization: phase done_logs parse/append + batch row progress formula.
 * Run: node scripts/characterization/characterize-batch-task-progress.mjs
 */
import assert from 'node:assert/strict';
import {
  parseDoneLogs,
  appendDoneLogEntry,
  DONE_LOG_TEXT_MAX,
} from '../../src/models/phase-done-logs.js';
import {
  computeBatchItemProgress,
  summarizePhases,
} from '../../src/services/trajectory/batch-item-progress.js';

assert.deepEqual(parseDoneLogs(null), []);
assert.deepEqual(parseDoneLogs('not-json'), []);
assert.deepEqual(parseDoneLogs({ text: 'x' }), []);
assert.equal(parseDoneLogs([{ text: 'ok', at: '2026-08-13T00:00:00.000Z', source: 'agent' }]).length, 1);

const skipped = appendDoneLogEntry([], { text: '  ', source: 'agent' });
assert.equal(skipped.length, 0);
assert.equal(appendDoneLogEntry([], { text: 'hi', source: 'nope' }).length, 0);

const once = appendDoneLogEntry([], {
  text: '已保存',
  source: 'agent',
  at: '2026-08-13T03:12:00.000Z',
});
assert.deepEqual(once, [{
  text: '已保存',
  at: '2026-08-13T03:12:00.000Z',
  source: 'agent',
}]);
const twice = appendDoneLogEntry(once, {
  text: '第二次',
  source: 'agent',
  at: '2026-08-13T04:00:00.000Z',
});
assert.equal(twice.length, 2);
assert.equal(twice[1].text, '第二次');

const long = 'x'.repeat(DONE_LOG_TEXT_MAX + 50);
assert.equal(appendDoneLogEntry([], { text: long, source: 'fail', at: 't' })[0].text.length, DONE_LOG_TEXT_MAX);

const phases = [
  {
    phaseNumber: 1, status: 'completed', description: '登录后进入列表',
    doneLogs: [{ text: '进了列表', at: '2026-08-13T01:00:00.000Z', source: 'agent' }],
  },
  {
    phaseNumber: 2, status: 'running', description: '填写客户信息',
    doneLogs: [],
  },
  { phaseNumber: 3, status: 'pending', description: '保存', doneLogs: [] },
  { phaseNumber: 4, status: 'pending', description: '提交', doneLogs: [] },
];
const sum = summarizePhases(phases);
assert.equal(sum.phaseCompleted, 1);
assert.equal(sum.phaseTotal, 4);
assert.equal(sum.phaseName, '填写客户信息');
assert.equal(sum.lastDoneText, '进了列表');

function pct(partial) {
  return computeBatchItemProgress(partial).progressPercent;
}
assert.equal(pct({ status: 'pending', mode: 'record' }), 0);
assert.equal(pct({ status: 'analyzing', mode: 'record' }), 10);
assert.equal(pct({ status: 'analyzed', mode: 'record' }), 20);
assert.equal(pct({ status: 'queued', mode: 'record' }), 25);
assert.equal(pct({ status: 'waiting_executor', mode: 'record' }), 30);
assert.equal(pct({ status: 'preparing', mode: 'record' }), 40);
assert.equal(pct({
  status: 'recording', mode: 'record', trajectoryId: 1, phases,
}), 53); // 40 + 50 * (1/4) = 52.5 → 53
assert.equal(pct({ status: 'recorded', mode: 'record' }), 100);
assert.equal(pct({ status: 'analyzing', mode: 'draft' }), 40);
assert.equal(pct({ status: 'analyzed', mode: 'draft' }), 70);
assert.equal(pct({ status: 'drafted', mode: 'draft' }), 100);
assert.equal(pct({ status: 'rejected', mode: 'record' }), 0);
assert.equal(pct({ status: 'failed', mode: 'record' }), 10);
assert.equal(pct({ status: 'failed', mode: 'draft' }), 40);
assert.equal(pct({
  status: 'failed', mode: 'record', trajectoryId: 9, phases,
}), 53);
assert.ok(pct({
  status: 'failed', mode: 'record', trajectoryId: 9,
  phases: phases.map((p) => ({ ...p, status: 'completed' })),
}) <= 90);

console.log('characterize-batch-task-progress: OK');
```

Fix the file-read at the end: **do not** cue-assert runner in Task 1 (files not wired yet). Stop the char after the `<= 90` assert. Add source-cues in Task 7.

- [ ] **Step 2: Run — expect FAIL** (modules missing)

```powershell
cd d:\dev\JS-gen
node scripts/characterization/characterize-batch-task-progress.mjs
```

Expected: `ERR_MODULE_NOT_FOUND` for `phase-done-logs.js`.

- [ ] **Step 3: Implement `src/models/phase-done-logs.js`**

```javascript
export const DONE_LOG_TEXT_MAX = 2000;
export const DONE_LOG_SOURCES = new Set(['agent', 'fail']);

export function parseDoneLogs(raw) {
  if (raw == null || raw === '') return [];
  let arr = raw;
  if (typeof raw === 'string') {
    try { arr = JSON.parse(raw); } catch { return []; }
  }
  if (!Array.isArray(arr)) return [];
  return arr.map(normalizeDoneLogEntry).filter(Boolean);
}

export function normalizeDoneLogEntry(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const source = entry.source === 'fail' || entry.source === 'agent' ? entry.source : null;
  if (!source) return null;
  const at = typeof entry.at === 'string' && entry.at.trim() ? entry.at.trim() : null;
  if (!at) return null;
  const text = String(entry.text ?? '').trim().slice(0, DONE_LOG_TEXT_MAX);
  return { text, at, source };
}

export function appendDoneLogEntry(existing, { text, source, at } = {}, now = () => new Date().toISOString()) {
  const trimmed = String(text ?? '').trim();
  if (!trimmed) return parseDoneLogs(existing);
  if (!DONE_LOG_SOURCES.has(source)) return parseDoneLogs(existing);
  const entry = {
    text: trimmed.slice(0, DONE_LOG_TEXT_MAX),
    at: typeof at === 'string' && at.trim() ? at.trim() : now(),
    source,
  };
  return [...parseDoneLogs(existing), entry];
}
```

- [ ] **Step 4: Implement `src/services/trajectory/batch-item-progress.js`**

```javascript
import { parseDoneLogs } from '../../models/phase-done-logs.js';

export const PHASE_LOOKUP_STATUSES = new Set([
  'preparing', 'recording', 'recorded', 'failed', 'cancelled',
]);

export function summarizePhases(phases = []) {
  const list = Array.isArray(phases) ? phases : [];
  const phaseTotal = list.length;
  const phaseCompleted = list.filter((p) => p.status === 'completed').length;
  const running = list.find((p) => p.status === 'running');
  const completed = list
    .filter((p) => p.status === 'completed')
    .sort((a, b) => (Number(a.phaseNumber) || 0) - (Number(b.phaseNumber) || 0));
  const named = running || completed[completed.length - 1];
  let last = null;
  for (const p of list) {
    for (const e of parseDoneLogs(p.doneLogs ?? p.done_logs)) {
      if (!last || String(e.at) >= String(last.at)) last = e;
    }
  }
  return {
    phaseCompleted,
    phaseTotal,
    phaseName: named ? String(named.description || '').trim() : '',
    lastDoneText: last?.text || '',
  };
}

function recordingRatioPercent(phaseCompleted, phaseTotal) {
  if (!(Number(phaseTotal) > 0)) return 40;
  return Math.min(90, Math.round(40 + 50 * (Number(phaseCompleted) / Number(phaseTotal))));
}

function pipelinePercent(status, mode) {
  if (mode === 'draft') {
    if (status === 'pending') return 0;
    if (status === 'analyzing') return 40;
    if (status === 'analyzed') return 70;
    if (status === 'drafted') return 100;
    return null;
  }
  const map = {
    pending: 0,
    analyzing: 10,
    analyzed: 20,
    queued: 25,
    waiting_executor: 30,
    preparing: 40,
    recorded: 100,
    drafted: 100,
  };
  return Object.prototype.hasOwnProperty.call(map, status) ? map[status] : null;
}

export function computeBatchItemProgress({
  status,
  mode = 'record',
  trajectoryId = null,
  phases = [],
} = {}) {
  const st = String(status || '');
  const md = mode === 'draft' ? 'draft' : 'record';
  const hasTraj = Number(trajectoryId) > 0;
  const lookUp = hasTraj && PHASE_LOOKUP_STATUSES.has(st);
  const phaseFields = lookUp
    ? summarizePhases(phases)
    : { phaseCompleted: 0, phaseTotal: 0, phaseName: '', lastDoneText: '' };

  let progressPercent = 0;
  if (st === 'rejected') progressPercent = 0;
  else if (st === 'recording') {
    progressPercent = recordingRatioPercent(phaseFields.phaseCompleted, phaseFields.phaseTotal);
  } else if (st === 'failed' || st === 'cancelled') {
    progressPercent = hasTraj
      ? recordingRatioPercent(phaseFields.phaseCompleted, phaseFields.phaseTotal)
      : (md === 'draft' ? 40 : 10);
  } else {
    const piped = pipelinePercent(st, md);
    progressPercent = piped == null ? 0 : piped;
  }
  progressPercent = Math.max(0, Math.min(100, Math.round(progressPercent)));
  return { progressPercent, ...phaseFields };
}
```

- [ ] **Step 5: Run — expect PASS**

```powershell
node scripts/characterization/characterize-batch-task-progress.mjs
```

Expected: `characterize-batch-task-progress: OK`

Recording 1/4: `Math.round(40 + 12.5) = 53`. If the test fails on 52 vs 53, keep `Math.round`.

---

### Task 2: Schema

**Files:**
- Create: `migrations/20260813120000_phase_done_logs.js`
- Modify: `schemas/init.sql` (after `stitch_screenshot_id` on `trajectory_phase`)

**Interfaces:**
- Consumes: Task 1 (none)
- Produces: column `trajectory_phase.done_logs` JSON NULL

- [ ] **Step 1: Migration**

```javascript
/**
 * trajectory_phase.done_logs — phase-end explanations [{text, at, source}].
 * trajectory.trajectory_log remains agent full-text LONGTEXT.
 */
export async function up(knex) {
  if (!(await knex.schema.hasTable('trajectory_phase'))) return;
  if (await knex.schema.hasColumn('trajectory_phase', 'done_logs')) return;
  await knex.schema.alterTable('trajectory_phase', (t) => {
    t.json('done_logs').nullable()
      .comment('阶段结束说明 [{text, at, source}]；trajectory.trajectory_log 仍为 agent 全文');
  });
}

export async function down(knex) {
  if (!(await knex.schema.hasTable('trajectory_phase'))) return;
  if (!(await knex.schema.hasColumn('trajectory_phase', 'done_logs'))) return;
  await knex.schema.alterTable('trajectory_phase', (t) => {
    t.dropColumn('done_logs');
  });
}
```

- [ ] **Step 2: `schemas/init.sql`** — add after `stitch_screenshot_id`:

```sql
  `done_logs`        JSON NULL COMMENT '阶段结束说明 [{text, at, source}]；trajectory.trajectory_log 仍为 agent 全文',
```

- [ ] **Step 3: `node --check` the migration file.** Expected: silent exit 0.

---

### Task 3: DAO parse + batch lookup

**Files:**
- Modify: `src/dao/trajectory-phase-dao.js`
- Modify: `src/dao/batch-recording-dao.js`

**Interfaces:**
- Consumes: `parseDoneLogs` from Task 1
- Produces: phase entities always have `doneLogs` array; `listByTrajectoryIds(ids)`; `findItemByTrajectoryId(tid)`

- [ ] **Step 1: In `parseCandidates` (trajectory-phase-dao.js)** after special-element parse:

```javascript
import { parseDoneLogs } from '../models/phase-done-logs.js';
// ...
obj.doneLogs = parseDoneLogs(obj.doneLogs);
```

- [ ] **Step 2: Add `listByTrajectoryIds`**

```javascript
export async function listByTrajectoryIds(ids) {
  const nums = [...new Set((ids || []).map((x) => Number(x)).filter((n) => Number.isFinite(n) && n > 0))];
  if (!nums.length) return [];
  const rows = await getDB()(TABLE)
    .whereIn('trajectory_id', nums)
    .orderBy('phase_number');
  return rows.map(parseCandidates);
}
```

- [ ] **Step 3: `findItemByTrajectoryId` in batch-recording-dao.js**

```javascript
export async function findItemByTrajectoryId(trajectoryId) {
  const tid = Number(trajectoryId);
  if (!Number.isFinite(tid) || tid <= 0) return null;
  const row = await getDB()(ITEM_TABLE)
    .where({ trajectory_id: tid })
    .orderBy('id', 'desc')
    .first();
  return shapeItem(row);
}
```

- [ ] **Step 4: When `update()` receives `doneLogs` array**, stringify (same pattern as `specialElementCandidatesJson`):

```javascript
if ('doneLogs' in fields || 'done_logs' in fields) {
  const raw = fields.doneLogs ?? fields.done_logs ?? null;
  patch.done_logs = raw == null || typeof raw === 'string'
    ? raw
    : JSON.stringify(raw);
  delete patch.doneLogs;
}
```

- [ ] **Step 5:** `node --check src/dao/trajectory-phase-dao.js src/dao/batch-recording-dao.js`

---

### Task 4: `appendPhaseDoneLog` + clear reset

**Files:**
- Modify: `src/services/trajectory-phase-service.js`
- Modify: `src/services/trajectory-service.js` (re-export)

**Interfaces:**
- Consumes: `appendDoneLogEntry`, `parseDoneLogs`, `trajectoryPhaseDao.update`
- Produces: `appendPhaseDoneLog(phaseDbId, { text, source }) → phase|null` (warn-on-fail, no throw)

- [ ] **Step 1: Add helper in trajectory-phase-service.js**

```javascript
import { appendDoneLogEntry } from '../models/phase-done-logs.js';

export async function appendPhaseDoneLog(phaseDbId, { text, source } = {}) {
  const id = Number(phaseDbId);
  if (!Number.isFinite(id) || id <= 0) return null;
  try {
    const row = await trajectoryPhaseDao.getById(id);
    if (!row) return null;
    const next = appendDoneLogEntry(row.doneLogs, { text, source });
    if (next.length === (row.doneLogs || []).length) return row;
    return trajectoryPhaseDao.update(id, { doneLogs: next });
  } catch (err) {
    console.warn('[phase] appendPhaseDoneLog failed:', err?.message || err);
    return null;
  }
}
```

- [ ] **Step 2: `clearTrajectory` updates** that set `status: 'pending'` also set `done_logs` empty.

In both the phaseIds branch and the all-phases branch, change `.update({ status: 'pending', completed_at: null })` to:

```javascript
.update({ status: 'pending', completed_at: null, done_logs: JSON.stringify([]) })
```

- [ ] **Step 3: Re-export** from `src/services/trajectory-service.js` next to `markPhaseStatus`:

```javascript
export {
  upsertPhaseDescription,
  markPhaseStatus,
  appendPhaseDoneLog,
  clearTrajectory,
  addPhaseToTrajectory,
  syncTrajectoryPhaseDescriptions,
} from './trajectory-phase-service.js';
```

- [ ] **Step 4:** Extend `characterize-batch-task-progress.mjs` with source cues (add `readFileSync` / `join` / `ROOT` imports):

```javascript
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const phaseSvc = readFileSync(join(ROOT, 'src/services/trajectory-phase-service.js'), 'utf-8');
assert.match(phaseSvc, /export async function appendPhaseDoneLog/);
assert.match(phaseSvc, /done_logs: JSON\.stringify\(\[\]\)/);
```

Run char — expect PASS.

---

### Task 5: Enrich batch GET + WS

**Files:**
- Create: `src/services/trajectory/batch-progress-notify.js`
- Modify: `src/services/trajectory/trajectory-batch-service.js`

**Interfaces:**
- Consumes: `computeBatchItemProgress`, `listByTrajectoryIds`, `findItemByTrajectoryId`
- Produces: `enrichBatchItems(items, mode)`; GET/WS items include the five fields; `notifyBatchProgressForTrajectory(tid)`

- [ ] **Step 1: `enrichBatchItems` in trajectory-batch-service.js** (or keep in `batch-item-progress.js` as async wrapper — prefer service file to own the query):

```javascript
import * as trajectoryPhaseDao from '../../dao/trajectory-phase-dao.js';
import { computeBatchItemProgress, PHASE_LOOKUP_STATUSES } from './batch-item-progress.js';

export async function enrichBatchItems(items, mode = 'record') {
  const list = Array.isArray(items) ? items : [];
  const ids = [...new Set(list
    .filter((it) => Number(it?.trajectoryId) > 0 && PHASE_LOOKUP_STATUSES.has(String(it.status)))
    .map((it) => Number(it.trajectoryId)))];
  const phases = await trajectoryPhaseDao.listByTrajectoryIds(ids);
  const byTid = new Map();
  for (const p of phases) {
    const tid = Number(p.trajectoryId);
    if (!byTid.has(tid)) byTid.set(tid, []);
    byTid.get(tid).push(p);
  }
  return list.map((it) => {
    const extra = computeBatchItemProgress({
      status: it.status,
      mode,
      trajectoryId: it.trajectoryId,
      phases: byTid.get(Number(it.trajectoryId)) || [],
    });
    return { ...it, ...extra };
  });
}
```

**One IN query only** — do not call `listByTrajectory` per row.

- [ ] **Step 2: `getBatchJobView`** — after `listItemsByBatch`, wrap rows:

```javascript
const enriched = await enrichBatchItems(items.rows, job.mode || 'record');
// return items: enriched
```

- [ ] **Step 3: `emitProgress`** — if `item` is passed, enrich a one-element array and copy the five fields onto `payload`:

```javascript
let progress = {};
if (item) {
  const [enriched] = await enrichBatchItems([item], job?.mode || 'record');
  progress = {
    progressPercent: enriched.progressPercent,
    phaseCompleted: enriched.phaseCompleted,
    phaseTotal: enriched.phaseTotal,
    phaseName: enriched.phaseName,
    lastDoneText: enriched.lastDoneText,
    itemStatus: enriched.status ?? item.status,
  };
}
const payload = { /* existing */, ...progress };
```

- [ ] **Step 4: `batch-progress-notify.js`** (break cycle with recording-runner):

```javascript
import * as batchDao from '../../dao/batch-recording-dao.js';

export async function notifyBatchProgressForTrajectory(trajectoryId) {
  try {
    const item = await batchDao.findItemByTrajectoryId(trajectoryId);
    if (!item) return;
    const { emitProgress } = await import('./trajectory-batch-service.js');
    await emitProgress(item.batchId, item);
  } catch (err) {
    console.warn('[batch] notify progress skipped:', err?.message || err);
  }
}
```

- [ ] **Step 5:** `node --check` the three files.

---

### Task 6: Wire product record + session-message

**Files:**
- Modify: `src/services/trajectory/trajectory-recording-runner.js`
- Modify: `src/routes/browser-session/session-message.js`

**Interfaces:**
- Consumes: `appendPhaseDoneLog`, `notifyBatchProgressForTrajectory`
- Produces: `phase_done.data.text` appended as `source:agent`; errors as `source:fail`; login path unchanged

- [ ] **Step 1: In the phase loop of `trajectory-recording-runner.js`**, after `textFromDone` / `phaseOutcome` assignment, **only persist `donePayload.text`**:

```javascript
import { appendPhaseDoneLog } from '../trajectory-phase-service.js';
import { notifyBatchProgressForTrajectory } from './batch-progress-notify.js';

const rawDoneText = String(donePayload?.text || '').trim();
if (rawDoneText) {
  await appendPhaseDoneLog(phase.id, { text: rawDoneText, source: 'agent' });
}
await trajectoryPhaseDao.updateStatus(phase.id, 'completed');
await notifyBatchProgressForTrajectory(tid);
```

Do **not** pass `phaseOutcome.text` (it may be「见页面当前状态」).

- [ ] **Step 2: In the `catch` of that loop**, before rethrow, if `session?.activePhaseId`:

```javascript
const failText = String(err?.message || err || '').trim();
if (failText && session?.activePhaseId) {
  await appendPhaseDoneLog(session.activePhaseId, { text: failText, source: 'fail' });
}
await notifyBatchProgressForTrajectory(tid);
```

Existing `updateStatus(..., 'failed')` on abort stays.

- [ ] **Step 3: Confirm `runDefaultLogin` does not import/call `appendPhaseDoneLog`.**

- [ ] **Step 4: `session-message.js`**

```javascript
import { markPhaseStatus, appendPhaseDoneLog } from '../../services/trajectory-service.js';

const appendFromEvent = (source, text) => {
  const phaseId = session.activePhaseId != null ? Number(session.activePhaseId) : null;
  const t = String(text || '').trim();
  if (!Number.isFinite(phaseId) || phaseId <= 0 || !t) return;
  appendPhaseDoneLog(phaseId, { text: t, source }).catch((err) => {
    console.warn('[session] appendPhaseDoneLog failed:', err.message);
  });
};
```

- `phase_done`: `appendFromEvent('agent', data?.text)` (not `data.summary`).
- `phase_error` / `error`: `appendFromEvent('fail', data?.message)`.

- [ ] **Step 5: Extend char with source cues**

```javascript
const runner = readFileSync(join(ROOT, 'src/services/trajectory/trajectory-recording-runner.js'), 'utf-8');
assert.match(runner, /appendPhaseDoneLog/);
assert.match(runner, /donePayload\?\.text/);
assert.doesNotMatch(runner.slice(runner.indexOf('export async function runDefaultLogin')), /appendPhaseDoneLog/);
const sess = readFileSync(join(ROOT, 'src/routes/browser-session/session-message.js'), 'utf-8');
assert.match(sess, /appendPhaseDoneLog/);
```

```powershell
node scripts/characterization/characterize-batch-task-progress.mjs
node --check src/services/trajectory/trajectory-recording-runner.js src/routes/browser-session/session-message.js
```

Expected: both OK.

---

### Task 7: API docs + Python entity + CHANGELOG

**Files:**
- Modify: `src/dashboard/api-docs/groups/trajectory.js`
- Modify: `scripts/models/entity/trajectory_phase_entity.py`
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: response field names from Tasks 4–5
- Produces: docs + CHANGELOG Python 同步提示

- [ ] **Step 1: GET `/trajectories/{id}` desc** — append: `phases[].doneLogs` 为 `{ text, at, source }[]`（`agent`|`fail`）；`trajectoryLog` 仍为 agent 全文。

- [ ] **Step 2: GET batch `{batchId}` notes + example item** add:

`progressPercent`, `phaseCompleted`, `phaseTotal`, `phaseName`, `lastDoneText`.

WS `batch:progress` `respExample.payload` add the same five keys (example `progressPercent: 53`).

- [ ] **Step 3: Python entity**

```python
from typing import Optional, Any
# ...
done_logs: Optional[Any] = None
```

- [ ] **Step 4: CHANGELOG `[Unreleased]` → `### Added`** (top of Added):

```markdown
- 2026-08-13: **批量行进度 + 阶段 done 说明**：`trajectory_phase.done_logs` JSON 数组 `[{text, at, source}]`；`phase_done.data.text` 追加写入（空 text 跳过；`phase_error` 为 `source=fail`）。`GET` 交易树 `phases[].doneLogs`；`GET/WS` 批量 item 计算 `progressPercent` / `phaseCompleted` / `phaseTotal` / `phaseName` / `lastDoneText`（不落 batch_item）。`trajectory.trajectory_log` 语义不变。
  影响范围：trajectory_phase schema、录制 runner、batch GET/WS、api-docs。
  文件：migrations/20260813120000_phase_done_logs.js, src/models/phase-done-logs.js, src/services/trajectory/batch-item-progress.js, src/services/trajectory-phase-service.js, trajectory-recording-runner.js, trajectory-batch-service.js
  Python 同步提示：对齐 `trajectory_phase.done_logs`；透传 tree 的 `doneLogs` 与 batch item 五个计算字段；**不**改 batch URL。
```

- [ ] **Step 5:** `node --check src/dashboard/api-docs/groups/trajectory.js`

---

### Task 8: Vue types + BatchImportDialog

**Files (Vue repo):**
- Modify: `D:\dev\ui-auto-recording-agent-vue-master\vue-project\src\api\recording.ts`
- Modify: `D:\dev\ui-auto-recording-agent-vue-master\vue-project\src\views\ui-recording\components\BatchImportDialog.vue`

**Interfaces:**
- Consumes: batch item five fields from GET (store already replaces `items` as-is)
- Produces: typed fields; row UI with progress + phase name + truncated lastDone

- [ ] **Step 1: Types in `api/recording.ts`**

```ts
export interface PhaseDoneLog {
  text: string
  at: string
  source: 'agent' | 'fail'
}

export interface TrajectoryPhase {
  // existing fields...
  doneLogs?: PhaseDoneLog[]
}

export interface BatchImportItem {
  // existing fields...
  progressPercent?: number
  phaseCompleted?: number
  phaseTotal?: number
  phaseName?: string
  lastDoneText?: string
}
```

- [ ] **Step 2: Dialog script** — add:

```ts
function truncateDone(text: string, n = 80) {
  const s = String(text || '')
  return s.length <= n ? s : `${s.slice(0, n)}…`
}
```

- [ ] **Step 3: Replace `.item-row` template**

```html
<div v-for="it in task.items" :key="it.id" class="item-row">
  <div class="item-main">
    <span class="item-name">
      第 {{ it.rowNumber ?? it.row ?? '—' }} 行 · {{ it.name || '未命名' }}
    </span>
    <el-progress
      :percentage="Number(it.progressPercent) || 0"
      :stroke-width="8"
      :status="it.status === 'failed' || it.status === 'rejected' ? 'exception'
        : it.status === 'recorded' || it.status === 'drafted' ? 'success'
        : undefined"
    />
    <div class="item-meta">
      <span class="item-status">{{ itemStatusText(String(it.status)) }}</span>
      <span v-if="it.phaseName" class="item-phase">{{ it.phaseName }}</span>
      <el-tooltip v-if="it.lastDoneText" :content="it.lastDoneText" placement="top">
        <span class="item-done">{{ truncateDone(it.lastDoneText) }}</span>
      </el-tooltip>
    </div>
  </div>
</div>
```

- [ ] **Step 4: CSS**

```css
.item-row {
  display: block;
  padding: 6px 0;
  border-top: 1px solid #ebeef5;
}
.item-main { display: flex; flex-direction: column; gap: 4px; }
.item-meta { display: flex; gap: 8px; align-items: center; font-size: 12px; color: #909399; }
.item-phase, .item-done {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.item-done { max-width: 280px; color: #606266; }
```

Keep existing `.item-name` / `.item-status` if they already exist; adjust rather than duplicate.

- [ ] **Step 5:** No store change required (`pollOnce` already assigns `data.items`). Confirm `batchImport.ts` does not strip unknown keys.

Vue: no characterization in JS-gen. Visual check: open 批量导入, expand a running job, row shows a bar.

---

### Task 9: Vue StepsPanel `doneLogs`

**Files:**
- Modify: `D:\dev\ui-auto-recording-agent-vue-master\vue-project\src\views\ui-recording\detail\components\StepsPanel.vue`
- Verify: `detail/index.vue` already passes `:phases="studio.phases.value"` — **do not change index.vue unless types break.**

**Interfaces:**
- Consumes: `TrajectoryPhase.doneLogs`
- Produces: list under `group-title`, above `group-steps`

- [ ] **Step 1: Helper in script**

```ts
function phaseDoneLogs(groupId: number): PhaseDoneLog[] {
  const ph = (props.phases || []).find((p) => Number(p.id) === Number(groupId));
  const logs = ph?.doneLogs;
  return Array.isArray(logs) ? logs : [];
}

function doneSourceLabel(source: string) {
  return source === 'fail' ? '失败' : 'AI说明';
}
```

Import `PhaseDoneLog` from `@/api/recording`.

- [ ] **Step 2: Template — after `</div>` of `group-title`, before `group-steps`:**

```html
<ul v-if="phaseDoneLogs(group.id).length" class="phase-done-logs">
  <li v-for="(log, i) in phaseDoneLogs(group.id)" :key="`${group.id}-${i}-${log.at}`">
    <span class="done-src">{{ doneSourceLabel(log.source) }}</span>
    <span class="done-at">{{ log.at }}</span>
    <span class="done-text">{{ log.text }}</span>
  </li>
</ul>
```

Empty → no element.

- [ ] **Step 3: CSS**

```css
.phase-done-logs {
  list-style: none;
  margin: 0;
  padding: 4px 12px 8px 28px;
  font-size: 12px;
  color: #606266;
  line-height: 1.5;
}
.phase-done-logs .done-src {
  margin-right: 6px;
  color: #909399;
}
.phase-done-logs .done-at {
  margin-right: 8px;
  color: #c0c4cc;
  font-family: monospace;
  font-size: 11px;
}
.phase-done-logs .done-text { white-space: pre-wrap; }
```

- [ ] **Step 4:** Title remains `group.title`. Done logs are extra, not a replacement.

---

### Task 10: Final verification

**Files:** verify only

- [ ] **Step 1: JS-gen**

```powershell
cd d:\dev\JS-gen
node scripts/characterization/characterize-batch-task-progress.mjs
node scripts/characterization/characterize-batch-import.mjs
node --check src/models/phase-done-logs.js src/services/trajectory/batch-item-progress.js src/services/trajectory-phase-service.js src/services/trajectory/trajectory-batch-service.js src/services/trajectory/trajectory-recording-runner.js src/routes/browser-session/session-message.js
```

Expected: both characterize scripts print OK; `--check` silent.

- [ ] **Step 2: Confirm CHANGELOG Unreleased contains `done_logs` and Python 同步提示.**

- [ ] **Step 3: Confirm `runDefaultLogin` source still has no `appendPhaseDoneLog`.**

- [ ] **Step 4: Do not claim Vue typed-check unless `vue-tsc` is already in that project's scripts.** If `package.json` has `typecheck`, run it from `vue-project`.

---

## Self-review vs spec

| Spec requirement | Task |
|------------------|------|
| `trajectory_phase.done_logs` JSON; `trajectory.trajectory_log` unchanged | 2 |
| `{ text, at, source }`; append keep history; empty skip; max 2000 | 1, 4 |
| clear → empty logs | 4 |
| Product runner writes `data.text`; session-message secondary; no login write | 6 |
| Tree `phases[].doneLogs` | 3 (parse on list) |
| Batch GET/WS five computed fields; one IN query | 5 |
| Progress formula tables + fail cap 90 | 1 |
| Vue dialog row bar + lastDone 80 chars | 8 |
| Vue detail phase logs | 9 |
| CHANGELOG + Python entity; no URL change | 7 |
| No user isolation / job list | (non-goal, no task) |

Spec lookup statuses now include `cancelled` (plan + spec aligned).
