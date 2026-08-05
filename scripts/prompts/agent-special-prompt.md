# 🚨 特殊场景规则

## 禁用字段字段规则
1. **禁用字段 + 旁边有"引入"/"选择"按钮**：
   - 若任务列出【特殊元素库候选】且匹配该字段流程 → `use_special_element(special_element_id)`
   - 否则 → `click_adjacent_button(label_text)`
   - 流程失败或需纠正 → 人工录制纠正

## 🚨 法人类字段辅助填写（"引入"按钮 → 客户放大镜弹窗）

**前提条件：用户已通过 case_data_store 或 commandValue 提供了可搜索的法人数据（如客户名称、证件号码）。**

当法人相关字段（如"法定代表人"等）旁边出现文本为"引入"的按钮时，该按钮用于打开**客户放大镜弹窗**，通过搜索选择已有法人客户来回填字段。

**判断流程：**

```
# 0. 先检查是否有用户提供的数据
name = read_case_data("法人_客户名称") or read_case_data("客户名称")
idno = read_case_data("法人_证件号码") or read_case_data("证件号码")

if 无用户数据 (name 和 idno 都为空):
  # 无法自行搜索
  → 若任务有【特殊元素库候选】匹配引入流程 → use_special_element(...)
  → 否则 click_adjacent_button("法定代表人")
  → 仍失败 → click_save() 触发校验 → sync_tasks_from_errors()；必要时人工录制纠正

if 有用户数据:
  # 按用户提供的数据执行搜索引入流程
  check = click_adjacent_button("法定代表人")
  if check == "ok-clicked":
    wait(1000)
    fill_form_field("客户名称", name)
    click 查询 按钮
    wait(1000)
    wait_for_loading()

    if 表格有结果:
      click_table_row_radio("first")
      wait(200)
      click 确认 按钮
      wait(200)
    else:
      # 搜索无结果 → 关闭弹窗
      close_dialog()
      → 若有【特殊元素库候选】→ use_special_element(...)
      → 否则 click_adjacent_button("法定代表人")
      → click_save() 触发校验（禁止用索引点「保存」）→ sync_tasks_from_errors()
```

**注意**：
- **前提：本规则仅在用户通过 case_data_store 提供了可靠搜索数据时生效。无数据则优先特殊元素候选或 `click_adjacent_button`，失败时人工录制纠正。**
- "引入"按钮可能不在法定代表人字段所在的 .el-form-item 内，而是在**相邻**的 .el-form-item 中（如放在"证件号码"旁但影响姓名/证件类型/证件号码三个字段）。`click_adjacent_button` 已自动扩大搜索范围
- 弹窗内搜索字段标签可能与主表单不同（弹窗用"客户名称"，主表单用"法定代表人"），按弹窗中的实际标签填写
- case_data 优先使用带 `法人_` 前缀的 key，不存在则回退到无前缀版本
- 结果表格有多条时选第一条即可，只需引入一条可用记录
- 引入后回填字段为 readonly/disabled，**不要尝试修改或重新填写**
- 查询无结果时：先尝试仅用客户名称或仅用证件号码重试一次。仍无结果 → 关闭弹窗 → 特殊元素候选或 `click_adjacent_button` → **`click_save()`** 触发校验 → sync_tasks_from_errors()。**禁止** `click_element` / 索引点击「保存」。

## 📱 手机号验证规则

当字段标签包含"手机"、"手机号"、"手机号码"、"联系号码"，且旁边有"验证"按钮时：
1. 先填写手机号：`fill_form_field("财务部联系人手机号码（短信通知）", "13912345678")`（使用随机生成的合法手机号）
2. 填写成功后，点击"验证"按钮：`click_adjacent_button("财务部联系人手机号码（短信通知）")`
3. 等待验证结果（可能出现 loading 或 notification）
