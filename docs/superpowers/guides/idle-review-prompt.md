# 闲时任务提示词：基于教训的定期代码审查与优化

> 用途：**交给闲时任务管线派发执行**（对本仓代码做一轮「教训驱动」的定向审查，并**根据报告实施优化**）。
> **管线说明（2026-09-08 定）：本任务只走闲时管线，不建 cron 定时任务**——频次由派发方按闲时与花销决定，guide 本身即完整自包含的 dispatch 产物。
> 源头：2026-09-07/08 agent-log 教训总结。教训清单过期时，先重读 `docs/superpowers/agent-log.md` 最近 30 条与 `docs/superpowers/todo-list.md` 更新本文件的「教训检查单」。

---

## 提示词正文（复制以下全部内容作为任务 prompt）

你是 JS-gen 仓库的闲时代码审查员。本轮任务分两阶段：**阶段一只读审查、产出报告；阶段二根据报告实施优化（修复+加固+回归验证）**。

### 花销约束（硬要求，2026-09-08 用户定）

- 审查子智能体**严格 3 个**（第四步编队），不追加派发、不拆更细；
- **P1 修复主线程直改优先**，只有文件集互不相交且批量明显时才派发子智能体；
- **禁真机类验证**：不发起 record/prepare/start、不占执行机槽、不做任何写库冒烟——只跑离线 characterization；
- 审查+修复在**单轮会话内完成**；在途线与目标文件大面积冲突时，缩范围为非冲突族并在收工条说明。

### 下轮复查入口（防再犯护栏台账，每轮先跑一遍确认仍绿）

- `characterize-quality-final-gate.mjs`——终局门闩 v3（quality_failed 捕获 / phaseOutcomes 消费 / perRunZero / gate runId 守卫 + batch 收敛）；
- `characterize-recorder-phase-reset.py`——done 拒绝分支 return True / save 三键阶段清理 / persist 事件 runId 盖章；
- `characterize-req-draft-fk-guard.mjs` + `characterize-req-draft-traj.mjs`——suggestedFunctionId FK 双防御；
- `characterize-owned-wait-shape.mjs`——真实 hub 驱动 owned-wait（3 参 arity 钉）+ runHealStep runId/success 接线；
- `characterize-ghost-pending-prune` / `characterize-run-event-ownership` / `characterize-phase-done-runid`——先行护栏。
（新护栏落地后追加到本清单；发现护栏红=先归因「形状漂移 vs 回归」再动 pin。）

### 第一步：开工声明（硬约定）

按 AGENTS.md 协议，在 `docs/superpowers/agent-log.md` 顶部插入开工条目（时刻 + 范围=审查涉及文件 + 预计修复文件 + 禁入区 + 方式）并立即 commit。声明范围必须覆盖阶段二可能触碰的文件；与在途条目/工作区未提交改动有交集的文件，从审查修复范围剔除并记入报告「移交」节。

### 第二步：收集最新教训

1. `git log --oneline -30` 看最近提交主题；
2. 读 `docs/superpowers/agent-log.md` 最近 30 条，提取自上次审查以来新出现的缺陷模式与「遗留移交」条目；
3. 读 `docs/superpowers/todo-list.md`，确认没有与在途工作线冲突的审查目标（他线热区跳过不审）。

### 第三步：按「教训检查单」逐项定向搜索

对下列每一族模式，用 grep/阅读定位疑似点位，逐一判定是真问题还是已防护。**每族都要跑，不许只挑顺眼的。**

**A. 假成功族（最高优先）**——历史上被打穿四次：门闩豁免、跨 run 串台、自愈删步、静默保存。
- 搜成功标记点：`isSuccessful`、`recorded`、`save_ok`、`success: true`、`phase_done` 的所有写入/放行分支；
- 检查每个门闩：豁免条件是否过宽（如「save_ok 豁免一切错误」）、判定单元是否是聚合总数（应按阶段/按步骤）、是否只信自报 flag 而无业务证据（toast/stamp/单据状态/步骤数）；
- 搜「无反馈即成功」分支：无 toast/无报错/无跳转就记成功的路径（历史案例：form_save 静默保存分支）。

**B. 事件/回调接线族**——3 参 onSessionEvent 被当 addListener 直传，令所有录制失败，单元测试抓不住。
- 搜 `addListener`/`on(`/`emit(` 调用点，核对回调实参 arity 与签名一致；
- 搜跨会话/跨 run 共享的可变状态（`_CURRENT_` 类模块级键、runtime 缓存），检查是否有归属隔离（如 runId）与清理（finally 补发/取消）；
- 新增接线若无真实形状的 smoke（与生产调用形状一致），列为风险。

**C. 静默兜底族**——静默 catch、静默降级、静默空转。
- 搜空 catch、catch 后吞错继续、`String()` 包 JSON 列对象（mysql2 JSON 列返回对象，String() 得 `[object Object]`）；
- 搜重试/降级路径是否有日志与广播（如 `*_failed` 事件），失败不可见=隐患。

**D. 状态时序族**——过早返回、异步未落库就断言。
- 搜「操作立即返回终态」的点（历史案例：record/start 过早返回 recorded；detach 后立即读 stepCount 读 0）；
- 检查返回终态前是否有双源复核或异步终局化。

**E. 重启/进程族**
- 搜端口绑定、进程管理代码，检查 EADDRINUSE 是否显式报错退出而非静默半死；旧实例残留是否可被探测。

**F. 遗留移交对账**
- 把第二步收集的「遗留移交」逐条核对：是否已有对应 commit/条目闭环？超期未动的按优先级列出来。

### 第四步：带领 agent team 并行执行（默认执行方式）

第三步的六族检查单**不要主线程串行跑**，按并行子智能体模式带团队执行：

**派发前（主线程自己做）**：
- 完成第一、二步（开工声明 + 教训收集），把最新教训注入各子智能体 prompt——子智能体不会自己读 agent-log；
- 自查 agent-log 所有在途开工条目与工作区未提交改动，确定**禁入区**（他线热区、busy 槽位、WIP 文件）写进每个 prompt。

**团队分工（6 族 → 3 个子智能体，文件集/关注面必须不相交）**：
- **Agent 1（Node 侧审查）**：A 假成功族 + D 状态时序族，范围 `src/services/trajectory/**`、`src/services/req-draft-traj/**`、`src/routes/v2/**`；
- **Agent 2（Python 侧审查）**：B 事件/回调接线族 + A 族中 Python 段（recorder_emitters 门闩、_CURRENT_ 类模块级键），范围 `scripts/agent/**`、`scripts/session_runner.py`、`scripts/state.py`；
- **Agent 3（横切面审查）**：C 静默兜底族 + E 重启/进程族 + F 遗留移交对账，范围全仓 grep（node + python + 迁移脚本），只报模式命中不需深读。

每个 prompt 必须自包含：本族检查单全文 + 最新教训摘要 + 禁入区 + 产出格式（`file:line` + 严重度 + 违反哪条教训）+ **纪律：只读、绝不编辑任何文件、绝不 commit、零发现也要写明搜索模式与覆盖文件**。

**回收与验收（主线程做）**：
- 抽查每个子智能体的 top 发现（亲自 Read 对应 file:line 核实），防「假完成」与误报——历史教训：有子智能体 0 改动声称完成，也有误报；
- 汇总去重、按严重度排序，写第四步的报告；
- agent-log 开工声明中**代子智能体声明**（子智能体不写 agent-log）。

### 第五步：产出报告

写 `tmp/idle-review/<日期>-report.md`，每个发现一条：
- 严重度（P0 可致假成功/数据损坏 / P1 功能缺陷 / P2 观察项）；
- `file:line` 定位 + 代码片段 + 为什么违反哪条教训；
- 明确区分「确认的问题 / 疑似需人工判断 / 已有防护不成立为问题」。

**纪律**：宁可报疑似并说明理由，不许静默跳过某一族；也不许把「风格不顺眼」当发现。若某族搜索后零发现，在报告里写明搜索了什么模式、覆盖哪些文件。

### 第六步：实施优化（阶段二）

根据报告逐条处置，**全部确认的问题都必须修复或显式移交，不许只记录不动手**：

**处置优先级**：
- **P0（可致假成功/数据损坏）**：主线程亲自修，最小改动；修复必须配防再犯护栏（characterization pin / 断言 / 真实形状 smoke），这是本任务与普通修 bug 的区别——教训不能只修一次，要钉死。
- **P1（功能缺陷）**：可派发子智能体修复（文件集不相交），prompt 必须含：发现详情（file:line + 违反的教训）+ 允许编辑的文件白名单 + 禁入区 + 验证命令 +「绝不 commit」。子智能体只改代码，验收与代提交由主线程做。
- **P2（观察项/疑似）**：不当场修；写入 `docs/superpowers/todo-list.md` 挂起区或 agent-log 收工条目的「遗留移交」，附触发条件。

**修复纪律**（沿用仓内硬约束）：
- 最小改动原则，修哪条报哪条，不顺手重构；
- JSDoc 规范：只插注释不改已有代码行；新代码 0 新 lint warning；
- 每个修复独立 commit，message 引用教训来源（如 `fix(traj): guard save_ok exemption — lesson from #612/#614 fake-success`）；
- 与在途线文件集有交集的发现不修，移交流程同 P2。

**回归验证（每个修复 commit 前必跑）**：
- Node 改动：`node --check` + `npx eslint <改动文件>` 0 新 warning；
- Python 改动：`python -m py_compile` 或 ast.parse；
- 涉及引擎/服务链：`bash scripts/refactor/verify-all.sh`（**基线=ALL GREEN，2026-09-08 起**；出现红先归因「他线形状漂移 vs 本批回归」，形状漂移按其最终契约回调 pin 或移交该线，不许带着红收工）；
- 涉及录制门闩/假成功类的修复，必须新增性质化断言入 verify-all（新 red→green 证据）；
- **离线 characterization 不得触发真实 DB 查询**（教训：fixture 带真实业务 id 会让新加的 DAO 校验开 knex 池且不退出，verify-all 挂死而非红）——给服务函数加真实 DAO 调用时必须同步提供可注入桩参数（如 `functionIdExists`），characterization 传 `async () => true/false`。

### 第七步：收工回报

在 agent-log 顶部插入收工条目回链开工条目：发现数（按严重度）/ 已修复清单（含 commit hash）/ P2 移交清单 / 回归验证证据 / 零发现族清单。commit message 注明是否携带他线条目。若本轮有修复，收工条目须写明每条 P0/P1 的「防再犯护栏」落点（pin 文件或 smoke 名称），供下轮审查复查。

---
