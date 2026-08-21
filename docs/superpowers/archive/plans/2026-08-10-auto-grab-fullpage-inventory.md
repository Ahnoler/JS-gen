# Auto-grab Fullpage Inventory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Product「自动抓取」defaults to fullpage visible-operable inventory (`mode=inventory`): optional `actionType` + `labelText` filters; no label → always picker; pick infers `actionType` from `target_kind`; same-name keeps L1/titlebox + `xpath_smart`.

**Architecture:** Extend `POST …/resolve-element` (no new URL). Page-side inventory collector in `PAGE_LOCATOR_HELPERS` builds `{el,text,kind,region}[]` from `document` (shell included), filters by kind whitelist + optional contains(text), then reuses `pushHostsRefined` / collision refine / `buildLocatorSnap`. Node post-process: if `!labelText && matches.length>=1` force `{ambiguous,matches}` even when N=1. Vue loosens `canAutoGrab`, sends `mode:'inventory'`, infers action on pick.

**Tech Stack:** `src/cdp/page-locator-helpers.js`, `src/cdp/resolve-by-label.js`, trajectory resolve service + executor `bib_resolve_element`, Vue `OperationDialog.vue` + `recording.ts`, characterization `.mjs`.

**Spec:** `docs/superpowers/specs/2026-08-10-auto-grab-fullpage-inventory-design.md`

## Global Constraints

- Path **甲**: extend `resolve-element` only; default product mode = **`inventory`**; `mode=needle` keeps old needle search.
- `actionType` and `labelText` are **optional filters**, not required to click auto-grab.
- **No `labelText`:** return full kind-filtered (or all-kind) list → **always** `ambiguous` + picker (even N=1).
- **With `labelText`:** N=1 → `{element}`; N≥2 → ambiguous; N=0 → 404.
- Same-name: existing collision titlebox refine + algorithm **B** (never drop).
- On Vue pick: if `form.actionType` empty → map `target_kind` → actionType + fill text params; **do not overwrite** user-chosen actionType.
- Hard cap **120** hosts; set `truncated: true` when cut.
- No auto-fill of the page; no `region_*` as replay primary; no BiB highlight; no L1c-LLM.
- TDD: characterization fail → implement → green.
- Commit only if user asks.
- BiB wet needs executor reload after helper changes.
- CHANGELOG `[Unreleased]` for route/service/CDP semantic changes (Python sync tip).

## File map

| File | Role |
|------|------|
| `src/cdp/page-locator-helpers.js` | `SHARED_INVENTORY_COLLECT`: collect visible operable hosts + kind tags; kind whitelist helper; text filter; INVENTORY_CAP=120 |
| `src/cdp/resolve-by-label.js` | `mode` in expression + Node API; inventory branch; forceAmbiguous when !labelText; needle branch unchanged |
| `src/cdp/remote-bridge/index.js` | Pass `mode` into `resolveElementByLabel` |
| `src/services/trajectory/trajectory-record-lifecycle.js` | Accept/pass `mode`; relax 400 when mode=inventory |
| `src/routes/v2/trajectory-record.js` | Body `mode` |
| `executor/session-handler.js` (+ manager if needed) | Pass `mode` on `bib_resolve_element` |
| `src/dashboard/api-docs/groups/recording.js` | Document inventory semantics |
| `CHANGELOG.md` | Unreleased entry |
| `scripts/controller/actions/js_snippets/_locator_helpers_js.py` | Sync SHARED_INVENTORY markers from helpers |
| `scripts/characterization/characterize-resolve-inventory.mjs` | New char |
| Vue `OperationDialog.vue` | canAutoGrab; mode inventory; inferActionType on pick |
| Vue `api/recording.ts` | `mode?` on `resolveElement` |
| Spec status line | → Implemented when green |

```text
auto-grab
  → resolve-element { mode:inventory, actionType?, labelText? }
  → CDP collectInventory(document)
  → filter kind(actionType?) → filter text(labelText?)
  → refine collisions → snap[]
  → Node: !labelText ? always ambiguous : N==1 ? element : ambiguous
  → Vue picker / apply + maybe inferActionType
```

---

### Task 1: Characterization — inventory mode cues

**Files:**
- Create: `scripts/characterization/characterize-resolve-inventory.mjs`
- Test: same

**Interfaces:**
- Consumes: sources of helpers + `resolve-by-label.js` + `buildResolveExpression`
- Produces: RED until Tasks 2–3 land

- [ ] **Step 1: Write failing characterization**

```js
/**
 * Characterize resolve-element mode=inventory (AG-fullpage).
 *   node scripts/characterization/characterize-resolve-inventory.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildResolveExpression } from '../../src/cdp/resolve-by-label.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const helpers = readFileSync(join(root, 'src/cdp/page-locator-helpers.js'), 'utf8');
const resolveSrc = readFileSync(join(root, 'src/cdp/resolve-by-label.js'), 'utf8');

function ok(n) { console.log(`ok: ${n}`); }

{
  assert.match(helpers, /SHARED_INVENTORY_COLLECT|INVENTORY_COLLECT/);
  assert.match(helpers, /function collectInventoryHosts\s*\(/);
  assert.match(helpers, /INVENTORY_CAP\s*=\s*120|inventoryCap\s*=\s*120/);
  ok('helpers: inventory collect + cap');
}

{
  assert.match(resolveSrc, /mode\s*===\s*['\"]inventory['\"]|opts\.mode|mode === \"inventory\"/);
  assert.match(resolveSrc, /forceAmbiguous|alwaysAmbiguous|!labelText/);
  const expr = buildResolveExpression({
    labelText: '',
    actionType: 'click_element_by_index',
    params: {},
    mode: 'inventory',
  });
  assert.match(expr, /inventory|collectInventoryHosts/);
  ok('resolve: inventory mode wired into expression');
}

{
  const needle = buildResolveExpression({
    labelText: '客户名称',
    actionType: 'fill_form_field',
    params: { label_text: '客户名称' },
    mode: 'needle',
  });
  assert.ok(needle.length > 100);
  ok('resolve: needle mode still builds expression');
}

console.log('characterize-resolve-inventory: ok');
```

- [ ] **Step 2: Run — expect FAIL**

```bash
node scripts/characterization/characterize-resolve-inventory.mjs
```

Expected: AssertionError (missing inventory symbols)

- [ ] **Step 3: Commit** (only if user asks)

```bash
git add scripts/characterization/characterize-resolve-inventory.mjs
git commit -m "test: characterize resolve-element inventory mode"
```

---

### Task 2: Helpers — `collectInventoryHosts`

**Files:**
- Modify: `src/cdp/page-locator-helpers.js` (append SHARED block near collision refine)
- Modify: `scripts/controller/actions/js_snippets/_locator_helpers_js.py` (sync same JS string / regenerate per repo convention)
- Test: Task 1 char (partial green on helper asserts)

**Interfaces:**
- Produces (page-side):
  - `collectInventoryHosts()` → `Array<{ el: Element, text: string, kind: string }>`
  - kinds: at least `form_input|form_select|form_date|form_radio|form_checkbox|button|menu|icon` (align resolve `target_kind`)
  - visible only (`getBoundingClientRect` w/h > 0; not `display:none`)
  - roots: `document` (shell menus included)
  - `INVENTORY_CAP = 120`
  - `filterInventoryByKind(list, actionType)` / `filterInventoryByText(list, needle)` (contains, normalized)
- Consumes: existing `assignRegion`, `buildLocatorSnap`, `refineCollidingRegions`

- [ ] **Step 1: Add inventory collect skeleton in helpers**

Inside `PAGE_LOCATOR_HELPERS` string (mirror style of `SHARED_COLLISION_REFINE`):

```js
/* SHARED_INVENTORY_COLLECT — AG-fullpage; keep in sync with _locator_helpers_js.py */
var INVENTORY_CAP = 120;
function inventoryNorm(s) {
  return String(s || '').replace(/\s+/g, ' ').trim();
}
function inventoryVisible(el) {
  if (!el || !el.getBoundingClientRect) return false;
  var st = window.getComputedStyle(el);
  if (st.display === 'none' || st.visibility === 'hidden') return false;
  var r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}
function inventoryKindOf(el) {
  if (el.closest && el.closest('.el-select')) return 'form_select';
  if (el.closest && el.closest('.el-date-editor')) return 'form_date';
  if (el.closest && el.closest('.el-radio, .el-radio-group')) return 'form_radio';
  if (el.closest && el.closest('.el-checkbox, .el-checkbox-group')) return 'form_checkbox';
  if (el.closest && el.closest('.el-form-item') && el.matches && el.matches('input, textarea')) return 'form_input';
  if (el.closest && el.closest('.menu-item, .submenu-item, .el-menu-item, .el-submenu__title, [role="menuitem"]')) return 'menu';
  if (el.matches && (el.matches('button, .el-button') || el.closest('.el-button'))) return 'button';
  return 'button';
}
function inventoryTextOf(el, kind) {
  if (kind.indexOf('form_') === 0) {
    var item = el.closest && el.closest('.el-form-item');
    var lab = item && item.querySelector('.el-form-item__label');
    var t = inventoryNorm(lab && lab.textContent);
    if (t) return t;
    return inventoryNorm(el.getAttribute && el.getAttribute('placeholder'));
  }
  return inventoryNorm(el.textContent || el.getAttribute && el.getAttribute('title') || el.getAttribute && el.getAttribute('aria-label'));
}
function collectInventoryHosts() {
  var sel = [
    '.el-form-item input:not([type="hidden"])',
    '.el-form-item textarea',
    '.el-form-item .el-select .el-input__inner',
    'button.el-button, .el-button, button',
    '.menu-item, .submenu-item, .el-menu-item, .el-submenu__title, [role="menuitem"]',
  ].join(',');
  var nodes = document.querySelectorAll(sel);
  var out = [];
  var seen = typeof WeakSet !== 'undefined' ? new WeakSet() : null;
  for (var i = 0; i < nodes.length; i++) {
    var el = nodes[i];
    if (!inventoryVisible(el)) continue;
    var host = el.closest && (el.closest('button, .el-button, .menu-item, .el-menu-item, .el-form-item') || el) || el;
    if (seen) { if (seen.has(host)) continue; seen.add(host); }
    var kind = inventoryKindOf(host.matches && host.matches('input, textarea') ? host : (host.querySelector && host.querySelector('input, textarea, .el-input__inner, button, .el-button') || host));
    var operable = host;
    if (kind.indexOf('form_') === 0) {
      operable = host.querySelector && (host.querySelector('input:not([type="hidden"]), textarea, .el-select .el-input__inner') || host);
    }
    var text = inventoryTextOf(operable, kind);
    out.push({ el: operable, text: text, kind: kind });
    if (out.length >= INVENTORY_CAP) break;
  }
  return out;
}
function kindsForAction(action) {
  var a = String(action || '');
  if (a === 'fill_form_field') return { form_input:1, form_date:1, form_radio:1, form_checkbox:1, form_tree_select:1 };
  if (a === 'select_option') return { form_select:1 };
  if (a === 'click_menu_item') return { menu:1 };
  if (a === 'click_element_by_index') return { button:1, icon:1, menu:1 };
  return null; // all kinds
}
function filterInventoryByKind(list, action) {
  var allow = kindsForAction(action);
  if (!allow) return list.slice();
  return list.filter(function (it) { return !!allow[it.kind]; });
}
function filterInventoryByText(list, needle) {
  var n = inventoryNorm(needle).toLowerCase();
  if (!n) return list.slice();
  return list.filter(function (it) {
    return inventoryNorm(it.text).toLowerCase().indexOf(n) >= 0;
  });
}
```

Tune host/operable selection so snaps match today’s resolve quality; prefer minimal diffs if existing helper utils already expose visibility/text.

- [ ] **Step 2: Sync `_locator_helpers_js.py`**

Copy the same block into the Python dual string (or run whatever sync script this repo uses). Ensure marker `SHARED_INVENTORY_COLLECT` appears in both files.

- [ ] **Step 3: Re-run char — helper asserts PASS, resolve asserts still FAIL**

```bash
node scripts/characterization/characterize-resolve-inventory.mjs
```

- [ ] **Step 4: Commit** (if user asks)

```bash
git add src/cdp/page-locator-helpers.js scripts/controller/actions/js_snippets/_locator_helpers_js.py
git commit -m "feat: CDP inventory collect for auto-grab fullpage"
```

---

### Task 3: Wire `mode=inventory` in resolve-by-label

**Files:**
- Modify: `src/cdp/resolve-by-label.js` (`buildResolveExpression`, `resolveElementByLabel`)
- Test: `scripts/characterization/characterize-resolve-inventory.mjs`

**Interfaces:**
- Consumes: `collectInventoryHosts`, filters, `refineCollidingRegions`, existing `snap` / `pushHostsRefined`
- Produces:
  - `buildResolveExpression({ labelText, actionType, params, mode })`
  - `resolveElementByLabel(client, { …, mode })`
  - When `mode==='inventory'` (default if omitted in product path — **implement default in service/Vue**; Node resolve treats missing mode as inventory when called from product, or explicit `'inventory'`):
    - page returns array of snap objects
  - Node: `forceAmbiguous = !labelText && matches.length >= 1` → always `{ ambiguous:true, matches }`
  - `truncated` optional on result when page sets flag / list hit cap

- [ ] **Step 1: Extend `buildResolveExpression` signature**

```js
export function buildResolveExpression({
  labelText = '',
  actionType = '',
  params = {},
  mode = 'needle',
} = {}) {
  // stringify mode into IIFE
  // if mode === 'inventory': early branch collecting inventory → refine → snap → return out
  // else: existing needle body unchanged
}
```

Inventory branch sketch (inside page IIFE, after helpers available):

```js
if (mode === 'inventory') {
  var inv = collectInventoryHosts();
  inv = filterInventoryByKind(inv, action);
  inv = filterInventoryByText(inv, needle);
  var hostList = inv.map(function (it) { return it.el; });
  // Prefer pushHostsRefined with per-item kind/text:
  // group by text for collision key — reuse refineCollidingRegions on hosts
  // then snap each with matchedLabel = item.text, kind = item.kind
  return out;
}
```

Exact wiring: map inventory items → `{el, region}` via `assignRegion` then `refineCollidingRegions`, then `snap(el, text, asForm, kind, region)`.

`asForm = kind.indexOf('form_') === 0`.

- [ ] **Step 2: Node post-process**

```js
export async function resolveElementByLabel(client, opts = {}) {
  const mode = String(opts.mode || 'needle').trim() || 'needle';
  const labelText = String(opts.labelText || opts.label_text || '').trim();
  // Relax 400: allow inventory with empty label+action
  if (mode !== 'inventory' && !labelText && !actionType && !Object.keys(params).length) {
    // existing 400
  }
  // evaluate with mode
  const matches = list.map(enrichOne);
  const truncated = list.length >= 120; // or read flag from page
  if (!labelText && matches.length >= 1) {
    return { ambiguous: true, matches, ...(truncated ? { truncated: true } : {}) };
  }
  if (matches.length === 1) {
    return { element: matches[0].element, matchedLabel: matches[0].matchedLabel };
  }
  return { ambiguous: true, matches, ...(truncated ? { truncated: true } : {}) };
}
```

- [ ] **Step 3: Run characterization — PASS**

```bash
node scripts/characterization/characterize-resolve-inventory.mjs
node scripts/characterization/characterize-resolve-collision-titlebox.mjs
```

Expected: both `ok`

- [ ] **Step 4: Commit** (if user asks)

```bash
git add src/cdp/resolve-by-label.js
git commit -m "feat: resolve-element inventory mode from fullpage pool"
```

---

### Task 4: Service / route / executor / docs / CHANGELOG

**Files:**
- Modify: `src/services/trajectory/trajectory-record-lifecycle.js` (`resolveTrajectoryElement`)
- Modify: `src/routes/v2/trajectory-record.js`
- Modify: `src/cdp/remote-bridge/index.js`
- Modify: `executor/session-handler.js` (+ `bibResolveElement` impl file if separate)
- Modify: `src/dashboard/api-docs/groups/recording.js`
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: `mode` from HTTP body / executor payload
- Produces: same resolve response shapes + optional `truncated`

- [ ] **Step 1: Pass `mode` end-to-end**

```js
// trajectory-record.js
actionType: body.actionType ?? body.action ?? '',
params: body.params || {},
mode: body.mode ?? 'inventory',

// resolveTrajectoryElement({ …, mode })
// USE_EXECUTOR send: { …, mode }
// remoteBridge.resolveElementByLabelText(label, { actionType, params, mode })

// session-handler bib_resolve_element:
mode: payload.mode || 'inventory',
```

Relax service 400 when `mode==='inventory'` even if label and action empty.

- [ ] **Step 2: api-docs notes**

Update resolve-element summary/notes:

- default `mode: inventory` — fullpage operable pool; optional filters
- no labelText → always `ambiguous` list for UI
- `mode: needle` — legacy label needle search

- [ ] **Step 3: CHANGELOG `[Unreleased]` Added/Changed**

Include Python sync tip: pass `mode` on resolve-element / bib_resolve_element.

- [ ] **Step 4: Commit** (if user asks)

```bash
git add src/services/trajectory/trajectory-record-lifecycle.js src/routes/v2/trajectory-record.js src/cdp/remote-bridge/index.js executor/session-handler.js src/dashboard/api-docs/groups/recording.js CHANGELOG.md
git commit -m "feat: plumb resolve-element inventory mode through API and executor"
```

---

### Task 5: Vue — optional filters, inventory call, infer actionType

**Files:**
- Modify: `D:/dev/ui-auto-recording-agent-vue-master/vue-project/src/api/recording.ts`
- Modify: `D:/dev/ui-auto-recording-agent-vue-master/vue-project/src/views/ui-recording/detail/components/OperationDialog.vue`
- Test: manual / typecheck; no mandatory e2e in P0

**Interfaces:**
- Consumes: resolve response `{ ambiguous, matches, element, truncated? }`
- Produces: `inferActionTypeFromKind(kind: string): string`

- [ ] **Step 1: API type**

```ts
export function resolveElement(
  trajectoryId: number,
  data: {
    labelText?: string
    actionType?: string
    params?: Record<string, unknown>
    mode?: 'inventory' | 'needle'
  },
) {
  return post<ResolveElementResult>(
    `/v2/trajectories/${trajectoryId}/resolve-element`,
    data,
    { timeout: 25000 },
  )
}
```

Extend `ResolveElementResult` with `truncated?: boolean`.

- [ ] **Step 2: `canAutoGrab` / reasons**

```ts
const canAutoGrab = computed(() => {
  return !grabbing.value && !!props.prepareReady
})
const autoGrabDisabledReason = computed(() => {
  if (!props.prepareReady) return '请先申请浏览器资源'
  return ''
})
```

Hint text: 操作类型与文案均为可选过滤；空文案则列出当前页可见可操作控件。

- [ ] **Step 3: `handleAutoGrab`**

```ts
const result = await resolveElement(tid, {
  labelText: labelForGrab.value || undefined,
  actionType: normalizeActionType(form.actionType) || form.actionType.trim() || undefined,
  params: buildParams(),
  mode: 'inventory',
})
if (result.ambiguous && Array.isArray(result.matches) && result.matches.length) {
  if (result.truncated) ElMessage.warning('控件较多已截断，可填写文案或选择类型缩小范围')
  await openAmbiguousPicker(result.matches)
  return
}
applyResolvedMatch(result.element || null, result.matchedLabel)
```

Ambiguous dialog title: `选择控件` when `!labelForGrab` else keep `选择匹配的控件`.

- [ ] **Step 4: Infer action on pick**

```ts
function inferActionTypeFromKind(kind: string): string {
  const k = String(kind || '')
  if (k === 'form_select' || k === 'select') return 'select_option'
  if (k.startsWith('form_')) return 'fill_form_field'
  if (k === 'menu') return 'click_menu_item'
  return 'click_element_by_index'
}

function applyResolvedMatch(el: ElementJson | null | undefined, matchedLabel?: string) {
  // existing locator fill…
  if (!form.actionType.trim() && el) {
    const kind = str((el as any).target_kind || (el as any).targetKind)
    const inferred = inferActionTypeFromKind(kind)
    form.actionType = inferred
    // ensure param fields exist then set text/label_text/menu_text from matchedLabel
    const label = str(matchedLabel || el.text || '').trim()
    if (label) {
      if (inferred === 'fill_form_field') paramValues.value = { ...paramValues.value, label_text: label }
      else if (inferred === 'click_menu_item') paramValues.value = { ...paramValues.value, menu_text: label, text: label }
      else if (inferred === 'select_option') paramValues.value = { ...paramValues.value, label_text: label }
      else paramValues.value = { ...paramValues.value, text: label }
    }
  }
  // …
}
```

Also call infer path from `confirmAmbiguousPick` (already uses `applyResolvedMatch`).

- [ ] **Step 5: Smoke checklist (manual)**

1. prepareReady → 无类型无文案 → 自动抓取 → 选择器多 kind  
2. 选一条无类型 → 表单出现推断的 actionType  
3. 有类型无文案 → 清单仅该 kind  
4. 有文案唯一 → 直写（不弹）  
5. 保存后 xpath_smart 仍为锚定串  

- [ ] **Step 6: Commit Vue** (if user asks)

```bash
cd D:/dev/ui-auto-recording-agent-vue-master
git add vue-project/src/api/recording.ts vue-project/src/views/ui-recording/detail/components/OperationDialog.vue
git commit -m "feat: auto-grab fullpage inventory with optional filters"
```

---

### Task 6: Spec status + backlog pointer

**Files:**
- Modify: `docs/superpowers/specs/2026-08-10-auto-grab-fullpage-inventory-design.md` status → Implemented  
- Modify: `docs/superpowers/backlog-visible-editable-controls.md` AG-fullpage row → 代码已实施（湿测按需）  
- Modify: `docs/superpowers/todos/2026-08-10-auto-grab-fullpage-same-name.md` Status  

- [ ] **Step 1: Update status lines after chars green + Vue landed**
- [ ] **Step 2: Commit docs** (if user asks)

---

## Self-review (plan vs spec)

| Spec requirement | Task |
|------------------|------|
| 形态 B / 路径甲 / mode inventory | 3–5 |
| actionType + label optional filters | 3–5 |
| no label → always picker | 3 (forceAmbiguous) + 5 |
| with label: 1 direct / ≥2 picker | 3 |
| kind whitelist by action | 2 (`kindsForAction`) |
| titlebox / L1 same-name | 3 reuses refine |
| infer actionType on pick | 5 |
| truncated 120 | 2–3 |
| needle compat | 3 |
| api-docs + CHANGELOG | 4 |
| no auto-fill page / no region replay primary | Global Constraints |

No TBD placeholders. Executor `mode` plumbing included (Task 4).

---

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-08-10-auto-grab-fullpage-inventory.md`.

**Two execution options:**

1. **Subagent-Driven (recommended)** — fresh subagent per task, review between tasks  
2. **Inline Execution** — this session with executing-plans checkpoints  

Which approach?
