# Design: `tssc_multi_select` 专用动作（对标 tree-select 族）

**日期**：2026-09-08  
**状态**：已实现（2026-09-08）；实现计划见 [`../plans/2026-09-08-tssc-multi-select-action.md`](../plans/2026-09-08-tssc-multi-select-action.md)  
**触发**：产品要素库「选择要素」→「要素名称」；Playwright 实证为 Vue2 `TsscMultiSelect`（`.tssc-multi-select` → `.el-select.search-select` → 弹层 `.select-table` + `el-table` 行选）  
**对标**：已注册树族 `select_tree_option` / `tree_picker_click` / `tree_check_confirm`（`scripts/prompts/agent-tools-tree.md`、`js_snippets/select_tree.py`、`_tree.py`、`TreeEngine`）

## 1. 问题

| 表象 | 根因 |
|---|---|
| Agent 把「要素名称」当普通 `el-select` / `select_option` | 扫描把 `.tssc-multi-select`（内含 `.el-select`）判成 `select`；prompt 还写「表格行型远程下拉必须用 select_option」 |
| `select_option` 表行适配对要素库失效 | `optionLabel` 取**第一个非纯数字 cell** → 本页表头是「英文名\|中文名」，匹配键落在英文 `attrEngEcd`；而组件 `params.text/value = attrChnNm`（中文），业务常按中文搜 |
| 精确查询 / 弹层内搜索 / 分页 | 现有 `select_option` 无 `exactBtn`、弹层内 keyword、上一页/下一页契约 |
| #696 录制痛点 | 选中后 toast 已 OK，阶段门仍要 `dialog_close` 等（本设计不改 introduce_pick；另案） |

**实证摘要（2026-09-08 Playwright）**

- 组件名：`TsscMultiSelect`；host：`.tssc-multi-select`
- `params`：`exactBtn:true`，`header/body: [attrEngEcd, attrChnNm]`，`text/value: attrChnNm`，`multiple:false`，远程 `findProdDataPage`
- 选中语义：点 `tr.el-table__row`（非 `el-option`）
- 同弹窗：「要素编码」disabled 回填；「要素类型」同为另一个 `TsscMultiSelect`

## 2. 目标 / 非目标

### In

1. 注册专用动作 **`tssc_multi_select(label_text, option_text, xpath_smart='')`**，契约与 **`select_tree_option`** 同形（label + option + 可选 xpath）。
2. **组件门控**：仅认 `TsscMultiSelect`（DOM `.tssc-multi-select` 或 Vue `$options.name` 含 `TsscMultiSelect`）；否则返回 `no-tssc-multi-select`（对标 `no-tree-component`），禁止空转重试。
3. **扫描分流**：在 `JS_CLASSIFY_FIELD` 里于 `.el-select` **之前**识别 `.tssc-multi-select` → kind `tssc-multi-select`（对标 `tree-select` 先于 `select`）。
4. **成功谓词内联**：选行后读回触发器 / `vm.selectName|myValue`，与期望匹配才 `ok`（对标 tree 的 echo / `err-tree-no-echo`）。
5. Prompt / autofill 路由：扫描为 `tssc-multi-select` 时必须调用本动作；禁止 `click_element_by_index` 点表行；修正现有「用 select_option 点表行」文案。
6. Characterization pin（对标 `characterize-tree-picker-click.py` / tree-select-classify）。

### Out（YAGNI v1）

- 多选 `params.multiple=true`（对标另拆 `tree_check_confirm`；本页单选）
- 通用「任意 el-table 下拉」泛化（先钉 `.tssc-multi-select` / `.select-table`）
- 改 `introduce_pick` / phase 成功门（toast_ok vs dialog_close）
- 删掉 `select_option` 内既有 `SELECT_TABLE_ROW_OPTIONS`（保留兼容；新扫描路径不再指引走它）
- 湿测重录 #695/#696（本设计落地后再开）

## 3. 设计原则（从 tree 族抄作业）

| Tree 族 | 本动作镜像 |
|---|---|
| 组件名门控 `TsscMultiTree`，禁裸 `.el-tree` | 门控 `TsscMultiSelect`，禁裸「任意下拉里的 el-table」 |
| `select_tree_option(label, option, xpath)` | `tssc_multi_select(label, option, xpath)` |
| `target_kind=form_tree_select` 捕获 | `target_kind=form_tssc_multi_select` |
| `no-tree-component` → 改 fill/select | `no-tssc-multi-select` → 改 `select_option`（真 el-option）或上报 |
| `disabled` → 跳过勿重试 | 同；只读回填字段（如要素编码）不走本动作 |
| 独立 prompt 包 `agent-tools-tree.md` | 新增 `agent-tools-tssc-multi-select.md`（或 form 包一节；推荐独立包便于 characterize 针） |
| JS 内联校验回显 | 行点击后校验 trigger / Vue 显示值含 `option_text` 或 `params.text` 列 |
| 合成事件不够时 CDP `real_click` 兜底 | v1：先合成行 click（现 select_option 表行路径）；若 echo 失败再 **一次** real_click 触发行（对标 tree_picker 的 fallback，不默认全链路 CDP） |

**与 tree 三动作的分工类比（只实现左侧一列的「单选」位）：**

| 树 | 表格远程选 |
|---|---|
| `select_tree_option`（单选叶） | **`tssc_multi_select`（单选行）← v1** |
| `tree_picker_click`（逐级 path） | 暂无（分页「下一页」若需要再拆，不塞进本动作参数） |
| `tree_check_confirm`（多选勾） | 暂无（`multiple`） |

## 4. 动作契约

### 签名

```text
tssc_multi_select(label_text: str, option_text: str, xpath_smart: str = "")
```

- `option_text`：业务期望的**显示名**（优先匹配 `params.text` 列，要素库即中文名）；别名 `"first"` / `"第一个"` → 点当前页第一可见行（对标 tree 的 `first`）。
- 不引入 `path_texts` / `exact=` 独立参数：精确查询由 JS **启发式**处理（见 §5），避免 agent 多参。

### 返回码（字符串，ok 前缀可录）

| 码 | 含义 | Agent 行为 |
|---|---|---|
| `ok:` / `ok-first:` / `ok-echo:...` | 选中且回显通过 | 信任；勿重选 |
| `ok-already:...` | 触发器已是目标值 | 停止 |
| `label-not-found` | 无 form-item | 重扫 / 查弹窗 scope |
| `disabled` | 组件/触发器只读 | **跳过**，勿重试 |
| `no-tssc-multi-select` | 非本组件 | **禁止重试本动作**；改 `select_option` 或 fill |
| `no-items` | 等行超时仍空 | 最多再调一次；仍空则上报 |
| `option-not-found:...` | 有行无匹配（可附前几行摘要） | 换文案 / 确认业务数据；勿点索引 |
| `err-no-echo:...` | 点了行但回显未变 | **勿盲目重试**；check_field_value 或上报（对标 `err-tree-no-echo`） |

### 录制

- `_record_action('tssc_multi_select', {label_text, option_text}, …, element=…)`
- `target_kind='form_tssc_multi_select'`；`stamp_recorded_xpath_smart` + `_task_done_impl` 与 tree 同路径
- 挂入：`ACTION_TO_COMMAND` / `state.py` 字段类表 / `event_dispatch` 参数白名单 / `src/models/action-name.js` 别名 / export `select:tssc-multi`（命名与 `select:tree` 平行）

## 5. 交互序列（JS 单次注入）

对标 `JS_SELECT_TREE_OPTION` 的「找 label → 开门控 → 操作 → 回显」：

1. **定位** `el-form-item`（body → 可见 dialog/drawer；与 tree 相同弹窗感知）。
2. **门控**：item 内找 `.tssc-multi-select` 或 Vue 链 `TsscMultiSelect`；否则 `no-tssc-multi-select`。
3. **已选短路**：readback 已匹配 → `ok-already`。
4. **打开**：点触发器（`.el-select .el-input__inner` / 可见 input）；等待 `.el-select-dropdown` 内出现 `.select-table` / `tr.el-table__row`（轮询，对标 remote 等行）。
5. **匹配行**（按优先级）：
   - `first` 别名 → 首行；
   - 精确：任一 cell / `params.text` 列文本 `=== option`；
   - 若面板有搜索框且首屏无匹配：填 keyword → 若有「精确查询」开关且关键词像完整中文名，可拨到精确（`exactBtn`）→ 再收集行；
   - 模糊：cell / 行全文 `includes`（最短命中）；
   - **禁止**只取「第一非数字 cell」作为唯一标签（这是要素库相对客户名称的硬伤）。
6. **点击**：`tr` 或 `td .cell` 上 mousedown+click（必要时再点 `tr`）；可选一次 CDP real_click 仅当 echo 失败。
7. **回显**：trigger `value` 或 `vm.selectName/myValue/chosenValue` 匹配期望（允许 name+id 粘连后缀，客户名称场景仍兼容）；失败 → `err-no-echo`。
8. **不点**外层「选择要素」弹窗的「确定」——本动作只填字段；外层确定仍由 agent `click_save` / 索引点确定（对标 tree_picker「只选叶，确认你自己点」）。

## 6. 扫描与路由

**`JS_CLASSIFY_FIELD`（伪代码顺序）**

```
date → tree-select(TsscMultiTree markers)
    → tssc-multi-select(.tssc-multi-select / Vue TsscMultiSelect)  // NEW，须在 .el-select 前
    → select(.el-select)
    → radio / checkbox / input
```

**Autofill / pending tasks**：`tssc-multi-select` → 推荐动作 `tssc_multi_select`（对标 `tree-select` → `select_tree_option`）。

**Prompt**

- 新包 `scripts/prompts/agent-tools-tssc-multi-select.md`（针 characterize）。
- 改 `agent-tools-form.md` / `phase/prompts.py`：删「表格行远程下拉必须用 select_option」；改为本动作。
- 与 tree 文案平行：`disabled` / `no-tssc-multi-select` / `err-no-echo` 行为句。

## 7. 落地文件（实现阶段；本 spec 不改代码）

| 区域 | 路径（预期） |
|---|---|
| JS | `scripts/controller/actions/js_snippets/tssc_multi_select.py` |
| 聚合 | `_js_snippets.py` re-export |
| Engine | `SelectEngine` 新方法 **或** 薄 `TsscMultiSelectEngine` 挂在 `_register_form_actions`（风格近 `TreeEngine.select_tree_option`） |
| Register | `_form.py` `@controller.action(...)` |
| Scan | `scan_utils.py` `JS_CLASSIFY_FIELD`；`scan_form.py` 若有平行分支一并改 |
| Locator kind | `page-locator-helpers.js` + gen `_locator_helpers_js.py`：`form_tssc_multi_select` |
| 模型/导出 | `scripts/models/action.py`、`state.py`、`event_dispatch.py`、`src/models/action-name.js`、`legacy-engine-export.js` |
| Prompt | `agent-tools-tssc-multi-select.md` + form/phase 修正 + create/shim 打包 |
| 测 | `scripts/characterization/cold/characterize-tssc-multi-select.py`（字符串/注册/classify 顺序针） |

## 8. 验收

1. Characterize cold 全绿；`JS_CLASSIFY_FIELD` 源中 `.tssc-multi-select` 出现在 `.el-select` 判定之前。
2. 干跑：「选择要素」弹窗对「要素名称」调用 `tssc_multi_select('要素名称', '部署方式')` → `ok*`，触发器回显中文，`elmtNo` 由 SUT 回填（动作不手写编码）。
3. 对普通 `el-select` 误调 → `no-tssc-multi-select`，不假 ok。
4. Prompt 包可被 agent create/shim 加载；不再指示用 `select_option` 点 `.select-table` 行。

## 9. 风险与后续

- **客户名称** 等已靠 `select_option` 表行路径跑通的轨迹：v1 不破坏该路径；新扫描会把同类字段导到本动作——需一条客户名称冒烟防回归。
- **`$emit` 不落 model**（KB 旧坑）：本动作以 **UI 行点击 + 回显** 为准，不走直写 form.model（避免与 tree `$emit` 路径混淆）。
- 后续可选：分页翻页、`multiple`、introduce_pick 门闸、要素库 T4 重录。

## 10. 决议摘要（请审）

1. **做专用动作**，不继续加厚 `select_option` 作为主路径。  
2. **契约与文件布局对标 `select_tree_option`**，不是对标 `tree_picker_click`（无 path）也不是 `picker_dialog_*`。  
3. **扫描先于 `.el-select` 分流**；失败码与 agent 纪律照抄 tree。  
4. **匹配键以 `params.text` 列 / 任意 cell 为准**，修复「只认第一列英文」缺陷。  
