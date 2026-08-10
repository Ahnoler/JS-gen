# Resolve-Element Auto-Grab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make product「新增步骤 → 自动抓取」work again for `fill_form_field` / `select_option` / `click_element_by_index` by sending action-aware requests from Vue and returning only verified relative `xpath_smart` (with user-picked disambiguation when multiple labels match).

**Architecture:** Keep CDP page matching in `buildResolveExpression` (`src/cdp/resolve-by-label.js`). Gate branches by `actionType`; expand click search to sidebar/menu nodes; post-filter every candidate so only `locator_verified + xpath_smart` survive. Vue `OperationDialog` sends `{ actionType, params, labelText }` and shows a radio list on `ambiguous`.

**Tech Stack:** Node ESM (JS-gen CDP + Express), Vue 3 + Element Plus (vue-project), characterization via `node scripts/characterization/*.mjs`.

**Spec:** `docs/superpowers/specs/2026-08-10-resolve-element-auto-grab-design.md`

## Global Constraints

- In-scope actions only: `fill_form_field`, `select_option`, `click_element_by_index`.
- Missing / out-of-scope `actionType` → **400** (no legacy label-only broad search).
- Usable candidate requires **verified** `xpath_smart`; primary `xpath` = that smart value.
- Multiple usable matches → HTTP 200 `{ ambiguous: true, matches }` — never silent first-pick.
- Do not change AI recording / manual_recorder CDP paths in this plan.
- Executor BiB already calls the same `resolveElementByLabel` — one backend fix covers both.
- JS-gen CHANGELOG `[Unreleased]` required for route/docs/behavior; Python sync: 无（可选对齐请求体）.
- Vue lives in `D:\dev\ui-auto-recording-agent-vue-master\vue-project` — commit there separately.

## File map

| File | Responsibility |
|------|----------------|
| `src/cdp/resolve-by-label.js` | Action-gated DOM expression; filter verified relative; 400/404 messages |
| `scripts/characterization/characterize-resolve-element-auto-grab.mjs` | Source + pure-helper characterization for branches / filter / collapse |
| `src/dashboard/api-docs/groups/recording.js` | Request/response examples + notes |
| `CHANGELOG.md` | Unreleased Fixed/Changed entry |
| Vue `src/api/recording.ts` | Typed `resolveElement` body + ambiguous response |
| Vue `.../OperationDialog.vue` | Send actionType/params; candidate picker UI |

---

### Task 1: Characterization harness (TDD — fail first)

**Files:**
- Create: `scripts/characterization/characterize-resolve-element-auto-grab.mjs`
- Modify (later tasks): `src/cdp/resolve-by-label.js`

**Interfaces:**
- Consumes (after Task 2): exported helpers from `resolve-by-label.js`:
  - `buildResolveExpression({ labelText, actionType, params }) -> string`
  - `filterVerifiedRelativeMatches(matches: Array<{element, matchedLabel, preview?}>) -> same shape[]`
  - `SUPPORTED_RESOLVE_ACTIONS` frozen list of three action names
- Produces: failing characterization that Task 2 must green

- [ ] **Step 1: Write failing characterization**

Create `scripts/characterization/characterize-resolve-element-auto-grab.mjs`:

```js
/**
 * Characterize resolve-element auto-grab (action-aware + verified xpath_smart).
 *
 *   node scripts/characterization/characterize-resolve-element-auto-grab.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  buildResolveExpression,
  filterVerifiedRelativeMatches,
  SUPPORTED_RESOLVE_ACTIONS,
} from '../../src/cdp/resolve-by-label.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(__dirname, '../../src/cdp/resolve-by-label.js'), 'utf8');

function ok(name) {
  console.log(`ok: ${name}`);
}

{
  assert.deepEqual(
    [...SUPPORTED_RESOLVE_ACTIONS].sort(),
    ['click_element_by_index', 'fill_form_field', 'select_option'].sort(),
  );
  ok('SUPPORTED_RESOLVE_ACTIONS');
}

{
  const fill = buildResolveExpression({
    labelText: '客户名称',
    actionType: 'fill_form_field',
    params: { label_text: '客户名称' },
  });
  assert.match(fill, /el-form-item/);
  assert.match(fill, /fill_form_field/);
  // PAGE_LOCATOR_HELPERS may mention menu-item tokens; assert form early-return instead
  assert.match(fill, /action === 'fill_form_field'|actionType === 'fill_form_field'/);
  assert.match(fill, /return out/);
  ok('fill expression scopes to form');
}

{
  const sel = buildResolveExpression({
    labelText: '币种',
    actionType: 'select_option',
    params: { label_text: '币种', option_text: '人民币' },
  });
  assert.match(sel, /el-form-item/);
  assert.match(sel, /el-select|form_select/);
  ok('select expression scopes to form');
}

{
  const click = buildResolveExpression({
    labelText: '对公客户管理',
    actionType: 'click_element_by_index',
    params: { text: '对公客户管理', index: -1 },
  });
  assert.match(click, /\.menu-item|\.el-menu-item/);
  assert.match(click, /button|\.el-button/);
  assert.match(click, /click_element_by_index/);
  ok('click expression includes menu + buttons');
}

{
  const usable = filterVerifiedRelativeMatches([
    {
      matchedLabel: 'A',
      element: {
        xpath: '//x',
        xpath_smart: '//x',
        locator_verified: true,
        locator_strategy: 'xpath_smart',
      },
      preview: { xpath_smart: '//x' },
    },
    {
      matchedLabel: 'B',
      element: {
        xpath: '/html/1',
        xpath_smart: '',
        locator_verified: false,
        locator_strategy: 'xpath_full',
      },
      preview: { xpath_smart: '' },
    },
  ]);
  assert.equal(usable.length, 1);
  assert.equal(usable[0].matchedLabel, 'A');
  assert.equal(usable[0].element.xpath, '//x');
  ok('filter keeps only verified xpath_smart');
}

{
  assert.match(SRC, /SUPPORTED_RESOLVE_ACTIONS|unsupported|out-of-scope|not supported/i);
  assert.match(SRC, /无可用相对定位|xpath_smart/);
  ok('source mentions unsupported action + relative xpath failure copy');
}

console.log('characterize-resolve-element-auto-grab: PASS');
```

- [ ] **Step 2: Run characterization — expect FAIL**

Run: `node scripts/characterization/characterize-resolve-element-auto-grab.mjs`

Expected: FAIL (missing exports `filterVerifiedRelativeMatches` / `SUPPORTED_RESOLVE_ACTIONS`, and/or expression assertions).

- [ ] **Step 3: Commit failing test only**

```bash
git add scripts/characterization/characterize-resolve-element-auto-grab.mjs
git commit -m "test: characterize resolve-element auto-grab contract"
```

---

### Task 2: Backend action gates + verified filter

**Files:**
- Modify: `src/cdp/resolve-by-label.js`
- Test: `scripts/characterization/characterize-resolve-element-auto-grab.mjs`

**Interfaces:**
- Produces:
  - `export const SUPPORTED_RESOLVE_ACTIONS = Object.freeze(['fill_form_field','select_option','click_element_by_index'])`
  - `export function filterVerifiedRelativeMatches(matches)` — drops entries without non-empty `element.xpath_smart` and `element.locator_verified === true`; forces `element.xpath = element.xpath_smart` and `locator_strategy = 'xpath_smart'`
  - `resolveElementByLabel(client, opts)` — validates action ∈ supported (after `normalizeActionName`); needle required; filters list; 0 usable after filter → 404 with `无可用相对定位` when raw DOM hits existed but all failed filter, else 找不到文案; 1 → unique; N → ambiguous
- Consumes: existing `buildResolveExpression`, `enrichLocatorFields`, `normalizeElementJson`, `toPreview`

- [ ] **Step 1: Add exports + filter helper**

Near top of `src/cdp/resolve-by-label.js` (after imports):

```js
export const SUPPORTED_RESOLVE_ACTIONS = Object.freeze([
  'fill_form_field',
  'select_option',
  'click_element_by_index',
]);

/**
 * @param {Array<{ matchedLabel?: string, element?: object, preview?: object }>} matches
 * @returns {typeof matches}
 */
export function filterVerifiedRelativeMatches(matches) {
  const list = Array.isArray(matches) ? matches : [];
  const out = [];
  for (const m of list) {
    const el = m?.element && typeof m.element === 'object' ? { ...m.element } : null;
    if (!el) continue;
    const smart = String(el.xpath_smart || '').trim();
    if (!smart || el.locator_verified !== true) continue;
    el.xpath_smart = smart;
    el.xpath = smart;
    el.locator_strategy = 'xpath_smart';
    el.locator_verified = true;
    out.push({
      matchedLabel: m.matchedLabel,
      element: el,
      preview: m.preview
        ? { ...m.preview, xpath_smart: smart, locator_strategy: 'xpath_smart' }
        : toPreview(el),
    });
  }
  return out;
}
```

- [ ] **Step 2: Rewrite page expression branching for the three actions**

Inside `buildResolveExpression` IIFE, after `needle` / `action` locals, **prefer action-gated early returns**:

1. If `action === 'fill_form_field' || action === 'select_option'`: run **only** the form-item label block (existing form matching + overlay prefer). For `select_option`, prefer `.el-select` / `kindHint = 'form_select'`. `return out` — do **not** fall through to generic clickables/menu.

2. If `action === 'click_element_by_index'`: run clickable search that includes buttons/links/tree **plus** sidebar/menu nodes (`.menu-item`, `.submenu-item`, `.el-menu-item`, `.el-submenu__title`, …). Exact-before-fuzzy; collapsed exact hits allowed (copy current menu block ~179–199). `return out` — do **not** run form-field matching.

3. Keep other specialized branches (`close_dialog`, `switch_tab`, `click_menu_item`, …) in the expression for legacy callers if needed; `resolveElementByLabel` will 400 unsupported product actions.

Sketch for click branch:

```js
    if (action === 'click_element_by_index') {
      const name = String(params.text || needle || '').trim();
      const nodes = document.querySelectorAll(
        '.menu-item, .submenu-item, .el-menu-item, .el-submenu__title, .el-dropdown-menu__item, [role="menuitem"], aside li, nav li, ' +
        '.el-dialog__footer button, .el-dialog__footer .el-button, .el-message-box__btns button, button.el-button, .el-button, button, a, .el-tree-node__content'
      );
      // exact / fuzzy + collapsed exact force-snap
      return out;
    }
```

- [ ] **Step 3: Gate `resolveElementByLabel` + filter after enrich**

```js
export async function resolveElementByLabel(client, opts = {}) {
  const labelText = String(opts.labelText || opts.label_text || '').trim();
  const actionType = normalizeActionName(opts.actionType || opts.action || '');
  const params = opts.params && typeof opts.params === 'object' ? opts.params : {};

  if (!SUPPORTED_RESOLVE_ACTIONS.includes(actionType)) {
    const err = new Error(
      `resolve-element requires actionType in ${SUPPORTED_RESOLVE_ACTIONS.join('|')} (got: ${actionType || '(empty)'})`,
    );
    err.statusCode = 400;
    throw err;
  }
  const needle = labelText
    || String(params.label_text || params.text || params.menu_text || params.button_text || '').trim();
  if (!needle) {
    const err = new Error('labelText or params.text / params.label_text is required');
    err.statusCode = 400;
    throw err;
  }
  // ... existing client check + Runtime.evaluate ...

  const rawList = /* existing list parse */;
  if (!rawList.length) {
    const err = new Error(`页上找不到「${needle}」对应的控件（请确认弹窗已打开且目标可见）`);
    err.statusCode = 404;
    throw err;
  }

  const matches = filterVerifiedRelativeMatches(rawList.map(enrichOne));
  if (!matches.length) {
    const err = new Error(
      `页上找到「${needle}」但无可用相对定位（xpath_smart 未通过校验）`,
    );
    err.statusCode = 404;
    throw err;
  }
  if (matches.length === 1) {
    return { element: matches[0].element, matchedLabel: matches[0].matchedLabel };
  }
  return { ambiguous: true, matches };
}
```

Update file header comment: this API returns **only** verified `xpath_smart`.

- [ ] **Step 4: Run characterization — expect PASS**

Run: `node scripts/characterization/characterize-resolve-element-auto-grab.mjs`  
Expected: `characterize-resolve-element-auto-grab: PASS`

Also: `node scripts/characterization/characterize-locator-candidates.mjs` — still PASS.

- [ ] **Step 5: Commit**

```bash
git add src/cdp/resolve-by-label.js scripts/characterization/characterize-resolve-element-auto-grab.mjs
git commit -m "fix: action-aware resolve-element with verified xpath_smart"
```

---

### Task 3: API docs + CHANGELOG

**Files:**
- Modify: `src/dashboard/api-docs/groups/recording.js` (resolve-element entry ~97–135)
- Modify: `CHANGELOG.md` `[Unreleased]`

**Interfaces:**
- Consumes: Task 2 response shapes
- Produces: docs + changelog only

- [ ] **Step 1: Update recording docs entry**

For `POST .../resolve-element`:

- `summary`: 按 actionType + params 从已附着页面解析相对 xpath_smart
- `reqExample`:

```js
J({
  labelText: '对公客户管理',
  actionType: 'click_element_by_index',
  params: { text: '对公客户管理', index: -1 },
})
```

- Notes must state: only three actions; verified xpath_smart required; ambiguous 200; click search includes sidebar menu; fill example with `label_text`

- [ ] **Step 2: CHANGELOG Unreleased Fixed entry**

```markdown
- 2026-08-10: **新增步骤自动抓取 `resolve-element` 动作感知 + 严格相对 xpath：** 请求需 `actionType`∈`fill_form_field|select_option|click_element_by_index` 与 `params`；点击元素搜索含侧栏菜单；仅返回已校验 `xpath_smart`；多匹配 `ambiguous+matches` 供前端自选。Vue 需同步传 actionType/params。
  影响范围：`POST /api/v2/trajectories/:id/resolve-element`、BiB resolve、产品新增步骤自动抓取。
  文件：src/cdp/resolve-by-label.js, src/dashboard/api-docs/groups/recording.js, scripts/characterization/characterize-resolve-element-auto-grab.mjs
  Python 同步提示：无（可选对齐请求体 actionType/params；scripts 不涉及）。
```

- [ ] **Step 3: Commit**

```bash
git add src/dashboard/api-docs/groups/recording.js CHANGELOG.md
git commit -m "docs: resolve-element auto-grab API notes and CHANGELOG"
```

---

### Task 4: Vue API + OperationDialog (separate repo)

**Files:**
- Modify: `D:\dev\ui-auto-recording-agent-vue-master\vue-project\src\api\recording.ts`
- Modify: `D:\dev\ui-auto-recording-agent-vue-master\vue-project\src\views\ui-recording\detail\components\OperationDialog.vue`

**Interfaces:**
- Consumes: Task 2 HTTP contract
- Produces: working auto-grab UX for the three actions

Git commits in the Vue project repo.

- [ ] **Step 1: Widen `resolveElement` types in `recording.ts`**

```ts
export type ResolveElementMatch = {
  matchedLabel: string
  element: ElementJson
  preview?: {
    tag?: string
    text?: string
    formLabel?: string
    xpath_smart?: string
    target_kind?: string
    locator_strategy?: string
  }
}

export type ResolveElementResult = {
  trajectoryId: number
  matchedLabel?: string
  element?: ElementJson
  ambiguous?: boolean
  matches?: ResolveElementMatch[]
}

export function resolveElement(
  trajectoryId: number,
  data: {
    labelText: string
    actionType: string
    params?: Record<string, unknown>
  },
) {
  return post<ResolveElementResult>(
    `/v2/trajectories/${trajectoryId}/resolve-element`,
    data,
    { timeout: 25000 },
  )
}
```

- [ ] **Step 2: Enablement + request body in `OperationDialog.vue`**

```ts
const AUTO_GRAB_ACTIONS = new Set([
  'fill_form_field',
  'select_option',
  'click_element_by_index',
])

const canAutoGrab = computed(() => {
  const act = normalizeActionType(form.actionType)
  return (
    AUTO_GRAB_ACTIONS.has(act)
    && !!labelForGrab.value
    && !grabbing.value
    && !!states.prepareReady
  )
})

const autoGrabDisabledReason = computed(() => {
  if (!form.actionType.trim()) return '请先选择操作类型'
  if (!AUTO_GRAB_ACTIONS.has(normalizeActionType(form.actionType))) {
    return '当前操作不支持自动抓取（仅填写字段 / 选择下拉 / 点击元素）'
  }
  if (!labelForGrab.value) return '请先填写字段标签 / 按钮文本（label_text / text）'
  if (!states.prepareReady) return '请先申请浏览器资源'
  return ''
})
```

`handleAutoGrab` must call:

```ts
const result = await resolveElement(tid, {
  labelText: labelForGrab.value,
  actionType: normalizeActionType(form.actionType) || form.actionType.trim(),
  params: buildParams(),
})
```

On unique hit: set locator from `el.xpath_smart || el.xpath`.  
On `ambiguous`: open picker (Step 3).  
Update hint:「按操作类型在已附着页面解析相对 XPath；重名时请选择一项。」

- [ ] **Step 3: Ambiguous candidate dialog**

State + confirm/cancel as in design §3; second `el-dialog` with `el-radio-group` listing `matchedLabel` / `target_kind` / truncated `xpath_smart`. Cancel leaves prior locator unchanged.

Match Element Plus radio API used in this codebase (`:label` vs `:value`).

- [ ] **Step 4: Manual verification checklist**

1. 点击元素「对公客户管理」→ unique or picker; relative xpath.  
2. 填写字段 → xpath_smart.  
3. 选择下拉 → form_select trigger.  
4. Duplicate labels → picker; cancel keeps old.  
5. Unsupported action → auto-grab disabled.

- [ ] **Step 5: Commit in Vue repo**

```bash
git add src/api/recording.ts src/views/ui-recording/detail/components/OperationDialog.vue
git commit -m "fix: resolve-element auto-grab sends actionType and disambiguates"
```

---

### Task 5: Cross-repo smoke

**Files:** none new

- [ ] **Step 1:** Re-run

```bash
node scripts/characterization/characterize-resolve-element-auto-grab.mjs
node scripts/characterization/characterize-locator-candidates.mjs
```

Expected: both PASS.

- [ ] **Step 2:** `/api/docs` recording → resolve-element notes show three actions + ambiguous.

- [ ] **Step 3:** No commit unless typo fix.

---

## Spec coverage (self-review)

| Spec requirement | Task |
|------------------|------|
| Vue sends actionType + params | Task 4 |
| Three actions only; else 400 / disabled | Task 2 + Task 4 |
| Verified xpath_smart only | Task 2 |
| Click includes sidebar menu | Task 2 |
| fill/select form-only | Task 2 |
| Ambiguous user pick | Task 4 |
| 404 找不到 vs 无可用相对定位 | Task 2 |
| API docs + CHANGELOG | Task 3 |
| Characterization | Task 1–2 |
| No AI/manual recorder changes | Global constraints |

## Placeholder / consistency check

- Names: `SUPPORTED_RESOLVE_ACTIONS`, `filterVerifiedRelativeMatches`, `buildResolveExpression`, `resolveElementByLabel`, `ResolveElementResult`.
- No TBD steps.
