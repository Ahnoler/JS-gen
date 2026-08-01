# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Start the control-plane server (standalone LLM — no OpenCode SDK)
npm start

# Start via PowerShell launcher (sets env vars)
.\start.ps1

# Dev mode with file watching
npm run dev

# Executor agent (connects out to control plane WS /ws/executor)
npm run executor

# Install dependencies (first time)
npm install

# Run Python script assembler directly
python scripts/script_assembler.py <action_file.json> [output.js]

# Lightweight characterization / import smokes (not a full test suite)
node scripts/characterize-dedup.mjs
node scripts/accept-replay-apis.mjs
python scripts/characterize-assembler-click.py
python scripts/characterize-form-rules.py
node scripts/characterize-ctrl.mjs
# ↑ CTRL parity: parses CTRL_OBJECT methods vs _js_snippets / actions/*.py cues
node scripts/characterize-trajectory.mjs
```

Manual verification: product API docs at `http://localhost:4097/api/docs` after starting the server (`src/dashboard/api-docs/catalog.js` — sole frontend contract). Product APIs are under `/api/v2/*`. Human-oriented overview: `README.md` (keep in sync with this file’s architecture section). Legacy engineering HTML (`/api/test`, record-console/studio) redirects to `/api/docs`.

## Architecture

This is a **browser automation service** for Element UI / Vue web applications. It provides AI-driven browser control, Playwright script generation, MySQL-backed trajectory recording/replay, and an optional remote **executor** process — served from a Node.js Express control plane (port 4097). Product UI lives in a separate Vue repo; this repo exposes APIs and `/api/docs`.

### Two-Language Architecture

Element UI CTRL helpers: **`src/ctrl-actions.js` is canonical** for `window.CTRL` (replay/assemble). Agent-side copies are dual (not byte-identical):

| Language | File | Used by |
|----------|------|---------|
| JavaScript (canonical) | `src/ctrl-actions.js` | Injected into generated Playwright scripts (`getInjectionCode`) |
| Python JS strings | `scripts/actions/_js_snippets.py` | `page.evaluate` injection from Python agent |
| Python | `scripts/controller.py` + `scripts/actions/*` | Browser Use agent at runtime |

Same CTRL surface (`fillFormField`, `selectOption`, `selectDate`, `clickMenuItem`, `clickTableRowButton`, `closeDialog`, etc.). Edit canonical first; keep Python cues in sync — `node scripts/characterize-ctrl.mjs` fails on missing methods.

### Control plane pipelines

```
Node.js Express (server.mjs)
  ├─ Product recording (preferred)
  │     /api/v2/trajectories/*  record/prepare|start|stop, stream/detach, manual-record, attach|detach
  │     → executor session (USE_EXECUTOR) or local browser session
  ├─ Product replay (supported)
  │     /api/v2/trajectories/:id/steps/replay → live replay_actions → _replay.py
  ├─ Assembled full replay (DEPRECATED engineering asset)
  │     /api/v2/trajectories/:id/replay/*  → assemble (server-side) → script-runner
  ├─ Session debug (engineering; secondary)
  │     POST /api/browser/session (+ /step, …)
  │     → python scripts/browser-use-agent.py --session  and/or executor
  └─ Assemble / run (engineering)
        POST /api/test/assemble  → assemble-service → script_assembler.py
        POST /api/test/run       → src/runtime/script-runner.js → playwright-runner/run.cjs
```

One-shot Explore/Workflow and the legacy engineering HTML dashboard / record-console / record-studio pages are removed (product SPA is external). Product AI recording uses v2 `record/start` (optional `phaseIds`).

Agent I/O: JSON Lines on stdout (`{"event":"step"|"done"|…}`). Recording steps also persist live to MySQL when `autoPersist` / trajectory binding is on.

### Route modules (`src/routes/`)

- **`v2/`** — Primary product APIs: system-mgmt, trajectories (+ recording), replay, executors, case-data, screenshots, remote-session, accounts.
- **`browser-session.js`** — Long-lived session debug path; trajectory/case save prefers MySQL.
- **`test-assemble.js`** — Thin HTTP over `assemble-service` (dedup → assembler).
- **`test-run.js`** — Thin HTTP/WS over `script-runner` (`execution:*` events).
- **`llm-proxy.js`** — OpenAI-compatible `/v1/chat/completions` and `/v1/models`.
- **`explore-utils.js`** — Process/SSE helpers (name is historical; not an Explore route).
- **`legacy-gone.js`** — `/api/trajectory` and `/api/case-data` → **410 Gone**.
- **`agent.js`** — Generic LLM agent HTTP (standalone LLM).

### Runtime / services (recent extractions)

| Module | Role |
|--------|------|
| `src/runtime/script-runner.js` | Shared Playwright execute (test-run + replay) |
| `src/services/assemble-service.js` | action JSON → Playwright script |
| `src/services/replay-service.js` | **DEPRECATED** assembled Playwright replay (engineering asset) |
| Live replay | `scripts/actions/_replay.py` via `/steps/replay` — **product-supported** |

| `src/executor-slot-lease.js` | Executor slot exclusive leases until `detach` |
| `src/executor-*.js` | Executor WS registry, session client, event hub |

### Persistence

**Primary:** MySQL via Knex (`/api/v2/*`).

**Legacy offline:** `/api/trajectory`、`/api/case-data` → **410**. JSON catalog stores are best-effort / optional.

| Store | Module | Directory | Status |
|-------|--------|-----------|--------|
| Generated scripts | `script-utils.js` | `scripts/generated/` | active (gitignored) |
| Action dump | assemble-file / replay prepare | `scripts/action/` | ephemeral |
| Trajectories / case JSON | `*-store.js` | `scripts/trajectories/` etc. | optional bypass |

Frontend delivery contract: `/api/docs` only (do not maintain separate product API markdown). Refactor status: `docs/REFACTOR_INSIGHT.md` (local/gitignore).

### Product frontend & docs

Product SPA is external (Vue). In-repo UI is only **`/api/docs`** (`api-docs.html` + `src/dashboard/api-docs/`). Former `test-dashboard.html` / `record-console.html` / `record-studio.html` are deleted; `GET /api/test`, `/api/test/record-console`, `/api/test/record-studio` **301 → `/api/docs`**. Engineering APIs `/api/test/assemble` and `/api/test/run` remain. Root `/` redirects to `/api/docs` when configured.

Executor BiB uses per-slot CDP ports (`9242+slotIndex`) to avoid `CDP WebSocket not found`.

Executor ops notes: `docs/执行机解耦与操作总结.md` (gitignored docs/).

### Python agent (`scripts/`)

- **`main.py`** — Session CLI (`--session`, stdin-driven).
- **`controller.py` / `actions/`** — Custom Element UI actions; `_record_action()` → `_ACTION_LOG`.
- **`session_runner.py`** — Stdin JSON → agent steps → stdout events; intervention buffer.
- **`script_assembler.py`** — Action entries → Playwright JS + CTRL injection; emits `__REPLAY_STEP__` markers for replay WS.
- **`agent_utils.py`** — LLM + context trim; loads prompts from `scripts/prompts/`.
- **`recorder.py`** — Session/phase action + log files.
- **`actions/form_rules.py`** — `match_rule(label_text)` → valid random values (ID card, phone, credit code, …). Used by the **agent** auto-fill path, not a user-facing plugin yet.
- **`browser-use-agent.py`** — Thin wrapper around `main()`.

### Prompts (not OpenCode skills)

**There is no active `.opencode/skills/` tree in this repo** (`.opencode/` is gitignored). Former “skill” knowledge was folded into **markdown prompts** and **code**:

| Prompt / code | Role |
|---------------|------|
| `scripts/prompts/agent-prompt.md` | Main agent system prompt (Element UI actions, response JSON) |
| `scripts/prompts/planner-prompt.md` | Planner prompt (preferred over inline section) |
| `scripts/prompts/agent-field-rules.md` | Field-filling guidance for the agent |
| `scripts/prompts/form-prompt.md` | Form-oriented prompt fragments |
| `scripts/prompts/agent-special-prompt.md` | Special-case agent guidance |
| `scripts/prompts/heal-prompt.md` | Self-heal / repair prompts |
| `scripts/actions/form_rules.py` | Executable value generators (former atp-rule behavior) |
| `src/ctrl-actions.js` + Python CTRL | Executable Element UI ops (former atp-ui “how to click” as code) |

Do **not** look for or restore OpenCode skill packages unless the user explicitly asks. Update prompts under `scripts/prompts/` and keep CTRL / `form_rules` in sync instead.

### Key design decisions

- **`STANDALONE_LLM=true`** — Default; LLM via `src/llm-utils.js`. OpenCode SDK is not the product path.
- **Consecutive-only dedup** (`src/dedup.js`) — Only back-to-back identical `(action, params)`; non-consecutive duplicates kept.
- **Native setter pattern** for Element UI inputs — never rely on Playwright `page.fill()` alone for el-form.
- **`el-select`** — Use `selectOption`; generic click-by-index on option spans fails silently.
- **Re-query DOM** before each op — Vue may recreate dialogs/components.
- **Recording vs detach** — `record/stop` ends recording status but **does not** free the executor slot; `POST .../stream/detach` stops BiB only (`remote_session`→`idle`, `live`→`draft`); `POST .../detach` closes Chrome + Python + slot.
- **Multi-traj BiB** — Push identity is `remote_session.id`; bindings are 1:1 trajectory ↔ remote_session ↔ agent session. Detach/stream-detach are scoped per trajectory (no global singleton).
- **Replay (product)** — Attached/live `replay_actions` via `_replay.py` (`POST .../steps/replay`). Prefers recorded `xpath_smart`, then label/semantic, then `xpath_full`.
- **Replay (deprecated)** — `/api/v2/trajectories/:id/replay/*` assembles Playwright + CTRL; kept runnable as an engineering asset, not product-supported. Assemble/test-run remain engineering APIs.
- **Executor slots** — `EXECUTOR_CAPACITY` slots per node; control-plane lease until detach / node offline.
