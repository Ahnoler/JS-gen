# Flow-card-guided draft-traj propose Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `draft-traj/propose` cut atoms by real KB flow-card closed loops (not one write-step = one atom), with write-step fallback when no card matches.

**Architecture:** Before atomize, recall Top-K flow cards for the module’s through-chains; pass card summaries into the LLM prompt and into a deterministic fallback. Materialize allows multiple non-boundary write steps in one atom when `flowRef` is set and steps share one closed loop; stamp `flowGuided` on each atom. Bump propose cache version so old fine-split caches go stale.

**Tech Stack:** Node ESM (`src/services/req-draft-traj/*`), `data/kb/flows/*.json`, characterization via `node scripts/characterization/characterize-req-draft-traj.mjs`, existing `listFlowCardsDetailed` / `matchFlowForAtom`.

**Spec:** [`docs/superpowers/specs/2026-09-09-flow-card-guided-propose-design.md`](../specs/2026-09-09-flow-card-guided-propose-design.md)

## Global Constraints

- Granularity source of truth = flow cards; provenance source of truth = through-chains + chapters (unchanged).
- No card / mapping failure → degrade to write-step atoms with `flowGuided: false` (never silent).
- Do not merge an entire business main chain into one atom by default (multi-card / multi closed-loop → multi atoms).
- Do not expand `taskDraft` into full-card precondition essays (prepare still injects template later).
- Out of scope: SSE propose, Vue fake-stream progress, auto-authoring missing flow cards, “one card = one draft”.
- Commits: JS-gen only unless Vue types need `flowGuided` (optional follow-up; not required for this plan’s DoD).

## File map

| File | Responsibility |
|------|----------------|
| `src/services/req-draft-traj/flow-card-guide.js` | Select Top-K cards; summarize for LLM; detect persist/loop boundaries; optional deterministic card-loop grouping helpers |
| `src/services/req-draft-traj/propose.js` | Wire recall → atomize → materialize; `flowGuided`; relax `multi_write_atom` when card-guided |
| `src/services/req-draft-traj/propose-cache.js` | Bump `PROPOSE_CACHE_VERSION` to `2` |
| `scripts/prompts/req-draft-traj-atomize-prompt.md` | Rules: cut by card closed loops; allow multi-step same loop |
| `scripts/characterization/characterize-req-draft-traj.mjs` | Fixture + asserts for merge + fallback |
| `scripts/characterization/fixtures/req-draft-traj/flow-guide-mod/**` | Mini module + optional tiny flow JSON dir for inject |
| `docs/superpowers/specs/2026-09-09-flow-card-guided-propose-design.md` | Link plan; status → implementing |
| `docs/superpowers/specs/2026-09-07-req-to-draft-traj-design.md` | One-line cross-ref under §3 |

---

### Task 1: `flow-card-guide` helpers + characterization

**Files:**
- Create: `src/services/req-draft-traj/flow-card-guide.js`
- Modify: `scripts/characterization/characterize-req-draft-traj.mjs` (add cases at end of propose section)
- Test: same characterize script

**Interfaces:**
- Consumes: `listFlowCardsDetailed`-shaped card objects (`flow`, `nodes`, `_stem`, keywords, …); through-chain objects `{ chainId, title, steps:[{index,action,zjjk,buttons,page}] }`
- Produces:
  - `selectRelevantFlowCards({ chains, cards, limit = 6 }) → object[]` (cards with `_stem`, ranked)
  - `summarizeCardsForLlm(cards) → object[]` (stem, flow, menu_path, preconditions≤6, nodes with id/page/enter/buttons/fields truncated)
  - `isPersistBoundaryAction(action: string) → boolean` (true for 保存|提交|启用|禁用|克隆|删除 and similar terminal writes — mirror `PERSIST_WRITE_RE` plus enable/disable/clone/delete)
  - `stepsShareClosedLoop({ stepActions: string[], nodeId?: string|null }) → boolean` (true when ≤1 persist-boundary action in the set, or all actions are form/nav before a single trailing persist)

- [ ] **Step 1: Write failing characterize cases**

Append to `characterize-req-draft-traj.mjs`:

```javascript
await runAsync('flow-card-guide selectRelevantFlowCards ranks stem hit', async () => {
  const guide = await import(pathToFileURL(join(ROOT, 'src/services/req-draft-traj/flow-card-guide.js')).href);
  const cards = [
    { _stem: 'other', flow: '其他', keywords: ['无关'], nodes: [] },
    { _stem: 'customer_onboarding', flow: '对公客户建档', keywords: ['信贷潜在客户', '草稿客户'], nodes: [{ id: 'edit_page', page: '编辑页' }] },
  ];
  const chains = [{ chainId: 'a', title: '草稿转信贷潜在', steps: [{ index: 1, action: '维护概况并保存为信贷潜在客户' }] }];
  const hit = guide.selectRelevantFlowCards({ chains, cards, limit: 2 });
  assert.equal(hit[0]._stem, 'customer_onboarding');
});

await runAsync('flow-card-guide stepsShareClosedLoop allows fill+verify+one save', async () => {
  const guide = await import(pathToFileURL(join(ROOT, 'src/services/req-draft-traj/flow-card-guide.js')).href);
  assert.equal(
    guide.stepsShareClosedLoop({
      stepActions: ['进入编辑页', '维护概况', '联网核查', '保存'],
    }),
    true,
  );
  assert.equal(
    guide.stepsShareClosedLoop({
      stepActions: ['保存概况', '提交审批'],
    }),
    false,
  );
});
```

- [ ] **Step 2: Run to verify fail**

Run: `node scripts/characterization/characterize-req-draft-traj.mjs`  
Expected: FAIL — cannot find module `flow-card-guide.js` (or export missing)

- [ ] **Step 3: Implement `flow-card-guide.js`**

```javascript
/**
 * Flow-card selection + closed-loop helpers for draft-traj propose (spec 2026-09-09).
 */
import { matchFlowForAtom } from './flow-card-recall.js';

const PERSIST_BOUNDARY_RE = /保存|提交|启用|禁用|克隆|删除|作废|撤销(?!查询)/;

export function isPersistBoundaryAction(action) {
  return PERSIST_BOUNDARY_RE.test(String(action || ''));
}

export function stepsShareClosedLoop({ stepActions }) {
  const actions = (stepActions || []).map((a) => String(a || '').trim()).filter(Boolean);
  if (actions.length === 0) return false;
  const boundaries = actions.filter((a) => isPersistBoundaryAction(a));
  return boundaries.length <= 1;
}

function chainHaystack(chains) {
  const parts = [];
  for (const c of chains || []) {
    parts.push(c.title, c.chainId);
    for (const s of c.steps || []) {
      parts.push(s.action, s.zjjk, s.page, s.buttons);
    }
  }
  return parts.filter(Boolean).join('\n');
}

export function selectRelevantFlowCards({ chains, cards, limit = 6 }) {
  const list = Array.isArray(cards) ? cards : [];
  const hay = chainHaystack(chains);
  /** @type {Array<{ card: object, score: number }>} */
  const scored = [];
  for (const card of list) {
    const hit = matchFlowForAtom({ title: hay, taskDraft: '', cards: [card] });
    const score = Number(hit.score) || 0;
    if (score > 0) scored.push({ card, score });
  }
  scored.sort((a, b) => b.score - a.score || String(a.card._stem).localeCompare(String(b.card._stem)));
  const out = [];
  const seen = new Set();
  for (const { card } of scored) {
    const stem = card._stem || card.flow;
    if (seen.has(stem)) continue;
    seen.add(stem);
    out.push(card);
    if (out.length >= limit) break;
  }
  return out;
}

export function summarizeCardsForLlm(cards) {
  return (cards || []).map((card) => ({
    flowRef: card._stem || null,
    flow: card.flow,
    menu_path: card.menu_path || '',
    preconditions: (card.preconditions || []).slice(0, 6),
    nodes: (card.nodes || []).map((n) => ({
      id: n.id,
      page: n.page,
      enter: n.enter,
      buttons: (n.buttons || []).slice(0, 12),
      fields: (n.fields || []).slice(0, 16),
    })),
  }));
}
```

Tune `selectRelevantFlowCards` if `matchFlowForAtom` on full haystack is too weak for the fixture — acceptable to also add a simple keyword overlap boost on `card.keywords` / `card.flow` vs haystack.

- [ ] **Step 4: Run characterize — new cases pass**

Run: `node scripts/characterization/characterize-req-draft-traj.mjs`  
Expected: new `flow-card-guide` cases PASS (full file may still be green)

- [ ] **Step 5: Commit**

```bash
git add src/services/req-draft-traj/flow-card-guide.js scripts/characterization/characterize-req-draft-traj.mjs
git commit -m "feat(req-draft): add flow-card-guide helpers for propose cut"
```

---

### Task 2: Bump propose cache version + atom `flowGuided` on materialize path

**Files:**
- Modify: `src/services/req-draft-traj/propose-cache.js` (`PROPOSE_CACHE_VERSION` `1` → `2`)
- Modify: `src/services/req-draft-traj/propose.js` (`DraftAtom` typedef, `materializeLlmAtom`, observation fields)
- Modify: `scripts/characterization/characterize-req-draft-traj.mjs` (assert cacheVersion 2 if any cache-version test exists; add atom field assert in existing fakeLLM propose)

**Interfaces:**
- Consumes: Task 1 helpers (imported in Task 3 wiring; this task only stamps fields + version)
- Produces: `DraftAtom.flowGuided: boolean`; cache files written with `cacheVersion: 2`; commit rejects v1 as `STALE_PROPOSE_CACHE`

- [ ] **Step 1: Write failing assert on cache version constant**

```javascript
run('PROPOSE_CACHE_VERSION is 2 (flow-guided propose)', async () => {
  const { PROPOSE_CACHE_VERSION } = await import(
    pathToFileURL(join(ROOT, 'src/services/req-draft-traj/propose-cache.js')).href
  );
  assert.equal(PROPOSE_CACHE_VERSION, 2);
});
```

(Use sync `run` + top-level await import pattern already used in file, or `runAsync`.)

- [ ] **Step 2: Run — expect FAIL** (`1 !== 2`)

- [ ] **Step 3: Bump version; stamp `flowGuided` in materialize**

In `propose-cache.js`:
```javascript
export const PROPOSE_CACHE_VERSION = 2;
```

In `propose.js` `DraftAtom` typedef add `flowGuided?: boolean`.

In `materializeLlmAtom`, after building `atom`:
```javascript
const flowRef = llmAtom.flowRef != null ? String(llmAtom.flowRef).trim() : '';
const flowGuided = Boolean(flowRef);
atom.flowGuided = flowGuided;
if (flowGuided) {
  atom.suggestedFlowRef = flowRef;
  if (llmAtom.nodeId != null && String(llmAtom.nodeId).trim()) {
    atom.suggestedNodeId = String(llmAtom.nodeId).trim();
  }
}
```

Keep existing post-pass `matchFlowForAtom` for atoms that still lack `suggestedFlowRef` (fallback path), but **do not** set `flowGuided=true` from post-hoc recall alone.

Relax multi-write guard:
```javascript
import { stepsShareClosedLoop, isPersistBoundaryAction } from './flow-card-guide.js';
// ...
if (writeStepCount > 1) {
  const actions = stepIndexes.map((idx) => findStepByIndex(chain, idx)?.action || title);
  const allow = flowRef && stepsShareClosedLoop({ stepActions: actions });
  if (!allow) {
    return { rejected: { atomKey, reason: 'multi_write_atom' } };
  }
}
```
(Compute `flowRef` before this check.)

- [ ] **Step 4: Run characterize — cache version + existing propose cases still PASS**

Run: `node scripts/characterization/characterize-req-draft-traj.mjs`  
Expected: PASS (update any test that hardcoded `cacheVersion: 1` on read)

- [ ] **Step 5: Commit**

```bash
git add src/services/req-draft-traj/propose-cache.js src/services/req-draft-traj/propose.js scripts/characterization/characterize-req-draft-traj.mjs
git commit -m "feat(req-draft): cache v2 + flowGuided on materialized atoms"
```

---

### Task 3: Prompt + `callAtomizeLlm` card injection + propose wiring

**Files:**
- Modify: `scripts/prompts/req-draft-traj-atomize-prompt.md`
- Modify: `src/services/req-draft-traj/propose.js` (`callAtomizeLlm`, `proposeDraftTrajectories`, optional `flowsDir` inject for tests)
- Modify: `scripts/characterization/characterize-req-draft-traj.mjs`

**Interfaces:**
- Consumes: `selectRelevantFlowCards`, `summarizeCardsForLlm`, `listFlowCardsDetailed`
- Produces: LLM user payload `{ chains, flowCards }`; propose opts `{ flowsDir?, listFlowCardsFn? }` for tests; observation `flowGuidedCount` / `fallbackCount`

- [ ] **Step 1: Write failing integrate test (card-guided multi-step accepted)**

Create fixture dir `scripts/characterization/fixtures/req-draft-traj/flow-guide-mod/` with:
- `through-chains.md` — one chain, four steps: 进入编辑页 / 维护概况 / 联网核查 / 保存（信贷潜在客户）
- `source.link.json` — minimal
- `chapters/01.md` — short file so provenance can resolve (match existing demo-mod pattern)

Add tiny flows dir under fixture: `flows/customer_onboarding_mini.json` with `_stem`-able filename `customer_onboarding_mini.json`, keywords including 信贷潜在客户, one node `edit_page`.

Test:
```javascript
await runAsync('propose merges same-loop steps when LLM returns flowRef', async () => {
  const fakeLLM = async (prompt) => {
    assert.match(prompt, /flowCards|customer_onboarding_mini/);
    return JSON.stringify({
      atoms: [{
        chainId: 'chain-a',
        stepIndexes: [1, 2, 3, 4],
        title: '草稿客户转为信贷潜在客户',
        flowRef: 'customer_onboarding_mini',
        nodeId: 'edit_page',
        taskDraft: '1、进入编辑页\n2、维护概况\n3、联网核查\n4、保存\n\n来源：<sourceDoc> / <sourceChapter>\n',
        phaseHints: ['进页', '保存'],
        pageCodes: [],
        suggestedFunctionId: null,
      }],
    });
  };
  const out = await proposeDraftTrajectories({
    moduleKey: 'flow-guide-mod',
    rootDir: /* tmp copy of fixture */,
    callLLM: fakeLLM,
    listSystemsFn: async () => [],
    listFlowCardsFn: async () => [/* load mini card with _stem */],
  });
  assert.equal(out.atoms.length, 1);
  assert.equal(out.atoms[0].flowGuided, true);
  assert.equal(out.atoms[0].suggestedFlowRef, 'customer_onboarding_mini');
  assert.equal(out.rejected.filter((r) => r.reason === 'multi_write_atom').length, 0);
});
```

Also:
```javascript
await runAsync('propose fallback without cards sets flowGuided false', async () => {
  const out = await proposeDraftTrajectories({
    moduleKey: 'demo-mod',
    rootDir: tmpDemo,
    callLLM: async () => { throw new Error('force fallback'); },
    listSystemsFn: async () => [],
    listFlowCardsFn: async () => [],
  });
  assert.ok(out.atoms.length >= 1);
  assert.ok(out.atoms.every((a) => a.flowGuided === false));
});
```

- [ ] **Step 2: Run — expect FAIL** (multi_write still rejects or prompt lacks flowCards)

- [ ] **Step 3: Update prompt**

Replace rules 1–2 / 禁止「不要合并多个写步骤」 with:

```markdown
1. **优先按 flowCards 切原子**：每个 atom ≈ 一张卡上的一段可录制闭环（通常对应一个 node，或「进页→填/核→一次保存/提交」）。
2. **同一闭环内**允许合并多个 through-chains 步骤（含维护/填写/核查 + 一次保存）；`stepIndexes` 列出覆盖序号；必填 `flowRef`（= flowCards[].flowRef / stem），可选 `nodeId`。
3. **禁止**把多张卡或多个独立落库闭环合并进一个 atom；**禁止**无卡依据时把整条主链打成一笔。
4. 若 `flowCards` 为空：回退「一个落库写操作步骤 → 一个 atom」（保存/提交/启用/…）；纯导航/入口-only 并入下一写操作。
```

Keep 关键数据 / pageCodes / 出处占位 rules.

- [ ] **Step 4: Wire propose**

```javascript
async function callAtomizeLlm(chains, moduleKey, llmFn, flowCards = []) {
  const systemPrompt = loadAtomizePrompt();
  const userPayload = JSON.stringify({
    chains: JSON.parse(serializeChainsForLlm(chains).replace(/\n\/\* truncated \*\/$/, '') || '{"chains":[]}'),
    // Safer: change serializeChainsForLlm to return object, or build:
  }, null, 2);
}
```

Prefer refactor:

```javascript
function buildAtomizeUserPayload(chains, flowCards) {
  const chainJson = JSON.parse(serializeChainsForLlm(chains).includes('truncated')
    ? /* keep string path */ 
    : serializeChainsForLlm(chains));
}
```

Simplest robust approach:

```javascript
function buildAtomizeUserPayload(chains, flowCards) {
  let chainsObj = { chains };
  let s = JSON.stringify(chainsObj, null, 2);
  if (s.length > MAX_CHAIN_PAYLOAD_CHARS) {
    // reuse existing trim logic from serializeChainsForLlm — extract shared helper
  }
  return JSON.stringify({ ...chainsObj, flowCards: summarizeCardsForLlm(flowCards) }, null, 2);
}
```

In `proposeDraftTrajectories`:
```javascript
const cards = await (listFlowCardsFn
  ? listFlowCardsFn()
  : listFlowCardsDetailed(flowsDir ? { dir: flowsDir } : {}));
const relevant = selectRelevantFlowCards({ chains, cards, limit: 6 });
// pass relevant into callAtomizeLlm
// on fallback atoms from buildFallbackLlmAtoms: mark flowGuided false when materializing (no flowRef)
```

Extend `proposeDraftTrajectories` params: `listFlowCardsFn`, `flowsDir`.

After materialize loop, ensure every atom has boolean `flowGuided` (default `false`).

Observation append:
```javascript
flowGuidedCount: capped.filter((a) => a.flowGuided).length,
fallbackCount: capped.filter((a) => !a.flowGuided).length,
```

- [ ] **Step 5: Run characterize — all PASS**

Run: `node scripts/characterization/characterize-req-draft-traj.mjs`  
Expected: PASS including new merge + fallback cases

- [ ] **Step 6: Commit**

```bash
git add scripts/prompts/req-draft-traj-atomize-prompt.md src/services/req-draft-traj/propose.js scripts/characterization/characterize-req-draft-traj.mjs scripts/characterization/fixtures/req-draft-traj/flow-guide-mod
git commit -m "feat(req-draft): atomize by flow-card closed loops with no-card fallback"
```

---

### Task 4: Deterministic fallback card-loop merge (optional hardening) + docs close-out

**Files:**
- Modify: `src/services/req-draft-traj/propose.js` (`buildFallbackLlmAtoms` or new `buildCardGuidedFallbackAtoms`)
- Modify: `docs/superpowers/specs/2026-09-09-flow-card-guided-propose-design.md` (status + plan link)
- Modify: `docs/superpowers/specs/2026-09-07-req-to-draft-traj-design.md` §3 one cross-ref line
- Modify: `docs/superpowers/agent-log.md` (short entry)

**Interfaces:**
- Consumes: `selectRelevantFlowCards`, `isPersistBoundaryAction`, `stepsShareClosedLoop`
- Produces: When LLM fails **and** `relevant.length > 0`, group consecutive steps until a persist boundary into one llm-shaped atom with `flowRef` set to best card stem; else existing per-write fallback

- [ ] **Step 1: Failing test — LLM throw + cards present → one merged atom with flowGuided**

```javascript
await runAsync('propose card-guided deterministic fallback merges to persist boundary', async () => {
  const out = await proposeDraftTrajectories({
    moduleKey: 'flow-guide-mod',
    rootDir: tmp,
    callLLM: async () => { throw new Error('force fallback'); },
    listSystemsFn: async () => [],
    listFlowCardsFn: async () => [miniCard],
  });
  assert.equal(out.atoms.length, 1);
  assert.equal(out.atoms[0].flowGuided, true);
});
```

- [ ] **Step 2: Run — expect FAIL** if Task 3 only did LLM path

- [ ] **Step 3: Implement `buildCardGuidedFallbackAtoms(chains, sourceDoc, cards)`**

For each chain, walk steps; accumulate until `isPersistBoundaryAction`; emit one atom with `flowRef: relevant[0]._stem` (or per-step `matchFlowForAtom` best stem); if no persist and only nav, keep old behavior.

Call from `proposeDraftTrajectories` when LLM null/empty **and** `relevant.length > 0`; else `buildFallbackLlmAtoms`.

- [ ] **Step 4: Run full characterize PASS**

- [ ] **Step 5: Docs**

- Spec header: `状态：实现中`；`计划：plans/2026-09-09-flow-card-guided-propose.md`
- `req-to-draft-traj-design.md` §3 add: `> 2026-09-09：有流程卡时改为卡闭环切分，见 specs/2026-09-09-flow-card-guided-propose-design.md`
- agent-log one line

- [ ] **Step 6: Commit**

```bash
git add src/services/req-draft-traj/propose.js docs/superpowers/specs/2026-09-09-flow-card-guided-propose-design.md docs/superpowers/specs/2026-09-07-req-to-draft-traj-design.md docs/superpowers/agent-log.md
git commit -m "feat(req-draft): card-guided deterministic fallback + docs"
```

---

## Self-review (plan vs spec)

| Spec section | Task |
|--------------|------|
| §1 目标 / 同页四步合并 | Task 3 integrate test + Task 4 fallback |
| §2 In prompt/guards/fallback/cache/characterize/docs | Tasks 1–4 |
| §4 流水线召回→atomize→materialize | Task 3 |
| §4.3 multi_write 放宽 | Task 2–3 |
| §5 无卡降级 + 标记 | Task 3 fallback test |
| §6 prepare 注入不变 | No code change (docs note) |
| §7 cacheVersion bump + flowGuided | Task 2 |
| §8 验收 | Characterize + manual wet note in spec |
| Out SSE/Vue | Not in tasks |

Placeholder scan: none intentional beyond fixture “copy demo-mod pattern” — implementer should mirror `scripts/characterization/fixtures/req-draft-traj/demo-mod/` file names exactly when creating `flow-guide-mod`.

---

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-09-09-flow-card-guided-propose.md`.

**Two execution options:**

1. **Subagent-Driven (recommended)** — fresh subagent per task, review between tasks  
2. **Inline Execution** — same session with executing-plans checkpoints  

Which approach?
