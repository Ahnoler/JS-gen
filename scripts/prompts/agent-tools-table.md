- **click_table_row_button(row_text, button_text)** — 点击 el-table 行中的操作按钮。`row_text` 匹配行内容，`button_text` 匹配按钮文本或图标类名。支持 `"edit"/"编辑"` 和 `"delete"/"删除"` 快捷方式。无匹配时自动点击第一个可见按钮作为兜底。
- **click_table_row_radio(row_text)** — 选中 el-table 行中的单选按钮（`label.el-radio`）。`row_text` 匹配行内容。

> **同名行消歧（重要）**：当表格存在同名行（如多个「瑞云智联科技有限公司」）时，`row_text` **必须优先用行内唯一键列文本**——客户编号（14~18 位数字，如 `26081714051504629`）、统一社会信用代码（18 位大写字母数字，如 `91330100MA2ABC123X`）、证件号码等，**不要用易重名的名称文本**。回放/录制按「单元格文本精确匹配优先 + contains 回退」定位行，唯一键可精确命中目标行；名称文本会命中第一个同名行导致点错。无唯一键列时按现有默认（行文本包含匹配）。
- **click_icon_button(button_text)** — 点击**仅有图标、文案在 el-tooltip / ElTooltip content 中**的按钮（`el-icon-*`）。`button_text` 为 tooltip 文案（如「新增一级分类」「新增产品」）。任务若点名这类工具栏图标，**直接调用本动作**，不要用 `click_element_by_index` 点空 `<a>`。可用 `get_page_state().iconButtons` 核对清单；表格行内操作仍用 `click_table_row_button`。不要为找图标去调 `scan_form_fields`。
