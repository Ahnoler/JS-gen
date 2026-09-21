# Req-draft mount-function column Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the wizard function UI into a read-only recall-candidate column plus a new mount-function select (module leaf functions) that alone drives `functionIdOverrides`.

**Architecture:** Add `listFunctionsUnderModule` in Vue `hierarchy.ts` (system→module→function forest). Refactor `fn-pick.ts` so mount options/defaults/overrides use the module leaf set; recall display is a separate formatter. Wizard loads system tree once, computes module options from left selection / aggregated node, renames the old column, adds the mount column.

**Tech Stack:** Vue 3 + Element Plus (`vue-project`), existing `getSystemTree` / `hierarchy.ts`, `fn-pick.selfcheck.mjs` (Node assert mirror).

**Spec:** [`docs/superpowers/specs/2026-09-11-req-draft-mount-function-column-design.md`](../specs/2026-09-11-req-draft-mount-function-column-design.md) (in JS-gen). **Code primarily in:** `D:\dev\ui-auto-recording-agent-vue-master\vue-project`. Docs/spec updates in JS-gen.

## Global Constraints

- Recall column = read-only display of `suggestedFunctionId` / `functionIdCandidates` (may show `· reason`); does **not** write overrides.
- Mount column options = leaves under current **module** (task-catalog siblings), plain `name` labels — no reason suffix.
- `functionIdOverrides` ← mount pick map only.
- Default mount: suggested ∈ module set → else top candidate ∈ set → else left leaf ∈ set → else empty.
- Do not change JS-gen `computeFunctionIdCandidates`.
- Out: cross-module search, “apply recall → mount” button, SSE/progress UX.
- Commits: Vue repo for code; JS-gen for spec/plan/§6.4 cross-ref (separate commits per repo).

## File map

| File | Responsibility |
|------|----------------|
| `vue-project/src/utils/hierarchy.ts` | `listFunctionsUnderModule(tree, { functionId?, moduleNodeId? }) → {id,name}[]` |
| `vue-project/src/views/ui-recording/req-draft-wizard/fn-pick.ts` | Mount options/default/overrides; recall label helper |
| `vue-project/src/views/ui-recording/req-draft-wizard/fn-pick.selfcheck.mjs` | Mirror + tests |
| `vue-project/src/views/ui-recording/req-draft-wizard/index.vue` | Dual columns; load tree; canCreate |
| `JS-gen/docs/superpowers/specs/2026-09-11-…-design.md` | Status + plan link |
| `JS-gen/docs/superpowers/specs/2026-09-09-req-draft-wizard-function-candidates-design.md` | Cross-ref: mount is separate column |

---

### Task 1: `listFunctionsUnderModule` + selfcheck

**Files:**
- Modify: `D:\dev\ui-auto-recording-agent-vue-master\vue-project\src\utils\hierarchy.ts`
- Create: `D:\dev\ui-auto-recording-agent-vue-master\vue-project\src\utils\hierarchy-module-fns.selfcheck.mjs` (or append to an existing hierarchy selfcheck if one exists — prefer new small file next to hierarchy)

**Interfaces:**
- Consumes: `SystemNode[]` forest (`asSystemForest` shape: system → module → function)
- Produces: `export function listFunctionsUnderModule(tree: SystemNode[], opts: { functionId?: number | null, moduleId?: number | null }): Array<{ id: number, name: string }>`
  - If `moduleId` set: that module’s direct function children (type 3 / leaf children).
  - Else if `functionId` set: find the module that contains this function; return that module’s function children.
  - Else: `[]`.
  - Stable order = tree order; skip non-finite ids.

- [ ] **Step 1: Write failing selfcheck**

```javascript
import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..')
// hierarchy.ts is TS — either duplicate pure JS helper in selfcheck for Task1
// OR compile: prefer implementing the function in a tiny .ts and mirroring logic in selfcheck like fn-pick.selfcheck.mjs

const tree = [
  {
    id: 1, name: 'Sys', type: 1,
    children: [
      {
        id: 10, name: '产品管理', type: 2,
        children: [
          { id: 101, name: '产品阶段管理', type: 3 },
          { id: 102, name: '产品库管理', type: 3 },
          { id: 103, name: '产品要素库', type: 3 },
        ],
      },
      {
        id: 20, name: '其他模块', type: 2,
        children: [{ id: 201, name: '别的功能', type: 3 }],
      },
    ],
  },
]

// After export exists:
assert.deepEqual(
  listFunctionsUnderModule(tree, { functionId: 102 }).map((x) => x.id),
  [101, 102, 103],
)
assert.deepEqual(
  listFunctionsUnderModule(tree, { moduleId: 10 }).map((x) => x.name),
  ['产品阶段管理', '产品库管理', '产品要素库'],
)
assert.deepEqual(listFunctionsUnderModule(tree, { functionId: 999 }), [])
console.log('hierarchy-module-fns selfcheck ok')
```

Because Vite TS may not import from Node without transpile, **mirror the helper as pure JS inside the selfcheck file for assertions, then implement the same algorithm in `hierarchy.ts`** (same pattern as `fn-pick.selfcheck.mjs`). The selfcheck asserts the mirrored logic; Task 1 also adds the real export to `hierarchy.ts` and a one-line comment “keep in sync with hierarchy-module-fns.selfcheck.mjs”.

Alternatively: put the pure function in `hierarchy-module-fns.ts` as plain logic that selfcheck can dynamic-import if the project supports it — prefer **selfcheck mirror + hierarchy.ts export** for consistency with fn-pick.

- [ ] **Step 2: Run selfcheck — expect FAIL** (export / mirror not ready)

Run: `node src/utils/hierarchy-module-fns.selfcheck.mjs`  
(from vue-project root)

- [ ] **Step 3: Implement in `hierarchy.ts` + mirror in selfcheck**

```typescript
/** Functions under the module that contains functionId, or under moduleId directly. */
export function listFunctionsUnderModule(
  tree: SystemNode[],
  opts: { functionId?: number | null; moduleId?: number | null } = {},
): Array<{ id: number; name: string }> {
  const moduleId = opts.moduleId != null && Number.isFinite(Number(opts.moduleId))
    ? Number(opts.moduleId)
    : null
  const functionId = opts.functionId != null && Number.isFinite(Number(opts.functionId))
    ? Number(opts.functionId)
    : null

  for (const sys of tree || []) {
    for (const mod of sys.children || []) {
      const fns = mod.children || []
      if (moduleId != null && Number(mod.id) === moduleId) {
        return fns
          .filter((fn) => Number(fn.type) === 3 || !fn.children?.length)
          .map((fn) => ({ id: Number(fn.id), name: String(fn.name || '') }))
          .filter((x) => Number.isFinite(x.id))
      }
      if (functionId != null && fns.some((fn) => Number(fn.id) === functionId)) {
        return fns
          .map((fn) => ({ id: Number(fn.id), name: String(fn.name || '') }))
          .filter((x) => Number.isFinite(x.id))
      }
    }
  }
  return []
}
```

(Match project’s type conventions: if `type===3` is the leaf flag used elsewhere, filter on that; sidebar uses `nodeType === 3`.)

- [ ] **Step 4: Run selfcheck — PASS**

- [ ] **Step 5: Commit (vue-project)**

```bash
cd D:/dev/ui-auto-recording-agent-vue-master/vue-project
git add src/utils/hierarchy.ts src/utils/hierarchy-module-fns.selfcheck.mjs
git commit -m "feat(hierarchy): list functions under module for draft mount"
```

---

### Task 2: Mount pick helpers (refactor fn-pick)

**Files:**
- Modify: `vue-project/src/views/ui-recording/req-draft-wizard/fn-pick.ts`
- Modify: `vue-project/src/views/ui-recording/req-draft-wizard/fn-pick.selfcheck.mjs`

**Interfaces:**
- Consumes: `DraftAtom`, `moduleFns: Array<{id,name}>`, leftFnId
- Produces:
  - `formatRecallCandidateLabel(atom): string` — best suggested/candidate line for read-only column (e.g. `产品库管理 · page_code` or `—`)
  - `buildMountFunctionOptions(moduleFns): FnOption[]` — `{id, label: name}` only
  - `defaultMountPick(atom, moduleFns, leftFnId): number | undefined` — per spec §4.2
  - `initMountPicks(atoms, moduleFns, leftFnId): Record<string, number>`
  - Keep `buildFunctionIdOverrides(selectedKeys, mountPickByAtomKey)` (rename param conceptually; same signature)
  - **Remove** use of `buildFunctionOptions` for overrides path (can keep temporarily unused or delete if unused after Task 3)

- [ ] **Step 1: Extend selfcheck with mount cases**

```javascript
const moduleFns = [
  { id: 101, name: '产品阶段管理' },
  { id: 102, name: '产品库管理' },
  { id: 103, name: '产品要素库' },
]
const atom = {
  suggestedFunctionId: null,
  functionIdCandidates: [
    { id: 201, name: '别的功能', score: 99, reason: 'menu_path' },
    { id: 102, name: '产品库管理', score: 50, reason: 'page_code' },
  ],
}
assert.equal(defaultMountPick(atom, moduleFns, 101), 102) // top-in-set is 102 not 201
assert.deepEqual(
  buildMountFunctionOptions(moduleFns).map((o) => o.label),
  ['产品阶段管理', '产品库管理', '产品要素库'],
)
assert.match(formatRecallCandidateLabel(atom), /别的功能 · menu_path|产品库管理 · page_code/)
// formatRecall: prefer suggested, else highest score overall for display
```

- [ ] **Step 2: Run — FAIL**

Run: `node src/views/ui-recording/req-draft-wizard/fn-pick.selfcheck.mjs`

- [ ] **Step 3: Implement in `fn-pick.ts` + mirror selfcheck**

```typescript
export function formatRecallCandidateLabel(atom: DraftAtom): string {
  if (atom.suggestedFunctionId != null) {
    const c = (atom.functionIdCandidates || []).find((x) => x.id === atom.suggestedFunctionId)
    if (c) return candidateLabel(c)
    return `功能 ${atom.suggestedFunctionId}`
  }
  const cands = [...(atom.functionIdCandidates || [])].sort((a, b) => b.score - a.score)
  if (cands[0]) return candidateLabel(cands[0])
  return '—'
}

export function buildMountFunctionOptions(
  moduleFns: Array<{ id: number; name: string }>,
): FnOption[] {
  return (moduleFns || [])
    .filter((f) => Number.isFinite(f.id))
    .map((f) => ({ id: f.id, label: f.name || String(f.id) }))
}

export function defaultMountPick(
  atom: DraftAtom,
  moduleFns: Array<{ id: number; name: string }>,
  leftFnId: number | null | undefined,
): number | undefined {
  const allowed = new Set(moduleFns.map((f) => f.id))
  if (atom.suggestedFunctionId != null && allowed.has(atom.suggestedFunctionId)) {
    return atom.suggestedFunctionId
  }
  const cands = [...(atom.functionIdCandidates || [])].sort((a, b) => b.score - a.score)
  for (const c of cands) {
    if (allowed.has(c.id)) return c.id
  }
  if (leftFnId != null && allowed.has(leftFnId)) return leftFnId
  return undefined
}
```

Update `initFnPicks` → `initMountPicks(atoms, moduleFns, leftFnId)` or change `initFnPicks` signature to require `moduleFns`.

- [ ] **Step 4: Selfcheck PASS**

- [ ] **Step 5: Commit (vue-project)**

```bash
git add src/views/ui-recording/req-draft-wizard/fn-pick.ts src/views/ui-recording/req-draft-wizard/fn-pick.selfcheck.mjs
git commit -m "feat(req-draft): mount pick helpers vs recall label"
```

---

### Task 3: Wizard dual columns + tree load

**Files:**
- Modify: `vue-project/src/views/ui-recording/req-draft-wizard/index.vue`

**Interfaces:**
- Consumes: Task 1–2 helpers, `getSystemTree`, `asSystemForest`, appStore selectedFunction / aggregatedNode
- Produces: UI dual columns; `mountPickByAtomKey` (rename from `fnPickByAtomKey` or keep name but semantics = mount); `canCreate` validates pick ∈ module set

- [ ] **Step 1: Manual acceptance checklist in comment (no code) — then implement**

Wire:

```typescript
const systemForest = ref<SystemNode[]>([])
const moduleFns = computed(() => {
  const agg = appStore.aggregatedNode
  if (agg?.id?.startsWith('mod-')) {
    const moduleId = Number(agg.id.slice(4))
    return listFunctionsUnderModule(systemForest.value, { moduleId })
  }
  const fnId = appStore.selectedFunction?.id
  return listFunctionsUnderModule(systemForest.value, { functionId: fnId })
})

onMounted(async () => {
  // existing mounts…
  const res = await getSystemTree({})
  systemForest.value = asSystemForest(res as SystemNode[])
})

// after propose success:
mountPickByAtomKey.value = initMountPicks(allAtoms.value, moduleFns.value, leftFn.value?.id)
```

Template:

```vue
<el-table-column label="召回候选" min-width="180" show-overflow-tooltip>
  <template #default="{ row }">
    {{ formatRecallCandidateLabel(row) }}
  </template>
</el-table-column>

<el-table-column label="挂载功能" min-width="220">
  <template #default="{ row }">
    <el-select
      :model-value="mountPickByAtomKey[row.atomKey]"
      filterable
      clearable
      placeholder="选择挂载功能"
      style="width: 100%"
      :disabled="moduleFns.length === 0"
      @change="(v) => onMountPick(row.atomKey, v)"
    >
      <el-option
        v-for="opt in buildMountFunctionOptions(moduleFns)"
        :key="opt.id"
        :label="opt.label"
        :value="opt.id"
      />
    </el-select>
  </template>
</el-table-column>
```

Update alert copy: remove “左侧功能可为候选预填” confusion; say 挂载列选择模块下功能；召回列为引擎建议。

`canCreate`: each selected key’s pick is finite **and** `moduleFns.some(f => f.id === pick)`.

When `moduleFns` becomes available after tree load and picks empty, optionally re-init empty picks only (do not overwrite user picks).

- [ ] **Step 2: Run fn-pick + hierarchy selfchecks PASS**

- [ ] **Step 3: Commit (vue-project)**

```bash
git add src/views/ui-recording/req-draft-wizard/index.vue
git commit -m "feat(req-draft): dual columns recall vs mount function"
```

---

### Task 4: Docs close-out (JS-gen)

**Files:**
- Modify: `docs/superpowers/specs/2026-09-11-req-draft-mount-function-column-design.md` (status + plan link)
- Modify: `docs/superpowers/specs/2026-09-09-req-draft-wizard-function-candidates-design.md` (note: overrides now from 挂载功能列)
- Modify: `docs/superpowers/agent-log.md` (one line)

- [ ] **Step 1: Edit docs**

- [ ] **Step 2: Commit (JS-gen)**

```bash
cd D:/dev/JS-gen
git add docs/superpowers/specs/2026-09-11-req-draft-mount-function-column-design.md \
  docs/superpowers/specs/2026-09-09-req-draft-wizard-function-candidates-design.md \
  docs/superpowers/plans/2026-09-11-req-draft-mount-function-column.md \
  docs/superpowers/agent-log.md
git commit -m "docs: mount-function column spec/plan close-out"
```

---

## Self-review (plan vs spec)

| Spec | Task |
|------|------|
| §1 dual columns | Task 3 |
| §3 recall read-only / mount select | Task 2–3 |
| §4.1 module leaves | Task 1 |
| §4.2 default order | Task 2 |
| §4.3 canCreate ∈ set | Task 3 |
| §5 §6.4 cross-ref | Task 4 |
| Out backend recall | Not touched |

---

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-09-11-req-draft-mount-function-column.md`.

**Two execution options:**

1. **Subagent-Driven (recommended)** — fresh subagent per task  
2. **Inline Execution** — this session with checkpoints  

Which approach?
