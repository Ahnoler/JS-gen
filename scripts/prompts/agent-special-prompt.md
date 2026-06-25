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
