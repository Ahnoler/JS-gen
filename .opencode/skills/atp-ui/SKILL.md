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

表单提交失败时，页面右上角会出现 `.el-notification` 浮动提示。agent 必须先将通知文本记录下来，再手动关闭弹窗。

```javascript
// 1. 检测右侧通知是否存在并读取内容
const notifInfo = await page.evaluate(() => {
  const n = document.querySelector('.el-notification');
  if (!n) return null;
  return {
    text: n.querySelector('.el-notification__content')?.textContent?.trim() || '',
    title: n.querySelector('.el-notification__title')?.textContent?.trim() || '',
  };
});

if (notifInfo) {
  // 通知文本已在 notifInfo 中记录，后续决策可用

  // 2. 关闭通知（点 X 按钮）
  await page.evaluate(() => {
    const close = document.querySelector('.el-notification .el-notification__closeBtn');
    if (close) close.click();
  });
  await page.waitForTimeout(300);
}
```

**注意**：`el-notification` 不会自动消失，必须手动关闭。它和 `el-message`（居中顶部，几秒后自动消失）是两种不同的组件，两者都要检查。


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

**注意**：地址选择器输入框通常是 `readonly` 的，不能直接 setter 赋值。它常与 §14.10 的"相邻按钮"模式配合——点击输入框的下一个兄弟按钮打开地址树弹窗。


---

## 14. 表单填写（详细指南）

> 以下内容继承自原表单填写技能，已整合为脚本生成知识库的一部分。

### 14.0 识别待填字段：跳过已有值的必填项

只填写**同时满足以下两个条件**的表单项：
1. `class` 中包含 `is-required`（必填字段）
2. 输入框当前**无值**（`value` 为空，或 el-select 未选中）

**已有值的必填字段跳过不填**，避免重复填写导致无限循环。

```javascript
// 扫描页面上需要填写且尚未填写的表单项
const fieldsToFill = await page.evaluate(() => {
  const items = document.querySelectorAll('.el-form-item.is-required');
  const result = [];
  for (const item of items) {
    const label = item.querySelector('.el-form-item__label')?.textContent?.trim() || '';
    const input = item.querySelector('.el-input__inner, .el-textarea__inner');
    const selectInput = item.querySelector('.el-select .el-input__inner');
    const actualInput = input || selectInput;
    if (!actualInput) continue;
    // 跳过已有值的字段（el-select 取 input.value，有值说明已选中）
    if (actualInput.value && actualInput.value.trim() !== '') continue;
    result.push({ label, element: actualInput });
  }
  return result;
});

console.log('待填写字段:', fieldsToFill.map(f => f.label));
```

**注意**：
- 只处理 `class` 中包含 `is-required` 的 `.el-form-item`
- 已有值的必填字段**跳过**，不再重复填写
- 不带 `is-required` 的表单项跳过，无需填写
- class 中可能同时包含 `is-success`、`tssc-form-item` 等其他 class，不影响判断


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

```javascript
// 1. 点击触发下拉
await page.evaluate(() => {
  const trigger = document.querySelector(
    '.el-form-item:has(.el-form-item__label:contains("类型")) .el-select .el-input__inner'
  );
  if (trigger) trigger.click();
});
await page.waitForTimeout(500);

// 2. 选择选项
await page.evaluate(() => {
  const option = [...document.querySelectorAll('.el-select-dropdown__item')]
    .find(el => el.textContent.trim() === '目标选项');
  if (option) option.click();
});
await page.waitForTimeout(300);
```

**注意**：如果多个 el-select 共用一个下拉面板（`el-select-dropdown`），点击第二个 select 前可能需要先关闭前一个下拉。

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

当 `el-input__inner` 的下一个兄弟元素（按 DOM 树先后顺序）是 `button.el-button--primary.is-plain` 时，agent **必须点击该按钮**来填写输入框，而不是直接修改 input.value。

此模式常见于地址选择器、组织树选择器等场景——点击按钮弹出 el-dialog / el-tree / el-cascader，选择后自动回填 input。

```javascript
// 1. 查找输入框，点击其下一个兄弟按钮打开选择器
await page.evaluate(() => {
  const input = document.querySelector(
    '.el-form-item:has(.el-form-item__label:contains("地址")) .el-input__inner'
  );
  if (!input) return;
  const nextBtn = input.nextElementSibling;
  if (nextBtn?.matches('button.el-button--primary.is-plain')) {
    nextBtn.click();
  }
});
await page.waitForTimeout(800);

// 2. 在弹出的弹窗中完成选择，输入框会自动填充
```

**注意**：这类输入框通常为 `readonly`，不可直接 setter 赋值。点击按钮打开选择器是唯一正确的填写方式。


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

## 18. 完整脚本模板

```javascript
// /tmp/playwright-test-elui.js
const { chromium } = require('playwright');

const TARGET_URL = 'http://localhost:8080';

(async () => {
  const browser = await chromium.launch({ headless: false, slowMo: 50 });
  const page = await browser.newPage();

  await page.goto(TARGET_URL);
  await page.waitForLoadState('networkidle');

  // ===== 1. 登录 =====
  // 略...

  // ===== 2. 导航到目标页面 =====
  await page.evaluate(() => {
    const menu = document.querySelector('.el-menu');
    if (!menu) return;
    [...menu.querySelectorAll('.el-menu-item')]
      .find(el => el.textContent.trim() === '目标页面')
      ?.click();
  });
  await page.waitForLoadState('networkidle');

  // ===== 3. 等待表格加载 =====
  await page.waitForSelector('.el-table__body', { timeout: 10000 });

  // ===== 4. 点击"新增"按钮打开弹窗 =====
  await page.evaluate(() => {
    document.querySelector('button:has-text("新增"), .el-button--primary:has-text("新增")')
      ?.click();
  });
  await page.waitForTimeout(800);

  // ===== 5. 填写弹窗表单 =====
  // 各字段填写...
  await page.evaluate(() => {
    const input = document.querySelector('.el-dialog .el-input__inner');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, '测试值');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    input.dispatchEvent(new Event('blur', { bubbles: true }));
  });
  await page.waitForTimeout(500);

  // ===== 6. 提交 =====
  await page.evaluate(() => {
    const btn = document.querySelector('.el-dialog__footer .el-button--primary');
    if (btn) btn.click();
  });

  // ===== 7. 验证提交结果 =====
  await page.waitForTimeout(1000);
  const message = await page.evaluate(() => {
    const msg = document.querySelector('.el-message');
    return msg ? msg.textContent.trim() : null;
  });
  console.log('提交结果:', message);

  await browser.close();
})();
```

---

## 19. 常见错误与排查

| 现象 | 原因 | 解决 |
|------|------|------|
| `fill()` 后 input 显示空白 | Vue 劫持了 value 属性 | 用原生 setter + 冒泡事件 |
| 填值后聚焦/点击其他字段就变空 | v-model 没感知到变化 | 确保 `input` + `change` 事件 `bubbles: true` |
| select 选了但提交值是原值 | 只改了显示文本，未触发选择 | 通过点击 `.el-select-dropdown__item` 触发选择 |
| el-dialog 中操作后无反应 | Dialog 被异步重建，引用失效 | 每次操作前重新 `querySelector` |
| 表单验证错误但值已填入 | 验证在 v-model 更新前触发 | 填值后 `waitForTimeout(500)` |
| 点击菜单项无效 | 父级菜单折叠，子项不可见 | 先展开 `el-submenu` |
| 表格没更新 | 操作后表格自动刷新，无视觉反馈 | 步骤末说明"表格自动刷新，页面外观不变" |
| 弹窗预填值不会被修改 | 用了"先清空再赋值"模式 | 改为直接赋值 |
| 来回点菜单形成死循环 | 多个步骤的文本有子串重叠 | 确保各步骤目标文本无子串重叠 |
| `page.fill()` 不生效 | 按钮或输入在 Shadow DOM 中 | 改用 `page.evaluate()` |

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
