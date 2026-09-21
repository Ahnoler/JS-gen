# 录制陪跑 Agent（OpenCode + Skill）设计

> 日期：2026-09-18  
> 状态：设计定稿（待实现计划）  
> Lead：本会话 Cursor  
> 相关：[`../guides/ui-record-through-line-agent-prompt.md`](../guides/ui-record-through-line-agent-prompt.md)、[`../../tools/recording-coach/skill/SKILL.md`](../../tools/recording-coach/skill/SKILL.md)、AGENTS.md（LLM standalone；OpenCode SDK 非产品主路径）

## 1. 目标

为测试/研发提供**多轮对话编排助手**：借助 OpenCode Agent 的会话能力，加载 `ui-record-wet-test` skill，通过控制面 HTTP API 协助用户完成「建交易 → 准备 → 录制 → 按落库验收」，减轻手工点 UI 与重复湿测成本。

成功判据：

1. 用户可在对话中补齐门闩字段后，由 Coach 调通 `analyze → create → prepare → start → detach`。
2. PASS/FAIL 以**规则工具**核对 `steps[]`（非仅 `recordStatus` / `isSuccessful`）；模型只解释结果。
3. 不改变产品录制执行路径：真机点击仍由 Executor + Python Agent 完成。
4. 不把 OpenCode SDK 焊入 `record/start` 或替换 `src/llm-utils.js` standalone。

## 2. 非目标

| 非目标 | 说明 |
|--------|------|
| 替换 Python 录制 Agent | Coach 不持有 CDP、不点 Element UI |
| 产品主路径引入 OpenCode SDK | 控制面 LLM 保持 standalone（AGENTS 硬约定） |
| SPA 仓内嵌首版 | MVP 不做 Vue 面板；后续 Phase 2 可选 |
| 默认改引擎代码 | 引擎修复属 Lead/另线；Coach 默认拒绝 |
| 无人值守批量录制 | 与现有 batch 录制入口分离；本设计不做队列抢占 |
| 自动 `restart-local` | 须用户显式确认后才可调用 |

## 3. 决策摘要

| 项 | 选择 |
|----|------|
| 形态 | **旁路 CLI / 本地进程**：仓库目录 `tools/recording-coach/` |
| 控制面 | HTTP 客户端 → `http://localhost:4097/api/v2/*`（可配 base URL） |
| 作业手册 | **唯一真源** [`tools/recording-coach/skill/SKILL.md`](../../tools/recording-coach/skill/SKILL.md)；Coach 直接加载该目录，**不**另写 `brief.md` |
| 对话运行时 | OpenCode Agent（SDK / CLI 会话）；多轮补槽、确认危险操作 |
| 验收 | 规则 tool `assert_steps`；LLM 不得单独裁定 PASS |
| 改引擎 | MVP **禁止**；话术引导用户开另线 |
| 重启服务 | tool 存在，但 **require_confirm=true** |
| 会话分层 | **OpenCode Session**（对话）与 **Coach Workflow**（编排相）分离；相状态不靠模型记忆 |
| 编排状态存放 | 证据目录内 `workflow.json`（权威）；禁止只存在于 LLM 上下文 |
| 步骤权威源 | 控制面 MySQL（经 `/api/v2`）；Coach 不复制步骤库 |

## 4. 架构

```text
用户 ←多轮对话→ OpenCode Recording Coach
                    │ system ← tools/recording-coach/skill/SKILL.md
                    │ tools ← HTTP 薄封装 + assert_steps
                    ▼
            JS-gen 控制面 :4097  /api/v2/*
                    │ prepare / start
                    ▼
            Executor + Python 录制 Agent + Chrome
```

职责切割：

| 组件 | 职责 |
|------|------|
| OpenCode Coach | 追问缺字段、调用 tools、解释日志/VERDICT、写证据目录摘要 |
| Skill | 流程纪律、假成功定义、查询类注意点、可复制提示词模板 |
| 控制面 + Python Agent | 登录、占槽、真机操作、落库步骤 |

## 5. 会话状态机

状态名用英文便于实现；对用户可用中文复述。

```text
CollectInputs → ReadyToCreate → Created → Prepared → Recording
    → Settled → Asserting → Done
         │                      │
         └──── RetryNewTraj ←───┘（失败且用户同意新建）
```

| 状态 | 进入条件 | Coach 行为 | 退出 |
|------|----------|------------|------|
| CollectInputs | 会话开始或缺字段 | 按 skill「开场必填」追问 | 六字段齐 → ReadyToCreate |
| ReadyToCreate | 用户确认任务文案 | 可 `analyze` 预览 phases | 用户确认 → Created（create） |
| Created | trajId 已有 | 展示 id；检查 executors | prepare 成功 → Prepared |
| Prepared | prepare 200 | 可选提示 CDP 关弹窗（MVP 可只文档提示） | 用户确认后 start |
| Recording | start 已发出 | **异步轮询** `GET trajectory`；禁止同步死等无进度 | recordStatus 终态或超时 |
| Settled | recorded/failed/… | detach（若仍附着） | → Asserting |
| Asserting | 有 steps 快照 | 调 `assert_steps` | → Done 或建议 RetryNewTraj |
| Done | 已写 through-report 要点 | 输出 VERDICT 一行 | 会话可结束 |
| RetryNewTraj | 用户同意新建 | 清 trajId，保留门闩/stamp | → ReadyToCreate |

**硬门闩（CollectInputs 齐套）**：验收目标（含落库级判据）、参考 traj 或显式 functionId、systemAccountId、关键 stamp、禁入、可否改引擎（MVP 固定否）。

### 5.1 双层会话模型

| 层 | 含义 | 权威存放 |
|----|------|----------|
| **OpenCode Session** | 多轮对话线程：messages、tool 调用轨迹、abort/revert/summarize | OpenCode 运行时（SDK/`session.create` 所绑目录，随安装与 `location` 而定） |
| **Coach Workflow** | 编排进度：`phase`、`trajectoryId`、门闩 inputs、assert 判据 | 本地 `workflow.json`（见 §5.2）；**不是** OpenCode message 历史 |

关系约定：

1. **一单湿测 = 一个 OpenCode session**（title 建议含 fid/stamp 摘要）。`RetryNewTraj` **复用同一 session**：清 `trajectoryId`、保留 inputs，勿为「再建一笔」无脑新开 session。
2. **相迁移由 tool 成功回调推进**（如 `create_trajectory` 成功 → `Created`）。模型不得直接写 `phase=Done`；非法迁移（如未 `Prepared` 就 `start`）由 tool 返回 error。
3. 每轮用户 `prompt` 前可用 `noReply: true` 注入一小段当前 `workflow.json` 快照，降低 compaction 后丢 trajId 的概率。
4. **并发（MVP）**：同一 Coach 进程同时最多一个 `phase=Recording`；已有 Recording 时拒绝第二条 `start`。
5. **取消**：用户中止 → OpenCode `session.abort` + 若仍占槽则必调 `detach_trajectory`。
6. **上下文**：`get_trajectory` 对模型侧优先回摘要（stepCount、actionTypes、目标步 params）；完整 JSON 可落证据目录，避免撑爆 session。

```text
用户 ⇄ OpenCode Session（聊天）
         │ 读写
         ▼
    workflow.json（编排相）
         │ HTTP
         ▼
    控制面 MySQL（交易/步骤权威）
```

### 5.2 数据存放

| 数据 | 存放位置 | 说明 |
|------|----------|------|
| 交易 / 阶段 / 步骤 / recordStatus / remote_session | **控制面 MySQL**（`/api/v2`） | 产品权威；Coach 只持 `trajectoryId` 引用 |
| OpenCode 对话 messages、tool 轨迹 | **OpenCode 运行时会话存储** | 「聊到哪了」；随 SDK/CLI 生命周期 |
| 编排相与门闩 | **`{evidenceDir}/workflow.json`** | 「录到哪了」的权威；见下方 schema |
| traj-id、VERDICT、可选 through-report | **`{evidenceDir}/`** | 默认 `tmp/recording-coach-<timestamp>/`；**不提交 git** |
| 控制面 / 执行机进程日志 | `tmp/server-main.log`、`tmp/executor-main.log` | 已有；Coach 只读查阅 |

**刻意不存：**

- MVP **不**新建产品侧「陪跑会话」MySQL 表  
- **不**写入 `data/kb/`  
- **不**把账号密码写入证据目录或对话落盘  
- **不**在 Coach 侧复制全量 steps 作为第二真相源  

#### `workflow.json` schema（MVP）

```json
{
  "opencodeSessionId": "string",
  "phase": "CollectInputs|ReadyToCreate|Created|Prepared|Recording|Settled|Asserting|Done|RetryNewTraj",
  "trajectoryId": null,
  "evidenceDir": "tmp/recording-coach-...",
  "inputs": {
    "goal": "",
    "functionId": null,
    "systemAccountId": null,
    "stamp": {},
    "forbidden": [],
    "allowEngineEdit": false,
    "taskText": "",
    "assert": {}
  },
  "lastError": null,
  "updatedAt": "ISO-8601"
}
```

`inputs.assert` 形状与 §7 `assert_steps` 入参一致。实现期可用 Zod/JSON Schema 校验；phase 枚举与 §5 表同步。

## 6. Tool 清单（MVP）

薄封装：入参/出参 JSON，错误原样上抛；超时与 skill 一致（prepare≥600s、start 请求可立即返回若改为异步——见 §6.1）。

| Tool | 方法 | 用途 |
|------|------|------|
| `list_executors` | `GET /api/v2/executors` | connected / inUse；拒绝在全忙时 prepare |
| `get_trajectory` | `GET /api/v2/trajectories/{id}` | 详情、phases、steps |
| `analyze_trajectory` | `POST /api/v2/trajectories/analyze` | `{description, functionId}` → phases |
| `create_trajectory` | `POST /api/v2/trajectories` | name/task/requirement/phases/fid/account |
| `prepare_record` | `POST .../record/prepare` | 占槽登录 |
| `start_record` | `POST .../record/start` | `{phaseIds}`；见异步约定 |
| `detach_trajectory` | `POST .../detach` | 释放槽 |
| `assert_steps` | 本地规则 | 见 §7；**不调 LLM** |
| `write_evidence_summary` | 写 `tmp/<dir>/` | traj-id、VERDICT 摘要（可选 MVP） |

### 6.1 `start_record` 异步约定

`record/start` 可能阻塞数分钟。MVP 二选一（实现计划锁定其一）：

- **A（推荐）**：Coach 用长 timeout 调 start，同时每 N 秒 `get_trajectory` 向用户播报 stepCount/recordStatus；或  
- **B**：若控制面后续提供「仅触发」语义则轮询至终态。

禁止对用户呈现「无进度的无限等待」。超时后建议 `detach` + BLOCKED，并提示查 `tmp/executor-main.log`。

### 6.2 确认型 tool（MVP 可延后实现，契约先定）

| Tool | 约束 |
|------|------|
| `restart_local_services` | 仅当用户本回合明确确认；先 `list_executors` 警示在途录制 |
| `cdp_dismiss_dialogs` | Phase 2；MVP 话术引导人工/已有脚本 |

## 7. 验收规则（`assert_steps`）

输入：`trajectory` JSON（或 id 由 tool 内自拉）+ 用户声明的判据对象，例如：

```json
{
  "minStepCount": 1,
  "requireActionTypes": ["click_table_row_radio"],
  "paramEquals": { "click_table_row_radio.row_text": "first" },
  "xpathSmartIncludes": { "click_table_row_radio": ["el-table__body-wrapper", "el-table__row"] },
  "rejectZeroStepRecorded": true
}
```

规则（全部可配置，默认开启假成功拒绝）：

1. `rejectZeroStepRecorded`：`recordStatus` 为 recorded/completed 且业务 `stepCount==0`（或 steps 无业务动作）→ **FAIL**（假成功）。
2. 每个 `requireActionTypes` 至少出现一次。
3. `paramEquals`：对应动作的 `paramsJson` 字段精确匹配。
4. `xpathSmartIncludes`：`elementJson.xpath_smart`（或等价）含子串列表。
5. 汇总：`PASS` | `FAIL` + `reasons[]`；Coach 映射 skill 的 `DONE` / `DONE_WITH_CONCERNS` / `BLOCKED`。

模型可以复述 reasons，**不得**在 assert 返回 FAIL 时输出 DONE。

## 8. Skill 与提示词边界

| 内容 | 位置 |
|------|------|
| 流程、铁律、失败再试、可复制提示词 | skill 真源 |
| Coach 系统提示 | **无独立 brief.md**；以 `tools/recording-coach/skill/SKILL.md` 为 system/作业手册真源（可再叠一行极短角色句：编排陪跑、禁改引擎） |
| API 坑位长文 | guide，按需 Read，不整篇塞进 system |

挂载：OpenCode 侧 `skills` 指向 `tools/recording-coach/skill/`（或启动时注入该目录 `SKILL.md` 全文）。

## 9. 安全与并发

1. **抢槽**：`list_executors` 见 `inUse>0` 且无空闲 connected 节点 → 不 prepare，请用户等待或换节点。  
2. **重启**：默认不暴露自动重启；若实现 `restart_local_services`，必须二次确认文案含「将杀掉 server.mjs/agent.mjs」。  
3. **禁改引擎**：无 `edit_file` / `git_commit` 类 tool；用户要求修 STC 等 → 说明开引擎线。  
4. **证据目录**：默认 `tmp/recording-coach-<timestamp>/` 或用户指定；内含 `workflow.json` + traj-id/VERDICT；不提交 git。  
5. **密钥**：不经对话回显账号密码；prepare 使用已有 `systemAccountId`。  
6. **Recording 互斥**：见 §5.1；禁止并行双 start 抢槽。

## 10. MVP vs Phase 2

### MVP（实现计划第一批）

- `tools/recording-coach/`：OpenCode 入口、HTTP tools、`assert_steps`、README  
- 加载 skill；**外置 `workflow.json` + tool 推进相**（Collect→Done，含 RetryNewTraj）  
- 证据目录：`workflow.json`、`traj-id.txt`、对话末 VERDICT（through-report 可最小）  
- 手工验收：对照 skill 实证锚点（如 fid `9000000011` + stamp 客户号）跑通一轮

### Phase 2

- `cdp_dismiss_dialogs`  
- SPA「录制向导」旁路入口（另仓）  
- 按 `trajectoryId` / `workflow.json` 恢复 OpenCode session；只读进度子 session  
- 与 batch 录制的只读联动（不抢队列）  
- 更丰富的 assert DSL（正则、phase 级）

## 11. 与产品路径并存

| 路径 | LLM | 用途 |
|------|-----|------|
| 产品 AI 录制 | 控制面 standalone → Executor Python | 浏览器内操作与落库 |
| Recording Coach | OpenCode 会话（旁路） | 编排 API + 验收话术 |

Coach **不是**第二套点击引擎；发版与依赖（OpenCode SDK）仅存在于 `tools/recording-coach/`，控制面 `package.json` 主依赖不强制引入 OpenCode。

## 12. 目录预告（实现期）

```text
tools/recording-coach/
  README.md                 # 启动、环境、与 4097 关系
  package.json              # 旁路依赖（含 OpenCode SDK，若采用）
  skill/
    SKILL.md                # 作业手册真源（原 scripts/prompts/skills/ui-record-wet-test）
  src/
    index.ts                # 会话入口（绑定 OpenCode session ↔ evidenceDir；加载 ../skill）
    workflow.ts             # workflow.json 读写与合法相迁移
    tools/*.ts              # HTTP + assert_steps（成功时推进 phase）
  # 不另建 brief.md
# 运行期证据（gitignore）：
# tmp/recording-coach-<ts>/workflow.json
# tmp/recording-coach-<ts>/traj-id.txt
```

表征：实现期可加 `scripts/characterization/` 对 `assert_steps` 纯函数 pin（不依赖真机）。

## 13. 验收（本设计文档）

- [x] 目标/非目标/决策表完整  
- [x] 状态机与 tool 契约可指导实现计划  
- [x] 明确 OpenCode 旁路、不进入 record 主链  
- [x] 双层会话 + 数据存放（§5.1–§5.2）定稿  
- [x] 实现计划：`docs/superpowers/plans/2026-09-18-recording-coach-opencode.md`  
- [ ] 代码 MVP（旁路脚手架已落地 `tools/recording-coach/`；全链路 wet 见 WET-CHECKLIST，另开窗口验收）

## 14. 遗留移交

1. OpenCode SDK 具体包名/版本与鉴权方式：实现计划对照当时上游文档锁定。  
2. `start` 同步 vs 触发+轮询：实现计划做一次控制面行为核实后二选一写死。  
3. 是否允许 Coach 写完整 `through-report.md`：MVP 最小 VERDICT 即可，Phase 2 对齐。  
4. OpenCode 会话文件在磁盘上的精确根目录：实现计划按所选 SDK/`location.directory` 实测登记（本设计只要求与 `workflow.json` 分离）。
