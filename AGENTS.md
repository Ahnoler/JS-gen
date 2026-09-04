# AGENTS.md

Guidance for Codex (Codex.ai/code) and Claude Code when working in this repo. This is the single source of truth. Product-facing docs live in `README.md` (human) and `/api/docs` (sole frontend contract); architecture depth that an agent can rediscover from the tree is intentionally not duplicated here.

## 跨 Agent 协作（开场三件事 / 收工写日志）

多个 Agent 工具（Zcode / Cursor / Codex 等）在同一仓库开发，会话记忆互不相通；跨工具互通靠仓库内文件 + git 历史，不靠任何工具的内置记忆。

**开场三件事（每次会话开始先做）：**
1. `git log --oneline -15` + `git status` — 看最近提交与未提交改动
2. 读 `docs/superpowers/todo-list.md` — 当前工作线与挂起项
3. 读 `docs/superpowers/agent-log.md` 最近几条 — 其他 Agent 最近做了什么、有什么遗留

**收工写日志（每次会话结束前）：**
- 在 `docs/superpowers/agent-log.md` **顶部**插入一条，格式见该文件头：完成（含 commit hash）/ 进行中 / 注意事项
- 一个任务单元结束尽量 commit——未提交的工作对其他 Agent 不可见
- **不维护 CHANGELOG.md**（2026-09-04 已移除）：变更史以翔实的 git commit message 为准，不要重建该文件

## Working with subagents

Default split（各司其职）:
- **main** — plan & design: decides split granularity, asks the user to arbitrate key tradeoffs, reviews subagent output, runs final verification, reports honestly.
- **Explore** — read-only research (big files/long functions/dead code, characterization coupling matrix); outputs a prioritized `file:line` list. **Never edits files.**
- **general-purpose** — implements self-contained, behavior-preserving changes and runs its own verification. **Never commits.**

Delegation rules:
- Give every subagent a self-contained prompt: file paths + line numbers, allowed/forbidden edits, verification commands, report format.
- Parallel subagents get **disjoint** file sets (no concurrent-edit conflicts).
- On subagent network timeout, retry once; if it still fails, the main thread does the work.
- After each subagent: re-run key verification and review for out-of-scope edits; report compliant deviations honestly.

Refactoring constraint (hard): `scripts/characterization/*` uses `read_text` to assert source substrings, pinning function names / closure relative order / exact strings (`_form.py` is pinned by ~30 scripts). When splitting files, keep those markers and make tests read concatenated files (see `_form.py` → `form_autofill.py`).

## Commands

```bash
npm start          # control-plane server (standalone LLM — no OpenCode SDK)
.\start.ps1        # PowerShell launcher (sets env vars)
npm run dev        # dev mode, file watching
npm run executor   # executor agent (connects out to /ws/executor)
npm install        # install dependencies (first time)

# characterization / import smokes (not a full test suite)
node scripts/characterization/characterize-dedup.mjs
node scripts/smoke/accept-replay-apis.mjs
python scripts/characterization/characterize-form-rules.py
node scripts/characterization/characterize-trajectory.mjs

# refactor gate — run after every refactoring micro-step (core smokes)
bash scripts/refactor/verify-all.sh
```

Manual verification: product API docs at `http://localhost:4097/api/docs` (`src/dashboard/api-docs/catalog.js` is the sole frontend contract); public APIs under `/api/v2/*`. Legacy engineering HTML (`/api/test`, record-console/studio) 301s to `/api/docs`; legacy `/api/trajectory` and `/api/case-data` → **410 Gone**.

## What you must know to act correctly

This is a **browser-automation service** for Element UI / Vue apps: Playwright script generation, MySQL trajectory recording/replay, an optional remote executor — served from a Node.js Express control plane (`server.mjs`, port 4097). Product SPA is external; only `/api/docs` lives here. Deep module/route inventories are discoverable in the tree; the load-bearing, easy-to-get-wrong facts are below.

**JS snippets 单一语言面:**
- window.CTRL 注入库（`src/ctrl-actions/` 及桩 `src/ctrl-actions.js`）与 assemble 工程管线已于本次清理移除，浏览器注入式 CTRL 双语言副本不再存在。
- agent 侧浏览器 JS 片段唯一定义在 `scripts/controller/actions/js_snippets/*`（由 `scripts/controller/actions/_js_snippets.py` 聚合 re-export）；控件逻辑改一处即可，无跨语言同步负担。
- 仍存在的跨语言单源是 **PAGE_LOCATOR_HELPERS 生成链**：JS 源 `src/cdp/page-locator-helpers.js` 经 `node scripts/_gen_locator_helpers_py.mjs` 生成 `scripts/controller/actions/js_snippets/_locator_helpers_js.py`，仍禁止手改生成物。
- Do **not** hand-edit generated `scripts/controller/actions/js_snippets/_locator_helpers_js.py` — it's produced by `node scripts/_gen_locator_helpers_py.mjs` from `src/cdp/page-locator-helpers.js`.

**Element UI / correctness rules:**
- **Consecutive-only dedup** (`src/dedup.js`): only back-to-back identical `(action, params)`; non-consecutive duplicates are kept.
- **Native setter pattern** for Element UI inputs — never rely on Playwright `page.fill()` alone for `el-form`.
- **`el-select`** → use `selectOption`; generic click-by-index on option spans fails silently.
- **Re-query DOM** before each op — Vue may recreate dialogs/components.

**Recording / detach semantics:**
- `record/stop` ends recording but does **not** free the executor slot; `stream/detach` stops BiB only (`remote_session`→`idle`, `live`→`draft`); `detach` closes Chrome + Python + slot.
- Multi-traj BiB: push identity is `remote_session.id`; bindings are 1:1 trajectory ↔ remote_session ↔ agent session; detach/stream-detach are scoped per trajectory.
- Replay (product) is live `replay_actions` via `_replay.py` (`POST .../steps/replay`); locator preference `xpath_smart` (semantic anchors + visible dialog/drawer scope + volatile tree-text strip + icon class/tooltip) → label/semantic (incl. placeholder) → `xpath_full`. 装配式回放与工程调试端点（`/api/test/assemble|run|history`、v2 `assemble-file`）已整体移除；回放统一走产品 API 驱动的 `replay_actions`。
- Executor slots: `EXECUTOR_CAPACITY` slots per node; control-plane lease until detach; per-slot CDP ports (`9242+slotIndex`) to avoid `CDP WebSocket not found`.
- LLM standalone mode is **default** (`src/llm-utils.js`); OpenCode SDK is not the product path.

**Python agent (`scripts/`):** browser_use-style layout (`main.py`, `controller/`, `agent/`, `session_runner.py`); agent prompts live in `scripts/prompts/`. There is **no** `.opencode/skills/` tree here (it's gitignored) — update prompts under `scripts/prompts/` and keep `js_snippets` cues / `form_rules.py` in sync; do not restore "skill" packages unless explicitly asked.

**Where you'll spend most time:** `src/routes/v2/*` (primary product APIs), `src/services/trajectory/*` (services + extracted runners; `index.js` re-exports public names). Follow existing route/service extraction patterns already in the tree.

**JSDoc 注释规范:**
- 规范文档：`docs/jsdoc-convention.md`。核心公开函数（导出函数 / 路由 handler / 公开 service·dao 方法 / 类方法）**必须有 JSDoc**，含 `@param`/`@returns`；私有 helper、回调、Promise `.then/catch` 内联箭头、一行纯转发函数可省略。**不加** `@author`/`@since`。
- 工具链：`npm run lint` 检查 / `npm run lint:fix` 自动修复（eslint-plugin-jsdoc，warn 级别）。存量 warning 已清零，**新代码不得引入新 warning**。
- 绕过区域（不 lint、不加 JSDoc）：`migrations/**`（一次性脚本，已 ignore）、`scripts/characterization/**`、`scripts/smoke/**`。
- 硬性约束（踩坑教训）：给函数加 JSDoc 时**只插入注释，严禁删除/修改任何已有代码行**——曾有子智能体误删函数定义导致代码损坏。
