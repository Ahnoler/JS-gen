# Req-Slice → Atomic Draft Trajectories Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** From a sliced `data/kb/req/<moduleKey>/` workspace, propose atomic draft-trajectory candidates (with document+chapter provenance), let a human select `atomKeys`, then commit only those as `draft` trajectories—never auto-record.

**Architecture:** Two APIs under `/api/v2/kb/req-modules/:moduleKey/draft-traj/{propose,commit}`. Propose reads `through-chains.md` + `chapters/` + `source.link.json`, optionally recalls `flows` as soft guardrails, calls an injectable LLM “atomic splitter”, writes a module-local propose cache, and returns selectable atoms. Commit resolves atoms from that cache by `atomKey`, runs `analyzeRequirementToPhases`, then `createTransactionWithPhases`, and persists four provenance columns on `trajectory`. No prepare/record paths.

**Tech Stack:** Node ESM (Express control plane), Knex/MySQL migrations, existing `analyzeRequirementToPhases` / `createTransactionWithPhases`, characterization scripts under `scripts/characterization/`, api-docs catalog `src/dashboard/api-docs/groups/kb.js`.

**Spec:** `docs/superpowers/specs/2026-09-07-req-to-draft-traj-design.md`

## Global Constraints

- Input must be an existing req workspace (`manifest.json` + `through-chains.md`); never generate from raw docx alone.
- Every created draft MUST have non-empty `req_module_key`, `req_source_path`, `req_chapter_ref`, `req_atom_key`.
- Atoms lacking chapter provenance go to `rejected`, never `atoms`.
- Commit creates `recordStatus=draft` only; do **not** call `record/prepare` or `record/start`.
- Granularity = atomic closed loops (login-component scale), not whole business mainchains.
- Default idempotency: same `(req_module_key, req_atom_key)` existing draft → skip unless `force=true`.
- Do not touch `scripts/session_runner.py`, restore `save_section.py`, or implement component mining / batch-push-of-components (future §7).
- New JS public functions need JSDoc (`@param`/`@returns`); `npm run lint` must not introduce new warnings.
- Characterization style: follow `scripts/characterization/characterize-kb-req-modules.mjs` (temp `rootDir`, assert, register in `scripts/refactor/verify-all.sh`).

---

## File map

| Path | Responsibility |
|------|----------------|
| `migrations/20260907120000_trajectory_req_provenance.js` | Add four nullable provenance columns + index |
| `src/dao/trajectory-dao.js` | Persist/read provenance; `findDraftByReqAtomKey` |
| `src/services/req-draft-traj/parse-through-chains.js` | Deterministic parse of chains → step hints |
| `src/services/req-draft-traj/provenance.js` | Resolve sourceDoc/chapter; validate atom provenance |
| `src/services/req-draft-traj/propose-cache.js` | Read/write `.draft-traj-propose.json` under module dir |
| `src/services/req-draft-traj/propose.js` | `proposeDraftTrajectories(moduleKey, opts)` |
| `src/services/req-draft-traj/commit.js` | `commitDraftTrajectories(moduleKey, opts)` |
| `src/services/req-draft-traj/index.js` | Re-exports |
| `scripts/prompts/req-draft-traj-atomize-prompt.md` | Atomic splitter system prompt text |
| `src/routes/v2/kb.js` | Wire propose/commit routes |
| `src/dashboard/api-docs/groups/kb.js` | Catalog the two endpoints |
| `src/services/trajectory/trajectory-meta-service.js` | Accept optional provenance on create |
| `scripts/characterization/characterize-req-draft-traj.mjs` | Offline tests |
| `scripts/characterization/fixtures/req-draft-traj/` | Minimal workspace fixture |
| `scripts/refactor/verify-all.sh` | Register characterize script |

---

### Task 1: Provenance columns + DAO

**Files:**
- Create: `migrations/20260907120000_trajectory_req_provenance.js`
- Modify: `src/dao/trajectory-dao.js` (`save`, `updateMeta` already use `toDbRow`—ensure fields pass through; add finder)
- Test: `scripts/characterization/characterize-req-draft-traj.mjs` (initial cases for finder helpers can wait until Task 2; this task adds a small DAO unit section or migrate dry-check)

**Interfaces:**
- Consumes: Knex `schema.hasColumn` / `table.*`
- Produces:
  - Columns: `req_module_key` VARCHAR(128) NULL, `req_source_path` VARCHAR(1024) NULL, `req_chapter_ref` VARCHAR(512) NULL, `req_atom_key` VARCHAR(191) NULL
  - Index: `(req_module_key, req_atom_key)`
  - `findDraftByReqAtomKey(moduleKey, atomKey) → Promise<object|null>` — first row where those match and `record_status='draft'`

- [ ] **Step 1: Write failing characterization for finder signature (import)**

Create stub test file that imports dao and expects `findDraftByReqAtomKey` to be a function:

```js
// scripts/characterization/characterize-req-draft-traj.mjs (start)
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';

const ROOT = new URL('../../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

const dao = await import(pathToFileURL(join(ROOT, 'src/dao/trajectory-dao.js')).href);
assert.equal(typeof dao.findDraftByReqAtomKey, 'function');
console.log('✓ findDraftByReqAtomKey exported');
```

- [ ] **Step 2: Run to verify fail**

```bash
node scripts/characterization/characterize-req-draft-traj.mjs
```

Expected: FAIL — `findDraftByReqAtomKey` undefined / not a function.

- [ ] **Step 3: Add migration**

```js
/**
 * trajectory: req-slice provenance for draft trajectories generated from KB req workspaces.
 */
export async function up(knex) {
  const has = await knex.schema.hasColumn('trajectory', 'req_atom_key');
  if (has) return;
  await knex.schema.alterTable('trajectory', (t) => {
    t.string('req_module_key', 128).nullable()
      .comment('KB req moduleKey that sourced this draft');
    t.string('req_source_path', 1024).nullable()
      .comment('Requirement doc path/name from source.link.json');
    t.string('req_chapter_ref', 512).nullable()
      .comment('Chapter file + title path inside chapters/');
    t.string('req_atom_key', 191).nullable()
      .comment('Stable atom key from draft-traj propose');
    t.index(['req_module_key', 'req_atom_key'], 'traj_req_atom_idx');
  });
}

export async function down(knex) {
  const has = await knex.schema.hasColumn('trajectory', 'req_atom_key');
  if (!has) return;
  await knex.schema.alterTable('trajectory', (t) => {
    t.dropIndex(['req_module_key', 'req_atom_key'], 'traj_req_atom_idx');
    t.dropColumn('req_module_key');
    t.dropColumn('req_source_path');
    t.dropColumn('req_chapter_ref');
    t.dropColumn('req_atom_key');
  });
}
```

- [ ] **Step 4: Implement DAO finder + save fields**

In `trajectory-dao.js` `save()` insert object, add:

```js
reqModuleKey: trajectory.reqModuleKey ?? null,
reqSourcePath: trajectory.reqSourcePath ?? null,
reqChapterRef: trajectory.reqChapterRef ?? null,
reqAtomKey: trajectory.reqAtomKey ?? null,
```

Add:

```js
/**
 * Find an existing draft trajectory for a req atom (idempotency).
 * @param {string} moduleKey
 * @param {string} atomKey
 * @returns {Promise<object|null>}
 */
export async function findDraftByReqAtomKey(moduleKey, atomKey) {
  const mk = String(moduleKey || '').trim();
  const ak = String(atomKey || '').trim();
  if (!mk || !ak) return null;
  const row = await getDB()(TABLE)
    .where({
      req_module_key: mk,
      req_atom_key: ak,
      record_status: 'draft',
    })
    .orderBy('id', 'desc')
    .first();
  return fromDbRow(row);
}
```

- [ ] **Step 5: Re-run characterization export check**

```bash
node scripts/characterization/characterize-req-draft-traj.mjs
```

Expected: PASS on export assert (DB call tests come later with mocks/skip if no DB).

- [ ] **Step 6: Commit**

```bash
git add migrations/20260907120000_trajectory_req_provenance.js src/dao/trajectory-dao.js scripts/characterization/characterize-req-draft-traj.mjs
git commit -m "feat(traj): add req provenance columns and draft atom finder"
```

---

### Task 2: Fixture + pure parse / provenance helpers

**Files:**
- Create: `scripts/characterization/fixtures/req-draft-traj/demo-mod/manifest.json`
- Create: `scripts/characterization/fixtures/req-draft-traj/demo-mod/source.link.json`
- Create: `scripts/characterization/fixtures/req-draft-traj/demo-mod/through-chains.md`
- Create: `scripts/characterization/fixtures/req-draft-traj/demo-mod/chapters/01-product-library.md`
- Create: `src/services/req-draft-traj/parse-through-chains.js`
- Create: `src/services/req-draft-traj/provenance.js`
- Modify: `scripts/characterization/characterize-req-draft-traj.mjs`

**Interfaces:**
- Consumes: fixture markdown
- Produces:
  - `parseThroughChainsMarkdown(md: string) → { chains: Array<{ chainId: string, title: string, chapterHint: string, steps: Array<{ index: number, action: string, page?: string, zjjk?: string, buttons?: string }> }> }`
  - `buildAtomKey({ moduleKey, chainId, stepIndex, title }) → string` (stable, slug-like)
  - `resolveChapterRef({ chaptersDir, chapterHint, zjjk }) → string|null`
  - `assertAtomProvenance(atom) → { ok: true } | { ok: false, reason: string }` — requires `sourceDoc`, `sourceChapter`, `atomKey`

Fixture `through-chains.md` (minimal):

```markdown
# 视图2：可贯通主链清单（demo-mod）

### 主链 A：产品建库原子示例

- **章节出处**：§产品库管理（ZJJK00110131）

| # | 步骤 | 页面/弹窗 | ZJJK | 关键按钮 |
|---|------|-----------|------|----------|
| 1 | 进入产品库，加载产品树 | 产品库管理主页 | ZJJK00110131 | 【刷新产品树】 |
| 2 | 新增一级分类 | 新增产品弹窗 | ZJJK00094361 | 【新增一级分类】→【确定】 |
| 3 | 选中分类下新增子分类 | 同上 | ZJJK00094361 | 【新增分类】→【确定】 |
```

Chapter file must contain a machine line mentioning `ZJJK00110131` / `ZJJK00094361` and title `产品库管理`.

- [ ] **Step 1: Write failing tests for parse + provenance**

Append to characterize script:

```js
import { readFileSync, cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

const parseMod = await import(pathToFileURL(join(ROOT, 'src/services/req-draft-traj/parse-through-chains.js')).href);
const provMod = await import(pathToFileURL(join(ROOT, 'src/services/req-draft-traj/provenance.js')).href);

const fixtureRoot = join(ROOT, 'scripts/characterization/fixtures/req-draft-traj/demo-mod');
const md = readFileSync(join(fixtureRoot, 'through-chains.md'), 'utf8');
const parsed = parseMod.parseThroughChainsMarkdown(md);
assert.ok(parsed.chains.length >= 1);
assert.equal(parsed.chains[0].steps.length, 3);

const key = parseMod.buildAtomKey({
  moduleKey: 'demo-mod',
  chainId: parsed.chains[0].chainId,
  stepIndex: 2,
  title: parsed.chains[0].steps[1].action,
});
assert.match(key, /^demo-mod:/);

const chapter = await provMod.resolveChapterRef({
  chaptersDir: join(fixtureRoot, 'chapters'),
  chapterHint: parsed.chains[0].chapterHint,
  zjjk: 'ZJJK00094361',
});
assert.ok(chapter && /chapters\//.test(chapter.replace(/\\/g, '/')));

const bad = provMod.assertAtomProvenance({
  atomKey: key,
  sourceDoc: '',
  sourceChapter: chapter,
});
assert.equal(bad.ok, false);
```

- [ ] **Step 2: Run — expect FAIL (module missing)**

```bash
node scripts/characterization/characterize-req-draft-traj.mjs
```

- [ ] **Step 3: Implement parsers**

`parse-through-chains.js` requirements:
- Detect `### 主链 X：…` → `chainId` = slug of heading (e.g. `chain-a`), `title` = full heading text.
- Capture bullet `章节出处` into `chapterHint`.
- Parse markdown tables with headers containing `步骤` / `ZJJK` / `按钮`.
- Ignore optional-only narrative chains without tables if needed; fixture has a table.

`provenance.js`:
- `resolveChapterRef`: scan `chapters/*.md` for ZJJK first; else fuzzy-match `chapterHint` against file contents/filenames; return `chapters/<file>#<title>` or `null`.
- `loadSourceDoc(moduleDir)`: read `source.link.json` → `sourcePath` string.
- `assertAtomProvenance`: all of `atomKey`, `sourceDoc`, `sourceChapter` non-empty trimmed strings.

- [ ] **Step 4: Run tests — expect PASS**

```bash
node scripts/characterization/characterize-req-draft-traj.mjs
```

- [ ] **Step 5: Commit**

```bash
git add scripts/characterization/fixtures/req-draft-traj src/services/req-draft-traj/parse-through-chains.js src/services/req-draft-traj/provenance.js scripts/characterization/characterize-req-draft-traj.mjs
git commit -m "feat(req-draft-traj): parse through-chains and resolve chapter provenance"
```

---

### Task 3: Propose service + cache + atomize prompt

**Files:**
- Create: `scripts/prompts/req-draft-traj-atomize-prompt.md`
- Create: `src/services/req-draft-traj/propose-cache.js`
- Create: `src/services/req-draft-traj/propose.js`
- Create: `src/services/req-draft-traj/index.js`
- Modify: `scripts/characterization/characterize-req-draft-traj.mjs`

**Interfaces:**
- Consumes: `getReqModule` / `moduleDir` from `kb-req-modules.js`; parse + provenance helpers; optional `callLLM`
- Produces:
  - `proposeDraftTrajectories({ moduleKey, rootDir?, chainIds?, maxAtoms?, callLLM? }) → Promise<{ atoms: DraftAtom[], rejected: Array<{ atomKey?: string, reason: string }> }>`
  - `DraftAtom = { atomKey, title, suggestedFunctionId: number|null, sourceDoc, sourceChapter, taskDraft, phaseHints: string[], wetTestHint?: string }`
  - Cache file: `<moduleDir>/.draft-traj-propose.json` = `{ updatedAt, atoms, rejected }`

**Atomicity rule (hard-coded in propose):**
- Prefer **one table step → one atom** when step is a write action (新增/启用/禁用/克隆/保存…).
- Navigation-only steps (进入/加载/刷树) may merge into the next write atom’s `taskDraft` preamble, not separate atoms—unless they are the only step.
- Never emit one atom that covers an entire `主链 A` multi-write table.

Prompt file outline (`req-draft-traj-atomize-prompt.md`):
- Role: 原子化交易拆解助手
- Input: chain JSON + optional flow card snippets
- Output: strict JSON `{ atoms: [{ chainId, stepIndexes, title, taskDraft, phaseHints, suggestedFunctionId }] }`
- Forbid merging multiple write steps; forbid inventing chapters

For characterization, inject `callLLM` that returns a fixed JSON so tests are offline.

- [ ] **Step 1: Failing test — propose on temp copy of fixture**

```js
const { proposeDraftTrajectories } = await import(pathToFileURL(join(ROOT, 'src/services/req-draft-traj/propose.js')).href);
const tmp = mkdtempSync(join(tmpdir(), 'req-draft-'));
cpSync(fixtureRoot, join(tmp, 'demo-mod'), { recursive: true });

const fakeLLM = async () => JSON.stringify({
  atoms: [
    {
      chainId: 'chain-a',
      stepIndexes: [2],
      title: '新增一级分类',
      taskDraft: '1、进入产品库。\n2、点击新增一级分类，名称填「KB测一级」，序号填「1」，确定。\n\n来源：demo.docx / chapters/01-product-library.md\n\n关键数据\n分类名称：KB测一级\n序号：1\n',
      phaseHints: ['进入产品库', '新增一级分类并确定'],
      suggestedFunctionId: 9000000740,
    },
  ],
});

const out = await proposeDraftTrajectories({
  moduleKey: 'demo-mod',
  rootDir: tmp,
  callLLM: fakeLLM,
});
assert.ok(out.atoms.length >= 1);
assert.ok(out.atoms.every((a) => a.sourceDoc && a.sourceChapter && a.atomKey));
assert.ok(!out.atoms.some((a) => !a.sourceChapter));
const cachePath = join(tmp, 'demo-mod', '.draft-traj-propose.json');
assert.ok(existsSync(cachePath));
rmSync(tmp, { recursive: true, force: true });
```

Also assert: missing `through-chains.md` throws / AppError VALIDATION.

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement propose-cache + propose**

`propose.js` flow:
1. `getReqModule({ rootDir, moduleKey })`; if `!hasThroughChains` throw `AppError('through-chains.md required', { code: 'VALIDATION' })`.
2. Read `through-chains.md`, parse chains; filter by `chainIds` if provided.
3. Build LLM user payload from chains (truncate if huge).
4. `callLLM(systemPrompt + user)` (default import `callLLM` from `llm-utils.js`); parse JSON atoms.
5. For each LLM atom: compute `atomKey` via `buildAtomKey`; resolve `sourceDoc` + `sourceChapter`; if provenance fails → `rejected`.
6. Apply `maxAtoms` slice on selectable list.
7. `writeProposeCache(moduleDir, { atoms, rejected })`.
8. Return `{ atoms, rejected }`.

Fallback if LLM fails: **deterministic fallback** — each write step becomes an atom with template `taskDraft` from step action/buttons (still must resolve chapter). Document this in code comment.

- [ ] **Step 4: Run — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add scripts/prompts/req-draft-traj-atomize-prompt.md src/services/req-draft-traj scripts/characterization/characterize-req-draft-traj.mjs
git commit -m "feat(req-draft-traj): propose atomic draft candidates with cache"
```

---

### Task 4: Commit service (analyze → create draft + provenance)

**Files:**
- Create: `src/services/req-draft-traj/commit.js`
- Modify: `src/services/trajectory/trajectory-meta-service.js` (`createTransactionWithPhases` accept provenance)
- Modify: `src/services/req-draft-traj/index.js`
- Modify: `scripts/characterization/characterize-req-draft-traj.mjs`

**Interfaces:**
- Consumes: propose cache; `analyzeRequirementToPhases`; `createTransactionWithPhases`; `findDraftByReqAtomKey`
- Produces:
  - `commitDraftTrajectories({ moduleKey, atomKeys, rootDir?, systemAccountId?, functionIdOverrides?, force?, analyzeFn?, createFn?, findDraftFn? }) → Promise<{ created: Array<{ trajectoryId, atomKey, name }>, skipped: Array<{ atomKey, reason }> }>`
  - Must NOT import or call any `record/prepare` / `record/start` helpers

Extend `createTransactionWithPhases` opts:

```js
reqModuleKey = null,
reqSourcePath = null,
reqChapterRef = null,
reqAtomKey = null,
```

Pass into `trajectoryDao.save({ ... })`.

- [ ] **Step 1: Failing tests**

Cases:
1. Commit unknown `atomKey` → skipped `reason` includes `unknown` or `stale`.
2. Commit with mocked analyze+create → `created[0]` has trajectoryId; createFn receives provenance fields.
3. Second commit same atom without `force` → skipped `duplicate`.
4. Atom missing provenance in cache → skipped (should not happen if cache honest).

```js
const { commitDraftTrajectories } = await import(...);

// seed cache file with one good atom
const created = await commitDraftTrajectories({
  moduleKey: 'demo-mod',
  rootDir: tmp,
  atomKeys: ['demo-mod:chain-a:2:新增一级分类'],
  analyzeFn: async () => ({ phases: ['进入产品库。预期结果：抵达产品库管理页面。', '新增一级分类。预期结果：出现操作成功。'], businessEntries: [{ fieldKey: '分类名称', fieldValue: 'KB测一级' }] }),
  createFn: async (opts) => {
    assert.equal(opts.reqModuleKey, 'demo-mod');
    assert.ok(opts.reqSourcePath);
    assert.ok(opts.reqChapterRef);
    assert.ok(opts.reqAtomKey);
    assert.equal(opts.recordStatus ?? 'draft', 'draft');
    return { id: 4242, name: opts.name };
  },
  findDraftFn: async () => null,
});
assert.equal(created.created[0].trajectoryId, 4242);
```

- [ ] **Step 2: Run — FAIL**

- [ ] **Step 3: Implement commit**

```js
export async function commitDraftTrajectories({
  moduleKey,
  atomKeys,
  rootDir,
  systemAccountId = null,
  functionIdOverrides = {},
  force = false,
  analyzeFn,
  createFn,
  findDraftFn,
} = {}) {
  const keys = Array.isArray(atomKeys) ? atomKeys.map(String) : [];
  const cache = await readProposeCache(moduleDir(moduleKey, rootDir));
  if (!cache?.atoms?.length) {
    throw new AppError('propose cache missing — run draft-traj/propose first', { code: 'VALIDATION' });
  }
  const byKey = new Map(cache.atoms.map((a) => [a.atomKey, a]));
  const analyze = analyzeFn || analyzeRequirementToPhases;
  const create = createFn || createTransactionWithPhases;
  const findDraft = findDraftFn || findDraftByReqAtomKey;

  const created = [];
  const skipped = [];
  for (const atomKey of keys) {
    const atom = byKey.get(atomKey);
    if (!atom) {
      skipped.push({ atomKey, reason: 'unknown_or_stale_atom' });
      continue;
    }
    const prov = assertAtomProvenance(atom);
    if (!prov.ok) {
      skipped.push({ atomKey, reason: prov.reason });
      continue;
    }
    if (!force) {
      const existing = await findDraft(moduleKey, atomKey);
      if (existing) {
        skipped.push({ atomKey, reason: 'duplicate_draft', trajectoryId: existing.id });
        continue;
      }
    }
    let analyzed;
    try {
      analyzed = await analyze({ description: atom.taskDraft });
    } catch (e) {
      skipped.push({ atomKey, reason: `analyze_failed:${e.message}` });
      continue;
    }
    const functionId = functionIdOverrides[atomKey] ?? atom.suggestedFunctionId;
    try {
      const traj = await create({
        functionId: functionId != null ? Number(functionId) : undefined,
        name: atom.title,
        requirement: atom.taskDraft,
        phases: analyzed.phases,
        businessEntries: analyzed.businessEntries,
        systemAccountId,
        requireFunctionId: true,
        reqModuleKey: moduleKey,
        reqSourcePath: atom.sourceDoc,
        reqChapterRef: atom.sourceChapter,
        reqAtomKey: atom.atomKey,
      });
      const trajectoryId = typeof traj === 'number' ? traj : traj.id;
      created.push({ trajectoryId, atomKey, name: atom.title });
    } catch (e) {
      skipped.push({ atomKey, reason: `create_failed:${e.message}` });
    }
  }
  return { created, skipped };
}
```

Wire provenance into `createTransactionWithPhases` → `trajectoryDao.save`.

- [ ] **Step 4: Run — PASS**

- [ ] **Step 5: Commit**

```bash
git add src/services/req-draft-traj/commit.js src/services/req-draft-traj/index.js src/services/trajectory/trajectory-meta-service.js src/dao/trajectory-dao.js scripts/characterization/characterize-req-draft-traj.mjs
git commit -m "feat(req-draft-traj): commit selected atoms to draft trajectories"
```

---

### Task 5: HTTP routes + api-docs + verify-all

**Files:**
- Modify: `src/routes/v2/kb.js`
- Modify: `src/dashboard/api-docs/groups/kb.js`
- Modify: `scripts/refactor/verify-all.sh`
- Modify: `docs/superpowers/todo-list.md` (⑧ point to plan done when implementing—optional at end)
- Modify: `docs/superpowers/agent-log.md` (implementer declares)

**Interfaces:**
- `POST /api/v2/kb/req-modules/:moduleKey/draft-traj/propose`
- `POST /api/v2/kb/req-modules/:moduleKey/draft-traj/commit`

- [ ] **Step 1: Add route handlers**

```js
import * as reqDraftTraj from '../services/req-draft-traj/index.js';
// note: path from src/routes/v2 → ../../services/req-draft-traj/index.js

app.post('/api/v2/kb/req-modules/:moduleKey/draft-traj/propose', asyncHandler(async (req, res) => {
  const { chainIds, maxAtoms } = req.body || {};
  const result = await reqDraftTraj.proposeDraftTrajectories({
    moduleKey: req.params.moduleKey,
    chainIds,
    maxAtoms,
  });
  sendOk(res, result);
}));

app.post('/api/v2/kb/req-modules/:moduleKey/draft-traj/commit', asyncHandler(async (req, res) => {
  const { atomKeys, systemAccountId, functionIdOverrides, force } = req.body || {};
  if (!Array.isArray(atomKeys) || !atomKeys.length) {
    throw new AppError('atomKeys required', { code: 'VALIDATION' });
  }
  const result = await reqDraftTraj.commitDraftTrajectories({
    moduleKey: req.params.moduleKey,
    atomKeys,
    systemAccountId,
    functionIdOverrides,
    force: Boolean(force),
  });
  sendOk(res, result);
}));
```

Update `GROUP_KB.description` to mention draft-traj propose/commit. Add two endpoint entries with req/resp examples matching the spec.

- [ ] **Step 2: Register characterize in verify-all.sh**

Near `characterize-kb-req-modules` line:

```bash
run "characterize-req-draft-traj" node scripts/characterization/characterize-req-draft-traj.mjs
```

- [ ] **Step 3: Run characterization + lint touchpoints**

```bash
node scripts/characterization/characterize-req-draft-traj.mjs
npm run lint
```

Expected: characterize PASS; no new eslint/jsdoc warnings on new files.

- [ ] **Step 4: Manual smoke (optional if control plane up)**

```bash
# after migrate
npx knex migrate:latest --knexfile config/knexfile.js
curl -s -X POST http://localhost:4097/api/v2/kb/req-modules/product-mgmt/draft-traj/propose -H "Content-Type: application/json" -d "{}"
# then commit 1–2 atomKeys from response — expect draft ids; never record
```

- [ ] **Step 5: Commit**

```bash
git add src/routes/v2/kb.js src/dashboard/api-docs/groups/kb.js scripts/refactor/verify-all.sh
git commit -m "feat(api): expose req-module draft-traj propose/commit"
```

---

### Task 6: Ensure GET trajectory returns provenance + wet-check note

**Files:**
- Modify: `src/dao/trajectory-dao.js` / query shaping if any field stripping exists
- Modify: `src/services/trajectory/trajectory-query-service.js` only if it maps columns explicitly
- Docs: short note in `docs/superpowers/specs/2026-09-07-req-to-draft-traj-design.md` status → `计划已就绪` (optional)

- [ ] **Step 1: Grep for trajectory field allowlists**

```bash
rg -n "recordStatus|paasUserId|authKind" src/services/trajectory/trajectory-query-service.js src/dao/helpers.js
```

If `fromDbRow` already camelCases all columns, GET detail should return `reqModuleKey` etc. automatically—add a characterize assert with a mocked row or document smoke check.

- [ ] **Step 2: If stripping exists, add the four fields to the allowlist; write assert**

- [ ] **Step 3: Commit if code changed**

```bash
git commit -m "fix(traj): surface req provenance on trajectory reads"
```

- [ ] **Step 4: Agent-log closeout for implementation wave (when execution finishes)**

Implementer inserts 收工 on `docs/superpowers/agent-log.md` with migration hash + characterize PASS evidence.

---

## Self-review (plan vs spec)

| Spec requirement | Task |
|------------------|------|
| propose/commit two-step API | T5 |
| atoms require sourceDoc + sourceChapter | T2–T3 |
| rejected vs atoms | T3 |
| structured provenance columns | T1, T4 |
| human select then create draft only | T4–T5 |
| no auto record | T4 Global Constraints |
| analyze + create reuse | T4 |
| api-docs catalog | T5 |
| characterization + fixture | T2–T5 |
| idempotent atomKey | T1 finder + T4 |
| functionIdOverrides | T4 |
| future components/push Out | Global Constraints (no task) |
| SPA Out | no task |
| propose cache for stable commit | T3 |

**Placeholder scan:** none intentional.  
**Type consistency:** `DraftAtom.atomKey` / `reqAtomKey` / `findDraftByReqAtomKey` / commit `atomKeys` aligned.

**Gap closed in plan vs earlier ambiguity:** commit reconstructs atoms from **module propose cache** (not re-LLM), matching `{ atomKeys }` body in the spec.

---
