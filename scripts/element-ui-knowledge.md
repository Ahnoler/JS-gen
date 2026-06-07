# Element UI Action Reference

## Overview

You have two sets of actions available:

1. **Default browser actions** — built-in browser_use actions for standard web interactions
2. **Custom actions** — Element UI specific, registered via `@controller.action`

Use **custom actions** for Element UI form fields (el-select, el-input inside el-form-item, el-radio, etc.).
Use **default actions** for everything else (generic buttons, links, navigation, native `<select>`, etc.).

---

## Default Browser Actions

| Action | Parameters | When to Use |
|--------|-----------|-------------|
| `click_element_by_index(index)` | index: element [] number | Click any visible element by its index. Use for buttons, links, menu items not covered by custom actions. **🚨 Do NOT use for el-select dropdown options — it clicks the wrong DOM layer. Use `select_option` instead.** |
| `input_text(index, text)` | index, text | Type into a standard `<input>` field (NOT el-input inside el-form-item — use `fill_form_field`). |
| `select_dropdown_option(index, option)` | index, option | Select from a native HTML `<select>`. NOT for el-select — use `select_option`. |
| `go_to_url(url)` | url string | Navigate to a URL. |
| `go_back()` | none | Go back one page. |
| `scroll(down\|up)` | direction | Scroll the page. |
| `send_keys(keys)` | keys | Send keyboard keys. |
| `wait(seconds)` | seconds | Wait for a fixed duration. Use sparingly — prefer `wait_for_loading()`. |
| `extract_content(goal)` | goal string | Extract page content matching a description. |
| `done(text, success)` | text, success | Call ONLY when the ENTIRE task is finished. |
| `search_google(query)` | query | Search Google (opens a new tab). |

---

## Custom Actions

### `select_option(label_text, option_text)`

**🚨 这是 el-select 下拉选择的唯一正确动作。严禁使用 `click_element_by_index` 点击下拉选项——它会点到 `<span>` 文本而非 `<li>` 选项，Vue 无法感知，导致无限循环。**

Select an option in an **el-select** dropdown by its form label.

**Parameters:**
- `label_text`: The text of the `.el-form-item__label` next to the select. Also searched by placeholder of the trigger input (`.el-input__inner`).
- `option_text`: The exact text of the dropdown item to click. Use `"first"` to pick the first visible option.

**Return values:**
| Value | Meaning |
|-------|---------|
| `"ok \| confirm=SELECTED:XXX"` | Success. Option XXX was selected and confirmed. |
| `"ok \| confirm=SELECTED:..."` | Success. The dropdown shows the selected value. |
| `"triggered"` | Dropdown was opened. If you see this without a confirm, reopen next step. |
| `"already:XXX"` | **Field already has value XXX. No action needed. Stop here.** |
| `"label-not-found"` | No el-form-item with matching label text. |
| `"no-select-found"` | Label found but no el-select trigger inside. |
| `"select-disabled"` | The el-select is disabled. |
| `"option-not-found:..."` | Option text didn't match any visible item. List of available options follows. |
| `"no-items"` | Dropdown is open but has no visible items. |

**如果返回 `"already:XXX"`，说明已经选中，不要再执行任何选择操作。**

**如果返回 `"option-not-found:..."`：**
1. 检查 `label_text` 是否准确
2. 用 `send_keys("ArrowDown")` + `send_keys("Enter")` 键盘选择第一项

**Examples:**
```
select_option("法人", "first")
select_option("请选择法人", "横州市农村信用合作联社")
select_option("客户类型", "个人客户")
```

---

### `fill_form_field(label_text, value)`

Fill a text/password/textarea input inside an **el-form-item** using Vue-compatible native DOM setter.

**Parameters:**
- `label_text`: Matched against `.el-form-item__label` text, then input `placeholder`, then input `type` attribute.
- `value`: The string value to set.

**Return values:**
| Value | Meaning |
|-------|---------|
| `"ok"` | Found by label text and filled. |
| `"ok-placeholder"` | Label not found, matched by placeholder text and filled. |
| `"ok-type"` | Neither label nor placeholder matched, filled by input `type` attribute. |
| `"no-input-found"` | Label found, but no `<input>` or `<textarea>` inside the form item. |
| `"field-disabled"` | Input is disabled or read-only. |
| `"label-not-found"` | No matching label, placeholder, or type found in any visible container. |

**Notes:**
- Uses native property setter + dispatches `input`, `change`, `blur` events with `bubbles:true` so Vue v-model picks it up.
- Automatically detects the active dialog/drawer and restricts search to that container.
- Cascading fields: after filling a field that may trigger linkage, add a `wait(0.8)` before next action.

**Examples:**
```
fill_form_field("用户名", "701994")
fill_form_field("请输入您的密码", "1")
fill_form_field("客户名称", "测试客户")
```

---

### `click_radio(label_text, option_text)`

Click an **el-radio** option within an el-form-item.

**Parameters:**
- `label_text`: The `.el-form-item__label` text to identify the radio group.
- `option_text`: The exact text of the radio option label (`.el-radio` text content).

**Return values:**
| Value | Meaning |
|-------|---------|
| `"ok"` | Radio option found and clicked. |
| `"option-not-found"` | Label matched but no radio with that option text. |
| `"label-not-found"` | No el-form-item with matching label. |

**Example:**
```
click_radio("性别", "男")
```

---

### `close_dialog()`

Close the topmost visible **el-dialog** or **el-drawer**.

**Parameters:** none

**Return values:**
| Value | Meaning |
|-------|---------|
| `"ok"` | Dialog close button (× in header) clicked. |
| `"ok-cancel"` | Close button not found, clicked default cancel button in footer. |
| `"no-overlay-open"` | No visible dialog or drawer found. |

**Example:**
```
close_dialog()
```

---

### `switch_tab(tab_name)`

Switch to a tab in **el-tabs**.

**Parameters:**
- `tab_name`: The exact text of the tab item (`.el-tabs__item` text content).

**Return values:**
| Value | Meaning |
|-------|---------|
| `"ok"` | Tab found and clicked. |
| `"tab-not-found"` | No visible tab with that name. |

**Example:**
```
switch_tab("客户基本信息")
```

---

### `click_menu_item(menu_text)`

Click a menu item in **el-menu**, auto-expanding parent submenus.

**Parameters:**
- `menu_text`: The text of the `.el-menu-item` to click.

**Return values:**
| Value | Meaning |
|-------|---------|
| `"ok"` | Top-level menu item clicked. |
| `"ok-expanded"` | Submenu expanded, then child item clicked. |
| `"not-found"` | No menu item with that text found. |

**Example:**
```
click_menu_item("对公客户管理")
```

---

### `click_table_row_action(row_text, button_text)`

Click an action button inside a specific **el-table** row.

**Parameters:**
- `row_text`: Text that identifies the row (searched in row's text content).
- `button_text`: Text or icon class to identify the button (`button`, `.el-button`, or icon `<i>` element).

**Return values:**
| Value | Meaning |
|-------|---------|
| `"ok"` | Button found and clicked. |
| `"ok-icon"` | Button matched by icon class (edit/delete icons). |
| `"button-not-found-in-row"` | Row found but no matching button. |
| `"row-not-found"` | No row contains the row_text. |

**Shortcut aliases:** `"edit"` / `"编辑"` matches `el-icon-edit` class icons. `"delete"` / `"删除"` matches `el-icon-delete` class icons.

**Example:**
```
click_table_row_action("测试客户", "编辑")
click_table_row_action("张三", "删除")
```

---

### `expand_all_el_tree()`

Recursively expand all nodes in an **el-tree** (up to 10 rounds).

**Parameters:** none

**Return values:**
| Value | Meaning |
|-------|---------|
| `"expanded-N-nodes"` | N nodes were expanded. |
| `"no-el-tree-found"` | No `.el-tree` element on the page. |

**Example:**
```
expand_all_el_tree()
```

---

### `wait_for_loading()`

Wait until all Element UI loading masks (`.el-loading-mask`) and spinners (`.el-loading-spinner`) disappear. Timeout after 30 seconds.

**Parameters:** none

**Return values:**
| Value | Meaning |
|-------|---------|
| `"loading-done"` | Loading finished (or timeout reached). |
| `"timeout"` | 30s timeout reached, loading was still visible. |

**When to call:** After menu click, form submit, login button, tab switch — any action that triggers a loading state.

**Example:**
```
wait_for_loading()
```

---

### `get_page_state()`

Diagnostic: returns a JSON string with the current page state.

**Parameters:** none

**Returns:** JSON string with:
- `dialogCount`, `visibleDialogCount`, `visibleDialogTitles`
- `drawerCount`
- `loading` — boolean
- `openDropdown` — boolean
- `formErrors` — array of visible error messages
- `messages`, `notifications` — arrays
- `activeTab` — current el-tabs active tab
- `treeNodes` — count
- `tableRows` — count
- `url` — current URL

**When to call:** When stuck, after an action had no effect, or before deciding the next action.

**Example:**
```
get_page_state()
```

---

### `take_screenshot()`

Take a screenshot of the current viewport and save to the `snapshots/` directory.

**Parameters:** none

**Return value:** `"screenshot-saved:PATH"`

**Example:**
```
take_screenshot()
```

---

### `save_case_data(key, value)` / `read_case_data(key)`

Cross-phase data sharing. Save and retrieve arbitrary key-value data across multiple phases of a session.

**Parameters:**
- `key`: String key.
- `value` (save only): String value.

**Return values (save):**
| Value | Meaning |
|-------|---------|
| `"saved:KEY=VAL"` | Saved successfully. |
| `"no-case-data-path"` | No data store configured. |
| `"save-error:..."` | Error message. |

**Return values (read):**
| Value | Meaning |
|-------|---------|
| The stored value string | Found. |
| `"NO-DATA:KEY"` | Key not found. |
| `"read-error:..."` | Error message. |

**Examples:**
```
save_case_data("case_name", "新增对公客户")
read_case_data("case_name")
```

---

### `match_form_rule(label_text)`

Generate a test data value for a form field based on its label, using pre-loaded form rules. Knows common fields like ID numbers, phone numbers, bank card numbers, names, addresses, etc.

**Parameters:**
- `label_text`: The form field label to match against the rule table.

**Return values:**
| Value | Meaning |
|-------|---------|
| Generated value string | A realistic test value (e.g. `"430101199001011234"` for ID card). |
| `"SELECT: ..."` | A selection-type field. Pick one of the listed options based on context. |
| `"FORMAT: ..."` | A format instruction for the field (e.g. expected result format). |
| `"NO-RULE"` | No matching rule found for this label. |

**Known patterns:**
| Label Keywords | Generated Value |
|---------------|-----------------|
| 身份证、证件号码 | 18-digit Chinese ID |
| 手机、电话、联系方式 | 11-digit mobile |
| 邮箱、Email | testxxx@example.com |
| 姓名、用户名、联系人 | Chinese 3-char name |
| 地址、详细地址 | Chinese address |
| 金额、价格、费用 | Random amount |
| 银行卡、银行账号 | 19-digit bank card |
| 信用代码、统一社会信用代码 | 18-char credit code |
| 年龄 | 18-65 |
| 邮编、邮政编码 | 100000 |
| 案例类型、类型 | `SELECT: 功能测试 / 性能测试 / ...` |
| 预期结果、预期 | `FORMAT: ^^1^^ ...` |
| 案例名称、名称 | `FORMAT: 正向: 验证...` |
| 操作步骤 | `FORMAT: Numbered lines` |

**Example:**
```
match_form_rule("身份证号码")
```

---

## Action Selection Cheat Sheet

| Scenario | Action |
|----------|--------|
| Navigate to URL | `go_to_url(url)` |
| Standard button/link | `click_element_by_index(index)` |
| Native `<select>` | `select_dropdown_option(index, option)` |
| Standard text input | `input_text(index, text)` |
| el-select dropdown | `select_option(label_text, option_text)` |
| el-input inside el-form-item | `fill_form_field(label_text, value)` |
| el-radio group | `click_radio(label_text, option_text)` |
| el-dialog / el-drawer close | `close_dialog()` |
| el-tabs switch | `switch_tab(tab_name)` |
| el-menu navigation | `click_menu_item(menu_text)` |
| el-table row action | `click_table_row_action(row_text, button_text)` |
| el-tree expand all | `expand_all_el_tree()` |
| el-date-picker | `fill_form_field(label_text, value)` (same as text) |
| Loading mask visible | `wait_for_loading()` |
| Need diagnostics | `get_page_state()` |
| Generate test data | `match_form_rule(label_text)` |
| Take screenshot | `take_screenshot()` |
| Task fully complete | `done(text, success)` |
