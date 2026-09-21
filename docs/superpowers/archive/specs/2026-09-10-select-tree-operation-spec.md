# select:tree（树形选择器）操作规格 — 交接文档

> 2026-09-10 · JS-gen 引擎线 → 执行引擎同事侧。
> 覆盖三个树形选择动作的完整实现：**select_tree_option**（单选树，TsscMultiTree 自定义组件）、**tree_check_confirm**（复选树/流程选人）、**tree_picker_click**（真实点击逐级树/品种明细）。
> 所有内容出自本仓真机实测（2026-06-30 Edge CDP 探索 + KB-I5 多轮湿测），非理论设计。

---

## 0. 一句话架构

树形选择分三层：**JS 片段（DOM/Vue 操作）→ Python 引擎（TreeEngine，录放共用）→ 回放分发（replay_form_action 按 action_name 路由）**。与 select:click 交接包同构；`select_dispatch.py` 是 select 族（tssc/tree/el-select）的分流单源。

---

## 1. 被测系统的树组件 DOM/Vue 结构（必须先懂这个）

组件**不是 Element UI 标准组件**，是自定义 `TsscMultiTree` = `el-popover + el-tree` 组合：

```
.el-form-item
  ├─ input                          ← trigger，点它开 popover
  └─ .tree-popover (或 .my-popover)
       └─ .el-tree                  ← 树本体
```

**Vue 实例链（关键）**：`ElTree → ElPopover → ElTooltip → TsscMultiTree`。
**TsscMultiTree 是业务层**，持有：
- `data[]`：树结构 `[{label, id, children?}]`（层级）
- `treeData[]`：扁平数组 `[{name, id, pId}]`（无 children）

**踩坑实录（不要重蹈）**：
| 尝试 | 结果 |
|---|---|
| `span.click()` 触发选中 | ❌ Vue 事件绑定在 TsscMultiTree 层 |
| `el-tree.setCurrentKey()` | input 不更新（回调在 TsscMultiTree） |
| `el-tree.setChecked()` | 同样无效 |
| **`vm.$emit('input', code)`** | ✅ **唯一正确 API**，组件自动 code→label 更新 input |
| `vm.handleHideClick()` | 关闭 popover（可选收尾） |

**规则**：必须先 `input.click()` 打开 popover 才能访问 `.el-tree` DOM；**绝不裸查 `document.querySelector('.el-tree')`**——产品/分类侧边栏也是 `.el-tree`，会拿错组件。必须沿 `__vue__` 的 `$parent` 链向上找 `$options.name` 含 `TsscMultiTree` 的实例。

## 2. select_tree_option（单选树，JS 三段式 P0→P1→P2）

JS：`js_snippets/select_tree.py` 的 `JS_SELECT_TREE_OPTION`（async ([label, option])）。

流程：
1. **找字段**：按 label 精确/包含匹配 `.el-form-item` 的 label；找不到补扫**可见** `.el-dialog/.el-drawer`（弹窗内字段不在页面容器里）。`label-not-found` / `no-input` / `disabled` 先行短路。
2. **开 popover**：`input.click()` + 200ms。
3. **找 TsscMultiTree 实例**（walkVueForTssc，见 §1 规则）。找不到 → 返回 `no-tree-component | Not TsscMultiTree...`（**不要重试本动作**——是普通 input/el-select，走 fill_form_field/select_option）。
4. **P0 精确匹配**：在 `vm.data`（层级）按 label/name/id 匹配节点；命中非叶节点则 DFS 取第一个叶子；`vm.$emit('input', code)` → 150ms 后**回读 input 值验证**（组件可能拒非法 code）→ 100ms 后 `handleHideClick()` 收起。返回 `ok:<option> (<code>)`。
   - `option='first'`/空 → 取全树第一个叶子（跳过关键字搜索，避免拿字面量"first"去搜）。
5. **P1 关键字搜索**（P0 未命中）：popover 里 `.search-input input`（native setter + InputEvent）触发过滤，轮询等结果（≤2s），Pass1 点第一个可见叶子；无叶则 Pass2 展开第一个非叶再取子叶；点后仍 `$emit('input', code)` + 验证。返回 `ok-search:<label>`。
6. **P2 兜底**：全树 DFS 第一个叶子直接 emit。返回 `ok-fallback:<label> (<code>)`。
7. 全部失败 → `option-not-found`。

**结果协议**：P0/P1/P2 成功码全部 `ok` 前缀（ok / ok-search / ok-fallback / ok-fill-fallback），Python 侧 `_is_ok_result` 统一判可记录；失败码 `label-not-found` / `no-input` / `disabled` / `no-tree-component | ...` / `fail: ...` / `option-not-found`。

### Python 引擎（tree_engine.py TreeEngine.select_tree_option，录放同体 mode=record|replay）

- record：`_resolve_control`（scan 缓存软解析，miss 也继续走 label JS）→ `_capture_element(target_kind='form_tree_select')` → evaluate JS → ok 则 `_record_action`（stamp `form_tree_select`）+ `_task_done_impl`。
- replay：`select_tree_option_for_replay(page, ...)` 类方法用 `_ReplayPageAdapter` 构造引擎跑 `mode="replay"`（不落步骤表）。
- **disabled 语义**：返回 `disabled` 时提示**勿重试**（TsscMultiTree 只读/分类目录预填场景，如从侧边栏带入）。
- **no-tree-component 降级**：option 是具体值 → 自动转 `fill_form_field`（记 `ok-fill-fallback`，步骤记为 fill_form_field）；option='first' → 明确报错并指路 fill_form_field/select_option。

### 回放接线（replay_form_action.py:89）

`action_name == 'select_tree_option'` → `_with_xpath_first` 包装（先验证 `xpath_smart` 仍定位 → label JS（内部 TreeEngine mode=replay）→ ok 时按定位来源注记 `ok-xpath-smart` / `ok-xpath-full`）。**旧别名归一**（replay_names.py）：`treeSelect / selectTreeOption / tree_select / treeselect / fill_tree / fillTree → select_tree_option`。

## 3. tree_check_confirm（复选树/流程选人）

场景：`show-checkbox` 的 el-tree in popover（流程选人 nextNodeAprvPsnList 等）。**选中列表只有真实 check 事件才写**（KB-I5 r6c 根因）——所以 JS 流程是：开 trigger → 找 node_text → **点击其 checkbox（已预选中的也再点一次，保证终态=checked 且真实事件触发）** → 验证节点 checked 且 checked-count ≥ 1。

- 结果 `ok:{checked_count}`；错误码：`err-tree-label-not-found` / `err-tree-node-not-found` / `err-tree-check-unverified`（**未验证成功禁止盲目重试**——先重读状态）。
- 只负责勾选；**确认按钮（"确 定"）由调用方自己点**。

## 4. tree_picker_click（真实点击逐级树）

场景：品种/产品树选择器，`select_tree_option` 的 `$emit` 注入不生效的地方（「维护方案品种明细」popover：点叶子文本会关闭 popover 并自动回填只读额度字段）。

- 输入 `path_texts` = 根到叶 JSON 数组 `["贷款","对公","房地产贷款","住房开发贷款"]`；逐级**真实点击**节点文本（等展开）→ 验证字段 input 回显叶子文本。
- **关键坑（探针实证）**：该 popover 只认**可信（真实鼠标）事件**——合成 mousedown 链既打不开 trigger 也注册不了节点点击/展开。因此 Python 侧有 CDP real-click 兜底编排（`_real_click_via_cdp`）：①real_click trigger 开 popover ②逐级 real_click（下一层已可见则跳过，防 toggle 收起）③`JS_REAL_CLICK_ECHO` 验证回显。每级等渲染 ≤4×1s。
- 点击前先 `JS_STRIP_STALE_WRAPPERS` 剥离 tsscMutilDialog 关闭残留（幂等 <10ms），否则真实点击够不到 popover。
- 只负责选叶子；确认按钮（"确认"）调用方自己点。

## 5. 辅助片段

| 片段 | 位置 | 用途 |
|---|---|---|
| `JS_SELECT_TREE_OPTION` | js_snippets/select_tree.py:63 | 单选树三段式主体 |
| `JS_EXPAND_ALL_EL_TREE` | js_snippets/select_tree.py:371 | 全展开（≤10 轮），expand_all_el_tree 动作 |
| `JS_TREE_CHECK_CONFIRM` | js_snippets/tree_check.py:17 | 复选树检查+验证 |
| `JS_TREE_PICKER_CLICK` | js_snippets/tree_picker.py:13 | 逐级真实点击树 |
| `JS_TREE_POPOVER_OPEN` | js_snippets/real_click.py:156 | 探测 popover 内某节点是否渲染 |
| `JS_REAL_CLICK_ECHO` | js_snippets/real_click.py:109 | real-click 后回显验证 |
| `JS_STRIP_STALE_WRAPPERS` | js_snippets/strip_dialogs.py:23 | 剥离关闭残留 dialog wrapper |
| `JS_FIELD_DISABLED` / `JS_GET_CONTAINER` | js_snippets/base.py / container.py | 共享 disabled 判定 + 容器感知（拼接依赖） |

## 6. Python 文件清单（zip 内 py/ 目录）

| 文件 | 角色 |
|---|---|
| `tree_engine.py` | TreeEngine：select_tree_option 录放同体 + expand_all_el_tree |
| `_tree.py` | tree_check_confirm / tree_picker_click 动作注册（含 CDP real-click 兜底编排） |
| `js_snippets/select_tree.py` | JS_SELECT_TREE_OPTION / JS_EXPAND_ALL_EL_TREE |
| `js_snippets/tree_check.py` / `tree_picker.py` | 复选树 / 逐级树 JS |
| `js_snippets/real_click.py` / `strip_dialogs.py` | real-click 回显/开面板探测 / 残留剥离 |
| `js_snippets/base.py` / `container.py` | JS_FIELD_DISABLED / JS_GET_CONTAINER（拼接依赖） |
| `select_dispatch.py` | select 族分流单源（tssc/tree/el-select；tree 按 target_kind/field_kind 判定） |
| `replay_form_action.py` | 回放路由（select_tree_option 分支 + _with_xpath_first） |
| `replay_names.py` | 旧别名归一表（treeSelect/fillTree/…） |
| `_form.py` | 动作注册面（select_tree_option → TreeEngine 接线示例） |
| `_helpers.py` / `form_engine_base.py` / `form_scan_utils.py` | 引擎基座（_ok/_err/_is_ok_result、基类、_resolve_control） |
| `_workspace.py` | _real_click_via_cdp（CDP trusted click） |

## 7. 集成注意（给同事）

1. **动作面**：三个独立 action_name（`select_tree_option` / `tree_check_confirm` / `tree_picker_click`），LLM 按 field 形态选；别合并成一个——复选树和 $emit 注入树的选中机制完全不同。
2. **select_option 分流**：本仓 `select_option` 经 `resolve_select_dispatch` 也会判出 `tree` path（target_kind=`form_tree_select` / field_kind=tree-select / tree_select），但当前 tree path **fall through 到 el-select**（select_engine.py:550 注释）——树字段请直接调 `select_tree_option`。
3. **结果码消费**：`no-tree-component` 与 `disabled` 是终态，禁止重试（文案里带了给 LLM 的指路语）。
4. **验证惯例**：所有成功路径 emit/click 后都**回读 input 值验证**（readDisplayValue），未回显=失败——不要省，组件可能静默拒收非法 code。
5. 拼接型 JS（`JS_FIELD_DISABLED` 等字符串拼接）搬运时保持拼接顺序，别拆成独立文件后丢前缀。
