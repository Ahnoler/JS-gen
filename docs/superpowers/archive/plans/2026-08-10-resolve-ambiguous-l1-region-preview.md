# Resolve-element Ambiguous L1 Region Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Plan status (2026-08-10):** Tasks 1–4 **code complete** (characterization PASS; Vue picker wired). Task 5 BiB reload + multi「新增」UI smoke **deferred** until executor free.

**Goal:** Make resolve-element ambiguous matches show fullpage L1 `region_label` and bake region/section-anchored `xpath_smart` when verifiable, so users can pick among duplicate「新增」etc.

**Architecture:** Extract/share P0 `assignRegion` (+ human `regionLabelOf`) with fullpage scan semantics into CDP `PAGE_LOCATOR_HELPERS`; attach `region_*` on every resolve snap/preview; keep dual-save `sectionAnchorXPath` as the xpath bake-in for `region_role=section`. Vue picker reads `region_label` first. Algorithm B: never drop matches because assign failed.

**Tech Stack:** Node CDP helpers (`src/cdp/page-locator-helpers.js`, `resolve-by-label.js`), Python scan JS string (`scan_form.py`) kept rule-aligned, Vue `OperationDialog.vue` + `recording.ts`, characterization `.mjs`.

**Spec:** `docs/superpowers/specs/2026-08-10-resolve-ambiguous-section-preview-design.md`

## Global Constraints

- Region model = fullpage L1 (algorithm B); mislabel → `other` / 「其他」, match **stays** in `matches[]`.
- Playwright locate contract = relative `xpath_smart` only (no `params.section` / `region_role` at execute).
- P0 assign = **rules only** (no L1c LLM in resolve).
- Same assign priority as scan `assignRegion` (overlay → table → collapse section → shell-aside → shell-header → main → other).
- `section` role xpath bake-in reuses existing `sectionAnchorOf` / `sectionAnchorXPath`; do not invent fake collapse anchors for shell/main/other.
- No global `(…)[n]` as exported smart when a section/region verified anchor exists but uniqueness failed (dual-save rule).
- TDD: characterization fail → implement → green.
- Commit only if user asks (existing project rule).
- Executor must reload `resolve-by-label` for BiB wet verify (ops note, not a code task).

## File map

| File | Role |
|------|------|
| `src/cdp/page-locator-helpers.js` | Canonical `assignRegion` / `regionLabelOf`; attach on `buildLocatorSnap`; markers |
| `scripts/controller/actions/js_snippets/_locator_helpers_js.py` | Keep in sync with PAGE_LOCATOR_HELPERS (existing dual-copy pattern) |
| `scripts/controller/actions/js_snippets/scan_form.py` | Align inline `assignRegion` + emit `region_label` where fields/buttons get regions |
| `src/cdp/resolve-by-label.js` | `toPreview` exposes `region_role` / `region_id` / `region_label` |
| `scripts/characterization/characterize-resolve-ambiguous-region.mjs` | New char harness |
| `vue-project/.../api/recording.ts` | Preview types |
| `vue-project/.../OperationDialog.vue` | Picker primary line uses `region_label` |
| Spec status line | Mark approved / implemented when done |

```text
resolve match host
  → assignRegion(host) → region_role / region_id / region_label
  → buildLocatorSnap (existing section-anchor for multi-hit section)
  → toPreview(+ region_*)
  → Vue: "{region_label} · {label} · {kind}"
```

---

### Task 1: Characterization — shared assign + preview cues

**Files:**
- Create: `scripts/characterization/characterize-resolve-ambiguous-region.mjs`
- Test: same

**Interfaces:**
- Consumes: `buildResolveExpression` / source of `page-locator-helpers.js` + `resolve-by-label.js`
- Produces: failing asserts until Tasks 2–3 land

- [ ] **Step 1: Write failing characterization**

```js
/**
 * Characterize resolve-element ambiguous L1 region preview.
 *   node scripts/characterization/characterize-resolve-ambiguous-region.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildResolveExpression } from '../../src/cdp/resolve-by-label.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const helpers = readFileSync(join(root, 'src/cdp/page-locator-helpers.js'), 'utf8');
const resolveSrc = readFileSync(join(root, 'src/cdp/resolve-by-label.js'), 'utf8');
const scanForm = readFileSync(
  join(root, 'scripts/controller/actions/js_snippets/scan_form.py'),
  'utf8',
);

function ok(n) { console.log(`ok: ${n}`); }

{
  assert.match(helpers, /SHARED_ASSIGN_REGION/);
  assert.match(helpers, /function assignRegion\s*\(/);
  assert.match(helpers, /function regionLabelOf\s*\(/);
  assert.match(helpers, /region_role:\s*'overlay'/);
  assert.match(helpers, /shell-aside/);
  assert.match(helpers, /region_label/);
  ok('helpers: SHARED_ASSIGN_REGION + assignRegion + regionLabelOf');
}

{
  assert.match(helpers, /region_role:/);
  assert.match(helpers, /buildLocatorSnap/);
  // snap return must include region fields
  assert.match(helpers, /region_role:\s*region\.region_role|region_role:\s*reg\.|region_role:/);
  ok('helpers: buildLocatorSnap exposes region_*');
}

{
  assert.match(resolveSrc, /region_label/);
  assert.match(resolveSrc, /toPreview/);
  const previewBlock = resolveSrc.slice(resolveSrc.indexOf('function toPreview'), resolveSrc.indexOf('function toPreview') + 800);
  assert.match(previewBlock, /region_label/);
  assert.match(previewBlock, /region_role/);
  ok('resolve: toPreview includes region_*');
}

{
  const expr = buildResolveExpression({
    labelText: '新增',
    actionType: 'click_element_by_index',
    params: { text: '新增', index: -1 },
  });
  assert.match(expr, /assignRegion/);
  assert.match(expr, /region_label/);
  ok('expression injects assignRegion');
}

{
  // Scan must stay rule-aligned (same marker / role order cues)
  assert.match(scanForm, /SHARED_ASSIGN_REGION|assignRegion/);
  assert.match(scanForm, /shell-aside/);
  assert.match(scanForm, /el-collapse-item/);
  ok('scan_form: assignRegion still present / aligned');
}

console.log('characterize-resolve-ambiguous-region: ok');
```

- [ ] **Step 2: Run — expect FAIL**

```bash
node scripts/characterization/characterize-resolve-ambiguous-region.mjs
```

Expected: FAIL on missing `SHARED_ASSIGN_REGION` / `regionLabelOf` / preview fields.

- [ ] **Step 3: Commit only if user asks** (otherwise leave untracked until batch commit).

---

### Task 2: Shared `assignRegion` + attach on `buildLocatorSnap`

**Files:**
- Modify: `src/cdp/page-locator-helpers.js` (near `sectionAnchorOf` / `buildLocatorSnap`)
- Modify: `scripts/controller/actions/js_snippets/_locator_helpers_js.py` (sync same JS body)
- Modify: `scripts/controller/actions/js_snippets/scan_form.py` (`assignRegion` body + `region_label` on assigned fields/buttons; keep `/* SHARED_ASSIGN_REGION */` marker)

**Interfaces:**
- Produces (page-side):
  - `assignRegion(el) → { region_role, region_id, region_label }`
  - `regionLabelOf(role, idOrTitle) → string` (「弹层」/ collapse title / 「侧栏」/ …)
  - `buildLocatorSnap` return adds `region_role`, `region_id`, `region_label`
- Consumes: existing `sectionAnchorOf` for xpath when role is section (unchanged dual-save path)

- [ ] **Step 1: Add helpers inside `PAGE_LOCATOR_HELPERS` string** (after `sectionAnchorOf` block is fine)

```js
    /* SHARED_ASSIGN_REGION — keep in sync with scan_form.py assignRegion */
    function regionLabelOf(role, title) {
      const t = String(title || '').replace(/\\s+/g, ' ').trim().slice(0, 40);
      if (role === 'overlay') return t || '弹层';
      if (role === 'table') return t || '表格';
      if (role === 'section') return t || '区块';
      if (role === 'shell-aside') return '侧栏';
      if (role === 'shell-header') return '顶栏';
      if (role === 'main') return '主区';
      if (role === 'page') return '页面';
      return t || '其他';
    }
    function assignRegion(el) {
      if (!el || !el.closest) {
        return { region_role: 'other', region_id: 'other', region_label: regionLabelOf('other') };
      }
      if (el.closest('.el-dialog, .el-drawer, .el-message-box')) {
        const o = el.closest('.el-dialog, .el-drawer, .el-message-box');
        const title = (o.querySelector('.el-dialog__title, .el-drawer__title')
          && (o.querySelector('.el-dialog__title, .el-drawer__title').textContent || ''))
          || o.getAttribute('aria-label') || '';
        const id = 'overlay:' + String(title || 'overlay').replace(/\\s+/g, ' ').trim().slice(0, 40);
        return { region_role: 'overlay', region_id: id, region_label: regionLabelOf('overlay', title) };
      }
      if (el.closest('.el-table, .tssc-multiple-table-content, .myTable')) {
        return { region_role: 'table', region_id: 'table', region_label: regionLabelOf('table') };
      }
      if (el.closest('.el-collapse-item')) {
        const it = el.closest('.el-collapse-item');
        const t = (it.querySelector('.el-collapse-item__header')
          && (it.querySelector('.el-collapse-item__header').innerText || ''))
          || '';
        const title = String(t).replace(/\\s+/g, ' ').trim().slice(0, 40);
        return {
          region_role: 'section',
          region_id: 'section:' + (title || 'section'),
          region_label: regionLabelOf('section', title),
        };
      }
      if (el.closest('.el-aside, .sidebar, aside, .el-menu')) {
        return { region_role: 'shell-aside', region_id: 'shell-aside', region_label: regionLabelOf('shell-aside') };
      }
      if (el.closest('.el-header, .navbar, header, .tags-view-container')) {
        return { region_role: 'shell-header', region_id: 'shell-header', region_label: regionLabelOf('shell-header') };
      }
      if (el.closest('.el-main, .app-main, .plugin-content, main')) {
        return { region_role: 'main', region_id: 'main', region_label: regionLabelOf('main') };
      }
      return { region_role: 'other', region_id: 'other', region_label: regionLabelOf('other') };
    }
```

- [ ] **Step 2: In `buildLocatorSnap` return object**, after computing `host`, call:

```js
      const region = assignRegion(host);
```

and add to the returned object:

```js
      region_role: region.region_role,
      region_id: region.region_id,
      region_label: region.region_label,
```

Do **not** remove matches or clear region when xpath verify fails.

- [ ] **Step 3: Sync `_locator_helpers_js.py`** with the same helper text (copy from `page-locator-helpers.js` helpers section as the repo already does for PAGE_LOCATOR_HELPERS).

- [ ] **Step 4: Align `scan_form.py`**
  - Add marker comment `/* SHARED_ASSIGN_REGION */` above its `assignRegion`.
  - Extend return to include `region_label` via the same `regionLabelOf` rules (inline duplicate OK if Python cannot import JS module; characterization checks both have `SHARED_ASSIGN_REGION` + `shell-aside`).
  - When assigning `f.region_role` / `b.region_role`, also set `region_label` / `region_id` consistently.

- [ ] **Step 5: Re-run Task 1 char — helpers asserts should pass; toPreview may still fail**

```bash
node scripts/characterization/characterize-resolve-ambiguous-region.mjs
```

- [ ] **Step 6: Commit only if user asks.**

---

### Task 3: `toPreview` + enrich passthrough

**Files:**
- Modify: `src/cdp/resolve-by-label.js` (`toPreview`, and ensure `enrichOne` / `normalizeElementJson` does not strip `region_*` if present on raw snap)

**Interfaces:**
- Consumes: snap fields `region_role`, `region_id`, `region_label`
- Produces: `preview.region_role`, `preview.region_id`, `preview.region_label`; element JSON keeps same keys when present

- [ ] **Step 1: Extend `toPreview`**

```js
function toPreview(el) {
  // ... existing attr scrub ...
  return {
    tag: el?.tag || '',
    text: el?.text || '',
    formLabel: el?.formLabel || '',
    xpath_smart: el?.xpath_smart || '',
    xpath_full: el?.xpath_full || '',
    locator_strategy: el?.locator_strategy || '',
    target_kind: el?.target_kind || '',
    attributes: attrs,
    region_role: el?.region_role || '',
    region_id: el?.region_id || '',
    region_label: el?.region_label || '',
  };
}
```

- [ ] **Step 2: In `enrichOne`**, copy region fields onto `enriched` before `normalizeElementJson` (or set on the object passed in) so single-match and ambiguous paths both retain them:

```js
region_role: raw.region_role || '',
region_id: raw.region_id || '',
region_label: raw.region_label || '',
```

If `normalizeElementJson` whitelists keys, add these three to the allow-list.

- [ ] **Step 3: Run characterization — expect PASS**

```bash
node scripts/characterization/characterize-resolve-ambiguous-region.mjs
node scripts/characterization/characterize-resolve-element-auto-grab.mjs
```

Expected: both `ok` / exit 0.

- [ ] **Step 4: Commit only if user asks.**

---

### Task 4: Vue ambiguous picker

**Files:**
- Modify: `D:/dev/ui-auto-recording-agent-vue-master/vue-project/src/api/recording.ts` (`ResolveElementMatch.preview`)
- Modify: `D:/dev/ui-auto-recording-agent-vue-master/vue-project/src/views/ui-recording/detail/components/OperationDialog.vue` (picker template)

**Interfaces:**
- Consumes: `preview.region_label` (fallback 「页面」)
- Produces: primary line `{region_label} · {matchedLabel} · {target_kind}`

- [ ] **Step 1: Extend type**

```ts
preview?: {
  tag?: string
  text?: string
  formLabel?: string
  xpath_smart?: string
  xpath_full?: string
  target_kind?: string
  locator_strategy?: string
  region_role?: string
  region_id?: string
  region_label?: string
}
```

- [ ] **Step 2: Update picker row**

```vue
<span class="ambiguous-title">
  {{ m.preview?.region_label || '页面' }}
  · {{ m.matchedLabel || m.preview?.formLabel || '未命名' }}
  <span v-if="m.preview?.target_kind"> · {{ m.preview.target_kind }}</span>
</span>
<span class="ambiguous-xpath">
  {{ truncate(m.preview?.xpath_smart || m.element?.xpath_smart || m.preview?.xpath_full || m.element?.xpath_full, 120) }}
</span>
```

- [ ] **Step 3: Manual check** — refresh Vite; auto-grab multi「新增」; rows show distinct 主区/区块/… labels when L1 differs.

- [ ] **Step 4: Commit Vue only if user asks.**

---

### Task 5: Spec status + optional wet note

**Files:**
- Modify: `docs/superpowers/specs/2026-08-10-resolve-ambiguous-section-preview-design.md` status → `Approved + Implemented YYYY-MM-DD` when Tasks 1–4 green
- Optional: tick success criteria checkboxes if present

- [ ] **Step 1: Update status line after green chars + UI smoke.**
- [ ] **Step 2: Wet BiB** (ops): restart LMY executor so CDP injects new helpers; re-test ambiguous「新增」on traj with attached session.
- [ ] **Step 3: Commit docs only if user asks.**

---

## Spec coverage (self-review)

| Spec requirement | Task |
|------------------|------|
| L1 `region_role` / `region_id` / `region_label` on matches | 2, 3 |
| Same assign rules as fullpage scan | 2 (`SHARED_ASSIGN_REGION` + scan_form align) |
| Algorithm B — never drop match on assign fail | 2 (attach only; no filter) |
| Section xpath bake-in via existing helpers | 2 (existing `buildLocatorSnap` path; no removal) |
| Overlay/shell/main: label even if xpath ties | 2–4 |
| Vue primary line `region_label` | 4 |
| Characterization shared assigner cue | 1 |
| No L1c LLM / no Playwright MCP write path | Global constraints (not implemented) |

## Placeholder scan

No TBD / “similar to Task N” without code. Commit steps deferred to user ask (project rule).

## Type consistency

- Fields: `region_role`, `region_id`, `region_label` everywhere (preview + element).
- Marker: `SHARED_ASSIGN_REGION`.
- Fallback display string: `页面` only in Vue when label empty; helper uses `其他` for role `other`.
