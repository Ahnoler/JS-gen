# PR-LAYER `layers[]` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Each L2 control carries `layers[]` (`{ role, label }[]`, outer→inner) derived from existing `region_*`, persisted on snap / preview / `element_json`.

**Architecture:** Do not rescan the DOM. After `assignRegion` (and after collision `mergeTitleboxIntoRegion`), `buildRegionLayers(region)` fills `layers`. Optional `prependPageLayer(layers, pageLabel)` runs in Node when the caller has a function/menu name. `display_group` stays `region_label`. Do **not** implement `assembleRegionTree` / `region_tree`.

**Tech Stack:** `PAGE_LOCATOR_HELPERS` in `src/cdp/page-locator-helpers.js` (template literal; regex `\\s` / `\\b`), regen `scripts/controller/actions/js_snippets/_locator_helpers_js.py` via `node scripts/_gen_locator_helpers_py.mjs`, `src/cdp/display-group.js`, `src/cdp/resolve-by-label.js`, `src/models/element.js`, `src/services/trajectory/trajectory-record-lifecycle.js`, Node characterization + Playwright chromium fixtures.

**Spec:** `docs/superpowers/specs/2026-08-14-pr-layer-region-layers-design.md`

## Global Constraints

- Overlay / table / `.todo-item` / shell still short-circuit **before** compose. Do not produce `tab → overlay` this cut.
- `layers` from `region_*` only — **no extra DOM walk**.
- `page` never comes from `assignRegion`. At most one `page`, and only at `layers[0]`; drop inner `page`.
- Todo short-circuit: `region_role` becomes `todo`; `region_id` stays `section:${idKey}` (biz-key uniquify unchanged); `region_label` stays the Chinese title.
- `display_group` = `region_label`. Do not change Vue grouping. Do not backfill old steps. No `assembleRegionTree`. No xpath recipe changes. No L1c LLM.
- `PAGE_LOCATOR_HELPERS` is a JS template literal — regex backslashes stay doubled (`\\s`, `\\b`).
- After any edit to `page-locator-helpers.js`: `node scripts/_gen_locator_helpers_py.mjs` (never hand-edit `_locator_helpers_js.py`).
- Characterization pins substrings; keep `SHARED_ASSIGN_REGION`, `function assignRegion`, `function regionLabelOf`, `SHARED_COLLISION_REFINE`, and `buildFeatureCard` **before** `isActionOnlyTitle`.
- `src/` changes need `CHANGELOG.md` `[Unreleased]` with Python 同步提示: no schema; optional `layers` on preview / `element_json`; SPA still shows `display_group` as-is.
- **Commit only when the user explicitly asks.** Skip every Commit step until then.

---

## File map

| File | Role |
|------|------|
| `src/cdp/page-locator-helpers.js` | `buildRegionLayers`, `prependPageLayer`, `withLayers`; todo `region_role`; stamp `layers` on assign + snap + merge |
| `scripts/controller/actions/js_snippets/_locator_helpers_js.py` | Generated mirror |
| `src/cdp/region-layers.js` | Node copy of `prependPageLayer` (resolve/record after snap) |
| `src/cdp/display-group.js` | `todo` in `TAXONOMY_ROLES` |
| `src/cdp/resolve-by-label.js` | Pass `layers`; `opts.pageLabel` → prepend |
| `src/models/element.js` | `copyLocatorMeta` copies `layers` |
| `src/services/trajectory/trajectory-record-lifecycle.js` | `patchRegionFields` keeps `layers` and `todo` role |
| `src/dashboard/api-docs/groups/recording.js` | Note optional `preview.layers` |
| `scripts/characterization/characterize-partition-compose.mjs` | Layers + todo role + prepend assertions |
| `CHANGELOG.md` | Unreleased |

---

### Task 0: Baseline green

**Files:** none

- [ ] **Step 1: Run compose + related chars**

```bash
node scripts/characterization/characterize-partition-compose.mjs
node scripts/characterization/characterize-resolve-collision-titlebox.mjs
node scripts/characterization/characterize-l1c-region-classify.mjs
```

Expected: all three print `ok` / exit 0.

- [ ] **Step 2: Commit**

Skip unless the user asked.

---

### Task 1: Failing characterization

**Files:**
- Modify: `scripts/characterization/characterize-partition-compose.mjs`

**Interfaces:**
- Consumes: existing `assignExpr` / `snapExpr` / fixture IDs (`#corp-legal`, `#img-form-next`, `#tbl-btn`, `#dlg-ok`, `#todo-handle`, `#rate-basic`)
- Produces: RED assertions on `layers`, `region_role === 'todo'`, `prependPageLayer`

Do **not** add `assert.match(elSrc, /layers/)` here (that cue belongs in Task 4).

- [ ] **Step 1: Add helper cues and assertions**

In the top cue block, add:

```javascript
  assert.match(helpersSrc, /function buildRegionLayers\s*\(/);
  assert.match(helpersSrc, /function prependPageLayer\s*\(/);
```

After `isTaxonomyRegionToken('wizard')`, add:

```javascript
  assert.equal(isTaxonomyRegionToken('todo'), true);
```

(If this fails before Task 5, keep the taxonomy assert in Task 5 instead.)

After the existing `tab + collapse + titlebox` asserts on `legal`, add:

```javascript
  assert.deepEqual(legal.layers, [
    { role: 'tab', label: '客户基本信息' },
    { role: 'section', label: '对公客户概况' },
    { role: 'titlebox', label: '法定代表人/负责人信息' },
  ]);
```

After `imgForm` wizard footer asserts:

```javascript
  assert.deepEqual(imgForm.layers, [{ role: 'wizard', label: '影像资料' }]);
```

After table / overlay:

```javascript
  assert.deepEqual(tbl.layers, [{ role: 'table', label: '表格' }]);
  assert.equal(dlg.layers && dlg.layers[0] && dlg.layers[0].role, 'overlay');
  assert.equal(dlg.layers.length, 1);
```

Replace the todo asserts with:

```javascript
  const todo = await page.evaluate(assignExpr('#todo-handle'));
  assert.equal(todo.region_role, 'todo');
  assert.match(String(todo.region_label), /对公授信申请|信贷调查/);
  assert.equal(todo.layers && todo.layers[0] && todo.layers[0].role, 'todo');
  assert.equal(todo.layers.length, 1);
  ok('todo-item still before compose; region_role todo');
```

After `rate` (no chrome) asserts:

```javascript
  assert.equal(rate.layers && rate.layers[0] && rate.layers[0].role, 'section');
  assert.equal(rate.layers[rate.layers.length - 1].role, 'titlebox');
  assert.ok(!(rate.layers || []).some((x) => x.role === 'tab' || x.role === 'wizard' || x.role === 'page'));
```

Add a Playwright evaluate that injects helpers and calls `prependPageLayer` (same pattern as `assignExpr`):

```javascript
  const pre = await page.evaluate(`(() => {
${PAGE_LOCATOR_HELPERS}
    const a = prependPageLayer(
      [{ role: 'tab', label: '客户基本信息' }],
      '对公客户管理'
    );
    const b = prependPageLayer(
      [{ role: 'page', label: '已有页' }, { role: 'page', label: '内层' }, { role: 'tab', label: 'T' }],
      ''
    );
    const c = prependPageLayer(
      [{ role: 'page', label: '已有页' }, { role: 'tab', label: 'T' }],
      '对公客户管理'
    );
    return { a, b, c };
  })()`);
  assert.deepEqual(pre.a, [
    { role: 'page', label: '对公客户管理' },
    { role: 'tab', label: '客户基本信息' },
  ]);
  assert.equal(pre.b[0].role, 'page');
  assert.equal(pre.b[0].label, '已有页');
  assert.ok(!(pre.b || []).slice(1).some((x) => x.role === 'page'));
  assert.equal(pre.c[0].label, '已有页');
  assert.equal(pre.c.length, 2);
  ok('prependPageLayer: head insert; drop inner page; do not double page');
```

Duplicate 新增 snaps: assert `assetSnap.layers` contains `{ role: 'titlebox', label: '资产信息' }` and contact the other titlebox.

- [ ] **Step 2: Run — expect FAIL**

```bash
node scripts/characterization/characterize-partition-compose.mjs
```

Expected: `AssertionError` on missing `buildRegionLayers` or `legal.layers`.

- [ ] **Step 3: Commit**

Skip unless the user asked.

---

### Task 2: Implement helpers + todo role + stamp `layers`

**Files:**
- Modify: `src/cdp/page-locator-helpers.js` only

**Interfaces:**
- Consumes: `assignRegion` result fields (`region_role`, `region_label`, `region_chrome`, `region_section`, `region_block`)
- Produces: `buildRegionLayers(region) → {role,label}[]`; `prependPageLayer(layers, pageLabel) → layers`; `withLayers(region)`; todo `region_role: 'todo'`

- [ ] **Step 1: `regionLabelOf` — add todo**

Inside `function regionLabelOf`, after the `table` line:

```javascript
      if (role === 'todo') return t || '待办';
```

- [ ] **Step 2: Add `buildRegionLayers`, `prependPageLayer`, `withLayers` immediately after `regionLabelOf` and before `assignRegion`**

`function assignRegion` must stay at the `SHARED_ASSIGN_REGION` site. New helpers sit between `regionLabelOf` and `assignRegion`. Template-literal whitespace regex uses `\\s`.

```javascript
    function layerLabel(s) {
      return String(s || '').replace(/\\s+/g, ' ').trim().slice(0, 40);
    }
    function buildRegionLayers(region) {
      if (!region) return [];
      const role = String(region.region_role || '');
      const label = layerLabel(region.region_label);
      if (role === 'overlay') {
        return label ? [{ role: 'overlay', label: label }] : [];
      }
      if (role === 'table') {
        return [{ role: 'table', label: label || '表格' }];
      }
      if (role === 'todo') {
        return label ? [{ role: 'todo', label: label }] : [];
      }
      const out = [];
      const chrome = region.region_chrome;
      if (chrome && chrome.label && (chrome.role === 'tab' || chrome.role === 'wizard')) {
        const cl = layerLabel(chrome.label);
        if (cl) out.push({ role: chrome.role, label: cl });
      }
      const section = layerLabel(region.region_section);
      if (section) out.push({ role: 'section', label: section });
      const block = layerLabel(region.region_block);
      if (block) out.push({ role: 'titlebox', label: block });
      return out;
    }
    function prependPageLayer(layers, pageLabel) {
      const src = Array.isArray(layers) ? layers.slice() : [];
      let existingPage = '';
      if (src[0] && src[0].role === 'page') existingPage = layerLabel(src[0].label);
      const cleaned = [];
      for (let i = 0; i < src.length; i++) {
        if (src[i] && src[i].role === 'page') continue;
        cleaned.push(src[i]);
      }
      const incoming = layerLabel(pageLabel);
      const page = existingPage || incoming;
      if (page) cleaned.unshift({ role: 'page', label: page });
      return cleaned;
    }
    function withLayers(region) {
      if (!region) return region;
      region.layers = buildRegionLayers(region);
      return region;
    }
```

`prependPageLayer`: if `layers[0]` is already `page`, do **not** add a second page from `pageLabel`; drop every inner `page`.

- [ ] **Step 3: Todo short-circuit `region_role`**

```javascript
        return withLayers({
          region_role: 'todo',
          region_id: 'section:' + idKey,
          region_label: regionLabelOf('todo', label),
        });
```

Keep `region_id` prefix `section:` (biz-key uniquify).

- [ ] **Step 4: Wrap every other `assignRegion` return with `withLayers(...)`**

Including overlay, table, shell, `composed`, main, other.

- [ ] **Step 5: Collision merge restamps layers**

In `refineCollidingRegions`, after merge:

```javascript
          if (finer) {
            it.region = withLayers(mergeTitleboxIntoRegion(it.region, finer));
          }
```

- [ ] **Step 6: `buildLocatorSnap` copies `layers`**

Next to `region_block`:

```javascript
      layers: region.layers || [],
```

- [ ] **Step 7: Run char — expect PASS on helper/layers asserts (taxonomy `todo` may still fail until Task 5)**

If Task 1 included `isTaxonomyRegionToken('todo')` and it fails, move that assert to Task 5 before continuing.

```bash
node scripts/characterization/characterize-partition-compose.mjs
```

Expected: `characterize-partition-compose: ok` once taxonomy cue is either passing or deferred.

- [ ] **Step 8: Commit**

Skip unless the user asked.

---

### Task 3: Regen Python helper mirror

**Files:**
- Generate: `scripts/controller/actions/js_snippets/_locator_helpers_js.py`
- Do not hand-edit the `.py`

- [ ] **Step 1: Regen**

```bash
node scripts/_gen_locator_helpers_py.mjs
```

Expected: `ok: wrote _locator_helpers_js.py`

- [ ] **Step 2: Confirm cues in the generated file**

Search for `buildRegionLayers`, `prependPageLayer`, `region_role: 'todo'`.

- [ ] **Step 3: Commit**

Skip unless the user asked.

---

### Task 4: Persist `layers` on preview / `element_json`

**Files:**
- Modify: `src/models/element.js` (`copyLocatorMeta`)
- Modify: `src/cdp/resolve-by-label.js` (`toPreview`, in-page `snap()` mapping, enrich)
- Modify: `src/services/trajectory/trajectory-record-lifecycle.js` (`patchRegionFields`)
- Modify: `scripts/characterization/characterize-partition-compose.mjs` (element.js cue)

**Interfaces:**
- Consumes: snap `layers`
- Produces: `element_json.layers`, `preview.layers`; L1c does not wipe `layers` or `todo`

- [ ] **Step 1: `copyLocatorMeta`**

Add `'layers'` to the copied keys. Empty array must copy. If the generic skip drops `[]`, special-case:

```javascript
  if (Array.isArray(source.layers)) target.layers = source.layers;
```

- [ ] **Step 2: `toPreview` and resolve enrich**

`toPreview`: `layers: Array.isArray(el?.layers) ? el.layers : []`

In-page `snap()` (around `region_block`): `layers: loc.layers || []`

`resolveElementByLabel` enrich: `layers: raw.layers || []`

- [ ] **Step 3: `patchRegionFields`**

Keep `todo` like tab/wizard/section:

```javascript
  if (keepPrevLabel && (prevRole === 'tab' || prevRole === 'wizard' || prevRole === 'section' || prevRole === 'todo')) {
    target.region_role = prevRole;
  } else {
    target.region_role = role;
  }
```

Do not delete `target.layers`.

- [ ] **Step 4: Char cue + run**

Add `assert.match(elSrc, /layers/);` next to `region_block`.

```bash
node scripts/characterization/characterize-partition-compose.mjs
node scripts/characterization/characterize-l1c-region-classify.mjs
node scripts/characterization/characterize-resolve-collision-titlebox.mjs
```

Expected: all ok (unless Task 5 taxonomy cue still pending).

- [ ] **Step 5: Commit**

Skip unless the user asked.

---

### Task 5: Taxonomy `todo` + Node `prependPageLayer` + resolve `pageLabel`

**Files:**
- Modify: `src/cdp/display-group.js` — add `'todo'` to `TAXONOMY_ROLES`
- Create: `src/cdp/region-layers.js` — Node `prependPageLayer` (same semantics; no DOM)
- Modify: `src/cdp/resolve-by-label.js` — `opts.pageLabel`; prepend after enrich
- Modify: `scripts/characterization/characterize-partition-compose.mjs` — Node prepend smoke + `isTaxonomyRegionToken('todo')` if deferred

**Interfaces:**
- Consumes: `opts.pageLabel` string (optional)
- Produces: preview/element `layers` with a root `page` when label provided and `layers[0]` is not already `page`

- [ ] **Step 1: `TAXONOMY_ROLES`**

Add `'todo'` next to `'table'` / `'page'`.

- [ ] **Step 2: Create `src/cdp/region-layers.js`**

```javascript
function layerLabel(s) {
  return String(s || '').replace(/\s+/g, ' ').trim().slice(0, 40);
}

export function prependPageLayer(layers, pageLabel) {
  const src = Array.isArray(layers) ? layers.slice() : [];
  let existingPage = '';
  if (src[0] && src[0].role === 'page') existingPage = layerLabel(src[0].label);
  const cleaned = [];
  for (let i = 0; i < src.length; i++) {
    if (src[i] && src[i].role === 'page') continue;
    cleaned.push(src[i]);
  }
  const incoming = layerLabel(pageLabel);
  const page = existingPage || incoming;
  if (page) cleaned.unshift({ role: 'page', label: page });
  return cleaned;
}
```

Do **not** duplicate `buildRegionLayers` in Node.

- [ ] **Step 3: resolve**

`import { prependPageLayer } from './region-layers.js';`

In `resolveElementByLabel`: `const pageLabel = String(opts.pageLabel || opts.page_label || '').trim();`

After `layers` is on `enriched` / `element` / `preview`:

```javascript
    const layers = prependPageLayer(enriched.layers || [], pageLabel);
    enriched.layers = layers;
    element.layers = layers;
    preview.layers = layers;
```

Do **not** hunt trajectory `functionName` this cut — callers pass `pageLabel` when they have it.

- [ ] **Step 4: Char**

Node import (no browser):

```javascript
import { prependPageLayer } from '../../src/cdp/region-layers.js';
assert.deepEqual(
  prependPageLayer([{ role: 'tab', label: '客户基本信息' }], '对公客户管理')[0],
  { role: 'page', label: '对公客户管理' },
);
assert.equal(isTaxonomyRegionToken('todo'), true);
```

```bash
node scripts/characterization/characterize-partition-compose.mjs
node scripts/characterization/characterize-l1c-region-classify.mjs
```

Expected: ok.

- [ ] **Step 5: Commit**

Skip unless the user asked.

---

### Task 6: CHANGELOG, api-docs, spec/todo

**Files:**
- Modify: `CHANGELOG.md` `[Unreleased]`
- Modify: `src/dashboard/api-docs/groups/recording.js` notes
- Modify: `docs/superpowers/specs/2026-08-14-pr-layer-region-layers-design.md` Status
- Modify: `docs/superpowers/todo-list.md` PR-LAYER row

- [ ] **Step 1: CHANGELOG** under `### Added` or `### Changed`:

```markdown
- 2026-08-14: **分区 layers[]**：每个控件 `layers`（`{ role, label }[]`，外→内）由 `region_*` 推导，写入 snap / preview / `element_json`。todo 短路 `region_role` 改为 `todo`。可选 `pageLabel` 头插 `page`（不套 page）。无 schema。
  影响范围：扫描 / resolve / 录制 `element_json`；`display_group` 仍为中文路径。
  文件：src/cdp/page-locator-helpers.js, src/cdp/region-layers.js, src/cdp/resolve-by-label.js, src/models/element.js
  Python 同步提示：无 HTTP/schema。可选透传 `layers`；SPA 仍按 `display_group` 原样展示。整页 `region_tree` 未做。
```

- [ ] **Step 2: api-docs recording notes**

Add: `preview.layers` 为 `{ role, label }[]`（外→内）；缺省回退 `display_group`。不要拆 `region_id`。

- [ ] **Step 3: Spec status** → `Implemented (CI)` — link this plan. Keep **TODO: 整页大树**.

- [ ] **Step 4: Run compose char**

```bash
node scripts/characterization/characterize-partition-compose.mjs
```

- [ ] **Step 5: Commit**

Skip unless the user asked.

---

### Task 7: Regression

**Files:** none

- [ ] **Step 1: Run**

```bash
node scripts/characterization/characterize-partition-compose.mjs
node scripts/characterization/characterize-resolve-collision-titlebox.mjs
node scripts/characterization/characterize-l1c-region-classify.mjs
```

Expected: all ok.

On Windows do **not** require `bash scripts/refactor/verify-all.sh` (CRLF). Optional: `node scripts/characterization/characterize-dedup.mjs`, `node scripts/characterization/characterize-ctrl.mjs`.

- [ ] **Step 2: Commit**

Skip unless the user asked.

---

## Self-review

1. **Spec coverage:** `layers[]` mapping, todo role, persist, prepend page, no assembleRegionTree, display_group unchanged — Tasks 1–6. 整页大树 remains spec TODO (no task).
2. **Placeholders:** none; helper source is in Task 2.
3. **Types:** `layers: { role: string, label: string }[]`; roles `page|overlay|tab|wizard|section|titlebox|table|todo`; `prependPageLayer(layers, pageLabel)` in helpers and `src/cdp/region-layers.js`.
