# Heal-Locate 现状调研（Current Analysis）

- **日期**：2026-08-15
- **状态**：H0 收尾完成；作为 Phase 1 MVP 的实现依据
- **上游计划**：
  - `docs/superpowers/plans/2026-08-15-heal-locate-handoff-plan.md`（执行口径）
  - `docs/superpowers/plans/2026-08-14-heal-locate-phase0-current-analysis-plan.md`（底稿）
  - `docs/superpowers/plans/2026-08-14-heal-locate-phase1-design.md`（底稿）
- **调研方式**：只读代码与文档；未运行任何真实浏览器实验。

---

## 1. 调用链（重构后路径，2026-08-15 已核对）

```
POST /api/v2/trajectories/:id/steps/replay
  → src/services/trajectory/trajectory-session-replay.js
      prepareReplayBatch(): DB rows → action entries（含 element/xpath_smart/xpath_full）
  → src/services/trajectory/replay-batch-runner.js  runReplayBatch()
      - 每步 forwardStdin({ event:'replay_actions', data:{ actions:[entry] } })
      - Type A fail → buildStepHealInstruction() → runHealStep(runtime, instruction, 12, 'step')
      - Type B save_form_snapshot → handleFormStructureCheckpoint()
  → src/services/trajectory/replay-heal-shared.js  runHealStep()
      - forwardStdin({ event:'step', data:{ instruction, max_steps, phase_number, heal_type, healType } })
  → src/executor-session-client.js  forwardStdin()（session.step 白名单映射）
  → executor/session-handler.js  session.step → manager.forward('step', instruction 对象)
  → executor/session-slot.js  writeEvent() → Python stdin JSON
  → scripts/session_runner.py → scripts/agent/service.py _run_agent_step()
      - detect_heal_mode(instruction, agent_task)
      - apply_heal_mode(case_data_ref, heal_mode)
      - contract = get_phase_intent(...)  # heal 时当前实际为 None
      - build_agent_system_message(contract)  # None → full fallback
      - browser_use.Agent(override_system_message=...)

Type B 表单结构自愈：
  → src/services/trajectory/form-structure-heal.js
      - verifyFormStructure 差异 → 删除 missing 步骤 → buildFormStructureHealInstruction(report)
      - runHealStep(runtime, instruction, FORM_STRUCTURE_HEAL_MAX_STEPS, 'form_structure')
      - 成功后 insertStepsAfter() 写入新增字段步骤
```

### 1.1 关键事实表

| 事实 | 位置 |
|---|---|
| `runHealStep` 定义与 forward 载荷 | `src/services/trajectory/replay-heal-shared.js:47-139` |
| Type A instruction 模板 | `src/routes/browser-session/heal-instruction.js:12-34` |
| Type B instruction 模板 | `src/routes/browser-session/heal-instruction.js:43-77` |
| Type A 调用点（失败分类后） | `src/services/trajectory/replay-batch-runner.js:238-274` |
| Type B 调用点 | `src/services/trajectory/form-structure-heal.js:325-344` |
| Python `replay_actions` 分发 | `scripts/event_dispatch.py:206-243` |
| Python replay 统一结果判定 | `scripts/controller/actions/_replay.py:111-137` |
| absent-field 判定 | `scripts/controller/actions/_helpers.py:199-213` |
| Python heal 检测 | `scripts/controller/actions/phase/prompts.py:136-150` |
| Python heal 状态写入 | `scripts/controller/actions/phase/prompts.py:153-173` |
| Python Agent heal 分支 | `scripts/agent/service.py:146-182`、`scripts/agent/service.py:415-426` |
| System message 装配 | `scripts/agent_utils.py:87-118` |
| `session.step` 控制面白名单 | `src/executor-session-client.js:298-318` |
| `session.step` 执行机白名单 | `executor/session-handler.js:68-86` |

---

## 2. H0.1 失败信号盘点

扫描范围：`scripts/controller/actions/**/*.py`。表中次数为字符串字面量出现次数（按源文件统计）。

| error 模式 | 来源模块（出现次数） |
|---|---|
| `label-not-found` | `_helpers.py:4`、`_replay.py:2`、`autofill_round.py:3`、`form_action_engines.py:9`、`js_snippets/fill_core.py:1`、`js_snippets/scan_form.py:1`、`js_snippets/select_tree.py:2`、`js_snippets/select_trigger.py:1`、`replay_form_action.py:1` |
| `xpath-not-found` | `autofill_round.py:3`、`form_action_engines.py:2`、`form_autofill.py:1`、`form_scan_utils.py:2`、`js_snippets/fill_core.py:1`、`js_snippets/fill_date.py:3`、`js_snippets/select_trigger.py:1`、`replay_js.py:1` |
| `option-not-found` | `autofill_round.py:1`、`form_action_engines.py:1`、`js_snippets/fill_date.py:2`、`js_snippets/select_option.py:1`、`js_snippets/select_tree.py:2`、`js_snippets/select_trigger.py:1`、`replay_form_action.py:2` |
| `no-items` | `autofill_round.py:3`、`form_action_engines.py:5`、`js_snippets/select_option.py:2`、`replay_form_action.py:11` |
| `select-disabled` / `field-disabled` / `*-disabled` | `form_action_engines.py`、`js_snippets/select_trigger.py`、`js_snippets/select_tree.py`、`_form.py` 等（见 grep 结果） |
| `readonly` / `read-only` | `_form.py:4`、`form_action_engines.py:1`、`form_scan_utils.py:1`、`js_snippets/base.py:3`、`js_snippets/fill_core.py:8`、`js_snippets/select_trigger.py:2`、`replay_js.py:1`、`scan_summary.py:18` |
| `loading` / `timeout` | 广泛分布在 `replay_wait.py`、`replay_form_action.py`、`_misc.py`、`autofill_pending.py`、`form_action_engines.py` |
| `err-login` | `form_action_engines.py:111` |
| `err-xpath-smart-required` | `form_action_engines.py:168` |
| `err-section-required` 等 `err-*` | `_form.py:8`、`form_action_engines.py:2`、`phase/reviewer.py:1` |
| `networkidle` | `_replay.py:2`（go_to_url 的等待策略） |
| `page-idle` / `no-visible` / `no-permission` / `unauthorized` | 当前 Python 返回串中**未发现**；D3 保留为防御性枚举，等待未来信号 |
| `absent-skip`（`ok-skip:label-not-found`） | `_helpers.py:211-213`、`replay_form_action.py:127-132/171-177` |

### 2.1 进入 Node Type A 的实际失败串

`_result_ok()` 判定失败且 `stop_on_fail=true` 时进入 `replay-batch-runner` 的 Type A。常见候选：

- `xpath-not-found`
- `option-not-found:...`
- `no-items`
- `false_ok:expected=...,actual=...`
- `click-failed...` / `not-found`
- `error:*`（含异常消息）
- `err-login | ...`
- `unknown-action:*`
- `bad_option_text:*` / `option-mismatch:*` / `option-not-synced:*`

`label-not-found` 与 `ok-skip:label-not-found` 被 `is_absent_field_result()` 判定为成功，**不会**进入 Type A（见 §3）。

---

## 3. H0.2 触发条件矩阵

| 失败信号 | 当前策略 | 进入 Type A heal？ | 备注 |
|---|---|---|---|
| `ok` / `ok-*` | 成功 | 否 | — |
| `label-not-found`（表单动作） | `absent_field_skip_result()` → `ok-skip:...` | **否** | `_result_ok` 把 absent-field 视为 ok |
| `ok-skip:label-not-found` | 成功跳过 | **否** | `should_record_result` 不写轨迹步骤 |
| `xpath-not-found` | 失败 | 是 | 通常触发 Type A heal |
| `option-not-found:*` | 失败 | 是 | 触发 Type A heal |
| `no-items` | 失败 | 是 | select 重置后仍失败则进入 Type A |
| `select-disabled` / `*-disabled` | 失败 | 是 | 属于定位/状态失败 |
| `false_ok:*` | 失败 | 是 | 动作假成功（值不一致） |
| `click-failed*` / `not-found` | 失败 | 是 | 点击失败 |
| `err-login \| ...` | 失败 | 是 | 登录动作失败 |
| `error:*` | 失败 | 是 | 异常兜底 |
| Type B `container_not_found` | 失败（soft fail continue） | 否（Type B 非 heal） | `FORM_STRUCTURE_UNSAFE_CONTINUE` |
| Type B unsafe diff | 失败（soft fail continue） | 否 | `FORM_STRUCTURE_UNSAFE_CONTINUE` |
| Type B added fields | 需要 heal | 是（Type B heal） | `needsTypeB(report)` 为真 |

**关键结论**：MVP 规则表里的 `label-not-found → not_visible` 在 live replay 的表单动作路径上通常不会发生（被 absent-skip 提前吞掉），但它仍会出现在非表单动作、历史日志或未来关闭 absent-skip 的路径中，因此规则表保留该映射不冲突。

---

## 4. H0.3 Heal 上下文清单

### 4.1 Node Type A 当前可用信息

`runReplayBatch` 失败点（`replay-batch-runner.js:238`）实际可拿到：

| 字段 | 来源 | 当前是否传给了 heal |
|---|---|---|
| `entry.action` | `actions[i]` | 是（instruction） |
| `entry.params`（label/value/option/placeholder 等） | `actions[i]` | 是（instruction） |
| `entry.element.xpath_smart` / `xpath_full` / `candidates` | `actions[i]` | **否**（contract 补齐） |
| `entry.id` | `actions[i]` | 否（仅用于结果） |
| `failResult` | Python `row.result` 或 `result.error` | 是（instruction） |
| `stepNum` / `total` | 循环变量 | 否（context 可补齐） |
| 前序 steps `actions[0..i-1]` | `actions` 数组 | **否**，但低成本可得 |
| `runtime.trajectoryId/sessionId/executorNodeUuid` | `runtime` | 仅 `runHealStep` 使用 |
| 失败时页面快照/可见控件 | 无 | 否（非目标） |

### 4.2 Node Type B 当前可用信息

`form-structure-heal.js:325` 实际可拿到：

- `report`（已解析 JSON）：`error/container/count/expected_count/missing_required/missing_optional/added_required/added_optional/hasRequiredChange/hasOptionalChange/reordered/fields`
- `snap`（快照）、`entry`、`addingLabels`、`deletedIds`
- 当前仅把 `container + 四个 change 数组` 传给 instruction。

### 4.3 `errorResult` 类型归一化

- Node `failResult = row?.result || result?.error || 'unknown'`。
- Python replay 结果统一 `str()` 化，但 `result.error` 可能是 Node 侧拼装的字符串，也可能未来是对象。
- 结论：analyzer 入口必须归一化：`String(errorResult ?? '')`；若为对象，JSON.stringify 后匹配，避免规则引擎被类型问题击穿。

---

## 5. H0.4 Locator 能力矩阵

### 5.1 replay 阶段（Python 确定性回放）

| 能力 | 支持 | 来源 / 备注 |
|---|---|---|
| `xpath_smart` | ✅ 首选 | `_resolve_replay_xpath()`；`RELATIVE_XPATH_PRIMARY` 开启时用 `entry.element.xpath_smart`，否则 `xpath_full` |
| `xpath_full` / `xpath_abs` | ✅ 回退 | `_element_xpath_full()` |
| `label` 语义定位 | ✅ | `JS_FILL_FORM_FIELD` / `JS_FIND_LABELED_SELECT` / `JS_SELECT_TREE_OPTION` / `JS_CLICK_RADIO` |
| `placeholder` | ✅ | fill 时 label 未命中且 placeholder 存在；搜索框 label 可映射 placeholder |
| `text` 语义点击 | ✅ | 菜单/相邻按钮/表格行按钮通过 `text` 参数 + durable click |
| DOM scan | ⚠️ 间接 | replay 不做全页 scan；但 `save_form_snapshot` 用 `JS_VERIFY_FORM_STRUCTURE` 做结构 scan |
| `region` / 分区定位 | ⚠️ 部分 | `section_scope`、`container`（main/drawer:/dialog:）用于扫描与容器选择；replay 表单动作不显式传 region |
| a11y 快照 | ❌ | replay 确定性路径不使用 a11y 快照 |

### 5.2 heal 阶段（Agent 非确定性恢复）

| 能力 | 当前可用 | 缺口 |
|---|---|---|
| action + params 文本 | ✅ | 只有文本描述，无结构化 target |
| `xpath_smart` | ❌ | `buildStepHealInstruction` 未接收 `entry.element` |
| label/placeholder | ✅（文本里） | params 中的 label/value 在 instruction 内 |
| DOM scan | ⚠️ 工具在 full fallback 中 | heal 模式仍加载 form/table/tree packs，规则混杂 |
| region / container | ❌ | 无结构化传递 |
| 失败原因语义 | ❌ | 只有原始 error 字符串 |

**结论**：H1/H2 新增 `HealContract.target`（action/label/xpath_smart/option_text）和 `HealContract.reason`，可补齐 heal 阶段最需要的语义信息，而无需扩展 executor 传输协议。

---

## 6. H0.5 失败案例收集（仅文档证据，不跑真实浏览器）

| 案例来源 | 轨迹/步骤 | error | 根因 | 建议分类 |
|---|---|---|---|---|
| `docs/superpowers/archive/specs/2026-08-07-select-dropdown-lazy-load-design.md` | select 底部 option | `option-not-found:*` | 懒加载下拉未滚动加载完 | `not_loaded`（MVP 触发串为 `timeout/loading`，`option-not-found` 按优先级落 `not_visible`；P2 可细分） |
| `docs/superpowers/specs/2026-08-11-select-option-state-boundary-design.md` | `option-not-found` 后紧接同字段选择 | `no-items` | Element UI 下拉状态泄漏 | `not_visible`（建议 `heal`） |
| `scripts/controller/actions/_replay.py:130` 注释 | traj 130 step 23 | 错误 params.xpath_smart 指向编号字段 | 历史脏 params 优先错误 | `not_visible` |
| `docs/superpowers/plans/2026-08-13-hardcoded-prepare-login.md` | prepare/login | `label-not-found` 被 replay 当 skip-OK | 登录字段实际缺失，却被 absent-skip 吞掉 | `conditional_absent`（已有 skip） |
| `docs/superpowers/specs/2026-08-07-xpath-primary-control-ops-design.md:13` | 表格复合控件 | `label-not-found` | Agent 传短 label，scan 中是复合 label（如 `业务往来及使用\|指标值`） | `not_visible` |
| `docs/superpowers/archive/plans/2026-08-08-xpath-params-replay-audit-design.md:137` | 回放 | `xpath_miss:… / xpath-not-found / label-not-found` | locator 失效 | `not_visible` |
| `docs/superpowers/plans/2026-08-09-save-form-snapshot-replay-p0.md` | Type B | `container_not_found` / unsafe diff | 抽屉/主表单容器错配 | `changed_structure`（Type B 保留路径） |

---

## 7. 优化缺口（H0 结论）

1. 缺**失败原因语义分类层**：原始 error 直接进 instruction，无法区分 hidden/collapsed/wrong region/conditional absent。
2. 缺**结构化 HealContract**：Node 只发文本；Python `contract=None` → full fallback，heal 没有专用 prompt。
3. 缺 **prompt/runtime 分离**：instruction 文本把“怎么做”和“重试几次”混在一起。
4. `label-not-found` 的 absent-skip 语义存在**误吞风险**：非级联缺席的真实缺字段也会被当成 ok（已有 prepare/login 文档佐证），P2 需要与 D10 路由一起重评估。
5. `session.step` 在控制面与执行机各有一处白名单映射；新增字段必须两处同步 pass-through，否则 Python 收不到。

---

## 8. H0 对 H1/H2/H3 的直接影响

1. **前序 steps 可低成本获取**：`runReplayBatch` 内 `actions.slice(0, i)` 可用；MVP 只把 `previousAction` 放入 `context.evidence`，不扩大传输面。
2. **`errorResult` 必须归一化**：analyzer 首行 `String()` + 对象时 `JSON.stringify`。
3. **Type B report 字段确认**：除 handoff 列出的 `container/missing_required/added_required/missing_optional/added_optional` 外，还有 `error/count/expected_count/hasRequiredChange/hasOptionalChange/reordered/fields`；analyzer 只依赖前五个稳定字段。
4. **executor 无 schema 校验，但有两处白名单**：`src/executor-session-client.js` 与 `executor/session-handler.js` 都必须把 `heal_contract` 传给 Python；SessionManager 本身只透传 JSON，无需改动。
5. **`heal_type=step` 但实为 changed_structure 的历史案例未在文档中发现**；D3 优先级保持不变。

---

## 9. 最终规则表（同步自 handoff §D3，执行 H1 前已确认）

| 优先级 | category | 触发信号（或关系） | suggestedAction |
|---|---|---|---|
| 1 | `changed_structure` | `healType === 'form_structure'`，或 report `added_required/missing_required` 非空 | `repair` |
| 2 | `business_locked` | error 含 `disabled / read-only / readonly / no-permission / locked` | `skip` |
| 3 | `permission_blocked` | error 含 `403 / forbidden / unauthorized / 无权限` | `skip` |
| 4 | `conditional_absent` | `ok-skip:` / `label-not-found` 且 context 含 `absent_skip`，或已有 absent-skip 标记 | `skip` |
| 5 | `not_loaded` | error 含 `timeout / loading / page-idle / networkidle`，或 context.timeout | `retry` |
| 6 | `not_visible` | error 含 `label-not-found / xpath-not-found / option-not-found / no-items / not-found / no-visible`，且不命中更高优先级 | `heal` |
| 7 | `unknown` | 无匹配 | `fail` |

> 注意：handoff 原表 `not_visible` 未列 `no-items`。本 spec 从 H0.1 真实返回串补入 `no-items`，使 live replay 的 Type A 失败能被归类；`select-disabled / field-disabled / *-disabled` 按 D3 优先级先命中 `business_locked` 的 `disabled` 信号。characterization 以本表为准。
