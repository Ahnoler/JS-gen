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

**四类页面形态与标准动作序列：**
- **列表页：** 菜单进入 → 设筛选条件 → 点「查询」→ 选目标行 → 点行内操作按钮（新增/修改/删除等）。
- **选择器弹窗（授信选客户、用信「引入」等）：** 三段式 — ① 输入条件**查询**；② 结果列表**单选**一条；③ 点「确定/确认」带回。**禁止**跳过查询直接翻找，**禁止**多选。
- **编辑抽屉（新增/编辑表单）：** 页面右侧 el-drawer 侧滑抽屉。抽屉内字段**扫描**（`scan_form_fields`）→ 填充（`run_form_assistant` / `fill_form_field`）→ 终检 → `click_save`。抽屉是独立容器，勿扫到抽屉外背景页元素。
- **向导审批页：** 保存/**下一步**/**返回**的分步向导。按序点「下一步」推进到**末步**，再填写审批意见并提交；**禁止**跳步，**禁止**在中间步骤找审批意见框。
- **日期默认值 = 系统营业日期：** 「今天」指系统**营业日期**（非自然今天），可用 `read_business_date()` 读取；默认值优先用营业日期，**不得填晚于营业日期的日期**。
