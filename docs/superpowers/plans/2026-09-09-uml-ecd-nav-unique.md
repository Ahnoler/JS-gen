# Navigable uml_ecd Unique Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enforce uniqueness of non-empty `uml_ecd` among rows with non-empty `menu_xpath` via MySQL generated column `uml_ecd_nav` + UNIQUE, and reject conflicting writes in import/scan/adopt with `code: 'CONFLICT'`.

**Architecture:** Add STORED generated column + `uk_uml_ecd_nav`. Introduce `menu-uml-ecd-nav-guard.js` with `isNavigableUmlPair` + `assertUmlEcdNavAvailable` (DB lookup for another navigable row with same trim(uml_ecd)). Call the assert before updates that yield navigable+uml in `menu-scan-apply` (xpath write, `assignAiUmlEcdFromId`, adopt) and `menu-json-import` upsert when the resulting pair is navigable.

**Tech Stack:** Knex migrations (MySQL 5.7+), Node services, characterization `.mjs`, `verify-all.sh`.

**Spec:** [`docs/superpowers/specs/2026-09-09-uml-ecd-nav-unique-design.md`](../specs/2026-09-09-uml-ecd-nav-unique-design.md)

## Global Constraints

- Unique set = non-empty trim(`menu_xpath`) **and** non-empty trim(`uml_ecd`) only.
- Conflict → **reject** (`code: 'CONFLICT'` → HTTP 409); never clear old codes or steal.
- Do **not** UNIQUE whole-table `uml_ecd`; do **not** require xpath rows to have uml.
- Keep `idx_uml_ecd`; DAO must not insert into generated `uml_ecd_nav`.
- Main session commits; subagents never commit.
- Characterization: `node scripts/characterization/characterize-menu-uml-ecd-nav-guard.mjs`.

## File map

| File | Role |
|---|---|
| `migrations/20260909220000_system_uml_ecd_nav_unique.js` | Dup probe + generated col + UNIQUE |
| `src/services/menu-uml-ecd-nav-guard.js` | `isNavigableUmlPair`, `assertUmlEcdNavAvailable` |
| `src/services/menu-scan-apply.js` | Guard before xpath/uml writes |
| `src/services/menu-json-import.js` | Guard when resulting pair navigable |
| `scripts/characterization/characterize-menu-uml-ecd-nav-guard.mjs` | Pure + wiring pins |
| `scripts/refactor/verify-all.sh` | Register pin |
| `src/dashboard/api-docs/groups/overview.js` | One note on CONFLICT |
| Spec + agent-log | Status / 收工 |

---

### Task 1: Red — guard characterization

**Files:**
- Create: `scripts/characterization/characterize-menu-uml-ecd-nav-guard.mjs`
- Modify: `scripts/refactor/verify-all.sh` (register after implement green, or register in Task 2 — prefer register when pin exists in Task 1)

**Interfaces:**
- Produces: FAIL until Task 2 implements `menu-uml-ecd-nav-guard.js`

- [ ] **Step 1: Write pin**

```js
/**
 * Characterization: navigable uml_ecd guard (xpath+uml unique).
 * Run: node scripts/characterization/characterize-menu-uml-ecd-nav-guard.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isNavigableUmlPair } from '../../src/services/menu-uml-ecd-nav-guard.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function testIsNavigableUmlPair() {
  assert.equal(isNavigableUmlPair('UML1', "//li[@data-id='1']"), true);
  assert.equal(isNavigableUmlPair('UML1', ''), false);
  assert.equal(isNavigableUmlPair('', "//li"), false);
  assert.equal(isNavigableUmlPair('  ', '  /x  '), false);
  assert.equal(isNavigableUmlPair(' UML1 ', ' /x '), true);
}

function testWiring() {
  const guardPath = path.join(ROOT, 'src/services/menu-uml-ecd-nav-guard.js');
  assert.ok(fs.existsSync(guardPath), 'missing menu-uml-ecd-nav-guard.js');
  const guard = fs.readFileSync(guardPath, 'utf8');
  assert.match(guard, /export async function assertUmlEcdNavAvailable/);
  assert.match(guard, /CONFLICT/);

  const apply = fs.readFileSync(path.join(ROOT, 'src/services/menu-scan-apply.js'), 'utf8');
  assert.match(apply, /assertUmlEcdNavAvailable/);

  const imp = fs.readFileSync(path.join(ROOT, 'src/services/menu-json-import.js'), 'utf8');
  assert.match(imp, /assertUmlEcdNavAvailable/);
}

function testAssertWithStub() {
  // Dynamic import after file exists; Task 1 may fail on missing module — OK for red.
}

async function main() {
  console.log('\n=== menu-uml-ecd-nav-guard characterization ===\n');
  const tests = [
    ['isNavigableUmlPair', testIsNavigableUmlPair],
    ['wiring apply+import', testWiring],
  ];
  // Optional: assertUmlEcdNavAvailable with injected finder — add in Task 2 pin expansion if needed
  let failed = 0;
  for (const [name, fn] of tests) {
    try {
      await fn();
      console.log(`  ✓ ${name}`);
    } catch (e) {
      failed += 1;
      console.error(`  ✗ ${name}:`, e.message);
    }
  }
  console.log(failed ? '\nFAIL' : '\nOK');
  process.exitCode = failed ? 1 : 0;
}

main();
```

- [ ] **Step 2: Run — expect FAIL** (missing module)

```bash
node scripts/characterization/characterize-menu-uml-ecd-nav-guard.mjs
```

- [ ] **Step 3: Commit**

```bash
git add scripts/characterization/characterize-menu-uml-ecd-nav-guard.mjs
git commit -m "test(menu): red pin navigable uml_ecd uniqueness guard"
```

---

### Task 2: Guard module + green pure/wiring (wiring still red until Task 4)

**Files:**
- Create: `src/services/menu-uml-ecd-nav-guard.js`

**Interfaces:**
- Produces:
  - `isNavigableUmlPair(umlEcd: string, menuXpath: string): boolean`
  - `assertUmlEcdNavAvailable(candidate: { umlEcd: string, menuXpath?: string, excludeNodeId?: number }, trx?: object): Promise<void>` throws `{ code: 'CONFLICT' }`

- [ ] **Step 1: Implement guard**

```js
/**
 * 可导航菜单 uml_ecd 唯一性守卫：仅当候选自身「有 xpath + 非空 uml」时，
 * 拒绝与另一已有 xpath 节点共用同一 uml_ecd。
 */
import { getDB } from '../../config/database.js';

export function isNavigableUmlPair(umlEcd, menuXpath) {
  return Boolean(String(umlEcd || '').trim() && String(menuXpath || '').trim());
}

/**
 * @param {{ umlEcd: string, menuXpath?: string, excludeNodeId?: number }} candidate
 * @param {object} [trx]
 * @returns {Promise<void>}
 */
export async function assertUmlEcdNavAvailable(candidate, trx) {
  const umlEcd = String(candidate?.umlEcd || '').trim();
  const menuXpath = String(candidate?.menuXpath || '').trim();
  if (!isNavigableUmlPair(umlEcd, menuXpath)) return;

  const client = trx || getDB();
  let q = client('system')
    .whereRaw("TRIM(uml_ecd) = ?", [umlEcd])
    .whereRaw("menu_xpath IS NOT NULL AND TRIM(menu_xpath) <> ''")
    .first('id', 'name', 'uml_ecd', 'menu_xpath');
  const exclude = Number(candidate?.excludeNodeId);
  if (Number.isFinite(exclude) && exclude > 0) {
    q = q.andWhereNot('id', exclude);
  }
  const hit = await q;
  if (!hit) return;
  throw Object.assign(
    new Error(
      `可导航菜单 uml_ecd 冲突：${umlEcd} 已被节点 ${hit.id}（${hit.name || ''}）占用`,
    ),
    { code: 'CONFLICT', conflict: { id: hit.id, name: hit.name, umlEcd: hit.uml_ecd } },
  );
}
```

Note: knex `first` after `whereRaw` — if chain typing differs, use `.select(...).first()`.

- [ ] **Step 2: Temporarily loosen wiring asserts OR implement empty stubs in apply/import**

Prefer: in Task 1 pin, split wiring into Task 4 — **update Task 1 pin now** so Task 2 only needs `isNavigableUmlPair` + file exports; move `testWiring` to Task 4 red/green. If Task 1 already committed with wiring, Task 2 add `// assertUmlEcdNavAvailable` comment placeholders is wrong — instead edit pin in this task to defer wiring until Task 4:

Edit characterize file: remove apply/import wiring from Task 2 gate; add `testExports` that imports `assertUmlEcdNavAvailable`.

- [ ] **Step 3: Run pin — pure OK**

```bash
node scripts/characterization/characterize-menu-uml-ecd-nav-guard.mjs
```

Expected: OK (if wiring deferred) or still FAIL on wiring (then Task 4).

- [ ] **Step 4: Commit**

```bash
git add src/services/menu-uml-ecd-nav-guard.js scripts/characterization/characterize-menu-uml-ecd-nav-guard.mjs
git commit -m "feat(menu): assertUmlEcdNavAvailable for xpath+uml uniqueness"
```

---

### Task 3: Migration

**Files:**
- Create: `migrations/20260909220000_system_uml_ecd_nav_unique.js`

**Interfaces:**
- Produces: column `uml_ecd_nav` + `uk_uml_ecd_nav`

- [ ] **Step 1: Migration**

```js
/**
 * system.uml_ecd_nav — STORED generated: uml_ecd when menu_xpath and uml_ecd both non-empty (trim);
 * UNIQUE uk_uml_ecd_nav. Navigable menus only.
 */
async function indexExists(knex, table, name) {
  const rows = await knex.raw(
    `SELECT 1 AS ok FROM information_schema.statistics
     WHERE table_schema = DATABASE() AND table_name = ? AND index_name = ? LIMIT 1`,
    [table, name],
  );
  return (rows[0] || []).length > 0;
}

export async function up(knex) {
  const dups = await knex.raw(`
    SELECT uml_ecd AS umlEcd, COUNT(*) AS c, GROUP_CONCAT(id ORDER BY id) AS ids
    FROM \`system\`
    WHERE menu_xpath IS NOT NULL AND TRIM(menu_xpath) <> ''
      AND uml_ecd IS NOT NULL AND TRIM(uml_ecd) <> ''
    GROUP BY uml_ecd
    HAVING c > 1
    ORDER BY c DESC
    LIMIT 20
  `);
  const rows = dups[0] || [];
  if (rows.length) {
    console.error('[migration] navigable uml_ecd duplicates (fix before uk_uml_ecd_nav):', rows);
    throw new Error(
      `Cannot add uk_uml_ecd_nav: ${rows.length} duplicate uml_ecd group(s) among xpath rows`,
    );
  }

  const hasCol = await knex.schema.hasColumn('system', 'uml_ecd_nav');
  if (!hasCol) {
    await knex.raw(`
      ALTER TABLE \`system\`
      ADD COLUMN \`uml_ecd_nav\` VARCHAR(64)
        GENERATED ALWAYS AS (
          CASE
            WHEN \`menu_xpath\` IS NOT NULL AND TRIM(\`menu_xpath\`) <> ''
             AND \`uml_ecd\` IS NOT NULL AND TRIM(\`uml_ecd\`) <> ''
            THEN \`uml_ecd\`
            ELSE NULL
          END
        ) STORED
        COMMENT '可导航唯一：有 xpath 且非空 uml_ecd 时等于 uml_ecd'
        AFTER \`uml_ecd\`
    `);
    console.log('[migration] added system.uml_ecd_nav');
  }

  if (!(await indexExists(knex, 'system', 'uk_uml_ecd_nav'))) {
    await knex.raw('ALTER TABLE `system` ADD UNIQUE INDEX `uk_uml_ecd_nav` (`uml_ecd_nav`)');
    console.log('[migration] added system.uk_uml_ecd_nav');
  }
}

export async function down(knex) {
  if (await indexExists(knex, 'system', 'uk_uml_ecd_nav')) {
    await knex.raw('ALTER TABLE `system` DROP INDEX `uk_uml_ecd_nav`');
  }
  if (await knex.schema.hasColumn('system', 'uml_ecd_nav')) {
    await knex.schema.alterTable('system', (t) => t.dropColumn('uml_ecd_nav'));
  }
}
```

- [ ] **Step 2: Run migration against dev DB** (when credentials available)

```bash
npx knex migrate:latest
# or project-standard migrate command
```

Expected: success (current env had 0 navigable dups).

- [ ] **Step 3: Commit**

```bash
git add migrations/20260909220000_system_uml_ecd_nav_unique.js
git commit -m "feat(db): uk_uml_ecd_nav unique for xpath+uml rows"
```

---

### Task 4: Wire apply + import + adopt; green wiring pin

**Files:**
- Modify: `src/services/menu-scan-apply.js`
- Modify: `src/services/menu-json-import.js`
- Modify: `scripts/characterization/characterize-menu-uml-ecd-nav-guard.mjs` (add wiring asserts)
- Modify: `scripts/refactor/verify-all.sh`

**Interfaces:**
- Consumes: `assertUmlEcdNavAvailable` from Task 2

- [ ] **Step 1: `menu-scan-apply.js`**

Import guard. Before each path:

1. **`assignAiUmlEcdFromId`**: after computing `umlEcd = String(id)`, load current `menuXpath` from `created` or re-read; `await assertUmlEcdNavAvailable({ umlEcd, menuXpath: created.menuXpath || '', excludeNodeId: id }, trx)` then update.

2. **`plan.updates` loop**: before `systemDao.update` with new `menuXpath`, load existing node uml (from DB or plan), call  
   `assertUmlEcdNavAvailable({ umlEcd: existing.umlEcd, menuXpath: u.menuXpath, excludeNodeId: u.nodeId }, trx)`.

3. **`adoptModelingUmlEcdUnderSystem`**: before `update({ umlEcd: uml })`,  
   `assertUmlEcdNavAvailable({ umlEcd: uml, menuXpath: nav.menuXpath, excludeNodeId: nav.id }, trx)`.

4. **L1/L2 create**: after create with xpath, `assignAiUmlEcdFromId` already guarded.

If `update` sets xpath without knowing uml, `getRawById` first.

- [ ] **Step 2: `menu-json-import.js`**

Before `systemDao.update` / `create` with `patchCommon` / create payload: compute resulting `umlEcd` and `menuXpath` (import usually `menuXpath: ''` → no-op). On update, merge with existing node xpath:

```js
const nextXpath = String(node.menuXpath || patch.menuXpath || '').trim(); // import rarely sets xpath
await assertUmlEcdNavAvailable({
  umlEcd,
  menuXpath: nextXpath || String(node.menuXpath || ''),
  excludeNodeId: node?.id,
}, trx);
```

On create with `menuXpath: ''`, assert no-ops.

- [ ] **Step 3: Restore wiring tests in characterize; register verify-all**

```bash
# verify-all.sh near other menu pins:
run "characterize-menu-uml-ecd-nav-guard" node scripts/characterization/characterize-menu-uml-ecd-nav-guard.mjs
```

```bash
node scripts/characterization/characterize-menu-uml-ecd-nav-guard.mjs
node scripts/characterization/characterize-menu-scan-uml-adopt.mjs
node scripts/characterization/characterize-system-import-json.mjs
```

Expected: all OK.

- [ ] **Step 4: Commit**

```bash
git add src/services/menu-scan-apply.js src/services/menu-json-import.js \
  scripts/characterization/characterize-menu-uml-ecd-nav-guard.mjs \
  scripts/refactor/verify-all.sh
git commit -m "feat(menu): guard navigable uml_ecd on scan/import/adopt"
```

---

### Task 5: api-docs + spec close

**Files:**
- Modify: `src/dashboard/api-docs/groups/overview.js` (scan-menu / import-json notes: navigable uml conflict → 409 CONFLICT)
- Modify: `docs/superpowers/specs/2026-09-09-uml-ecd-nav-unique-design.md` → 已落地 + plan link
- Modify: `docs/superpowers/agent-log.md` 收工

- [ ] **Step 1–3: docs + commit**

```bash
git add src/dashboard/api-docs/groups/overview.js \
  docs/superpowers/specs/2026-09-09-uml-ecd-nav-unique-design.md \
  docs/superpowers/agent-log.md
git commit -m "docs: close navigable uml_ecd unique design"
```

---

## Spec coverage (self-review)

| Spec | Task |
|---|---|
| Generated col + UNIQUE | T3 |
| Dup probe fail migration | T3 |
| Guard helper CONFLICT | T2 |
| Wire apply / import / adopt | T4 |
| Reject not clear | Global / T2 |
| Characterization | T1/T2/T4 |
| api-docs note | T5 |
| No whole-table UNIQUE / no require uml | Global |

**Task 1 note:** If wiring is asserted in the first pin commit, Task 2 alone stays red until Task 4 — acceptable TDD; or split wiring asserts into Task 4 only (recommended in Task 2 step 2).
