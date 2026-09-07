# 登录/登出自动化录制与原子化组件 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增系统后自动由 agent 自主演练录制登录/登出两个交易（挂系统树「自动化任务/登录与登出」、状态待确认），注册为原子化组件，此后系统登录自动 replay 组件（替换 runDefaultLogin），交易人工确认后可手动推伙伴平台。

**Architecture:** 复用 batch record 的录制链路（`prepareTrajectoryRecording` + `startTrajectoryRecording`），新 `auth-recording-service.js` 编排「登录段→登出段」两段录制；组件存录制步骤快照并在注册时标记账密注入步（`param_schema`），运行时 `runAuthComponentLogin` 优先 replay 组件步骤、回落硬编码配方。spec：`docs/superpowers/specs/2026-09-07-auth-recording-design.md`。

**Tech Stack:** Node.js ESM (Express, knex MySQL), Python agent (scripts/，本计划只加 prompt 不改引擎)。

## Global Constraints

- 单账号：每系统只录一套（登录组件 + 登出组件各一），账号取 system_account 默认/第一个。
- 交易状态：录制成功 = 待确认(recorded)，**不自动确认**；推送走既有闸门（仅 completed 可推）与既有手动/批量推送。
- 组件唯一性：`(system_id, component_type)`，重录成功 = 旧组件 deprecate + 新组件生效，不物理删除。
- 账密运行时注入：组件不存账密快照，注入点在注册时以 step_number 写入 `param_schema`。
- 挂载点幂等：固定名「自动化任务」（type=2）/「登录与登出」（type=3），已存在同名直接复用（用户已认可）。
- 演练失败 → job failed + 可读 error，组件不落库；已产生轨迹保留。
- 硬约束：给函数加 JSDoc 只插入注释，严禁删除/修改已有代码行；新代码 JSDoc 按 `docs/jsdoc-convention.md`，lint 0 新 warning。
- 生成物禁手改：`scripts/controller/actions/js_snippets/_locator_helpers_js.py`。
- 验证基线：`bash scripts/refactor/verify-all.sh`（3 个存量红项非回归；金标准=HEAD worktree 复跑比对）。
- 每任务独立 commit，消息遵循现有 conventional 风格（feat:/feat(kb):/docs: 等）。
- 控制面验证需本地 server 起在 4097（占用则 4098），API 冒烟走 `node scripts/smoke/accept-replay-apis.mjs` 风格临时脚本或 curl。

---

### Task 1: 迁移 — auth_recording_jobs 表 + 两列扩展

**Files:**
- Create: `migrations/20260907000000_auth_recording.js`

**Interfaces:**
- Produces: 表 `auth_recording_jobs`（id, system_id, account_id, status enum(pending/running/success/failed), login_trajectory_id, logout_trajectory_id, error text, created_at, updated_at）；`operation_component.component_type` enum('normal','login','logout') default 'normal'（+ idx (system_id, component_type)）；`trajectory.auth_kind` enum('login','logout') nullable。

注意：`operation_component.system_id` 已存在（NOT NULL，20260806120000 迁移），本任务**不**再加 system_id。

- [ ] **Step 1: 写迁移文件**

```js
/**
 * Auth recording: jobs table + operation_component.component_type + trajectory.auth_kind.
 * Spec: docs/superpowers/specs/2026-09-07-auth-recording-design.md
 */

export async function up(knex) {
  if (!(await knex.schema.hasTable('auth_recording_jobs'))) {
    await knex.schema.createTable('auth_recording_jobs', (t) => {
      t.bigIncrements('id').unsigned().primary();
      t.bigInteger('system_id').unsigned().notNullable().comment('系统节点 → system.id (type=1)');
      t.bigInteger('account_id').unsigned().nullable().comment('system_account.id');
      t.enu('status', ['pending', 'running', 'success', 'failed']).notNullable().defaultTo('pending');
      t.bigInteger('login_trajectory_id').unsigned().nullable();
      t.bigInteger('logout_trajectory_id').unsigned().nullable();
      t.text('error').nullable().comment('失败摘要（agent 诊断）');
      t.datetime('created_at', 3).notNullable().defaultTo(knex.fn.now(3));
      t.datetime('updated_at', 3).notNullable().defaultTo(knex.fn.now(3));
      t.index(['system_id'], 'idx_arj_system');
      t.index(['status'], 'idx_arj_status');
    });
  }
  if (!(await knex.schema.hasColumn('operation_component', 'component_type'))) {
    await knex.schema.alterTable('operation_component', (t) => {
      t.enu('component_type', ['normal', 'login', 'logout']).notNullable().defaultTo('normal');
    });
    await knex.schema.alterTable('operation_component', (t) => {
      t.index(['system_id', 'component_type'], 'idx_oc_system_ctype');
    });
  }
  if (!(await knex.schema.hasColumn('trajectory', 'auth_kind'))) {
    await knex.schema.alterTable('trajectory', (t) => {
      t.enu('auth_kind', ['login', 'logout']).nullable().comment('登录/登出自动录制交易标记，NULL=普通交易');
    });
  }
}

export async function down(knex) {
  if (await knex.schema.hasColumn('trajectory', 'auth_kind')) {
    await knex.schema.alterTable('trajectory', (t) => t.dropColumn('auth_kind'));
  }
  if (await knex.schema.hasColumn('operation_component', 'component_type')) {
    await knex.schema.alterTable('operation_component', (t) => {
      t.dropIndex(['system_id', 'component_type'], 'idx_oc_system_ctype');
      t.dropColumn('component_type');
    });
  }
  if (await knex.schema.hasTable('auth_recording_jobs')) {
    await knex.schema.dropTable('auth_recording_jobs');
  }
}
```

- [ ] **Step 2: 本地跑迁移验证** — 启动 `npm start`（迁移自动执行；若仓库迁移机制为手动，按现有迁移运行方式执行）。验证 SQL：`SHOW COLUMNS FROM operation_component LIKE 'component_type';` `SHOW COLUMNS FROM trajectory LIKE 'auth_kind';` `SHOW TABLES LIKE 'auth_recording_jobs';` 三者非空。
- [ ] **Step 3: Commit** — `git add migrations/20260907000000_auth_recording.js && git commit -m "feat(auth-recording): migration — auth_recording_jobs + component_type + auth_kind"`

---

### Task 2: DAO + 挂载点 ensure（auth-recording-store.js）

**Files:**
- Create: `src/services/auth-recording/auth-recording-store.js`（job DAO + 挂载点 ensure，一个文件两种职责都小）

**Interfaces:**
- Consumes: `getDB()` 模式参照 `src/dao/system-account-dao.js`；`hierarchy-tree-query.js` 的树查询；`hierarchy-service.js` create（`createNode`，见 hierarchy-service.js:285 附近 `body.type + parentId + name`）。
- Produces:
  - `createJob({ systemId, accountId }) → { id }`
  - `getJobById(id) → row|null`
  - `latestJobForSystem(systemId) → row|null`
  - `updateJob(id, fields) → void`
  - `ensureMountPoint(systemId) → { functionNodeId }`：在系统节点下找/建「自动化任务」模块与其下「登录与登出」功能，返回功能节点数字 id。

- [ ] **Step 1: 实现 store**。要点代码：

```js
const MOUNT_MODULE_NAME = '自动化任务';
const MOUNT_FUNCTION_NAME = '登录与登出';

/**
 * Find-or-create the fixed mount point under a system:
 * 系统(type=1) → 自动化任务(type=2) → 登录与登出(type=3).
 * @param {number} systemId system tree node id (type=1)
 * @returns {Promise<{ functionNodeId: number }>} function node id for trajectory.function_id
 */
export async function ensureMountPoint(systemId) {
  const children = await hierarchyTreeQuery.listChildren(Number(systemId)); // 按 name 查 type=2
  let mod = children.find((n) => Number(n.type) === 2 && n.name === MOUNT_MODULE_NAME);
  if (!mod) mod = await hierarchyService.createNode({ parentId: Number(systemId), type: 2, name: MOUNT_MODULE_NAME });
  const subs = await hierarchyTreeQuery.listChildren(Number(mod.id));
  let fn = subs.find((n) => Number(n.type) === 3 && n.name === MOUNT_FUNCTION_NAME);
  if (!fn) fn = await hierarchyService.createNode({ parentId: Number(mod.id), type: 3, name: MOUNT_FUNCTION_NAME });
  return { functionNodeId: Number(fn.id) };
}
```

（`createNode`/`listChildren` 以实际导出签名为准做适配——开工前先 Read `src/services/hierarchy-service.js` 的 create 导出名与 `hierarchy-tree-query.js` 的子节点查询函数，只调用不改。）

- [ ] **Step 2: 语法与 lint** — `node --check src/services/auth-recording/auth-recording-store.js && npx eslint src/services/auth-recording/`，0 error 0 warning。
- [ ] **Step 3: 真库冒烟** — 写临时脚本 `tmp/auth-store-smoke.mjs`：连本地库对一个测试系统 id 调 `ensureMountPoint` 两次，断言两次返回同一 functionNodeId 且树上无重复节点；`createJob/getJobById/updateJob` 读写一圈。跑完删除脚本。
- [ ] **Step 4: Commit** — `feat(auth-recording): store — job DAO + mount point ensure`

---

### Task 3: 演练 prompt（Python 侧，仅文档/提示词）

**Files:**
- Create: `scripts/prompts/auth-login-prompt.md`
- Create: `scripts/prompts/auth-logout-prompt.md`

**Interfaces:**
- Produces: 两份 prompt 文本，登录版要求「在当前登录页，用页面可见表单完成登录（native setter 填账号/密码，点登录按钮），成功后停在首页」；登出版要求「找到登出入口（常见：右上角头像/用户名下拉中的退出项，或独立退出按钮），真实点击登出，回到登录页」。均写明：失败时如实报告，不得伪造成功；不要操作与登录/登出无关的页面元素。参照 `scripts/prompts/agent-tools-common.md` 的动作名书写（fill_form_field/select_option/real_click 等）。

- [ ] **Step 1: 写两份 prompt**（纯 markdown，各 30 行以内；内容按上述要求逐条写成 agent 可执行指令，含「验证码出现时报告失败退出」——本系统验证码不拦截但新系统可能有）。
- [ ] **Step 2: Commit** — `feat(auth-recording): agent prompts for login/logout dry-run`

---

### Task 4: 组件注册 — 步骤快照 + 账密注入点标记

**Files:**
- Modify: `src/services/operation-component-service.js`（新增导出函数，不改既有函数）
- Test: `tmp/auth-component-smoke.mjs`（临时）

**Interfaces:**
- Consumes: Task 1 的 `component_type` 列；`trajectory_step` 读取（`loadPhaseSteps` 同文件已有）。
- Produces:
  - `registerAuthComponent({ systemId, componentType, trajectoryId, accountId, account, password }) → { componentId }`：读轨迹全部步骤（按 step_number 排序），扫描出「值 === account」与「值 === password」的填值步（`action_type` 属填值族、`params_json` 中任一字符串值命中），将 `{ usernameStepNumber, passwordStepNumber }` 写入该组件 `param_schema`；`steps_json` 存步骤快照（param 值中账密原文替换为占位符 `__AUTH_USERNAME__`/`__AUTH_PASSWORD__`）；`component_type` 置 login/logout；同系统同 type 旧组件先 `deprecate`。
  - `findActiveAuthComponent(systemId, componentType) → row|null`（status != 'deprecated' 且 component_type 命中，取最新）。
  - `resolveAuthComponentSteps(component, { account, password }) → actions[]`：将 steps_json 中占位符替换为当前账密，输出 runReplayActions 可用的 `[{ action, params }]`。

- [ ] **Step 1: 实现三个导出函数**（追加到文件末尾，JSDoc 齐全，只加不改）。
- [ ] **Step 2: 冒烟** — 临时脚本：构造两条假步骤（fill username=X / fill password=Y / click），调 registerAuthComponent → findActiveAuthComponent → resolveAuthComponentSteps(account='a2', password='p2')，断言输出步骤值已替换为 a2/p2、库里 steps_json 无明文账密。跑完删脚本。
- [ ] **Step 3: lint + commit** — `feat(auth-recording): component registration with credential injection points`

---

### Task 5: job 编排 — auth-recording-service.js

**Files:**
- Create: `src/services/auth-recording/auth-recording-service.js`
- Modify: `src/services/auth-recording/index.js`（Create，re-export）

**Interfaces:**
- Consumes: Task 2 store、Task 4 注册函数、`trajectory-recording-runner.js` 的 `startTrajectoryRecording(tid, { accountId })`（:259 起签名以实际为准）、`batch-record.js` 的 `prepareTrajectoryRecording(tid)`（:104 用例）、`trajectoryDao` create（function_id + auth_kind 传入，dao 需透传 auth_kind——`toDbRow` 白名单机制，**需在 trajectory-dao.js 的字段映射中加 auth_kind**，作为本任务一小步）、`trajectoryPhaseDao` 建阶段、`trajectory-account-service.js` 的默认账号解析、Task 3 prompt 文本读取。
- Produces:
  - `startAuthRecording(systemId, { accountId } = {}) → { jobId }`：校验 system.url + 默认账号齐备（缺则 400）；建 job(pending→running)；ensureMountPoint；建两条轨迹（登录 traj: function_id=挂载点, auth_kind='login', 单 phase「登录」task=登录 prompt；登出 traj 同理 auth_kind='logout'）。
  - 内部执行器（fire-and-forget，参照 batch-record 的 worker 模式）：登录段 `prepareTrajectoryRecording(loginTid)` → `startTrajectoryRecording(loginTid)` → 等待录制自然结束（轮询 trajectory.record_status 离开 recording，超时 10 分钟）→ 判据校验（登录后 URL ≠ login_url）→ 登出段同理（判据：结束 URL 回登录页）→ 两段过 → registerAuthComponent ×2 → job success。任一段失败：job failed + error，登出段不执行（登录段失败时）。
  - `getAuthRecordingStatus(systemId) → { latest job + 两轨迹摘要 }`。
  - **判据实现**：录制结束后用轨迹 `url` 字段（trajectory 表既有列）+ execSession 当前页 URL 复核；复核函数 `checkLoginCriteria(traj, loginUrl)` / `checkLogoutCriteria(traj, loginUrl)` 为纯函数导出（便于后续测试）。

- [ ] **Step 1: trajectory-dao.js 字段映射加 auth_kind**（一行白名单 + camelCase 映射，插入不改行）。
- [ ] **Step 2: 实现 service**（编排 + 两个纯函数判据 + JSDoc）。轮询等待复用 batch 既有 sleep/lease 风格，不引入新依赖。
- [ ] **Step 3: 语法/lint** — `node --check` + eslint 0/0。
- [ ] **Step 4: 纯函数判据单测**（临时脚本断言：url 含 'login' 判失败/成功各例）。跑完删。
- [ ] **Step 5: Commit** — `feat(auth-recording): job orchestration — two-segment dry-run recording + criteria + component registration`

---

### Task 6: 路由 + 系统创建自动触发

**Files:**
- Create: `src/routes/v2/auth-recording.js`
- Modify: `src/routes/v2/__init__.js`（注册路由，一行）
- Modify: `src/routes/v2/hierarchy.js` 或 `system-mgmt.js`（系统创建成功后 fire-and-forget 调 `startAuthRecording`；定位到 type=1 创建 handler 后追加一行调用，try/catch 包裹不影响创建本身）
- Modify: `src/dashboard/api-docs/catalog.js`（新端点入 API 文档，产品契约）

**Interfaces:**
- Produces:
  - `POST /api/v2/systems/:id/auth-recording`（body 可选 `{ accountId }`；同系统 running/pending job 存在时 409；响应 `{ jobId }`）
  - `GET /api/v2/systems/:id/auth-recording`（最新 job + 状态 + 两轨迹 id/状态 + error）

- [ ] **Step 1: 实现路由文件**（参照 `src/routes/v2/operation-component.js` 的结构/JSDoc/错误码风格）。
- [ ] **Step 2: 系统创建钩子**（一行 fire-and-forget + 注释指回 spec）。
- [ ] **Step 3: api-docs catalog 补两端点**。
- [ ] **Step 4: API 冒烟** — server 起后 `curl -X POST .../systems/<测试系统id>/auth-recording` 返回 jobId；GET 能查到；重复 POST 409。
- [ ] **Step 5: Commit** — `feat(auth-recording): v2 routes + auto-trigger on system create + api-docs`

---

### Task 7: 运行时替换 — runAuthComponentLogin

**Files:**
- Modify: `src/services/trajectory/trajectory-record-lifecycle.js:238-303`（runDefaultLogin 内部改造；保留函数名与调用点签名不变）
- Modify: `src/services/trajectory/trajectory-recording-runner.js:312-321`（无签名变化，仅日志）

**Interfaces:**
- Consumes: Task 4 `findActiveAuthComponent` + `resolveAuthComponentSteps`；既有 `runReplayActions`。
- Produces: `runDefaultLogin(runtime, account, system)` 行为升级：先查 login 组件 → 命中则 replay 组件步骤（前置 `go_to_url` + `wait_for_loading` 保留）→ 失败或无组件回落现有硬编码序列（`{action:'login'}`），console.log 提示「auth component miss → fallback」。`runtime.loginDone/loginAccountId` 语义不变。

- [ ] **Step 1: 改造 runDefaultLogin**（在函数体内加组件分支；不改函数签名与 finally 段；只插入不改行）。
- [ ] **Step 2: 冒烟** — server + executor 起后，对已注册组件的测试系统发起一次普通录制（准备段走组件）；日志确认「component replay」路径；对无组件系统发起录制确认 fallback 路径。
- [ ] **Step 3: 回归** — `bash scripts/refactor/verify-all.sh`（重点 `characterize-login-action.py` 相关与轨迹 characterization），基线比对无新增红。
- [ ] **Step 4: Commit** — `feat(auth-recording): runDefaultLogin consumes login component with hardcoded fallback`

---

### Task 8: 前端 dashboard 最小 UI

**Files:**
- Modify: 系统详情相关 dashboard 组件（开工前 grep `src/dashboard/` 定位系统详情页文件；范围：触发/重录按钮 + job 状态 + 账密变更提示）
- Modify: 导出/推送列表组件（auth_kind 徽标：登录/登出 tag）

- [ ] **Step 1: 定位文件**（`grep -rn "系统详情\|system-detail\|accounts" src/dashboard/ --include=*.js -l`），在系统详情页加「录制登录/登出」按钮：POST 触发 + 轮询 GET 状态展示（pending/running/success/failed + error）；账密与最近成功 job 时间不一致时显示「账密已变更，建议重录」。
- [ ] **Step 2: 推送列表徽标**（auth_kind → tag「登录」/「登出」）。
- [ ] **Step 3: 浏览器手工验证**（内置 Playwright MCP，snapshot→click 纪律）：按钮触发、状态流转展示、徽标显示。
- [ ] **Step 4: Commit** — `feat(auth-recording): dashboard — trigger/status UI + auth trade badge`

---

### Task 9: 收尾验证与交接

**Files:**
- Modify: `docs/superpowers/agent-log.md`（收工条目）
- Modify: `docs/superpowers/todo-list.md`（工作线登记，如适用）

- [ ] **Step 1: 全量回归** — `bash scripts/refactor/verify-all.sh`，与 HEAD 基线比对无新增红；`npm run lint` 0 新 warning。
- [ ] **Step 2: 端到端湿测** — 本地新建测试系统（真实 SUT 地址+账密）→ 自动触发 → 验证 spec 验收标准 1-6 逐条打勾（两轨迹挂载/待确认/组件注册/运行时组件登录/账密注入/确认后可推）。
- [ ] **Step 3: agent-log 收工条目**（含 commit hash 清单 + 验收证据 + 遗留）并 commit。

---

## Self-Review 记录

- Spec coverage：§2 流程→T5/T6；§2.1 挂载与确认→T2/T5/T8（不自动确认=无额外代码，状态机天然满足）；§3 数据模型→T1/T4；§4 编排→T5；§5 运行时→T7；§6 推送→T8 徽标+零改动复用；§7 错误处理→T5/T8；§9 验收→T9 湿测清单。无缺口。
- 类型一致性：`registerAuthComponent/findActiveAuthComponent/resolveAuthComponentSteps/ensureMountPoint/startAuthRecording/getAuthRecordingStatus` 各任务间命名一致。
- 占位扫描：T2/T8 存在「以实际签名为准适配」点，已写明开工前先 Read 的定位指令，非 TBD。
