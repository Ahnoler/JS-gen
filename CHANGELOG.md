# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

本文件**只从 2026-08-03 开始记**，之前的 24 个迁移（2026-07-13 ~ 2026-08-02）不回填。
Python 控制面（`d:\dev\ui-auto-recording-agent-python`）以当前 `schemas/init.sql` 为基线对齐，历史迁移视为已同步。

## [Unreleased]

### Added

- 2026-08-24: **LLM 请求超时保护（`LLM_TIMEOUT_MS`）**：新增配置 `LLM_TIMEOUT_MS`（毫秒，默认 120000，`.env` 唯一真源）。此前所有 LLM 调用无超时——网关通道挂起（如 GLM-5 宕机，请求 60s+ 无任何响应）时 agent 每步 LLM 调用无限阻塞，最终以「Phase idle timeout: no agent activity for 10 minutes」这种迟钝方式暴露。现三处生效：① `src/llm-utils.js` `callLLM`（`AbortSignal.timeout`）；② `src/routes/llm-proxy.js` `/v1/chat/completions` 转发（agent 主链路）——超时返回 **504 `upstream_timeout`** 并附排查指引（错误体不再挂起）；③ Python `agent_utils.create_llm` 与 `_llm_values._get_form_llm` 的 `ChatOpenAI(timeout=..., max_retries=1)`（表单 LLM 直连网关场景）。执行机与 global-browser spawn Python 时下发 `LLM_TIMEOUT_MS`。
  影响范围：LLM 调用失败模式从「无限挂起」变为「120s 内快速失败」；超时值经 `.env` 可调。无 schema/WS 变更。
  文件：config/config.js, config/.env, config/.env.example, src/llm-utils.js, src/routes/llm-proxy.js, src/routes/browser-session/global-browser.js, executor/config.js, executor/session-slot.js, scripts/agent_utils.py, scripts/controller/actions/_llm_values.py
  Python 同步提示：Python 端读 `LLM_TIMEOUT_MS`（毫秒）设 ChatOpenAI timeout；控制面透传该 env 给 Python 子进程。

### Changed

- 2026-08-24: **V3 `type` 字段对齐 §8 层级类型定义**：V3.1 flat 导出 `transcationProperties[].type` 从 4 种改为 §8 定义的层级类型值——截图条目 `dialog`→`popup`（`page` 不变）；控件条目 `ele`→`object`；中间节点按 `region_id` 段 role 映射：`tab`→`tab`、`wizard`→`wizard`、`card`→`card`（此前全为 `section`），`section/titlebox/table/todo`→`section`（不变），`dialog/overlay`→`popup`；`main/shell-header/shell-aside/other` 等结构性 role **跳过不建节点**（ele pid 直指上层，用户决策"main 归 page 级"）。覆盖校验/字段完整性校验/伙伴出站适配/可视化工具同步更新。**V3.0 groups 格式（legacy）不动**。
  影响范围：V3 导出 payload（`type` 字段取值集变更：新增 `popup`/`tab`/`wizard`/`card`/`object`，移除 `dialog`/`ele`——V3.1 flat only）、伙伴出站契约、可视化工具、API docs。V2 / V3.0 groups 不受影响。无 schema/WS 变更。
  文件：src/services/transaction-export-v3.js, src/services/partner-platform.js, config/config.js, src/dashboard/api-docs/groups/export-mgmt.js, scripts/tools/lightup-phase-screenshot.mjs, scripts/tools/layer-tree-from-properties.mjs, scripts/characterization/characterize-export-v3.mjs, scripts/characterization/characterize-export-v3-pid.mjs, scripts/characterization/characterize-export-v3-field-completeness.mjs, scripts/characterization/characterize-page-level-screenshot.mjs, scripts/characterization/characterize-dialog-screenshot.mjs, scripts/characterization/characterize-layer-tree.mjs, scripts/characterization/characterize-partner-platform.mjs
  Python 同步提示：**契约变更**。`transcationProperties[].type` 取值集变更（V3.1 flat）：`dialog`→`popup`、`ele`→`object`、新增中间节点类型 `tab`/`wizard`/`card`（此前均为 `section`）。消费方需按新类型值识别层级种类。`main/shell-header/shell-aside/other` role 不再产出中间节点。V3.0 groups 格式不受影响。

- 2026-08-24: **Partner 批量推送切到同事本地联调服务**：`PARTNER_API_BASE` 默认值从 `http://test.atp.tansun.com.cn/api` 改为 `http://172.20.101.162:11001/api`（172.20.101.162:11001 为同事本地服务，原 test.atp 已停用；80 端口无服务；env `PARTNER_API_BASE`/`PARTNER_IMPORT_DEMAND_URL` 仍可覆盖）。`resolveAccessToken` 回落链增加硬编码联调 JWT（`PARTNER_DEBUG_ACCESS_TOKEN`，同事 172.20.101.162 的 access token）：请求头 token → `PARTNER_ACCESS_TOKEN` env → 硬编码 JWT，无登录态脚本/联调不再 400。⚠️ 临时联调配置：硬编码 token 含敏感凭据，联调结束须移除（历史曾移除过一次，恢复时已同步更新 characterize-partner-platform 断言）。
  影响范围：出站推送目标地址、token 回落语义（无请求 token 时不再 400）、characterization（partner-platform）。无 schema/WS 变更，API docs 契约未变。
  文件：src/services/partner-platform.js, config/.env.example, scripts/characterization/characterize-partner-platform.mjs
  Python 同步提示：若 Python 控制面也推送 partner，需将地址改为 `http://172.20.101.162:11001/api` 并使用同一 token（SSO JWT）；token 来源与有效期以同事本地服务为准。

- 2026-08-24: **V3 分区数据改用 propertiesID/propertiesPID 父子树表达（partition-via-pid）**：V3 导出构建期（`buildV3Properties`）从 `region_id` 链提取分区段（tab/section/titlebox 等），为每段创建 `type='section'` 中间节点插入 `transcationProperties[]`，ele 的 `propertiesPID` 指向最近 section 节点（无分区段时直指 page/dialog 截图，存量兼容）。同页同名控件（如两个「保存」按钮）因分区不同 pid 不同 → 可区分。`validatePageLevelCoverage` 改为沿 PID 链向上追溯（`resolveRootScreenshotId`）到 page/dialog 截图校验覆盖。伙伴出站适配新增 `PARTNER_SECTION_TYPE` 配置（默认 `'section'`，伙伴不接受时可切 `'ele'+elementType='partition'`）。可视化工具 lightup 加 PID 树侧栏、layer-tree 识别 section 节点为中间层。
  影响范围：V3 导出 payload（`transcationProperties[].type` 新增 `'section'` 值；ele `propertiesPID` 可能指向 section 节点而非 page/dialog）、伙伴出站契约、可视化工具、API docs。V2 不受影响。无 schema/WS 变更。
  文件：src/services/transaction-export-v3.js, src/services/partner-platform.js, config/config.js, src/dashboard/api-docs/groups/export-mgmt.js, scripts/tools/lightup-phase-screenshot.mjs, scripts/tools/layer-tree-from-properties.mjs, scripts/characterization/characterize-export-v3-pid.mjs, scripts/characterization/characterize-export-v3.mjs, scripts/characterization/characterize-page-level-screenshot.mjs, scripts/characterization/characterize-partner-platform.mjs, scripts/refactor/verify-all.sh
  Python 同步提示：**契约变更**。`transcationProperties[].type` 新增 `'section'` 值（分区容器节点，无截图/坐标/action）；ele 的 `propertiesPID` 可能指向 section 节点而非 page/dialog，消费方需沿 PID 链上溯找根截图。伙伴出站 `PARTNER_SECTION_TYPE` 配置项（默认 `'section'`，fallback `'ele'+elementType='partition'`）。

- 2026-08-24: **阶段步数预算耗尽续跑（budget-extend）**：agent `run()` 后质量门改为续跑循环——done 未触发且仍有待完成字段（introduce/pending/tree-select）时，用同实例二次 `agent.run(max_steps=extension)` 续跑（≤2 轮，ceiling 钳制）。`compute_budget_extension` 纯函数（reviewer.py）按成本模型计算续跑步数（introduce×4 + pending×2 + tree_select×1 + 2，clamp 到 ceiling-used；全空返回 0）。done 检测用闭包 flag `case_data_store['_done_fired']`（`make_done_callback` 设置，不依赖 `agent._done_fired`）。引入字段计数从 `_scan_fields`（disabled && hasButton）读。phase_end payload 新增 `budgetExtensions` 观测字段（每轮步数/引入/pending 数）。
  影响范围：agent 运行控制流（续跑行为）、phase_end 观测 payload（新增可选字段，向后兼容）、scripts/ Python 代码。无 schema/WS/Node 变更。
  文件：scripts/controller/actions/phase/reviewer.py, scripts/agent_utils.py, scripts/agent/service.py, scripts/characterization/characterize-budget-extend.py, scripts/refactor/verify-all.sh
  Python 同步提示：phase_end observability payload 新增 `budgetExtensions` 字段（数组，每项含 round/steps/introduce/pending，消费方按可选字段处理）。`compute_budget_extension` 纯函数可对齐（成本模型：introduce×4 + pending×2 + tree_select×1 + 2，clamp ceiling-used）。

- 2026-08-24: **V3 字段完整性校验 + 超长截断 + 推送前自检（v3-payload-size ②③）**：新增 `validateFieldCompleteness`（ele 缺 elementType+realLabel / orphanPid、page/dialog 空截图、空名称 → issue，section 节点豁免）和 `preflightCheck`（wire payload 中 undefined 值检测——JSON.stringify 静默丢弃 undefined key 的信息丢失风险、page/dialog 无 screenCapture），均**只统计不阻断**。超长字段截断（`FIELD_LENGTH_LIMITS`：elementType 2000、options 4000、objectValue 500、propertiesName 100，超长截断加 `...truncated` 后缀），在 `buildTransactionEntryV3` 合并后 `uniquifyPropertiesNames` 之前应用。stats 扩展 `fieldCompletenessIssues` 和 `truncatedFields`（per-entry + 聚合），批量推送响应 surface `merged.stats`。
  影响范围：V3 导出 payload（超长字段被截断，消费方需处理 `...truncated` 后缀）、推送响应（新增 stats 可选字段）、推送日志（preflight 非阻断告警）。无 schema/WS 变更。
  文件：src/services/transaction-export-v3.js, src/services/partner-platform.js, src/routes/v2/export-mgmt.js, scripts/characterization/characterize-export-v3-field-completeness.mjs, scripts/refactor/verify-all.sh
  Python 同步提示：V3 payload 超长字段可能含 `...truncated` 后缀（elementType>2000/options>4000/objectValue>500/propertiesName>100），消费方按截断处理。批量推送响应新增 `stats` 可选字段（含 `fieldCompletenessIssues`/`truncatedFields` 聚合统计）。

- 2026-08-22: **录制监听器生命周期修复（session-end 截图配套）**：AI 录制的事件订阅（trajectory-recording-runner 的 action_log_sync / step_screenshot / page_level_screenshot 监听）原在 record/start 完成时立即注销，导致 detach 时 Python agent 优雅退出路径发出的会话结束最终截图（capturedAt='session-end'）无人接收而被丢弃。现改为：订阅挂在会话上（session._aiRecordUnsub），随会话关闭（closeSession → removeSessionHub）自动清理，detach / 节点掉线 / 运行时清理路径同步显式注销；重录时先注销旧订阅。影响范围：录制事件持久化（record/start 结束后至 detach 前的事件不再丢失）；文件：src/services/trajectory/trajectory-recording-runner.js, trajectory-attach-service.js, trajectory-runtime.js, src/services/executor-node-service.js。
- 2026-08-22: **executor 会话优雅关闭宽限修复（session-end 截图配套）**：SessionSlot.close() 原在写入 close 事件后固定等 2 秒即 taskkill /F 强杀进程树，Python agent 的优雅退出路径（session-end 最终截图、记忆队列冲刷、浏览器关闭）来不及执行导致截图缺失。现改为：成功写入 close 事件后等待子进程自然退出（上限 20 秒），超时才强杀；写入失败保持原 2.5s/2s 兜底。影响范围：会话 detach/关闭行为（宽限 2s→20s，最坏关闭耗时增加；正常路径 agent 数秒内自然退出不受影响）。文件：executor/session-slot.js。
- 2026-08-21: **关键状态前置截图（session-end / before-close / close_notification）**：补齐三类"关键状态转变前"截图——① 会话结束（含 error/cancel/SystemExit 异常退出路径）在 `browser_context.close()` 前追加一次当前页面截图：`register_current_page_screenshot` 新增可选参数 `captured_at`（默认 `'phase-end'` 维持既有调用方语义），meta `capturedAt` 新增取值 `session-end`；② `close_dialog` 在关闭动作执行前先捕获弹窗裁剪图（`capturedAt:'before-close'`，经 `register_popup_screenshot` 落 popup 级截图），动作后跳过 post 弹窗捕获（弹窗已关必为空），step 级 dialog 图改用前置图；③ `close_notification` 移出 `_SKIP_SCREENSHOT_ACTIONS` 跳过名单（关闭前有整页 before/after 图），`capture_dialog_png_b64_from_page` 弹窗选择器追加 `.el-notification:visible`、标题选择器追加 `.el-notification__title`（可见通知也能出裁剪图）。
  影响范围：录制截图语义（`capturedAt` 新增 `session-end`/`before-close` 两个取值，消费方按可选字段处理；close_dialog 步骤多一次前置弹窗捕获，仅该动作触发，频率极低）；复用 `page_level_screenshot` / `step_screenshot` 事件，无 schema/WS/Node 消费面变更。
  文件：scripts/state.py, scripts/session_runner.py, scripts/controller/service.py, scripts/characterization/characterize-before-close-screenshots.py, scripts/refactor/verify-all.sh
  Python 同步提示：`capturedAt` 新增取值 `session-end`（会话结束最终页图）与 `before-close`（弹窗关闭前裁剪图），消费方按可选字段处理即可；弹窗/通知裁剪选择器扩展（`.el-notification:visible`），Python 控制面如需对齐按同样选择器扩展。

- 2026-08-21: **批量动作显式化（`max_actions_per_step` 参数化）**：browser_use 0.1.48 一轮多动作此前走框架默认 10（Agent 构造未传参，实际生效但不可控），现新增 `MAX_ACTIONS_PER_STEP` 配置（默认 4）经 Node → Python 透传显式控制。解析规则（`resolve_max_actions_per_step` 纯函数，scripts/agent_utils.py）：指令显式值优先（0/空不覆盖）→ 否则按 contract 模式映射（create/modify/introduce_pick → 5；navigate/query/login/其它/None → 3）→ clamp 到 [1,10]。agent prompt 追加批量输出纪律（同一轮多动作仅允许对已存在元素的连续填充/选择，如多个 fill_form_field / click_radio；禁止 click_element、导航、下拉展开、select_option 等 DOM 结构变更动作与保存/提交类动作入批）；agent-tools-form「每步最多 1 个 select_option」不变。观测：Agent 构造前 stderr `[batch] max_actions_per_step=N (source=config|mode|default)`；phase_end observability payload 增加 `maxActionsPerStep` 字段。
  影响范围：agent 会话批量动作预算（行为可调）、prompt 纪律、phase_end 观测 payload（新增可选字段，向后兼容）、config 新增配置项。无 schema/WS 变更。
  文件：config/config.js, config/.env, config/.env.example, src/services/trajectory/trajectory-recording-runner.js, scripts/agent_utils.py, scripts/agent/service.py, scripts/prompts/agent-tools-common.md, scripts/characterization/characterize-batch-actions.py, scripts/refactor/verify-all.sh
  Python 同步提示：phase_end observability payload 新增 `maxActionsPerStep` 字段（消费方按可选字段处理）；Python 控制面如需对齐批量动作预算语义，参照 `resolve_max_actions_per_step` 规则（显式值优先、模式映射 5/3、clamp [1,10]）。

- 2026-08-21: **V3 `rect` 字段改为 JSON 字符串**：`transcationProperties[].rect` 从对象改为字符串（如 `'{"x1":0.4617838541666667,"y1":0.11821438412785891,"x2":0.6642903645833333,"y2":0.12703224028658033}'`），空值从 `{}` 改为 `""`，方便消费方单列存储。序列化在 `buildTransactionEntryV3` 合并截图+控件条目后统一进行（构建期内部仍为对象，弹窗坐标换算不受影响）；`validatePageLevelCoverage` 可定位判定兼容字符串/对象两种形式；`lightup-phase-screenshot` 工具读取 payload 时解析字符串 rect（兼容旧对象格式文件）。底层导出函数 `buildScreenshotEntries` / `buildV3Properties` 返回值保持对象形式（内部构建形态，非 payload 契约）。
  影响范围：V3 导出服务契约（payload 中 rect 类型变化：对象→字符串，空 `{}`→`""`）、API docs、tools（lightup）、characterization。V2 不受影响（V2 无 rect 字段）；无 schema/WS 变更。
  文件：src/services/transaction-export-v3.js, src/dashboard/api-docs/groups/export-mgmt.js, scripts/tools/lightup-phase-screenshot.mjs, scripts/characterization/characterize-export-v3.mjs, scripts/characterization/characterize-page-level-screenshot.mjs
  Python 同步提示：**契约变更**。若 Python 控制面消费 V3 推送或自行组装 V3 payload，`rect` 字段按 JSON 字符串处理（解析后取 x1/y1/x2/y2 四值；空为 `""`，不再有 `{}` 对象形式）。截图条目与控件条目同理。

- 2026-08-21: **batch/names 仅返回已有交易轨迹的任务名**：交易列表「按任务名筛选」下拉候选原先包含全部任务，含未产生任何交易轨迹的空任务（选中后列表恒为空）。`listDistinctNames` 增加 `EXISTS trajectory.batch_job_id` 关联过滤，空任务不再出现在下拉。
  影响范围：`GET /api/v2/trajectories/batch/names` 返回内容收窄（可能变少）；无 schema 变更。
  文件：src/dao/batch-recording-dao.js, src/dashboard/api-docs/groups/trajectory.js, scripts/characterization/characterize-batch-task-name.mjs
  Python 同步提示：任务名候选接口（如有）应对齐「仅含已产生交易轨迹的任务」语义。

- 2026-08-21: **引入 Node 原生 `#` 路径别名（增量）**：`package.json` 新增 `imports` 映射 `#config/*` → `./config/*`、`#src/*` → `./src/*`（Node ESM 标准子路径导入，零构建依赖）。本次改动涉及的 9 个文件（server.mjs、llm-utils、agent/llm-proxy/setup 路由、resolve-model、两个 service、global-browser）的 config 导入已从多层 `../` 相对路径切换为 `#config/config.js`，消除层数数错导致的 `ERR_MODULE_NOT_FOUND`。**存量其他相对导入不动，新增/改动文件逐步采用**（characterization 对源码做子串断言，避免大面积重写的回归成本）。
  影响范围：仅 import 书写方式，运行时行为不变；无 schema/路由/WS 变更。
  文件：package.json, server.mjs, src/llm-utils.js, src/routes/agent.js, src/routes/llm-proxy.js, src/routes/setup.js, src/runtime/resolve-model.js, src/services/operation-component-mine-service.js, src/routes/browser-session/global-browser.js；第二批：src/services/trajectory/ 下 16 个文件；第三批：src/cdp/remote-bridge/ws-router.js, src/routes/browser-session/{broadcasts,register,watcher-actions}.js, src/routes/v2/{auth,case-data,trajectory}.js, src/services/sso/paas-client.js。`src/` 内 3 层相对导入已清零（0 处残留）。
  Python 同步提示：无（纯 JS 模块解析约定）。

### Added

- 2026-08-21: **`GET /api/v2/llm/models` 模型列表接口**：代理网关 `GET {LLM_BASE_URL}/models`，返回 `{ ok, baseUrl, defaultModel, models[] }`。配置的模型报 `model_not_found` 时可用此接口确认网关实际可用模型名（含 provider 前缀需整名使用）；网关不可达返回 502（错误透传）。API docs 新增「LLM 配置」分组。
  影响范围：新增只读端点，无 schema/WS 变更。
  文件：src/routes/llm-proxy.js, src/dashboard/api-docs/groups/llm.js, src/dashboard/api-docs/catalog.js
  Python 同步提示：可选对齐同名只读端点；无契约破坏。

### Changed

- 2026-08-21: **模型配置统一收敛到 `.env`（`LLM_MODEL` 唯一真源）**：新增 `LLM_MODEL` 配置项（`config/config.js` 导出），消灭散落在 `llm-utils.js` / `resolve-model.js` / `agent.js` / 两个 service / `setup.js` / `executor/session-slot.js` 的硬编码默认模型。**删除 `config/agent-api.json` 及其覆盖逻辑**（原优先级 agent-api.json → .env，构成第二配置源陷阱；`server.mjs` `loadDefaultModel` 现只读 `.env LLM_MODEL`，modelID 保留完整带前缀名）。执行机与 global-browser spawn Python 时显式下发 `FORM_LLM_MODEL` / `FORM_LLM_BASE_URL` / `FORM_LLM_API_KEY`（此前 Python 表单 LLM 只能靠 connect.py 兜底或回落 agent LLM）。`FORM_LLM_MODEL` 缺省回落 `LLM_MODEL`。当前值：`LLM_MODEL=GLM-5`。
  影响范围：LLM 默认模型解析链（会话/表单/分析）、setup 页生成 .env、执行机 Python 子进程环境。无 schema/WS 变更。
  文件：config/config.js, config/.env, config/.env.example, server.mjs, src/llm-utils.js, src/runtime/resolve-model.js, src/routes/agent.js, src/routes/setup.js, src/services/operation-component-mine-service.js, src/services/trajectory/trajectory-meta-service.js, src/routes/browser-session/global-browser.js, executor/config.js, executor/session-slot.js
  Python 同步提示：默认模型统一经环境配置（`LLM_MODEL`）下发；Python 端如有硬编码默认模型应对齐为读 env。

- 2026-08-21: **LLM 默认供应商由 DeepSeek 切换到 Qwen（new-api 网关）**：默认 LLM 端点改为 `http://218.77.58.156:3000/v1`，默认模型改为 `Qwen/Qwen3.5-35B-A3B`。**模型名不再剥 provider 前缀**——旧逻辑把 `provider/model` 剥成 `model`（适配 DeepSeek 官方 API），新网关要求完整 `Qwen/...` 名称，故 `resolveModelId`（`src/llm-utils.js`、`src/runtime/resolve-model.js`）改为原样透传。同步更新：`config/config.js` FORM_LLM 默认值、`config/.env` / `.env.example`、`start.ps1` 环境变量、`src/routes/setup.js` 生成 .env 的默认值、`src/routes/agent.js` 与两个 service 的兜底模型名、`scripts/cdp/connect.py` Python 兜底、API docs 示例。llm-proxy 转发体注入的 `thinking:{type:'disabled'}` 已对新网关实测兼容。
  影响范围：LLM 调用链（agent 会话 / 表单填写 / L1c）、setup 页初始配置、API docs 示例。无 schema/路由/WS 变更。
  文件：config/config.js, config/.env, config/.env.example, config/setup.html, start.ps1, server.mjs, src/llm-utils.js, src/runtime/resolve-model.js, src/routes/setup.js, src/routes/agent.js, src/routes/health.js, src/services/operation-component-mine-service.js, src/services/trajectory/trajectory-meta-service.js, scripts/cdp/connect.py, executor/session-slot.js, executor/config.js, src/dashboard/api-docs/groups/{components,memory,trajectory}.js（`config/agent-api.json` 已删除）
  Python 同步提示：模型名语义变化——带 `/` 的模型名需原样传给网关（不再剥前缀）；Python 端如有同样的剥前缀逻辑需对齐。默认端点/模型/key 经各自环境配置下发，无代码结构变更。

### Fixed

- 2026-08-21: **V3 覆盖率校验页面上下文兜底——人工/抓取步骤也归属页面截图**：`buildV3Properties` 的 pid 解析对无页面锚点的步骤（人工录制/自动抓取的表格操作，region 常为 `table` 等区域标记）匹配不到任何页面截图（`propertiesPID=0`）→ `page_level` 严格模式下被覆盖率校验拦截（如交易 33 推送 409「页面级截图缺失」）。修复：按步骤执行顺序维护 `lastPageKey` 页面上下文，步骤自身无 page key 时继承前序最近步骤所在页面——操作发生在该页面，归属同一页面截图；无 element 的纯动作步骤同样继承 pid（仍无 rect 则继续豁免）。已在同事本地后端实测：交易 33 推送返回「同步成功，共同步1条数据」，`isExport=1`。
  影响范围：V3 导出 `buildV3Properties` pid/regionId 组装（覆盖校验更准：人工步骤不再误报缺失）；V2 不受影响；无 schema/路由变更。
  文件：src/services/transaction-export-v3.js, scripts/characterization/characterize-export-v3.mjs, scripts/characterization/characterize-page-level-screenshot.mjs
  Python 同步提示：无（JS 侧导出组装；Python 录制侧如需同语义，可让抓取步骤带 page key 上下文，非必须）。

- 2026-08-21: **V3 批量推送 importDemand 400「参数错误」——发送前做伙伴契约适配**：`/api/v2/export/transactions-v3`（前端批量推送已切到 V3）真实推送被伙伴返回 400 参数错误，而 V2 可推。根因：① V3 的 `transcationProperties` 每步多出 `screenshot` 字段（URL 数组），伙伴 schema 中 `screenshot` 为 **integer（是否执行截图）**，数组/空字符串导致 Jackson Integer 反序列化失败；② `regionId/regionLabel` 不在伙伴 schema（未知字段）。修复：`partner-platform.js` 新增 `toPartnerImportPayload` 纯函数（发送前统一适配，仅影响发送体、不影响 dry-run/响应）：剥 `regionId/regionLabel`、`screenshot[]` 并入 **`screenCapture`**（逗号串，伙伴 V3 新契约字段名）后删除 `screenshot` 字段；**`page`/`dialog`/`ele` 步骤全量保留**（伙伴 V3 契约确认 page 步骤透传，页面级截图经 `screenCapture` 送达）。已在同事本地后端实测：交易 182 推送返回「同步成功，共同步1条数据」，`isExport=1`。
  影响范围：`/api/v2/export/transactions-v3` 及 `transaction-v3` 单条推送的出站体；V2 不受影响（V2 本无这些字段）；无 schema/路由变更。
  文件：src/services/partner-platform.js, scripts/characterization/characterize-partner-platform.mjs
  Python 同步提示：V3 推送出站体需同样适配（若 Python 端也对接 importDemand，注意 `screenshot` 是 integer 语义，URL 数组走 `screenshots` 逗号串）。

- 2026-08-21: **伙伴系统树子节点字段适配 `childSystems`**：test.atp 版 `lazySystemTree` 子节点在 `children`，同事本地后端（172.20.101.63:11002）返回 `childSystems`——`normalizeSystemNode` 的子节点来源增加 `childSystems`（`children ?? childList ?? childSystems ?? nodes`），两代格式兼容，否则系统树展开无子节点。已在同事本地后端完成三接口实测（projects 28 项 / systems 根+子展开 / importDemand 推送 1 条交易返回「同步成功」）。
  影响范围：`GET /api/v2/export/partner/systems` 子节点解析；无 schema/路由变更。
  文件：src/services/partner-platform.js
  Python 同步提示：伙伴系统树解析需同样兼容 `childSystems` 字段。

- 2026-08-21: **批量推送伙伴调用改透传登录态 access_token（移除硬编码联调 JWT）**：`partner-platform.js` 的 `resolveAccessToken` 原先让 `DEFAULT_PARTNER_ACCESS_TOKEN`（硬编码联调 JWT）永远优先，前端即使带了 SSO `access_token` 头也不被使用；该 JWT 过期后 `GET /api/v2/export/partner/projects|systems` 与 importDemand 推送全部失败。现优先级改为：请求方 token（header/body/query，Vue 登录态 SSO JWT——伙伴平台与账号中心同源，按登录用户身份调用）→ `PARTNER_ACCESS_TOKEN`（服务级回落，供无登录态脚本/联调）→ 都无则 400（不再有隐式兜底）。api-docs 描述无需变（文档本来即按此语义写）。
  影响范围：`/api/v2/export/partner/*`、`/api/v2/export/trajectories/:id/transaction(-v3)?`（push）、`/api/v2/export/transactions(-v3)?` 的出站鉴权；无 schema/路由变更。
  文件：src/services/partner-platform.js, scripts/characterization/characterize-partner-platform.mjs
  Python 同步提示：伙伴平台出站调用需同语义转发调用方 access_token，勿内置默认 token。

- 2026-08-20: **页面级 key 含 hash 内易变 query——VARCHAR(512) 溢出致截图丢失（湿测抓到）**：hash 路由 SUT 的 `page_level_key_from_url` 此前只弃 `#` 前 search、保留了 fragment 内 query（如 `#/route?part=..&v=时间戳`），长 URL 超过 `screenshot.level_key` VARCHAR(512) → 修改页（业务对象主页面）page_level 截图 INSERT 失败且被吞掉 → V3 覆盖校验 19/32 控件 pid=0。修复：① `scripts/state.py` `page_level_key_from_url` 剥 fragment 内 query（对齐原设计「弃 query」），key 从 ~1100 字符降到 ~110，且消除跨次访问 `v=` 漂移；② 导出侧兜底：`transaction-export-v3.js` 新增 `stripVolatileQuery()` + `idByPageLevelNorm` 规范化索引——存量两代 key（带/不带 query）互相对齐，控件 pid 解析在精确匹配未命中后按规范化 key 重试（弹窗 key 截到段边界、anchor 保留）。数据修复：traj 181 修改页截图按规范化 key 回填（MinIO 对象已在，`backfilledFrom` 标记来源）。复录验证（traj 182）：3 页面 key 全部无 query、0 插入失败、V3 dry-run 原生 missing=0。
  影响范围：Python 录制侧页面级 key 生成、V3 导出 pid 解析、存量 page_level 数据兼容。无 schema/路由/WS 变更。
  文件：scripts/state.py, src/services/transaction-export-v3.js, scripts/characterization/characterize-page-level-python.py, scripts/characterization/characterize-export-v3.mjs
  Python 同步提示：无 schema 变更。Python 录制侧 key 语义变化——页面级 key 不再含 fragment 内 query（同一路由不同 query 视为同一页面，uk_ss_level_key 去重到一条）；导出消费方无感知（`regionId` 仍为 pageKey，规范化匹配为 JS-gen 内部实现）。

### Changed

- 2026-08-20: **V3 覆盖校验存量兼容：legacy_phase_fallback 降级为告警不阻断**：覆盖校验强制范围收窄到 `stats.coverageMode='page_level'`（新录制，830 需求适用对象）——仅该模式缺截图时单条 push 409 `page_level_screenshot_missing`、批量该项 build failed；`legacy_phase_fallback`（存量旧数据，phase 截图兜底链路，无法不重录补页面级截图）缺失**不再阻断推送**，缺失数/键仍经 `stats.missingPageLevelScreenshots` / `missingPageLevelKeys` 下发供消费方识别存量风险。新增导出服务纯函数 `coverageBlocksPush(coverage, stats)` 承载该判定（单条/批量两处路由共用；无 stats 时默认不阻断，存量兜底）。修复存量交易（含无任何可解析截图的旧数据）在 de59e69 之后被整批拦 409 的破坏性变更。
  影响范围：V3 导出服务 + 单条/批量推送路由的覆盖校验门槛、API docs、characterization。无 schema/WS/payload 结构变更；V2 不受影响。
  文件：src/services/transaction-export-v3.js, src/routes/v2/export-mgmt.js, src/dashboard/api-docs/groups/export-mgmt.js, scripts/characterization/characterize-export-v3.mjs
  Python 同步提示：无 schema 变更。推送行为变化：存量模式（无页面级截图）交易恢复可推送，消费方需按 `stats.missingPageLevelScreenshots>0` 自行识别存量风险；新录制仍强校验。

- 2026-08-19: **页面级截图（page/popup）与 V3 覆盖校验**：为对齐 830「每个含有业务对象的最小页面层级（page/popup）都需要有对应截图」，新增 `screenshot.kind='page_level'`、`level_type` / `level_key` / `parent_level_key` 字段与唯一键 `uk_ss_level_key`。录制侧：Python 维护页面/弹窗级截图注册表，新增 `page_level_screenshot` 事件；页面跳转前保存旧页面截图，`phase_done` 时兜底保存当前页面；弹窗截图按 `pageKey|dialog:标题@@anchor:xpath` 注册并自动推断 anchor；控件 stamp `page_level_key` / `popup_level_key`。Node 三处事件监听（executor / global-browser / trajectory-recording-runner）落库。导出侧：V3 优先使用页面级截图，`regionId` 承载 pageKey/popupKey，控件通过 `page_level_key` / `popup_level_key`（或 `region_id` 的 page/dialog 前缀）对齐；弹窗控件 `rect` 从页面长图坐标换算为相对弹窗截图坐标；新增 `validatePageLevelCoverage`，缺失截图时单条 push 返回 409 `page_level_screenshot_missing`，批量 push 整批失败；无 element_json 的可导出步骤不参与覆盖校验，避免历史步骤硬阻断；`stats.coverageMode` 区分 `page_level` 与 `legacy_phase_fallback`，用于提示存量交易兼容风险。坐标体系统一：`PAGE_LOCATOR_HELPERS` 新增 `documentBBoxOf()`，`element_json` 新增 `page_bbox`，页面级截图与 `page_bbox` 同为 document 坐标。工具同步：`layer-tree` / `lightup` 支持页面级截图；API docs 补充契约；旧 `phase_highlight` 链路保留兼容。
  影响范围：migrations（`20260819000002_screenshot_page_level.js`）、schemas/init.sql、screenshot DAO/service、V3 导出/路由、录制事件链路、Python 录制侧、API docs、characterization、tools。V2 不受影响。
  文件：migrations/20260819000002_screenshot_page_level.js, schemas/init.sql, src/dao/screenshot-dao.js, src/services/screenshot-service.js, src/services/transaction-export-v3.js, src/routes/v2/export-mgmt.js, src/routes/browser-session/persist-live.js, src/routes/browser-session/executor-events.js, src/routes/browser-session/global-browser.js, src/services/trajectory/trajectory-recording-runner.js, scripts/state.py, scripts/controller/service.py, scripts/manual_recorder/recorder.py, scripts/session_runner.py, scripts/event_dispatch.py, scripts/models/action.py, scripts/models/entity/screenshot_entity.py, src/models/element.js, src/models/entities.js, src/cdp/page-locator-helpers.js, scripts/controller/actions/js_snippets/_locator_helpers_js.py, scripts/controller/actions/js_snippets/enrich.py, scripts/controller/actions/js_snippets/fill_core.py, src/dashboard/api-docs/groups/export-mgmt.js, src/dashboard/api-docs/api-docs.css, src/dashboard/api-docs/pending-screenshots.js, scripts/tools/layer-tree-from-properties.mjs, scripts/characterization/characterize-export-v3.mjs, scripts/characterization/characterize-layer-tree.mjs, scripts/characterization/characterize-page-level-screenshot.mjs, scripts/characterization/characterize-page-level-python.py, scripts/refactor/verify-all.sh
  Python 同步提示：schema 变更（`screenshot.kind` 增加 `page_level`，新增 `level_type`/`level_key`/`parent_level_key`）；Python 录制侧新增 `page_level_screenshot` 事件和 `page_bbox` 字段；若 Python 控制面自行持久化截图需对齐该结构与字段。V3 推送消费方无需新增字段：截图条目 `regionId` 现在为 pageKey/popupKey，缺截图会推送失败。

- 2026-08-19: **DOM 分区算法支持 `card / 卡片`**：`assignRegion()` / `composeContentRegion()` 新增 `.el-card` 识别，卡片内元素会生成 `card:标题` 分区，`layers` 增加 `{ role:'card', label }`，`region_card` 记录卡片标题。`display-group` 将 `card` 视为 taxonomy role；`layer-tree` 工具增加卡片样式；同步重新生成 `_locator_helpers_js.py`。影响范围：元素分区/分层结果、V3 导出 `regionId/regionLabel/layers`（若元素在卡片内）、工具展示。无 schema/WS 变更；V2 不受影响。
  文件：src/cdp/page-locator-helpers.js, src/cdp/display-group.js, scripts/controller/actions/js_snippets/_locator_helpers_js.py, scripts/tools/layer-tree-from-properties.mjs, scripts/characterization/characterize-partition-compose.mjs
  Python 同步提示：Python 侧通过 `_locator_helpers_js.py` 注入同一套 JS，若消费 `region_role/region_id/layers`，需兼容新增 `card` 角色与 `region_card` 字段。

- 2026-08-19: **V3.1 弹窗父子关联与截图叠加坐标**：`dialog` 截图条目的 `propertiesPID` 不再固定为 `"0"`，改为通过 `dialogScreenshots[].trajectoryStepId` → `traj.steps[].trajectoryPhaseId` → 页面截图 `propertiesID` 回填，从而在 flat 单数组中也能还原“页面 → 弹窗 → 控件”的层级。`dialog` 截图条目新增可选 `rect`（弹窗在页面长图上的位置，来自录制时 `dialogMeta.rect`），弹窗内控件 `rect` 仍相对弹窗截图。工具同步更新：`layer-tree-from-properties.mjs` 支持把 dialog 挂到 page 下；`lightup-phase-screenshot.mjs` 支持在页面长图上叠加弹窗截图，并按弹窗截图坐标点亮弹窗内控件。V3.0 `result.groups` 工具兼容保留。
  影响范围：V3 导出服务契约（`dialog.propertiesPID` 语义变化、`dialog.rect` 可选）、API docs、tools、characterization。无 schema/WS 变更；V2 不受影响。
  文件：src/services/transaction-export-v3.js, src/dashboard/api-docs/groups/export-mgmt.js, scripts/tools/layer-tree-from-properties.mjs, scripts/tools/lightup-phase-screenshot.mjs, scripts/characterization/characterize-export-v3.mjs
  Python 同步提示：若 Python 控制面消费 V3 推送，解析 `dialog` 截图条目时注意 `propertiesPID` 指向所属页面截图；若自行组装 V3，弹窗截图条目需带 `propertiesPID`（页面截图 id）和可选 `rect`（弹窗在页面长图上的位置）。弹窗内控件 `rect` 相对弹窗截图。

- 2026-08-19: **V3 批量推送结构重大变更——截图合并进 transcationProperties**：发给 partner 的 payload **只含 `transcationEventTypeList`**（顶层移除 `payload.screenshots`，截图已合并进每个 entry 的 `transcationProperties`，截图条目与控件步骤条目同构、统一 schema，消费方后端只需一张表存储）。截图条目：`eventTypeValue="click"`/`eventTypeName="点击"`/`elementType=""`/`mothed=""`/`type`沿用原 screenshots type（`page`/`dialog`）/`screenshot`=[MinIO 永久直链]数组/`rect={}`/`propertiesPID="0"`（无父）/`realLabel=""`。控件步骤条目：保持 V2 五核心字段语义，`type="ele"`/`elementType`=xpath/`mothed="By.XPATH"`/`screenshot=[]`空数组/`rect`=坐标或`{}`/`realLabel`承接原 label 值。`id`/`pid`/`label` 三字段改名：`id`→`propertiesID`（字符串顺序号，截图先占 `"1"`..`"N"`，控件续接 `"N+1"`..）、`pid`→`propertiesPID`（字符串，控件指向所属截图条目的 propertiesID；截图=`"0"`）、`label`→`realLabel`（承接原 label 语义）；移除 `scanIndex`、移除 `step-N`/`page-N` 前缀；控件→截图关联键由 `propertiesPID` 指向截图 `propertiesID`（字符串相等，取代旧 `pid==="page-N"`===`screenshot.key`）。`rect`/`realLabel`/`regionId`/`regionLabel`/`screenshot` 统一恒有（无值给 `{}`/`""`/`[]`，旧实现是条件 omit）。弹窗关联键修正：`idByDialog` 用弹窗标题（`name`/`dialogTitle`）而非 `dialogKey`，与控件侧 `overlay.label` 对齐。
  影响范围：V3 导出服务契约（`payload` 只含 `transcationEventTypeList`；`transcationProperties[]` 统一 schema，截图+控件同构；`id`/`pid`/`label` 改名 `propertiesID`/`propertiesPID`/`realLabel`）、V3 批量路由（`okBuilt` 去掉 `screenshots` 字段）、API docs、characterization。无 schema/WS 变更；V2 不受影响（V2 精简版本无 screenshots）。
  文件：src/services/transaction-export-v3.js, src/routes/v2/export-mgmt.js, src/dashboard/api-docs/groups/export-mgmt.js, scripts/characterization/characterize-export-v3.mjs, scripts/characterization/characterize-dialog-screenshot.mjs
  Python 同步提示：**契约重大变更**。发给 partner 的 payload 只有 `transcationEventTypeList`（无顶层 `screenshots`）。一条 `transcationProperties` 既可能是截图（`type=page`/`dialog`，`eventTypeValue=click`，`screenshot` 数组有值，`elementType`/`mothed` 空，`propertiesPID="0"`）也可能是控件步骤（`type=ele`，`eventTypeValue=click`/`input`/...，`elementType`=xpath，`mothed=By.XPATH`，`screenshot` 空数组）——用 `type` 字段区分条目种类，消费方单表存储。注意字段改名：`id`→`propertiesID`（字符串）、`pid`→`propertiesPID`（字符串）、`label`→`realLabel`；控件 `propertiesPID` 指向截图条目的 `propertiesID`（字符串相等）。若 Python 控制面自行组装 V3 payload，对齐新结构：`payload = { transcationEventTypeList: [...] }`，每个 entry 的 `transcationProperties` 含统一 schema 的截图+控件条目。前提不变：MinIO bucket `uara-step-phase-picture` 已设公开读策略，截图 `screenshot[0]` 为永久直链。

- 2026-08-19: **V3 批量推送 payload.screenshots 字段变更**（已被上一条"截图合并进 transcationProperties"取代，保留作历史记录）：每个截图条目改为只给一个永久有效的 `url`（MinIO 公网直链，bucket `uara-step-phase-picture` 已设公开读策略，匿名可访问），消费方直接用该 url 访问图片，无需 MinIO SDK / 预签名。去掉此前的 `bucket`+`file` 方案与 `expires` 字段。`url` 取值：优先用 `screenshot.image_url`（上传时由 `uploadScreenshot` 存的公网直链），缺失时用 `MINIO_PUBLIC_URL + MINIO_BUCKET + storage_path` 兜底拼接。`buildV3Screenshots` 守卫：拿不到 url 的截图（本地暂存未上传且无公网直链兜底）被跳过。同步移除配置 `PUSH_V3_SCREENSHOT_BUCKET` / `PUSH_V3_SCREENSHOT_EXPIRES`（bucket 统一来自 `MINIO_BUCKET`；截图 URL 现在是永久直链，不再有"有效期"概念）。
  影响范围：V3 导出服务契约（`payload.screenshots[]` 结构：`{ phaseNumber, type, key, name, url }`，批量再加 `trajectoryId`，无 `bucket`/`file`/`expires`）、screenshot DAO（`listPhaseHighlightsByTrajectory` / `listDialogScreenshotsByTrajectory` 新增返回 `storagePath`/`storageType`/`imageUrl`）、config（移除两个 `PUSH_V3_SCREENSHOT_*`）、API docs、characterization。无 schema/WS 变更；V2 不受影响。
  文件：src/services/transaction-export-v3.js, src/dao/screenshot-dao.js, config/config.js, config/.env.example, src/dashboard/api-docs/groups/export-mgmt.js, scripts/characterization/characterize-export-v3.mjs, scripts/characterization/characterize-dialog-screenshot.mjs
  Python 同步提示：**契约变更**。消费方（含 Python 控制面若消费 V3 推送）直接用 `payload.screenshots[].url` 访问图片（MinIO 公网永久直链），不再需要 bucket+file 调 MinIO SDK、也不再依赖 JS-gen 的 `/api/v2/screenshots/:id/image`；`bucket`/`file`/`expires` 字段不再下发。若 Python 控制面自行组装 V3 payload，对齐新结构：`{ phaseNumber, type, key, name, url }`（批量再加 `trajectoryId`）。前提：MinIO bucket 已设公开读（anonymous read）策略，否则直链不可匿名访问——需在 MinIO 控制台为 `uara-step-phase-picture` 配 `download` 匿名策略。

### Added

- 2026-08-19: **待上传截图一键补传**：新增 `POST /api/v2/screenshots/pending/upload`（立即把全部 `storage_type='local'` 待传项推送到 MinIO，忽略重试间隔与已达 `SCREENSHOT_MAX_RETRY` 上限，返回 `{scanned,uploaded,failed,skipped}`）与 `POST /api/v2/screenshots/:id/upload`（单行补传）。`screenshot-service.js` 新增 `uploadPendingScreenshots()` / `uploadPendingScreenshot(id)`（复用 `retryPendingScreenshots` 的上传+DB 标记+删本地文件链路；单行补传失败回滚已上传的 MinIO 对象）。API docs 新增「待上传截图」实时面板（`monitor` 组）：列表展示 `GET /api/v2/screenshots/pending` 的待传项（ID/类型/归属/MIME/大小/重试次数/上次重试/创建时间），支持「一键上传全部」「单行上传」「预览」「删除」「每 5s 自动刷新」。
  影响范围：新增路由（`/api/v2/screenshots/pending/upload`、`/api/v2/screenshots/:id/upload`）、截图服务、API docs 前端（catalog 新增 `GROUP_PENDING_SCREENSHOTS` + `pending-screenshots.js` 挂载模块 + app.js 分发 + css）。
  文件：src/routes/v2/screenshot.js, src/services/screenshot-service.js, src/dashboard/api-docs/catalog.js, src/dashboard/api-docs/app.js, src/dashboard/api-docs/pending-screenshots.js, src/dashboard/api-docs/api-docs.css
  Python 同步提示：无 schema 变更。新增两个补传端点为 Node 控制面运营操作（把本地暂存截图推到 MinIO），Python 侧无感知；若 Python 也实现待传列表，对齐 `GET /api/v2/screenshots/pending`（已存在）与这两个 POST 端点的响应语义。

- 2026-08-19: **MinIO bucket 配置**：`config/.env` 启用 MinIO（`MINIO_HOST=http://172.19.87.169:9001`、`MINIO_ACCESS_KEY=admin`、`MINIO_SECRET_KEY=tansun@123`、`MINIO_BUCKET=uara-step-phase-picture`、`MINIO_PUBLIC_URL=http://172.19.87.169:9001`）。bucket 由 `ensureBucket()` 首次上传时自动创建（无需手工建桶）。`isMinioConfigured()` 由 false 变 true，截图走 MinIO 而非本地暂存；存量 `storage_type='local'` 行由后台重试循环或新增一键补传端点处理。
  影响范围：仅 `config/.env`（运行环境配置，不入 schema/路由/WS 契约）。
  文件：config/.env
  Python 同步提示：无。`.env` 为本地运行配置不随仓库同步；Python 侧如需独立 MinIO，参照 `config/.env.example` 的 `MINIO_*` 模板配置。

- 2026-08-19: **补齐 MinIO 依赖**：将 `minio`（`^8.0.7`）加入 `package.json` 并安装，修复 `npm start` 启动时报 `ERR_MODULE_NOT_FOUND: Cannot find package 'minio'`（`src/services/minio-service.js` 顶层 `import { Client } from 'minio'` 无法解析）。不影响 schema/路由/WS；`package-lock.json` 同步更新。
  影响范围：依赖声明（`package.json` / `package-lock.json`）。
  文件：package.json, package-lock.json
  Python 同步提示：无。仅 Node 控制面依赖补齐，Python 侧无感知。

- 2026-08-19: **批量任务名候选接口 + 存量文件名乱码修复**：新增 `GET /api/v2/trajectories/batch/names`（functionId + keyword 模糊去重、最近创建优先、按 paasUserId 隔离空=全可见、limit 默认 20 最大 100；注册在 `batch/:batchId` 之前）——交易列表页「按任务名筛选」搜索下拉的选项源。另新增迁移 `20260819000000_fix_batch_job_name_mojibake.js`：修复 `batch_recording_job` 存量 5 行 `name`/`original_filename` 的 mojibake（UTF-8 字节被 latin1 解码，如「批量录制导入模板.xlsx」存成 `æ¹éå¶å¯¼å¥æ¨¡æ¿.xlsx`；运行时链路已由 `decodeUploadFilename` 修复，本迁移只修存量，幂等）。
  影响范围：新增路由（/api/v2/trajectories/batch/names）、存量数据修复（batch_recording_job.name/original_filename）。
  文件：src/routes/v2/trajectory-batch.js, src/services/trajectory/trajectory-batch-service.js, src/dao/batch-recording-dao.js, migrations/20260819000000_fix_batch_job_name_mojibake.js, src/dashboard/api-docs/groups/trajectory.js, scripts/characterization/characterize-batch-task-name.mjs
  Python 同步提示：无 schema 变更（数据修复不动结构）。若代理侧提供任务名下拉，对齐 `GET /api/v2/trajectories/batch/names?functionId=&keyword=&limit=`（返回 `{names: string[]}`）；任务名/文件名展示前若见乱码，可复用 `Buffer.from(s,'latin1').toString('utf8')` 修复（仅当不含 CJK 时）。

- 2026-08-18: **截图上传失败本地暂存与自动补传**：MinIO 上传失败时，截图先写入本地 `tmp/pending-screenshots/`，DB 标记 `storage_type='local'`；后台每 3 分钟扫描一次，最多重试 3 次，补传成功后删除本地文件并更新为 `storage_type='minio'`。新增 `GET /api/v2/screenshots/pending` 待补传截图列表；`GET /api/v2/screenshots/:id/image` 支持从本地暂存文件读取；删除截图/步骤/阶段/轨迹时同步清理本地文件。
  影响范围：schema（新增 `retry_count` / `last_retry_at`，截图存储改为 `storage_type` / `storage_path` / `image_url`）、config（新增 `MINIO_*` / `SCREENSHOT_PENDING_*`）、截图服务/路由/API docs、server 启动重试任务。
  文件：migrations/20260819000000_screenshot_minio_storage.js, migrations/20260819000001_screenshot_pending_upload.js, schemas/init.sql, config/config.js, config/.env.example, src/services/minio-service.js, src/services/screenshot-pending-store.js, src/services/screenshot-pending-retry.js, src/services/screenshot-service.js, src/dao/screenshot-dao.js, src/routes/v2/screenshot.js, src/dashboard/api-docs/groups/remote.js, server.mjs, scripts/models/entity/screenshot_entity.py
  Python 同步提示：截图仍通过 WS `step_screenshot` 上报 base64；本地暂存与补传完全在 Node 控制面处理，Python 侧无感知。若 Python 直接读写 screenshot 表，需对齐新 schema。


- 2026-08-18: **弹窗独立截图采集**：录制时检测到 `overlay:` 弹窗操作，实时采集弹窗可视区域截图；复用现有 `screenshot` 表（`kind='phase_highlight'` + `trajectory_step_id` + `metadata_json.dialog=true`），不新增数据库字段。V3 推送 `payload.screenshots` 支持 `type:'dialog'`，弹窗控件 `pid` 与 dialog key 对应，有 dialog 截图时 `rect` 相对弹窗截图。
  影响范围：Python 录制截图链路、Node screenshot DAO/service、V3 导出、API 文档、characterization。
  文件：scripts/state.py, scripts/controller/service.py, scripts/manual_recorder/recorder.py, src/dao/screenshot-dao.js, src/services/screenshot-service.js, src/routes/browser-session/persist-live.js, src/services/trajectory/trajectory-recording-runner.js, src/services/transaction-export-v3.js, src/routes/v2/export-mgmt.js, src/dashboard/api-docs/groups/export-mgmt.js, scripts/characterization/characterize-dialog-screenshot.mjs, scripts/refactor/verify-all.sh
  Python 同步提示：Python 侧 `step_screenshot` 事件新增可选 `dialog` / `dialogMeta` 字段；仅弹窗操作时上报。

- 2026-08-18: **批量推送 V3 结构优化（去重）**：移除 `result.groups` 双轨结构，改为 `payload.screenshots` + `transcationProperties` 单轨。`transcationProperties` 在 V2 五个核心字段基础上增加 `id` / `pid` / `label` / `regionId` / `regionLabel` / `rect` / `scanIndex`；属性中不再重复输出 `url`，通过 `pid` 关联 `payload.screenshots`。新增配置 `PUSH_V3_SCREENSHOT_BUCKET` / `PUSH_V3_SCREENSHOT_EXPIRES`。删除 `recorded` / `manualRecord` / `targetType` / `group` / `anchorTarget` 等冗余字段。
  影响范围：V3 导出服务/路由/API 文档/characterization；无 V2 影响。
  文件：src/services/transaction-export-v3.js, src/dashboard/api-docs/groups/export-mgmt.js, scripts/characterization/characterize-export-v3.mjs, config/config.js, config/.env.example
  Python 同步提示：若 Python 控制面消费 V3 推送，需改为解析 `payload.screenshots` + `transcationProperties` 单轨结构；`result.groups` 不再输出。

- 2026-08-18: **V2 批量推送精简（消费方格式对齐）**：`transcationProperties` 条目不再含 `regionId`/`parentRegionId`；entry 不再含 `phases`（阶段截图引用 + 全量元素 metadata）——控件点亮能力由 V3.0 `result.groups` 承担。V2 端点/响应结构其余不变（外层 `payload.transcationEventTypeList`/count/skipped/stats）。
  影响范围：src/services/transaction-export.js（`mapStepToTransactionEvent` 去 region 字段、`buildTransactionEntry` 去 phases、删除 `buildTransactionPhases`、`TRANSACTION_ENVELOPE_FIELDS` 精简）、src/routes/v2/export-mgmt.js（V2 组装不再查 phase/screenshot）、api-docs、characterize-transaction-export-region 重写为精简断言。无 schema/WS 变更。
  文件：src/services/transaction-export.js, src/routes/v2/export-mgmt.js, src/dashboard/api-docs/groups/export-mgmt.js, scripts/characterization/characterize-transaction-export-region.mjs
  Python 同步提示：V2 推送契约精简（无 phases/regionId/parentRegionId）；若 Python 控制面消费 V2 envelope，去掉对 phases/regionId 的依赖；分层/坐标信息走 V3.0 result.groups。

- 2026-08-18: **批量推送 V3.0（阶段长图控件点亮，对齐消费方 groups 约定）**：新增 `src/services/transaction-export-v3.js` + 3 个端点（`GET/POST /api/v2/export/trajectories/:id/transaction-v3`、`POST /api/v2/export/transactions-v3`，V2.0 保留）。entry 新增 `result`：`{id, name, url, groups[]}`——页面组（**一张长图=一个页面组**，`page-<n>` 平级，`screenshots[]={phaseNumber,url}` 无尺寸字段，前端按图片自然尺寸计算）+ 弹窗组（region_id 含 `overlay:` 段归属，弹窗=独立页面，`key` 带 `@@anchor=<触发按钮xpath>`，anchor 按步骤序推断前置按钮步骤）+ 控件节点（`id=step-<n>` 全局唯一、`rect`=element_json.bbox 内容坐标与长图同根、target/kind/params 映射、pid 树）。`transcationProperties` 保留（控件组语义）。无坐标步骤省略 rect（stats.noRectControls）。
  影响范围：路由（src/routes/v2/export-mgmt.js 新增 3 端点）、服务（新增 src/services/transaction-export-v3.js，复用 V2.0 mapStepToTransactionEvent/uniquifyPropertiesNames）、api-docs（export-mgmt 分组登记 V3 端点）。无 schema/WS 变更。
  文件：src/services/transaction-export-v3.js, src/routes/v2/export-mgmt.js, src/dashboard/api-docs/groups/export-mgmt.js, scripts/characterization/characterize-export-v3.mjs, scripts/refactor/verify-all.sh
  Python 同步提示：V3.0 `result.groups` 结构（页面组/弹窗组/控件 rect 内容坐标）为消费方点亮契约；若 Python 控制面自行组装推送数据，按此结构对齐。控件 rect 语义 = 步骤 element_json.bbox（内容坐标系，与阶段长图同 `pickScrollRoot` 滚动根）；弹窗控件第一版 rect 相对阶段长图（弹窗独立截图 TODO）。

- 2026-08-17: **点击导航识别（AI_CLICK_NAV_CUE，默认开）**：`click_element_by_index` 点击后若 URL 跳转，recorder 注入一条 `[导航]` HumanMessage，提示“已进入目标页、停止找同一按钮、直接填表/保存”；recorder goal 闸门停机前先提示核查 URL 是否已跳转。录制步骤结果仍为 `ok-clicked-N`，不污染轨迹。
  影响范围：仅 Python 子进程录制内的点击导航提示与 goal 停机兜底；无路由/schema/WS 变更。
  文件：config/.env.example, scripts/feature_flags.py, scripts/controller/actions/click_navigation_cue.py, scripts/controller/actions/_misc.py, scripts/agent/recorder_emitters.py, scripts/recorder.py, scripts/controller/actions/phase/intent_contract.py, scripts/characterization/characterize-click-navigation-cue.py
  Python 同步提示：无（点击导航 cue 为 Python 子进程内部行为，控制面/前端无需感知）。

- 2026-08-17: **SSO 接入 + /api/v2 用户隔离（paasUserId）**：新增 `src/middleware/sso-auth.js` 鉴权中间件（仅 `/api/v2/*`，白名单 `/api/v2/auth/*`；`SSO_AUTH_REQUIRED=false` 默认关，关时无 token 也放行、`req.paasUserId=null` 全可见，向后兼容；开时无 token 或 token 无法解码 → 401，走 v2 envelope 包成 `{code:401}`）。新增 `src/services/sso/jwt-decode.js` 纯解账号中心 HS256 JWT payload 拿 `paasUserId`（19 位 long 用正则从原文提取数字串，**不验签、不调账号中心校验**，与已上线产品取法一致）。新增 `src/routes/v2/auth.js`：`GET /api/v2/auth/sso/login-page`、`GET /api/v2/auth/sso/logout-page`、`GET /api/v2/auth/me`、`GET /api/v2/auth/sso/check`（appKey 固定 `1920710182837141505`，回跳地址取 query `uiPath`/`redirect` 或请求 host）。`trajectory` / `batch_recording_job` 加 `paas_user_id VARCHAR(32) NULL`（空=无主=全可见，存量兼容；PR-SSO-ADMIN 出结论后再收紧）。trajectory `save/list/listByFunction/countByRecordStatus` + batch `createJob`/`importBatchFromExcel`/`getBatchJobView` 注入 `paasUserId`（写入盖章 + 列表过滤 + view 归属校验：幂等 key 跨用户复用返回 409、view 跨用户访问返回 404）；`POST/GET /api/v2/trajectories` 与 `POST /api/v2/trajectories/batch/import`、`GET /api/v2/trajectories/batch/:batchId` 从 `req.paasUserId` 透传。前端（另仓 vue-project）：`api/sso/sso.ts` 占位路径改打真实 `/v2/auth/*` + 新增 `getMe`；`stores/sso.ts` 取消硬编码 loginUrl/logoutUrl 改调后端；新增 `stores/user.ts`（paasUserId）；`permission.ts` 拿到 token 后拉 `/me`；`request.ts` 加 401 清 token 回首页；`AppHeader.vue` 用户名改显 `paasUserId`；`stores/batchImport.ts` 任务 key 按 paasUserId 命名空间。
  影响范围：schema（迁移 `20260818000000_paas_user_id`，旧库执行 migrate 后生效；新库 init.sql 同步）、config（新增 `SSO_APP_KEY`/`SSO_BASE_URL`/`SSO_AUTH_REQUIRED`）、src/middleware、src/routes/v2（__init__ 挂载顺序：v2ResponseEnvelope → ssoAuth → registerAuth → 业务路由）、src/dao、src/services/trajectory、src/dashboard/api-docs（新增 auth 分组）。`/api/v2/*` 之外端点（/api/browser/*、/api/test/*、/api/agent、/v1/*、/ws*、/api/setup*、/api/health）本周不鉴权。
  文件：migrations/20260818000000_paas_user_id.js, schemas/init.sql, config/config.js, config/.env.example, src/middleware/sso-auth.js, src/routes/v2/__init__.js, src/routes/v2/auth.js, src/services/sso/jwt-decode.js, src/dao/trajectory-dao.js, src/dao/batch-recording-dao.js, src/services/trajectory/trajectory-meta-service.js, src/services/trajectory/trajectory-batch-service.js, src/routes/v2/trajectory.js, src/routes/v2/trajectory-batch.js, src/dashboard/api-docs/groups/auth.js, src/dashboard/api-docs/catalog.js
  Python 同步提示：schema 对齐 `trajectory`/`batch_recording_job` 的 `paas_user_id VARCHAR(32) NULL`（空=全可见）。若代理侧也做用户隔离：`paasUserId` 从请求头 `access_token` 解 JWT payload 取（HS256，本周不验签，userId 用字符串防 19 位 long 精度丢失）；列表过滤语义对齐「空 paas_user_id=全可见」；鉴权范围仅 `/api/v2/*`，`/api/v2/auth/*` 白名单放行。前端字段无 schema 变更（token 仍走 `access_token` 请求头）。

- 2026-08-16: **步骤编辑/移动闸对齐 AI 活跃**：纯观看占位（recordStatus=recording 且非 AI 录制）放开步骤编辑/移动；后端步骤更新、删除、移动在 AI 录制活跃（phase.status='running'）时 409；清空步骤由前端在 AI 录制中禁用（后端 clear 无闸）。确认/推送/record-start 闸不变。
  影响范围：步骤更新/删除/移动的闸门语义（纯观看占位从 409 变为放行；新增 AI 活跃 409 覆盖更新/删除路径）；步骤 CRUD 路由错误码改为透传 statusCode（原硬编码 500）。
  文件：src/services/trajectory/trajectory-step-service.js, src/routes/v2/trajectory-steps.js, src/routes/v2/trajectory-record.js, src/dashboard/api-docs/groups/recording.js, scripts/characterization/characterize-step-move.mjs, scripts/characterization/characterize-record-status-v2.mjs
  Python 同步提示：无 HTTP/schema。代理侧若实现步骤编辑闸，按「AI 录制活跃才 409」对齐（纯推流占用放行）。步骤 CRUD 错误码不再一律 500；步骤创建/插入路径仍无 AI 活跃闸（录制活持久化依赖，勿误判为漏洞）

- 2026-08-16: **AI 录制重复失败动作纠偏开关（Python 侧，默认关闭）**：新增 `AI_DUP_FAILURE_CUE=false`；开启后，连续 2 步「动作+参数完全相同且结果均 err-」时，recorder 向 Agent 注入一条 `[纠偏]` HumanMessage 处方（按错误码给建议，每阶段每签名只注入一次）。默认关闭，现有录制行为不变。
  影响范围：仅 Python 子进程录制运行时的可选行为开关；无路由/schema/WS 变更。
  文件：config/.env.example, scripts/feature_flags.py, scripts/controller/actions/duplicate_failure_cue.py, scripts/agent/recorder_emitters.py, scripts/recorder.py, scripts/controller/actions/phase/intent_contract.py, scripts/characterization/characterize-duplicate-failure-cue.py, scripts/refactor/verify-all.sh
  Python 同步提示：无（开关与 cue 均为 Python 子进程内部行为；如需 UI 暴露灰度开关再对齐 Node config）。

### Changed

- 2026-08-18: **SSO 验签 + /me 回查用户信息**：`ssoAuth` 中间件改为异步验签——密钥来自账号中心 `query_jwt_secret`（实测返回 `paas-application`，Base64 解码作 HMAC-SHA256 key，与账号中心 Java SDK `JWTUtil.verifyJWT` 一致），内存缓存 1h；配置 `SSO_JWT_SECRET` 可直接指定密钥不调接口。验签失败 → token 无效（`SSO_AUTH_REQUIRED=true` 时 401，伪造 token 不再被信任）；密钥不可用（账号中心不可达）→ 降级纯解 payload 保持可用性。`GET /api/v2/auth/me` 增强：带有效 token 时回查账号中心 `query_access_user`（对应 SDK `AccessUserContext.getCurrentUser()`），返回 `userName`/`userAccount`（如 管理员/admin），查询失败返回 null 不阻塞。
  影响范围：/api/v2/* 鉴权行为（验签）、`/api/v2/auth/me` 响应体（新增 userName/userAccount 字段）、config（新增 `SSO_JWT_SECRET`）。
  文件：src/services/sso/jwt-decode.js, src/services/sso/paas-client.js(新), src/middleware/sso-auth.js, src/routes/v2/auth.js, config/config.js, config/.env.example, scripts/characterization/characterize-sso-auth.mjs
  Python 同步提示：无 HTTP/schema 变更（`/me` 新增字段可选透传）。若代理侧做验签：密钥取 `query_jwt_secret`（`GET /api/ucenter/open/app/query_jwt_secret?appKey=...` 返回字符串，Base64 解码作 HS256 key）；用户信息回查 `GET /api/ucenter/open/access/query_access_user?accessToken=<JWT>&appKey=...`（返回 `{userId,userName,userAccount,...}`，envelope `code=00000000`）。

- 2026-08-18: **交易轨迹列表状态统计随查询条件过滤**：`GET /api/v2/trajectories` 返回的 `stats` 五档统计（draft/recording/failed/recorded/completed）与行查询同基准——新增按当前 `recordStatus` 过滤（原来忽略该条件恒展示功能全量统计，现与 keyword/batchTaskName/functionId 一并作为统计基准）。例如查询条件设为「未录制」时，`stats` 中仅 draft 有值、其余为 0、total=筛选行数。行数据沿用 `bj.name as batchTaskName`（所属任务）。
   影响范围：src/dao/trajectory-dao.js（`countByRecordStatus` 接受并应用 `recordStatus`；`list`/`listByFunction` 向统计透传 `recordStatus`）；无路由路径/响应字段增减（`stats` 结构不变）、无 schema/WS 变更。
   文件：src/dao/trajectory-dao.js, scripts/characterization/characterize-batch-task-name.mjs, scripts/characterization/characterize-sso-auth.mjs（stats 调用签名断言同步新增 `recordStatus` 参数）
   Python 同步提示：`GET /api/v2/trajectories` 的 `stats` 语义变化——统计随 `recordStatus` 查询条件过滤（其余筛选为 0，total=当前筛选行数）；若 Python 控制面复刻列表统计，需对齐「统计与行查询同基准（含 recordStatus）」。

- 2026-08-17: **element_json bbox 落库补全（Node 侧）**：Python 侧 ElementInfo/from_record 已透传 region/layers/bbox，但 Node 侧 `copyLocatorMeta` 漏 bbox，直播录制持久化时步骤坐标被丢弃；补全 bbox 复制。新录制 element_json 完整含 region_id/region_label/layers[]/bbox。
  影响范围：src/models/element.js（录制落库归一化）；无路由/schema/WS 变更。
  文件：src/models/element.js, scripts/characterization/characterize-step-region-bbox.py
  Python 同步提示：element_json bbox 字段语义已确认落库；Python 控制面若自行持久化 element_json 需同样保留 bbox。

- 2026-08-17: **阶段长图 DPR 拼接**：`runPhaseScreenshotCapture` 滚动步进改用 CSS 片高（`box.height - 48`），stitch overlap 按 `h0 / box.height` 把 CSS 位移换成设备像素。修复 Windows DPR=1.5 时把 PNG 高当 scrollTop 导致每片漏 ~0.5 屏、长图错位/重复条带。
  影响范围：阶段长图捕获几何（Node 控制面与 executor BiB CDP 共用 `src/cdp/phase-screenshot-capture.js`）；无路由/schema/WS 变更。
  文件：src/cdp/phase-screenshot-capture.js, scripts/characterization/characterize-phase-highlight-screenshot.mjs
  Python 同步提示：无 HTTP/schema。阶段长图在 Node/executor 侧 CDP 捕获；代理侧不重实现 capture 则无需改动。

- 2026-08-17: **单阶段录制步数上限配置化**：`trajectory-recording-runner` 每阶段 `max_steps` 由硬编码 30 改为 `PHASE_MAX_STEPS`（默认 300，环境变量可调）。长表单（如 120 字段）不再因 ceiling 截断；短阶段仍由 phase reviewer 估算下压（`resolve_phase_max_steps` 不超 ceiling）。
  影响范围：config（新增 `PHASE_MAX_STEPS`）、src/services/trajectory（录制主循环步数上限）。
  文件：config/config.js, config/.env.example, src/services/trajectory/trajectory-recording-runner.js
  Python 同步提示：无 HTTP/schema。代理侧若发 `session.step` 录制，`max_steps` 语义不变（仍为阶段步数上限；reviewer 估算会在此 ceiling 内下压）。

- 2026-08-17: **步骤 element 分层 + 坐标入库**：录制时 `_capture_element`/`_enrich_click_element` 对操作控件 evaluate `assignRegion`（分层）+ `stepBBoxOf`（内容坐标，复用泛化 `pickScrollRoot`），`element_json` 新增 `region_id`/`region_label`/`layers[]`/`bbox{x1,y1,x2,y2}`（内容坐标系，对齐阶段截图 `metadata.rect`）。元素分层可直接读 step；步骤级高亮（PR-LOC-HL）用 bbox 画框。只影响新录制，存量不回填。`PAGE_LOCATOR_HELPERS` 新增 `pickScrollRoot`/`stepBBoxOf`，阶段截图 collect 表达式去重共用。
  影响范围：录制链路（scripts/controller/actions）、`_locator_helpers_js.py`（重生成）、element_json 新增字段（无 schema）。
  文件：src/cdp/page-locator-helpers.js, src/cdp/phase-screenshot-page.js, scripts/controller/actions/js_snippets/{fill_core,enrich}.py, scripts/controller/actions/_helpers.py, scripts/controller/actions/js_snippets/_locator_helpers_js.py, scripts/characterization/characterize-step-region-bbox.py
  Python 同步提示：element_json 新增 region_id/region_label/layers/bbox（内容坐标，滚动根=标准主区或全页最高可滚动容器）；若代理侧有类似录制链路，需在操作控件时取分层与坐标。

- 2026-08-17: **分区算法：页面级裸按钮不再继承 titlebox（PR-PART 修正）**：`composeTitleboxTitle` 新增 `isBareActionButton` 前置判定——`BUTTON`/`.el-button` 且不在 `.el-collapse-item`/`.titlebox`/`.el-table` 内（页面级操作按钮，如向导/页签底部 fixed 操作条）时跳过 titlebox 几何就近继承，保留 chrome（tab/向导）与 collapse section 段。修复对公客户评级页「下一步/返回 被归入 基本信息/征信信息」问题：现为 `wizard:基本信息`（layers 仅 `[{wizard,基本信息}]`）。表单字段行为不变（字段不在 titlebox 内仍几何就近）；collapse/table 内按钮不受影响。
  影响范围：`PAGE_LOCATOR_HELPERS` 的 `assignRegion` 对页面级裸按钮的 `region_label`/`region_id`/`layers` 输出（SPA `display_group` 随之变化）；Python 镜像 `_locator_helpers_js.py` 已重新生成。
  文件：src/cdp/page-locator-helpers.js, scripts/controller/actions/js_snippets/_locator_helpers_js.py（生成物）, scripts/characterization/characterize-partition-compose.mjs（新增固定底栏按钮用例、`#float-back` 断言改为不继承）, scripts/characterization/characterize-scan-assign-region-once.py（过期断言修正：`xpath_smart_fill_only_enabled` 闸门已从 `_form.py` 移至 `form_action_engines.py`，既有漂移与本次改动无关）
  Python 同步提示：`scripts/controller/actions/js_snippets/_locator_helpers_js.py` 由 `node scripts/_gen_locator_helpers_py.mjs` 从 `src/cdp/page-locator-helpers.js` 生成，勿手改；Python 侧无需其他同步（scan_form.py 运行时注入调用）。

- 2026-08-17: **存量数据回填 paas_user_id**：`trajectory`（95 行）与 `batch_recording_job`（18 行）中 `paas_user_id IS NULL` 的存量行全部回填为 `1510076810578644992`（账号中心 admin）。迁移 `20260818120000_backfill_trajectory_paas_user_id.js`（幂等：只回填 NULL 行；down 为 no-op，数据回填不可逆）。回填后存量交易/批量导入任务归属 admin，隔离语义从「空=全可见」变为「归 admin」。
  影响范围：存量数据归属（无 schema 变更）。
  文件：migrations/20260818120000_backfill_trajectory_paas_user_id.js
  Python 同步提示：纯数据回填，无 schema/HTTP 变更。Python 控制面无需改动；若代理侧展示归属，存量数据归属为账号中心用户 1510076810578644992。

- 2026-08-17: **system_account.username 更名 account + 系统节点批量账号维护**：`system_account.username` 物理列更名为 `account`（新增迁移，旧库执行 migrate 后生效，新库 init.sql 直接建为 account；API/实体字段同步由 username 改为 account）。`POST /api/v2/system-mgmt/nodes` 在 type=1 时支持 `accounts[]` 一次创建多个系统账号；`PUT /api/v2/system-mgmt/nodes/{id}` 支持 `accounts[]` 全量替换该系统账号（按 id 更新、无 id 按 name 匹配、未出现的老账号删除；不传 accounts 不动账号；账号被 batch_recording_job 引用时删除返回 409）。账号字段 account/password 接受数字并落库为字符串。
  影响范围：system_account 表结构（需跑迁移）、系统账号 API 请求/响应字段 username → account、系统节点 POST/PUT 请求体新增可选 accounts[]（非 type=1 传 accounts 返回 400）。
  文件：migrations/20260817000000_system_account_rename_username_to_account.js, schemas/init.sql, src/services/system-account-service.js, src/services/hierarchy-service.js, src/services/trajectory/trajectory-account-service.js, src/services/trajectory/trajectory-record-lifecycle.js, src/dao/system-dao.js, src/dao/system-account-dao.js, src/models/entities.js, src/routes/v2/system-mgmt.js, src/dashboard/api-docs/groups/overview.js, src/dashboard/api-docs/groups/hierarchy.js, src/dashboard/api-docs/groups/recording.js, scripts/models/entity/system_account_entity.py, scripts/characterization/characterize-system-node-accounts.mjs, scripts/characterization/characterize-trajectory.mjs
  Python 同步提示：system_account 表结构基线对齐 init.sql；实体 `SystemAccountEntity.username` 已同步改为 `account`。HTTP 侧前端字段从 username 切到 account；未迁移旧库前请勿发布 Node 侧代码。

- 2026-08-15: **Heal-Locate Phase 1 MVP**：新增 Node 侧纯函数规则引擎 `missing-reason-analyzer.js` 与 `heal-contract.js`（失败原因分类 → HealContract：mode/scope/strategy/reason/target/runtime，prompt 与 runtime 分离）；Type A/B heal instruction 旧文本末尾追加【失败分析】结构化段落；`runHealStep` forward 载荷新增 `heal_contract`，`instruction/max_steps/phase_number/heal_type/healType` 旧字段原样保留；`session.step` 在控制面与执行机两处白名单同步透传 `heal_contract`；Python 侧解析 contract 并让 heal 模式只装配 `agent-core.md + agent-tools-common.md + agent-tools-heal.md`。
  影响范围：live replay heal 指令内容（旧文本不变，仅追加分析段）、`session.step` 载荷新增可选字段（WS 事件名与旧字段不变）、Python Agent heal 模式 system prompt 收窄。
  文件：src/services/trajectory/missing-reason-analyzer.js, src/services/trajectory/heal-contract.js, src/services/trajectory/replay-batch-runner.js, src/services/trajectory/form-structure-heal.js, src/services/trajectory/replay-heal-shared.js, src/routes/browser-session/heal-instruction.js, src/executor-session-client.js, executor/session-handler.js, scripts/controller/actions/phase/prompts.py, scripts/agent/service.py, scripts/agent_utils.py, scripts/prompts/agent-tools-heal.md, scripts/characterization/characterize-heal-locate.mjs, scripts/characterization/characterize-heal-mode.py, scripts/refactor/verify-all.sh, docs/superpowers/specs/2026-08-15-heal-locate-current-analysis.md
  Python 同步提示：executor/agent 需解析 `instruction.heal_contract`（`mode=='heal'`，`scope` 为 `step | form_structure`，`reason.target` 供定位、`runtime` 供运行时）；heal 模式 system packs 应收敛为 `agent-core + agent-tools-common + agent-tools-heal`，勿再走 full fallback；`heal_type/healType` 与文本关键词兜底必须保留。

- 2026-08-15: **Heal-Locate P2 决策路由（默认关闭）**：新增 `HEAL_LOCATE_DECISION_ENABLED=1` 开关；开启后 Type A 按 `suggestedAction` 走 skip（标记 confirmed=0 后继续）/ fail（不进 AI heal，直接结束批次）/ retry（按 `runtime.retry_count` 有限重放当前步，仍失败再落 AI heal）。默认关闭时控制流与 Phase 1 完全一致。
  影响范围：仅 `src/services/trajectory/replay-batch-runner.js` Type A 失败路径；无 schema、无路由、无 WS 消息名变更。
  文件：src/services/trajectory/heal-decision.js, src/services/trajectory/replay-batch-runner.js, scripts/characterization/characterize-heal-decision.mjs, scripts/refactor/verify-all.sh
  Python 同步提示：无（决策在 Node 控制面；Python 侧仍只消费 `heal_contract` 与 instruction）。

- 2026-08-15: **trajectory-* 服务归位**：9 个平铺服务（account/batch-excel/idle-reaper/phase/query/recording/runtime/step-move/step）迁入 `src/services/trajectory/`；`src/services/trajectory-service.js` 保持纯 re-export facade，所有消费方 import 路径同步更新。
  影响范围：src/services 组织变化（无路由、无 schema、无响应格式变更）。
  文件：src/services/trajectory-service.js, src/services/trajectory/*, src/services/special-element-service.js, src/services/session-lifecycle.js, src/services/remote-session-service.js, src/routes/v2/trajectory-batch.js, src/cdp/remote-bridge/ws-router.js, server.mjs, scripts/characterization/*.mjs
  Python 同步提示：纯路径移动，不改接口语义，Python 控制面无需改动。

- 2026-08-15: **sys-msg 服务归位 + 常量下沉**：`sys-msg-service.js`/`sys-msg-compose.js` 迁入 `src/services/sys-msg/` 并新增 barrel；6 个 sys_msg 常量下沉到 `src/models/constants.js`（`sys-msg.js` 保留 re-export shim，compose 保留常量转发 export）。
  影响范围：src/services/sys-msg 组织与 constants 单一来源；无路由/schema 变更。
  文件：src/services/sys-msg/*, src/models/constants.js, src/models/sys-msg.js, src/dao/sys-msg-dao.js, src/routes/v2/messages.js, src/services/trajectory/trajectory-batch-service.js, scripts/characterization/characterize-sys-msg.mjs
  Python 同步提示：纯路径移动与常量下沉，不改接口语义，Python 控制面无需改动。



- 2026-08-15: 阶段截图 V2：phase_done 长图不再烘焙元素高亮；`screenshot.metadata_json` 记录截图长宽 + 全部可见 L2 控件坐标（拼接图内容坐标）+ region_tree；录制链路 `capturePhaseHighlightScreenshot` → `capturePhaseScreenshot`。
  影响范围：src/services/trajectory 录制链路、executor `session.bib_phase_highlight_capture`（消息名不变，payload `hitCount` → `meta`）。
  文件：src/dao/screenshot-dao.js, src/services/screenshot-service.js, src/services/trajectory/phase-highlight-screenshot.js, src/services/trajectory/trajectory-recording-runner.js, src/models/phase-highlight-targets.js（删除）, scripts/characterization/characterize-phase-highlight-screenshot.mjs
  Python 同步提示：executor 桥接为 JS-gen executor 内部实现，Python 控制面无需改动；前端契约见 /api/v2/export/transaction/schema（Task 6）。

- 2026-08-15: **导出/推送 envelope V2（schemaVersion 2）**：每个 `transcationProperties` 项新增 `regionId`/`parentRegionId`（层级作证，空串兜底）；每交易新增 `phases[]`（phaseId/phaseNumber/screenshotId/stitchScreenshotUrl/metadata）。
  影响范围：src/routes/v2/export-mgmt、src/services/transaction-export、api-docs 契约。
  文件：src/services/transaction-export.js, src/routes/v2/export-mgmt.js, src/dashboard/api-docs/groups/export-mgmt.js, scripts/characterization/characterize-transaction-export-region.mjs
  Python 同步提示：前端契约以 /api/v2/export/transaction/schema 为准；Python 控制面无对应端点。

- 2026-08-13: **分区拼接（tab / 向导 / titlebox）**：`assignRegion` 在 overlay/表格/待办/壳短路之后，把内容 tab 或向导当前步、collapse、最近 titlebox 拼成 `region_label`（` / `）与 `region_id`（`|`）；collapse 标题剥尾部动作字。撞车 refine 不再把路径打回单独 titlebox。`display_group` 仍等于中文路径。
  影响范围：扫描 / resolve / 录制 `element_json` 的 `region_*` 与 `display_group`；无 schema。
  文件：src/cdp/page-locator-helpers.js, src/cdp/display-group.js, src/cdp/resolve-by-label.js, src/models/element.js
  Python 同步提示：无 HTTP/schema。透传 `display_group` / `region_label` 原样展示（可能含 ` / `）；可选透传 `region_chrome` / `region_section` / `region_block`。勿再按单层 collapse 标题重算分组。

- 2026-08-13: **阶段长图控件高亮**：由纯描边改为 Chrome 审查元素风格（框内浅蓝色半透明蒙层 + 蓝色 outline）。不改 layout。
  影响范围：phase_done 拼接截图观感。
  文件：src/cdp/phase-highlight-page.js
  Python 同步提示：无 HTTP/schema。执行机若自带 mark CSS，应对齐 inset `rgba(111,168,220,.45)`。

- 2026-08-13: **prepare 登录硬编码**：`record/prepare`（及 `record/start` 未登录兜底）改为 `replay_actions`：`go_to_url` + `login(username, password)`，不再发 `session.step` 启动 browser-use；失败（导航/填表/按钮）使 prepare 失败。登录仍不写入 `trajectory_step`。
  影响范围：service（prepare/start 登录）、scripts（`login()` 失败返回 `err-login`）、api-docs。
  文件：src/services/trajectory/trajectory-record-lifecycle.js, scripts/controller/actions/_form.py, src/dashboard/api-docs/groups/recording.js, scripts/characterization/characterize-trajectory.mjs, characterize-login-action.py
  Python 同步提示：无 HTTP/schema。若代理侧 prepare 登录仍发 session.step，改为 replay_actions（go_to_url + login，不传验证码）。

### Fixed

- 2026-08-17: **阶段长图内部滚动容器漏截（瀑布流）**：`pickScrollRoot` 只认 `.el-main`/`.app-main`，页面主文档不滚动、内容在非标准 class 的内部滚动容器（如 `.plugin-content-list`，el-scrollbar 内容容器，scrollHeight 6554 / clientHeight 659）时回退 `document`（不滚动）→ 长图只截一屏、瀑布流内容丢失。修复：`pickScrollRoot` 泛化——标准主区优先，否则扫描全页 `div/main/section/article` 中 `overflowY∈{auto,scroll}` 且确实可滚动的容器，选 `scrollHeight` 最大的作为滚动根（`phase-screenshot-page.js` scroll/collect 两处共用同一逻辑）。真实页面湿测：选中 `.plugin-content-list`（6554>659），坐标 box 正确。
  影响范围：阶段长图拼接（src/cdp）；无 schema/HTTP。
  文件：src/cdp/phase-screenshot-page.js, scripts/characterization/characterize-phase-highlight-screenshot.mjs
  Python 同步提示：无 HTTP/schema。执行机注入的 locator helpers 不涉及滚动根（滚动根仅在 Node CDP 截图链路）；若代理侧有类似长图拼接，滚动根选择需覆盖内部滚动容器。

- 2026-08-17: **执行机 slot 复用失效（控制面重启后重连开新 slot）**：`supersedeStaleForTrajectory` 清理旧 remote_session 时只做 DB 侧处理（detachLive 停 BiB + close 行 + unmount），未关闭执行机上对应的 agent session——Python 进程与 Chrome 继续存活、slot 持续占用，`listCdp` 的 `occupiedCdpPorts` 把旧 CDP 端口排除出孤儿 Chrome 扫描，`preferIdleChrome` 复用失败，重新 prepare 时**新开 slot**，旧 Chrome 变成无法接管的孤儿（"连不上之前断开的"）。修复：supersede 关闭 DB 行后补 `closeExecutorSession({nodeUuid, sessionId: agentSessionId, keepBrowser: true, timeoutMs: 2000})`——杀 Python 释放 slot，**保留 Chrome 在 CDP 端口**，下次 attach 的孤儿扫描能发现并复用同一个浏览器（页面/登录态保留）；`closeSession` 新增可选 `timeoutMs` 参数（默认 15000 不变；执行机对未知 session 不发 `session.closed` 事件，supersede 用 2000 短超时避免 prepare 卡顿）。
  影响范围：src/services/remote-session-service.js（supersede 行为）、src/executor-session-client.js（closeSession 新增可选参数，默认不变）。
  文件：src/services/remote-session-service.js, src/executor-session-client.js, scripts/characterization/characterize-session-lifecycle.mjs
  Python 同步提示：无 HTTP/schema。执行机侧 `session.close` 语义不变（`keepBrowser=true` 保留 Chrome 供复用）；代理侧若也有「清理旧绑定→关闭执行机 session」链路，需同步关闭 agent session（保留浏览器）。

- 2026-08-17: **节点详情接口回显系统账号**：`GET /api/v2/system-mgmt/nodes/:id` 此前只返回节点本身（`getNode` 仅 `systemDao.getById`），type=1 系统节点详情不回显 `accounts[]`，编辑表单若用详情接口将拿不到已有账号。现在 type=1 节点详情附带 `accounts[]`（形状与 tree `includeAccounts` 一致：id/name/account/password/loginUrl/remark/sortOrder）。
  影响范围：`GET /api/v2/system-mgmt/nodes/:id` 响应体（type=1 节点新增 accounts 字段；无 schema/HTTP 路径变更）。
  文件：src/services/hierarchy-service.js, scripts/characterization/characterize-system-node-accounts.mjs
  Python 同步提示：无 HTTP 路径/schema 变更；若代理侧展示节点详情，可选透传 `accounts[]`（含 id，编辑全量替换按 id 更新依赖回显 id）。

- 2026-08-17: **批量导入生成的交易漏盖 paasUserId**：`batch-analyze.js` 的 `createDraftFromAnalyzed` 创建交易时未透传 `job.paasUserId`，导致批量导入任务归了用户、任务生成的交易 `paas_user_id` 为 NULL（无主全可见），隔离失效。现在透传 `paasUserId: job.paasUserId || null`，交易与任务归属一致。
  影响范围：批量导入 analyze 链路新建交易的用户归属（无 schema/HTTP 变更）。
  文件：src/services/trajectory/batch-analyze.js, scripts/characterization/characterize-sso-auth.mjs
  Python 同步提示：无 HTTP/schema。若代理侧也有「任务→交易」创建链路，需同步透传任务归属用户 id。

- 2026-08-15: **分区 compose 继承修复**：浮动/固定操作条（如底部「返回」按钮）位于 tab pane 之外时 chrome/section 丢失、region 退化为单 titlebox 段；现在从几何就近 titlebox 自身的上下文继承 chrome+section，得到完整 `tab|section|titlebox` 路径（与同 titlebox 内按钮一致）。
  影响范围：assignRegion / composeContentRegion（src/cdp）、resolve/扫描/录制 `element_json`、`_locator_helpers_js.py`（重生成）。
  文件：src/cdp/page-locator-helpers.js, scripts/controller/actions/js_snippets/_locator_helpers_js.py, scripts/characterization/characterize-partition-compose.mjs
  Python 同步提示：无 HTTP/schema；`_locator_helpers_js.py` 为重生成物，Python 端直接使用即可。

- 2026-08-15: **阶段截图坐标几何修正**（final review I1/I2）：捕获 clip 到滚动根 box（片高==容器高，图像=纯主滚动区内容）；每片按实际 scrollTop 放置（`stitchPngSlices` 支持每片 overlap），元素坐标恒为内容坐标（x=rect.left-box.x、y=top_i+rect.top-box.y），无末片 clamp 重复条带、无内容带丢失；树组装失败落 `regionTree:null`（不丢截图）。
  影响范围：阶段长图与 `metadata_json` 坐标契约（前端按 imageWidth/imageHeight 与 contentWidth/contentHeight 比例渲染；12MB 降采样时二者不同）。
  文件：src/cdp/phase-screenshot-capture.js, src/cdp/phase-screenshot-page.js, src/cdp/png-stitch.js, src/services/trajectory/phase-highlight-screenshot.js, executor/session-handler.js, executor/session-manager.js, scripts/characterization/characterize-phase-highlight-screenshot.mjs, scripts/refactor/verify-all.sh
  Python 同步提示：无 HTTP/schema；executor 消息名与 meta 字段不变。

- 2026-08-13: **向导分区**：`nearestPageSteps` 在公共祖先下最多向下 3 层找 `.el-steps`，且包裹 class 含 `step`（如 `form > el-col > .steps-wrapper`）；不搜 `body`/`html`。当前步 class 读 `.el-step__head` / `__title`（皮肤不在 `.el-step` 根上打 `is-process`）。
  影响范围：向导页 `region_chrome` / `region_label`；无 schema。
  文件：src/cdp/page-locator-helpers.js
  Python 同步提示：无 HTTP/schema。执行机注入 locator helpers 后生效。

### Added

- 2026-08-15: **region-tree 服务**：新增 `src/services/region-tree.js`——整页大树 `assembleRegionTree`（前缀合并 / other 桶 / PR-LAYER page 只当根）+ 每步层级推导 `deriveRegionRef`（回退链：layers → region_id 按 `|` 拆 → region_label/display_group 按 ` / ` 拆 → 空串），为批量推送 V2.0 层级作证与阶段截图元数据组树提供公共依赖；`scripts/characterization/characterize-region-tree.mjs` 作证。
  影响范围：Node 侧新增纯函数服务；无 schema、无路由、无 HTTP 变更。
  文件：src/services/region-tree.js, scripts/characterization/characterize-region-tree.mjs
  Python 同步提示：无（纯 Node 服务；Python 不迁 scripts）；导出 envelope 形状变化在后续任务条目覆盖。

- 2026-08-15: `migrations/20260815090000_screenshot_metadata_json`：`screenshot` 表新增 `metadata_json` JSON 列（阶段长图元数据：长宽/元素坐标/region_tree）。
  影响范围：screenshot schema、阶段截图捕获链路。
  文件：migrations/20260815090000_screenshot_metadata_json.js, schemas/init.sql
  Python 同步提示：无（截图捕获在 Node CDP 侧）；`schemas/init.sql` 已同步。

- 2026-08-14: **轨迹状态枚举 v2**：`trajectory.record_status` 由旧五态改为 `ENUM('draft','recording','failed','recorded','completed')`（未录制/录制中/录制异常/待确认/已确认）；`live`（推流占用）并入 `recording`（存量迁移）。录制失败/中断/批次恢复 INTERRUPTED → `failed`（重录走 record/start 或 clear 重置）；取消确认 completed→recorded；推送闸仅 `completed`；`isAiRecordingActive`（phase.status='running'）替换全部旧 live 判定；stats 五档键名与 api-docs/Vue 文案同步。
  影响范围：schema（迁移+init.sql）、录制/占用/清理全部写入点、export push gate、轨迹列表 stats、api-docs。
  文件：migrations/20260814120000_trajectory_record_status_v2.js, schemas/init.sql, src/models/constants.js, src/dao/trajectory-dao.js, src/services/trajectory/trajectory-status-utils.js, trajectory-recording-runner.js, trajectory-record-lifecycle.js, trajectory-meta-service.js, trajectory-batch-service.js, trajectory-attach-runner.js, trajectory-attach-service.js, trajectory-manual-record.js, src/services/export-push-gate.js, src/services/replay-service.js, src/routes/v2/export-mgmt.js, src/dashboard/api-docs/*, scripts/characterization/characterize-record-status-v2.mjs, characterize-trajectory.mjs, characterize-export-push-gate.mjs, characterize-batch-task-progress.mjs, scripts/smoke/accept-recording-apis.mjs, accept-multi-traj-lifecycle.mjs
  Python 同步提示：无状态值跨仓透传；Python 端若展示轨迹状态按新五档文案（未录制/录制中/录制异常/待确认/已确认）；`manual_record_status` 事件不变；stats 键名改为 draft/recording/failed/recorded/completed。

- 2026-08-14: **批量导入任务名称 + 轨迹列表统计**：`batch_recording_job` 加 `name VARCHAR(512)`（默认 `文件名_MMDD-HHmm`，存量回填）；`trajectory` 加 `batch_job_id`（VARCHAR(36)，可空，FK→`batch_recording_job.id`，NULL=手动创建；init.sql 只同步列与索引，FK 仍只在迁移）。`POST /v2/trajectories/batch/import` 可选表单字段 `name`（缺省按公式生成）；`GET /v2/trajectories/batch/{batchId}` 响应加 `name`。`GET /api/v2/trajectories` 新增查询参数 `batchTaskName`（模糊），每行返回 `batchTaskName`，响应新增 `stats`（total/draft/live/recording/recorded/completed，与行查询同基准过滤、忽略 recordStatus）。sys_msg 消息链路不变。
  影响范围：schema（两迁移）、batch import/view、轨迹列表 API、api-docs。
  文件：migrations/20260814100000_batch_job_name.js, migrations/20260814110000_trajectory_batch_job.js, schemas/init.sql, src/services/trajectory/batch-job-name.js, src/dao/batch-recording-dao.js, src/dao/trajectory-dao.js, src/services/trajectory/trajectory-batch-service.js, src/services/trajectory/trajectory-meta-service.js, src/services/trajectory/batch-analyze.js, src/routes/v2/trajectory-batch.js, src/routes/v2/trajectory.js, src/dashboard/api-docs/groups/trajectory.js, scripts/characterization/characterize-batch-task-name.mjs
  Python 同步提示：对齐 `batch_recording_job.name` 与 `trajectory.batch_job_id`（UUID，可空，FK SET NULL）；`/v2/trajectories` 透传 `batchTaskName`（模糊）与 `stats`（五档同基准）；批量导入创建时 name 缺省按 `文件名_MMDD-HHmm` 生成；消息正文不含任务名。

- 2026-08-14: **分区 layers[]**：每个控件 `layers`（`{ role, label }[]`，外→内）由 `region_*` 推导，写入 snap / preview / `element_json`。todo 短路 `region_role` 改为 `todo`。可选 `pageLabel` 头插 `page`（不套 page）。无 schema。
  影响范围：扫描 / resolve / 录制 `element_json`；`display_group` 仍为中文路径。
  文件：src/cdp/page-locator-helpers.js, src/cdp/region-layers.js, src/cdp/resolve-by-label.js, src/models/element.js
  Python 同步提示：无 schema；resolve-element 可选 body `pageLabel`/`page_label`（头插根 page）；可选透传 `layers`；SPA 仍按 `display_group` 原样展示。整页 `region_tree` 未做。

- 2026-08-13: **产品消息表（批量导入终态）**：新建 `sys_msg`；字典 `sys_msg_type`（`1`=批量导入任务）。批量任务第一次进入终态插入一条；标题「批量导入任务」；正文两行（功能·文件·状态 / 共N条统计）；`linkUrl=/ui-recording?batchId=`。`GET /api/v2/messages`（`pageNum`）/ `unread-count` / `POST :id/read` / `read-all`。`user_id` 挂起，全员同一列表与已读。
  影响范围：schema、字典种子、batch finalize、v2 消息 API、api-docs。
  文件：migrations/20260813160000_sys_msg.js, schemas/init.sql, src/services/sys-msg-compose.js, src/services/sys-msg-service.js, src/dao/sys-msg-dao.js, src/routes/v2/messages.js, src/services/trajectory/trajectory-batch-service.js
  Python 同步提示：对齐表 `sys_msg` 与字典 `sys_msg_type`；透传 `/api/v2/messages*`（无用户过滤）；勿从 batch 表虚拟拼消息。

- 2026-08-13: **批量行进度 + 阶段 done 说明**：`trajectory_phase.done_logs` JSON 数组 `[{text, at, source}]`；`phase_done.data.text` 追加写入（空 text 跳过；`phase_error` 为 `source=fail`）。`GET` 交易树 `phases[].doneLogs`；`GET/WS` 批量 item 计算 `progressPercent` / `phaseCompleted` / `phaseTotal` / `phaseName` / `lastDoneText`（不落 batch_item）。`trajectory.trajectory_log` 语义不变。
  影响范围：trajectory_phase schema、录制 runner、batch GET/WS、api-docs。
  文件：migrations/20260813120000_phase_done_logs.js, src/models/phase-done-logs.js, src/services/trajectory/batch-item-progress.js, src/services/trajectory-phase-service.js, trajectory-recording-runner.js, trajectory-batch-service.js
  Python 同步提示：对齐 `trajectory_phase.done_logs`；透传 tree 的 `doneLogs` 与 batch item 五个计算字段；**不**改 batch URL。

- 2026-08-13: **AI 阶段结束长图（控件高亮）**：`phase_done` 后对本阶段产品树步骤在当前页描边并滚主滚动区拼接 1 张 PNG，写入 `screenshot.kind=phase_highlight` 与 `trajectory_phase.stitch_screenshot_id`。失败不影响录制。交易树 phase 带 `stitchScreenshotId` / `stitchScreenshotUrl`。
  影响范围：screenshot / trajectory_phase schema、录制 runner、tree、BiB executor `session.bib_phase_highlight_capture`。
  文件：migrations/20260813100000_phase_highlight_screenshot.js, schemas/init.sql, src/cdp/phase-highlight-*.js, src/services/trajectory/phase-highlight-screenshot.js, executor/bib-bridge.js
  Python 同步提示：对齐 `screenshot.kind` 新枚举与 `trajectory_phase.stitch_screenshot_id`；透传 tree 的 `stitchScreenshotUrl`；执行机需实现 `session.bib_phase_highlight_capture`（JS-gen executor 已加）。

### Fixed

- 2026-08-13: **批量导入中文文件名乱码**：multipart `filename` 按 UTF-8 解码（multer `defParamCharset`）；latin1 误读的已存文件名在落库、通知拼装、消息列表、batch GET 按段修复。勿把整段 `msgContent` 当 latin1。
  影响范围：upload、batch import、sys_msg 列表回显。
  文件：src/http/decode-upload-filename.js, src/http/upload-xlsx.js, src/routes/v2/trajectory-batch.js, src/services/sys-msg-compose.js, src/services/trajectory/trajectory-batch-service.js
  Python 同步提示：上传文件名按 UTF-8；已存乱码只修文件名段。无 schema。

- 2026-08-13: **批量行 lastDoneText 取最新已完成阶段**：不再跨阶段按 `at` 取全局最新日志（后续阶段常无 `done().text` 时会一直停在阶段1）。有该阶段 `done_logs` 用末条；没有则显示 `阶段N已完成`。不落库、不写「见页面当前状态」。
  影响范围：batch GET/WS 计算字段 `lastDoneText`。
  文件：src/services/trajectory/batch-item-progress.js
  Python 同步提示：若代理展示 lastDoneText，按最新 completed 阶段取，勿用全局 max(at)。`phase_done` 只结束当前阶段，整段 `record/start` 保持 `recordStatus=recording` 与 `session.busy`（画布仅观看）。prepare 不得把正在 recording 的交易打回 `live`（占用中）。`waitForSessionEvent` 的 phase_error 等待在本阶段结束后取消，避免误杀下一阶段。
  影响范围：录制 runner、prepare attach、debug session-message、画布 remote:status。
  文件：src/services/trajectory/trajectory-recording-runner.js, trajectory-record-lifecycle.js, trajectory-attach-runner.js, src/routes/browser-session/session-message.js, src/executor-event-hub.js
  Python 同步提示：无 HTTP/schema。代理侧若同样在 phase_done 时把会话标 idle / 允许画布输入，应对齐为整段录制锁。

- 2026-08-13: **日期填表与文本合并为 `fill_form_field`**：`el-date-editor` / `tsscdatepicker`（含 TsscMultiDatePicker）走同一填值动作，写入 Vue `v-model`。库内旧 `fill_date_field` 已 SQL 迁成 `fill_form_field`；控制器动作已删，仅别名归一。导出日期类型按控件 xpath（`el-date-editor` / `tsscdatepicker`）推断。
  影响范围：CTRL fillFormField、Python fill/replay、action-name 别名、legacy-engine 导出、heal 指令。
  文件：src/ctrl-actions/form.js, src/models/action-name.js, src/services/legacy-engine-export.js, src/routes/browser-session/heal-instruction.js, scripts/controller/actions/_form.py, _replay.py, replay_names.py
  Python 同步提示：无 HTTP/schema。`fill_date_field` / `fillDateField` 归一为 `fill_form_field`。日期控件须同步 Vue 模型。前端须去掉「填写日期」独立动作（别名指向 fill_form_field）。

- 2026-08-13: **分区逻辑收口后端**：`displayGroupOf` / `uniquifyDisplayGroups` 产出可直接展示的 `display_group`（中文 `region_label`；撞车后缀仅业务主键或 `#n`，禁止 xpath 碎片）；产品 SPA 选择器按该字段原样分组，不再从 xpath / 中文启发式重算分区。
  影响范围：resolve-element ambiguous matches、自动抓取选择器。
  文件：src/cdp/display-group.js, src/dashboard/api-docs/groups/recording.js, scripts/characterization/characterize-l1c-region-classify.mjs
  Python 同步提示：透传 `display_group` 原样展示；勿在代理/前端再解析 xpath 当分组标题。

- 2026-08-13: **待办 region 优先中文标题**：`assignRegion(.todo-item)` 的 `region_label` 用卡片头中文（如【对公授信申请】信贷调查），`region_id` 用业务主键（PJ/DGSX/YXPC…）；同标题撞车时 `uniquifyDisplayGroups` 追加主键后缀。scan L1 todo title 同步。
  影响范围：resolve-element / 自动抓取选择器分组。
  文件：src/cdp/page-locator-helpers.js, src/cdp/display-group.js, scripts/controller/actions/js_snippets/scan_form.py, scripts/characterization/characterize-unify-partition-locator.py, characterize-todo-item-action.py
  Python 同步提示：透传 `region_label` 中文优先；勿把业务主键当唯一展示名。

- 2026-08-12: **`uniquifyDisplayGroups` 撞车键优先 formLabel**：el-select 可见值常相同（如「否」），不可当 label；仅 `(display_group, formLabel|matchedLabel)` 双撞车才追加 xpath 后缀。修复「对公客户概况」被拆成 `… · ins(@class,'el-select')]`。
  影响范围：自动抓取/歧义选择器分组。
  文件：src/cdp/display-group.js, scripts/characterization/characterize-l1c-region-classify.mjs
  Python 同步提示：同名去重键用表单项 label，勿用控件当前显示值。

- 2026-08-12: **`uniquifyDisplayGroups` 仅在「分区 + label」双撞车时细化**：同一 `display_group` 下不同控件文案（客户编号/客户名称）不再追加 xpath 后缀；仅同区同文案（多「处理」/「新增」）才加后缀。对齐「先粗分区，撞车再细化」。
  影响范围：自动抓取/歧义选择器分组标题。
  文件：src/cdp/display-group.js, scripts/characterization/characterize-l1c-region-classify.mjs
  Python 同步提示：若代理侧有同名 display_group 去重，按 (region, label) 键，勿按 region  alone。

- 2026-08-12: **撞车细化后 L1c 不得回写粗 collapse 标签**：`assignRegion` 仍先粗分区；`refineCollidingRegions` 升到 titlebox 后，`patchRegionFields` 保留已有可读 `region_label`/`region_id`（不再被 feature-card 外层「股东及关联人信息」覆盖）；`buildFeatureCard` 取 title 时 titlebox 优先于 collapse。
  影响范围：`resolve-element` 多「新增」歧义选择器分组。
  文件：src/services/trajectory/trajectory-record-lifecycle.js, src/cdp/page-locator-helpers.js, scripts/characterization/characterize-l1c-region-classify.mjs, characterize-resolve-collision-titlebox.mjs
  Python 同步提示：无 API；代理侧若有 L1c 回写，勿覆盖 resolve 已细化的 `region_label`。

- 2026-08-12: **L1c 改写 region 后同步 `display_group`**：`patchRegionFields` 经共享 `displayGroupOf` 重算分组键；**禁止用 taxonomy 角色名（`section`）覆盖可读 `region_label`（PJ/DGSX/卡片标题）**；歧义多命中同名时 `uniquifyDisplayGroups` 追加短 xpath/id 后缀，并可从 xpath 找回业务键。
  影响范围：`resolve-element` ambiguous matches（含 L1c）、自动抓取选择器分组。
  文件：src/cdp/display-group.js, src/cdp/resolve-by-label.js, src/cdp/page-locator-helpers.js, src/services/region-classify.js, src/services/trajectory/trajectory-record-lifecycle.js, scripts/characterization/characterize-l1c-region-classify.mjs
  Python 同步提示：透传 `display_group`；L1c 回写后勿用 `section` 等角色名覆盖业务 `region_label`。

- 2026-08-12: **待办「处理」假成功回放 + 自动抓取漏抓**：`normalizeTargetRoot` / `inventoryKindOf` 均优先 `.todo-item-action`（先于 `.el-checkbox-group`），避免录成 checkbox-group xpath、以及 inventory 误标 `form_checkbox` 被 `click_element` 过滤掉；durable 在 `want` 文本存在时拒绝「xpath 命中祖先但文案非精确匹配」的 `ok-xpath-smart`；inventory 收录 `.todo-item-action`。
  影响范围：手动录制 xpath_smart、steps/replay 点击、resolve-element / 自动抓取 inventory。
  文件：src/cdp/page-locator-helpers.js, scripts/controller/actions/replay_js.py, scripts/controller/actions/js_snippets/_locator_helpers_js.py, scripts/characterization/characterize-todo-item-action.py
  Python 同步提示：无 API；执行机需重载含上述 helpers / replay_js 的会话后再用「自动抓取」点「处理」。

- 2026-08-12: **待办卡片「处理」自动抓取/分区（1448067 延伸）**：L2 `collectL2Buttons` 收录 `div.todo-item-action`（非 button 标签亦准入）；L1 经 `assignRegion` 按 `.todo-item` 卡片赋 `region_label`（如 PJ…）；xpath 消歧经 `regionAnchor*` / 类 leaf；`resolve-by-label` 候选同步。人工录制/回放此前已补。
  影响范围：`scan_editable_summary` / `JS_SCAN_FORM_FIELDS` L2 buttons + L1 regions、resolve-element 文本匹配、locator helpers。
  文件：scripts/controller/actions/js_snippets/scan_form.py, scan_utils.py, src/cdp/page-locator-helpers.js, resolve-by-label.js, locator-builders/dispatcher.js, scripts/characterization/characterize-todo-item-action.py
  Python 同步提示：若代理侧有全页扫描/resolve 按钮白名单，对齐 L2 准入 `.todo-item-action` + L1 `assignRegion` 卡片分区。

- 2026-08-12: **Partner 代理网络失败文案**：projects/systems/importDemand 遇 nginx 502、超时、非 JSON 时统一返回「网络异常，自动化平台无法连接」（技术细节打 warn 日志，不塞进 `error`）。
  影响范围：`GET /api/v2/export/partner/projects|systems`、推送 importDemand 502/504 message。
  文件：src/services/partner-platform.js, src/dashboard/api-docs/groups/export-mgmt.js
  Python 同步提示：对齐同文案；对方业务 `msg` 仍透传。

- 2026-08-12: **草稿交易不可推送（1448068）**：partner 真实推送仅允许 `recordStatus=recorded|completed`；单轨 `push=true` → 409 `not_pushable_status`；批量跳过 draft/live/recording（item 带同 code）。dryRun/raw 仍可组装。批量无可推送时文案改为中文「没有可推送的交易…」。
  影响范围：export 推送闸门、api-docs、产品 toast 文案。
  文件：src/services/export-push-gate.js, src/routes/v2/export-mgmt.js, src/dashboard/api-docs/groups/export-mgmt.js, scripts/characterization/characterize-export-push-gate.mjs
  Python 同步提示：对齐 push 前校验录制状态；409 body 含 `code`/`recordStatus`；空推送 error 用中文。

- 2026-08-12: **下拉选项子串误匹配（国民经济部门类别）**：`already-matched` / fuzzy / JS `includes` 不再用「短选项 ⊆ 长 want」把「其他非金融企业部门」录成「非金融企业部门」；exact 优先，contains 取最短合法项。
  影响范围：AI/`select_option` 录制与 autofill、`_llm_values` commandValue fuzzy。
  文件：scripts/controller/actions/form_scan_utils.py, _form.py, _llm_values.py, js_snippets/select_option.py, scripts/characterization/characterize-select-option-substring.py
  Python 同步提示：无 API 变更；若代理侧有同类 fuzzy，对齐「禁止 o in want 短串」。

- 2026-08-12: **人工录制弹窗表格 radio 不落步**：`tableRadio` 在 `rowText` 空时不再静默 `return`；回退 `data-row-key` / `row-index:N`，仍无身份则 fall through 到普通 click。
  影响范围：手动录制 dialog/picker 表行单选。
  文件：scripts/manual_recorder/js_parts/a.py, b.py, scripts/characterization/characterize-manual-table-radio.py
  Python 同步提示：无；仅 executor 手动录制脚本。

- 2026-08-12: **AI 录制行业代码等树选择器落成树节点**：`select_tree_option` 按 label 解析 xpath 并 stamp `form_tree_select`；`prepareElementJson` 对 `select_tree_option` 推断 `form_tree_select`（不再误成 `form_input`）；popover 内树节点回绑表单树选择控件（侧栏 `.el-tree` 仍为 `tree_node`）；AI `click_element_by_index` / 手动录制在表单树 popover 上升级为 `select_tree_option`。
  影响范围：录制步骤 `action`/`target_kind`、回放定位、手动录制 mapper。
  文件：scripts/controller/actions/_form.py, _misc.py, src/models/element.js, src/cdp/page-locator-helpers.js, scripts/manual_recorder/*, scripts/characterization/characterize-tree-select-record.py
  Python 同步提示：对齐 `select_tree_option`→`form_tree_select` 元素元数据；产品 UI 操作类型应对「树选择器」而非「树节点」。

- 2026-08-11: **browser-session-lifecycle final review**：`assertNoForeignGraceOnNodeSlot` 改为 slot 感知（不同 `slotIndex` 跳过，同槽/未知槽 + idle grace 仍 gate）；`reusedChrome` 时即使无 `cdpPort` 也跑 claim；`detachTrajectoryLive` 在 streamDetach 清缓存后经 `getByTrajectory`/`getOccupiedByAgentSession` 解析 remote_session，并以 `clearOwnershipOnClose` 立即清归属；`markActive`/`syncMount` 清 `grace_until`。
  影响范围：多槽 attach 409 误拒修复；硬 detach 在 streamDetach 后仍能关 idle Chrome；owner reclaim 不再残留 grace。
  文件：src/services/trajectory/trajectory-attach-service.js, src/services/session-lifecycle.js, src/dao/remote-session-dao.js, scripts/characterization/characterize-session-lifecycle.mjs
  Python 同步提示：对齐 attach claim gate 按 slot 过滤（勿 node 全表 false-deny）；硬 detach 走 truth `trajectory_id` 查找并立即清归属；`markActive`/`syncMount` 清 `grace_until`。

- 2026-08-11: **remote_session 归属真相源 + streamDetach 宽限**：`trajectory_id` 为唯一归属；`trajectory.remote_session_id` 仅为门面缓存；`streamDetach` 进入 idle 时保留归属并设 `grace_until`（默认 15min）；宽限期内他交易认领 → 409 `grace_owned`；reaper 先到期清归属再关孤儿。修复 `markIdle` 清空 `trajectory_id` 导致交叉挂载/易主；`attachLive` / `attachTrajectoryLive`（含 `reusedChrome` slot 感知 claim gate）在宽限内拒绝他交易复用 idle Chrome。
  影响范围：schema（`grace_until`）、attach/streamDetach/detach/reaper 语义、409 响应可含 `code`/`ownerTrajectoryId`/`graceUntil`；env `REMOTE_SESSION_GRACE_MS`。
  文件：migrations/20260811200000_remote_session_grace_until.js, schemas/init.sql, config/config.js, src/services/session-lifecycle*.js, src/dao/remote-session-dao.js, src/services/remote-session-service.js, src/services/trajectory-idle-reaper.js, src/services/trajectory/trajectory-attach-service.js, src/routes/v2/remote-session.js, src/routes/v2/trajectory-shared.js, scripts/characterization/characterize-session-lifecycle.mjs
  Python 同步提示：对齐 `remote_session.grace_until`；代理 attach/stream-detach 时透传 409 `code=grace_owned` 与 `ownerTrajectoryId`/`graceUntil`；勿在宽限期内把 idle Chrome 当无主复用。

- 2026-08-11: **产品步骤列表过滤内部 meta（Bug-1448055）**：`save_form_snapshot` 等仍入库供 Type B 回放，但默认不出现在 `GET .../tree` / `GET .../phases/:id/steps`；`includeMeta=1` 可看全量；步骤带 `isMeta`；`stepCount` 只计业务步；live `action_persisted` 不对 meta 广播；`steps/replay` 在选中业务步 `step_number` 区间自动补入 meta 检查点。
  影响范围：轨迹树/阶段步骤列表、stepCount、live WS、steps/replay 选步扩展。
  文件：src/models/meta-step-actions.js, src/services/trajectory-query-service.js, src/services/trajectory-step-service.js, src/routes/browser-session/persist-live.js, src/services/trajectory/trajectory-session-replay.js, src/routes/v2/trajectory.js, src/routes/v2/trajectory-steps.js, src/dashboard/api-docs/groups/trajectory.js, scripts/characterization/characterize-meta-step-filter.mjs
  Python 同步提示：代理 tree/phase-steps 透传 `includeMeta`；对齐默认隐藏 meta + `isMeta`；回放若只传业务 stepIds，应对齐「区间内自动补 save_form_snapshot」或依赖本控制面扩展。

- 2026-08-11: **批量导入中文提示与模板文件名**：未上传/空 buffer →「请上传 Excel 文件」；无数据行 →「导入文件为空，请至少填写一行交易」；无有效行 →「Excel 中没有有效数据行」。模板下载 `Content-Disposition` 中文名「批量录制导入模板.xlsx」（RFC 5987 `filename*` + ASCII 回退）。
  影响范围：`GET /api/v2/trajectories/batch/template`、`POST /api/v2/trajectories/batch/import` 错误文案与下载文件名。
  文件：src/routes/v2/trajectory-batch.js, src/services/trajectory/trajectory-batch-service.js, src/services/trajectory-batch-excel.js, src/dashboard/api-docs/groups/trajectory.js
  Python 同步提示：对齐空文件/无数据行中文 error 文案；模板下载按 `filename*` 展示中文名（或同步改代理侧 Content-Disposition）。

- 2026-08-11: **L1c final review hardening**：`callLLMWithTimeout` 在 race 结束后 `clearTimeout`，避免 LLM 先返回后超时 rejection 未处理；`L1C_LLM=false` 时不 L1d 缓存 `shouldLlmClassify` 规则结果（仅缓存最终规则命中如高置信 `main`）；`resolve-element` 的 `resolveSystemIdForTrajectory` / `applyL1cRegionClassify` 软失败（warn + 原 payload），不因分类 500。
  影响范围：`classifyRegions` L1d 命中条件；`POST .../resolve-element` 稳定性。
  文件：src/services/region-classify.js, src/services/trajectory/trajectory-record-lifecycle.js
  Python 同步提示：无 API 变更；若本地缓存 L1d，对齐「LLM 关闭时不缓存待 LLM 卡片」语义。

### Changed

- 2026-08-13: **v2 行为保持去重：steps→commands 映射合并 + sendErr/asyncHandler 统一**：`stepsToActionCommands` 收拢到 `src/models/element.js`（replay-service `prepareReplay` 传 `{ preferEntryPhase: true }` 保留原 `phaseNumber ?? entry.phase ?? 0` 语义；`/assemble-file` 默认 `phaseNumber ?? 0` 不变）；v2 `sendErr` 统一到 `trajectory-shared.js`（canonical 增补可选 `rejected` 字段，其余字段不变），并新增 `asyncHandler`；replay / regions / operation-component / system-ref-data / trajectory-batch 5 个路由文件删除本地 sendErr 副本与手写 try/catch（batch/import 的 multipart 回调除外）。
  影响范围：错误响应 body 为兼容性扩张（错误对象若带 `code`/`ownerTrajectoryId`/`graceUntil`/`holders`/`rejected` 时多透传，此前部分模块不返回）；路由路径/方法、成功响应字段、WS 协议均不变。
  文件：src/models/element.js, src/services/replay-service.js, src/routes/v2/trajectory.js, src/routes/v2/trajectory-shared.js, src/routes/v2/replay.js, src/routes/v2/regions.js, src/routes/v2/operation-component.js, src/routes/v2/system-ref-data.js, src/routes/v2/trajectory-batch.js
  Python 同步提示：错误响应扩展字段均为可选透传；Python 端转发 v2 错误 body 时透传即可，无需强制。

- 2026-08-12: **分区/定位统一 U2（inventory = L2 投影）**：`collectL2Hosts` 为唯一 host 选择器表；`collectInventoryHosts` 委托之；循环内 `normalizeHost` + `classifyOperable`（无并行 collector 表）。`collectL2Buttons` 仍保留 button-only 投影但继续 `classifyOperable` 准入。
  影响范围：PAGE_LOCATOR_HELPERS、resolve-element inventory、自动抓取。
  文件：src/cdp/page-locator-helpers.js, scripts/controller/actions/js_snippets/_locator_helpers_js.py, scripts/characterization/characterize-unify-partition-locator.py
  Python 同步提示：无 API；SPA/执行机需重载 helpers 后再用 inventory / 自动抓取。

- 2026-08-12: **分区/定位统一 U1（自动抓取可读分区）**：`classifyOperable`/`normalizeHost` 为唯一准入/host 内核；resolve-element 歧义项增加 `display_group`（= `region_label`），待办多「处理」须带互异卡片业务键。
  影响范围：PAGE_LOCATOR_HELPERS、resolve-element ambiguous matches、api-docs。
  文件：src/cdp/page-locator-helpers.js, src/cdp/resolve-by-label.js, src/dashboard/api-docs/groups/recording.js, …
  Python 同步提示：透传 `display_group`；产品 SPA「选择匹配的控件」按 `display_group`/`region_label` 分组，勿用 `region_role`。

- 2026-08-12: **BiB 画布本机剪贴板**：`remote:input` 新增 `kind:clipboard`（`getSelection`）；下行 `remote:clipboard`；产品画布 Ctrl/Cmd+C/V 走本机剪贴板语义（不再把 C/V 当远端键透传）。
  影响范围：`/ws` BiB 协议；executor `session.bib_clipboard`；Vue `useRemoteCanvas`
  文件：src/cdp/clipboard-selection.js, src/cdp/remote-bridge/ws-router.js, executor/bib-bridge.js, src/dashboard/api-docs/groups/websocket.js, scripts/characterization/characterize-clipboard-selection.mjs
  Python 同步提示：若 Python 控制面转发 BiB `remote:input`，对齐 `clipboard` 与 `remote:clipboard` 广播

- 2026-08-12: **xpath 消歧 helpers 统一为 `regionAnchor*`（R4）**：`sectionAnchorOf` / `sectionAnchorXPath` 别名已删除；仅保留 `regionAnchorOf` / `regionAnchorXPath`，注释标明 xpath 消歧（非产品 L1 分块 / `section=`）。产品区域请用 `region_*` / `assignRegion`。
  影响范围：CDP locator helpers、Python 镜像 `_locator_helpers_js.py`、region-anchored xpath 导出/回放。
  文件：src/cdp/page-locator-helpers.js, scripts/controller/actions/js_snippets/_locator_helpers_js.py, scripts/characterization/characterize-section-anchored-xpath.py
  Python 同步提示：控制面若不镜像 `page-locator-helpers` 可跳过；代理侧若注入同名 helpers，仅使用 `regionAnchor*`（勿再引用 `sectionAnchor*`）。

- 2026-08-12: **Agent stderr 导出剥前缀**：`GET|POST .../agent-stderr` 与 traj 快捷导出返回正文时去掉 `[slot:N sid:…]` 与 `[session]`（落盘 slot 前缀仍保留供过滤）；监视面板「日志」同步干净正文。
  影响范围：导出 text/json 的 `lines` 内容；Python agent 源日志不再写 `[session]`，阶段结束为 `Phase N done` + 空行。
  文件：src/services/agent-stderr-log-service.js, src/routes/v2/agent-stderr.js, scripts/session_runner.py, scripts/agent/service.py, scripts/browser/factory.py, scripts/event_dispatch.py, scripts/trajectory_store.py, scripts/cdp_ports.py
  Python 同步提示：若代理导出接口，对齐剥前缀后的正文（或自行 strip）。

- 2026-08-12: **`GET /api/v2/recording/agent-stderr/active` 附带 CDP 端口**：对在线执行机拉 `session.list`，`rows[].cdpPort` + `slotPorts[]`（含空闲槽默认口）；执行机 `list()` 改为返回全容量槽。监视面板新增 CDP 列。
  影响范围：`/active` 响应扩字段；executor WS `session.list_result.sessions` 可含 `sessionId: null` 的空闲槽。
  文件：executor/session-manager.js, src/services/agent-stderr-log-service.js, src/dashboard/api-docs/slot-monitor.js, src/dashboard/api-docs/groups/recording.js
  Python 同步提示：若代理 `/active`，透传 `cdpPort` 与 `slotPorts`；解析 `session.list` 时忽略无 sessionId 的槽即可。

- 2026-08-11: **AI 录制 agent_task：案例 KV 仅文本注入 + 【阶段目录】全量阶段**：`format_case_data_hint` 同时附原文 block 与扁平 `- 键：值`（不再互斥）；撤回 select `commandValue` 硬绑。`stepData.all_phases` 来自交易全部 phase（`allPhases`），执行仍只跑勾选 `phaseIds`。
  影响范围：`[session] agent_task preview` 内容；录制 `all_phases` 载荷。
  文件：scripts/controller/actions/_case_data.py, scripts/controller/actions/_form.py, scripts/controller/actions/phase/outcomes.py, src/services/trajectory/trajectory-recording-runner.js
  Python 同步提示：若代理录制 step 载荷，透传全量 `all_phases`；业务数据以 task 文本为准，勿再依赖 case_data_store 硬灌 select。

### Added

- 2026-08-12: **`POST /api/v2/recording/agent-stderr/clear` + 监视面板「清空日志」**：按 session 删除控面 `logs/agent-stderr/{sessionId}.log`（仅该文件）。Body 同 /active 行；监视占用行与日志面板均可触发。
  影响范围：新路由；`/api/docs` 执行机监视 UX。
  文件：src/services/agent-stderr-log-service.js, src/routes/v2/agent-stderr.js, src/dashboard/api-docs/slot-monitor.js, src/dashboard/api-docs/groups/recording.js
  Python 同步提示：若代理录制相关 API，对齐 `POST /api/v2/recording/agent-stderr/clear`（body 透传 sessionId/trajectoryId/sid）。

- 2026-08-12: **`/api/docs` 执行机监视面板**：侧栏「执行机监视」按节点拆分槽位（空闲/占用、交易、session、CDP）；支持刷新/筛选/自动刷新；占用行可「断开画面」「释放浏览器」「日志」「清空日志」。
  影响范围：仅 `/api/docs` 前端；清空走 `POST .../agent-stderr/clear`；CDP 来自 `/active.slotPorts`。
  文件：src/dashboard/api-docs/slot-monitor.js, src/dashboard/api-docs/app.js, src/dashboard/api-docs/catalog.js, src/dashboard/api-docs/api-docs.css
  Python 同步提示：无

- 2026-08-12: **`POST /api/v2/recording/agent-stderr` 粘贴 /active 行导出**：请求体可直接粘贴活动目录 `rows[]` 一项（识别 `slotIndex`/`sid`/`sessionId`/`trajectoryId`，其余字段忽略）。
  影响范围：新增 POST；`/api/docs` Try 示例为 active 行 JSON。
  文件：src/routes/v2/agent-stderr.js, src/dashboard/api-docs/groups/recording.js
  Python 同步提示：代理 `POST /api/v2/recording/agent-stderr`，body 透传 active 行字段。

- 2026-08-11: **多 slot Agent stderr 隔离与导出**：执行机行前缀 `[slot:N sid:…]` 经 WS `session.agent_stderr` 落盘控面；交易录制分组新增 `GET /api/v2/recording/agent-stderr/active`、`GET|POST /api/v2/recording/agent-stderr`、`GET /api/v2/trajectories/:id/agent-stderr`。
  影响范围：新路由 + executor stderr 前缀；env `AGENT_STDERR_LOG_DIR`。
  文件：executor/stderr-prefix.js, executor/session-slot.js, src/services/agent-stderr-log-service.js, src/routes/v2/agent-stderr.js, src/executor-ws.js, src/dashboard/api-docs/groups/recording.js, config/config.js
  Python 同步提示：若代理录制相关 API，对齐 active GET + recording agent-stderr GET/POST + traj 快捷 GET；WS `session.agent_stderr` 可忽略（控面落盘）。

- 2026-08-11: **L1c 区域分类 `POST /api/v2/regions/classify` + `L1C_LLM` 灰度**：批量对 feature card 做规则 → L1d 缓存 → 可选 LLM 分类；`resolve-element` 已在 lifecycle 内联 `classifyRegions`；scan/fullpage 可经 HTTP 调用同一服务。
  影响范围：`POST /api/v2/regions/classify` 请求体 `{ systemId?, cards }` → `{ items }`；env `L1C_LLM`（默认关）、`L1C_LLM_TIMEOUT_MS`。
  文件：src/routes/v2/regions.js, src/services/region-classify.js, src/services/trajectory/trajectory-record-lifecycle.js, config/config.js, config/.env.example, src/dashboard/api-docs/groups/regions.js
  Python 同步提示：代理 `POST /api/v2/regions/classify`；对齐 `items[].role|label|confidence|source` 与 `L1C_LLM` 开关语义；`scan_editable_summary` 接入可后续跟进。

- 2026-08-10: **`resolve-element` inventory 模式端到端贯通**：HTTP body / executor WS `session.bib_resolve_element` 支持 `mode`（产品默认 `inventory`）；inventory 无 label/action 不 400，无 labelText 时始终返回 ambiguous 列表；可选 `truncated` 表示命中 INVENTORY_CAP。
  影响范围：`POST .../resolve-element` 请求体 `mode`；executor WS `session.bib_resolve_element` payload；响应可含 `truncated`。
  文件：src/routes/v2/trajectory-record.js, src/services/trajectory/trajectory-record-lifecycle.js, src/cdp/remote-bridge/index.js, executor/session-handler.js, executor/session-manager.js, executor/bib-bridge.js, src/dashboard/api-docs/groups/recording.js
  Python 同步提示：代理 resolve-element / bib_resolve_element 时透传 `mode`（默认 `inventory`）；对齐 ambiguous + `truncated` 响应字段。

- 2026-08-10: **`resolve-element` 同区碰撞后 titlebox 细化 L1**：歧义匹配按 `(needle, region_id)` 碰撞组再发现 `div.titlebox`/`span.title`，刷新 `region_*` 并尝试 titlebox 锚定 `xpath_smart`（算法 B 不丢匹配）。湿测多「新增」可区分面板标签。
  影响范围：`POST .../resolve-element` 歧义 matches 的 `region_*` / `xpath_smart`；CDP helpers 与 Python `_locator_helpers_js` 同步。
  文件：src/cdp/page-locator-helpers.js, src/cdp/resolve-by-label.js, src/models/element.js, scripts/controller/actions/js_snippets/_locator_helpers_js.py, scripts/characterization/characterize-resolve-collision-titlebox.mjs
  Python 同步提示：若代理 resolve-element，对齐碰撞细化后的 `preview.region_label` / `xpath_smart`（无 schema 变更）。

### Fixed

- 2026-08-10: **`prepareElementJson` / `enrichLocatorFields` 保留已抓取相对 xpath**：缺 `xpath_smart` 但 `xpath` 已是 `//…`（含 titlebox 锚定）时不再按按钮文案发明裸 leaf 覆盖。
  影响范围：步骤创建/更新 element 归一化；与 Vue `buildElement` 持久化 `xpath_smart` 互补。
  文件：src/cdp/locator-builders/candidates.js
  Python 同步提示：若 Python 控制面有同源 enrich，对齐「已有相对 xpath 优先于 text 发明」。

### Added

- 2026-08-10: **灰度开关 `XPATH_SMART_FILL_ONLY`（默认关）**：开则 `fill_form_field` 仅允许 `xpath_smart` 定位；关则无 xpath 时保留 label DOM 兜底（测试人员）。入口 `scripts/feature_flags.py` / `config/.env.example`。
  影响范围：Agent 填表行为开关。
  文件：scripts/feature_flags.py, scripts/controller/actions/_form.py, config/.env.example
  Python 同步提示：无（scripts 侧；若 Python 控制面另有填表代理可对齐同名 env）。

- 2026-08-10: **`resolve-element` 歧义匹配附带 L1 区域预览**：`matches[].preview` / element 增加 `region_role`、`region_id`、`region_label`（与全页扫描 `assignRegion` 同源规则）；Vue 选择器主行展示区域标签。算法 B：归位失败不丢匹配。BiB 需重载执行机后做多「新增」冒烟（湿测挂起）。
  影响范围：`POST .../resolve-element` 响应预览字段；CDP `PAGE_LOCATOR_HELPERS` / `resolve-by-label`。
  文件：src/cdp/page-locator-helpers.js, src/cdp/resolve-by-label.js, scripts/controller/actions/js_snippets/scan_form.py, scripts/controller/actions/js_snippets/_locator_helpers_js.py
  Python 同步提示：对齐 resolve-element 歧义 `matches[].preview.region_*`（若 Python 控制面代理该接口）。

- 2026-08-10: **`GET /api/v2/export/transaction/schema` partner envelope 字段契约**：返回 `schemaVersion`、`fields`（transcId / transcationName / …）、`eventTypeName` 中文映射与 `actionTypeMap`；拼写（transcation*、mothed）为对接约定。
  影响范围：`/api/v2/export/transaction/schema` 新增端点。
  文件：src/routes/v2/export-mgmt.js, src/services/transaction-export.js, src/dashboard/api-docs/groups/export-mgmt.js
  Python 同步提示：对齐 partner transaction schema 响应结构与字段说明。

- 2026-08-10: **`GET|POST /api/v2/export/trajectories/:id/transaction` 单条交易导出**：query/body 必填 `systemId`、`projectId`；全量导出 trajectory_step 为 partner envelope，成功 `markExported`（`isExport=1`）；`download=1` 时响应体仅为 payload。轨迹不存在 → 404；缺 id → 400。
  影响范围：`/api/v2/export/trajectories/:id/transaction` 新增端点。
  文件：src/routes/v2/export-mgmt.js, src/services/transaction-export.js, src/dashboard/api-docs/groups/export-mgmt.js
  Python 同步提示：对齐单条交易导出路由、必填参数与 download 语义。

- 2026-08-10: **`POST /api/v2/export/transactions` 批量交易导出**：body 传 `trajectoryIds`、`systemId`、`projectId`；逐条独立 ok/fail，成功项返回 partner envelope 并 `markExported`，失败项（不存在/异常）不翻转 `isExport`；响应含 `items[]` 与 `summary.{ok,failed}`。
  影响范围：`/api/v2/export/transactions` 新增端点。
  文件：src/routes/v2/export-mgmt.js
  Python 同步提示：对齐批量交易导出路由与 per-item 响应格式。

- 2026-08-10: **`trajectory.is_export` 脏标记列 + DAO helpers**：迁移新增 `is_export TINYINT(1) NOT NULL DEFAULT 0`（1=最近一次全量导出成功，0=有变更或未导出）；`markExportDirty` / `markExported` 更新标志；`getById` / `list` / `listByFunction` 返回 `isExport` 为 `0|1` 数字。
  影响范围：trajectory 表 schema、trajectory DAO。
  文件：migrations/20260810120000_trajectory_is_export.js, src/dao/trajectory-dao.js
  Python 同步提示：对齐 `trajectory.is_export` 列及 `isExport` 字段语义；导出成功由 transaction export 路由调用 `markExported`。

- 2026-08-09: **T10-P1:** `JS_VERIFY_FORM_STRUCTURE` / CTRL `verifyFormStructure` collect Source B `el-table` labels (same `row#N` naming as scan) so snapshot verify matches recording surface.
  影响范围: `scripts/controller/actions/js_snippets/misc.py`, `src/ctrl-actions/structure.js`
  Python 同步提示：无

- 2026-08-09: **T4-P3:** Source B keeps empty-leading `el-table` rows (`row#N` + index xpath); `CTRL.selectOption` ports `SELECT_LAZY_LOAD_ON_MISS`.
  影响范围: `scripts/controller/actions/js_snippets/scan_form.py`, `scripts/prompts/agent-tools-form.md`, `src/ctrl-actions/select.js`
  Python 同步提示：无

- 2026-08-09: **`scan_editable_summary` 旁路记忆（T4-P2）**：成功摘要后 best-effort 上报 `form_state` 事件与 `form_inventory` 聚合 facts（`container`/`pending_count`/`pending_labels`/`buttons`）；`AI_MEMORY_EVENTS` 开关；不阻塞 action 返回。
  影响范围：Python agent `scripts/controller/actions/_form.py`、`scripts/memory/inventory_emit.py`。
  文件：scripts/controller/actions/_form.py, scripts/memory/inventory_emit.py, scripts/characterization/characterize-inventory-memory.py
  Python 同步提示：无

- 2026-08-09: **`scan_editable_summary` Agent 动作（T4-P0）**：只读可见可编辑控件摘要（`pending_labels`、`buttons[{text,section}]`、`sections`）；不写 `task_list` / `_scan_fields`、不触发 auto-fill。P0 单根扫描（复用 `JS_GET_CONTAINER` + `quick=true`）；多 overlay 根合并去壳 → T4-P1。Prompt 引导填表/找按钮前先摘要。
  影响范围：Python agent `scripts/controller/actions/_form.py`、`form_scan_utils.py`、`scripts/prompts/agent-tools-form.md`。
  文件：scripts/controller/actions/_form.py, scripts/controller/actions/form_scan_utils.py, scripts/prompts/agent-tools-form.md, scripts/characterization/characterize-scan-editable-summary.py
  Python 同步提示：无

- 2026-08-09: **`scan_editable_summary` 多根扫描（T4-P1）**：`JS_SCAN_FORM_FIELDS` 新增 `opts.mode:'multi'`；`scan_editable_summary` 传入多根模式，合并可见 overlay 或 `.el-main` 主内容区（去壳），跨根 `xpath_smart` 去重；默认无 `opts` 时行为不变。
  影响范围：Python agent `scripts/controller/actions/_form.py`、`js_snippets/scan_form.py`。
  文件：scripts/controller/actions/_form.py, scripts/controller/actions/js_snippets/scan_form.py
  Python 同步提示：无

- 2026-08-07: **批量导入草稿模式（`mode=record|draft`）**：`POST .../trajectories/batch/import` 接受 `mode`（默认 `record`；非法值 → 400）。`mode=draft` 仅 analyze+建草稿（`bindTrajectoryAsDrafted` → item `drafted`），跳过 prepare/record/detach，不要求 `USE_EXECUTOR`；`mode=record` 保持原一站式录制语义，`USE_EXECUTOR=false` → 503。`request_hash` / 幂等键含 `mode`；`summary.drafted` 计数；取消 job 仅 `cancelOpenItems` 未决项，已 `drafted`/`recorded` 保留。状态查询与 WS `batch:*` payload 含 `mode`；`pumpDraft` 独立认领 `analyzed` 且无 `trajectoryId` 的孤儿项（重启 `kickScheduler` 可恢复）；`pumpRecord` 仅 `queued`/`waiting_executor` + `jobModes: ['record']`。schema：`batch_recording_job.mode`；item 终端态 `drafted`；常量 `BATCH_JOB_MODES`、`BATCH_ITEM_STATUSES` / `BATCH_ITEM_TERMINAL` 含 `drafted`。
  影响范围：batch import API、调度、DAO、api-docs、Vue 批量导入 UI。
  文件：migrations/20260807120000_batch_job_mode_and_drafted.js, src/models/constants.js, src/dao/batch-recording-dao.js, src/services/trajectory-batch-service.js, src/dashboard/api-docs/catalog.js, scripts/characterization/characterize-batch-import.mjs
  Python 同步提示：对齐 `mode` 参数（默认 record、非法 400）、item `drafted`、summary.drafted、状态/WS `mode` 字段；`mode=draft` 不校验 executor；取消保留已 drafted。

- 2026-08-07: **`POST /api/v2/trajectories/{id}/steps/move`**：拖拽改序 / 跨阶段移动单步；`beforeStepId` 省略或 null 表示目标阶段末尾；AI 录制 / 人工录制 / `session.busy` 时 409。
  影响范围：v2 trajectories API、step DAO、api-docs。
  文件：src/dao/trajectory-step-dao.js, src/services/trajectory-step-move.js, src/services/trajectory-step-service.js, src/services/trajectory-service.js, src/routes/v2/trajectory.js, src/dashboard/api-docs/catalog.js
  Python 同步提示：对齐 `POST .../steps/move` 请求体与 409 忙碌语义。

- 2026-08-07: Session Chrome 可选无头：`CHROME_HEADLESS=true`（config/.env 或 executor/.env）。无实体窗口，BiB 仍走 CDP screencast，便于规避最小化/失焦节流。
  影响范围：config、executor 子进程 env、Python 启动参数。
  文件：config/.env.example, executor/.env.example, executor/config.js, src/runtime/agent-process.js, scripts/session_runner.py
  Python 同步提示：无（仅 JS-gen Session Chrome 启动）。

### Changed

- 2026-08-11: BiB 画面推流默认限帧约 10–12fps（分辨率/quality 不变），降低公网观看延迟与卡顿。可通过 `BIB_STREAM_MIN_FORWARD_MS`、`BIB_STREAM_EVERY_NTH_FRAME` 调整。
  - 影响：执行机 `bib-bridge`、控制面 `remote-bridge` screencast、`/api/docs` WS 说明。
  - Python 同步提示：无 schema/路由变更；若 Python 控制面有独立 screencast 旁路，对齐限帧默认值即可。

- 2026-08-11: **page-state-gen**：可点击 leaf 在相对 xpath 多命中时，用页态（步骤条→dialog/drawer→breadcrumb）锚定 `xpath_smart`；唯一控件不包。推广原 wizard 下一步逻辑。
  影响范围：CDP locator helpers / 录制 snap / resolve inventory。
  文件：src/cdp/page-locator-helpers.js, scripts/controller/actions/js_snippets/_locator_helpers_js.py
  Python 同步提示：无 API 变更；若 Python 侧自建 xpath enrich 可对齐碰撞才包 page-state。

- 2026-08-10: **批量推送（Batch Push）端到端**：api-docs 分组改为「批量推送管理」；新增对方项目/系统代理（`GET /export/partner/projects|systems`）；`POST /export/transactions` 组装后代调 importDemand，仅对方成功才 `markExported`；`systemId`/`projectId` 缺省 98/31；`access_token` 从头/body/env 转发。Vue 弹窗改为项目→系统级联。
  影响范围：批量推送产品流、partner 代理、importDemand 代推。
  文件：src/services/partner-platform.js, src/routes/v2/export-mgmt.js, src/dashboard/api-docs/groups/export-mgmt.js, config/.env.example；Vue：api/export.ts、BatchPushDialog.vue、ui-recording/index.vue
  Python 同步提示：无（导出/推送为 Node 侧）。

- 2026-08-10: **Partner transaction 导出对齐 importDemand 定稿**：外层 `transcationEventTypeList`；轨内步骤为 `transcationProperties`；`testFrame=playwright`；`propertiesName` 无分隔符且同轨去重（重复追加 2、3…）；`raw`/`forImport`/`download` 返回可直接 POST 的导入体；批量 raw 合并多轨。
  影响范围：`/api/v2/export/trajectories/:id/transaction`、`/api/v2/export/transactions`、transaction schema/docs。
  文件：src/services/transaction-export.js, src/routes/v2/export-mgmt.js, src/dashboard/api-docs/groups/export-mgmt.js, scripts/characterization/characterize-transaction-export.mjs, scripts/export-transaction-raw.mjs
  Python 同步提示：无（导出为 Node 侧）。

- 2026-08-09: **Overlay 容器命名带触发按钮（`dialog:<按钮>|<标题>`）。** 录制用最近成功点击文案合成 display id（无标题 → `|unnamed`）；`verifyFormStructure` / `JS_VERIFY_FORM_STRUCTURE` 只匹配 `|` 后标题，兼容旧 `dialog:标题` / `dialog:unnamed`。
  影响范围：录制 snapshot container、steps/replay Type B 校验、assembled CTRL。
  文件：scripts/controller/actions/container_naming.py, _form.py, form_scan_utils.py, _misc.py, _table.py, js_snippets/misc.py, src/ctrl-actions/structure.js
  Python 同步提示：无（scripts + CTRL；Python 控制面无对等逻辑）。

- 2026-08-08: **修复重构回归——`liveByRemoteSessionId` 裸引用**：remote-session-service 拆分 state 后未导入该 Map（仅 re-export，不会引入模块作用域），BiB attach 时 ReferenceError → `[trajectory] BiB attach failed`。已在导入块补回。
  影响范围：录制 attach（attachTrajectoryLive / stream attach）与 live 状态绑定。
  文件：src/services/remote-session-service.js
  Python 同步提示：无（JS 侧回归修复，协议不变）。

- 2026-08-08: **拆分 cdp/remote-bridge.js 为包**：`src/cdp/remote-bridge/` 下拆出 `state.js`（共享可变状态 `bridge` 对象 + 常量 + `getRemoteStatus` / `broadcastStatus` / `broadcastInspect` / `pushAgentEvent`）、`screencast.js`（startScreencast/restartScreencast/onScreencastFrame/stall watchdog/viewport override）、`cdp-input.js`（handleAck/flushFillRecord/handleInput/handleViewport）、`ws-router.js`（ensureWsHook WS 路由 + BiB target 解析 `resolveBibTarget`）；`index.js` 保留全部 10 个公开导出与模块状态，`src/cdp/remote-bridge.js` 改为 10 名字的 re-export shim（同一函数身份），消费者导入路径零变化。`wsHooked` 注册语义与 `ensureWsHook` 调用时机不变（`attachLive` 以参数注入 ws-router 避免 import 环）。全部函数逐字比对一致（仅 `bridge.` 前缀改写与 shorthand→显式属性等价变换），无逻辑变更。
  影响范围：BiB 远程桥（CDP screencast/input、remote:* WS、resolveBibTarget、resolveElementByLabelText）语义不变。
  文件：src/cdp/remote-bridge.js, src/cdp/remote-bridge/{index,state,screencast,cdp-input,ws-router}.js
  Python 同步提示：无（纯结构移动，端点路径/响应零变化）。

- 2026-08-08: **拆分 v2/trajectory.js 路由注册**：单一注册函数按资源拆为三个模块——`trajectory.js`（trajectory CRUD / phases / case-data / login-context / clear / assemble-file）、`trajectory-record.js`（record prepare/start/stop、attach/detach/stream-detach、manual-record、resolve-element、confirm）、`trajectory-steps.js`（steps CRUD、steps/replay start+stop、step-move）；共享 `sendErr` 助手移入 `trajectory-shared.js`。`__init__.js` 在 `registerTrajectory(app)` 后依次调用三个注册函数；32 条路由的方法/路径/处理器逐字不变（每块逐字比对一致），各模块内注册顺序不变。跨模块间路由互不遮蔽（各路径字面段/段数互异），Express 匹配行为不变。
  影响范围：/api/v2/trajectories* 全部路由（语义不变）。
  文件：src/routes/v2/trajectory.js, src/routes/v2/trajectory-record.js, src/routes/v2/trajectory-steps.js, src/routes/v2/trajectory-shared.js, src/routes/v2/__init__.js
  Python 同步提示：无（纯结构移动，端点路径/响应零变化）。

- 2026-08-08: **拆分 browser-session/register.js 路由处理器**：`POST /api/browser/session/:id/trajectory` 持久化编排块（~200 行）移入 `src/routes/browser-session/trajectory-persist.js`；`POST /api/browser/watcher/action` 处理器 + `session:step` WS 消息路由移入 `src/routes/browser-session/watcher-actions.js`。register.js 保留路由表，handler 体改为调用导入函数；WS 处理器注册顺序不变（仍为注册函数末尾）。代码块逐字移动，无逻辑变更。
  影响范围：/api/browser/session/:id/trajectory、/api/browser/watcher/action、WS session:step（语义不变）。
  文件：src/routes/browser-session/register.js, src/routes/browser-session/trajectory-persist.js, src/routes/browser-session/watcher-actions.js
  Python 同步提示：无（纯结构移动，端点路径/响应零变化）。

- 2026-08-08: **trajectory 服务迁入 `src/services/trajectory/`**：六个服务文件（`trajectory-session-replay` / `trajectory-batch-service` / `trajectory-record-lifecycle` / `trajectory-persist-service` / `trajectory-attach-service` / `trajectory-meta-service`）git mv 到 `src/services/trajectory/`，与 batch 2 各抽取模块同目录；新增 `src/services/trajectory/index.js` barrel re-export 六个服务的全部公开导出（45 个名字）。所有引用方（facade `trajectory-recording-service` / `trajectory-service`、路由、scripts 表征/smoke）导入路径同步更新；表征脚本按新模块位置断言同一不变量。纯目录移动 + 路径修正，无逻辑变更、无协议变更。
  影响范围：模块导入路径（服务行为不变）。
  文件：src/services/trajectory/index.js, src/services/trajectory/trajectory-{session-replay,batch-service,record-lifecycle,persist-service,attach-service,meta-service}.js, src/services/trajectory-recording-service.js, src/services/trajectory-service.js, src/routes/v2/trajectory-batch.js, src/routes/browser-session/persist-live.js, scripts/characterization/characterize-trajectory.mjs, scripts/characterization/characterize-analyze-case-data.mjs, scripts/characterization/characterize-batch-import.mjs, scripts/characterization/characterize-form-snapshot-trigger.mjs, scripts/smoke/smoke-trajectory-step-idempotent.mjs
  Python 同步提示：无（纯结构移动，无协议变更）。

- 2026-08-08: **拆分 hierarchy-service.js**：树导出/导入块（`exportTree` / `getTreeTemplate` / `getTreeTemplateExcel` / `exportTreeExcel` / `importTreeExcel` + `EXPORT_VERSION`）移入 `src/services/hierarchy-excel.js`；原文件保留树查询/CRUD（`getTree` / `nestToChildrenTree` / `createSystem` / `createModule` / `createFunction` / `resolveAncestorSystemId` / `importTree` 等），5 个被移动的公开导出改为 re-export（同一函数身份），`getTree` 供新模块的 `importTreeExcel` 复用。代码块逐字移动，无逻辑变更。
  影响范围：系统管理树导出/导入端点（JSON/Excel 语义不变）。
  文件：src/services/hierarchy-service.js, src/services/hierarchy-excel.js
  Python 同步提示：无（纯结构移动，无协议变更）。

- 2026-08-08: **拆分 remote-session-service.js**：模块级状态枢纽（`liveByRemoteSessionId` 活绑定 Map + `trajLocks` 每轨迹串行锁）与全部状态访问器（`withTrajectoryLock` / `bindingToStatus` / `getLiveBindingBy*` / `resolveLiveBinding` / `clearExecutorLive*` / `clearLiveBinding` / `restoreLiveBindingFromRow` / `listLiveBindings`）移入 `src/services/remote-session-state.js`；原文件保留 BiB 生命周期操作（`openSession` / `attachLive` / `detachLive` / `getLiveStatus` / `mountTrajectoryRemoteSession` / `supersedeStaleForTrajectory` 等），11 个被移动的公开导出改为 re-export（同一函数身份），`liveByRemoteSessionId` 导出供状态模块使用（ESM 活绑定，Map 变更跨模块可见）。代码块逐字移动，无逻辑变更。
  影响范围：BiB 绑定查询/状态序列（语义不变）。
  文件：src/services/remote-session-service.js, src/services/remote-session-state.js
  Python 同步提示：无（纯结构移动，无协议变更）。

- 2026-08-08: **拆分 trajectory-meta-service.js**：需求文本抽取助手（`stripBusinessDataBlock` / `phaseNeedsBusinessData` / `extractCaseDataBlock` / `extractCaseEntriesFromRequirement` / `appendCaseDataToPhases` + 区块正则常量）移入 `src/services/trajectory/trajectory-text-extract.js`；原文件保留 `analyzeRequirementToPhases` / `createEmptyTrajectory` / `createTransactionWithPhases` / `setTrajectoryCaseEntries` / `confirmTrajectory`，被移动的 4 个公开导出改为 re-export（同一函数身份），`CASE_DATA_SECTION_RE` / `appendCaseDataToPhases` 供 `analyzeRequirementToPhases` 复用。代码块逐字移动，无逻辑变更。
  影响范围：需求→阶段分析、业务数据注入、case-data 解析（语义不变）。
  文件：src/services/trajectory-meta-service.js, src/services/trajectory/trajectory-text-extract.js
  Python 同步提示：无（纯结构移动，无协议变更）。

- 2026-08-08: **拆分 trajectory-attach-service.js**：`prepareTrajectoryRecordingUnlocked`（录制准备主流程：session/browser/stream/login 分阶段 + BiB 挂载 + 默认登录）移入 `src/services/trajectory/trajectory-attach-runner.js`；原文件保留全部公开导出（`prepareTrajectoryRecording` / `attachTrajectoryLive` / `detachTrajectoryStream` / `detachTrajectoryLive` / `bindTrajectoryManualPersist` / `cleanupPersistedTrajectoryResources`），`prepareTrajectoryRecording` 改为调用新模块（内部函数，非公开导出）。代码块逐字移动，无逻辑变更。
  影响范围：record/prepare 路径（阶段事件语义不变）。
  文件：src/services/trajectory-attach-service.js, src/services/trajectory/trajectory-attach-runner.js
  Python 同步提示：无（纯结构移动，无协议变更）。

- 2026-08-08: **拆分 trajectory-persist-service.js**：实时步骤追加块（`appendRecordedStep` + `appendRecordedFormSnapshot` 快照双写/指纹去重）移入 `src/services/trajectory/form-snapshot-append.js`；原文件保留其余公开导出（`buildStepsFromActionFile` / `buildStepsFromFlow` / `readOperationLogText` / `persistSessionTrajectory` / `saveFullTrajectory` / `resolvePhaseIdForPersist` / `removeRecordedStepsByDbIds`），被移动的 2 个导出改为 re-export（同一函数身份），`resolvePhaseIdForPersist` 供新模块复用。代码块逐字移动，无逻辑变更。
  影响范围：实时 step append / save_form_snapshot 双写路径（语义不变）。
  文件：src/services/trajectory-persist-service.js, src/services/trajectory/form-snapshot-append.js
  Python 同步提示：无（纯结构移动，无协议变更）。

- 2026-08-08: **拆分 trajectory-record-lifecycle.js**：`startTrajectoryRecording`（AI 分阶段录制主循环 + action_log_sync 持久化 + 截图存取 lazy accessor）移入 `src/services/trajectory/trajectory-recording-runner.js`，`toggleTrajectoryManualRecord` 移入 `src/services/trajectory/trajectory-manual-record.js`；原文件保留其余 5 个公开导出（`prepareCaseDataInjection` / `runDefaultLogin` / `stopTrajectoryRecording` / `stopTrajectoryRecordingSafe` / `resolveTrajectoryElement`），被移动的 2 个导出改为 re-export（同一函数身份，facade 与表征校验不变）。代码块逐字移动，无逻辑变更。
  影响范围：record/start、manual-record toggle 路径（语义不变）。
  文件：src/services/trajectory-record-lifecycle.js, src/services/trajectory/trajectory-recording-runner.js, src/services/trajectory/trajectory-manual-record.js
  Python 同步提示：无（纯结构移动，无协议变更）。

- 2026-08-08: **拆分 trajectory-batch-service.js**：analyze 流水线（`pumpAnalyze` / `runAnalyze` / `createDraftFromAnalyzed` / `pumpDraft` + worker 计数）移入 `src/services/trajectory/batch-analyze.js`，record 流水线（`computeClusterFreeSlots` / `pumpRecord` / `runRecord` + worker 计数）移入 `src/services/trajectory/batch-record.js`；原文件保留全部公开 API（`buildRequestHash` / `getBatchJobView` / `importBatchFromExcel` / `startBatchScheduler` / `kickScheduler` / `cancelBatch` / `recoverBatchJobsOnStartup` / `buildTemplateBuffer`）与调度器，`cancelledAnalyzeTokens` / `emitProgress` / `maybeFinalizeJob` 改为导出供抽取模块复用（纯新增导出，无消费者破坏）。代码块逐字移动，无逻辑变更。
  影响范围：批量导入调度（analyze/draft/record pump 语义不变）。
  文件：src/services/trajectory-batch-service.js, src/services/trajectory/batch-analyze.js, src/services/trajectory/batch-record.js
  Python 同步提示：无（纯结构移动，无协议变更）。

- 2026-08-08: **拆分 trajectory-session-replay.js**：`runReplayBatch`（Type A 单步 heal 批处理）移入 `src/services/trajectory/replay-batch-runner.js`，`handleFormStructureCheckpoint`（Type B 表单结构检查点）移入 `src/services/trajectory/form-structure-heal.js`；原文件保留 3 个公开导出（`acceptTrajectoryStepsReplay` / `replayTrajectorySteps` / `stopTrajectoryStepsReplay`）与 `prepareReplayBatch`，仅新增对抽取模块的 import。代码块逐字移动，无逻辑变更。
  影响范围：steps/replay 路径（Type A/B heal 语义不变）。
  文件：src/services/trajectory-session-replay.js, src/services/trajectory/replay-batch-runner.js, src/services/trajectory/form-structure-heal.js
  Python 同步提示：无（纯结构移动，无协议变更）。

- 2026-08-08: **Agent prompt 分册装配 + 特殊元素按需 hint：** `agent-prompt.md` 拆为 `agent-core` + `agent-tools-common/form/table/tree`；`build_agent_system_message(contract)` 按 `_phase_intent.mode` 装配；`session_runner` 创建 Agent 时传入合约。删除 `agent-special-prompt.md`（内容不迁移）；`format_special_element_hint` 加厚 `phaseDescription`/`remark`/`stepSummary`；`toDisplayCandidates` 透传新字段。Planner 同步终检后保存口径。
  影响范围：Agent system prompt 装配、特殊元素 hint、planner-prompt、表征。
  文件：scripts/prompts/agent-*.md, scripts/agent_utils.py, scripts/session_runner.py, scripts/actions/_special_element.py, src/services/special-element-search-service.js, scripts/prompts/planner-prompt.md, scripts/characterization/characterize-agent-prompt-packs.py, scripts/characterization/characterize-special-element-hint.py, AGENTS.md, CLAUDE.md
  Python 同步提示：无（scripts 子进程）；若 Python 控制面复述 Agent 工具 schema 需对齐分册结构。

- 2026-08-08: **表单助手注入阶段任务/业务数据/只读快照；不确定字段 `needs_agent` 交主 Agent：** `_llm_generate_values` 带使命上下文；吃不准不写入。`run_form_assistant` 返回 `needs_agent[]`。主 Agent prompt 要求终检后再保存，并清理「助手完直接 click_save」过时句。
  影响范围：run_form_assistant、form/agent prompts、自动填值。
  文件：scripts/actions/_llm_values.py, scripts/actions/_form.py, scripts/prompts/form-prompt.md, scripts/prompts/agent-prompt.md, scripts/characterization/characterize-assistant-mission-context.py
  Python 同步提示：无（scripts 子进程）。

- 2026-08-08: **阶段保存闸门按 LLM 声明的 section 收窄：** `click_save`/`get_pending_tasks`/`run_form_assistant` 可选 `section=`；只校验/填写该折叠块 pending。无 section 且 pending 跨多块 → `err-section-required`。不再因征信等无关块挡住「系统评级结论」保存。
  影响范围：录制表单阶段提交闸门、助手、pending 摘要、agent-prompt。
  文件：scripts/actions/_section_scope.py, scripts/actions/_form.py, scripts/actions/_phase_intent.py, scripts/actions/_phase_boundary.py, scripts/prompts/agent-prompt.md, scripts/characterization/characterize-phase-section-scope.py
  Python 同步提示：无（scripts 子进程）；若控制面复述工具 schema 需为三动作增加可选 section。

- 2026-08-08: **XPath-primary 控件操作：** 写路径经 `_resolve_control` 后仅用相对 `xpath_smart` 定位；语义名 `label||placeholder` 仅用于取值/规则/录制。同 label 多 xpath → `ambiguous-label`。Agent 动作可选 `xpath_smart`；prompt 要求优先带 xpath。
  影响范围：Agent fill/select/date/radio、run_form_assistant、scan 语义名。
  文件：scripts/actions/_form.py, scripts/actions/_llm_values.py, scripts/prompts/agent-prompt.md, scripts/characterization/characterize-xpath-primary-ops.py
  Python 同步提示：无（scripts 子进程）；若控制面复述 Agent 工具 schema 需增加可选 xpath_smart。

- 2026-08-07: **el-select 懒加载选项：** `JS_SELECT_OPTION` 首轮未命中时，对下拉滚动容器稳态滚底加载更多选项后再匹配（Agent `select_option` 与 live `_replay.py` 共用）。不改 `CTRL.selectOption`。
  影响范围：Agent select_option、live replay fill/select。
  文件：scripts/actions/_js_snippets.py（调用方 `_form.py` / `_replay.py` 无接口变更）
  Python 同步提示：无（scripts 子进程）；若 Python 控制面自带同源 snippets 需对齐。

- 2026-08-07: **执行机会话模型缺省解析**：`attachTrajectoryLive` 不再硬编码 `deepseek-v4-flash` 兜底，改为 `resolveModelId(traj.model)` —— `traj.model` 为空 → `agent-api.json` 的 `defaultModel`，显式值保持不变。
  影响范围：录制 attach 的执行机会话模型选择。
  文件：src/services/trajectory-attach-service.js
  Python 同步提示：无（仅 JS 侧执行机会话模型解析；Python 端无需对齐）。

- 2026-08-07: **control-ops 分块闭环（section + buttons + xpath-first 写路径）**：`JS_SCAN_FORM_FIELDS` 为字段/按钮挂 `section_id`/`section_title`（collapse/tab/card）；Source B 对齐 `date`/`radio`/`checkbox`；扫描结果含 `buttons[]`；`run_form_assistant` / `scan_form_fields` 摘要返回 `sections[]` 与 `ambiguous_buttons[]`（同名按钮跨块时提示）。`fill_form_field`/`select_option`/`click_radio` 及 date/radio/checkbox 在 pending 项带 `xpath_smart` 时 xpath-first 执行；`click_save(button_text, section='')` 按区块定位保存，多处可见「保存」且无 `section` 时返回 `err-save-ambiguous` 不盲点。
  影响范围：表单扫描、助手、live replay 写路径、保存按钮定位。
  文件：scripts/actions/_js_snippets.py, scripts/actions/_form.py, scripts/models/field.py, scripts/models/task.py, scripts/characterization/characterize-control-ops-closed-loop.py, scripts/characterization/characterize-xpath-fill-select.py, scripts/prompts/agent-prompt.md
  Python 同步提示：无（scripts 子进程行为；控制面 API 不变）。

- 2026-08-07: 删除 `trajectory_step.is_replay` 列及 `idx_step_is_replay` 索引；列表/计数/组件签名不再按该列过滤。`POST .../steps/replay` 请求体 `isReplay` 仍为运行时抑制入库。
  影响范围：schema、trajectory step DAO/计数、operation-component 签名、api-docs。
  文件：migrations/20260807160000_drop_trajectory_step_is_replay.js, schemas/init.sql, src/dao/trajectory-step-dao.js, src/dao/trajectory-dao.js, src/services/trajectory-step-service.js, src/services/operation-component-signature.js, src/services/operation-component-service.js, src/services/trajectory-persist-service.js, src/dashboard/api-docs/catalog.js
  Python 同步提示：对齐 schema 删除 `is_replay`；勿再读写该列。

- 2026-08-07: **表单扫描 control-first + el-table（Source B）**：`JS_SCAN_FORM_FIELDS` 在 Source A（`.el-form-item`）之外发现可见 `el-table` 可编辑单元格；每条字段输出相对 `xpath_smart`；按 xpath 去重（冲突时保留 form-item 元数据）；`ScannedField` / `TaskItem` / `form_snapshot.fields_fingerprint` 携带 xpath；无 label 仅有 placeholder 的控件纳入扫描（displayName=placeholder）。表单助手与 `save_form_snapshot` 共用同一扫描结果。
  影响范围：run_form_assistant 批量填写、录制 form_snapshot、live replay 定位语义。
  文件：scripts/actions/_js_snippets.py, scripts/models/field.py, scripts/models/task.py, scripts/models/form_snapshot.py, scripts/characterization/characterize-form-scan-control-first.py
  Python 同步提示：无（scripts 子进程扫描语义；控制面 API 不变）。

- 2026-08-07: **表单助手 xpath-first 执行**：pending 项带 `xpath_smart` 时 `_auto_fill_pending` / `_execute_round` 优先 `JS_FILL_BY_XPATH` / `JS_SELECT_TRIGGER_BY_XPATH`；`TaskList.mark_done` 按 xpath 消歧同名 label；xpath fill/select 从 `_replay.py` 抽到 `_js_snippets.py` 供助手与回放共用。legacy 轨迹无 xpath 时仍走 label 回退。
  影响范围：run_form_assistant、live replay fill/select。
  文件：scripts/actions/_form.py, scripts/actions/_js_snippets.py, scripts/actions/_replay.py, scripts/characterization/characterize-form-assistant.py, scripts/characterization/characterize-xpath-fill-select.py
  Python 同步提示：无（scripts 子进程）。

- 2026-08-07: AI 录制阶段结果 **`prior_outcome.success` 缺省改为未知（`null`）**，不再把「未收到明确 done(success)」当成成功。`phase_done` 无 outcome 时 Python 显式发 `success: null`；控制面仅在 `true`/`false` 时写入成败，文案走「未知」。
  影响范围：录制生命周期 prior 注入、session `phase_done`。
  文件：src/services/trajectory-record-lifecycle.js, scripts/session_runner.py
  Python 同步提示：对齐 prior_outcome.success 三态（true/false/null）；勿再 `?? true` / `!== false`。

- 2026-08-06: AI 录制 step instruction 增加 **`all_phases`**（当前录制集全量阶段 id/序号/标题/描述）与 **`prior_outcome`**（上一阶段一句结果）；不再依赖 prior 0–2 段全文注入执行 Agent。
  影响范围：录制生命周期 → Python session instruction。
  文件：src/services/trajectory-record-lifecycle.js, src/executor-session-client.js, executor/session-handler.js
  Python 同步提示：session step 消费 `all_phases` / `prior_outcome`（经 executor `session.step` 中继转发）；执行 Agent 用短目录，评审器用全文 description。

- 2026-08-06: 组件库列表展示 **入库人**（`created_by`，暂可空串显示「—」）；`special_element` 同步预留 `updated_by`。
  影响范围：schema、列表 UI。
  文件：migrations/20260806123000_library_created_by.js, schemas/init.sql, src/dao/operation-component-dao.js, src/models/entities.js
  Python 同步提示：对齐 `operation_component.created_by`、`special_element.created_by/updated_by`。

- 2026-08-06: 特殊元素库保留筛选：**入库说明 / 步骤说明 / 入库人**（与系统/模块/功能/入库时间并存）；后端支持 `keyword`/`stepDesc`/`createdBy`。
  影响范围：特殊元素列表 API、Vue UI。
  文件：src/dao/special-element-dao.js, src/services/special-element-service.js, src/dashboard/api-docs/catalog.js
  Python 同步提示：对齐 special-elements list 的 stepDesc/createdBy 查询参数。

- 2026-08-06: 组件库列表筛选对齐：`GET /api/v2/operation-components` 与 `GET /api/v2/special-elements` 支持 **systemId / moduleId / functionId** 三级联查 + **startTime/endTime**（按 created_at 入库时间）。moduleId 展开下属功能；functionId 优先。
  影响范围：列表 API 查询参数、api-docs、Vue UI资产库两 Tab。
  文件：src/dao/operation-component-dao.js, src/services/operation-component-service.js, src/dao/special-element-dao.js, src/services/special-element-service.js, src/dashboard/api-docs/catalog.js
  Python 同步提示：对齐 list 查询参数 moduleId/functionId/startTime/endTime。

### Added

- 2026-08-06: **操作步骤原子化组件库 Phase 1（沉淀）**：新建 `operation_component` / `operation_component_occurrence`；`trajectory_phase.component_id` 预留列（业务不写）。v2 API：`/api/v2/operation-components`（list/get/create/patch/confirm/deprecate/delete）+ `POST .../mine`（按 systemId/functionId/trajectoryIds 扫轨迹三表，签名含 label_text 等稳定语义；已存在组件只加 occurrence 不改文案）。api-docs 归入分组 **「组件库管理」**（`id: component-library`）。本阶段不碰 login、不接录制/回放引用。
  影响范围：MySQL schema、v2 API、api-docs。
  文件：migrations/20260806120000_operation_component.js, migrations/20260806120100_trajectory_phase_component_id.js, schemas/init.sql, src/dao/operation-component-dao.js, src/dao/operation-component-occurrence-dao.js, src/services/operation-component-signature.js, src/services/operation-component-service.js, src/services/operation-component-mine-service.js, src/routes/v2/operation-component.js, src/routes/v2/__init__.js, src/dashboard/api-docs/catalog.js, src/models/entities.js, src/models/constants.js, scripts/prompts/component-mine-prompt.md, scripts/characterization/characterize-operation-component.mjs
  Python 同步提示：对齐新表 schema + `/api/v2/operation-components*`；`trajectory_phase.component_id` 可空预留；mine/CRUD 语义见 CHANGELOG。

### Fixed

- 2026-08-09: **`dialog:unnamed` / `drawer:unnamed` 表单结构校验误报 `container_not_found`。** 录制对无标题弹窗写入哨兵 `unnamed`；`verifyFormStructure` 原先按字面标题匹配「unnamed」找不到容器，引入弹窗后紧接着的结构检查点失败。现改为匹配空 title/aria 的可见 overlay。
  影响范围：`steps/replay` Type B `save_form_snapshot`、assembled CTRL verify。
  文件：src/ctrl-actions/structure.js, scripts/controller/actions/js_snippets/misc.py, scripts/characterization/characterize-verify-form-structure.mjs
  Python 同步提示：无（scripts 子进程 + CTRL；Python 控制面无对等逻辑）。

- 2026-08-09: **T10-P0: unsafe form-structure checkpoint fails step but continues replay batch (A2).** `handleFormStructureCheckpoint` unsafe/`container_not_found` returns `aborted: false`; `replay-batch-runner` continues on `!ok && !aborted` (records `failedStepIds`, no batch abort). Transport timeout / heal fail / userAbort still `aborted: true`; no snapshot mutate on unsafe.
  影响范围：`steps/replay` Type B checkpoint、WS `replay:step` failed 语义。
  文件：src/services/trajectory/form-structure-heal.js, src/services/trajectory/replay-batch-runner.js, scripts/characterization/characterize-form-snapshot-trigger.mjs
  Python 同步提示：无

- 2026-08-08: **录制 `element.xpath_smart` 与写入 `params.xpath_smart` 对齐：** `_capture_element` 改为 `JS_CAPTURE_FROM_XPATH` 从写入命中节点取 `xpath_full`，不再调用 `JS_SMART_LOCATOR` 覆盖为 form-item xpath；fill/select/date/radio/round 写路径传入 `resolved.xpath_smart`。
  影响范围：录制 element 快照、xpath-primary 写路径。
  文件：scripts/actions/_js_snippets.py, scripts/actions/_form.py, scripts/characterization/characterize-capture-element-xpath.py
  Python 同步提示：无。

- 2026-08-08: **阶段运行时加固（section 记忆、空 act 缓冲与处方、done 闸门收窄、质量可观测）：** `remember_phase_section` / `resolve_phase_section` 记忆与推断当前区块；`click_save` 先读 `_phase_section` 再 `refresh_scan_buttons` + `unique_button_section` 消歧。`submit.required` 在 `max(8, est+2)` 之上再 `+3` 空 act 缓冲（est=4→11）；`recorder` 检测空/无效 `act={}` 注入合法 `NEXT_ACTION`（末步仅 `done`、已保存则 `done(success=true)`、否则 scoped `click_save`）。`done()` 在 `refill=all_editable` 时经 `resolve_phase_section` 收窄 pending 写闸门，不再被其他折叠块挡住。阶段结束写 stderr `QUALITY FAIL` 并在 `phase_end` 事件附带 `quality_failed` / `quality_failed_reasons`。
  影响范围：录制 Agent 步数预算、空 act 恢复、scoped 保存/done 闸门、阶段结束可观测性。
  文件：scripts/actions/_section_scope.py, scripts/actions/_form.py, scripts/actions/_phase_reviewer.py, scripts/actions/_phase_intent.py, scripts/recorder.py, scripts/session_runner.py, scripts/characterization/characterize-phase-runtime.py, scripts/characterization/characterize-phase-reviewer.py
  Python 同步提示：无（scripts 子进程）。

- 2026-08-08: **`ok-save-no-feedback` 视为保存成功：** 已点击保存且无校验错误/错误 toast/跳转时，记 `_last_save_ok` + success token，并提示立刻 `done`（适配被测系统区块保存无「操作成功」提示）。同步 agent/recorder 文案，避免机械重试。
  影响范围：录制 click_save 成功判定、agent prompts。
  文件：scripts/actions/_form.py, scripts/recorder.py, scripts/prompts/agent-tools-form.md, scripts/prompts/agent-core.md, scripts/characterization/characterize-phase-section-scope.py
  Python 同步提示：无（scripts 子进程）。

- 2026-08-08: **`click_save` 自动补 section 后未传入 JS：** `unique_button_section` 已写入 `sec`，但 `JS_CLICK_SAVE_BUTTON` 仍用空的入参 `section`，多「保存」时误报 `err-save-ambiguous`（日志：auto section=系统评级结论 后仍 section=''）。改为传 `sec`。
  影响范围：录制阶段 scoped 保存。
  文件：scripts/actions/_form.py, scripts/characterization/characterize-phase-section-scope.py
  Python 同步提示：无（scripts 子进程）。

- 2026-08-08: **`submit.required` 阶段 `max_steps` 下限 8：** 在 `estimated_steps+2` 强制截断之外，需保存/提交的阶段至少 8 步，避免乐观估算（如 est=4→6）叠空 `act={}` 后饿死 `click_save`。
  影响范围：录制 Agent 步数上限。
  文件：scripts/actions/_phase_reviewer.py, scripts/prompts/phase-reviewer-prompt.md, scripts/characterization/characterize-phase-reviewer.py
  Python 同步提示：无（scripts 子进程）。

- 2026-08-08: **阶段评审器步数强制截断保留，buffer 1→2：** `estimated_steps + 2`（1 步留给 browser-use done-only 末步，1 步留给保存/终检）；评审器 prompt 要求估算含「终检 + 保存/提交」。避免过小预算吞掉 `click_save`/暂存，同时仍用估算控阶段漂移。
  影响范围：录制 Agent 步数上限、评审器 prompt。
  文件：scripts/actions/_phase_reviewer.py, scripts/session_runner.py, scripts/prompts/phase-reviewer-prompt.md, scripts/characterization/characterize-phase-reviewer.py
  Python 同步提示：无（scripts 子进程）。

- 2026-08-08: **`click_save` 漏传 section 时唯一「保存」自动补区块：** pending 跨多块且 `section=` 为空时，若 `_scan_buttons` 中匹配按钮只属于一个 `section_title`/`section_id`，自动用该区块做写闸门与点击（日志 `[click_save] auto section=`）；多「保存」仍 `err-section-required`。`NEXT_ACTION` / agent-prompt 改为带 `section=`，不再暗示「无 ambiguous 就裸 click_save」。
  影响范围：录制阶段保存闸门、pending 提示、agent-prompt。
  文件：scripts/actions/_section_scope.py, scripts/actions/_form.py, scripts/prompts/agent-prompt.md, scripts/characterization/characterize-phase-section-scope.py
  Python 同步提示：无（scripts 子进程）。

- 2026-08-08: **`force_refill` 重建 TaskItem 丢失 section_* 打成假 `__root__`：** 已有值字段在 `from_scan(force_refill=True)` 手工重建时未拷贝 `section_id`/`section_title`，`pending_by_section` 误报 `__root__`，放大 `err-section-required`。现三处 TaskItem 构造均保留扫描区块元数据。
  影响范围：force_refill 任务列表、section 闸门。
  文件：scripts/models/task.py, scripts/characterization/characterize-phase-section-scope.py
  Python 同步提示：无（scripts 子进程）。

- 2026-08-07: **表单助手表格内 el-select 不填**（实锤：评级等级测算 input 能填、下拉 pending 残留；`select_option`/`JS_SELECT_TRIGGER_BY_XPATH` 对表格控件返回 `field-disabled`）。根因：xpath 开下拉把 `input.readOnly` 当禁用，而 Element UI 可编辑 select 的 trigger 常为 readOnly；无 `.el-form-item` 时又无法 label 回退。现：xpath trigger **不再**因 readOnly 拒绝（与 `JS_FIELD_DISABLED` 约定一致）。
  影响范围：Agent `run_form_assistant` / `select_option`、live replay 的 xpath 开下拉。
  文件：scripts/actions/_js_snippets.py, scripts/characterization/characterize-xpath-fill-select.py
  Python 同步提示：无（scripts 子进程）。

- 2026-08-07: **el-table 页面表单助手仅扫到少量 `.el-form-item` 字段**（实锤：评级等级测算 ~40 个可编辑表格单元格不可见，仅 3 项进入 pending）。根因：扫描仅 form-item-centric。现 control-first 扫描 + el-table Source B + xpath 去重；同名控件（如不同折叠区两个「保存」）靠 xpath 区分，不靠 displayName 合并。
  影响范围：表单助手扫描与批量填写。
  文件：scripts/actions/_js_snippets.py, scripts/models/field.py, scripts/models/task.py, scripts/models/form_snapshot.py, scripts/actions/_form.py
  Python 同步提示：无（scripts 子进程）。**未修复**：`click_save` 多「保存」按钮仍只点第一个；主 Agent 全页 DOM 仍为 Future TODO（见 spec）。

- 2026-08-07: **`close_dialog` 关不了 el-drawer**（轨迹 36 回归）。根因：`el-dialog__close` icon class 被误判为 dialog 容器，xpath_smart 只挂 dialog；live replay 死磕 xpath 失败也不回退控制器。现：`detectContainerKind` 不再把 `el-dialog__*` 当容器；close 默认 `overlay`（dialog+message-box+drawer）；replay xpath 失败则 CTRL/controller 回退。
  影响范围：CDP/录制定位、live steps/replay。
  文件：src/cdp/locator-candidates.js, scripts/actions/_locator_helpers_js.py, scripts/actions/_replay.py
  Python 同步提示：无（scripts 子进程 + CDP 辅助；控制面 API 不变）。

- 2026-08-06: **表单结构 Type B 护栏**：expected/actual 数量崩塌或 missing 过半（错容器扫描特征）时检查点失败，禁止删 missing 步骤、禁止改 form_snapshot；与 `container_not_found` 同路径。
  影响范围：live steps/replay Type B。
  文件：src/services/trajectory-session-replay.js, src/dashboard/api-docs/catalog.js
  Python 同步提示：对齐 Type B「unsafe diff 不删步/不改快照」语义。

- 2026-08-06: **表单结构校验按录制 container 选根**（实锤：main 检查点在抽屉仍开时用 getContainer 扫到抽屉 6 字段 → Type B 误删主表步骤）。`verifyFormStructure(fields, containerId)` / live `_replay_verify_form_structure` 传入 `main|drawer:…|dialog:…`；`main` 排除可见 overlay 内字段；容器找不到返回 `error:container_not_found` 且 Type B 不删步/不改 snapshot。
  影响范围：live steps/replay Type B、assemble 注入的 FORM-CHECK、CTRL.verifyFormStructure。
  文件：src/ctrl-actions.js, scripts/actions/_js_snippets.py, scripts/actions/_replay.py, scripts/script_assembler.py, src/services/trajectory-session-replay.js, src/dashboard/api-docs/catalog.js
  Python 同步提示：若镜像 verifyFormStructure / steps replay Type B，对齐按 container 选根与 container_not_found 失败语义。

- 2026-08-06: **action_log_sync 单条 entry 后处理抛错导致整批循环中断、录制步骤永久卡死**（实锤：交易 35 阶段 2 在 trajectory_step 第 118 行后不再前进，Python `_ACTION_LOG` 已到 337 条且 `done(success=true)`）。根因：`appendRecordedStep` 成功后 `flushPendingStepScreenshot` / `broadcast` 无 try/catch，异常冲出 `for (const entry of entries)` 循环，后续 entry 全部跳过；下一条全量快照在同一位置再次中断。修复：① 单条 entry 处理（含截图 flush / broadcast）包 try/catch 并打 `[record] action_log_sync entry failed` 日志，循环继续；② `resolvePhaseIdForPersist` 返回 `{ id, phaseNumber }` 消除 phase 重复查询；③ `trajectory_step.action_id` 列 + `(trajectory_id, action_id)` 唯一索引，`appendRecordedStep` 插入前查重（`ER_DUP_ENTRY` 兜底），控制面重启后 DB 级幂等。
  影响范围：录制落库管道（action_log_sync）、MySQL schema、appendRecordedStep。
  文件：src/services/trajectory-record-lifecycle.js, src/services/trajectory-persist-service.js, src/models/helpers.js, src/dao/trajectory-step-dao.js, migrations/20260806130000_trajectory_step_action_id.js, schemas/init.sql, scripts/smoke/smoke-trajectory-step-idempotent.mjs
  Python 同步提示：`trajectory_step` 新增可空列 `action_id VARCHAR(64)` + 唯一索引 `uk_traj_action (trajectory_id, action_id)`；Python 控制面（`d:\dev\ui-auto-recording-agent-python`）若镜像该表 schema 需同步加列与索引。NULL 不受唯一约束（历史行及 manual/cdp/special_element 来源保持 NULL）。

- 2026-08-06: **force_refill 重扫把本会话刚填字段打回 pending 导致整表重复填 3 遍**（实锤：交易 35 122 字段表单 337 条 auto-fill；法定代表人引入弹窗关闭后 stale 容器重扫 + agent 请求不存在字段「婚姻状况」触发未知 label 重扫）。根因：`TaskList.from_scan(force_refill=True)` 无差别把 DOM 有值字段打回 pending，值生成无缓存每次随机不同。修复：① `session_filled_labels` 豁免本会话已填字段；② `_task_done_impl` 记录 `_autofilled_labels` / `_generated_value_cache`；③ `_execute_round` 经 `commandValue` 复用缓存值；④ `_auto_fill_pending` 兜底过滤。
  影响范围：表单填写 agent（录制新增场景 auto-fill 状态机）
  文件：scripts/models/task.py, scripts/actions/_form.py, scripts/characterization/characterize-phase-intent.py
  Python 同步提示：无强 schema 变更；纯 agent 运行时状态机逻辑，Python 控制面若有独立镜像的表单填写状态机可参考同步。

- 2026-08-06: **click_save 非白名单 toast 被静默丢弃后误判失败**（实锤：交易 35 保存成功 toast「已提交创建！保存的客户，客户状态为【信贷正式客户】」无「成功」关键词，agent 连续点击保存 3 次）。toast 分类改为 fail 优先、其余默认 success；无 toast/校验/跳转反馈时降级为 `_ok` 提示 agent 自行二次确认，不再机械重试。
  影响范围：表单填写 agent（click_save 判定）
  文件：scripts/actions/_form.py, scripts/actions/_js_snippets.py, scripts/characterization/characterize-save-toast.mjs
  Python 同步提示：无强 schema 变更；纯 agent 运行时逻辑，Python 控制面若有独立镜像的 click_save 判定逻辑可参考同步。

- 2026-08-05: **导航阶段被【业务数据】误判为 form_fill 导致越界**（实锤：阶段「点击客户管理…抵达对公客户管理页面」却继续新增/保存/引入）。根因：每阶段挂业务数据 boilerplate 含「填写」，且「引入」关键值污染 classify；`抵达…页面` 未进 open_page 规则。修复：① classify/boundary/intent **先剥离【业务数据】**；② **仅填表/修改/引入**阶段注入业务数据（analyze append + record/start + Python hint）；③ open_page 支持「抵达/到达」。
  影响范围：阶段边界、录制注入、analyze phase 附文。
  文件：scripts/actions/_phase_context.py, _phase_boundary.py, _phase_intent.py, scripts/session_runner.py, src/services/trajectory-meta-service.js, src/services/trajectory-record-lifecycle.js
  Python 同步提示：对齐「业务数据仅填表/引入阶段注入；分类忽略业务数据后缀」。

- 2026-08-05: 案例数据注入链路二次修复（实锤：交易 35 重录后模型仍未拿到案例数据——phase 描述无【业务场景案例数据】块、case_data_entry 0 条、preamble 无【预设案例数据】）：① **恢复 `prepareCaseDataInjection` 调用**（V2.2 停用注释残留 `const caseData = null`，函数实现此前已恢复但调用点未恢复，案例数据从未注入）；② **task 兜底解析**：case_data_entry 为空时从 `trajectory.task` 的「关键数据」段规则解析（`extractCaseEntriesFromRequirement`）→ 落库 case_data_entry + 摄取 memory_fact（requirement/authoritative）→ 注入 Python store。不依赖前端透传 analyze caseEntries（外部 Vue 仓库未透传，Node 侧兜底保证权威值可达模型）。端到端验证：交易 35 task → `{"法定责任人引入":"朱桂武"}` 注入 + 落库 + 摄取全过。
  影响范围：录制注入链路（startTrajectoryRecording 的 case_data 准备）。
  文件：src/services/trajectory-record-lifecycle.js
  Python 同步提示：无强 schema；Python 控制面如镜像录制，可对齐「task 关键数据段 → 案例 KV 注入」语义。

- 2026-08-05: 案例数据「引入」类解析 + 注入链路修复（实锤：交易 35 需求"法定责任人引入 朱桂武"无冒号分隔，KV 解析不出 → 模型在客户放大镜反复用主表单值"测试科技发展有限公司"查询致循环）：① `extractCaseEntriesFromRequirement` 支持无冒号「引入」类格式（`法定责任人引入 朱桂武` / `引入 朱桂武` → KV）；② 修复 analyze 返回 `caseEntries` 误传 raw 文本块（`normalizeCaseEntries` 对非数组返回 []，P1 落库/摄取实际未生效）——改为 KV 数组；③ 恢复 `prepareCaseDataInjection`：case_data_entry KV 注入 Python store → preamble【预设案例数据】hint 生效，放大镜查询/填表优先权威值。
  影响范围：analyze API 返回、轨迹创建/录制注入、案例数据解析。
  文件：src/services/trajectory-meta-service.js, src/services/trajectory-record-lifecycle.js
  Python 同步提示：无强 schema；Python 控制面如镜像 analyze，可对齐「引入」类 KV 解析与 case_data 注入语义。

- 2026-08-05: 录制事件断线静默丢失（实锤：交易 35 只录到 step 127，Python `_ACTION_LOG` 已到 251——控制面/WS 断线后 executor `ws.send` 在 `readyState!==OPEN` 时 return false 静默丢弃，Python 子进程继续执行，后续动作/截图/phase_done 全部丢失，前端只显示到"实际控制企业证件号码"）。修复：① executor ws-client **断线缓冲**（`send` 断线入队，上限 32MB，溢出丢最旧+告警），重连注册成功后**按序重放**（`flushPending`）；② **断线超时看门狗**（`EXECUTOR_DISCONNECT_TIMEOUT_MS` 默认 30s，可配）：超时未恢复 → 杀全部 Python 会话（`killTree`）——宁可明确失败，不静默丢数据；重连成功即清除看门狗。覆盖短暂断线（缓冲重放，数据不丢）与长断线/控制面重启（杀会话，明确失败）两个场景。
  影响范围：executor 进程（ws-client / agent / config）。
  文件：executor/ws-client.js, executor/agent.mjs, executor/config.js, config/.env.example
  Python 同步提示：无（executor Node 侧）。

- 2026-08-06: **WS 半开连接静默丢事件完整修复**（实锤场景：100+ 表单项长阶段内表单填写助手一次 LLM 批量生成（`_llm_values.py` invoke）数十秒无 stdout → WS 空闲被 NAT/LB 静默掐断，executor `readyState` 仍 OPEN，事件进内核黑洞——不发送成功、不进断线缓冲、无任何报错；表单助手填表动作无法入库）。三层修复：
  ① **executor 主动侦测半开**：`EXECUTOR_HEARTBEAT_ACK_TIMEOUT_MS`（默认 40000 = 2×心跳间隔）未收到 `executor.heartbeat.ack` → console.error 明确报错 + `ws.terminate()` 强制触发 close → 复用断线缓冲/看门狗/重连路径，事件不再进黑洞；
  ② **服务端心跳加速 + 断线可见**：`src/executor-ws.js` ping 周期 30s → 10s（感知窗口缩到 ~10–20s），pong 缺失 terminate 时输出 `[executor-ws] half-open detected, terminated <nodeUuid>`（此前静默）；
  ③ **重连后快照补拉（恢复断线窗口数据）**：executor 重连注册成功后若断过线，对全部活跃 session 触发 `get_action_log`；`relayAgentEvent` 把 `get_action_log_result`（_ACTION_LOG 全量快照）同时以 `action_log_sync` 上送，控制面 `trajectory-record-lifecycle` 的 `persistedActionIds` 幂等消费**自动补写缺失步骤、不重复**；并发 `action_resync` 事件 → 控制面旁路落 `memory_event(connection_resync)` 审计（sessionId 自动关联 trajectory_id）。
  ④ **表单批量占位事件（源头缓解）**：`AI_FORM_BATCH_HEARTBEAT`（默认 on）——`_llm_values.py` 批量生成前发 `form_batch_started`、成功/异常两路径发 `form_batch_done`，LLM 长调用期间事件流不再静默。
  影响范围：executor 进程、控制面 WS、Python 表单值生成；无 schema 变更、无新依赖。
  文件：executor/ws-client.js, executor/agent.mjs, executor/config.js, executor/session-handler.js, executor/.env.example, src/executor-ws.js, scripts/actions/_llm_values.py, scripts/feature_flags.py, config/.env.example, scripts/smoke/smoke-executor-halfopen.mjs（新）, scripts/smoke/smoke-resync-log.mjs（新）
  Python 同步提示：对齐 `AI_FORM_BATCH_HEARTBEAT` 开关与 form_batch_started/done 事件（若 Python 控制面镜像表单助手）；executor/WS 侧为 Node 独有。

### Added

- 2026-08-06: 记忆 **P2-4 多模型对比报告**：`GET /api/v2/memory/compare?trajectoryIds=1,2,3` 对已录制交易汇总步骤数 / 成功状态 / 审计通过率 / 填表值一致性。formValues 仅 `source∈{llm,page,rule,agent,observer}`；consistency 用 entity **并集**分母（缺字段=不一致）；全部缺失 404、≥1 条 200、<2 条 `consistency=null`。无 token 字段（用 passRate + isSuccessful 代理）。烟测 `smoke-memory-compare.mjs` 19/19。
  影响范围：记忆 API / api-docs；不写库、不改 schema。
  文件：src/memory/memory-dao.js, src/memory/memory-service.js, src/routes/v2/memory.js, src/dashboard/api-docs/catalog.js, scripts/smoke/smoke-memory-compare.mjs
  Python 同步提示：对齐 `GET /api/v2/memory/compare` 响应契约（trajectories + consistency + missingIds）。

- 2026-08-05: 记忆 **P2-2 跨交易复用**：`POST /api/v2/memory/retrieve` 接受 `functionId`；`AI_MEMORY_HISTORY=true` 时，并入同 `function_id` 历史成功交易（`is_successful=1`，排除本交易，取最近 5 条）的当前版本事实——标记 `source=history, stance=inferred, weight×0.5`，排序自然靠后，**绝不覆盖本交易 requirement 事实**、不参与冲突 supersede。`protocol.js` 新增 `history` 到 FACT/EVENT sources；`weight-engine` 基准 0.4；`config` 新增 `AI_MEMORY_HISTORY`（默认 false）。录制链路 `trajectory-record-lifecycle` 传 `trajRow.functionId`。烟测：`scripts/smoke/smoke-memory-history.mjs`（子进程验证开关三态，12/12）。
  影响范围：Fact Pack 检索 / 录制阶段注入；向后兼容（不传 functionId 或开关关闭时行为不变）。
  文件：src/memory/protocol.js, src/memory/weight-engine.js, src/memory/memory-dao.js, src/memory/memory-service.js, src/routes/v2/memory.js, src/services/trajectory-record-lifecycle.js, config/config.js, config/.env.example, src/dashboard/api-docs/catalog.js, scripts/smoke/smoke-memory-history.mjs
  Python 同步提示：无 schema；对齐 retrieve 接受 functionId + AI_MEMORY_HISTORY 开关。

- 2026-08-05: 记忆 **P2-1 审计产品化**：① 决策覆盖扩展——`scenario_summary` LLM 摘要写 `decision_record`；回放自愈（healType step/form_structure）发起时记 `decisionType:'heal'`（确定性指令模板，model 留空）；**agent_step 决策不做**。② 决策详情回填——`GET /api/v2/memory/decisions/:id` 新增 `inputFacts`（按 `inputFactIds` 查 `memory_fact`，含被 supersede 版本）；`memory-service.ingestEvents` 在决策与事实同事件上报且未传 `inputFactIds` 时自动回填同事件事实 id。③ 审计汇总——`GET /api/v2/memory/audit/summary` 新增 `topReferencedFacts`（仅按 trajectoryId 聚合 Top10）。④ api-docs 补齐缺失的 memory 分组及新字段示例。
  影响范围：记忆决策 API / 审计汇总 / api-docs；外部 Vue 审计页据此渲染。
  文件：scripts/actions/_scenario_describer.py, src/services/trajectory-session-replay.js, src/memory/memory-dao.js, src/memory/memory-service.js, src/dashboard/api-docs/catalog.js
  Python 同步提示：无强 schema；对齐 decisions/:id 响应新增 inputFacts、audit/summary 新增 topReferencedFacts；decision 未传 inputFactIds 时自动回填同事件 facts。

- 2026-08-05: 新建 **system_ref_data / system_ref_entry**（方案 C：旧 `case_data` / `case_data_entry` 保留并标 legacy）。专存目标系统回写、经校验可复用的填表参考值（`source` / `verification_status`）；用户需求**业务数据**仍走 `trajectory.task`【业务数据】块，**禁止**把 analyze/`caseEntries` 写入 system_ref。本迭代提供 CRUD API 地基，录制暂不自动注入 system_ref。
  影响范围：MySQL schema、v2 API、api-docs。
  文件：migrations/20260805220000_system_ref_data.js, schemas/init.sql, src/dao/system-ref-dao.js, src/services/system-ref-service.js, src/routes/v2/system-ref-data.js, src/routes/v2/__init__.js, src/dashboard/api-docs/catalog.js, src/models/entities.js
  Python 同步提示：对齐新表 schema + `/api/v2/system-ref-data`、`/api/v2/trajectories/:id/system-ref-entries`；业务数据与系统参考值用语勿混。

- 2026-08-05: 记忆 P1 收尾：① **权重引擎完整版**（weight-engine.js）：时间衰减 `recencyFactor`（半衰期默认 1h，检索时动态计算）+ 冲突惩罚（superseded ×0.6）+ `computeWeight` 完整公式；摄取时**冲突版本化**——同 (trajectory, entity, attribute) 新值取代旧值：旧值 `superseded_by` + `disputed`（审计保留），新值 `version=旧.version+1`；检索按 `effectiveWeight`（存储权重×衰减）排序，Fact Pack 带出有效权重（Python fact_pack 同步读取）。② **action 打点 + `fill_before_save` 建模**：`writer.emit_memory_event` 支持 `facts` 参数；recorder 每步上报 `action` 事件（填写动作 label → `filled` 事实）；`phase_done` 补 `outcome` 事实；Node 摄取 phase_done 时对同阶段 filled 字段 × outcome 建 `fill_before_save` 关系（strength 1.0）。
  影响范围：记忆摄取（冲突/关系建模）、检索排序、Python agent 打点。
  文件：src/memory/weight-engine.js, src/memory/memory-dao.js, src/memory/memory-service.js, src/memory/fact-pack.js, src/memory/protocol.js, scripts/memory/writer.py, scripts/memory/fact_pack.py, scripts/recorder.py
  Python 同步提示：无强 schema；Python 控制面如镜像摄取，对齐冲突版本化（superseded_by/disputed/version）与 fill_before_save 关系语义。

- 2026-08-05: 记忆 P1——**analyze 结构化案例数据摄取**：`analyzeRequirementToPhases` 恢复返回结构化 KV（`caseEntries`，复用已有 `extractCaseDataBlock` 规则解析，非 LLM 拆解）；`createTransactionWithPhases` / `setTrajectoryCaseEntries` 落 case_data_entry 后同步摄取 `memory_fact`——`source=requirement`（新加入 EVENT/FACT_SOURCES）、`stance=authoritative`、权重 1.5（base 1.0 × stance 1.5），不可被 LLM 覆盖；空值/空白 label 过滤（与 extractCaseDataBlock 对齐）。配合已就位的事实包注入，模型填表优先采用需求里的权威值。
  影响范围：analyze API 返回（新增 caseEntries 非空）、轨迹创建/案例数据更新、记忆摄取、事实包内容。
  文件：src/services/trajectory-meta-service.js, src/memory/memory-service.js, src/memory/protocol.js
  Python 同步提示：无强 schema；Python 控制面如镜像 analyze，可对齐「案例数据 → 权威事实」语义（requirement/authoritative）。

- 2026-08-05: 记忆 P1 全量第一块：① **ContextCompiler v1**（`scripts/context_compiler.py`）：消息窗口裁剪逻辑从 `patch_message_manager` 内联抽取，每次裁剪产出结构化丢弃明细（index/role/preview），随 `context_drop` 事件上报（dropped_items），丢弃可见可审计；`AI_MEMORY_MAX_RECENT` 可配（默认 16 保持旧行为），compiler 异常回退旧内联逻辑。② **表单值决策记录**：`_llm_values.py` LLM 生成（成功/异常两条路径）写 `decision_record(form_value)`——记录模型、温度、输入字段、prompt 预览、输出 actions、parse 策略校验、audit_status；`writer.emit_memory_event` 扩展 `decision` 字段透传。回答「这个测试值是谁、依据什么生成的」。
  影响范围：Python agent 上下文管理 + 表单值生成、记忆摄取（决策类型 form_value 已有）。
  文件：scripts/context_compiler.py（新增）, scripts/agent_utils.py, scripts/actions/_llm_values.py, scripts/memory/writer.py
  Python 同步提示：无强 schema；Python 控制面如镜像决策摄取，事件内嵌 decision 对象即可落 decision_record。

- 2026-08-05: 记忆 P1 最小切片——**事实包注入**（`AI_MEMORY_FACT_PACK` 默认关，opt-in）：phase 开始前 Node 按 trajectory_id 检索 `memory_fact`（`retrieveFactPack`，含 P0 无归属 NULL 阶段事实），随 step 指令透传 `fact_pack` + `trajectory_id`（lifecycle → forwardStdin → session-handler → Python）；Python 在 preamble 后追加【记忆事实包】块（`scripts/memory/fact_pack.py` 格式化，权威值/已保存值带 stance/source/weight），替代「靠 MAX_RECENT 截断记忆猜」。另修复 `case_saved` 事件补传 `phase_number`（否则事实包按阶段检索不到），`listFacts` 放宽为「匹配阶段或 NULL」。
  影响范围：AI 录制链路（Node step 指令 + Python preamble）、记忆检索、feature flag、api-docs 无变更。
  文件：src/services/trajectory-record-lifecycle.js, src/executor-session-client.js, executor/session-handler.js, src/memory/memory-dao.js, scripts/session_runner.py, scripts/actions/_case_data.py, scripts/memory/fact_pack.py
  Python 同步提示：无强 schema；Python 控制面如镜像录制链路，step 指令需透传 trajectory_id / fact_pack，事件上报带 phase_number。

### Changed

- 2026-08-05: 步骤日志改为**每步一行紧凑格式**：`[step N] done=yes/no stopped=yes/no | goal=…(≤100字) | act=…(≤200字) | res=…(≤120字) err=…`——统一前缀可 grep，goal/actions/result 全截断防刷屏（此前 `[on_step_end]/[next_goal]/[actions]/[last_result]` 四行无前缀输出，`get_page_state` 长 JSON 每次全量刷屏）。完整 tool 结果仍在模型上下文内，日志侧只留关键信号。
  影响范围：Python agent stderr 日志。
  文件：scripts/recorder.py
  Python 同步提示：无（仅 JS-gen scripts）。

- 2026-08-05: 移除 `recorder.py` on_step_start 的逐步 `[on_step_start] n_steps=N` 冗余日志（每步刷屏，无信息增量；on_step_end 的状态日志与 5 步节流的 `[recorder] step N done` 保留）。
  影响范围：Python agent stderr 日志。
  文件：scripts/recorder.py
  Python 同步提示：无（仅 JS-gen scripts）。

- 2026-08-05: 文档修订：Codex × 浏览器 MCP 集成计划（v1.1）对内驱动由 chrome-devtools-mcp 改为 **Playwright MCP 为主**（`--cdp-endpoint` 附着现有 CDP 端口、a11y 快照、`browser_run_code` 执行现有 CTRL helpers、testing 断言做边界证据），chrome-devtools-mcp 降级为可选深度诊断；新增三个产品痛点（弹窗循环 / 任务边界漂移 / 人工辅助依赖）的方案归属——前两者主战场在记忆系统 P1 + 阶段边界合约，驱动层只提供确定性快照与断言证据。灰度测试开发计划同步更新（开关 `AI_MCP_PLAYWRIGHT_URL` / `AI_MCP_PLAYWRIGHT_CAPS`、`AGENT_DRIVER=playwright-mcp|browser-use`、P1 任务与矩阵）。
  影响范围：设计文档（未改动代码）。
  文件：docs/JS-gen学习Codex与ChromeDevTools集成计划.md, docs/JS-gen灰度测试开发计划.md
  Python 同步提示：无（纯文档）。Playwright MCP 接入后 Python 侧 session_runner 的 CDP 端口分配不变，agent 驱动切换在 Node 侧。

### Fixed

- 2026-08-05: 明确区分 **业务数据** vs **案例数据**：前者是用户需求里要使用的关键/场景说明（相对结构化 NL，容忍偏差，原文给 AI 判断）；后者是系统回写、由本项目落库的录制产物（`save_case_data` / form snapshot / case_data 表）。历史符号 `case_data_block` 等常承载业务数据，注释已标明勿混用。同步将 agent 提示头 /api-docs 改为【业务数据】。
  影响范围：设计口径 / agent preamble /api-docs / 工程师注释。
  文件：src/services/trajectory-record-lifecycle.js, src/services/trajectory-meta-service.js, scripts/actions/_case_data.py, scripts/session_runner.py, scripts/prompts/agent-prompt.md, src/dashboard/api-docs/catalog.js
  Python 同步提示：对齐「业务数据=用户需求；案例数据=系统回写」用语，避免文档/接口混称。

- 2026-08-05: 案例数据改为**原文提示给 AI 自行判断**，不再用 fieldKey↔表单 label 硬匹配驱动 autofill/`match_form_rule`（修复「法定责任人引入 朱桂武」注入后放大镜仍查主表「客户名称」的错配）。record/start 抽取 `case_data_block` 写入 phase instruction + Python `_case_scenario_text`；KV 仍可选透传供 `read_case_data`。设计前提：用户需求里的关键数据多为相对结构化表述（如「引入 / 法定责任人引入 朱桂武」），无法也不应要求严格 KV，需容忍措辞偏差——已在 lifecycle / `_case_data.py` / meta-service 注释写明。
  影响范围：录制注入、agent preamble、autofill。
  文件：src/services/trajectory-record-lifecycle.js, src/executor-session-client.js, executor/session-handler.js, scripts/actions/_case_data.py, scripts/actions/_form.py, scripts/session_runner.py, src/services/trajectory-meta-service.js
  Python 同步提示：step 指令可透传 case_data_block；勿再依赖 label 硬匹配灌值。

- 2026-08-05: 人工录制开/关：执行机未连接时 `forwardStdin` 改为明确 503；`manual_record_status` ack 等待 8s 后乐观回落，避免 HTTP 长时间挂起。Vue 侧 `manual-record` / `record/stop` / `detach` / `stream/detach` 显式加长超时。
  影响范围：manual-record API、产品前端录制超时。
  文件：src/services/trajectory-record-lifecycle.js（Vue 在 ui-auto-recording-agent-vue-master）
  Python 同步提示：可选对齐 manual-record ack 短等+乐观回落（无强 schema）。

- 2026-08-05: 记忆系统 P0 摄取层两处数据 bug（冒烟脚本实测暴露）：① `normalizeDecision` 的 `policyChecks` / `outputJson` / `finalAction` 未显式序列化——mysql2 会把数组参数展开为多值，`decision_record` 插入报 `Column count doesn't match value count`；现统一 `toJsonString` 序列化。② 多行 `INSERT` 仅返回单 insertId——`insertFacts` 返回值长度被当作事实计数（少计）且 `co_occur` 关系因 `ids[1]=undefined` 静默丢失；新增 `factIdsByEvent` 按 event_id 回查真实 id，关系建模基于真实 id。新增冒烟脚本 `scripts/smoke/smoke-memory-ingest.mjs`（摄取→检索→审计→统计→清理，23 项断言全过）。
  影响范围：记忆系统摄取（Node service/dao）、冒烟验证。
  文件：src/memory/memory-service.js, src/memory/memory-dao.js, scripts/smoke/smoke-memory-ingest.mjs
  Python 同步提示：无强 schema；Python 控制面如镜像决策摄取，注意 policy_checks 等 JSON 列需序列化后传输。

- 2026-08-05: `select_option` check 模式在 label 未匹配时无条件取**第一个可见 select** 的当前值（常是分页器 `10条/页`），误导模型跳过真实字段（自愈日志实锤：`ok-already:10条/页`）。现 fallback 仅认可 placeholder 或所属 form-item label 关联目标 label 的 select，否则返回 `not-found` → 走 `label-not-found` 报错。修复自愈链路 `select_option 模型名称/first` 错配为分页器。
  影响范围：Python agent 表单动作（select_option / check / replay fallback）。
  文件：scripts/actions/_js_snippets.py
  Python 同步提示：无（仅 JS-gen scripts 内嵌 JS 片段）。

- 2026-08-05: 无进展循环止损（自愈日志实锤：`get_page_state` 连发 3 次空转至 max_steps 后需人工）。`recorder.py` 指纹映射新增只读动作（`get_page_state` / `check_field_value` / `scan_form_fields` / `get_pending_tasks`），heal 模式新增「连续 ≥3 次相同只读动作 → 停止」检测（原 heal 分支完全跳过周期检测）。非 heal 模式的只读动作循环亦可被 cycle detect 捕获。
  影响范围：Python 录制/自愈止损。
  文件：scripts/recorder.py
  Python 同步提示：无（仅 JS-gen scripts）。

- 2026-08-05: `close_dialog` 回放幂等化：录制语义为「确保弹窗关闭」，回放时若前置动作（确定/下一步）已关掉弹窗/抽屉/message-box，不再报 `click-failed:not-found` 触发无效自愈，直接返回 `ok (no visible dialog/drawer — already closed)`。可见性检测用 offsetParent + getBoundingClientRect 兜底（对齐固定定位 drawer）。
  影响范围：live replay（scripts）。
  文件：scripts/actions/_replay.py
  Python 同步提示：无（仅 JS-gen scripts）。

- 2026-08-05: 记忆系统 P0 阻断项修复：`scripts/session_runner.py` 中 `from scripts.memory.writer import (` 首行丢失导致 IndentationError，且 `configure_memory_writer(session_id=session_id, …)` 在 `session_id` 赋值前调用（运行期 NameError）。现导入语句完整、`session_id` 先赋值再 configure；`recorder.py` 501 行 f-string 为单行无语法问题。Python 侧 9 个记忆相关文件 AST 全部通过，writer/store/fact_pack/feature_flags 导入验证通过。
  影响范围：Python agent 记忆旁路（P0，只写不读）。
  文件：scripts/session_runner.py
  Python 同步提示：无（仅 JS-gen scripts）。


- 2026-08-05: 「客户名称搜索为…，点击下一步」误判为 query（强制点查询收口）；现含「下一步/上一步」时退出 query，boundary `role=navigate` + 向导 hint；表单动词（新增/填写/修改…）优先于 wizard 关键词，向导表单步仍按 maintain 录制。
  影响范围：scripts 阶段分类 / agent preamble。
  文件：scripts/actions/_phase_context.py, scripts/actions/_phase_boundary.py, scripts/session_runner.py
  Python 同步提示：无（仅 Python 子进程 scripts）。

- 2026-08-05: 「点击评级申请。预期结果：打开…页面」类阶段此前为 `other` 无收口 cue，AI 打开页面后继续把弹窗流程走完；现识别为 boundary `role=navigate`（goal `open_page`）+【打开页面/导航】hint：页面/弹窗出现即 done，禁止在新页面内继续操作；agent-prompt 任务类型表与完成规则同步。
  影响范围：scripts 阶段分类 / agent preamble / agent prompt。
  文件：scripts/actions/_phase_context.py, scripts/actions/_phase_boundary.py, scripts/prompts/agent-prompt.md
  Python 同步提示：无（仅 Python 子进程 scripts）。

### Changed

- 2026-08-05: 稳健相对 xpath：录制生成不再写 dialog `[last()]`；树节点剥 `(n)`/`[V-x]` + 可选 parent_text；图标优先 `el-icon-*` class（tip 文案入 params）；无 label 时 placeholder 锚点。回放侧对旧 `[last()]` 改解析为最后可见 dialog/drawer，树/按钮全去空格匹配，图标 class+tooltip。
  影响范围：locator-candidates / inspect / live replay（scripts）/ api-docs 合同文案。
  文件：src/cdp/locator-candidates.js, src/cdp/inspect.js, scripts/actions/_replay.py, scripts/actions/_js_snippets.py, scripts/actions/_locator_helpers_js.py, src/dashboard/api-docs/catalog.js
  Python 同步提示：无强 schema；若 Python 控制面有 xpath_smart 生成/回放，对齐可见 dialog、树剥后缀、图标 class+tip、placeholder 兜底。

### Added

- 2026-08-05: AI 录制 **阶段边界合约**（`AI_PHASE_BOUNDARY` 默认 on，opt-out）：role/goals/证据收口替代散落 if；混合「新增+完成引入」须引入证据+保存证据；picker 确认写 `picker_closed` 并父 container `_form_stale` 重扫；`_task_lists_by_container` 按 `JS_IDENTIFY_CONTAINER` 分存；录制 `events[]` / SSE 含 `phase_boundary_obs`。
  影响范围：scripts 录制语义、record-lifecycle events、api-docs、feature flag。
  文件：scripts/actions/_phase_boundary.py, scripts/actions/_phase_intent.py, scripts/actions/_form.py, scripts/actions/_misc.py, scripts/feature_flags.py, scripts/session_runner.py, src/services/trajectory-record-lifecycle.js, src/dashboard/api-docs/catalog.js
  Python 同步提示：无强 schema；可选对齐 AI_PHASE_BOUNDARY 与 phase_boundary_obs 事件（不入 MySQL）。

- 2026-08-05: P1 干预通道清理：移除 `request_intervention` / `intervention_needed` SSE 与 STDIN `intervene` 映射；prompt 改为特殊元素 + `click_adjacent_button` + 人工录制；browser-session 转发 `phase_intent_obs` / `phase_boundary_obs`；case_data 跳过键对齐 phase 内部状态。
  影响范围：工程 session SSE、executor stdin 映射、case_data 持久化过滤、element locator 豁免表。
  文件：src/routes/browser-session/session-message.js, src/services/case-data-service.js, src/models/element.js, src/executor-session-client.js, scripts/prompts/*, scripts/actions/_scenario_describer.py
  Python 同步提示：不再发送/处理 `session.intervene` stdin；SSE 移除 intervention_* 事件；可选订阅 phase_intent_obs / phase_boundary_obs。

### Fixed

- 2026-08-05: create 阶段内客户放大镜「确认」死锁：`use-click-save` 禁索引确认，同时 `click_save(确认)` 被 query-toolbar 判为 not-form-save。现 picker UI 允许索引确认；query UI 上 `click_save(确认/确定)` 走引入确认；auto-fill 对 disabled+button 优先特殊元素/引入而非先 click_save。
  影响范围：Python agent actions（_misc / _form / _phase_intent）。
  文件：scripts/actions/_misc.py, scripts/actions/_form.py, scripts/actions/_phase_intent.py
  Python 同步提示：无（scripts 不迁）。

- 2026-08-04: 录制 `session.step` 透传丢弃 `special_element_candidates` / `prior_phases`，导致 agent 日志 `special_element_candidates loaded: 0`（库内已有「对公客户引入流程」仍无法 `use_special_element`）。`forwardStdin` + executor `session.step` 现完整转发。
  影响范围：executor WS 载荷、录制 step 注入。
  文件：src/executor-session-client.js, executor/session-handler.js, src/services/trajectory-record-lifecycle.js
  Python 同步提示：对齐 session.step 可选字段 specialElementCandidates、priorPhases（蛇形 special_element_candidates / prior_phases 亦可）。

- 2026-08-04: 阶段意图合约将「新增…如果出现引入按钮…」误判为 `introduce_pick`（`force_refill_all=False`）；现 create/modify 优先，纯引入阶段仍为 `introduce_pick`。另：`_query_ui` 不再跨弹窗粘性（放大镜关闭后可再 `click_save`）。特殊元素搜索归一「法定责任人/代表人」并加强引入语义加权。
  影响范围：Python agent 合约 / form 查询栏检测；搜索评分（控制面）。
  文件：scripts/actions/_phase_intent.py, scripts/actions/_form.py, scripts/actions/_phase_context.py, src/services/special-element-search-service.js, scripts/characterization/*
  Python 同步提示：无强 schema；若 Python 控制面有同名合约编译，对齐 introduce 不覆盖 create 的优先级。

### Added

- 2026-08-04: WS `remote:input` 文档化；`kind:'text'` 支持可选 `replace:true`（选中 activeElement 后 insertText，空 text 清空）。便于 SPA 透明 input IME 透传（中文 composition 在本机完成，确认后下发 text；控制键仍走 kind:key）。
  影响范围：WS 契约、CDP bridge（local + executor）、api-docs。
  文件：src/cdp/remote-bridge.js, executor/bib-bridge.js, src/dashboard/api-docs/catalog.js
  Python 同步提示：对齐 remote:input payload.replace；文档约定 IME 在 SPA 完成；控制面透传语义不变。

- 2026-08-04: `POST /api/v2/trajectories/:id/steps/replay/stop` — 用户可中断进行中的 steps/replay 自愈（Type A/B）；WS `replay:finished` 增加 `aborted`/`reason`（主动停止时 `error:null`）。
  影响范围：route、service（session-replay）、runtime flag、WS 契约、api-docs。
  文件：src/routes/v2/trajectory.js, src/services/trajectory-session-replay.js, src/services/trajectory-runtime.js, src/services/trajectory-recording-service.js, src/services/trajectory-service.js, src/dashboard/api-docs/catalog.js
  Python 同步提示：对齐新路由 POST .../steps/replay/stop；WS replay:finished 增加 aborted/reason 字段。

- 2026-08-04: 表单结构变化自愈（Type B）：`form_snapshot.trigger_step_id` 绑定 checkpoint `trajectory_step`；live 录制双写；`steps/replay` 遇 `save_form_snapshot` 校验结构并删 missing / 结构化插入 adding；WS `replay:form_structure` + `healType`。
  影响范围：schema、service（persist / session-replay / step）、WS 契约、api-docs。
  文件：migrations/20260804010000_form_snapshot_trigger_step.js, schemas/init.sql, src/dao/form-snapshot-dao.js, src/services/trajectory-persist-service.js, src/services/trajectory-session-replay.js, src/services/trajectory-step-service.js, src/routes/browser-session/heal-instruction.js, src/dashboard/api-docs/catalog.js
  Python 同步提示：同步 sql/init.sql 增加 form_snapshot.trigger_step_id（FK CASCADE UNIQUE）并将 trajectory_id 改为 ON DELETE CASCADE；对齐 WS replay:form_structure 与 healType 字段。

### Fixed

- 2026-08-04: 执行机 agent 在 `ready` 前崩溃后 slot 变成幽灵占用（`sessionId` 未清，下一次落到更高 slot）。现失败 open / process_exit 回收槽位，`_findFreeSlot` 也会回收无活进程的 ghost。
  影响范围：executor slot 生命周期。
  文件：executor/session-slot.js, executor/session-manager.js
  Python 同步提示：无（执行机本地；控制面 lease 本就不 confirm 未 ready 的会话）。

- 2026-08-04: BiB 默认视口/推流改为 **1600×900 / quality≈65**（相对 1080p 更流畅，相对 720p 显示更全）；去掉编码强制抬到 1080p，编码跟视口走（上限仍 1920×1080）；Chrome 不自动最大化。
  影响范围：executor bib-bridge、local remote-bridge、remote-session 默认值、prepare attach、session_runner 窗口、api-docs。
  文件：executor/bib-bridge.js, src/cdp/remote-bridge.js, src/services/remote-session-service.js, src/services/trajectory-attach-service.js, scripts/session_runner.py, src/dashboard/api-docs/catalog.js
  Python 同步提示：无（执行机/控制面推流默认；产品画布自适应显示不变）。

- 2026-08-04: `record/prepare` 在无在线执行机时改为 **409** + 中文 `无可用执行资源（没有在线执行机）` + `holders`（与槽位已满同形），避免英文 500 `No executor agent online` 导致前端无法提示。
  影响范围：executor 选节点、api-docs。
  文件：src/executor-slot-lease.js, src/executor-session-client.js, src/dashboard/api-docs/catalog.js
  Python 同步提示：对齐 prepare 无执行机时 409 与中文 message（与无槽位同形）。

- 2026-08-04: 修复 `trajectory.remote_session_id` 脏指针导致「2 个浏览器却显示多笔占用」：挂载时互斥清掉其他交易的同 rs FK；stream detach / close 扫清所有指向该 rs 的交易（live→draft）；启动时 reconcile 修复历史脏数据。
  影响范围：service（remote-session、trajectory-attach、idle-reaper）、dao、server 启动对账。
  文件：src/dao/trajectory-dao.js, src/services/remote-session-service.js, src/services/trajectory-attach-service.js, src/services/trajectory-idle-reaper.js, src/executor-ws.js, server.mjs
  Python 同步提示：无（控制面绑定语义；列表占用以 remote_session.status+trajectory_id 为准）。

- 2026-08-03: 同一 trajectory 重复 `record/prepare` 或控制面重启后，可能残留多条 `active` 的 `remote_session`，`trajectory.remote_session_id` 与 BiB 实际推流 UUID 不一致导致前端黑屏。
  影响范围：service（remote-session、trajectory-attach）、executor-ws 启动恢复。
  文件：src/dao/remote-session-dao.js, src/services/remote-session-service.js, src/services/trajectory-attach-service.js, src/executor-ws.js
  Python 同步提示：无（逻辑在 JS-gen 控制面/执行机桥接层）。
- 2026-08-04: 黑屏修复收紧：`supersede` 仅关闭非当前 agentSession/非 keepId 脏行；prepare 在 session 不匹配时强制 re-attach（不再沿用已关闭的 runtime.remoteSessionId）；`getLiveStatus` 优先 runtime.sessionId 一致的 attached binding 并回写 FK；执行机重连关闭同 traj 旧 active 行。
  影响范围：service（remote-session、trajectory-attach）、executor-ws。
  文件：src/services/remote-session-service.js, src/services/trajectory-attach-service.js, src/executor-ws.js
  Python 同步提示：无。

### Changed

- 2026-08-04: 案例数据 V2.2 口径落地：analyze 将「关键数据/案例数据」原文附到每个 phase（不拆 caseEntries）；`caseEntries` 仍可 POST/PATCH 入库但不注入录制；录制填表靠 phase 文本 + agent prompt 优先对齐场景值，autofill 继续随机补其余字段；报文捞取仅文档占位。
  影响范围：analyze、record/start 注入、api-docs、agent prompt。
  文件：src/services/trajectory-meta-service.js, src/services/trajectory-record-lifecycle.js, src/routes/v2/trajectory.js, src/dashboard/api-docs/catalog.js, scripts/prompts/agent-prompt.md
  Python 同步提示：对齐 agent-prompt 中【业务场景案例数据】优先规则；勿再依赖 record/start 注入 case_data。

- 2026-08-03: `trajectory_step.confirmed` 语义重定义：DEFAULT 0→1，注释"人工确认"→"回放确认"。
  影响范围：schema（DEFAULT + COMMENT）、Python 端 trajectory_step domain。
  文件：migrations/20260803110000_trajectory_step_confirmed_replay.js, migrations/20260803111500_trajectory_step_confirmed_comment.js
  Python 同步提示：更新 sql/init.sql trajectory_step.confirmed DEFAULT 1 + 注释；更新 uara/trajectory/domain/trajectory_step.py 注释 + default=1。


### Removed

- 2026-08-15: **废弃组装回放栈下线**：删除 `src/routes/v2/replay.js`（5 个 REST 端点 + WS `replay:start`）与 `src/services/replay-service.js`；`/api/test/assemble`、`/api/test/run` 与产品 live `/steps/replay`（`_replay.py`）保持不变。api-docs 同步删除已弃用 replay 组与 `replay:status/step/screenshot/result/done` 事件（保留 `replay:form_structure`）。
  影响范围：`/api/v2/trajectories/:id/replay/*`、`/api/v2/replays/:replayId` 与 WS `replay:start` 已移除。
  文件：src/routes/v2/replay.js（删除）, src/services/replay-service.js（删除）, src/routes/v2/__init__.js, server.mjs, src/dashboard/api-docs/groups/recording.js, websocket.js, app.js, scripts/smoke/accept-engineering-apis.mjs（新增）, scripts/refactor/verify-all.sh
  Python 同步提示：Python 控制面若有 `/api/v2/replay/*` 组装回放调用需同步移除；live `/steps/replay` 协议不变。

## 条目格式约定

每次修改本项目必追加到 `[Unreleased]` 区段（发版时再剪切到 `[x.y.z] - YYYY-MM-DD`）：

- 一级分类：`Added` / `Changed` / `Deprecated` / `Removed` / `Fixed` / `Security`
- 条目：`- YYYY-MM-DD: <简述>` + 换行 + `  影响范围：<schema/service/controller/WS/scripts/config>` + 换行 + `  文件：<相对路径列表>` + 换行 + `  Python 同步提示：<如适用，说明 Python 端需如何跟进>`

## 强制规则

本项目与 `d:\dev\ui-auto-recording-agent-python`（Python FastAPI 控制面）并行开发。Python 端对齐 JS-gen 的 schema / 接口 / WS 协议。

**涉及以下变更时必须写 CHANGELOG**：

- `migrations/` 新增或修改迁移（schema 变更）
- `src/routes/` 端点新增/删除/改路径/改响应格式
- `src/services/` 业务逻辑变更（影响 Python 对齐语义）
- `server.mjs` WebSocket 协议变更
- `config/` 配置项变更

仅改 `scripts/`（Python 子进程）可不写 CHANGELOG（Python 不迁 scripts）。
