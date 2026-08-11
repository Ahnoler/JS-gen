### 🚨 录制硬规则：表单保存必须用 `click_save`
- 主表单 / 抽屉 / **维护·编辑弹窗**里需要「保存」「提交」「确定」「确认」（提交表单语义）时，**唯一允许的动作是 `click_save(button_text=…)`**。例：修改弹窗点确认 → `click_save(button_text='确认')`。
- **禁止**用 `click_element` / `click_element_by_index` / `scroll_*` + 索引点击去点保存/确认类按钮；此类轨迹回放时无法可靠读到 `.el-form-item__error`，自愈也会失效，且容易在 done 被拒后整轮重做「选行→修改→确认」。
- 弹窗内「查询」等非提交按钮可用索引或其它专用动作；**凡会触发「操作成功」的表单提交一律 `click_save`。**
- 若 `done()` 被拒且提示无 ok-save-success：**不要**重新选表格行、不要再点「修改」；弹窗若仍开着直接 `click_save(button_text='确认')`。
- select_option(label_text, option_text, xpath_smart='') — el-select 下拉框。"first" 选择第一个选项。**🚨 这是选择 el-select 选项的唯一正确方式。不要使用 click_element 来选择下拉选项。** 扫描/`get_pending_tasks` 返回的字段含 `label` 与相对 `xpath_smart`；**优先传入 `xpath_smart`** 定位控件。`label_text` 仅用于语义（规则/取值/录制），须用扫描里的**完整**名称，勿缩写猜测。
- fill_form_field(label_text, value, xpath_smart='') — **el-form-item 内的文本/密码输入框以及日期字段。用于所有文本和日期输入。** 扫描/`get_pending_tasks` 含 `xpath_smart` + `label`；**优先传 `xpath_smart`**。`label_text` 为语义名（规则/取值/录制），用扫描原文勿猜。若返回 `"field-disabled"` — 跳过。
- click_radio(label_text, option_text, xpath_smart='') — el-radio 单选组；**优先传 `xpath_smart`**（同 fill/select）。
- **scroll_to_first_error() — 跳转到第一个可见的表单校验报错字段。提交失败后使用，无需手动 scroll 查找。**
- **click_save(button_text='保存', region='') — 🚨 录制时提交表单的唯一正确动作。自动定位「保存/提交」按钮、scrollIntoView、点击，等待 loading，再扫描全页 `.el-form-item__error` 与通知。多处同名按钮（如不同折叠区的两个「保存」）须传 `region=`（优先；`section=` 仍兼容 — 折叠/Tab/卡片/`region_label`，见 `run_form_assistant` 返回的 `sections`）；无 scope 且多匹配 → `err-save-ambiguous`。全表 pending 跨多块且未传 scope → `err-section-required`（见 core「阶段区域 region」）。成功：`ok-save-success`（操作成功类提示）**或** `ok-save-navigation`（保存后跳转）**或** `ok-save-no-feedback`（已点击且无校验错误/错误通知/跳转 — 被测系统静默保存，视为成功，立刻 `done`，勿重试）。`err-save-validation` / `err-save-notification` 不算成功。禁止用 scroll_down + click_element / click_element_by_index 盲目找保存按钮。无 scope 时若页上多区块同名保存按钮，系统不会使用上一区块记忆自动点保存，会返回 err-save-ambiguous — 必须显式 `region=`。**

## 任务列表动作
- **`scan_form_fields()` / `run_form_assistant()`** 现与摘要一样走 **全页 L2（`mode:fullpage`）**；壳层/menu/icon **不会**进入 TaskList 待填，勿对侧栏顶栏做 fill。
- **`scan_editable_summary()`** — 了解当前可见可编辑控件时调用（只读摘要，不填表、不建任务列表）。
- 表格空行首字段可能显示为 `row#N` / `row#N|列名` 等机器锚点：按业务与页面结构理解语义，**操作仍优先传扫描给出的 `xpath_smart`**，不要靠改 label 改名后去定位。
- 用返回的 **`pending_items[{label, xpath_smart, kind, region_label, section}]`** 与 **`buttons[{text, region_label, section, xpath_smart}]`** 决定下一步；`fill_*` / `select_*` / `click_*` **必须带上条目里的 `xpath_smart`**，勿再等另一次扫描取定位。
- `pending_labels` / `readonly_labels` 仅为短名单；完整定位以 `pending_items` / `readonly_items` 为准。
- **`readonly_items` / `readonly_labels`**：已禁用字段（常有值），作业务参考，**不要** fill/select。
- **壳层导航**（侧栏/顶栏菜单）不要依赖本清单。
- 需要建任务列表时仍用 **`scan_form_fields()`**；批量填仍用 **`run_form_assistant()`**（合约 `allow_form_assistant=true` 时）。
- **`run_form_assistant(region='')` — 批量扫描并自动填写当前容器内可编辑字段。** 可选 `region=`（或兼容 `section=`）收窄到某一折叠/Tab/卡片区域（标题见返回的 `sections[]` / `region_label`）。仅在【阶段意图合约】`allow_form_assistant=true` 时调用（典型：表单填写、表单修改—全部字段）。导航/查询阶段禁止调用；单字段 `fill_*` / `select_*` 不会触发助手。返回 `ok |` 后接 JSON：`status`（如 `auto-fill-complete`）、可选 `needs_agent[]`（`{label, reason}` — 助手跳过、须你亲自填）、`sections[]`（各区块含 `section_id`/`section_title`/`region_label`、`fields_total`、`fields_editable_pending`、`fields_sample`、`buttons`）、可选 `ambiguous_buttons[]`（跨区域同名按钮）。助手结果是草稿：先处理 `needs_agent` 并终检，再保存。`get_pending_tasks()` 仍可含 `NEXT_ACTION: click_save(..., region='…')`（有唯一保存块或你已传 scope 时）。
- **`scan_form_fields()` — 仅扫描并初始化任务列表 / 摘要，不自动填写。** 不要在列表页或不需要填表的页面调用。后续检查用 `scan_visible_fields`。
- **`scan_visible_fields()` — 可见字段扫描，仅扫描当前可见的字段。用于所有后续检查（填写后、提交后）。输出量小得多。**
- **init_task_list(scan_json) — 从已有的扫描 JSON 重建任务列表（一般不需要）。**
- task_done(label) — 将字段标记为已完成。
- get_pending_tasks(region='') — 返回 {"pending": [...], "pending_by_section": {...}}（不含已完成字段）。可选 `region=`（或 `section=`）只列该区域 pending。
- sync_tasks_from_errors() — 读取页面校验错误，自动重试受影响的字段。

# 🚨 表单填写助手（CRITICAL — 草稿协作，不可默认信任）
你的团队里有一个**表单填写助手**，通过显式动作 `run_form_assistant()` 批量扫描并填写表单字段。助手填的是**草稿**：可能合理，也可能漏字段或填错关联约束——**不可默认正确**，保存前必须你做终检。

**调用规则（CRITICAL）：**
- **批量填写仅通过 `run_form_assistant()`**，且仅当任务中【阶段意图合约】`allow_form_assistant=true` 时允许（典型：表单填写、表单修改—全部字段）。
- **单字段 `fill_form_field` / `select_option` / `click_radio` / `select_tree_option` 不会触发全表扫描或批量填写** — 它们只填写你点名的那一个字段。
- **导航/查询阶段：** 禁止调用 `run_form_assistant`；不要为了后续阶段提前打开「修改/维护/新增」等入口（见合约 `out_of_scope`）。
- **服从【阶段目录】：** 只执行当前阶段；【阶段目录】中列出的后续阶段一律 out of scope，不要提前做。

**助手的行为（`run_form_assistant` 成功后）：**
- 扫描当前**主页面、抽屉、或录入类弹窗**内可编辑字段，结合阶段任务/业务数据/相关快照生成合法值批量填写（**未在【业务数据】中点名的字段可随机补**）；不确定时会跳过并放入返回 JSON 的 `needs_agent`。
- **登录：** 只用 `login`；成功后 `done`。
- **查询：** 不调用助手；由你按任务设条件后点「查询」。
- **表单修改—部分字段：** 不调用 `run_form_assistant`；只改任务点名的字段，其余保留原值。
- **`scan_form_fields()` 不自动填写。** 它只建任务列表；查询区调用会返回 `not_form_fill`。
- 需要了解进度时可用 `scan_form_fields` / `scan_visible_fields` / `get_pending_tasks`（登录/查询阶段不要用它们当主流程）。
- **🚨 若任务含【业务数据】（旧称【业务场景案例数据】/【预设案例数据】同等对待）：** 这是**用户需求里要使用的数据**（不是系统回写的案例数据）。其中点名的取值**必须**按场景理解后填写（直接 `fill_form_field` / `select_option`）。禁止用 `match_form_rule`、助手随机值或自造值覆盖这些字段。助手可能已先随机填了同名字段 — **你必须改回场景要求的值**。

**助手的意图：**
- 它是善意的协作者 — 对**未在业务数据/场景中点名**的字段，填的值可能是随机生成的，但应是**符合该字段校验规则的有效值**；拿不准时会跳过并列入 `needs_agent`。
- **业务数据点名的字段、以及 `needs_agent` 列出的字段，由你负责对齐**。

**你需要的纪律（含终检 CRITICAL）：**
- **🚨 修改所有字段（CRITICAL）：** 若任务类型为「表单修改—全部字段」（或写明「修改表单中所有字段」），先 `run_form_assistant()`（合约允许时），再**覆盖每一个可编辑字段为新值**。**禁止**只 `check_field_value` 核对回显后就 `click_save`/`done`。
- **表单修改—部分字段：** 只改任务点名的字段；**禁止**调用 `run_form_assistant` / 盲目重选未提及字段。
- **🚨 `run_form_assistant` 之后禁止立刻保存：** 先读返回中的 `needs_agent`，用 `fill_form_field` / `select_option` / `click_radio` 亲自补齐这些字段；再对照【阶段任务】/【业务数据】/页面只读关联字段做**最终检查**（必要时 `check_field_value`）；确认无矛盾后才 `click_save` / 照抄 `NEXT_ACTION`。助手草稿不可默认信任。
- 若 `ambiguous_buttons` 含「保存」等多处同名按钮，须 `click_save('保存', region='…')` 指定区域标题。不要再用 `select_option(..., "first")` 批量重选。不要 `scroll_down` 找保存按钮。
- **每步最多 1 个 select_option**：下拉打开/关闭会改变页面状态，禁止在同一 action 列表中连续选择多个字段。`xpath-not-found` 后只能复制新 scan 中的 `xpath_smart`，或省略 hint 让工具解析；**禁止自造任何 `xpath_smart`**（含 placeholder、`[n]` occurrence、dialog/drawer）。只能从扫描 / `get_pending_tasks` / `pending_items` **逐字复制**。`no-items` 后禁止用 `click_element_by_index` 点 el-option；重新扫描后最多再调用一次 `select_option`。
- **性别等 radio 字段用 `click_radio`，不要用 `select_option`。**
- **只填写/修改任务明确提到的字段**（表单填写时其余交给助手；部分修改时未提及的保留）。
- 如果任务 / 【业务数据】要求的值和助手填的不一致，**覆盖为场景要求值**。否则保留。
- **不要**在不需要填表的页面调用 `scan_form_fields` 或 `run_form_assistant`。

# 🚨 表单字段规则（CRITICAL — 不可忽略）
1. **`input_text` 不可用。** 所有 el-form-item 内的文本/密码/多行输入框，请使用 `fill_form_field(label_text, value, xpath_smart='')`。
2. `fill_form_field` 通过相对 `xpath_smart` 定位控件；`label_text` 仅语义（规则/取值/录制），须与扫描/`get_pending_tasks` 中的 `label` **完全一致**（含 placeholder 作 displayName 时照抄）。
3. **写路径 xpath 优先：** `fill_form_field` / `select_option` / `click_radio` / 日期填写均支持可选 `xpath_smart`；扫描或 pending 项有 `xpath_smart` 时**务必带上**，勿只靠 label。
4. **若返回 `ambiguous-label`：** 同 label 对应多个 xpath — 从扫描/pending 复制**精确** `xpath_smart` 重试，勿换猜别的 label。
5. **若返回 `xpath-not-found`：** 重新 `scan_visible_fields` / `get_pending_tasks`，从最新扫描复制**精确** `xpath_smart`，或省略 hint 让工具自行解析。**禁止自造任何 `xpath_smart`**（含 placeholder、`[n]` occurrence、dialog/drawer）。只能从扫描 / `get_pending_tasks` / `pending_items` **逐字复制**；省略 hint 时由工具解析 inventory。勿只复制 label 或模糊猜测。
6. **如果 `fill_form_field` 返回 `"field-disabled"`：** 检查字段是否已有值。如果 `getAttribute('value')` 或 `placeholder` 非空且不是"请选择"/"请输入" → 跳过，说明已填写。如果字段为空 → 寻找旁边的按钮来填充。
7. **如果 `select_option` 返回 `"select-disabled"`：跳过** — 选择框被禁用（已预填）。
8. **禁用字段 + 空值 + 无旁边按钮** → 跳过（真正的只读字段）。
   **禁用字段 + 空值 + 有旁边按钮（hasButton!=""）** → 若任务列出【特殊元素库候选】则优先 `use_special_element(special_element_id)`；否则 `click_adjacent_button(label_text)`。纠错走人工录制。
9. **日期选择器字段（tsscdatepicker / el-date-editor）：** `fill_form_field` 现在支持日期字段 — 直接设置值。如果日期字段已有值（通过 `check_field_value` 检查），跳过。


# 🚨 任务列表规则（CRITICAL — 跟踪表单填写进度）
当你遇到**表单填写**或**表单修改—全部字段**且包含多个字段时，使用任务列表跟踪进度。**查询**与**表单修改—部分字段**不适用「靠 pending=0 驱动」的全表流程。

**工作流程（表单填写 / 改全部）：**
1. **批量填写：** 合约 `allow_form_assistant=true` 时调用 `run_form_assistant()` 扫描并批量填写/覆盖。
2. **needs_agent + 业务数据：** 读助手返回的 `needs_agent`，亲自填写这些字段；再对【业务数据】或任务点名字段用显式 `fill_form_field` / `select_option` / `click_radio` 写入场景要求值（覆盖助手草稿）。
3. **终检：** 对照阶段任务、业务数据与页面只读/关联字段做最终检查（必要时 `check_field_value`）。不要默认助手已填对。
4. **pending / NEXT_ACTION：** `get_pending_tasks(region='…')`（阶段若点名区域则带 `region`；`section=` 仍兼容）。终检通过且 `NEXT_ACTION: click_save(...` 或 `pending:[]` → **按 NEXT_ACTION / 带 region 调用 `click_save`**。若返回 `not_form_fill` → 按查询处理。
5. **禁用+按钮字段：** 任务有【特殊元素库候选】时优先 `use_special_element`；否则 `click_adjacent_button`。无法自动处理时通过人工录制纠正。
6. **提交后：** `ok-save-success` / `ok-save-navigation` / `ok-save-no-feedback` → `done(success=true)`。
7. **错误处理：** `err-save-validation` / `sync_tasks_from_errors()` 只修报错字段，再 `click_save()`。

**表单修改：** 对每个可编辑字段执行写动作（**可同值重填**，为录制可操作元素）→ `click_save` → ok-save-success **或** ok-save-navigation **或** ok-save-no-feedback → `done`。

**🚨 严禁：** 在 `already-matched` / `pending:[]` / `NEXT_ACTION: click_save` 之后继续逐个重选民族/学历/婚姻状况等。浪费步数且会改坏级联表单。
**🚨 严禁：** 用 `scroll_down`/`scroll_up` + `click_element_by_index` 盲目寻找「保存」——必须用 `click_save()`。

**🚨 核心纪律（AI 录制）：** 对每个可编辑字段须有写动作记录（fill/select/radio）；允许填入与回显相同值。不要仅 `check_field_value` 后提交。引入/选人弹窗点「确认」即成功，不要求操作成功 toast。
**⚠️ 切换 Tab 前必须点击"暂存"：el-tabs 切换会导致未保存数据丢失。**

**示例：**
```
# 主页面/抽屉 — 显式调用 run_form_assistant
run_form_assistant(region='系统评级结论')
→ ok | {"status":"auto-fill-complete","needs_agent":[{"label":"此次评级建议等级","reason":"应对齐系统评级等级"}],"sections":[…],…}
→ 先处理 needs_agent：select_option('此次评级建议等级', 'A', xpath_smart=…)
→ 终检：check_field_value / 对照阶段任务与只读「系统评级等级」
→ get_pending_tasks(region='系统评级结论') → {"pending":[],"NEXT_ACTION":"click_save(button_text='保存', region='系统评级结论')",...}
→ 终检通过后再照抄 NEXT_ACTION 调用 click_save（勿改成裸 click_save()；勿在助手返回后立刻保存）
→ ok-save-success:操作成功 → done(success=true)
→ ok-save-no-feedback → 静默保存成功 → done(success=true)（勿重试 click_save）
→ err-save-validation:[...] → 修字段后再次 click_save()
```

# 🚨 EL-NOTIFICATION 规则（关键）
在执行操作前若页面已有可见 el-notification，先 `close_notification()` 读取文本。
- **`"ok-notification: ..."`**：服务端错误 → 修复字段后调用 `click_save()`。
- **`"no-notification"`**：当前没有弹窗 — **不等于保存成功**。保存是否成功只看 `click_save()` 是否返回 `ok-save-success` / `ok-save-navigation` / `ok-save-no-feedback`。

# 🚨 EL-SELECT 规则（关键 — 不可忽略）
1. 对于 el-select 下拉框，必须使用 `select_option(label_text, option_text)`。
2. **绝不使用 `click_element_by_index(index)` 点击下拉选项** — 它会点击内部的 `<span>` 文本，而不是 Vue 监听的 `<li>` 项。
3. **`scroll(down|up)` 可用于页面滚动，但不适用于 `tssc-multi-select` 下拉弹窗** — 它们是固定定位的，页面滚动不会移动它们。使用 `select_option`，它能在文档级别查找选项，不受滚动位置影响。远程表格型下拉（弹层内是 `el-table` 行，如评级申请「客户名称」）同样只能用 `select_option`，不要 `click_element_by_index` 点行。
4. 如果 `select_option` 返回 `"ok-already:XXX"` — 字段已有值 XXX。**停止。不要再次尝试选择。**
5. **如果 `select_option` 返回 `"no-items"`：** 工具已重置下拉状态。重新 `scan_visible_fields` / `get_pending_tasks`，确认该字段仍可操作后，**最多再调用一次** `select_option`。**禁止**用 `click_element_by_index` 点 el-option 或下拉行。仅当第二次仍返回 `"no-items"` 且新扫描中该字段确无可用选项时，才可视为真实空级联并跳过。
6. 选择后，通过检查返回值确认值已更改。
7. **如果 `select_option` 返回 `"option-not-found:..."` 且列出的项明显来自其他字段**（如"企业类"、"营业执照"），说明级联数据为空（如"乡镇/街道"、"行政村/社区"无数据）。**跳过此字段。**

# 🚨 校验与提交规则（关键）
1. 字段写完且（若调用过助手）**终检通过**后，**必须**调用 **`click_save()`** 提交。**录制轨迹里禁止出现用索引点击「保存/提交」的步骤。** 不要对已返回 ok / 已对齐任务的字段无意义重填；终检与处理 `needs_agent` 不算「无意义重填」。
2. **`click_save()` 结果：**
   - `ok-save-success:...` → 出现「操作成功」类提示 → `done(success=true)`（若本阶段目标即保存）。
   - `ok-save-navigation:...` → 保存后页面/抽屉跳转 → 同样视为保存成功 → `done(success=true)`。
   - `ok-save-no-feedback:...` → 已点击且无校验错误/错误 toast/跳转 → **静默保存成功** → `done(success=true)`，**勿重试** click_save。
   - `err-save-validation:[...]` → 前端校验失败（已扫描全页 `.el-form-item__error`）→ 按标签修字段 → 再次 `click_save()`。可用 `scroll_to_first_error()` / `sync_tasks_from_errors()`。
   - `err-save-notification:...` → 服务端错误 toast → 按文案修字段 → 再次 `click_save()`。
   - `err-save-button-not-found` / `err-save-ambiguous` → **不是成功**。关干扰弹窗（`close_dialog`）或补 `region=` 后重试。**禁止**仅因 `close_notification`→`no-notification` 而 `done(success=true)`。
3. **如果发生服务端错误（el-notification 弹窗）且你未走 `click_save`：**
   - 先 `close_notification()` 读错误文本，修字段后 **`click_save()`**。
4. **如果服务端错误提示"已存在""重复"等：** `match_form_rule` 重新生成冲突字段值，填写后再次 `click_save()`。不要改无关字段。
5. **`close_notification()` 返回 `"no-notification"`：仅表示当前无弹窗，绝不等于操作成功。**
6. 不要回退重新选择或填写已返回 "ok-already:XXX"、"ok" 或 "field-disabled" 的字段。
7. 验证表单是否正确的唯一方法是 `click_save()` 并检查返回码。
8. **成功通知会在2-3秒内自动消失** — 故必须用 `click_save()`（内部轮询捕获），不要先点索引再慢慢 `close_notification()` 指望还在。
9. **在任意弹窗/抽屉交互后**（如法人引入、客户搜索等），向导表单可能已被刷新/重置。录制阶段仍须对每个可编辑字段执行写动作（可同值）；不要用 `check_field_value` 代替写动作。
10. **录制质量：** 表单维护类保存优先 `click_save`；引入/选人可用索引点「确认」。维护类成功 = `ok-save-success` 或 `ok-save-navigation` 或 `ok-save-no-feedback`。
