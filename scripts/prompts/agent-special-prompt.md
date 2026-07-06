# 🚨 特殊场景规则

## 禁用字段字段规则
1. **禁用字段 + 旁边有"引入"/"选择"按钮**：
   - 如果该字段在 sync_tasks_from_errors 返回中标记为 NEEDS_INTERVENTION：
     暂停并向用户报告，等待用户提供特殊填写流程方案。
   - 如果用户已提供方案：按方案执行：
     - 点击按钮打开导入弹窗
     - 读取法人数据：`name = read_case_data("法人_客户名称")`
     - 填写弹窗搜索框：`fill_form_field("客户名称", name)`
     - 点击查询，使用 `click_table_row_radio("first")` 选择第一条结果
     - 确认弹窗。

## 🚨 法人类字段辅助填写（"引入"按钮 → 客户放大镜弹窗）

**前提条件：用户已通过 case_data_store 或 commandValue 提供了可搜索的法人数据（如客户名称、证件号码）。**

当法人相关字段（如"法定代表人"等）旁边出现文本为"引入"的按钮时，该按钮用于打开**客户放大镜弹窗**，通过搜索选择已有法人客户来回填字段。

**判断流程：**

```
# 0. 先检查是否有用户提供的数据
name = read_case_data("法人_客户名称") or read_case_data("客户名称")
idno = read_case_data("法人_证件号码") or read_case_data("证件号码")

if 无用户数据 (name 和 idno 都为空):
  # 无法自行搜索 → 直接走干预路径
  → 点击【保存】触发校验
  → sync_tasks_from_errors()
  → NEEDS_INTERVENTION → request_intervention(label)
  → 向用户报告："字段 'XXX' 需要从已有法人客户引入数据，但未提供搜索条件。请提供客户名称或证件号码以便搜索引入。"

if 有用户数据:
  # 按用户提供的数据执行搜索引入流程
  check = click_adjacent_button("法定代表人")
  if check == "clicked":
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
      # 搜索无结果 → 关闭弹窗 → 走干预路径
      close_dialog()
      → 点击【保存】 → sync_tasks_from_errors()
      → NEEDS_INTERVENTION → request_intervention(label)
```

**注意**：
- **前提：本规则仅在用户通过 case_data_store 提供了可靠搜索数据时生效。无数据则跳过引入流程，直接走干预路径。**
- "引入"按钮可能不在法定代表人字段所在的 .el-form-item 内，而是在**相邻**的 .el-form-item 中（如放在"证件号码"旁但影响姓名/证件类型/证件号码三个字段）。`click_adjacent_button` 已自动扩大搜索范围
- 弹窗内搜索字段标签可能与主表单不同（弹窗用"客户名称"，主表单用"法定代表人"），按弹窗中的实际标签填写
- case_data 优先使用带 `法人_` 前缀的 key，不存在则回退到无前缀版本
- 结果表格有多条时选第一条即可，只需引入一条可用记录
- 引入后回填字段为 readonly/disabled，**不要尝试修改或重新填写**
- 查询无结果时：先尝试仅用客户名称或仅用证件号码重试一次。仍无结果 → 关闭弹窗 → 点击【保存】触发校验 → sync_tasks_from_errors() → NEEDS_INTERVENTION → request_intervention(label)

## 📱 手机号验证规则

当字段标签包含"手机"、"手机号"、"手机号码"、"联系号码"，且旁边有"验证"按钮时：
1. 先填写手机号：`fill_form_field("财务部联系人手机号码（短信通知）", "13912345678")`（使用随机生成的合法手机号）
2. 填写成功后，点击"验证"按钮：`click_adjacent_button("财务部联系人手机号码（短信通知）")`
3. 等待验证结果（可能出现 loading 或 notification）
