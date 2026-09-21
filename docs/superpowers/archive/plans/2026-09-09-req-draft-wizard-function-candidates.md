# Req-Draft Wizard Function Candidates (§6.4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Per-atom function dropdown on the req-draft wizard candidate table; commit `functionIdOverrides` from row picks (not a single left-nav function id).

**Architecture:** Pure helpers build select options and default picks from `suggestedFunctionId` ∪ `functionIdCandidates` ∪ left-nav function. Wizard holds `fnPickByAtomKey`, seeds it when propose returns, gates `canCreate` on every selected key having a numeric pick, and builds overrides from that map only.

**Tech Stack:** Vue 3 + Element Plus (`vue-project` on `dev`); types in `src/api/kb.ts`. No JS-gen runtime changes. Vue has no unit-test runner — helpers are pure TS verified by a small Node self-check script next to them (plain `.mjs` re-exporting the same logic duplicated OR run via `npx tsx` if available; prefer **duplicate-free**: put helpers in `fn-pick.ts` and a `fn-pick.selfcheck.mjs` that inlines the same algorithms for assert — NO: put helpers only in `.ts` and verify with `vue-tsc`; document manual checklist).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-09-09-req-draft-wizard-function-candidates-design.md` (`8a2e01bd`).
- Parent: kb-remediation §6.4 — show `functionIdCandidates`; commit still `functionIdOverrides`.
- Default pick order: `suggestedFunctionId` → highest-`score` candidate → left `selectedFunction.id` → empty.
- Left nav is a **seed only**; `canCreate` does **not** require `hasSelectedFunction`.
- **Out:** validate endpoint, truncated banner, paasUserId, JS-gen propose/commit, SSE, `kind` column.
- Do not stage `vite.config.ts`, tar.gz, `.playwright-mcp`, or fill/select WIP.
- Commits on Vue `dev`; JS-gen only for docs/agent-log/spec status.

## File map

| File | Responsibility |
|------|----------------|
| `vue-project/src/api/kb.ts` | `FunctionIdCandidate` + `DraftAtom` fields |
| `vue-project/src/views/ui-recording/req-draft-wizard/fn-pick.ts` | Pure option/default/override helpers |
| `vue-project/src/views/ui-recording/req-draft-wizard/index.vue` | Column, state, canCreate, runCommit |
| `JS-gen/docs/.../specs/2026-09-09-...-design.md` | Status → 已实现 when done |
| `JS-gen/docs/superpowers/agent-log.md` | Close-out |

---

### Task 1: Types + `fn-pick` helpers

**Files:**
- Modify: `D:\dev\ui-auto-recording-agent-vue-master\vue-project\src\api\kb.ts`
- Create: `D:\dev\ui-auto-recording-agent-vue-master\vue-project\src\views\ui-recording\req-draft-wizard\fn-pick.ts`

**Interfaces:**
- Produces:
  - `FunctionIdCandidate` type
  - `buildFunctionOptions(atom, leftFn): Array<{ id: number, label: string }>`
  - `defaultFunctionPick(atom, leftFnId): number | undefined`
  - `initFnPicks(atoms, leftFnId): Record<string, number>`
  - `buildFunctionIdOverrides(selectedKeys, fnPickByAtomKey): Record<string, number> | { error: string }`

- [ ] **Step 1: Extend `kb.ts`**

```ts
export interface FunctionIdCandidate {
  id: number
  name: string
  score: number
  reason: 'page_code' | 'name_match' | 'menu_path' | string
}

export interface DraftAtom {
  // ...existing fields...
  functionIdCandidates?: FunctionIdCandidate[]
  kind?: 'write' | 'nav'
}
```

- [ ] **Step 2: Create `fn-pick.ts`**

```ts
import type { DraftAtom, FunctionIdCandidate } from '@/api/kb'

export type LeftFn = { id: number; name: string } | null | undefined

export type FnOption = { id: number; label: string }

function candidateLabel(c: FunctionIdCandidate): string {
  const reason = c.reason ? ` · ${c.reason}` : ''
  return `${c.name}${reason}`
}

/** Options for one atom row select (deduped by id, stable order). */
export function buildFunctionOptions(atom: DraftAtom, leftFn: LeftFn): FnOption[] {
  const out: FnOption[] = []
  const seen = new Set<number>()
  const push = (id: number, label: string) => {
    if (!Number.isFinite(id) || seen.has(id)) return
    seen.add(id)
    out.push({ id, label })
  }

  const cands = [...(atom.functionIdCandidates || [])].sort((a, b) => b.score - a.score)
  const byId = new Map(cands.map((c) => [c.id, c]))

  if (atom.suggestedFunctionId != null) {
    const c = byId.get(atom.suggestedFunctionId)
    push(
      atom.suggestedFunctionId,
      c ? candidateLabel(c) : `功能 ${atom.suggestedFunctionId}`,
    )
  }
  for (const c of cands) {
    push(c.id, candidateLabel(c))
  }
  if (leftFn?.id != null) {
    push(leftFn.id, `左侧：${leftFn.name || leftFn.id}`)
  }
  return out
}

export function defaultFunctionPick(
  atom: DraftAtom,
  leftFnId: number | null | undefined,
): number | undefined {
  if (atom.suggestedFunctionId != null && Number.isFinite(atom.suggestedFunctionId)) {
    return atom.suggestedFunctionId
  }
  const cands = [...(atom.functionIdCandidates || [])].sort((a, b) => b.score - a.score)
  if (cands[0]?.id != null) return cands[0].id
  if (leftFnId != null && Number.isFinite(leftFnId)) return leftFnId
  return undefined
}

export function initFnPicks(
  atoms: DraftAtom[],
  leftFnId: number | null | undefined,
): Record<string, number> {
  const map: Record<string, number> = {}
  for (const atom of atoms) {
    const pick = defaultFunctionPick(atom, leftFnId)
    if (pick != null) map[atom.atomKey] = pick
  }
  return map
}

/** Returns overrides or error if any selected key lacks a finite pick. */
export function buildFunctionIdOverrides(
  selectedKeys: string[],
  fnPickByAtomKey: Record<string, number>,
): { ok: true; overrides: Record<string, number> } | { ok: false; error: string } {
  const overrides: Record<string, number> = {}
  for (const key of selectedKeys) {
    const id = fnPickByAtomKey[key]
    if (id == null || !Number.isFinite(id)) {
      return { ok: false, error: '请为已勾选原子选择功能' }
    }
    overrides[key] = id
  }
  return { ok: true, overrides }
}
```

- [ ] **Step 3: Sanity-check with a one-off Node assert (no Vue runner)**

Create temporary checks by running in shell (PowerShell) importing is hard for TS — instead run:

```bash
cd D:\dev\ui-auto-recording-agent-vue-master\vue-project
npx vue-tsc -b --pretty false 2>&1 | Select-String "fn-pick|kb.ts" 
```

Expected: no errors mentioning these files (pre-existing errors elsewhere OK).

Manually verify logic with a quick mental/table check in the report, OR add `fn-pick.selfcheck.mjs` that copies the three pure functions in plain JS and asserts:

```js
import assert from 'node:assert/strict'
// paste minimal copies of defaultFunctionPick / buildFunctionOptions / buildFunctionIdOverrides
assert.equal(defaultFunctionPick({ suggestedFunctionId: 1, functionIdCandidates: [{ id: 2, name: 'b', score: 99, reason: 'x' }] }, 3), 1)
assert.equal(defaultFunctionPick({ suggestedFunctionId: null, functionIdCandidates: [{ id: 2, name: 'b', score: 10, reason: 'x' }, { id: 9, name: 'a', score: 50, reason: 'y' }] }, 3), 9)
assert.equal(defaultFunctionPick({ suggestedFunctionId: null, functionIdCandidates: [] }, 3), 3)
const o = buildFunctionIdOverrides(['a', 'b'], { a: 1, b: 2 })
assert.equal(o.ok, true)
assert.deepEqual(o.overrides, { a: 1, b: 2 })
console.log('fn-pick selfcheck ok')
```

Prefer: **implement helpers only in `.ts`**, and a **committed** `fn-pick.selfcheck.mjs` with the same algorithm inlined (small) so CI/local can `node …/fn-pick.selfcheck.mjs`. Keep the `.mjs` in the wizard folder.

- [ ] **Step 4: Run selfcheck**

```bash
node D:\dev\ui-auto-recording-agent-vue-master\vue-project\src\views\ui-recording\req-draft-wizard\fn-pick.selfcheck.mjs
```

Expected: `fn-pick selfcheck ok`

- [ ] **Step 5: Commit (Vue `dev`)**

```bash
git add src/api/kb.ts src/views/ui-recording/req-draft-wizard/fn-pick.ts src/views/ui-recording/req-draft-wizard/fn-pick.selfcheck.mjs
git commit -m "feat(req-draft-wizard): functionIdCandidates types + fn-pick helpers"
```

---

### Task 2: Wizard column + canCreate + runCommit

**Files:**
- Modify: `D:\dev\ui-auto-recording-agent-vue-master\vue-project\src\views\ui-recording\req-draft-wizard\index.vue`

**Interfaces:**
- Consumes: `buildFunctionOptions`, `initFnPicks`, `buildFunctionIdOverrides` from `./fn-pick`
- Produces: UI column; `fnPickByAtomKey`; updated `canCreate` / `runCommit`

- [ ] **Step 1: State + seed on propose**

```ts
import { buildFunctionOptions, initFnPicks, buildFunctionIdOverrides } from './fn-pick'

const fnPickByAtomKey = ref<Record<string, number>>({})

const leftFn = computed(() => {
  const f = appStore.selectedFunction
  return f?.id != null ? { id: f.id, name: f.name || String(f.id) } : null
})
```

In `runPropose`, after `allAtoms.value = data.atoms || []` and before `startReveal`:

```ts
fnPickByAtomKey.value = initFnPicks(allAtoms.value, leftFn.value?.id)
```

On empty/error paths, set `fnPickByAtomKey.value = {}`.

Left-nav changes: **do not** rewrite existing picks (spec §4.2 simple rule).

- [ ] **Step 2: Replace `canCreate`**

```ts
const canCreate = computed(() => {
  if (!proposeDone.value || proposing.value) return false
  if (selectedKeys.value.length < 1) return false
  if (!systemAccountId.value) return false
  return selectedKeys.value.every((k) => Number.isFinite(fnPickByAtomKey.value[k]))
})
```

Remove `hasSelectedFunction` from this gate (left is seed only). Keep `functionDisplayName` / tip that left can seed defaults if useful.

- [ ] **Step 3: Add table column** (after title column is fine)

```vue
<el-table-column label="功能" min-width="220">
  <template #default="{ row }">
    <el-select
      :model-value="fnPickByAtomKey[row.atomKey]"
      filterable
      clearable
      placeholder="选择功能"
      style="width: 100%"
      @change="(v: number | undefined) => onFnPick(row.atomKey, v)"
    >
      <el-option
        v-for="opt in buildFunctionOptions(row, leftFn)"
        :key="opt.id"
        :label="opt.label"
        :value="opt.id"
      />
    </el-select>
  </template>
</el-table-column>
```

```ts
function onFnPick(atomKey: string, v: number | undefined) {
  const next = { ...fnPickByAtomKey.value }
  if (v == null || !Number.isFinite(v)) delete next[atomKey]
  else next[atomKey] = v
  fnPickByAtomKey.value = next
}
```

Note: `index.vue` uses blank lines between statements — match local style when editing.

- [ ] **Step 4: Rewrite `runCommit`**

```ts
async function runCommit() {
  if (!selectedKeys.value.length) {
    ElMessage.warning('请至少勾选一个原子')
    return
  }
  if (!systemAccountId.value) {
    ElMessage.warning('当前系统下没有账号，请先在系统管理中添加')
    return
  }
  const built = buildFunctionIdOverrides(selectedKeys.value, fnPickByAtomKey.value)
  if (!built.ok) {
    ElMessage.warning(built.error)
    return
  }
  // remove early return that required appStore.selectedFunction?.id

  committing.value = true
  try {
    const data = await commitDraftTrajectories(moduleKey.value, {
      atomKeys: selectedKeys.value,
      systemAccountId: systemAccountId.value,
      functionIdOverrides: built.overrides,
      force: force.value,
    })
    commitResult.value = data
    step.value = 3
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '创建失败')
  } finally {
    committing.value = false
  }
}
```

Do **not** pass `paasUserId`. Do **not** call validate.

- [ ] **Step 5: Typecheck + static checklist**

```bash
cd D:\dev\ui-auto-recording-agent-vue-master\vue-project
npx vue-tsc -b --pretty false
node src/views/ui-recording/req-draft-wizard/fn-pick.selfcheck.mjs
```

Static checklist (document in commit/report):

1. `runCommit` has no `functionIdOverrides[key] = fnId` loop from left nav alone.  
2. `canCreate` does not reference `hasSelectedFunction`.  
3. No `validate` / `paasUserId` / `truncated` in wizard.

- [ ] **Step 6: Commit (Vue)**

```bash
git add src/views/ui-recording/req-draft-wizard/index.vue
git commit -m "feat(req-draft-wizard): per-atom function select for commit overrides"
```

---

### Task 3: Docs close-out (JS-gen)

**Files:**
- Modify: `docs/superpowers/specs/2026-09-09-req-draft-wizard-function-candidates-design.md` (状态 → 已实现；§6 勾选)
- Modify: `docs/superpowers/agent-log.md`
- Modify: `docs/superpowers/todo-list.md` — mark §6.4 前端派单 done if listed

**Interfaces:** none

- [ ] **Step 1: Flip spec + todo**

Status line: `状态：已实现（Vue commits …）`. Check §6 boxes that code satisfies; leave wet browser smoke unchecked with note.

- [ ] **Step 2: Agent-log 收工**

Note Vue SHAs, Out items still Out, wet smoke = restart 4097 + product-mgmt multi-row different functions.

- [ ] **Step 3: Commit (JS-gen)**

```bash
git add docs/superpowers/specs/2026-09-09-req-draft-wizard-function-candidates-design.md docs/superpowers/agent-log.md docs/superpowers/todo-list.md
git commit -m "docs: close out §6.4 functionIdCandidates wizard UI"
```

---

## Self-review

| Spec | Task |
|------|------|
| Types `functionIdCandidates` | T1 |
| Table dropdown + defaults §3 | T1 helpers + T2 column |
| Overrides per atom | T2 runCommit |
| canCreate without forced left fn | T2 |
| No validate / truncated / paasUserId | T2 Out + checklist |
| canProposeAtoms unchanged | Global |

No TBD placeholders. Dual-repo commits explicit.
