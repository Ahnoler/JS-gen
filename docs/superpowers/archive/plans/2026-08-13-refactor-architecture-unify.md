# 架构统一重构计划（3 阶段）

- **日期**：2026-08-13
- **仓库**：D:\dev\JS-gen（分支 `uara_V1.2`，Windows + Git Bash）
- **交付对象**：deepseek harness（本文件为自包含执行指令，不依赖任何会话上下文）
- **范围**：① Python agent 单体拆分 ② services/dao 架构统一 ③ 废弃代码下线
- **明确不做**：CTRL 双实现统一（另行专项）、server.mjs 启动块提取（P2 未选）
- **用户已拍板**：`verify-all.sh` 直接扩充门禁；sys-msg 归位目标布局 = `src/services/sys-msg/` 子目录 + 常量下沉 `src/models/constants.js`；replay smoke 用新增 `accept-engineering-apis.mjs` 替代；`_wet_*` 探针末尾统一清理

---

## 0. 执行前必读（铁律）

1. 先读仓库 `AGENTS.md` 并遵守其 multi-agent 约定与 CHANGELOG 同步规则。
2. **每个重构微步结束跑 `bash scripts/refactor/verify-all.sh`**，全绿才进下一步；红则回滚该微步排查后再试。
3. 改 `src/` 文件必须同步 `CHANGELOG.md` 的 `[Unreleased]`（按仓库"条目格式约定"，含影响范围 + Python 同步提示）；仅改 `scripts/`（Python 子进程）免写。
4. 用 general-purpose 子智能体实现（prompt 自包含：文件路径+行号、允许/禁止清单、验证命令、报告格式；并行时文件集无交集）；子智能体不提交 git；主线程重跑关键验证、审查越界改动、负责 commit（**绝不 push**）。
5. 绝不创建/调度其他自动化或定时任务。
6. 最终报告必须如实：完成项、验证输出结论、推迟项、既有失败基线。

---

## 1. Phase 0 — 前置收敛 + 门禁扩充

1. **`git status` 检查点**：若 sys-msg 消息管理开发仍未提交（存在未提交的 `src/services/sys-msg-service.js`、`sys-msg-compose.js`、`src/dao/sys-msg-dao.js`、`migrations/20260813160000_sys_msg.js` 等），则**跳过 Phase 2b 与 3e**，并在最终报告注明"已推迟：消息管理未收敛"；其余阶段照做。
2. **门禁扩充**：`scripts/refactor/verify-all.sh` 现有 6 项之后追加（排除需真实浏览器的 wet/e2e 脚本）：

   ```
   characterize-scan-editable-summary.py
   characterize-scan-fullpage-p1.py
   characterize-phase-section-scope.py
   characterize-capture-element-xpath.py
   characterize-xpath-primary-ops.py
   characterize-xpath-fill-select.py
   characterize-region-section-alias.py
   characterize-phase-runtime.py
   characterize-select-option-substring.py
   characterize-close-dialog-replay.py
   characterize-cascade-three-round.py
   characterize-dialog-tasklist-scope.py
   characterize-container-naming.py
   characterize-field-value-match.py
   characterize-dual-save-section.py
   characterize-form-assistant.py
   characterize-introduce-query-fill.py
   characterize-select-state-boundary.py
   characterize-date-fill-merge.py
   characterize-replay-params-xpath.py
   characterize-tree-select-record.py
   characterize-inventory-memory.py
   characterize-control-ops-closed-loop.py
   characterize-case-data.py
   characterize-login-action.py
   characterize-assistant-mission-context.py
   characterize-scan-fullpage-p2.py
   characterize-form-snapshot-trigger.mjs
   characterize-sys-msg.mjs
   characterize-trajectory.mjs
   characterize-batch-import.mjs
   characterize-step-move.mjs
   ```

   先整体跑一遍建**绿基线**：个别失败且与本次重构无关的，记录为既有问题（不阻塞，但须列入最终报告）。

---

## 2. Phase 1 — Python agent 单体拆分（仅 `scripts/`，免 CHANGELOG）

**总模式**：遵循既有 facade 先例（`phase/`、`replay_js.py`、`codegen/actions.py`）：旧文件名保留为薄 facade re-export，调用方零改动。微步顺序从低风险到高风险：

- **1a 内联 JS 提取为 js_snippets 常量**（逐块迁移、逐块跑表征）：
  - `scripts/controller/actions/_form.py` L69-86、L104-113、L154-164、L830-856 各提为新常量；
  - `scripts/controller/actions/_replay.py` L408-453 `_JS_LOCATE_BY_XPATH` → 迁 `replay_js.py`；L932-944 → 提 `JS_COUNT_OVERLAYS`；
  - `scripts/controller/actions/form_autofill.py` L626-638、L737-752 提常量（含 `JS_GET_CONTAINER` 拼接块，按既有拼接写法）；
  - `scripts/controller/actions/form_scan_utils.py` L754-771 `_JS_READ_CERT_TYPE`、L772-793 `_JS_EXTRACT_ERROR_LABELS` → 迁 `js_snippets/scan_utils.py` 并原地 re-export（`_form.py:55`、`form_autofill.py:61` 依赖这些名字）。
- **1b `_replay.py` 拆分**：`_replay_form_action`(L463-798)→`replay_form_action.py`；`_replay_click_by_index`(L161-268)+`_post_click_settle`(L269-293)→`replay_click.py`；`_replay_table_row_radio`(L828-871)→`replay_table.py`。`_replay.py` 保留文件 + facade re-export；`replay_action_entries`(L872-1097) 留原位。
- **1c `form_scan_utils.py` 拆分**：摘要组(L353-612)→`scan_summary.py`；select 匹配组(L697-795)→`select_match.py`；task/submit 组(L928-1142)→`task_completion.py`。原文件保留 facade。
- **1d `form_autofill.py` 拆分**：`_execute_round`(L229-675)→`autofill_round.py`、`_auto_fill_pending`(L708-866)→`autofill_pending.py`，类内委托；原文件路径保留（8 个表征脚本 `read_text` 钉它）。
- **1e `_form.py` 引擎化（最后、风险最高）**：参照 `FormAutofillEngine` 先例，login/fill/select/radio/tree 成组提取引擎类，`_register_form_actions` 只做实例化+别名+注册。**必须保留函数名与 `@controller.action` 相对顺序**；或按 AGENTS.md 授权把钉点脚本改为多文件拼接（已有 7 个示范，如 `characterize-phase-section-scope.py`）。
  - 两个负向钉点勿把已删函数带回：`characterize-case-data.py:88`（`apply_case_presets_to_fields` 不得在 `_form.py`）、`characterize-capture-element-xpath.py:95`（`fill_date_field` 不得在 `_form.py`）。
  - `_form.py` 是 `form_scan_utils` 符号中转站（`characterize-assistant-mission-context.py:116` `import _dedupe_needs_agent from _form`），facade 须继续转发这些名字。

每微步验证：`python -m py_compile` 相关文件 + 相关表征脚本 + `verify-all.sh`。

---

## 3. Phase 2 — services/dao 架构统一（`src/`，CHANGELOG 必须）

- **2a trajectory-* 平铺归位**：`git mv` 9 个平铺文件入 `src/services/trajectory/`：

  ```
  trajectory-account-service.js
  trajectory-batch-excel.js
  trajectory-idle-reaper.js
  trajectory-phase-service.js
  trajectory-query-service.js
  trajectory-recording-service.js
  trajectory-runtime.js
  trajectory-step-move.js
  trajectory-step-service.js
  ```

  改 import：
  - facade `src/services/trajectory-service.js` 的 `:10`、`:20`、`:32`、`:52`、`:82` → `'./trajectory/...'`（`:43`、`:62` 不变）；
  - `src/services/trajectory/` 子目录内 13 处 `'../trajectory-*'` → `'./trajectory-*'`（含 `trajectory-recording-service.js` 内 3 处 `'./trajectory/...'` → `'./...'`）；
  - 顶层消费 9 处：`trajectory-step-service.js:8-9`、`trajectory-phase-service.js:9-10`、`special-element-service.js:16`、`session-lifecycle.js:22,153`、`remote-session-service.js:87,112,462`、`trajectory-idle-reaper.js:12` → `'../trajectory-service.js'`；
  - `src/routes/v2/trajectory-batch.js:6`、`server.mjs:117`、`src/cdp/remote-bridge/ws-router.js:10`；
  - 同步表征脚本路径：`characterize-trajectory.mjs:87,89,91`、`characterize-batch-import.mjs:16`、`characterize-step-move.mjs:6`、`characterize-session-lifecycle.mjs:99`、`characterize-meta-step-filter.mjs:38-39`、`characterize-batch-task-progress.mjs:20`、`characterize-phase-highlight-screenshot.mjs:192`。
  - **必须保持纯 re-export 转发不复制粘贴**（`characterize-trajectory.mjs:136-157` 函数恒等断言会抓复制）；facade 与 `trajectory/index.js` barrel 存在同名重叠导出（如 `stopTrajectoryRecording`），**不得合并二者**。
  - 收尾 `grep` 确认无 `'../trajectory-'` 残留。
- **2b sys-msg 归位**（前置：Phase 0 检查点通过，消息管理已提交）：
  - 6 个常量（`MSG_TYPE_BATCH_IMPORT`、`MSG_TITLE_BATCH_IMPORT`、`SOURCE_TYPE_BATCH_IMPORT`、`MSG_STATUS_UNREAD`、`MSG_STATUS_READ`、`DICT_TYPE_SYS_MSG`）从 `sys-msg-compose.js` 下沉到 `src/models/constants.js`（追加，同风格 `BATCH_*`）；
  - `sys-msg-service.js` 与 `sys-msg-compose.js` 移入 `src/services/sys-msg/` 子目录 + `index.js` barrel；
  - `src/dao/sys-msg-dao.js:3` 改从 constants 取常量（消除 dao→service 反向依赖）；
  - 同步消费方 `src/routes/v2/messages.js:1`、`src/services/trajectory/trajectory-batch-service.js:26` 与 `characterize-sys-msg.mjs` 的路径/import（compose 可保留常量转发 export 保兼容）。
- **2c CHANGELOG**：2a/2b 各追加 `[Unreleased]` 条目（services 组织变化；Python 同步提示注明纯路径移动不改接口语义）。

---

## 4. Phase 3 — 废弃代码下线（`src/` + `scripts/`，CHANGELOG 必须）

- **3a replay 栈下线**：删 `src/routes/v2/replay.js`（5 端点 + WS `replay:start`）、`src/services/replay-service.js`、`src/routes/v2/__init__.js` 中 `registerReplay` 注册行、`server.mjs:170` 启动日志行。
  - **保留**：`assemble-service.js`、`script-runner.js`、`ctrl-actions.js`、`models/element.js`（`/api/test/assemble`、`/api/test/run` 仍在用）；`scripts/controller/actions/_replay.py` 与 `/steps/replay` 产品 live 路径；`replay:form_structure` 事件。
- **3b api-docs 同步**：删 `src/dashboard/api-docs/groups/recording.js:358-405` 弃用组（保留 `:153-208` 的 `/steps/replay`）；`groups/websocket.js` 删 `replay:start` 发送说明与 `replay:status/step/screenshot/result/done` 事件文档（保留 `form_structure`）；`app.js:73` 文案同步。
- **3c smoke 替代**：删 `scripts/smoke/accept-replay-apis.mjs`；新增 `scripts/smoke/accept-engineering-apis.mjs`（import smoke：assemble-service、script-runner、ctrl-actions 能加载 + 关键导出 typeof 断言），替换 `verify-all.sh` 中 `accept-replay-apis` 条目。
- **3d 删 `scripts/controller/registry.py`**（零消费方死脚手架，删除前 grep 全仓确认）。
- **3e 探针统一清理**（前置：消息管理开发已结束且提交）：grep 全仓零引用后删 5 个 untracked `_wet_*.py`（`_wet_archive_region_probe`、`_wet_date_current_value`、`_wet_date_refill`、`_wet_task7_probe`、`_wet_traj33_phase2_replay`）+ 2 个 `wet-*.py`（`wet-traj-xpath-replay`、`wet-fullpage-p1-scan`）。
- **3f CHANGELOG**：端点删除 + 服务删除条目，注明 Python 端对齐（`/api/v2/replay/*` 组装回放端点下线，Python 控制面若有调用需同步移除）。

---

## 5. 终验与汇报

- 每阶段结束：`bash scripts/refactor/verify-all.sh` 全绿。
- Phase 2/3 后加跑：`node --check` 全量 `src/`、grep 残留检查（`'../trajectory-'`、`replay-service`、`_wet_`）。
- 最终报告：分阶段完成清单、验证输出结论、推迟项（sys-msg 未收敛时）、既有失败基线、CHANGELOG 条目清单。**不声称完成任何未验证项。**

---

## 6. 风险提示

- 27 个表征脚本钉 `_form.py` 路径（含 2 个负向钉点，见 1e）；`_form.py` 是 `form_scan_utils` 符号中转站，facade 须继续转发。
- `characterize-trajectory.mjs` 的函数恒等断言依赖纯 re-export 转发；facade 与 barrel 同名重叠导出不得合并。
- 分支上有其他 agent 并行开发消息管理，Phase 2b/3e 以"该工作已提交"为硬前置；执行代理的文件集必须与其无交集。
