---
name: atp-fix
description: |
  Fix broken Playwright scripts by analyzing execution errors. Supports Element UI / Vue apps.
  Given a failed script and its stderr output, this skill classifies the error and applies the correct fix.
  Covers: CTRL injection issues, locator/XPath mismatches, strict mode violations, navigation errors,
  el-select vs native select confusion, missing page.goto, and invalid CTRL method calls.
---

# atp-fix — Playwright 脚本错误修复

## 工作流程

1. 接收：**失败脚本内容** + **stderr 错误输出**
2. 分析：根据 stderr 匹配错误模式（见下方错误分类）
3. 修复：按错误类型应用对应的修复策略
4. 输出：**完整的修复后脚本**（不省略任何代码）

## 错误分类（从 stderr 匹配）

分析 stderr 的首行错误信息，按以下规则分类：

| stderr 包含 | 错误类型 | 说明 |
|-------------|---------|------|
| `CTRL is not defined` | ctrl-undefined | CTRL 未注入或用 bare CTRL.xxx() |
| `locator.click` 或 `Timeout` | locator-timeout | 选择器/定位器超时 |
| `strict mode violation` | strict-mode | 定位器匹配了多个元素 |
| `ReferenceError` 或 `is not defined` | reference-error | 变量未定义 |
| `page.fill` 或 `fill(` | page-fill | 用了 page.fill() 而非 CTRL |
| `selectOption` 或 `locator('select')` | native-select | 用了原生 select 而非 el-select |

---

## 错误分类与修复策略

### 1. CTRL is not defined

**stderr 特征**：
```
ReferenceError: CTRL is not defined
    at eval (eval at evaluate ...)
```

**原因**：CTRL 对象在 `page.evaluate` 中不可用。可能的原因：
- 脚本用了 `await CTRL.xxx()` 而不是 `await page.evaluate(() => CTRL.xxx())`
- `addInitScript` 注入失败（语法错误导致注入代码抛异常）
- `addInitScript` 放在了 `page.goto` **之后**而不是之前（`addInitScript` 必须在 `newPage` 之前调用）

**修复方案**：
```javascript
// ✅ 正确：在 context 上注入，newPage 之前
const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
await context.addInitScript(() => {
  window.CTRL = { ... };
});
const page = await context.newPage();

// ✅ 正确：调用 CTRL 方法必须用 page.evaluate 包裹
await page.evaluate(() => CTRL.fillFormField('label', 'value'));

// ❌ 错误：直接调用
await CTRL.fillFormField('label', 'value');  // ReferenceError
```

**检查清单**：
- [ ] `addInitScript` 是否在 `newPage` 之前调用？
- [ ] `addInitScript` 内部的代码是否有语法错误？
- [ ] 所有 `CTRL.xxx()` 是否被 `page.evaluate(() => ...)` 包裹？

---

### 2. locator.click Timeout / locator.waitFor Timeout

**stderr 特征**：
```
locator.click: Timeout 30000ms exceeded.
Call log:
  - waiting for locator('...')
```

**常见原因与修复**：

#### 2a. 用了 `page.locator('select')` 但页面是 `el-select`

**stderr 特征**：locator 包含 `select` 且超时 30s。

**修复**：替换为 `CTRL.selectOption`：
```javascript
// ❌ 错误
await page.locator('select').first().selectOption({ index: 1 });

// ✅ 正确
await page.evaluate(() => CTRL.selectOption('请选择法人', 'first'));
```

#### 2b. 中文文本含空格导致 XPath 匹配失败

**stderr 特征**：locator 包含中文按钮文本但超时。

**修复**：使用 `translate()` 去除空格：
```javascript
// ❌ 错误：text()="登录" 匹配不上 "登 录"
await page.locator('xpath=//button[text()="登录"]').click();

// ✅ 正确：translate 去掉所有空格
await page.locator('xpath=//button[contains(translate(.," ",""),"登录")]').click();
```

#### 2c. 页面未加载完成

**修复**：在操作前加等待：
```javascript
await page.waitForSelector('.el-form-item', { timeout: 10000 });
// 或
await page.waitForLoadState('networkidle');
```

#### 2d. 元素在 el-dialog 内

**修复**：先等 dialog 出现，再操作：
```javascript
await page.waitForSelector('.el-dialog', { state: 'visible', timeout: 10000 });
// 然后在 dialog 内查找元素
```

---

### 3. Strict Mode Violation

**stderr 特征**：
```
strict mode violation: locator('...') resolved to N elements
```

**原因**：XPath/CSS 匹配了多个元素，Playwright 严格模式禁止模糊操作。

**修复方案**：

#### 3a. 表格 radio/checkbox 列

```javascript
// ❌ 错误：tr 没有指定行号，匹配全部行
await page.locator('xpath=.../table/tbody/tr/td[1]/div/label').click();

// ✅ 正确：指定 tr[1] 匹配第一行
await page.locator('xpath=.../table/tbody/tr[1]/td[1]/div/label').click();

// ✅ 或使用 .first()
await page.locator('xpath=.../table/tbody/tr/td[1]/div/label').first().click();
```

#### 3b. 一般多元素匹配

```javascript
// ✅ 使用 .first() 或 .nth(N) 消歧
await page.locator('xpath=...').first().click();
await page.locator('xpath=...').nth(2).click();
```

---

### 4. Navigation Error (wrong URL)

**stderr 特征**：
```
page.goto: net::ERR_...
  - navigating to "https://wrong-url.com/"
```

**修复**：替换为正确的 `TARGET_URL` 或去掉多余的导航：
```javascript
// ❌ 错误：用了占位 URL
await page.goto('https://your-target-url.com');

// ✅ 正确：使用 TARGET_URL
await page.goto(TARGET_URL, { waitUntil: 'networkidle', timeout: 60000 });

// ❌ 错误：Phase 2+ 不需要导航（页面已加载）
// ✅ 正确：Phase 2+ 不添加 page.goto，除非轨迹有 go_to_url
```

---

### 5. CTRL Method Not Found

**stderr 特征**：
```
CTRL.getPageState is not a function
CTRL.extractContent is not a function
```

**原因**：LLM 发明了不存在的 CTRL 方法。CTRL 只有 12 个预定义方法。

**修复**：替换为等价的 `page.evaluate`：
```javascript
// ❌ 错误
await page.evaluate(() => CTRL.getPageState());
await page.evaluate(() => CTRL.extractContent());

// ✅ 正确
await page.evaluate(() => ({
  dialogs: document.querySelectorAll('.el-dialog').length,
  loading: !!document.querySelector('.el-loading-mask:not(.el-loading-mask--hidden)'),
  notifs: [...document.querySelectorAll('.el-notification')].filter(e => e.offsetParent !== null).length
}));
await page.evaluate(() => document.body.innerText);
```

**完整 CTRL 方法列表**（只有这些，不要发明新的）：

| 方法 | 用途 |
|------|------|
| `CTRL.fillFormField(label, value)` | 填充文本输入框 |
| `CTRL.selectOption(label, option)` | el-select 下拉选择 |
| `CTRL.selectDate(label, dateStr)` | 日期选择 |
| `CTRL.clickRadio(label, option)` | 单选按钮 |
| `CTRL.clickMenuItem(text)` | 菜单导航 |
| `CTRL.clickTableRowAction(rowText, btnText)` | 表格行按钮 |
| `CTRL.closeDialog()` | 关闭弹窗/通知 |
| `CTRL.waitForLoading()` | 等待加载 |
| `CTRL.switchTab(name)` | 切换标签页 |
| `CTRL.checkFieldValue(label)` | 读取字段值 |
| `CTRL.clickAdjacentButton(label)` | 点击相邻按钮 |
| `CTRL.expandAllTreeNodes()` | 展开树节点 |

---

### 6. page.fill / page.click 用于 Element UI

**stderr 特征**：虽然没有直接报错，但填值不生效。

**修复**：替换为 CTRL 方法：
```javascript
// ❌ 错误
await page.fill('input[name="username"]', '701994');
await page.click('button[type="submit"]');

// ✅ 正确
await page.evaluate(() => CTRL.fillFormField('请输入您的用户名', '701994'));
await page.locator('xpath=//button[contains(translate(.," ",""),"登录")]').click();
```

---

### 7. 缺少导航（脚本未 goto 任何 URL）

**stderr 特征**：脚本直接操作 CTRL 方法，但之前没有 `page.goto`。

**修复**：在首个操作前添加导航：
```javascript
// 在 Phase 1 的开头添加
await page.goto(TARGET_URL, { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForTimeout(2000);
```

---

## 通用修复规则

1. **输出完整脚本**：只输出修复后的完整脚本，不省略任何代码
2. **保持 `addInitScript`**：不要移除或修改 CTRL 注入代码
3. **保持 `try/catch/finally`**：不破坏脚本结构
4. **验证修复**：确保修复后的代码是语法正确的 JavaScript
5. **优先使用 CTRL**：所有 Element UI 交互优先用 CTRL 方法，不行再用 `page.evaluate`

## 示例

### 输入：stderr
```
Test failed: page.evaluate: ReferenceError: CTRL is not defined
    at eval (eval at evaluate (:302:30), <anonymous>:1:12)
```

### 输出：修复后脚本
```javascript
// 完整的修复后脚本...
```
