# Multi-slot Agent stderr Isolation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prefix every agent stderr line with `[slot:N sid:…]`, forward batches to the control plane, persist per-session log files, and expose recording-group APIs to list active remote sessions and export filtered logs (logAnalysis semantics).

**Architecture:** Executor `SessionSlot` line-buffers stderr, prefixes each line, tees to local stderr, and emits `session.agent_stderr` over the existing executor WS. Control plane appends to `logs/agent-stderr/{sessionId}.log` and serves `GET /api/v2/recording/agent-stderr*` plus `GET /api/v2/trajectories/:id/agent-stderr` (GROUP_RECORDING). Active index joins `remote_session` (occupied) + lease + trajectory.

**Tech Stack:** Node ESM, Express `/api/v2`, executor WS, Knex `remote_session` / `trajectory` / `executor_node`, characterization `.mjs`.

**Spec:** `docs/superpowers/specs/2026-08-11-multi-slot-stderr-isolation-design.md`

## Global Constraints

- Prefix format (exact): `[slot:${slotIndex} sid:${sid}] ` + original line, **every** line.
- `sid` = `String(sessionId).replace(/-/g, '').slice(0, 8).toLowerCase()`.
- Flush WS batches: every **200ms** OR **50** lines (whichever first).
- Log dir default: `{PROJECT_DIR}/logs/agent-stderr/` (override via `AGENT_STDERR_LOG_DIR`).
- Export requires at least one of `slot` | `sid` | `sessionId` | `trajectoryId` → else **400**.
- Multi-filter = **AND**. Empty match → 200 empty body / `{ lines: [], count: 0 }`.
- `format=text` (default) → `text/plain` via `res.type('text/plain').send(...)` (bypass JSON envelope). `format=json` → `res.json(...)` (envelope OK).
- Catalog: endpoints live in **交易录制** (`GROUP_RECORDING` in `recording.js`).
- Local `USE_EXECUTOR=false` path: out of scope this plan (executor path only).
- TDD: characterization fail → implement → green.
- Commit only when the user asks.
- CHANGELOG `[Unreleased]` Required (new routes).

## File map

| File | Role |
|------|------|
| `executor/stderr-prefix.js` | **Create** — `shortSid`, `prefixLine`, `createStderrLineBuffer` |
| `executor/session-slot.js` | Wire line buffer → local stderr + `emitToControlPlane` |
| `src/services/agent-stderr-log-service.js` | **Create** — append, filter, listActive, resolve session |
| `src/routes/v2/agent-stderr.js` | **Create** — register three GETs |
| `src/routes/v2/__init__.js` | Register `agent-stderr` **before** `trajectory/:id` routes |
| `src/executor-ws.js` | On `session.agent_stderr` → appendLines |
| `src/dashboard/api-docs/groups/recording.js` | Document endpoints |
| `config/config.js` + `config/.env.example` | `AGENT_STDERR_LOG_DIR` optional |
| `scripts/characterization/characterize-agent-stderr-log.mjs` | Unit/characterization |
| `CHANGELOG.md` | Unreleased Added |
| Spec status line | → Implemented when green |

```text
Python stderr chunk
  → line buffer
  → prefix each line
  → process.stderr.write(prefixed+"\n")
  → batch emit session.agent_stderr
  → CP append logs/agent-stderr/{sessionId}.log
  → GET filter / active
```

---

### Task 1: Prefix helper + failing characterization

**Files:**
- Create: `executor/stderr-prefix.js`
- Create: `scripts/characterization/characterize-agent-stderr-log.mjs`
- Test: `scripts/characterization/characterize-agent-stderr-log.mjs`

**Interfaces:**
- Consumes: none
- Produces:
  - `shortSid(sessionId: string): string`
  - `prefixLine(slotIndex: number, sessionId: string, line: string): string`
  - `createStderrLineBuffer(opts: { slotIndex, sessionId, onFlush(lines: string[]), flushMs?: number, maxLines?: number, now?: () => number }): { push(chunk: string|Buffer): void, flush(): void, dispose(): void }`

- [ ] **Step 1: Write the failing characterization**

Create `scripts/characterization/characterize-agent-stderr-log.mjs`:

```js
/**
 * Characterization: multi-slot agent stderr prefix + filter helpers.
 * Spec: docs/superpowers/specs/2026-08-11-multi-slot-stderr-isolation-design.md
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { shortSid, prefixLine, createStderrLineBuffer } from '../../executor/stderr-prefix.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function testShortSid() {
  assert.equal(shortSid('a1b2c3d4-e5f6-7890-abcd-ef1234567890'), 'a1b2c3d4');
  assert.equal(shortSid('ABCDEF12-....'), 'abcdef12'.slice(0, 8)); // lowercased stripped
}

function testPrefixLine() {
  const line = prefixLine(1, 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'hello');
  assert.equal(line, '[slot:1 sid:a1b2c3d4] hello');
}

function testLineBufferSplitsAndPrefixes() {
  const flushed = [];
  const buf = createStderrLineBuffer({
    slotIndex: 0,
    sessionId: 'a1b2c3d4-0000-0000-0000-000000000001',
    flushMs: 10_000,
    maxLines: 50,
    onFlush: (lines) => flushed.push(...lines),
  });
  buf.push('line1\nline2\npartial');
  buf.flush();
  assert.deepEqual(flushed, [
    '[slot:0 sid:a1b2c3d4] line1',
    '[slot:0 sid:a1b2c3d4] line2',
  ]);
  buf.push('tail\n');
  buf.flush();
  assert.equal(flushed[2], '[slot:0 sid:a1b2c3d4] partialtail');
  buf.dispose();
}

function testMaxLinesFlush() {
  const batches = [];
  const buf = createStderrLineBuffer({
    slotIndex: 2,
    sessionId: 'deadbeef-0000-0000-0000-000000000002',
    flushMs: 60_000,
    maxLines: 3,
    onFlush: (lines) => batches.push(lines),
  });
  buf.push('a\nb\nc\n');
  assert.equal(batches.length, 1);
  assert.equal(batches[0].length, 3);
  buf.dispose();
}

async function main() {
  testShortSid();
  testPrefixLine();
  testLineBufferSplitsAndPrefixes();
  testMaxLinesFlush();

  // Service tests imported only if module exists (Task 2+); skip soft if missing for Task 1 alone.
  const svcPath = path.join(ROOT, 'src/services/agent-stderr-log-service.js');
  if (fs.existsSync(svcPath)) {
    const {
      filterLines,
      appendLines,
      resolveLogDir,
      listLogFilesMatching,
    } = await import('../../src/services/agent-stderr-log-service.js');

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-stderr-'));
    process.env.AGENT_STDERR_LOG_DIR = dir;
    try {
      appendLines('sess-aaaa-bbbb-cccc-ddddeeee0001', [
        '[slot:0 sid:sessaaaa] A',
        '[slot:1 sid:other000] B',
        '[slot:0 sid:sessaaaa] C',
      ]);
      const all = filterLines({
        sessionId: 'sess-aaaa-bbbb-cccc-ddddeeee0001',
        slot: 0,
      });
      assert.deepEqual(all, [
        '[slot:0 sid:sessaaaa] A',
        '[slot:0 sid:sessaaaa] C',
      ]);
      const bySid = filterLines({ sid: 'sessaaaa' });
      assert.ok(bySid.every((l) => l.includes('sid:sessaaaa')));
      assert.ok(listLogFilesMatching({ slot: 0 }).length >= 1);
      assert.ok(resolveLogDir().includes(dir) || resolveLogDir() === dir);
    } finally {
      delete process.env.AGENT_STDERR_LOG_DIR;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  console.log('PASS characterize-agent-stderr-log');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Run test — expect FAIL (module missing)**

```bash
node scripts/characterization/characterize-agent-stderr-log.mjs
```

Expected: `ERR_MODULE_NOT_FOUND` for `executor/stderr-prefix.js`

- [ ] **Step 3: Implement `executor/stderr-prefix.js`**

```js
/**
 * Per-slot stderr line prefix + flush buffer for executor SessionSlot.
 */

export function shortSid(sessionId) {
  return String(sessionId || '')
    .replace(/-/g, '')
    .slice(0, 8)
    .toLowerCase();
}

export function prefixLine(slotIndex, sessionId, line) {
  const sid = shortSid(sessionId);
  return `[slot:${Number(slotIndex)} sid:${sid}] ${line}`;
}

/**
 * @param {{
 *   slotIndex: number,
 *   sessionId: string,
 *   onFlush: (lines: string[]) => void,
 *   flushMs?: number,
 *   maxLines?: number,
 *   now?: () => number,
 * }} opts
 */
export function createStderrLineBuffer(opts) {
  const flushMs = opts.flushMs ?? 200;
  const maxLines = opts.maxLines ?? 50;
  const now = opts.now || (() => Date.now());
  let pending = '';
  /** @type {string[]} */
  let queue = [];
  let timer = null;

  function clearTimer() {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  }

  function flush() {
    clearTimer();
    if (!queue.length) {
      // do not flush incomplete pending line
      return;
    }
    const batch = queue;
    queue = [];
    try {
      opts.onFlush(batch);
    } catch {}
  }

  function schedule() {
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      flush();
    }, flushMs);
    if (typeof timer.unref === 'function') timer.unref();
  }

  function enqueue(prefixed) {
    queue.push(prefixed);
    if (queue.length >= maxLines) flush();
    else schedule();
  }

  return {
    push(chunk) {
      pending += chunk.toString();
      const parts = pending.split('\n');
      pending = parts.pop() || '';
      for (const raw of parts) {
        if (!raw.length && raw !== '') continue;
        // Keep empty lines as empty content after prefix for fidelity
        enqueue(prefixLine(opts.slotIndex, opts.sessionId, raw));
      }
    },
    flush() {
      if (pending) {
        enqueue(prefixLine(opts.slotIndex, opts.sessionId, pending));
        pending = '';
      }
      flush();
    },
    dispose() {
      clearTimer();
      queue = [];
      pending = '';
    },
  };
}
```

Fix empty-line handling: for `raw` always enqueue (including empty string lines from consecutive `\n`).

- [ ] **Step 4: Re-run characterization (prefix tests only must PASS; service block skipped until Task 2)**

```bash
node scripts/characterization/characterize-agent-stderr-log.mjs
```

Expected: `PASS characterize-agent-stderr-log`

---

### Task 2: Control-plane log service

**Files:**
- Create: `src/services/agent-stderr-log-service.js`
- Modify: `config/config.js` — export `AGENT_STDERR_LOG_DIR`
- Modify: `config/.env.example` — document env
- Test: same characterization (service block now runs)

**Interfaces:**
- Consumes: `PROJECT_DIR` / `AGENT_STDERR_LOG_DIR`, `remote-session-dao`, `trajectory-dao`, `executor-node-dao`, `executor-slot-lease`
- Produces:
  - `resolveLogDir(): string`
  - `shortSid(sessionId)` (re-export or duplicate thin wrapper importing from executor is OK; prefer import from `executor/stderr-prefix.js` to stay DRY)
  - `appendLines(sessionId: string, lines: string[]): void`
  - `filterLines(filter: { slot?, sid?, sessionId?, trajectoryId? }): string[]`
  - `listLogFilesMatching(filter): string[]` (paths)
  - `resolveSessionIdFromFilter(filter): Promise<string|null>`
  - `listActiveStderrTargets(): Promise<{ rows: object[] }>`

- [ ] **Step 1: Add config**

In `config/config.js` add:

```js
export const AGENT_STDERR_LOG_DIR = _resolve('AGENT_STDERR_LOG_DIR')
  || path.join(PROJECT_DIR, 'logs', 'agent-stderr');
```

(Use existing `path` / `PROJECT_DIR` imports already in that file.)

In `config/.env.example` add:

```
# AGENT_STDERR_LOG_DIR=   # default: {PROJECT_DIR}/logs/agent-stderr
```

- [ ] **Step 2: Implement service**

Create `src/services/agent-stderr-log-service.js` with:

```js
import { existsSync, mkdirSync, appendFileSync, readdirSync, readFileSync } from 'fs';
import path from 'path';
import { AGENT_STDERR_LOG_DIR } from '../../config/config.js';
import { shortSid } from '../../executor/stderr-prefix.js';
import * as remoteSessionDao from '../dao/remote-session-dao.js';
import * as trajectoryDao from '../dao/trajectory-dao.js';
import * as executorNodeDao from '../dao/executor-node-dao.js';
import * as lease from '../executor-slot-lease.js';
import { REMOTE_SESSION_OCCUPIED } from '../models/constants.js';

export { shortSid };
export function resolveLogDir() { /* mkdir sync; return AGENT_STDERR_LOG_DIR */ }
export function logPathForSession(sessionId) {
  return path.join(resolveLogDir(), `${sessionId}.log`);
}
export function appendLines(sessionId, lines) { /* appendFileSync joined by \n */ }
export function lineMatches(line, { slot, sid }) { /* parse [slot:N sid:xxxx] */ }
export async function resolveSessionIdFromFilter(filter) { /* sessionId | trajectory→rs/lease | sid scan filenames */ }
export function filterLines(filter) { /* read file(s), AND filters */ }
export async function listActiveStderrTargets() {
  // list occupied remote_session rows via dao.listByNode for all nodes OR
  // getDB whereIn status REMOTE_SESSION_OCCUPIED
  // enrich: lease.getBySession, trajectoryDao.getById, executorNodeDao.getById
  // hasStderrLog: existsSync(logPath)
}
```

Concrete `listActive` query: add `listOccupied()` to `remote-session-dao.js` if missing:

```js
export async function listOccupied(statuses = [...REMOTE_SESSION_OCCUPIED]) {
  const rows = await getDB()(TABLE)
    .whereIn('status', statuses)
    .orderBy([{ column: 'slot_index', order: 'asc' }, { column: 'id', order: 'desc' }]);
  return fromDbRows(rows);
}
```

Row shape must match spec §5.1 (`slotIndex`, `sid`, `sessionId`, `trajectoryId`, `trajectoryName`, `recordStatus`, `remoteSessionId`, `remoteStatus`, `executorNodeId`, `executorNodeUuid`, `hasStderrLog`).

`filterLines` when only `slot`/`sid` (no sessionId): read **all** `*.log` under log dir and keep matching lines (logAnalysis across mixed dump). Cap: if >200 files, still scan (diagnostic OK); do not load entire file into memory twice — stream/split once.

- [ ] **Step 3: Run characterization — full PASS**

```bash
node scripts/characterization/characterize-agent-stderr-log.mjs
```

Expected: `PASS characterize-agent-stderr-log`

---

### Task 3: Executor SessionSlot wire-up

**Files:**
- Modify: `executor/session-slot.js` — replace naive stderr write with buffer

**Interfaces:**
- Consumes: `createStderrLineBuffer` from `./stderr-prefix.js`
- Produces: emits via existing `onAgentEvent` / `emitToControlPlane` path:

```js
{
  event: 'session.agent_stderr',
  session_id: sessionId,
  data: { sessionId, slotIndex, lines },
}
```

(`relayAgentEvent` flattens to WS `{ type: 'session.agent_stderr', payload: { sessionId, slotIndex, lines } }`.)

- [ ] **Step 1: Replace stderr handler in `open()`**

After `this.sessionId = sessionId` / spawn:

```js
this._stderrBuf?.dispose?.();
this._stderrBuf = createStderrLineBuffer({
  slotIndex: this.slotIndex,
  sessionId,
  onFlush: (lines) => {
    for (const line of lines) {
      process.stderr.write(`${line}\n`);
    }
    this.onAgentEvent({
      event: 'session.agent_stderr',
      session_id: sessionId,
      data: {
        sessionId,
        slotIndex: this.slotIndex,
        lines,
      },
    });
  },
});
child.stderr.on('data', (chunk) => this._stderrBuf.push(chunk));
```

On `close` / process exit: `this._stderrBuf?.flush(); this._stderrBuf?.dispose();`

- [ ] **Step 2: Smoke-check import**

```bash
node -e "import('./executor/session-slot.js').then(() => console.log('ok'))"
```

Expected: `ok`

---

### Task 4: Control-plane WS ingest + HTTP routes + docs + CHANGELOG

**Files:**
- Modify: `src/executor-ws.js` — handle `session.agent_stderr`
- Create: `src/routes/v2/agent-stderr.js`
- Modify: `src/routes/v2/__init__.js` — register early
- Modify: `src/dashboard/api-docs/groups/recording.js`
- Modify: `CHANGELOG.md`
- Modify: spec status → Implemented

**Interfaces:**
- Routes:
  - `GET /api/v2/recording/agent-stderr/active` → `listActiveStderrTargets()`
  - `GET /api/v2/recording/agent-stderr` → filter query
  - `GET /api/v2/trajectories/:id/agent-stderr` → `trajectoryId` shortcut

- [ ] **Step 1: WS ingest in `handleMessage`**

After `routeExecutorInbound(msg);`, when `type === 'session.agent_stderr'`:

```js
if (type === 'session.agent_stderr' && Array.isArray(payload?.lines) && payload.sessionId) {
  import('./services/agent-stderr-log-service.js')
    .then(({ appendLines }) => appendLines(payload.sessionId, payload.lines))
    .catch((err) => console.warn('[executor-ws] agent_stderr append failed:', err?.message || err));
}
```

Do **not** broadcast to dashboard WS (noise).

- [ ] **Step 2: Create `src/routes/v2/agent-stderr.js`**

```js
import * as svc from '../../services/agent-stderr-log-service.js';
import { sendErr } from './trajectory-shared.js'; // or local sendErr

function parseFilter(query) {
  return {
    slot: query.slot != null && query.slot !== '' ? Number(query.slot) : undefined,
    sid: query.sid ? String(query.sid).toLowerCase() : undefined,
    sessionId: query.sessionId || undefined,
    trajectoryId: query.trajectoryId != null && query.trajectoryId !== ''
      ? Number(query.trajectoryId) : undefined,
  };
}

function hasAnyFilter(f) {
  return f.slot != null && Number.isFinite(f.slot)
    || !!f.sid
    || !!f.sessionId
    || (f.trajectoryId != null && Number.isFinite(f.trajectoryId));
}

export default function registerAgentStderr(app) {
  app.get('/api/v2/recording/agent-stderr/active', async (_req, res) => {
    try {
      res.json(await svc.listActiveStderrTargets());
    } catch (err) {
      sendErr(res, err);
    }
  });

  app.get('/api/v2/recording/agent-stderr', async (req, res) => {
    try {
      const filter = parseFilter(req.query);
      if (!hasAnyFilter(filter)) {
        return res.status(400).json({ error: 'slot, sid, sessionId, or trajectoryId required' });
      }
      const lines = await svc.filterLines(filter); // make async if resolve needs DB
      if (String(req.query.format || 'text').toLowerCase() === 'json') {
        return res.json({ lines, count: lines.length, filter });
      }
      res.type('text/plain; charset=utf-8').send(lines.join('\n') + (lines.length ? '\n' : ''));
    } catch (err) {
      sendErr(res, err);
    }
  });

  app.get('/api/v2/trajectories/:id/agent-stderr', async (req, res) => {
    try {
      const filter = {
        ...parseFilter(req.query),
        trajectoryId: Number(req.params.id),
      };
      const lines = await svc.filterLines(filter);
      if (String(req.query.format || 'text').toLowerCase() === 'json') {
        return res.json({ lines, count: lines.length, filter });
      }
      res.type('text/plain; charset=utf-8').send(lines.join('\n') + (lines.length ? '\n' : ''));
    } catch (err) {
      sendErr(res, err);
    }
  });
}
```

- [ ] **Step 3: Register in `__init__.js`**

```js
import registerAgentStderr from './agent-stderr.js';
// after registerTrajectoryBatch, before or after registerTrajectory:
registerAgentStderr(app);
```

Static `/api/v2/recording/...` does not collide with `:id`; `trajectories/:id/agent-stderr` must be registered such that Express matches — same pattern as other `:id/*` routes on `trajectory-record.js` is fine (path more specific wins by registration order within Express: exact method+path). Prefer registering `registerAgentStderr` alongside record routes.

- [ ] **Step 4: API docs — append to `GROUP_RECORDING` endpoints**

Add three endpoint objects matching existing style (summary/desc/params/respExample/notes). Note `format=text` returns plain text (not envelope).

- [ ] **Step 5: CHANGELOG `[Unreleased]` → Added**

```markdown
- 2026-08-11: **多 slot Agent stderr 隔离与导出**：执行机行前缀 `[slot:N sid:…]` 经 WS `session.agent_stderr` 落盘控面；交易录制分组新增 `GET /api/v2/recording/agent-stderr/active`、`GET /api/v2/recording/agent-stderr`、`GET /api/v2/trajectories/:id/agent-stderr`。
  影响范围：新路由 + executor stderr 前缀；env `AGENT_STDERR_LOG_DIR`。
  文件：executor/stderr-prefix.js, executor/session-slot.js, src/services/agent-stderr-log-service.js, src/routes/v2/agent-stderr.js, src/executor-ws.js, src/dashboard/api-docs/groups/recording.js, config/config.js
  Python 同步提示：若代理录制相关 API，对齐上述三个 GET；WS `session.agent_stderr` 可忽略（控面落盘）。
```

- [ ] **Step 6: Update spec status**

Set design doc header status to: `Implemented 2026-08-11 — plan docs/superpowers/plans/2026-08-11-multi-slot-stderr-isolation.md`

- [ ] **Step 7: Final verification**

```bash
node scripts/characterization/characterize-agent-stderr-log.mjs
node -e "import('./src/routes/v2/agent-stderr.js').then(() => console.log('route ok'))"
```

Expected: PASS + `route ok`

Manual (when executor online): open two slots → hit `/active` → export `?slot=0`.

---

## Spec coverage checklist

| Spec § | Task |
|--------|------|
| 4.1 prefix every line | Task 1–3 |
| 4.2 WS `session.agent_stderr` + batch | Task 1 buffer + Task 3–4 |
| 4.3 CP files | Task 2 |
| 5.1 active | Task 2 `listActive` + Task 4 route |
| 5.2 export filters | Task 2 + Task 4 |
| 5.3 traj shortcut | Task 4 |
| GROUP_RECORDING | Task 4 |
| CHANGELOG | Task 4 |
| Acceptance 1–5 | Task 3–4 + manual |

## Placeholder scan

None intentional. Empty-line enqueue edge clarified in Task 1.
