# Recording Coach Skill 四层收口设计

> 日期：2026-09-20  
> 状态：设计定稿（待实现计划）  
> Lead：本会话 Cursor  
> 相关：  
> - [`2026-09-18-recording-coach-opencode-design.md`](./2026-09-18-recording-coach-opencode-design.md)（旁路 OpenCode + 工具链底座）  
> - [`../plans/2026-09-19-recording-coach-wet-operator.md`](../plans/2026-09-19-recording-coach-wet-operator.md)（12 步操作员补充）  
> - [`../guides/2026-09-19-recording-coach-skill-draft.md`](../guides/2026-09-19-recording-coach-skill-draft.md)（合约线经验草稿，只读吸收）  
> - [`../../tools/recording-coach/skill/SKILL.md`](../../tools/recording-coach/skill/SKILL.md)（当前单文件作业手册）

## 1. 目标

在**不改录制引擎、不扩产品 API**的前提下，把 `tools/recording-coach` 的 OpenCode skill 按四层收齐，服务**功能湿测录制**派发与验收：

| 层 | 职责 |
|----|------|
| **元数据** | YAML frontmatter：触发场景与短描述 |
| **LLM 指令** | 短铁律 + 可按需阅读的 references |
| **脚本** | 固定 3 个薄脚手架（调现有 `src` tools，不重写管线） |
| **模板** | 五段 brief、业务 taskText、close、证据清单 |

成功判据见 §7。

## 2. 非目标

| 非目标 | 说明 |
|--------|------|
| 改 Python 录制引擎 / 控制面产品 API | 属引擎线；coach 旁路 |
| 复制到 `.cursor/skills/` | 用时口头指向 `tools/recording-coach/skill/` 即可 |
| 把 `tmp/run-opencode-*.mjs` 收成唯一正式入口 | 本版仅在 README 留示例指针 |
| 全量场景卡库、无人值守批量队列 | 超出「B 偏瘦」 |
| 脚手架串联到 `start_record` | 避免无确认开录 |
| 回写 JS-gen-contract | 草稿只读吸收 |

## 3. 决策摘要

| 项 | 选择 |
|----|------|
| 范围档 | **B（偏瘦）**：文档四层 + 薄脚手架；不大改 `src` 管线语义 |
| 加载面 | **仅 OpenCode**：`tools/recording-coach/skill/` |
| 目录形态 | **方案 2**：`skill/{SKILL.md,references/,templates/,scripts/}`；`src/` 仍为工具权威实现 |
| 脚手架数量 | 固定 3 个：`init-evidence` / `scaffold-brief` / `preflight-probes` |
| 合约草稿 | 角色、五段式、管线坑、诚实失败、派发前自查、变体骨架 → references/templates |
| 场景卡 | 本版只保留 STC 等实证锚点一篇；不建全量库 |

## 4. 目录与职责边界

```text
tools/recording-coach/
├── skill/
│   ├── SKILL.md                 # 元数据 + 短指令（铁律/顺序/红线/何时用）
│   ├── references/
│   │   ├── pipeline-pits.md     # prepare/CDP/phaseIds/doneLogs 截断等坑
│   │   ├── acceptance.md        # 看 steps；假成功；诚实失败；CREATED/REJECTED/BLOCKED
│   │   └── stc-anchors.md       # STC 首行等实证锚点（可增场景卡）
│   ├── templates/
│   │   ├── dispatch-brief.md    # 五段式操作员任务书
│   │   ├── task-text.md         # 业务 taskText（硬性门闩，无 API/curl）
│   │   ├── close.txt            # 五行收尾形态
│   │   └── evidence-checklist.md
│   └── scripts/                 # 薄脚手架，只调 createTools / 写文件
│       ├── init-evidence.mjs
│       ├── scaffold-brief.mjs
│       └── preflight-probes.mjs
├── src/                         # 现有：tools / workflow / poll / assert / plugin…
├── README.md / WET-CHECKLIST.md # 人读入口，指向 skill/
```

| 层 | 做什么 | 不做什么 |
|----|--------|----------|
| **元数据**（frontmatter） | `name` / `description` 触发湿测、真机录制验收 | 不写长 runbook |
| **LLM 指令**（SKILL 正文 + references） | 三角色、两份输入、12 步铁律、红线；长坑进 references | 不内嵌 curl 大段；不教改引擎 |
| **模板** | 填空即用的 brief / taskText / close / 证据清单 | 不含某次湿测的具体 stamp（范例可引用 STC，标「示例」） |
| **脚本**（`skill/scripts/`） | 建证据目录、从模板填 brief+taskText、组装只读 probes | 不 `start_record`、不替代 plugin tools |
| **`src/`** | 现有编排与验收 | 本版只被脚手架调用，不拆业务语义 |

加载约定：OpenCode skill 根 = `tools/recording-coach/skill/`；模型按需 `read` references/templates；脚手架用 `node skill/scripts/….mjs`。

## 5. 功能清单（按层承载）

| 能力 | 用户/操作员要什么 | 承载层 | 本版做法 |
|------|-------------------|--------|----------|
| 触发与角色 | 何时用、三角色 | 元数据 + 短指令 | `SKILL.md` description + 正文首节 |
| 拆两份输入 | brief ≠ taskText；禁 curl 进 task | 指令 + 模板 | 纪律 + `templates/dispatch-brief.md` / `task-text.md` |
| 派发前核查 | 槽位、健康、业务前置 GET | 指令 + 脚本 + `src` | 指向 `preflight_readonly`；`preflight-probes.mjs` 组装 probes |
| 阶段接受 | 数字 phaseIds、描述够长、预期可验 | 指令 + references | 坑位进 `pipeline-pits.md`；执行仍 `analyze`→`accept` |
| 12 步管线 | 固定顺序、prepare≥600s、CDP、40min | 短指令 + references | SKILL 只列铁律；细节在 `pipeline-pits.md` |
| 值守取证 | 60s poll、证据目录完整 | 指令 + 模板 + 脚本 | `init-evidence.mjs`；poll 仍在 `src` |
| 落库验收 | 看 steps 字段；假成功/诚实失败 | references + `src` assert | `acceptance.md`；结论映射不变 |
| 收尾契约 | close.txt 五行 = 最后一条消息 | 模板 + `src` | `templates/close.txt`；`write_through_report` 不变 |
| 场景锚点 | 如 STC 首行判据 | references | `stc-anchors.md` |
| 变体角色 | 只读核查员 / 取证员 | 短指令 + 模板可选段 | 只写「同骨架换步骤」；不新工具名 |
| 失败再试 | retry 纪律、不擅自重录 | 短指令 | 保留现有三条；诚实失败默认停 |

## 6. 三个薄脚手架契约

均放在 `skill/scripts/`，Node ESM；可调 `../../src/*`（`createEvidenceDir` / `createTools`），**不**自己发 `prepare` / `start` / `detach`。失败非 0 退出并打印可读错误。

### 6.1 `init-evidence.mjs`

| | |
|--|--|
| **用途** | 建空证据目录 + 最小 `workflow.json`（相仍为 `CollectInputs`） |
| **输入** | 可选 `--repo <path>`（默认向上找仓库根）；可选 `--label <slug>` |
| **输出** | 打印 `evidenceDir=` 一行；可选写入 checklist / `hypothesis.txt` 占位 |
| **不写** | brief、taskText、analyze、traj |

### 6.2 `scaffold-brief.mjs`

| | |
|--|--|
| **用途** | 从 `templates/` 填 `dispatch-brief.md` + taskText 预览/落盘 |
| **输入** | `--evidence <dir>`（必填）；`--goal`；`--function-id`；`--account-id`；`--ref-traj`；`--task-file` 或 `--task-stdin`；可选 `--product-label` |
| **校验** | brief 五标题齐全（`assertDispatchBrief`）；taskText 同 `assertBusinessTaskText`（硬性门闩、≥80、无 `POST /api/v2` / curl） |
| **输出** | 证据目录文件；stdout JSON：`{ ok, evidenceDir, dispatchBriefPath, taskTextPath }` |
| **可选** | `--apply` → `save_dispatch_brief` + `mark_inputs_ready`（停在 ReadyToCreate，不开单） |

### 6.3 `preflight-probes.mjs`

| | |
|--|--|
| **用途** | 按场景拼 `probes[]`，可选直接跑 `preflight_readonly` |
| **输入** | `--evidence <dir>`；`--profile none\|rating-credit\|custom`；`--custom-json <file>`；`--run` |
| **输出** | `probes.json`；若 `--run` 则 `preflight.json`，尊重 `BLOCKED_前置未核` / `BLOCKED_无空闲槽位` |
| **约定** | `none` → `probes: []` 且 `businessProbeRequired: false`（STC 类）；`rating-credit` 预置只读 `/api/v2/` GET（路径表标注「以 `/api/docs` 为准」，本版可先占位） |

### 6.4 共用约定

- 环境变量：`JSGEN_BASE_URL`（默认 `http://127.0.0.1:4097`）、`RECORDING_COACH_EVIDENCE_DIR`（可被 `--evidence` 覆盖）
- 脚手架成功后，操作员仍按铁律从 `analyze_trajectory`（或已 accept 的阶段）走 OpenCode / CLI tools
- 冷表征：钉「脚本存在 + help/dry-run 出口 + 调用 assert 函数名」，不做真机 HTTP

## 7. 成功判据

1. **四层齐全**：短 `SKILL.md` + `references/`（≥3 篇）+ `templates/`（brief / taskText / close / checklist）+ `scripts/`（上述 3 个可跑）。
2. **合约草稿吸收**：draft §1–§7 要点进 references/templates；不回写 contract 仓。
3. **行为不回退**：`characterize-recording-coach-assert` / `characterize-recording-coach-operator` 仍绿；脚手架不绕过 `assertBusinessTaskText` / `assertDispatchBrief` / `preflight_readonly`。
4. **人机路径**：README / WET-CHECKLIST 指向四层；OpenCode 只挂 `skill/`。
5. **冷验收**：新脚手架至少有 dry-run/help 类 cold pin，或并入既有 operator pin 的「文件存在 + 关键校验调用」断言。

## 8. 风险与缓解

| 风险 | 缓解 |
|------|------|
| SKILL 仍过长 | 正文只留铁律表；细节强制 `read references/…` |
| probe 路径过期 | `rating-credit` 表标注以 `/api/docs` 为准；错误即 `BLOCKED_前置未核` |
| 与旧单文件双真源 | 实现时收缩旧长文，单一入口为四层包 |
| 阶段预期过宽致跳过查询 | 验收与 references 强调同相「先查询再选行」；引擎侧索引 STC 硬护栏已另线落地（traj 908），本 skill 不重复改引擎 |

## 9. 实现顺序（供后续 plan）

1. 建 `references/` + `templates/`，从现 SKILL + 合约草稿迁文（先迁后缩 SKILL）。
2. 实现三个脚手架 + dry-run/help；复用现有 assert 函数。
3. 收缩 `SKILL.md` 正文；更新 README / WET-CHECKLIST。
4. 冷 pin 登记；跑既有 coach characterization。
5. （可选）用 STC 或既有证据目录做一次「脚手架 → OpenCode 从 analyze 起」文档化烟测，不强制新开业务单。

## 10. 与既有设计的关系

- **2026-09-18 opencode 设计**：本文件是其子题——把「作业手册唯一真源」从单文件 SKILL **结构化为四层包**；工具相状态机与 `src` 契约不变。
- **2026-09-19 wet-operator 计划**：12 步、60s poll、close 契约已实现；本文件不重做，只把纪律与模板固化进 skill 包。
