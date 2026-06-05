# Element UI / Vue Component Interaction Guide

This document describes how to interact with Element UI (Vue 2/3) components via `page.evaluate()` JavaScript. The Planner tracks task progress — this guide focuses purely on component mechanics.

## General Principles

1. **Vue v-model bypass**: Setting `.value = X` directly does NOT update Vue components. Use the native setter + dispatchEvent pattern:
   ```javascript
   const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
   setter.call(input, 'value');
   input.dispatchEvent(new Event('input', {bubbles:true}));
   input.dispatchEvent(new Event('change', {bubbles:true}));
   ```

2. **DOM is rebuilt**: Element UI destroys and re-creates DOM nodes when dialogs open/close, tabs switch, or data refreshes. Never cache element references across actions. Re-query every time.

3. **bubbles:true**: All dispatched events must have `{bubbles: true}` or Vue won't detect them.

4. **Readonly on el-select triggers is NORMAL**: `el-select .el-input__inner` is always `readonly="true"` by design. Only check `disabled`, ignore `readonly`.

5. **Custom wrappers (tsscInput / tssc-multi-select)**: Some systems wrap elements in custom divs. The native `<input>` or `.el-input__inner` still exists inside. Standard selectors like `input:not([type="hidden"])` and `.el-select .el-input__inner` penetrate wrappers automatically.

6. **Pre-filled fields**: Use `fill_form_field` and `select_option` — they auto-detect existing values and return `OK-SKIP:[value]` if the field is already done. Move to the next field.

## CRITICAL: Form Fields Must Use Custom Actions

**For ALL Element UI form fields, use the dedicated custom actions — NOT `click_element_by_index`.**

| Field Type | WRONG (built-in) | RIGHT (custom action) |
|------------|----------|-----------|
| el-select dropdown | `click_element_by_index` | `select_option("label", "option")` |
| el-input / textarea | `input_text` or `click`+`type` | `fill_form_field("label", "value")` |
| el-radio | `click_element_by_index` | `click_radio("label", "option")` |
| el-dialog close | `click_element_by_index` | `close_dialog()` |

**Using `click_element_by_index` on an el-select trigger only opens the dropdown — it does NOT select a value.** Always use `select_option` which handles the full open→select→close flow.

## CRITICAL: Credit System Login — Exact Procedure

The login page at `test.creditv5p2.tansun.com.cn` requires THESE actions in THIS order. Execute them one by one:

```
Step A: select_option("法人", "first")       ← selects first option in 法人机构 dropdown
Step B: fill_form_field("用户名", "701994")  ← fills username via placeholder "请输入您的用户名"
Step C: fill_form_field("密码", "1")         ← fills password via type="password" matching
Step D: Click the login button                ← use includes("登") to find button text
Step E: wait_for_loading()                   ← wait for redirect, ~15s
```

These 5 steps are the COMPLETE login flow. Do NOT call done() until all 5 are complete. The planner will track your progress through them.

---

## el-select (Dropdown)

**Always use the `select_option` custom action:**
```
select_option("字段标签", "选项文本")
select_option("法人", "first")       ← selects first visible option
```

The action handles: find by label → find by placeholder → fallback to first visible el-select → open dropdown → click option → close.

**Troubleshooting dropdown failures:**
1. Check `trigger.disabled`, NOT `trigger.readOnly`
2. Call `wait_for_loading()` — loading mask blocks clicks
3. Call `get_page_state()` — check for open dialogs/drawers
4. If label not found → try placeholder text or first-item fallback
5. After 2 failures → skip field, note as failed

---

## el-dialog / el-drawer (Overlays)

**Before ANY action, verify the active overlay.** All custom actions detect `.el-dialog` and `.el-drawer` automatically.

- `el-dialog` — modal with header, body, footer
- `el-drawer` — slide-in panel, common in wizards
- Multiple overlays can stack — call `get_page_state()` for counts
- Close with `close_dialog()` if wrong overlay is open, wait 500ms for Vue to destroy old DOM

---

## el-form Field Location

Locate fields by priority:
1. **Label text**: `fill_form_field("客户名称", "value")`
2. **Placeholder**: `fill_form_field("请输入用户名", "value")` — common on login pages with empty labels
3. **Type attribute**: `fill_form_field("password", "value")` — fallback for unlabeled fields

**3-scroll rule**: If you scroll 3 times without finding a field, STOP. The field is likely in a collapsed section, different tab, or closed dialog.

**Cascading fields**: After filling a field that may trigger linkage, wait 800ms and re-query DOM.

---

## el-table (Data Table)

- Table body: `.el-table__body-wrapper .el-table__row`
- Wait for `.el-table__body` or `.el-table__empty-text` before interacting
- Loading state: `.el-loading-mask` visible → call `wait_for_loading()`
- Row actions: `click_table_row_action("row_text", "button_text")`
- Pagination: click `.el-pagination .btn-next`, wait 800ms for reload

---

## el-tabs (Tab Switching)

```
switch_tab("目标标签名称")
```
Wait 800ms after switching for tab content to render.

---

## el-tree (Tree Navigation)

Call `expand_all_el_tree()` to expand all nodes, then click the leaf by text. Wait 500ms after each expand.

---

## el-menu (Navigation Menu)

- Top-level: `.el-menu-item`
- Submenu: expand `.el-submenu__title` first, then click child `.el-menu-item`
- After clicking a menu item, call `wait_for_loading()` and wait for page content

**Note**: Some apps use custom menus (`<LI class="menu-item">` inside `<NAV>`), NOT `el-menu`. Check structure first with `get_page_state()`.

---

## el-date-picker

Use native setter (same as text inputs) — do NOT click the calendar icon:
```javascript
setter.call(input, '2025-01-15');
input.dispatchEvent(new Event('change', {bubbles:true}));
input.dispatchEvent(new Event('blur', {bubbles:true}));
```

---

## Other Components (Quick Reference)

- **el-radio**: `click_radio("字段标签", "选项文本")`
- **el-checkbox**: Click `.el-checkbox__input .el-checkbox__inner`
- **el-switch**: Check `.is-active` class first — skip if already in desired state
- **el-cascader**: Click trigger → wait 800ms → select level-1 → wait 500ms → select level-2
- **el-upload**: Cannot automate file chooser — skip or note as manual step
- **el-autocomplete**: Type text → wait 500ms → click `.el-autocomplete-suggestion li`
- **el-transfer**: Select items in left panel → click transfer button
- **el-message / el-notification**: Auto-disappear after 3-5s. Capture immediately.

---

## Post-Navigation Wait Pattern

After clicking menu items, login, or any action that triggers page navigation:

1. `wait_for_loading()` — handles loading mask with 30s timeout
2. Scan DOM for expected element (table body, form, page title)
3. If NOT found → wait 15s, scan again, repeat up to 90s
4. If still not found → report failure

---

## Common Failure Modes

| Symptom | Likely Cause | Fix |
|---------|-------------|-----|
| Dropdown click does nothing | Loading mask or disabled | `wait_for_loading()`, check `disabled` |
| Text disappears after typing | Vue v-model not triggered | Use `fill_form_field` / native setter + dispatchEvent |
| Field not found after scrolling | Field in different tab/dialog | `get_page_state()`, check overlay/tabs |
| Action had no effect | Element obscured, loading, or Vue swallowed it | `get_page_state()`, scroll into view, try different approach |
| Dialog appeared unexpectedly | Previous action triggered it | `get_page_state()` to identify, confirm/cancel/close |
| Button click intercepted | Submenu overlay remains | `wait_for_loading()` then retry |

---

## Application Reference: 信贷系统对公客户管理 (test.creditv5p2.tansun.com.cn)

### Login Page Structure

URL: `http://test.creditv5p2.tansun.com.cn/#/login?redirect=%2Fhome`
All login fields have EMPTY labels — locate by placeholder ONLY.

| # | Type | Placeholder | Notes |
|---|------|------------|-------|
| 0 | el-select | "请选择法人" | readonly is NORMAL |
| 1 | el-input | "请输入您的用户名" | type=text |
| 2 | el-input | "请输入您的密码" | type=password |
| 3 | el-input | "请输入图形中的字符" | Captcha — NOT REQUIRED |
| 4 | el-input | "用户转授权编码" | Optional |
| 5 | el-input | "灰度版本" | Optional |

**Login button**: text "登 录" (has SPACE), use `includes("登")`
**Dropdown options**: 横州市农村信用合作联社, 南宁市武鸣区农村信用合作联社, 柳州市区农村信用合作联社, etc.

**Login flow** (3-4 steps): select institution → fill username → fill password → click login → wait redirect
**Captcha NOT required.** `username=701994, password=1`

### Post-Login Home Page

URL: `/#/home?part=home`

Navigation uses CUSTOM `<LI class="menu-item">` inside `<NAV class="navbar">` — NOT `el-menu`. The `click_menu_item` action is ineffective here. Use `click_element_by_index` instead.

**Top-level menu items**: 工作台, 任务事项, 客户管理, 评级管理, 授信管理, ...
**Submenu items** (under 客户管理): 对公客户管理, 个人客户管理, ...

10 pre-loaded hidden el-dialogs exist (修改密码, 营业日期切换, etc.) — they may intercept clicks.

### Form Wizard (新增对公客户)

Wizard opens in `el-dialog` or `el-drawer`. Fields: 客户状态, 对公客户类型, 证件类型, 客户名称, 证件号码. Click 保存 to submit.

Main form page has tabs: 客户基本信息, 财务信息, 业务信息, 影像资料, 其他信息. Each tab has dozens of fields.

### Known Timeouts
- Login → home: wait 15s+
- Menu click → list: wait 10-15s
- Form save → message: wait 5-10s
- Query → results: wait 5-8s

Always use `wait_for_loading()` (30s timeout) rather than fixed sleeps.
