---
name: atp-ui
description: |
  Playwright script generation knowledge base for Element UI / Vue apps. Covers best practices for interacting with all Element UI components (el-form, el-table, el-dialog, el-tree, el-menu, el-select, el-date-picker, etc.) in Playwright automation. Use when playwright-skill needs to generate robust scripts for Element UI-based web applications.
---

# Playwright 脚本生成 — Element UI 前端页面自动化知识库

本文档覆盖在 Element UI（Vue 2/3）前端网页上使用 Playwright 进行自动化时的所有注意事项。涉及从页面诊断、元素定位、表单填写到各组件交互的完整知识体系。

**核心问题**：Element UI 组件基于 Vue 的响应式系统，直接在 DOM 上操作（如 `page.fill()`、`element.value = X`）往往无法触发 v-model 更新，导致值被覆盖、校验不通过等问题。必须通过原生 setter + 冒泡事件或真实用户交互来驱动。

---

## 1. 诊断：确定页面使用的 UI 框架

**不要假定页面使用 Element UI**。写脚本前先执行诊断：

```javascript
const diag = await page.evaluate(() => {
  const frameworks = [];
  if (document.querySelector('.el-input, .el-form, .el-dialog, .el-button, .el-table, .el-menu, .el-tree')) frameworks.push('Element UI');
  if (document.querySelector('.n-input, .n-form, .n-dialog, .n-button')) frameworks.push('Naive UI');
  if (document.querySelector('.ant-input, .ant-form, .ant-modal, .ant-btn')) frameworks.push('Ant Design');
  if (document.querySelector('.ivu-input, .ivu-form, .ivu-modal, .ivu-btn')) frameworks.push('iView');
  return frameworks;
});
console.log('UI Frameworks:', JSON.stringify(diag));
```

---

## 2. 核心原则

### 2.1 不要使用 page.fill()

在 Element UI / Naive UI 等 Vue 组件场景下，**必须放弃** `page.fill()` / `locator.fill()`。改用 `page.evaluate()` 通过原生 DOM API 操作。

### 2.2 DOM 引用必须每次重新查询

Element UI 的 `el-dialog`、`el-drawer`、`el-table` 等组件可能被 Vue 框架异步销毁重建。缓存的引用会失效。

```javascript
// ✅ 正确：每次操作都重新查找
const exists = await page.evaluate(() => !!document.querySelector('.el-dialog'));

// ❌ 错误：缓存引用（Vue 可能重建 DOM）
const cached = await page.$('.el-dialog');
```

### 2.3 每步之间加等待

```javascript
await page.evaluate(() => { /* 操作 A */ });
await page.waitForTimeout(500);  // 给 Vue 响应式更新留时间
await page.evaluate(() => { /* 操作 B */ });
```

### 2.4 操作后验证

填写/操作完成后，回读值确认成功：
```javascript
const ok = await page.evaluate(() => {
  const input = document.querySelector('.el-input__inner');
  return input?.value === '期望值';
});
console.log(ok ? '✓ 验证通过' : '⚠ 验证失败');
```

### 2.5 事件必须冒泡

```javascript
// ✅ 正确
input.dispatchEvent(new Event('input', { bubbles: true }));

// ❌ 错误
input.dispatchEvent(new Event('input')); // 默认不冒泡
```

**原因**：Vue 的 v-model 通过事件委托监听，不冒泡则无法感知。

---

## 3. 元素定位策略

### 3.1 优先用 label 文本定位

```javascript
// 通过 el-form-item 的 label 找到关联输入框
const input = document.querySelector(
  '.el-form-item:has(.el-form-item__label:contains("姓名")) input'
);
```

### 3.2 用 placeholder 定位

```javascript
const input = document.querySelector('input[placeholder*="请输入姓名"]');
```

### 3.3 用 class + 上下文组合定位

```javascript
// 在指定表格行内查找图标按钮
const row = document.querySelector('.el-table__row:has(td:contains("目标行"))');
const btn = row?.querySelector('i.el-icon-edit, button.el-button--primary');
```

### 3.4 避免多步联动查找

单次 evaluate 中完成"找容器→找元素→操作"全流程，不依赖中间 Playwright 状态判断。

---

## 4. el-table（表格）交互

### 4.1 点击某行中的操作按钮

```javascript
await page.evaluate(() => {
  const rows = document.querySelectorAll('.el-table__body-wrapper .el-table__row');
  for (const row of rows) {
    if (row.textContent.includes('目标行标识')) {
      const btn = row.querySelector('button.el-button--primary, button:has-text("编辑")');
      if (btn && btn.offsetParent !== null) { btn.click(); return true; }
    }
  }
  return false;
});
await page.waitForTimeout(500);
```

### 4.2 获取表格数据

```javascript
const tableData = await page.evaluate(() => {
  const rows = document.querySelectorAll('.el-table__body-wrapper .el-table__row');
  return Array.from(rows).map(row => {
    const cells = row.querySelectorAll('.el-table__cell, td');
    return Array.from(cells).map(cell => cell.textContent.trim());
  });
});
```

### 4.3 checkbox 行选中

```javascript
await page.evaluate(() => {
  const row = [...document.querySelectorAll('.el-table__row')]
    .find(r => r.textContent.includes('目标行'));
  const checkbox = row?.querySelector('.el-checkbox__input .el-checkbox__inner');
  if (checkbox) checkbox.click();
});
```

### 4.4 分页（el-pagination）切换

```javascript
await page.evaluate(() => {
  const pagination = document.querySelector('.el-pagination');
  if (!pagination) return;
  // 点击下一页
  const nextBtn = pagination.querySelector('.btn-next');
  if (nextBtn && !nextBtn.classList.contains('disabled')) nextBtn.click();
});
await page.waitForTimeout(800);
```

---

## 5. el-dialog / el-drawer（弹窗/抽屉）处理

### 5.1 等待打开

```javascript
await page.waitForSelector('.el-dialog', { state: 'visible', timeout: 5000 });
// 或
const opened = await page.evaluate(() => {
  const dialog = document.querySelector('.el-dialog');
  return dialog && dialog.offsetParent !== null;
});
```

### 5.2 判断弹窗是否已打开（避免重复触发）

```javascript
const dialogOpen = await page.evaluate(() => {
  const d = document.querySelector('.el-dialog[style*="display: block"], .el-dialog:not([style*="display: none"])');
  return d && d.offsetParent !== null;
});
```

### 5.3 弹窗内操作（DOM 可能被重建）

```javascript
// 每次操作都重新 querySelector
await page.evaluate(() => {
  const dialog = document.querySelector('.el-dialog');
  if (!dialog) throw new Error('弹窗未打开');
  const input = dialog.querySelector('.el-input__inner');
  // ... 操作
});
```

### 5.4 关闭弹窗

```javascript
await page.evaluate(() => {
  // 点右上角 X
  const close = document.querySelector('.el-dialog__headerbtn .el-dialog__close');
  if (close) { close.click(); return; }
  // 或点取消按钮
  const cancel = document.querySelector('.el-dialog__footer .el-button--default');
  if (cancel) cancel.click();
});
```

### 5.5 等待弹窗关闭

```javascript
await page.waitForSelector('.el-dialog', { state: 'hidden', timeout: 5000 });
// 或
await page.evaluate(() => new Promise(resolve => {
  const check = () => {
    const d = document.querySelector('.el-dialog');
    if (!d || d.offsetParent === null) resolve();
    else setTimeout(check, 200);
  };
  check();
}));
```

---

## 6. el-menu（菜单）导航

### 6.1 点击左侧菜单项

```javascript
await page.evaluate(() => {
  const menu = document.querySelector('.el-menu');
  if (!menu) return false;
  const items = menu.querySelectorAll('.el-menu-item, .el-submenu__title');
  for (const item of items) {
    const text = item.textContent.trim();
    if (text === '目标菜单名' && item.offsetParent !== null) {
      // 先展开父级菜单（如果被折叠）
      const submenu = item.closest('.el-submenu');
      if (submenu) {
        const expand = submenu.querySelector('.el-submenu__title');
        if (expand) expand.click();
        await new Promise(r => setTimeout(r, 300));
      }
      item.click();
      return true;
    }
  }
  return false;
});
```

### 6.2 处理子菜单展开

```javascript
await page.evaluate(() => {
  const submenu = [...document.querySelectorAll('.el-submenu')]
    .find(sm => sm.querySelector('.el-submenu__title')?.textContent.includes('父菜单'));
  if (submenu && !submenu.classList.contains('is-opened')) {
    submenu.querySelector('.el-submenu__title').click();
  }
});
await page.waitForTimeout(500);
```

### 6.3 通过菜单位置消歧

当同一文字在页面多处出现时，用位置约束：

```javascript
await page.evaluate(() => {
  const candidates = document.querySelectorAll('.el-menu-item');
  for (const el of candidates) {
    if (el.textContent.trim() === '目标项') {
      const rect = el.getBoundingClientRect();
      if (rect.x < window.innerWidth * 0.3) { // 左侧菜单区域
        el.click();
        return 'clicked-menu';
      }
    }
  }
  return 'not-found';
});
```

---

## 7. el-tree（树形组件）

### 7.1 展开树节点

点击 `.el-tree-node__expand-icon` 而非节点文本：

```javascript
await page.evaluate(() => {
  const tree = document.querySelector('.el-tree');
  if (!tree) return false;
  const nodes = tree.querySelectorAll('.el-tree-node');
  for (const node of nodes) {
    const label = node.querySelector(':scope > .el-tree-node__content .el-tree-node__label');
    const text = label?.textContent?.trim();
    if (text?.includes('目标节点') && !node.classList.contains('is-expanded')) {
      node.querySelector(':scope > .el-tree-node__content .el-tree-node__expand-icon')?.click();
      return true;
    }
  }
  return false;
});
```

### 7.2 选中树节点

```javascript
await page.evaluate(() => {
  const node = [...document.querySelectorAll('.el-tree-node')]
    .find(n => n.querySelector('.el-tree-node__label')?.textContent?.trim() === '目标节点');
  node?.querySelector(':scope > .el-tree-node__content .el-tree-node__label')?.click();
});
```

---

## 8. el-tabs（标签页）切换

```javascript
await page.evaluate(() => {
  const tabs = document.querySelectorAll('.el-tabs__item');
  for (const tab of tabs) {
    if (tab.textContent.trim() === '目标标签页' && tab.offsetParent !== null) {
      tab.click();
      return true;
    }
  }
  return false;
});
await page.waitForTimeout(500);
```

---

## 9. el-message / el-notification（消息提示）

### 9.1 检测成功/错误消息

```javascript
const message = await page.evaluate(() => {
  const msg = document.querySelector('.el-message');
  const notif = document.querySelector('.el-notification');
  return {
    message: msg ? msg.textContent.trim() : null,
    notification: notif ? notif.textContent.trim() : null,
  };
});
```

### 9.2 等待消息出现并消失

```javascript
// 等待消息出现
await page.waitForSelector('.el-message', { timeout: 5000 });
const text = await page.evaluate(() => document.querySelector('.el-message')?.textContent?.trim());
console.log('消息:', text);
// 等待消息消失
await page.waitForSelector('.el-message', { state: 'detached', timeout: 5000 });
```

### 9.3 el-notification 右侧弹窗：读取错误信息后关闭

表单验证失败时，页面右上角会出现 `.el-notification right` 浮动提示，列出所有未填写的必填项（可点击定位）。agent **必须先记录错误列表，再手动关闭弹窗**，然后根据错误列表填写对应字段。

```javascript
// 1. 检测右侧通知是否存在并读取所有错误项
const notifInfo = await page.evaluate(() => {
  const n = document.querySelector('.el-notification');
  if (!n) return null;
  const title = n.querySelector('.el-notification__title')?.textContent?.trim() || '';
  const text = n.querySelector('.el-notification__content')?.textContent?.trim() || '';
  // 提取每条错误（格式: "字段名 - 错误描述"）
  const errors = [...n.querySelectorAll('.error-clickable')].map(el => el.textContent.trim());
  return { title, text, errors };
});

if (notifInfo) {
  console.log('错误通知标题:', notifInfo.title);
  console.log('错误项列表:', notifInfo.errors);
  // 错误列表可用于确定下一步需填写的字段

  // 2. 关闭通知（点 X 按钮）
  await page.evaluate(() => {
    const close = document.querySelector('.el-notification .el-notification__closeBtn');
    if (close) close.click();
  });
  await page.waitForTimeout(300);
}
```

**注意**：
- `el-notification` **不会自动消失**，必须手动关闭。它与 `el-message`（居中顶部，几秒后自动消失）是两种不同的组件，两者都要检查。
- 通知中的错误项（`.error-clickable`）可点击定位到对应字段，agent 可直接读取文本了解哪些字段需要补充。
- 关闭通知后，按错误列表中的字段名逐一调用 `fill_form_field` 或 `select_option` 补填。


---

## 10. el-loading / v-loading（加载状态）

```javascript
// 等待加载指示器消失
await page.evaluate(() => new Promise(resolve => {
  const check = () => {
    const loading = document.querySelector('.el-loading-mask');
    if (!loading || loading.classList.contains('el-loading-mask--hidden')) resolve();
    else setTimeout(check, 200);
  };
  check();
}));
```

---

## 11. el-date-picker（日期选择器）

```javascript
await page.evaluate(() => {
  const input = document.querySelector(
    '.el-form-item:has(.el-form-item__label:contains("日期")) .el-date-editor input'
  );
  if (!input) return;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  setter.call(input, '2025-01-15');
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
  input.dispatchEvent(new Event('blur', { bubbles: true }));
});
```

---

## 12. el-upload（文件上传）

```javascript
// Element UI 的 el-upload 底层是 <input type="file">
// 使用 Playwright 的 setInputFiles
const [fileChooser] = await Promise.all([
  page.waitForEvent('filechooser'),
  page.click('.el-upload .el-upload__input'),
]);
await fileChooser.setFiles('path/to/file.pdf');
await page.waitForTimeout(2000); // 等待上传完成
```

---

## 13. el-cascader（级联选择器）

```javascript
// 1. 点击触发下拉
await page.evaluate(() => {
  document.querySelector('.el-cascader .el-input__inner')?.click();
});
await page.waitForTimeout(500);

// 2. 依次选择各级选项
await page.evaluate(() => {
  const items = document.querySelectorAll('.el-cascader-menu__item');
  for (const item of items) {
    if (item.textContent.trim() === '一级选项') {
      item.click();
      return true;
    }
  }
  return false;
});
await page.waitForTimeout(500);

// 3. 选二级选项
await page.evaluate(() => {
  const items = document.querySelectorAll('.el-cascader-menu__item');
  for (const item of items) {
    if (item.textContent.trim() === '二级选项') {
      item.click();
      return true;
    }
  }
  return false;
});
```

### 13.1 地址选择器：通过 placeholder 变化判断选中状态

地址选择器（省市区三级联动）的输入框在未选择时：

```html
<input type="text" autocomplete="off" placeholder="请选择" class="el-input__inner" readonly="readonly">
```

选择完成后变为（`readonly` 移除，`placeholder` 变成已选省份名）：

```html
<input type="text" autocomplete="off" placeholder="福建省" class="el-input__inner">
```

agent **不要检查 value**，而是通过 `placeholder` 推断选中状态：
- `placeholder === "请选择"` → 未选择，需要打开选择器
- `placeholder !== "请选择"` → 已选中，无需再操作

```javascript
const addrState = await page.evaluate(() => {
  const input = document.querySelector(
    '.el-form-item:has(.el-form-item__label:contains("地址")) .el-input__inner'
  );
  if (!input) return null;
  return { placeholder: input.placeholder, readonly: input.hasAttribute('readonly') };
});

if (addrState && addrState.placeholder === '请选择') {
  // 未选择，需要通过相邻按钮打开地址选择器
} else {
  console.log('地址已选中:', addrState?.placeholder);
}
```

**注意**：地址选择器输入框通常是 `readonly` 的，不能直接 setter 赋值。它常与 §14.10 的"相邻按钮"模式配合——点击输入框的下一个兄弟按钮打开地址树弹窗。弹窗中的下拉选择按 §14.6 的策略执行。


---

## 14. 表单填写（详细指南）

> 以下内容继承自原表单填写技能，已整合为脚本生成知识库的一部分。

### 14.0 前置检查：先读当前值，确认未填再动手

agent 在操作任何字段前，**必须先读当前值**。只有确认字段**既为必填又未填**时才执行操作。

**判断规则**（按字段类型）：

| 字段类型 | 读取方式 | 已填标志 | 未填标志 |
|---------|---------|---------|---------|
| 文本输入 `el-input` | `input.value` | 非空字符串 | `""` |
| 文本域 `el-textarea` | `textarea.value` | 非空字符串 | `""` |
| 下拉选择 `el-select` | `input.value \|\| input.placeholder` | 非空且非初始值 | `""` 或 `"请选择"` |
| 相邻按钮选择器（§14.10） | `input.placeholder` | 不是 `"请选择"` | `"请选择"` |

```javascript
function isFieldFilled(input) {
  if (!input) return true; // 不存在则视为已填
  const v = (input.value || '').trim();
  const p = (input.placeholder || '').trim();
  // el-select / 地址选择器：看 placeholder 是否从"请选择"变成了实际内容
  if (p && p !== '请选择' && p !== '请输入') return true;
  // 文本输入框：看 value 是否非空
  if (v) return true;
  return false;
}

// 扫描待填字段
const fieldsToFill = await page.evaluate(() => {
  const items = document.querySelectorAll('.el-form-item.is-required');
  const result = [];
  for (const item of items) {
    const label = item.querySelector('.el-form-item__label')?.textContent?.trim() || '';
    const input = item.querySelector('.el-input__inner, .el-textarea__inner');
    if (!input) continue;
    if (isFieldFilled(input)) continue; // 已有值，跳过
    const errorText = item.querySelector('.el-form-item__error')?.textContent?.trim() || '';
    result.push({ label, errorText });
  }
  return result;
});

console.log('待填写字段:', fieldsToFill.map(f =>
  `${f.label}${f.errorText ? ` (${f.errorText})` : ''}`
));
```

**注意**：
- 只处理 `class` 中包含 `is-required` 的 `.el-form-item`
- 前置检查**必须**放在每次操作之前，确认字段未填再动手
- 文本输入框看 `value`，下拉/地址选择器看 `placeholder`——前者存用户输入的值，后者在选中后会被替换为实际内容
- 跳过条件优先用 `value` 非空；`value` 为空但 `placeholder` 不是初始值的，也视为已选中


### 14.1 核心原因：Vue v-model 劫持

`page.fill()` 在 Element UI 输入框中经常失效，原因是 Vue 的 v-model 通过 getter/setter 劫持了 input 的 value 属性。直接设置 `.value = X` 不会触发 Vue 的响应式更新。

### 14.2 原生 setter 策略

```javascript
const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
setter.call(input, '目标值');
input.dispatchEvent(new Event('input', { bubbles: true }));
input.dispatchEvent(new Event('change', { bubbles: true }));
input.dispatchEvent(new Event('blur', { bubbles: true })); // 触发表单校验
```

### 14.3 ⚠️ 不要先清空再赋值

**已被证实的坑**：先 `setter('')` → dispatch `input` → 再 `setter('X')` 在预填场景下会导致 Vue 把字段彻底清空。

**原因**：弹窗已有预填值 "X"，先清空为 "" 触发 input 事件，Vue 响应式模型变为 ""；再赋值为 "X" 时，Vue 已通过上一轮 input 将模型置为 ""，可能触发 watch/渲染覆盖导致最终值为 ""。

**解决方案：直接赋值，不清空。**

```javascript
// ✅ 正确：直接设目标值
setter.call(input, '目标值');
input.dispatchEvent(new Event('input', { bubbles: true }));
input.dispatchEvent(new Event('change', { bubbles: true }));

// ❌ 错误：先清空再赋值（预填值 = 目标值 → 结果变 ""）
setter.call(input, '');
input.dispatchEvent(new Event('input', { bubbles: true }));
setter.call(input, '目标值');  // Vue 可能已覆盖
input.dispatchEvent(new Event('input', { bubbles: true }));
```

### 14.4 el-input（文本输入框）

**对于 agent 在线操作**：使用自定义动作 `fill_form_field(label_text, value)`。输入框可能在 `.tsscInput` 等自定义包装内，`fill_form_field` 内部自动处理。

**对于 Playwright 脚本**：使用原生 setter 策略。

```javascript
await page.evaluate(() => {
  const el = document.querySelector(
    '.el-form-item:has(.el-form-item__label:contains("字段名")) .el-input__inner'
  );
  if (!el) return;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  setter.call(el, '值');
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  el.dispatchEvent(new Event('blur', { bubbles: true }));
});
```

### 14.5 el-input type="textarea"

```javascript
await page.evaluate(() => {
  const el = document.querySelector(
    '.el-form-item:has(.el-form-item__label:contains("备注")) .el-textarea__inner'
  );
  if (!el) return;
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
  setter.call(el, '文本内容');
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  el.dispatchEvent(new Event('blur', { bubbles: true }));
});
```

### 14.6 el-select（下拉选择）

**🚨 严禁使用 `click_element_by_index` 选择下拉选项**

从日志可知，`click_element_by_index=27` 点击"福建省"时实际点中了 `<span>` 文本元素，而 Element UI 监听的是 `<li class="el-select-dropdown__item">` 上的事件。**点击错了 DOM 层级，Vue 收不到选中事件**。此问题无法通过调整 index 解决。

**只能用 `select_option(label_text, option_text)` 这个自定义动作来选 el-select。**

#### `select_option` 的正确用法

系统已内置 `select_option` 动作，它内部自动完成：
1. 读取当前值 → 如果已选中则返回 `already:XXX`，直接跳过
2. 点击触发器打开下拉面板
3. 在正确的 `<li>` 元素上执行选中操作
4. 验证选中结果

```python
# ✅ 正确：用自定义动作选 el-select
select_option("省份", "福建省")

# 也支持"first"关键字选第一个可见项
select_option("法人", "first")

# 如果选项文本较长，传入完整文本
select_option("请选择法人", "横州市农村信用合作联社")
```

**不要自己实现**——`select_option` 已经处理了元素定位、事件触发、前置检查、选中确认等所有逻辑。

#### 特殊情况处理

**如果 `select_option` 返回 `"option-not-found:..."`**：
- 说明下拉面板中没有匹配的选项
- 先检查 label_text 是否准确（是否包含完整标签文本）
- 然后用 `send_keys("ArrowDown")` + `send_keys("Enter")` 通过键盘选择第一项

```python
# 键盘备选方案
select_option("省份", "福建省")          # 尝试标准选择
# 如果返回 option-not-found:
click_element_by_index(3)                # 打开下拉
send_keys("ArrowDown")                   # 往下导航
send_keys("ArrowDown")
send_keys("Enter")                       # 确认选中
```

#### 绝对禁止

- ❌ 禁止用 `click_element_by_index` 点击下拉选项（点了也白点）
- ❌ 禁止用 `select_dropdown_option`（那是原生 `<select>` 用的，不是 el-select）
- ❌ 禁止在 `select_option` 返回 `already:XXX` 后还重复选择

### 14.7 el-radio / el-radio-group

```javascript
await page.evaluate(() => {
  const radio = [...document.querySelectorAll('.el-radio')]
    .find(el => el.textContent.trim() === '目标选项');
  if (radio && radio.offsetParent !== null) radio.click();
});
```

### 14.8 el-checkbox

```javascript
await page.evaluate(() => {
  const checkbox = [...document.querySelectorAll('.el-checkbox')]
    .find(el => el.textContent.trim() === '目标选项');
  if (checkbox) checkbox.querySelector('.el-checkbox__input .el-checkbox__inner')?.click();
});
```

### 14.9 el-switch（开关）

```javascript
// 切换开关状态
await page.evaluate(() => {
  const sw = document.querySelector(
    '.el-form-item:has(.el-form-item__label:contains("启用")) .el-switch'
  );
  if (sw) sw.click();
});
```

### 14.10 相邻按钮触发的输入填写

当 `el-input__inner` 所在的 `.el-form-item` 内有一个 `button.el-button--primary.is-plain` 时，agent **必须点击该按钮**来填写输入框，而不是直接修改 input.value。

此模式有两种常见场景：
- **地址选择器**：按钮文本为"选择"，点击弹出地址选择器弹窗
- **数据引入**：按钮文本为"引入"，点击自动从系统引入数据，填充多个关联字段（如法定代表人信息的三字段联动）

**重要：点击按钮之前，先检查输入框是否已有值。** 如果输入框的 `value` 非空（已有地址/数据），则**不要点击按钮**，跳过该字段。

**注意**：按钮不是 `input` 的直接兄弟，它在 `.tsscInput`、`.el-input` 等包装层的外部，与包装层同级。必须从 `.el-form-item` 层面查找按钮。

```javascript
// 1. 先检查字段是否已有值
const addrInput = document.querySelector(
  '.el-form-item:has(.el-form-item__label:contains("登记注册地址")) .el-input__inner'
);
if (addrInput && addrInput.value && addrInput.value.trim() !== '') {
  // 已有值，跳过
} else {
  // 2. 字段为空，点击按钮打开选择器
  const item = document.querySelector(
    '.el-form-item:has(.el-form-item__label:contains("登记注册地址"))'
  );
  if (!item) return;
  const btn = item.querySelector('button.el-button--primary.is-plain');
  if (btn && btn.offsetParent !== null) {
    btn.click();
  }
}
await page.waitForTimeout(800);
```

**注意**：
- 这类输入框通常为 `disabled` 或 `readonly`，不可直接 setter 赋值
- 如果 `fill_form_field` 返回 `field-disabled`，检查当前 `.el-form-item` 及其同级相邻表单项内是否有 `button.el-button--primary.is-plain`——按钮可能不在同一个表单项内（如"引入"按钮在 证件号码 上，但影响 姓名、证件类型 三个字段）
- 按钮文本可能是"选择"（打开弹窗选择）或"引入"（自动导入数据），两种都适用上述查找逻辑
- **关键**：点击前必须先检查字段值，避免重复打开已填好的地址选择器
- 弹窗内的下拉选择按 §14.6 的策略执行


---

## 15. 错误检测与断言

### 15.1 检测表单验证错误

```javascript
const errors = await page.evaluate(() => {
  const result = [];
  // 字段级错误
  document.querySelectorAll('.el-form-item__error').forEach(el => {
    if (el.textContent.trim()) result.push({ type: 'field', text: el.textContent.trim() });
  });
  // 消息提示
  document.querySelectorAll('.el-message').forEach(el => {
    result.push({ type: 'message', text: el.textContent.trim() });
  });
  // 通知
  document.querySelectorAll('.el-notification').forEach(el => {
    result.push({ type: 'notification', text: el.textContent.trim() });
  });
  // 红框标记
  document.querySelectorAll('.el-input.is-error input, .el-textarea.is-error textarea').forEach(el => {
    if (el.value) result.push({ type: 'error-field-value', text: el.value });
  });
  return result;
});
```

### 15.2 等待网络请求完成

```javascript
// 等待所有网络请求结束（适用于提交后）
await page.waitForLoadState('networkidle', { timeout: 10000 });
```

### 15.3 验证接口响应

```javascript
// 捕获 XHR 响应
page.on('response', response => {
  if (response.url().includes('/api/submit')) {
    console.log('提交接口状态:', response.status());
  }
});
```

---

## 16. 纯图标按钮处理

Element UI 表格中的操作列常使用纯图标按钮（无文字，只有 `<i>` 或 SVG 图标）：

```javascript
await page.evaluate(() => {
  const rows = document.querySelectorAll('.el-table__row, .vxe-body--row');
  for (const row of rows) {
    if (row.textContent.includes('目标行文字')) {
      const icon = row.querySelector(
        'i[class*="bianji"], i[class*="edit"], i[class*="xiugai"], ' +
        'i[class*="el-icon-edit"], button[class*="el-icon-"], ' +
        'i.el-icon-edit, svg[class*="edit"]'
      );
      if (icon && icon.offsetParent !== null) {
        icon.click();
        return true;
      }
    }
  }
  return false;
});
```

**关键**：在目标行上下文中查找 + 检查 `offsetParent !== null` 确保可见。

---

## 17. Naive UI 补充说明

如果诊断发现页面使用 Naive UI 而非 Element UI，注意以下差异：

| 要素 | Element UI | Naive UI |
|------|-----------|----------|
| 输入框 class | `el-input__inner` | `n-input__input-el` |
| 按钮 class | `el-button` | `n-button` |
| 下拉框 | `el-select` | `n-select` |
| 对话框 | `el-dialog` | `n-dialog` / `n-modal` |
| 表格 | `el-table` | `n-data-table` |
| 树 | `el-tree` | `n-tree` |

Naive UI 的输入框也适用原生 setter 策略，但更依赖 `blur` 事件触发校验：

```javascript
await page.evaluate(() => {
  const input = document.querySelector('input.n-input__input-el');
  if (!input) return;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  setter.call(input, '目标值');
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
  input.dispatchEvent(new Event('blur', { bubbles: true }));  // Naive UI 依赖 blur
});
```

---

## 18. 通用脚本结构

一个完整的 Element UI 自动化脚本通常遵循以下流程。各步骤的细节实现参见对应章节：

1. **启动浏览器** → 打开目标页面
2. **诊断 UI 框架**（§1）→ 确认页面使用 Element UI
3. **导航菜单**（§6）→ 通过 `el-menu` 进入目标页面
4. **等待表格/数据加载**（§10 loading / §15.2 networkidle）
5. **打开操作弹窗**（§5）→ 点击 `el-button` 打开 `el-dialog`
6. **填写弹窗表单**（§14）→ 根据字段类型选择对应的填写方式
7. **提交表单**（§15）→ 检测表单验证错误、接口响应
8. **验证结果**（§9 / §15）→ 检查 `el-message` / `el-notification`
9. **关闭通知**（§9.3）→ 手动关闭 `el-notification`

不提供硬编码示例。agent 应根据页面上实际存在的 DOM 元素和文本内容，按上述流程和各章节的模式代码动态生成脚本。

---

## 19. 常见错误与排查

| 现象 | 原因 | 解决 |
|------|------|------|
| `fill()` 后 input 显示空白 | Vue 劫持了 value 属性 | 用原生 setter + 冒泡事件 |
| 填值后聚焦/点击其他字段就变空 | v-model 没感知到变化 | 确保 `input` + `change` 事件 `bubbles: true` |
| select 选了但提交值是原值 | 选项点击未触发 Vue 更新 | 用键盘导航（ArrowDown+Enter）或 evaluate mousedown 触发（§14.6） |
| el-dialog 中操作后无反应 | Dialog 被异步重建，引用失效 | 每次操作前重新 `querySelector` |
| 表单验证错误但值已填入 | 验证在 v-model 更新前触发 | 填值后 `waitForTimeout(500)` |
| 点击菜单项无效 | 父级菜单折叠，子项不可见 | 先展开 `el-submenu` |
| 表格没更新 | 操作后表格自动刷新，无视觉反馈 | 步骤末说明"表格自动刷新，页面外观不变" |
| 弹窗预填值不会被修改 | 用了"先清空再赋值"模式 | 改为直接赋值 |
| 来回点菜单形成死循环 | 多个步骤的文本有子串重叠 | 确保各步骤目标文本无子串重叠 |
| `page.fill()` 不生效 | 按钮或输入在 Shadow DOM 中 | 改用 `page.evaluate()` |
| el-select 反复打开无法选中 | 选项不在 agent 可点击索引中，click 未触发 Vue | 先读当前值（§14.0），用键盘导航或输入搜索选中（§14.6） |

---

## 20. 脚本生成最佳实践总结

1. **先诊断**：执行框架检测脚本，确认 UI 框架类型
2. **全部用 evaluate**：Element UI 场景下优先使用 `page.evaluate()`，不用 `page.fill()`
3. **每次重新查找 DOM**：不缓存引用，避免 Vue 重建导致引用失效
4. **原子操作**：在一个 evaluate 内完成"查找→判断→操作"全流程
5. **验证每一步**：操作后回读确认，避免 LLM 重复执行失败步骤
6. **总等待**：每步间 `waitForTimeout(300-500ms)` 给 Vue 响应式系统处理时间
7. **不依赖中间状态**：避免"点行→等高亮→点图标"的两步联动，合并为一次操作
8. **去重目标文本**：确保各步骤的目标文本无子串/前缀/后缀重叠
9. **图标按钮用 class 定位**：纯图标按钮无文字，通过 CSS class 在行上下文中定位
10. **检测错误**：提交后扫描 `.el-form-item__error` / `.el-message` / `.el-notification`
11. **消息等待**：`el-message` 几秒后自动消失，在消失前捕获其内容
12. **Network idle**：涉及数据加载的操作后等待 `networkidle`
