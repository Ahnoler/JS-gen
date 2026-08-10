# Select option 状态边界闭环设计

**Status:** Approved  
**Date:** 2026-08-11  
**Scope:** 录制/回放 `select_option` 状态复位、单 select 约束、录制期 xpath 定向回退  
**Isolation:** 基于当前 `HEAD` 的独立 worktree 实施；不带入父工作树 table-row / first-stamp WIP

## 问题

新增客户录制出现以下稳定故障链：

1. 某次 `select_option` 返回 `option-not-found`。
2. 紧接着对同一字段选择有效项却返回 `no-items`。
3. Agent 改用自造的 `el-dialog` xpath，而实际容器是 `el-drawer`。
4. 显式错误 xpath 被直接使用，连续 `xpath-not-found`，最终耗尽步数并产生
   `pending_fields:证件类型` / `missing_success_token`。

复查确认：

- Browser Use 的 multi-action 是逐个 `await` 执行，并非并行。
- `JS_SELECT_OPTION` 成功时会自然关闭下拉并清理
  `window.__last_select_trigger`；`no-items` / `option-not-found` 失败出口不会清理。
- `_form.py` 当前通过 CSS 隐藏 popper 并调用 `document.body.click()`，无法保证
  Element UI 内部 `visible` 状态归零。
- Prompt 同时写着“仅页面不变化时才可多动作”和“每步可有 2～3 个 select”，契约冲突。
- `_resolve_control` 的“显式 hint 优先”是既有 xpath-primary 契约，不应全局改写。

首次 `option-not-found` 的目标值在日志中被截断，因此本设计不臆测其业务原因；
闭环目标是确保一次 miss 不污染后续动作。

## 目标

1. 每次 select 动作以确定的关闭状态开始，最终失败也以关闭状态结束。
2. 保留现有 `ok:*` / `no-items` / `option-not-found:*` 返回契约。
3. 模型传入的 xpath 实际 miss 时，仅回退到同 label 的唯一 scan xpath，一次为限。
4. Agent 每步最多调用一个 `select_option`。
5. 回放仍严格使用录制的具体 `option_text`，不从 `options[0]` 猜值。

## 非目标

- 不把“刘伟”等引入人名与企业证件号码做字段级业务校验。
- 不修改 `_resolve_control` 的全局 hint 优先语义。
- 不给回放增加 scan-xpath fallback；回放继续使用既有 params / element / label / full 层级。
- 不把父工作树未提交的 table-row select 或 first-stamp 改动混入独立实现提交。
- 不重构 `_form.py`；该工作由 `form-actions-split` 单独跟踪。

## 方案比较

### A. 动作边界闭环（采用）

真实复位 Element UI select 状态；录制与回放共享复位原语；录制动作增加一次定向
xpath fallback；Prompt 改为一步一个 select。

优点：修复状态泄漏根因，保留精确定位与选值契约。  
代价：需同时调整 JS snippet、Python orchestration、Prompt 与表征。

### B. 仅 Python 重试（不采用）

`no-items` 后重新点击同一 trigger。若组件内部仍认为下拉已打开，重试只会再次
toggle，无法保证恢复。

### C. 全局 resolver / options 兜底（不采用）

全局否定显式 xpath 或用 `options[0]` 顶替会掩盖错误，并可能操作错误控件或选错值。

## 设计

### 1. 共享复位原语

在 `scripts/controller/actions/js_snippets/select_trigger.py` 增加
`JS_RESET_SELECT_UI`，并通过 `_js_snippets.py` 兼容导出。

JS 原语执行：

1. 读取 `window.__last_select_trigger`。
2. 对 trigger 发送**不冒泡**的 Escape 并 blur；不冒泡可避免关闭承载表单的 dialog/drawer。
3. 对 body 发送 `mousedown`、`mouseup`，触发 Element UI clickoutside；不发送业务 `click`。
4. 清空 `window.__last_select_trigger`。
5. 短轮询可见 `.el-select-dropdown`，直到消失或达到小上限。
6. 返回 `before` / `after` 可见 popper 数量，供 stderr 诊断。

不再把直接写 `display:none` 当作状态复位；它只能改变视觉状态，不能证明 Vue
组件状态已关闭。

`scripts/controller/actions/_helpers.py` 提供 `reset_select_ui(page)`，录制与回放
共用同一调用入口。

### 2. 动作边界

录制和回放 select 流程统一为：

```text
preflight reset
→ xpath trigger
→ 等待选项
→ 选择 / 当前值确认
→ success: 选项点击自然关闭
→ final failure: reset 后返回原错误
```

“final failure”指同一次动作内的 fuzzy / lazy-load 尝试全部结束后。中间尝试仍可
复用当前已打开 dropdown；不在第一次 miss 后提前关闭。

应覆盖：

- `_form.py` 的直接 `select_option`
- `_form.py` 的 auto-fill `_select_by_xpath` 及 select fallback
- `_replay.py` 的精确 select

最终失败日志至少包含 label、请求值、触发结果、选择结果、复位前后 popper 数量；
产品返回码保持不变。

### 3. 录制期 xpath 运行时回退

不修改 `_resolve_control`。直接 `select_option` 按以下顺序执行：

1. 使用调用方显式 `xpath_smart`（若有）。
2. 只有 `JS_SELECT_TRIGGER_BY_XPATH` 实际返回 `xpath-not-found` 时，才以空 hint
   调用 `_resolve_control(store, label, "")`。
3. 若得到唯一、非空、且不同于失败 xpath 的 scan/TaskList xpath，先复位 UI，
   再用该 xpath重试一次。
4. 成功时 `_record_action` 写入实际成功的 fallback xpath。
5. 无唯一候选或重试失败时返回失败；不继续猜测容器或索引。

`no-items` 不是定位错误，不触发 xpath fallback。

### 4. Agent 约束

更新 `scripts/prompts/agent-tools-form.md`：

- 每步最多一个 `select_option`。
- `xpath-not-found` 后只能复制新 scan 中的 xpath，或省略 hint 让工具解析；禁止自造
  dialog / drawer xpath。
- `no-items` 后禁止用 `click_element_by_index` 点 el-option；动作已完成状态复位，
  可重新扫描后再试一次。

代码层复位是正确性保障，Prompt 只是降低无效尝试。

## 测试

### 自动表征

先增加失败表征，再实施：

1. 复位原语包含 Escape / blur、body `mousedown+mouseup`、全局 trigger 清理和条件等待。
2. 显式 xpath 运行时 miss 后，仅允许回退到同 label 唯一 inventory xpath。
3. `_resolve_control` 的既有 `hint wins` 表征保持不变。
4. Prompt 明确每步最多一个 select，并禁止 index 选 el-option。

回归命令：

```bash
python scripts/characterization/characterize-select-lazy-load.py
python scripts/characterization/characterize-select-table-row.py
python scripts/characterization/characterize-xpath-primary-ops.py
python scripts/characterization/characterize-xpath-fill-select.py
node scripts/characterization/characterize-ctrl.mjs
```

合入父工作树后，再运行父工作树的
`scripts/characterization/characterize-select-option-stamp.py`，验证组合兼容。

### 湿测

1. 在一个有稳定选项的 el-select 中故意请求不存在项，预期
   `option-not-found:*`。
2. 紧接着对同一字段请求有效项，必须成功，不能返回 `no-items`。
3. 对 drawer 字段传错误 dialog xpath；scan 中保留唯一 drawer xpath。预期只回退
   一次并成功，落库参数为 drawer xpath。
4. 重跑新增客户流程：不得用 index 点击 el-option，必须越过“新增客户校验”并最终
   不出现 `pending_fields:证件类型`。

## 隔离、交付与合并

1. subagent 基于当前提交 `HEAD` 创建独立 worktree / 分支。
2. 独立提交只包含本设计文件列出的闭环改动及测试。
3. 审查提交和测试证据后，再将补丁合入父工作树。
4. 同文件冲突逐块合并：保留父工作树 table-row / first-stamp WIP，同时保留本刀
   reset / runtime fallback。
5. 合入后运行联合回归；不自动 push。

## 验收

- `option-not-found → 下一次有效选择` 不再退化为 `no-items`。
- 错 dialog hint 可从唯一 drawer scan xpath 恢复，且录制真实成功 xpath。
- 每次最终 select 失败后无可见残留 popper，`__last_select_trigger` 已清空。
- 所有列出的表征通过。
- 原新增客户湿测完成保存，不再因“证件类型”耗尽步骤。
- 未改变回放精确 option、全局 hint 优先及外部工具参数/返回码。
