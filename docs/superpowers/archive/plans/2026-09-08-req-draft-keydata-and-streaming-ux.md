# Req-Draft KeyData + Fake-Stream UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop stuffing ZJJK into propose `关键数据`, expose `pageCodes` as structured metadata, and collapse the Vue draft wizard into a 3-step flow with fake-stream candidate reveal + same-page select/commit.

**Architecture:** Backend adds a pure `atom-keydata.js` helper (collect/sanitize page codes + strip ZJJK-only keydata lines from `taskDraft`), wires it in `materializeLlmAtom`, and tightens the atomize prompt. Frontend keeps one HTTP propose, jumps to step 2 immediately, reveals atoms on a timer, and expands each row into steps / business KV / page-code tags. No SSE this release.

**Tech Stack:** Node ESM (JS-gen), characterization scripts, Vue 3 + Element Plus (`vue-project`), existing `/draft-traj/propose|commit` APIs.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-09-08-req-draft-keydata-and-streaming-ux-design.md` (`77989784`).
- **禁止**在「关键数据」下列「大页面 / 基本信息页签 / ZJJK 表格式清单」。
- 「关键数据」仅允许业务可填值、业务规则短句；无则整块省略。
- `pageCodes?: string[]` — 去重、保序；**不进**「关键数据」标题块。
- `phaseHints` 仍可输出；UI 标「预览建议」；**commit 仍以 analyze(taskDraft) 为准**.
- Propose stays **one synchronous HTTP**; fake stream is client-only (80–150ms/row).
- 「创建草稿」requires `selectedKeys.length ≥ 1` **and** propose finished (no create mid-reveal).
- Do **not** implement SSE; do **not** rewrite stock `.draft-traj-propose.json`.
- Dual-repo: JS-gen commits on `uara_V1.2`; Vue commits on `dev`. Do not commit propose-cache JSON.
- Restart 4097 only with user approval after in-process backend changes.

## File map

| File | Responsibility |
|------|----------------|
| `scripts/prompts/req-draft-traj-atomize-prompt.md` | Teach LLM layered keydata + optional `pageCodes` |
| `src/services/req-draft-traj/atom-keydata.js` | Pure collect/sanitize helpers |
| `src/services/req-draft-traj/propose.js` | Call sanitize in `materializeLlmAtom`; typedef `pageCodes` |
| `src/services/req-draft-traj/index.js` | Re-export helpers |
| `scripts/characterization/characterize-atom-keydata.mjs` | Offline pins |
| `scripts/refactor/verify-all.sh` | Register characterization |
| `src/dashboard/api-docs/groups/kb.js` | Document `pageCodes` on propose response |
| `vue-project/src/api/kb.ts` | `pageCodes?: string[]` on `DraftAtom` |
| `vue-project/src/views/ui-recording/req-draft-wizard/atom-display.ts` | Split taskDraft layers + legacy ZJJK detect |
| `vue-project/src/views/ui-recording/req-draft-wizard/index.vue` | 3-step wizard + fake stream + expand panes |
| `docs/superpowers/agent-log.md` | Close-out entry |
| Spec status line | Mark approved / implemented when done |

---

### Task 1: Atomize prompt — keydata rules + `pageCodes`

**Files:**
- Modify: `scripts/prompts/req-draft-traj-atomize-prompt.md`
- Modify: `docs/superpowers/specs/2026-09-08-req-draft-keydata-and-streaming-ux-design.md` (status → 已批准)

**Interfaces:**
- Produces: LLM JSON may include `pageCodes?: string[]` per atom; `taskDraft` 关键数据 rules documented in prompt

- [ ] **Step 1: Update the example atom + rules**

In `req-draft-traj-atomize-prompt.md`, update the sample atom so `taskDraft` puts ZJJK in step parentheses and adds a real business KV under `关键数据`, and add optional `"pageCodes": ["ZJJK00107304"]` on the sample.

Append a new section **「关键数据与页面编号（必须遵守）」** with these four bullets (verbatim intent):

1. 关键数据块只写业务可填值或短规则（`字段：值`）；无业务值时整块省略。
2. 禁止在「关键数据」下列大页面号 / 页签 / ZJJK 表 / 纯 `ZJJKxxxx` 行。
3. ZJJK 优先写在步骤括号内；同时填 `pageCodes`（去重、保序）。
4. `phaseHints` 仅预览建议；commit 仍以 analyze(`taskDraft`) 为准。

Tighten existing rule 5: `taskDraft` = 有序步骤 + 「来源：…」+ **可选**关键数据块（仅业务 KV/规则）。

- [ ] **Step 2: Flip spec status**

In the design doc header, set `状态：已批准（会话 OK）`.

- [ ] **Step 3: Commit (JS-gen)**

```bash
git add scripts/prompts/req-draft-traj-atomize-prompt.md docs/superpowers/specs/2026-09-08-req-draft-keydata-and-streaming-ux-design.md
git commit -m "docs(prompt): ban ZJJK in atomize 关键数据; allow pageCodes"
```

---

### Task 2: `atom-keydata` helpers (TDD)

**Files:**
- Create: `src/services/req-draft-traj/atom-keydata.js`
- Create: `scripts/characterization/characterize-atom-keydata.mjs`
- Modify: `src/services/req-draft-traj/index.js`
- Modify: `scripts/refactor/verify-all.sh`

**Interfaces:**
- Consumes: `extractZjjkCodes` from `./provenance.js`
- Produces:
  - `collectPageCodes({ llmPageCodes?, taskDraft?, zjjkCells? }) → string[]`
  - `sanitizeTaskDraftKeyData(taskDraft) → { taskDraft: string, extractedCodes: string[] }`
  - `isLegacyZjjkOnlyKeyData(taskDraft) → boolean` (for UI / tests; true when 关键数据 body lines are all ZJJK-ish)

- [ ] **Step 1: Write failing characterization**

Create `scripts/characterization/characterize-atom-keydata.mjs`:

```js
#!/usr/bin/env node
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const { collectPageCodes, sanitizeTaskDraftKeyData, isLegacyZjjkOnlyKeyData } = await import(
  pathToFileURL(join(ROOT, 'src/services/req-draft-traj/atom-keydata.js')).href,
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

console.log('characterize-atom-keydata');

await run('collectPageCodes merges llm + draft + cells, dedupes preserve order', () => {
  const out = collectPageCodes({
    llmPageCodes: ['ZJJK00107304', 'zjjk00107304', 'ZJJK00999999'],
    taskDraft: '1、进入主页（ZJJK00111111）。\n关键数据\n分类：A\n',
    zjjkCells: ['ZJJK00107304 / ZJJK00122222', '—'],
  });
  assert.deepEqual(out, [
    'ZJJK00107304',
    'ZJJK00999999',
    'ZJJK00111111',
    'ZJJK00122222',
  ]);
});

await run('sanitize strips ZJJK-only 关键数据 block and returns codes', () => {
  const raw =
    '1、进入产品库。\n\n来源：demo.docx\n\n关键数据\nZJJK00107304\n大页面：ZJJK00136564\n';
  const { taskDraft, extractedCodes } = sanitizeTaskDraftKeyData(raw);
  assert.equal(taskDraft.includes('关键数据'), false);
  assert.deepEqual(extractedCodes, ['ZJJK00107304', 'ZJJK00136564']);
  assert.match(taskDraft, /来源：demo\.docx/);
});

await run('sanitize keeps business KV lines; drops pure ZJJK lines', () => {
  const raw =
    '1、填表。\n\n关键数据\n分类名称：KB测\nZJJK00107304\n序号：1\n';
  const { taskDraft, extractedCodes } = sanitizeTaskDraftKeyData(raw);
  assert.match(taskDraft, /关键数据/);
  assert.match(taskDraft, /分类名称：KB测/);
  assert.match(taskDraft, /序号：1/);
  assert.equal(taskDraft.includes('ZJJK00107304'), false);
  assert.deepEqual(extractedCodes, ['ZJJK00107304']);
});

await run('isLegacyZjjkOnlyKeyData true for ZJJK-only body', () => {
  assert.equal(
    isLegacyZjjkOnlyKeyData('1、x\n\n关键数据\nZJJK00107304\nZJJK00136564\n'),
    true,
  );
  assert.equal(
    isLegacyZjjkOnlyKeyData('1、x\n\n关键数据\n分类名称：A\n'),
    false,
  );
});

if (failed) process.exit(1);
console.log('all passed');
```

- [ ] **Step 2: Run — expect FAIL (module missing)**

```bash
node scripts/characterization/characterize-atom-keydata.mjs
```

Expected: `ERR_MODULE_NOT_FOUND` for `atom-keydata.js`.

- [ ] **Step 3: Implement `atom-keydata.js`**

```js
/**
 * Layer B/C helpers: pageCodes + sanitize 关键数据 (no ZJJK tables in keydata).
 */
import { extractZjjkCodes } from './provenance.js';

const KEYDATA_HEADER_RE = /^(关键数据|业务数据|案例数据|测试数据|预设数据|用例数据)\s*[:：]?$/i;
const ZJJK_LINE_RE = /ZJJK\d{5,}/i;
/** Line is "only" page-code metadata if every token is ZJJK-ish or label noise. */
const PURE_ZJJK_META_RE = /^(?:大页面|页签|页面|组件|编号)?\s*[:：]?\s*(?:ZJJK\d{5,}(?:\s*[\/|,，]\s*ZJJK\d{5,})*)\s*$/i;

/**
 * @param {{ llmPageCodes?: unknown, taskDraft?: string, zjjkCells?: unknown[] }} opts
 * @returns {string[]}
 */
export function collectPageCodes({ llmPageCodes, taskDraft, zjjkCells } = {}) {
  /** @type {string[]} */
  const out = [];
  const seen = new Set();
  const pushAll = (raw) => {
    for (const code of extractZjjkCodes(String(raw || ''))) {
      if (seen.has(code)) continue;
      seen.add(code);
      out.push(code);
    }
  };
  if (Array.isArray(llmPageCodes)) {
    for (const item of llmPageCodes) pushAll(item);
  }
  pushAll(taskDraft);
  if (Array.isArray(zjjkCells)) {
    for (const cell of zjjkCells) pushAll(cell);
  }
  return out;
}

/**
 * @param {string} line
 * @returns {boolean}
 */
function isPureZjjkMetaLine(line) {
  const t = String(line || '').trim();
  if (!t) return false;
  if (PURE_ZJJK_META_RE.test(t)) return true;
  // bare code(s) only
  const codes = extractZjjkCodes(t);
  if (!codes.length) return false;
  const stripped = t.replace(/ZJJK\d{5,}/gi, '').replace(/[\s\/|,，:：\-—_]/g, '');
  return stripped.length === 0;
}

/**
 * Remove ZJJK-only lines from 关键数据; drop empty keydata section.
 * @param {string} taskDraft
 * @returns {{ taskDraft: string, extractedCodes: string[] }}
 */
export function sanitizeTaskDraftKeyData(taskDraft) {
  const lines = String(taskDraft || '').split(/\r?\n/);
  /** @type {string[]} */
  const extractedCodes = [];
  /** @type {string[]} */
  const out = [];
  let inKey = false;
  /** @type {string[]} */
  const keyBuf = [];

  const flushKey = () => {
    const kept = [];
    for (const raw of keyBuf) {
      const t = raw.trim();
      if (!t) {
        kept.push(raw);
        continue;
      }
      if (isPureZjjkMetaLine(t)) {
        for (const c of extractZjjkCodes(t)) {
          if (!extractedCodes.includes(c)) extractedCodes.push(c);
        }
        continue;
      }
      kept.push(raw);
    }
    while (kept.length && !kept[kept.length - 1].trim()) kept.pop();
    const body = kept.filter((l) => l.trim());
    if (body.length === 0) return;
    out.push('关键数据');
    out.push(...kept);
  };

  for (const line of lines) {
    const t = line.trim();
    if (!inKey) {
      if (KEYDATA_HEADER_RE.test(t)) {
        inKey = true;
        keyBuf.length = 0;
        continue;
      }
      out.push(line);
      continue;
    }
    if (/^\d+[\.、\)]\s*/.test(t) || /^来源\s*[:：]/.test(t)) {
      flushKey();
      inKey = false;
      out.push(line);
      continue;
    }
    keyBuf.push(line);
  }
  if (inKey) flushKey();

  let text = out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  if (text) text += '\n';
  return { taskDraft: text, extractedCodes };
}

/**
 * @param {string} taskDraft
 * @returns {boolean}
 */
export function isLegacyZjjkOnlyKeyData(taskDraft) {
  const lines = String(taskDraft || '').split(/\r?\n/);
  let inKey = false;
  /** @type {string[]} */
  const body = [];
  for (const line of lines) {
    const t = line.trim();
    if (!inKey) {
      if (KEYDATA_HEADER_RE.test(t)) inKey = true;
      continue;
    }
    if (/^\d+[\.、\)]\s*/.test(t)) break;
    if (!t) continue;
    body.push(t);
  }
  if (body.length === 0) return false;
  return body.every((l) => isPureZjjkMetaLine(l) || ZJJK_LINE_RE.test(l) && isPureZjjkMetaLine(l));
}
```

Simplify `isLegacyZjjkOnlyKeyData` body check to: every non-empty body line passes `isPureZjjkMetaLine`.

- [ ] **Step 4: Re-export + register verify**

In `index.js` add:

```js
export {
  collectPageCodes,
  sanitizeTaskDraftKeyData,
  isLegacyZjjkOnlyKeyData,
} from './atom-keydata.js';
```

In `verify-all.sh` after `characterize-flow-card-recall`:

```bash
run "characterize-atom-keydata" node scripts/characterization/characterize-atom-keydata.mjs
```

- [ ] **Step 5: Run — expect PASS**

```bash
node scripts/characterization/characterize-atom-keydata.mjs
```

Expected: `all passed`.

- [ ] **Step 6: Commit**

```bash
git add src/services/req-draft-traj/atom-keydata.js src/services/req-draft-traj/index.js \
  scripts/characterization/characterize-atom-keydata.mjs scripts/refactor/verify-all.sh
git commit -m "feat(req-draft): sanitize keydata ZJJK into pageCodes helpers"
```

---

### Task 3: Wire sanitize + `pageCodes` in `materializeLlmAtom`

**Files:**
- Modify: `src/services/req-draft-traj/propose.js` (`DraftAtom` typedef + `materializeLlmAtom`)
- Modify: `scripts/characterization/characterize-req-draft-traj.mjs` (one assert on pageCodes / sanitized draft)
- Modify: `src/dashboard/api-docs/groups/kb.js` (propose respExample)

**Interfaces:**
- Consumes: `collectPageCodes`, `sanitizeTaskDraftKeyData` from `./atom-keydata.js`
- Produces: each accepted `DraftAtom` may include `pageCodes: string[]` (omit or `[]` when empty — prefer omit empty for lean JSON, or always `[]`; **use always array**, may be empty)

- [ ] **Step 1: Extend typedef**

```js
 * @property {string[]} [pageCodes] Ordered unique ZJJK page/component codes (not in 关键数据)
```

- [ ] **Step 2: After filling provenance placeholders, sanitize + attach**

Inside `materializeLlmAtom`, after:

```js
const taskDraft = fillTaskDraftProvenancePlaceholders(rawTaskDraft, sourceDoc, resolvedChapter);
```

replace with:

```js
  const filled = fillTaskDraftProvenancePlaceholders(rawTaskDraft, sourceDoc, resolvedChapter);
  const { taskDraft: cleanedDraft, extractedCodes } = sanitizeTaskDraftKeyData(filled);

  const zjjkCells = [];
  for (const idx of (stepIndexes.length ? stepIndexes : [atomKeyStepIndex])) {
    const st = findStepByIndex(chain, idx);
    if (st?.zjjk) zjjkCells.push(st.zjjk);
  }

  const pageCodes = collectPageCodes({
    llmPageCodes: llmAtom.pageCodes,
    taskDraft: cleanedDraft,
    zjjkCells: [...zjjkCells, ...extractedCodes],
  });

  /** @type {DraftAtom} */
  const atom = {
    atomKey,
    title,
    suggestedFunctionId: parseSuggestedFunctionId(llmAtom.suggestedFunctionId),
    sourceDoc,
    sourceChapter: resolvedChapter,
    taskDraft: cleanedDraft,
    phaseHints: Array.isArray(llmAtom.phaseHints)
      ? llmAtom.phaseHints.map((h) => String(h))
      : [],
    pageCodes,
  };
```

Keep `wetTestHint` / provenance assert as today.

- [ ] **Step 3: Characterization pin**

In an existing propose stub test (or new `runAsync`), assert:

```js
assert.ok(Array.isArray(out.atoms[0].pageCodes));
// When LLM returns 关键数据 with only ZJJK lines, cleaned draft has no 关键数据 header:
assert.equal(out.atoms[0].taskDraft.includes('关键数据\nZJJK'), false);
```

Add a stub LLM atom whose `taskDraft` includes:

```
关键数据
ZJJK00107304
```

and assert `pageCodes` contains `ZJJK00107304` and taskDraft has no that bare line under 关键数据.

- [ ] **Step 4: api-docs**

In propose `respExample` atom, add:

```js
pageCodes: ['ZJJK00107304'],
```

and a note: `pageCodes` 为页面/组件编号元数据；关键数据块不应再堆 ZJJK 表。

- [ ] **Step 5: Run characterizations**

```bash
node scripts/characterization/characterize-atom-keydata.mjs
node scripts/characterization/characterize-req-draft-traj.mjs
```

Expected: both pass.

- [ ] **Step 6: Commit**

```bash
git add src/services/req-draft-traj/propose.js scripts/characterization/characterize-req-draft-traj.mjs \
  src/dashboard/api-docs/groups/kb.js
git commit -m "feat(req-draft): attach pageCodes and sanitize keydata on propose"
```

---

### Task 4: Vue — `DraftAtom.pageCodes` + display helpers

**Files:**
- Modify: `D:\dev\ui-auto-recording-agent-vue-master\vue-project\src\api\kb.ts`
- Create: `D:\dev\ui-auto-recording-agent-vue-master\vue-project\src\views\ui-recording\req-draft-wizard\atom-display.ts`

**Interfaces:**
- Produces:
  - `DraftAtom.pageCodes?: string[]`
  - `splitTaskDraftLayers(taskDraft) → { stepsText: string, businessLines: string[], legacyZjjkOnly: boolean }`
  - `resolvePageCodes(atom) → string[]` (prefer `atom.pageCodes`, else extract from draft)

- [ ] **Step 1: Extend `kb.ts`**

```ts
  /** 页面/组件编号（结构化；不进关键数据正文） */
  pageCodes?: string[]
```

- [ ] **Step 2: Create `atom-display.ts`**

```ts
const KEYDATA_HEADER_RE = /^(关键数据|业务数据|案例数据|测试数据|预设数据|用例数据)\s*[:：]?$/i
const ZJJK_RE = /ZJJK\d{5,}/gi
const PURE_ZJJK_META_RE =
  /^(?:大页面|页签|页面|组件|编号)?\s*[:：]?\s*(?:ZJJK\d{5,}(?:\s*[\/|,，]\s*ZJJK\d{5,})*)\s*$/i

function isPureZjjkMetaLine(line: string): boolean {
  const t = line.trim()
  if (!t) return false
  if (PURE_ZJJK_META_RE.test(t)) return true
  const codes = t.match(ZJJK_RE)
  if (!codes?.length) return false
  const stripped = t.replace(ZJJK_RE, '').replace(/[\s\/|,，:：\-—_]/g, '')
  return stripped.length === 0
}

export function splitTaskDraftLayers(taskDraft: string): {
  stepsText: string
  businessLines: string[]
  legacyZjjkOnly: boolean
} {
  const lines = String(taskDraft || '').split(/\r?\n/)
  const before: string[] = []
  const business: string[] = []
  let inKey = false
  for (const line of lines) {
    const t = line.trim()
    if (!inKey) {
      if (KEYDATA_HEADER_RE.test(t)) {
        inKey = true
        continue
      }
      before.push(line)
      continue
    }
    if (/^\d+[\.、\)]\s*/.test(t)) {
      inKey = false
      before.push(line)
      continue
    }
    if (t) business.push(t)
  }
  const legacyZjjkOnly =
    business.length > 0 && business.every((l) => isPureZjjkMetaLine(l))
  return {
    stepsText: before.join('\n').trim(),
    businessLines: legacyZjjkOnly ? [] : business,
    legacyZjjkOnly,
  }
}

export function resolvePageCodes(atom: {
  pageCodes?: string[]
  taskDraft?: string
}): string[] {
  if (Array.isArray(atom.pageCodes) && atom.pageCodes.length) {
    const seen = new Set<string>()
    const out: string[] = []
    for (const c of atom.pageCodes) {
      const u = String(c || '').toUpperCase()
      if (!u || seen.has(u)) continue
      seen.add(u)
      out.push(u)
    }
    return out
  }
  const found = String(atom.taskDraft || '').match(ZJJK_RE) || []
  const seen = new Set<string>()
  const out: string[] = []
  for (const c of found) {
    const u = c.toUpperCase()
    if (seen.has(u)) continue
    seen.add(u)
    out.push(u)
  }
  return out
}
```

- [ ] **Step 3: Typecheck**

```bash
cd D:\dev\ui-auto-recording-agent-vue-master\vue-project
npx vue-tsc -b --pretty false
```

Expected: no errors from these files (ignore pre-existing unrelated errors if any; fix only what this task introduced).

- [ ] **Step 4: Commit (Vue `dev`)**

```bash
git add src/api/kb.ts src/views/ui-recording/req-draft-wizard/atom-display.ts
git commit -m "feat(req-draft-wizard): pageCodes type + taskDraft layer split helpers"
```

---

### Task 5: Vue — 3-step wizard + fake stream + expand panes

**Files:**
- Modify: `D:\dev\ui-auto-recording-agent-vue-master\vue-project\src\views\ui-recording\req-draft-wizard\index.vue`

**Interfaces:**
- Consumes: `splitTaskDraftLayers`, `resolvePageCodes` from `./atom-display`
- Produces: `step: 1 | 2 | 3`; `visibleAtoms` revealed list; `proposeDone`; `canCreate` gates on proposeDone

**Legacy step mapping (no URL deep-link today):** old 2+3 → new 2; old 4 → new 3. Delete `goToStep3` “下一步到勾选页”; merge selection UI into step 2.

- [ ] **Step 1: State + stream helpers**

```ts
import { splitTaskDraftLayers, resolvePageCodes } from './atom-display'

const step = ref<1 | 2 | 3>(1)
const allAtoms = ref<DraftAtom[]>([]) // full propose payload
const visibleAtoms = ref<DraftAtom[]>([]) // revealed subset
const proposeDone = ref(true)
const proposeError = ref('')
const revealProgress = ref({ i: 0, total: 0 })
let revealTimer: ReturnType<typeof setInterval> | null = null
const REVEAL_MS = 120

function clearRevealTimer() {
  if (revealTimer) {
    clearInterval(revealTimer)
    revealTimer = null
  }
}

function startReveal(list: DraftAtom[]) {
  clearRevealTimer()
  visibleAtoms.value = []
  revealProgress.value = { i: 0, total: list.length }
  if (list.length === 0) {
    proposeDone.value = true
    return
  }
  let idx = 0
  revealTimer = setInterval(() => {
    visibleAtoms.value = list.slice(0, idx + 1)
    idx += 1
    revealProgress.value = { i: idx, total: list.length }
    if (idx >= list.length) {
      clearRevealTimer()
      proposeDone.value = true
    }
  }, REVEAL_MS)
}

const canCreate = computed(
  () =>
    proposeDone.value &&
    !proposing.value &&
    selectedKeys.value.length >= 1 &&
    hasSelectedFunction.value &&
    !!systemAccountId.value,
)
```

On `onBeforeUnmount`, call `clearRevealTimer()`.

- [ ] **Step 2: Rewrite `handleGenerate` / `runPropose` / regenerate**

```ts
async function runPropose(): Promise<'ok' | 'empty' | 'error'> {
  proposing.value = true
  proposeDone.value = false
  proposeError.value = ''
  clearRevealTimer()
  visibleAtoms.value = []
  allAtoms.value = []
  rejected.value = []
  selectedKeys.value = []
  try {
    const data = await proposeDraftTrajectories(moduleKey.value, { maxAtoms: maxAtoms.value })
    allAtoms.value = data.atoms || []
    rejected.value = data.rejected || []
    if (allAtoms.value.length === 0) {
      proposeDone.value = true
      return 'empty'
    }
    // HTTP finished — begin fake stream; create still gated on proposeDone after reveal
    proposing.value = false
    startReveal(allAtoms.value)
    return 'ok'
  } catch (e) {
    proposeError.value = e instanceof Error ? e.message : '生成失败，请重试'
    proposeDone.value = true
    return 'error'
  } finally {
    proposing.value = false
  }
}

async function handleGenerate() {
  if (!canGenerate.value) return
  const key = moduleKey.value
  step.value = 2 // immediate enter candidates page
  const status = await runPropose()
  if (status === 'empty') {
    markModuleNoAtoms(key)
    // stay on step 2 with empty state (spec: 失败留在 step 2)
  }
}

async function handleRegenerate() {
  const key = moduleKey.value
  const status = await runPropose()
  if (status === 'empty') markModuleNoAtoms(key)
}
```

Remove `goToStep3`. After successful commit, `step.value = 3` (was 4).

- [ ] **Step 3: Steps bar + merge panels**

`el-steps` titles: `选作业区` / `候选与勾选` / `结果`.

- Step 1: keep module table; primary button still「生成候选」but calls new `handleGenerate`.
- Step 2: single panel combining former step 2+3:
  - Progress: if `proposing` → indeterminate `el-progress` +「正在生成候选…」; else if `!proposeDone` → `已展示 i / total`; else 100%.
  - Table `:data="visibleAtoms"` with selection column (from old step 3), expand with three sections:

```vue
<template #default="{ row }">
  <div class="atom-expand">
    <div class="atom-expand-section">
      <div class="atom-expand-label">任务草稿</div>
      <pre class="atom-task-draft">{{ splitTaskDraftLayers(row.taskDraft).stepsText }}</pre>
    </div>
    <div
      v-if="splitTaskDraftLayers(row.taskDraft).businessLines.length"
      class="atom-expand-section"
    >
      <div class="atom-expand-label">业务数据</div>
      <ul>
        <li v-for="(line, i) in splitTaskDraftLayers(row.taskDraft).businessLines" :key="i">
          {{ line }}
        </li>
      </ul>
    </div>
    <div
      v-else-if="splitTaskDraftLayers(row.taskDraft).legacyZjjkOnly"
      class="atom-expand-section"
    >
      <div class="atom-expand-label">页面编号（遗留）</div>
      <el-alert type="info" :closable="false" show-icon
        title="关键数据仅含页面编号，建议重新生成候选。" />
    </div>
    <div v-if="resolvePageCodes(row).length" class="atom-expand-section">
      <div class="atom-expand-label">页面编号</div>
      <el-tag v-for="code in resolvePageCodes(row)" :key="code" size="small" class="page-code-tag">
        {{ code }}
      </el-tag>
    </div>
    <div v-if="row.phaseHints?.length" class="atom-expand-section">
      <div class="atom-expand-label">阶段提示（预览建议）</div>
      <!-- existing tags -->
    </div>
  </div>
</template>
```

Prefer a small helper in script to avoid calling `splitTaskDraftLayers` four times per expand (e.g. `layersFor(row)`).

  - Actions: 上一步 → step 1; 重新生成; 创建草稿 (`:disabled="!canCreate"` `:loading="committing"`).
  - Error: `el-alert` when `proposeError`; buttons「返回作业区」「重试」.
- Step 3: former result panel (created/skipped).

Optional CSS: `@keyframes atom-row-in { from { opacity: 0; transform: translateY(6px); } to { … } }` on `.atoms-table .el-table__row`.

- [ ] **Step 4: Manual checklist (dev server)**

1. Open 需求草稿向导 → 选 `product-mgmt` → 点生成：应立刻到「候选与勾选」，先见等待文案，再逐条出现。  
2. 揭示未完时「创建草稿」禁用；完成后勾选可创建。  
3. 展开行：步骤 / 业务数据 / 页面编号分栏；`phaseHints` 带「预览建议」。  
4. 失败：断网或坏 module → 留在 step 2 有错误 + 重试。

- [ ] **Step 5: Commit (Vue)**

```bash
git add src/views/ui-recording/req-draft-wizard/index.vue
git commit -m "feat(req-draft-wizard): 3-step flow with fake-stream candidates"
```

---

### Task 6: Docs close-out

**Files:**
- Modify: `docs/superpowers/agent-log.md`
- Modify: `docs/superpowers/specs/2026-09-08-req-draft-keydata-and-streaming-ux-design.md` (验收勾选 / 状态 → 已实现，若代码已合)

**Interfaces:** none

- [ ] **Step 1: Agent-log entry**

Append a short entry noting plan path, prompt+sanitize+pageCodes, Vue 3-step fake stream, commits SHAs when known.

- [ ] **Step 2: Spec acceptance checkboxes**

Mark §6 items done when wet/manual verify passes; leave unchecked any that wait on user 4097 restart.

- [ ] **Step 3: Commit (JS-gen)**

```bash
git add docs/superpowers/agent-log.md docs/superpowers/specs/2026-09-08-req-draft-keydata-and-streaming-ux-design.md
git commit -m "docs(agent-log): close out keydata + fake-stream UX"
```

---

## Self-review

| Spec requirement | Task |
|------------------|------|
| 关键数据禁 ZJJK 表；仅业务 KV | T1 prompt + T2 sanitize + T3 wire |
| `pageCodes` 结构化 | T2/T3 + T4 types |
| 三步向导 + 假流式 | T5 |
| propose 完成前不可创建 | T5 `canCreate` / `proposeDone` |
| 展开分栏 + 遗留提示 | T5 + `atom-display` |
| 旧四步兼容映射 | T5 (2+3→2, 4→3) |
| 无 SSE / 不清缓存 | Global + Out |
| api-docs | T3 |
| characterization | T2/T3 |

No TBD placeholders; dual-repo commits explicit.
