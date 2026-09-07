# 夜班长线任务提示词（todo/agent-log 驱动，干到早9点收工回报）

> 用途：**交给闲时任务管线派发执行**——晚间离开前把下方「提示词正文」派发给一个闲时会话，它会自主选线、无人值守推进到次日 09:00 并留收工回报。
> **管线说明（2026-09-08 定）：本任务只走闲时管线，不建 cron 定时任务**（原 automation-99c0d73a 已删，指令全文迁入本文件）。频次与时机由派发方决定。
> 源头：2026-09-07 首建（当晚产出报文捞取 Tasks 7-9）；2026-09-08 迁入闲时管线并补充夜班守则。

---

## 提示词正文（复制以下全部内容作为任务 prompt）

你是 JS-gen 仓库（D:\dev\JS-gen）的夜班长线任务会话，从现在起工作到次日 09:00 左右（约 10 小时）。本次派发执行以下流程：

1. 开场三件事：`git log --oneline -15` + `git status`；读 docs/superpowers/todo-list.md；读 docs/superpowers/agent-log.md 最近几条（含所有在途开工声明和工作区未提交改动的文件集）。

2. 选任务：按 docs/superpowers/todo-list.md 的优先级（当前最高优先通常是「⑤ 引擎主链贯通」），选一条**与你人在场与否无关、可无人值守推进、且文件集与所有在途声明及未提交改动不相交**的任务。若某条线需要真机/服务器操作，先探测环境（控制面 4097 / executor 是否在线、槽位是否被占），被占则换纯代码/文档线。用户已做过的长线任务（如主链能力差盘点）不重复做，从 todo/agent-log 里的最新遗留继续。

3. 按协议写开工条目：在 docs/superpowers/agent-log.md 顶部插入开工条目（时刻+范围+禁入区+方式），并立即 commit。禁入区必须列明当晚发现的他线在途文件。

4. 执行任务，遵循 AGENTS.md 全部约定：JS snippets 唯一源、不手改生成物、JSDoc 规范、refactor gate（bash scripts/refactor/verify-all.sh）、task 单元尽量 commit。可派发子智能体但文件集必须不相交、子智能体不 commit 由主会话验收代提交。

5. 收工（09:00 前）：verify-all 或相应验证跑一遍；在 agent-log.md 顶部插入收工条目（回链开工条目、完成+commit hash+验收证据+遗留移交）；最后在最终消息里写 10 行以内摘要供用户早上 2 分钟读完拍板。

明确不做：不碰他线在途热区；不改服务器配置/不重启服务器进程（除非该晚任务就是运维线且证据充分）；用户已明确不做的项（安全 P1/P2、恢复 save_section 等）不做；#614 法人行社重录等产品裁决项不做。

### 夜班守则补充（2026-09-08 沉淀，执行中随时适用）

- **湿测/API 驱动前必核 4097 进程 StartTime > 最新代码提交**（netstat 取 PID → powershell Get-Process StartTime）；否则先协调重启，防旧实例假服务。
- **活跃多会话期禁用 `git commit --amend`**（09-08 事故：amend 与并行会话提交相撞，混入他线条目）。
- **Git Bash 中文 JSON 一律 `--data-binary @file`**，不内联（内联会变 GBK）。
- **离线 characterization 不得触发真实 DB 查询**：fixture 带真实业务 id 会令新加的 DAO 校验开 knex 池挂死（EXIT=124 假象）——服务函数加 DAO 调用须同步提供可注入桩。
- **verify-all 基线=ALL GREEN（2026-09-08 起）**：出现红先归因「他线形状漂移 vs 本批回归」，形状漂移按其最终契约回调 pin 或移交，不许带红收工。
- **长跑脚本/审批链执行途中用只读 CDP 实时探测页面现场**（formErrors/分区结构/真实 label），不能只事后翻日志。
- **agent-log 提交只带自己的条目**（`git commit -- <file>` 定界），发现他线未提交条目在 message 注明。
