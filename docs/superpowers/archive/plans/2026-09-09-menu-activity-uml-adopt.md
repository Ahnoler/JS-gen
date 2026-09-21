# Menu Activity-Level umlEcd Adopt Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Menu JSON import stores each managePage’s **activity** `umlEcd` on `system_page`; scan adopt fills navigable leaves with that activity code on unique pageId match (never the intermediate subdomain code via pageId).

**Architecture:** Add nullable `system_page.activity_uml_ecd`. `collectPages` attaches `activityUmlEcd` from the activity node; on duplicate `pageId` with a different activity code, clear `activityUmlEcd` (1:N → adopt skips). `pickUmlEcdFromIntermediates` takes intermediates shaped `{ name, umlEcd, pages: [{ pageId, activityUmlEcd }] }` — name match still returns subdomain `umlEcd`; pageId match returns the sole non-empty `activityUmlEcd` across all intermediates’ pages.

**Tech Stack:** Node.js (Knex migration, Express services), existing characterization `.mjs` pins, `verify-all.sh`.

**Spec:** [`docs/superpowers/specs/2026-09-09-menu-activity-uml-adopt-design.md`](../specs/2026-09-09-menu-activity-uml-adopt-design.md)

## Global Constraints

- Navigable leaf modeling identity = **activity** `umlEcd` (`umlType=3`), not leaf-subdomain code, when adopting by pageId.
- 1:N shared `pdCmptEcd`: **only unique** activity code → adopt; ambiguous → no pageId adopt.
- Do **not** auto-split navigable leaves from activities; intermediate directory semantics unchanged.
- Do **not** overwrite leaf `umlEcd` that already matches `/^UML/i`.
- Do **not** touch: fill/select unify, `.cursor/`, Vue partner UI, whitelist.
- Main session commits; subagents never commit.
- Characterization: `node scripts/characterization/characterize-menu-scan-uml-adopt.mjs`, `node scripts/characterization/characterize-system-import-json.mjs`.

## File map

| File | Role |
|---|---|
| `migrations/20260909170000_system_page_activity_uml_ecd.js` | Add `activity_uml_ecd` VARCHAR(64) |
| `src/dao/system-page-dao.js` | Persist `activityUmlEcd` in `replaceForNode` |
| `src/services/menu-json-import.js` | `collectPages` → `activityUmlEcd` + 1:N clear |
| `src/services/menu-scan-uml-adopt.js` | pageId → activity code; new intermediate shape |
| `src/services/menu-scan-apply.js` | Build `pages: [{pageId, activityUmlEcd}]` for adopt |
| `scripts/characterization/characterize-menu-scan-uml-adopt.mjs` | Unique / ambiguous / name / no-overwrite |
| `scripts/characterization/characterize-system-import-json.mjs` | Assert `activityUmlEcd` on plan pages; shared-page clear |

---

### Task 1: Red — uml-adopt characterization (new contract)

**Files:**
- Modify: `scripts/characterization/characterize-menu-scan-uml-adopt.mjs`
- Test: same

**Interfaces:**
- Consumes: nothing yet
- Produces: FAIL until Task 4 implements new `pickUmlEcdFromIntermediates` shape

- [ ] **Step 1: Rewrite pin to activity-page contract**

Replace `testPickByPageId` and add ambiguity; update name fixtures to use `pages` (keep backward-compatible: if implementation still accepts legacy `pageIds` only for name tests, prefer **one** shape — use `pages` everywhere):

```js
function testPickByName() {
  const inter = [
    { name: '对公客户管理', umlEcd: 'UML00005556', pages: [{ pageId: 'ZJJK1', activityUmlEcd: 'UML_ACT_1' }] },
    { name: '产品要素管理', umlEcd: 'UML00092663', pages: [{ pageId: 'ZJJK_E', activityUmlEcd: 'UML00031596' }] },
  ];
  assert.equal(
    pickUmlEcdFromIntermediates({ name: '对公客户管理', umlEcd: '9001' }, inter),
    'UML00005556',
  );
  assert.equal(
    pickUmlEcdFromIntermediates({ name: '产品要素库', umlEcd: '9002' }, inter),
    '',
    'different SUT leaf name does not steal group uml',
  );
}

function testPickByPageIdUniqueActivity() {
  const inter = [
    {
      name: '产品信息管理',
      umlEcd: 'UML00092662',
      pages: [
        { pageId: 'ZJJK00110131', activityUmlEcd: 'UML00057701' },
        { pageId: 'ZJJK00095454', activityUmlEcd: 'UML00031743' },
      ],
    },
  ];
  assert.equal(
    pickUmlEcdFromIntermediates({ name: '产品库管理', pageId: 'ZJJK00110131', umlEcd: '1' }, inter),
    'UML00057701',
    'pageId adopt uses activity code, not subdomain UML00092662',
  );
}

function testPickByPageIdAmbiguous() {
  const inter = [
    {
      name: '公告',
      umlEcd: 'UML_GROUP',
      pages: [
        { pageId: 'ZJJK00109712', activityUmlEcd: '' }, // cleared at import for 1:N
      ],
    },
  ];
  assert.equal(
    pickUmlEcdFromIntermediates({ name: '查看公告', pageId: 'ZJJK00109712', umlEcd: '9' }, inter),
    '',
  );
  // Also: two non-empty different codes for same pageId across pages arrays
  const inter2 = [
    {
      name: 'G',
      umlEcd: 'UML_G',
      pages: [
        { pageId: 'ZJJK_SHARE', activityUmlEcd: 'UML_A' },
        { pageId: 'ZJJK_SHARE', activityUmlEcd: 'UML_B' },
      ],
    },
  ];
  assert.equal(
    pickUmlEcdFromIntermediates({ name: 'X', pageId: 'ZJJK_SHARE', umlEcd: '1' }, inter2),
    '',
  );
}
```

Keep `testIsModelingUmlEcd` and `testDoNotOverwriteModelingUml` (update inter to `pages: []`).

Register new tests in `main()`.

- [ ] **Step 2: Run — expect FAIL**

```bash
node scripts/characterization/characterize-menu-scan-uml-adopt.mjs
```

Expected: FAIL (old pick still returns subdomain code / ignores `pages`).

- [ ] **Step 3: Commit**

```bash
git add scripts/characterization/characterize-menu-scan-uml-adopt.mjs
git commit -m "test(menu): red pin activity-level umlEcd adopt by pageId"
```

---

### Task 2: Migration + DAO

**Files:**
- Create: `migrations/20260909170000_system_page_activity_uml_ecd.js`
- Modify: `src/dao/system-page-dao.js`

**Interfaces:**
- Produces: column `activity_uml_ecd` VARCHAR(64) NULL or `''` default; DAO insert field `activityUmlEcd`

- [ ] **Step 1: Migration**

```js
/**
 * system_page.activity_uml_ecd — modeling activity umlEcd for this managePage
 * (menu JSON import); used by scan adopt instead of intermediate subdomain code.
 */
export async function up(knex) {
  if (!(await knex.schema.hasColumn('system_page', 'activity_uml_ecd'))) {
    await knex.schema.alterTable('system_page', (t) => {
      t.string('activity_uml_ecd', 64).notNullable().defaultTo('')
        .comment('活动级 umlEcd（建模 umlType=3）；导入写入，扫描 pageId 回填用')
        .after('page_type');
    });
    console.log('[migration] added system_page.activity_uml_ecd');
  }
}

export async function down(knex) {
  if (await knex.schema.hasColumn('system_page', 'activity_uml_ecd')) {
    await knex.schema.alterTable('system_page', (t) => {
      t.dropColumn('activity_uml_ecd');
    });
    console.log('[migration] dropped system_page.activity_uml_ecd');
  }
}
```

- [ ] **Step 2: DAO `replaceForNode`**

In the `toDbRow({...})` map, add:

```js
activityUmlEcd: String(p.activityUmlEcd ?? ''),
```

Update JSDoc on `pages` items to mention `activityUmlEcd`.

- [ ] **Step 3: Commit**

```bash
git add migrations/20260909170000_system_page_activity_uml_ecd.js src/dao/system-page-dao.js
git commit -m "feat(db): system_page.activity_uml_ecd for menu adopt"
```

---

### Task 3: Import `collectPages` → activityUmlEcd + 1:N clear

**Files:**
- Modify: `src/services/menu-json-import.js` (`collectPages`)
- Modify: `scripts/characterization/characterize-system-import-json.mjs`

**Interfaces:**
- Produces: plan pages `{ pageId, pageName, resPath, pageType, activityUmlEcd }`
- 1:N: when same `pageId` seen again with a **different** non-empty activity code, set existing row’s `activityUmlEcd` to `''` (do not insert second row; keep `seen` dedupe)

- [ ] **Step 1: Update `collectPages`**

```js
function collectPages(node, opts = {}) {
  const wantAll = !!opts.all;
  const pages = [];
  const seen = new Set();
  const children = Array.isArray(node.children) ? node.children : [];
  let skippedExtraManage = 0;
  for (const child of children) {
    if (String(child.umlType) !== '3') continue;
    const managePage = child.managePage;
    const pageId = managePage ? String(managePage.pdCmptEcd || '').trim() : '';
    if (!pageId) continue;
    const activityUmlEcd = String(child.umlEcd || '').trim();
    if (seen.has(pageId)) {
      const existing = pages.find((p) => p.pageId === pageId);
      if (
        existing &&
        activityUmlEcd &&
        existing.activityUmlEcd &&
        existing.activityUmlEcd !== activityUmlEcd
      ) {
        existing.activityUmlEcd = ''; // 1:N ambiguous → adopt must skip
      }
      continue;
    }
    if (!wantAll && pages.length > 0) {
      skippedExtraManage += 1;
      continue;
    }
    seen.add(pageId);
    pages.push({
      pageId,
      pageName: String(managePage.pdCmptNm || '').trim(),
      resPath: String(managePage.resPath || '').trim(),
      pageType: 'managePage',
      activityUmlEcd,
    });
  }
  // ... existing warn unchanged
  return pages;
}
```

Update JSDoc `@returns` to include `activityUmlEcd`.

- [ ] **Step 2: Characterization assertions**

In `characterize-system-import-json.mjs`:

1. After building product-style intermediate with unique pages, assert e.g. page `ZJJK_E` has non-empty `activityUmlEcd` matching the activity fixture’s `umlEcd` (extend existing leaf fixtures that already set activity `umlEcd`).
2. In `testBuildPlanSharedManagePageDedup` (公告 shared `ZJJK00109712`): after plan build, assert the single page’s `activityUmlEcd === ''` (two activities cleared).

If existing activity helpers omit `umlEcd`, add them in the fixture factory:

```js
const activity = (nm, mp, umlEcd = '') => ({
  umlEcd: umlEcd || `UML_${nm}`,
  umlNm: nm,
  umlType: '3',
  managePage: mp,
});
```

(Adjust to match current helper signature without breaking other asserts.)

- [ ] **Step 3: Run import characterization**

```bash
node scripts/characterization/characterize-system-import-json.mjs
```

Expected: OK

- [ ] **Step 4: Commit**

```bash
git add src/services/menu-json-import.js scripts/characterization/characterize-system-import-json.mjs
git commit -m "feat(menu-import): store activityUmlEcd; clear on shared pageId"
```

---

### Task 4: Green — `pickUmlEcdFromIntermediates` + apply wiring

**Files:**
- Modify: `src/services/menu-scan-uml-adopt.js`
- Modify: `src/services/menu-scan-apply.js` (`adoptModelingUmlEcdUnderSystem`)
- Test: `scripts/characterization/characterize-menu-scan-uml-adopt.mjs`

**Interfaces:**
- Consumes: intermediate `{ name, umlEcd, pages: Array<{ pageId: string, activityUmlEcd: string }> }`
- Produces: pageId path returns unique activity code or `''`

- [ ] **Step 1: Rewrite pick**

```js
/**
 * @param {{ name: string, pageId?: string, umlEcd?: string }} nav
 * @param {Array<{ name: string, umlEcd: string, pages?: Array<{ pageId: string, activityUmlEcd?: string }>, pageIds?: string[] }>} intermediates
 * @returns {string}
 */
export function pickUmlEcdFromIntermediates(nav, intermediates) {
  const list = Array.isArray(intermediates) ? intermediates : [];
  const navName = String(nav?.name || '').trim();
  const navPageId = String(nav?.pageId || '').trim();
  const existing = String(nav?.umlEcd || '').trim();
  if (isModelingUmlEcd(existing)) return '';

  if (navName) {
    const byName = list.find(
      (i) => String(i.name || '').trim() === navName && isModelingUmlEcd(i.umlEcd),
    );
    if (byName) return String(byName.umlEcd).trim();
  }

  if (navPageId) {
    const codes = [];
    for (const i of list) {
      const pages = Array.isArray(i.pages) ? i.pages : [];
      for (const p of pages) {
        if (String(p.pageId || '').trim() !== navPageId) continue;
        const act = String(p.activityUmlEcd || '').trim();
        if (act) codes.push(act);
      }
    }
    const uniq = [...new Set(codes)];
    if (uniq.length === 1 && isModelingUmlEcd(uniq[0])) return uniq[0];
  }
  return '';
}
```

Update file header comment: pageId → **activity** umlEcd; 1:N skip.

- [ ] **Step 2: `adoptModelingUmlEcdUnderSystem` build shape**

Replace `pageIds` aggregation with pages from DAO rows:

```js
const pagesByNode = new Map();
for (const p of pages) {
  const nid = Number(p.systemNodeId);
  if (!pagesByNode.has(nid)) pagesByNode.set(nid, []);
  const pageId = String(p.pageId || '').trim();
  if (!pageId) continue;
  pagesByNode.get(nid).push({
    pageId,
    activityUmlEcd: String(p.activityUmlEcd || '').trim(),
  });
}
const intermediates = interNodes.map((i) => ({
  name: String(i.name || ''),
  umlEcd: String(i.umlEcd || ''),
  pages: pagesByNode.get(Number(i.id)) || [],
}));
```

- [ ] **Step 3: Run uml-adopt pin — expect OK**

```bash
node scripts/characterization/characterize-menu-scan-uml-adopt.mjs
```

Expected: OK

- [ ] **Step 4: Commit**

```bash
git add src/services/menu-scan-uml-adopt.js src/services/menu-scan-apply.js
git commit -m "fix(menu-scan): adopt activity umlEcd by unique pageId"
```

---

### Task 5: Docs close + optional wet note

**Files:**
- Modify: `docs/superpowers/specs/2026-09-09-menu-activity-uml-adopt-design.md` (status → 已落地; link this plan)
- Modify: `docs/superpowers/agent-log.md` (收工)
- Modify: `docs/superpowers/todo-list.md` only if a menu-line bullet should mention the fix (optional, one line)

**Interfaces:** none

- [ ] **Step 1: Spec status line**

Set **状态**：已落地（plan 本文件；表征 uml-adopt + import-json OK）

- [ ] **Step 2: Wet path (manual, not coded)**

Document in 收工/遗留：部署迁移 → `systemId=1` 再导入同份建模 JSON → 触发扫描 apply 或调用 `adoptModelingUmlEcdUnderSystem` → 核对产品四叶表（spec §4.2）。同事已手工改码的可作对照。

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/specs/2026-09-09-menu-activity-uml-adopt-design.md docs/superpowers/agent-log.md
git commit -m "docs: close menu activity umlEcd adopt design"
```

---

## Spec coverage (self-review)

| Spec item | Task |
|---|---|
| `activity_uml_ecd` column + DAO | T2 |
| `collectPages` activity code | T3 |
| 1:N clear / only unique adopt | T3 + T4 |
| Name match → subdomain code | T4 |
| No overwrite existing UML… | T1/T4 unchanged |
| Characterization unique/ambiguous/name | T1 + T4 |
| Import plan asserts | T3 |
| No activity-split nav leaves | Global / untouched flatten |
| Stock re-import + adopt | T5 wet note |

No TBD placeholders. Intermediate shape `pages` consistent across T1/T4.
