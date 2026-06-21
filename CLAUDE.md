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
  ├─ POST /api/browser-use/explore  → spawns python scripts/browser-use-agent.py --task/--workflow
  ├─ POST /api/browser/session/:id/step → spawns python ...  --session
  └─ POST /api/test/assemble        → execSync python scripts/script_assembler.py
```

The Python agent process communicates via JSON Lines on stdout (each line is `{"event": "step"|"done"|"nav_step", "data": {...}}`). Routes parse this line-by-line and forward as SSE to the client.

### Route Modules (`src/routes/`)

- **`agent.js`** — Generic AI agent execution (sync/async/SSE), session management. Dispatches to OpenCode SDK or standalone LLM.
- **`browser-use-explore.js`** — Workflow mode: parses multi-phase task text, spawns Python agent, streams progress via SSE, saves trajectories and case data on completion.
- **`browser-session.js`** — Session mode: maintains a long-lived browser via `state.globalBrowser`, supports multi-turn interaction with human intervention.
- **`test-gen.js`** — LLM-based Playwright script generation. Calls `buildScriptPrompt()` from `script-utils.js`, sends to LLM, parses response.
- **`test-assemble.js`** — Assembler pipeline: reads action JSON → `dedup.js` (consecutive-only dedup) → Python `script_assembler.py` → returns Playwright JS script.
- **`test-run.js`** + **`sse.js`** — Execute generated Playwright scripts, streaming output.
- **`llm-proxy.js`** — OpenAI-compatible `/v1/chat/completions` and `/v1/models` endpoints.
- **`explore-utils.js`** — Shared spawn/kill/SSE utilities for browser routes (not a route module, but imported by routes).

### Stores (JSON File Persistence)

All use the same pattern: `index.json` for metadata + individual JSON files for content, all under `scripts/`:

| Store | Module | Directory |
|-------|--------|-----------|
| Trajectories | `src/trajectory-store.js` | `scripts/trajectories/` |
| Case data | `src/case-data-store.js` | `scripts/case_data/` |
| Generated scripts | `src/script-utils.js` | `scripts/generated/` |

### Dashboard (`src/dashboard/`, `test-dashboard.html`)

Single-page web dashboard with 11 ESM modules. Key panels: script generation pipeline, execution history, trajectory viewer, case data manager, browser session controller. Served statically from project root.

### Python Agent Internals (`scripts/`)

- **`main.py`** — CLI entry point. Three modes: `--task` (single run), `--workflow` (multi-phase from JSON), `--session` (stdin-driven interactive).
- **`controller.py`** — Registers ~20 custom `browser_use` controller actions for Element UI components. Records every action call via `_record_action()` into `_ACTION_LOG` (used later by the action recorder and assembler).
- **`session_runner.py`** — Reads JSON instructions from stdin, runs agent steps, emits JSON events on stdout. Supports human intervention via a pending buffer.
- **`workflow_runner.py`** — Executes phased tasks, saves per-phase trajectories.
- **`script_assembler.py`** — Reads recorded action entries (`{action, params, element}`) and generates a complete Playwright JS script with injected CTRL helpers. No LLM involved — pure mapping from action+params to CTRL calls.
- **`agent_utils.py`** — LLM creation (langchain `ChatOpenAI`), message context trimming (keeps last 12 messages, patches `browser_use`'s `MessageManager`), system prompt loading from `agent-prompt.md`.
- **`recorder.py`** — Builds recording hooks that write `action_{ts}.json` and `log_{ts}.txt` files per session/phase.
- **`form_rules.py`** — Python port of `atp-rule` skill: `match_rule(label_text)` → valid random value for form fields.

### OpenCode Skills (`.opencode/skills/`)

7 custom skills that inject domain knowledge into AI prompts:
- **`atp-ui`** — The canonical Element UI interaction knowledge base (~900 lines). Covers el-form, el-table, el-dialog, el-tree, el-menu, el-select, el-date-picker, el-cascader, el-tabs, el-upload. Agent and script generation both pull rules from here.
- **`atp-rule`** — Smart form value generators (ID card with checksum, phone, credit code, etc.) via the `matchSpecialRule(label)` pattern.
- **`atp-step-gen`** — Test case generation from requirement documents.
- **`atp-fix`** — Failed script error classification and auto-repair rules.
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
