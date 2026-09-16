# Atomic Draft TX Split Boundary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `draft-traj/propose` split atoms by independently recordable component boundaries using structured `produces` / `dataDependsOn`, with hard-gates and a revised atomize prompt — no product-tree special cases.

**Architecture:** Add a pure helper module `atom-depend.js` (normalize + batch validate). `propose.js` copies LLM fields onto each `DraftAtom`, then runs batch validation to push self-produce∩depend and dangling-deps into `rejected`, and missing-field soft issues into a new `warnings` array. Revise `req-draft-traj-atomize-prompt.md` to teach the general rules. Offline characterization pins the helper; `verify-all.sh` registers it.

**Tech Stack:** Node ESM (`src/services/req-draft-traj/*.js`), characterization `.mjs` + `node:assert/strict`, `scripts/refactor/verify-all.sh`.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-09-15-atomic-draft-tx-split-boundary-design.md` (approved).
- Hard-reject reasons (exact strings): `self_produce_depend`, `dangling_data_depend`.
- Soft warning reason (exact string): `missing_depend_fields`.
- Do **not** add product-tree / 一级/子分类/产品 keyword force-split.
- Do **not** implement one-confirm-per-atom hard gate (scheme C).
- Do **not** auto-rewrite `produces` from `taskDraft` or change record-time scheduling.
- Keep existing `multi_write_atom` / flow-card closed-loop allow behavior unchanged.
- Branch: work on `uara_V1.2` (or a feature branch off it); small local commits; do not touch unrelated WIP under `config/`.
- Prefer Chinese comments only where neighboring files already use Chinese; code identifiers stay English.

## File map

| File | Role |
|------|------|
| `src/services/req-draft-traj/atom-depend.js` | **Create.** Pure normalize + `validateAtomDependGraph`. |
| `src/services/req-draft-traj/propose.js` | **Modify.** Attach fields on materialize; batch validate; return `warnings`. |
| `src/services/req-draft-traj/index.js` | **Modify only if** public re-exports are required by existing pattern. |
| `scripts/prompts/req-draft-traj-atomize-prompt.md` | **Modify.** Schema + §3 rules; forbid #504 fallback & scene lists. |
| `scripts/characterization/characterize-atom-depend.mjs` | **Create.** Offline pins for helper. |
| `scripts/refactor/verify-all.sh` | **Modify.** Register characterize-atom-depend. |
| `docs/superpowers/specs/2026-09-07-req-to-draft-traj-design.md` | **Modify.** One cross-ref sentence under §3 粒度. |
| `docs/superpowers/specs/2026-09-09-flow-card-guided-propose-design.md` | **Modify.** Note §1 depend rule wins on create-A+create-B conflict. |
| `docs/superpowers/prompt-engineering/atom-depend-split-samples.md` | **Create.** Abstract #675/#676/#678 as produces/depends samples (not tree dogma). |
| `docs/superpowers/agent-log.md` | **Modify.** Short work log on finish. |

---

### Task 1: `atom-depend.js` pure helper (TDD)

**Files:**
- Create: `scripts/characterization/characterize-atom-depend.mjs`
- Create: `src/services/req-draft-traj/atom-depend.js`
- Modify: `scripts/refactor/verify-all.sh` (register after `characterize-atom-keydata` line)

**Interfaces:**
- Consumes: nothing (pure)
- Produces:
  - `normalizeDependKey(raw: unknown): string` — trim; empty → `''`
  - `normalizeProduces(raw: unknown): string[]` — array of non-empty unique keys, first-seen order
  - `normalizeDataDependsOn(raw: unknown): Array<{ key: string, source: 'atom' | 'preset' }>` — string items → `{key, source:'atom'}`; objects use `key`/`name` and `source` (`preset` only if exactly that string, else `atom`); drop empty keys; dedupe by `key` keeping first
  - `validateAtomDependGraph(atoms: Array<{ atomKey?: string, produces?: unknown, dataDependsOn?: unknown }>): { rejected: Array<{ atomKey?: string, reason: string }>, warnings: Array<{ atomKey?: string, reason: string }> }`
    - For each atom: if both fields missing/undefined → warning `missing_depend_fields` (still normalize as empty arrays for graph checks)
    - After normalize: if `produces` ∩ `dataDependsOn.keys` nonempty → reject `self_produce_depend`
    - Build set of all keys produced by any atom
    - For each depend with `source==='atom'`: if key not in produced set → reject `dangling_data_depend`
    - `source==='preset'` never dangling
    - An atom rejected for self_produce still contributes its `produces` to the produced set **only if** we want downstream to resolve — **Spec choice for this plan:** rejected atoms **do not** contribute `produces` to the produced set (safer: broken atom cannot satisfy deps). Implement that.
    - Order: per-atom self check first (and exclude from produced set if rejected), then dangling pass over remaining atoms only
    - Same atomKey may appear once in rejected; if both self and dangling apply, prefer `self_produce_depend` only

- [ ] **Step 1: Write the failing characterization**

Create `scripts/characterization/characterize-atom-depend.mjs`:

```js
#!/usr/bin/env node
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const mod = await import(
  pathToFileURL(join(ROOT, 'src/services/req-draft-traj/atom-depend.js')).href,
);

let failed = 0;
async function run(name, fn) {
  try {
    await fn();
    console.log(`  ok - ${name}`);
  } catch (e) {
    failed += 1;
    console.error(`  FAIL - ${name}: ${e.message}`);
  }
}

console.log('characterize-atom-depend');

await run('normalizeProduces dedupes preserve order', () => {
  assert.deepEqual(mod.normalizeProduces(['一级分类', '一级分类', ' 子分类 ', '', null]), [
    '一级分类',
    '子分类',
  ]);
});

await run('normalizeDataDependsOn strings default source atom', () => {
  assert.deepEqual(mod.normalizeDataDependsOn(['一级分类', { key: '子分类', source: 'preset' }]), [
    { key: '一级分类', source: 'atom' },
    { key: '子分类', source: 'preset' },
  ]);
});

await run('675/676/678 isomorphic chain passes', () => {
  const { rejected, warnings } = mod.validateAtomDependGraph([
    { atomKey: 'a675', produces: ['一级分类'], dataDependsOn: [] },
    { atomKey: 'a676', produces: ['子分类'], dataDependsOn: ['一级分类'] },
    { atomKey: 'a678', produces: ['产品'], dataDependsOn: ['一级分类', '子分类'] },
  ]);
  assert.deepEqual(rejected, []);
  assert.deepEqual(warnings, []);
});

await run('merged L1+child+product self_produce_depend', () => {
  const { rejected } = mod.validateAtomDependGraph([
    {
      atomKey: 'merged',
      produces: ['一级分类', '子分类', '产品'],
      dataDependsOn: ['一级分类', '子分类'],
    },
  ]);
  assert.equal(rejected.length, 1);
  assert.equal(rejected[0].reason, 'self_produce_depend');
  assert.equal(rejected[0].atomKey, 'merged');
});

await run('dangling_data_depend when upstream missing', () => {
  const { rejected } = mod.validateAtomDependGraph([
    { atomKey: 'a678', produces: ['产品'], dataDependsOn: ['一级分类', '子分类'] },
  ]);
  assert.ok(rejected.some((r) => r.reason === 'dangling_data_depend'));
});

await run('preset source skips dangling', () => {
  const { rejected } = mod.validateAtomDependGraph([
    {
      atomKey: 'a676',
      produces: ['子分类'],
      dataDependsOn: [{ key: '一级分类', source: 'preset' }],
    },
  ]);
  assert.deepEqual(rejected, []);
});

await run('missing both fields → warning missing_depend_fields', () => {
  const { rejected, warnings } = mod.validateAtomDependGraph([
    { atomKey: 'legacy', title: 'x' },
  ]);
  assert.deepEqual(rejected, []);
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].reason, 'missing_depend_fields');
});

if (failed) process.exit(1);
console.log('all passed');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node scripts/characterization/characterize-atom-depend.mjs`  
Expected: fail to import / module not found (or missing exports).

- [ ] **Step 3: Write minimal implementation**

Create `src/services/req-draft-traj/atom-depend.js`:

```js
/**
 * Normalize and validate atom produces / dataDependsOn graphs for draft-traj propose.
 * Pure helpers — no I/O.
 */

export function normalizeDependKey(raw) {
  return String(raw ?? '').trim();
}

export function normalizeProduces(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  const seen = new Set();
  for (const item of raw) {
    const key = normalizeDependKey(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}

export function normalizeDataDependsOn(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  const seen = new Set();
  for (const item of raw) {
    let key = '';
    let source = 'atom';
    if (item && typeof item === 'object' && !Array.isArray(item)) {
      key = normalizeDependKey(item.key ?? item.name);
      source = item.source === 'preset' ? 'preset' : 'atom';
    } else {
      key = normalizeDependKey(item);
    }
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({ key, source });
  }
  return out;
}

/**
 * @param {Array<{ atomKey?: string, produces?: unknown, dataDependsOn?: unknown }>} atoms
 * @returns {{ rejected: Array<{ atomKey?: string, reason: string }>, warnings: Array<{ atomKey?: string, reason: string }> }}
 */
export function validateAtomDependGraph(atoms) {
  const list = Array.isArray(atoms) ? atoms : [];
  /** @type {Array<{ atomKey?: string, reason: string }>} */
  const rejected = [];
  /** @type {Array<{ atomKey?: string, reason: string }>} */
  const warnings = [];

  /** @type {Array<{ atomKey?: string, produces: string[], depends: Array<{ key: string, source: string }>, selfRejected: boolean }>} */
  const normalized = [];

  for (const atom of list) {
    const atomKey = atom?.atomKey != null ? String(atom.atomKey) : undefined;
    const hasProduces = Object.prototype.hasOwnProperty.call(atom || {}, 'produces');
    const hasDepends = Object.prototype.hasOwnProperty.call(atom || {}, 'dataDependsOn');
    if (!hasProduces && !hasDepends) {
      warnings.push({ atomKey, reason: 'missing_depend_fields' });
    }
    const produces = normalizeProduces(atom?.produces);
    const depends = normalizeDataDependsOn(atom?.dataDependsOn);
    const produceSet = new Set(produces);
    let selfRejected = false;
    for (const d of depends) {
      if (produceSet.has(d.key)) {
        rejected.push({ atomKey, reason: 'self_produce_depend' });
        selfRejected = true;
        break;
      }
    }
    normalized.push({ atomKey, produces, depends, selfRejected });
  }

  const produced = new Set();
  for (const row of normalized) {
    if (row.selfRejected) continue;
    for (const k of row.produces) produced.add(k);
  }

  for (const row of normalized) {
    if (row.selfRejected) continue;
    for (const d of row.depends) {
      if (d.source === 'preset') continue;
      if (!produced.has(d.key)) {
        rejected.push({ atomKey: row.atomKey, reason: 'dangling_data_depend' });
        break;
      }
    }
  }

  return { rejected, warnings };
}
```

- [ ] **Step 4: Run characterization — expect PASS**

Run: `node scripts/characterization/characterize-atom-depend.mjs`  
Expected: `all passed`

- [ ] **Step 5: Register in verify-all.sh**

In `scripts/refactor/verify-all.sh`, immediately after the line that runs `characterize-atom-keydata`, add:

```bash
run "characterize-atom-depend" node scripts/characterization/characterize-atom-depend.mjs
```

- [ ] **Step 6: Commit**

```bash
git add src/services/req-draft-traj/atom-depend.js \
  scripts/characterization/characterize-atom-depend.mjs \
  scripts/refactor/verify-all.sh
git commit -m "feat(req-draft-traj): validate atom produces/dataDependsOn graph"
```

---

### Task 2: Wire fields + validation into `propose.js`

**Files:**
- Modify: `src/services/req-draft-traj/propose.js`
- Test: extend `scripts/characterization/characterize-atom-depend.mjs` **or** add cases to `characterize-req-draft-traj.mjs` that stub `proposeDraftTrajectories` with injectable `callLLM` — prefer a focused addition in `characterize-atom-depend.mjs` that imports `proposeDraftTrajectories` only if cheap; **this plan uses a thin propose integration pin in the same characterize file** via dynamic import of propose + temp module fixture.

**Interfaces:**
- Consumes: `normalizeProduces`, `normalizeDataDependsOn`, `validateAtomDependGraph` from `./atom-depend.js`
- Produces: `DraftAtom.produces: string[]`, `DraftAtom.dataDependsOn: Array<{key, source}>` (always present after materialize, default `[]`); `proposeDraftTrajectories` return adds `warnings: Array<{atomKey?: string, reason: string}>`

- [ ] **Step 1: Write failing integration pin**

Append to `characterize-atom-depend.mjs` (after helper tests):

```js
await run('propose materialize keeps produces/depends and rejects self_produce batch', async () => {
  // Marker-style pin on propose.js source (fast, no DB): fields + validate call present.
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(join(ROOT, 'src/services/req-draft-traj/propose.js'), 'utf8');
  assert.ok(src.includes("from './atom-depend.js'"));
  assert.ok(src.includes('validateAtomDependGraph'));
  assert.ok(src.includes('self_produce_depend') || src.includes('validateAtomDependGraph('));
  assert.ok(src.includes('warnings'));
});
```

(Full LLM stub integration is optional if marker pin + Task 1 graph tests cover acceptance #2; if you have time, add a second async test that calls `proposeDraftTrajectories` with a temp `through-chains.md` and stub `callLLM` returning one merged atom — only if existing characterize-req-draft-traj already shows the temp-module pattern nearby.)

- [ ] **Step 2: Run pin — expect FAIL** (import / markers missing)

- [ ] **Step 3: Implement wire-up**

1. Add import at top of `propose.js`:

```js
import {
  normalizeProduces,
  normalizeDataDependsOn,
  validateAtomDependGraph,
} from './atom-depend.js';
```

2. Extend `DraftAtom` typedef with:

```js
 * @property {string[]} [produces] Keys this atom newly establishes
 * @property {Array<{ key: string, source: 'atom' | 'preset' }>} [dataDependsOn] Required related-data keys
```

3. In `materializeLlmAtom`, when building `atom`, after `pageCodes` assignment:

```js
atom.produces = normalizeProduces(llmAtom.produces);
atom.dataDependsOn = normalizeDataDependsOn(llmAtom.dataDependsOn);
// Preserve "missing fields" signal for batch warning: if LLM omitted both, mark
if (!Object.prototype.hasOwnProperty.call(llmAtom, 'produces')
    && !Object.prototype.hasOwnProperty.call(llmAtom, 'dataDependsOn')) {
  atom._dependFieldsMissing = true;
}
```

Better: pass through raw presence without private flag — in batch, call `validateAtomDependGraph` on objects shaped as:

```js
{
  atomKey: atom.atomKey,
  produces: Object.prototype.hasOwnProperty.call(llmAtom, 'produces') ? atom.produces : undefined,
  // PROBLEM: llmAtom not available after loop
}
```

**Do this instead:** during materialize, set:

```js
const hasDependFields =
  Object.prototype.hasOwnProperty.call(llmAtom, 'produces')
  || Object.prototype.hasOwnProperty.call(llmAtom, 'dataDependsOn');
atom.produces = normalizeProduces(llmAtom.produces);
atom.dataDependsOn = normalizeDataDependsOn(llmAtom.dataDependsOn);
if (!hasDependFields) {
  // Omit properties so validateAtomDependGraph sees "missing" via hasOwnProperty
  delete atom.produces;
  delete atom.dataDependsOn;
}
```

Wait — then accepted atoms lack fields. Spec wants fields on output. **Final approach:**

```js
atom.produces = normalizeProduces(llmAtom.produces);
atom.dataDependsOn = normalizeDataDependsOn(llmAtom.dataDependsOn);
atom.dependFieldsPresent = (
  Object.prototype.hasOwnProperty.call(llmAtom, 'produces')
  || Object.prototype.hasOwnProperty.call(llmAtom, 'dataDependsOn')
);
```

Then before `validateAtomDependGraph`:

```js
const graphInput = atoms.map((a) => ({
  atomKey: a.atomKey,
  ...(a.dependFieldsPresent
    ? { produces: a.produces, dataDependsOn: a.dataDependsOn }
    : {}),
}));
const dependResult = validateAtomDependGraph(graphInput);
// strip ephemeral flag before cache/return
for (const a of atoms) delete a.dependFieldsPresent;
```

4. After the materialize loop (when `atoms` / `rejected` arrays are filled), **before** maxAtoms capping:

```js
const graphInput = atoms.map((a) => ({
  atomKey: a.atomKey,
  ...(a.dependFieldsPresent
    ? { produces: a.produces, dataDependsOn: a.dataDependsOn }
    : {}),
}));
const dependResult = validateAtomDependGraph(graphInput);
const rejectKeys = new Set(
  dependResult.rejected.map((r) => r.atomKey).filter(Boolean),
);
const kept = [];
for (const a of atoms) {
  if (a.dependFieldsPresent == null) {
    // always delete ephemeral
  }
  if (rejectKeys.has(a.atomKey)) {
    // reason from dependResult
    const reason = dependResult.rejected.find((r) => r.atomKey === a.atomKey)?.reason
      || 'dangling_data_depend';
    rejected.push({ atomKey: a.atomKey, reason });
    continue;
  }
  delete a.dependFieldsPresent;
  kept.push(a);
}
atoms.length = 0;
atoms.push(...kept);
const warnings = dependResult.warnings;
```

Also delete `dependFieldsPresent` on rejected path.

5. Include `warnings` in `writeProposeCache` payload and return value:

```js
return { atoms: capped, rejected, truncated, warnings };
```

Update JSDoc `@returns` accordingly. Default `warnings = []` when empty.

6. Fallback atoms from `buildFallbackLlmAtoms` / `buildCardGuidedFallbackAtoms`: leave without `produces`/`dataDependsOn` on the **llm** objects so they get `dependFieldsPresent=false` → warnings only (spec: degrade + warning).

- [ ] **Step 4: Run** `node scripts/characterization/characterize-atom-depend.mjs` → PASS  
  Also run: `node scripts/characterization/characterize-req-draft-traj.mjs` if it asserts propose return shape — fix only if it breaks on extra `warnings` field (should be backward compatible).

- [ ] **Step 5: Commit**

```bash
git add src/services/req-draft-traj/propose.js \
  scripts/characterization/characterize-atom-depend.mjs
git commit -m "feat(propose): attach produces/dataDependsOn and hard-gate depend graph"
```

---

### Task 3: Revise atomize prompt + samples

**Files:**
- Modify: `scripts/prompts/req-draft-traj-atomize-prompt.md`
- Create: `docs/superpowers/prompt-engineering/atom-depend-split-samples.md`

**Interfaces:** none (docs/prompt only)

- [ ] **Step 1: Update prompt schema example**

In the JSON example atom, add:

```json
"produces": ["一级分类"],
"dataDependsOn": [],
```

And a second illustrative atom in a short comment or second example block is optional; prefer one paragraph of rules.

- [ ] **Step 2: Replace/extend 原子化规则** with these bullets (Chinese, merge with existing non-conflicting rules; **remove any product-tree layer special case if present**):

```markdown
## 拆分边界（必须遵守）

1. 一笔 atom = 一个可独立录制的组件交易：其前置草稿完成后，单独开录应能跑通。
2. 每笔必须输出 `produces`（本笔新确立的关联数据键数组）与 `dataDependsOn`（开录前须已存在的关联数据；字符串或 `{ "key", "source": "atom"|"preset" }`）。
3. **必须拆**：若步骤 B 依赖步骤 A 的 `produces`，则 A、B 不得同一 atom；B 的 `dataDependsOn` 指向 A。
4. **禁止**同一 atom 内「先 produces X，再依赖 X 新建下一步」（自产自依赖）。
5. **允许合入同一笔**：进页/等待加载；搜索/展开/选中已存在的依赖对象；同一次落库闭环内多字段填写 + 一次【确定】。
6. 对 `dataDependsOn` 中的键：新建/修改前先尝试搜索或列表/树定位，再选中，再打开新建/修改入口。
7. **禁止** taskDraft 写「若找不到上游则先新建上游再继续」；缺上游应拆出上游 atom 或 `source: "preset"`。
8. **禁止**按具体业务场景清单强制拆笔（例如产品树每一层）；只使用上述依赖规则。
9. 有 flowCards 时优先参考卡上可录闭环；若卡把「造 A + 造依赖 A 的 B」画在同一闭环，仍须拆成两笔并用 `dataDependsOn` 串联。
10. `taskDraft` 文末「关键数据」KV 键名须与 `produces` / `dataDependsOn` 一致。
```

Keep existing rules that do not conflict: no system menu nav; no inventing chapter paths; JSON-only output; ZJJK not in 关键数据; etc.

- [ ] **Step 3: Write samples file**

Create `docs/superpowers/prompt-engineering/atom-depend-split-samples.md` summarizing #675/#676/#678 as three atoms with produces/depends tables and one anti-example (#504 create-parent fallback + merged produces∩depends). Explicit note: examples illustrate **depend graph**, not “tree layers must split”.

- [ ] **Step 4: Commit**

```bash
git add scripts/prompts/req-draft-traj-atomize-prompt.md \
  docs/superpowers/prompt-engineering/atom-depend-split-samples.md
git commit -m "docs(prompt): atomize split by produces/dataDependsOn bounds"
```

---

### Task 4: Spec cross-refs + agent-log + verify

**Files:**
- Modify: `docs/superpowers/specs/2026-09-07-req-to-draft-traj-design.md`
- Modify: `docs/superpowers/specs/2026-09-09-flow-card-guided-propose-design.md`
- Modify: `docs/superpowers/specs/2026-09-15-atomic-draft-tx-split-boundary-design.md` (status → 已审阅/实现中)
- Modify: `docs/superpowers/agent-log.md`

- [ ] **Step 1: Cross-ref 2026-09-07 §3**

After the bullet about 原子闭环, add:

```markdown
- 拆分边界以 `produces` / `dataDependsOn` 依赖规则为准（见 `2026-09-15-atomic-draft-tx-split-boundary-design.md`）；禁止场景特例清单。
```

- [ ] **Step 2: Cross-ref 2026-09-09**

In the section on 单卡单闭环 / multi_write allow, add:

```markdown
- 若同一闭环内包含「造 A + 造依赖 A 的 B」，仍须拆成两笔 atom，并用 `dataDependsOn` 串联（依赖规则优先于卡闭环合并）。
```

- [ ] **Step 3: Flip spec status header** to `状态：已审阅；实现按 2026-09-16 plan`

- [ ] **Step 4: Run verification**

```bash
node scripts/characterization/characterize-atom-depend.mjs
node scripts/characterization/characterize-atom-keydata.mjs
```

Expected: both `all passed` / OK.

- [ ] **Step 5: Agent-log + commit**

```bash
git add docs/superpowers/specs/2026-09-07-req-to-draft-traj-design.md \
  docs/superpowers/specs/2026-09-09-flow-card-guided-propose-design.md \
  docs/superpowers/specs/2026-09-15-atomic-draft-tx-split-boundary-design.md \
  docs/superpowers/agent-log.md
git commit -m "docs: cross-ref atom depend split boundary; note implement plan"
```

---

## Spec coverage checklist (plan self-review)

| Spec requirement | Task |
|------------------|------|
| produces / dataDependsOn fields | T1–T2 |
| must-split on depend / self_produce hard gate | T1–T2 |
| dangling + preset | T1 |
| missing fields warning | T1–T2 |
| no product-tree force-split | T3 |
| search-before-write in prompt | T3 |
| #504 forbid | T3 |
| flowCards advisory; §1 wins | T3–T4 |
| soft multi-persist only (no C hard gate) | Global — not implemented as hard gate; existing `multi_write_atom` unchanged |
| characterization pins | T1 |
| verify-all register | T1 |
| no runtime scheduling / auto-rewrite produces | Global — omitted |

## Placeholder scan

None intentional. Integration pin in Task 2 uses source markers; optional full stub noted as optional only if time — acceptance #2 is covered by graph fixture tests in Task 1.

---

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-09-16-atomic-draft-tx-split-boundary.md`. Two execution options:

**1. Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks  
**2. Inline Execution** — execute tasks in this session with executing-plans checkpoints  

Which approach?
