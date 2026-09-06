# Transaction Export V2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Export trajectories as the partner transaction envelope (`参数.txt`), with single + batch full-trajectory APIs and an `is_export` dirty flag.

**Architecture:** New pure mapper `src/services/transaction-export.js` reuses V1 primitives from `legacy-engine-export.js` + `trajectoryStepToActionEntry`. Routes live in `export-mgmt.js`. DAO helpers flip `trajectory.is_export`; step/phase write paths mark dirty; successful full export marks clean.

**Tech Stack:** Node.js (ESM), Knex migrations, Express `/api/v2/export/*`, characterization scripts (`node scripts/characterization/*.mjs`).

**Spec:** `docs/superpowers/specs/2026-08-10-transaction-export-v2-design.md`

## Global Constraints

- Partner field spellings are fixed: `transcationName`, `transcationType`, `transcationEventType`, `mothed`, `transcId` — do not “correct” them.
- Export only actions in `ACTION_TO_ENGINE_TYPE`; skip V1 `SKIP_ACTIONS` (import or re-export from legacy module — do not fork divergent skip sets).
- `elementType` = xpath (smart first, else full). `options` = `""` or `JSON.stringify(string[])`.
- `systemId` / `projectId` required from caller; never call partner lookup APIs.
- Full-trajectory only this cut. Leave `// TODO: partial export (stepIds/phaseIds) + export coverage` comments — do not implement.
- `// TODO: placeholder` — do not emit placeholder.
- V1 `/legacy-engine` and `assemble-file` must stay behavior-identical.
- Empty `transcationEventType` (`count: 0`) still sets `is_export = 1` on successful export response.
- `scripts/`-only changes need no CHANGELOG; **API/route + migration changes require** `catalog.js` update (and CHANGELOG if repo convention for API adds applies — follow existing export entry style in catalog).

---

## File map

| File | Responsibility |
|------|----------------|
| `migrations/20260810120000_trajectory_is_export.js` | Add `trajectory.is_export` TINYINT(1) NOT NULL DEFAULT 0 |
| `src/dao/trajectory-dao.js` | `markExportDirty` / `markExported`; normalize `isExport` on read |
| `src/dao/trajectory-step-dao.js` | After create/update/remove/batchSave/applyPlannedOrder → dirty |
| `src/dao/trajectory-phase-dao.js` | After create/update/updateStatus → dirty; add `remove` if missing and wire dirty |
| `src/services/transaction-export.js` | Pure map: step → event; traj → payload; batch helper |
| `src/services/legacy-engine-export.js` | Export `SKIP_ACTIONS` (or shared constant) for reuse — minimal change |
| `src/routes/v2/export-mgmt.js` | schema + single + batch transaction routes |
| `src/dashboard/api-docs/catalog.js` | Document new endpoints + `isExport` |
| `scripts/characterization/characterize-transaction-export.mjs` | Mapper + envelope assertions |

---

### Task 1: Migration + DAO export flag helpers

**Files:**
- Create: `migrations/20260810120000_trajectory_is_export.js`
- Modify: `src/dao/trajectory-dao.js`
- Test: manual SQL / knex migrate (characterization of flag in Task 4)

**Interfaces:**
- Produces:
  - `markExportDirty(trajectoryId, trx?) → Promise<number>` — `UPDATE … SET is_export=0`
  - `markExported(trajectoryId, trx?) → Promise<number>` — `SET is_export=1`
  - `getById` / list entities expose `isExport` as `0|1` number (fromDbRow already camelCases `is_export`)

- [ ] **Step 1: Add migration**

```js
/**
 * trajectory.is_export — 0 dirty/never exported, 1 last full export succeeded
 */
export async function up(knex) {
  await knex.schema.alterTable('trajectory', (t) => {
    t.specificType('is_export', 'TINYINT(1)')
      .notNullable()
      .defaultTo(0)
      .comment('1 = full transaction export succeeded; 0 = changed or never exported');
  });
}

export async function down(knex) {
  await knex.schema.alterTable('trajectory', (t) => {
    t.dropColumn('is_export');
  });
}
```

- [ ] **Step 2: Add DAO helpers** (near `updateMeta` in `trajectory-dao.js`)

```js
export async function markExportDirty(trajectoryId, trx = null) {
  const id = Number(trajectoryId);
  if (!Number.isFinite(id) || id <= 0) return 0;
  const db = trx || getDB();
  return db(TABLE).where({ id }).update({ is_export: 0 });
}

export async function markExported(trajectoryId, trx = null) {
  const id = Number(trajectoryId);
  if (!Number.isFinite(id) || id <= 0) return 0;
  const db = trx || getDB();
  return db(TABLE).where({ id }).update({ is_export: 1 });
}
```

After `fromDbRow` in `getById` / list shaping, normalize:

```js
entity.isExport = Number(entity.isExport) ? 1 : 0;
```

(Apply the same one-liner wherever list returns trajectory entities — `list` / `listByFunction` loop is fine.)

- [ ] **Step 3: Run migration against local DB**

Run: `npx knex migrate:latest` (or project’s usual migrate command from `package.json`)

Expected: migration applied; `SHOW COLUMNS FROM trajectory LIKE 'is_export'` shows column.

- [ ] **Step 4: Commit**

```bash
git add migrations/20260810120000_trajectory_is_export.js src/dao/trajectory-dao.js
git commit -m "feat: add trajectory.is_export column and DAO helpers"
```

---

### Task 2: Pure transaction mapper (TDD)

**Files:**
- Create: `scripts/characterization/characterize-transaction-export.mjs`
- Create: `src/services/transaction-export.js`
- Modify: `src/services/legacy-engine-export.js` — export `SKIP_ACTIONS` as named export if currently private

**Interfaces:**
- Consumes: `ACTION_TO_ENGINE_TYPE`, `pickExportTarget`, `buildOperationName`, `pickOperationValue`, `SKIP_ACTIONS` from legacy-engine-export; `trajectoryStepToActionEntry` from element.js
- Produces:
  - `EVENT_TYPE_NAME` — map `eventTypeValue →` Chinese category name
  - `mapStepToTransactionEvent(step) → object|null`
  - `buildTransactionPayload(traj, { systemId, projectId }) → { payload, count, skipped, stats }`
  - `TRANSACTION_ENVELOPE_FIELDS` / schema constants for `/schema` route

- [ ] **Step 1: Write failing characterization**

Create `scripts/characterization/characterize-transaction-export.mjs`:

```js
/**
 * Characterization: partner transaction export envelope (V2).
 * Run: node scripts/characterization/characterize-transaction-export.mjs
 */
import assert from 'node:assert/strict';
import {
  mapStepToTransactionEvent,
  buildTransactionPayload,
  EVENT_TYPE_NAME,
} from '../../src/services/transaction-export.js';

function testFillInput() {
  const ev = mapStepToTransactionEvent({
    id: 10,
    actionType: 'fill_form_field',
    params: { label_text: '用户名', value: '701994' },
    element: {
      tag: 'input',
      xpath_smart: '//input[@placeholder="请输入您的用户名"]',
      attributes: { placeholder: '请输入您的用户名' },
    },
  });
  assert.equal(ev.eventTypeValue, 'input');
  assert.equal(ev.eventTypeName, '文本框输入');
  assert.equal(ev.propertiesName, '填写:用户名');
  assert.equal(ev.objectValue, '701994');
  assert.equal(ev.elementType, '//input[@placeholder="请输入您的用户名"]');
  assert.equal(ev.options, '');
  assert.equal(ev.mothed, 'By.XPATH');
  assert.equal(ev.transcationType, 'selenium');
  assert.equal(Object.prototype.hasOwnProperty.call(ev, 'placeholder'), false);
}

function testSelectOptionsJson() {
  const ev = mapStepToTransactionEvent({
    actionType: 'select_option',
    params: { label_text: '状态', option_text: '启用', options: ['启用', '停用'] },
    element: {
      xpath_smart: "//div[contains(@class,'el-select')]",
      options: ['启用', '停用'],
    },
  });
  assert.equal(ev.eventTypeValue, 'select:click');
  assert.equal(ev.eventTypeName, EVENT_TYPE_NAME['select:click']);
  assert.equal(ev.objectValue, '启用');
  assert.equal(ev.options, JSON.stringify(['启用', '停用']));
}

function testSkipMeta() {
  assert.equal(mapStepToTransactionEvent({ actionType: 'wait_for_loading', params: {} }), null);
  assert.equal(mapStepToTransactionEvent({ actionType: 'go_to_url', params: { url: 'http://x' } }), null);
}

function testEnvelope() {
  const { payload, count, skipped } = buildTransactionPayload(
    {
      id: 99,
      name: '登录',
      steps: [
        {
          id: 1,
          actionType: 'fill_form_field',
          params: { label_text: '用户名', value: 'a' },
          element: { xpath_smart: '//input[@name="u"]' },
        },
        { id: 2, actionType: 'scan_form_fields', params: {} },
      ],
    },
    { systemId: 1, projectId: '7' },
  );
  assert.equal(payload.transcId, '99');
  assert.equal(payload.transcationName, '登录');
  assert.equal(payload.systemId, '1');
  assert.equal(payload.projectId, '7');
  assert.equal(payload.transcationType, 'web');
  assert.equal(payload.testFrame, 'selenium');
  assert.equal(count, 1);
  assert.equal(payload.transcationEventType.length, 1);
  assert.equal(skipped.metaActions, 1);
  assert.ok(!('attributes' in payload.transcationEventType[0]));
}

function testAbsoluteFallbackStat() {
  const { stats, payload } = buildTransactionPayload(
    {
      id: 1,
      name: 't',
      steps: [{
        actionType: 'click_element_by_index',
        params: { text: 'x' },
        element: { xpath_full: '/html/body/button' },
      }],
    },
    { systemId: '1', projectId: '1' },
  );
  assert.equal(payload.transcationEventType[0].elementType, '/html/body/button');
  assert.equal(stats.absoluteFallback, 1);
}

testFillInput();
testSelectOptionsJson();
testSkipMeta();
testEnvelope();
testAbsoluteFallbackStat();
console.log('characterize-transaction-export: OK');
```

- [ ] **Step 2: Run to verify fail**

Run: `node scripts/characterization/characterize-transaction-export.mjs`

Expected: FAIL — module not found / export missing.

- [ ] **Step 3: Implement `transaction-export.js`**

```js
/**
 * V2 partner transaction export (参数.txt envelope).
 * // TODO: partial export (stepIds/phaseIds) + export coverage
 * // TODO: placeholder — wait for partner / relative xpath guidance
 */
import { normalizeActionName } from '../models/action-name.js';
import { trajectoryStepToActionEntry } from '../models/element.js';
import {
  ACTION_TO_ENGINE_TYPE,
  pickExportTarget,
  buildOperationName,
  pickOperationValue,
  SKIP_ACTIONS,
} from './legacy-engine-export.js';

export const EVENT_TYPE_NAME = Object.freeze({
  click: '点击',
  input: '文本框输入',
  'select:click': '下拉框点击选择',
  'select:tree': '下拉框树形选择',
  radio: '单选框选择',
  date: '日期',
});

export const TRANSACTION_ENVELOPE_FIELDS = Object.freeze([
  { key: 'transcId', zh: '录制/交易 id' },
  { key: 'transcationName', zh: '交易名称' },
  { key: 'systemId', zh: '系统树 id' },
  { key: 'projectId', zh: '项目 id' },
  { key: 'transcationType', zh: '类型（默认 web）' },
  { key: 'testFrame', zh: '框架（默认 selenium）' },
  { key: 'transcationEventType', zh: '事件数组' },
]);

function resolveOptions(entry) {
  const fromEl = entry?.element?.options;
  const fromParams = entry?.params?.options;
  const raw = Array.isArray(fromEl) && fromEl.length
    ? fromEl
    : (Array.isArray(fromParams) ? fromParams : []);
  const opts = [];
  const seen = new Set();
  for (const o of raw) {
    const s = String(o ?? '').trim();
    if (!s || s === '请选择' || seen.has(s)) continue;
    seen.add(s);
    opts.push(s);
  }
  return opts.length ? JSON.stringify(opts) : '';
}

export function mapStepToTransactionEvent(step) {
  const entry = step?.action && step?.element !== undefined && !step?.actionType
    ? step
    : trajectoryStepToActionEntry(step || {});
  const action = normalizeActionName(entry.action || step?.actionType || '');
  if (!action || SKIP_ACTIONS.has(action)) return null;
  const eventTypeValue = ACTION_TO_ENGINE_TYPE[action];
  if (!eventTypeValue) return null;

  const params = entry.params || {};
  const element = entry.element || {};
  const { target, source } = pickExportTarget(entry);
  const options = resolveOptions(entry);

  return {
    options,
    elementType: target || null,
    eventTypeName: EVENT_TYPE_NAME[eventTypeValue] || eventTypeValue,
    eventTypeValue,
    transcationType: 'selenium',
    objectValue: pickOperationValue(action, params),
    propertiesName: buildOperationName(action, params, element),
    mothed: 'By.XPATH',
    _meta: { targetSource: source || null, missingOptions: options === '' && (eventTypeValue.startsWith('select') || eventTypeValue === 'radio') },
  };
}

export function buildTransactionPayload(traj, { systemId, projectId } = {}) {
  if (systemId == null || systemId === '' || projectId == null || projectId === '') {
    const err = new Error('systemId and projectId are required');
    err.statusCode = 400;
    throw err;
  }
  const events = [];
  let metaActions = 0;
  let absoluteFallback = 0;
  let missingOptions = 0;

  for (const step of traj.steps || []) {
    const ev = mapStepToTransactionEvent(step);
    if (!ev) {
      metaActions += 1;
      continue;
    }
    if (ev._meta?.targetSource === 'xpath_full') absoluteFallback += 1;
    if (ev._meta?.missingOptions) missingOptions += 1;
    const { _meta, ...publicEv } = ev;
    events.push(publicEv);
  }

  const id = traj.id != null ? String(traj.id) : '';
  const name = String(traj.name || '').trim() || `trajectory-${id}`;

  return {
    payload: {
      transcId: id,
      transcationName: name,
      systemId: String(systemId),
      projectId: String(projectId),
      transcationType: 'web',
      testFrame: 'selenium',
      transcationEventType: events,
    },
    count: events.length,
    skipped: { metaActions },
    stats: { absoluteFallback, missingOptions },
  };
}
```

Also change `legacy-engine-export.js`: rename/export the private `SKIP_ACTIONS` set:

```js
export const SKIP_ACTIONS = new Set([ /* existing list unchanged */ ]);
```

(Remove the old `const SKIP_ACTIONS` so there is a single export.)

- [ ] **Step 4: Run characterization**

Run: `node scripts/characterization/characterize-transaction-export.mjs`

Expected: `characterize-transaction-export: OK`

- [ ] **Step 5: Confirm V1 still green**

Run: `node scripts/characterization/characterize-legacy-engine-export.mjs`

Expected: OK

- [ ] **Step 6: Commit**

```bash
git add src/services/transaction-export.js src/services/legacy-engine-export.js scripts/characterization/characterize-transaction-export.mjs
git commit -m "feat: map trajectory steps to partner transaction envelope"
```

---

### Task 3: Mark dirty on step/phase writes

**Files:**
- Modify: `src/dao/trajectory-step-dao.js`
- Modify: `src/dao/trajectory-phase-dao.js`

**Interfaces:**
- Consumes: `trajectoryDao.markExportDirty`
- Produces: every successful step/phase mutation dirties parent trajectory

- [ ] **Step 1: Helper inside step DAO** (top of file after imports)

```js
import * as trajectoryDao from './trajectory-dao.js';

async function dirtyParent(trajectoryId, trx = null) {
  if (trajectoryId == null) return;
  await trajectoryDao.markExportDirty(trajectoryId, trx);
}
```

Call `dirtyParent` after successful:

- `batchSave` — once per distinct `trajectoryId` in the batch (or once if all same)
- `create` — after insert, with `step.trajectoryId`
- `update` — load row first if `fields` lacks trajectoryId: `const cur = await getById(id)` then dirty `cur.trajectoryId`
- `removeById` — getById before delete, then dirty
- `applyPlannedOrder` — dirty `trajectoryId` once after transaction
- `removeByTrajectory` — dirty that id (optional; trajectory may be deleting)

- [ ] **Step 2: Phase DAO**

After `create` / `update` / `updateStatus` success, call `markExportDirty(data.trajectoryId || existing.trajectoryId)`.

If product has phase delete elsewhere that only deletes steps, ensure that path also dirties (grep `trajectory_phase` `.del(` / `remove`); if a `remove(phaseId)` is added, dirty there too.

**Note:** `updateStatus` during recording will set `is_export=0` repeatedly — intended (“有改变就置 0”).

- [ ] **Step 3: Smoke** — no automated DB test required in this task; Task 4 covers export mark. Optionally:

```js
// In a quick node REPL / one-off: create step → SELECT is_export FROM trajectory WHERE id=?
```

- [ ] **Step 4: Commit**

```bash
git add src/dao/trajectory-step-dao.js src/dao/trajectory-phase-dao.js
git commit -m "feat: clear is_export on phase and step mutations"
```

---

### Task 4: Single-trajectory export routes + mark exported

**Files:**
- Modify: `src/routes/v2/export-mgmt.js`
- Modify: `scripts/characterization/characterize-transaction-export.mjs` (add `requireIds` unit if pure; route smoke optional)

**Interfaces:**
- Consumes: `buildTransactionPayload`, `TRANSACTION_ENVELOPE_FIELDS`, `EVENT_TYPE_NAME`, `ACTION_TO_ENGINE_TYPE`, `trajectoryDao.getById`, `markExported`
- Produces: HTTP handlers per spec

- [ ] **Step 1: Add routes** (keep all existing legacy-engine routes)

```js
import {
  buildTransactionPayload,
  TRANSACTION_ENVELOPE_FIELDS,
  EVENT_TYPE_NAME,
  mapStepToTransactionEvent,
} from '../../services/transaction-export.js';

function requireSystemProject(src) {
  const systemId = src.systemId ?? src.system_id;
  const projectId = src.projectId ?? src.project_id;
  if (systemId == null || systemId === '' || projectId == null || projectId === '') {
    const err = new Error('systemId and projectId are required');
    err.statusCode = 400;
    throw err;
  }
  return { systemId, projectId };
}

// GET /api/v2/export/transaction/schema
app.get('/api/v2/export/transaction/schema', (_req, res) => {
  res.json({
    schemaVersion: 1,
    fields: TRANSACTION_ENVELOPE_FIELDS,
    eventTypeName: EVENT_TYPE_NAME,
    actionTypeMap: ACTION_TO_ENGINE_TYPE,
    notes: [
      'Partner envelope spellings (transcation*, mothed) are intentional',
      // TODO: partial export (stepIds/phaseIds) + export coverage
      // TODO: placeholder
    ],
  });
});

async function exportOneTrajectory(traj, { systemId, projectId }) {
  const built = buildTransactionPayload(traj, { systemId, projectId });
  await trajectoryDao.markExported(traj.id);
  return {
    trajectoryId: traj.id,
    isExport: 1,
    schemaVersion: 1,
    ...built,
  };
}

app.get('/api/v2/export/trajectories/:id/transaction', async (req, res) => {
  try {
    const { systemId, projectId } = requireSystemProject(req.query);
    const traj = await trajectoryDao.getById(+req.params.id);
    if (!traj) return res.status(404).json({ error: 'Trajectory not found' });
    const result = await exportOneTrajectory(traj, { systemId, projectId });
    if (parseBool(req.query.download, false)) {
      res.setHeader('Content-Disposition', `attachment; filename="transaction_${traj.id}.json"`);
      return res.json(result.payload);
    }
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

app.post('/api/v2/export/trajectories/:id/transaction', async (req, res) => {
  try {
    const body = req.body || {};
    const { systemId, projectId } = requireSystemProject({ ...req.query, ...body });
    const traj = await trajectoryDao.getById(+req.params.id);
    if (!traj) return res.status(404).json({ error: 'Trajectory not found' });
    const result = await exportOneTrajectory(traj, { systemId, projectId });
    if (parseBool(body.download ?? req.query.download, false)) {
      res.setHeader('Content-Disposition', `attachment; filename="transaction_${traj.id}.json"`);
      return res.json(result.payload);
    }
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});
```

- [ ] **Step 2: Manual / curl check** (server running)

```bash
# expect 400
curl -s "http://localhost:4097/api/v2/export/trajectories/1/transaction"
# expect 200 + isExport 1 when ids present
curl -s -X POST "http://localhost:4097/api/v2/export/trajectories/1/transaction" -H "Content-Type: application/json" -d "{\"systemId\":\"1\",\"projectId\":\"1\"}"
```

Expected: 400 without ids; 200 with `payload.transcationEventType` array and `isExport: 1`.

- [ ] **Step 3: Commit**

```bash
git add src/routes/v2/export-mgmt.js
git commit -m "feat: add single trajectory transaction export API"
```

---

### Task 5: Batch export route

**Files:**
- Modify: `src/routes/v2/export-mgmt.js`

**Interfaces:**
- Produces: `POST /api/v2/export/transactions`

- [ ] **Step 1: Implement batch**

```js
app.post('/api/v2/export/transactions', async (req, res) => {
  try {
    const body = req.body || {};
    const { systemId, projectId } = requireSystemProject(body);
    const ids = parseIdList(body.trajectoryIds ?? body.trajectory_ids);
    if (!ids.length) {
      return res.status(400).json({ error: 'trajectoryIds[] is required' });
    }
    const items = [];
    let ok = 0;
    let failed = 0;
    for (const id of ids) {
      try {
        const traj = await trajectoryDao.getById(id);
        if (!traj) {
          failed += 1;
          items.push({ trajectoryId: id, ok: false, error: 'Trajectory not found' });
          continue;
        }
        const result = await exportOneTrajectory(traj, { systemId, projectId });
        ok += 1;
        items.push({
          trajectoryId: id,
          ok: true,
          isExport: 1,
          payload: result.payload,
          count: result.count,
          skipped: result.skipped,
          stats: result.stats,
        });
      } catch (e) {
        failed += 1;
        items.push({ trajectoryId: id, ok: false, error: e.message });
      }
    }
    res.json({
      schemaVersion: 1,
      systemId: String(systemId),
      projectId: String(projectId),
      items,
      summary: { ok, failed },
    });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});
```

- [ ] **Step 2: Curl batch with one valid + one invalid id**

Expected: `summary.ok >= 1`, `summary.failed >= 1`, failed item has no `isExport` flip for missing traj.

- [ ] **Step 3: Commit**

```bash
git add src/routes/v2/export-mgmt.js
git commit -m "feat: add batch transaction export API"
```

---

### Task 6: API docs (`catalog.js`)

**Files:**
- Modify: `src/dashboard/api-docs/catalog.js`

- [ ] **Step 1: Add enum/notes** near existing legacy-engine entries

Document:

- `GET /api/v2/export/transaction/schema`
- `GET|POST /api/v2/export/trajectories/{id}/transaction` (required `systemId`, `projectId`; optional `download`)
- `POST /api/v2/export/transactions` (body `trajectoryIds`, `systemId`, `projectId`)
- Trajectory list/detail field `isExport`

Include a short `respExample` matching the partner envelope shape (one click event is enough).

- [ ] **Step 2: Commit**

```bash
git add src/dashboard/api-docs/catalog.js
git commit -m "docs: catalog transaction export V2 APIs and isExport"
```

---

### Task 7: Final verification

- [ ] **Step 1: Run characterizations**

```bash
node scripts/characterization/characterize-transaction-export.mjs
node scripts/characterization/characterize-legacy-engine-export.mjs
```

Expected: both OK

- [ ] **Step 2: Dirty-flag roundtrip (manual)**

1. Export traj → `isExport === 1`
2. Patch any step (or append via record) → `isExport === 0`
3. Export again → `1`

- [ ] **Step 3: Spec coverage checklist**

Confirm implemented: partner envelope, operation type table, `is_export` rules, single + batch, schema route, TODOs as comments, V1 untouched.

---

## Spec coverage (plan self-check)

| Spec requirement | Task |
|------------------|------|
| Partner envelope + spellings | 2, 4 |
| Operation type / eventTypeName map | 2 |
| options JSON string / empty | 2 |
| elementType xpath smart→full | 2 |
| systemId/projectId required from caller | 2, 4, 5 |
| Single full export + download | 4 |
| Batch independent ok/fail | 5 |
| `is_export` column + mark 1 on export | 1, 4 |
| Dirty on phase/step mutate | 3 |
| List/detail `isExport` | 1 (+ catalog 6) |
| Partial export / placeholder TODOs | 2, 4 comments |
| V1 preserved | 2 regression + non-edits to assemble-file |

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-08-10-transaction-export-v2.md`. Two execution options:

**1. Subagent-Driven (recommended)** — fresh subagent per task, review between tasks  
**2. Inline Execution** — execute tasks in this session with executing-plans checkpoints  

Which approach?
