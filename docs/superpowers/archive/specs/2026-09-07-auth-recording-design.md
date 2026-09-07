# 设计 spec：登录/登出自动化录制与原子化组件

- 日期：2026-09-07
- 状态：待用户评审
- 分支：uara_V1.2
- 决策记录（brainstorming 澄清结论）：
  1. 首次录制方式 = **A：agent 自主演练录制**（登录/登出均由 agent 真实探索并录制，非固定配方）。
  2. 运行时语义 = **A：替换 runDefaultLogin**（组件即配置，录制/回放前自动查组件 replay）。
  3. 数据载体 = **A：双载体**（真实轨迹交易，可推伙伴平台 + 注册为 operation_component 供运行时调用）。
  4. 账号 = **单账号**（各角色仅权限不同，登录/登出流程相同；每系统录一套：登录组件 + 登出组件各一）。
  5. 伙伴平台推送 = **不自动**，走既有手动/批量推送链路（产品需求未定自动推送）。

## 1. 背景与目标

当前登录是录制启动前的硬编码准备动作：`src/services/trajectory/trajectory-record-lifecycle.js:238-289` `runDefaultLogin` 读取 `system.url` + `system_account` 账密，硬编码 replay `go_to_url` + `{action:'login'}`，不落步骤表、不算交易；登出能力不存在。组件库 Phase 1（`operation_component`，phase 粒度）挖掘 prompt 明确排除登录（`scripts/prompts/component-mine-prompt.md:17`）。

目标：新增系统后，自动用系统配置的地址与账号，由 agent 自主演练录制**登录、登出两个交易**，沉淀为原子化组件；此后所有系统的登录自动调用组件；两个交易后续可手动推送伙伴平台。

## 2. 总体流程

```
新增系统（含 system.url + system_account 默认账号）
   │
   ├─ 系统创建成功后自动触发一次
   ├─ 系统详情页手动触发/重录按钮
   ▼
auth-recording job（一系统一 job，登录段+登出段串行）
   │
   ├─ 登录段：go_to_url(system.url) → agent 演练：填账号/密码 → 点登录 → 验证登录成功
   └─ 登出段：agent 演练：找登出入口（头像下拉/退出按钮）→ 登出 → 验证回到登录页
   │
   ▼
两条真实 trajectory（auth_kind = login / logout，含完整 trajectory_step）
   │
   ├─ 校验通过 → 各注册一条 operation_component（引用轨迹步骤，component_type=login/logout）
   └─ 校验失败 → job 置 failed + 失败原因；组件不落库；人工重录
   ▼
运行时：录制/回放前需登录 → 查该系统 login 组件 → replay 组件步骤（替代 runDefaultLogin）
```

要点：

- 复用 batch record 的 executor / 浏览器会话链路，不新开录制通道；job 模型参照 `batch_recording_jobs`。
- agent 演练 prompt 新增于 `scripts/prompts/`（登录演练 + 登出演练两份），动作集复用现有 agent 工具（native setter、el-select 等规则天然继承）；引擎无改动。
- **成功判据**（失败即 job failed，不落组件）：
  - 登录段 = 登录后特征达成：URL 离开 `login_url`，或出现登录后首页特征（菜单/工作台元素）。
  - 登出段 = 回到登录页（URL 回到 `login_url` 或出现登录表单特征）。

### 2.1 交易挂载与确认（系统树）

两条产出轨迹必须挂载到该系统名下的固定位置，走既有系统树（`system` 表统一层级：type=1 系统 / 2 模块 / 3 功能，`src/models/hierarchy-constants.js`）与轨迹挂载字段 `trajectory.function_id`：

```
系统（type=1）
  └─ 自动化任务（type=2 模块，固定名）
       └─ 登录与登出（type=3 功能，固定名）
            ├─ 登录交易（trajectory.function_id → 该功能节点）
            └─ 登出交易（同上）
```

- job 开始时确保挂载点存在：按系统查「自动化任务」模块及其下「登录与登出」功能，不存在则创建（幂等，已存在直接复用；不重名不重复建）。
- 交易状态 = **待确认(recorded)**（录制成功 V3 默认态，`trajectory-meta-service.js:429` 既有语义），**不自动确认**；用户在前端查看交易详情后自行人工确认（recorded → completed 既有确认动作）。
- 推送闸门（仅 completed 可推，`export-push-gate.js`）不动：用户确认后交易自然变为可推送，导出页手动勾选推送（见 §6）。

## 3. 数据模型

### 3.1 新表 `auth_recording_jobs`

| 列 | 类型 | 说明 |
|---|---|---|
| id | bigint PK | |
| system_id | bigint, idx | 关联 system |
| account_id | bigint | 使用的 system_account（默认/第一个） |
| status | enum | pending / running / success / failed |
| login_trajectory_id | bigint, null | 登录交易 |
| logout_trajectory_id | bigint, null | 登出交易 |
| error | text, null | 失败摘要（agent 诊断） |
| created_at / updated_at | datetime | |

### 3.2 `operation_component` 扩展

- 加列 `component_type` enum(`normal`,`login`,`logout`) 默认 `normal`；加列 `system_id` bigint null（normal 组件保持 null，不受影响）。
- 唯一约束：`(system_id, component_type)` 仅对 login/logout 生效（应用层保证即可，避免与存量 normal 数据冲突）；重录成功 = 旧组件 deprecate、新组件生效。
- 组件步骤数据引用轨迹步骤（同 Phase 1 既有结构），账密字段标记为运行时注入点（见 §5）。

### 3.3 `trajectory` 扩展

- 加列 `auth_kind` enum(`login`,`logout`) null，NULL = 普通交易。用于推送列表识别/过滤与组件注册回链。

## 4. job 编排（auth-recording-service.js）

1. 触发入口：
   - 自动：系统创建成功（system-mgmt 创建路径）且 `system.url` 与默认账号齐备 → 入队 job。
   - 手动：`POST /api/v2/systems/:id/auth-recording`（重录同入口，需确认覆盖）。
2. 串行执行两段：登录段（go_to_url + agent 演练 + 判据校验）→ 登出段（agent 演练 + 判据校验）。登录失败则登出段不执行（无意义）。
3. 每段产出一条真实 trajectory：**先确保挂载点（§2.1 自动化任务/登录与登出）存在，创建轨迹时 function_id 指向该功能节点**；状态保持待确认(recorded)，不自动确认。
4. 两段通过后注册两条组件、回写 job 成功。
5. 失败：job 置 failed + error；已产生的轨迹保留（供排查，同样挂载在功能节点下），组件不落库。
6. 超时与浏览器崩溃处理沿用 batch record 既有机制；job 支持重试（重录 = 新 job）。

## 5. 运行时：替换 runDefaultLogin

- `trajectory-recording-runner.js` 的登录准备段改为 `runAuthComponentLogin(systemId, account)`：
  1. 查该系统 `component_type=login` 的有效组件；
  2. 命中 → replay 组件步骤（沿用现有 replay_actions 通道），其中账号/密码字段在回放时用 `system_account` **当前值注入**（组件存步骤结构，不存账密快照；改密后组件不作废）；
  3. 未命中 → 回落现有硬编码配方（兼容存量未录制系统），并在响应/日志提示「该系统尚未录制登录组件」。
- 「同账号复用」语义映射为「同系统找同组件」；本设计单账号一套，不按账号区分组件。
- 登出组件本期**只沉淀不接运行时**（当前无自动登出消费方），预留查询接口。

## 6. 伙伴平台推送

- 不自动推送。登录/登出轨迹录制后为**待确认(recorded)**，用户查看后人工确认为已确认(completed)，满足既有闸门（`export-push-gate.js:35`）后在导出页手动勾选/批量推送。
- V3 payload 构建不特殊化（auth 轨迹就是普通轨迹）。
- 推送列表 UI 给 auth_kind 轨迹加类型标识（登录/登出徽标），推送与否由人决定。

## 7. 错误处理与生命周期

- 失败分类：agent 演练超时 / 成功判据不满足 / 浏览器或 executor 异常。均置 failed + error 摘要，一键重录。
- 覆盖保护：重录成功替换组件前，旧组件先 deprecate（保留证据链），不物理删除。
- 系统删除：组件级联 deprecate；轨迹与 job 记录保留。
- 账密变更：组件不自动失效（账密运行时注入）；系统详情页显示「账密已变更，建议重录」提示。

## 8. 改动面清单

| 层 | 改动 |
|---|---|
| 迁移 | 新表 `auth_recording_jobs`；`operation_component` +2 列；`trajectory` +1 列 |
| 服务 | 新增 `src/services/auth-recording-service.js`（job 编排 + 判据校验 + 挂载点 ensure）；`operation-component-service.js` 扩展注册/按系统查询；`trajectory-record-lifecycle.js` / `trajectory-recording-runner.js` 登录准备段改造 |
| 路由 | `POST /api/v2/systems/:id/auth-recording`（触发/重录）、`GET /api/v2/systems/:id/auth-recording`（状态/历史） |
| 前端 dashboard | 系统详情页：触发/重录按钮、job 状态展示、账密变更提示；推送列表 auth 徽标 |
| Python | `scripts/prompts/` 新增登录演练、登出演练两份 prompt；复用现有动作集，无引擎改动 |
| 文档 | `/api/docs` 目录（`src/dashboard/api-docs/`）补新端点说明 |

## 9. 验收标准

1. 新增一个系统（配置真实地址+账密）后自动触发 job，产出登录/登出两条轨迹（步骤齐全）并注册两条组件。
2. 两条轨迹挂在「系统 → 自动化任务 → 登录与登出」功能节点下，状态为待确认；自动挂载节点幂等（job 重跑不重复建节点）。
3. 对该系统再次发起任意录制，登录准备段走组件 replay（日志可见组件调用，非硬编码配方）。
4. 修改账密后不重录组件，录制登录仍成功（运行时注入生效）。
5. 演练失败（如密码错误）→ job failed + 可读 error，组件未落库；重录成功后组件替换。
6. 待确认交易人工确认后，在导出页可见、可手动推送，payload 与普通交易同构。
7. `bash scripts/refactor/verify-all.sh` 无新增红项。

## 10. 明确不做（本期边界）

- 登出组件的运行时自动消费（仅预留查询接口）。
- 多账号/多套登录组件（单账号定案；表结构已留 account_id 可扩展）。
- 伙伴平台自动推送与组件推送通道。
- 组件对其他非登录流程的运行时自动调用（组件库运行时消费本期仅登录）。
