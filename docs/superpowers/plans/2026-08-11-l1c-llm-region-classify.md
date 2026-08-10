# L1c LLM Region Classify (+ L1d) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Control-plane `classifyRegions(cards, { systemId })` upgrades low-confidence / `other`/`custom:*` L1 labels via feature-card LLM JSON, with L1d signature cache; wire into resolve-element and expose HTTP for scan/summary consumers — never drop L2/matches.

**Architecture:** CDP emits L1b feature cards next to `assignRegion`. Node service applies rules → L1d lookup → optional batched `callLLM` when `L1C_LLM=true` and trigger fires → writes role/label/confidence back. Resolve post-processes snaps before response. Scan/agent calls `POST /api/v2/regions/classify` (same service). L1d = in-process TTL map (no MySQL in this cut).

**Tech Stack:** `src/cdp/page-locator-helpers.js`, `src/services/region-classify.js`, `src/llm-utils.js` (`callLLM`), resolve-by-label / trajectory-record-lifecycle, Express route, characterization `.mjs`, `config/.env.example`.

**Spec:** `docs/superpowers/specs/2026-08-10-l1c-llm-region-classify-design.md`

## Global Constraints

- Control plane only (not Agent tool as primary; not executor-embedded LLM).
- Trigger: `confidence < 0.7` **or** `role` is `other` or starts with `custom:`.
- Consumers: resolve-element **and** scan via shared service (+ HTTP for Python).
- Sync classify before return; include L1d in this cut.
- Path 甲: shared `classifyRegions(cards, { systemId })`.
- Algorithm **B**: failure/timeout/bad JSON must **not** drop L2 / matches.
- `L1C_LLM` default **false** → rules + L1d read only (no outbound chat).
- Never send raw HTML or full-page screenshots to the model.
- Batch cap **12** cards per LLM call.
- Seed roles: `shell-header|shell-aside|shell-tabs|main|section|table|overlay|menu|custom:*|page|other`.
- L1d key: `systemId` + hash(normalized classTokens+title+band+flags+childCounts).
- L1d storage this cut: **in-memory TTL Map** (not MySQL).
- TDD: characterization fail → implement → green.
- Commit only if user asks.
- CHANGELOG `[Unreleased]` for env / new route / classify semantics (Python sync tip).

## File map

| File | Role |
|------|------|
| `src/cdp/page-locator-helpers.js` | `buildFeatureCard(el)` + attach on region/snap; sync Python helpers |
| `src/services/region-classify.js` | `featureSignature`, rules refine, L1d cache, `classifyRegions`, LLM batch |
| `src/routes/v2/regions-classify.js` (or under trajectory) | `POST /api/v2/regions/classify` |
| `src/cdp/resolve-by-label.js` / lifecycle | After CDP snaps, classify cards, patch `region_*` |
| `config/config.js` + `.env.example` | `L1C_LLM`, optional `L1C_LLM_TIMEOUT_MS` |
| `scripts/characterization/characterize-l1c-region-classify.mjs` | Char |
| `CHANGELOG.md` | Unreleased |
| `src/dashboard/api-docs/...` | Document classify endpoint |
| Optional: Python scan caller | Best-effort POST cards when CP reachable (Task 5) |

```text
CDP snaps (+ feature_card)
  → classifyRegions(cards, { systemId })
  → patch region_role / region_label / confidence
  → resolve response / scan summary
```

---

### Task 1: Characterization — L1c cues

**Files:**
- Create: `scripts/characterization/characterize-l1c-region-classify.mjs`
- Test: same

**Interfaces:**
- Consumes: sources of helpers + future `region-classify.js`
- Produces: RED until Tasks 2–3

- [ ] **Step 1: Write failing characterization**

```js
/**
 * Characterize L1c region classify (+ L1d).
 *   node scripts/characterization/characterize-l1c-region-classify.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const helpers = readFileSync(join(root, 'src/cdp/page-locator-helpers.js'), 'utf8');
function ok(n) { console.log(`ok: ${n}`); }

{
  assert.match(helpers, /function buildFeatureCard\s*\(/);
  assert.match(helpers, /feature_card|featureCard/);
  assert.match(helpers, /childCounts|classTokens/);
  ok('helpers: feature card API');
}

{
  const p = join(root, 'src/services/region-classify.js');
  assert.equal(existsSync(p), true);
  const src = readFileSync(p, 'utf8');
  assert.match(src, /export async function classifyRegions\s*\(/);
  assert.match(src, /featureSignature|L1d|l1dCache/);
  assert.match(src, /L1C_LLM|l1cLlm/);
  assert.match(src, /0\.7/);
  assert.match(src, /custom:/);
  ok('service: classifyRegions + trigger + cache cues');
}

console.log('characterize-l1c-region-classify: ok');
```

- [ ] **Step 2: Run — expect FAIL**

```bash
node scripts/characterization/characterize-l1c-region-classify.mjs
```

- [ ] **Step 3: Commit** (only if user asks)

---

### Task 2: CDP `buildFeatureCard`

**Files:**
- Modify: `src/cdp/page-locator-helpers.js`
- Modify: `scripts/controller/actions/js_snippets/_locator_helpers_js.py` (regen via `_gen_locator_helpers_py.mjs` if that is repo convention)
- Test: Task 1 helper asserts

**Interfaces:**
- Produces (page-side): `buildFeatureCard(el) → { tag, classTokens, title, band, childCounts, flags, ruleRole, ruleConfidence }`
- Attach on `assignRegion` / `buildLocatorSnap` output as `feature_card` (snake) for Node
- Truncate: title ≤ 80 chars; classTokens ≤ 12
- `band` from getBoundingClientRect vs viewport thirds
- `ruleRole`/`ruleConfidence`: reuse current `assignRegion` result (confidence 0.9 for shell/main/section/table/overlay; 0.4 for `other`)

- [ ] **Step 1: Implement `buildFeatureCard` in PAGE_LOCATOR_HELPERS** near `SHARED_ASSIGN_REGION`

Sketch:

```js
function buildFeatureCard(el, regionHint) {
  var region = regionHint || assignRegion(el);
  var cls = String((el.getAttribute && el.getAttribute('class')) || '').trim();
  var classTokens = cls.split(/\s+/).filter(Boolean).slice(0, 12);
  var title = cleanVisibleText(
    (el.getAttribute && (el.getAttribute('aria-label') || el.getAttribute('title'))) || ''
  ).slice(0, 80);
  // optional: nearest titled panel title
  var rect = el.getBoundingClientRect();
  var cy = rect.top + rect.height / 2;
  var vh = window.innerHeight || 800;
  var band = cy < vh * 0.25 ? 'top' : (cy > vh * 0.75 ? 'bottom' : (rect.left < 120 ? 'side' : 'center'));
  var childCounts = { button: 0, input: 0, menu: 0 };
  // cheap query within el for counts (cap query)
  var conf = region.region_role === 'other' ? 0.4 : 0.9;
  return {
    tag: (el.tagName || '').toLowerCase(),
    classTokens: classTokens,
    title: title,
    band: band,
    childCounts: childCounts,
    flags: {
      overlay: region.region_role === 'overlay',
      tableLike: region.region_role === 'table',
      menuLike: region.region_role === 'shell-aside' || region.region_role === 'menu',
      titledPanel: !!title,
    },
    ruleRole: region.region_role,
    ruleConfidence: conf,
  };
}
```

Include `feature_card` on snap / region objects returned to Node.

- [ ] **Step 2: Sync Python dual helpers**
- [ ] **Step 3: Re-run char — helper block PASS, service still FAIL**
- [ ] **Step 4: Commit** (if user asks)

---

### Task 3: `region-classify.js` service + unit-style char

**Files:**
- Create: `src/services/region-classify.js`
- Modify: `config/config.js`, `config/.env.example`
- Modify: characterization to import and exercise pure functions
- Test: `node scripts/characterization/characterize-l1c-region-classify.mjs`

**Interfaces:**
- Produces:
  - `featureSignature(card) → string`
  - `shouldLlmClassify(card) → boolean`
  - `classifyRegions(cards, { systemId }) → Promise<Array<{ ...card, role, label, confidence, source }>>`
  - In-memory L1d: `Map` key `${systemId}:${signature}`, TTL default 3600s
- Consumes: `callLLM` from `src/llm-utils.js`; `L1C_LLM` from config

- [ ] **Step 1: Config**

```js
// config/config.js
export const L1C_LLM = String(process.env.L1C_LLM || 'false').toLowerCase() === 'true';
export const L1C_LLM_TIMEOUT_MS = Number(process.env.L1C_LLM_TIMEOUT_MS || 8000) || 8000;
```

`.env.example`:
```
# L1c: low-confidence region classify via LLM (default off)
# L1C_LLM=false
# L1C_LLM_TIMEOUT_MS=8000
```

- [ ] **Step 2: Implement service**

```js
import { createHash } from 'node:crypto';
import { callLLM } from '../llm-utils.js';
import { L1C_LLM, L1C_LLM_TIMEOUT_MS } from '../../config/config.js';

const SEED = new Set(['shell-header','shell-aside','shell-tabs','main','section','table','overlay','menu','page','other']);
const cache = new Map(); // key -> { value, exp }

export function featureSignature(card = {}) {
  const payload = JSON.stringify({
    classTokens: card.classTokens || [],
    title: String(card.title || '').trim(),
    band: card.band || '',
    flags: card.flags || {},
    childCounts: card.childCounts || {},
  });
  return createHash('sha256').update(payload).digest('hex').slice(0, 32);
}

export function shouldLlmClassify(card = {}) {
  const role = String(card.ruleRole || card.role || 'other');
  const conf = Number(card.ruleConfidence ?? card.confidence ?? 0);
  if (conf < 0.7) return true;
  if (role === 'other' || role.startsWith('custom:')) return true;
  return false;
}

export async function classifyRegions(cards = [], { systemId = '' } = {}) {
  const sid = String(systemId || '');
  const out = [];
  const needLlm = [];
  for (const raw of cards) {
    const card = { ...raw };
    const sig = featureSignature(card);
    const ck = `${sid}:${sig}`;
    const hit = cacheGet(ck);
    if (hit) {
      out.push({ ...card, role: hit.role, label: hit.label, confidence: hit.confidence, source: 'l1d', signature: sig });
      continue;
    }
    const role = String(card.ruleRole || 'other');
    const confidence = Number(card.ruleConfidence ?? 0.4);
    const base = {
      ...card,
      role,
      label: card.title || role,
      confidence,
      source: 'rule',
      signature: sig,
    };
    if (L1C_LLM && shouldLlmClassify(base)) needLlm.push(base);
    else {
      cacheSet(ck, base);
      out.push(base);
    }
  }
  if (needLlm.length) {
    const batch = needLlm.slice(0, 12);
    try {
      const classified = await llmClassifyBatch(batch);
      for (let i = 0; i < batch.length; i++) {
        const merged = mergeLlm(batch[i], classified[i]);
        cacheSet(`${sid}:${merged.signature}`, merged);
        out.push(merged);
      }
      for (const rest of needLlm.slice(12)) {
        cacheSet(`${sid}:${rest.signature}`, rest);
        out.push(rest);
      }
    } catch {
      for (const c of needLlm) {
        out.push({ ...c, fallback_reason: 'llm_error' });
      }
    }
  }
  return out;
}
```

Implement `llmClassifyBatch` with strict JSON parse, role validation (`SEED` or `/^custom:[a-z0-9_-]+$/i`), timeout via `AbortSignal` or `Promise.race`. Prompt: cards only, ask for JSON array aligned by index.

- [ ] **Step 3: Extend characterization** to call `featureSignature` / `shouldLlmClassify` / mock cache hit path (no live LLM required when `L1C_LLM=false`)

```js
import { featureSignature, shouldLlmClassify, classifyRegions } from '../../src/services/region-classify.js';

{
  const card = { classTokens: ['el-main'], title: '', band: 'center', flags: {}, childCounts: {}, ruleRole: 'other', ruleConfidence: 0.4 };
  assert.equal(shouldLlmClassify(card), true);
  assert.equal(featureSignature(card).length, 32);
  const once = await classifyRegions([card], { systemId: 'sys1' });
  const twice = await classifyRegions([card], { systemId: 'sys1' });
  assert.equal(twice[0].source, 'l1d');
  ok('classifyRegions L1d hit without LLM');
}
```

- [ ] **Step 4: Full char PASS**
- [ ] **Step 5: Commit** (if user asks)

---

### Task 4: Wire resolve-element

**Files:**
- Modify: `src/cdp/resolve-by-label.js` (`enrichOne` / after matches built) **or** `src/services/trajectory/trajectory-record-lifecycle.js` after CDP result
- Prefer lifecycle: has `trajectoryId` → can resolve `systemId` from trajectory DAO

**Interfaces:**
- Consumes: `classifyRegions`, snaps with `feature_card`
- Produces: patched `region_role` / `region_id` / `region_label` / optional `region_confidence` on element + preview

- [ ] **Step 1: In `resolveTrajectoryElement`, after successful resolve list/matches:**

```js
import { classifyRegions } from '../region-classify.js'; // path adjust
// load systemId from trajectory row if available
const cards = [];
for (const m of matchesOrSingle) {
  const fc = m.element?.feature_card || m.preview?.feature_card;
  if (fc) cards.push({ ...fc, _ref: m });
}
if (cards.length) {
  const classified = await classifyRegions(cards, { systemId });
  // map back by signature onto region_* fields; never remove matches
}
```

- [ ] **Step 2: Ensure `copyLocatorMeta` / `toPreview` pass `feature_card` if needed only ephemerally (may strip before persist)**
- [ ] **Step 3: Manual/char: with `L1C_LLM=false`, resolve still works; other stays other**
- [ ] **Step 4: Commit** (if user asks)

---

### Task 5: HTTP API for scan + docs + CHANGELOG

**Files:**
- Create/register: `POST /api/v2/regions/classify` body `{ systemId?, cards: FeatureCard[] }` → `{ items: Classified[] }`
- Modify: api-docs catalog/group
- Modify: `CHANGELOG.md`
- Optional: Python `scan_editable_summary` best-effort POST when control plane URL configured — if too heavy, document as follow-up and only ship HTTP + Node resolve wire in this cut; **spec requires both consumers** — minimum: HTTP exists so scan *can* call; add a 10-line Python helper if `CONTROL_PLANE_URL` set.

- [ ] **Step 1: Route**

```js
app.post('/api/v2/regions/classify', async (req, res) => {
  try {
    const cards = Array.isArray(req.body?.cards) ? req.body.cards : [];
    const systemId = req.body?.systemId ?? req.body?.system_id ?? '';
    const items = await classifyRegions(cards, { systemId });
    res.json({ items });
  } catch (err) {
    sendErr(res, err);
  }
});
```

- [ ] **Step 2: api-docs + CHANGELOG** (Python sync tip: proxy `POST /api/v2/regions/classify`; env `L1C_LLM`)
- [ ] **Step 3: Spec status → Implemented** when green; backlog L1c/L1d rows update
- [ ] **Step 4: Commit** (if user asks)

---

### Task 6: Spec / backlog status

**Files:**
- Spec status line → Implemented (+ caveats: wet LLM optional; in-memory L1d)
- Backlog L1c-LLM / L1d-cache → 代码已实施

- [ ] **Step 1: Update docs after Tasks 1–5 green**
- [ ] **Step 2: Commit** (if user asks)

---

## Self-review (plan vs spec)

| Spec item | Task |
|-----------|------|
| Feature cards CDP | 2 |
| classifyRegions + trigger 0.7 / other/custom | 3 |
| L1d signature cache | 3 |
| L1C_LLM default off | 3 |
| Batch ≤12 + fail-soft | 3 |
| resolve consumer | 4 |
| scan consumer (HTTP) | 5 |
| Algorithm B / no L2 drop | 3–4 |
| CHANGELOG / env | 5 |
| Characterization | 1+3 |

No TBD placeholders. L1d storage locked to in-memory TTL in Global Constraints.

---

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-08-11-l1c-llm-region-classify.md`.

**Two execution options:**

1. **Subagent-Driven (recommended)** — fresh subagent per task, review between tasks  
2. **Inline Execution** — this session with executing-plans  

Which approach?
