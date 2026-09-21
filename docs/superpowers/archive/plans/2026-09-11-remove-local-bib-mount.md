# Remove Local BiB Mount Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Physically remove control-plane local browser spawn (`ensureGlobalBrowser`) and local CDP attach (`refreshCdpEndpoints` / `attachLive` connect body), while keeping `USE_EXECUTOR` gates and `state.globalBrowser` bag.

**Architecture:** B1 from spec `docs/superpowers/specs/2026-09-11-remove-local-bib-mount-design.md`. Delete dead local mount code; local `attachLive` becomes a loud throw for any residual WS hook; phase-highlight drops `getAttachedCdpClient` fallback. Executor BiB path unchanged.

**Tech Stack:** Node control plane, cold characterization pins, existing executor BiB.

## Global Constraints

- Keep `USE_EXECUTOR` default `true`; `false` → 503 (do not remove the flag).
- Keep `src/runtime/global-browser.js` and `state.globalBrowser` bag (no field migration).
- Do **not** delete entire `src/cdp/remote-bridge/` tree — only local CDP connect / refresh implementation.
- Do not edit Python executor agent behavior beyond what control-plane already does.
- Disjoint from WIP: leave `classify.py` / unrelated verify-all WIP lines intact; only add/adjust our pin lines.
- TDD: failing cold assertions before production deletes.
- Subagents never commit if using SDD under this repo’s AGENTS.md — controller commits after review (or executing-plans follows user commit rules).

## File map

| File | Role after this plan |
|------|----------------------|
| `src/routes/browser-session/global-browser.js` | Gone, or thin `teardownRemoteBridge` only |
| `src/routes/browser-session/register.js` | No spawn; teardown via bridge helpers |
| `src/cdp/remote-bridge/index.js` | No local discover/connect; `attachLive` throws; `getAttachedCdpClient` → null |
| `src/services/trajectory/phase-highlight-screenshot.js` | Executor / explicit client only |
| `scripts/characterization/cold/characterize-remove-local-bib-mount.mjs` | New cold pin |
| `scripts/characterization/cold/characterize-llm-role-env.py` | Point SCENARIO/FORM inject asserts at `executor/session-slot.js` |
| `scripts/characterization/characterize-page-level-screenshot.mjs` | Stop requiring spawn file content if deleted |
| `docs/superpowers/todo-list.md` / `README.md` | Close leftover; one-line doctrine |

---

### Task 1: Failing cold pin for local-mount absence

**Files:**
- Create: `scripts/characterization/cold/characterize-remove-local-bib-mount.mjs`
- Modify: `scripts/refactor/verify-all.sh` — one `run` line after `characterize-executor-only-bib`
- Modify: `scripts/characterization/cold/characterize-executor-only-bib.mjs` — keep existing 503 pins; optionally cross-link comment only

**Interfaces:**
- Produces: RED pin that requires `ensureGlobalBrowser` absent and `attachLive` body not to contain `gb.cdpWsUrl` / `discoverCdp` / `CdpClient().connect` local mount sequence

- [ ] **Step 1: Write the failing pin**

Assert (source-level):
1. No `export async function ensureGlobalBrowser` / `function ensureGlobalBrowser` under `src/`.
2. `src/cdp/remote-bridge/index.js` `attachLive` does **not** call `refreshCdpEndpoints` then `connect(gb.cdpWsUrl)` (pin the absence of `cdpWsUrl` connect path, or require `attachLive` to throw-only / contain the exact error string `local BiB mount removed`).
3. `phase-highlight-screenshot.js` does not import or call `getAttachedCdpClient`.
4. Existing `characterize-executor-only-bib.mjs` still runnable (do not break it).

- [ ] **Step 2: Run pin — expect RED**

```bash
node scripts/characterization/cold/characterize-remove-local-bib-mount.mjs
```

Expected: FAIL on ensureGlobalBrowser still present (or attachLive still connects).

- [ ] **Step 3: Register in verify-all.sh** (single new line; preserve any other-agent WIP lines).

- [ ] **Step 4: Commit** (controller / per team rules)

```
test(cdp): RED pin for remove local BiB mount
```

---

### Task 2: Delete ensureGlobalBrowser / collapse global-browser.js

**Files:**
- Modify or Delete: `src/routes/browser-session/global-browser.js`
- Modify: `src/routes/browser-session/register.js` (teardown import)
- Modify: `scripts/characterization/cold/characterize-llm-role-env.py` — move FORM/SCENARIO/REVIEWER inject checks from `global-browser.js` to `executor/session-slot.js` (already injects these env vars)
- Modify: `scripts/characterization/characterize-page-level-screenshot.mjs` if it `readFileSync`s `global-browser.js` for spawn markers — retarget or drop spawn-specific asserts

**Interfaces:**
- Consumes: Task 1 pin (ensureGlobalBrowser absence)
- Produces: No `ensureGlobalBrowser` export; teardown still available as `detachLive`+`clearCdpEndpoints` (either thin wrapper file or inlined in register)

- [ ] **Step 1: Re-run Task 1 pin — still RED on remaining assert if attachLive not yet fixed; ensureGlobalBrowser assert should go GREEN after this task**

- [ ] **Step 2: Remove spawn implementation**

Preferred end state:
- Delete `ensureGlobalBrowser` and all `spawnAgent` / stdout persist wiring in `global-browser.js`.
- Keep a thin `teardownRemoteBridge` that only calls `detachLive({ crashed: true })` + `clearCdpEndpoints`, **or** delete the file and in `register.js` import those two from `../../cdp/remote-bridge.js` directly.

- [ ] **Step 3: Fix characterization that assumed spawn file injects LLM role env**

In `characterize-llm-role-env.py`, replace `global-browser.js` SCENARIO/FORM/REVIEWER injection checks with `executor/session-slot.js` (same keys). Keep L1C “not injected into spawn” semantics against the correct spawn site.

- [ ] **Step 4: Run**

```bash
node scripts/characterization/cold/characterize-remove-local-bib-mount.mjs
python scripts/characterization/cold/characterize-llm-role-env.py
node scripts/characterization/characterize-page-level-screenshot.mjs
```

Expected: ensureGlobalBrowser-related pin GREEN; llm-role-env GREEN; page-level screenshot GREEN (adjusted).

- [ ] **Step 5: Commit**

```
refactor(browser): remove ensureGlobalBrowser local spawn
```

---

### Task 3: Remove local CDP attach from remote-bridge + phase-highlight

**Files:**
- Modify: `src/cdp/remote-bridge/index.js` (`refreshCdpEndpoints`, `attachLive`, `getAttachedCdpClient`)
- Modify: `src/cdp/remote-bridge.js` re-exports if any export removed
- Modify: `src/services/trajectory/phase-highlight-screenshot.js`
- Grep callers of `refreshCdpEndpoints` / `getAttachedCdpClient` and fix

**Interfaces:**
- Produces:
  - `attachLive(opts)` → throws `Error('local BiB mount removed — use executor')` (or same wording as pin)
  - `getAttachedCdpClient()` → `null`
  - `refreshCdpEndpoints` removed or no-op that does not discover; prefer **delete** and fix imports
- Consumes: Task 1 pin remaining asserts

- [ ] **Step 1: Implement throw-only attachLive; null getAttachedCdpClient; delete local discover/connect body**

Do **not** remove `detachLive`, `startScreencast`, `initRemoteBridgeWs`, `getRemoteStatus`, ws-router — only local mount.

- [ ] **Step 2: phase-highlight — remove else branch that uses `getAttachedCdpClient()`**

Keep: explicit `cdpClient` argument; `USE_EXECUTOR` + executor RPC path. If neither → `{ ok: false, skipped: 'no_cdp' }`.

- [ ] **Step 3: Run pins**

```bash
node scripts/characterization/cold/characterize-remove-local-bib-mount.mjs
node scripts/characterization/cold/characterize-executor-only-bib.mjs
node --check src/cdp/remote-bridge/index.js
node --check src/services/trajectory/phase-highlight-screenshot.js
```

Expected: ALL GREEN.

- [ ] **Step 4: Commit**

```
refactor(cdp): remove local BiB CDP attach; phase-highlight executor-only fallback
```

---

### Task 4: Docs closeout

**Files:**
- Modify: `docs/superpowers/todo-list.md` — `executor-only-bib` leftover “物理删除” → closed / note this plan commits
- Modify: `README.md` — one line: local global-browser spawn / control-plane CDP attach removed; BiB via executor only
- Modify: `docs/superpowers/agent-log.md` — 收工 when executing

- [ ] **Step 1: Docs edits**
- [ ] **Step 2: Commit**

```
docs: close local BiB mount removal leftover
```

---

### Task 5: Smoke (manual, executor online)

**Files:** none (evidence only)

- [ ] With `USE_EXECUTOR=true` and online executor: prepare/attach a trajectory; `POST .../resolve-element` still succeeds.
- [ ] Optional: confirm `USE_EXECUTOR=false` still 503 on session/resolve.
- [ ] Record one-line result in agent-log 收工.

---

## Execution handoff

After this plan is committed, run via **subagent-driven-development** or **executing-plans**. Do not start Task 2 until Task 1 RED is observed.
