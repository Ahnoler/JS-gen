# Trajectory Context Data Passing — TODO

## 目标
在 Trajectory History Tab 的 Action View 中，实现 action 之间的上下文数据传递机制。

## 设计思路

### 核心模型
在 JSON 顶层新增 `context` 字段，存储全局键值对：

```json
{
  "context": { "userName": "admin", "phone": "13800138000" },
  "tests": [{ "commands": [...] }]
}
```

### 功能点

1. **Context Panel**
   - Action View 中新增可折叠的 "Context Variables" 区域
   - 显示 key-value 表格（Variable Name | Value | Actions）
   - 底部 "+ Add Variable" 按钮

2. **变量引用**
   - action value 字段支持 `\${variableName}` 语法引用 context
   - 渲染时解析为实际值，可视化标记（hover tooltip 显示解析值）

3. **变量输出**
   - 每个 action card 底部新增 "Store output as" 输入框
   - 填入 context key 后，执行结果存入 context
   - 后续 action 可通过 `${key}` 引用

4. **数据流示意**

   ```
   Context: { userName: "admin" }
       │
       ├─ Action #1: fill_form_field(L"用户名", V="${userName}")
       │   └─ 渲染时解析 → "admin"
       │
       ├─ Action #2: go_to_url("http://example.com")
       │
       └─ Action #3: fill_form_field(L"手机号", V="13800138000")
           └─ "Store output as" = "phoneNumber"
              → 执行后: Context.phoneNumber = "13800138000"
   ```

### 涉及文件

| 文件 | 改动 |
|------|------|
| `src/dashboard/trajectory.js` | Context Panel 渲染 + 变量引用解析 + "Store output as" 字段 + 保存逻辑扩展 |
| `test-dashboard.html` | Context Panel 容器元素（可选） |
| `test-dashboard.css` | Context Panel 样式 |

### 优先级
- [ ] Context Panel UI（展示 key-value 表格）
- [ ] 变量引用解析（\${var} 语法）
- [ ] "Store output as" 字段
- [ ] 保存/加载 context 数据
