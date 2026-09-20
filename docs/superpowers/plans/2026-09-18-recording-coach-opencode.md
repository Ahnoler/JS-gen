# Recording Coach (OpenCode + Skill) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a bypass CLI under `tools/recording-coach/` that drives JS-gen `/api/v2` recording via OpenCode multi-turn chat + `ui-record-wet-test` skill, with `workflow.json` as phase authority and rule-based `assert_steps` for VERDICT.

**Architecture:** Sidecar Node package (not wired into control-plane `package.json`). OpenCode session (`@opencode-ai/sdk`) holds chat; local `workflow.json` holds CollectInputs→Done phases; HTTP tools call `localhost:4097`; Python record agent unchanged. Phase transitions only on successful tool callbacks.

**Tech Stack:** Node 18+/TypeScript (or plain ESM JS if lighter), `@opencode-ai/sdk` (`createOpencode`), fetch to control plane, characterization pin for `assert_steps` (node or python — prefer node `node --test` or existing mjs pin style).

**Spec:** [`docs/superpowers/specs/2026-09-18-recording-coach-opencode-design.md`](../specs/2026-09-18-recording-coach-opencode-design.md)

> **2026-09-19 补充：** 值守轮询、40 分钟上限、收尾契约、派发前自查以 [`2026-09-19-recording-coach-wet-operator.md`](./2026-09-19-recording-coach-wet-operator.md) 为准。本文件「每 ~5s 轮询」和「through-report 只写 verdict.txt」两处锁定已被该补充计划取代。

## Global Constraints

- OpenCode SDK **only** under `tools/recording-coach/`; do **not** add to repo-root product deps or `record/start` path (AGENTS.md).
- Control plane default `http://127.0.0.1:4097`. OpenCode embedded server default port is **4096** — keep distinct; document both in README.
- Skill true source: `tools/recording-coach/skill/SKILL.md` — OpenCode loads this directory; **no** separate `brief.md`.
- No engine-edit tools; no auto `restart-local` without explicit user confirm in the same turn.
- MVP: one Recording at a time per Coach process; `RetryNewTraj` reuses OpenCode session.
- Evidence under `tmp/recording-coach-<ts>/` (gitignored); never commit secrets.
- **`start_record` locked to Strategy A:** long HTTP timeout on `POST .../record/start` while polling `GET .../trajectories/{id}` every ~5s for stepCount/recordStatus (user-facing progress). On timeout → detach + BLOCKED.
- Characterization: RED pin first for `assert_steps`; register in `verify-all.sh` only if adding a new pin file under `scripts/characterization/`.
- Commit only when user asks (plan commit steps = optional checkpoints).

## Locked decisions (spec §14)

| Item | Lock |
|------|------|
| SDK package | `@opencode-ai/sdk` — `createOpencode()` / `client.session.*` ([docs](https://opencode.ai/docs/sdk/)) |
| start_record | Strategy A (long timeout + poll) |
| through-report | MVP: `verdict.txt` + `traj-id.txt` only |
| OpenCode data dir | Pass `location.directory` = evidenceDir or repo root; record actual path in README after first smoke |

## File map

| Path | Role |
|------|------|
| `tools/recording-coach/package.json` | Sidecar deps (`@opencode-ai/sdk`, typescript/tsx optional) |
| `tools/recording-coach/README.md` | Start, ports 4096 vs 4097, env `JSGEN_BASE_URL` |
| `tools/recording-coach/skill/SKILL.md` | Job handbook (moved from `scripts/prompts/skills/ui-record-wet-test/`) |
| `tools/recording-coach/src/assert-steps.mjs` | Pure `assertSteps(traj, criteria) → {ok, reasons}` |
| `tools/recording-coach/src/workflow.mjs` | Load/save `workflow.json`; `transition(from,to)` allowlist |
| `tools/recording-coach/src/http.mjs` | Thin fetch wrapper to `/api/v2` |
| `tools/recording-coach/src/tools.mjs` | Tool handlers; gate on phase; advance workflow |
| `tools/recording-coach/src/index.mjs` | CLI: create evidenceDir, OpenCode session, load `../skill` |
| `tools/recording-coach/src/opencode-plugin.mjs` | Register coach tools with OpenCode (or document fallback) |
| `scripts/characterization/cold/characterize-recording-coach-assert.mjs` | Pin assert_steps fixtures |
| `scripts/refactor/verify-all.sh` | Register new pin (one line) |
| Spec §13 checkbox | Mark plan done after this file lands |

---

### Task 1: `assert_steps` pure function + pin

**Files:**
- Create: `tools/recording-coach/src/assert-steps.mjs`
- Create: `scripts/characterization/cold/characterize-recording-coach-assert.mjs`
- Modify: `scripts/refactor/verify-all.sh` (register pin)

**Interfaces:**
- Produces: `export function assertSteps(trajectory, criteria) → { pass: boolean, reasons: string[], verdict: 'DONE'|'DONE_WITH_CONCERNS'|'BLOCKED' }`
- Criteria keys per spec §7: `minStepCount`, `requireActionTypes`, `paramEquals`, `xpathSmartIncludes`, `rejectZeroStepRecorded`

- [x] **Step 1: Write failing pin** with fixtures: (a) recorded+0 steps → not pass; (b) has `click_table_row_radio` + `row_text=first` → pass; (c) wrong row_text → fail reasons include param.

- [x] **Step 2: Run pin — expect FAIL** (scaffold landed with impl in same pass)

Run: `node scripts/characterization/cold/characterize-recording-coach-assert.mjs`

- [x] **Step 3: Implement `assert-steps.mjs`** minimal rules from spec §7.

- [x] **Step 4: Run pin — expect PASS**; register in `verify-all.sh`.

- [ ] **Step 5: Commit** (if user requested): `test(coach): pin assert_steps for recording-coach`

---

### Task 2: `workflow.json` store + transitions

**Files:**
- Create: `tools/recording-coach/src/workflow.mjs`

**Interfaces:**
- `createEvidenceDir(root?) → { evidenceDir, workflowPath }`
- `loadWorkflow(evidenceDir) / saveWorkflow(wf)`
- `assertTransition(wf, nextPhase)` — throw if illegal
- `applyToolSuccess(wf, toolName, payload)` — sets phase/trajectoryId per table below

| Tool success | Phase after |
|--------------|-------------|
| (manual) inputs complete | ReadyToCreate |
| create_trajectory | Created (+ trajectoryId) |
| prepare_record | Prepared |
| start_record (request accepted / in flight) | Recording |
| start finishes (poll settled) | Settled |
| detach (optional) | stays Settled |
| assert_steps | Asserting then Done (or RetryNewTraj if user later confirms) |
| retry_new_traj | ReadyToCreate (clear trajectoryId, keep inputs) |

- [x] **Step 1: Unit-style self-check** in file or small `node -e` / pin: illegal `Prepared→Done` throws; `create` → Created.

- [x] **Step 2: Implement allowlist + ISO `updatedAt`**.

- [x] **Step 3: Smoke write** to `tmp/recording-coach-selftest/workflow.json` then delete or leave under tmp.

- [ ] **Step 4: Commit** (optional): `feat(coach): workflow.json phase store`

---

### Task 3: HTTP client + control-plane tools

**Files:**
- Create: `tools/recording-coach/src/http.mjs`
- Create: `tools/recording-coach/src/tools.mjs`

**Interfaces:**
- `createClient({ baseUrl })` with `get/post(path, body?, { timeoutMs })`
- Tools: `list_executors`, `get_trajectory` (summary mode default), `analyze_trajectory`, `create_trajectory`, `prepare_record` (timeout≥600000), `start_record` (Strategy A), `detach_trajectory`, `assert_steps` (wrap Task 1), `write_evidence_summary`

**start_record (A):**
1. Gate: phase===Prepared and no other Recording in process.
2. Set phase Recording; save workflow.
3. Fire POST start with timeout e.g. 1800000ms; parallel `setInterval` GET every 5s → append progress lines to `{evidenceDir}/progress.log`.
4. On response or terminal recordStatus → Settled; clear interval.
5. On hard timeout → detach best-effort; lastError; phase Settled or keep Recording→user detach.

- [x] **Step 1: Implement http.mjs** against live or mock; handle `{code,data}` envelope.

- [x] **Step 2: Implement tools with phase gates** calling `applyToolSuccess`.

- [x] **Step 3: Manual dry-run** (4097 up): `list_executors` only — no prepare if busy.

- [ ] **Step 4: Commit** (optional): `feat(coach): HTTP tools for v2 record pipeline`

---

### Task 4: Package scaffold + README（skill 已在 `skill/`）

**Files:**
- Create: `tools/recording-coach/package.json`
- Create: `tools/recording-coach/README.md`
- Ensure: `tools/recording-coach/skill/SKILL.md` already present (canonical)
- Stub (optional keep): `scripts/prompts/skills/ui-record-wet-test/SKILL.md` → points to coach skill
- Ensure root `.gitignore` already covers `tmp/` (verify; do not ignore `tools/recording-coach/`)

**Do not create `brief.md`.** OpenCode system/skills load `tools/recording-coach/skill/`.

README must include:
- Ports: Coach→4097; OpenCode server→4096
- env `JSGEN_BASE_URL`
- How to start 4097+executor first
- Skill path `skill/SKILL.md`

- [x] **Step 1: `npm init` + add `@opencode-ai/sdk` dependency** inside `tools/recording-coach/` only.

- [x] **Step 2: Write README** (no brief.md).

- [ ] **Step 3: Commit** (optional): `chore(coach): scaffold recording-coach package`

---

### Task 5: OpenCode session loop + tool registration

**Files:**
- Create: `tools/recording-coach/src/index.mjs`
- Create: `tools/recording-coach/src/opencode-plugin.mjs` (or inline plugin in index)

**Behavior:**
1. Create evidenceDir + empty workflow (phase CollectInputs).
2. `const { client, server } = await createOpencode({ port: 4096, config: {...} })` — avoid colliding with 4097.
3. `session.create({ body: { title: 'recording-coach …' } })`; save `opencodeSessionId` into workflow.
4. `session.prompt({ noReply: true, parts: [load skill/SKILL.md] })`.
5. Inject workflow snapshot via `noReply` each user turn before real prompt.
6. Register tools so the model can call Task 3 handlers (use OpenCode plugin `tool` API for this SDK version; if blocked, **fallback**: CLI commands `/prepare` `/start` that call tools locally while chat stays on OpenCode — document fallback in README).
7. On abort: `session.abort` + `detach_trajectory` if trajectoryId set.
8. On Done: write `verdict.txt`.

- [x] **Step 1: Spike** `createOpencode` + `session.create` + one `prompt` — note where session files land; paste into README.

- [x] **Step 2: Wire tool registration** (plugin or fallback).

- [x] **Step 3: End-to-end chat smoke** without real record (CollectInputs only). *(CLI REPL path verified; OpenCode path auto-fallback if SDK/session fails)*

- [ ] **Step 4: Commit** (optional): `feat(coach): OpenCode session loop for recording-coach`

---

### Task 6: Wet-path checklist (manual)

**Files:**
- Create: `tools/recording-coach/WET-CHECKLIST.md` (short)

- [x] **Step 1: Ensure** 4097 + executor connected (`list_executors`). *(dry-run OK — LMY connected inUse=0)*

- [ ] **Step 2: Run coach** with skill anchors (fid `9000000011`, stamp customerNo from skill, assert row_text=first) **or** a safer read-only query traj if rating picker unavailable.

- [ ] **Step 3: Confirm** evidenceDir has `workflow.json`, `traj-id.txt`, `verdict.txt`; MySQL traj has steps; VERDICT matches `assert_steps`.

- [x] **Step 4: Update** design spec §13 note + agent-log closeout for scaffold; full wet checkbox remains open until Step 2–3.

---

### Task 7: Spec / skill cross-links for plan

**Files:**
- Modify: `docs/superpowers/specs/2026-09-18-recording-coach-opencode-design.md` §13 — check plan item
- Modify: `docs/superpowers/agent-log.md` — 开工/收工 for plan doc

- [ ] **Step 1: Mark** `[x] 实现计划：plans/2026-09-18-recording-coach-opencode.md`

- [ ] **Step 2: agent-log** entry pointing to this plan

- [ ] **Step 3: Commit** (optional): `docs(plan): recording-coach OpenCode implementation plan`

---

## Out of scope (Phase 2 — do not implement in this plan)

- `cdp_dismiss_dialogs`, SPA panel, session restore by trajectoryId, batch linkage, restart_local tool, engine edits.

## Risk notes

- OpenCode custom tool plugin API may differ by SDK minor version — Task 5 Step 1 spike before large wiring.
- `record/start` blocking behavior: Strategy A assumes POST waits until phases finish; if control plane returns early, polling still converges on recordStatus.
- Do not run wet Task 6 while other agents hold the only executor slot.
