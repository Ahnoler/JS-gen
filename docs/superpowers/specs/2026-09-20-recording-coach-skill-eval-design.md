# Recording Coach Skill OpenCode 评测门禁设计

> 日期：2026-09-20  
> 状态：设计定稿（待实现）  
> Lead：本会话 Cursor  
> 相关：  
> - [`2026-09-20-recording-coach-skill-pack-design.md`](./2026-09-20-recording-coach-skill-pack-design.md)（四层包）  
> - [`2026-09-18-recording-coach-opencode-design.md`](./2026-09-18-recording-coach-opencode-design.md)（OpenCode 旁路）  
> - 冒烟证据：`tmp/opencode-skill-smoke-report.json`（2026-09-20，`save_dispatch_brief` PASS）

## 1. 目标

为四层 skill 包建立**可重复、分层、可对比**的 OpenCode 侧评测，回答：「注入后的模型是否仍按铁律编排？」——而不是「冷文件是否存在」。

成功判据见 §7。

## 2. 非目标（本版明确不做）

| 非目标 | 说明 |
|--------|------|
| 全链路湿测 A/B（有/无 skill） | 成本高、噪声大；等有 3～5 条历史失败单再开 |
| 8 维打分平台 / S–D 等级看板 | 过度建设；本版用二元 PASS + JSON 报告 |
| 多 skill 冲突矩阵 | 旁路目前单 skill |
| 改引擎 / 产品 API / `.cursor/skills/` 副本 | 与四层包约束一致 |
| 脚手架或评测调用 `start_record` | 无确认开录禁止 |
| 替代现有 cold pin | cold pin 仍钉契约；本评测钉 LLM 过程 |

## 3. 分类与评估重点

本 skill 属 **Encoded Preference（编码偏好型）**：模型各步都能做，skill 按团队湿测 SOP 串联。

| 维度 | 本版是否测 | 指标形态 |
|------|------------|----------|
| 触发质量 | 浅测 | 注入成功 + description/正文关键词仍在上下文（报告字段） |
| 执行过程 | **主测** | 指令遵循准确率；可选工具轨迹合规率 |
| 结果质量 | 不测湿测落库 | B 档仅验 `workflow.json` 相停在 `ReadyToCreate` |
| 系统成本 | 记录 | 墙钟耗时；Token 本版不强制计量 |

对照原则：本版不做「无 skill vs 有 skill」大盘；做「固定题集回归」——skill 改文后分数不得无故下滑。

## 4. 分层：A 门禁 + B 钩子

### 4.1 Tier A — 指令遵循门禁（必做，进本地/CI 可选）

**流程：**

1. 解析 `opencode.exe` 可执行路径（Windows：优先 `PATH` 上的 `opencode.exe`；fallback 常见 nvm/`opencode-ai/bin`）。
2. `createOpencode`（或等价：自启 `opencode serve` + `createOpencodeClient`）+ 注入 `skill/SKILL.md` 全文（与 `src/index.mjs` 同构，`noReply`）。
3. 对固定题集逐题 `session.prompt`（**禁止**调用 coach 工具；题干写明「不要调用工具」）。
4. 规则评分：期望子串 / 禁止子串 / 正则。
5. 写报告 `tmp/recording-coach-skill-eval-A-<ts>.json`；汇总 exit 0/1。

**题集（v1，5 题，冻结在仓库 fixture）：**

| ID | 意图 | 期望（规则） |
|----|------|--------------|
| A1 | CollectInputs 首工具 | 须含 `save_dispatch_brief`；不得含 `start_record` |
| A2 | taskText 禁 API | 对「能否把 curl/`POST /api/v2` 写进 taskText」答否/禁止类表述；不得主张允许 |
| A3 | close 契约 | 须提及五行或 `结论：`/`报告：`/`证据` |
| A4 | 变体角色 | 须含 `只读核查员` 或 `取证员`；须含「不新工具名」或「同骨架」意 |
| A5 | 假成功 | 须含 `BLOCKED_` 或「假成功」且不得用 `DONE` 作结论前缀建议 |

题面与期望放在：`tools/recording-coach/eval/fixtures/tier-a.v1.json`（`evalVersion` 字段；变更须改 version 或 changeLog）。

**通过线：** 5/5 PASS。任一失败 → exit 1。

### 4.2 Tier B — 工具轨迹到 ReadyToCreate（钩子，默认手动/夜间）

**流程：**

1. 同 A 起会话并注入 skill。
2. 用户消息给定最小派发上下文（goal / functionId / account / 已填好的 brief+task 文本或允许模型调 `save_dispatch_brief` + `mark_inputs_ready`）。
3. **允许** coach 工具；**硬禁** `start_record` / `prepare_record`（插件侧可加评测模式拦截，或事后扫轨迹）。
4. 结束条件：`workflow.json.phase === 'ReadyToCreate'` 且两文件落盘；或超时/违规工具 → FAIL。
5. 报告 `tmp/recording-coach-skill-eval-B-<ts>.json`。

**通过线：** phase 正确 + 未出现禁工具。本版 **不** 登记进 `verify-all.sh`（避免 CI 依赖 LLM+4097 槽位）。

**前置：** 控制面 `JSGEN_BASE_URL` 可达；executor 可缺席（本档不 preflight `--run`）。

### 4.3 Tier C — 湿测 A/B（本版不做）

仅在设计层预留目录约定：`eval/fixtures/tier-c/` 未来放历史失败样本 ID；实现与门禁均本版跳过。

## 5. 目录与入口

```text
tools/recording-coach/
├── eval/
│   ├── fixtures/
│   │   └── tier-a.v1.json          # 题集 + 期望
│   └── README.md                   # 怎么跑、通过线、PATH 说明
├── scripts/
│   ├── opencode-skill-smoke.mjs    # 单题冒烟（可保留或并入 runner）
│   └── eval-tier-a.mjs             # Tier A runner（实现计划产出）
│   └── eval-tier-b.mjs             # Tier B runner（可选，可同 PR 或后随）
└── skill/                          # 被测对象（只读）
```

命令（拟定）：

```bash
# Windows：确保 opencode.exe 在 PATH（nvm opencode-ai/bin）
node tools/recording-coach/scripts/eval-tier-a.mjs
node tools/recording-coach/scripts/eval-tier-b.mjs   # 可选；需 4097
```

**与 cold pin 关系：**  
`characterize-recording-coach-skill-pack.mjs` 不变职责（文件+脚手架 dry-run）。Tier A **不**默认塞进 `verify-all.sh`（LLM 非确定性 + 需本机 opencode）；可在 README / WET-CHECKLIST 列为「skill 改文后手跑」。若后续稳定性足够，再 opt-in 环境变量 `RECORDING_COACH_EVAL_A=1` 挂门禁。

## 6. 运行时约束（踩坑已证）

| 项 | 约定 |
|----|------|
| Windows spawn | SDK `spawn('opencode')` 需能解析到 **`opencode.exe`**；仅 `.cmd`/`.ps1` 会 ENOENT。Runner 启动前自检并打印修复提示。 |
| 端口 | OpenCode serve 默认 **4096**；控制面 **4097**；勿混。 |
| 注入方式 | 与 `src/index.mjs` 一致：session `noReply` 注入 SKILL 全文 + evidenceDir/baseUrl 一行。 |
| 清理 | `server.close` 后 Windows 偶发 UV 断言；runner 以报告已写成为准，close 失败不掩盖已判定的 PASS/FAIL。 |
| 非确定性 | 题干约束「只输出…」；评分用包含匹配而非整句相等；允许一题 1 次重试（可选，v1 可不重试）。 |

## 7. 成功判据

1. **Tier A**：fixture 5 题可跑；本机有 opencode 时 5/5；报告 JSON 含 `evalVersion`、每题 `ok`、`replyPreview`、墙钟。  
2. **文档**：`eval/README.md` 写清 PATH、命令、与 cold pin 分工。  
3. **Tier B**：脚本可跑通到 `ReadyToCreate` 或清晰 SKIP（无 4097）；默认不进 verify-all。  
4. **不破坏**：既有三 coach cold pin 仍绿；skill 正文无强制改写（除非评测发现铁律缺口，另开任务）。  
5. **非目标守住**：无 `start_record`、无湿测 A/B、无引擎改动。

## 8. 退役 / 升格信号（治理，本版只记账）

| 信号 | 动作 |
|------|------|
| Tier A 长期 5/5 且改文从不掉 | 保留为回归 |
| 某题变成「模型无 skill 也对」 | 标记 capability absorbed，考虑删题或升格为脚本断言 |
| B 档稳定且总是同序调工具 | 考虑把固定前两步更多交给 `scaffold-brief`（已部分升格） |
| 长期不跑 / 无增益 | 退役 runner，保留 fixture 历史 |

## 9. 实现顺序（供后续 plan）

1. 固化 `eval/fixtures/tier-a.v1.json` + `eval-tier-a.mjs`（吸收现有 smoke）。  
2. `eval/README.md` + WET-CHECKLIST / recording-coach README 各加一节指针。  
3. （可选同 PR）`eval-tier-b.mjs` 骨架 + SKIP 语义。  
4. 手跑 A 全绿；三 cold pin 回归。  
5. 不默认改 `verify-all.sh`。

## 10. 与既有设计关系

- **四层包设计**：本文件评测「LLM 是否遵循已收缩的 SKILL + 是否仍指向 references/templates」。  
- **OpenCode 旁路设计**：复用注入与 plugin 挂载；评测不另造编排状态机。  
- **Cold pin**：契约层；本评测：过程层。两者互补，不互相替代。
