# Recording Coach（旁路 OpenCode 编排）

旁路 CLI：用 OpenCode 多轮对话 + `skill/SKILL.md` 驱动控制面 `/api/v2` 录制管线。  
**不**写入仓库根 `package.json`，**不**接入 `record/start` 产品路径。

设计：[docs/superpowers/specs/2026-09-18-recording-coach-opencode-design.md](../../docs/superpowers/specs/2026-09-18-recording-coach-opencode-design.md)  
计划：[docs/superpowers/plans/2026-09-18-recording-coach-opencode.md](../../docs/superpowers/plans/2026-09-18-recording-coach-opencode.md)

## 端口（勿混）

| 服务 | 默认端口 |
|------|----------|
| JS-gen 控制面 | **4097** |
| OpenCode embedded（本 CLI） | **4096** |

环境变量：`JSGEN_BASE_URL`（默认 `http://127.0.0.1:4097`）。

## 前置

1. 控制面 + executor 已起（`npm start` / `.\start.ps1` + `npm run executor`），且 `GET /api/v2/executors` 有空闲 connected。
2. 本目录安装依赖（仅 sidecar）：

```bash
cd tools/recording-coach
npm install
```

## Skill

真源：**`skill/SKILL.md`**（`ui-record-wet-test`）。无单独 `brief.md`。  
旧路径 stub：`scripts/prompts/skills/ui-record-wet-test/SKILL.md` → 指向此处。

## 启动

```bash
# OpenCode 会话（SDK 不可用时自动降级 CLI REPL）
node src/index.mjs

# 强制本地工具 REPL（不启 OpenCode）
node src/index.mjs --cli-only

# 单次工具
node src/index.mjs --tool list_executors
node src/index.mjs --resume tmp/recording-coach-<ts> --tool get_trajectory --args "{\"summary\":true}"
```

证据目录：`tmp/recording-coach-<ISO>/`（含 `workflow.json`、`progress.log`、`traj-id.txt`、`verdict.txt`）。已由根 `.gitignore` 的 `tmp/` 覆盖。

## 相变（workflow.json）

`CollectInputs → ReadyToCreate → Created → Prepared → Recording → Settled → Asserting → Done`  
（`RetryNewTraj` → 回到 `ReadyToCreate`，复用同一 OpenCode session）

工具成功回调才推进相；`start_record` 为 **Strategy A**（长超时 POST + 每 60s GET 写 `poll-N.json` 与 `progress.log`）。

## 操作员顺序

严格按序调用工具（`create_trajectory` 参数必须是 `{}`）：

1. `save_dispatch_brief` → 2. `mark_inputs_ready` → 3. `preflight_readonly` → 4. `analyze_trajectory` → 5. `accept_phases` → 6. `create_trajectory` → 7. `prepare_record`（**600** 秒超时）→ 8. `cdp_precheck` → 9. `start_record`（**40** 分钟值守上限）→ 10. `detach_trajectory` → 11. `assert_steps` → 12. `write_through_report`

收尾文件：`through-report.md`、`close.txt`（最后一条助手消息须与 `close.txt` 完全相同）。详见 `skill/SKILL.md`。

## OpenCode 数据目录

首次 `createOpencode` 成功后，会话文件落在 OpenCode 默认 location（常见为本机 OpenCode data / 传入的 working directory）。以运行日志与 `workflow.json` 的 `opencodeSessionId` 为准；本 README 不硬编码厂商路径。

## 验收 pin

```bash
node scripts/characterization/cold/characterize-recording-coach-assert.mjs
```

已登记 `scripts/refactor/verify-all.sh`。

## Wet 清单

见 [WET-CHECKLIST.md](./WET-CHECKLIST.md)。
