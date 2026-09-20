# Recording Coach Skill OpenCode Eval Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落地 Tier A 指令遵循门禁（5 题 fixture + runner + 报告）与可选 Tier B 钩子骨架，验证 OpenCode 注入四层 skill 后仍按铁律编排。

**Architecture:** 复用 `src/index.mjs` 的 skill 注入与 plugin 挂载；抽出可复用的 `ensureOpencodeOnPath` + session bootstrap；Tier A 只做 `noReply` 注入 + 规则评分（不调工具）；Tier B 允许工具到 `ReadyToCreate` 并硬禁 `start_record`/`prepare_record`。不改 `verify-all.sh` 默认集。

**Tech Stack:** Node ESM、`@opencode-ai/sdk`、既有 `createEvidenceDir` / `createCoachPlugin`、JSON fixture。

**Spec:** [`../specs/2026-09-20-recording-coach-skill-eval-design.md`](../specs/2026-09-20-recording-coach-skill-eval-design.md)

## Global Constraints

- Encoded Preference 评测：过程保真为主；不做湿测 A/B（Tier C）。
- 禁止评测路径调用 `start_record`；Tier A 题干禁止调用任何 coach 工具。
- 不改 Python 引擎 / 产品 API / 不建 `.cursor/skills/` 副本。
- 不默认把 Tier A 登记进 `scripts/refactor/verify-all.sh`（LLM + opencode 依赖）；文档标明手跑。
- Windows：runner 必须能解析到 `opencode.exe`（仅 `.cmd`/`.ps1` 不够）。
- 端口：OpenCode **4096**、控制面 **4097**。
- 用户没要求就不要 commit；commit 步默认跳过。
- 中文 commit message（若用户要求提交）。
- 既有三 coach cold pin 必须仍绿。

## File map

| Path | Role |
|------|------|
| `tools/recording-coach/eval/fixtures/tier-a.v1.json` | **新建**：5 题 + 期望 |
| `tools/recording-coach/eval/README.md` | **新建**：怎么跑 / PATH / 与 cold pin 分工 |
| `tools/recording-coach/src/opencode-path.mjs` | **新建**：解析/注入 `opencode.exe` 到 PATH |
| `tools/recording-coach/src/opencode-session.mjs` | **新建**：createEvidence + plugin entry + createOpencode + 注入 SKILL |
| `tools/recording-coach/scripts/eval-tier-a.mjs` | **新建**：Tier A runner |
| `tools/recording-coach/scripts/eval-tier-b.mjs` | **新建**：Tier B 钩子（可 SKIP） |
| `tools/recording-coach/scripts/opencode-skill-smoke.mjs` | **修改或薄封装**：改为调用 session helper / 或注明 deprecated→A1 |
| `tools/recording-coach/README.md` | **修改**：加 Eval 一节指针 |
| `tools/recording-coach/WET-CHECKLIST.md` | **修改**：skill 改文后手跑 Tier A |
| `docs/superpowers/specs/2026-09-20-recording-coach-skill-eval-design.md` | **修改**：状态 → 定稿 |

---

### Task 1: PATH helper + session bootstrap

**Files:**
- Create: `tools/recording-coach/src/opencode-path.mjs`
- Create: `tools/recording-coach/src/opencode-session.mjs`
- Test: 小脚本或 node -e 断言 `resolveOpencodeExe()` 在本机非空（有 exe 时）

**Interfaces:**
- `resolveOpencodeExe(): string | null` — 查 PATH / `OPENCODE_BIN` / 常见 `…/opencode-ai/bin/opencode.exe`
- `ensureOpencodeOnPath(): { exe: string, prepended: boolean }` — 若 PATH 无 exe 则 `process.env.PATH` 前置其目录；失败 throw 可读错误
- `startCoachOpencodeSession(opts?: { port?: number, repoRoot?: string }): Promise<{ evidenceDir, client, server, sessionId, skillText, close }>` — 同 `index.mjs` 注入逻辑；`close()` best-effort

- [ ] **Step 1: 实现 `opencode-path.mjs`**

```js
import fs from 'node:fs';
import path from 'node:path';

/**
 * @returns {string | null}
 */
export function resolveOpencodeExe() {
  if (process.env.OPENCODE_BIN && fs.existsSync(process.env.OPENCODE_BIN)) {
    return path.resolve(process.env.OPENCODE_BIN);
  }
  // scan process.env.PATH for opencode.exe; then well-known nvm paths
  // …
}

/**
 * @returns {{ exe: string, prepended: boolean }}
 */
export function ensureOpencodeOnPath() {
  // if spawnable already, return; else prepend dirname(exe)
}
```

- [ ] **Step 2: 实现 `opencode-session.mjs`**

从 `index.mjs` / `opencode-skill-smoke.mjs` 抽出：`createEvidenceDir`、写 plugin entry、`createOpencode`、`session.create`、`noReply` 注入 SKILL。调用前 `ensureOpencodeOnPath()`。

- [ ] **Step 3: 本机断言**

Run: `node --input-type=module -e "import { ensureOpencodeOnPath } from './tools/recording-coach/src/opencode-path.mjs'; console.log(ensureOpencodeOnPath());"`  
Expected: 打印含 `exe` 指向 `opencode.exe`（无 exe 的机器应 throw 且文案含 PATH 提示）。

- [ ] **Step 4: Commit（默认跳过）**

```bash
git add tools/recording-coach/src/opencode-path.mjs tools/recording-coach/src/opencode-session.mjs
git commit -m "feat(coach): OpenCode PATH 解析与评测会话 bootstrap"
```

---

### Task 2: Tier A fixture + runner

**Files:**
- Create: `tools/recording-coach/eval/fixtures/tier-a.v1.json`
- Create: `tools/recording-coach/scripts/eval-tier-a.mjs`
- Modify: `tools/recording-coach/scripts/opencode-skill-smoke.mjs`（改为调用 session helper，或顶部注释「请用 eval-tier-a」并保留 A1 单题兼容）

**Interfaces:**
- Fixture shape:
  ```json
  {
    "evalVersion": "tier-a.v1",
    "cases": [
      {
        "id": "A1",
        "prompt": "…",
        "expectAny": ["save_dispatch_brief"],
        "forbidAny": ["start_record"],
        "expectRegex": null
      }
    ]
  }
  ```
- Runner stdout：每题一行 `A1 PASS|FAIL`；末行 `OK eval-tier-a 5/5` 或 `FAIL eval-tier-a n/5`
- 报告：`tmp/recording-coach-skill-eval-A-<ISO>.json`

- [ ] **Step 1: 写 `tier-a.v1.json`（5 题，对齐 spec §4.1 表）**

A1–A5 题干须含「不要调用任何工具」。期望与 spec 表一致。

- [ ] **Step 2: 实现 `eval-tier-a.mjs`**

流程：bootstrap session → 逐题 prompt → 规则评分（`expectAny` 任一命中且 `forbidAny` 皆未命中；若有 `expectRegex` 则另测）→ 写报告 → `close()` → exit 0/1。  
缺 opencode：exit 2 + stderr 提示（不假绿）。

- [ ] **Step 3: 手跑 Tier A**

Run: `node tools/recording-coach/scripts/eval-tier-a.mjs`  
Expected: `OK eval-tier-a 5/5`（需本机 LLM/opencode；失败则修题干约束或评分宽松度，禁止放宽到无断言）。

- [ ] **Step 4: 回归 cold pin**

Run:
```bash
node scripts/characterization/cold/characterize-recording-coach-skill-pack.mjs
node scripts/characterization/cold/characterize-recording-coach-operator.mjs
```
Expected: 两个 OK。

- [ ] **Step 5: Commit（默认跳过）**

```bash
git add tools/recording-coach/eval tools/recording-coach/scripts/eval-tier-a.mjs tools/recording-coach/scripts/opencode-skill-smoke.mjs
git commit -m "test(coach): Tier A OpenCode skill 指令遵循评测"
```

---

### Task 3: Tier B 钩子 + 文档

**Files:**
- Create: `tools/recording-coach/scripts/eval-tier-b.mjs`
- Create: `tools/recording-coach/eval/README.md`
- Modify: `tools/recording-coach/README.md`
- Modify: `tools/recording-coach/WET-CHECKLIST.md`
- Modify: `docs/superpowers/specs/2026-09-20-recording-coach-skill-eval-design.md`（状态 → 定稿）

**Interfaces:**
- Tier B：注入 skill → 一条用户消息要求完成 `save_dispatch_brief` + `mark_inputs_ready`（可内嵌合法 brief/taskText）→ 轮询/读 `workflow.json` 直至 `ReadyToCreate` 或超时 → 扫描是否出现禁工具名（从 session 轨迹或本地 progress，能拿到则断言；拿不到则以 phase + 文件存在为准并在报告标 `trajectoryPartial: true`）
- 无 4097：`SKIP eval-tier-b` exit 0（或 exit 0 + report.skipped=true）——避免坏 CI；有 4097 则必须真 PASS/FAIL
- 禁：调用或建议 `start_record` / `prepare_record`

- [ ] **Step 1: 实现 `eval-tier-b.mjs` 骨架**

健康检查：`GET ${JSGEN_BASE_URL}/api/health`（或现网可用路径）；失败则 SKIP。

- [ ] **Step 2: 写 `eval/README.md`**

含：Tier A/B 命令、`OPENCODE_BIN`、Windows PATH、与 cold pin 分工、不进 verify-all 的原因。

- [ ] **Step 3: README + WET-CHECKLIST 指针**

各加一小节：skill 改文后手跑 `eval-tier-a.mjs`。

- [ ] **Step 4: 更新 spec 状态为定稿**

- [ ] **Step 5: 有 4097 时手跑 B；无则确认 SKIP**

- [ ] **Step 6: Commit（默认跳过）**

```bash
git add tools/recording-coach/scripts/eval-tier-b.mjs tools/recording-coach/eval/README.md tools/recording-coach/README.md tools/recording-coach/WET-CHECKLIST.md docs/superpowers/specs/2026-09-20-recording-coach-skill-eval-design.md
git commit -m "feat(coach): Tier B 评测钩子与 eval 文档"
```

---

## Spec coverage

| Spec 节 | Task |
|---------|------|
| §4.1 Tier A | 2 |
| §4.2 Tier B | 3 |
| §4.3 Tier C 不做 | Global Constraints |
| §5 目录 | 2–3 |
| §6 Windows PATH | 1 |
| §7 成功判据 | 2–3 |
| 不进 verify-all | Global Constraints / Task 3 文档 |

无 TBD。

---

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-09-20-recording-coach-skill-eval.md`.

**Two execution options:**

1. **Subagent-Driven (recommended)** — 每任务新子智能体 + 任务间审查  
2. **Inline Execution** — 本会话按 executing-plans 执行  

Which approach?
