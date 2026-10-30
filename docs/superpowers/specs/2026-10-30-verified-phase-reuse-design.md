# 已验证阶段的确定性复用 v1（导航与查询阶段）

> **状态**：草案，待用户审阅。依据快照 `uara_V2.0_dev@6d2c770d`（2026-09-24）。部署版已把 `record/start` 改为 202 异步、守卫链收敛为四道门，所以实现前必须按 §15 在 js-project `V2.0_dev` 复核插入点，再写实现计划。
> **用途**：AI 录制时，「跨菜单导航」阶段和「查询并打开记录」阶段先确定性执行。成功则这一阶段不调用模型；失败则把已执行的步骤落库，现场交回模型继续。
> **上游**：[`../reports/2026-10-30-tech-director-direction-review.md`](../reports/2026-10-30-tech-director-direction-review.md) 第五节 R1。评测口径见 [`2026-10-30-bench-decision-loop-design.md`](2026-10-30-bench-decision-loop-design.md)。

## 1. 结论

- 沿用登录回放已经跑通的路径：查找 → 绑定参数 → `runReplayActions` → 判定 → 写阶段结果（`src/services/trajectory/trajectory-record-lifecycle.js:363-409`）。不新增执行通道。
- 两类阶段，两种来源：
  - **跨菜单导航**（合约 `mode=navigate`）：把目标菜单解析到系统树的功能节点，用节点上已扫描的菜单 xpath 生成动作（`buildMenuNavActions`，`src/services/trajectory/menu-navigation.js:28`）。不需要组件。
  - **查询并打开记录**（合约 `mode=query`）：只用人工确认过、并且开启了复用的组件（`operation_component`）。草稿一律不参与，包括语料来源的草稿。
- 导航动作与组件步骤都不得包含写库动作。组件开启复用时校验一次，每次执行前再校验一次。
- 与登录回放不同，这里执行过的步骤**要落库**，成为本轨迹的步骤。否则以后回放这条轨迹会缺步。阶段完全由组件完成时，写 `trajectory_phase.component_id`。
- 开关 `PHASE_REUSE_MODE=off|shadow|on`，默认 `off`。`shadow` 只记录「会不会命中、命中谁」，不执行。

## 2. 范围

**本文交付（实现时）：**

- 纯函数：阶段 → 复用类别；导航目标解析；组件候选打分；参数绑定；写动作校验；后置条件判定
- 录制 runner 阶段入口的复用分支（含 shadow），以及与落库、阶段收尾的接线
- `operation_component` 增加复用相关列；新表 `operation_component_use`；启用 `trajectory_phase.component_id`
- 组件接口：开启或关闭复用（含校验）、参数建议、试跑（在指定会话执行，不落库）、统计
- 执行端动作 `probe_postconditions`（后置条件探针）
- characterization：上述纯函数与 use 记录状态机，登记进 `scripts/refactor/verify-all.sh`

**不在本文：**

- 创建、修改、引入（`create` / `modify` / `introduce_pick`）阶段的复用：需要参数化测试数据（报告 D3）
- 控件级多步技能（报告 D4）
- 召回提示、流程卡写回、自动挖掘与自动确认
- 录后自动回放验证（报告 R2，另稿；可复用本文的阶段类别与写动作校验）
- 前端组件管理界面的交互细节（本文只给接口）

## 3. 三种做法

| 做法 | 结果 |
|---|---|
| 召回已确认组件，只把步骤写进提示 | 模型仍逐步决策，单步成本不降；KB A/B 已显示文本提示的边际很小 |
| 整条历史交易换参数后回放（克隆交易） | 写阶段撞唯一键；阶段之间状态耦合，失败后无法接回 |
| **阶段入口先确定性执行，失败交回模型（采用）** | 只在阶段边界改动；失败有明确的接回点；与登录回放同构 |

## 4. 复用类别与安全边界

### 4.1 阶段到类别

| 阶段合约 `mode` | 附加条件 | 复用类别 |
|---|---|---|
| `navigate` | `isNavigateOnlyPhase(phase)` 为真（`src/services/trajectory/trajectory-recording-runner.js:67-75`） | `nav` |
| `query` | 阶段描述不含查询阶段写动词（见下） | `query_open` |
| 其余 | — | 不复用 |

查询阶段写动词单独成表，不能沿用 `NAVIGATE_ONLY_WRITE_VERBS`（`trajectory-recording-runner.js:54`）：那张表含「填写、输入、勾选」，查询阶段的描述几乎都会写「输入客户名称并查询」，沿用会把查询阶段全部排除。建议的查询阶段写动词：保存、提交、上传、新增、编辑、修改、删除、启用、停用、导入、确定、审批、发起、签订。「编辑、修改」在表内，与 §14 第 3 条的保守口径一致。

合约缺失（旧数据、未签合约）时不复用。判定拿不准就不复用：误放行的代价（走到错误页面、写错数据）远高于漏放行（退回模型，与现状相同）。

### 4.2 `nav`：导航目标解析

目标菜单路径按以下顺序取第一个可用来源：

1. 阶段合约里显式的目标菜单字段（如果 js-project 的结构化合约已带此字段）
2. 阶段描述里的「段/段/段」菜单路径，例如【对公客户管理/客户查询】，用 `resolveMenuPath` 解析（`src/services/menu-path-matcher.js:39`）
3. 本轨迹 `kbFlowRef` 对应卡的 `menu_path`，仅当阶段描述包含该路径末段名称时使用

解析结果必须同时满足：`matchStatus='matched'`、不是 `ambiguous`、节点是功能节点（`type=3`；`resolveMenuPath` 允许停在模块层，模块层不算）、节点带 `menuXpath`。否则不复用。

目标就是本轨迹自己的功能节点、并且 prepare 已经导航到该页（`runtime._lastMenuNavKey` 相同）时，记 `skipped:same_menu`，阶段按现有的仅导航零步豁免处理。

### 4.3 `query_open`：组件候选与打分

候选条件：`status='confirmed'`、`reuse_enabled=1`、`reuse_scope='query_open'`、`system_id` 等于本轨迹系统、未挂起。

| 项 | 分值 | 说明 |
|---|---|---|
| 页面键一致 | 0.5 | 组件 `applicability_json.pageKey` 等于阶段开始时的页面键 |
| 功能节点一致 | 0.3 | 组件 `applicability_json.functionId` 等于本轨迹的功能节点，或等于前一个 `nav` 阶段解析出的节点 |
| 描述关键词重合 | 0–0.2 | 组件 `applicability_json.keywords` 在阶段描述中出现的比例 × 0.2 |

先按「全部必填参数可绑定」（§6）过滤候选，再在剩下的候选里打分。命中需要同时满足：最高分 ≥ 0.8；比第二名（同样可绑定的候选）高 ≥ 0.15。不满足记 `skipped:<原因>`。

页面键取阶段开始时执行端上报的当前页面键（快照中录制端已有 `phase_state_key` 事件，`trajectory-recording-runner.js:838`；字段在 §15 复核）。拿不到页面键时该项记 0 分，最高只能到 0.5，不会命中。

### 4.4 写动作校验

`nav` 与 `query_open` 都要过。命中任何一条即拒绝：

| 校验项 | 规则 |
|---|---|
| 动作类型白名单 | 只允许 `go_to_url`、`wait_for_loading`、`click_menu_xpath`、`click_menu_item`、`fill_form_field`、`select_option`、`select_tree_option`、`click_button`、`click_table_row_button`、`click_element_by_index`、`probe_postconditions`。其余一律拒绝，包括 `click_save`、`run_form_assistant`、`introduce_*`、`login`、`close_dialog` |
| 按钮与行动作文案 | `click_button` 只允许 查询、搜索、重置、刷新、上一页、下一页、跳转；`click_table_row_button` 只允许 查看、详情（「修改、编辑」见 §14 第 3 条）；`click_element_by_index` 的文本参数套用前两条白名单，文本不在白名单内的只允许作用于菜单项或页签（快照 `elementJson` 能确定时） |
| 文案黑名单（兜底） | 任何动作的文本参数含 保存、提交、删除、审批、通过、退回、发起、签订、生效、作废、注销、启用、禁用、确认提交，即拒绝 |
| 填写范围 | `fill_form_field`、`select_option`、`select_tree_option` 只允许作用于查询区：依据组件快照 `elementJson` 的区域标识（`region_id` 与已有的分区结果）能确定在查询区才放行，拿不准就拒绝 |

校验时点：组件开启复用时（不通过返回 409 并列出命中项）；每次执行前（防止快照被改）；`nav` 生成动作之后。

### 4.5 不复用的情形

开关为 `off`；系统不在允许列表；阶段类别为空；候选为空或分差不够；必填参数缺失；写动作校验失败；组件已挂起；本轨迹已有用户停止请求；执行端会话忙。每种情形都记入 use 表（`outcome=skipped` + 原因）。

## 5. 数据模型

### 5.1 `operation_component` 增加列

| 列 | 类型 | 说明 |
|---|---|---|
| `reuse_scope` | enum(`none`, `query_open`)，默认 `none` | v1 只有一类；`nav` 不用组件 |
| `reuse_enabled` | tinyint(1)，默认 0 | 人工开启；开启时跑 §4.4 校验 |
| `applicability_json` | json，可空 | `{ pageKey?, functionId?, keywords?: string[] }` |
| `postcondition_json` | json，可空 | 后置条件数组，见 §7.3 |
| `reuse_suspended_reason` | varchar(64)，可空 | `consecutive_fail` / `menu_changed` / `manual` |
| `reuse_ok_count`、`reuse_fail_count`、`reuse_consecutive_fail` | int unsigned，默认 0 | 统计与自动挂起 |
| `last_reused_at` | datetime(3)，可空 | |

`param_schema` 从「参数化预留」转为启用，形状见 §6。

语料来源的组件与录制挖掘的组件同等对待：只要人工确认并开启复用，就可以参与。

### 5.2 新表 `operation_component_use`

| 列 | 说明 |
|---|---|
| `id` | 主键 |
| `trajectory_id`、`trajectory_phase_id`、`run_id` | 归属；`run_id` 与录制 runId 一致 |
| `scope` | `nav` / `query_open` |
| `component_id` | `nav` 为空 |
| `mode` | `shadow` / `on` |
| `outcome` | `would_hit` / `ok` / `fallback` / `skipped` |
| `skip_reason` | `outcome=skipped` 时必填 |
| `score`、`runner_up_score` | 打分结果 |
| `bound_params_json` | 绑定后的参数；敏感键按语料规格的剔除规则处理 |
| `actions_json` | 实际下发的动作清单（审计写动作） |
| `failed_step_index`、`failure_text` | `outcome=fallback` 时记录 |
| `duration_ms` | 执行耗时 |
| `created_at` | |

索引：`(component_id, created_at)`、`(trajectory_id)`。保留期跟随 `memory_event` 的保留策略（报告 P2）；策略定下之前不清理。

### 5.3 `trajectory_phase.component_id`

只有 `outcome=ok` 时写入。`fallback` 不写，因为阶段由组件与模型共同完成。`nav` 没有组件，不写。

## 6. 参数绑定

`param_schema` 形状：

```json
[
  { "name": "customerName", "required": true,
    "source": { "type": "business_data", "key": "客户名称" } },
  { "name": "certNo", "required": false,
    "source": { "type": "phase_text", "pattern": "证件号码[:：]\\s*(\\S+)" } }
]
```

- `steps_json` 里的参数位写成 `{{customerName}}`。替换沿用认证组件的深度替换（`src/services/operation-component-service.js:587-598`），区别只是占位符由两个固定名改为按 `param_schema` 生成。
- `business_data` 来自 `prepareRecordingBusinessContext`（`trajectory-recording-runner.js:884`）；`phase_text` 在阶段描述上做正则匹配。
- 必填参数缺一个就不命中。可选参数缺失时，删除只引用该参数的 `fill_form_field` / `select_option` / `select_tree_option` 步骤；其他步骤也引用了它，则不命中。
- 参数建议接口：把来源轨迹查询区里、与该轨迹业务数据值相同的填写值替换为占位符，返回给人工确认，确认后才写入。

## 7. 执行、落库与判定

### 7.1 插入点

录制 runner 的阶段循环里（`trajectory-recording-runner.js:1074-1130`），快照中的顺序是：阶段置为 running → 启动空闲看门狗 → 创建本 run 的 `phase_done` / `phase_error` 等待 → 构造 `stepData` → 下发执行端。`tryPhaseReuse` 插在「启动看门狗」之后、「创建等待」之前：

```js
const reuse = await tryPhaseReuse({ runtime, tid, phase, systemId, functionId, bizCtx, runId: myRunId });
if (reuse.kind === 'ok') {
  clearPhaseActivity();                       // 清掉本阶段看门狗
  await appendPhaseDoneLog(phase.id, { text: reuse.doneText, source: 'gate' });
  await recordPhaseResult(phase, { success: true });
  continue;                                   // 不创建等待，不下发 stepData
}
const reuseContext = reuse.kind === 'fallback' ? reuse.contextForAgent : null;
// …照常创建等待、构造 stepData；reuseContext 非空时写入 stepData.reuse_context
```

放在创建等待之前，是为了让成功路径不留下没人消费的事件监听。复用说明直接以 `source='gate'` 写 doneLog，不经 `recordPhaseResult` 的 `text`：后者会把 `text` 记成 `source='agent'`（`trajectory-recording-runner.js:987-990`），复用说明不应冒充模型自述。`shadow` 下的 `would_hit` 与其余情形照常交给模型。上面是示意，实际的变量名与返回形态在实现计划里按 js-project 现行代码确定。

### 7.2 执行

- `nav`：`buildMenuNavActions` 生成动作，前面加 `wait_for_loading`，末尾加 `probe_postconditions`。
- `query_open`：绑定参数后的组件步骤，末尾加 `probe_postconditions`。
- 一律经 `runReplayActions`，`stopOnFail: true`、`abortOnSessionTerminal: true`。超时取 `REPLAY_NAV_TIMEOUT_MS` 与按步数估算值中的较大者。
- **字段缺席不算成功。** 回放把 `label-not-found` 当作「级联字段缺席、跳过成功」（`scripts/controller/actions/_replay.py:315-343`）。复用时这会让查询条件没填也算成功，所以复用执行收到任何缺席结果都按失败处理。实现方式（执行参数里加严格标志，或在控制面检查结果文本）在实现计划里定。
- 执行期间与登录回放一样：会话 `busy` 置位，执行端的步骤同步不落库（`runtime.suppressStepPersist`）。执行结束后由控制面按动作清单落库（§7.4）。用户停止经现有 `cancel_step` 生效。
- 复位标志时不得释放 AI 录制锁：录制中 `runtime.aiRecording` 为真，复位后 `session.busy` 仍须为真。登录回放的 finally 段就是这样处理的，原因见其注释（`trajectory-record-lifecycle.js:434-445`）。

### 7.3 后置条件

`probe_postconditions` 在页面上逐条判定，全部满足才算成功：

| 类型 | 判定 |
|---|---|
| `page_key` | 当前页面键等于给定值 |
| `url_contains` | 当前 URL 含给定片段 |
| `visible_text` | 可见区域（优先顶层弹窗或抽屉）含给定文本，文本可引用参数 |
| `table_has_row` | 可见表格中存在含给定文本的行，文本可引用参数 |
| `no_error_notice` | 没有新的错误通知或表单校验红字 |
| `overlay_closed` | 没有可见的弹窗或抽屉 |

- `nav` 的默认后置条件：`no_error_notice`，加上目标功能节点的页面键（系统树有页面键时）或节点名称的 `visible_text`。
- `query_open` 的后置条件来自组件 `postcondition_json`。开启复用时必须至少有一条引用参数值的 `table_has_row` 或 `visible_text`，防止打开了错误记录的详情。
- 新探针尽量组合 `scripts/controller/actions/js_snippets/` 里已有的错误读取与页面状态片段，不另起一套。

### 7.4 落库

- 执行结束、标志复位之后，把每个成功的动作合成为一条 action_log 条目（`id` 用 `reuse-<runId>-<阶段号>-<序号>`；`action`、绑定后的 `params`；`element` 取组件快照，`nav` 用系统树节点的菜单 xpath 构造；`source='agent'`），整批交给录制 runner 现有的 `handleActionLogSync`（`trajectory-recording-runner.js:618-763`）。`probe_postconditions` 与 `wait_for_loading` 不合成。
- 必须走 `handleActionLogSync`，不能直接调用 `createTrajectoryStep`。录制期的落库不只是插一行：它要校验本 run 仍持有运行时（`runStillOwnsRuntime`），更新控制面的 action_log 副本（前端展示与门闩读它），从内存计数器 `runtime._nextStepNumber` 取步号，累加零步门依赖的 `runtime.phaseStepCounts`，按动作 id 绑定待落的逐步截图，并广播 `action_persisted`。另起一条写入路径会让步号与计数和模型步骤脱节。
- 调用挂在 `runtime._persistDrain` 链上，与之后模型步骤的落库串行。必须串行的原因见 `trajectory-recording-runner.js:850-860` 的注释（#917 同号双行）。合成条目的字段形状按执行端 `ActionEntry`（`scripts/state.py:1006` `_record_action`）对齐，落库函数是 `appendRecordedStep`（`src/services/trajectory/form-snapshot-append.js:34`）。
- 截图：录制会话已开启逐步截图（`trajectory-recording-runner.js:875-881`）。回放路径在录制会话里是否产出逐步截图，要按 §15 复核。如果不产出，至少照常截一张阶段图（阶段收尾已有 `capturePhaseScreenshot`），并和伙伴推送 V3 的使用方确认缺逐步截图可以接受。导出代码对缺图是跳过而不是报错（`src/services/transaction-export-v3-screenshot.js` 中 `resolveScreenshotUrl` 返回 null 时跳过）。
- `step.source` 保持 `agent`，不新增枚举值，避免改动前端与推送契约。复用来源记在 use 表和 `component_id`。是否需要单独的来源值，见 §14 第 2 条。
- `nav` 落库的动作类型（`click_menu_xpath`，或改写成 Agent 录制时会产生的 `click_menu_item`）要保证两件事：`steps/replay` 能回放，伙伴推送的动作映射认识它。按 §15 复核后在实现计划里定。

### 7.5 成功与失败

| 结果 | 条件 | 动作 |
|---|---|---|
| `ok` | 全部动作成功，且后置条件全部满足 | 落库全部动作；doneLog 追加一条 `source='gate'`、以「[复用]」开头的说明；`recordPhaseResult(phase, { success: true })`；`query_open` 写 `component_id`；成功计数 +1，连续失败清零 |
| `fallback` | 某一步失败，或后置条件不满足 | 落库失败前已成功的动作；`stepData.reuse_context` 告诉模型「已执行哪些步骤、哪一步失败、失败原文、当前页面」，模型从当前页面继续完成本阶段；失败计数 +1，连续失败 +1 |

失败时也落库已成功的步骤，是因为这些动作已经改变了页面状态，模型从这里接着做。若不落库，轨迹会少这几步，以后回放会从错误的页面开始。

`reuse_context` 只是追加给模型的说明文字。它不改变阶段合约，也不改变任何门的判定。

### 7.6 与现有门的关系

- 零步门：复用成功的阶段有落库步骤（`nav` 至少 1 步），不会触发零步降级。
- 质量门与成功令牌：`ok` 路径不经过 Python 侧的 done 守卫链。`navigate` 与 `query` 本来就不要求提交令牌（`scripts/controller/actions/phase/reviewer.py:22` `_NO_SUBMIT_TOKEN_MODES`），后置条件就是这一阶段的证据。
- AI 事后核验：照常对整条轨迹执行。核验需要知道哪些阶段由复用完成（doneLog 已写明），按 §15 复核核验输入。

## 8. 接口

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/v2/operation-components/{id}/reuse/enable` | 入参 `reuseScope`、`applicability`、`postconditions`、`paramSchema`；跑 §4.4 校验，不通过返回 409 并列出命中项；要求组件已 `confirmed` |
| POST | `/api/v2/operation-components/{id}/reuse/disable` | 入参 `reason`；写 `reuse_suspended_reason=manual` |
| POST | `/api/v2/operation-components/{id}/reuse/suggest-params` | 按来源轨迹给出参数占位建议，不写库 |
| POST | `/api/v2/operation-components/{id}/reuse/trial` | 入参 `trajectoryId`（提供已 attach 的会话与业务数据）；在该会话执行一次，不落库，返回每步结果与后置条件判定 |
| GET | `/api/v2/operation-components/{id}/reuse/stats` | 命中、成功、失败次数与最近失败原因 |
| GET | `/api/v2/trajectories/{id}/reuse-log` | 本轨迹各阶段的复用决策 |

鉴权跟随 `/api/v2` 的 SSO。前端契约写进 `src/dashboard/api-docs/groups/components.js`。

## 9. 生命周期与自动挂起

```
draft ──人工确认──▶ confirmed ──开启复用（校验通过）──▶ confirmed + reuse_enabled
                                                          │
                  连续失败达阈值 / 菜单变更命中 / 人工关闭  ▼
                                              reuse_enabled=0 + reuse_suspended_reason
```

- 连续失败阈值默认 3（`PHASE_REUSE_SUSPEND_AFTER`）。挂起后不参与匹配，直到人工重新开启；重新开启会再跑一次校验。
- 菜单变更：菜单导入或扫描产生变更流水时，按 `change-impact` 的匹配逻辑找出 `applicability_json.functionId` 受影响的组件，置 `menu_changed`。部署版已有影响反查接口，联动写回在 §15 复核接口形状后实现。
- 改动步骤快照会改变签名，按现有唯一键 `(system_id, signature)` 产生新组件；旧组件置 `deprecated`，复用设置不继承。

## 10. 开关与灰度

| 开关 | 默认 | 说明 |
|---|---|---|
| `PHASE_REUSE_MODE` | `off` | `off` / `shadow` / `on` |
| `PHASE_REUSE_SCOPES` | `nav,query_open` | 可以只开一类 |
| `PHASE_REUSE_SYSTEMS` | 空（=全部系统） | 系统 id 允许列表 |
| `PHASE_REUSE_SUSPEND_AFTER` | 3 | 自动挂起阈值 |

灰度顺序：

1. `shadow` 跑满一个评测周期，并在生产上观察一段时间。得出可命中阶段的占比、候选分布、`skipped` 原因分布。可命中阶段不到全部阶段的约 20% 时，先补组件或调整类别，不进入下一步。
2. 在评测任务集上做 `on` / `off` 配对对照（§11）。
3. 先只开 `nav`，再开 `query_open`；先开一个系统，再全量。

## 11. 度量与验收

全部在评测任务集上配对测量，任务与运行协议见评测设计稿：

| 指标 | 验收线（建议，待裁） |
|---|---|
| 轨迹成功率（L1 口径） | `on` 臂未见劣化（评测设计稿 §7 的定义） |
| 命中阶段的活跃耗时中位 | 比 `off` 臂同一阶段下降 ≥ 50% |
| 命中阶段的模型调用数 | `ok` 路径为 0 |
| `fallback` 占命中的比例 | ≤ 20%；超过时逐条看失败原因，优先修组件或定位 |
| 复用后下一阶段的失败率 | 不高于 `off` 臂（防「后置条件过了但页面状态不对」） |
| 复用执行的写动作数 | 0（审计 `actions_json`） |
| 复用阶段的回放通过率 | 不低于模型录制的同类阶段 |

## 12. 测试

- characterization（离线，登记进 `verify-all.sh`）：
  - 阶段 → 类别映射，表驱动
  - 导航目标解析：matched / ambiguous / possibly-stale / 节点无 xpath
  - 候选打分与分差规则
  - 参数绑定：必填缺失、可选缺失删步、深度替换
  - 写动作校验：每条规则各一个放行、一个拒绝样例
  - use 记录与自动挂起状态机
  - 字段缺席按失败处理
- 行为金样例：固定组件 + 固定业务数据 → 固定动作清单。断言输入输出，不读源码子串。
- 真机：用 `trial` 接口逐个试跑首批组件；评测两臂对照。

## 13. 风险

| 风险 | 对策 |
|---|---|
| 页面漂移后误命中 | 页面键前置、分差规则、后置条件；连续失败自动挂起；菜单变更挂起 |
| 后置条件过了，但页面状态不对（例如打开了别的客户的详情） | `query_open` 后置条件必须引用参数值；评测监控「复用后下一阶段失败率」 |
| 执行了写操作 | §4.4 三个时点的校验；动作清单落库审计；v1 不含任何提交类动作 |
| 复用落库的步骤与模型步骤步号冲突 | 合成条目走同一个 `handleActionLogSync`，并挂在 `_persistDrain` 链上 |
| 复用步骤缺逐步截图，影响伙伴推送 | §7.4 截图处理，并与 V3 使用方确认 |
| 菜单 xpath 过期 | 菜单扫描会更新节点；导航失败进入 `fallback`，不会比现状差 |
| 组件太少，命中率低，投入不成立 | 先用 `shadow` 量化；命中率不够就不开 `on` |

## 14. 待裁问题

1. 验收线（§11）是否采用建议值？
2. `step.source` 保持 `agent`，还是新增 `reuse` 并同步前端与伙伴推送契约（§7.4）？
3. 「修改、编辑」行动作是否允许出现在 `query_open` 组件里？它们只打开编辑页、不提交，但打开后是写阶段的入口。本文 v1 按保守做法只允许 查看、详情。
4. 开启复用的权限：任何已登录用户，还是限定角色（依赖 PR-SSO-ADMIN 的结论）？

## 15. 实现前复核清单（在 js-project `V2.0_dev` 上做）

1. `record/start` 改为 202 异步之后，阶段循环、`recordPhaseResult`、`handleActionLogSync`、`_persistDrain`、`phaseStepCounts` 是否仍是快照中的形态
2. 09-30 收敛为四道门之后，`navigate` / `query` 阶段在 Python 侧的收尾有没有新的要求（复用成功的阶段不经过 Python）
3. 结构化阶段合约（方案 D）是否已落地，合约里有没有目标菜单字段（§4.2 来源 1）
4. 执行端上报当前页面键的事件名与字段（§4.3）
5. 回放路径在录制会话里是否产出逐步截图（§7.4）
6. `nav` 落库的动作类型能否被 `steps/replay` 回放、能否被伙伴推送的动作映射识别（§7.4）
7. AI 事后核验的输入是否包含 doneLog，以便识别复用阶段（§7.6）
8. 语料规格给组件表新增的列（如 `origin`）是否已上线，避免迁移冲突（§5.1）
9. 菜单变更流水的产生点，用于挂起联动（§9）
