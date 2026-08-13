# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## AI 协作分工约定（multi-agent workflow）

本仓库多智能体的默认分工：

| 角色 | 职责 |
|------|------|
| **主模型（main）** | 计划与设计：plan mode 定方案与拆分粒度、AskUserQuestion 让用户拍板关键取舍；审查子智能体产出、跑最终整体验证、向用户如实汇报 |
| **Explore 子智能体** | 只读调研：大文件/长函数/重复代码/死代码普查、characterization 脚本耦合矩阵；输出带 `file:line` 证据的优先级清单。**绝不改文件** |
| **general-purpose 子智能体** | 干活实现：按自包含指令做行为保持的代码改动，跑验证并回传原始输出。**不提交 git** |

执行规则：

- 给子智能体的 prompt 必须自包含：文件路径+行号、允许/禁止改动清单、验证命令（`node --check` / import smoke / characterize 脚本）、报告格式。
- 并行子智能体必须分配**无交集**的文件集，避免并发编辑冲突。
- 子智能体网络超时先重试一次，仍失败由主线程兜底执行。
- 子智能体完成后，主线程必须：重跑关键验证 + 审查是否有越出允许范围的改动（如 CHANGELOG 追加）；合规的越界改动如实告知用户。
- 改 `src/` 时子智能体可能按下方"同步约定"追加 CHANGELOG 条目；主线程审查其格式与是否覆盖用户未提交条目。

重构专用约束：`scripts/characterization/*` 会用 `read_text` 断言源码子串，钉死函数名 / 闭包相对顺序 / 精确字符串（`_form.py` 被约 30 个脚本固定）。拆分文件时必须保留这些标记，并把相关测试改为拼接多文件读取（参照 `_form.py` → `form_autofill.py` 的做法）。

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
node scripts/characterization/characterize-dedup.mjs
node scripts/smoke/accept-replay-apis.mjs
python scripts/characterization/characterize-assembler-click.py
python scripts/characterization/characterize-form-rules.py
node scripts/characterization/characterize-ctrl.mjs
# ↑ CTRL parity: parses CTRL_OBJECT methods vs _js_snippets / actions/*.py cues
node scripts/characterization/characterize-trajectory.mjs

# Refactor gate — run after every refactoring micro-step (CTRL parity + core smokes)
bash scripts/refactor/verify-all.sh
```

Manual verification: product API docs at `http://localhost:4097/api/docs` after starting the server (`src/dashboard/api-docs/catalog.js` — sole frontend contract). Product APIs are under `/api/v2/*`. Human-oriented overview: `README.md` (quick start / API cheat-sheet / FAQ — human-facing only). Architecture details are documented here; README links here instead of duplicating them. Legacy engineering HTML (`/api/test`, record-console/studio) redirects to `/api/docs`.

## Architecture

This is a **browser automation service** for Element UI / Vue web applications. It provides AI-driven browser control, Playwright script generation, MySQL-backed trajectory recording/replay, and an optional remote **executor** process — served from a Node.js Express control plane (port 4097). Product UI lives in a separate Vue repo; this repo exposes APIs and `/api/docs`.

### Two-Language Architecture

Element UI CTRL helpers: **`src/ctrl-actions/` is canonical** (`index.js` re-exports per-control modules) for `window.CTRL` (replay/assemble). Agent-side copies are dual (not byte-identical):

| Language | File | Used by |
|----------|------|---------|
| JavaScript (canonical) | `src/ctrl-actions/` (`index.js` re-exports form/nav/select/structure/table) | Injected into generated Playwright scripts (`getInjectionCode`) |
| Python JS strings | `scripts/controller/actions/_js_snippets.py` | `page.evaluate` injection from Python agent |
| Python | `scripts/controller/` + `scripts/controller/actions/*` | Browser Use agent at runtime |

Same CTRL surface (`fillFormField`, `selectOption`, `selectDate`, `clickMenuItem`, `clickTableRowButton`, `closeDialog`, etc.). Edit canonical first; keep Python cues in sync — `node scripts/characterization/characterize-ctrl.mjs` fails on missing methods. Generated file: `scripts/controller/actions/js_snippets/_locator_helpers_js.py` is produced by `node scripts/_gen_locator_helpers_py.mjs` from `src/cdp/locator-candidates.js` — do not hand-edit it.

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

- **`v2/`** — Primary product APIs: system-mgmt, trajectories (+ recording), replay, executors, case-data, screenshots, remote-session, accounts. `trajectory.js` registration split by resource into `trajectory-record.js` / `trajectory-steps.js` (routes unchanged).
- **`browser-session/`** — Long-lived session debug path (register.js + persist-live / watcher-actions / trajectory-persist / step-execution / heal-instruction / …); trajectory/case save prefers MySQL.
- **`test-assemble.js`** — Thin HTTP over `assemble-service` (dedup → assembler).
- **`test-run.js`** — Thin HTTP/WS over `script-runner` (`execution:*` events).
- **`llm-proxy.js`** — OpenAI-compatible `/v1/chat/completions` and `/v1/models`.
- **`setup.js`** — `/api/setup*`, `/` redirect, `/api/docs`, legacy 301 redirects (extracted from `server.mjs`).
- **`legacy-gone.js`** — `/api/trajectory` and `/api/case-data` → **410 Gone**.
- **`agent.js`** — Generic LLM agent HTTP (standalone LLM).

### Runtime / services (recent extractions)

| Module | Role |
|--------|------|
| `src/services/trajectory/` | trajectory-* services + extracted runners (replay-batch-runner, form-structure-heal, replay-heal-shared, recording-runner, batch-analyze/batch-record, form-snapshot-append, attach-runner, text-extract); `index.js` re-exports all public names |
| `src/runtime/script-runner.js` | Shared Playwright execute (test-run + replay) |
| `src/services/assemble-service.js` | action JSON → Playwright script |
| `src/services/replay-service.js` | **DEPRECATED** assembled Playwright replay (engineering asset) |
| Live replay | `scripts/controller/actions/_replay.py` via `/steps/replay` — **product-supported** |

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

### Python agent (`scripts/`)

Layout follows browser_use's package structure (agent/ + controller/); the module mapping is listed below.

- **`main.py`** — Session CLI (`--session`, stdin-driven).
- **`controller/`** — Tool registry + dispatch (browser_use-style): `service.py` (build_controller), `registry.py` (registered actions schema view), `actions/` (per-control action registration: `_form`/`_misc`/`_navigation`/`_table`/`_special_element`/`_replay`/`phase/`/`js_snippets/`…; extracted helpers: `form_autofill` (auto-fill engine), `form_scan_utils`, `cascade_fill`, `section_scope`, `container_naming`). `controller.py` + `actions/*` are compatibility shims re-exporting the same names.
- **`agent/`** — `service.py` (per-phase agent step execution), `recorder_emitters.py` (on_step_end phase/intent/quality-gate emission).
- **`browser/`** — `factory.py` (Chrome launch / window / seed profile).
- **`session_runner.py`** — Stdin JSON → agent steps → stdout events; intervention buffer (thin orchestrator; helpers split into `cdp_ports.py` / `trajectory_store.py` / `event_dispatch.py`).
- **`script_assembler.py`** — Thin facade; code generation lives in `codegen/` (`actions.py` + `js_escaping.py`).
- **`agent_utils.py`** — LLM + context trim; loads prompts from `scripts/prompts/`.
- **`recorder.py`** — Session/phase action + log files (hooks; emitters in `agent/recorder_emitters.py`).
- **`actions/form_rules.py`** — `match_rule(label_text)` → valid random values (ID card, phone, credit code, …). Used by the **agent** auto-fill path, not a user-facing plugin yet.
- **`browser-use-agent.py`** — Thin wrapper around `main()`.

### Prompts (not OpenCode skills)

**There is no active `.opencode/skills/` tree in this repo** (`.opencode/` is gitignored). Former “skill” knowledge was folded into **markdown prompts** and **code**:

| Prompt / code | Role |
|---------------|------|
| `scripts/prompts/agent-core.md` | Core role, JSON, CRITICAL checklist, phase boundary, case-data |
| `scripts/prompts/agent-tools-common.md` | Generic browser/Element UI actions |
| `scripts/prompts/agent-tools-form.md` | Form fill/select/assistant/needs_agent/final-check/section |
| `scripts/prompts/agent-tools-table.md` | Table row buttons, icon buttons |
| `scripts/prompts/agent-tools-tree.md` | Tree selector details |
| `scripts/prompts/agent-prompt.md` | Shim: full assembly (backward compat) |
| `scripts/prompts/planner-prompt.md` | Planner prompt (preferred over inline section) |
| `scripts/prompts/agent-field-rules.md` | Field-filling guidance for the agent |
| `scripts/prompts/form-prompt.md` | Form-oriented prompt fragments |
| `scripts/prompts/heal-prompt.md` | Self-heal / repair prompts |
| `scripts/controller/actions/form_rules.py` | Executable value generators (former atp-rule behavior) |
| `src/ctrl-actions/*` + Python CTRL | Executable Element UI ops (former atp-ui “how to click” as code) |

Do **not** look for or restore OpenCode skill packages unless the user explicitly asks. Update prompts under `scripts/prompts/` and keep CTRL / `form_rules` in sync instead.

### Key design decisions

- **LLM standalone mode** — Default; LLM via `src/llm-utils.js`. OpenCode SDK is not the product path.
- **Consecutive-only dedup** (`src/dedup.js`) — Only back-to-back identical `(action, params)`; non-consecutive duplicates kept.
- **Native setter pattern** for Element UI inputs — never rely on Playwright `page.fill()` alone for el-form.
- **`el-select`** — Use `selectOption`; generic click-by-index on option spans fails silently.
- **Re-query DOM** before each op — Vue may recreate dialogs/components.
- **Recording vs detach** — `record/stop` ends recording status but **does not** free the executor slot; `POST .../stream/detach` stops BiB only (`remote_session`→`idle`, `live`→`draft`); `POST .../detach` closes Chrome + Python + slot.
- **Multi-traj BiB** — Push identity is `remote_session.id`; bindings are 1:1 trajectory ↔ remote_session ↔ agent session. Detach/stream-detach are scoped per trajectory (no global singleton).
- **Replay (product)** — Attached/live `replay_actions` via `_replay.py` (`POST .../steps/replay`). Prefers recorded `xpath_smart` (semantic anchors + visible dialog/drawer scope + volatile tree-text strip + icon class/tooltip), then label/semantic (incl. placeholder), then `xpath_full`.
- **Replay (deprecated)** — `/api/v2/trajectories/:id/replay/*` assembles Playwright + CTRL; kept runnable as an engineering asset, not product-supported. Assemble/test-run remain engineering APIs.
- **Executor slots** — `EXECUTOR_CAPACITY` slots per node; control-plane lease until detach / node offline. Executor BiB uses per-slot CDP ports (`9242+slotIndex`) to avoid `CDP WebSocket not found`.
- **Executor ops notes** — `docs/执行机解耦与操作总结.md` (gitignored docs/).

## 同步约定（Python 控制面对齐）

本项目（JS-gen）与 `d:\dev\ui-auto-recording-agent-python`（Python FastAPI 控制面）并行开发。Python 端对齐 JS-gen 的 schema / 接口 / WS 协议。

**强制规则**：每次修改 JS-gen，必须同步更新 `CHANGELOG.md` 的 `[Unreleased]` 区段，按 Keep a Changelog 分类追加条目。条目需说明影响范围和 Python 同步提示。

涉及以下变更时**必须**写 CHANGELOG：
- `migrations/` 新增或修改迁移（schema 变更）
- `src/routes/` 端点新增/删除/改路径/改响应格式
- `src/services/` 业务逻辑变更（影响 Python 对齐语义）
- `server.mjs` WebSocket 协议变更
- `config/` 配置项变更

仅改 `scripts/`（Python 子进程）可不写 CHANGELOG（Python 不迁 scripts）。

条目格式见 `CHANGELOG.md` 顶部"条目格式约定"。

### Git post-commit hook（自动跑同步检查）

仓库提供 `scripts/hooks/post-commit` 脚本：commit 后若本次修改了 `migrations/` / `schemas/init.sql` / `src/routes/` / `src/services/` / `server.mjs` / `config/`，自动跑 Python 端 `scripts/check_jsgen_sync.py` 并打印报告（不阻塞 commit）。

**首次安装 / 换机器后安装**：

```bash
cp scripts/hooks/post-commit .git/hooks/post-commit
chmod +x .git/hooks/post-commit
```

`.git/hooks/` 不被 git 跟踪，重装 git 或换机器后需重新安装。脚本本身被 git 跟踪在 `scripts/hooks/post-commit`，永久保留。

**报告解读**：
- `[0] 增量对比`：自上次 `--mark-synced` 以来新增的迁移（最关键的区段）
- `[3] CHANGELOG [Unreleased]`：JS-gen 端待跟进的变更条目
- `[5] Python 同步提示`：每条带"Python 同步提示"的 CHANGELOG 条目
- 跟进完 Python 端变更后，在 Python 仓库跑 `python scripts/check_jsgen_sync.py --mark-synced` 重置增量基线
