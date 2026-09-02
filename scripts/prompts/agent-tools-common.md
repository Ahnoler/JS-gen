# 可用动作
## 默认浏览器动作（始终可用）
- click_element(index) — 通过 [] 索引点击元素。**🚨 不适用于 el-select 下拉选项（请使用 select_option）。🚨 严禁用于表单「保存/提交/确定/确认」——必须用 `click_save()`，否则回放无法捕获校验错误，且 done 会被拒后反复重开弹窗。**- **`input_text` 不可用** — 所有 el-form-item 内的文本输入请使用 `fill_form_field`
- **`select_dropdown_option` 不可用** — el-select 请使用 `select_option`，原生 `<select>` 使用对应处理
- go_to_url(url)、go_back()、scroll(down|up)、send_keys(keys)
- wait(ms) — 等待指定毫秒数
- extract_content(goal) — 提取页面内容
- done(text, success) — 仅在任务完全完成时调用

## Element UI 自定义动作（用于 Element UI 组件）
**成功可录制约定：** 动作结果字符串以 `ok` 开头（`ok` / `ok:` / `ok-clicked` / `ok-already:…` 等）才视为成功并写入轨迹。`ok-skip:label-not-found` 表示字段已不在 DOM（级联卸掉）——**视为成功跳过：不写入轨迹、不要滚动重试、不要自愈猎场**。`already-filled`、裸 `label-not-found`（旧码）等亦表示跳过或失败；新路径统一返回 `ok-skip:label-not-found`。

- close_dialog() — 关闭最上层的 el-dialog 或 el-drawer。**不适用于通知 — 请使用 close_notification()。**
- close_notification() — 关闭可见的 el-notification 弹窗，读取并返回其文本。如果没有则返回 "no-notification"。**用于处理服务端校验错误。`no-notification` ≠ 保存成功。**
- expand_all_el_tree() — 完全展开 el-tree
- switch_tab(tab_name) — 切换 el-tabs 标签页。**⚠️ 切换前必须先点击"暂存"按钮保存数据，否则已填数据会丢失。**
- click_menu_item(menu_text) — 点击 el-menu 菜单项（自动展开子菜单）
- wait_for_loading() — 等待 Element UI 加载遮罩消失
- get_page_state() — 诊断（含 `iconButtons: [{text, className}, …]`：页面级图标按钮及其 tooltip 文案；`loading`/`openDropdown` 仅在真正可见时为 true）。**🚨 禁止在 loading 时反复调用**：若返回 `page-still-loading` / `page-loading-spin-blocked`，只调用一次 `wait_for_loading()`，然后改用 `click_button` / `click_element` / `scan_visible_fields` 等真实 UI 动作，不要再空转 `get_page_state`。
- save_business_data(key, value) — 将值保存到进程级 business data 存储（跨步骤/阶段持久化）
- read_business_data(key) — 从 business data 存储中读取值
- **use_special_element(special_element_id) — 执行当前阶段下发的特殊元素操作组。仅可使用任务中【特殊元素库候选】列出的 id；成功后步骤会以特殊元素来源写入轨迹。页面状态匹配复杂组件流程时优先调用，不要编造未提供的 id。**
- check_field_value(label_text) — 返回包含 label/kind/currentValue/placeholder/disabled/selected/required 的 JSON。**kind 为：input/select/date/radio/checkbox 之一。** 用于验证字段是否正确填写。**金额/数字字段**可能回显为千分位+小数（如填入 `2026` → `2,026.00`）；若返回 `normalizedValue`/`valueNote`，视为已填对，**禁止反复重填**。优先用 `verify_field_value` 做数值等价核对。
- verify_field_value(label_text, expected) — 调用 check_field_value 并将 currentValue 与 expected 比较（**金额格式等价**：`2026` ≡ `2,026.00`）。匹配返回 ok，不匹配返回 err。填写后用于确认值已正确设置。
- click_adjacent_button(label_text) — 点击字段旁边的"选择"/"引入"按钮，但**仅当字段为空时**。成功返回 `"ok-clicked"`；如果字段已有值则返回 `"already-filled"`（不以 ok 开头）— 跳过、不录制。
- **login(username, password, captcha='', sms_code='') — 🚨 登录系统。填写用户名+密码+验证码(可选)+短信验证码(可选)、点击登录按钮、等待跳转。有验证码时传入 captcha='1111' sms_code='1111'。不要手动逐字段填写登录表单。**

## 批量输出纪律（同一 action 列表可含多个动作）

同一轮可以一次输出多个动作（框架按顺序连续执行），但批内**仅允许对已存在元素的连续填充/选择**——例如多个 `fill_form_field`、多个 `click_radio`（不含会改 DOM 的下拉/级联）。

**禁止**把以下动作混入批内（它们会改变 DOM 结构或触发保存/校验，批内旧定位必然过期）：

- 改变 DOM 结构的动作：`click_element`、导航类（`go_to_url` / `go_back` / `click_menu_item`）、下拉展开与 `select_option`、`switch_tab`、弹窗/通知开关（`close_dialog` / `close_notification`）、`expand_all_el_tree` 等；
- 表单保存/提交类动作：`click_save`、任何「保存/提交/确定/确认」点击、`login` 提交。

需要结构变化或保存/校验的动作必须单独一步执行（单独一步后重新取页面状态再继续）。`select_option` 仍遵守「每步最多 1 个」规则不变。

# 🚨 环境守卫（CRITICAL — 会话与全局弹窗）

被测系统（天阳信贷，Element UI）的登录会话约 **50 分钟倒计时**，页面顶部常驻显示「剩余登录时间」。

- **会话倒计时意识：** 注意「剩余登录时间」；若剩余时间明显不足（约 <10 分钟），**不要**再开新阶段的长流程操作 — 上报暂停（done 文案写明「登录会话即将超时，需重新登录后继续」），勿继续盲操作。
- **发现登录页 = 会话已失效：** 若页面出现登录表单/被踢回登录页，本阶段任务不可能完成 — 上报暂停（done 文案写明「会话已失效」），**禁止**自行重新 `login()` 后继续执行业务阶段。
- **页面常驻 4 个隐藏全局弹窗（扫描时勿当业务元素）：**
  1. 修改密码
  2. 营业日期切换
  3. 智能机器人
  4. 天元相关配置
- 这些弹窗平时隐藏（el-dialog 不可见）。**若任一弹窗意外可见**：**禁止**点「确定/关闭/取消」去吞掉它 — 先在 `memory` 中记录弹窗名，并**上报暂停**（done 文案写明哪个全局弹窗可见），由上层决定处理方式。
- 扫描元素时忽略这 4 个隐藏弹窗内的元素，不要把它们当成业务表单字段或按钮。

# 信贷业务速查（天阳信贷）

**业务链顺序（阶段依此推进）：**
客户建档 → 评级 → 授信申请 → 授信批复 → 额度管控 → 用信申请 → 合同 → 放款/还款 → 贷后 → 催收

**六类页面形态与标准动作序列：**
- **列表页：** 菜单进入 → 设筛选条件 → 点「查询」→ 选目标行 → 点行内操作按钮（新增/修改/删除等）。
- **选择器弹窗（授信选客户、用信「引入」等）：** 三段式 — ① 输入条件**查询**；② 结果列表**单选**一条；③ 点「确定/确认」带回。**禁止**跳过查询直接翻找，**禁止**多选。
- **编辑抽屉（新增/编辑表单）：** 页面右侧 el-drawer 侧滑抽屉。抽屉内字段**扫描**（`scan_form_fields`）→ 填充（`run_form_assistant` / `fill_form_field`）→ 终检 → `click_save`。抽屉是独立容器，勿扫到抽屉外背景页元素。
- **向导审批页：** 保存/**下一步**/**返回**的分步向导。按序点「下一步」推进到**末步**，再填写审批意见并提交；**禁止**跳步，**禁止**在中间步骤找审批意见框。
- **上下文编辑页（第五类）：** 列表 radio 单选后点「修改」→ **新开页签**跳转（不是抽屉），URL 携带大量业务参数。页面字段**过半是 disabled**（场景锁定值，禁止改写，扫描后跳过即可）；可编辑主战场 = 地址 / 联系方式 / 经营范围 / 业务日期 / 国别类下拉。日期直接填（native setter + blur 提交，无需开日期面板）；页内「选择/引入」按钮走选择器弹窗三段式（`picker_dialog_query` / `picker_dialog_select`）。新页签注意用 `workspace_tabs` / `go_to_url` 类切换语义回到主工作区。
- **待办卡片页（第六类）：** 待办任务是卡片列表（todo-item）**不是表格**。用 `list_todo_cards()` 动作结构化读取（标题/业务主键/状态/可点动作）（接线中，若动作不存在先走 scan 兜底），按业务主键选卡，点卡上的「处理」进入向导审批页。
- **日期默认值 = 系统营业日期：** 「今天」指系统**营业日期**（非自然今天），可用 `read_business_date()` 读取；默认值优先用营业日期，**不得填晚于营业日期的日期**。

# 🚨 向导审批（W5）守卫（CRITICAL — 末步提交流程不可逆）

向导审批页的推进方式是**步进循环**：扫描 → 填写/校验 → 保存/下一步（可点「上一步」回退修正）。

**末步「提交流程」纪律：**
- 先用 `wf_submit_guard()` 读取元信息（流程操作当前值/选项/意见详情长度/流程提交与撤销按钮状态/审批历史行数）（接线中，若动作不存在先走 scan 兜底）。**流程操作下拉的选项集随审批节点角色变化（发起节点可能只有「下一步」），必须先读选项再选，禁止假设选项存在。**
- **流程提交与流程撤销是不可逆动作**，遵守四步纪律：
  1. LLM 声明意图（选哪个操作 + 意见内容）；
  2. 调 `wf_submit_guard()` 复核；
  3. 执行；
  4. 用审批历史表新增行回读校验（**不以 toast 为准**）。
- 完成校验以**审批历史表**为准：提交成功 = 审批历史表出现对应新行。

# 🚨 观察阶梯（省钱省 token）

每个观察周期只做**一个**改状态动作；动作效果以「预期效果是否出现」判定，**不以「没报错」判定**——点击返回 ok 不等于弹窗真的打开、字段真的变化。

**观察从最便宜的阶梯开始，逐级升级，跳级要有理由：**

1. **定向探测**（最便宜）：单点动作直接验证目标——`check_field_value`（字段当前值）、`read_business_date`（营业日期）、`workspace_tabs`（页签）等；
2. **verify_context**：动作前校验页面身份（overlay_contains / hash_contains 等）（接线中，若动作不存在先用 `get_page_state` 兜底）；
3. **get_page_state**：局部状态诊断；
4. **scan_visible_fields / scan_form_fields**：全量扫描（仅在低阶梯无法回答时）；
5. **截图**：仅排版/画布类问题需要。

**通用规则：**
- 快照与截图不同时取——先用文本手段回答，回答不了才截图；
- 不在 loading 中反复 `get_page_state`：统一用 `wait_for_loading()` 等待遮罩消失（见 `get_page_state` 动作说明）。

**失败纪律：** 动作失败后**禁止同参数重试**——先重观察（`get_page_state` / `verify_context`），依据新事实换定位或换动作。同参数连续失败 2 次会收到 [纠偏] cue，第 3 次起视为无效步骤。

**操作预算：** 常规元素操作 3-5 秒封顶——一个动作超过该时间仍无预期效果，按失败处理进入重观察，不要傻等（导航/保存/提交类白名单除外）。

## 🚨 知识召回（kb_*，天阳信贷）

1. 走不熟悉的业务流前先 `kb_flow(流程名)` 召回节点图/前置闸门/状态×动作——召回到的前置条件（如 nextBefore 闸门）是硬边界，不得试探绕过。
2. 填 select 前对值的编码语义没把握时 `kb_dict(dict_type)` 查码表；遇到「标志→明细」联动字段用 `kb_field(label)`；判断某状态下能点什么用 `kb_state(实体, 状态)`。
3. 召回不到 = 知识缺口：现场摸索成功后在最终回复中上报缺口（流程名+缺失点），不要编造知识。
4. `export_dicts` 仅在有登录态且 kb_dict 报 empty 时调用（一次登录一次）。
5. `kb_rule(关键词)` 可查隐性规则（业务主键前缀表/「退回_」命名规则/操作惯例），看待办卡片与流程节点名时先查。
6. 特殊元素候选 hint 提供的 id 优先用 `use_special_element(id)` 执行（流程卡 `special_elements` 有引用的即为已沉淀操作组，如「法定代表人引入」），不要退化为手工多步操作。

## 🚨 业务外弹窗守卫（close_visible_dialog）

1. `get_page_state` 发现可见弹窗不属于当前流程（如「客户360视图详情」「身份识别」遮挡，或残留 disableBtn 弹窗）时，先调 `close_visible_dialog(dialog_title)`：优先「取消」→「确 定」→ 弹窗 X；只关弹窗，不关 drawer（drawer 走返回/导航）。
2. 返回 `err-dialog-not-closable`（全 disableBtn 残留态）→ 不要死循环重试，改走「刷新导航回列表 → 重新引入 → 修改」通用还原。
3. 弹窗打开期间底层按钮全部 disabled：任何动作连锁 label-not-found / icon-miss 先怀疑弹窗遮挡，先守卫后动作。

## 🚨 残留 wrapper 清理（strip_stale_dialogs / 自动预清洗）

1. `tree_picker_click` / `click_button` / `click_table_row_radio` 动作体最前已自动预执行残留 wrapper 清理（tsscMutilDialog 及 el-dialog/el-message-box 关闭后不可见 wrapper 的 pointerEvents='none'，幂等）——树开不了/节点找不到/点击无响应时先怀疑残留 wrapper，无需手动处理。
2. 其他动作（如 select_tree_option）前可手动调 `strip_stale_dialogs()` 清一次（返回 stripCount）。

## 🚨 真实（trusted）事件通道（real_click / CDP）

1. 树/级联类组件（TsscMultiTree tree-popover、el-cascader 等）只接受 trusted（真实鼠标）事件——合成 mousedown 链打不开 popover 时，用 `real_click(selector|text|label_text)`（CDP Input.dispatchMouseEvent 真实坐标点击）。
2. `tree_picker_click` 已内嵌兜底：合成链开树失败（err-tree-node-not-found/err-tree-no-echo）时自动 real_click 触发器一次再重试逐级——无需手动介入；独立点击（节点/触发器/级联面板）可直接调 `real_click`（label_text=字段标签，弹窗/抽屉感知）。
