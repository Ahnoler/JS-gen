# click_button（按钮点击）操作规格 — 交接文档

> 2026-09-10 · JS-gen 引擎线 → 执行引擎同事侧。
> 覆盖表单/工具栏按钮点击动作 `click_button`（含图标按钮/文本按钮/容器优先/选择器触发），以及同引擎的 `click_element_by_index`（index 点击，回放走 durable 链）。
> 与 select:click / select:tree / radio 交接包同构。全部内容真机实证（KB-I5 r4/r5/r6 多轮 + 2026-08-27 toolbar 事故 + 2026-09-10 录放统一）。

---

## 0. 一句话架构

`click_button(button_text)` 录制走 `ClickEngine.click_button`（**G1 容器优先**：可见弹窗内先点 → 弹窗内无匹配再页面级 `JS_CLICK_ICON_BUTTON`）；回放走 `ClickEngine.click_button_for_replay` → `_replay_click_by_index` **durable 链**（xpath_smart → 弹窗修正 xpath_full → Playwright role/text 兜底）——录制与回放**不同 JS 路但同一引擎入口**（2026-09-10 统一定案）。

**硬门槛（先说，最容易被忽略）**：保存/提交/确认/确定类按钮**禁止走 click_button**，一律 `click_save`（带 outcome 校验+可导出落库）。引擎入口第一行就拦（`_is_form_submit_label`，正则 `^(保存|提交|确认|确定)(并.*)?$`），返回 `err-use-click-save:<text>` 指路。分区保存用 `click_save(button_text, region="<分区标题>")`。

## 1. 录制路：ClickEngine.click_button（click_action_engine.py:29）

编排顺序（每步都是踩坑换来的）：

1. **提交类改道**：见 §0 硬门槛。
2. **`JS_STRIP_STALE_WRAPPERS`**：剥 tsscMutilDialog 关闭残留 wrapper（幂等 <10ms）——残留会让真实点击够不到目标。
3. **`JS_STAMP_ICON_ARIA_LABELS`**：给无 aria-label/title 的**图标按钮**打上 aria-label（从 tooltip/icon class 解析短标签）——后面 icon 查找靠它。
4. **`_enrich_click_element`**：点击**前**采集元素定位（drawer/dialog 可能点击后卸载，截图/落库要在 click 前完成）。
5. **G1 容器优先**：`_JS_CLICK_BUTTON_IN_CONTAINER`（_misc.py:67）——
   - 找**可见** overlay（`.el-dialog/.el-drawer/.el-message-box`），**z-index 最高者**为 scope；
   - scope 内扫候选（button/.el-button/a/radio/checkbox/tree-node__content），容器内**宽松匹配**（exact 或 includes），页面级**仅精确**；
   - dialog 内无匹配 → **补扫 body 挂载的 popper**（`.el-popover/.el-popper/.el-select-dropdown/.tree-popover`）——TsscMultiTree/el-select 的选项面板渲染在 dialog DOM **之外**；
   - 仍无匹配 → **`click_button('<字段label>')` 开 picker trigger**：按 label 找 `.el-form-item__label`，取 el-select trigger 或**首个可见非 hidden input**（TsscMultiTree 在显示 input 前有个隐藏搜索 input，`querySelector('input')` 会拿到它——必须过滤），发 **mousedown→40ms→mouseup→40ms→click 全链合成事件**，返回 `ok-container:`/`ok-click:`——这样 `click_button(客户名称)` + `click_button(选项文本)` 两步能开选择器；
   - 无 overlay 时 scope=document（KB-I5 r6：todo-card 的 div.todo-item-action 等非 button affordance 也可达）。
   - 返回 `ok-container:`/`ok-click:` 即采纳；否则落回页面级。
6. **`JS_CLICK_ICON_BUTTON`**（icons.py:133，页面级三级优先）：
   - **精确文本优先**（KB-I5 run5 定案：原 icon 优先改为文本优先）：归一化 innerText===目标 的可见元素（排除 `.el-table__body-wrapper` 行内），**同文本取 document 顺序最后一个=最内层**（祖先先于后代），scrollIntoView 后 `el.click()` → `ok-text:`；
   - icon 宿主（tooltip/icon class 解析 label，精确或包含）→ `ok`；
   - **泛化文本兜底**（2026-08-27 toolbar 事件）：普通可见 button 文本精确/包含（`want.includes(t)` 反向排除长文本误吞），**池化消歧**——精确优先；**页面级（非 overlay）优先于 overlay**（弹窗开着时主列表页同名「查询」不能抢）；唯一才点，多个返回 `err-icon-label-ambiguous:`（附候选清单给 agent）。
7. **结果分派**：ok → `_record_action('click_button', {button_text}, result, element)`；查 store 记 `remember_trigger_button`（弹窗内 picker 的触发按钮名，供后续 picker_confirm 语义）；去空格==「查询」→ `mark_query_clicked`（search-then-click 守卫）。`err-icon-label-ambiguous`/`err-icon-label-miss` 结构化错误（带 next_action 指路 `click_element_by_index`/`click_table_row_button`）。
8. 点击后 `wait 400ms`。

## 2. click_element_by_index（录制，同引擎）

index 点击（agent 按观察到的元素编号点击）：`get_dom_element_by_index` → **点击前**采集 text/tag/xpath（同 §1.4 理由）→ **禁点击 el-select 下拉面**（option li/表内行/下拉体——Agent 常把拼接的公司名当按钮名记录，此类索引点击会被拒绝引导改走 select_option）→ 点击 → picker confirm 语义识别（「确 定」关闭 picker → 记 confirm_click/toast_ok + submit-ready）。异常包 `click-failed:<e>`。

## 3. 回放路：durable 链（replay_click.py，无 ephemeral index）

`click_button_for_replay(page, entry, params)` / `click_element_by_index_for_replay` 都归 `_replay_click_by_index`：

1. **参数收集**（多来源兼容）：text（params.text/menu_text/element.text）；xpath_smart（element.xpath_smart→candidates[type=xpath_smart]→target 以 `//` 开头则视作 smart）；xpath_full（element.xpath_full/xpath_abs→candidates→params.xpath）；icon_class/target_kind（blob 含 `el-tree-node`→tree_node、`el-icon-`→icon）。
2. **`_JS_CLICK_DURABLE`**（replay_js.py:70）：单次 evaluate 按 `[text, xpath, tagHint, xpathSmart, opts{parentText,iconClass,targetKind}]` 定位点击——**语义锚优先**（targetKind 分支：tree_node/icon/普通），xpath_smart → 弹窗感知修正的 xpath_full。
3. ok → `_post_click_settle`（replay_click.py:127，**分类沉降**）：
   - 保存类文本（`_is_save_click_text`）→ 保存后页面 idle 等待（列表刷新）；
   - 树节点 → 300ms + loading 等待 + 编辑表单出现探测（不出→stderr 记录）；
   - 其他 → 400ms（expand/submenu 600ms）+ loading。
4. **JS 三路全败 → Playwright 可信点击兜底**（弹窗重挂载场景）：`get_by_role('button', name, exact).last` → `get_by_text(exact).last` → `text=` 松散 `.last`——**全部取 .last**（overlay 重挂载后最新实例在前）。
5. 全败 → `click-failed:not-found text=… xpath=…`。

**组外壳**：回放组内 `click_button` 前有 `_replay_close_dialog_idempotent` 幂等清场（契约 §2.3）。

## 4. 动作名与别名（replay_names.py）

canonical=`click_button`；别名 `clickIconButton / click_icon_button → click_button`、`clickElementByIndex → click_element_by_index`；kebab/camelCase 自动转 snake_case。

## 5. 结果协议（Python 侧）

| 场景 | 结果 |
|---|---|
| 录制 ok | `ok-text:<text>` / `ok` / `ok-container:<text>` / `ok-click:<text>`（`_is_ok_result` 判定）+ 落步骤 |
| 同名按钮多且无法安全挑 | `err-icon-label-ambiguous`（结构化，带候选清单，next_action 指路） |
| 找不到 | `err-icon-label-miss`（next_action：核对 iconButtons 清单/用 click_table_row_button） |
| 提交类按钮 | `err-use-click-save:<text>`（指路 click_save） |
| 回放全败 | `click-failed:not-found ...` |

## 6. 相关但不在本包核心

- **click_save**（保存/提交专用，outcome 校验+保存后 idle+可导出落库）：`form_save.py`/`_form.py:148`——若同事侧有保存链需求，本包附带 `form_save.py` 可参考，但它属「保存族」独立契约（分区保存/双保存）。
- **click_table_row_button / click_table_row_radio**：表格行内按钮（replay_table 族）。
- **click_menu_xpath / click_menu_item**：菜单导航（见 mega-menu 交接文档）。
- **real_click**（CDP trusted click）：`_workspace.py`——本包未含（radio/tree 包已含），弹窗只认可信事件场景用它。

## 7. 文件清单（zip 内 py/）

| 文件 | 角色 |
|---|---|
| `click_action_engine.py` | ClickEngine：click_button / click_element_by_index 录制 + *_for_replay 入口 |
| `replay_click.py` | `_replay_click_by_index` durable 链 + `_post_click_settle` 分类沉降 |
| `replay_js.py` | `_JS_CLICK_DURABLE`（回放单次 evaluate 定位点击） |
| `replay_wait.py` | `_is_save_click_text` / `_is_tree_node_entry` / 保存后/树后等待 |
| `replay_timing.py` | WAIT_300/400/450/600_MS、CLICK_TIMEOUT_MS 常量 |
| `js_snippets/icons.py` | JS_STAMP_ICON_ARIA_LABELS / JS_CLICK_ICON_BUTTON / JS_COLLECT_ICON_BUTTONS |
| `_misc.py` | `_is_form_submit_label` / `_JS_CLICK_BUTTON_IN_CONTAINER`（G1 容器优先） |
| `js_snippets/strip_dialogs.py` | JS_STRIP_STALE_WRAPPERS（残留清场） |
| `js_snippets/_locator_helpers_js.py` | PAGE_LOCATOR_HELPERS（isVisible 等，生成物勿手改） |
| `js_snippets/enrich.py` | _enrich_click_element 依赖（点击前定位采集） |
| `_helpers.py` | _ok/_err/_is_ok_result/_wait_if_loading 等 |
| `result_protocol.py` | err_with 结构化错误协议 |
| `form_save.py` | click_save（附带参考：保存族契约） |
| `_form.py` | 动作注册面（click_save 注册示例） |

## 8. 集成注意（给同事）

1. **保存类分流是安全护栏不是风格偏好**：保存/提交/确认走 click_save 才有 outcome 校验（保存后 idle、表单回读），click_button 点保存会漏掉保存失败检测——分流正则可按他们 SUT 文案扩展。
2. **点击前采集**：弹窗/抽屉点击后常卸载，定位信息（xpath/text/attributes）必须在 click 之前取全。
3. **同名按钮消歧**：池化策略（精确>包含、页面级>overlay、唯一才点）直接照抄；多个同名时**报 ambiguous 带候选**比随机点一个安全得多。
4. **z-index 最高 overlay 优先** + **popper 补扫** + **label 开 trigger**：这三层是 picker/弹窗场景的完整解法，缺一层就会「看得见点不着」。
5. **回放 .last 纪律**：Playwright 兜底与 xpath 快照都取最后一个可见实例——overlay 重挂载后新实例才是活的。
6. **分类沉降**：保存后等列表 idle、树点击后等编辑表单，比固定 sleep 抗慢环境；等不到时 stderr 记录不硬失败。
