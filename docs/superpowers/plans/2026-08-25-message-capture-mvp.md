# 报文捞取 MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename case_data → business_data across the full stack, build an E2E API capture tool, and implement form-related XHR/fetch persistence to system_ref_data during recording — establishing the 报文捞取 framework at ~40% completion.

**Architecture:** Three parallel workstreams: (1) mechanical rename touching DB migrations, JS/Python files, routes, and characterization tests; (2) a standalone Playwright script for manual API sample capture; (3) a Python network listener that emits memory events consumed by the Node control plane to deduplicate and persist new form-related interfaces.

**Tech Stack:** Node.js Express, Knex migrations, Playwright (Node + Python async), browser_use BrowserContext, MySQL

## Global Constraints

- Python interpreter: `D:\anaconda3\envs\browser_use\python.exe`
- Git branch: `uara_V1.2` (do NOT commit to master)
- verify-all.sh ALL GREEN is the hard delivery gate after each task
- CHANGELOG [Unreleased] must be updated for src/services/, src/routes/, migrations/, server.mjs, config/ changes per AGENTS.md
- characterization tests pin source substrings — any rename must update pins in the same task
- `CASE_BLOCK_MARK_LEGACY` (`【业务场景案例数据`) is kept for backward compat — do NOT rename
- `CASE_DATA_SECTION_RE` regex must still match `案例数据` in user input (it's a header recognition pattern, not a self-referencing name) — rename the JS symbol but keep the regex content
- `_FORM_KEYWORDS` / `_EXCLUDE_PATTERN` regex in network_capture.py are initial heuristics; tune after E2E capture samples
- Transport keys (`case_data`, `case_data_file`, `case_data_block` in stdin JSON) are renamed to `business_data` / `business_data_file` / `business_data_block` — both Python and JS sides updated in the same task
- Action names `save_case_data` / `read_case_data` → `save_business_data` / `read_business_data` — both the `@controller.action` registration and all string references in state.py, models/action.py, event_dispatch.py, codegen/actions.py, executor-session-client.js, session-handler.js, register.js, legacy-engine-export.js, meta-step-actions.js
- `session_state['case_data_store']` dict key → `session_state['business_data_store']` — coordinated across session_runner.py and event_dispatch.py
- `case_data_ref` alias in agent/service.py → `business_data_ref`
- `_case_scenario_text` internal key → `_business_scenario_text` with dual-key fallback in format_business_data_hint

---

### Task 1: DB Migration — Rename case_data tables/columns

**Files:**
- Create: `migrations/20260825220000_rename_case_data_to_business_data.js`
- Test: `npx knex migrate:latest && npx knex migrate:rollback` (up then down)

**Interfaces:**
- Produces: DB tables `business_data` / `business_data_entry` (renamed from `case_data` / `case_data_entry`); column `business_data_id` in `business_data_entry` and `form_snapshot` (renamed from `case_data_id`)

- [ ] **Step 1: Write the migration file**

```js
// migrations/20260825220000_rename_case_data_to_business_data.js

export async function up(knex) {
  // 表重命名
  await knex.schema.renameTable('case_data', 'business_data');
  await knex.schema.renameTable('case_data_entry', 'business_data_entry');
  // form_snapshot 表名不改，仅改其外键列名

  // 列重命名（case_data_id → business_data_id）
  await knex.schema.alterTable('business_data_entry', (t) => {
    t.renameColumn('case_data_id', 'business_data_id');
  });
  await knex.schema.alterTable('form_snapshot', (t) => {
    t.renameColumn('case_data_id', 'business_data_id');
  });
}

export async function down(knex) {
  await knex.schema.alterTable('form_snapshot', (t) => {
    t.renameColumn('business_data_id', 'case_data_id');
  });
  await knex.schema.alterTable('business_data_entry', (t) => {
    t.renameColumn('business_data_id', 'case_data_id');
  });
  await knex.schema.renameTable('business_data_entry', 'case_data_entry');
  await knex.schema.renameTable('business_data', 'case_data');
}
```

- [ ] **Step 2: Run migration up and verify**

Run: `npx knex migrate:latest`
Expected: migration applies successfully; `SHOW TABLES LIKE 'business_data%'` returns `business_data` and `business_data_entry`; `DESCRIBE business_data_entry` shows `business_data_id` column; `DESCRIBE form_snapshot` shows `business_data_id` column.

- [ ] **Step 3: Run migration down and verify rollback**

Run: `npx knex migrate:rollback`
Expected: tables revert to `case_data` / `case_data_entry`; columns revert to `case_data_id`.

- [ ] **Step 4: Re-run migration up (leave DB in new state)**

Run: `npx knex migrate:latest`

- [ ] **Step 5: Commit**

```bash
git add migrations/20260825220000_rename_case_data_to_business_data.js
git commit -m "feat(migration): rename case_data tables/columns to business_data"
```

---

### Task 2: Rename JS DAO + Service + Store + Route files

**Files:**
- Rename: `src/dao/case-data-dao.js` → `src/dao/business-data-dao.js`
- Rename: `src/services/case-data-service.js` → `src/services/business-data-service.js`
- Rename: `src/routes/v2/case-data.js` → `src/routes/v2/business-data.js`
- Rename: `src/case-data-store.js` → `src/business-data-store.js`
- Modify: `src/routes/v2/__init__.js`
- Modify: `server.mjs`
- Modify: `config/config.js`

**Interfaces:**
- Produces: `businessDataDao` (module with `save`, `getByRecordId`, `list`, `remove`, `listEntriesByTrajectory`, `replaceEntriesForTrajectory`, `loadFlatDictByTrajectory`, `normalizeCaseEntries` → `normalizeBusinessEntries`, `entriesToFlatDict`)
- Produces: `businessDataService` (module with `saveCaseData` → `saveBusinessData`, `persistSessionCaseData` → `persistSessionBusinessData`, `persistFormSnapshotsFromFile`)
- Produces: `businessDataStore` (module with `saveCaseDataRecord` → `saveBusinessDataRecord`, `getCaseDataRecord` → `getBusinessDataRecord`, `loadCaseDataJson` → `loadBusinessDataJson`, `deleteCaseData` → `deleteBusinessData`, `ensureCaseDataDir` → `ensureBusinessDataDir`, `loadCaseDataIndex` → `loadBusinessDataIndex`, `saveCaseDataIndex` → `saveBusinessDataIndex`)
- Produces: route path `/api/v2/business-data` (was `/api/v2/case-data`); 301 redirect for old path
- Produces: `BUSINESS_DATA_DIR` config constant (was `CASE_DATA_DIR`)

- [ ] **Step 1: Rename the 4 files and update their internal symbols**

In `src/dao/business-data-dao.js` (renamed from `case-data-dao.js`):
- Line 4: `const TABLE = 'case_data'` → `const TABLE = 'business_data'`
- Line 5: `const ENTRY_TABLE = 'case_data_entry'` → `const ENTRY_TABLE = 'business_data_entry'`
- Line 33: `export function normalizeCaseEntries` → `export function normalizeBusinessEntries`
- Line 76: `case_data_id: id` → `business_data_id: id`
- Line 95: `.where({ case_data_id: row.id })` → `.where({ business_data_id: row.id })`
- Line 152: error string `'case_data_entry.trajectory_id missing ...'` → `'business_data_entry.trajectory_id missing ...'`
- Line 162: `case_data_id: null` → `business_data_id: null`

In `src/services/business-data-service.js` (renamed from `case-data-service.js`):
- Line 1: `import * as caseDataDao from '../dao/case-data-dao.js'` → `import * as businessDataDao from '../dao/business-data-dao.js'`
- Line 8: `function normalizeSnapshot(snap, caseDataId, trajectoryId)` → `function normalizeSnapshot(snap, businessDataId, trajectoryId)`
- Line 15: `caseDataId: caseDataId ?? null` → `businessDataId: businessDataId ?? null`
- Line 27: `export async function saveCaseData` → `export async function saveBusinessData`
- Line 41: `const caseDataId = await caseDataDao.save(...)` → `const businessDataId = await businessDataDao.save(...)`
- Line 54: `normalizeSnapshot(snap, caseDataId, trajectoryId)` → `normalizeSnapshot(snap, businessDataId, trajectoryId)`
- Line 63: `export async function persistSessionCaseData` → `export async function persistSessionBusinessData`
- Line 77: param `caseDataId` → `businessDataId`
- Line 91: `normalizeSnapshot(snap, caseDataId ?? null, ...)` → `normalizeSnapshot(snap, businessDataId ?? null, ...)`

In `src/routes/v2/business-data.js` (renamed from `case-data.js`):
- Line 8: `import * as caseDataDao from '../../dao/case-data-dao.js'` → `import * as businessDataDao from '../../dao/business-data-dao.js'`
- Line 9: `import { CASE_DATA_DIR } from '#config/config.js'` → `import { BUSINESS_DATA_DIR } from '#config/config.js'`
- Line 11: `function materializeCaseDataFile` → `function materializeBusinessDataFile`
- Lines 32, 42, 53, 63: route paths `/api/v2/case-data` → `/api/v2/business-data`
- All `caseDataDao.` calls → `businessDataDao.`
- All `CASE_DATA_DIR` refs → `BUSINESS_DATA_DIR`

In `src/business-data-store.js` (renamed from `case-data-store.js`):
- Line 4: `import { CASE_DATA_DIR } from '../config/config.js'` → `import { BUSINESS_DATA_DIR } from '../config/config.js'`
- Line 10: `export function ensureCaseDataDir` → `export function ensureBusinessDataDir`
- Line 14: `export function loadCaseDataIndex` → `export function loadBusinessDataIndex`
- Line 20: `function saveCaseDataIndex` → `function saveBusinessDataIndex`
- Line 26: `export function saveCaseDataRecord` → `export function saveBusinessDataRecord`; param `caseDataPath` → `businessDataPath`
- Line 29: `path.basename(caseDataPath)` → `path.basename(businessDataPath)`
- Line 32: `readFileSync(caseDataPath, 'utf-8')` → `readFileSync(businessDataPath, 'utf-8')`
- Line 53: `export function getCaseDataRecord` → `export function getBusinessDataRecord`
- Line 58: `export function loadCaseDataJson` → `export function loadBusinessDataJson`
- Line 66: `export function deleteCaseData` → `export function deleteBusinessData`
- All `CASE_DATA_DIR` refs → `BUSINESS_DATA_DIR`

- [ ] **Step 2: Update config/config.js**

- Line 52: `export const CASE_DATA_DIR = path.join(PROJECT_ROOT, 'scripts', 'case_data');` → `export const BUSINESS_DATA_DIR = path.join(PROJECT_ROOT, 'scripts', 'case_data');`

Note: the physical directory `scripts/case_data/` is NOT renamed in this task (it holds runtime JSON files; renaming the dir is cosmetic and can be done later). Only the JS constant name changes.

- [ ] **Step 3: Update src/routes/v2/__init__.js**

- Line 21: `import registerCaseData from './case-data.js';` → `import registerBusinessData from './business-data.js';`
- Line 48: `registerCaseData(app);` → `registerBusinessData(app);`


- [ ] **Step 4: Update server.mjs**

- Line 173: change log from /api/v2/case-data to /api/v2/business-data
- After registerV2Routes(app) (line 48), add 301 redirect for old path:
  app.use((req, res, next) => {
    if (req.path.startsWith('/api/v2/case-data'))
      return res.redirect(301, req.path.replace('/api/v2/case-data', '/api/v2/business-data'));
    next();
  });

- [ ] **Step 5: Run verify-all to check for import breakage**

Run: bash scripts/refactor/verify-all.sh
Expected: May fail on tests that import old module names. Note which tests fail — they will be fixed in Task 5. The key check is that the server starts without import errors.

- [ ] **Step 6: Commit**

- git add src/dao/business-data-dao.js src/services/business-data-service.js src/routes/v2/business-data.js src/business-data-store.js src/routes/v2/__init__.js server.mjs config/config.js
- git rm src/dao/case-data-dao.js src/services/case-data-service.js src/routes/v2/case-data.js src/case-data-store.js
- git commit -m "feat: rename case-data JS files/symbols to business-data (DAO/service/route/store)"

---

---

## Continuation Plans

Tasks 3-6 (JS/Python rename references, characterization test pins, API docs/CHANGELOG):
See `docs/superpowers/plans/2026-08-25-rename-js-python.md`

Tasks 7-10 (E2E capture tool, network_capture.py, persistence hook, final CHANGELOG/push):
See `docs/superpowers/plans/2026-08-25-capture-persistence.md`

## Execution Order

Tasks 1-6 are sequential (rename workstream, each depends on previous).
Tasks 7-8 can run in parallel with the rename (independent files).
Task 9 depends on Task 8 (network_capture.py must exist before hooking).
Task 10 depends on all previous tasks.
