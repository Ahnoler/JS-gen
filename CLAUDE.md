# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Start the server (standalone LLM mode — skips OpenCode SDK)
npm start

# Start via PowerShell launcher (sets env vars)
.\start.ps1

# Dev mode with file watching
npm run dev

# Install dependencies (first time)
npm install

# Run Python script assembler directly
python scripts/script_assembler.py <action_file.json> [output.js]
```

No test suite exists. Manual verification is done via the dashboard at `http://localhost:4097/api/test` after starting the server.

## Architecture

This is a **browser automation service** for Element UI / Vue web applications. It provides AI-driven browser control, Playwright script generation, test data management, and a web dashboard — all served from a Node.js Express server (port 4097) that spawns a Python `browser_use` agent subprocess.

### Two-Language Architecture

Code that drives Element UI interaction exists in **two synchronized copies** that must be kept in sync:

| Language | File | Used by |
|----------|------|---------|
| Python | `scripts/controller.py` (~87KB) | Browser Use agent at runtime |
| JavaScript | `src/ctrl-actions.js` | Injected into generated Playwright scripts |

Both implement the same CTRL helpers (`fillFormField`, `selectOption`, `selectDate`, `clickMenuItem`, `clickTableRowAction`, `closeDialog`, etc.). When modifying one, update the other.

### Server → Python Agent Pipeline

```
Node.js Express (server.mjs)
  ├─ POST /api/browser/session (+ /step, /trajectory, /action-flow)
  │     → spawns python scripts/browser-use-agent.py --session
  └─ POST /api/test/assemble
        → execSync python scripts/script_assembler.py
```

One-shot Explore/Workflow (`POST /api/browser-use/explore`, `--task` / `--workflow`) has been removed. Multi-phase batch “Run All Phases” is also removed pending a redesign; Dashboard can still **load** phase plans for display, and steps are sent one at a time via Session.

The Python agent process communicates via JSON Lines on stdout (each line is `{"event": "step"|"done"|"nav_step", "data": {...}}`). Routes parse this line-by-line and forward as SSE to the client.

### Route Modules (`src/routes/`)

- **`agent.js`** — Generic AI agent execution (sync/async/SSE), session management. Dispatches to OpenCode SDK or standalone LLM.
- **`browser-session.js`** — Session mode: long-lived browser via `state.globalBrowser`, multi-turn steps, human intervention; trajectory/case-data save to MySQL (JSON catalogs optional/legacy).
- **`test-assemble.js`** — Assembler pipeline: reads action JSON → `dedup.js` (consecutive-only dedup) → Python `script_assembler.py` → returns Playwright JS script.
- **`test-run.js`** + **`sse.js`** — Execute generated Playwright scripts, streaming output.
- **`llm-proxy.js`** — OpenAI-compatible `/v1/chat/completions` and `/v1/models` endpoints.
- **`explore-utils.js`** — Shared spawn/kill/SSE utilities for Session and test-run (not an Explore route; name is historical).
- **`v2/`** — Database-backed APIs (hierarchy, trajectories, case-data, screenshots, remote-session, api-override). **Primary persistence.**

### Persistence

**Primary:** MySQL via Knex (`/api/v2/*`). Session「保存轨迹/案例」失败以 DB 为准。

**Legacy offline:** `/api/trajectory`、`/api/case-data` 返回 `410 Gone` → 用 `/api/v2/*`。  
Session 保存时 `trajectory-store` / `case-data-store` 仅 best-effort，失败不阻断 DB。

| Store | Module | Directory | Status |
|-------|--------|-----------|--------|
| Trajectories JSON | `src/trajectory-store.js` | `scripts/trajectories/` | optional bypass |
| Case data JSON | `src/case-data-store.js` | `scripts/case_data/` | optional bypass |
| Generated scripts | `src/script-utils.js` | `scripts/generated/` | active |
| Action dump | Python / `assemble-file` | `scripts/action/` | ephemeral assemble input |

前端契约见 `docs/前端接口文档.md`。

### Dashboard (`src/dashboard/`, `test-dashboard.html`)

Single-page web dashboard with ESM modules. Key panels: script generation pipeline, execution history, trajectory viewer (v2), case data manager (v2), browser session controller. Served statically from project root.

### Python Agent Internals (`scripts/`)

- **`main.py`** — CLI entry point. Session-only: requires `--session` (stdin-driven interactive).
- **`controller.py`** — Registers ~20 custom `browser_use` controller actions for Element UI components. Records every action call via `_record_action()` into `_ACTION_LOG` (used later by the action recorder and assembler).
- **`session_runner.py`** — Reads JSON instructions from stdin, runs agent steps, emits JSON events on stdout. Supports human intervention via a pending buffer.
- **`script_assembler.py`** — Reads recorded action entries (`{action, params, element}`) and generates a complete Playwright JS script with injected CTRL helpers. No LLM involved — pure mapping from action+params to CTRL calls.
- **`agent_utils.py`** — LLM creation (langchain `ChatOpenAI`), message context trimming (keeps last 12 messages, patches `browser_use`'s `MessageManager`), system prompt loading from `agent-prompt.md`.
- **`recorder.py`** — Builds recording hooks that write `action_{ts}.json` and `log_{ts}.txt` files per session/phase.
- **`form_rules.py`** — Python port of `atp-rule` skill: `match_rule(label_text)` → valid random value for form fields.
- **`browser-use-agent.py`** — Thin compatibility wrapper that calls `main()`.

### OpenCode Skills (`.opencode/skills/`)

7 custom skills that inject domain knowledge into AI prompts:
- **`atp-ui`** — The canonical Element UI interaction knowledge base (~900 lines). Covers el-form, el-table, el-dialog, el-tree, el-menu, el-select, el-date-picker, el-cascader, el-tabs, el-upload. Agent and script generation both pull rules from here.
- **`atp-rule`** — Smart form value generators (ID card with checksum, phone, credit code, etc.) via the `matchSpecialRule(label)` pattern.
- **`atp-step-gen`** — Test case generation from requirement documents.
- **`playwright-skill`** — Rewritten Playwright automation skill with custom Element UI actions.
- **`cdp-agent`** — CDP-based browser automation for legacy bank cabinet systems.
- **`clarification-protocol`** — Structured requirement clarification templates.

### Key Design Decisions

- **`STANDALONE_LLM=true`** is the default mode — bypasses OpenCode SDK, calls LLM API directly via `src/llm-utils.js`. The SDK mode is fallback.
- **Consecutive-only dedup** (`src/dedup.js`): only removes back-to-back identical `(action, params)` pairs. Non-consecutive duplicates (e.g., same fill before and after a click) are preserved — they represent distinct semantic steps.
- **Native setter pattern**: Element UI forms require `Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, val)` followed by bubbling `input`/`change`/`blur` events. Never use `page.fill()`.
- **`el-select` requires custom handling**: dropdown items are `<li>` elements that need specific click targeting. The `selectOption` action handles this; using generic click-by-index on `<span>` children silently fails.
- **DOM references must be re-queried** before each operation — Vue can asynchronously destroy and recreate components (especially in el-dialog).
- **`agent-prompt.md`** contains the system prompt for the Python agent, split into main prompt and planner prompt by `---` and `# PLANNER SYSTEM PROMPT` markers.
