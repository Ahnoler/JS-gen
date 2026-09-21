# Atom Record Flow-Card Recall Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist `kb_flow_ref` / `kb_flow_node_id` on atomic draft trajectories and inject a full KB flow-card template + entry-path hint at prepare/record time (without bloating propose `taskDraft`).

**Architecture:** Propose lightly matches atoms → flow card stem + optional node id. Commit writes two new trajectory columns. Prepare loads the latest card from disk, builds an idempotent `【流程卡模板】` block via a pure helper, and prefixes the first phase description so record already sends it as `instruction`.

**Tech Stack:** Node ESM (JS-gen), Knex migrations, characterization scripts under `scripts/characterization/`, existing `kb-flow-cards.js` + `req-draft-traj/*` + `trajectory-attach-runner.js`.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-09-08-atom-record-flow-card-recall-design.md` (`ef2ae526`).
- `kb_flow_ref` = **filename stem** under `data/kb/flows/<stem>.json` (e.g. `customer_onboarding`).
- Propose `taskDraft` must **not** gain long entry prose; only optional `suggestedFlowRef` / `suggestedNodeId`.
- Prepare must **not** silently write `kb_flow_*` if missing; skip injection.
- No hit → behave as today (do not block prepare/record).
- Injection marker `【流程卡模板】` is idempotent (never double-prefix).
- Do **not** touch trajectory listByFunction query WIP, Vue recording dialog WIP, or propose-cache JSON commits.
- Restart 4097 only with user approval after code that must load in-process.

## File map

| File | Responsibility |
|------|----------------|
| `migrations/20260908103000_trajectory_kb_flow_ref.js` | Add nullable `kb_flow_ref`, `kb_flow_node_id` + index on `kb_flow_ref` |
| `src/dao/trajectory-dao.js` | Pass new fields through `save()` |
| `src/services/trajectory/trajectory-meta-service.js` | `createTransactionWithPhases` accepts + forwards refs |
| `src/services/kb-flow-cards.js` | `getFlowCard({ stem, dir })` full card read |
| `src/services/req-draft-traj/flow-card-recall.js` | `matchFlowForAtom`, `buildFlowTemplateHint`, `applyFlowTemplateHintToDescription` |
| `src/services/req-draft-traj/index.js` | Re-export recall helpers |
| `src/services/req-draft-traj/propose.js` | Attach suggest fields after materialize |
| `src/services/req-draft-traj/commit.js` | Write refs (+ optional overrides) |
| `src/services/trajectory/trajectory-attach-runner.js` | Prepare inject into first phase |
| `src/routes/v2/trajectory-record.js` or `trajectory.js` | Optional GET preview hint |
| `src/dashboard/api-docs/groups/kb.js` + trajectory docs | Contract notes |
| `scripts/characterization/characterize-flow-card-recall.mjs` | Offline pins |
| `scripts/refactor/verify-all.sh` | Register characterization |

---

### Task 1: Migration + DAO save wiring

**Files:**
- Create: `migrations/20260908103000_trajectory_kb_flow_ref.js`
- Modify: `src/dao/trajectory-dao.js` (`save` insert object ~153–176)
- Modify: `src/services/trajectory/trajectory-meta-service.js` (`createTransactionWithPhases` opts + `trajectoryDao.save` call)

**Interfaces:**
- Produces: DB columns `kb_flow_ref` VARCHAR(191) NULL, `kb_flow_node_id` VARCHAR(128) NULL; camelCase entity fields `kbFlowRef`, `kbFlowNodeId` via `fromDbRow`; `createTransactionWithPhases({ …, kbFlowRef?, kbFlowNodeId? })`

- [ ] **Step 1: Add migration**

```js
/**
 * trajectory: KB flow-card refs for atomic draft recording templates.
 */
export async function up(knex) {
  const has = await knex.schema.hasColumn('trajectory', 'kb_flow_ref');
  if (has) return;
  await knex.schema.alterTable('trajectory', (t) => {
    t.string('kb_flow_ref', 191).nullable()
      .comment('KB flow card filename stem under data/kb/flows');
    t.string('kb_flow_node_id', 128).nullable()
      .comment('Optional nodes[].id within the flow card');
    t.index(['kb_flow_ref'], 'traj_kb_flow_ref_idx');
  });
}

export async function down(knex) {
  const has = await knex.schema.hasColumn('trajectory', 'kb_flow_ref');
  if (!has) return;
  await knex.schema.alterTable('trajectory', (t) => {
    t.dropIndex(['kb_flow_ref'], 'traj_kb_flow_ref_idx');
    t.dropColumn('kb_flow_ref');
    t.dropColumn('kb_flow_node_id');
  });
}
```

- [ ] **Step 2: Wire `trajectoryDao.save`**

In the `toDbRow({…})` object of `save`, add:

```js
kbFlowRef: trajectory.kbFlowRef ?? null,
kbFlowNodeId: trajectory.kbFlowNodeId ?? null,
```

- [ ] **Step 3: Wire `createTransactionWithPhases`**

Add params `kbFlowRef = null`, `kbFlowNodeId = null` to the destructuring list and pass them into `trajectoryDao.save({ … })` alongside `reqAtomKey`.

- [ ] **Step 4: Commit**

```bash
git add migrations/20260908103000_trajectory_kb_flow_ref.js src/dao/trajectory-dao.js src/services/trajectory/trajectory-meta-service.js
git commit -m "feat(db): trajectory kb_flow_ref/kb_flow_node_id for atom recording templates"
```

Note: migrate on the user’s DB only when they approve (do not run migrate in CI characterization unless the suite already migrates).

---

### Task 2: `getFlowCard` + recall helpers (TDD)

**Files:**
- Modify: `src/services/kb-flow-cards.js`
- Create: `src/services/req-draft-traj/flow-card-recall.js`
- Modify: `src/services/req-draft-traj/index.js`
- Create: `scripts/characterization/characterize-flow-card-recall.mjs`
- Modify: `scripts/refactor/verify-all.sh` (register the new script near other kb/req-draft runs)

**Interfaces:**
- Consumes: flow JSON shape `{ flow, aliases?, keywords?, hash_markers?, menu_path?, preconditions?, nodes?: [{ id, page?, enter?, … }] }`
- Produces:
  - `getFlowCard({ stem, dir? }) → Promise<object|null>`
  - `matchFlowForAtom({ title, taskDraft, cards }) → { flowRef: string|null, nodeId: string|null }`
  - `buildFlowTemplateHint({ card, nodeId, atomTask }) → string|null`
  - `applyFlowTemplateHintToDescription(description, hint) → string`
  - Marker constant: `FLOW_TEMPLATE_MARKER = '【流程卡模板】'`

- [ ] **Step 1: Write failing characterization**

Create `scripts/characterization/characterize-flow-card-recall.mjs` that:

1. Builds a temp dir with one card `customer_onboarding.json`:

```json
{
  "flow": "对公客户建档",
  "aliases": ["对公客户管理"],
  "keywords": ["客户转正", "草稿客户"],
  "hash_markers": ["ZJJK00066153", "FS00004007"],
  "menu_path": "客户管理→对公客户管理",
  "preconditions": [
    "入口：客户管理→对公客户管理",
    "客户转正：选择一个信贷预客户，点击修改，进入对公客户主页，点击客户转正",
    "草稿客户：选择一个草稿客户，点击修改，进入创建潜在客户基础页面"
  ],
  "nodes": [
    { "id": "list", "page": "对公客户管理列表页", "enter": "菜单 客户管理→对公客户管理" },
    { "id": "convert", "page": "客户转正场景", "enter": "列表选信贷预客户→【修改】→对公客户主页→【客户转正】" }
  ]
}
```

2. Asserts:

```js
import assert from 'node:assert/strict';
// after importing helpers with pathToFileURL
const card = await getFlowCard({ stem: 'customer_onboarding', dir: tmpFlows });
assert.equal(card.flow, '对公客户建档');

const hit = matchFlowForAtom({
  title: '对公客户转正并补齐任务页信息',
  taskDraft: '1、在对公客户主页点击【客户转正】，进入 FS00004007。\n',
  cards: [ { ...card, _stem: 'customer_onboarding' } ],
});
assert.equal(hit.flowRef, 'customer_onboarding');
assert.equal(hit.nodeId, 'convert');

const hint = buildFlowTemplateHint({
  card,
  nodeId: 'convert',
  atomTask: '在对公客户主页点击【客户转正】',
});
assert.match(hint, /【流程卡模板】/);
assert.match(hint, /客户转正：选择一个信贷预客户/);
assert.match(hint, /【本段起点】/);
assert.match(hint, /【本原子任务】/);

const once = applyFlowTemplateHintToDescription('原阶段描述', hint);
const twice = applyFlowTemplateHintToDescription(once, hint);
assert.equal(once, twice);
assert.ok(once.startsWith('【流程卡模板】'));

assert.equal(buildFlowTemplateHint({ card: null, nodeId: null, atomTask: 'x' }), null);
assert.equal(matchFlowForAtom({ title: '无关标题xyz', taskDraft: '', cards: [{ ...card, _stem: 'customer_onboarding' }] }).flowRef, null);
```

Scoring rules to implement (deterministic):

- Normalize haystacks to lowercased strings of `flow|aliases|keywords|hash_markers|node.page|node.enter|node.id`.
- Tokenize atom `title + taskDraft` for CJK keywords of length ≥2 that appear in card text; also exact substring hits for `FS\d+` / `ZJJK\d+`.
- Card score = sum of hits; node score = hits against that node’s fields (+ bonus if node.enter/page/id appears in taskDraft).
- Pick best card if score ≥ 2; pick best node if its score ≥ 1 and ≥ 50% of top card score; else `nodeId: null`.
- `cards` entries must carry `_stem` (filename stem) set by caller when listing.

- [ ] **Step 2: Run characterization — expect FAIL**

```bash
node scripts/characterization/characterize-flow-card-recall.mjs
```

Expected: FAIL (module / exports missing).

- [ ] **Step 3: Implement `getFlowCard` in `kb-flow-cards.js`**

```js
export async function getFlowCard({ stem, dir = DEFAULT_FLOWS_DIR } = {}) {
  const name = String(stem || '').trim();
  if (!name || name.includes('..') || name.includes('/') || name.includes('\\')) return null;
  const path = join(dir, `${name}.json`);
  try {
    const card = JSON.parse(await readFile(path, 'utf-8'));
    if (!card || typeof card !== 'object' || !card.flow) return null;
    return card;
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    console.warn(`[kb-flow-cards] getFlowCard failed: ${name} (${e.message})`);
    return null;
  }
}
```

Also add `listFlowCardsDetailed({ dir })` that returns full cards with `_stem: name.replace(/\.json$/, '')` for matching (or build that list inside propose by readdir — prefer one helper here).

- [ ] **Step 4: Implement `flow-card-recall.js`**

Implement `FLOW_TEMPLATE_MARKER`, `matchFlowForAtom`, `buildFlowTemplateHint`, `applyFlowTemplateHintToDescription` per asserts above.

`buildFlowTemplateHint` layout:

```
【流程卡模板】{flow}
菜单：{menu_path}
前置条件：
- {up to 8 preconditions}
【本段起点】（node={id} {page}）
到达：{enter}
【本原子任务】
{atomTask}
```

If `nodeId` missing/unknown: omit「本段起点」block but keep 菜单 + 前置条件 + 本原子任务.

- [ ] **Step 5: Re-export from `req-draft-traj/index.js` and re-run characterization — expect PASS**

```bash
node scripts/characterization/characterize-flow-card-recall.mjs
```

- [ ] **Step 6: Register in `verify-all.sh`**

```bash
run "characterize-flow-card-recall" node scripts/characterization/characterize-flow-card-recall.mjs
```

- [ ] **Step 7: Commit**

```bash
git add src/services/kb-flow-cards.js src/services/req-draft-traj/flow-card-recall.js src/services/req-draft-traj/index.js scripts/characterization/characterize-flow-card-recall.mjs scripts/refactor/verify-all.sh
git commit -m "feat(kb): match flow cards and build atom entry-path template hints"
```

---

### Task 3: Propose suggests flow refs

**Files:**
- Modify: `src/services/req-draft-traj/propose.js` (after atoms materialized, before cache write)
- Modify: `src/dashboard/api-docs/groups/kb.js` (propose respExample)
- Extend: `scripts/characterization/characterize-req-draft-traj.mjs` **or** add a small assert in `characterize-flow-card-recall.mjs` that imports propose with stub LLM and temp flows+chains — prefer extending flow-card-recall script with one propose integration stub to avoid heavy DB.

**Interfaces:**
- Consumes: `listFlowCardsDetailed` / temp cards; `matchFlowForAtom`
- Produces: each `DraftAtom` may include `suggestedFlowRef?: string`, `suggestedNodeId?: string`

- [ ] **Step 1: After building `capped` atoms in `proposeDraftTrajectories`, attach suggestions**

```js
import { listFlowCardsDetailed } from '../kb-flow-cards.js';
import { matchFlowForAtom } from './flow-card-recall.js';

const cards = await listFlowCardsDetailed({});
for (const atom of capped) {
  const hit = matchFlowForAtom({
    title: atom.title,
    taskDraft: atom.taskDraft,
    cards,
  });
  if (hit.flowRef) atom.suggestedFlowRef = hit.flowRef;
  if (hit.nodeId) atom.suggestedNodeId = hit.nodeId;
}
```

Do **not** mutate `taskDraft`.

- [ ] **Step 2: Update api-docs propose example** with the two optional fields.

- [ ] **Step 3: Characterization** — in `characterize-flow-card-recall.mjs`, pin that a hand-built atom object after calling `matchFlowForAtom` would set both fields (already covered in Task 2). Add one source pin:

```js
assert.match(readFileSync(proposePath, 'utf8'), /suggestedFlowRef/);
assert.match(readFileSync(proposePath, 'utf8'), /matchFlowForAtom/);
```

- [ ] **Step 4: Commit**

```bash
git add src/services/req-draft-traj/propose.js src/dashboard/api-docs/groups/kb.js scripts/characterization/characterize-flow-card-recall.mjs
git commit -m "feat(propose): suggest kb flowRef/nodeId for draft atoms without expanding taskDraft"
```

---

### Task 4: Commit persists refs

**Files:**
- Modify: `src/services/req-draft-traj/commit.js`
- Modify: route body parsing if commit route whitelists fields (`src/routes/v2/kb.js`)
- Modify: api-docs commit notes

**Interfaces:**
- Consumes: atom.`suggestedFlowRef` / `suggestedNodeId`; optional `flowRefOverrides: { [atomKey]: { kbFlowRef?, kbFlowNodeId? } }`
- Produces: `createTransactionWithPhases({ …, kbFlowRef, kbFlowNodeId })`

- [ ] **Step 1: Extend `commitDraftTrajectories` signature**

```js
flowRefOverrides = {},
```

Resolve per atom:

```js
const ov = flowRefOverrides[atomKey] || {};
const kbFlowRef = ov.kbFlowRef ?? atom.suggestedFlowRef ?? null;
const kbFlowNodeId = ov.kbFlowNodeId ?? atom.suggestedNodeId ?? null;
// pass into create({ …, kbFlowRef, kbFlowNodeId })
```

- [ ] **Step 2: Plumb `flowRefOverrides` from HTTP body** in the commit route (same pattern as `functionIdOverrides`).

- [ ] **Step 3: Characterization** — offline commit stub: mock `createFn` capturing args; propose-cache atom with `suggestedFlowRef: 'customer_onboarding'`; assert create received `kbFlowRef`.

Add to `characterize-flow-card-recall.mjs` or a tiny block in existing `characterize-req-draft-traj.mjs` if it already stubs commit.

- [ ] **Step 4: Commit**

```bash
git add src/services/req-draft-traj/commit.js src/routes/v2/kb.js src/dashboard/api-docs/groups/kb.js scripts/characterization/characterize-flow-card-recall.mjs
git commit -m "feat(commit): persist kbFlowRef/kbFlowNodeId on atomic draft trajectories"
```

---

### Task 5: Prepare injects template into first phase

**Files:**
- Modify: `src/services/trajectory/trajectory-attach-runner.js`
- Possibly tiny helper import only (no record-runner change if phase.description is the instruction source — confirmed: record uses `instruction: phase.description`)

**Interfaces:**
- Consumes: `traj.kbFlowRef`, `traj.kbFlowNodeId`, `traj.task`, `getFlowCard`, `buildFlowTemplateHint`, `applyFlowTemplateHintToDescription`, `trajectoryPhaseDao.listByTrajectory` + `update`
- Produces: first pending/lowest `phase_number` description prefixed once

- [ ] **Step 1: After account resolve / before or after attach (once traj is loaded), inject**

Recommended placement: early in `prepareTrajectoryRecordingUnlocked`, after `resolveTrajectoryAccount` returns `traj`, before attach is fine:

```js
import { getFlowCard } from '../kb-flow-cards.js';
import {
  buildFlowTemplateHint,
  applyFlowTemplateHintToDescription,
} from '../req-draft-traj/flow-card-recall.js';

async function injectFlowTemplateHintIfNeeded(traj) {
  const flowRef = traj?.kbFlowRef;
  if (!flowRef) return;
  const card = await getFlowCard({ stem: flowRef });
  if (!card) return;
  const hint = buildFlowTemplateHint({
    card,
    nodeId: traj.kbFlowNodeId || null,
    atomTask: String(traj.task || '').trim(),
  });
  if (!hint) return;
  const phases = await trajectoryPhaseDao.listByTrajectory(traj.id);
  const first = phases.slice().sort((a, b) => Number(a.phaseNumber) - Number(b.phaseNumber))[0];
  if (!first?.id) return;
  const next = applyFlowTemplateHintToDescription(first.description || '', hint);
  if (next === (first.description || '')) return;
  await trajectoryPhaseDao.update(first.id, { description: next });
}
```

Call `await injectFlowTemplateHintIfNeeded(traj);` then continue prepare. If `resolveTrajectoryAccount`’s traj is stale after updates, re-read only if needed — description update is on phase table, tree later will show it.

- [ ] **Step 2: Characterization** — unit-test `applyFlowTemplateHintToDescription` already covers idempotency. Add source pin:

```js
assert.match(attachRunnerSrc, /injectFlowTemplateHintIfNeeded|buildFlowTemplateHint/);
assert.match(attachRunnerSrc, /kbFlowRef/);
```

- [ ] **Step 3: Manual note in commit message** — wet verify requires migrate + restart + prepare on a committed atom (user-owned).

- [ ] **Step 4: Commit**

```bash
git add src/services/trajectory/trajectory-attach-runner.js scripts/characterization/characterize-flow-card-recall.mjs
git commit -m "feat(prepare): inject flow-card template hint into first phase description"
```

---

### Task 6: Preview API (spec §9 — include this version)

**Files:**
- Modify: `src/routes/v2/trajectory.js` (or record routes group)
- Modify: api-docs trajectory group
- Extend characterization with HTTP-less service call:

`getFlowTemplateHintForTrajectory(trajectoryId)` in `flow-card-recall.js` or thin service wrapping getById + build.

**Interfaces:**
- `GET /api/v2/trajectories/:id/flow-template-hint` → `{ code:200, data: { hint: string|null, kbFlowRef, kbFlowNodeId } }`

- [ ] **Step 1: Implement handler** using `trajectoryDao.getById` + `getFlowCard` + `buildFlowTemplateHint` (no DB write).

- [ ] **Step 2: api-docs entry**

- [ ] **Step 3: Pin route registration in characterization**

- [ ] **Step 4: Commit**

```bash
git add src/routes/v2/trajectory.js src/dashboard/api-docs/groups/*.js scripts/characterization/characterize-flow-card-recall.mjs
git commit -m "feat(api): preview flow-template-hint for atomic trajectories"
```

---

### Task 7: Docs close-out

**Files:**
- Modify: `docs/superpowers/specs/2026-09-08-atom-record-flow-card-recall-design.md` status → 已实现（hash）
- Modify: `docs/superpowers/todo-list.md` — short note under ⑧ bug/enhancement line if present
- Modify: `docs/superpowers/agent-log.md` — start/close for implementation session when executing

- [ ] **Step 1: Mark spec status + link plan**

- [ ] **Step 2: Commit docs only**

```bash
git add docs/superpowers/specs/2026-09-08-atom-record-flow-card-recall-design.md docs/superpowers/todo-list.md docs/superpowers/agent-log.md
git commit -m "docs: close atom flow-card recall plan status after implementation"
```

(This task runs **after** Tasks 1–6 land.)

---

## Spec coverage self-review

| Spec section | Task |
|--------------|------|
| §5 columns A | Task 1 |
| §6 match | Task 2–3 |
| §7 build hint | Task 2 |
| §8 prepare inject + no silent write + idempotent | Task 5 |
| §9 propose suggest / commit write / preview API | Tasks 3–4, 6 |
| §12 acceptance | characterize in 2–6 |
| Out: no Vue override UI | — omitted |
| Out: card content enrichment | — omitted (engine degrades) |

## Placeholder scan

No TBD/TODO steps; concrete scoring, marker, file paths, and commands included.

## Type consistency

- DB: `kb_flow_ref` / `kb_flow_node_id`
- JS camelCase: `kbFlowRef` / `kbFlowNodeId`
- Propose JSON: `suggestedFlowRef` / `suggestedNodeId`
- Match result: `{ flowRef, nodeId }` mapped at propose/commit boundaries
