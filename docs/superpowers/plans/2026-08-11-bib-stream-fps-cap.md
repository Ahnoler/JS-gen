# BiB Stream FPS Cap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cap BiB JPEG screencast forward rate to ~11fps while keeping encode resolution and quality unchanged, so public-network canvas viewing is smoother and less behind.

**Architecture:** Extract shared screencast timing defaults + env overrides into `src/cdp/screencast-timing.js`. Both `executor/bib-bridge.js` and `src/cdp/remote-bridge` call `resolveScreencastTiming()` for `MIN_FORWARD_MS` / `everyNthFrame`. CDP ack stays immediate; throttle only affects RSCF forward. Update `/api/docs` WS notes.

**Tech Stack:** Node ESM, CDP `Page.startScreencast`, RSCF binary WS, characterization `.mjs`.

**Spec:** `docs/superpowers/specs/2026-08-11-bib-stream-fps-cap-design.md`

## Global Constraints

- **Do not** lower `maxWidth` / `maxHeight` or default `quality` (~65).
- Target ~**10–12fps**: default `MIN_FORWARD_MS = 90`, `EVERY_NTH_FRAME = 2`.
- Always **immediate** `Page.screencastFrameAck`; never defer ack for throttle.
- Stall watchdog keys off CDP frame callbacks (`lastFrameAt`), **not** forward success.
- Executor path and local remote-bridge must share the **same** timing semantics.
- Env overrides: `BIB_STREAM_MIN_FORWARD_MS` (clamp 50–500), `BIB_STREAM_EVERY_NTH_FRAME` (clamp 1–5); invalid → defaults.
- TDD: characterization fail → implement → green.
- Commit only when the user asks.
- No WebRTC / SwiftShader / Xvfb changes in this plan.
- CHANGELOG `[Unreleased]` briefly notes product stream FPS change (api-docs / BiB behavior).

## File map

| File | Role |
|------|------|
| `src/cdp/screencast-timing.js` | **Create** — defaults + `resolveScreencastTiming(env)` |
| `scripts/characterization/characterize-screencast-timing.mjs` | **Create** — assert defaults, clamps, startScreencast cue |
| `executor/bib-bridge.js` | Use shared timing for throttle + `everyNthFrame` |
| `src/cdp/remote-bridge/state.js` | Export timing from shared module (replace hard-coded 33) |
| `src/cdp/remote-bridge/screencast.js` | Pass `everyNthFrame` into `Page.startScreencast` |
| `src/dashboard/api-docs/groups/websocket.js` | Docs: ~30fps → ~10–12fps |
| `CHANGELOG.md` | Unreleased note |
| Spec status line | → Implemented when green |

```text
Page.screencastFrame
  → ack Chrome immediately (update lastFrameAt)
  → if now - lastForwardAt < minForwardMs → drop
  → else pack RSCF → sendBinary / fan-out (skip slow sockets)
```

---

### Task 1: Shared timing module + failing characterization

**Files:**
- Create: `src/cdp/screencast-timing.js`
- Create: `scripts/characterization/characterize-screencast-timing.mjs`
- Test: `scripts/characterization/characterize-screencast-timing.mjs`

**Interfaces:**
- Consumes: `process.env` (or injected `env` object)
- Produces:
  - `DEFAULT_MIN_FORWARD_MS: number` (= 90)
  - `DEFAULT_EVERY_NTH_FRAME: number` (= 2)
  - `TARGET_FPS: number` (= 11, documentation constant)
  - `resolveScreencastTiming(env?: NodeJS.ProcessEnv): { minForwardMs: number, everyNthFrame: number }`

- [ ] **Step 1: Write the failing characterization**

Create `scripts/characterization/characterize-screencast-timing.mjs`:

```js
/**
 * Characterization: BiB screencast timing defaults (~11fps, resolution untouched).
 * Spec: docs/superpowers/specs/2026-08-11-bib-stream-fps-cap-design.md
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_MIN_FORWARD_MS,
  DEFAULT_EVERY_NTH_FRAME,
  TARGET_FPS,
  resolveScreencastTiming,
} from '../../src/cdp/screencast-timing.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');

assert.equal(TARGET_FPS, 11);
assert.equal(DEFAULT_MIN_FORWARD_MS, 90);
assert.equal(DEFAULT_EVERY_NTH_FRAME, 2);

const base = resolveScreencastTiming({});
assert.equal(base.minForwardMs, 90);
assert.equal(base.everyNthFrame, 2);

const fromEnv = resolveScreencastTiming({
  BIB_STREAM_MIN_FORWARD_MS: '120',
  BIB_STREAM_EVERY_NTH_FRAME: '3',
});
assert.equal(fromEnv.minForwardMs, 120);
assert.equal(fromEnv.everyNthFrame, 3);

const clampedLo = resolveScreencastTiming({
  BIB_STREAM_MIN_FORWARD_MS: '10',
  BIB_STREAM_EVERY_NTH_FRAME: '0',
});
assert.equal(clampedLo.minForwardMs, 50);
assert.equal(clampedLo.everyNthFrame, 1);

const clampedHi = resolveScreencastTiming({
  BIB_STREAM_MIN_FORWARD_MS: '9999',
  BIB_STREAM_EVERY_NTH_FRAME: '99',
});
assert.equal(clampedHi.minForwardMs, 500);
assert.equal(clampedHi.everyNthFrame, 5);

const bad = resolveScreencastTiming({
  BIB_STREAM_MIN_FORWARD_MS: 'nope',
  BIB_STREAM_EVERY_NTH_FRAME: '',
});
assert.equal(bad.minForwardMs, 90);
assert.equal(bad.everyNthFrame, 2);

// Cue: both producers must call startScreencast with everyNthFrame from timing
const bib = fs.readFileSync(path.join(root, 'executor/bib-bridge.js'), 'utf8');
const screencast = fs.readFileSync(
  path.join(root, 'src/cdp/remote-bridge/screencast.js'),
  'utf8',
);
assert.match(bib, /resolveScreencastTiming|EVERY_NTH_FRAME|everyNthFrame/);
assert.match(screencast, /everyNthFrame/);
// Must not hard-code the old 30fps forward interval as the live constant
assert.doesNotMatch(
  fs.readFileSync(path.join(root, 'src/cdp/remote-bridge/state.js'), 'utf8'),
  /export const MIN_FORWARD_MS = 33/,
);

console.log('characterize-screencast-timing: PASS');
```

- [ ] **Step 2: Run characterization — expect FAIL (module missing)**

Run: `node scripts/characterization/characterize-screencast-timing.mjs`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `screencast-timing.js` (or assert failures if stub exists).

- [ ] **Step 3: Implement `src/cdp/screencast-timing.js`**

```js
/**
 * Shared BiB / remote-bridge screencast forward timing.
 * Spec: docs/superpowers/specs/2026-08-11-bib-stream-fps-cap-design.md
 *
 * Resolution/quality are NOT controlled here — only forward cadence + CDP everyNthFrame.
 */
export const TARGET_FPS = 11;
export const DEFAULT_MIN_FORWARD_MS = 90;
export const DEFAULT_EVERY_NTH_FRAME = 2;

const MIN_FORWARD_CLAMP = [50, 500];
const EVERY_NTH_CLAMP = [1, 5];

function parseIntEnv(raw, fallback) {
  if (raw == null || String(raw).trim() === '') return fallback;
  const n = Number.parseInt(String(raw), 10);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, n));
}

/**
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} [env]
 * @returns {{ minForwardMs: number, everyNthFrame: number }}
 */
export function resolveScreencastTiming(env = process.env) {
  const minForwardMs = clamp(
    parseIntEnv(env.BIB_STREAM_MIN_FORWARD_MS, DEFAULT_MIN_FORWARD_MS),
    MIN_FORWARD_CLAMP[0],
    MIN_FORWARD_CLAMP[1],
  );
  const everyNthFrame = clamp(
    parseIntEnv(env.BIB_STREAM_EVERY_NTH_FRAME, DEFAULT_EVERY_NTH_FRAME),
    EVERY_NTH_CLAMP[0],
    EVERY_NTH_CLAMP[1],
  );
  return { minForwardMs, everyNthFrame };
}
```

- [ ] **Step 4: Re-run characterization**

Run: `node scripts/characterization/characterize-screencast-timing.mjs`

Expected: May still FAIL on bib/state cues until Task 2–3 wire producers. If only cue asserts fail, that is OK — proceed to Task 2. If timing asserts fail, fix the module first.

---

### Task 2: Wire executor `BibBridge`

**Files:**
- Modify: `executor/bib-bridge.js`
- Test: `scripts/characterization/characterize-screencast-timing.mjs`

**Interfaces:**
- Consumes: `resolveScreencastTiming` from `../src/cdp/screencast-timing.js`
- Produces: `startScreencast` sends `everyNthFrame`; `_onScreencastFrame` throttles with `minForwardMs`

- [ ] **Step 1: Replace local timing constants**

In `executor/bib-bridge.js`:

1. Add import:

```js
import { resolveScreencastTiming } from '../src/cdp/screencast-timing.js';
```

2. Remove (or stop using) local:

```js
const MIN_FORWARD_MS = 33;
```

3. In constructor, after other fields:

```js
this._minForwardMs = 90;
this._everyNthFrame = 2;
```

4. At start of `startScreencast()`:

```js
const timing = resolveScreencastTiming();
this._minForwardMs = timing.minForwardMs;
this._everyNthFrame = timing.everyNthFrame;
```

5. Change `Page.startScreencast` args to:

```js
await this.client.send('Page.startScreencast', {
  format: 'jpeg',
  quality: this.quality,
  maxWidth: maxW,
  maxHeight: maxH,
  everyNthFrame: this._everyNthFrame,
});
```

Keep `maxWidth` / `maxHeight` / `quality` logic unchanged.

6. In `_onScreencastFrame`, keep immediate `_ackChrome` + `_lastFrameAt = Date.now()` **before** throttle. Replace `MIN_FORWARD_MS` with `this._minForwardMs`:

```js
if (now - this._lastForwardAt < this._minForwardMs) return;
```

Do not change `sendBinary` backpressure behavior in `ws-client.js` (already drops when buffered).

- [ ] **Step 2: Sanity-check stall path**

Confirm `_armStallWatch` still uses `_lastFrameAt` (updated on every CDP frame including dropped-forward frames). No code change if already correct.

- [ ] **Step 3: Run characterization (partial)**

Run: `node scripts/characterization/characterize-screencast-timing.mjs`

Expected: bib cue passes; `state.js` / screencast cues may still fail until Task 3.

---

### Task 3: Wire remote-bridge

**Files:**
- Modify: `src/cdp/remote-bridge/state.js`
- Modify: `src/cdp/remote-bridge/screencast.js`
- Test: `scripts/characterization/characterize-screencast-timing.mjs`

**Interfaces:**
- Consumes: `resolveScreencastTiming`, `DEFAULT_MIN_FORWARD_MS` from `../screencast-timing.js`
- Produces: `MIN_FORWARD_MS` live value for `onScreencastFrame`; `startScreencast` includes `everyNthFrame`

- [ ] **Step 1: Update `state.js`**

Replace hard-coded `export const MIN_FORWARD_MS = 33` with:

```js
import {
  DEFAULT_MIN_FORWARD_MS,
  resolveScreencastTiming,
} from '../screencast-timing.js';

// Re-export default for readers; runtime throttle should use bridge.minForwardMs.
export const MIN_FORWARD_MS = DEFAULT_MIN_FORWARD_MS;
export { resolveScreencastTiming };
```

Keep `STALL_RESTART_MS = 2500` unchanged.

Add to `bridge` initial state:

```js
minForwardMs: DEFAULT_MIN_FORWARD_MS,
everyNthFrame: 2,
```

(Import `DEFAULT_EVERY_NTH_FRAME` as well if preferred over literal `2`.)

- [ ] **Step 2: Update `screencast.js` `startScreencast`**

Import `resolveScreencastTiming` from `./state.js` (re-export) or `../screencast-timing.js`.

At the top of `startScreencast()`:

```js
const timing = resolveScreencastTiming();
bridge.minForwardMs = timing.minForwardMs;
bridge.everyNthFrame = timing.everyNthFrame;
```

Pass into CDP:

```js
await bridge.client.send('Page.startScreencast', {
  format: 'jpeg',
  quality: bridge.quality,
  maxWidth: maxW,
  maxHeight: maxH,
  everyNthFrame: timing.everyNthFrame,
});
```

- [ ] **Step 3: Update `onScreencastFrame` throttle**

Keep immediate ack + `bridge.lastFrameAt = Date.now()` first.

Replace interval check with:

```js
const minForward = bridge.minForwardMs ?? MIN_FORWARD_MS;
if (now - bridge.lastForwardAt < minForward) return;
```

Keep subscriber / `broadcastBinary` bufferedAmount skip as-is.

- [ ] **Step 4: Run full characterization — expect PASS**

Run: `node scripts/characterization/characterize-screencast-timing.mjs`

Expected: `characterize-screencast-timing: PASS`

---

### Task 4: Docs + CHANGELOG + spec status

**Files:**
- Modify: `src/dashboard/api-docs/groups/websocket.js`
- Modify: `CHANGELOG.md`
- Modify: `docs/superpowers/specs/2026-08-11-bib-stream-fps-cap-design.md` (status line)

**Interfaces:**
- Consumes: none
- Produces: docs aligned with ~10–12fps behavior

- [ ] **Step 1: Update api-docs note**

In `src/dashboard/api-docs/groups/websocket.js`, change the notes string from mentioning `约 30fps` to:

```js
'推流为二进制 RSCF JPEG；执行端约 10–12fps 上限（可用 BIB_STREAM_MIN_FORWARD_MS / BIB_STREAM_EVERY_NTH_FRAME 调整）、默认编码跟视口（常见 1600×900）/ quality≈65；画布显示默认自适应容器；编码不强制抬到 1080p',
```

Keep the other two notes (immediate ack; drop old frames on backlog).

- [ ] **Step 2: CHANGELOG `[Unreleased]`**

Under `### Changed` (create section if missing):

```markdown
- 2026-08-11: BiB 画面推流默认限帧约 10–12fps（分辨率/quality 不变），降低公网观看延迟与卡顿。可通过 `BIB_STREAM_MIN_FORWARD_MS`、`BIB_STREAM_EVERY_NTH_FRAME` 调整。
  - 影响：执行机 `bib-bridge`、控制面 `remote-bridge` screencast、`/api/docs` WS 说明。
  - Python 同步提示：无 schema/路由变更；若 Python 控制面有独立 screencast 旁路，对齐限帧默认值即可。
```

- [ ] **Step 3: Spec status**

Set spec header status to: `Implemented 2026-08-11 — plan docs/superpowers/plans/2026-08-11-bib-stream-fps-cap.md` (after implementation is verified).

- [ ] **Step 4: Final verification**

Run:

```bash
node scripts/characterization/characterize-screencast-timing.mjs
```

Expected: PASS.

Manual (server, after deploy/restart executor + control plane): idle BiB watch 1–2 min; confirm smoother / less lag; click canvas still accurate; optional: compare eth0 TX vs prior ~6.5 Mbps baseline.

---

## Spec coverage checklist

| Spec requirement | Task |
|------------------|------|
| Keep resolution / quality | Task 2–3 (untouched encode size/quality) |
| ~11fps via MIN_FORWARD_MS=90 | Task 1–3 |
| everyNthFrame=2 | Task 1–3 |
| Env overrides + clamp | Task 1 |
| Immediate CDP ack | Task 2–3 |
| Stall on CDP frames not forwards | Task 2 step 2, Task 3 |
| Executor + remote-bridge parity | Task 2–3 |
| api-docs FPS text | Task 4 |
| No WebRTC / no res drop | Global + omitted tasks |
| Characterization | Task 1–3 |

## Plan self-review

- No TBD/placeholder steps; full code for timing module and test.
- Names consistent: `resolveScreencastTiming`, `minForwardMs`, `everyNthFrame`, env keys match spec.
- Scheme B (subscribe fan-out) intentionally omitted (spec: optional, not blocking).
