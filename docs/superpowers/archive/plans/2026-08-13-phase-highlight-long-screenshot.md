# Phase Highlight Long-Page Screenshot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After each AI-recording `phase_done`, save one long-page screenshot of the current page with outlines on still-locatable product-tree controls, bound to that `trajectory_phase`.

**Architecture:** Control plane (or executor BiB CDP) injects page helpers to resolve `xpath_smart` + region, paints temporary outlines, scrolls the main overflow container, captures viewport PNGs, stitches with `pngjs`, UPSERTs `screenshot.kind=phase_highlight`, then sets `trajectory_phase.stitch_screenshot_id`. Fail-soft: never fail the recording.

**Tech Stack:** Node ESM, Knex/MySQL, CDP `Runtime.evaluate` + `Page.captureScreenshot`, `pngjs`, Playwright characterization, existing `PAGE_LOCATOR_HELPERS` / `filterMetaSteps` / BiB executor WS.

**Spec:** `docs/superpowers/specs/2026-08-13-phase-highlight-long-screenshot-design.md`

## Global Constraints

- AI record only; do not hook manual record.
- Highlight **controls** (L2), not region washes; region fields only disambiguate xpath.
- Step set = `filterMetaSteps` (same as product tree).
- Zero hits still save a current-page long screenshot.
- Capture failure = `console.warn` only; recording continues.
- P0 size cap: shrink/truncate **PNG** (no JPEG encoder / no `sharp`). Target `< 12_000_000` bytes (under MEDIUMBLOB 16MB).
- Highlight: Chrome-inspect fill (`outline: 2px solid #1a73e8` + inset `rgba(111,168,220,.45)`); attribute `data-jsgen-phase-hl="1"`; stylesheet id `jsgen-phase-hl-style`.
- Scroll overlap `48`; max slices `30`; restore scrollTop after capture.
- Regen locator helpers if `page-locator-helpers.js` changes: `node scripts/_gen_locator_helpers_py.mjs`.
- Schema / routes / services → `CHANGELOG.md` `[Unreleased]` with Python 同步提示.
- **Commit only when the user explicitly asks.**

## File map

| File | Role |
|------|------|
| `migrations/20260813100000_phase_highlight_screenshot.js` | kind enum, `trajectory_phase_id`, unique, `stitch_screenshot_id` |
| `schemas/init.sql` | Same columns for greenfield |
| `src/dao/screenshot-dao.js` | `replaceForPhase` UPSERT |
| `src/services/screenshot-service.js` | `replacePhaseHighlightScreenshot` |
| `src/models/phase-highlight-targets.js` | `collectHighlightTargets(steps)` |
| `src/cdp/phase-highlight-page.js` | Injected page script: resolve / mark / unmark / scroll root |
| `src/cdp/png-stitch.js` | `stitchPngSlices(buffers, { overlap })` |
| `src/cdp/phase-highlight-capture.js` | `runPhaseHighlightCapture(cdpClient, targets)` → `{ buffer, hitCount }` |
| `src/services/trajectory/phase-highlight-screenshot.js` | Orchestrator `capturePhaseHighlightScreenshot` |
| `src/cdp/remote-bridge/index.js` | Export attached CDP client getter |
| `executor/bib-bridge.js` + `session-manager.js` + `session-handler.js` + `agent.mjs` | `session.bib_phase_highlight_capture` |
| `src/services/trajectory/trajectory-recording-runner.js` | Call after phase completed |
| `src/services/trajectory-query-service.js` | `stitchScreenshotId` + image URL on phase |
| `src/dashboard/api-docs/groups/trajectory.js` + `remote.js` | Contract notes |
| `scripts/characterization/characterize-phase-highlight-screenshot.mjs` | Char suite |
| `package.json` | dependency `pngjs` |
| `CHANGELOG.md` | Unreleased |

```text
phase_done → collectHighlightTargets(filterMetaSteps)
           → CDP: mark hits
           → scroll+capture slices → stitchPngSlices
           → unmark → replaceForPhase → phase.stitch_screenshot_id
```

---

### Task 0: Baseline green

**Files:**
- Verify only

**Interfaces:**
- Consumes: N/A
- Produces: Confirmed baseline before schema work

- [ ] **Step 1: Run existing screenshot char**

```powershell
cd d:\dev\JS-gen
node scripts/characterization/characterize-screenshots.mjs
```

Expected: `ok: characterize screenshots before/after`

- [ ] **Step 2: If red, fix only blockers** — do not start Task 1 until this is green.

---

### Task 1: Schema — `phase_highlight` + phase FK

**Files:**
- Create: `migrations/20260813100000_phase_highlight_screenshot.js`
- Modify: `schemas/init.sql` (`trajectory_phase` ~L121–137, `screenshot` ~L429–442)
- Test: `scripts/characterization/characterize-phase-highlight-screenshot.mjs` (create this file)

**Interfaces:**
- Consumes: N/A
- Produces: DB columns `screenshot.kind` includes `phase_highlight`; `screenshot.trajectory_phase_id`; unique `uk_ss_phase_kind`; `trajectory_phase.stitch_screenshot_id`

- [ ] **Step 1: Write failing char (migration + init.sql text)**

Create `scripts/characterization/characterize-phase-highlight-screenshot.mjs`:

```javascript
/**
 * Phase highlight long-page screenshot.
 *   node scripts/characterization/characterize-phase-highlight-screenshot.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
function ok(n) { console.log(`ok: ${n}`); }

{
  const mig = join(root, 'migrations/20260813100000_phase_highlight_screenshot.js');
  assert.equal(existsSync(mig), true, 'migration file must exist');
  const src = readFileSync(mig, 'utf8');
  assert.match(src, /phase_highlight/);
  assert.match(src, /trajectory_phase_id/);
  assert.match(src, /uk_ss_phase_kind/);
  assert.match(src, /stitch_screenshot_id/);
  ok('migration cues');
}

{
  const sql = readFileSync(join(root, 'schemas/init.sql'), 'utf8');
  assert.match(sql, /phase_highlight/);
  assert.match(sql, /stitch_screenshot_id/);
  assert.match(sql, /uk_ss_phase_kind/);
  ok('init.sql cues');
}

console.log('characterize-phase-highlight-screenshot: ok');
```

- [ ] **Step 2: Run char — expect FAIL** (file missing)

```powershell
node scripts/characterization/characterize-phase-highlight-screenshot.mjs
```

Expected: `ERR_MODULE_NOT_FOUND` or `migration file must exist`

- [ ] **Step 3: Add migration**

`migrations/20260813100000_phase_highlight_screenshot.js`:

```javascript
/**
 * screenshot.kind += phase_highlight; bind to trajectory_phase;
 * trajectory_phase.stitch_screenshot_id.
 */

async function dropFkIfExists(knex, table, name) {
  const [rows] = await knex.raw(
    `SELECT CONSTRAINT_NAME FROM information_schema.TABLE_CONSTRAINTS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND CONSTRAINT_NAME = ?
       AND CONSTRAINT_TYPE = 'FOREIGN KEY' LIMIT 1`,
    [table, name],
  );
  if (rows && rows.length) {
    await knex.raw(`ALTER TABLE \`${table}\` DROP FOREIGN KEY \`${name}\``);
  }
}

async function dropIndexIfExists(knex, table, indexName) {
  const [rows] = await knex.raw(
    `SELECT INDEX_NAME FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?
     LIMIT 1`,
    [table, indexName],
  );
  if (rows && rows.length) {
    await knex.raw(`ALTER TABLE \`${table}\` DROP INDEX \`${indexName}\``);
  }
}

export async function up(knex) {
  if (await knex.schema.hasTable('screenshot')) {
    await knex.raw(
      `ALTER TABLE \`screenshot\`
       MODIFY COLUMN \`kind\` ENUM('before','after','phase_highlight')
       NOT NULL DEFAULT 'after'
       COMMENT 'before/after=步骤; phase_highlight=阶段长图'`,
    );
    if (!(await knex.schema.hasColumn('screenshot', 'trajectory_phase_id'))) {
      await knex.schema.alterTable('screenshot', (t) => {
        t.bigInteger('trajectory_phase_id').unsigned().nullable()
          .comment('阶段长图所属 trajectory_phase.id')
          .after('trajectory_step_id');
      });
      await knex.raw(
        `ALTER TABLE \`screenshot\`
         ADD CONSTRAINT \`fk_ss_trajectory_phase\`
         FOREIGN KEY (\`trajectory_phase_id\`) REFERENCES \`trajectory_phase\` (\`id\`)
         ON DELETE CASCADE`,
      );
    }
    await dropIndexIfExists(knex, 'screenshot', 'uk_ss_phase_kind');
    await knex.raw(
      'ALTER TABLE `screenshot` ADD UNIQUE KEY `uk_ss_phase_kind` (`trajectory_phase_id`, `kind`)',
    );
  }

  if (await knex.schema.hasTable('trajectory_phase')) {
    if (!(await knex.schema.hasColumn('trajectory_phase', 'stitch_screenshot_id'))) {
      await knex.schema.alterTable('trajectory_phase', (t) => {
        t.bigInteger('stitch_screenshot_id').unsigned().nullable()
          .comment('阶段展示长图 → screenshot.id')
          .after('component_id');
      });
      try {
        await knex.raw(
          `ALTER TABLE \`trajectory_phase\`
           ADD CONSTRAINT \`fk_phase_stitch_screenshot\`
           FOREIGN KEY (\`stitch_screenshot_id\`) REFERENCES \`screenshot\` (\`id\`)
           ON DELETE SET NULL`,
        );
      } catch (err) {
        console.warn('[migration] skip fk_phase_stitch_screenshot:', err.message);
      }
    }
  }
}

export async function down(knex) {
  if (await knex.schema.hasTable('trajectory_phase')) {
    await dropFkIfExists(knex, 'trajectory_phase', 'fk_phase_stitch_screenshot');
    if (await knex.schema.hasColumn('trajectory_phase', 'stitch_screenshot_id')) {
      await knex.schema.alterTable('trajectory_phase', (t) => {
        t.dropColumn('stitch_screenshot_id');
      });
    }
  }
  if (await knex.schema.hasTable('screenshot')) {
    await dropFkIfExists(knex, 'screenshot', 'fk_ss_trajectory_phase');
    await dropIndexIfExists(knex, 'screenshot', 'uk_ss_phase_kind');
    if (await knex.schema.hasColumn('screenshot', 'trajectory_phase_id')) {
      await knex.schema.alterTable('screenshot', (t) => {
        t.dropColumn('trajectory_phase_id');
      });
    }
    await knex.raw(
      `ALTER TABLE \`screenshot\`
       MODIFY COLUMN \`kind\` ENUM('before','after') NOT NULL DEFAULT 'after'`,
    );
  }
}
```

- [ ] **Step 4: Patch `schemas/init.sql`**

On `trajectory_phase`, after `component_id` line add:

```sql
  `stitch_screenshot_id` BIGINT UNSIGNED DEFAULT NULL COMMENT '阶段展示长图 → screenshot.id',
```

Add index/FK near other phase constraints:

```sql
  KEY `idx_phase_stitch_screenshot` (`stitch_screenshot_id`),
  CONSTRAINT `fk_phase_stitch_screenshot` FOREIGN KEY (`stitch_screenshot_id`) REFERENCES `screenshot` (`id`) ON DELETE SET NULL
```

(If circular-create order is a problem in a fresh dump, omit the FK in init.sql and keep only the column + key; migration already try/catches the FK.)

On `screenshot`:

- Change kind to `ENUM('before','after','phase_highlight')`
- Add `trajectory_phase_id BIGINT UNSIGNED DEFAULT NULL` after `trajectory_step_id`
- Add `UNIQUE KEY uk_ss_phase_kind (trajectory_phase_id, kind)`
- Add `CONSTRAINT fk_ss_trajectory_phase FOREIGN KEY (trajectory_phase_id) REFERENCES trajectory_phase(id) ON DELETE CASCADE`

- [ ] **Step 5: Re-run char — expect PASS**

```powershell
node scripts/characterization/characterize-phase-highlight-screenshot.mjs
```

Expected: `ok: migration cues` / `ok: init.sql cues` / `characterize-phase-highlight-screenshot: ok`

---

### Task 2: DAO `replaceForPhase`

**Files:**
- Modify: `src/dao/screenshot-dao.js`
- Modify: `src/services/screenshot-service.js`
- Modify: `scripts/characterization/characterize-phase-highlight-screenshot.mjs`

**Interfaces:**
- Consumes: Task 1 columns
- Produces: `replaceForPhase({ trajectoryId, trajectoryPhaseId, imageData, mimeType? }) → Promise<number|null>`
- Produces: `replacePhaseHighlightScreenshot(phaseId, { trajectoryId, buffer, mimeType? }) → Promise<number|null>`

- [ ] **Step 1: Extend char to require DAO source cues**

Append to the characterization file:

```javascript
{
  const dao = readFileSync(join(root, 'src/dao/screenshot-dao.js'), 'utf8');
  assert.match(dao, /export async function replaceForPhase/);
  assert.match(dao, /uk_ss_phase_kind|trajectory_phase_id/);
  assert.match(dao, /phase_highlight/);
  const svc = readFileSync(join(root, 'src/services/screenshot-service.js'), 'utf8');
  assert.match(svc, /replacePhaseHighlightScreenshot/);
  ok('dao+service replaceForPhase');
}
```

- [ ] **Step 2: Run — expect FAIL** (`replaceForPhase` missing)

- [ ] **Step 3: Implement DAO**

Add to `META_COLS`: `'screenshot.trajectory_phase_id'`.

Append:

```javascript
export async function replaceForPhase(screenshot) {
  const phaseId = screenshot.trajectoryPhaseId != null ? Number(screenshot.trajectoryPhaseId) : null;
  const kind = 'phase_highlight';
  if (!Number.isFinite(phaseId) || phaseId <= 0) {
    throw new Error('trajectoryPhaseId required for replaceForPhase');
  }
  const imageData = screenshot.imageData;
  const fileSize = screenshot.fileSize || (imageData ? imageData.length : 0);
  const mimeType = screenshot.mimeType || 'image/png';
  const trajectoryId = screenshot.trajectoryId != null ? Number(screenshot.trajectoryId) : null;

  const db = getDB();
  const phaseExists = await db('trajectory_phase').where({ id: phaseId }).first('id');
  if (!phaseExists) {
    const err = new Error(`trajectory_phase ${phaseId} not found`);
    err.code = 'ER_NO_REFERENCED_ROW_2';
    throw err;
  }

  await db.raw(
    `INSERT INTO \`${TABLE}\`
      (image_data, file_size, mime_type, trajectory_id, trajectory_step_id, trajectory_phase_id, kind)
     VALUES (?, ?, ?, ?, NULL, ?, ?)
     ON DUPLICATE KEY UPDATE
      image_data = VALUES(image_data),
      file_size = VALUES(file_size),
      mime_type = VALUES(mime_type),
      trajectory_id = VALUES(trajectory_id)`,
    [imageData, fileSize, mimeType, trajectoryId, phaseId, kind],
  );

  const row = await db(TABLE)
    .select('id')
    .where({ trajectory_phase_id: phaseId, kind })
    .first();
  return row?.id != null ? Number(row.id) : null;
}
```

`screenshot-service.js` add:

```javascript
export async function replacePhaseHighlightScreenshot(trajectoryPhaseId, {
  trajectoryId = null,
  buffer,
  mimeType = 'image/png',
} = {}) {
  const phaseId = Number(trajectoryPhaseId);
  if (!Number.isFinite(phaseId) || phaseId <= 0) throw new Error('trajectoryPhaseId required');
  if (!buffer || !buffer.length) throw new Error('buffer required');
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  return screenshotDao.replaceForPhase({
    trajectoryPhaseId: phaseId,
    trajectoryId: trajectoryId != null ? Number(trajectoryId) : null,
    imageData: buf,
    fileSize: buf.length,
    mimeType,
  });
}
```

- [ ] **Step 4: Re-run char — expect PASS**

---

### Task 3: `collectHighlightTargets`

**Files:**
- Create: `src/models/phase-highlight-targets.js`
- Modify: `scripts/characterization/characterize-phase-highlight-screenshot.mjs`

**Interfaces:**
- Consumes: `filterMetaSteps` from `src/models/meta-step-actions.js`
- Produces: `collectHighlightTargets(steps: object[]) => Array<{ xpath_smart: string, xpath_full: string, region_id: string, region_label: string }>`

- [ ] **Step 1: Failing char (import + behavior)**

```javascript
{
  const { collectHighlightTargets } = await import('../../src/models/phase-highlight-targets.js');
  const out = collectHighlightTargets([
    { actionType: 'save_form_snapshot', element: { xpath_smart: '//meta' } },
    {
      actionType: 'fill_form_field',
      element: {
        xpath_smart: "//input[@id='a']",
        xpath_full: '/html/body/input',
        region_id: 'section:概况',
        region_label: '对公客户概况',
      },
    },
    { actionType: 'click_element_by_index', elementJson: { xpath_smart: "//button[.='保存']" } },
    { actionType: 'fill_form_field', element: {} },
  ]);
  assert.equal(out.length, 2);
  assert.equal(out[0].xpath_smart, "//input[@id='a']");
  assert.equal(out[0].region_label, '对公客户概况');
  assert.equal(out[1].xpath_smart, "//button[.='保存']");
  assert.ok(!out.some((t) => t.xpath_smart === '//meta'));
  ok('collectHighlightTargets drops meta and empty xpath');
}
```

- [ ] **Step 2: Run — expect FAIL** (module missing)

- [ ] **Step 3: Implement**

`src/models/phase-highlight-targets.js`:

```javascript
import { filterMetaSteps } from './meta-step-actions.js';

function asElement(step) {
  let el = step?.element ?? step?.elementJson ?? null;
  if (typeof el === 'string') {
    try { el = JSON.parse(el); } catch { el = null; }
  }
  return el && typeof el === 'object' ? el : {};
}

export function collectHighlightTargets(steps) {
  const business = filterMetaSteps(Array.isArray(steps) ? steps : []);
  const out = [];
  for (const step of business) {
    const el = asElement(step);
    const xpath_smart = String(el.xpath_smart || '').trim();
    const xpath_full = String(el.xpath_full || el.xpath || '').trim();
    if (!xpath_smart && !xpath_full) continue;
    out.push({
      xpath_smart,
      xpath_full,
      region_id: String(el.region_id || '').trim(),
      region_label: String(el.region_label || '').trim(),
    });
  }
  return out;
}
```

- [ ] **Step 4: Run char — expect PASS**

---

### Task 4: Page JS — resolve / mark / unmark / scroll root

**Files:**
- Create: `src/cdp/phase-highlight-page.js`
- Modify: `scripts/characterization/characterize-phase-highlight-screenshot.mjs`

**Interfaces:**
- Consumes: `PAGE_LOCATOR_HELPERS` from `src/cdp/locator-candidates.js` (or `page-locator-helpers.js`)
- Produces:
  - `buildPhaseHighlightMarkExpression(targets) => string` (IIFE, return `{ hitCount, scroll }`)
  - `buildPhaseHighlightUnmarkExpression() => string`
  - `buildPhaseHighlightScrollExpression({ top }) => string`

Page contract (inside evaluate):

- Reuse `isVisible` / `assignRegion` from helpers.
- Resolve order: unique visible `xpath_smart` → multi + region_id/label match → `xpath_full`.
- Dedupe by element (Set).
- Mark: `data-jsgen-phase-hl="1"` + style tag `#jsgen-phase-hl-style` with Chrome-inspect fill (`outline: 2px solid #1a73e8` + inset `rgba(111,168,220,.45)`).
- Scroll root: visible `.el-main` / `.app-main` with `overflow` auto/scroll and `scrollHeight > clientHeight`; else `document.scrollingElement`.
- Return `{ hitCount, scroll: { top, clientHeight, scrollHeight, overlap: 48 } }`.

- [ ] **Step 1: Failing char — Playwright fixture**

Append (uses installed `playwright`):

```javascript
{
  const { chromium } = await import('playwright');
  const { buildPhaseHighlightMarkExpression, buildPhaseHighlightUnmarkExpression } =
    await import('../../src/cdp/phase-highlight-page.js');
  const html = `<!DOCTYPE html><html><body>
  <div class="el-main" style="height:200px;overflow:auto">
    <div class="el-form-item"><label>客户编号</label><input id="no"></div>
    <div style="height:400px"></div>
    <button id="save">保存</button>
  </div>
  </body></html>`;
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setContent(html);
  const markExpr = buildPhaseHighlightMarkExpression([
    { xpath_smart: "//input[@id='no']", xpath_full: '', region_id: '', region_label: '' },
    { xpath_smart: "//button[@id='missing']", xpath_full: '', region_id: '', region_label: '' },
  ]);
  const marked = await page.evaluate(markExpr);
  assert.equal(marked.hitCount, 1);
  assert.equal(await page.locator('[data-jsgen-phase-hl="1"]').count(), 1);
  await page.evaluate(buildPhaseHighlightUnmarkExpression());
  assert.equal(await page.locator('[data-jsgen-phase-hl="1"]').count(), 0);
  await browser.close();
  ok('page mark/unmark via evaluate string');
}
```

- [ ] **Step 2: Run — expect FAIL** (module missing)

- [ ] **Step 3: Implement `src/cdp/phase-highlight-page.js`**

Must embed `PAGE_LOCATOR_HELPERS` in the mark IIFE. Sketch:

```javascript
import { PAGE_LOCATOR_HELPERS } from './locator-candidates.js';

export function buildPhaseHighlightMarkExpression(targets) {
  const list = JSON.stringify(Array.isArray(targets) ? targets : []);
  return `(() => {
    ${PAGE_LOCATOR_HELPERS}
    const targets = ${list};
    function evalXp(xp) {
      if (!xp) return null;
      try {
        return document.evaluate(xp, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
      } catch (e) { return null; }
    }
    function regionMatch(el, t) {
      if (!t.region_id && !t.region_label) return true;
      const r = assignRegion(el);
      if (t.region_id && r.region_id === t.region_id) return true;
      if (t.region_label && r.region_label === t.region_label) return true;
      return false;
    }
    function pickFromSnap(snap, t) {
      if (!snap || !snap.snapshotLength) return null;
      const vis = [];
      for (let i = 0; i < snap.snapshotLength; i++) {
        const n = snap.snapshotItem(i);
        if (n && isVisible(n)) vis.push(n);
      }
      if (vis.length === 1) return vis[0];
      if (vis.length > 1) {
        const scoped = vis.filter(function (n) { return regionMatch(n, t); });
        if (scoped.length === 1) return scoped[0];
        if (scoped.length > 1) return scoped[0];
      }
      return null;
    }
    function resolveHit(t) {
      const a = pickFromSnap(evalXp(t.xpath_smart), t);
      if (a) return a;
      return pickFromSnap(evalXp(t.xpath_full), t);
    }
    const seen = new Set();
    const hits = [];
    for (let i = 0; i < targets.length; i++) {
      const el = resolveHit(targets[i] || {});
      if (!el || seen.has(el)) continue;
      seen.add(el);
      hits.push(el);
    }
    if (!document.getElementById('jsgen-phase-hl-style')) {
      const st = document.createElement('style');
      st.id = 'jsgen-phase-hl-style';
      st.textContent = '[data-jsgen-phase-hl="1"]{outline:2px solid #1a73e8;outline-offset:0;box-shadow:inset 0 0 0 9999px rgba(111,168,220,.45);}';
      document.documentElement.appendChild(st);
    }
    for (let j = 0; j < hits.length; j++) hits[j].setAttribute('data-jsgen-phase-hl', '1');
    function pickScrollRoot() {
      const cands = document.querySelectorAll('.el-main, .app-main');
      for (let k = 0; k < cands.length; k++) {
        const el = cands[k];
        const s = getComputedStyle(el);
        const oy = s.overflowY || s.overflow;
        if ((oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight + 8) return el;
      }
      return document.scrollingElement || document.documentElement;
    }
    const root = pickScrollRoot();
    return {
      hitCount: hits.length,
      scroll: {
        top: root.scrollTop || 0,
        clientHeight: root.clientHeight || 0,
        scrollHeight: root.scrollHeight || 0,
        overlap: 48,
      },
    };
  })()`;
}

export function buildPhaseHighlightUnmarkExpression() {
  return `(() => {
    document.querySelectorAll('[data-jsgen-phase-hl]').forEach(function (el) {
      el.removeAttribute('data-jsgen-phase-hl');
    });
    const st = document.getElementById('jsgen-phase-hl-style');
    if (st) st.remove();
    return { ok: true };
  })()`;
}

export function buildPhaseHighlightScrollExpression({ top }) {
  const y = Number(top) || 0;
  return `(() => {
    const cands = document.querySelectorAll('.el-main, .app-main');
    let root = document.scrollingElement || document.documentElement;
    for (let k = 0; k < cands.length; k++) {
      const el = cands[k];
      const s = getComputedStyle(el);
      const oy = s.overflowY || s.overflow;
      if ((oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight + 8) { root = el; break; }
    }
    root.scrollTop = ${y};
    return { top: root.scrollTop, clientHeight: root.clientHeight, scrollHeight: root.scrollHeight };
  })()`;
}
```

- [ ] **Step 4: Run char — expect PASS**

---

### Task 5: `pngjs` stitch

**Files:**
- Create: `src/cdp/png-stitch.js`
- Modify: `package.json` (add `"pngjs": "^7.0.0"`)
- Modify: characterization file

**Interfaces:**
- Consumes: PNG buffers from `Page.captureScreenshot`
- Produces: `stitchPngSlices(buffers: Buffer[], { overlap?: number, maxBytes?: number }) => Buffer`

- [ ] **Step 1: Install**

```powershell
cd d:\dev\JS-gen
npm install pngjs@7 --save
```

- [ ] **Step 2: Failing char** — two 10×10 PNGs overlap 0 → height 20; with overlap 2 → height 18.

Use `pngjs` in the test to synthesize inputs, then call `stitchPngSlices`.

- [ ] **Step 3: Implement `src/cdp/png-stitch.js`**

```javascript
import { PNG } from 'pngjs';

const DEFAULT_MAX_BYTES = 12_000_000;

export function stitchPngSlices(buffers, { overlap = 48, maxBytes = DEFAULT_MAX_BYTES } = {}) {
  if (!Array.isArray(buffers) || !buffers.length) {
    throw new Error('stitchPngSlices: empty buffers');
  }
  const pngs = buffers.map((b) => PNG.sync.read(Buffer.isBuffer(b) ? b : Buffer.from(b)));
  const width = pngs[0].width;
  const ov = Math.max(0, Number(overlap) || 0);
  let height = pngs[0].height;
  for (let i = 1; i < pngs.length; i++) {
    if (pngs[i].width !== width) {
      throw new Error('stitchPngSlices: width mismatch');
    }
    height += Math.max(0, pngs[i].height - ov);
  }
  const out = new PNG({ width, height });
  let y = 0;
  for (let i = 0; i < pngs.length; i++) {
    const src = pngs[i];
    const skip = i === 0 ? 0 : Math.min(ov, src.height);
    for (let row = skip; row < src.height; row++) {
      const srcStart = (row * width) << 2;
      const dstStart = (y * width) << 2;
      src.data.copy(out.data, dstStart, srcStart, srcStart + (width << 2));
      y += 1;
    }
  }
  let packed = PNG.sync.write(out);
  if (packed.length > maxBytes && height > 2) {
    const half = new PNG({ width, height: Math.floor(height / 2) });
    for (let row = 0; row < half.height; row++) {
      const srcStart = ((row * 2) * width) << 2;
      const dstStart = (row * width) << 2;
      out.data.copy(half.data, dstStart, srcStart, srcStart + (width << 2));
    }
    packed = PNG.sync.write(half);
  }
  return packed;
}
```

- [ ] **Step 4: Char PASS**

---

### Task 6: `runPhaseHighlightCapture(cdpClient, targets)`

**Files:**
- Create: `src/cdp/phase-highlight-capture.js`
- Modify: characterization (Playwright CDP: `page.context().newCDPSession(page)` or use `page.evaluate` + `page.screenshot` stand-in)

**Interfaces:**
- Consumes: `buildPhaseHighlight*` (Task 4), `stitchPngSlices` (Task 5)
- Produces: `runPhaseHighlightCapture(client, targets) => Promise<{ buffer: Buffer, hitCount: number }>`
  - `client.send(method, params)` like `CdpClient`
  - Always unmark in `finally`
  - Restore `scroll.top`
  - Max 30 slices; step = `clientHeight - overlap`

If Playwright's CDP session is awkward in char, char this module by:

1. Source cues: `Page.captureScreenshot`, `buildPhaseHighlightMarkExpression`, `stitchPngSlices`, `finally` unmark.
2. Playwright path: launch page, wrap `page.evaluate` + `page.screenshot({ type: 'png' })` is **not** the production client — production must use CDP.

Prefer a thin adapter in the capture file:

```javascript
async function cdpEval(client, expression) {
  const result = await client.send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: false,
  });
  if (result?.exceptionDetails) {
    throw new Error(result.exceptionDetails.text || 'evaluate failed');
  }
  return result?.result?.value;
}

async function cdpPng(client) {
  const shot = await client.send('Page.captureScreenshot', {
    format: 'png',
    fromSurface: true,
    captureBeyondViewport: false,
  });
  return Buffer.from(shot.data, 'base64');
}
```

Playwright char: `const client = await page.context().newCDPSession(page); await client.send('Page.enable');` then `runPhaseHighlightCapture(client, targets)` on the Task 4 HTML (tall `.el-main`). Assert `result.buffer` starts with PNG magic `89 50 4E 47`.

- [ ] **Step 1: Failing char** (import missing)
- [ ] **Step 2: Implement capture loop**
- [ ] **Step 3: Char PASS** (PNG magic + unmark)

---

### Task 7: Orchestrator `capturePhaseHighlightScreenshot` (fail-soft)

**Files:**
- Create: `src/services/trajectory/phase-highlight-screenshot.js`
- Modify: `src/cdp/remote-bridge/index.js` (export getter)
- Modify: characterization (source + mock)

**Interfaces:**
- Consumes: `trajectoryStepDao.listByPhase`, `collectHighlightTargets`, `runPhaseHighlightCapture`, `replacePhaseHighlightScreenshot`, `trajectoryPhaseDao.update`
- Produces: `capturePhaseHighlightScreenshot({ trajectoryId, phaseId, cdpClient }) => Promise<{ ok: boolean, screenshotId?: number, skipped?: string, hitCount?: number }>`
  - No throw to caller for CDP/stitch/DAO errors (catch + warn + `{ ok: false, skipped }`)
  - Insert screenshot **then** `update(phaseId, { stitchScreenshotId })`

CDP client injection: orchestrator accepts `cdpClient` so Task 8/9 can pass local BiB or skip. If `!cdpClient` → `{ ok: false, skipped: 'no_cdp' }` without throw.

- [ ] **Step 1: Char** — mock `cdpClient` throwing on send → `{ ok: false }` and does not throw.

Because the real orchestrator hits MySQL, keep this char as **source contract**:

```javascript
{
  const src = readFileSync(join(root, 'src/services/trajectory/phase-highlight-screenshot.js'), 'utf8');
  assert.match(src, /export async function capturePhaseHighlightScreenshot/);
  assert.match(src, /collectHighlightTargets/);
  assert.match(src, /runPhaseHighlightCapture/);
  assert.match(src, /replacePhaseHighlightScreenshot/);
  assert.match(src, /stitchScreenshotId/);
  assert.match(src, /console\.warn/);
  ok('orchestrator fail-soft cues');
}
```

Plus a small exported helper used by tests:

```javascript
export function wrapCaptureError(err) {
  console.warn('[record] phase highlight screenshot skipped:', err?.message || err);
  return { ok: false, skipped: String(err?.message || err || 'error') };
}
```

Char: `assert.deepEqual(wrapCaptureError(new Error('cdp')), { ok: false, skipped: 'cdp' })`

- [ ] **Step 2: Implement orchestrator**

```javascript
export async function capturePhaseHighlightScreenshot({
  trajectoryId,
  phaseId,
  cdpClient,
} = {}) {
  try {
    if (!cdpClient) return { ok: false, skipped: 'no_cdp' };
    const steps = await trajectoryStepDao.listByPhase(phaseId);
    const targets = collectHighlightTargets(steps);
    const { buffer, hitCount } = await runPhaseHighlightCapture(cdpClient, targets);
    const screenshotId = await replacePhaseHighlightScreenshot(phaseId, {
      trajectoryId,
      buffer,
      mimeType: 'image/png',
    });
    if (screenshotId) {
      await trajectoryPhaseDao.update(phaseId, { stitchScreenshotId: screenshotId });
    }
    return { ok: true, screenshotId, hitCount };
  } catch (err) {
    return wrapCaptureError(err);
  }
}
```

`runPhaseHighlightCapture` **must** return `{ buffer, hitCount }` (DOM hits from mark). Task 6 chars assert PNG magic on `result.buffer`.

- [ ] **Step 3: Export `getAttachedCdpClient()` from remote-bridge**

In `src/cdp/remote-bridge/index.js`:

```javascript
export function getAttachedCdpClient() {
  return bridge.client || null;
}
```

Re-export from `src/cdp/remote-bridge.js` if that barrel is what services import.

- [ ] **Step 4: Char PASS**

---

### Task 8: Wire AI `phase_done` + executor BiB

**Files:**
- Modify: `src/services/trajectory/trajectory-recording-runner.js` (~after L371 `updateStatus(..., 'completed')`)
- Modify: `executor/bib-bridge.js`, `executor/session-manager.js`, `executor/session-handler.js`, `executor/agent.mjs`
- Modify: `src/services/trajectory/phase-highlight-screenshot.js` to resolve CDP (local vs executor)
- Modify: characterization (source cues: `capturePhaseHighlightScreenshot`, `bib_phase_highlight_capture`)

**Interfaces:**
- Consumes: `capturePhaseHighlightScreenshot`, `USE_EXECUTOR`, `getAttachedCdpClient`, `execSession.sendToExecutor` / `waitForSessionEvent`
- Produces: WS `session.bib_phase_highlight_capture` → result `{ pngBase64, hitCount, error? }`

- [ ] **Step 1: Char cues**

```javascript
{
  const runner = readFileSync(join(root, 'src/services/trajectory/trajectory-recording-runner.js'), 'utf8');
  assert.match(runner, /capturePhaseHighlightScreenshot/);
  const handler = readFileSync(join(root, 'executor/session-handler.js'), 'utf8');
  assert.match(handler, /bib_phase_highlight_capture/);
  ok('runner + executor wire cues');
}
```

- [ ] **Step 2: Executor `BibBridge.capturePhaseHighlight(targets)`**

```javascript
async capturePhaseHighlight(targets) {
  const { runPhaseHighlightCapture } = await import('../src/cdp/phase-highlight-capture.js');
  if (!this.client) throw new Error('BiB not attached');
  const { buffer, hitCount } = await runPhaseHighlightCapture(this.client, targets || []);
  return { pngBase64: buffer.toString('base64'), hitCount };
}
```

`session-manager.js`: `bibPhaseHighlightCapture(sessionId, { targets, requestId })` — same error shape as `bibResolveElement` (`error` string if no bib).

`session-handler.js` case `'session.bib_phase_highlight_capture'`.

`agent.mjs`: relay result as `session.bib_phase_highlight_capture_result` (copy the `bib_resolve_element_result` pattern at ~L140).

- [ ] **Step 3: Orchestrator CDP resolution**

```javascript
async function resolveCdpClient({ cdpClient, sessionId, executorNodeUuid } = {}) {
  if (cdpClient) return cdpClient;
  if (USE_EXECUTOR && executorNodeUuid && sessionId) {
    return {
      async send(method, params) {
        throw new Error('executor capture should not use raw send');
      },
      __executor: { sessionId, executorNodeUuid },
    };
  }
  return getAttachedCdpClient();
}
```

YAGNI: keep capture on the machine that owns CDP.

In orchestrator, if `USE_EXECUTOR` and `executorNodeUuid`:

```javascript
const requestId = randomUUID();
const resultP = execSession.waitForSessionEvent(
  runtimeSessionId,
  'session.bib_phase_highlight_capture_result',
  60000,
);
execSession.sendToExecutor(executorNodeUuid, 'session.bib_phase_highlight_capture', {
  sessionId: runtimeSessionId,
  requestId,
  targets,
});
const payload = await resultP;
if (payload?.error) return { ok: false, skipped: String(payload.error) };
const buffer = Buffer.from(payload.pngBase64, 'base64');
// persist as today
```

Else local: `runPhaseHighlightCapture(getAttachedCdpClient(), targets)`.

Pass `sessionId` + `executorNodeUuid` from the recording runner.

- [ ] **Step 4: Hook runner** after `await trajectoryPhaseDao.updateStatus(phase.id, 'completed');` and **before** `events.push`:

```javascript
try {
  const { capturePhaseHighlightScreenshot } = await import('./phase-highlight-screenshot.js');
  await capturePhaseHighlightScreenshot({
    trajectoryId: tid,
    phaseId: phase.id,
    sessionId: runtime.sessionId,
    executorNodeUuid: runtime.executorNodeUuid,
  });
} catch (err) {
  console.warn('[record] phase highlight screenshot skipped:', err?.message || err);
}
```

(Double fail-soft: orchestrator already catches; this catch is belt-and-suspenders.)

Do **not** call this from `toggleTrajectoryManualRecord`.

- [ ] **Step 5: Char PASS**

---

### Task 9: Tree payload + api-docs + CHANGELOG

**Files:**
- Modify: `src/services/trajectory-query-service.js` (`getTrajectoryTree` phase map)
- Modify: `src/dashboard/api-docs/groups/trajectory.js` tree example
- Modify: `src/dashboard/api-docs/groups/remote.js` screenshot group description
- Modify: `CHANGELOG.md` `[Unreleased]`
- Modify: characterization

**Interfaces:**
- Consumes: `phase.stitchScreenshotId` from DAO `fromDbRow`
- Produces: each tree phase includes `stitchScreenshotId` and `stitchScreenshotUrl` (`/api/v2/screenshots/${id}/image` when id present)

- [ ] **Step 1: Char cues** on query-service + changelog `phase_highlight`

- [ ] **Step 2: In `getTrajectoryTree`**, when mapping phases:

```javascript
return {
  ...p,
  steps,
  stitchScreenshotId: p.stitchScreenshotId || null,
  stitchScreenshotUrl: p.stitchScreenshotId
    ? `/api/v2/screenshots/${p.stitchScreenshotId}/image`
    : null,
};
```

- [ ] **Step 3: api-docs** — tree `phases[]` example adds `stitchScreenshotId`, `stitchScreenshotUrl`. Screenshot group notes: `kind=phase_highlight` rows have `trajectoryPhaseId` and null `trajectoryStepId`.

- [ ] **Step 4: CHANGELOG `[Unreleased]` Added**

```markdown
- 2026-08-13: **AI 阶段结束长图（控件高亮）**：`phase_done` 后对本阶段产品树步骤在当前页描边并滚主滚动区拼接 1 张 PNG，写入 `screenshot.kind=phase_highlight` 与 `trajectory_phase.stitch_screenshot_id`。失败不影响录制。交易树 phase 带 `stitchScreenshotId` / `stitchScreenshotUrl`。
  影响范围：screenshot / trajectory_phase schema、录制 runner、tree、BiB executor `session.bib_phase_highlight_capture`。
  文件：migrations/20260813100000_phase_highlight_screenshot.js, schemas/init.sql, src/cdp/phase-highlight-*.js, src/services/trajectory/phase-highlight-screenshot.js, executor/bib-bridge.js
  Python 同步提示：对齐 `screenshot.kind` 新枚举与 `trajectory_phase.stitch_screenshot_id`；透传 tree 的 `stitchScreenshotUrl`；执行机需实现 `session.bib_phase_highlight_capture`（JS-gen executor 已加）。
```

- [ ] **Step 5: Run full char**

```powershell
node scripts/characterization/characterize-phase-highlight-screenshot.mjs
node scripts/characterization/characterize-screenshots.mjs
```

Expected: both `ok`

- [ ] **Step 6: Update spec status line** to `Approved — plan at docs/superpowers/plans/2026-08-13-phase-highlight-long-screenshot.md`

---

## Spec coverage (self-review)

| Spec item | Task |
|-----------|------|
| AI `phase_done` only | 8 |
| `filterMetaSteps` | 3 |
| xpath_smart → region → xpath_full | 4 |
| Control outline, not region wash | 4 |
| 0 hits still screenshot | 4 + 6 (mark hitCount 0 still slices) |
| Stitch inner scroll, overlap 48, max 30 | 5–6 |
| Persist phase_highlight + stitch_screenshot_id | 1–2, 7 |
| Insert screenshot then update phase | 7 |
| Fail-soft | 7–8 |
| Executor CDP | 8 |
| Tree URL | 9 |
| No JPEG P0 | 5 maxBytes shrink |
| Manual record out of scope | 8 (no hook) |
| Per-step HL still hung | no task |

## Wet verification (not a blocking task)

On CDP 19242 / BiB after control plane + executor reload: finish an AI phase on the 对公 long form; `GET /api/v2/trajectories/{id}/tree` shows `stitchScreenshotUrl`; image has blue outlines on still-visible filled controls; closed-dialog controls absent; killing CDP mid-phase still yields `recorded`.
