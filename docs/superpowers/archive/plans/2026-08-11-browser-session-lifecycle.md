# Browser / remote_session Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `remote_session.trajectory_id` the sole ownership truth, keep `trajectory.remote_session_id` as a facade-written cache, and enforce grace-period exclusivity after `streamDetach` (foreign claim → 409) with reconcile + structured lifecycle logs.

**Architecture:** Add pure `session-lifecycle-rules.js` for claim/grace decisions; introduce `session-lifecycle.js` as the only mutator for ownership/status (existing HTTP/services call into it). Fix `markIdle` so idle rows **keep** `trajectory_id` and set `grace_until`. Idle-reaper expires grace then closes true orphans. Prefer-idle Chrome reuse must pass the claim gate before binding another traj.

**Tech Stack:** Knex migrations, Node ESM services/DAO, characterization `.mjs` (offline-first), Express v2 remote-session / trajectory attach routes, CHANGELOG for schema/API.

**Spec:** `docs/superpowers/specs/2026-08-11-browser-session-lifecycle-design.md`

## Global Constraints

- Truth column: `remote_session.trajectory_id` only for affiliation decisions.
- Cache column: `trajectory.remote_session_id` written **only** by session-lifecycle facade.
- After `streamDetach`: status=`idle`, **keep** `trajectory_id`, set `grace_until`, **clear** traj cache.
- Foreign claim while `grace_until > now` → HTTP **409** with `code: 'grace_owned'`.
- Hard `detach` / `close` clear ownership immediately (no grace wait).
- Default grace: **15 minutes** via `REMOTE_SESSION_GRACE_MS` (default `900000`).
- Do **not** rewrite slot-lease / BiB bridge / CDP discovery algorithms beyond ownership checks before claim.
- TDD: characterization fail → implement → green.
- Commit only if the user asks (repo rule); steps marked Commit are optional.
- Schema/route/service changes → update `CHANGELOG.md` `[Unreleased]` with Python sync hint.

## File map

| File | Role |
|------|------|
| `migrations/20260811200000_remote_session_grace_until.js` | Add `grace_until`; backfill dirty mounts |
| `schemas/init.sql` | Keep init schema in sync |
| `config/config.js`, `config/.env.example` | `REMOTE_SESSION_GRACE_MS` |
| `src/services/session-lifecycle-rules.js` | Pure: `isWithinGrace`, `canClaimRemoteSession`, error factory |
| `src/services/session-lifecycle.js` | Sole writer: attach ownership, streamDetach, detach/close clear, grace expire, reconcile |
| `src/dao/remote-session-dao.js` | `markIdle` keep traj + grace; `clearGraceOwnership`; `listGraceExpired` |
| `src/dao/trajectory-dao.js` | Adjust stale-mount listing if needed for grace-owned idle |
| `src/services/remote-session-service.js` | Delegate ownership mutations to lifecycle; keep BiB WS attach plumbing |
| `src/services/trajectory/trajectory-attach-service.js` | Claim gate before/around `openSession` + attach |
| `src/services/trajectory-idle-reaper.js` | Call grace expiry then orphan close |
| `src/routes/v2/remote-session.js` | Surface `code` on 409 when present |
| `scripts/characterization/characterize-session-lifecycle.mjs` | Offline rules + source contracts |
| `CHANGELOG.md` | Schema + 409 body + grace semantics |
| Spec status line | Mark plan path when implementing |

```text
attach / streamDetach / detach / close / reaper
        │
        ▼
 session-lifecycle.js  (only FK + status ownership writes)
        │
        ├─ session-lifecycle-rules.js (pure claim/grace)
        ├─ remote-session-dao.js
        └─ trajectory-dao.js (cache only via lifecycle)
```

**Known bug this plan must fix:** `remoteSessionDao.markIdle` currently sets `trajectoryId: null`, which forces unowned idle and enables cross-traj reuse during what should be grace.

---

### Task 1: Schema + config — `grace_until`

**Files:**
- Create: `migrations/20260811200000_remote_session_grace_until.js`
- Modify: `schemas/init.sql` (`remote_session` table)
- Modify: `config/config.js`
- Modify: `config/.env.example`
- Test: migration dry-read + config export smoke in Task 2 char

**Interfaces:**
- Produces: DB column `remote_session.grace_until` DATETIME(3) NULL; export `REMOTE_SESSION_GRACE_MS` (number, default `900000`)

- [ ] **Step 1: Write migration**

```js
/**
 * remote_session.grace_until — streamDetach ownership window.
 * Also one-shot backfill for cross-link / half-empty mounts (truth = trajectory_id).
 */
export async function up(knex) {
  const has = await knex.schema.hasColumn('remote_session', 'grace_until');
  if (!has) {
    await knex.schema.alterTable('remote_session', (t) => {
      t.datetime('grace_until', { precision: 3 }).nullable()
        .comment('streamDetach 宽限截止；期内仍属 trajectory_id；到期后清空归属')
        .after('trajectory_id');
      t.index(['grace_until'], 'idx_rs_grace_until');
    });
  }

  // Cross-link: traj cache points at rs owned by another traj → clear cache (+ demote live)
  const cross = await knex('trajectory as t')
    .join('remote_session as rs', 'rs.id', 't.remote_session_id')
    .whereNotNull('rs.trajectory_id')
    .whereRaw('rs.trajectory_id <> t.id')
    .select('t.id as tid', 't.record_status as recordStatus');
  for (const row of cross) {
    const patch = { remote_session_id: null, updated_at: knex.fn.now() };
    if (row.recordStatus === 'live') patch.record_status = 'draft';
    await knex('trajectory').where({ id: row.tid }).update(patch);
  }

  // Half-empty: traj → rs, rs.trajectory_id NULL, rs still occupied → set truth to traj
  // Prefer lowest traj id if multiple caches point at same rs (exclusive).
  const half = await knex('trajectory as t')
    .join('remote_session as rs', 'rs.id', 't.remote_session_id')
    .whereNull('rs.trajectory_id')
    .whereIn('rs.status', ['active', 'idle'])
    .select('t.id as tid', 'rs.id as rid')
    .orderBy(['rs.id', 't.id']);
  const claimed = new Set();
  for (const row of half) {
    if (claimed.has(row.rid)) {
      await knex('trajectory').where({ id: row.tid }).update({
        remote_session_id: null,
        updated_at: knex.fn.now(),
      });
      continue;
    }
    claimed.add(row.rid);
    await knex('remote_session').where({ id: row.rid }).update({ trajectory_id: row.tid });
  }

  // Cache → closed/crashed → clear
  await knex('trajectory as t')
    .join('remote_session as rs', 'rs.id', 't.remote_session_id')
    .whereIn('rs.status', ['closed', 'crashed'])
    .update({
      't.remote_session_id': null,
      't.updated_at': knex.fn.now(),
    });
}

export async function down(knex) {
  const has = await knex.schema.hasColumn('remote_session', 'grace_until');
  if (!has) return;
  await knex.schema.alterTable('remote_session', (t) => {
    t.dropIndex(['grace_until'], 'idx_rs_grace_until');
    t.dropColumn('grace_until');
  });
}
```

Note: if Knex multi-table `update` with join fails on MySQL driver, replace the closed/crashed block with select-ids + per-row `trajectory` updates (same as cross-link loop).

- [ ] **Step 2: Update `schemas/init.sql`**

In `remote_session` CREATE TABLE, after `trajectory_id` add:

```sql
  `grace_until`         DATETIME(3) DEFAULT NULL COMMENT 'streamDetach 宽限截止；期内仍属 trajectory_id；到期后清空归属',
```

And add `KEY `idx_rs_grace_until` (`grace_until`),`. Update `trajectory_id` comment to: `当前挂载交易；idle 宽限期内仍非空；到期或 detach/close 后 NULL`.

- [ ] **Step 3: Config**

In `config/config.js` (near `EXECUTOR_DISCONNECT_GRACE_MS`):

```js
export const REMOTE_SESSION_GRACE_MS = parseInt(
  _resolve('REMOTE_SESSION_GRACE_MS', '900000'),
  10,
);
```

In `config/.env.example`:

```bash
# remote_session streamDetach ownership grace (ms); default 15min
# REMOTE_SESSION_GRACE_MS=900000
```

- [ ] **Step 4: Commit (only if user asked)**

```bash
git add migrations/20260811200000_remote_session_grace_until.js schemas/init.sql config/config.js config/.env.example
git commit -m "feat(db): add remote_session.grace_until and ownership backfill"
```

---

### Task 2: Pure claim/grace rules + failing characterization

**Files:**
- Create: `src/services/session-lifecycle-rules.js`
- Create: `scripts/characterization/characterize-session-lifecycle.mjs`
- Test: same characterization

**Interfaces:**
- Produces:
  - `isWithinGrace(row, nowMs = Date.now()): boolean`
  - `canClaimRemoteSession(row, claimantTrajectoryId, nowMs = Date.now()): { ok: true } | { ok: false, code: 'grace_owned', ownerTrajectoryId, graceUntil }`
  - `graceOwnedError(details): Error` with `statusCode=409`, `code='grace_owned'`
  - `computeGraceUntil(fromMs = Date.now(), graceMs): Date`

- [ ] **Step 1: Write failing characterization**

```js
/**
 * Session lifecycle ownership rules (offline).
 * Run: node scripts/characterization/characterize-session-lifecycle.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  isWithinGrace,
  canClaimRemoteSession,
  graceOwnedError,
  computeGraceUntil,
} from '../../src/services/session-lifecycle-rules.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');

function testRules() {
  const now = Date.parse('2026-08-11T12:00:00.000Z');
  const graceUntil = new Date(now + 15 * 60 * 1000);

  assert.equal(
    isWithinGrace({ graceUntil, trajectoryId: 36 }, now),
    true,
    'inside grace',
  );
  assert.equal(
    isWithinGrace({ graceUntil, trajectoryId: 36 }, now + 16 * 60 * 1000),
    false,
    'past grace',
  );
  assert.equal(
    isWithinGrace({ graceUntil: null, trajectoryId: 36 }, now),
    false,
    'no grace_until ⇒ not within grace',
  );

  const ownedIdle = {
    id: 576,
    status: 'idle',
    trajectoryId: 129,
    graceUntil,
  };
  const denied = canClaimRemoteSession(ownedIdle, 112, now);
  assert.equal(denied.ok, false);
  assert.equal(denied.code, 'grace_owned');
  assert.equal(denied.ownerTrajectoryId, 129);

  const same = canClaimRemoteSession(ownedIdle, 129, now);
  assert.equal(same.ok, true, 'owner may reclaim during grace');

  const expired = canClaimRemoteSession(
    { ...ownedIdle, graceUntil: new Date(now - 1000) },
    112,
    now,
  );
  // Still has trajectoryId but grace expired → claim rules treat as not grace-blocked
  // (expiry clearer should null trajectory_id; rules allow claim if !isWithinGrace)
  assert.equal(expired.ok, true, 'expired grace claimable even if traj id stale');

  const unowned = { id: 1, status: 'idle', trajectoryId: null, graceUntil: null };
  assert.equal(canClaimRemoteSession(unowned, 112, now).ok, true);

  const err = graceOwnedError({ ownerTrajectoryId: 129, graceUntil, remoteSessionId: 576 });
  assert.equal(err.statusCode, 409);
  assert.equal(err.code, 'grace_owned');

  const until = computeGraceUntil(now, 900000);
  assert.equal(until.toISOString(), graceUntil.toISOString());
}

function testDaoContractSource() {
  const dao = readFileSync(join(root, 'src/dao/remote-session-dao.js'), 'utf8');
  // After Task 3: markIdle must NOT unconditionally null trajectory_id
  assert.match(
    dao,
    /graceUntil|grace_until/,
    'dao must know grace_until',
  );
  assert.doesNotMatch(
    dao,
    /export async function markIdle\([\s\S]*?trajectoryId:\s*null/,
    'markIdle must not clear trajectoryId (grace keeps ownership)',
  );
}

function testConfigExport() {
  const cfg = readFileSync(join(root, 'config/config.js'), 'utf8');
  assert.match(cfg, /REMOTE_SESSION_GRACE_MS/);
}

testRules();
testConfigExport();
// testDaoContractSource runs after Task 3 — call it when implementing Task 3 green
console.log('characterize-session-lifecycle: rules OK');
```

First land Task 2 with only `testRules` + `testConfigExport` (config from Task 1). Defer `testDaoContractSource` until Task 3, or leave it in the file commented until Task 3 Step 4 enables it.

- [ ] **Step 2: Run — expect FAIL (module missing)**

```bash
node scripts/characterization/characterize-session-lifecycle.mjs
```

Expected: `ERR_MODULE_NOT_FOUND` for `session-lifecycle-rules.js`

- [ ] **Step 3: Implement rules**

```js
/** Pure remote_session ownership / grace helpers (no DB). */

export function computeGraceUntil(fromMs = Date.now(), graceMs = 900000) {
  return new Date(Number(fromMs) + Number(graceMs));
}

export function isWithinGrace(row, nowMs = Date.now()) {
  if (!row?.graceUntil) return false;
  const t = new Date(row.graceUntil).getTime();
  if (!Number.isFinite(t)) return false;
  return t > nowMs;
}

/**
 * @param {{ trajectoryId?: number|null, graceUntil?: Date|string|null, status?: string }} row
 * @param {number} claimantTrajectoryId
 */
export function canClaimRemoteSession(row, claimantTrajectoryId, nowMs = Date.now()) {
  const claimant = Number(claimantTrajectoryId);
  const owner = row?.trajectoryId != null ? Number(row.trajectoryId) : null;
  if (!Number.isFinite(claimant) || claimant <= 0) {
    return { ok: false, code: 'invalid_claimant' };
  }
  if (owner == null || !Number.isFinite(owner)) return { ok: true };
  if (owner === claimant) return { ok: true };
  if (isWithinGrace(row, nowMs)) {
    return {
      ok: false,
      code: 'grace_owned',
      ownerTrajectoryId: owner,
      graceUntil: row.graceUntil,
      remoteSessionId: row.id != null ? Number(row.id) : null,
    };
  }
  return { ok: true };
}

export function graceOwnedError(details = {}) {
  const err = new Error(
    `remote_session still owned by trajectory ${details.ownerTrajectoryId} until ${details.graceUntil}`,
  );
  err.statusCode = 409;
  err.code = 'grace_owned';
  err.ownerTrajectoryId = details.ownerTrajectoryId ?? null;
  err.graceUntil = details.graceUntil ?? null;
  err.remoteSessionId = details.remoteSessionId ?? null;
  return err;
}
```

- [ ] **Step 4: Run — expect PASS (rules + config)**

```bash
node scripts/characterization/characterize-session-lifecycle.mjs
```

Expected: `characterize-session-lifecycle: rules OK`

- [ ] **Step 5: Commit (only if user asked)**

```bash
git add src/services/session-lifecycle-rules.js scripts/characterization/characterize-session-lifecycle.mjs
git commit -m "feat: pure remote_session grace/claim rules + characterization"
```

---

### Task 3: DAO — idle keeps ownership + grace helpers

**Files:**
- Modify: `src/dao/remote-session-dao.js`
- Modify: `scripts/characterization/characterize-session-lifecycle.mjs` (enable `testDaoContractSource`)
- Test: characterization

**Interfaces:**
- Consumes: `graceUntil` column; rules module (callers)
- Produces:
  - `markIdle(id, { graceUntil, trajectoryId? })` — status idle; **keep** trajectory_id; set grace_until
  - `clearGraceOwnership(id)` — `trajectory_id=null`, `grace_until=null` (status unchanged)
  - `listGraceExpired({ now = new Date() })` — idle rows with non-null trajectory_id and grace_until <= now

- [ ] **Step 1: Enable DAO source assert in characterization** (uncomment / call `testDaoContractSource`)

- [ ] **Step 2: Run — expect FAIL** on `markIdle` clearing `trajectoryId`

```bash
node scripts/characterization/characterize-session-lifecycle.mjs
```

- [ ] **Step 3: Fix DAO**

Replace `markIdle` / add helpers:

```js
export async function markIdle(id, { graceUntil = null, trajectoryId } = {}) {
  const patch = {
    status: 'idle',
    graceUntil: graceUntil ?? null,
  };
  // Keep existing trajectory_id unless explicitly overridden.
  if (trajectoryId !== undefined) {
    patch.trajectoryId = trajectoryId == null ? null : Number(trajectoryId);
  }
  return update(id, patch);
}

export async function clearGraceOwnership(id) {
  return update(id, {
    trajectoryId: null,
    graceUntil: null,
  });
}

export async function listGraceExpired({ now = new Date() } = {}) {
  const rows = await getDB()(TABLE)
    .where({ status: 'idle' })
    .whereNotNull('trajectory_id')
    .whereNotNull('grace_until')
    .andWhere('grace_until', '<=', now)
    .orderBy('id', 'asc');
  return fromDbRows(rows);
}
```

Ensure `toDbRow` / `fromDbRow` map `graceUntil` ↔ `grace_until` (helpers already camelCase ↔ snake_case).

Update `close()` to also null `graceUntil`:

```js
export async function close(id, { crashed = false } = {}) {
  return update(id, {
    status: crashed ? 'crashed' : 'closed',
    closedAt: new Date(),
    trajectoryId: null,
    graceUntil: null,
  });
}
```

- [ ] **Step 4: Run characterization — PASS**

- [ ] **Step 5: Commit (only if user asked)**

```bash
git add src/dao/remote-session-dao.js scripts/characterization/characterize-session-lifecycle.mjs
git commit -m "fix(dao): markIdle keeps trajectory_id and sets grace_until"
```

---

### Task 4: Session lifecycle facade — streamDetach / mount / clear

**Files:**
- Create: `src/services/session-lifecycle.js`
- Modify: `src/services/remote-session-service.js` (`detachLive`, `mountTrajectoryRemoteSession`, `getLiveStatus` rewrite)
- Modify: `src/routes/v2/remote-session.js` (pass through `err.code`)
- Test: extend characterization with source contracts on lifecycle + detachLive

**Interfaces:**
- Produces:
  - `syncMount(trajectoryId, remoteSessionId)` — exclusive: set truth + cache in one place
  - `clearMountCache(remoteSessionId, { exceptTrajectoryId?, demoteLive? })` — cache only
  - `streamDetach({ remoteSessionId?, trajectoryId?, crashed?, graceMs? })` — BiB stop still in remote-session-service; ownership via lifecycle
  - `assertClaimable(remoteSessionRow, claimantTrajectoryId)`
  - `expireGrace(remoteSessionId)` / `expireAllDueGrace()`
  - `reconcileDirtyMounts()` — wraps/extends repair + truth backfill

- [ ] **Step 1: Add characterization source contracts**

Append to `characterize-session-lifecycle.mjs`:

```js
function testLifecycleSourceContracts() {
  const life = readFileSync(join(root, 'src/services/session-lifecycle.js'), 'utf8');
  const remote = readFileSync(join(root, 'src/services/remote-session-service.js'), 'utf8');
  assert.match(life, /export async function syncMount/);
  assert.match(life, /export async function streamDetachOwnership/);
  assert.match(life, /export async function expireAllDueGrace/);
  assert.match(life, /grace_owned|canClaimRemoteSession/);
  // detachLive must not call markIdle without going through lifecycle ownership
  assert.match(remote, /session-lifecycle|streamDetachOwnership/);
}
```

- [ ] **Step 2: Run — FAIL missing `session-lifecycle.js`**

- [ ] **Step 3: Implement `session-lifecycle.js` (core)**

```js
import { REMOTE_SESSION_GRACE_MS } from '../../config/config.js';
import * as remoteSessionDao from '../dao/remote-session-dao.js';
import * as trajectoryDao from '../dao/trajectory-dao.js';
import {
  canClaimRemoteSession,
  computeGraceUntil,
  graceOwnedError,
} from './session-lifecycle-rules.js';
import { clearLiveBinding } from './remote-session-state.js';

function logLifecycle(event, fields = {}) {
  console.log(`[lifecycle.${event}]`, JSON.stringify(fields));
}

export function assertClaimable(row, claimantTrajectoryId, nowMs = Date.now()) {
  const r = canClaimRemoteSession(row, claimantTrajectoryId, nowMs);
  if (r.ok) return;
  if (r.code === 'grace_owned') {
    logLifecycle('claim_denied', {
      trajectoryId: claimantTrajectoryId,
      remoteSessionId: r.remoteSessionId,
      ownerTrajectoryId: r.ownerTrajectoryId,
      graceUntil: r.graceUntil,
    });
    throw graceOwnedError(r);
  }
  const err = new Error(r.code || 'claim_denied');
  err.statusCode = 409;
  err.code = r.code;
  throw err;
}

/** Exclusive mount: truth + cache. Clears other caches pointing at this rs. */
export async function syncMount(trajectoryId, remoteSessionId) {
  const tid = Number(trajectoryId);
  const rid = Number(remoteSessionId);
  if (!Number.isFinite(tid) || tid <= 0 || !Number.isFinite(rid) || rid <= 0) return;

  const cleared = await trajectoryDao.clearMountByRemoteSessionId(rid, {
    exceptTrajectoryId: tid,
    demoteLive: true,
  });
  await remoteSessionDao.update(rid, { trajectoryId: tid });
  await trajectoryDao.updateMeta(tid, { remoteSessionId: rid });
  logLifecycle('attach', { trajectoryId: tid, remoteSessionId: rid, clearedCaches: cleared });
  return cleared;
}

/** streamDetach ownership side: idle + grace + clear caches (not Chrome). */
export async function streamDetachOwnership(remoteSessionId, {
  trajectoryId = null,
  graceMs = REMOTE_SESSION_GRACE_MS,
} = {}) {
  const rid = Number(remoteSessionId);
  const remote = await remoteSessionDao.getById(rid);
  if (!remote) return null;

  const owner = trajectoryId != null
    ? Number(trajectoryId)
    : (remote.trajectoryId != null ? Number(remote.trajectoryId) : null);
  const graceUntil = computeGraceUntil(Date.now(), graceMs);

  await remoteSessionDao.markIdle(rid, {
    graceUntil,
    trajectoryId: owner, // keep / set owner during grace
  });
  await trajectoryDao.clearMountByRemoteSessionId(rid, { demoteLive: true });
  clearLiveBinding(rid);
  logLifecycle('stream_detach', { remoteSessionId: rid, trajectoryId: owner, graceUntil });
  logLifecycle('grace_set', { remoteSessionId: rid, trajectoryId: owner, graceUntil });
  return remoteSessionDao.getById(rid);
}

export async function expireAllDueGrace(now = new Date()) {
  const rows = await remoteSessionDao.listGraceExpired({ now });
  const out = [];
  for (const row of rows) {
    await remoteSessionDao.clearGraceOwnership(row.id);
    await trajectoryDao.clearMountByRemoteSessionId(row.id, { demoteLive: true });
    logLifecycle('grace_expire', {
      remoteSessionId: row.id,
      prevTrajectoryId: row.trajectoryId,
    });
    out.push(row.id);
  }
  return out;
}

export async function clearOwnershipOnClose(remoteSessionId) {
  const rid = Number(remoteSessionId);
  await trajectoryDao.clearMountByRemoteSessionId(rid, { demoteLive: true });
  clearLiveBinding(rid);
  logLifecycle('close', { remoteSessionId: rid });
}
```

- [ ] **Step 4: Wire `detachLive` in `remote-session-service.js`**

After BiB `detach_bib` succeeds (existing), replace:

```js
await remoteSessionDao.markIdle(remoteSessionId);
await unmountTrajectoriesFromRemoteSession(...);
```

with:

```js
import * as sessionLifecycle from './session-lifecycle.js';
// ...
await sessionLifecycle.streamDetachOwnership(remoteSessionId, { trajectoryId });
```

Keep crashed → `close` path; call `clearOwnershipOnClose` as well.

Change `mountTrajectoryRemoteSession` body to:

```js
export async function mountTrajectoryRemoteSession(trajectoryId, remoteSessionId) {
  const { syncMount } = await import('./session-lifecycle.js');
  return syncMount(trajectoryId, remoteSessionId);
}
```

Change `getLiveStatus` cache rewrite: when rewriting, call `syncMount` (sets **both** sides), never cache-only `updateMeta`.

- [ ] **Step 5: Route 409 body includes `code`**

In `src/routes/v2/remote-session.js` catch blocks (and trajectory attach route if it surfaces the error):

```js
res.status(err.statusCode || 500).json({
  error: err.message,
  ...(err.code ? { code: err.code } : {}),
  ...(err.ownerTrajectoryId != null ? { ownerTrajectoryId: err.ownerTrajectoryId } : {}),
  ...(err.graceUntil != null ? { graceUntil: err.graceUntil } : {}),
});
```

Apply the same pattern on trajectory attach/prepare route that calls `attachTrajectoryLive`.

- [ ] **Step 6: Run characterization — PASS**

- [ ] **Step 7: Commit (only if user asked)**

```bash
git add src/services/session-lifecycle.js src/services/remote-session-service.js src/routes/v2/remote-session.js scripts/characterization/characterize-session-lifecycle.mjs
git commit -m "feat: session-lifecycle facade for streamDetach grace ownership"
```

---

### Task 5: Reaper — expire grace then orphan close

**Files:**
- Modify: `src/services/trajectory-idle-reaper.js`
- Modify: `server.mjs` boot reconcile if needed (already calls `reconcileStaleTrajectoryRemoteMounts`)
- Test: characterization source assert that reaper calls `expireAllDueGrace`

**Interfaces:**
- Consumes: `expireAllDueGrace`, existing `reapOrphanIdleRemoteSessions`
- Produces: tick order = expire grace → detach idle trajs → close unowned orphans

- [ ] **Step 1: Add char assert**

```js
function testReaperWiresGrace() {
  const src = readFileSync(join(root, 'src/services/trajectory-idle-reaper.js'), 'utf8');
  assert.match(src, /expireAllDueGrace/);
}
```

- [ ] **Step 2: Run — FAIL**

- [ ] **Step 3: Wire reaper**

At start of `reapIdleTrajectoryRuntimes` (before orphan close):

```js
import { expireAllDueGrace } from './session-lifecycle.js';

// inside reapIdleTrajectoryRuntimes, before orphan pass:
let graceExpired = [];
try {
  graceExpired = await expireAllDueGrace();
} catch (err) {
  console.warn('[idle-reaper] grace expire failed:', err.message);
}
```

Include `graceExpired` in return object for ops.

Ensure `reapOrphanIdleRemoteSessions` still requires `trajectory_id IS NULL` (already in `listOrphanIdle`) — grace-owned idle **must not** be closed until expiry clears ownership.

- [ ] **Step 4: Boot reconcile**

Keep `reconcileStaleTrajectoryRemoteMounts` on boot; optionally also call `expireAllDueGrace()` once at boot so overdue grace from downtime clears immediately:

```js
await sessionLifecycle.expireAllDueGrace().catch(() => {});
```

- [ ] **Step 5: Run characterization — PASS**

- [ ] **Step 6: Commit (only if user asked)**

```bash
git add src/services/trajectory-idle-reaper.js server.mjs scripts/characterization/characterize-session-lifecycle.mjs
git commit -m "feat(reaper): expire remote_session grace before orphan close"
```

---

### Task 6: Attach path claim gate (409 `grace_owned`)

**Files:**
- Modify: `src/services/trajectory/trajectory-attach-service.js`
- Modify: `src/services/remote-session-service.js` (`attachLive` idle reuse)
- Modify: `src/routes/v2/trajectory-record.js` (or wherever attach errors are mapped) for `code`
- Test: characterization source + rules already cover denial

**Interfaces:**
- Consumes: `assertClaimable`, `syncMount`
- Produces: foreign attach against grace-owned idle rs → 409 before Chrome steal

- [ ] **Step 1: Gate idle row reuse in `attachLive`**

Before `markActive` on an idle `remoteSession`:

```js
import { assertClaimable } from './session-lifecycle.js';

if (remoteSession && remoteSession.status === 'idle') {
  if (Number.isFinite(trajectoryId)) {
    assertClaimable(remoteSession, trajectoryId);
  }
  // then markActive + syncMount as today
}
```

- [ ] **Step 2: Gate Chrome reuse by node/slot**

After `execSession.openSession` returns `{ nodeUuid, cdpPort, reusedChrome, ... }` in `attachTrajectoryLive`, look up occupied idle rows on that node that might own the Chrome:

```js
import * as executorNodeDao from '../../dao/executor-node-dao.js';
import * as remoteSessionDao from '../../dao/remote-session-dao.js';
import { assertClaimable } from '../session-lifecycle.js';

async function assertNoForeignGraceOnNodeSlot(tid, opened) {
  if (!opened?.reusedChrome || opened.cdpPort == null) return;
  const node = opened.nodeUuid
    ? await executorNodeDao.getByUuid(opened.nodeUuid).catch(() => null)
    : null;
  if (!node?.id) return;
  const rows = await remoteSessionDao.listByNode(node.id, ['idle', 'active']);
  for (const row of rows) {
    // Prefer matching slot_index when present; otherwise any grace-owned foreign row on node blocks reuse.
    if (opened.slotIndex != null && row.slotIndex != null
      && Number(row.slotIndex) !== Number(opened.slotIndex)) {
      continue;
    }
    assertClaimable(row, tid);
  }
}
```

Call **before** registering runtime / attaching BiB. On throw 409, release the just-opened session/lease (existing error paths / `closeSession` best-effort) so we do not leave a leaked agent after deny.

If slot matching is too coarse and false-denies, narrow to rows where `agent_session_id` is empty/idle and `grace_until` set — still never allow foreign within grace.

- [ ] **Step 3: Ensure attach HTTP maps `err.code`**

Same JSON shape as Task 4 routes.

- [ ] **Step 4: Run characterization + manual mental check**

```bash
node scripts/characterization/characterize-session-lifecycle.mjs
```

- [ ] **Step 5: Commit (only if user asked)**

```bash
git add src/services/trajectory/trajectory-attach-service.js src/services/remote-session-service.js src/routes/v2/trajectory-record.js
git commit -m "fix: reject foreign attach during remote_session grace"
```

---

### Task 7: CHANGELOG + docs + spec status

**Files:**
- Modify: `CHANGELOG.md`
- Modify: `src/dashboard/api-docs/groups/` (recording / remote-session) if 409 example documented
- Modify: `docs/superpowers/specs/2026-08-11-browser-session-lifecycle-design.md` status line

- [ ] **Step 1: CHANGELOG `[Unreleased]` → Added/Fixed**

```markdown
### Fixed

- 2026-08-11: **remote_session 归属真相源 + streamDetach 宽限**：`trajectory_id` 为唯一归属；`trajectory.remote_session_id` 仅门面缓存；`streamDetach` 进入 idle 时保留归属并写 `grace_until`（默认 15min）；宽限期内他交易认领 → 409 `grace_owned`；reaper 先到期清归属再关孤儿。修复 `markIdle` 清空 `trajectory_id` 导致交叉指/易主。
  影响范围：schema（`grace_until`）、attach/streamDetach/detach/reaper 语义、409 响应可含 `code`/`ownerTrajectoryId`/`graceUntil`；env `REMOTE_SESSION_GRACE_MS`。
  文件：migrations/20260811200000_remote_session_grace_until.js, schemas/init.sql, config/config.js, src/services/session-lifecycle*.js, src/dao/remote-session-dao.js, src/services/remote-session-service.js, src/services/trajectory-idle-reaper.js, src/services/trajectory/trajectory-attach-service.js, …
  Python 同步提示：对齐 `remote_session.grace_until`；代理 attach/stream-detach 时透传 409 `code=grace_owned` 与 `ownerTrajectoryId`/`graceUntil`；勿在宽限期内把 idle Chrome 当无主复用。
```

- [ ] **Step 2: API docs example** — document 409 body on attach / remote-session detach if those groups list errors.

- [ ] **Step 3: Spec status** → `Approved + plan docs/superpowers/plans/2026-08-11-browser-session-lifecycle.md`

- [ ] **Step 4: Commit (only if user asked)**

```bash
git add CHANGELOG.md src/dashboard/api-docs/groups/*.js docs/superpowers/specs/2026-08-11-browser-session-lifecycle-design.md
git commit -m "docs: changelog and api notes for session lifecycle grace"
```

---

### Task 8: Wet verification checklist (ops, not blocked on code)

**Files:** none required

- [ ] **Step 1: Run migration** on the env that showed dirty SQL

```bash
npx knex migrate:latest
```

- [ ] **Step 2: Invariant query must return 0**

```sql
SELECT t.id, t.remote_session_id, rs.trajectory_id
FROM trajectory t
JOIN remote_session rs ON rs.id = t.remote_session_id
WHERE rs.trajectory_id IS NOT NULL
  AND rs.trajectory_id <> t.id;
```

- [ ] **Step 3: Product flow**

1. Attach traj A → streamDetach → confirm `rs.status=idle`, `trajectory_id=A`, `grace_until` set, `t.remote_session_id` NULL.  
2. Attach traj B intending same Chrome → **409** `grace_owned`.  
3. Set short `REMOTE_SESSION_GRACE_MS=5000` in a test env → wait → B attach succeeds or new Chrome.  
4. Hard detach A → ownership cleared immediately; slot free.

- [ ] **Step 4: Grep logs** for `lifecycle.claim_denied` / `grace_set` / `grace_expire`

---

## Spec coverage (self-review)

| Spec requirement | Task |
|------------------|------|
| Truth = `remote_session.trajectory_id` | 3–4 (`syncMount`, markIdle keep) |
| Cache only via facade | 4 |
| State machine streamDetach → idle+grace | 3–4 |
| Foreign claim 409 | 2, 6 |
| Grace default 15m + env | 1 |
| Reaper expiry then orphan | 5 |
| Reconcile / backfill cross-link & half-empty | 1, 4/5 boot |
| Observability `lifecycle.*` | 4–5 |
| Non-goal: no slot/BiB rewrite | honored (claim gate only) |
| CHANGELOG + Python hint | 7 |
| Invariant SQL acceptance | 8 |

## Placeholder / consistency check

- No TBD steps; `markIdle` behavior explicitly corrected.
- Error code consistently `grace_owned`.
- Facade name: `session-lifecycle.js` with functions `syncMount` / `streamDetachOwnership` / `expireAllDueGrace` / `assertClaimable` — attach + remote-session-service must import these names only.
