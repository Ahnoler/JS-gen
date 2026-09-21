# 引擎管线会话交接文档（2026-09-18 晚）

> 交接人：ZCode 引擎管线会话（2026-09-18 下午场）。接收人：下一引擎线会话。
> 触发：用户指示「本对话专用于引擎管线开发，引擎管线以后所有修改另起工作树进行」并准备将会话移交。
> **本单元未收工——处于「spec 完成、四决策点待用户批准、实施未开始」的中断态**，开工声明见主检出 agent-log `2026-09-18 16:23` 条目（commit `c2cd58be`），本条目由接收会话闭环收工条目。

## 一、一句话状态

B-1/B-2/B-3 三缺陷（五轮湿测移交）已完成四路只读调研 + 设计 spec + 评审对照 + 证据补采，全部落在分支 `engine/pipeline-20260918`（已推送）；**卡在 spec §六 四个决策点等用户批准，批准后按 §五 编排派 3 个实施子智能体即可开工**。

## 二、工作环境（接收会话照此续用）

- **worktree**：`D:\dev\JS-gen-engine`，分支 **`engine/pipeline-20260918`**，基点 `5956ab7a`（=origin/uara_V1.2），已推送远端。提交链：`32a73fc2`（spec+专项地图）→ `e52f8ab0`（评审对照 §七）→ `b9f40e51`（§六证据注记）。
- **环境落地已做**：`node_modules`/`python` 为指向主检出的 junction（`mklink /J`）；`config/.env`+`executor/.env` 已复制；`tmp/` 已建。若 worktree 丢失重建：worktree add 新目录 → 上述 junction + env 复制重做（配方见 [[deadcode-cleanup-20260908]] 记忆，junction 复制 .env 两步即可）。
- **解释器**：Python 一律 `./python/python.exe`（junction 至主检出便携版）；ruff 在主机 PATH。
- **只读 DB 取证脚本**：`tmp/recon-evidence-859.mjs`（node 直跑，凭据读 config/.env；traj 859/858 步行查询）。重跑无害（纯 SELECT）。
- **服务状态**：控制面 4097 + 执行机 LMY 正从**合约 worktree `D:\dev\JS-gen-contract`**（分支 `fix/phase-contract-20260918`）运行——**本线禁入不重启**（见 §五）。

## 三、四路调研结论（全文在 spec 与专项地图）

| 缺陷 | 根因结论（证据齐备） | 修法（spec 节） |
|---|---|---|
| B-1（P1）tssc 路由互拒 | fill 侧信扫描期 store kind（`fill_engine.py:179` 短路直接拒）↔ select 执行体 live 复核否认（`tssc_multi_select.py:100-102`），报错互指成 7 步环（#864 实录 `tmp/executor-main.log` L829-865）；**落点是 `select_engine.py`，`fill_dispatch.py` 不含 tssc 判定**（移交报告线索有误，已更正） | §一：select 侧对「store 说 tssc/live 说不是」落穿既有 el-select 路径 + 消灭自我循环文案；方案 2/3 后置 |
| B-2（P2）步数对账 | **翻案：#859「15 行 vs stepCount 13」非缺陷**（DB 实测=13 业务步+2 条 save_form_snapshot meta 步，分毫不差）；**真缺陷只有 #858 空号 #8**（DB 序列 #1-#7→#9#10，假说 B1「删除重排后 `_nextStepNumber` 不回退」实锤，瞬态可自愈） | §二：遵移交报告只加 `[traj-recon]` 四挂点对账日志；修法（步号回补）待下轮读数 |
| B-3（P2）双进程 | 3048cf4c 已挡主路径；残留=被拒 agent 不自杀（`ws-client.js:104-114` close 不分 code 无限重连）+ DB upsert 先于 attach 校验（被拒仍刷 online，`executor-ws.js:58-66`）+ 锁仅在检出目录内（`config.js:114-116`） | §三：4001 即退出（exit 2）+ 401 连续 5 次退出（exit 3）+ 锁移 tmpdir 共享 + attach 校验前置 |
| 挂账专项 | stop 双实现 + 零步门禁三代收敛地图成文，**最大假成功复活口=stop(success) 绕过全部零步门禁**（file:line 实证） | 报告 `2026-09-18-stop-zero-gate-convergence-survey.md`；**本批不实施** |

## 四、待用户批准的四决策点（spec §六，含证据注记）

1. B-1 取方案 1（落穿+文案），方案 2/3 后置 hardening；
2. B-2 本批只加日志不修逻辑（DB 证据已把 15v13 判为口径非缺陷）；
3. B-3 的 401 采用连续 5 次退出而非无限重连；
4. 挂账专项只交地图不实施。

**记忆勘误已落**：`server-deployment-mysql57.md` 中「401 后重试一次即退出」系 606277a 前 unref 时代形态，现码为无限重连循环——下一会话勿被旧结论误导。

## 五、批准后执行剧本（spec §五为准，此处摘要）

- 3 个实施子智能体文件集**互不相交**：A=`select_engine.py`+新 pin（B-1）；B=`trajectory-recording-runner.js`+`trajectory-persist-service.js`+新 pin（B-2，只加日志）；C=`executor/ws-client.js`+`executor/config.js`+`src/executor-registry.js`+`src/executor-ws.js`+新 pin（B-3）。一律不 commit，主线程回收。
- 主线程：登记 3 个新 pin 入 `scripts/refactor/verify-all.sh`（在**引擎 worktree 内**改+提交）；RED 先行→GREEN→`py_compile`/`node --check`→越界审查（`git diff --stat` 恰为授权文件）→全量 verify-all（3 红基线零新增：step-highlight/layer-tree/confirm-notification）。
- **Pin 硬约束**：B-1 实施前先 grep 盘点 cold pin needle（`cold/characterize-tssc-multi-select.py:116-145` 钉死 `return await self.tssc_multi_select(` 等，重构破坏 needle 须同 commit 修订并在 message 注明）。
- 收尾：引擎分支 commit+push；**收工条目写在主检出 agent-log（uara_V1.2）并 commit+push**；合并回 uara_V1.2 **待用户拍板**（合约线先例：交付分支+验收+「未合并待批」）。

## 六、禁入区与红线

1. **合约线 worktree `D:\dev\JS-gen-contract` 全部文件 + 分支 `fix/phase-contract-20260918`**——4097+LMY 服务正从该 worktree 运行，不重启不触碰；Python 侧改动生效需重启控制面，**重启时机须与用户协调**（他会知会测试重新发版）。
2. 主检出（D:\dev\JS-gen）代码文件——本线一切代码改动只发生在引擎 worktree；主检出只写 agent-log。
3. 他线 WIP：`data/kb/req/product-mgmt/**`、Cursor 证据目录、`scripts/prompts/**`（动作词表冻结，C-3 走提示词 cue 另案）。
4. 运行中录制会话/执行机槽位占用前先查 `/api/v2/executors`；录制中禁止 DB 手术。

## 七、接收会话第一步清单

1. 开场三件事（pull + git log/status + 读 agent-log 最近条目——注意合约线 11:35 条目的遗留移交项）；
2. 读本文档 + spec `specs/2026-09-18-engine-pipeline-b123-fix-design.md`（§六决策点+§七评审对照）；
3. 向用户要 §六 四决策点的批准（或用户直接给新指令）；
4. 批准后按 §五 剧本派工。需深挖本会话过程时，可用 `ReadSessionContext` 引用本会话（sess id 由用户提供）。
