# AGENTS.md

Guidance for Codex (Codex.ai/code) and Claude Code when working in this repo. This is the single source of truth. Product-facing docs live in `README.md` (human) and `/api/docs` (sole frontend contract); architecture depth that an agent can rediscover from the tree is intentionally not duplicated here.

## Working with subagents

Default split（各司其职）:
- **main** — plan & design: decides split granularity, asks the user to arbitrate key tradeoffs, reviews subagent output, runs final verification, reports honestly.
- **Explore** — read-only research (big files/long functions/dead code, characterization coupling matrix); outputs a prioritized `file:line` list. **Never edits files.**
- **general-purpose** — implements self-contained, behavior-preserving changes and runs its own verification. **Never commits.**

Delegation rules:
- Give every subagent a self-contained prompt: file paths + line numbers, allowed/forbidden edits, verification commands, report format.
- Parallel subagents get **disjoint** file sets (no concurrent-edit conflicts).
- On subagent network timeout, retry once; if it still fails, the main thread does the work.
- After each subagent: re-run key verification and review for out-of-scope edits (e.g. CHANGELOG); report compliant deviations honestly.
- When a subagent edits `src/`, it may append a CHANGELOG entry per the CHANGELOG 约定 below; main reviews the format and checks it doesn't overwrite the user's uncommitted entries.

Refactoring constraint (hard): `scripts/characterization/*` uses `read_text` to assert source substrings, pinning function names / closure relative order / exact strings (`_form.py` is pinned by ~30 scripts). When splitting files, keep those markers and make tests read concatenated files (see `_form.py` → `form_autofill.py`).

## Commands

```bash
npm start          # control-plane server (standalone LLM — no OpenCode SDK)
.\start.ps1        # PowerShell launcher (sets env vars)
npm run dev        # dev mode, file watching
npm run executor   # executor agent (connects out to /ws/executor)
npm install        # install dependencies (first time)
python scripts/script_assembler.py <action_file.json> [output.js]

# characterization / import smokes (not a full test suite)
node scripts/characterization/characterize-dedup.mjs
node scripts/smoke/accept-replay-apis.mjs
python scripts/characterization/characterize-assembler-click.py
python scripts/characterization/characterize-form-rules.py
node scripts/characterization/characterize-ctrl.mjs   # CTRL parity: CTRL_OBJECT vs _js_snippets / actions cues
node scripts/characterization/characterize-trajectory.mjs

# refactor gate — run after every refactoring micro-step (CTRL parity + core smokes)
bash scripts/refactor/verify-all.sh
```

Manual verification: product API docs at `http://localhost:4097/api/docs` (`src/dashboard/api-docs/catalog.js` is the sole frontend contract); public APIs under `/api/v2/*`. Legacy engineering HTML (`/api/test`, record-console/studio) 301s to `/api/docs`; legacy `/api/trajectory` and `/api/case-data` → **410 Gone**.

## What you must know to act correctly

This is a **browser-automation service** for Element UI / Vue apps: Playwright script generation, MySQL trajectory recording/replay, an optional remote executor — served from a Node.js Express control plane (`server.mjs`, port 4097). Product SPA is external; only `/api/docs` lives here. Deep module/route inventories are discoverable in the tree; the load-bearing, easy-to-get-wrong facts are below.

**Two-language CTRL parity (hard):**
- `src/ctrl-actions/` is **canonical** (`index.js` re-exports per-control modules) for `window.CTRL`; the Python cue copy lives in `scripts/controller/actions/_js_snippets.py`. Keep the same surface (`fillFormField`, `selectOption`, `selectDate`, `clickTableRowButton`, `closeDialog`, …) in sync — `node scripts/characterization/characterize-ctrl.mjs` fails on missing methods. Edit canonical first.
- Do **not** hand-edit generated `scripts/controller/actions/js_snippets/_locator_helpers_js.py` — it's produced by `node scripts/_gen_locator_helpers_py.mjs` from `src/cdp/locator-candidates.js`.

**Element UI / correctness rules:**
- **Consecutive-only dedup** (`src/dedup.js`): only back-to-back identical `(action, params)`; non-consecutive duplicates are kept.
- **Native setter pattern** for Element UI inputs — never rely on Playwright `page.fill()` alone for `el-form`.
- **`el-select`** → use `selectOption`; generic click-by-index on option spans fails silently.
- **Re-query DOM** before each op — Vue may recreate dialogs/components.

**Recording / detach semantics:**
- `record/stop` ends recording but does **not** free the executor slot; `stream/detach` stops BiB only (`remote_session`→`idle`, `live`→`draft`); `detach` closes Chrome + Python + slot.
- Multi-traj BiB: push identity is `remote_session.id`; bindings are 1:1 trajectory ↔ remote_session ↔ agent session; detach/stream-detach are scoped per trajectory.
- Replay (product) is live `replay_actions` via `_replay.py` (`POST .../steps/replay`); locator preference `xpath_smart` (semantic anchors + visible dialog/drawer scope + volatile tree-text strip + icon class/tooltip) → label/semantic (incl. placeholder) → `xpath_full`. The assembled `/api/v2/trajectories/:id/replay/*` path is **deprecated** (engineering-only, like `/api/test/assemble` and `/api/test/run`).
- Executor slots: `EXECUTOR_CAPACITY` slots per node; control-plane lease until detach; per-slot CDP ports (`9242+slotIndex`) to avoid `CDP WebSocket not found`.
- LLM standalone mode is **default** (`src/llm-utils.js`); OpenCode SDK is not the product path.

**Python agent (`scripts/`):** browser_use-style layout (`main.py`, `controller/`, `agent/`, `session_runner.py`, `script_assembler.py`); agent prompts live in `scripts/prompts/`. There is **no** `.opencode/skills/` tree here (it's gitignored) — update prompts under `scripts/prompts/` and keep CTRL / `form_rules.py` in sync; do not restore "skill" packages unless explicitly asked.

**Where you'll spend most time:** `src/routes/v2/*` (primary product APIs), `src/services/trajectory/*` (services + extracted runners; `index.js` re-exports public names), `src/runtime/script-runner.js` (shared Playwright execute). Follow existing route/service extraction patterns already in the tree.

## CHANGELOG 约定

**强制规则**：每次修改 JS-gen，必须同步更新 `CHANGELOG.md` 的 `[Unreleased]` 区段，按 Keep a Changelog 分类追加条目。条目需说明影响范围。

涉及以下变更时**必须**写 CHANGELOG：
- `migrations/` 新增或修改迁移（schema 变更）
- `src/routes/` 端点新增/删除/改路径/改响应格式
- `src/services/` 业务逻辑变更
- `server.mjs` WebSocket 协议变更
- `config/` 配置项变更

仅改 `scripts/`（Python 子进程）可不写 CHANGELOG。
条目格式见 `CHANGELOG.md` 顶部"条目格式约定"。

> 注：Python 控制面（`d:\dev\ui-auto-recording-agent-python`）同步已叫停（2026-08-26），不再写 Python 同步提示，也不需要与 Python 端对齐。
