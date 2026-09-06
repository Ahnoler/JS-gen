# Trajectory Step Move + Drop `is_replay` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist drag-reorder / cross-phase step moves via `POST .../steps/move`, and remove the dead `trajectory_step.is_replay` column while keeping runtime replay suppress-persist.

**Architecture:** Pure `planStepMove` computes new global order + phase bindings from `(stepId, targetPhaseId, beforeStepId)`; service validates busy/ownership in a DB transaction and applies updates + `step_number` rewrite. Vue StepsPanel enables cross-group Sortable and calls the new API. Column drop is a migration + filter/write cleanup; request body `isReplay` on `steps/replay` is unchanged.

**Tech Stack:** Node.js (Express, Knex/MySQL), Vue 3 + SortableJS (product SPA), characterization scripts (`node scripts/characterization/*.mjs`).

**Spec:** `docs/superpowers/specs/2026-08-07-trajectory-step-reorder-design.md`

## Global Constraints

- Sort key: global `step_number` 1..n; phase membership: `trajectory_phase_id` (+ sync `phase_number`).
- One step per move; `beforeStepId` null/omit = end of target phase.
- Do **not** gate on trajectory `status` / `completed`; block only when AI recording, manual recording, or session busy (replay/step).
- Keep `POST .../steps/replay` body `isReplay` (= suppress persist); remove table column only.
- Screenshots/form_snapshots follow `trajectory_step.id` — no migration.
- Orphan UI group `id === -1` is not a valid `targetPhaseId`.
- Repos: control plane `D:/dev/JS-gen`; Vue `D:/dev/ui-auto-recording-agent-vue-master/vue-project`.

## File map

| File | Responsibility |
|------|----------------|
| `migrations/20260807160000_drop_trajectory_step_is_replay.js` | Drop index + column |
| `schemas/init.sql` | Remove `is_replay` from `trajectory_step` |
| `src/dao/trajectory-step-dao.js` | Stop filtering/writing `is_replay`; optional ordered apply helper |
| `src/dao/trajectory-dao.js` | Stop `is_replay` in insert/getById filters |
| `src/services/trajectory-step-service.js` | `refreshTrajectoryCounts` without filter; add `moveTrajectoryStep` |
| `src/services/trajectory-step-move.js` | Pure `planStepMove` (testable, no DB) |
| `src/services/operation-component-signature.js` | Drop `.filter(!isReplay)` |
| `src/services/operation-component-service.js` | Drop isReplay parse/filter if only for column |
| `scripts/characterization/characterize-operation-component.mjs` | Remove is_replay section |
| `scripts/characterization/characterize-step-move.mjs` | Pure move + key cases |
| `scripts/run_traj56_cdp_replay.py` | Remove SQL `is_replay` predicate |
| `src/routes/v2/trajectory.js` | `POST .../steps/move` |
| `src/dashboard/api-docs/catalog.js` | Document move; clarify replay `isReplay` ≠ column |
| Vue `src/api/recording.ts` | `moveTrajectoryStep` |
| Vue `StepsPanel.vue` | Cross-group Sortable + new emit |
| Vue `detail/index.vue` + `useRecordingStudio.ts` | Persist move + refresh |

---

### Task 1: Drop `trajectory_step.is_replay`

**Files:**
- Create: `migrations/20260807160000_drop_trajectory_step_is_replay.js`
- Modify: `schemas/init.sql` (trajectory_step block ~line 159–167)
- Modify: `src/dao/trajectory-step-dao.js`
- Modify: `src/dao/trajectory-dao.js`
- Modify: `src/services/trajectory-step-service.js` (`refreshTrajectoryCounts`)
- Modify: `src/services/operation-component-signature.js`
- Modify: `src/services/operation-component-service.js` (if it maps/filters `isReplay` from DB steps)
- Modify: `scripts/characterization/characterize-operation-component.mjs`
- Modify: `scripts/run_traj56_cdp_replay.py` (SQL filter)
- Modify: `migrations/20260720113948_trajectory_account_and_step_replay.js` — **do not rewrite history**; leave as-is (column was added there; drop is new migration)
- Modify: `src/dashboard/api-docs/catalog.js` notes under `steps/replay` — state column removed

**Interfaces:**
- Consumes: none
- Produces: DB without `is_replay`; list/count APIs return all steps; `computePhaseSignature` / `stepsToSnapshot` no longer filter `isReplay`

- [ ] **Step 1: Write migration**

```js
/**
 * Drop dead trajectory_step.is_replay.
 * Replay suppress-persist remains request/runtime isReplay only (no table column).
 */
async function dropIndexIfExists(knex, table, indexName) {
  const [rows] = await knex.raw(
    `SELECT INDEX_NAME FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?
     LIMIT 1`,
    [table, indexName],
  );
  if (rows?.length) {
    await knex.raw(`ALTER TABLE \`${table}\` DROP INDEX \`${indexName}\``);
  }
}

export async function up(knex) {
  const has = await knex.schema.hasColumn('trajectory_step', 'is_replay');
  if (!has) return;
  await dropIndexIfExists(knex, 'trajectory_step', 'idx_step_is_replay');
  await knex.schema.alterTable('trajectory_step', (t) => {
    t.dropColumn('is_replay');
  });
}

export async function down(knex) {
  const has = await knex.schema.hasColumn('trajectory_step', 'is_replay');
  if (has) return;
  await knex.schema.alterTable('trajectory_step', (t) => {
    t.boolean('is_replay').notNullable().defaultTo(false)
      .comment('DEPRECATED restored — prefer runtime isReplay suppress');
    t.index(['trajectory_id', 'is_replay'], 'idx_step_is_replay');
  });
}
```

- [ ] **Step 2: Update `schemas/init.sql`**

Remove the `is_replay` column line and `KEY idx_step_is_replay` from `CREATE TABLE trajectory_step`.

- [ ] **Step 3: Strip write/read filters**

In `trajectory-step-dao.js`:
- `batchSave`: remove `isReplay: !!s.isReplay` from `toDbRow` input.
- `listByTrajectory`: remove `includeReplay` option and the `is_replay` `andWhere` block; always return all steps for the trajectory.

In `trajectory-dao.js`:
- `insertStepRows`: remove `is_replay: s.isReplay ? 1 : 0`.
- `getById` steps query: remove the `is_replay` `andWhere`.

In `trajectory-step-service.js` `refreshTrajectoryCounts`:
```js
const [{ steps }] = await db('trajectory_step')
  .where({ trajectory_id: trajectoryDbId })
  .count('* as steps');
```

In `operation-component-signature.js`:
- `computePhaseSignature` / `stepsToSnapshot`: delete `.filter((s) => !s?.isReplay)`.

In `operation-component-service.js`: remove `isReplay` mapping/filter used only for the column (keep behavior equivalent to “all steps”).

In `characterize-operation-component.mjs`: delete the section that asserts `is_replay` steps are excluded; keep other signature tests.

In `scripts/run_traj56_cdp_replay.py`: change step load SQL to drop `AND (is_replay=0 OR is_replay IS NULL)`.

Catalog `steps/replay` notes: replace “表字段 is_replay ≠ 请求参数 isReplay” with “请求体 isReplay 仅为运行时抑制入库；表字段 is_replay 已删除”.

- [ ] **Step 4: Run characterization**

```bash
node scripts/characterization/characterize-operation-component.mjs
node scripts/characterization/characterize-trajectory.mjs
```

Expected: PASS (no references to missing column in imports).

- [ ] **Step 5: Commit (JS-gen)**

```bash
git add migrations/20260807160000_drop_trajectory_step_is_replay.js schemas/init.sql \
  src/dao/trajectory-step-dao.js src/dao/trajectory-dao.js \
  src/services/trajectory-step-service.js \
  src/services/operation-component-signature.js \
  src/services/operation-component-service.js \
  scripts/characterization/characterize-operation-component.mjs \
  scripts/run_traj56_cdp_replay.py \
  src/dashboard/api-docs/catalog.js
git commit -m "$(cat <<'EOF'
fix: drop unused trajectory_step.is_replay column

Replay suppress-persist stays on request/runtime isReplay only.
EOF
)"
```

---

### Task 2: Pure `planStepMove` + characterization

**Files:**
- Create: `src/services/trajectory-step-move.js`
- Create: `scripts/characterization/characterize-step-move.mjs`

**Interfaces:**
- Consumes: none (pure)
- Produces:
  ```ts
  // @returns {{ ok: true, ordered: Array<{ id, trajectoryPhaseId, phaseNumber, stepNumber }> }}
  // or { ok: false, code: 'invalid_step'|'invalid_phase'|'invalid_before'|'noop_ready', message }
  planStepMove({
    steps: Array<{ id: number, trajectoryPhaseId: number|null, phaseNumber?: number, stepNumber: number }>,
    phases: Array<{ id: number, phaseNumber: number }>,
    stepId: number,
    targetPhaseId: number,
    beforeStepId?: number|null,
  })
  ```

- [ ] **Step 1: Write failing characterization**

Create `scripts/characterization/characterize-step-move.mjs`:

```js
/**
 * Pure step-move ordering (no DB).
 * Run: node scripts/characterization/characterize-step-move.mjs
 */
import assert from 'assert';
import { planStepMove } from '../../src/services/trajectory-step-move.js';

const phases = [
  { id: 1, phaseNumber: 1 },
  { id: 2, phaseNumber: 2 },
];

function ids(ordered) {
  return ordered.map((s) => s.id);
}

// Within phase: [10,20,30] move 30 before 10 → [30,10,20]
{
  const steps = [
    { id: 10, trajectoryPhaseId: 1, stepNumber: 1 },
    { id: 20, trajectoryPhaseId: 1, stepNumber: 2 },
    { id: 30, trajectoryPhaseId: 1, stepNumber: 3 },
  ];
  const r = planStepMove({ steps, phases, stepId: 30, targetPhaseId: 1, beforeStepId: 10 });
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(ids(r.ordered), [30, 10, 20]);
  assert.deepStrictEqual(r.ordered.map((s) => s.stepNumber), [1, 2, 3]);
}

// Append end of phase: omit beforeStepId
{
  const steps = [
    { id: 10, trajectoryPhaseId: 1, stepNumber: 1 },
    { id: 20, trajectoryPhaseId: 1, stepNumber: 2 },
    { id: 30, trajectoryPhaseId: 2, stepNumber: 3 },
  ];
  const r = planStepMove({ steps, phases, stepId: 10, targetPhaseId: 2, beforeStepId: null });
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(ids(r.ordered), [20, 30, 10]);
  assert.strictEqual(r.ordered.find((s) => s.id === 10).trajectoryPhaseId, 2);
  assert.strictEqual(r.ordered.find((s) => s.id === 10).phaseNumber, 2);
}

// Cross-phase insert before
{
  const steps = [
    { id: 10, trajectoryPhaseId: 1, stepNumber: 1 },
    { id: 20, trajectoryPhaseId: 1, stepNumber: 2 },
    { id: 30, trajectoryPhaseId: 2, stepNumber: 3 },
    { id: 40, trajectoryPhaseId: 2, stepNumber: 4 },
  ];
  const r = planStepMove({ steps, phases, stepId: 20, targetPhaseId: 2, beforeStepId: 40 });
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(ids(r.ordered), [10, 30, 20, 40]);
}

// Empty target phase append: phase1=[10], phase2=[], phase3=[30] → move 10 to phase2 end
{
  const phasesB = [
    { id: 1, phaseNumber: 1 },
    { id: 2, phaseNumber: 2 },
    { id: 3, phaseNumber: 3 },
  ];
  const steps = [
    { id: 10, trajectoryPhaseId: 1, stepNumber: 1 },
    { id: 30, trajectoryPhaseId: 3, stepNumber: 2 },
  ];
  const r = planStepMove({ steps, phases: phasesB, stepId: 10, targetPhaseId: 2, beforeStepId: null });
  assert.strictEqual(r.ok, true);
  // phase1 empty, phase2=[10], phase3=[30]
  assert.deepStrictEqual(ids(r.ordered), [10, 30]);
  assert.strictEqual(r.ordered[0].trajectoryPhaseId, 2);
}

// beforeStepId not in target phase → fail
{
  const steps = [
    { id: 10, trajectoryPhaseId: 1, stepNumber: 1 },
    { id: 20, trajectoryPhaseId: 2, stepNumber: 2 },
  ];
  const r = planStepMove({ steps, phases, stepId: 10, targetPhaseId: 2, beforeStepId: 10 });
  // before === stepId invalid
  assert.strictEqual(r.ok, false);
}

{
  const steps = [
    { id: 10, trajectoryPhaseId: 1, stepNumber: 1 },
    { id: 20, trajectoryPhaseId: 2, stepNumber: 2 },
  ];
  const r = planStepMove({ steps, phases, stepId: 20, targetPhaseId: 2, beforeStepId: 10 });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'invalid_before');
}

console.log('ok: characterize-step-move');
```

Fix the empty-phase comment in the test when implementing: after removing 10 from phase1, ordered by phase_number: phase1=[], phase2=[10], phase3=[30] → ids `[10, 30]`.

- [ ] **Step 2: Run — expect FAIL**

```bash
node scripts/characterization/characterize-step-move.mjs
```

Expected: FAIL — module not found / `planStepMove` undefined.

- [ ] **Step 3: Implement `planStepMove`**

Create `src/services/trajectory-step-move.js`:

```js
/**
 * Pure planner for POST .../steps/move.
 * Builds global order = phases sorted by phaseNumber, each phase's steps in list order
 * after removing stepId and inserting before beforeStepId (or phase end).
 */
export function planStepMove({
  steps,
  phases,
  stepId,
  targetPhaseId,
  beforeStepId = null,
}) {
  const sid = Number(stepId);
  const tidPhase = Number(targetPhaseId);
  const before = beforeStepId == null || beforeStepId === ''
    ? null
    : Number(beforeStepId);

  if (!Number.isFinite(sid) || sid <= 0) {
    return { ok: false, code: 'invalid_step', message: 'stepId required' };
  }
  if (!Number.isFinite(tidPhase) || tidPhase <= 0) {
    return { ok: false, code: 'invalid_phase', message: 'targetPhaseId required' };
  }
  if (before != null && before === sid) {
    return { ok: false, code: 'invalid_before', message: 'beforeStepId must differ from stepId' };
  }

  const phaseList = (phases || [])
    .map((p) => ({ id: Number(p.id), phaseNumber: Number(p.phaseNumber) || 0 }))
    .filter((p) => p.id > 0)
    .sort((a, b) => a.phaseNumber - b.phaseNumber || a.id - b.id);

  const targetPhase = phaseList.find((p) => p.id === tidPhase);
  if (!targetPhase) {
    return { ok: false, code: 'invalid_phase', message: 'targetPhaseId not in trajectory' };
  }

  const all = (steps || []).map((s) => ({
    id: Number(s.id),
    trajectoryPhaseId: s.trajectoryPhaseId != null ? Number(s.trajectoryPhaseId) : null,
    phaseNumber: Number(s.phaseNumber) || 0,
    stepNumber: Number(s.stepNumber) || 0,
  }));

  const moving = all.find((s) => s.id === sid);
  if (!moving) {
    return { ok: false, code: 'invalid_step', message: 'stepId not in trajectory' };
  }

  if (before != null) {
    const anchor = all.find((s) => s.id === before);
    if (!anchor) {
      return { ok: false, code: 'invalid_before', message: 'beforeStepId not in trajectory' };
    }
    // Anchor must be in target phase after move (same phase as target; if anchor is the
    // moving step we already rejected; if anchor is currently elsewhere, reject unless
    // it's already targetPhaseId).
    if (Number(anchor.trajectoryPhaseId) !== tidPhase) {
      return { ok: false, code: 'invalid_before', message: 'beforeStepId not in targetPhaseId' };
    }
  }

  // Bucket by phase id (unknown/null → keep relative global order in an "orphan" bucket at end)
  const byPhase = new Map(phaseList.map((p) => [p.id, []]));
  const orphans = [];
  const rest = all
    .filter((s) => s.id !== sid)
    .slice()
    .sort((a, b) => a.stepNumber - b.stepNumber || a.id - b.id);

  for (const s of rest) {
    const pid = s.trajectoryPhaseId;
    if (pid != null && byPhase.has(pid)) byPhase.get(pid).push({ ...s });
    else orphans.push({ ...s });
  }

  const moved = {
    ...moving,
    trajectoryPhaseId: tidPhase,
    phaseNumber: targetPhase.phaseNumber,
  };

  const targetBucket = byPhase.get(tidPhase);
  if (before == null) {
    targetBucket.push(moved);
  } else {
    const idx = targetBucket.findIndex((s) => s.id === before);
    if (idx < 0) {
      return { ok: false, code: 'invalid_before', message: 'beforeStepId not in target phase list' };
    }
    targetBucket.splice(idx, 0, moved);
  }

  const ordered = [];
  for (const p of phaseList) {
    for (const s of byPhase.get(p.id) || []) ordered.push(s);
  }
  for (const s of orphans) ordered.push(s);

  for (let i = 0; i < ordered.length; i += 1) {
    ordered[i] = { ...ordered[i], stepNumber: i + 1 };
  }

  return { ok: true, ordered, movedStepId: sid };
}
```

- [ ] **Step 4: Run — expect PASS**

```bash
node scripts/characterization/characterize-step-move.mjs
```

Expected: `ok: characterize-step-move`

- [ ] **Step 5: Commit**

```bash
git add src/services/trajectory-step-move.js scripts/characterization/characterize-step-move.mjs
git commit -m "$(cat <<'EOF'
feat: add pure planStepMove for trajectory step drag reorder

EOF
)"
```

---

### Task 3: Service + route + catalog

**Files:**
- Modify: `src/services/trajectory-step-service.js`
- Modify: `src/routes/v2/trajectory.js`
- Modify: `src/dashboard/api-docs/catalog.js` (near trajectory-steps entries ~674+)
- Modify: `src/dao/trajectory-step-dao.js` (add `applyStepOrder` if helpful)

**Interfaces:**
- Consumes: `planStepMove` from Task 2; `getTrajectoryRuntime` from `trajectory-runtime.js`; `state.sessions` for `session.busy`
- Produces:
  ```js
  // throws err.statusCode 400|404|409
  async function moveTrajectoryStep(trajectoryId, {
    stepId, targetPhaseId, beforeStepId = null,
  }) → TrajectoryStep  // camelCase row of moved step after apply
  ```

- [ ] **Step 1: Add DAO apply helper**

In `trajectory-step-dao.js`:

```js
/**
 * Apply planned order: update phase binding + step_number for each row in one transaction.
 * @param {number} trajectoryId
 * @param {Array<{ id: number, trajectoryPhaseId: number|null, phaseNumber: number, stepNumber: number }>} ordered
 */
export async function applyPlannedOrder(trajectoryId, ordered) {
  const db = getDB();
  const tid = Number(trajectoryId);
  await db.transaction(async (trx) => {
    for (const s of ordered) {
      await trx('trajectory_step').where({ id: s.id, trajectory_id: tid }).update({
        trajectory_phase_id: s.trajectoryPhaseId,
        phase_number: s.phaseNumber,
        step_number: s.stepNumber,
      });
    }
  });
}
```

- [ ] **Step 2: Implement `moveTrajectoryStep` in service**

```js
import { planStepMove } from './trajectory-step-move.js';
import { getTrajectoryRuntime } from './trajectory-runtime.js';
import { state } from '../state.js';
import * as trajectoryPhaseDao from '../dao/trajectory-phase-dao.js';

function assertNotBusyForStepEdit(trajectoryId, traj) {
  const tid = Number(trajectoryId);
  if (traj?.recordStatus === 'recording') {
    const err = new Error('Cannot move steps while AI recording');
    err.statusCode = 409;
    throw err;
  }
  const runtime = getTrajectoryRuntime(tid);
  if (runtime?.manualRecording) {
    const err = new Error('Cannot move steps while manual recording');
    err.statusCode = 409;
    throw err;
  }
  const session = runtime?.sessionId ? state.sessions.get(runtime.sessionId) : null;
  if (session?.busy) {
    const err = new Error('Cannot move steps while session is busy');
    err.statusCode = 409;
    throw err;
  }
}

export async function moveTrajectoryStep(trajectoryId, input = {}) {
  const tid = Number(trajectoryId);
  if (!Number.isFinite(tid) || tid <= 0) {
    const err = new Error('Invalid trajectory id');
    err.statusCode = 400;
    throw err;
  }
  const traj = await trajectoryDao.getById(tid);
  if (!traj) {
    const err = new Error('Trajectory not found');
    err.statusCode = 404;
    throw err;
  }
  assertNotBusyForStepEdit(tid, traj);

  const steps = await trajectoryStepDao.listByTrajectory(tid);
  const phases = await trajectoryPhaseDao.listByTrajectory(tid);
  const planned = planStepMove({
    steps,
    phases,
    stepId: input.stepId,
    targetPhaseId: input.targetPhaseId,
    beforeStepId: input.beforeStepId,
  });
  if (!planned.ok) {
    const err = new Error(planned.message || planned.code);
    err.statusCode = 400;
    err.code = planned.code;
    throw err;
  }

  // Idempotent: if already matching planned numbers/phases, skip writes
  const same = steps.length === planned.ordered.length && steps.every((s, i) => {
    const o = planned.ordered[i];
    return Number(s.id) === o.id
      && Number(s.stepNumber) === o.stepNumber
      && Number(s.trajectoryPhaseId) === Number(o.trajectoryPhaseId);
  });
  if (!same) {
    await trajectoryStepDao.applyPlannedOrder(tid, planned.ordered);
  }

  const counts = await refreshTrajectoryCounts(tid);
  await trajectoryDao.updateMeta(tid, {
    stepCount: counts.stepCount,
    phaseCount: counts.phaseCount,
  });

  return trajectoryStepDao.getById(Number(input.stepId));
}
```

Export `moveTrajectoryStep` from the trajectory facade if `src/services/trajectory-service.js` (or similar) re-exports step APIs — mirror `createTrajectoryStep` / `removeTrajectoryStep`.

- [ ] **Step 3: Wire route**

In `src/routes/v2/trajectory.js`, next to other step routes:

```js
app.post('/api/v2/trajectories/:id/steps/move', async (req, res) => {
  try {
    const row = await trajectoryService.moveTrajectoryStep(+req.params.id, {
      stepId: req.body?.stepId,
      targetPhaseId: req.body?.targetPhaseId ?? req.body?.trajectoryPhaseId,
      beforeStepId: req.body?.beforeStepId !== undefined
        ? req.body.beforeStepId
        : null,
    });
    if (!row) return res.status(404).json({ error: 'Trajectory step not found' });
    res.json(row);
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message, code: err.code });
  }
});
```

Confirm the route module’s `trajectoryService` import exposes the new function (add re-export if needed).

- [ ] **Step 4: Catalog entry**

Add under trajectories / steps group:

```js
{
  method: 'POST', path: '/api/v2/trajectories/{id}/steps/move',
  summary: '拖拽改序 / 跨阶段移动单步',
  desc:
    '将 stepId 移到 targetPhaseId；beforeStepId 有值则插到该步之前，省略/null 则追加到该阶段末尾。'
    + '事务内重写全局 step_number。AI 录制 / 人工录制 / session.busy（回放等）时 409；不按 recordStatus=completed 拒绝。',
  params: [
    { name: 'id', type: 'number', required: true, in: 'path' },
    { name: 'stepId', type: 'number', required: true, in: 'body' },
    { name: 'targetPhaseId', type: 'number', required: true, in: 'body' },
    { name: 'beforeStepId', type: 'number|null', in: 'body', desc: '省略=阶段末尾' },
  ],
  reqExample: J({ stepId: 123, targetPhaseId: 7, beforeStepId: 456 }),
  notes: [
    '排序字段 step_number；阶段归属 trajectory_phase_id',
    '截图随 trajectory_step.id，无需迁移',
  ],
},
```

- [ ] **Step 5: Smoke / import check**

```bash
node scripts/characterization/characterize-step-move.mjs
node scripts/characterization/characterize-trajectory.mjs
```

If DB available and migrations runnable:

```bash
npx knex migrate:latest
```

Manual API check (optional): create traj with 2 phases / 3 steps, `POST .../steps/move`, then `GET .../tree` — `stepNumber` and phase nesting match.

- [ ] **Step 6: Commit**

```bash
git add src/services/trajectory-step-service.js src/services/trajectory-step-move.js \
  src/dao/trajectory-step-dao.js src/routes/v2/trajectory.js \
  src/dashboard/api-docs/catalog.js
# plus any facade re-export file touched
git commit -m "$(cat <<'EOF'
feat: POST trajectories/:id/steps/move for drag reorder

EOF
)"
```

---

### Task 4: Vue StepsPanel + studio persist

**Files (Vue repo `D:/dev/ui-auto-recording-agent-vue-master/vue-project`):**
- Modify: `src/api/recording.ts`
- Modify: `src/views/ui-recording/detail/components/StepsPanel.vue`
- Modify: `src/views/ui-recording/detail/index.vue`
- Modify: `src/composables/useRecordingStudio.ts`
- Optionally: step row template — add `data-step-id` / `data-phase-id` on containers

**Interfaces:**
- Consumes: `POST /v2/trajectories/{id}/steps/move`
- Produces: emit payload `{ stepId, targetPhaseId, beforeStepId }`

- [ ] **Step 1: API helper**

In `recording.ts`:

```ts
export function moveTrajectoryStep(
  trajectoryId: number,
  data: { stepId: number; targetPhaseId: number; beforeStepId?: number | null },
) {
  return post<TrajectoryStep>(
    `/v2/trajectories/${trajectoryId}/steps/move`,
    data,
  )
}
```

- [ ] **Step 2: Sortable cross-group**

In `StepsPanel.vue`:

1. Change emit type:
```ts
"move-step": [{
  stepId: number
  targetPhaseId: number
  beforeStepId: number | null
  fromPhaseId: number
}]
```

2. On `.group-steps` root, set `data-phase-id="group.id"`.
3. On each step row, set `:data-step-id="step.id"`.
4. Sortable options:
```js
group: {
  name: 'trajectory-steps',
  pull: true,
  put: (to) => {
    const phaseId = Number(to?.el?.dataset?.phaseId);
    return phaseId > 0; // orphan -1 cannot receive
  },
},
```
For orphan group init, use `put: false` when `groupId === -1`.

5. `onEnd`:
```js
onEnd: (evt) => {
  const item = evt.item as HTMLElement;
  const stepId = Number(item?.dataset?.stepId);
  const toEl = evt.to as HTMLElement;
  const fromEl = evt.from as HTMLElement;
  const targetPhaseId = Number(toEl?.dataset?.phaseId);
  const fromPhaseId = Number(fromEl?.dataset?.phaseId);
  if (!(stepId > 0) || !(targetPhaseId > 0)) return;
  const next = item.nextElementSibling as HTMLElement | null;
  const beforeStepId = next?.dataset?.stepId
    ? Number(next.dataset.stepId)
    : null;
  if (evt.from === evt.to && evt.oldIndex === evt.newIndex) return;
  emit('move-step', { stepId, targetPhaseId, beforeStepId, fromPhaseId });
},
```

Keep existing disable rules (`isStepDraggable`).

- [ ] **Step 3: `doMoveStep` in studio**

```ts
async function doMoveStep(payload: {
  stepId: number
  targetPhaseId: number
  beforeStepId: number | null
}) {
  const id = trajId()
  if (!(id > 0)) return
  await moveTrajectoryStep(id, payload)
  await refreshTree()
}
```

Export `doMoveStep`.

- [ ] **Step 4: `handleMoveStep` in `detail/index.vue`**

Replace local-only splice with:

```ts
async function handleMoveStep(payload: {
  stepId: number
  targetPhaseId: number
  beforeStepId: number | null
  fromPhaseId: number
}) {
  // optimistic: move in stepGroups (optional); always refresh on settle
  try {
    await studio.doMoveStep({
      stepId: payload.stepId,
      targetPhaseId: payload.targetPhaseId,
      beforeStepId: payload.beforeStepId,
    })
  } catch {
    await studio.refreshTree()
    // error already toasted by request layer if applicable
  }
}
```

If optimistic splice is kept, rebuild groups from `fromPhaseId` → `targetPhaseId` using `stepId` / `beforeStepId`; on failure `refreshTree()` restores server truth.

- [ ] **Step 5: Manual UI verify**

1. Open a draft/recorded trajectory with ≥2 phases and ≥3 steps.
2. Drag within phase → order persists after refresh.
3. Drag to another phase middle and to end → tree + `stepNumber` correct.
4. During AI/manual record or replay → drag disabled (existing flags) / API 409 if forced.

- [ ] **Step 6: Commit (Vue repo)**

```bash
cd D:/dev/ui-auto-recording-agent-vue-master/vue-project
git add src/api/recording.ts \
  src/views/ui-recording/detail/components/StepsPanel.vue \
  src/views/ui-recording/detail/index.vue \
  src/composables/useRecordingStudio.ts
git commit -m "$(cat <<'EOF'
feat: persist step drag reorder via steps/move API

EOF
)"
```

---

## Spec coverage checklist

| Spec item | Task |
|-----------|------|
| `POST .../steps/move` + before/null = end | Task 3 |
| Global `step_number` + `trajectory_phase_id` | Task 2–3 |
| Busy 409, not status-gated | Task 3 |
| Screenshots unchanged | N/A (FK by id) |
| Catalog | Task 3 |
| Cross-phase Sortable + orphan put:false | Task 4 |
| Drop column `is_replay` + filters | Task 1 |
| Keep request `isReplay` | Task 1 (docs only) |
| Characterization within/cross/empty/invalid | Task 2 |

## Self-review notes

- No TBD placeholders; FE is a separate commit stream but same plan.
- `planStepMove` signature consistent across Tasks 2–3.
- Empty-phase case: phases with zero steps still occupy order slots via phase_number walk — inserting into empty phase places the step between neighboring phases’ segments.
