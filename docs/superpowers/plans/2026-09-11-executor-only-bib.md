# Executor-only BiB Implementation Plan

> **For agentic workers:** Execute task-by-task. Steps use checkbox syntax.

**Goal:** Make BiB/session CDP product path executor-only: default `USE_EXECUTOR=true`, resolve and attach refuse local fallback with 503.

**Architecture:** Keep `src/cdp/resolve-by-label.js` as shared library imported by executor; remove control-plane “I own Chrome” branches behind hard 503 gates. Phase 3 gates attach/prepare without deleting bridge files yet.

**Tech Stack:** Node control plane, executor WS, characterization cold pins.

## Global Constraints

- Do not commit unless user asks (except AGENTS.md agent-log start declaration).
- Disjoint from WIP: `classify.py`, `verify-all.sh`, plans archive moves.
- No behavior change when `USE_EXECUTOR=true` (current product path).

---

### Task 1: Cold pin (fail first) — resolve requires executor

**Files:**
- Create: `scripts/characterization/cold/characterize-executor-only-resolve.mjs`

- [ ] Assert `config.js` default string for USE_EXECUTOR is `'true'`
- [ ] Assert `trajectory-record-lifecycle.js` `resolveTrajectoryElement` contains `503` / `USE_EXECUTOR` gate and does **not** call `resolveElementByLabelText` after the executor branch
- [ ] Run pin (expect fail before code change)

### Task 2: Phase 1+2 implement

**Files:**
- Modify: `config/config.js` — default `'true'`
- Modify: `src/services/trajectory/trajectory-record-lifecycle.js` — drop local resolve; 503 if !USE_EXECUTOR
- Modify: `config/.env.example`, `README.md`, api-docs recording notes
- Modify: cold pin if needed

- [ ] Implement
- [ ] Re-run cold pin → pass

### Task 3: Phase 3 gates

**Files:**
- Modify: `src/services/trajectory/trajectory-attach-runner.js` — early 503 if !USE_EXECUTOR
- Modify: `src/services/remote-session-service.js` — `attachLive` / related local branches → 503
- Modify: `src/routes/browser-session/register.js` — session open that used `ensureGlobalBrowser` when false → 503
- Extend cold pin for attach/register markers

- [ ] Implement gates (do not delete global-browser.js)
- [ ] Cold pin pass
- [ ] Smoke: with USE_EXECUTOR=true, no import/syntax break (`node --check` on touched files)

### Task 4: Closeout docs

- [ ] Update `docs/superpowers/todo-list.md` if needed
- [ ] agent-log 收工（commit when user asks）
