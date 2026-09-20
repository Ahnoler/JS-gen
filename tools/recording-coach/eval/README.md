# Recording Coach Skill Eval

OpenCode 侧分层评测：验证注入 `skill/SKILL.md` 后模型是否仍按铁律编排。

设计：[docs/superpowers/specs/2026-09-20-recording-coach-skill-eval-design.md](../../../docs/superpowers/specs/2026-09-20-recording-coach-skill-eval-design.md)

## 前置

| 项 | 说明 |
|----|------|
| OpenCode | 本机可解析到 **`opencode.exe`**（Windows 勿只靠 `.cmd`） |
| `OPENCODE_BIN` | 可选；指向 `opencode.exe` 全路径；**优先于 PATH 上已有的 exe**（`ensureOpencodeOnPath` 会前置其目录） |
| PATH | 或把 `opencode-ai/bin` 加入 PATH；runner 也会在缺失时尝试 nvm / `node_modules` 旁路 |
| 控制面 | Tier B 需要 `JSGEN_BASE_URL`（默认 `http://127.0.0.1:4097`）可达 `GET /api/health` |
| 依赖 | `cd tools/recording-coach && npm install` |

## Tier A — 指令遵循（必跑，skill 改文后）

纯文本 prompt，**禁止**调用 coach 工具。5 题 fixture 规则评分。

```bash
node tools/recording-coach/scripts/eval-tier-a.mjs
```

- Fixture：`eval/fixtures/tier-a.v1.json`（当前 `evalVersion: tier-a.v1.1`，8 题）
- 通过线：**全题 PASS**（现为 **8/8**）→ exit 0；任一失败 → exit 1
- 缺 `opencode.exe` → exit 2（不伪绿）
- 报告：`tmp/recording-coach-skill-eval-A-<ISO>.json`
- 扩题样本与来源：`eval/fixtures/FAILURE-SAMPLES.md`

单题冒烟（A1 only）：

```bash
node tools/recording-coach/scripts/opencode-skill-smoke.mjs
```

## Tier B — 工具轨迹到 ReadyToCreate（可选）

注入 skill 后一条用户消息，要求模型调用 `save_dispatch_brief` + `mark_inputs_ready`（prompt 内嵌合法 brief / taskText）。**硬禁** `start_record` / `prepare_record`。

```bash
node tools/recording-coach/scripts/eval-tier-b.mjs
```

- 控制面不可达 → **SKIP**（exit 0，`report.skipped=true`）
- 控制面可达 → 必须真 **PASS** 或 **FAIL**
- 通过线：`workflow.json.phase === ReadyToCreate` + `dispatch-brief.md` + `task-text.md` 落盘 + 未出现禁工具
- 说明：若 `mark_inputs_ready` 未写 `task-text.md`，harness 可能从 `workflow.inputs.taskText` **镜像**落盘；报告字段 `taskTextMirrored: true` 标明此情况（内容仍经 `assertBusinessTaskText`）
- 超时默认 180s（`RECORDING_COACH_EVAL_B_TIMEOUT_MS` 可覆盖）
- 报告：`tmp/recording-coach-skill-eval-B-<ISO>.json`

## Scoring notes (Tier A)

`forbidAny` 使用否定安全匹配：仅当禁串作为**正面主张**出现时才判 FAIL。  
例如「不允许 curl」**不会**命中 forbid「允许 curl」；「禁止用 DONE」**不会**命中「用 DONE」。

## 与 cold pin 分工

| 层 | 入口 | 测什么 |
|----|------|--------|
| Cold pin | `scripts/characterization/cold/characterize-recording-coach-*.mjs` | 文件契约、脚手架 dry-run、operator 断言（**无 LLM**） |
| Tier A/B | 本目录 `scripts/eval-tier-*.mjs` | OpenCode 注入后 LLM 是否遵循铁律 / 工具序 |

两者互补：cold pin 钉契约；eval 钉过程。改 `skill/SKILL.md` 或 references/templates 后，**手跑 Tier A**；有 4097 时可手跑 Tier B。

## 为何不进 verify-all

- Tier A/B 依赖本机 **opencode + LLM**，非确定性、无 opencode 时不应阻断 CI。
- Tier B 还依赖控制面 4097（无则 SKIP，不 fail CI）。
- 已在 `scripts/refactor/verify-all.sh` 登记的仍是 **cold pin**（含 skill-pack / operator / assert / **tier-a-score** 纯函数钉，共四份 recording-coach 相关）；Tier A/B LLM eval 仅在 README / WET-CHECKLIST 列为 skill 改文后手跑项。
