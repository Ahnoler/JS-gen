# 🚨 特殊场景规则

## 禁用字段字段规则
1. **禁用字段 + 旁边有"引入"/"选择"按钮**：点击按钮打开导入弹窗，然后：
   - 读取法人数据：`name = read_case_data("法人_客户名称")`
   - 填写弹窗搜索框：`fill_form_field("客户名称", name)`
   - 点击查询，使用 `click_table_row_action("first", "确认")` 选择第一条结果
   - 确认弹窗。


## 特殊情况

** "引入"法定代表人：**
法人数据在早期阶段使用上下文前缀 key 保存：

```
# 早期阶段（个人客户搜索）：使用前缀保存
save_case_data("法人_客户名称", name_from_search_result)
save_case_data("法人_证件号码", id_from_search_result)
save_case_data("法人_客户编号", number_from_search_result)
```

在"引入"弹窗中：
```
# 通过带前缀的 key 读取 — 获取的是法人信息，而非对公客户
name = read_case_data("法人_客户名称")   → "测试人员某"
id_no = read_case_data("法人_证件号码")  → "123456..."

# 填写弹窗搜索框（通常标签为"客户名称"）
fill_form_field("客户名称", name)

# 点击查询，选择第一行，点击确认
点击 查询
click_table_row_action("first", "确认")
```

## 🚨 地址类字段辅助填写（"选择"/"获取地址"按钮）

当地址类字段（如"登记注册地址"、"住所地"等）旁边出现文本为"选择"或"获取地址"的按钮时，该按钮用于打开**五级地址联动弹窗**辅助填写。操作流程：

```
# 1. 检查字段是否已有值 — 已有则跳过
check = click_adjacent_button("登记注册地址")
# 返回 "clicked" → 继续；"already-filled" → 跳过

if check == "clicked":
  # 2. 等待地址弹窗打开
  wait(1000)

  # 3. 逐级选择地址（省→市→区→乡镇→村）
  # 每选一级后等待级联数据加载
  select_option("省份", "福建省")
  wait(500)
  select_option("城市", "福州市")
  wait(500)
  select_option("区县", "鼓楼区")
  wait(500)
  select_option("乡镇/街道", "某某街道")
  wait(500)
  select_option("村/社区", "某某社区")
  wait(500)

  # 4. 填写详细地址文本输入框
  fill_form_field("详细地址", "XX路XX号XX大厦XX层")
  wait(500)

  # 5. 点击确认按钮关闭弹窗
  click 确定/确认 按钮  # 弹窗内最后一个 el-button--primary
  wait(1000)

  # 6. 弹窗关闭后地址已自动回填（readonly），不要手动修改
```

**注意**：
- 五级地址可能是 el-cascader 或多个级联 el-select，选完一级必须等下一级加载再选
- 详细地址的输入框标签可能是"详细地址"、"门牌号"等，用 fill_form_field 按实际标签填写
- 确认按钮文本可能含空格（"确 定"），用 `includes("确定")` 查找
- **如果 click_adjacent_button 返回 "already-filled"** → 字段已有值，不要重复点击
- 弹窗关闭后地址字段为 readonly，不要尝试修改其 value

## 🚨 法人类字段辅助填写（"引入"按钮 → 客户放大镜弹窗）

当法人相关字段（如"法定代表人"等）旁边出现文本为"引入"的按钮时，该按钮用于打开**客户放大镜弹窗**，通过搜索选择已有法人客户来回填字段。

```
# 1. 先检查字段是否已有值
check = click_adjacent_button("法定代表人")
# click_adjacent_button 会在当前及相邻 .el-form-item 中查找"引入"按钮
# 返回 "clicked" → 继续；"already-filled" → 跳过

if check == "clicked":
  # 2. 等待客户放大镜弹窗打开
  wait(1000)

  # 3. 读取 case_data 中的法人信息填写搜索条件
  # 优先使用带"法人_"前缀的 key（避免与对公客户数据冲突）
  name = read_case_data("法人_客户名称")
  if not name: name = read_case_data("客户名称")
  id_no = read_case_data("法人_证件号码")
  if not id_no: id_no = read_case_data("证件号码")

  # 4. 填写搜索框
  fill_form_field("客户名称", name)
  # 如果有证件号码字段也填上
  if id_no: fill_form_field("证件号码", id_no)
  # 如果有 el-select 下拉（证件类型、客户状态等），用 select_option 选
  # select_option("证件类型", "身份证")
  # select_option("客户状态", "正常")
  wait(500)

  # 5. 点击"查询"按钮
  click 查询 按钮
  wait(800)

  # 6. 等待结果表格加载完成
  # 使用 wait_for_loading() 等待加载遮罩消失

  # 7. 选中结果表格第一行
  click_table_row_action("first", "确认")  # 或使用 click 表格第一行中的 radio/checkbox
  wait(500)

  # 8. 点击弹窗"确认"按钮关闭并回填法人数据
  click 确认 按钮  # el-dialog__footer 中的 el-button--primary
  wait(1000)

  # 9. 弹窗关闭后法人数据已回填（姓名、证件类型、证件号码等均为 readonly）
  # 不要尝试修改这些字段的值
```

**注意**：
- "引入"按钮可能不在法定代表人字段所在的 .el-form-item 内，而是在**相邻**的 .el-form-item 中（如放在"证件号码"旁但影响姓名/证件类型/证件号码三个字段）。`click_adjacent_button` 已自动扩大搜索范围
- 弹窗内搜索字段标签可能与主表单不同（弹窗用"客户名称"，主表单用"法定代表人"），按弹窗中的实际标签填写
- case_data 优先使用带 `法人_` 前缀的 key，不存在则回退到无前缀版本
- 结果表格有多条时选第一条即可，只需引入一条可用记录
- 引入后回填字段为 readonly/disabled，**不要尝试修改或重新填写**
- 如果查询无结果（表格为空），尝试更换搜索条件（只用客户名称或只用证件号码）重新查询。仍无结果则关闭弹窗并报告"未找到匹配的法人数据"
