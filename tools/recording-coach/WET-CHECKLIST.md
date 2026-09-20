# Recording Coach — Wet checklist（手工）

前提：4097 控制面 + executor 在线；本目录 `npm install` 完成。

## Skill 改文后必跑（迭代门禁）

改 `skill/SKILL.md`、`references/`、`templates/` 或评测 fixture 后，**按序**：

```bash
# 1) 契约层（无 LLM；verify-all 已登记）
node scripts/characterization/cold/characterize-recording-coach-assert.mjs
node scripts/characterization/cold/characterize-recording-coach-operator.mjs
node scripts/characterization/cold/characterize-recording-coach-skill-pack.mjs
node scripts/characterization/cold/characterize-recording-coach-tier-a-score.mjs

# 2) OpenCode 过程层（需本机 opencode.exe + LLM）
node tools/recording-coach/scripts/eval-tier-a.mjs
# 期望：OK eval-tier-a 8/8（tier-a.v1.1）

# 3) 可选：工具轨迹到 ReadyToCreate（需 4097）
node tools/recording-coach/scripts/eval-tier-b.mjs
```

说明与 PATH：`eval/README.md`。扩题样本来源：`eval/fixtures/FAILURE-SAMPLES.md`。

## Skill 四层与脚手架

OpenCode 加载 **`skill/`** 根目录；Cursor 用时口头指向 `tools/recording-coach/skill/`（勿复制到 `.cursor/skills/`）。

| 层 | 内容 |
|----|------|
| `skill/SKILL.md` | 短铁律（12 步顺序、红线） |
| `skill/references/` | 管线坑、验收口径、STC 锚点 |
| `skill/templates/` | dispatch-brief、taskText、close、证据清单 |
| `skill/scripts/` | 三个薄脚手架（不调 `start_record`） |

```bash
node skill/scripts/init-evidence.mjs --label wet-check
node skill/scripts/scaffold-brief.mjs --evidence <dir> --goal "…" \
  --function-id … --account-id … --ref-traj … --task-file … --apply
node skill/scripts/preflight-probes.mjs --evidence <dir> --profile none
# 需要真跑 preflight 时加 --run（workflow 须已在 ReadyToCreate）
```

## 工具顺序（铁律）

严格按序调用；`create_trajectory` 的参数必须是 `{}`（inputs 已由 `mark_inputs_ready` 锁定）：

1. `save_dispatch_brief`
2. `mark_inputs_ready`
3. `preflight_readonly`
4. `analyze_trajectory`
5. `accept_phases`
6. `create_trajectory` `{}`
7. `prepare_record`（超时 **600** 秒）
8. `cdp_precheck`
9. `start_record`（值守上限 **40** 分钟；期间每 **60** 秒写 `poll-N.json` 并追加 `progress.log`）
10. `detach_trajectory`
11. `assert_steps`
12. `write_through_report`

`write_through_report` 写 `through-report.md` 与 `close.txt`。**最后一条助手消息必须与 `close.txt` 完全相同**（五行：结论 / 报告 / 证据1–3）。

## 步骤

1. **空闲槽**  
   `node src/index.mjs --tool list_executors`  
   确认有 `connected` 且非全 `inUse`。忙则停，勿 prepare。

2. **起 Coach**  
   `node src/index.mjs --cli-only`（或无 `--cli-only` 走 OpenCode）  
   记下打印的 `evidenceDir=tmp/recording-coach-…`。

3. **补齐门闩 → ReadyToCreate**  
   ```
   /tool save_dispatch_brief {"text":"<含五个标题的 dispatch-brief>"}
   /tool mark_inputs_ready {"goal":"STC首行","functionId":9000000011,"systemAccountId":2,"taskText":"<含硬性成功门闩的任务文案>","assert":{"minStepCount":1,"requireActionTypes":["click_table_row_radio"],"paramEquals":{"click_table_row_radio.row_text":"first"},"rejectZeroStepRecorded":true}}
   /tool preflight_readonly {}
   /tool analyze_trajectory {}
   /tool accept_phases {}
   ```

4. **建轨 → 准备 → CDP → 开录**  
   ```
   /tool create_trajectory {}
   /tool prepare_record {}
   /tool cdp_precheck {}
   /tool start_record {}
   ```  
   观察 `evidenceDir/progress.log`；start 可能数分钟；单次录制总长 **40** 分钟封顶。

5. **detach → 断言 → 收尾**  
   ```
   /tool detach_trajectory {}
   /tool assert_steps {}
   /tool write_through_report {}
   ```  
   确认 `verdict.txt`、`traj-id.txt`、`close.txt`；MySQL/API `steps` 含目标动作与字段。

6. **失败重录**  
   `/tool retry_new_traj {}` 后改 `taskText`（需再次 `mark_inputs_ready` 或手动改 workflow inputs）再 create。

## 通过标准

- `workflow.json` phase = `Done`
- `verdict.txt` 首行 `DONE`（或按门闩 `BLOCKED` / `REJECTED` 且 reasons 可读）
- 落库字段满足 skill 判据（不只看 `recordStatus=recorded`）
- 最后一条助手消息与 `close.txt` 一致

## 注意

- 评级选择器不可用时改用只读查询类 traj，勿硬闯禁入操作。
- 勿在他线占用执行机时抢 prepare。
- 引擎改动需控制面重启后再生效——与合约/引擎 worktree 协调。
