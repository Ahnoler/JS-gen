# 引擎管线缺陷修复批 B-1/B-2/B-3 设计（2026-09-18）

> 产线：引擎管线（worktree `D:\dev\JS-gen-engine`，分支 `engine/pipeline-20260918`，基点 `5956ab7a`）。
> 输入：五轮真机湿测移交报告 B 类（`docs/superpowers/reports/2026-09-18-wet-test-defect-handover.md`，证据在 `D:\dev\JS-gen-contract\tmp\contract-wet*\`）+ 台账挂账专项。四路只读调研已于本会话完成，根因与方案均经 file:line 实证；本文是实施契约。
> 原则：先 RED pin 后最小修复；修复只留根因代码；`bash scripts/refactor/verify-all.sh` 全量基线比对（已知 3 红：step-highlight / layer-tree / confirm-notification，零新增）。
> **不合并 uara_V1.2**——交付分支+验收证据，合并时机待用户拍板（沿用合约线先例）。

---

## 一、B-1（P1）TsscMultiSelect fill/select_option 路由互拒震荡

### 1.1 根因（调研更正了移交报告的一处细节）

对同一控件「是不是 TsscMultiSelect」由两套证据源分别裁定且互不通气：

- **fill 侧拒绝**信任**扫描期**按 label 全局缓存的 `field_kind`（`lookup_field_kind`，`form_scan_utils.py:512-527`，无容器作用域），kind 已是 tssc 时**跳过 live 复核直接拒绝**（`fill_engine.py:179` 短路 → `:219-230` 报 `err-use-tssc-multi-select` 引导去 select_option）。
- **select 侧路由**同样信 store kind（`select_dispatch.py:77-79`，`reason='field_kind'`）直接派 tssc 执行体；执行体用**落点时 live DOM**（`tssc_multi_select.py:87-102` 独立 `findFieldItem` + `.tssc-multi-select` host/vm 复核）否认时返回 `no-tssc-multi-select | ... Use select_option for plain el-select...`（`:100-102`），Python 侧再拼一遍同义句（`select_engine.py:1136-1140`）。
- **报错原文更正**：select 侧并非字面报「请用 fill」，而是自我循环句「Use select_option」；字面「Use fill_form_field」在 `select_tree.py:132-135`（同族）。#864 震荡实录 = `err-use-tssc-multi-select ↔ no-tssc-multi-select` 七步。
- 判定轴不一致三源：时间轴（扫描快照 vs 落点 live）、作用域（label 全局缓存 vs container-first live 解析，「选择客户」弹窗与向导抽屉同名「客户名称」绑定不同 form-item）、解析器（路由探针 `JS_FIELD_ITEM_PICK` vs 执行体独立 `findFieldItem`）。**没有任何 pin 钉住「fill 拒绝与 select 路由对同一控件必须同判」**。
- 调研同时更正移交报告线索：`fill_dispatch.py`/`select_dispatch.py` 只是定位尝试顺序/轻路由，真正的修复落点在 `select_engine.py`（执行体调用与文案）——fill_dispatch.py **不含 tssc 判定，本批不动**。

### 1.2 修法（方案 1，最小，单文件）

`scripts/controller/actions/select_engine.py` 两处：

1. **落穿（`:552-559` 附近）**：`dispatch.path == "tssc"` 分支不再无条件 `return` 执行体结果。当执行体返回 `no-tssc-multi-select`（`startswith` 判定）且 `dispatch.reason in ('target_kind', 'field_kind')`（即 store 缓存路由）时，**落穿到既有 el-select 路径**继续执行；其余情况维持原返回。落穿时 stderr 单行留痕：`[tssc-route-conflict] store kind 与 live 不一致 → fall through el-select label=...`。
2. **文案（`:1136-1140`）**：`no-tssc-multi-select` 前缀返回（非落穿路径，如 reason='live' 时）改为**冲突指引**，消灭自我循环句：说明 kind 缓存与现场不一致、指引先 `scan_form_fields` 刷新、明确「勿回退 fill_form_field、勿同参数重试」；不得把 next_action 指向 fill_form_field。

**为何断环**：震荡需要两侧互拒；select 侧对「路由说 tssc、执行体说不是」自行消化后，agent 视角只剩一条路。落穿后若 el-select 也失败 → 既有诚实失败链（option-not-found 等，`JS_SELECT_OPTION` 无首项兜底伪成功，`:743-752` 守卫）——**宁明确失败**，agent 收到单一明确指引而非回环。真 tssc 字段瞬时查找失败同理：dict 模式可落穿成功、table 模式诚实失败，**不比现状差**。

**明确不做**：方案 2（fill 侧去短路加 live 复核）与方案 3（三判定谓词统一 source of truth + `lookup_field_kind` 容器作用域化）列为后续 hardening，本批不叠加。

### 1.3 Pin 约束（硬）

- 新 pin `scripts/characterization/characterize-tssc-route-conflict.py`，**先 RED**。风格参照 `cold/characterize-select-dispatch.py`：源码 needle（落穿分支：`no-tssc-multi-select` 处理 + `dispatch.reason` 条件 + 冲突指引文案存在；自我循环句「Use select_option for plain el-select, or report」在 `select_engine.py` 侧不存在的断言按 pin 语义登记）+ 若可行加行为冒烟（桩 page.evaluate 返回 `no-tssc-multi-select | ...`，断言不把该错误上抛给 agent）。
- **既有 needle 共存硬约束**：`cold/characterize-tssc-multi-select.py:116-145` 钉死 `async def tssc_multi_select`、`err-use-tssc-multi-select`、`Do NOT fill_form_field`、`return await self.tssc_multi_select(`。实施时先 `grep -rn "no-tssc-multi-select\|tssc_multi_select" scripts/characterization/` 盘点受影响 needle；若落穿重构（改 return 为赋值+条件返回）破坏 `return await self.tssc_multi_select(` needle，**同 commit 修订该 cold pin 并在 commit message 注明理由**（pin 语义=「tssc 分派调用在场」不放松）。

---

## 二、B-2（P2）stepCount 与 trajectory_step 行数口径——只加对账日志，不修逻辑

移交报告明确「先加对账日志确认根因再修」；调研给出三假说（A1 meta 口径混入 15=13+2、A2 removedIds 翻译映射缺失静默漏删、B1 删除重排后 `_nextStepNumber` 不回退产生空号），本批只落日志供下一轮湿测判别。

### 2.1 对账日志（统一 grep 前缀 `[traj-recon]`，全部单行键值对，零行为变更）

- **挂点 1（必做）** `src/services/trajectory/trajectory-recording-runner.js:612`（`if (dbIds.length)` 之前）：对每个 removedId 记 `mappedDbIds` 与 `unmapped=[...]`。unmapped 非空 = A2 实锤（僵尸行直接来源）。
- **挂点 2（必做）** `src/services/trajectory/trajectory-persist-service.js:576`（删除之后）：`remove requested=N deleted=M mismatch=...`。mismatch>0 说明 where 未命中。
- **挂点 3（必做）** `trajectory-recording-runner.js:925`（recordPhaseResult 内 `refreshTrajectoryCounts` 之后）：`rawRows`（count(*)）vs `bizRows`（counts.stepCount）vs `copyBiz`（`countBusinessSteps`）vs `maxStep` + gaps（step_number 序列断裂检测，复用 `listByTrajectory` 排序找断号）。rawRows−bizRows=meta/engineering 行数 → 判 A1；gaps 非空 → 判 B1。
- **挂点 4（必做）** `trajectory-recording-runner.js:1148` 现有 `copy=db` 日志扩字段为 `[traj-recon] finalize traj=... rawRows=... biz=... copy=... maxStep=...`。
- 挂点 5（stop 收口补日志）列可选，不在本批（stop 路径属专项 Step 3 范围，避免动双实现热区）。

### 2.2 Pin 约束

新 pin `scripts/characterization/characterize-traj-recon-logging.mjs`（read_text 风格）：钉 `[traj-recon]` 前缀、四个挂点在场、日志键集合（rawRows/bizRows/copyBiz/maxStep/gaps/unmapped/mismatch）、单行格式（断言 needle 不含跨行拼接）。先 RED 后 GREEN。

### 2.3 假说判定表（写进 spec，供下轮湿测读数）

| 读数 | 判定 | 后续修法（另行报批） |
|---|---|---|
| rawRows−bizRows=常数(=meta 步数)、gaps 空、unmapped 空 | A1 口径现象，非缺陷 | 对账口径文档化，关观察项 |
| unmapped 非空 | A2 映射缺失漏删 | removedId 找不到 dbId 时按 action_id 兜底查 DB 删除 |
| gaps 非空（如 [8]）/ maxStep>rawRows | B1 步号不回退 | 删除分支后 `_nextStepNumber = getMaxStepNumber+1` 回补 |

---

## 三、B-3（P2）executor 同 uuid 僵尸双进程

### 3.1 根因（3048cf4c 已挡主路径，三残留缺口）

启动锁是 **per-检出目录** 的（`executor/config.js:114-116`，锁文件在 `EXECUTOR_DIR` 内）——跨检出/worktree 同 uuid 或锁文件被外删即失守；服务端已会以 close 4001 拒绝重复注册（`src/executor-registry.js:28-46`），但 agent 侧 close handler **不区分 close code 无条件重连**（`executor/ws-client.js:104-114`）→ 被拒进程永生半开重连循环（606277a 移除 `unref` 后进程不再静默自清，长期存活）；且 `executor-ws.js:58-65` 的 DB upsert（置 online）发生在 attach 校验之前 → 被拒注册仍把 DB 刷成假活。

### 3.2 修法（a 补强 + c 自杀 + b 时序，三个子集）

1. **c-1 被拒即退（核心，executor 侧）** `executor/ws-client.js`：close handler 增加 `code===4001` 分支——置 stopping、清看门狗/重连定时器、stderr 单行 `✖ duplicate node uuid — another live executor owns this uuid, exiting`、`process.exit(2)`。
2. **c-2 结构化信号**：`src/executor-registry.js:35-40` 拒绝分支的 `executor.error` payload 附 `code: 'duplicate_node_uuid'`；`ws-client.js:149-151` 识别该 code → 同 c-1 退出（与 close 4001 双保险）。
3. **c-3 401 有限退避**：错 token 是确定性配置错误（upgrade 阶段拒绝，`executor-ws.js:41-44`）。ws 库 error 事件消息含 `Unexpected server response: 401` 时计数，**连续 5 次 → 退出（exit(3)）**，stderr 明示 EXECUTOR_TOKEN 配置错误；网络类错误不计数不退避（保持 606277a 语义：网络问题重连、身份问题退出）。
4. **a 补强（锁跨目录共享）** `executor/config.js:114-116`：锁路径从 `EXECUTOR_DIR` 移到 `os.tmpdir()/js-gen-executor-<uuid前8>.lock`。uuid 不同 → 不同锁（多实例共存不受影响）；uuid 相同 → 跨检出互斥。残余绕过面（多用户 tmpdir 差异、锁被外删）由 c-1 兜底，接受。
5. **b 时序（服务端）** `src/executor-ws.js:58-74`：先 attach 校验、通过后再 DB upsert；被拒（4001）不再把 DB 刷 online。同 pid 半开重连走顶替路径不受影响；旧版 agent（pid==null 不拒）不受影响。

**明确不做**：独占端口 bind 变体（无常驻监听口，徒增暴露面）；「总是踢旧」语义回退（会误顶真进程 → 指令黑洞 + 误清活会话租约，`executor-ws.js:306-320` 注释即历史事故）。

### 3.3 验证

- 新 pin `scripts/characterization/characterize-executor-duplicate-uuid.mjs`（read_text needle）：close 4001 分支 + exit(2)、error code 识别、401 计数退出、锁 tmpdir 路径、registry `duplicate_node_uuid`、ws upsert 顺序。先 RED 后 GREEN。
- 手工双进程冒烟（湿测类，不进 CI）：同机同 uuid 起第二个 executor → 应 exit(2)；控制面 DB 不出现假活行。步骤写入 spec 附录即可，执行待下一轮 wet-test 窗口。

---

## 四、挂账专项：stop 双实现 + 零步门禁三代收敛（本批只交地图，不实施）

调研全文与收敛路线图落盘 `docs/superpowers/reports/2026-09-18-stop-zero-gate-convergence-survey.md`。要点：stop 双实现=lifecycle 路由级联版 vs runner 内 abort 状态机（batch 另有 CAS 变体）；零步门禁 v1 内联/v2 双源/v3 per-run 三代同活在 `trajectory-recording-runner.js`；**stop(success) 通道完全绕过零步门禁是当前最大假成功复活口**。收敛顺序 Step 0（stop 语义 pin）→ Step 1（三代收进单模块）→ Step 2（Python 双零步门）→ Step 3（stop 单点化+门禁覆盖 stop 通道，需湿测）。**本批不实施**，等 B 批合入稳定后另起任务单元。

---

## 五、实施编排与文件集（子智能体互不相交，一律不 commit）

| 子智能体 | 可写集 | 禁入 |
|---|---|---|
| A（B-1） | `scripts/controller/actions/select_engine.py`、新 pin `characterize-tssc-route-conflict.py` | fill_engine.py、fill_dispatch.py、select_dispatch.py、tssc_multi_select.py、其他 pins（如需修订 cold pin 报主线程裁决） |
| B（B-2） | `src/services/trajectory/trajectory-recording-runner.js`、`trajectory-persist-service.js`、新 pin `characterize-traj-recon-logging.mjs` | runner 内 gate/stop 逻辑（只加日志不动行为）、其他文件 |
| C（B-3） | `executor/ws-client.js`、`executor/config.js`、`src/executor-registry.js`、`src/executor-ws.js`、新 pin `characterize-executor-duplicate-uuid.mjs` | 心跳/重连既有语义、executor 其余文件 |
| 主线程 | `scripts/refactor/verify-all.sh`（登记 3 个新 pin）、agent-log、本 spec 修订 | —— |

共享文件裁决规则：cold pin 修订、`select_engine.py` 中既有 needle 冲突，由实施方在报告中标明 → 主线程回收时统一裁决，禁止子智能体静默改 pin。

### 回收验收清单（每子智能体 + 主线程）

1. RED 先行证据（pin 在未修源上跑红）→ 修后 GREEN；
2. `py_compile`（Python 改动）/ `node --check`（JS 改动）；eslint 零新增（jsdoc warning 不回退）；
3. 越界审查：`git diff --stat` 恰为授权文件集；
4. 主线程合并态全量 `verify-all.sh`：与干净基线逐行一致（3 红零新增）+ 3 新 pin 全绿；
5. 全部改动 commit 于 `engine/pipeline-20260918` 并 push 分支；收工条目 commit+push（agent-log 在主检出 uara_V1.2 写）。

## 六、决策点（待用户批准后开工）

1. B-1 采用方案 1（select 侧落穿+文案），方案 2/3 后置 hardening——确认。
2. B-2 本批只加日志不修逻辑（遵移交报告）——确认。
3. B-3 401 处理采用「连续 5 次退出（exit 3）」而非无限重连——确认。
4. 挂账专项本批不实施，只交地图——确认。
