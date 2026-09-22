# AGENTS.md

面向 Codex、Claude Code、Cursor 等在本仓库工作的 Agent。**本文件为唯一权威约定**。面向人的说明见 `README.md`；前端契约以 `/api/docs` 为准（`README` 与 api-docs 之外不在这里重复架构目录）。

## 跨 Agent 协作（开场三件事 / 开工声明 / 收工回报）

多个 Agent 工具（Zcode / Cursor / Codex 等）在同一仓库开发，会话记忆互不相通；跨工具互通靠仓库内文件 + git 历史，不靠任何工具的内置记忆。

**版本双线：**
- 每个版本两套分支：开发 `uara_V<版本>_dev`，相对稳定的 test `uara_V<版本>_test`。日常只在 **dev** 上改；test 只接收从对应 dev 合入的、已验收的结果。
- **V2.0**：稳定 test 沿用 **`uara_V2.0`**（定盘点 `eab6c041`，不再直接提交）。日常开发在 **`uara_V2.0_dev`**。V2.0 不另建 `uara_V2.0_test`，稳定线即 `uara_V2.0`。
- 日常 `git pull` 上游为 **`uara_V2.0_dev`**。功能分支从 dev 切出、合回 dev；发布到稳定 test 时再将 dev 合入 `uara_V2.0`（`--no-ff`，禁止 force push）。
- 新版本按对开：`uara_V<x.y>_dev` 与 `uara_V<x.y>_test`。

**适用范围：**
- **研发任务**（会改仓库内 tracked 文件：代码、配置、迁移、文档、todo/agent-log 等）：须遵守下方开场三件事、开工声明、收工回报。
- **联调测试**（仅控制面/执行机/SPA 湿测：录制、回放、停止链、grep 观测等，**本任务单元内不改 tracked 文件**）：**不写** agent-log 开工/收工条目，也**不必**为联调单独 commit agent-log。结论在用户会话或他线收工「遗留移交/联测回执」中交代即可。仍建议做开场三件事，避免踩他线在途声明或 WIP。
- 边界：联调过程中若发现必须改代码才能继续，**立即切换为研发任务**——先补开工声明再改文件，并按研发收工流程闭环。

**开场三件事（研发任务与会话开始时建议做）：**
1. `git log --oneline -15` + `git status` — 最近提交与未提交改动
2. `docs/superpowers/todo-list.md` — 当前工作线与挂起项
3. `docs/superpowers/agent-log.md` 最近几条 — 他线在途声明与遗留

**开工声明（研发任务：动第一行 tracked 改动之前）：**
- 先 `git pull` 再写声明，避免与他线声明/代码冲突
- 在 `docs/superpowers/agent-log.md` 顶部（紧随文件头说明块之下）插入**开工条目**：时刻 + 工作范围（文件/目录清单）+ 禁入区 + 执行方式；**立即 commit + push**（未推送对他线不可见）
- 自己的文件集须与在途声明及工作区未提交改动不相交；有交集先协调或换文件集
- 主会话派发子智能体时**代为声明**；子智能体不直接写 agent-log、不 commit，由主会话验收后代提交

**收工回报（研发任务单元结束时）：**
- **合并后验收**（有代码改动时）：commit 后、写收工条目前先 `git pull`（或 fetch + merge/rebase），在**合并后的集成状态**重跑本单元验收（smoke / characterization / `bash scripts/refactor/verify-all.sh` 等）；通过后再写收工并 push。禁止只凭合并前本地结果收工。
- 合流后验收失败：用 `git log`/`git diff` 区分本次 vs 他线；本次所致修完重验；他线所致在收工「遗留移交」写清文件:行、复现命令、现象。
- **收工条目**回链开工：完成（含 commit hash）/ 验收证据 / 遗留移交；**commit + push**。agent-log push 冲突时 pull 后并排保留双方条目，禁止 force push；合入他线代码后须重跑验收再 push。
- 任务单元代码改动结束即 commit；agent-log 与代码一并 push。顺带写入他线未提交条目时，commit message 注明。
- **commit message**：中文总结式——首行「改了什么 + 为什么」，正文分条写影响与验收证据；禁止无信息英文套话。变更史以 commit message 为准。
- **CHANGELOG.md**：根目录文件为用户指定的对外汇报稿，**仅按用户要求更新**；Agent 不主动维护，也不要重建已废弃的通用 CHANGELOG 流程。
- **收工前清点**：stash 逐条处置（只 drop 不裸 pop）；分支落后则 pull；不遗留无关他线 WIP。

## 子智能体协作

**默认分工：**
- **main（主会话）** — 规划与设计：决定拆分粒度、关键权衡请用户裁定、审阅子智能体产出、跑最终验收、如实汇报。
- **Explore** — 只读调研（大文件/长函数/死代码、characterization 耦合矩阵）；输出带优先级的 `file:line` 列表。**禁止改文件。**
- **general-purpose** — 实现自包含、行为保持的改动并自行验收。**禁止 commit。**

**委派规则：**
- 每个子智能体一份自洽 prompt：路径 + 行号、允许/禁止改动范围、验收命令、汇报格式。
- 并行子智能体的文件集须**互不相交**，避免并发编辑冲突。
- 子智能体网络超时：重试一次；仍失败则由主会话接手。
- 每个子智能体结束后：主会话重跑关键验收并检查越界改动；合规偏差如实说明。

**重构硬约束：** `scripts/characterization/*` 用 `read_text` 断言源码子串，钉住函数名、闭包相对顺序、精确字符串（`_form.py` 约被 30 个脚本 pin）。拆文件时保留这些标记，并让测试读拼接后的文件（参见 `_form.py` → `form_autofill.py`）。

## 常用命令

```bash
npm start          # 控制面（独立 LLM，非 OpenCode SDK 产品路径）
.\start.ps1        # PowerShell 启动（设置环境变量）
npm run dev        # 开发模式（文件监听）
npm run executor   # 执行机 Agent（连 /ws/executor）
npm install        # 首次安装依赖

# characterization / 导入 smoke（非完整测试套件）
node scripts/smoke/accept-replay-apis.mjs
python scripts/characterization/characterize-form-rules.py
node scripts/characterization/characterize-trajectory.mjs

# 重构门禁 — 每个重构微步后跑（核心 smoke）
bash scripts/refactor/verify-all.sh                # 全量（合并后验收必须用这个）
bash scripts/refactor/verify-all.sh select,fill    # 域管线：只跑改动涉及的域
bash scripts/refactor/verify-all.sh --changed      # 按 git diff 自动选域
# 微步验收 = 域管线 / --changed（秒级）；合并后验收必须全量；新 pin 须在
# verify-all.sh 域注册表登记（跨域 pin 可登记多个域；拿不准进 core）
```

**手工验收：** 产品 API 文档 `http://localhost:4097/api/docs`（前端契约以 `src/dashboard/api-docs/catalog.js` 为准）；公开 API 在 `/api/v2/*`。旧工程 HTML（`/api/test`、record-console/studio）301 到 `/api/docs`；旧 `/api/trajectory`、`/api/case-data` → **410 Gone**。

## 行动前必知

本仓库是面向 **Element UI / Vue** 的**浏览器自动化服务**：Playwright 脚本生成、MySQL 轨迹录制/回放、可选远程执行机，由 Node.js Express 控制面（`server.mjs`，端口 4097）提供。产品 SPA 在外部；本仓仅托管 `/api/docs`。模块/路由清单可在目录中自行发现；下面列出易错、承重的事实。

**JS 片段单一语言面：**
- `window.CTRL` 注入库（`src/ctrl-actions/` 及桩 `src/ctrl-actions.js`）与 assemble 工程管线已移除，浏览器注入式 CTRL 双语言副本不再存在。
- Agent 侧浏览器 JS 片段唯一定义在 `scripts/controller/actions/js_snippets/*`（由 `scripts/controller/actions/_js_snippets.py` 聚合 re-export）；控件逻辑改一处即可，无跨语言同步负担。
- 仍存在的跨语言单源是 **PAGE_LOCATOR_HELPERS 生成链**：JS 源 `src/cdp/page-locator-helpers.js` 经 `node scripts/_gen_locator_helpers_py.mjs` 生成 `scripts/controller/actions/js_snippets/_locator_helpers_js.py`；**禁止手改生成物**。
- **KB 召回金样例是唯一跨语言契约**：`scripts/characterization/fixtures/kb-recall-golden.json` 由 JS（`characterize-flow-card-recall.mjs`）与 Python（`characterize-kb-recall.py`）共同断言；改任一侧召回实现须同 commit 复跑两侧 characterization；已知分歧以 `divergenceAccepted` 显式登记（收敛后移除），禁止对金样例 query 特判。
- **KB 召回质量评测与跨语言契约职责分离**：质量门禁 = `scripts/characterization/fixtures/kb-recall-eval.v1.json`（130 条独立标注，冻结，`evalVersion`/`changeLog` 变更须 Lead 批准）；指标由 `node scripts/kb/recall-eval.mjs` 产出（Acc@1/Recall@5/MRR/nDCG/拒答/噪声/延迟冷热，`--baseline` diff）；任何召回改动须复跑评测并与基线 diff（设计/基线/阈值见 `docs/superpowers/archive/reports/2026-09-09-kb-recall-eval-baseline.md`）；扩充/修订评测集时禁止先跑匹配器反推 gold。

**Element UI 与正确性规则：**
- **录制合并（coalesce）**（`scripts/state.py` `_record_action`）：同一元素连续操作保留后一条并产出 `removedIds`；非连续重复保留。原 Node assemble 时 `src/dedup.js` 已随 assemble 管线移除。
- **原生 setter 模式**：Element UI 输入勿单独依赖 Playwright `page.fill()` 处理 `el-form`。
- **Select 录放分发**：`select_option` 录制与产品回放共用 `resolve_select_dispatch`（`scripts/controller/actions/select_dispatch.py`）；勿假定 docstring 里「同 JS 路径」即同一 Python 路由。见 `docs/superpowers/archive/specs/2026-09-09-select-record-replay-unify-design.md`。
- **Fill 录放分发**：`fill_form_field` 共用 `resolve_fill_attempt_order`（`scripts/controller/actions/fill_dispatch.py`）；Phase B 回放经 `FillEngine`。见 `docs/superpowers/archive/specs/2026-09-09-fill-record-replay-unify-design.md`。
- **Radio 录放**：`click_radio` 产品回放经 `RadioEngine`（`mode=replay` / `click_radio_for_replay`）；xpath 再 label JS。见 `docs/superpowers/archive/specs/2026-09-09-radio-record-replay-unify-design.md`。
- **Click 录放（index+button）**：产品回放经 `ClickEngine`（`*_for_replay` / durable）。见 `docs/superpowers/archive/specs/2026-09-10-click-record-replay-unify-design.md`。
- **`el-select`** → 用 `selectOption`；对 option span 泛用 index 点击会静默失败。
- **每次操作前重新查 DOM** — Vue 可能重建对话框/组件。
- **阶段合约令牌归属**（`scripts/controller/actions/phase/`）：终态令牌（`toast_ok` / `confirm_click` / `picker_closed` / `saved_navigation`）归属实际执行终态动作的阶段。仅开 picker → `navigate`（无 picker 令牌）；仅填写且保存在后续阶段 → `maintain` + `all_editable`，但 `submit.required=false` / `success.kinds=[]`；跨阶段守卫（`_apply_cross_phase_token_guard`）会丢弃归属后续阶段的令牌。`compile_boundary` / `apply_phase_contract` 调用方须传 `all_phases` + `current_phase_number`。见 `docs/superpowers/specs/2026-09-21-phase-contract-token-ownership-design.md`；pin：`characterize-cross-phase-token-guard.py`、`cold/characterize-phase-boundary.py`、`cold/characterize-phase-intent.py`。

**录制 / detach 语义：**
- `record/stop` 结束录制但**不**释放执行机槽位；`stream/detach` 仅停 BiB（`remote_session`→`idle`，`live`→`draft`）；`detach` 关闭 Chrome + Python + 槽位。
- 多轨迹 BiB：推送身份为 `remote_session.id`；绑定 1:1 轨迹 ↔ remote_session ↔ agent 会话；detach/stream-detach 按轨迹 scoped。
- 产品回放为 live `replay_actions`（`_replay.py`，`POST .../steps/replay`）；定位偏好 `xpath_smart`（语义锚 + 可见 dialog/drawer 范围 + 易变树文本剥离 + icon class/tooltip）→ label/semantic（含 placeholder）→ `xpath_full`。装配式回放与工程调试端点（`/api/test/assemble|run|history`、v2 `assemble-file`）已移除；回放统一走产品 API 的 `replay_actions`。
- 执行机槽位：每节点 `EXECUTOR_CAPACITY` 槽；控制面租约至 detach；每槽 CDP 端口 `9242+slotIndex`，避免 `CDP WebSocket not found`。
- LLM 独立模式为**默认**（`src/llm-utils.js`）；OpenCode SDK 非产品路径。

**Python Agent（`scripts/`）：** browser_use 式布局（`main.py`、`controller/`、`agent/`、`session_runner.py`）；prompt 在 `scripts/prompts/`。本仓**无** `.opencode/skills/`（已 gitignore）— 改 prompt 在 `scripts/prompts/`，并与 `js_snippets` 提示、`form_rules.py` 同步；除非用户明确要求，勿恢复「skill」包。

**常见改动区域：** `src/routes/v2/*`（主产品 API）、`src/services/trajectory/*`（服务与拆出的 runner；`index.js` 再导出公开名）。遵循树里已有的 route/service 抽取模式。

**JSDoc 注释规范：**
- 规范文档：`docs/jsdoc-convention.md`。核心公开函数（导出函数 / 路由 handler / 公开 service·dao 方法 / 类方法）**必须有 JSDoc**，含 `@param`/`@returns`；私有 helper、回调、Promise `.then/catch` 内联箭头、一行纯转发可省略。**不加** `@author`/`@since`。
- 工具链：`npm run lint` / `npm run lint:fix`（eslint-plugin-jsdoc，warn）。存量 warning 已清零，**新代码不得新增 warning**。
- 绕过（不 lint、不加 JSDoc）：`migrations/**`、`scripts/characterization/**`、`scripts/smoke/**`。
- 硬性约束：加 JSDoc 时**只插入注释，严禁删改已有代码行**（曾有子智能体误删函数定义）。
