# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

本文件**只从 2026-08-03 开始记**，之前的 24 个迁移（2026-07-13 ~ 2026-08-02）不回填。

## [Unreleased]

### Changed

- 2026-08-27: **动作统一改名：`click_icon_button` → `click_button`**（该工具已拓展为通用"按标签点击按钮"：tooltip 图标优先，miss 直点同标签文字按钮）。控制器注册名、state 录制映射、manual_recorder 发射/映射、script_assembler BOUNDARY、codegen 导出模板（含生成脚本内 CTRL.clickButton 调用点）、browser 服务层（resolve-by-label/dedup/legacy-engine-export/transaction-export-v3）、models/action 三处、CTRL nav.js 方法键与 index.js 文档行、agent prompt 两个文件全量同步；回放兼容：replay_names 新增 `'click_icon_button' → 'click_button'` 与 camelCase 双别名，历史轨迹可正常回放。返回码（err-icon-label-miss/-ambiguous、ok-text）与 JS_CLICK_ICON_BUTTON 常量名不变。前端 vue 仓库 schema value 同步为 click_button 并保留旧值 alias（中文展示「点击按钮」）。
- 2026-08-27: **配置/文档同步移除 ctrl-actions 与 assemble 残留**：`eslint.config.js` 移除 `src/ctrl-actions` ignore 项；`docs/jsdoc-convention.md` 删除 `ctrl-actions` 绕过章节；`AGENTS.md` 与 `README.md` 同步——删 `script_assembler` 命令与 characterization 示例行、改写双语言 CTRL 节为「JS snippets 单一语言面」、组件/服务表删 assemble 相关行、架构图删 assemble 分支、公开端点表删 `/api/test/assemble|run`、JSDoc 绕过列表删 `src/ctrl-actions/**`。
  影响范围：开发工具链 ignore 与文档约定；无 schema/路由/WS/业务逻辑变更。
  文件：`eslint.config.js`, `docs/jsdoc-convention.md`, `AGENTS.md`, `README.md`。

### Removed

- 2026-08-27: **移除 window.CTRL 注入库与 assemble 工程管线**：组装执行脚本职责早已退出产品需求，整体清理历史资产。删除 `src/ctrl-actions/` 目录与 `src/ctrl-actions.js` 桩、`src/services/assemble-service.js`、`src/routes/test-assemble.js` / `test-run.js` / `test-history.js`；`server.mjs` 摘除对应注册、启动日志行及 `/api/test/screenshots` 静态挂载。
  影响范围：HTTP 端点 `/api/test/assemble`、`/api/test/run`、`/api/test/history*` 下线；产品回放不受影响（`replay_actions` / `_replay.py`）。
  文件：`src/ctrl-actions*/`、`src/services/assemble-service.js`、`src/routes/test-{assemble,run,history}.js`、`server.mjs`、`src/runtime/script-runner.js`（瘦身为 characterization 用的 marker/截图工具函数）、`src/script-utils.js`（只留 `extractFlowFromTrajectory`）。
- 2026-08-27: **移除 Python 装配器及其喂料端点**：删除 `scripts/script_assembler.py`、`scripts/codegen/`、孤立死脚本 `scripts/trace_entries.py`；v2 路由删除 `POST /api/v2/trajectories/:id/assemble-file`（未被前端与公开 API catalog 消费）；`src/models/element.js` 删除随之无消费者的 `stepsToActionCommands`（`trajectoryStepToActionEntry` 因被 live 回放/导出复用而保留）。
  影响范围：产品回放零变化。
  文件：`scripts/script_assembler.py`、`scripts/codegen/`、`scripts/trace_entries.py`、`src/routes/v2/trajectory.js`、`src/models/element.js`。
- 2026-08-27: **移除绑定废弃资产的校验与门禁行**：删 `scripts/characterization/` 9 个脚本（ctrl/assembler-click/screenshots/date-fill-merge/icon-codes/select-table-row/select-lazy-load/table-toolbar-pattern/verify-form-structure）与 `scripts/smoke/accept-engineering-apis.mjs`；`verify-all.sh` 同步移除 6 行。
  影响范围：refactor gate 其余项不变。
  文件：`scripts/characterization/`、`scripts/smoke/`、`scripts/refactor/verify-all.sh`。

### Added

- 2026-08-27: **Agent 结果协议四层改造（六动作试点）**：根治"底层动作返回机器状态码、LLM 无法理解导致循环"的设计漏洞（spec：docs/superpowers/specs/2026-08-27-agent-result-protocol-design.md）。① 新模块 `scripts/controller/actions/result_protocol.py`——`err_with()` 三段式信封（`err-<code> | 原因:… | 现场:… | 下一步:…`，兼容 duplicate_failure 的 err- 前缀判定）、`ok_marked()` 诚实成功标注、`validate_protocol()` 校验器、`recommend_action_for_kind()` kind→工具映射、`affordances()` 现场快照助手；② 六动作失败点接入：select_option（err-select-option-unresolved + no-select-found 附 radio 指引）、fill_form_field（field-disabled 转 err-field-disabled 并推荐正确工具）、click_save not-found（close_dialog 指引降级为末选）、click_table_row_button/radio（err-table-row-not-found / err-button-not-found-in-row 结构化现场）、click_icon_button（码转正 err-icon-label-miss/-ambiguous，CTRL nav.js 同步）；③ 防呆前置：ScannedField/TaskItem 新增 `use` 推荐动作字段，扫描写入单点计算、get_pending_tasks/表单助手 LLM prompt/agent-field-rules 四处透传；④ fallback 假成功语义存疑记账 `_semantic_doubts` → 阶段末仅失败语境并入 `semantic_doubt_fields:` 理由（不阻断）；duplicate_failure_cue 处方表登记六个新错误码。新增特征化 characterize-result-protocol/icon-codes/use-field（已注册 verify-all）+ LIVE 冒烟 scripts/smoke/result-protocol-live.py。
  行为变化声明：`field-disabled` 从裸串转为 `err-field-disabled` 后**新进入** duplicate_failure 失败计数与处方注入（本会话曾因其不可见而空转 10+ 步）。
  影响范围：scripts/controller/actions（result_protocol 新模块 + 六动作引擎）、models 两模型加字段、_llm_values/prompt 文档、agent/service.py 阶段末理由、duplicate_failure_cue 处方表、src/ctrl-actions/index.js+nav.js 文档与返回码。存量其余 `_err` 点未动；回放链路兼容（durable xpath → CTRL 回退不变）。
- 2026-08-26: **角色级 LLM 配置统一到 .env**：为全部 LLM 调用角色补独立可配置键，未设置时回落主 LLM（LLM_MODEL/LLM_BASE_URL/LLM_API_KEY）——新增 `REVIEWER_LLM_MODEL/BASE_URL/API_KEY/TIMEOUT_MS`、`SCENARIO_LLM_MODEL/BASE_URL/API_KEY/TIMEOUT_MS`、`FORM_LLM_TIMEOUT_MS`、`L1C_LLM_MODEL`（config.js 导出 + 执行机 spawn 注入 + Python os.getenv 读取）；主/表单/场景三处 ChatOpenAI 补齐 timeout（毫秒配置转秒）；Phase Reviewer 现可独立于主 LLM（`_get_reviewer_llm`，REVIEWER_LLM_* 全空时复用主 LLM）；`.env.example` 同时文档化既有未记录键（AI_PHASE_REVIEWER、AI_PHASE_REVIEWER_TIMEOUT_S、AI_SCENARIO_DESCRIBER、SCENARIO_DESCRIBER_INTERVAL）。
  影响范围：config/.env 配置面（新增角色级键，缺省行为=回落主键，无行为变化）；LLM 超时从「无限等待」变为默认 120s 快速失败（与既 LLM_TIMEOUT_MS 语义一致）。无 schema/路由/WS 变更。
  文件：config/.env.example, config/config.js, src/routes/browser-session/global-browser.js, executor/config.js, executor/session-slot.js, scripts/agent_utils.py, scripts/session_runner.py, scripts/controller/actions/phase/reviewer.py, scripts/agent/service.py, scripts/controller/actions/_llm_values.py, scripts/controller/actions/_scenario_describer.py, scripts/characterization/characterize-llm-role-env.py（新增）

- 2026-08-26: **Reviewer 进度感知缓冲部署**：`compute_budget_extension` 新增可选入参 `total_fields/done_fields`（缺省完全走旧式）——以「已耗步数/已完成字段数」估平均每字段成本，按剩余字段数（max(剩余字段, introduce+pending+tree)）估算剩余步数，取 max(旧成本模型, 估算)（永不低于旧模型防欠分配），仍受 ceiling-used clamp 与空工作短路约束；`service.py` 续跑循环从 task_list 计算并传入 total/done；`characterize-budget-extend.py` 追加 7 条进度感知断言。
  影响范围：budget-exhausted 续跑步数在「已完成字段多、待办也多」时自动加大缓冲；旧调用行为不变。无 schema/路由/WS 变更。
  文件：scripts/controller/actions/phase/reviewer.py, scripts/agent/service.py, scripts/characterization/characterize-budget-extend.py

- 2026-08-24: **LLM 请求超时保护（`LLM_TIMEOUT_MS`）**：新增配置 `LLM_TIMEOUT_MS`（毫秒，默认 120000，`.env` 唯一真源）。此前所有 LLM 调用无超时——网关通道挂起（如 GLM-5 宕机，请求 60s+ 无任何响应）时 agent 每步 LLM 调用无限阻塞，最终以「Phase idle timeout: no agent activity for 10 minutes」这种迟钝方式暴露。现三处生效：① `src/llm-utils.js` `callLLM`（`AbortSignal.timeout`）；② `src/routes/llm-proxy.js` `/v1/chat/completions` 转发（agent 主链路）——超时返回 **504 `upstream_timeout`** 并附排查指引（错误体不再挂起）；③ Python `agent_utils.create_llm` 与 `_llm_values._get_form_llm` 的 `ChatOpenAI(timeout=..., max_retries=1)`（表单 LLM 直连网关场景）。执行机与 global-browser spawn Python 时下发 `LLM_TIMEOUT_MS`。
  影响范围：LLM 调用失败模式从「无限挂起」变为「120s 内快速失败」；超时值经 `.env` 可调。无 schema/WS 变更。
  文件：config/config.js, config/.env, config/.env.example, src/llm-utils.js, src/routes/llm-proxy.js, src/routes/browser-session/global-browser.js, executor/config.js, executor/session-slot.js, scripts/agent_utils.py, scripts/controller/actions/_llm_values.py

- 2026-08-26: **JSDoc 注释规范 + eslint-jsdoc 工具链兜底**：新增 `docs/jsdoc-convention.md`（精简版规范：核心公开函数必须有 JSDoc 含 @param/@returns，私有 helper/回调/一行纯转发可省略；ctrl-actions 字节 pin 区域绕过；不用 @author/@since）；引入 `eslint.config.js`（ESLint v9 flat config + `eslint-plugin-jsdoc`，规则 `require-jsdoc`（publicOnly 仅导出函数）、`require-param`、`require-returns`、`check-param-names`、`check-types`，全部 warn 级别）；`package.json` 新增 `devDependencies`（eslint@^10、eslint-plugin-jsdoc@^64）与 `lint`/`lint:fix` 脚本。ignore 区域：node_modules、nodejs、python（Playwright driver bundle）、src/ctrl-actions（字节 pin）、.superpowers、tmp、scripts/characterization、scripts/smoke。首次 `npm run lint` 0 error / 2431 warning（全部为存量 JSDoc 缺口，预期内）。`verify-all` GREEN。
  影响范围：新增开发工具链（lint 不阻塞 CI，warn 级别）；无 schema/路由/WS 变更；不影响 Python 对齐（仅 JS-gen 侧开发规范）。
  文件：docs/jsdoc-convention.md（新增）, eslint.config.js（新增）, package.json

- 2026-08-26: **审查优化：L1C 模型接入 / reviewer 超时语义 / sanitize 共享函数**（四项任务代码审查产物）：① L1C_LLM_MODEL 死配置修复——region-classify.js 接入（callLLMWithTimeout 透传模型），移除两处 spawn 死注入与 executor 死导出（此前该键无任何消费）；② REVIEWER_LLM_TIMEOUT_MS 语义修正——未设置时不再注入，Python 端超时链改为「显式键 → AI_PHASE_REVIEWER_TIMEOUT_S×1000（评审外层 20s 上限）→ LLM_TIMEOUT_MS」，消除「内层 120s 永不生效」的误导；③ sanitizeTranscationName 抽为共享函数（新文件 src/services/transaction-name.js），V2/V3 导入复用，消除正则三处拷贝。
  影响范围：L1C 开启动可独立配置模型（默认行为不变）；reviewer LLM 超时语义与评审外层时限一致；推送名称净化统一实现。无 schema/路由/WS 变更。
  文件：src/services/region-classify.js, src/services/transaction-name.js（新增）, src/services/transaction-export-v3.js, src/services/transaction-export.js, config/config.js, config/.env.example, src/routes/browser-session/global-browser.js, executor/config.js, executor/session-slot.js, scripts/controller/actions/phase/reviewer.py, scripts/characterization/characterize-llm-role-env.py, scripts/characterization/characterize-transaction-name.mjs（新增）
- 2026-08-26: **JSDoc 规范收尾：migrations 纳入 lint ignore + AGENTS.md 同步 + pre-commit lint 兜底**：① `eslint.config.js` ignore 新增 `migrations/**`（一次性迁移脚本注释价值低，全量 `npm run lint` 降至 0 warning/0 error）；② `AGENTS.md` 新增「JSDoc 注释规范」小节（规范文档指针、lint/lint:fix 工具链、绕过区域 ctrl-actions/migrations/characterization/smoke、加注释只插入不改代码行的硬性约束）；③ 新增 pre-commit 兜底——`scripts/githooks/pre-commit`（POSIX shell：对 staged 的 .js/.mjs/.cjs 跑 `npx eslint`，有 error 阻断提交、仅 warning 放行）+ `package.json` 新增 `prepare` script（`git config core.hooksPath scripts/githooks`，npm install 自动激活）。
  影响范围：开发工具链/文档约定；无 schema/路由/WS/业务逻辑变更；`verify-all` GREEN。
  文件：eslint.config.js, AGENTS.md, package.json, scripts/githooks/pre-commit（新增）

- 2026-08-26: **JSDoc 存量缺口批量补全（2431 warning → 0）**：按 `docs/jsdoc-convention.md` 规范，对 `src/` 下全部存量 JSDoc 缺口补全——每个导出函数补 `@param {Type}`/`@returns {Type}`（含对象解构逐字段、`Promise<{...}>`、默认值从 @param 移入代码签名）、补文件头、修 `{Object}`→`{object}`（check-types）、描述与 @param 空行（tag-lines）、`Function`→具体函数类型（reject-function-type）、`*`→`unknown`（reject-any-type）等。覆盖：src/models（315）、src/dao（312）、src/services（520）、src/routes（102）、src/dashboard（34）、src/cdp 剩余、src/memory、src/runtime、src/http、src 根级单文件、executor/、src/playwright-runner、config/、seeds/ 等约 180 个文件。全程遵守 characterization pin 约束（只插入注释不改代码行）。
  影响范围：`npm run lint` 从 2431 warning 降至 **0 warning / 0 error**；无任何业务逻辑、schema、路由、WS 变更；verify-all 全绿。
  文件：src/models/*, src/dao/*, src/services/**（约 70 文件）, src/routes/**（约 40 文件）, src/dashboard/**（16 文件）, src/cdp/*, src/memory/*, src/runtime/*, src/http/*, src/executor-*.js, src/dedup.js, src/state.js, src/ws-server.js, src/trajectory-store.js, src/business-data-store.js, src/script-utils.js, src/llm-utils.js, src/middleware/sso-auth.js, executor/*, src/playwright-runner/*, config/*, seeds/*, eslint.config.js

### Fixed

- 2026-08-27: **执行机会话孤儿对账（控制面重启后僵尸槽位根治）**：控制面重启时过期心跳清扫会把 remote_session 行标为 crashed，但执行机端 Python/Chrome 仍存活——该 live 会话无 row 绑定、无 lease、不在 state.sessions，永久占用槽位且无法从 UI 释放。修复：① 执行机重新注册时（handleRegister）新增 reconcileOrphanSessions 对账——拉取执行机 session.list，与节点 active|idle 行 + state.sessions（保护在途 open，ready===true 才可关）比对，孤儿会话以 keepBrowser:true 关闭（杀 Python、保留 Chrome 成为可复用孤儿 CDP，下一次 prepare 的 preferIdleChrome 直接复用）；② 新增 POST /api/v2/executors/:nodeUuid/sessions/:sessionId/close 手动兜底（节点离线 409、会话不存在 404）；③ 监视面板「occupied 但无交易」槽位新增「关闭会话」按钮。
  影响范围：src/executor-ws.js（注册对账）、src/services/executor-orphan-session-service.js（新模块）、src/routes/v2/executor.js（手动关闭端点）、src/dashboard/api-docs/slot-monitor.js（面板按钮）；scripts/characterization/characterize-executor-orphan-reconcile.mjs（新增）已注册 verify-all。无 schema 变更。
  附带：characterize-layer-tree / characterize-export-v3 真实数据锚点 traj 38 已不在库中（数据裁剪），迁移到 traj 33（#11426 / phase_highlight）；export-v3 的 rect 抽样断言从按位对齐改为多重集一致（步骤可能因元操作跳过导致错位，统计意义等价）。

- 2026-08-27: **对公客户类型读录错值根治——select_option 首项兜底伪成功移除（A+B 双层）**：traj 157 复现链——业务数据把「信贷潜在客户」（实际属「客户状态」选项）配给「对公客户类型」，wanted 不在下拉项中时 JS 旧 fallback-first 分支直接点首项「企业类」却返回 `ok | 企业类 | fallback-first | wanted:信贷潜在客户`，Python 误判成功：记录 wanted 原文 + task_done，回放/导出跟着错。修复：① A（JS 侧根修）`js_snippets/select_option.py` 删除 fallback-first 分支——wanted 不存在时返回 `option-not-found:<预览>`，不再伪造成功（首项别名 first/1st/第一个/第一项 显式请求语义保留）；② B（Python 防回归兜底）`form_action_engines.py` 在 `_is_ok_result` 分支顶端新增守卫：结果串含 `fallback-first` 一律拒绝为 err-select-option-unresolved（附现场预览与下一步指引），并删除 `retries>=3` 时以 JS_SELECT_OPTION, first + ok_marked(fallback=...) 的旧兜底——两层关闭「wanted 不在下拉项时点首项却报成功」通道，LLM 可当步自纠（取现场原文或改用正确字段）。
  影响范围：select_option 对「错配/不存在选项」从静默伪成功转为诚实失败；录制/回放链路无其他变化。无 schema/路由/WS 变更。
  文件：scripts/controller/actions/js_snippets/select_option.py, scripts/controller/actions/form_action_engines.py, scripts/characterization/characterize-select-option-verify.py, scripts/refactor/verify-all.sh（新增注册）

- 2026-08-27: **select_option 值↔选项错配源头根治（C 方案：提示词层防盲信 + 建议字段确定性重定向）**：traj 157 第三个根因——业务数据值被映射到错误 select 字段（「信贷潜在客户」配给「对公客户类型」，实为「客户状态」选项）；任务清单/业务数据绑定完全发生在 LLM 头部且无任何契约约束，A+B 只让错误点失败、本方案让错误点之前被纠正。修复三层：① C1 提示词规则——agent-core.md 阅读规则新增「select 值必须在字段选项内」（不在 → 同页其它字段选项找候选 → 唯一候选改填候选字段；无候选禁止盲填）；agent-tools-form.md select_option 工具描述与业务数据规则、form-prompt.md 业务数据/commandValue 规则各补值-选项契约，并新增「值不在选项内（跨字段建议）」行（同前缀旧规则补衔接句消除措辞矛盾）；② C2 确定性建议字段——select_match.py 新增 `suggest_field_for_value`（exact→最短包含、禁止 o-in-want 陷阱方向、按 label 去重），form_action_engines.py 新增 `_select_failure_next_action` 并把 select_option 全部 5 个 err-select-option-unresolved 分支的 next_action 接入：候选非空时直接给出「建议字段「客户状态」（快照选项含：信贷潜在客户）：select_option(...)」，无候选/首项哨兵回既有默认文案（逐字不变）；③ C3 表单助手值守卫——_llm_values.py P1 分支：commandValue 错配且 fuzzy 失败 → 唯一候选自动重定向到候选字段 / 无·多候选剥离 commandValue 并入 needs_agent（附候选建议，业务数据点名字段不再由助手自造值）；LLM 返回解析后新增 `_guard_select_plan_values` 后验：select/radio/checkbox 动作值不在该字段 options → 唯一候选重定向、否则撤并入 needs_agent；autofill_round.py 以同 section 全量字段作为 cross_fields 传入（filt 空时全量）。
  影响范围：select_option 失败报错附精确建议字段；表单助手对错配值从「盲写原字段」转为「唯一候选自动重定向 / 候选进 needs_agent」；三份 LLM 提示词新增值-选项契约规则（既有原文逐字保留）。无 schema/路由/WS 变更。
  文件：scripts/controller/actions/select_match.py, scripts/controller/actions/form_action_engines.py, scripts/controller/actions/_llm_values.py, scripts/controller/actions/autofill_round.py, scripts/prompts/agent-core.md, scripts/prompts/agent-tools-form.md, scripts/prompts/form-prompt.md, scripts/characterization/characterize-select-option-suggest-field.py（新增）, scripts/refactor/verify-all.sh（新增注册）

- 2026-08-27: **阶段评审器 navigate 误判护栏（D 方案：保存 cue 确定性升级合约）**：session d3943e89 事故——阶段文本「新增一个信贷潜在客户…，点击保存。预期结果：页面跳转至客户基本信息填写页或提示保存成功。」被 LLM 评审器误判 mode=navigate（目标重写为“点击新增进入新增填写页面”），submit.required=False → done 门禁在「新增客户校验」抽屉未填完（对公客户类型/证件类型/证件号码空 + 可见校验错误）时放行提前 done。修复：① D1 确定性护栏 reviewer.py 新增 `promote_contract_for_save_cues(contract, task_text)`——LLM 合约 mode∈{navigate,login,query,other} 且确定性 classify_task_mode=form_fill/form_modify 且文本命中保存/提交 cue（点击保存|保存成功|点击提交|提交成功|保存并提交|提交并保存|保存后）时强制升级：mode=create/modify、submit.required=true、success.kinds=[toast_ok,url_change,saved_navigation]、allow_form_assistant=true、refill=all_editable（其余键原样，stderr 记录升级）；调用点接在 normalize（末尾 sanitize 降级）之后，升级不被降级覆盖；② D2 评审提示词规则 2/8 补陷阱示例与「预期结果：页面跳转…或提示保存成功=保存成功形态（saved_navigation），禁止 navigate/query」规则；③ 新特征化 characterize-phase-save-cue-promote（A-G：事故文本升级/纯导航/纯查询/无 cue 不动/修改+保存→modify/None·非 dict 原样/create 不被触碰）已注册 verify-all。
  影响范围：含「点击保存/提交」且确定性为填表/修改类的阶段不再可能被 LLM 评审器降级为 navigate——done 门禁将按 submit.required 拒绝提前 done。无 schema/路由/WS 变更。
  文件：scripts/controller/actions/phase/reviewer.py, scripts/prompts/phase-reviewer-prompt.md, scripts/characterization/characterize-phase-save-cue-promote.py（新增）, scripts/refactor/verify-all.sh（新增注册）

- 2026-08-27: **promote 叙事字段派生（E：消除升级合约的提示词矛盾）**：D 方案护栏升级硬语义后，LLM 遗留的导航式叙事字段仍会注入 agent 提示（intent_gates.py 逐行输出 out_of_scope/done_when/brief_plan；planner 被要求尊重 out_of_scope）——如「只打开页面/不办理页面内业务流程」与升级后的 create 合约直接矛盾，agent 可能被明确告知不要填表或过早 done。修复：promote_contract_for_save_cues 升级分支同步派生叙事——goal=阶段全文[:300]（与【当前任务】一致）、done_when=校验+保存成功模板（create/modify 区分）、in_scope=填表/校验/保存/终检 4 条、out_of_scope=后续阶段+不放弃保存、brief_plan=对应 4 步、source=llm+guard（与纯 LLM 合约可区分）；stderr 日志句尾追加 narrative=derived（前缀逐字节不变）。特征化追加 E 断言（A 用例 goal/done_when/in_scope/out_of_scope/source/brief_plan 七项 + H 无导航残留用例 + B/C/D 未触发时 goal/source 保持不变）。
  影响范围：被 promote 的合约叙事与硬语义自洽，agent/planner 不再读到矛盾指引；触发条件与既有硬语义升级行为不变。无 schema/路由/WS 变更。
  文件：scripts/controller/actions/phase/reviewer.py, scripts/characterization/characterize-phase-save-cue-promote.py

- 2026-08-28: **阶段内状态组截图 + 步骤绑定（G：跳转前采集保 elements/regionTree 同源）**：阶段截图原先在 phase_done 后拍当前页——阶段内最后一次点击保存会跳转页面（新增客户校验抽屉→客户基本信息填写页），阶段截图及其 elements/regionTree 变成跳转后页面，阶段步骤元素（采集自跳转前抽屉）无法对应/点亮。修复：① 状态组机制——状态键=current_page_level() 的 level key（含 page/popup 层级，抽屉开合可识别）；阶段开始即采、状态键变化即开新组采集、提交类动作（click_save）执行前采集（Python 等待应答≤5s，超时降级），每阶段组数上限 20；② **步骤按 beforeKey 归组**（触发跳变的步骤=点击新增/点击保存归属旧状态组，与组图同源）；经 entryId↔dbId 关联后写入 trajectory_step.group_shot_id；③ 数据模型——screenshot.kind 增 phase_group、新增 state_group 列与 uk_ss_phase_group(phase_id, state_group)（替代 uk_ss_phase_kind；同时给 phase_highlight 行回填 state_group='done'、replaceForPhase 写入 'done'，保住 done 行去重——否则每阶段会累积多张 phase_highlight）、trajectory_step.group_shot_id FK ON DELETE SET NULL；④ API——phase.groupShots[] + step.groupShotId（内嵌扩展，null 平滑兼容）；phase_highlight done 行保留（state_group='done'）；⑤ 新特征化 characterize-phase-group-shot 注册 verify-all。
  影响范围：阶段截图/步骤绑定数据链新增（组图行 + 绑定列 + API 字段，null 兼容）；done 截图、page_level、步骤 before/after 机制不变；录制链路新增 click_save 前最多 5s 采集等待（超时/失败降级为无组图，不阻塞）。无路由/WS 变更；迁移随服务启动自动执行。
  文件：migrations/20260828090000_phase_group_shot.js（新增）, schemas/init.sql, src/dao/screenshot-dao.js, src/dao/trajectory-step-dao.js, src/services/screenshot-service.js, src/services/trajectory/phase-highlight-screenshot.js, src/services/trajectory/trajectory-recording-runner.js, src/services/trajectory/trajectory-query-service.js, src/dashboard/api-docs/groups/trajectory.js, src/dashboard/api-docs/groups/remote.js, scripts/state.py, scripts/controller/service.py, scripts/session_runner.py, scripts/characterization/characterize-phase-group-shot.py（新增）, scripts/refactor/verify-all.sh

- 2026-08-27: **编辑草稿客户录制循环（国别 value-mismatch 复发 + field-disabled 10 步空转）——三项加固**：录例中 radio→修改→引入全链路已修复生效，卡点收窄为三个下拉字段。用户初判"缓冲步骤给多"不成立：budget 预估 8 步/上限 17，第 16 步即注入 final-save urgency，且随后延期 +12/+8 共跑 38 步——步数充足，是每一步都在原地失败。CDP 隔离复现与带污染批次重放均**一次通过**（别名重试 ok:中华人民共和国），证明机制无恙、属负载型竞态：录制进程叠加截图捕获/CPU 高载时懒加载分块渲染 >500ms，旧滚动稳定判定（streak≥2≈500ms）误判"到底"，可见窗口模糊匹配点了「中国香港特别行政区」；Python 别名重试在同一负载下二次踩坑；`fill_form_field` 对三个 select 只返回裸 `field-disabled` 无任何指向，agent 连续 10+ 步盲试。
  加固：
  ① **滚动耐心显式化**（`js_snippets/select_option.py` + CTRL `select.js` 同步）：上限 8→14 轮、sleep 250→220ms、稳定判定 streak≥2→≥3 且须 `i>=4`（MIN_ROUNDS_BEFORE_STABLE）才允许提前收手——慢分块不再伪装列表尽头。CDP 实测常规命中路径 0.27s 不受影响。
  ② **engine 二次升级 exactOnly 兜底**（`form_action_engines.py` value-mismatch 分支）：别名重试仍 mismatch 时，再 reset+retrigger 后以 `[resolved_option, True]`（exactOnly）做最后一次严格尝试——彻底关闭 fuzzy 错选通道，成功记 `mismatch-retry-exact`，失败则错误信息即真实缺失标签。
  ③ **field-disabled 指引化**（FillEngine 两条 fill 路径）：非 ok 且以 `field-disabled` 开头时，探测该 label 的控件形态，为 select 追加"改用 select_option"、date 提示格式、cascader/tree 指向对应动作——直接针对本次 agent 盲填 select 空转 10+ 步的主浪费源。
  影响范围：大型懒加载下拉在高负载录制中的选项命中稳定性；select 类字段被文本填写时的错误自解释性（引导 LLM 当步切换正确工具）。无 schema/路由/WS 变更。
  文件：scripts/controller/actions/js_snippets/select_option.py, scripts/controller/actions/form_action_engines.py, src/ctrl-actions/select.js, scripts/characterization/characterize-select-lazy-load.py, scripts/characterization/characterize-select-option-verify.py

- 2026-08-27: **`click_icon_button` 通用化——icon miss 后直接点击同标签文字按钮（radio→工具栏修改 cycle 根除）**：修好 radio+工具栏指引后 agent 走 `click_table_row_radio` 成功（`ok`），但点工具栏「修改」时 `click_icon_button` 只匹配 el-icon+tooltip 宿主（`_iconCandidates` 选择器要求 aria-describedby+icon 类），普通 `<button>` 文字按钮永远不进候选集 → 必然 `not-found` 且零指引 → step 2–9 同动作死循环（cycle 检测触发仍 deviate → QUALITY FAIL）。按用户方案**拓展为通用按钮点击**：
  ① **JS fallback 直点文字按钮**（`js_snippets/icons.py` + CTRL `nav.js` 同步）：icon 候选全 miss 后，收集可见 `button/.el-button/a` 中文本等于/包含 button_text 的候选（排除 `.el-table__body-wrapper` 行内控件、≤8 条）；精确标签优先于 contains，页面级（弹层外）优先于弹层内；唯一命中 → scrollIntoView+点击返回 **`ok-text:<label>`**；多个命中 → `not-found-text-button:{wanted,reason:'ambiguous',textButtons:[…]}`；无匹配保持裸 `not-found`。ok 图标路径零改动。
  ② **Python 端**（`_misc.py`）：`ok-text:` 以 ok 开头自然走成功记录（回放链路 `_replay.py` 先 durable xpath 后控制器回退，CTRL 已同步拓展 → 录制/回放对称）；ambiguous 包装 `_err` 指引"改用 click_element_by_index 或提供完整按钮文字"。动作 description 与 prompt（`agent-tools-table.md`）改为「按标签点击按钮（通用）：tooltip 图标优先，miss 直接点同标签文字按钮」。
  CDP 19242 实测 E2E：列表页 radio 选中 `ok` → `click_icon_button("修改")` 一步 `ok-text:修改` → 路由跳转编辑页 `crtCpctInf`（此前该流程循环至预算耗尽 QUALITY FAIL）。
  影响范围：agent 点任何命名可见按钮（工具栏/页面级）单次调用即成功，无需先判断 icon 还是文字按钮；歧义时一次性给出候选清单。CTRL `clickIconButton` 行为同步。无 schema/路由/WS 变更。
  文件：scripts/controller/actions/js_snippets/icons.py, scripts/controller/actions/_misc.py, src/ctrl-actions/nav.js, src/ctrl-actions/index.js（文档）, scripts/prompts/agent-tools-table.md, scripts/characterization/characterize-table-toolbar-pattern.py（断言更新：固定 ok-text 直点行为）

- 2026-08-27: **`click_table_row_button` 工具栏模式页面误点与 row-not-found（录制编辑客户失败）**：「对公客户管理」列表页表格行内只有 单选框 + 客户名称链接（查看），真正的「修改」在表格上方工具栏（选中行后点工具栏模式）。Agent 两次误用 `click_table_row_button`：① `row_text="26082700011272705 璞真健康管理咨询中心"`（跨单元格空格拼接）被 `row.textContent.includes()` 判不匹配——textContent 将相邻单元格**无空格直接拼接**（`…72705璞真…`）→ `row-not-found`；agent 转而裸点工具栏「修改」（未先选中行 → 无效）。② 按名称命中行后行内无「修改」，旧逻辑盲点行内第一个可见按钮（客户名称链接）并记为 `ok-fallback` **假成功**——错误动作写入轨迹。
  修复：
  ① **行匹配去空白归一化**（`_table.py` button+radio 两处 + CTRL `src/ctrl-actions/table.js` 同步）：精确单元格匹配失败后，`rowText` 与整行 textContent 双方先剥掉全部空白再 includes——`"编号 名称"` 可命中 `"编号名称"` 拼接行。
  ② **移除盲点首个可见按钮的 `ok-fallback`**：改为返回结构化 `button-not-found-in-row:{wanted,rowButtons,rowHasRadio}`（JSON 列出行内真实按钮清单与是否有单选框），Python 端包装 `_err` 并附指引：该操作按钮若在工具栏（本类页面常见），先 `click_table_row_radio(row_text=...)` 选中行再点工具栏按钮；禁止反复猜行内按钮。
  ③ **Prompt 更新**（`scripts/prompts/agent-tools-table.md`）：删除"无匹配时自动点击第一个可见按钮作为兜底"的宣传，新增工具栏模式必走 radio+工具栏 的硬性指引与调用前判断方法；`src/ctrl-actions/index.js` 文档行同步返回码。
  CDP 19242 实测：带空格拼接 row_text 命中行（T1）、radio 同文本成功选中（checked+current-row，T1b）、请求不存在按钮时零点击副作用仅返回结构化信息（T2/T4）。
  影响范围：`click_table_row_button` 在工具栏模式表格不再假成功/盲点；跨单元格拼接 row_text 匹配修复（button+radio 一致）；CTRL `clickTableRowButton/clickTableRowRadio` 行为同步。无 schema/路由/WS 变更。
  文件：scripts/controller/actions/_table.py, src/ctrl-actions/table.js, src/ctrl-actions/index.js（文档）, scripts/prompts/agent-tools-table.md, scripts/characterization/characterize-table-toolbar-pattern.py（新增，已注册 verify-all）

- 2026-08-27: **`select_option` 国别字段 `value-mismatch` 死循环——中国 → 中国香港特别行政区**：天阳信贷系统「新增对公客户」表单的「国别」下拉含 250 个国家/地区选项，其中无精确「中国」，仅有「中华人民共和国」「中国香港特别行政区」「中国澳门特别行政区」「台湾(中国的省)」。Agent 要求 `select_option "国别" = "中国"` 时，`JS_SELECT_OPTION` 的 substring fallback `lab.includes("中国")` 命中最短的「中国香港特别行政区」并点击，但 `verifyAfterClick` 回读校验因后缀「香港特别行政区」非数字打头而拒绝 → `value-mismatch`。Python 端 `value-mismatch` 分支（`form_action_engines.py`）以相同 `option_text="中国"` 重试 → 再次命中同一错误选项 → 二次 mismatch → `_final_select_failure` → agent 反复重试「中国」陷入死循环（step 9–17）。
  修复（两层）：
  ① **`JS_SELECT_OPTION` 匹配逻辑重构**（`js_snippets/select_option.py`）：将 `matchInPool` 拆为 `exactMatchInPool`（仅精确匹配 `labelMatches`）+ `fuzzyMatchInPool`（子字符串 `includes`）。滚动查找流程改为：每步滚动先做精确匹配 → 滚到无法滚动（2 次 stable）后再做 fuzzy 子字符串匹配 → 仍无匹配则选第一个作为兜底（返回 `ok:<label> | fallback-first | wanted:<option>`）。此前 `matchInPool` 在第一帧就做子字符串匹配命中错误选项，根本不进入滚动阶段。
  ② **Python `value-mismatch` 分支别名解析**（`form_action_engines.py`）：当 `option_text` 为「中国」/「中国大陆」时，先从 `params['options']` 按前缀匹配排除港/澳/台变体，找不到则直接回退硬编码「中华人民共和国」（`params['options']` 仅含 ~21 个可见项，250 项列表需 scroll 才完整；`JS_SELECT_OPTION` 的 `SELECT_LAZY_LOAD_ON_MISS` 会在 retry 时 scroll 查找）。
  ③ **CTRL parity**（`src/ctrl-actions/select.js`）：`findTarget` 同步拆为 `findExactTarget` + `findFuzzyTarget`，滚动循环每步用精确匹配，`finishFallback` 在滚动耗尽后做 fuzzy → 首项兜底。
  CDP 19242 实测验证：① `select_option "中华人民共和国"` → `ok:中华人民共和国`（scroll 找到精确匹配）；② `select_option "中国"` → `value-mismatch` → Python 别名解析 → retry `"中华人民共和国"` → `ok:中华人民共和国`；③ `select_option "不存在的国家名XYZ"` → `ok:中国香港特别行政区 | fallback-first`（首项兜底）。
  影响范围：`select_option` 在含国家全称（无简称）的大型下拉中不再因 `value-mismatch` 死循环；别名解析覆盖「中国」/「中国大陆」→「中华人民共和国」；无匹配时选首项兜底而非死循环。CTRL `selectOption` 同步。无 schema/路由/WS 变更。
  文件：scripts/controller/actions/js_snippets/select_option.py, scripts/controller/actions/form_action_engines.py, src/ctrl-actions/select.js, scripts/characterization/characterize-select-option-verify.py（断言更新：`matchInPool` → `exactMatchInPool` + `fuzzyMatchInPool`）

- 2026-08-26: **`click_save` 误过滤 `disableBtn` 类保存按钮导致 agent 关闭抽屉（录制无法保存）**：天阳信贷系统的"新增客户"抽屉中保存按钮带自定义 `disableBtn` 类（无 `is-disabled`、无 HTML `disabled` 属性、`pointer-events: auto`、`opacity: 1`——完全可点击），但 `JS_CLICK_SAVE_BUTTON`（`save.py:53`）此前将 `disableBtn` 独立视为禁用并在候选收集阶段过滤 → `candidates=[]` → `not-found`。Agent 反复 `click_save` 失败后，错误消息建议 `close_dialog` 关闭"干扰弹窗" → agent 执行 `close_dialog` **关闭了正在填写的抽屉** → 所有表单值丢失 → `QUALITY FAIL`。修复：移除 `disableBtn` 的独立过滤，仅保留 `el.disabled`/`getAttribute('disabled')`/`is-disabled` 三项真正的禁用判定（`disableBtn` 在该系统中是视觉类，仅 `disableBtn.is-disabled` 组合才表禁用，而 `is-disabled` 已被过滤覆盖）。
  影响范围：`click_save` 不再误过滤仅含 `disableBtn` 的可点击保存按钮；此前因 `disableBtn` 被过滤导致 `not-found` → agent 误关抽屉的场景消除。无 schema/路由/WS 变更。
  文件：scripts/controller/actions/js_snippets/save.py, scripts/characterization/characterize-multi-save-sections.py（断言更新：`disableBtn` 不再独立过滤）

- 2026-08-26: **AI 录制自动填表多层 scope 泄漏审计修复（3 处）**：对 autofill 执行路径做系统审计，发现并修复三个独立的"填到弹窗外字段"泄漏点：
  ① **cascade 重扫描溢出 overlay**（`autofill_pending.py`）：cascade round 2/3 与 Step 6 同步扫描硬编码 `{'mode': 'fullpage'}`，以 `[document]` 为根，`.el-form-item` 命中弹窗外底层页面字段（实测「对公客户管理→新增」抽屉 `multi` 仅 5 个抽屉内字段，`fullpage` 8 个含 2 个弹窗外「客户编号」「客户分类」）。修复：改用 `tasklist_scan_mode(active_container)`，overlay 时 `multi`（仅 overlay 根），主页面时 `fullpage`。
  ② **cascade 轮次间 container 漂移**（`autofill_pending.py`）：cascade round 2/3 从 store 读 `_active_container`（round 1 时设的），不重新探测 DOM——若 round 1 填表打开/关闭子对话框（如"选择客户"picker），`getMultiRoots` 扫描所有可见 overlay 含子对话框，将其字段拉入当前 drawer 的 pending。修复：cascade 与 sync 两处增加 `JS_IDENTIFY_CONTAINER` 重新探测 DOM container，探测值优先于 store 缓存。
  ③ **placeholder fallback 查 document**（`fill_core.py` `JS_FILL_BY_XPATH`）：xpath 未命中时 placeholder 兜底按 `[drawer, dialog, document]` 找 input——当 drawer/dialog 内无匹配但主页面有同 placeholder input 时，填到弹窗外。修复：有可见 overlay 时 scope 仅限 `[drawer, dialog]`，无 overlay 时才回退 `document`（主页面表单行为不变）。
  影响范围：overlay 打开时 autofill 的扫描 + 执行 + placeholder 兜底三层均不再溢出到弹窗外；主页面（无 overlay）行为不变。无 schema/路由/WS 变更。
  文件：scripts/controller/actions/autofill_pending.py, scripts/controller/actions/js_snippets/fill_core.py
  已知遗留（未修，低优先）：`_switch_task_list_container`（task_completion.py:187-192）按 container_id 字符串盲恢复陈旧 task list + `_scan_fields`（跳过重扫），在同名 container 二次打开且字段集变化时可能填入陈旧字段；需更大设计改动（恢复时强制重扫或 fingerprint 校验），暂记录待后续处理。

- 2026-08-26: **select_option 在 overlay 抽屉内录制崩溃（`'bool' object is not subscriptable`）**：`scripts/state.py` `_record_action` 第 685 行用 `overlay = _is_overlay_region(rid)` 取 overlay 信息后访问 `overlay['label']`，但 `_is_overlay_region` 只返回 `bool`——在「对公客户管理 → 新增」打开 overlay 抽屉、对「客户状态」执行 `select_option` 时 `rid` 命中 overlay 段，`overlay` 为 `True`，`True['label']` 抛 `TypeError: 'bool' object is not subscriptable`，导致该步录制失败、agent 无法完成「新增信贷潜在客户」阶段。修复：新增 `_overlay_label_in_region(region_id)` 从 region_id 链中解析首个 `overlay:<label>` 段的 label（无则 None），`_is_overlay_region` 改为 `return _overlay_label_in_region(...) is not None`（bool 语义不变，所有既有 `if _is_overlay_region(...)` 调用点零影响），`_record_action` 改用 `_overlay_label_in_region(rid)` 取 label 构造 `popup_level_key`。
  影响范围：overlay（dialog/drawer）内 `select_option`/`fill_form_field` 等带 region_id 的动作录制不再崩溃；`_is_overlay_region` 返回值在布尔上下文行为不变。无 schema/路由/WS 变更。
  文件：scripts/state.py, scripts/characterization/characterize-page-level-python.py（既有断言 `is not None` 语义与新实现一致，无需改）

- 2026-08-26: **select_option 在 overlay 抽屉内录制崩溃（`'bool' object is not subscriptable`）**：`scripts/state.py` `_record_action` 第 685 行用 `overlay = _is_overlay_region(rid)` 取 overlay 信息后访问 `overlay['label']`，但 `_is_overlay_region` 只返回 `bool`——在「对公客户管理 → 新增」打开 overlay 抽屉、对「客户状态」执行 `select_option` 时 `rid` 命中 overlay 段，`overlay` 为 `True`，`True['label']` 抛 `TypeError: 'bool' object is not subscriptable`，导致该步录制失败、agent 无法完成「新增信贷潜在客户」阶段。修复：新增 `_overlay_label_in_region(region_id)` 从 region_id 链中解析首个 `overlay:<label>` 段的 label（无则 None），`_is_overlay_region` 改为 `return _overlay_label_in_region(...) is not None`（bool 语义不变，所有既有 `if _is_overlay_region(...)` 调用点零影响），`_record_action` 改用 `_overlay_label_in_region(rid)` 取 label 构造 `popup_level_key`。
  影响范围：overlay（dialog/drawer）内 `select_option`/`fill_form_field` 等带 region_id 的动作录制不再崩溃；`_is_overlay_region` 返回值在布尔上下文行为不变。无 schema/路由/WS 变更。
  文件：scripts/state.py, scripts/characterization/characterize-page-level-python.py（既有断言 `is not None` 语义与新实现一致，无需改）

- 2026-08-26: **xpath 填充路径补 scrollIntoView（before/after PNG 可视化修复）**：fill 主路径已切换到 xpath 优先（`JS_FILL_BY_XPATH`），原 `JS_FILL_FORM_FIELD`（label 路径）中的 `item.scrollIntoView` 仅在 label 兜底分支执行——输入框填写不再滚动到视口，导致填写前后截图看不到结果（下拉/日期选择器路径本就有滚动，故无此问题）。修复：`JS_FILL_BY_XPATH` 新增 `scrollFillTarget`（优先滚动所在 `.el-form-item`，与 label 路径语义一致），在 placeholder 分支与主 xpath 路径（date/普通共用）setFn 前调用。
  影响范围：xpath 路径填写输入框/日期控件前滚动到视口（before/after 截图可见填写结果）；下拉/日期选择器行为不变。无 schema/路由/WS 变更。
  文件：scripts/controller/actions/js_snippets/fill_core.py, scripts/characterization/characterize-fill-xpath-scroll.py（新增）

- 2026-08-26: **V3 推送「业务对象名称」报错补全（propertiesName 未净化）**：上条修复只覆盖顶层 transcationName，但伙伴将 V3 transcationProperties 的每个条目（propertiesName，如「法定代表人/负责人信息」）也作为业务对象校验——含 / 等禁用字符仍报「业务对象名称不能包含 \\ / : * ? \" < > | '」（V2 路径早有此规则，V3 遗漏）。修复：buildTransactionEntryV3 在 uniquifyPropertiesNames 后对全部 propertiesName 统一 sanitizeTranscationName。实测（traj 33 全量 143 个 propertiesName）残留 0。
  影响范围：V3 推送 payload 全部 properties 条目名称净化（推送不再因条目名含 / : 等报错）；transcationName 行为不变。无 schema/路由/WS 变更。
  文件：src/services/transaction-export-v3.js, scripts/characterization/characterize-transaction-name.mjs

- 2026-08-26: **V3 推送「业务对象名称」含伙伴禁用字符报错**：轨迹名（用户手输，无字符校验）经 transaction-export-v3.js:913 原样作为 transcationName 推送，伙伴 importDemand 校验失败（\\ / : * ? \" < > | '）时错误直透前端。修复：V3（及 V2 deprecated 路径）名称装配点对禁用字符 sanitize 为 `_`；前端 RecordingDialog.vue 交易名称输入增加同规则校验（即时提示+提交拦截，源头告警）。
  影响范围：推送 payload transcationName 命中禁用字符时以 `_` 替换（推送不再失败）；前端录入时即提示。无 schema/路由/WS 变更。
  文件：src/services/transaction-export-v3.js, src/services/transaction-export.js ★前端（ui-auto-recording-agent-vue-master：vue-project/src/views/ui-recording/components/RecordingDialog.vue）

- 2026-08-26: **迁移 `20260814110000_trajectory_batch_job.js` 在 MySQL 5.7 上 `Unknown collation: 'utf8mb4_0900_ai_ci'` 修复**：该迁移为 `trajectory` 新增 `batch_job_id` 外键列时显式 `.collate('utf8mb4_0900_ai_ci')` 以对齐 `batch_recording_job.id`——但 `utf8mb4_0900_ai_ci` 是 MySQL 8.0 专有 collation，服务器（47.101.58.49 docker mysql）为 **MySQL 5.7.44**，不识别该 collation，`knex migrate:latest` 在此迁移失败并阻塞其后全部迁移（12 个未应用）。实际 `batch_recording_job.id` 与 `trajectory` 表的 collation 均为 `utf8mb4_general_ci`（继承表默认，迁移 `20260802140000` 未钉 collation），原注释假设错误。修复：移除 `.collate(...)` 调用，新列继承 `trajectory` 表默认 `utf8mb4_general_ci`，与 FK 目标列一致，FK `fk_traj_batch_job` 正常建立。服务器已上传修复后迁移并重跑 `migrate:latest`（52 个迁移全部应用），`/api/docs`、`/api/health` 均返回 200。
  影响范围：迁移文件本身（仅 collation 声明去除，列/索引/FK 语义不变）；MySQL 5.7 部署环境迁移不再阻塞。无路由/WS/业务逻辑变更。
  文件：migrations/20260814110000_trajectory_batch_job.js

- 2026-08-26: **`case_data → business_data` 深度改名遗漏修复（`autofill_pending.py` + 提示词）**：commit `dfb5c9e` 全量改名时遗漏了 `scripts/controller/actions/autofill_pending.py`（10 处 `self.case_data_store` 未改为 `self.business_data_store`），导致 `run_form_assistant` 调用 `_auto_fill_pending_impl` 时 `FormAutofillEngine` 无 `case_data_store` 属性 → `'FormAutofillEngine' object has no attribute 'case_data_store'`，批量自动填表彻底不可用。同时提示词 `agent-core.md` / `agent-tools-common.md` 仍引用旧工具名 `save_case_data` / `read_case_data` / `case_data_store`（实际已改名 `save_business_data` / `read_business_data` / `business_data_store`），LLM 被指示调用不存在的工具。修复：① `autofill_pending.py` 全部 `self.case_data_store` → `self.business_data_store`；② `autofill_round.py` 注释/日志字符串 `case_data` → `business_data`；③ 提示词 `agent-core.md` / `agent-tools-common.md` 全量替换工具名与存储名。另在 `_misc.py` `click_element_by_index` 异常处理中增加 `traceback.format_exc()` 日志，以诊断 `'bool' object is not subscriptable` 错误的精确来源。
  影响范围：`run_form_assistant` 批量自动填表恢复可用；提示词工具名与代码一致。无 schema/路由/WS 变更。
  文件：scripts/controller/actions/autofill_pending.py, scripts/controller/actions/autofill_round.py, scripts/controller/actions/_misc.py, scripts/controller/actions/form_action_engines.py, scripts/prompts/agent-core.md, scripts/prompts/agent-tools-common.md

- 2026-08-25: **多保存按钮识别 disableBtn 自定义禁用类 + 提示词多分区各点保存指引**：collapse 多分区页面（如对公客户转正）「对公客户概况」「客户基本信息」等各区各带一个文本『保存』按钮（class 含 `el-button--text` 与自定义 `disableBtn` 类，文本完全相同"保存"）。此前 JS_CLICK_SAVE_BUTTON 的 disabled 判定（`el.disabled || getAttribute('disabled') != null || classList.contains('is-disabled')`）**不识别自定义 `disableBtn` 类**——被禁用的保存按钮仍被当候选，导致误点击/歧义；且提示词无"多保存按钮应分别按分区点击"的指引，AI 只录一个保存操作。修复：① `scripts/controller/actions/js_snippets/save.py` `JS_CLICK_SAVE_BUTTON` disabled 判定处追加 `el.classList.contains('disableBtn')`，在候选收集时（`matches` 循环内、`scoreBtn` 之前）滤掉该类按钮（score 流程不变；若全部候选均 disableBtn → `matches` 为空 → 返回 `not-found`，语义等价）；② `scripts/prompts/form-prompt.md` 与 `scripts/prompts/agent-tools-form.md` 增加多保存按钮分区语义规则——页面存在多个『保存』/提交按钮（分属不同分区/表单，且已填写多个分区的字段）时，对每个已填写的分区/表单分别调用一次 `click_save(button_text='保存', region='<分区名>')`（`region` 取分区 title/region_label），确保每个分区恰好保存一次；仅填写单一分区时无需 region；收到 `err-save-ambiguous` 报错时，按报错候选清单中的分区逐个带 region 重试；禁止只录制一个保存操作就 done。
  影响范围：JS_CLICK_SAVE_BUTTON 候选过滤（自定义 disableBtn 类视为不可点击/跳过）、提示词多分区保存指引。无 schema/路由/WS 变更。
  文件：scripts/controller/actions/js_snippets/save.py, scripts/prompts/form-prompt.md, scripts/prompts/agent-tools-form.md, scripts/characterization/characterize-multi-save-sections.py（新增）

- 2026-08-25: **select_option 写入后读回确认（value-mismatch）+ 表单快照 fields 新增可选 options（select 类）+ 提示词告诫同前缀下拉字段**：AI 曾用「国民经济部门」的选项（非金融企业部门）填「国民经济部门类别」字段（选项：公司/非公司企业/其他非金融企业部门）→ 自愈循环。`labelMatches` 精确优先 + 最短包含回退（避免 非金融 matching 其他非金融）与 `select_option_already_matched` 精确串检查已存在，但缺写入后确认与快照选项清单。修复：① `scripts/controller/actions/js_snippets/select_option.py` `JS_SELECT_OPTION` 的 `tryClick` 改为 async——点击后 `await sleep(250ms)` 读回 `triggerInput.value`（el-select readonly input 即当前选中文本；为空再尝试 `.el-select` 内 `.el-select__selected-item`/`.el-select__input` 选中项文本），normalize 后与期望 option 比较：`exactOnly` 时严格相等，否则相等或 table-select 名称+数字前缀回退；相等 → 返回 `ok:<label>`，不等 → 返回 `value-mismatch | expected:<option> | current:<读回>`；读不回（table-row 无 trigger input）→ 信任点击返回 `ok:<label>`（无误报）。`matchInPool` 同步改 async，各返回点统一经 `verifyAfterClick`；点击触发逻辑（`mousedown`/`click`/`input`/`change` 事件）不动。② `form_action_engines.py` `select_option` 新增 `value-mismatch` 分支：reset select UI 后 re-trigger + 相同入参重试一次（`_sel_mismatch_retry_<label>` 防重入，>1 次不再重试）；重试成功 → 记录 `ok | <matched> | mismatch-retry`；仍 mismatch / 其他失败 → `_err(_final_select_failure(...))` 交 heal。③ `scripts/models/form_snapshot.py` `SnapshotField` 新增可选 `options: list[str]` 字段（`from_scan_fields` 对 `kind` 为 `select`/`tree-select`/`tree` 且扫描信息有 options 的字段填充清洗后选项列表；非 select 字段为空列表）；`form_scan_utils.py` `_save_form_snapshot` checkpoint params 的 fields 条目对有 options 的字段附加 `'options': [...]`（无 options 不附加，兼容旧消费者）；`fields_fingerprint` 仅用 `(label, is_required, xpath_smart)` 不含 options（去重不受影响）；`CTRL.verifyFormStructure` 仅读 `label`/`is_required`（JS 忽略 options 键）。④ `scripts/prompts/form-prompt.md` 与 `scripts/prompts/agent-field-rules.md` 增加同前缀下拉字段告诫——必须使用该字段自己的 options 清单，禁止跨字段复用选项值，选项不在目标字段 options 中即视为错误。
  影响范围：select_option 写入后多一次读回确认（250ms 延迟 + value 比较），mismatch 自动 reset+重试一次后交 heal；表单快照 `save_form_snapshot` 的 `params.fields` 条目对 select 类字段新增可选 `options` 子字段（旧消费方忽略）；提示词增加同前缀下拉字段规则。无 schema/路由/WS 变更。
  文件：scripts/controller/actions/js_snippets/select_option.py, scripts/controller/actions/form_action_engines.py, scripts/models/form_snapshot.py, scripts/controller/actions/form_scan_utils.py, scripts/prompts/form-prompt.md, scripts/prompts/agent-field-rules.md, scripts/characterization/characterize-select-option-verify.py（新增）

- 2026-08-25: **click_adjacent_button 定位修复：同前缀 label 字段（实际控制人客户编号 vs 实际控制人配偶客户编号）下的相邻按钮**：`form_action_engines.py` `click_adjacent_button` 的 `page.evaluate` JS 此前用 `lbl.includes(label)` 命中**第一个**匹配 form-item 即尝试点击，该 item 无按钮就直接 `return 'no-adjacent-button-found'`——当录制 label（实际控制人客户编号）为另一同前缀字段（实际控制人配偶客户编号，按钮「选择」所在）的前缀时，录制与 controller 兜底回放都命中无按钮字段而失败。修复：① evaluate JS 改为遍历 container 内全部 `.el-form-item`，收集所有 `lbl.includes(label)` 的 item 并记录 `lbl.trim() === label` 精确命中 flag，按「精确匹配优先、includes 次之（保持 DOM 顺序）」排序后逐一处理——每个 item 先找关键词按钮（选择/引入/上传/添加/导入/新增）再找任意可见 button/a，点击成功即返回 `'ok-clicked'`，**无按钮的 item 直接 continue 到下一个**（不再 early return），全部处理完仍无按钮才返回 `'no-adjacent-button-found'`，无任何匹配 item 返回 `'label-not-found'`；返回值语义不变，`scrollIntoView`/`offsetParent` 可见性检查/`_is_ok_result`/`_record_action` 结构不变。② 快照 formLabel 修正（录制质量）：`src/cdp/page-locator-helpers.js` `buildLocatorSnap` 对 `kind==='adjacent_button'` 改为优先用 `el.closest('.el-form-item')` 的 `.el-form-item__label` 文本作为 `formLbl`（替换 hint label_text，因 hint 可能指向无按钮的同前缀字段），无 label 时保留 hint；`_locator_helpers_js.py` 经 `_gen_locator_helpers_py.mjs` 重新生成（Python 录制端 `enrich.py` 透传 `buildLocatorSnap` 自动生效）。
  影响范围：相邻按钮点击/回放不再因 label 前缀相同命中无按钮字段（实际控制人客户编号 → 实际控制人配偶客户编号的「选择」按钮）；录制 `element_json` 的 `formLabel`/`xpath_smart` 以按钮实际所属 form-item 为准。无 schema/路由/WS 变更。
  补充：`click_adjacent_button` 在 already-filled 分支后新增 disabled-no-adjacent-button 跳过分支——字段 disabled 且 `hasButton` 为空（无相邻按钮）时返回 `_ok(f'disabled-no-adjacent-button | <label>')`（与 already-filled **完全同构**：`_ok` 包装 + 非 `ok` 前缀消息 → `_is_ok_result` 为 False → `should_record_result` 为 False → 不记录轨迹步骤、非失败 ActionResult），回放不再到达点击 evaluate 的 `'no-adjacent-button-found'` 失败路径、不再触发自愈/"没有作用"；disabled 且有按钮维持现行（尝试点击）；非 disabled 维持现行。
  文件：scripts/controller/actions/form_action_engines.py, src/cdp/page-locator-helpers.js, scripts/controller/actions/js_snippets/_locator_helpers_js.py（生成，经 scripts/_gen_locator_helpers_py.mjs）, scripts/characterization/characterize-adjacent-button.py（新增）

- 2026-08-25: **absXPath/页面内 document.evaluate 兼容缺口：xpath_full 无 /html 根前缀导致 resolveByXpath 必失败回退 findByText 最后匹配**：`src/cdp/page-locator-helpers.js` 的 `absXPath` 循环以 `document.body` 为界且不输出 /html 根前缀，产物形如 /div[1]/div[1]/section[1]/...；浏览器原生 `document.evaluate` 从文档根解析必须 /html 开头 → 0 命中，而 Playwright 引擎自动补 // 前缀所以回放一直正常。页面内消费点 `resolveByXpath`（`scripts/controller/actions/js_snippets/enrich.py` 的 `JS_ENRICH_CLICK_LOCATOR`）裸 `document.evaluate` 失败后 `findByText` 取「最后一个匹配」。修复：① `absXPath` 循环改为以 `document.documentElement` 为界（含 body），返回 `/html` + parts（产物 /html/body/div[1]/...），id 快捷分支 `//*[@id=...]` 不变；② `enrich.py` 新增 `resolveXpathAny` 归一化回退：对以 / 开头且非 //、非 /html 的 xp 依次尝试原样 → //+xp → /html+xp，首个 `document.evaluate` 命中即返回，全失败返回 null（保持原语义）；③ `_locator_helpers_js.py` 经 `_gen_locator_helpers_py.mjs` 重新生成。
  影响范围：页面内定位失败→最后一个匹配（回放 Playwright 前缀约定不受影响）；新录制 `xpath_full` 改为标准 /html 绝对路径；旧数据经归一化回退兼容。无 schema/路由/WS 变更。
  文件：src/cdp/page-locator-helpers.js, scripts/controller/actions/js_snippets/_locator_helpers_js.py（生成，经 scripts/_gen_locator_helpers_py.mjs）, scripts/controller/actions/js_snippets/enrich.py, scripts/characterization/characterize-absxpath-prefix.mjs（新增）

- 2026-08-25: **表格同名行按行内唯一键（客户编号/证件号码）消歧，替代 [1]/[2] 索引**：当 el-table 出现同名行（如查询「瑞云智联科技有限公司」返回两行，tr 无 id/data-*，行内唯一文本=客户编号 14~18 位数字、证件号码/信用代码 18 位大写字母数字）时，AI/人工录制点击行内按钮/radio 的定位不再退化为 `//button[normalize-space()='同名']` + [N] 索引，而以行内唯一键单元格文本优先作为 `row_text` 行锚：① `tableRowIdentityText`（inspect-payload-script.js）与 table_row_button/radio 分支（page-locator-helpers.js）的 rowT 提取增加唯一键列优先，无唯一键时回退原「首个非操作列」逻辑；② Python 录制侧 `JS_ENRICH_CLICK_LOCATOR`（enrich.py）为表格行控件回填唯一键 `row_text`，_helpers.py 透传；③ 回放行匹配（_table.py / ctrl-actions/table.js）改为「单元格文本精确匹配优先 + contains 回退」，_replay.py 的 click_table_row_button 增加行锚 xpath 优先尝试；④ 提示词 agent-tools-table.md 增加同名行唯一键指导；⑤ 顺带修复上游 4ca2901 引入的 PAGE_LOCATOR_HELPERS 模板转义缺陷（`/^\/[^\\s]*\[/` 单反斜杠，eval 时报 `Unexpected token '^'` 整串崩溃），该缺陷已使 characterize-locator-parity / characterize-tree-select-record 全挂、也是线上定位异常的可疑根因之一。
  影响范围：录制 element_json 的 row_text/xpath_smart（同名行场景改以唯一键行锚）、回放行匹配语义（唯一键精确优先；无唯一键/单行场景行为不变）、locator 生成（JS + Python mirror）。无 schema/路由/WS 变更。
  文件：src/cdp/page-locator-helpers.js, src/cdp/inspect-payload-script.js, scripts/controller/actions/js_snippets/_locator_helpers_js.py（生成，经 scripts/_gen_locator_helpers_py.mjs）, scripts/controller/actions/js_snippets/enrich.py, scripts/controller/actions/_helpers.py, scripts/controller/actions/_table.py, scripts/controller/actions/_replay.py, scripts/prompts/agent-tools-table.md, src/ctrl-actions/table.js, scripts/characterization/characterize-row-unique-key.mjs（新增）

- 2026-08-25: **人工录制无 label 字段的 label 兜底与定位优先级**：`formItemLabel`/CDP fill 在无 `.el-form-item__label` 时，用 placeholder 文本去掉「请输入」作为 `label_text`；`formFieldXpathSmartOf` 回退顺序改为 placeholder 优先、name 次之。配合上一修复，登录等无 label 页面重录后 `xpath_smart` 可直接命中，减少自愈触发。
  影响范围：人工录制/CDP inspect 的 label 捕获与 locator 生成；无 schema/路由/WS 变更。
  文件：scripts/manual_recorder/js_parts/a.py, src/cdp/inspect-payload-script.js, src/cdp/inspect.js, src/cdp/page-locator-helpers.js, scripts/controller/actions/js_snippets/_locator_helpers_js.py, scripts/characterization/characterize-login-locator-fallback.py

- 2026-08-25: **登录等无 label 表单的 xpath_smart 回退**：`formFieldXpathSmartOf` 在 `.el-form-item` 内没有真实 `<label>` 时，忽略 `formLabel` 提示并改用 `name`/`placeholder` 定位；同时忽略形如 XPath 的损坏 `formLabel`（避免绝对路径被当 label 截断写入）。修复人工录制登录步骤在回放/录制时定位不到的问题。
  影响范围：locator 生成（`src/cdp/page-locator-helpers.js` 与 Python mirror）；无 schema/路由/WS 变更。
  文件：src/cdp/page-locator-helpers.js, scripts/controller/actions/js_snippets/_locator_helpers_js.py, scripts/characterization/characterize-login-locator-fallback.py, scripts/refactor/verify-all.sh

- 2026-08-26: **修复 region 提取函数中 5 处单反斜杠 `\s` 转义 bug**：`src/cdp/page-locator-helpers.js` 的 `PAGE_LOCATOR_HELPERS` 是 JS 模板字面量，源码单反斜杠 `\s` 求值后变成字母 `s`（非空白类），`/\s+/` 求值后变成 `/s+/g`（匹配字母 s 而非空白）——导致 `buildFeatureCard` 的 class token 分割（`cls.split(/\s+/)`）与标题/region_label 空白归一化（`.replace(/\s+/g, ' ')`）失效。修复：L644/L648/L654/L666/L670 共 5 处的 `/\s+/`、`/\s+/g` 改为 `\\s` 写法（源码两个反斜杠，模板求值后为 `\s`，正则恢复匹配空白）。同文件其它处（L35/L59 等）已是正确 `\\s`，对照未改。
  影响范围：JS 定位器内核（`src/cdp/page-locator-helpers.js`）+ Python mirror（生成物）。class token 分割与标题空白归一化恢复正常。无 schema/路由/WS 变更。
  文件：src/cdp/page-locator-helpers.js, scripts/controller/actions/js_snippets/_locator_helpers_js.py（生成，经 scripts/_gen_locator_helpers_py.mjs）

### Changed

- 2026-08-25: **V3 控件条目新增 `attr` 字段（disabled/required/readonly）**：录制侧新增 V3 控件布尔属性采集——JS `collectAttrFlags` 显式采集 disabled/required/readonly 三键布尔（HTML 布尔属性被 `collectAttrs` 的空值过滤丢弃，此前根本采不到，只能采到字符串属性）；Python 侧 `_helpers.py` 的 `_capture_element` / `_enrich_click_element` 透传 `attr`，`ElementInfo` 新增 `attr` 字段，`to_element_json` 输出，`from_record` 白名单搬运；Node `copyLocatorMeta` 保留 attr；V3 object 节点恒有 `attr`（三键布尔，旧数据回退 `{}`）。伙伴出站 `toPartnerImportPayload` 剥除 attr（本地/replay 元数据，确认伙伴认后再放开）。
  影响范围：V3 导出 payload（`transcationProperties[]` 中 type=object 的控件条目新增 `attr` 子对象）、伙伴出站体（剥除 attr）、录制采集链（JS+Python+Node）、characterization。V2 不受影响（V2 无 attr 字段）。无 schema/WS 变更。
  文件：src/cdp/page-locator-helpers.js, scripts/controller/actions/js_snippets/_locator_helpers_js.py（生成）, scripts/controller/actions/js_snippets/fill_core.py, scripts/controller/actions/js_snippets/enrich.py, scripts/controller/actions/_helpers.py, scripts/models/action.py, src/models/element.js, src/services/transaction-export-v3.js, src/services/partner-platform.js, src/dashboard/api-docs/groups/export-mgmt.js, scripts/characterization/characterize-partner-platform.mjs, scripts/characterization/characterize-export-v3-field-completeness.mjs

- 2026-08-25: **V3 `rect` 归一化坐标（`rect_norm`）**：录制侧新增 `rect_norm`（element_json 子字段，0~1 相对所属截图：页面控件 = `page_bbox` / 页面 full_page 截图尺寸，弹窗控件 = (`page_bbox` - 弹窗 rect) / 弹窗 rect 尺寸）；页面截图 meta 新增 `contentWidth`/`contentHeight`（`capture_page_dims_from_page`，document scrollWidth/Height；跳转前注册的 before-leave 截图由调用方在跳转前采集 `before_dims` 并传入 `register_page_screenshot_if_changed`）；修复 Python 透传断裂（`_helpers.py` 此前丢弃 `page_bbox`，现透传）；stamp 点 `_stamp_rect_norm` 集中归一化（注册表带 `@@anchor` 键用 startswith 兜底匹配）。导出侧 `rect_norm` 优先直出（跳过弹窗减法），旧像素数据回退现状路径，`stats.normalizedRects` 计数；lightup 工具按值域（≤1.0001）自动判归一化/像素双坐标渲染。
  影响范围：V3 导出 payload（控件条目新增 `rect_norm` 子对象；rect 仍为 JSON 字符串但新数据值为 0~1 归一化）、页面级截图 meta（新增 contentWidth/contentHeight）、录制采集链（JS+Python+Node）、可视化工具、characterization。V2 不受影响。无 schema/WS 变更。
  文件：scripts/state.py, scripts/controller/actions/_helpers.py, scripts/controller/service.py, scripts/manual_recorder/recorder.py, src/models/element.js, src/services/transaction-export-v3.js, scripts/tools/lightup-phase-screenshot.mjs, scripts/characterization/characterize-page-level-screenshot.mjs, scripts/characterization/characterize-export-v3.mjs

- 2026-08-25: **collapse 独立中间节点 `type`**：V3 `REGION_ROLE_TO_TYPE` 新增 `collapse: 'collapse'`（此前 `collapse` role fallback 成 `section`）；layer-tree `V3_INTERMEDIATE_TYPES`/`V3_INTERMEDIATE_ROLES` 加入 `collapse`；api-docs 类型枚举更新（`collapse`=折叠面板、`section`=区块/分区）。录制插件格式对齐。
  影响范围：V3 导出 payload（`transcationProperties[].type` 新增 `'collapse'` 取值，中间节点）、layer-tree 工具、API docs 类型枚举。V2 / V3.0 groups 不受影响。无 schema/WS 变更。
  文件：src/services/transaction-export-v3.js, scripts/tools/layer-tree-from-properties.mjs, src/dashboard/api-docs/groups/export-mgmt.js, scripts/characterization/characterize-export-v3-pid.mjs

- 2026-08-25: **case_data → business_data 全量改名**：DB 表 `case_data`/`case_data_entry` 重命名为 `business_data`/`business_data_entry`（列 `case_data_id` → `business_data_id`，含 `form_snapshot` 外键列）；JS 文件名/符号名/路由路径 `/api/v2/case-data` → `/api/v2/business-data`（旧路径 301 重定向）；Python `_case_data.py` → `_business_data.py`、`case_data_entity.py` → `business_data_entity.py`；action 名 `save_case_data`/`read_case_data` → `save_business_data`/`read_business_data`；transport keys `case_data`/`case_data_file`/`case_data_block` → `business_data`/`business_data_file`/`business_data_block`；`case_data_store` 参数/属性 → `business_data_store` 全域；`case_data_ref` → `business_data_ref`；`_case_scenario_text` → `_business_scenario_text`（双 key 回退兼容存量数据）；消除「业务数据 vs 案例数据」双重术语。`BUSINESS_DATA_SECTION_RE` 正则内容不变（仍匹配用户输入中的「案例数据」等标题）。`CASE_BLOCK_MARK_LEGACY` 保留（向后兼容旧录制）。
  影响范围：DB schema（表/列名）、API 路由路径、Python 模块路径、action 名、transport key、characterization 测试 pin。无语义变更。
  文件：migrations/20260825220000_rename_case_data_to_business_data.js, src/dao/business-data-dao.js, src/services/business-data-service.js, src/routes/v2/business-data.js, src/business-data-store.js, src/routes/v2/__init__.js, server.mjs, config/config.js, src/services/trajectory/*.js, src/memory/*.js, src/routes/v2/trajectory.js, src/models/*.js, src/executor-session-client.js, executor/session-handler.js, src/dao/form-snapshot-dao.js, src/routes/browser-session/*.js, scripts/controller/actions/_business_data.py, scripts/models/entity/business_data_entity.py, scripts/controller/actions/*.py, scripts/controller/actions/phase/*.py, scripts/agent/service.py, scripts/session_runner.py, scripts/event_dispatch.py, scripts/trajectory_store.py, scripts/characterization/*.py/*.mjs

- 2026-08-24: **V3 `type` 字段对齐 §8 层级类型定义**：V3.1 flat 导出 `transcationProperties[].type` 从 4 种改为 §8 定义的层级类型值——截图条目 `dialog`→`popup`（`page` 不变）；控件条目 `ele`→`object`；中间节点按 `region_id` 段 role 映射：`tab`→`tab`、`wizard`→`wizard`、`card`→`card`（此前全为 `section`），`section/titlebox/table/todo`→`section`（不变），`dialog/overlay`→`popup`；`main/shell-header/shell-aside/other` 等结构性 role **跳过不建节点**（ele pid 直指上层，用户决策"main 归 page 级"）。覆盖校验/字段完整性校验/伙伴出站适配/可视化工具同步更新。**V3.0 groups 格式（legacy）不动**。
  影响范围：V3 导出 payload（`type` 字段取值集变更：新增 `popup`/`tab`/`wizard`/`card`/`object`，移除 `dialog`/`ele`——V3.1 flat only）、伙伴出站契约、可视化工具、API docs。V2 / V3.0 groups 不受影响。无 schema/WS 变更。
  文件：src/services/transaction-export-v3.js, src/services/partner-platform.js, config/config.js, src/dashboard/api-docs/groups/export-mgmt.js, scripts/tools/lightup-phase-screenshot.mjs, scripts/tools/layer-tree-from-properties.mjs, scripts/characterization/characterize-export-v3.mjs, scripts/characterization/characterize-export-v3-pid.mjs, scripts/characterization/characterize-export-v3-field-completeness.mjs, scripts/characterization/characterize-page-level-screenshot.mjs, scripts/characterization/characterize-dialog-screenshot.mjs, scripts/characterization/characterize-layer-tree.mjs, scripts/characterization/characterize-partner-platform.mjs

- 2026-08-24: **Partner 批量推送切到同事本地联调服务**：`PARTNER_API_BASE` 默认值从 `http://test.atp.tansun.com.cn/api` 改为 `http://172.20.101.162:11001/api`（172.20.101.162:11001 为同事本地服务，原 test.atp 已停用；80 端口无服务；env `PARTNER_API_BASE`/`PARTNER_IMPORT_DEMAND_URL` 仍可覆盖）。`resolveAccessToken` 回落链增加硬编码联调 JWT（`PARTNER_DEBUG_ACCESS_TOKEN`，同事 172.20.101.162 的 access token）：请求头 token → `PARTNER_ACCESS_TOKEN` env → 硬编码 JWT，无登录态脚本/联调不再 400。⚠️ 临时联调配置：硬编码 token 含敏感凭据，联调结束须移除（历史曾移除过一次，恢复时已同步更新 characterize-partner-platform 断言）。
  影响范围：出站推送目标地址、token 回落语义（无请求 token 时不再 400）、characterization（partner-platform）。无 schema/WS 变更，API docs 契约未变。
  文件：src/services/partner-platform.js, config/.env.example, scripts/characterization/characterize-partner-platform.mjs

- 2026-08-24: **V3 分区数据改用 propertiesID/propertiesPID 父子树表达（partition-via-pid）**：V3 导出构建期（`buildV3Properties`）从 `region_id` 链提取分区段（tab/section/titlebox 等），为每段创建 `type='section'` 中间节点插入 `transcationProperties[]`，ele 的 `propertiesPID` 指向最近 section 节点（无分区段时直指 page/dialog 截图，存量兼容）。同页同名控件（如两个「保存」按钮）因分区不同 pid 不同 → 可区分。`validatePageLevelCoverage` 改为沿 PID 链向上追溯（`resolveRootScreenshotId`）到 page/dialog 截图校验覆盖。伙伴出站适配新增 `PARTNER_SECTION_TYPE` 配置（默认 `'section'`，伙伴不接受时可切 `'ele'+elementType='partition'`）。可视化工具 lightup 加 PID 树侧栏、layer-tree 识别 section 节点为中间层。
  影响范围：V3 导出 payload（`transcationProperties[].type` 新增 `'section'` 值；ele `propertiesPID` 可能指向 section 节点而非 page/dialog）、伙伴出站契约、可视化工具、API docs。V2 不受影响。无 schema/WS 变更。
  文件：src/services/transaction-export-v3.js, src/services/partner-platform.js, config/config.js, src/dashboard/api-docs/groups/export-mgmt.js, scripts/tools/lightup-phase-screenshot.mjs, scripts/tools/layer-tree-from-properties.mjs, scripts/characterization/characterize-export-v3-pid.mjs, scripts/characterization/characterize-export-v3.mjs, scripts/characterization/characterize-page-level-screenshot.mjs, scripts/characterization/characterize-partner-platform.mjs, scripts/refactor/verify-all.sh

- 2026-08-24: **阶段步数预算耗尽续跑（budget-extend）**：agent `run()` 后质量门改为续跑循环——done 未触发且仍有待完成字段（introduce/pending/tree-select）时，用同实例二次 `agent.run(max_steps=extension)` 续跑（≤2 轮，ceiling 钳制）。`compute_budget_extension` 纯函数（reviewer.py）按成本模型计算续跑步数（introduce×4 + pending×2 + tree_select×1 + 2，clamp 到 ceiling-used；全空返回 0）。done 检测用闭包 flag `case_data_store['_done_fired']`（`make_done_callback` 设置，不依赖 `agent._done_fired`）。引入字段计数从 `_scan_fields`（disabled && hasButton）读。phase_end payload 新增 `budgetExtensions` 观测字段（每轮步数/引入/pending 数）。
  影响范围：agent 运行控制流（续跑行为）、phase_end 观测 payload（新增可选字段，向后兼容）、scripts/ Python 代码。无 schema/WS/Node 变更。
  文件：scripts/controller/actions/phase/reviewer.py, scripts/agent_utils.py, scripts/agent/service.py, scripts/characterization/characterize-budget-extend.py, scripts/refactor/verify-all.sh

- 2026-08-24: **V3 字段完整性校验 + 超长截断 + 推送前自检（v3-payload-size ②③）**：新增 `validateFieldCompleteness`（ele 缺 elementType+realLabel / orphanPid、page/dialog 空截图、空名称 → issue，section 节点豁免）和 `preflightCheck`（wire payload 中 undefined 值检测——JSON.stringify 静默丢弃 undefined key 的信息丢失风险、page/dialog 无 screenCapture），均**只统计不阻断**。超长字段截断（`FIELD_LENGTH_LIMITS`：elementType 2000、options 4000、objectValue 500、propertiesName 100，超长截断加 `...truncated` 后缀），在 `buildTransactionEntryV3` 合并后 `uniquifyPropertiesNames` 之前应用。stats 扩展 `fieldCompletenessIssues` 和 `truncatedFields`（per-entry + 聚合），批量推送响应 surface `merged.stats`。
  影响范围：V3 导出 payload（超长字段被截断，消费方需处理 `...truncated` 后缀）、推送响应（新增 stats 可选字段）、推送日志（preflight 非阻断告警）。无 schema/WS 变更。
  文件：src/services/transaction-export-v3.js, src/services/partner-platform.js, src/routes/v2/export-mgmt.js, scripts/characterization/characterize-export-v3-field-completeness.mjs, scripts/refactor/verify-all.sh

- 2026-08-22: **录制监听器生命周期修复（session-end 截图配套）**：AI 录制的事件订阅（trajectory-recording-runner 的 action_log_sync / step_screenshot / page_level_screenshot 监听）原在 record/start 完成时立即注销，导致 detach 时 Python agent 优雅退出路径发出的会话结束最终截图（capturedAt='session-end'）无人接收而被丢弃。现改为：订阅挂在会话上（session._aiRecordUnsub），随会话关闭（closeSession → removeSessionHub）自动清理，detach / 节点掉线 / 运行时清理路径同步显式注销；重录时先注销旧订阅。影响范围：录制事件持久化（record/start 结束后至 detach 前的事件不再丢失）；文件：src/services/trajectory/trajectory-recording-runner.js, trajectory-attach-service.js, trajectory-runtime.js, src/services/executor-node-service.js。
- 2026-08-22: **executor 会话优雅关闭宽限修复（session-end 截图配套）**：SessionSlot.close() 原在写入 close 事件后固定等 2 秒即 taskkill /F 强杀进程树，Python agent 的优雅退出路径（session-end 最终截图、记忆队列冲刷、浏览器关闭）来不及执行导致截图缺失。现改为：成功写入 close 事件后等待子进程自然退出（上限 20 秒），超时才强杀；写入失败保持原 2.5s/2s 兜底。影响范围：会话 detach/关闭行为（宽限 2s→20s，最坏关闭耗时增加；正常路径 agent 数秒内自然退出不受影响）。文件：executor/session-slot.js。
- 2026-08-21: **关键状态前置截图（session-end / before-close / close_notification）**：补齐三类"关键状态转变前"截图——① 会话结束（含 error/cancel/SystemExit 异常退出路径）在 `browser_context.close()` 前追加一次当前页面截图：`register_current_page_screenshot` 新增可选参数 `captured_at`（默认 `'phase-end'` 维持既有调用方语义），meta `capturedAt` 新增取值 `session-end`；② `close_dialog` 在关闭动作执行前先捕获弹窗裁剪图（`capturedAt:'before-close'`，经 `register_popup_screenshot` 落 popup 级截图），动作后跳过 post 弹窗捕获（弹窗已关必为空），step 级 dialog 图改用前置图；③ `close_notification` 移出 `_SKIP_SCREENSHOT_ACTIONS` 跳过名单（关闭前有整页 before/after 图），`capture_dialog_png_b64_from_page` 弹窗选择器追加 `.el-notification:visible`、标题选择器追加 `.el-notification__title`（可见通知也能出裁剪图）。
  影响范围：录制截图语义（`capturedAt` 新增 `session-end`/`before-close` 两个取值，消费方按可选字段处理；close_dialog 步骤多一次前置弹窗捕获，仅该动作触发，频率极低）；复用 `page_level_screenshot` / `step_screenshot` 事件，无 schema/WS/Node 消费面变更。
  文件：scripts/state.py, scripts/session_runner.py, scripts/controller/service.py, scripts/characterization/characterize-before-close-screenshots.py, scripts/refactor/verify-all.sh

- 2026-08-21: **批量动作显式化（`max_actions_per_step` 参数化）**：browser_use 0.1.48 一轮多动作此前走框架默认 10（Agent 构造未传参，实际生效但不可控），现新增 `MAX_ACTIONS_PER_STEP` 配置（默认 4）经 Node → Python 透传显式控制。解析规则（`resolve_max_actions_per_step` 纯函数，scripts/agent_utils.py）：指令显式值优先（0/空不覆盖）→ 否则按 contract 模式映射（create/modify/introduce_pick → 5；navigate/query/login/其它/None → 3）→ clamp 到 [1,10]。agent prompt 追加批量输出纪律（同一轮多动作仅允许对已存在元素的连续填充/选择，如多个 fill_form_field / click_radio；禁止 click_element、导航、下拉展开、select_option 等 DOM 结构变更动作与保存/提交类动作入批）；agent-tools-form「每步最多 1 个 select_option」不变。观测：Agent 构造前 stderr `[batch] max_actions_per_step=N (source=config|mode|default)`；phase_end observability payload 增加 `maxActionsPerStep` 字段。
  影响范围：agent 会话批量动作预算（行为可调）、prompt 纪律、phase_end 观测 payload（新增可选字段，向后兼容）、config 新增配置项。无 schema/WS 变更。
  文件：config/config.js, config/.env, config/.env.example, src/services/trajectory/trajectory-recording-runner.js, scripts/agent_utils.py, scripts/agent/service.py, scripts/prompts/agent-tools-common.md, scripts/characterization/characterize-batch-actions.py, scripts/refactor/verify-all.sh

- 2026-08-21: **V3 `rect` 字段改为 JSON 字符串**：`transcationProperties[].rect` 从对象改为字符串（如 `'{"x1":0.4617838541666667,"y1":0.11821438412785891,"x2":0.6642903645833333,"y2":0.12703224028658033}'`），空值从 `{}` 改为 `""`，方便消费方单列存储。序列化在 `buildTransactionEntryV3` 合并截图+控件条目后统一进行（构建期内部仍为对象，弹窗坐标换算不受影响）；`validatePageLevelCoverage` 可定位判定兼容字符串/对象两种形式；`lightup-phase-screenshot` 工具读取 payload 时解析字符串 rect（兼容旧对象格式文件）。底层导出函数 `buildScreenshotEntries` / `buildV3Properties` 返回值保持对象形式（内部构建形态，非 payload 契约）。
  影响范围：V3 导出服务契约（payload 中 rect 类型变化：对象→字符串，空 `{}`→`""`）、API docs、tools（lightup）、characterization。V2 不受影响（V2 无 rect 字段）；无 schema/WS 变更。
  文件：src/services/transaction-export-v3.js, src/dashboard/api-docs/groups/export-mgmt.js, scripts/tools/lightup-phase-screenshot.mjs, scripts/characterization/characterize-export-v3.mjs, scripts/characterization/characterize-page-level-screenshot.mjs

- 2026-08-21: **batch/names 仅返回已有交易轨迹的任务名**：交易列表「按任务名筛选」下拉候选原先包含全部任务，含未产生任何交易轨迹的空任务（选中后列表恒为空）。`listDistinctNames` 增加 `EXISTS trajectory.batch_job_id` 关联过滤，空任务不再出现在下拉。
  影响范围：`GET /api/v2/trajectories/batch/names` 返回内容收窄（可能变少）；无 schema 变更。
  文件：src/dao/batch-recording-dao.js, src/dashboard/api-docs/groups/trajectory.js, scripts/characterization/characterize-batch-task-name.mjs

- 2026-08-21: **引入 Node 原生 `#` 路径别名（增量）**：`package.json` 新增 `imports` 映射 `#config/*` → `./config/*`、`#src/*` → `./src/*`（Node ESM 标准子路径导入，零构建依赖）。本次改动涉及的 9 个文件（server.mjs、llm-utils、agent/llm-proxy/setup 路由、resolve-model、两个 service、global-browser）的 config 导入已从多层 `../` 相对路径切换为 `#config/config.js`，消除层数数错导致的 `ERR_MODULE_NOT_FOUND`。**存量其他相对导入不动，新增/改动文件逐步采用**（characterization 对源码做子串断言，避免大面积重写的回归成本）。
  影响范围：仅 import 书写方式，运行时行为不变；无 schema/路由/WS 变更。
  文件：package.json, server.mjs, src/llm-utils.js, src/routes/agent.js, src/routes/llm-proxy.js, src/routes/setup.js, src/runtime/resolve-model.js, src/services/operation-component-mine-service.js, src/routes/browser-session/global-browser.js；第二批：src/services/trajectory/ 下 16 个文件；第三批：src/cdp/remote-bridge/ws-router.js, src/routes/browser-session/{broadcasts,register,watcher-actions}.js, src/routes/v2/{auth,case-data,trajectory}.js, src/services/sso/paas-client.js。`src/` 内 3 层相对导入已清零（0 处残留）。

### Added

- 2026-08-21: **`GET /api/v2/llm/models` 模型列表接口**：代理网关 `GET {LLM_BASE_URL}/models`，返回 `{ ok, baseUrl, defaultModel, models[] }`。配置的模型报 `model_not_found` 时可用此接口确认网关实际可用模型名（含 provider 前缀需整名使用）；网关不可达返回 502（错误透传）。API docs 新增「LLM 配置」分组。
  影响范围：新增只读端点，无 schema/WS 变更。
  文件：src/routes/llm-proxy.js, src/dashboard/api-docs/groups/llm.js, src/dashboard/api-docs/catalog.js

### Changed

- 2026-08-21: **模型配置统一收敛到 `.env`（`LLM_MODEL` 唯一真源）**：新增 `LLM_MODEL` 配置项（`config/config.js` 导出），消灭散落在 `llm-utils.js` / `resolve-model.js` / `agent.js` / 两个 service / `setup.js` / `executor/session-slot.js` 的硬编码默认模型。**删除 `config/agent-api.json` 及其覆盖逻辑**（原优先级 agent-api.json → .env，构成第二配置源陷阱；`server.mjs` `loadDefaultModel` 现只读 `.env LLM_MODEL`，modelID 保留完整带前缀名）。执行机与 global-browser spawn Python 时显式下发 `FORM_LLM_MODEL` / `FORM_LLM_BASE_URL` / `FORM_LLM_API_KEY`（此前 Python 表单 LLM 只能靠 connect.py 兜底或回落 agent LLM）。`FORM_LLM_MODEL` 缺省回落 `LLM_MODEL`。当前值：`LLM_MODEL=GLM-5`。
  影响范围：LLM 默认模型解析链（会话/表单/分析）、setup 页生成 .env、执行机 Python 子进程环境。无 schema/WS 变更。
  文件：config/config.js, config/.env, config/.env.example, server.mjs, src/llm-utils.js, src/runtime/resolve-model.js, src/routes/agent.js, src/routes/setup.js, src/services/operation-component-mine-service.js, src/services/trajectory/trajectory-meta-service.js, src/routes/browser-session/global-browser.js, executor/config.js, executor/session-slot.js

- 2026-08-21: **LLM 默认供应商由 DeepSeek 切换到 Qwen（new-api 网关）**：默认 LLM 端点改为 `http://218.77.58.156:3000/v1`，默认模型改为 `Qwen/Qwen3.5-35B-A3B`。**模型名不再剥 provider 前缀**——旧逻辑把 `provider/model` 剥成 `model`（适配 DeepSeek 官方 API），新网关要求完整 `Qwen/...` 名称，故 `resolveModelId`（`src/llm-utils.js`、`src/runtime/resolve-model.js`）改为原样透传。同步更新：`config/config.js` FORM_LLM 默认值、`config/.env` / `.env.example`、`start.ps1` 环境变量、`src/routes/setup.js` 生成 .env 的默认值、`src/routes/agent.js` 与两个 service 的兜底模型名、`scripts/cdp/connect.py` Python 兜底、API docs 示例。llm-proxy 转发体注入的 `thinking:{type:'disabled'}` 已对新网关实测兼容。
  影响范围：LLM 调用链（agent 会话 / 表单填写 / L1c）、setup 页初始配置、API docs 示例。无 schema/路由/WS 变更。
  文件：config/config.js, config/.env, config/.env.example, config/setup.html, start.ps1, server.mjs, src/llm-utils.js, src/runtime/resolve-model.js, src/routes/setup.js, src/routes/agent.js, src/routes/health.js, src/services/operation-component-mine-service.js, src/services/trajectory/trajectory-meta-service.js, scripts/cdp/connect.py, executor/session-slot.js, executor/config.js, src/dashboard/api-docs/groups/{components,memory,trajectory}.js（`config/agent-api.json` 已删除）

### Fixed

- 2026-08-21: **V3 覆盖率校验页面上下文兜底——人工/抓取步骤也归属页面截图**：`buildV3Properties` 的 pid 解析对无页面锚点的步骤（人工录制/自动抓取的表格操作，region 常为 `table` 等区域标记）匹配不到任何页面截图（`propertiesPID=0`）→ `page_level` 严格模式下被覆盖率校验拦截（如交易 33 推送 409「页面级截图缺失」）。修复：按步骤执行顺序维护 `lastPageKey` 页面上下文，步骤自身无 page key 时继承前序最近步骤所在页面——操作发生在该页面，归属同一页面截图；无 element 的纯动作步骤同样继承 pid（仍无 rect 则继续豁免）。已在同事本地后端实测：交易 33 推送返回「同步成功，共同步1条数据」，`isExport=1`。
  影响范围：V3 导出 `buildV3Properties` pid/regionId 组装（覆盖校验更准：人工步骤不再误报缺失）；V2 不受影响；无 schema/路由变更。
  文件：src/services/transaction-export-v3.js, scripts/characterization/characterize-export-v3.mjs, scripts/characterization/characterize-page-level-screenshot.mjs

- 2026-08-21: **V3 批量推送 importDemand 400「参数错误」——发送前做伙伴契约适配**：`/api/v2/export/transactions-v3`（前端批量推送已切到 V3）真实推送被伙伴返回 400 参数错误，而 V2 可推。根因：① V3 的 `transcationProperties` 每步多出 `screenshot` 字段（URL 数组），伙伴 schema 中 `screenshot` 为 **integer（是否执行截图）**，数组/空字符串导致 Jackson Integer 反序列化失败；② `regionId/regionLabel` 不在伙伴 schema（未知字段）。修复：`partner-platform.js` 新增 `toPartnerImportPayload` 纯函数（发送前统一适配，仅影响发送体、不影响 dry-run/响应）：剥 `regionId/regionLabel`、`screenshot[]` 并入 **`screenCapture`**（逗号串，伙伴 V3 新契约字段名）后删除 `screenshot` 字段；**`page`/`dialog`/`ele` 步骤全量保留**（伙伴 V3 契约确认 page 步骤透传，页面级截图经 `screenCapture` 送达）。已在同事本地后端实测：交易 182 推送返回「同步成功，共同步1条数据」，`isExport=1`。
  影响范围：`/api/v2/export/transactions-v3` 及 `transaction-v3` 单条推送的出站体；V2 不受影响（V2 本无这些字段）；无 schema/路由变更。
  文件：src/services/partner-platform.js, scripts/characterization/characterize-partner-platform.mjs

- 2026-08-21: **伙伴系统树子节点字段适配 `childSystems`**：test.atp 版 `lazySystemTree` 子节点在 `children`，同事本地后端（172.20.101.63:11002）返回 `childSystems`——`normalizeSystemNode` 的子节点来源增加 `childSystems`（`children ?? childList ?? childSystems ?? nodes`），两代格式兼容，否则系统树展开无子节点。已在同事本地后端完成三接口实测（projects 28 项 / systems 根+子展开 / importDemand 推送 1 条交易返回「同步成功」）。
  影响范围：`GET /api/v2/export/partner/systems` 子节点解析；无 schema/路由变更。
  文件：src/services/partner-platform.js

- 2026-08-21: **批量推送伙伴调用改透传登录态 access_token（移除硬编码联调 JWT）**：`partner-platform.js` 的 `resolveAccessToken` 原先让 `DEFAULT_PARTNER_ACCESS_TOKEN`（硬编码联调 JWT）永远优先，前端即使带了 SSO `access_token` 头也不被使用；该 JWT 过期后 `GET /api/v2/export/partner/projects|systems` 与 importDemand 推送全部失败。现优先级改为：请求方 token（header/body/query，Vue 登录态 SSO JWT——伙伴平台与账号中心同源，按登录用户身份调用）→ `PARTNER_ACCESS_TOKEN`（服务级回落，供无登录态脚本/联调）→ 都无则 400（不再有隐式兜底）。api-docs 描述无需变（文档本来即按此语义写）。
  影响范围：`/api/v2/export/partner/*`、`/api/v2/export/trajectories/:id/transaction(-v3)?`（push）、`/api/v2/export/transactions(-v3)?` 的出站鉴权；无 schema/路由变更。
  文件：src/services/partner-platform.js, scripts/characterization/characterize-partner-platform.mjs

- 2026-08-20: **页面级 key 含 hash 内易变 query——VARCHAR(512) 溢出致截图丢失（湿测抓到）**：hash 路由 SUT 的 `page_level_key_from_url` 此前只弃 `#` 前 search、保留了 fragment 内 query（如 `#/route?part=..&v=时间戳`），长 URL 超过 `screenshot.level_key` VARCHAR(512) → 修改页（业务对象主页面）page_level 截图 INSERT 失败且被吞掉 → V3 覆盖校验 19/32 控件 pid=0。修复：① `scripts/state.py` `page_level_key_from_url` 剥 fragment 内 query（对齐原设计「弃 query」），key 从 ~1100 字符降到 ~110，且消除跨次访问 `v=` 漂移；② 导出侧兜底：`transaction-export-v3.js` 新增 `stripVolatileQuery()` + `idByPageLevelNorm` 规范化索引——存量两代 key（带/不带 query）互相对齐，控件 pid 解析在精确匹配未命中后按规范化 key 重试（弹窗 key 截到段边界、anchor 保留）。数据修复：traj 181 修改页截图按规范化 key 回填（MinIO 对象已在，`backfilledFrom` 标记来源）。复录验证（traj 182）：3 页面 key 全部无 query、0 插入失败、V3 dry-run 原生 missing=0。
  影响范围：Python 录制侧页面级 key 生成、V3 导出 pid 解析、存量 page_level 数据兼容。无 schema/路由/WS 变更。
  文件：scripts/state.py, src/services/transaction-export-v3.js, scripts/characterization/characterize-page-level-python.py, scripts/characterization/characterize-export-v3.mjs

### Changed

- 2026-08-20: **V3 覆盖校验存量兼容：legacy_phase_fallback 降级为告警不阻断**：覆盖校验强制范围收窄到 `stats.coverageMode='page_level'`（新录制，830 需求适用对象）——仅该模式缺截图时单条 push 409 `page_level_screenshot_missing`、批量该项 build failed；`legacy_phase_fallback`（存量旧数据，phase 截图兜底链路，无法不重录补页面级截图）缺失**不再阻断推送**，缺失数/键仍经 `stats.missingPageLevelScreenshots` / `missingPageLevelKeys` 下发供消费方识别存量风险。新增导出服务纯函数 `coverageBlocksPush(coverage, stats)` 承载该判定（单条/批量两处路由共用；无 stats 时默认不阻断，存量兜底）。修复存量交易（含无任何可解析截图的旧数据）在 de59e69 之后被整批拦 409 的破坏性变更。
  影响范围：V3 导出服务 + 单条/批量推送路由的覆盖校验门槛、API docs、characterization。无 schema/WS/payload 结构变更；V2 不受影响。
  文件：src/services/transaction-export-v3.js, src/routes/v2/export-mgmt.js, src/dashboard/api-docs/groups/export-mgmt.js, scripts/characterization/characterize-export-v3.mjs

- 2026-08-19: **页面级截图（page/popup）与 V3 覆盖校验**：为对齐 830「每个含有业务对象的最小页面层级（page/popup）都需要有对应截图」，新增 `screenshot.kind='page_level'`、`level_type` / `level_key` / `parent_level_key` 字段与唯一键 `uk_ss_level_key`。录制侧：Python 维护页面/弹窗级截图注册表，新增 `page_level_screenshot` 事件；页面跳转前保存旧页面截图，`phase_done` 时兜底保存当前页面；弹窗截图按 `pageKey|dialog:标题@@anchor:xpath` 注册并自动推断 anchor；控件 stamp `page_level_key` / `popup_level_key`。Node 三处事件监听（executor / global-browser / trajectory-recording-runner）落库。导出侧：V3 优先使用页面级截图，`regionId` 承载 pageKey/popupKey，控件通过 `page_level_key` / `popup_level_key`（或 `region_id` 的 page/dialog 前缀）对齐；弹窗控件 `rect` 从页面长图坐标换算为相对弹窗截图坐标；新增 `validatePageLevelCoverage`，缺失截图时单条 push 返回 409 `page_level_screenshot_missing`，批量 push 整批失败；无 element_json 的可导出步骤不参与覆盖校验，避免历史步骤硬阻断；`stats.coverageMode` 区分 `page_level` 与 `legacy_phase_fallback`，用于提示存量交易兼容风险。坐标体系统一：`PAGE_LOCATOR_HELPERS` 新增 `documentBBoxOf()`，`element_json` 新增 `page_bbox`，页面级截图与 `page_bbox` 同为 document 坐标。工具同步：`layer-tree` / `lightup` 支持页面级截图；API docs 补充契约；旧 `phase_highlight` 链路保留兼容。
  影响范围：migrations（`20260819000002_screenshot_page_level.js`）、schemas/init.sql、screenshot DAO/service、V3 导出/路由、录制事件链路、Python 录制侧、API docs、characterization、tools。V2 不受影响。
  文件：migrations/20260819000002_screenshot_page_level.js, schemas/init.sql, src/dao/screenshot-dao.js, src/services/screenshot-service.js, src/services/transaction-export-v3.js, src/routes/v2/export-mgmt.js, src/routes/browser-session/persist-live.js, src/routes/browser-session/executor-events.js, src/routes/browser-session/global-browser.js, src/services/trajectory/trajectory-recording-runner.js, scripts/state.py, scripts/controller/service.py, scripts/manual_recorder/recorder.py, scripts/session_runner.py, scripts/event_dispatch.py, scripts/models/action.py, scripts/models/entity/screenshot_entity.py, src/models/element.js, src/models/entities.js, src/cdp/page-locator-helpers.js, scripts/controller/actions/js_snippets/_locator_helpers_js.py, scripts/controller/actions/js_snippets/enrich.py, scripts/controller/actions/js_snippets/fill_core.py, src/dashboard/api-docs/groups/export-mgmt.js, src/dashboard/api-docs/api-docs.css, src/dashboard/api-docs/pending-screenshots.js, scripts/tools/layer-tree-from-properties.mjs, scripts/characterization/characterize-export-v3.mjs, scripts/characterization/characterize-layer-tree.mjs, scripts/characterization/characterize-page-level-screenshot.mjs, scripts/characterization/characterize-page-level-python.py, scripts/refactor/verify-all.sh

- 2026-08-19: **DOM 分区算法支持 `card / 卡片`**：`assignRegion()` / `composeContentRegion()` 新增 `.el-card` 识别，卡片内元素会生成 `card:标题` 分区，`layers` 增加 `{ role:'card', label }`，`region_card` 记录卡片标题。`display-group` 将 `card` 视为 taxonomy role；`layer-tree` 工具增加卡片样式；同步重新生成 `_locator_helpers_js.py`。影响范围：元素分区/分层结果、V3 导出 `regionId/regionLabel/layers`（若元素在卡片内）、工具展示。无 schema/WS 变更；V2 不受影响。
  文件：src/cdp/page-locator-helpers.js, src/cdp/display-group.js, scripts/controller/actions/js_snippets/_locator_helpers_js.py, scripts/tools/layer-tree-from-properties.mjs, scripts/characterization/characterize-partition-compose.mjs

- 2026-08-19: **V3.1 弹窗父子关联与截图叠加坐标**：`dialog` 截图条目的 `propertiesPID` 不再固定为 `"0"`，改为通过 `dialogScreenshots[].trajectoryStepId` → `traj.steps[].trajectoryPhaseId` → 页面截图 `propertiesID` 回填，从而在 flat 单数组中也能还原“页面 → 弹窗 → 控件”的层级。`dialog` 截图条目新增可选 `rect`（弹窗在页面长图上的位置，来自录制时 `dialogMeta.rect`），弹窗内控件 `rect` 仍相对弹窗截图。工具同步更新：`layer-tree-from-properties.mjs` 支持把 dialog 挂到 page 下；`lightup-phase-screenshot.mjs` 支持在页面长图上叠加弹窗截图，并按弹窗截图坐标点亮弹窗内控件。V3.0 `result.groups` 工具兼容保留。
  影响范围：V3 导出服务契约（`dialog.propertiesPID` 语义变化、`dialog.rect` 可选）、API docs、tools、characterization。无 schema/WS 变更；V2 不受影响。
  文件：src/services/transaction-export-v3.js, src/dashboard/api-docs/groups/export-mgmt.js, scripts/tools/layer-tree-from-properties.mjs, scripts/tools/lightup-phase-screenshot.mjs, scripts/characterization/characterize-export-v3.mjs

- 2026-08-19: **V3 批量推送结构重大变更——截图合并进 transcationProperties**：发给 partner 的 payload **只含 `transcationEventTypeList`**（顶层移除 `payload.screenshots`，截图已合并进每个 entry 的 `transcationProperties`，截图条目与控件步骤条目同构、统一 schema，消费方后端只需一张表存储）。截图条目：`eventTypeValue="click"`/`eventTypeName="点击"`/`elementType=""`/`mothed=""`/`type`沿用原 screenshots type（`page`/`dialog`）/`screenshot`=[MinIO 永久直链]数组/`rect={}`/`propertiesPID="0"`（无父）/`realLabel=""`。控件步骤条目：保持 V2 五核心字段语义，`type="ele"`/`elementType`=xpath/`mothed="By.XPATH"`/`screenshot=[]`空数组/`rect`=坐标或`{}`/`realLabel`承接原 label 值。`id`/`pid`/`label` 三字段改名：`id`→`propertiesID`（字符串顺序号，截图先占 `"1"`..`"N"`，控件续接 `"N+1"`..）、`pid`→`propertiesPID`（字符串，控件指向所属截图条目的 propertiesID；截图=`"0"`）、`label`→`realLabel`（承接原 label 语义）；移除 `scanIndex`、移除 `step-N`/`page-N` 前缀；控件→截图关联键由 `propertiesPID` 指向截图 `propertiesID`（字符串相等，取代旧 `pid==="page-N"`===`screenshot.key`）。`rect`/`realLabel`/`regionId`/`regionLabel`/`screenshot` 统一恒有（无值给 `{}`/`""`/`[]`，旧实现是条件 omit）。弹窗关联键修正：`idByDialog` 用弹窗标题（`name`/`dialogTitle`）而非 `dialogKey`，与控件侧 `overlay.label` 对齐。
  影响范围：V3 导出服务契约（`payload` 只含 `transcationEventTypeList`；`transcationProperties[]` 统一 schema，截图+控件同构；`id`/`pid`/`label` 改名 `propertiesID`/`propertiesPID`/`realLabel`）、V3 批量路由（`okBuilt` 去掉 `screenshots` 字段）、API docs、characterization。无 schema/WS 变更；V2 不受影响（V2 精简版本无 screenshots）。
  文件：src/services/transaction-export-v3.js, src/routes/v2/export-mgmt.js, src/dashboard/api-docs/groups/export-mgmt.js, scripts/characterization/characterize-export-v3.mjs, scripts/characterization/characterize-dialog-screenshot.mjs

- 2026-08-19: **V3 批量推送 payload.screenshots 字段变更**（已被上一条"截图合并进 transcationProperties"取代，保留作历史记录）：每个截图条目改为只给一个永久有效的 `url`（MinIO 公网直链，bucket `uara-step-phase-picture` 已设公开读策略，匿名可访问），消费方直接用该 url 访问图片，无需 MinIO SDK / 预签名。去掉此前的 `bucket`+`file` 方案与 `expires` 字段。`url` 取值：优先用 `screenshot.image_url`（上传时由 `uploadScreenshot` 存的公网直链），缺失时用 `MINIO_PUBLIC_URL + MINIO_BUCKET + storage_path` 兜底拼接。`buildV3Screenshots` 守卫：拿不到 url 的截图（本地暂存未上传且无公网直链兜底）被跳过。同步移除配置 `PUSH_V3_SCREENSHOT_BUCKET` / `PUSH_V3_SCREENSHOT_EXPIRES`（bucket 统一来自 `MINIO_BUCKET`；截图 URL 现在是永久直链，不再有"有效期"概念）。
  影响范围：V3 导出服务契约（`payload.screenshots[]` 结构：`{ phaseNumber, type, key, name, url }`，批量再加 `trajectoryId`，无 `bucket`/`file`/`expires`）、screenshot DAO（`listPhaseHighlightsByTrajectory` / `listDialogScreenshotsByTrajectory` 新增返回 `storagePath`/`storageType`/`imageUrl`）、config（移除两个 `PUSH_V3_SCREENSHOT_*`）、API docs、characterization。无 schema/WS 变更；V2 不受影响。
  文件：src/services/transaction-export-v3.js, src/dao/screenshot-dao.js, config/config.js, config/.env.example, src/dashboard/api-docs/groups/export-mgmt.js, scripts/characterization/characterize-export-v3.mjs, scripts/characterization/characterize-dialog-screenshot.mjs

### Added

- 2026-08-19: **待上传截图一键补传**：新增 `POST /api/v2/screenshots/pending/upload`（立即把全部 `storage_type='local'` 待传项推送到 MinIO，忽略重试间隔与已达 `SCREENSHOT_MAX_RETRY` 上限，返回 `{scanned,uploaded,failed,skipped}`）与 `POST /api/v2/screenshots/:id/upload`（单行补传）。`screenshot-service.js` 新增 `uploadPendingScreenshots()` / `uploadPendingScreenshot(id)`（复用 `retryPendingScreenshots` 的上传+DB 标记+删本地文件链路；单行补传失败回滚已上传的 MinIO 对象）。API docs 新增「待上传截图」实时面板（`monitor` 组）：列表展示 `GET /api/v2/screenshots/pending` 的待传项（ID/类型/归属/MIME/大小/重试次数/上次重试/创建时间），支持「一键上传全部」「单行上传」「预览」「删除」「每 5s 自动刷新」。
  影响范围：新增路由（`/api/v2/screenshots/pending/upload`、`/api/v2/screenshots/:id/upload`）、截图服务、API docs 前端（catalog 新增 `GROUP_PENDING_SCREENSHOTS` + `pending-screenshots.js` 挂载模块 + app.js 分发 + css）。
  文件：src/routes/v2/screenshot.js, src/services/screenshot-service.js, src/dashboard/api-docs/catalog.js, src/dashboard/api-docs/app.js, src/dashboard/api-docs/pending-screenshots.js, src/dashboard/api-docs/api-docs.css

- 2026-08-19: **MinIO bucket 配置**：`config/.env` 启用 MinIO（`MINIO_HOST=http://172.19.87.169:9001`、`MINIO_ACCESS_KEY=admin`、`MINIO_SECRET_KEY=tansun@123`、`MINIO_BUCKET=uara-step-phase-picture`、`MINIO_PUBLIC_URL=http://172.19.87.169:9001`）。bucket 由 `ensureBucket()` 首次上传时自动创建（无需手工建桶）。`isMinioConfigured()` 由 false 变 true，截图走 MinIO 而非本地暂存；存量 `storage_type='local'` 行由后台重试循环或新增一键补传端点处理。
  影响范围：仅 `config/.env`（运行环境配置，不入 schema/路由/WS 契约）。
  文件：config/.env

- 2026-08-19: **补齐 MinIO 依赖**：将 `minio`（`^8.0.7`）加入 `package.json` 并安装，修复 `npm start` 启动时报 `ERR_MODULE_NOT_FOUND: Cannot find package 'minio'`（`src/services/minio-service.js` 顶层 `import { Client } from 'minio'` 无法解析）。不影响 schema/路由/WS；`package-lock.json` 同步更新。
  影响范围：依赖声明（`package.json` / `package-lock.json`）。
  文件：package.json, package-lock.json

- 2026-08-19: **批量任务名候选接口 + 存量文件名乱码修复**：新增 `GET /api/v2/trajectories/batch/names`（functionId + keyword 模糊去重、最近创建优先、按 paasUserId 隔离空=全可见、limit 默认 20 最大 100；注册在 `batch/:batchId` 之前）——交易列表页「按任务名筛选」搜索下拉的选项源。另新增迁移 `20260819000000_fix_batch_job_name_mojibake.js`：修复 `batch_recording_job` 存量 5 行 `name`/`original_filename` 的 mojibake（UTF-8 字节被 latin1 解码，如「批量录制导入模板.xlsx」存成 `æ¹éå¶å¯¼å¥æ¨¡æ¿.xlsx`；运行时链路已由 `decodeUploadFilename` 修复，本迁移只修存量，幂等）。
  影响范围：新增路由（/api/v2/trajectories/batch/names）、存量数据修复（batch_recording_job.name/original_filename）。
  文件：src/routes/v2/trajectory-batch.js, src/services/trajectory/trajectory-batch-service.js, src/dao/batch-recording-dao.js, migrations/20260819000000_fix_batch_job_name_mojibake.js, src/dashboard/api-docs/groups/trajectory.js, scripts/characterization/characterize-batch-task-name.mjs

- 2026-08-18: **截图上传失败本地暂存与自动补传**：MinIO 上传失败时，截图先写入本地 `tmp/pending-screenshots/`，DB 标记 `storage_type='local'`；后台每 3 分钟扫描一次，最多重试 3 次，补传成功后删除本地文件并更新为 `storage_type='minio'`。新增 `GET /api/v2/screenshots/pending` 待补传截图列表；`GET /api/v2/screenshots/:id/image` 支持从本地暂存文件读取；删除截图/步骤/阶段/轨迹时同步清理本地文件。
  影响范围：schema（新增 `retry_count` / `last_retry_at`，截图存储改为 `storage_type` / `storage_path` / `image_url`）、config（新增 `MINIO_*` / `SCREENSHOT_PENDING_*`）、截图服务/路由/API docs、server 启动重试任务。
  文件：migrations/20260819000000_screenshot_minio_storage.js, migrations/20260819000001_screenshot_pending_upload.js, schemas/init.sql, config/config.js, config/.env.example, src/services/minio-service.js, src/services/screenshot-pending-store.js, src/services/screenshot-pending-retry.js, src/services/screenshot-service.js, src/dao/screenshot-dao.js, src/routes/v2/screenshot.js, src/dashboard/api-docs/groups/remote.js, server.mjs, scripts/models/entity/screenshot_entity.py


- 2026-08-18: **弹窗独立截图采集**：录制时检测到 `overlay:` 弹窗操作，实时采集弹窗可视区域截图；复用现有 `screenshot` 表（`kind='phase_highlight'` + `trajectory_step_id` + `metadata_json.dialog=true`），不新增数据库字段。V3 推送 `payload.screenshots` 支持 `type:'dialog'`，弹窗控件 `pid` 与 dialog key 对应，有 dialog 截图时 `rect` 相对弹窗截图。
  影响范围：Python 录制截图链路、Node screenshot DAO/service、V3 导出、API 文档、characterization。
  文件：scripts/state.py, scripts/controller/service.py, scripts/manual_recorder/recorder.py, src/dao/screenshot-dao.js, src/services/screenshot-service.js, src/routes/browser-session/persist-live.js, src/services/trajectory/trajectory-recording-runner.js, src/services/transaction-export-v3.js, src/routes/v2/export-mgmt.js, src/dashboard/api-docs/groups/export-mgmt.js, scripts/characterization/characterize-dialog-screenshot.mjs, scripts/refactor/verify-all.sh

- 2026-08-18: **批量推送 V3 结构优化（去重）**：移除 `result.groups` 双轨结构，改为 `payload.screenshots` + `transcationProperties` 单轨。`transcationProperties` 在 V2 五个核心字段基础上增加 `id` / `pid` / `label` / `regionId` / `regionLabel` / `rect` / `scanIndex`；属性中不再重复输出 `url`，通过 `pid` 关联 `payload.screenshots`。新增配置 `PUSH_V3_SCREENSHOT_BUCKET` / `PUSH_V3_SCREENSHOT_EXPIRES`。删除 `recorded` / `manualRecord` / `targetType` / `group` / `anchorTarget` 等冗余字段。
  影响范围：V3 导出服务/路由/API 文档/characterization；无 V2 影响。
  文件：src/services/transaction-export-v3.js, src/dashboard/api-docs/groups/export-mgmt.js, scripts/characterization/characterize-export-v3.mjs, config/config.js, config/.env.example

- 2026-08-18: **V2 批量推送精简（消费方格式对齐）**：`transcationProperties` 条目不再含 `regionId`/`parentRegionId`；entry 不再含 `phases`（阶段截图引用 + 全量元素 metadata）——控件点亮能力由 V3.0 `result.groups` 承担。V2 端点/响应结构其余不变（外层 `payload.transcationEventTypeList`/count/skipped/stats）。
  影响范围：src/services/transaction-export.js（`mapStepToTransactionEvent` 去 region 字段、`buildTransactionEntry` 去 phases、删除 `buildTransactionPhases`、`TRANSACTION_ENVELOPE_FIELDS` 精简）、src/routes/v2/export-mgmt.js（V2 组装不再查 phase/screenshot）、api-docs、characterize-transaction-export-region 重写为精简断言。无 schema/WS 变更。
  文件：src/services/transaction-export.js, src/routes/v2/export-mgmt.js, src/dashboard/api-docs/groups/export-mgmt.js, scripts/characterization/characterize-transaction-export-region.mjs

- 2026-08-18: **批量推送 V3.0（阶段长图控件点亮，对齐消费方 groups 约定）**：新增 `src/services/transaction-export-v3.js` + 3 个端点（`GET/POST /api/v2/export/trajectories/:id/transaction-v3`、`POST /api/v2/export/transactions-v3`，V2.0 保留）。entry 新增 `result`：`{id, name, url, groups[]}`——页面组（**一张长图=一个页面组**，`page-<n>` 平级，`screenshots[]={phaseNumber,url}` 无尺寸字段，前端按图片自然尺寸计算）+ 弹窗组（region_id 含 `overlay:` 段归属，弹窗=独立页面，`key` 带 `@@anchor=<触发按钮xpath>`，anchor 按步骤序推断前置按钮步骤）+ 控件节点（`id=step-<n>` 全局唯一、`rect`=element_json.bbox 内容坐标与长图同根、target/kind/params 映射、pid 树）。`transcationProperties` 保留（控件组语义）。无坐标步骤省略 rect（stats.noRectControls）。
  影响范围：路由（src/routes/v2/export-mgmt.js 新增 3 端点）、服务（新增 src/services/transaction-export-v3.js，复用 V2.0 mapStepToTransactionEvent/uniquifyPropertiesNames）、api-docs（export-mgmt 分组登记 V3 端点）。无 schema/WS 变更。
  文件：src/services/transaction-export-v3.js, src/routes/v2/export-mgmt.js, src/dashboard/api-docs/groups/export-mgmt.js, scripts/characterization/characterize-export-v3.mjs, scripts/refactor/verify-all.sh

- 2026-08-17: **点击导航识别（AI_CLICK_NAV_CUE，默认开）**：`click_element_by_index` 点击后若 URL 跳转，recorder 注入一条 `[导航]` HumanMessage，提示“已进入目标页、停止找同一按钮、直接填表/保存”；recorder goal 闸门停机前先提示核查 URL 是否已跳转。录制步骤结果仍为 `ok-clicked-N`，不污染轨迹。
  影响范围：仅 Python 子进程录制内的点击导航提示与 goal 停机兜底；无路由/schema/WS 变更。
  文件：config/.env.example, scripts/feature_flags.py, scripts/controller/actions/click_navigation_cue.py, scripts/controller/actions/_misc.py, scripts/agent/recorder_emitters.py, scripts/recorder.py, scripts/controller/actions/phase/intent_contract.py, scripts/characterization/characterize-click-navigation-cue.py

- 2026-08-17: **SSO 接入 + /api/v2 用户隔离（paasUserId）**：新增 `src/middleware/sso-auth.js` 鉴权中间件（仅 `/api/v2/*`，白名单 `/api/v2/auth/*`；`SSO_AUTH_REQUIRED=false` 默认关，关时无 token 也放行、`req.paasUserId=null` 全可见，向后兼容；开时无 token 或 token 无法解码 → 401，走 v2 envelope 包成 `{code:401}`）。新增 `src/services/sso/jwt-decode.js` 纯解账号中心 HS256 JWT payload 拿 `paasUserId`（19 位 long 用正则从原文提取数字串，**不验签、不调账号中心校验**，与已上线产品取法一致）。新增 `src/routes/v2/auth.js`：`GET /api/v2/auth/sso/login-page`、`GET /api/v2/auth/sso/logout-page`、`GET /api/v2/auth/me`、`GET /api/v2/auth/sso/check`（appKey 固定 `1920710182837141505`，回跳地址取 query `uiPath`/`redirect` 或请求 host）。`trajectory` / `batch_recording_job` 加 `paas_user_id VARCHAR(32) NULL`（空=无主=全可见，存量兼容；PR-SSO-ADMIN 出结论后再收紧）。trajectory `save/list/listByFunction/countByRecordStatus` + batch `createJob`/`importBatchFromExcel`/`getBatchJobView` 注入 `paasUserId`（写入盖章 + 列表过滤 + view 归属校验：幂等 key 跨用户复用返回 409、view 跨用户访问返回 404）；`POST/GET /api/v2/trajectories` 与 `POST /api/v2/trajectories/batch/import`、`GET /api/v2/trajectories/batch/:batchId` 从 `req.paasUserId` 透传。前端（另仓 vue-project）：`api/sso/sso.ts` 占位路径改打真实 `/v2/auth/*` + 新增 `getMe`；`stores/sso.ts` 取消硬编码 loginUrl/logoutUrl 改调后端；新增 `stores/user.ts`（paasUserId）；`permission.ts` 拿到 token 后拉 `/me`；`request.ts` 加 401 清 token 回首页；`AppHeader.vue` 用户名改显 `paasUserId`；`stores/batchImport.ts` 任务 key 按 paasUserId 命名空间。
  影响范围：schema（迁移 `20260818000000_paas_user_id`，旧库执行 migrate 后生效；新库 init.sql 同步）、config（新增 `SSO_APP_KEY`/`SSO_BASE_URL`/`SSO_AUTH_REQUIRED`）、src/middleware、src/routes/v2（__init__ 挂载顺序：v2ResponseEnvelope → ssoAuth → registerAuth → 业务路由）、src/dao、src/services/trajectory、src/dashboard/api-docs（新增 auth 分组）。`/api/v2/*` 之外端点（/api/browser/*、/api/test/*、/api/agent、/v1/*、/ws*、/api/setup*、/api/health）本周不鉴权。
  文件：migrations/20260818000000_paas_user_id.js, schemas/init.sql, config/config.js, config/.env.example, src/middleware/sso-auth.js, src/routes/v2/__init__.js, src/routes/v2/auth.js, src/services/sso/jwt-decode.js, src/dao/trajectory-dao.js, src/dao/batch-recording-dao.js, src/services/trajectory/trajectory-meta-service.js, src/services/trajectory/trajectory-batch-service.js, src/routes/v2/trajectory.js, src/routes/v2/trajectory-batch.js, src/dashboard/api-docs/groups/auth.js, src/dashboard/api-docs/catalog.js

- 2026-08-16: **步骤编辑/移动闸对齐 AI 活跃**：纯观看占位（recordStatus=recording 且非 AI 录制）放开步骤编辑/移动；后端步骤更新、删除、移动在 AI 录制活跃（phase.status='running'）时 409；清空步骤由前端在 AI 录制中禁用（后端 clear 无闸）。确认/推送/record-start 闸不变。
  影响范围：步骤更新/删除/移动的闸门语义（纯观看占位从 409 变为放行；新增 AI 活跃 409 覆盖更新/删除路径）；步骤 CRUD 路由错误码改为透传 statusCode（原硬编码 500）。
  文件：src/services/trajectory/trajectory-step-service.js, src/routes/v2/trajectory-steps.js, src/routes/v2/trajectory-record.js, src/dashboard/api-docs/groups/recording.js, scripts/characterization/characterize-step-move.mjs, scripts/characterization/characterize-record-status-v2.mjs

- 2026-08-16: **AI 录制重复失败动作纠偏开关（Python 侧，默认关闭）**：新增 `AI_DUP_FAILURE_CUE=false`；开启后，连续 2 步「动作+参数完全相同且结果均 err-」时，recorder 向 Agent 注入一条 `[纠偏]` HumanMessage 处方（按错误码给建议，每阶段每签名只注入一次）。默认关闭，现有录制行为不变。
  影响范围：仅 Python 子进程录制运行时的可选行为开关；无路由/schema/WS 变更。
  文件：config/.env.example, scripts/feature_flags.py, scripts/controller/actions/duplicate_failure_cue.py, scripts/agent/recorder_emitters.py, scripts/recorder.py, scripts/controller/actions/phase/intent_contract.py, scripts/characterization/characterize-duplicate-failure-cue.py, scripts/refactor/verify-all.sh

### Changed

- 2026-08-18: **SSO 验签 + /me 回查用户信息**：`ssoAuth` 中间件改为异步验签——密钥来自账号中心 `query_jwt_secret`（实测返回 `paas-application`，Base64 解码作 HMAC-SHA256 key，与账号中心 Java SDK `JWTUtil.verifyJWT` 一致），内存缓存 1h；配置 `SSO_JWT_SECRET` 可直接指定密钥不调接口。验签失败 → token 无效（`SSO_AUTH_REQUIRED=true` 时 401，伪造 token 不再被信任）；密钥不可用（账号中心不可达）→ 降级纯解 payload 保持可用性。`GET /api/v2/auth/me` 增强：带有效 token 时回查账号中心 `query_access_user`（对应 SDK `AccessUserContext.getCurrentUser()`），返回 `userName`/`userAccount`（如 管理员/admin），查询失败返回 null 不阻塞。
  影响范围：/api/v2/* 鉴权行为（验签）、`/api/v2/auth/me` 响应体（新增 userName/userAccount 字段）、config（新增 `SSO_JWT_SECRET`）。
  文件：src/services/sso/jwt-decode.js, src/services/sso/paas-client.js(新), src/middleware/sso-auth.js, src/routes/v2/auth.js, config/config.js, config/.env.example, scripts/characterization/characterize-sso-auth.mjs

- 2026-08-18: **交易轨迹列表状态统计随查询条件过滤**：`GET /api/v2/trajectories` 返回的 `stats` 五档统计（draft/recording/failed/recorded/completed）与行查询同基准——新增按当前 `recordStatus` 过滤（原来忽略该条件恒展示功能全量统计，现与 keyword/batchTaskName/functionId 一并作为统计基准）。例如查询条件设为「未录制」时，`stats` 中仅 draft 有值、其余为 0、total=筛选行数。行数据沿用 `bj.name as batchTaskName`（所属任务）。
   影响范围：src/dao/trajectory-dao.js（`countByRecordStatus` 接受并应用 `recordStatus`；`list`/`listByFunction` 向统计透传 `recordStatus`）；无路由路径/响应字段增减（`stats` 结构不变）、无 schema/WS 变更。
   文件：src/dao/trajectory-dao.js, scripts/characterization/characterize-batch-task-name.mjs, scripts/characterization/characterize-sso-auth.mjs（stats 调用签名断言同步新增 `recordStatus` 参数）

- 2026-08-17: **element_json bbox 落库补全（Node 侧）**：Python 侧 ElementInfo/from_record 已透传 region/layers/bbox，但 Node 侧 `copyLocatorMeta` 漏 bbox，直播录制持久化时步骤坐标被丢弃；补全 bbox 复制。新录制 element_json 完整含 region_id/region_label/layers[]/bbox。
  影响范围：src/models/element.js（录制落库归一化）；无路由/schema/WS 变更。
  文件：src/models/element.js, scripts/characterization/characterize-step-region-bbox.py

- 2026-08-17: **阶段长图 DPR 拼接**：`runPhaseScreenshotCapture` 滚动步进改用 CSS 片高（`box.height - 48`），stitch overlap 按 `h0 / box.height` 把 CSS 位移换成设备像素。修复 Windows DPR=1.5 时把 PNG 高当 scrollTop 导致每片漏 ~0.5 屏、长图错位/重复条带。
  影响范围：阶段长图捕获几何（Node 控制面与 executor BiB CDP 共用 `src/cdp/phase-screenshot-capture.js`）；无路由/schema/WS 变更。
  文件：src/cdp/phase-screenshot-capture.js, scripts/characterization/characterize-phase-highlight-screenshot.mjs

- 2026-08-17: **单阶段录制步数上限配置化**：`trajectory-recording-runner` 每阶段 `max_steps` 由硬编码 30 改为 `PHASE_MAX_STEPS`（默认 300，环境变量可调）。长表单（如 120 字段）不再因 ceiling 截断；短阶段仍由 phase reviewer 估算下压（`resolve_phase_max_steps` 不超 ceiling）。
  影响范围：config（新增 `PHASE_MAX_STEPS`）、src/services/trajectory（录制主循环步数上限）。
  文件：config/config.js, config/.env.example, src/services/trajectory/trajectory-recording-runner.js

- 2026-08-17: **步骤 element 分层 + 坐标入库**：录制时 `_capture_element`/`_enrich_click_element` 对操作控件 evaluate `assignRegion`（分层）+ `stepBBoxOf`（内容坐标，复用泛化 `pickScrollRoot`），`element_json` 新增 `region_id`/`region_label`/`layers[]`/`bbox{x1,y1,x2,y2}`（内容坐标系，对齐阶段截图 `metadata.rect`）。元素分层可直接读 step；步骤级高亮（PR-LOC-HL）用 bbox 画框。只影响新录制，存量不回填。`PAGE_LOCATOR_HELPERS` 新增 `pickScrollRoot`/`stepBBoxOf`，阶段截图 collect 表达式去重共用。
  影响范围：录制链路（scripts/controller/actions）、`_locator_helpers_js.py`（重生成）、element_json 新增字段（无 schema）。
  文件：src/cdp/page-locator-helpers.js, src/cdp/phase-screenshot-page.js, scripts/controller/actions/js_snippets/{fill_core,enrich}.py, scripts/controller/actions/_helpers.py, scripts/controller/actions/js_snippets/_locator_helpers_js.py, scripts/characterization/characterize-step-region-bbox.py

- 2026-08-17: **分区算法：页面级裸按钮不再继承 titlebox（PR-PART 修正）**：`composeTitleboxTitle` 新增 `isBareActionButton` 前置判定——`BUTTON`/`.el-button` 且不在 `.el-collapse-item`/`.titlebox`/`.el-table` 内（页面级操作按钮，如向导/页签底部 fixed 操作条）时跳过 titlebox 几何就近继承，保留 chrome（tab/向导）与 collapse section 段。修复对公客户评级页「下一步/返回 被归入 基本信息/征信信息」问题：现为 `wizard:基本信息`（layers 仅 `[{wizard,基本信息}]`）。表单字段行为不变（字段不在 titlebox 内仍几何就近）；collapse/table 内按钮不受影响。
  影响范围：`PAGE_LOCATOR_HELPERS` 的 `assignRegion` 对页面级裸按钮的 `region_label`/`region_id`/`layers` 输出（SPA `display_group` 随之变化）；Python 镜像 `_locator_helpers_js.py` 已重新生成。
  文件：src/cdp/page-locator-helpers.js, scripts/controller/actions/js_snippets/_locator_helpers_js.py（生成物）, scripts/characterization/characterize-partition-compose.mjs（新增固定底栏按钮用例、`#float-back` 断言改为不继承）, scripts/characterization/characterize-scan-assign-region-once.py（过期断言修正：`xpath_smart_fill_only_enabled` 闸门已从 `_form.py` 移至 `form_action_engines.py`，既有漂移与本次改动无关）

- 2026-08-17: **存量数据回填 paas_user_id**：`trajectory`（95 行）与 `batch_recording_job`（18 行）中 `paas_user_id IS NULL` 的存量行全部回填为 `1510076810578644992`（账号中心 admin）。迁移 `20260818120000_backfill_trajectory_paas_user_id.js`（幂等：只回填 NULL 行；down 为 no-op，数据回填不可逆）。回填后存量交易/批量导入任务归属 admin，隔离语义从「空=全可见」变为「归 admin」。
  影响范围：存量数据归属（无 schema 变更）。
  文件：migrations/20260818120000_backfill_trajectory_paas_user_id.js

- 2026-08-17: **system_account.username 更名 account + 系统节点批量账号维护**：`system_account.username` 物理列更名为 `account`（新增迁移，旧库执行 migrate 后生效，新库 init.sql 直接建为 account；API/实体字段同步由 username 改为 account）。`POST /api/v2/system-mgmt/nodes` 在 type=1 时支持 `accounts[]` 一次创建多个系统账号；`PUT /api/v2/system-mgmt/nodes/{id}` 支持 `accounts[]` 全量替换该系统账号（按 id 更新、无 id 按 name 匹配、未出现的老账号删除；不传 accounts 不动账号；账号被 batch_recording_job 引用时删除返回 409）。账号字段 account/password 接受数字并落库为字符串。
  影响范围：system_account 表结构（需跑迁移）、系统账号 API 请求/响应字段 username → account、系统节点 POST/PUT 请求体新增可选 accounts[]（非 type=1 传 accounts 返回 400）。
  文件：migrations/20260817000000_system_account_rename_username_to_account.js, schemas/init.sql, src/services/system-account-service.js, src/services/hierarchy-service.js, src/services/trajectory/trajectory-account-service.js, src/services/trajectory/trajectory-record-lifecycle.js, src/dao/system-dao.js, src/dao/system-account-dao.js, src/models/entities.js, src/routes/v2/system-mgmt.js, src/dashboard/api-docs/groups/overview.js, src/dashboard/api-docs/groups/hierarchy.js, src/dashboard/api-docs/groups/recording.js, scripts/models/entity/system_account_entity.py, scripts/characterization/characterize-system-node-accounts.mjs, scripts/characterization/characterize-trajectory.mjs

- 2026-08-15: **Heal-Locate Phase 1 MVP**：新增 Node 侧纯函数规则引擎 `missing-reason-analyzer.js` 与 `heal-contract.js`（失败原因分类 → HealContract：mode/scope/strategy/reason/target/runtime，prompt 与 runtime 分离）；Type A/B heal instruction 旧文本末尾追加【失败分析】结构化段落；`runHealStep` forward 载荷新增 `heal_contract`，`instruction/max_steps/phase_number/heal_type/healType` 旧字段原样保留；`session.step` 在控制面与执行机两处白名单同步透传 `heal_contract`；Python 侧解析 contract 并让 heal 模式只装配 `agent-core.md + agent-tools-common.md + agent-tools-heal.md`。
  影响范围：live replay heal 指令内容（旧文本不变，仅追加分析段）、`session.step` 载荷新增可选字段（WS 事件名与旧字段不变）、Python Agent heal 模式 system prompt 收窄。
  文件：src/services/trajectory/missing-reason-analyzer.js, src/services/trajectory/heal-contract.js, src/services/trajectory/replay-batch-runner.js, src/services/trajectory/form-structure-heal.js, src/services/trajectory/replay-heal-shared.js, src/routes/browser-session/heal-instruction.js, src/executor-session-client.js, executor/session-handler.js, scripts/controller/actions/phase/prompts.py, scripts/agent/service.py, scripts/agent_utils.py, scripts/prompts/agent-tools-heal.md, scripts/characterization/characterize-heal-locate.mjs, scripts/characterization/characterize-heal-mode.py, scripts/refactor/verify-all.sh, docs/superpowers/specs/2026-08-15-heal-locate-current-analysis.md

- 2026-08-15: **Heal-Locate P2 决策路由（默认关闭）**：新增 `HEAL_LOCATE_DECISION_ENABLED=1` 开关；开启后 Type A 按 `suggestedAction` 走 skip（标记 confirmed=0 后继续）/ fail（不进 AI heal，直接结束批次）/ retry（按 `runtime.retry_count` 有限重放当前步，仍失败再落 AI heal）。默认关闭时控制流与 Phase 1 完全一致。
  影响范围：仅 `src/services/trajectory/replay-batch-runner.js` Type A 失败路径；无 schema、无路由、无 WS 消息名变更。
  文件：src/services/trajectory/heal-decision.js, src/services/trajectory/replay-batch-runner.js, scripts/characterization/characterize-heal-decision.mjs, scripts/refactor/verify-all.sh

- 2026-08-15: **trajectory-* 服务归位**：9 个平铺服务（account/batch-excel/idle-reaper/phase/query/recording/runtime/step-move/step）迁入 `src/services/trajectory/`；`src/services/trajectory-service.js` 保持纯 re-export facade，所有消费方 import 路径同步更新。
  影响范围：src/services 组织变化（无路由、无 schema、无响应格式变更）。
  文件：src/services/trajectory-service.js, src/services/trajectory/*, src/services/special-element-service.js, src/services/session-lifecycle.js, src/services/remote-session-service.js, src/routes/v2/trajectory-batch.js, src/cdp/remote-bridge/ws-router.js, server.mjs, scripts/characterization/*.mjs

- 2026-08-15: **sys-msg 服务归位 + 常量下沉**：`sys-msg-service.js`/`sys-msg-compose.js` 迁入 `src/services/sys-msg/` 并新增 barrel；6 个 sys_msg 常量下沉到 `src/models/constants.js`（`sys-msg.js` 保留 re-export shim，compose 保留常量转发 export）。
  影响范围：src/services/sys-msg 组织与 constants 单一来源；无路由/schema 变更。
  文件：src/services/sys-msg/*, src/models/constants.js, src/models/sys-msg.js, src/dao/sys-msg-dao.js, src/routes/v2/messages.js, src/services/trajectory/trajectory-batch-service.js, scripts/characterization/characterize-sys-msg.mjs



- 2026-08-15: 阶段截图 V2：phase_done 长图不再烘焙元素高亮；`screenshot.metadata_json` 记录截图长宽 + 全部可见 L2 控件坐标（拼接图内容坐标）+ region_tree；录制链路 `capturePhaseHighlightScreenshot` → `capturePhaseScreenshot`。
  影响范围：src/services/trajectory 录制链路、executor `session.bib_phase_highlight_capture`（消息名不变，payload `hitCount` → `meta`）。
  文件：src/dao/screenshot-dao.js, src/services/screenshot-service.js, src/services/trajectory/phase-highlight-screenshot.js, src/services/trajectory/trajectory-recording-runner.js, src/models/phase-highlight-targets.js（删除）, scripts/characterization/characterize-phase-highlight-screenshot.mjs

- 2026-08-15: **导出/推送 envelope V2（schemaVersion 2）**：每个 `transcationProperties` 项新增 `regionId`/`parentRegionId`（层级作证，空串兜底）；每交易新增 `phases[]`（phaseId/phaseNumber/screenshotId/stitchScreenshotUrl/metadata）。
  影响范围：src/routes/v2/export-mgmt、src/services/transaction-export、api-docs 契约。
  文件：src/services/transaction-export.js, src/routes/v2/export-mgmt.js, src/dashboard/api-docs/groups/export-mgmt.js, scripts/characterization/characterize-transaction-export-region.mjs

- 2026-08-13: **分区拼接（tab / 向导 / titlebox）**：`assignRegion` 在 overlay/表格/待办/壳短路之后，把内容 tab 或向导当前步、collapse、最近 titlebox 拼成 `region_label`（` / `）与 `region_id`（`|`）；collapse 标题剥尾部动作字。撞车 refine 不再把路径打回单独 titlebox。`display_group` 仍等于中文路径。
  影响范围：扫描 / resolve / 录制 `element_json` 的 `region_*` 与 `display_group`；无 schema。
  文件：src/cdp/page-locator-helpers.js, src/cdp/display-group.js, src/cdp/resolve-by-label.js, src/models/element.js

- 2026-08-13: **阶段长图控件高亮**：由纯描边改为 Chrome 审查元素风格（框内浅蓝色半透明蒙层 + 蓝色 outline）。不改 layout。
  影响范围：phase_done 拼接截图观感。
  文件：src/cdp/phase-highlight-page.js

- 2026-08-13: **prepare 登录硬编码**：`record/prepare`（及 `record/start` 未登录兜底）改为 `replay_actions`：`go_to_url` + `login(username, password)`，不再发 `session.step` 启动 browser-use；失败（导航/填表/按钮）使 prepare 失败。登录仍不写入 `trajectory_step`。
  影响范围：service（prepare/start 登录）、scripts（`login()` 失败返回 `err-login`）、api-docs。
  文件：src/services/trajectory/trajectory-record-lifecycle.js, scripts/controller/actions/_form.py, src/dashboard/api-docs/groups/recording.js, scripts/characterization/characterize-trajectory.mjs, characterize-login-action.py

### Fixed

- 2026-08-17: **阶段长图内部滚动容器漏截（瀑布流）**：`pickScrollRoot` 只认 `.el-main`/`.app-main`，页面主文档不滚动、内容在非标准 class 的内部滚动容器（如 `.plugin-content-list`，el-scrollbar 内容容器，scrollHeight 6554 / clientHeight 659）时回退 `document`（不滚动）→ 长图只截一屏、瀑布流内容丢失。修复：`pickScrollRoot` 泛化——标准主区优先，否则扫描全页 `div/main/section/article` 中 `overflowY∈{auto,scroll}` 且确实可滚动的容器，选 `scrollHeight` 最大的作为滚动根（`phase-screenshot-page.js` scroll/collect 两处共用同一逻辑）。真实页面湿测：选中 `.plugin-content-list`（6554>659），坐标 box 正确。
  影响范围：阶段长图拼接（src/cdp）；无 schema/HTTP。
  文件：src/cdp/phase-screenshot-page.js, scripts/characterization/characterize-phase-highlight-screenshot.mjs

- 2026-08-17: **执行机 slot 复用失效（控制面重启后重连开新 slot）**：`supersedeStaleForTrajectory` 清理旧 remote_session 时只做 DB 侧处理（detachLive 停 BiB + close 行 + unmount），未关闭执行机上对应的 agent session——Python 进程与 Chrome 继续存活、slot 持续占用，`listCdp` 的 `occupiedCdpPorts` 把旧 CDP 端口排除出孤儿 Chrome 扫描，`preferIdleChrome` 复用失败，重新 prepare 时**新开 slot**，旧 Chrome 变成无法接管的孤儿（"连不上之前断开的"）。修复：supersede 关闭 DB 行后补 `closeExecutorSession({nodeUuid, sessionId: agentSessionId, keepBrowser: true, timeoutMs: 2000})`——杀 Python 释放 slot，**保留 Chrome 在 CDP 端口**，下次 attach 的孤儿扫描能发现并复用同一个浏览器（页面/登录态保留）；`closeSession` 新增可选 `timeoutMs` 参数（默认 15000 不变；执行机对未知 session 不发 `session.closed` 事件，supersede 用 2000 短超时避免 prepare 卡顿）。
  影响范围：src/services/remote-session-service.js（supersede 行为）、src/executor-session-client.js（closeSession 新增可选参数，默认不变）。
  文件：src/services/remote-session-service.js, src/executor-session-client.js, scripts/characterization/characterize-session-lifecycle.mjs

- 2026-08-17: **节点详情接口回显系统账号**：`GET /api/v2/system-mgmt/nodes/:id` 此前只返回节点本身（`getNode` 仅 `systemDao.getById`），type=1 系统节点详情不回显 `accounts[]`，编辑表单若用详情接口将拿不到已有账号。现在 type=1 节点详情附带 `accounts[]`（形状与 tree `includeAccounts` 一致：id/name/account/password/loginUrl/remark/sortOrder）。
  影响范围：`GET /api/v2/system-mgmt/nodes/:id` 响应体（type=1 节点新增 accounts 字段；无 schema/HTTP 路径变更）。
  文件：src/services/hierarchy-service.js, scripts/characterization/characterize-system-node-accounts.mjs

- 2026-08-17: **批量导入生成的交易漏盖 paasUserId**：`batch-analyze.js` 的 `createDraftFromAnalyzed` 创建交易时未透传 `job.paasUserId`，导致批量导入任务归了用户、任务生成的交易 `paas_user_id` 为 NULL（无主全可见），隔离失效。现在透传 `paasUserId: job.paasUserId || null`，交易与任务归属一致。
  影响范围：批量导入 analyze 链路新建交易的用户归属（无 schema/HTTP 变更）。
  文件：src/services/trajectory/batch-analyze.js, scripts/characterization/characterize-sso-auth.mjs

- 2026-08-15: **分区 compose 继承修复**：浮动/固定操作条（如底部「返回」按钮）位于 tab pane 之外时 chrome/section 丢失、region 退化为单 titlebox 段；现在从几何就近 titlebox 自身的上下文继承 chrome+section，得到完整 `tab|section|titlebox` 路径（与同 titlebox 内按钮一致）。
  影响范围：assignRegion / composeContentRegion（src/cdp）、resolve/扫描/录制 `element_json`、`_locator_helpers_js.py`（重生成）。
  文件：src/cdp/page-locator-helpers.js, scripts/controller/actions/js_snippets/_locator_helpers_js.py, scripts/characterization/characterize-partition-compose.mjs

- 2026-08-15: **阶段截图坐标几何修正**（final review I1/I2）：捕获 clip 到滚动根 box（片高==容器高，图像=纯主滚动区内容）；每片按实际 scrollTop 放置（`stitchPngSlices` 支持每片 overlap），元素坐标恒为内容坐标（x=rect.left-box.x、y=top_i+rect.top-box.y），无末片 clamp 重复条带、无内容带丢失；树组装失败落 `regionTree:null`（不丢截图）。
  影响范围：阶段长图与 `metadata_json` 坐标契约（前端按 imageWidth/imageHeight 与 contentWidth/contentHeight 比例渲染；12MB 降采样时二者不同）。
  文件：src/cdp/phase-screenshot-capture.js, src/cdp/phase-screenshot-page.js, src/cdp/png-stitch.js, src/services/trajectory/phase-highlight-screenshot.js, executor/session-handler.js, executor/session-manager.js, scripts/characterization/characterize-phase-highlight-screenshot.mjs, scripts/refactor/verify-all.sh

- 2026-08-13: **向导分区**：`nearestPageSteps` 在公共祖先下最多向下 3 层找 `.el-steps`，且包裹 class 含 `step`（如 `form > el-col > .steps-wrapper`）；不搜 `body`/`html`。当前步 class 读 `.el-step__head` / `__title`（皮肤不在 `.el-step` 根上打 `is-process`）。
  影响范围：向导页 `region_chrome` / `region_label`；无 schema。
  文件：src/cdp/page-locator-helpers.js

### Added

- 2026-08-15: **region-tree 服务**：新增 `src/services/region-tree.js`——整页大树 `assembleRegionTree`（前缀合并 / other 桶 / PR-LAYER page 只当根）+ 每步层级推导 `deriveRegionRef`（回退链：layers → region_id 按 `|` 拆 → region_label/display_group 按 ` / ` 拆 → 空串），为批量推送 V2.0 层级作证与阶段截图元数据组树提供公共依赖；`scripts/characterization/characterize-region-tree.mjs` 作证。
  影响范围：Node 侧新增纯函数服务；无 schema、无路由、无 HTTP 变更。
  文件：src/services/region-tree.js, scripts/characterization/characterize-region-tree.mjs

- 2026-08-15: `migrations/20260815090000_screenshot_metadata_json`：`screenshot` 表新增 `metadata_json` JSON 列（阶段长图元数据：长宽/元素坐标/region_tree）。
  影响范围：screenshot schema、阶段截图捕获链路。
  文件：migrations/20260815090000_screenshot_metadata_json.js, schemas/init.sql

- 2026-08-14: **轨迹状态枚举 v2**：`trajectory.record_status` 由旧五态改为 `ENUM('draft','recording','failed','recorded','completed')`（未录制/录制中/录制异常/待确认/已确认）；`live`（推流占用）并入 `recording`（存量迁移）。录制失败/中断/批次恢复 INTERRUPTED → `failed`（重录走 record/start 或 clear 重置）；取消确认 completed→recorded；推送闸仅 `completed`；`isAiRecordingActive`（phase.status='running'）替换全部旧 live 判定；stats 五档键名与 api-docs/Vue 文案同步。
  影响范围：schema（迁移+init.sql）、录制/占用/清理全部写入点、export push gate、轨迹列表 stats、api-docs。
  文件：migrations/20260814120000_trajectory_record_status_v2.js, schemas/init.sql, src/models/constants.js, src/dao/trajectory-dao.js, src/services/trajectory/trajectory-status-utils.js, trajectory-recording-runner.js, trajectory-record-lifecycle.js, trajectory-meta-service.js, trajectory-batch-service.js, trajectory-attach-runner.js, trajectory-attach-service.js, trajectory-manual-record.js, src/services/export-push-gate.js, src/services/replay-service.js, src/routes/v2/export-mgmt.js, src/dashboard/api-docs/*, scripts/characterization/characterize-record-status-v2.mjs, characterize-trajectory.mjs, characterize-export-push-gate.mjs, characterize-batch-task-progress.mjs, scripts/smoke/accept-recording-apis.mjs, accept-multi-traj-lifecycle.mjs

- 2026-08-14: **批量导入任务名称 + 轨迹列表统计**：`batch_recording_job` 加 `name VARCHAR(512)`（默认 `文件名_MMDD-HHmm`，存量回填）；`trajectory` 加 `batch_job_id`（VARCHAR(36)，可空，FK→`batch_recording_job.id`，NULL=手动创建；init.sql 只同步列与索引，FK 仍只在迁移）。`POST /v2/trajectories/batch/import` 可选表单字段 `name`（缺省按公式生成）；`GET /v2/trajectories/batch/{batchId}` 响应加 `name`。`GET /api/v2/trajectories` 新增查询参数 `batchTaskName`（模糊），每行返回 `batchTaskName`，响应新增 `stats`（total/draft/live/recording/recorded/completed，与行查询同基准过滤、忽略 recordStatus）。sys_msg 消息链路不变。
  影响范围：schema（两迁移）、batch import/view、轨迹列表 API、api-docs。
  文件：migrations/20260814100000_batch_job_name.js, migrations/20260814110000_trajectory_batch_job.js, schemas/init.sql, src/services/trajectory/batch-job-name.js, src/dao/batch-recording-dao.js, src/dao/trajectory-dao.js, src/services/trajectory/trajectory-batch-service.js, src/services/trajectory/trajectory-meta-service.js, src/services/trajectory/batch-analyze.js, src/routes/v2/trajectory-batch.js, src/routes/v2/trajectory.js, src/dashboard/api-docs/groups/trajectory.js, scripts/characterization/characterize-batch-task-name.mjs

- 2026-08-14: **分区 layers[]**：每个控件 `layers`（`{ role, label }[]`，外→内）由 `region_*` 推导，写入 snap / preview / `element_json`。todo 短路 `region_role` 改为 `todo`。可选 `pageLabel` 头插 `page`（不套 page）。无 schema。
  影响范围：扫描 / resolve / 录制 `element_json`；`display_group` 仍为中文路径。
  文件：src/cdp/page-locator-helpers.js, src/cdp/region-layers.js, src/cdp/resolve-by-label.js, src/models/element.js

- 2026-08-13: **产品消息表（批量导入终态）**：新建 `sys_msg`；字典 `sys_msg_type`（`1`=批量导入任务）。批量任务第一次进入终态插入一条；标题「批量导入任务」；正文两行（功能·文件·状态 / 共N条统计）；`linkUrl=/ui-recording?batchId=`。`GET /api/v2/messages`（`pageNum`）/ `unread-count` / `POST :id/read` / `read-all`。`user_id` 挂起，全员同一列表与已读。
  影响范围：schema、字典种子、batch finalize、v2 消息 API、api-docs。
  文件：migrations/20260813160000_sys_msg.js, schemas/init.sql, src/services/sys-msg-compose.js, src/services/sys-msg-service.js, src/dao/sys-msg-dao.js, src/routes/v2/messages.js, src/services/trajectory/trajectory-batch-service.js

- 2026-08-13: **批量行进度 + 阶段 done 说明**：`trajectory_phase.done_logs` JSON 数组 `[{text, at, source}]`；`phase_done.data.text` 追加写入（空 text 跳过；`phase_error` 为 `source=fail`）。`GET` 交易树 `phases[].doneLogs`；`GET/WS` 批量 item 计算 `progressPercent` / `phaseCompleted` / `phaseTotal` / `phaseName` / `lastDoneText`（不落 batch_item）。`trajectory.trajectory_log` 语义不变。
  影响范围：trajectory_phase schema、录制 runner、batch GET/WS、api-docs。
  文件：migrations/20260813120000_phase_done_logs.js, src/models/phase-done-logs.js, src/services/trajectory/batch-item-progress.js, src/services/trajectory-phase-service.js, trajectory-recording-runner.js, trajectory-batch-service.js

- 2026-08-13: **AI 阶段结束长图（控件高亮）**：`phase_done` 后对本阶段产品树步骤在当前页描边并滚主滚动区拼接 1 张 PNG，写入 `screenshot.kind=phase_highlight` 与 `trajectory_phase.stitch_screenshot_id`。失败不影响录制。交易树 phase 带 `stitchScreenshotId` / `stitchScreenshotUrl`。
  影响范围：screenshot / trajectory_phase schema、录制 runner、tree、BiB executor `session.bib_phase_highlight_capture`。
  文件：migrations/20260813100000_phase_highlight_screenshot.js, schemas/init.sql, src/cdp/phase-highlight-*.js, src/services/trajectory/phase-highlight-screenshot.js, executor/bib-bridge.js

### Fixed

- 2026-08-13: **批量导入中文文件名乱码**：multipart `filename` 按 UTF-8 解码（multer `defParamCharset`）；latin1 误读的已存文件名在落库、通知拼装、消息列表、batch GET 按段修复。勿把整段 `msgContent` 当 latin1。
  影响范围：upload、batch import、sys_msg 列表回显。
  文件：src/http/decode-upload-filename.js, src/http/upload-xlsx.js, src/routes/v2/trajectory-batch.js, src/services/sys-msg-compose.js, src/services/trajectory/trajectory-batch-service.js

- 2026-08-13: **批量行 lastDoneText 取最新已完成阶段**：不再跨阶段按 `at` 取全局最新日志（后续阶段常无 `done().text` 时会一直停在阶段1）。有该阶段 `done_logs` 用末条；没有则显示 `阶段N已完成`。不落库、不写「见页面当前状态」。
  影响范围：batch GET/WS 计算字段 `lastDoneText`。
  文件：src/services/trajectory/batch-item-progress.js
  影响范围：录制 runner、prepare attach、debug session-message、画布 remote:status。
  文件：src/services/trajectory/trajectory-recording-runner.js, trajectory-record-lifecycle.js, trajectory-attach-runner.js, src/routes/browser-session/session-message.js, src/executor-event-hub.js

- 2026-08-13: **日期填表与文本合并为 `fill_form_field`**：`el-date-editor` / `tsscdatepicker`（含 TsscMultiDatePicker）走同一填值动作，写入 Vue `v-model`。库内旧 `fill_date_field` 已 SQL 迁成 `fill_form_field`；控制器动作已删，仅别名归一。导出日期类型按控件 xpath（`el-date-editor` / `tsscdatepicker`）推断。
  影响范围：CTRL fillFormField、Python fill/replay、action-name 别名、legacy-engine 导出、heal 指令。
  文件：src/ctrl-actions/form.js, src/models/action-name.js, src/services/legacy-engine-export.js, src/routes/browser-session/heal-instruction.js, scripts/controller/actions/_form.py, _replay.py, replay_names.py

- 2026-08-13: **分区逻辑收口后端**：`displayGroupOf` / `uniquifyDisplayGroups` 产出可直接展示的 `display_group`（中文 `region_label`；撞车后缀仅业务主键或 `#n`，禁止 xpath 碎片）；产品 SPA 选择器按该字段原样分组，不再从 xpath / 中文启发式重算分区。
  影响范围：resolve-element ambiguous matches、自动抓取选择器。
  文件：src/cdp/display-group.js, src/dashboard/api-docs/groups/recording.js, scripts/characterization/characterize-l1c-region-classify.mjs

- 2026-08-13: **待办 region 优先中文标题**：`assignRegion(.todo-item)` 的 `region_label` 用卡片头中文（如【对公授信申请】信贷调查），`region_id` 用业务主键（PJ/DGSX/YXPC…）；同标题撞车时 `uniquifyDisplayGroups` 追加主键后缀。scan L1 todo title 同步。
  影响范围：resolve-element / 自动抓取选择器分组。
  文件：src/cdp/page-locator-helpers.js, src/cdp/display-group.js, scripts/controller/actions/js_snippets/scan_form.py, scripts/characterization/characterize-unify-partition-locator.py, characterize-todo-item-action.py

- 2026-08-12: **`uniquifyDisplayGroups` 撞车键优先 formLabel**：el-select 可见值常相同（如「否」），不可当 label；仅 `(display_group, formLabel|matchedLabel)` 双撞车才追加 xpath 后缀。修复「对公客户概况」被拆成 `… · ins(@class,'el-select')]`。
  影响范围：自动抓取/歧义选择器分组。
  文件：src/cdp/display-group.js, scripts/characterization/characterize-l1c-region-classify.mjs

- 2026-08-12: **`uniquifyDisplayGroups` 仅在「分区 + label」双撞车时细化**：同一 `display_group` 下不同控件文案（客户编号/客户名称）不再追加 xpath 后缀；仅同区同文案（多「处理」/「新增」）才加后缀。对齐「先粗分区，撞车再细化」。
  影响范围：自动抓取/歧义选择器分组标题。
  文件：src/cdp/display-group.js, scripts/characterization/characterize-l1c-region-classify.mjs

- 2026-08-12: **撞车细化后 L1c 不得回写粗 collapse 标签**：`assignRegion` 仍先粗分区；`refineCollidingRegions` 升到 titlebox 后，`patchRegionFields` 保留已有可读 `region_label`/`region_id`（不再被 feature-card 外层「股东及关联人信息」覆盖）；`buildFeatureCard` 取 title 时 titlebox 优先于 collapse。
  影响范围：`resolve-element` 多「新增」歧义选择器分组。
  文件：src/services/trajectory/trajectory-record-lifecycle.js, src/cdp/page-locator-helpers.js, scripts/characterization/characterize-l1c-region-classify.mjs, characterize-resolve-collision-titlebox.mjs

- 2026-08-12: **L1c 改写 region 后同步 `display_group`**：`patchRegionFields` 经共享 `displayGroupOf` 重算分组键；**禁止用 taxonomy 角色名（`section`）覆盖可读 `region_label`（PJ/DGSX/卡片标题）**；歧义多命中同名时 `uniquifyDisplayGroups` 追加短 xpath/id 后缀，并可从 xpath 找回业务键。
  影响范围：`resolve-element` ambiguous matches（含 L1c）、自动抓取选择器分组。
  文件：src/cdp/display-group.js, src/cdp/resolve-by-label.js, src/cdp/page-locator-helpers.js, src/services/region-classify.js, src/services/trajectory/trajectory-record-lifecycle.js, scripts/characterization/characterize-l1c-region-classify.mjs

- 2026-08-12: **待办「处理」假成功回放 + 自动抓取漏抓**：`normalizeTargetRoot` / `inventoryKindOf` 均优先 `.todo-item-action`（先于 `.el-checkbox-group`），避免录成 checkbox-group xpath、以及 inventory 误标 `form_checkbox` 被 `click_element` 过滤掉；durable 在 `want` 文本存在时拒绝「xpath 命中祖先但文案非精确匹配」的 `ok-xpath-smart`；inventory 收录 `.todo-item-action`。
  影响范围：手动录制 xpath_smart、steps/replay 点击、resolve-element / 自动抓取 inventory。
  文件：src/cdp/page-locator-helpers.js, scripts/controller/actions/replay_js.py, scripts/controller/actions/js_snippets/_locator_helpers_js.py, scripts/characterization/characterize-todo-item-action.py

- 2026-08-12: **待办卡片「处理」自动抓取/分区（1448067 延伸）**：L2 `collectL2Buttons` 收录 `div.todo-item-action`（非 button 标签亦准入）；L1 经 `assignRegion` 按 `.todo-item` 卡片赋 `region_label`（如 PJ…）；xpath 消歧经 `regionAnchor*` / 类 leaf；`resolve-by-label` 候选同步。人工录制/回放此前已补。
  影响范围：`scan_editable_summary` / `JS_SCAN_FORM_FIELDS` L2 buttons + L1 regions、resolve-element 文本匹配、locator helpers。
  文件：scripts/controller/actions/js_snippets/scan_form.py, scan_utils.py, src/cdp/page-locator-helpers.js, resolve-by-label.js, locator-builders/dispatcher.js, scripts/characterization/characterize-todo-item-action.py

- 2026-08-12: **Partner 代理网络失败文案**：projects/systems/importDemand 遇 nginx 502、超时、非 JSON 时统一返回「网络异常，自动化平台无法连接」（技术细节打 warn 日志，不塞进 `error`）。
  影响范围：`GET /api/v2/export/partner/projects|systems`、推送 importDemand 502/504 message。
  文件：src/services/partner-platform.js, src/dashboard/api-docs/groups/export-mgmt.js

- 2026-08-12: **草稿交易不可推送（1448068）**：partner 真实推送仅允许 `recordStatus=recorded|completed`；单轨 `push=true` → 409 `not_pushable_status`；批量跳过 draft/live/recording（item 带同 code）。dryRun/raw 仍可组装。批量无可推送时文案改为中文「没有可推送的交易…」。
  影响范围：export 推送闸门、api-docs、产品 toast 文案。
  文件：src/services/export-push-gate.js, src/routes/v2/export-mgmt.js, src/dashboard/api-docs/groups/export-mgmt.js, scripts/characterization/characterize-export-push-gate.mjs

- 2026-08-12: **下拉选项子串误匹配（国民经济部门类别）**：`already-matched` / fuzzy / JS `includes` 不再用「短选项 ⊆ 长 want」把「其他非金融企业部门」录成「非金融企业部门」；exact 优先，contains 取最短合法项。
  影响范围：AI/`select_option` 录制与 autofill、`_llm_values` commandValue fuzzy。
  文件：scripts/controller/actions/form_scan_utils.py, _form.py, _llm_values.py, js_snippets/select_option.py, scripts/characterization/characterize-select-option-substring.py

- 2026-08-12: **人工录制弹窗表格 radio 不落步**：`tableRadio` 在 `rowText` 空时不再静默 `return`；回退 `data-row-key` / `row-index:N`，仍无身份则 fall through 到普通 click。
  影响范围：手动录制 dialog/picker 表行单选。
  文件：scripts/manual_recorder/js_parts/a.py, b.py, scripts/characterization/characterize-manual-table-radio.py

- 2026-08-12: **AI 录制行业代码等树选择器落成树节点**：`select_tree_option` 按 label 解析 xpath 并 stamp `form_tree_select`；`prepareElementJson` 对 `select_tree_option` 推断 `form_tree_select`（不再误成 `form_input`）；popover 内树节点回绑表单树选择控件（侧栏 `.el-tree` 仍为 `tree_node`）；AI `click_element_by_index` / 手动录制在表单树 popover 上升级为 `select_tree_option`。
  影响范围：录制步骤 `action`/`target_kind`、回放定位、手动录制 mapper。
  文件：scripts/controller/actions/_form.py, _misc.py, src/models/element.js, src/cdp/page-locator-helpers.js, scripts/manual_recorder/*, scripts/characterization/characterize-tree-select-record.py

- 2026-08-11: **browser-session-lifecycle final review**：`assertNoForeignGraceOnNodeSlot` 改为 slot 感知（不同 `slotIndex` 跳过，同槽/未知槽 + idle grace 仍 gate）；`reusedChrome` 时即使无 `cdpPort` 也跑 claim；`detachTrajectoryLive` 在 streamDetach 清缓存后经 `getByTrajectory`/`getOccupiedByAgentSession` 解析 remote_session，并以 `clearOwnershipOnClose` 立即清归属；`markActive`/`syncMount` 清 `grace_until`。
  影响范围：多槽 attach 409 误拒修复；硬 detach 在 streamDetach 后仍能关 idle Chrome；owner reclaim 不再残留 grace。
  文件：src/services/trajectory/trajectory-attach-service.js, src/services/session-lifecycle.js, src/dao/remote-session-dao.js, scripts/characterization/characterize-session-lifecycle.mjs

- 2026-08-11: **remote_session 归属真相源 + streamDetach 宽限**：`trajectory_id` 为唯一归属；`trajectory.remote_session_id` 仅为门面缓存；`streamDetach` 进入 idle 时保留归属并设 `grace_until`（默认 15min）；宽限期内他交易认领 → 409 `grace_owned`；reaper 先到期清归属再关孤儿。修复 `markIdle` 清空 `trajectory_id` 导致交叉挂载/易主；`attachLive` / `attachTrajectoryLive`（含 `reusedChrome` slot 感知 claim gate）在宽限内拒绝他交易复用 idle Chrome。
  影响范围：schema（`grace_until`）、attach/streamDetach/detach/reaper 语义、409 响应可含 `code`/`ownerTrajectoryId`/`graceUntil`；env `REMOTE_SESSION_GRACE_MS`。
  文件：migrations/20260811200000_remote_session_grace_until.js, schemas/init.sql, config/config.js, src/services/session-lifecycle*.js, src/dao/remote-session-dao.js, src/services/remote-session-service.js, src/services/trajectory-idle-reaper.js, src/services/trajectory/trajectory-attach-service.js, src/routes/v2/remote-session.js, src/routes/v2/trajectory-shared.js, scripts/characterization/characterize-session-lifecycle.mjs

- 2026-08-11: **产品步骤列表过滤内部 meta（Bug-1448055）**：`save_form_snapshot` 等仍入库供 Type B 回放，但默认不出现在 `GET .../tree` / `GET .../phases/:id/steps`；`includeMeta=1` 可看全量；步骤带 `isMeta`；`stepCount` 只计业务步；live `action_persisted` 不对 meta 广播；`steps/replay` 在选中业务步 `step_number` 区间自动补入 meta 检查点。
  影响范围：轨迹树/阶段步骤列表、stepCount、live WS、steps/replay 选步扩展。
  文件：src/models/meta-step-actions.js, src/services/trajectory-query-service.js, src/services/trajectory-step-service.js, src/routes/browser-session/persist-live.js, src/services/trajectory/trajectory-session-replay.js, src/routes/v2/trajectory.js, src/routes/v2/trajectory-steps.js, src/dashboard/api-docs/groups/trajectory.js, scripts/characterization/characterize-meta-step-filter.mjs

- 2026-08-11: **批量导入中文提示与模板文件名**：未上传/空 buffer →「请上传 Excel 文件」；无数据行 →「导入文件为空，请至少填写一行交易」；无有效行 →「Excel 中没有有效数据行」。模板下载 `Content-Disposition` 中文名「批量录制导入模板.xlsx」（RFC 5987 `filename*` + ASCII 回退）。
  影响范围：`GET /api/v2/trajectories/batch/template`、`POST /api/v2/trajectories/batch/import` 错误文案与下载文件名。
  文件：src/routes/v2/trajectory-batch.js, src/services/trajectory/trajectory-batch-service.js, src/services/trajectory-batch-excel.js, src/dashboard/api-docs/groups/trajectory.js

- 2026-08-11: **L1c final review hardening**：`callLLMWithTimeout` 在 race 结束后 `clearTimeout`，避免 LLM 先返回后超时 rejection 未处理；`L1C_LLM=false` 时不 L1d 缓存 `shouldLlmClassify` 规则结果（仅缓存最终规则命中如高置信 `main`）；`resolve-element` 的 `resolveSystemIdForTrajectory` / `applyL1cRegionClassify` 软失败（warn + 原 payload），不因分类 500。
  影响范围：`classifyRegions` L1d 命中条件；`POST .../resolve-element` 稳定性。
  文件：src/services/region-classify.js, src/services/trajectory/trajectory-record-lifecycle.js

### Changed

- 2026-08-13: **v2 行为保持去重：steps→commands 映射合并 + sendErr/asyncHandler 统一**：`stepsToActionCommands` 收拢到 `src/models/element.js`（replay-service `prepareReplay` 传 `{ preferEntryPhase: true }` 保留原 `phaseNumber ?? entry.phase ?? 0` 语义；`/assemble-file` 默认 `phaseNumber ?? 0` 不变）；v2 `sendErr` 统一到 `trajectory-shared.js`（canonical 增补可选 `rejected` 字段，其余字段不变），并新增 `asyncHandler`；replay / regions / operation-component / system-ref-data / trajectory-batch 5 个路由文件删除本地 sendErr 副本与手写 try/catch（batch/import 的 multipart 回调除外）。
  影响范围：错误响应 body 为兼容性扩张（错误对象若带 `code`/`ownerTrajectoryId`/`graceUntil`/`holders`/`rejected` 时多透传，此前部分模块不返回）；路由路径/方法、成功响应字段、WS 协议均不变。
  文件：src/models/element.js, src/services/replay-service.js, src/routes/v2/trajectory.js, src/routes/v2/trajectory-shared.js, src/routes/v2/replay.js, src/routes/v2/regions.js, src/routes/v2/operation-component.js, src/routes/v2/system-ref-data.js, src/routes/v2/trajectory-batch.js

- 2026-08-12: **分区/定位统一 U2（inventory = L2 投影）**：`collectL2Hosts` 为唯一 host 选择器表；`collectInventoryHosts` 委托之；循环内 `normalizeHost` + `classifyOperable`（无并行 collector 表）。`collectL2Buttons` 仍保留 button-only 投影但继续 `classifyOperable` 准入。
  影响范围：PAGE_LOCATOR_HELPERS、resolve-element inventory、自动抓取。
  文件：src/cdp/page-locator-helpers.js, scripts/controller/actions/js_snippets/_locator_helpers_js.py, scripts/characterization/characterize-unify-partition-locator.py

- 2026-08-12: **分区/定位统一 U1（自动抓取可读分区）**：`classifyOperable`/`normalizeHost` 为唯一准入/host 内核；resolve-element 歧义项增加 `display_group`（= `region_label`），待办多「处理」须带互异卡片业务键。
  影响范围：PAGE_LOCATOR_HELPERS、resolve-element ambiguous matches、api-docs。
  文件：src/cdp/page-locator-helpers.js, src/cdp/resolve-by-label.js, src/dashboard/api-docs/groups/recording.js, …

- 2026-08-12: **BiB 画布本机剪贴板**：`remote:input` 新增 `kind:clipboard`（`getSelection`）；下行 `remote:clipboard`；产品画布 Ctrl/Cmd+C/V 走本机剪贴板语义（不再把 C/V 当远端键透传）。
  影响范围：`/ws` BiB 协议；executor `session.bib_clipboard`；Vue `useRemoteCanvas`
  文件：src/cdp/clipboard-selection.js, src/cdp/remote-bridge/ws-router.js, executor/bib-bridge.js, src/dashboard/api-docs/groups/websocket.js, scripts/characterization/characterize-clipboard-selection.mjs

- 2026-08-12: **xpath 消歧 helpers 统一为 `regionAnchor*`（R4）**：`sectionAnchorOf` / `sectionAnchorXPath` 别名已删除；仅保留 `regionAnchorOf` / `regionAnchorXPath`，注释标明 xpath 消歧（非产品 L1 分块 / `section=`）。产品区域请用 `region_*` / `assignRegion`。
  影响范围：CDP locator helpers、Python 镜像 `_locator_helpers_js.py`、region-anchored xpath 导出/回放。
  文件：src/cdp/page-locator-helpers.js, scripts/controller/actions/js_snippets/_locator_helpers_js.py, scripts/characterization/characterize-section-anchored-xpath.py

- 2026-08-12: **Agent stderr 导出剥前缀**：`GET|POST .../agent-stderr` 与 traj 快捷导出返回正文时去掉 `[slot:N sid:…]` 与 `[session]`（落盘 slot 前缀仍保留供过滤）；监视面板「日志」同步干净正文。
  影响范围：导出 text/json 的 `lines` 内容；Python agent 源日志不再写 `[session]`，阶段结束为 `Phase N done` + 空行。
  文件：src/services/agent-stderr-log-service.js, src/routes/v2/agent-stderr.js, scripts/session_runner.py, scripts/agent/service.py, scripts/browser/factory.py, scripts/event_dispatch.py, scripts/trajectory_store.py, scripts/cdp_ports.py

- 2026-08-12: **`GET /api/v2/recording/agent-stderr/active` 附带 CDP 端口**：对在线执行机拉 `session.list`，`rows[].cdpPort` + `slotPorts[]`（含空闲槽默认口）；执行机 `list()` 改为返回全容量槽。监视面板新增 CDP 列。
  影响范围：`/active` 响应扩字段；executor WS `session.list_result.sessions` 可含 `sessionId: null` 的空闲槽。
  文件：executor/session-manager.js, src/services/agent-stderr-log-service.js, src/dashboard/api-docs/slot-monitor.js, src/dashboard/api-docs/groups/recording.js

- 2026-08-11: **AI 录制 agent_task：案例 KV 仅文本注入 + 【阶段目录】全量阶段**：`format_case_data_hint` 同时附原文 block 与扁平 `- 键：值`（不再互斥）；撤回 select `commandValue` 硬绑。`stepData.all_phases` 来自交易全部 phase（`allPhases`），执行仍只跑勾选 `phaseIds`。
  影响范围：`[session] agent_task preview` 内容；录制 `all_phases` 载荷。
  文件：scripts/controller/actions/_case_data.py, scripts/controller/actions/_form.py, scripts/controller/actions/phase/outcomes.py, src/services/trajectory/trajectory-recording-runner.js

### Added

- 2026-08-12: **`POST /api/v2/recording/agent-stderr/clear` + 监视面板「清空日志」**：按 session 删除控面 `logs/agent-stderr/{sessionId}.log`（仅该文件）。Body 同 /active 行；监视占用行与日志面板均可触发。
  影响范围：新路由；`/api/docs` 执行机监视 UX。
  文件：src/services/agent-stderr-log-service.js, src/routes/v2/agent-stderr.js, src/dashboard/api-docs/slot-monitor.js, src/dashboard/api-docs/groups/recording.js

- 2026-08-12: **`/api/docs` 执行机监视面板**：侧栏「执行机监视」按节点拆分槽位（空闲/占用、交易、session、CDP）；支持刷新/筛选/自动刷新；占用行可「断开画面」「释放浏览器」「日志」「清空日志」。
  影响范围：仅 `/api/docs` 前端；清空走 `POST .../agent-stderr/clear`；CDP 来自 `/active.slotPorts`。
  文件：src/dashboard/api-docs/slot-monitor.js, src/dashboard/api-docs/app.js, src/dashboard/api-docs/catalog.js, src/dashboard/api-docs/api-docs.css

- 2026-08-12: **`POST /api/v2/recording/agent-stderr` 粘贴 /active 行导出**：请求体可直接粘贴活动目录 `rows[]` 一项（识别 `slotIndex`/`sid`/`sessionId`/`trajectoryId`，其余字段忽略）。
  影响范围：新增 POST；`/api/docs` Try 示例为 active 行 JSON。
  文件：src/routes/v2/agent-stderr.js, src/dashboard/api-docs/groups/recording.js

- 2026-08-11: **多 slot Agent stderr 隔离与导出**：执行机行前缀 `[slot:N sid:…]` 经 WS `session.agent_stderr` 落盘控面；交易录制分组新增 `GET /api/v2/recording/agent-stderr/active`、`GET|POST /api/v2/recording/agent-stderr`、`GET /api/v2/trajectories/:id/agent-stderr`。
  影响范围：新路由 + executor stderr 前缀；env `AGENT_STDERR_LOG_DIR`。
  文件：executor/stderr-prefix.js, executor/session-slot.js, src/services/agent-stderr-log-service.js, src/routes/v2/agent-stderr.js, src/executor-ws.js, src/dashboard/api-docs/groups/recording.js, config/config.js

- 2026-08-11: **L1c 区域分类 `POST /api/v2/regions/classify` + `L1C_LLM` 灰度**：批量对 feature card 做规则 → L1d 缓存 → 可选 LLM 分类；`resolve-element` 已在 lifecycle 内联 `classifyRegions`；scan/fullpage 可经 HTTP 调用同一服务。
  影响范围：`POST /api/v2/regions/classify` 请求体 `{ systemId?, cards }` → `{ items }`；env `L1C_LLM`（默认关）、`L1C_LLM_TIMEOUT_MS`。
  文件：src/routes/v2/regions.js, src/services/region-classify.js, src/services/trajectory/trajectory-record-lifecycle.js, config/config.js, config/.env.example, src/dashboard/api-docs/groups/regions.js

- 2026-08-10: **`resolve-element` inventory 模式端到端贯通**：HTTP body / executor WS `session.bib_resolve_element` 支持 `mode`（产品默认 `inventory`）；inventory 无 label/action 不 400，无 labelText 时始终返回 ambiguous 列表；可选 `truncated` 表示命中 INVENTORY_CAP。
  影响范围：`POST .../resolve-element` 请求体 `mode`；executor WS `session.bib_resolve_element` payload；响应可含 `truncated`。
  文件：src/routes/v2/trajectory-record.js, src/services/trajectory/trajectory-record-lifecycle.js, src/cdp/remote-bridge/index.js, executor/session-handler.js, executor/session-manager.js, executor/bib-bridge.js, src/dashboard/api-docs/groups/recording.js

- 2026-08-10: **`resolve-element` 同区碰撞后 titlebox 细化 L1**：歧义匹配按 `(needle, region_id)` 碰撞组再发现 `div.titlebox`/`span.title`，刷新 `region_*` 并尝试 titlebox 锚定 `xpath_smart`（算法 B 不丢匹配）。湿测多「新增」可区分面板标签。
  影响范围：`POST .../resolve-element` 歧义 matches 的 `region_*` / `xpath_smart`；CDP helpers 与 Python `_locator_helpers_js` 同步。
  文件：src/cdp/page-locator-helpers.js, src/cdp/resolve-by-label.js, src/models/element.js, scripts/controller/actions/js_snippets/_locator_helpers_js.py, scripts/characterization/characterize-resolve-collision-titlebox.mjs

### Fixed

- 2026-08-10: **`prepareElementJson` / `enrichLocatorFields` 保留已抓取相对 xpath**：缺 `xpath_smart` 但 `xpath` 已是 `//…`（含 titlebox 锚定）时不再按按钮文案发明裸 leaf 覆盖。
  影响范围：步骤创建/更新 element 归一化；与 Vue `buildElement` 持久化 `xpath_smart` 互补。
  文件：src/cdp/locator-builders/candidates.js

### Added

- 2026-08-10: **灰度开关 `XPATH_SMART_FILL_ONLY`（默认关）**：开则 `fill_form_field` 仅允许 `xpath_smart` 定位；关则无 xpath 时保留 label DOM 兜底（测试人员）。入口 `scripts/feature_flags.py` / `config/.env.example`。
  影响范围：Agent 填表行为开关。
  文件：scripts/feature_flags.py, scripts/controller/actions/_form.py, config/.env.example

- 2026-08-10: **`resolve-element` 歧义匹配附带 L1 区域预览**：`matches[].preview` / element 增加 `region_role`、`region_id`、`region_label`（与全页扫描 `assignRegion` 同源规则）；Vue 选择器主行展示区域标签。算法 B：归位失败不丢匹配。BiB 需重载执行机后做多「新增」冒烟（湿测挂起）。
  影响范围：`POST .../resolve-element` 响应预览字段；CDP `PAGE_LOCATOR_HELPERS` / `resolve-by-label`。
  文件：src/cdp/page-locator-helpers.js, src/cdp/resolve-by-label.js, scripts/controller/actions/js_snippets/scan_form.py, scripts/controller/actions/js_snippets/_locator_helpers_js.py

- 2026-08-10: **`GET /api/v2/export/transaction/schema` partner envelope 字段契约**：返回 `schemaVersion`、`fields`（transcId / transcationName / …）、`eventTypeName` 中文映射与 `actionTypeMap`；拼写（transcation*、mothed）为对接约定。
  影响范围：`/api/v2/export/transaction/schema` 新增端点。
  文件：src/routes/v2/export-mgmt.js, src/services/transaction-export.js, src/dashboard/api-docs/groups/export-mgmt.js

- 2026-08-10: **`GET|POST /api/v2/export/trajectories/:id/transaction` 单条交易导出**：query/body 必填 `systemId`、`projectId`；全量导出 trajectory_step 为 partner envelope，成功 `markExported`（`isExport=1`）；`download=1` 时响应体仅为 payload。轨迹不存在 → 404；缺 id → 400。
  影响范围：`/api/v2/export/trajectories/:id/transaction` 新增端点。
  文件：src/routes/v2/export-mgmt.js, src/services/transaction-export.js, src/dashboard/api-docs/groups/export-mgmt.js

- 2026-08-10: **`POST /api/v2/export/transactions` 批量交易导出**：body 传 `trajectoryIds`、`systemId`、`projectId`；逐条独立 ok/fail，成功项返回 partner envelope 并 `markExported`，失败项（不存在/异常）不翻转 `isExport`；响应含 `items[]` 与 `summary.{ok,failed}`。
  影响范围：`/api/v2/export/transactions` 新增端点。
  文件：src/routes/v2/export-mgmt.js

- 2026-08-10: **`trajectory.is_export` 脏标记列 + DAO helpers**：迁移新增 `is_export TINYINT(1) NOT NULL DEFAULT 0`（1=最近一次全量导出成功，0=有变更或未导出）；`markExportDirty` / `markExported` 更新标志；`getById` / `list` / `listByFunction` 返回 `isExport` 为 `0|1` 数字。
  影响范围：trajectory 表 schema、trajectory DAO。
  文件：migrations/20260810120000_trajectory_is_export.js, src/dao/trajectory-dao.js

- 2026-08-09: **T10-P1:** `JS_VERIFY_FORM_STRUCTURE` / CTRL `verifyFormStructure` collect Source B `el-table` labels (same `row#N` naming as scan) so snapshot verify matches recording surface.
  影响范围: `scripts/controller/actions/js_snippets/misc.py`, `src/ctrl-actions/structure.js`

- 2026-08-09: **T4-P3:** Source B keeps empty-leading `el-table` rows (`row#N` + index xpath); `CTRL.selectOption` ports `SELECT_LAZY_LOAD_ON_MISS`.
  影响范围: `scripts/controller/actions/js_snippets/scan_form.py`, `scripts/prompts/agent-tools-form.md`, `src/ctrl-actions/select.js`

- 2026-08-09: **`scan_editable_summary` 旁路记忆（T4-P2）**：成功摘要后 best-effort 上报 `form_state` 事件与 `form_inventory` 聚合 facts（`container`/`pending_count`/`pending_labels`/`buttons`）；`AI_MEMORY_EVENTS` 开关；不阻塞 action 返回。
  影响范围：Python agent `scripts/controller/actions/_form.py`、`scripts/memory/inventory_emit.py`。
  文件：scripts/controller/actions/_form.py, scripts/memory/inventory_emit.py, scripts/characterization/characterize-inventory-memory.py

- 2026-08-09: **`scan_editable_summary` Agent 动作（T4-P0）**：只读可见可编辑控件摘要（`pending_labels`、`buttons[{text,section}]`、`sections`）；不写 `task_list` / `_scan_fields`、不触发 auto-fill。P0 单根扫描（复用 `JS_GET_CONTAINER` + `quick=true`）；多 overlay 根合并去壳 → T4-P1。Prompt 引导填表/找按钮前先摘要。
  影响范围：Python agent `scripts/controller/actions/_form.py`、`form_scan_utils.py`、`scripts/prompts/agent-tools-form.md`。
  文件：scripts/controller/actions/_form.py, scripts/controller/actions/form_scan_utils.py, scripts/prompts/agent-tools-form.md, scripts/characterization/characterize-scan-editable-summary.py

- 2026-08-09: **`scan_editable_summary` 多根扫描（T4-P1）**：`JS_SCAN_FORM_FIELDS` 新增 `opts.mode:'multi'`；`scan_editable_summary` 传入多根模式，合并可见 overlay 或 `.el-main` 主内容区（去壳），跨根 `xpath_smart` 去重；默认无 `opts` 时行为不变。
  影响范围：Python agent `scripts/controller/actions/_form.py`、`js_snippets/scan_form.py`。
  文件：scripts/controller/actions/_form.py, scripts/controller/actions/js_snippets/scan_form.py

- 2026-08-07: **批量导入草稿模式（`mode=record|draft`）**：`POST .../trajectories/batch/import` 接受 `mode`（默认 `record`；非法值 → 400）。`mode=draft` 仅 analyze+建草稿（`bindTrajectoryAsDrafted` → item `drafted`），跳过 prepare/record/detach，不要求 `USE_EXECUTOR`；`mode=record` 保持原一站式录制语义，`USE_EXECUTOR=false` → 503。`request_hash` / 幂等键含 `mode`；`summary.drafted` 计数；取消 job 仅 `cancelOpenItems` 未决项，已 `drafted`/`recorded` 保留。状态查询与 WS `batch:*` payload 含 `mode`；`pumpDraft` 独立认领 `analyzed` 且无 `trajectoryId` 的孤儿项（重启 `kickScheduler` 可恢复）；`pumpRecord` 仅 `queued`/`waiting_executor` + `jobModes: ['record']`。schema：`batch_recording_job.mode`；item 终端态 `drafted`；常量 `BATCH_JOB_MODES`、`BATCH_ITEM_STATUSES` / `BATCH_ITEM_TERMINAL` 含 `drafted`。
  影响范围：batch import API、调度、DAO、api-docs、Vue 批量导入 UI。
  文件：migrations/20260807120000_batch_job_mode_and_drafted.js, src/models/constants.js, src/dao/batch-recording-dao.js, src/services/trajectory-batch-service.js, src/dashboard/api-docs/catalog.js, scripts/characterization/characterize-batch-import.mjs

- 2026-08-07: **`POST /api/v2/trajectories/{id}/steps/move`**：拖拽改序 / 跨阶段移动单步；`beforeStepId` 省略或 null 表示目标阶段末尾；AI 录制 / 人工录制 / `session.busy` 时 409。
  影响范围：v2 trajectories API、step DAO、api-docs。
  文件：src/dao/trajectory-step-dao.js, src/services/trajectory-step-move.js, src/services/trajectory-step-service.js, src/services/trajectory-service.js, src/routes/v2/trajectory.js, src/dashboard/api-docs/catalog.js

- 2026-08-07: Session Chrome 可选无头：`CHROME_HEADLESS=true`（config/.env 或 executor/.env）。无实体窗口，BiB 仍走 CDP screencast，便于规避最小化/失焦节流。
  影响范围：config、executor 子进程 env、Python 启动参数。
  文件：config/.env.example, executor/.env.example, executor/config.js, src/runtime/agent-process.js, scripts/session_runner.py

### Changed

- 2026-08-11: BiB 画面推流默认限帧约 10–12fps（分辨率/quality 不变），降低公网观看延迟与卡顿。可通过 `BIB_STREAM_MIN_FORWARD_MS`、`BIB_STREAM_EVERY_NTH_FRAME` 调整。
  - 影响：执行机 `bib-bridge`、控制面 `remote-bridge` screencast、`/api/docs` WS 说明。

- 2026-08-11: **page-state-gen**：可点击 leaf 在相对 xpath 多命中时，用页态（步骤条→dialog/drawer→breadcrumb）锚定 `xpath_smart`；唯一控件不包。推广原 wizard 下一步逻辑。
  影响范围：CDP locator helpers / 录制 snap / resolve inventory。
  文件：src/cdp/page-locator-helpers.js, scripts/controller/actions/js_snippets/_locator_helpers_js.py

- 2026-08-10: **批量推送（Batch Push）端到端**：api-docs 分组改为「批量推送管理」；新增对方项目/系统代理（`GET /export/partner/projects|systems`）；`POST /export/transactions` 组装后代调 importDemand，仅对方成功才 `markExported`；`systemId`/`projectId` 缺省 98/31；`access_token` 从头/body/env 转发。Vue 弹窗改为项目→系统级联。
  影响范围：批量推送产品流、partner 代理、importDemand 代推。
  文件：src/services/partner-platform.js, src/routes/v2/export-mgmt.js, src/dashboard/api-docs/groups/export-mgmt.js, config/.env.example；Vue：api/export.ts、BatchPushDialog.vue、ui-recording/index.vue

- 2026-08-10: **Partner transaction 导出对齐 importDemand 定稿**：外层 `transcationEventTypeList`；轨内步骤为 `transcationProperties`；`testFrame=playwright`；`propertiesName` 无分隔符且同轨去重（重复追加 2、3…）；`raw`/`forImport`/`download` 返回可直接 POST 的导入体；批量 raw 合并多轨。
  影响范围：`/api/v2/export/trajectories/:id/transaction`、`/api/v2/export/transactions`、transaction schema/docs。
  文件：src/services/transaction-export.js, src/routes/v2/export-mgmt.js, src/dashboard/api-docs/groups/export-mgmt.js, scripts/characterization/characterize-transaction-export.mjs, scripts/export-transaction-raw.mjs

- 2026-08-09: **Overlay 容器命名带触发按钮（`dialog:<按钮>|<标题>`）。** 录制用最近成功点击文案合成 display id（无标题 → `|unnamed`）；`verifyFormStructure` / `JS_VERIFY_FORM_STRUCTURE` 只匹配 `|` 后标题，兼容旧 `dialog:标题` / `dialog:unnamed`。
  影响范围：录制 snapshot container、steps/replay Type B 校验、assembled CTRL。
  文件：scripts/controller/actions/container_naming.py, _form.py, form_scan_utils.py, _misc.py, _table.py, js_snippets/misc.py, src/ctrl-actions/structure.js

- 2026-08-08: **修复重构回归——`liveByRemoteSessionId` 裸引用**：remote-session-service 拆分 state 后未导入该 Map（仅 re-export，不会引入模块作用域），BiB attach 时 ReferenceError → `[trajectory] BiB attach failed`。已在导入块补回。
  影响范围：录制 attach（attachTrajectoryLive / stream attach）与 live 状态绑定。
  文件：src/services/remote-session-service.js

- 2026-08-08: **拆分 cdp/remote-bridge.js 为包**：`src/cdp/remote-bridge/` 下拆出 `state.js`（共享可变状态 `bridge` 对象 + 常量 + `getRemoteStatus` / `broadcastStatus` / `broadcastInspect` / `pushAgentEvent`）、`screencast.js`（startScreencast/restartScreencast/onScreencastFrame/stall watchdog/viewport override）、`cdp-input.js`（handleAck/flushFillRecord/handleInput/handleViewport）、`ws-router.js`（ensureWsHook WS 路由 + BiB target 解析 `resolveBibTarget`）；`index.js` 保留全部 10 个公开导出与模块状态，`src/cdp/remote-bridge.js` 改为 10 名字的 re-export shim（同一函数身份），消费者导入路径零变化。`wsHooked` 注册语义与 `ensureWsHook` 调用时机不变（`attachLive` 以参数注入 ws-router 避免 import 环）。全部函数逐字比对一致（仅 `bridge.` 前缀改写与 shorthand→显式属性等价变换），无逻辑变更。
  影响范围：BiB 远程桥（CDP screencast/input、remote:* WS、resolveBibTarget、resolveElementByLabelText）语义不变。
  文件：src/cdp/remote-bridge.js, src/cdp/remote-bridge/{index,state,screencast,cdp-input,ws-router}.js

- 2026-08-08: **拆分 v2/trajectory.js 路由注册**：单一注册函数按资源拆为三个模块——`trajectory.js`（trajectory CRUD / phases / case-data / login-context / clear / assemble-file）、`trajectory-record.js`（record prepare/start/stop、attach/detach/stream-detach、manual-record、resolve-element、confirm）、`trajectory-steps.js`（steps CRUD、steps/replay start+stop、step-move）；共享 `sendErr` 助手移入 `trajectory-shared.js`。`__init__.js` 在 `registerTrajectory(app)` 后依次调用三个注册函数；32 条路由的方法/路径/处理器逐字不变（每块逐字比对一致），各模块内注册顺序不变。跨模块间路由互不遮蔽（各路径字面段/段数互异），Express 匹配行为不变。
  影响范围：/api/v2/trajectories* 全部路由（语义不变）。
  文件：src/routes/v2/trajectory.js, src/routes/v2/trajectory-record.js, src/routes/v2/trajectory-steps.js, src/routes/v2/trajectory-shared.js, src/routes/v2/__init__.js

- 2026-08-08: **拆分 browser-session/register.js 路由处理器**：`POST /api/browser/session/:id/trajectory` 持久化编排块（~200 行）移入 `src/routes/browser-session/trajectory-persist.js`；`POST /api/browser/watcher/action` 处理器 + `session:step` WS 消息路由移入 `src/routes/browser-session/watcher-actions.js`。register.js 保留路由表，handler 体改为调用导入函数；WS 处理器注册顺序不变（仍为注册函数末尾）。代码块逐字移动，无逻辑变更。
  影响范围：/api/browser/session/:id/trajectory、/api/browser/watcher/action、WS session:step（语义不变）。
  文件：src/routes/browser-session/register.js, src/routes/browser-session/trajectory-persist.js, src/routes/browser-session/watcher-actions.js

- 2026-08-08: **trajectory 服务迁入 `src/services/trajectory/`**：六个服务文件（`trajectory-session-replay` / `trajectory-batch-service` / `trajectory-record-lifecycle` / `trajectory-persist-service` / `trajectory-attach-service` / `trajectory-meta-service`）git mv 到 `src/services/trajectory/`，与 batch 2 各抽取模块同目录；新增 `src/services/trajectory/index.js` barrel re-export 六个服务的全部公开导出（45 个名字）。所有引用方（facade `trajectory-recording-service` / `trajectory-service`、路由、scripts 表征/smoke）导入路径同步更新；表征脚本按新模块位置断言同一不变量。纯目录移动 + 路径修正，无逻辑变更、无协议变更。
  影响范围：模块导入路径（服务行为不变）。
  文件：src/services/trajectory/index.js, src/services/trajectory/trajectory-{session-replay,batch-service,record-lifecycle,persist-service,attach-service,meta-service}.js, src/services/trajectory-recording-service.js, src/services/trajectory-service.js, src/routes/v2/trajectory-batch.js, src/routes/browser-session/persist-live.js, scripts/characterization/characterize-trajectory.mjs, scripts/characterization/characterize-analyze-case-data.mjs, scripts/characterization/characterize-batch-import.mjs, scripts/characterization/characterize-form-snapshot-trigger.mjs, scripts/smoke/smoke-trajectory-step-idempotent.mjs

- 2026-08-08: **拆分 hierarchy-service.js**：树导出/导入块（`exportTree` / `getTreeTemplate` / `getTreeTemplateExcel` / `exportTreeExcel` / `importTreeExcel` + `EXPORT_VERSION`）移入 `src/services/hierarchy-excel.js`；原文件保留树查询/CRUD（`getTree` / `nestToChildrenTree` / `createSystem` / `createModule` / `createFunction` / `resolveAncestorSystemId` / `importTree` 等），5 个被移动的公开导出改为 re-export（同一函数身份），`getTree` 供新模块的 `importTreeExcel` 复用。代码块逐字移动，无逻辑变更。
  影响范围：系统管理树导出/导入端点（JSON/Excel 语义不变）。
  文件：src/services/hierarchy-service.js, src/services/hierarchy-excel.js

- 2026-08-08: **拆分 remote-session-service.js**：模块级状态枢纽（`liveByRemoteSessionId` 活绑定 Map + `trajLocks` 每轨迹串行锁）与全部状态访问器（`withTrajectoryLock` / `bindingToStatus` / `getLiveBindingBy*` / `resolveLiveBinding` / `clearExecutorLive*` / `clearLiveBinding` / `restoreLiveBindingFromRow` / `listLiveBindings`）移入 `src/services/remote-session-state.js`；原文件保留 BiB 生命周期操作（`openSession` / `attachLive` / `detachLive` / `getLiveStatus` / `mountTrajectoryRemoteSession` / `supersedeStaleForTrajectory` 等），11 个被移动的公开导出改为 re-export（同一函数身份），`liveByRemoteSessionId` 导出供状态模块使用（ESM 活绑定，Map 变更跨模块可见）。代码块逐字移动，无逻辑变更。
  影响范围：BiB 绑定查询/状态序列（语义不变）。
  文件：src/services/remote-session-service.js, src/services/remote-session-state.js

- 2026-08-08: **拆分 trajectory-meta-service.js**：需求文本抽取助手（`stripBusinessDataBlock` / `phaseNeedsBusinessData` / `extractCaseDataBlock` / `extractCaseEntriesFromRequirement` / `appendCaseDataToPhases` + 区块正则常量）移入 `src/services/trajectory/trajectory-text-extract.js`；原文件保留 `analyzeRequirementToPhases` / `createEmptyTrajectory` / `createTransactionWithPhases` / `setTrajectoryCaseEntries` / `confirmTrajectory`，被移动的 4 个公开导出改为 re-export（同一函数身份），`CASE_DATA_SECTION_RE` / `appendCaseDataToPhases` 供 `analyzeRequirementToPhases` 复用。代码块逐字移动，无逻辑变更。
  影响范围：需求→阶段分析、业务数据注入、case-data 解析（语义不变）。
  文件：src/services/trajectory-meta-service.js, src/services/trajectory/trajectory-text-extract.js

- 2026-08-08: **拆分 trajectory-attach-service.js**：`prepareTrajectoryRecordingUnlocked`（录制准备主流程：session/browser/stream/login 分阶段 + BiB 挂载 + 默认登录）移入 `src/services/trajectory/trajectory-attach-runner.js`；原文件保留全部公开导出（`prepareTrajectoryRecording` / `attachTrajectoryLive` / `detachTrajectoryStream` / `detachTrajectoryLive` / `bindTrajectoryManualPersist` / `cleanupPersistedTrajectoryResources`），`prepareTrajectoryRecording` 改为调用新模块（内部函数，非公开导出）。代码块逐字移动，无逻辑变更。
  影响范围：record/prepare 路径（阶段事件语义不变）。
  文件：src/services/trajectory-attach-service.js, src/services/trajectory/trajectory-attach-runner.js

- 2026-08-08: **拆分 trajectory-persist-service.js**：实时步骤追加块（`appendRecordedStep` + `appendRecordedFormSnapshot` 快照双写/指纹去重）移入 `src/services/trajectory/form-snapshot-append.js`；原文件保留其余公开导出（`buildStepsFromActionFile` / `buildStepsFromFlow` / `readOperationLogText` / `persistSessionTrajectory` / `saveFullTrajectory` / `resolvePhaseIdForPersist` / `removeRecordedStepsByDbIds`），被移动的 2 个导出改为 re-export（同一函数身份），`resolvePhaseIdForPersist` 供新模块复用。代码块逐字移动，无逻辑变更。
  影响范围：实时 step append / save_form_snapshot 双写路径（语义不变）。
  文件：src/services/trajectory-persist-service.js, src/services/trajectory/form-snapshot-append.js

- 2026-08-08: **拆分 trajectory-record-lifecycle.js**：`startTrajectoryRecording`（AI 分阶段录制主循环 + action_log_sync 持久化 + 截图存取 lazy accessor）移入 `src/services/trajectory/trajectory-recording-runner.js`，`toggleTrajectoryManualRecord` 移入 `src/services/trajectory/trajectory-manual-record.js`；原文件保留其余 5 个公开导出（`prepareCaseDataInjection` / `runDefaultLogin` / `stopTrajectoryRecording` / `stopTrajectoryRecordingSafe` / `resolveTrajectoryElement`），被移动的 2 个导出改为 re-export（同一函数身份，facade 与表征校验不变）。代码块逐字移动，无逻辑变更。
  影响范围：record/start、manual-record toggle 路径（语义不变）。
  文件：src/services/trajectory-record-lifecycle.js, src/services/trajectory/trajectory-recording-runner.js, src/services/trajectory/trajectory-manual-record.js

- 2026-08-08: **拆分 trajectory-batch-service.js**：analyze 流水线（`pumpAnalyze` / `runAnalyze` / `createDraftFromAnalyzed` / `pumpDraft` + worker 计数）移入 `src/services/trajectory/batch-analyze.js`，record 流水线（`computeClusterFreeSlots` / `pumpRecord` / `runRecord` + worker 计数）移入 `src/services/trajectory/batch-record.js`；原文件保留全部公开 API（`buildRequestHash` / `getBatchJobView` / `importBatchFromExcel` / `startBatchScheduler` / `kickScheduler` / `cancelBatch` / `recoverBatchJobsOnStartup` / `buildTemplateBuffer`）与调度器，`cancelledAnalyzeTokens` / `emitProgress` / `maybeFinalizeJob` 改为导出供抽取模块复用（纯新增导出，无消费者破坏）。代码块逐字移动，无逻辑变更。
  影响范围：批量导入调度（analyze/draft/record pump 语义不变）。
  文件：src/services/trajectory-batch-service.js, src/services/trajectory/batch-analyze.js, src/services/trajectory/batch-record.js

- 2026-08-08: **拆分 trajectory-session-replay.js**：`runReplayBatch`（Type A 单步 heal 批处理）移入 `src/services/trajectory/replay-batch-runner.js`，`handleFormStructureCheckpoint`（Type B 表单结构检查点）移入 `src/services/trajectory/form-structure-heal.js`；原文件保留 3 个公开导出（`acceptTrajectoryStepsReplay` / `replayTrajectorySteps` / `stopTrajectoryStepsReplay`）与 `prepareReplayBatch`，仅新增对抽取模块的 import。代码块逐字移动，无逻辑变更。
  影响范围：steps/replay 路径（Type A/B heal 语义不变）。
  文件：src/services/trajectory-session-replay.js, src/services/trajectory/replay-batch-runner.js, src/services/trajectory/form-structure-heal.js

- 2026-08-08: **Agent prompt 分册装配 + 特殊元素按需 hint：** `agent-prompt.md` 拆为 `agent-core` + `agent-tools-common/form/table/tree`；`build_agent_system_message(contract)` 按 `_phase_intent.mode` 装配；`session_runner` 创建 Agent 时传入合约。删除 `agent-special-prompt.md`（内容不迁移）；`format_special_element_hint` 加厚 `phaseDescription`/`remark`/`stepSummary`；`toDisplayCandidates` 透传新字段。Planner 同步终检后保存口径。
  影响范围：Agent system prompt 装配、特殊元素 hint、planner-prompt、表征。
  文件：scripts/prompts/agent-*.md, scripts/agent_utils.py, scripts/session_runner.py, scripts/actions/_special_element.py, src/services/special-element-search-service.js, scripts/prompts/planner-prompt.md, scripts/characterization/characterize-agent-prompt-packs.py, scripts/characterization/characterize-special-element-hint.py, AGENTS.md, CLAUDE.md

- 2026-08-08: **表单助手注入阶段任务/业务数据/只读快照；不确定字段 `needs_agent` 交主 Agent：** `_llm_generate_values` 带使命上下文；吃不准不写入。`run_form_assistant` 返回 `needs_agent[]`。主 Agent prompt 要求终检后再保存，并清理「助手完直接 click_save」过时句。
  影响范围：run_form_assistant、form/agent prompts、自动填值。
  文件：scripts/actions/_llm_values.py, scripts/actions/_form.py, scripts/prompts/form-prompt.md, scripts/prompts/agent-prompt.md, scripts/characterization/characterize-assistant-mission-context.py

- 2026-08-08: **阶段保存闸门按 LLM 声明的 section 收窄：** `click_save`/`get_pending_tasks`/`run_form_assistant` 可选 `section=`；只校验/填写该折叠块 pending。无 section 且 pending 跨多块 → `err-section-required`。不再因征信等无关块挡住「系统评级结论」保存。
  影响范围：录制表单阶段提交闸门、助手、pending 摘要、agent-prompt。
  文件：scripts/actions/_section_scope.py, scripts/actions/_form.py, scripts/actions/_phase_intent.py, scripts/actions/_phase_boundary.py, scripts/prompts/agent-prompt.md, scripts/characterization/characterize-phase-section-scope.py

- 2026-08-08: **XPath-primary 控件操作：** 写路径经 `_resolve_control` 后仅用相对 `xpath_smart` 定位；语义名 `label||placeholder` 仅用于取值/规则/录制。同 label 多 xpath → `ambiguous-label`。Agent 动作可选 `xpath_smart`；prompt 要求优先带 xpath。
  影响范围：Agent fill/select/date/radio、run_form_assistant、scan 语义名。
  文件：scripts/actions/_form.py, scripts/actions/_llm_values.py, scripts/prompts/agent-prompt.md, scripts/characterization/characterize-xpath-primary-ops.py

- 2026-08-07: **el-select 懒加载选项：** `JS_SELECT_OPTION` 首轮未命中时，对下拉滚动容器稳态滚底加载更多选项后再匹配（Agent `select_option` 与 live `_replay.py` 共用）。不改 `CTRL.selectOption`。
  影响范围：Agent select_option、live replay fill/select。
  文件：scripts/actions/_js_snippets.py（调用方 `_form.py` / `_replay.py` 无接口变更）

- 2026-08-07: **执行机会话模型缺省解析**：`attachTrajectoryLive` 不再硬编码 `deepseek-v4-flash` 兜底，改为 `resolveModelId(traj.model)` —— `traj.model` 为空 → `agent-api.json` 的 `defaultModel`，显式值保持不变。
  影响范围：录制 attach 的执行机会话模型选择。
  文件：src/services/trajectory-attach-service.js

- 2026-08-07: **control-ops 分块闭环（section + buttons + xpath-first 写路径）**：`JS_SCAN_FORM_FIELDS` 为字段/按钮挂 `section_id`/`section_title`（collapse/tab/card）；Source B 对齐 `date`/`radio`/`checkbox`；扫描结果含 `buttons[]`；`run_form_assistant` / `scan_form_fields` 摘要返回 `sections[]` 与 `ambiguous_buttons[]`（同名按钮跨块时提示）。`fill_form_field`/`select_option`/`click_radio` 及 date/radio/checkbox 在 pending 项带 `xpath_smart` 时 xpath-first 执行；`click_save(button_text, section='')` 按区块定位保存，多处可见「保存」且无 `section` 时返回 `err-save-ambiguous` 不盲点。
  影响范围：表单扫描、助手、live replay 写路径、保存按钮定位。
  文件：scripts/actions/_js_snippets.py, scripts/actions/_form.py, scripts/models/field.py, scripts/models/task.py, scripts/characterization/characterize-control-ops-closed-loop.py, scripts/characterization/characterize-xpath-fill-select.py, scripts/prompts/agent-prompt.md

- 2026-08-07: 删除 `trajectory_step.is_replay` 列及 `idx_step_is_replay` 索引；列表/计数/组件签名不再按该列过滤。`POST .../steps/replay` 请求体 `isReplay` 仍为运行时抑制入库。
  影响范围：schema、trajectory step DAO/计数、operation-component 签名、api-docs。
  文件：migrations/20260807160000_drop_trajectory_step_is_replay.js, schemas/init.sql, src/dao/trajectory-step-dao.js, src/dao/trajectory-dao.js, src/services/trajectory-step-service.js, src/services/operation-component-signature.js, src/services/operation-component-service.js, src/services/trajectory-persist-service.js, src/dashboard/api-docs/catalog.js

- 2026-08-07: **表单扫描 control-first + el-table（Source B）**：`JS_SCAN_FORM_FIELDS` 在 Source A（`.el-form-item`）之外发现可见 `el-table` 可编辑单元格；每条字段输出相对 `xpath_smart`；按 xpath 去重（冲突时保留 form-item 元数据）；`ScannedField` / `TaskItem` / `form_snapshot.fields_fingerprint` 携带 xpath；无 label 仅有 placeholder 的控件纳入扫描（displayName=placeholder）。表单助手与 `save_form_snapshot` 共用同一扫描结果。
  影响范围：run_form_assistant 批量填写、录制 form_snapshot、live replay 定位语义。
  文件：scripts/actions/_js_snippets.py, scripts/models/field.py, scripts/models/task.py, scripts/models/form_snapshot.py, scripts/characterization/characterize-form-scan-control-first.py

- 2026-08-07: **表单助手 xpath-first 执行**：pending 项带 `xpath_smart` 时 `_auto_fill_pending` / `_execute_round` 优先 `JS_FILL_BY_XPATH` / `JS_SELECT_TRIGGER_BY_XPATH`；`TaskList.mark_done` 按 xpath 消歧同名 label；xpath fill/select 从 `_replay.py` 抽到 `_js_snippets.py` 供助手与回放共用。legacy 轨迹无 xpath 时仍走 label 回退。
  影响范围：run_form_assistant、live replay fill/select。
  文件：scripts/actions/_form.py, scripts/actions/_js_snippets.py, scripts/actions/_replay.py, scripts/characterization/characterize-form-assistant.py, scripts/characterization/characterize-xpath-fill-select.py

- 2026-08-07: AI 录制阶段结果 **`prior_outcome.success` 缺省改为未知（`null`）**，不再把「未收到明确 done(success)」当成成功。`phase_done` 无 outcome 时 Python 显式发 `success: null`；控制面仅在 `true`/`false` 时写入成败，文案走「未知」。
  影响范围：录制生命周期 prior 注入、session `phase_done`。
  文件：src/services/trajectory-record-lifecycle.js, scripts/session_runner.py

- 2026-08-06: AI 录制 step instruction 增加 **`all_phases`**（当前录制集全量阶段 id/序号/标题/描述）与 **`prior_outcome`**（上一阶段一句结果）；不再依赖 prior 0–2 段全文注入执行 Agent。
  影响范围：录制生命周期 → Python session instruction。
  文件：src/services/trajectory-record-lifecycle.js, src/executor-session-client.js, executor/session-handler.js

- 2026-08-06: 组件库列表展示 **入库人**（`created_by`，暂可空串显示「—」）；`special_element` 同步预留 `updated_by`。
  影响范围：schema、列表 UI。
  文件：migrations/20260806123000_library_created_by.js, schemas/init.sql, src/dao/operation-component-dao.js, src/models/entities.js

- 2026-08-06: 特殊元素库保留筛选：**入库说明 / 步骤说明 / 入库人**（与系统/模块/功能/入库时间并存）；后端支持 `keyword`/`stepDesc`/`createdBy`。
  影响范围：特殊元素列表 API、Vue UI。
  文件：src/dao/special-element-dao.js, src/services/special-element-service.js, src/dashboard/api-docs/catalog.js

- 2026-08-06: 组件库列表筛选对齐：`GET /api/v2/operation-components` 与 `GET /api/v2/special-elements` 支持 **systemId / moduleId / functionId** 三级联查 + **startTime/endTime**（按 created_at 入库时间）。moduleId 展开下属功能；functionId 优先。
  影响范围：列表 API 查询参数、api-docs、Vue UI资产库两 Tab。
  文件：src/dao/operation-component-dao.js, src/services/operation-component-service.js, src/dao/special-element-dao.js, src/services/special-element-service.js, src/dashboard/api-docs/catalog.js

### Added

- 2026-08-06: **操作步骤原子化组件库 Phase 1（沉淀）**：新建 `operation_component` / `operation_component_occurrence`；`trajectory_phase.component_id` 预留列（业务不写）。v2 API：`/api/v2/operation-components`（list/get/create/patch/confirm/deprecate/delete）+ `POST .../mine`（按 systemId/functionId/trajectoryIds 扫轨迹三表，签名含 label_text 等稳定语义；已存在组件只加 occurrence 不改文案）。api-docs 归入分组 **「组件库管理」**（`id: component-library`）。本阶段不碰 login、不接录制/回放引用。
  影响范围：MySQL schema、v2 API、api-docs。
  文件：migrations/20260806120000_operation_component.js, migrations/20260806120100_trajectory_phase_component_id.js, schemas/init.sql, src/dao/operation-component-dao.js, src/dao/operation-component-occurrence-dao.js, src/services/operation-component-signature.js, src/services/operation-component-service.js, src/services/operation-component-mine-service.js, src/routes/v2/operation-component.js, src/routes/v2/__init__.js, src/dashboard/api-docs/catalog.js, src/models/entities.js, src/models/constants.js, scripts/prompts/component-mine-prompt.md, scripts/characterization/characterize-operation-component.mjs

### Fixed

- 2026-08-09: **`dialog:unnamed` / `drawer:unnamed` 表单结构校验误报 `container_not_found`。** 录制对无标题弹窗写入哨兵 `unnamed`；`verifyFormStructure` 原先按字面标题匹配「unnamed」找不到容器，引入弹窗后紧接着的结构检查点失败。现改为匹配空 title/aria 的可见 overlay。
  影响范围：`steps/replay` Type B `save_form_snapshot`、assembled CTRL verify。
  文件：src/ctrl-actions/structure.js, scripts/controller/actions/js_snippets/misc.py, scripts/characterization/characterize-verify-form-structure.mjs

- 2026-08-09: **T10-P0: unsafe form-structure checkpoint fails step but continues replay batch (A2).** `handleFormStructureCheckpoint` unsafe/`container_not_found` returns `aborted: false`; `replay-batch-runner` continues on `!ok && !aborted` (records `failedStepIds`, no batch abort). Transport timeout / heal fail / userAbort still `aborted: true`; no snapshot mutate on unsafe.
  影响范围：`steps/replay` Type B checkpoint、WS `replay:step` failed 语义。
  文件：src/services/trajectory/form-structure-heal.js, src/services/trajectory/replay-batch-runner.js, scripts/characterization/characterize-form-snapshot-trigger.mjs

- 2026-08-08: **录制 `element.xpath_smart` 与写入 `params.xpath_smart` 对齐：** `_capture_element` 改为 `JS_CAPTURE_FROM_XPATH` 从写入命中节点取 `xpath_full`，不再调用 `JS_SMART_LOCATOR` 覆盖为 form-item xpath；fill/select/date/radio/round 写路径传入 `resolved.xpath_smart`。
  影响范围：录制 element 快照、xpath-primary 写路径。
  文件：scripts/actions/_js_snippets.py, scripts/actions/_form.py, scripts/characterization/characterize-capture-element-xpath.py

- 2026-08-08: **阶段运行时加固（section 记忆、空 act 缓冲与处方、done 闸门收窄、质量可观测）：** `remember_phase_section` / `resolve_phase_section` 记忆与推断当前区块；`click_save` 先读 `_phase_section` 再 `refresh_scan_buttons` + `unique_button_section` 消歧。`submit.required` 在 `max(8, est+2)` 之上再 `+3` 空 act 缓冲（est=4→11）；`recorder` 检测空/无效 `act={}` 注入合法 `NEXT_ACTION`（末步仅 `done`、已保存则 `done(success=true)`、否则 scoped `click_save`）。`done()` 在 `refill=all_editable` 时经 `resolve_phase_section` 收窄 pending 写闸门，不再被其他折叠块挡住。阶段结束写 stderr `QUALITY FAIL` 并在 `phase_end` 事件附带 `quality_failed` / `quality_failed_reasons`。
  影响范围：录制 Agent 步数预算、空 act 恢复、scoped 保存/done 闸门、阶段结束可观测性。
  文件：scripts/actions/_section_scope.py, scripts/actions/_form.py, scripts/actions/_phase_reviewer.py, scripts/actions/_phase_intent.py, scripts/recorder.py, scripts/session_runner.py, scripts/characterization/characterize-phase-runtime.py, scripts/characterization/characterize-phase-reviewer.py

- 2026-08-08: **`ok-save-no-feedback` 视为保存成功：** 已点击保存且无校验错误/错误 toast/跳转时，记 `_last_save_ok` + success token，并提示立刻 `done`（适配被测系统区块保存无「操作成功」提示）。同步 agent/recorder 文案，避免机械重试。
  影响范围：录制 click_save 成功判定、agent prompts。
  文件：scripts/actions/_form.py, scripts/recorder.py, scripts/prompts/agent-tools-form.md, scripts/prompts/agent-core.md, scripts/characterization/characterize-phase-section-scope.py

- 2026-08-08: **`click_save` 自动补 section 后未传入 JS：** `unique_button_section` 已写入 `sec`，但 `JS_CLICK_SAVE_BUTTON` 仍用空的入参 `section`，多「保存」时误报 `err-save-ambiguous`（日志：auto section=系统评级结论 后仍 section=''）。改为传 `sec`。
  影响范围：录制阶段 scoped 保存。
  文件：scripts/actions/_form.py, scripts/characterization/characterize-phase-section-scope.py

- 2026-08-08: **`submit.required` 阶段 `max_steps` 下限 8：** 在 `estimated_steps+2` 强制截断之外，需保存/提交的阶段至少 8 步，避免乐观估算（如 est=4→6）叠空 `act={}` 后饿死 `click_save`。
  影响范围：录制 Agent 步数上限。
  文件：scripts/actions/_phase_reviewer.py, scripts/prompts/phase-reviewer-prompt.md, scripts/characterization/characterize-phase-reviewer.py

- 2026-08-08: **阶段评审器步数强制截断保留，buffer 1→2：** `estimated_steps + 2`（1 步留给 browser-use done-only 末步，1 步留给保存/终检）；评审器 prompt 要求估算含「终检 + 保存/提交」。避免过小预算吞掉 `click_save`/暂存，同时仍用估算控阶段漂移。
  影响范围：录制 Agent 步数上限、评审器 prompt。
  文件：scripts/actions/_phase_reviewer.py, scripts/session_runner.py, scripts/prompts/phase-reviewer-prompt.md, scripts/characterization/characterize-phase-reviewer.py

- 2026-08-08: **`click_save` 漏传 section 时唯一「保存」自动补区块：** pending 跨多块且 `section=` 为空时，若 `_scan_buttons` 中匹配按钮只属于一个 `section_title`/`section_id`，自动用该区块做写闸门与点击（日志 `[click_save] auto section=`）；多「保存」仍 `err-section-required`。`NEXT_ACTION` / agent-prompt 改为带 `section=`，不再暗示「无 ambiguous 就裸 click_save」。
  影响范围：录制阶段保存闸门、pending 提示、agent-prompt。
  文件：scripts/actions/_section_scope.py, scripts/actions/_form.py, scripts/prompts/agent-prompt.md, scripts/characterization/characterize-phase-section-scope.py

- 2026-08-08: **`force_refill` 重建 TaskItem 丢失 section_* 打成假 `__root__`：** 已有值字段在 `from_scan(force_refill=True)` 手工重建时未拷贝 `section_id`/`section_title`，`pending_by_section` 误报 `__root__`，放大 `err-section-required`。现三处 TaskItem 构造均保留扫描区块元数据。
  影响范围：force_refill 任务列表、section 闸门。
  文件：scripts/models/task.py, scripts/characterization/characterize-phase-section-scope.py

- 2026-08-07: **表单助手表格内 el-select 不填**（实锤：评级等级测算 input 能填、下拉 pending 残留；`select_option`/`JS_SELECT_TRIGGER_BY_XPATH` 对表格控件返回 `field-disabled`）。根因：xpath 开下拉把 `input.readOnly` 当禁用，而 Element UI 可编辑 select 的 trigger 常为 readOnly；无 `.el-form-item` 时又无法 label 回退。现：xpath trigger **不再**因 readOnly 拒绝（与 `JS_FIELD_DISABLED` 约定一致）。
  影响范围：Agent `run_form_assistant` / `select_option`、live replay 的 xpath 开下拉。
  文件：scripts/actions/_js_snippets.py, scripts/characterization/characterize-xpath-fill-select.py

- 2026-08-07: **el-table 页面表单助手仅扫到少量 `.el-form-item` 字段**（实锤：评级等级测算 ~40 个可编辑表格单元格不可见，仅 3 项进入 pending）。根因：扫描仅 form-item-centric。现 control-first 扫描 + el-table Source B + xpath 去重；同名控件（如不同折叠区两个「保存」）靠 xpath 区分，不靠 displayName 合并。
  影响范围：表单助手扫描与批量填写。
  文件：scripts/actions/_js_snippets.py, scripts/models/field.py, scripts/models/task.py, scripts/models/form_snapshot.py, scripts/actions/_form.py

- 2026-08-07: **`close_dialog` 关不了 el-drawer**（轨迹 36 回归）。根因：`el-dialog__close` icon class 被误判为 dialog 容器，xpath_smart 只挂 dialog；live replay 死磕 xpath 失败也不回退控制器。现：`detectContainerKind` 不再把 `el-dialog__*` 当容器；close 默认 `overlay`（dialog+message-box+drawer）；replay xpath 失败则 CTRL/controller 回退。
  影响范围：CDP/录制定位、live steps/replay。
  文件：src/cdp/locator-candidates.js, scripts/actions/_locator_helpers_js.py, scripts/actions/_replay.py

- 2026-08-06: **表单结构 Type B 护栏**：expected/actual 数量崩塌或 missing 过半（错容器扫描特征）时检查点失败，禁止删 missing 步骤、禁止改 form_snapshot；与 `container_not_found` 同路径。
  影响范围：live steps/replay Type B。
  文件：src/services/trajectory-session-replay.js, src/dashboard/api-docs/catalog.js

- 2026-08-06: **表单结构校验按录制 container 选根**（实锤：main 检查点在抽屉仍开时用 getContainer 扫到抽屉 6 字段 → Type B 误删主表步骤）。`verifyFormStructure(fields, containerId)` / live `_replay_verify_form_structure` 传入 `main|drawer:…|dialog:…`；`main` 排除可见 overlay 内字段；容器找不到返回 `error:container_not_found` 且 Type B 不删步/不改 snapshot。
  影响范围：live steps/replay Type B、assemble 注入的 FORM-CHECK、CTRL.verifyFormStructure。
  文件：src/ctrl-actions.js, scripts/actions/_js_snippets.py, scripts/actions/_replay.py, scripts/script_assembler.py, src/services/trajectory-session-replay.js, src/dashboard/api-docs/catalog.js

- 2026-08-06: **action_log_sync 单条 entry 后处理抛错导致整批循环中断、录制步骤永久卡死**（实锤：交易 35 阶段 2 在 trajectory_step 第 118 行后不再前进，Python `_ACTION_LOG` 已到 337 条且 `done(success=true)`）。根因：`appendRecordedStep` 成功后 `flushPendingStepScreenshot` / `broadcast` 无 try/catch，异常冲出 `for (const entry of entries)` 循环，后续 entry 全部跳过；下一条全量快照在同一位置再次中断。修复：① 单条 entry 处理（含截图 flush / broadcast）包 try/catch 并打 `[record] action_log_sync entry failed` 日志，循环继续；② `resolvePhaseIdForPersist` 返回 `{ id, phaseNumber }` 消除 phase 重复查询；③ `trajectory_step.action_id` 列 + `(trajectory_id, action_id)` 唯一索引，`appendRecordedStep` 插入前查重（`ER_DUP_ENTRY` 兜底），控制面重启后 DB 级幂等。
  影响范围：录制落库管道（action_log_sync）、MySQL schema、appendRecordedStep。
  文件：src/services/trajectory-record-lifecycle.js, src/services/trajectory-persist-service.js, src/models/helpers.js, src/dao/trajectory-step-dao.js, migrations/20260806130000_trajectory_step_action_id.js, schemas/init.sql, scripts/smoke/smoke-trajectory-step-idempotent.mjs

- 2026-08-06: **force_refill 重扫把本会话刚填字段打回 pending 导致整表重复填 3 遍**（实锤：交易 35 122 字段表单 337 条 auto-fill；法定代表人引入弹窗关闭后 stale 容器重扫 + agent 请求不存在字段「婚姻状况」触发未知 label 重扫）。根因：`TaskList.from_scan(force_refill=True)` 无差别把 DOM 有值字段打回 pending，值生成无缓存每次随机不同。修复：① `session_filled_labels` 豁免本会话已填字段；② `_task_done_impl` 记录 `_autofilled_labels` / `_generated_value_cache`；③ `_execute_round` 经 `commandValue` 复用缓存值；④ `_auto_fill_pending` 兜底过滤。
  影响范围：表单填写 agent（录制新增场景 auto-fill 状态机）
  文件：scripts/models/task.py, scripts/actions/_form.py, scripts/characterization/characterize-phase-intent.py

- 2026-08-06: **click_save 非白名单 toast 被静默丢弃后误判失败**（实锤：交易 35 保存成功 toast「已提交创建！保存的客户，客户状态为【信贷正式客户】」无「成功」关键词，agent 连续点击保存 3 次）。toast 分类改为 fail 优先、其余默认 success；无 toast/校验/跳转反馈时降级为 `_ok` 提示 agent 自行二次确认，不再机械重试。
  影响范围：表单填写 agent（click_save 判定）
  文件：scripts/actions/_form.py, scripts/actions/_js_snippets.py, scripts/characterization/characterize-save-toast.mjs

- 2026-08-05: **导航阶段被【业务数据】误判为 form_fill 导致越界**（实锤：阶段「点击客户管理…抵达对公客户管理页面」却继续新增/保存/引入）。根因：每阶段挂业务数据 boilerplate 含「填写」，且「引入」关键值污染 classify；`抵达…页面` 未进 open_page 规则。修复：① classify/boundary/intent **先剥离【业务数据】**；② **仅填表/修改/引入**阶段注入业务数据（analyze append + record/start + Python hint）；③ open_page 支持「抵达/到达」。
  影响范围：阶段边界、录制注入、analyze phase 附文。
  文件：scripts/actions/_phase_context.py, _phase_boundary.py, _phase_intent.py, scripts/session_runner.py, src/services/trajectory-meta-service.js, src/services/trajectory-record-lifecycle.js

- 2026-08-05: 案例数据注入链路二次修复（实锤：交易 35 重录后模型仍未拿到案例数据——phase 描述无【业务场景案例数据】块、case_data_entry 0 条、preamble 无【预设案例数据】）：① **恢复 `prepareCaseDataInjection` 调用**（V2.2 停用注释残留 `const caseData = null`，函数实现此前已恢复但调用点未恢复，案例数据从未注入）；② **task 兜底解析**：case_data_entry 为空时从 `trajectory.task` 的「关键数据」段规则解析（`extractCaseEntriesFromRequirement`）→ 落库 case_data_entry + 摄取 memory_fact（requirement/authoritative）→ 注入 Python store。不依赖前端透传 analyze caseEntries（外部 Vue 仓库未透传，Node 侧兜底保证权威值可达模型）。端到端验证：交易 35 task → `{"法定责任人引入":"朱桂武"}` 注入 + 落库 + 摄取全过。
  影响范围：录制注入链路（startTrajectoryRecording 的 case_data 准备）。
  文件：src/services/trajectory-record-lifecycle.js

- 2026-08-05: 案例数据「引入」类解析 + 注入链路修复（实锤：交易 35 需求"法定责任人引入 朱桂武"无冒号分隔，KV 解析不出 → 模型在客户放大镜反复用主表单值"测试科技发展有限公司"查询致循环）：① `extractCaseEntriesFromRequirement` 支持无冒号「引入」类格式（`法定责任人引入 朱桂武` / `引入 朱桂武` → KV）；② 修复 analyze 返回 `caseEntries` 误传 raw 文本块（`normalizeCaseEntries` 对非数组返回 []，P1 落库/摄取实际未生效）——改为 KV 数组；③ 恢复 `prepareCaseDataInjection`：case_data_entry KV 注入 Python store → preamble【预设案例数据】hint 生效，放大镜查询/填表优先权威值。
  影响范围：analyze API 返回、轨迹创建/录制注入、案例数据解析。
  文件：src/services/trajectory-meta-service.js, src/services/trajectory-record-lifecycle.js

- 2026-08-05: 录制事件断线静默丢失（实锤：交易 35 只录到 step 127，Python `_ACTION_LOG` 已到 251——控制面/WS 断线后 executor `ws.send` 在 `readyState!==OPEN` 时 return false 静默丢弃，Python 子进程继续执行，后续动作/截图/phase_done 全部丢失，前端只显示到"实际控制企业证件号码"）。修复：① executor ws-client **断线缓冲**（`send` 断线入队，上限 32MB，溢出丢最旧+告警），重连注册成功后**按序重放**（`flushPending`）；② **断线超时看门狗**（`EXECUTOR_DISCONNECT_TIMEOUT_MS` 默认 30s，可配）：超时未恢复 → 杀全部 Python 会话（`killTree`）——宁可明确失败，不静默丢数据；重连成功即清除看门狗。覆盖短暂断线（缓冲重放，数据不丢）与长断线/控制面重启（杀会话，明确失败）两个场景。
  影响范围：executor 进程（ws-client / agent / config）。
  文件：executor/ws-client.js, executor/agent.mjs, executor/config.js, config/.env.example

- 2026-08-06: **WS 半开连接静默丢事件完整修复**（实锤场景：100+ 表单项长阶段内表单填写助手一次 LLM 批量生成（`_llm_values.py` invoke）数十秒无 stdout → WS 空闲被 NAT/LB 静默掐断，executor `readyState` 仍 OPEN，事件进内核黑洞——不发送成功、不进断线缓冲、无任何报错；表单助手填表动作无法入库）。三层修复：
  ① **executor 主动侦测半开**：`EXECUTOR_HEARTBEAT_ACK_TIMEOUT_MS`（默认 40000 = 2×心跳间隔）未收到 `executor.heartbeat.ack` → console.error 明确报错 + `ws.terminate()` 强制触发 close → 复用断线缓冲/看门狗/重连路径，事件不再进黑洞；
  ② **服务端心跳加速 + 断线可见**：`src/executor-ws.js` ping 周期 30s → 10s（感知窗口缩到 ~10–20s），pong 缺失 terminate 时输出 `[executor-ws] half-open detected, terminated <nodeUuid>`（此前静默）；
  ③ **重连后快照补拉（恢复断线窗口数据）**：executor 重连注册成功后若断过线，对全部活跃 session 触发 `get_action_log`；`relayAgentEvent` 把 `get_action_log_result`（_ACTION_LOG 全量快照）同时以 `action_log_sync` 上送，控制面 `trajectory-record-lifecycle` 的 `persistedActionIds` 幂等消费**自动补写缺失步骤、不重复**；并发 `action_resync` 事件 → 控制面旁路落 `memory_event(connection_resync)` 审计（sessionId 自动关联 trajectory_id）。
  ④ **表单批量占位事件（源头缓解）**：`AI_FORM_BATCH_HEARTBEAT`（默认 on）——`_llm_values.py` 批量生成前发 `form_batch_started`、成功/异常两路径发 `form_batch_done`，LLM 长调用期间事件流不再静默。
  影响范围：executor 进程、控制面 WS、Python 表单值生成；无 schema 变更、无新依赖。
  文件：executor/ws-client.js, executor/agent.mjs, executor/config.js, executor/session-handler.js, executor/.env.example, src/executor-ws.js, scripts/actions/_llm_values.py, scripts/feature_flags.py, config/.env.example, scripts/smoke/smoke-executor-halfopen.mjs（新）, scripts/smoke/smoke-resync-log.mjs（新）

### Added

- 2026-08-06: 记忆 **P2-4 多模型对比报告**：`GET /api/v2/memory/compare?trajectoryIds=1,2,3` 对已录制交易汇总步骤数 / 成功状态 / 审计通过率 / 填表值一致性。formValues 仅 `source∈{llm,page,rule,agent,observer}`；consistency 用 entity **并集**分母（缺字段=不一致）；全部缺失 404、≥1 条 200、<2 条 `consistency=null`。无 token 字段（用 passRate + isSuccessful 代理）。烟测 `smoke-memory-compare.mjs` 19/19。
  影响范围：记忆 API / api-docs；不写库、不改 schema。
  文件：src/memory/memory-dao.js, src/memory/memory-service.js, src/routes/v2/memory.js, src/dashboard/api-docs/catalog.js, scripts/smoke/smoke-memory-compare.mjs

- 2026-08-05: 记忆 **P2-2 跨交易复用**：`POST /api/v2/memory/retrieve` 接受 `functionId`；`AI_MEMORY_HISTORY=true` 时，并入同 `function_id` 历史成功交易（`is_successful=1`，排除本交易，取最近 5 条）的当前版本事实——标记 `source=history, stance=inferred, weight×0.5`，排序自然靠后，**绝不覆盖本交易 requirement 事实**、不参与冲突 supersede。`protocol.js` 新增 `history` 到 FACT/EVENT sources；`weight-engine` 基准 0.4；`config` 新增 `AI_MEMORY_HISTORY`（默认 false）。录制链路 `trajectory-record-lifecycle` 传 `trajRow.functionId`。烟测：`scripts/smoke/smoke-memory-history.mjs`（子进程验证开关三态，12/12）。
  影响范围：Fact Pack 检索 / 录制阶段注入；向后兼容（不传 functionId 或开关关闭时行为不变）。
  文件：src/memory/protocol.js, src/memory/weight-engine.js, src/memory/memory-dao.js, src/memory/memory-service.js, src/routes/v2/memory.js, src/services/trajectory-record-lifecycle.js, config/config.js, config/.env.example, src/dashboard/api-docs/catalog.js, scripts/smoke/smoke-memory-history.mjs

- 2026-08-05: 记忆 **P2-1 审计产品化**：① 决策覆盖扩展——`scenario_summary` LLM 摘要写 `decision_record`；回放自愈（healType step/form_structure）发起时记 `decisionType:'heal'`（确定性指令模板，model 留空）；**agent_step 决策不做**。② 决策详情回填——`GET /api/v2/memory/decisions/:id` 新增 `inputFacts`（按 `inputFactIds` 查 `memory_fact`，含被 supersede 版本）；`memory-service.ingestEvents` 在决策与事实同事件上报且未传 `inputFactIds` 时自动回填同事件事实 id。③ 审计汇总——`GET /api/v2/memory/audit/summary` 新增 `topReferencedFacts`（仅按 trajectoryId 聚合 Top10）。④ api-docs 补齐缺失的 memory 分组及新字段示例。
  影响范围：记忆决策 API / 审计汇总 / api-docs；外部 Vue 审计页据此渲染。
  文件：scripts/actions/_scenario_describer.py, src/services/trajectory-session-replay.js, src/memory/memory-dao.js, src/memory/memory-service.js, src/dashboard/api-docs/catalog.js

- 2026-08-05: 新建 **system_ref_data / system_ref_entry**（方案 C：旧 `case_data` / `case_data_entry` 保留并标 legacy）。专存目标系统回写、经校验可复用的填表参考值（`source` / `verification_status`）；用户需求**业务数据**仍走 `trajectory.task`【业务数据】块，**禁止**把 analyze/`caseEntries` 写入 system_ref。本迭代提供 CRUD API 地基，录制暂不自动注入 system_ref。
  影响范围：MySQL schema、v2 API、api-docs。
  文件：migrations/20260805220000_system_ref_data.js, schemas/init.sql, src/dao/system-ref-dao.js, src/services/system-ref-service.js, src/routes/v2/system-ref-data.js, src/routes/v2/__init__.js, src/dashboard/api-docs/catalog.js, src/models/entities.js

- 2026-08-05: 记忆 P1 收尾：① **权重引擎完整版**（weight-engine.js）：时间衰减 `recencyFactor`（半衰期默认 1h，检索时动态计算）+ 冲突惩罚（superseded ×0.6）+ `computeWeight` 完整公式；摄取时**冲突版本化**——同 (trajectory, entity, attribute) 新值取代旧值：旧值 `superseded_by` + `disputed`（审计保留），新值 `version=旧.version+1`；检索按 `effectiveWeight`（存储权重×衰减）排序，Fact Pack 带出有效权重（Python fact_pack 同步读取）。② **action 打点 + `fill_before_save` 建模**：`writer.emit_memory_event` 支持 `facts` 参数；recorder 每步上报 `action` 事件（填写动作 label → `filled` 事实）；`phase_done` 补 `outcome` 事实；Node 摄取 phase_done 时对同阶段 filled 字段 × outcome 建 `fill_before_save` 关系（strength 1.0）。
  影响范围：记忆摄取（冲突/关系建模）、检索排序、Python agent 打点。
  文件：src/memory/weight-engine.js, src/memory/memory-dao.js, src/memory/memory-service.js, src/memory/fact-pack.js, src/memory/protocol.js, scripts/memory/writer.py, scripts/memory/fact_pack.py, scripts/recorder.py

- 2026-08-05: 记忆 P1——**analyze 结构化案例数据摄取**：`analyzeRequirementToPhases` 恢复返回结构化 KV（`caseEntries`，复用已有 `extractCaseDataBlock` 规则解析，非 LLM 拆解）；`createTransactionWithPhases` / `setTrajectoryCaseEntries` 落 case_data_entry 后同步摄取 `memory_fact`——`source=requirement`（新加入 EVENT/FACT_SOURCES）、`stance=authoritative`、权重 1.5（base 1.0 × stance 1.5），不可被 LLM 覆盖；空值/空白 label 过滤（与 extractCaseDataBlock 对齐）。配合已就位的事实包注入，模型填表优先采用需求里的权威值。
  影响范围：analyze API 返回（新增 caseEntries 非空）、轨迹创建/案例数据更新、记忆摄取、事实包内容。
  文件：src/services/trajectory-meta-service.js, src/memory/memory-service.js, src/memory/protocol.js

- 2026-08-05: 记忆 P1 全量第一块：① **ContextCompiler v1**（`scripts/context_compiler.py`）：消息窗口裁剪逻辑从 `patch_message_manager` 内联抽取，每次裁剪产出结构化丢弃明细（index/role/preview），随 `context_drop` 事件上报（dropped_items），丢弃可见可审计；`AI_MEMORY_MAX_RECENT` 可配（默认 16 保持旧行为），compiler 异常回退旧内联逻辑。② **表单值决策记录**：`_llm_values.py` LLM 生成（成功/异常两条路径）写 `decision_record(form_value)`——记录模型、温度、输入字段、prompt 预览、输出 actions、parse 策略校验、audit_status；`writer.emit_memory_event` 扩展 `decision` 字段透传。回答「这个测试值是谁、依据什么生成的」。
  影响范围：Python agent 上下文管理 + 表单值生成、记忆摄取（决策类型 form_value 已有）。
  文件：scripts/context_compiler.py（新增）, scripts/agent_utils.py, scripts/actions/_llm_values.py, scripts/memory/writer.py

- 2026-08-05: 记忆 P1 最小切片——**事实包注入**（`AI_MEMORY_FACT_PACK` 默认关，opt-in）：phase 开始前 Node 按 trajectory_id 检索 `memory_fact`（`retrieveFactPack`，含 P0 无归属 NULL 阶段事实），随 step 指令透传 `fact_pack` + `trajectory_id`（lifecycle → forwardStdin → session-handler → Python）；Python 在 preamble 后追加【记忆事实包】块（`scripts/memory/fact_pack.py` 格式化，权威值/已保存值带 stance/source/weight），替代「靠 MAX_RECENT 截断记忆猜」。另修复 `case_saved` 事件补传 `phase_number`（否则事实包按阶段检索不到），`listFacts` 放宽为「匹配阶段或 NULL」。
  影响范围：AI 录制链路（Node step 指令 + Python preamble）、记忆检索、feature flag、api-docs 无变更。
  文件：src/services/trajectory-record-lifecycle.js, src/executor-session-client.js, executor/session-handler.js, src/memory/memory-dao.js, scripts/session_runner.py, scripts/actions/_case_data.py, scripts/memory/fact_pack.py

### Changed

- 2026-08-05: 步骤日志改为**每步一行紧凑格式**：`[step N] done=yes/no stopped=yes/no | goal=…(≤100字) | act=…(≤200字) | res=…(≤120字) err=…`——统一前缀可 grep，goal/actions/result 全截断防刷屏（此前 `[on_step_end]/[next_goal]/[actions]/[last_result]` 四行无前缀输出，`get_page_state` 长 JSON 每次全量刷屏）。完整 tool 结果仍在模型上下文内，日志侧只留关键信号。
  影响范围：Python agent stderr 日志。
  文件：scripts/recorder.py

- 2026-08-05: 移除 `recorder.py` on_step_start 的逐步 `[on_step_start] n_steps=N` 冗余日志（每步刷屏，无信息增量；on_step_end 的状态日志与 5 步节流的 `[recorder] step N done` 保留）。
  影响范围：Python agent stderr 日志。
  文件：scripts/recorder.py

- 2026-08-05: 文档修订：Codex × 浏览器 MCP 集成计划（v1.1）对内驱动由 chrome-devtools-mcp 改为 **Playwright MCP 为主**（`--cdp-endpoint` 附着现有 CDP 端口、a11y 快照、`browser_run_code` 执行现有 CTRL helpers、testing 断言做边界证据），chrome-devtools-mcp 降级为可选深度诊断；新增三个产品痛点（弹窗循环 / 任务边界漂移 / 人工辅助依赖）的方案归属——前两者主战场在记忆系统 P1 + 阶段边界合约，驱动层只提供确定性快照与断言证据。灰度测试开发计划同步更新（开关 `AI_MCP_PLAYWRIGHT_URL` / `AI_MCP_PLAYWRIGHT_CAPS`、`AGENT_DRIVER=playwright-mcp|browser-use`、P1 任务与矩阵）。
  影响范围：设计文档（未改动代码）。
  文件：docs/JS-gen学习Codex与ChromeDevTools集成计划.md, docs/JS-gen灰度测试开发计划.md

### Fixed

- 2026-08-05: 明确区分 **业务数据** vs **案例数据**：前者是用户需求里要使用的关键/场景说明（相对结构化 NL，容忍偏差，原文给 AI 判断）；后者是系统回写、由本项目落库的录制产物（`save_case_data` / form snapshot / case_data 表）。历史符号 `case_data_block` 等常承载业务数据，注释已标明勿混用。同步将 agent 提示头 /api-docs 改为【业务数据】。
  影响范围：设计口径 / agent preamble /api-docs / 工程师注释。
  文件：src/services/trajectory-record-lifecycle.js, src/services/trajectory-meta-service.js, scripts/actions/_case_data.py, scripts/session_runner.py, scripts/prompts/agent-prompt.md, src/dashboard/api-docs/catalog.js

- 2026-08-05: 案例数据改为**原文提示给 AI 自行判断**，不再用 fieldKey↔表单 label 硬匹配驱动 autofill/`match_form_rule`（修复「法定责任人引入 朱桂武」注入后放大镜仍查主表「客户名称」的错配）。record/start 抽取 `case_data_block` 写入 phase instruction + Python `_case_scenario_text`；KV 仍可选透传供 `read_case_data`。设计前提：用户需求里的关键数据多为相对结构化表述（如「引入 / 法定责任人引入 朱桂武」），无法也不应要求严格 KV，需容忍措辞偏差——已在 lifecycle / `_case_data.py` / meta-service 注释写明。
  影响范围：录制注入、agent preamble、autofill。
  文件：src/services/trajectory-record-lifecycle.js, src/executor-session-client.js, executor/session-handler.js, scripts/actions/_case_data.py, scripts/actions/_form.py, scripts/session_runner.py, src/services/trajectory-meta-service.js

- 2026-08-05: 人工录制开/关：执行机未连接时 `forwardStdin` 改为明确 503；`manual_record_status` ack 等待 8s 后乐观回落，避免 HTTP 长时间挂起。Vue 侧 `manual-record` / `record/stop` / `detach` / `stream/detach` 显式加长超时。
  影响范围：manual-record API、产品前端录制超时。
  文件：src/services/trajectory-record-lifecycle.js（Vue 在 ui-auto-recording-agent-vue-master）

- 2026-08-05: 记忆系统 P0 摄取层两处数据 bug（冒烟脚本实测暴露）：① `normalizeDecision` 的 `policyChecks` / `outputJson` / `finalAction` 未显式序列化——mysql2 会把数组参数展开为多值，`decision_record` 插入报 `Column count doesn't match value count`；现统一 `toJsonString` 序列化。② 多行 `INSERT` 仅返回单 insertId——`insertFacts` 返回值长度被当作事实计数（少计）且 `co_occur` 关系因 `ids[1]=undefined` 静默丢失；新增 `factIdsByEvent` 按 event_id 回查真实 id，关系建模基于真实 id。新增冒烟脚本 `scripts/smoke/smoke-memory-ingest.mjs`（摄取→检索→审计→统计→清理，23 项断言全过）。
  影响范围：记忆系统摄取（Node service/dao）、冒烟验证。
  文件：src/memory/memory-service.js, src/memory/memory-dao.js, scripts/smoke/smoke-memory-ingest.mjs

- 2026-08-05: `select_option` check 模式在 label 未匹配时无条件取**第一个可见 select** 的当前值（常是分页器 `10条/页`），误导模型跳过真实字段（自愈日志实锤：`ok-already:10条/页`）。现 fallback 仅认可 placeholder 或所属 form-item label 关联目标 label 的 select，否则返回 `not-found` → 走 `label-not-found` 报错。修复自愈链路 `select_option 模型名称/first` 错配为分页器。
  影响范围：Python agent 表单动作（select_option / check / replay fallback）。
  文件：scripts/actions/_js_snippets.py

- 2026-08-05: 无进展循环止损（自愈日志实锤：`get_page_state` 连发 3 次空转至 max_steps 后需人工）。`recorder.py` 指纹映射新增只读动作（`get_page_state` / `check_field_value` / `scan_form_fields` / `get_pending_tasks`），heal 模式新增「连续 ≥3 次相同只读动作 → 停止」检测（原 heal 分支完全跳过周期检测）。非 heal 模式的只读动作循环亦可被 cycle detect 捕获。
  影响范围：Python 录制/自愈止损。
  文件：scripts/recorder.py

- 2026-08-05: `close_dialog` 回放幂等化：录制语义为「确保弹窗关闭」，回放时若前置动作（确定/下一步）已关掉弹窗/抽屉/message-box，不再报 `click-failed:not-found` 触发无效自愈，直接返回 `ok (no visible dialog/drawer — already closed)`。可见性检测用 offsetParent + getBoundingClientRect 兜底（对齐固定定位 drawer）。
  影响范围：live replay（scripts）。
  文件：scripts/actions/_replay.py

- 2026-08-05: 记忆系统 P0 阻断项修复：`scripts/session_runner.py` 中 `from scripts.memory.writer import (` 首行丢失导致 IndentationError，且 `configure_memory_writer(session_id=session_id, …)` 在 `session_id` 赋值前调用（运行期 NameError）。现导入语句完整、`session_id` 先赋值再 configure；`recorder.py` 501 行 f-string 为单行无语法问题。Python 侧 9 个记忆相关文件 AST 全部通过，writer/store/fact_pack/feature_flags 导入验证通过。
  影响范围：Python agent 记忆旁路（P0，只写不读）。
  文件：scripts/session_runner.py


- 2026-08-05: 「客户名称搜索为…，点击下一步」误判为 query（强制点查询收口）；现含「下一步/上一步」时退出 query，boundary `role=navigate` + 向导 hint；表单动词（新增/填写/修改…）优先于 wizard 关键词，向导表单步仍按 maintain 录制。
  影响范围：scripts 阶段分类 / agent preamble。
  文件：scripts/actions/_phase_context.py, scripts/actions/_phase_boundary.py, scripts/session_runner.py

- 2026-08-05: 「点击评级申请。预期结果：打开…页面」类阶段此前为 `other` 无收口 cue，AI 打开页面后继续把弹窗流程走完；现识别为 boundary `role=navigate`（goal `open_page`）+【打开页面/导航】hint：页面/弹窗出现即 done，禁止在新页面内继续操作；agent-prompt 任务类型表与完成规则同步。
  影响范围：scripts 阶段分类 / agent preamble / agent prompt。
  文件：scripts/actions/_phase_context.py, scripts/actions/_phase_boundary.py, scripts/prompts/agent-prompt.md

### Changed

- 2026-08-05: 稳健相对 xpath：录制生成不再写 dialog `[last()]`；树节点剥 `(n)`/`[V-x]` + 可选 parent_text；图标优先 `el-icon-*` class（tip 文案入 params）；无 label 时 placeholder 锚点。回放侧对旧 `[last()]` 改解析为最后可见 dialog/drawer，树/按钮全去空格匹配，图标 class+tooltip。
  影响范围：locator-candidates / inspect / live replay（scripts）/ api-docs 合同文案。
  文件：src/cdp/locator-candidates.js, src/cdp/inspect.js, scripts/actions/_replay.py, scripts/actions/_js_snippets.py, scripts/actions/_locator_helpers_js.py, src/dashboard/api-docs/catalog.js

### Added

- 2026-08-05: AI 录制 **阶段边界合约**（`AI_PHASE_BOUNDARY` 默认 on，opt-out）：role/goals/证据收口替代散落 if；混合「新增+完成引入」须引入证据+保存证据；picker 确认写 `picker_closed` 并父 container `_form_stale` 重扫；`_task_lists_by_container` 按 `JS_IDENTIFY_CONTAINER` 分存；录制 `events[]` / SSE 含 `phase_boundary_obs`。
  影响范围：scripts 录制语义、record-lifecycle events、api-docs、feature flag。
  文件：scripts/actions/_phase_boundary.py, scripts/actions/_phase_intent.py, scripts/actions/_form.py, scripts/actions/_misc.py, scripts/feature_flags.py, scripts/session_runner.py, src/services/trajectory-record-lifecycle.js, src/dashboard/api-docs/catalog.js

- 2026-08-05: P1 干预通道清理：移除 `request_intervention` / `intervention_needed` SSE 与 STDIN `intervene` 映射；prompt 改为特殊元素 + `click_adjacent_button` + 人工录制；browser-session 转发 `phase_intent_obs` / `phase_boundary_obs`；case_data 跳过键对齐 phase 内部状态。
  影响范围：工程 session SSE、executor stdin 映射、case_data 持久化过滤、element locator 豁免表。
  文件：src/routes/browser-session/session-message.js, src/services/case-data-service.js, src/models/element.js, src/executor-session-client.js, scripts/prompts/*, scripts/actions/_scenario_describer.py

### Fixed

- 2026-08-05: create 阶段内客户放大镜「确认」死锁：`use-click-save` 禁索引确认，同时 `click_save(确认)` 被 query-toolbar 判为 not-form-save。现 picker UI 允许索引确认；query UI 上 `click_save(确认/确定)` 走引入确认；auto-fill 对 disabled+button 优先特殊元素/引入而非先 click_save。
  影响范围：Python agent actions（_misc / _form / _phase_intent）。
  文件：scripts/actions/_misc.py, scripts/actions/_form.py, scripts/actions/_phase_intent.py

- 2026-08-04: 录制 `session.step` 透传丢弃 `special_element_candidates` / `prior_phases`，导致 agent 日志 `special_element_candidates loaded: 0`（库内已有「对公客户引入流程」仍无法 `use_special_element`）。`forwardStdin` + executor `session.step` 现完整转发。
  影响范围：executor WS 载荷、录制 step 注入。
  文件：src/executor-session-client.js, executor/session-handler.js, src/services/trajectory-record-lifecycle.js

- 2026-08-04: 阶段意图合约将「新增…如果出现引入按钮…」误判为 `introduce_pick`（`force_refill_all=False`）；现 create/modify 优先，纯引入阶段仍为 `introduce_pick`。另：`_query_ui` 不再跨弹窗粘性（放大镜关闭后可再 `click_save`）。特殊元素搜索归一「法定责任人/代表人」并加强引入语义加权。
  影响范围：Python agent 合约 / form 查询栏检测；搜索评分（控制面）。
  文件：scripts/actions/_phase_intent.py, scripts/actions/_form.py, scripts/actions/_phase_context.py, src/services/special-element-search-service.js, scripts/characterization/*

### Added

- 2026-08-04: WS `remote:input` 文档化；`kind:'text'` 支持可选 `replace:true`（选中 activeElement 后 insertText，空 text 清空）。便于 SPA 透明 input IME 透传（中文 composition 在本机完成，确认后下发 text；控制键仍走 kind:key）。
  影响范围：WS 契约、CDP bridge（local + executor）、api-docs。
  文件：src/cdp/remote-bridge.js, executor/bib-bridge.js, src/dashboard/api-docs/catalog.js

- 2026-08-04: `POST /api/v2/trajectories/:id/steps/replay/stop` — 用户可中断进行中的 steps/replay 自愈（Type A/B）；WS `replay:finished` 增加 `aborted`/`reason`（主动停止时 `error:null`）。
  影响范围：route、service（session-replay）、runtime flag、WS 契约、api-docs。
  文件：src/routes/v2/trajectory.js, src/services/trajectory-session-replay.js, src/services/trajectory-runtime.js, src/services/trajectory-recording-service.js, src/services/trajectory-service.js, src/dashboard/api-docs/catalog.js

- 2026-08-04: 表单结构变化自愈（Type B）：`form_snapshot.trigger_step_id` 绑定 checkpoint `trajectory_step`；live 录制双写；`steps/replay` 遇 `save_form_snapshot` 校验结构并删 missing / 结构化插入 adding；WS `replay:form_structure` + `healType`。
  影响范围：schema、service（persist / session-replay / step）、WS 契约、api-docs。
  文件：migrations/20260804010000_form_snapshot_trigger_step.js, schemas/init.sql, src/dao/form-snapshot-dao.js, src/services/trajectory-persist-service.js, src/services/trajectory-session-replay.js, src/services/trajectory-step-service.js, src/routes/browser-session/heal-instruction.js, src/dashboard/api-docs/catalog.js

### Fixed

- 2026-08-04: 执行机 agent 在 `ready` 前崩溃后 slot 变成幽灵占用（`sessionId` 未清，下一次落到更高 slot）。现失败 open / process_exit 回收槽位，`_findFreeSlot` 也会回收无活进程的 ghost。
  影响范围：executor slot 生命周期。
  文件：executor/session-slot.js, executor/session-manager.js

- 2026-08-04: BiB 默认视口/推流改为 **1600×900 / quality≈65**（相对 1080p 更流畅，相对 720p 显示更全）；去掉编码强制抬到 1080p，编码跟视口走（上限仍 1920×1080）；Chrome 不自动最大化。
  影响范围：executor bib-bridge、local remote-bridge、remote-session 默认值、prepare attach、session_runner 窗口、api-docs。
  文件：executor/bib-bridge.js, src/cdp/remote-bridge.js, src/services/remote-session-service.js, src/services/trajectory-attach-service.js, scripts/session_runner.py, src/dashboard/api-docs/catalog.js

- 2026-08-04: `record/prepare` 在无在线执行机时改为 **409** + 中文 `无可用执行资源（没有在线执行机）` + `holders`（与槽位已满同形），避免英文 500 `No executor agent online` 导致前端无法提示。
  影响范围：executor 选节点、api-docs。
  文件：src/executor-slot-lease.js, src/executor-session-client.js, src/dashboard/api-docs/catalog.js

- 2026-08-04: 修复 `trajectory.remote_session_id` 脏指针导致「2 个浏览器却显示多笔占用」：挂载时互斥清掉其他交易的同 rs FK；stream detach / close 扫清所有指向该 rs 的交易（live→draft）；启动时 reconcile 修复历史脏数据。
  影响范围：service（remote-session、trajectory-attach、idle-reaper）、dao、server 启动对账。
  文件：src/dao/trajectory-dao.js, src/services/remote-session-service.js, src/services/trajectory-attach-service.js, src/services/trajectory-idle-reaper.js, src/executor-ws.js, server.mjs

- 2026-08-03: 同一 trajectory 重复 `record/prepare` 或控制面重启后，可能残留多条 `active` 的 `remote_session`，`trajectory.remote_session_id` 与 BiB 实际推流 UUID 不一致导致前端黑屏。
  影响范围：service（remote-session、trajectory-attach）、executor-ws 启动恢复。
  文件：src/dao/remote-session-dao.js, src/services/remote-session-service.js, src/services/trajectory-attach-service.js, src/executor-ws.js
- 2026-08-04: 黑屏修复收紧：`supersede` 仅关闭非当前 agentSession/非 keepId 脏行；prepare 在 session 不匹配时强制 re-attach（不再沿用已关闭的 runtime.remoteSessionId）；`getLiveStatus` 优先 runtime.sessionId 一致的 attached binding 并回写 FK；执行机重连关闭同 traj 旧 active 行。
  影响范围：service（remote-session、trajectory-attach）、executor-ws。
  文件：src/services/remote-session-service.js, src/services/trajectory-attach-service.js, src/executor-ws.js

### Changed

- 2026-08-04: 案例数据 V2.2 口径落地：analyze 将「关键数据/案例数据」原文附到每个 phase（不拆 caseEntries）；`caseEntries` 仍可 POST/PATCH 入库但不注入录制；录制填表靠 phase 文本 + agent prompt 优先对齐场景值，autofill 继续随机补其余字段；报文捞取仅文档占位。
  影响范围：analyze、record/start 注入、api-docs、agent prompt。
  文件：src/services/trajectory-meta-service.js, src/services/trajectory-record-lifecycle.js, src/routes/v2/trajectory.js, src/dashboard/api-docs/catalog.js, scripts/prompts/agent-prompt.md

- 2026-08-03: `trajectory_step.confirmed` 语义重定义：DEFAULT 0→1，注释"人工确认"→"回放确认"。
  影响范围：schema（DEFAULT + COMMENT）、Python 端 trajectory_step domain。
  文件：migrations/20260803110000_trajectory_step_confirmed_replay.js, migrations/20260803111500_trajectory_step_confirmed_comment.js


### Removed

- 2026-08-15: **废弃组装回放栈下线**：删除 `src/routes/v2/replay.js`（5 个 REST 端点 + WS `replay:start`）与 `src/services/replay-service.js`；`/api/test/assemble`、`/api/test/run` 与产品 live `/steps/replay`（`_replay.py`）保持不变。api-docs 同步删除已弃用 replay 组与 `replay:status/step/screenshot/result/done` 事件（保留 `replay:form_structure`）。
  影响范围：`/api/v2/trajectories/:id/replay/*`、`/api/v2/replays/:replayId` 与 WS `replay:start` 已移除。
  文件：src/routes/v2/replay.js（删除）, src/services/replay-service.js（删除）, src/routes/v2/__init__.js, server.mjs, src/dashboard/api-docs/groups/recording.js, websocket.js, app.js, scripts/smoke/accept-engineering-apis.mjs（新增）, scripts/refactor/verify-all.sh

### Changed

- 2026-08-26: **三路径相对 XPath 统一**：AI 录制 / 人工录制 / 自动抓取统一 `buildLocatorSnap` 5 参调用（targetKind action-aware）+ formLabel 统一 DOM 取（含 placeholder 回退）+ region/layers/feature_card 全量透传。人工录制 select_option/click_radio/switch_tab/close_dialog 补齐 smart locator（原仅绝对 xpath）。同一 DOM 节点三入口产出 xpath_smart/xpath_full/candidates 完全一致（新增 characterize-xpath-three-sources.mjs 回归护栏）。
  影响范围：AI 录制 elMeta（src/cdp/inspect-payload-script.js）、自动抓取 snap（src/cdp/resolve-by-label.js）、人工录制（scripts/manual_recorder/js_parts/a.py、b.py）、Python mapper（scripts/manual_recorder/mapper.py）、一致性回归护栏（新增 characterize-xpath-three-sources.mjs）。无 schema/路由/WS 变更，算法内核 page-locator-helpers.js 未改。
  文件：src/cdp/inspect-payload-script.js, src/cdp/resolve-by-label.js, scripts/manual_recorder/js_parts/a.py, scripts/manual_recorder/js_parts/b.py, scripts/manual_recorder/mapper.py, scripts/characterization/characterize-xpath-three-sources.mjs（新增）, scripts/characterization/fixtures/xpath-unify-fixture.html（新增）

## 条目格式约定

每次修改本项目必追加到 `[Unreleased]` 区段（发版时再剪切到 `[x.y.z] - YYYY-MM-DD`）：

- 一级分类：`Added` / `Changed` / `Deprecated` / `Removed` / `Fixed` / `Security`

## 强制规则

**涉及以下变更时必须写 CHANGELOG**：

- `migrations/` 新增或修改迁移（schema 变更）
- `src/routes/` 端点新增/删除/改路径/改响应格式
- `src/services/` 业务逻辑变更
- `server.mjs` WebSocket 协议变更
- `config/` 配置项变更

仅改 `scripts/`（Python 子进程）可不写 CHANGELOG。
