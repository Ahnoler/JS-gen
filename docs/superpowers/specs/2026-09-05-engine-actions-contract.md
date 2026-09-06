# Actions 契约（执行引擎跨团队接口约定）

> 2026-09-05 定稿 · Zcode Lead。双方：JS-gen（录制侧，产出轨迹步骤）↔ 同事执行引擎（Python，消费轨迹步骤）。
> 本文档是**动作词汇与结果协议的唯一约定**；动作清单以代码为准（`replay_names.py` / `_replay.py` 直派表 / controller 注册表），代码变更须同步本文并 bump engine-subset 版本（见 [导出方案 §3](superpowers/research/2026-09-05-replay-engine-handover-export.md)）。

## 1. 步骤单元（entry）契约

执行引擎逐条消费步骤，结构：

```jsonc
{
  "id": "可选，原样回传到结果行",
  "action": "fill_form_field",          // 动作名，见 §2；别名归一见 §3
  "params": { "label_text": "客户名称", "value": "贯通验证企业" },
  "element": {                          // element_json——定位元数据载体（定位唯一真源）
    "xpath_smart": "…语义锚 xpath…",    // 优先消费
    "xpath_full": "/html/body/…",       // 兜底
    "formLabel": "客户名称", "placeholder": "...", "tag": "INPUT",
    "attr": "...", "rect_norm": "...", "occurrence": 1
  },
  "target": "…xpath 兜底来源…", "tagName": "...", "attributes": { "xpath": "..." }
}
```

**定位铁律**：引擎只认 `element.xpath_smart → element.xpath_full` 链（`_replay.py:317`）；**`params.xpath_smart` 被故意忽略**（脏参数历史教训，traj 130 step 23）。菜单导航类（`click_menu_xpath`）例外，吃 `params.xpath`。

## 2. 动作词汇表（canonical 名单，snake_case）

### 2.1 直派动作（`_DIRECT_REPLAY_ACTIONS`，_replay.py）

| 动作 | params | 结果附加 | 说明 |
|---|---|---|---|
| `go_to_url` | `url` | — | Playwright goto 导航 |
| `scan_menu_tree` | — | `menus` | 采集菜单树（JS_SCAN_MENU_TREE） |
| `read_page_component_code` | — | `pageCode` | 读页面组件码/场景码 |
| `click_menu_xpath` | `xpath`（或 `element.xpath_full` 兜底） | — | 菜单导航：JS 合成点击（隐藏节点可点，见 09-05 菜单验证）+ 点击后真实 mousedown 安全点收起 mega-menu |

### 2.2 关闭/点击组（幂等探测 + 持久化点击，_replay_close_dialog_idempotent）

`click_menu_item` · `click_button` · `click_adjacent_button` · `click_table_row_button` · `switch_tab` · `close_dialog`

params 主要：`text` / `menu_text` / `section` / `region` / `tab_name` 等（按动作）。

### 2.3 索引点击与表格

| 动作 | params 主要项 | 说明 |
|---|---|---|
| `click_element_by_index` | `index`、`text`/`menu_text`、`xpath`、`tag_name`、`parent_text`、`icon_class`、`target_kind` | 多源兜底阶梯（replay_click.py） |
| `click_table_row_radio` | 行语义匹配参数 | Element UI 固定列 radio 语义匹配优先（replay_table.py） |

### 2.4 表单四件套（`_FORM_ACTIONS`，replay_form_action.py；不走 controller 注册表）

| 动作 | params | 说明 |
|---|---|---|
| `fill_form_field` | `label_text`、`value`（别名 value/option/option_text/text 归一）、`placeholder` | native setter 填充 + 回读校验 |
| `select_option` | `label_text`、`option_text` | el-select：真实 mousedown 开下拉，exactOnly 防漂移，事后回读 + option-mismatch 校验 |
| `select_tree_option` | `label_text`、`option_text` | 树选择三段式 |
| `click_radio` | `label_text`、`option_text` | radio 组 |

### 2.5 检查点与等待

| 动作 | params | 说明 |
|---|---|---|
| `save_form_snapshot` | `fields?`、`container?`（main/drawer:…/dialog:…） | 表单结构检查点，结果恒 `form-structure:<json>` |
| `wait_for_loading` | — | 结果以 `loading-done` 前缀判成功 |
| `click_save` | `button_text`（默认 保存）、`section`、`region` | 保存成功后触发保存后 idle 等待（_replay.py:101 特判） |

### 2.6 registry 兜底开放集（build_controller 注册，未命中直派表时调用）

`real_click` · `semantic_snapshot` · `verify_context` · `read_xhr_log` · `read_business_date` · `read_error_notify` · `strip_stale_dialogs` · `close_visible_dialog` · `list_todo_cards` · `picker_dialog_query` · `picker_dialog_select` · `tree_check_confirm` · `tree_picker_click` · `save_section` · `workspace_tabs` · `wf_submit_guard` · `introduce_guarantor` · `export_dicts` · `kb_flow` / `kb_rule` / `kb_field` / `kb_dict` / `kb_state`

约定：registry 是**开放集**（随 engine-subset 版本发布清单）；未注册动作返回 `unknown-action:<name>`。

## 3. 动作名归一（replay_names.py，契约的一部分）

1. 旧别名 → canonical：`treeSelect/fillTree/…→select_tree_option`、`fillFormField/fillDateField→fill_form_field`、`clickIconButton→click_button`、`closeDialog→close_dialog` 等（全表见 `_ACTION_NAME_ALIASES`，17 条）。
2. kebab / camelCase 自动转 snake_case（`selectTreeOption→select_tree_option`）。
3. **新动作必须同时落两处**：代码注册 + 本文档 §2 加行；禁止只写别名不进注册表。

## 4. 结果协议（`_result_ok`，_replay.py）

每步产出结果行：

```jsonc
{ "index": 3, "action": "...", "params": {...}, "result": "<字符串>",
  "ok": true, "locate": "element|full|...", "id": "可选", "menus?": [...], "pageCode?": {...} }
```

`result` 字符串分类（判成败的唯一依据）：

| 前缀/值 | 判定 | 语义 |
|---|---|---|
| `ok…` / `ok-xxx \| …` 复合头 | 成功 | 含 `ok-skip:label-not-found`（级联字段缺位=跳过成功，不进 heal） |
| `form-structure:` | 成功（仅 save_form_snapshot） | 检查点 JSON |
| `loading-done…` | 成功（仅 wait_for_loading） | |
| `already-filled` | **不成功**（有意） | 跳过但不计成功 |
| `label-not-found`（裸） | 成功（缺位字段） | 与 ok-skip 同语义 |
| `error:` / `unknown-action:` / `err…` / `click-failed` / `not-found` | 失败 | |

批级返回：`{count, ok, failed, error, results, stoppedAt?}`；`error`="N/M steps failed; first: <action> → <result>"。`stop_on_fail=True` 时首败即停，`stoppedAt`=失败步序号（产品语义恒为 true）。进度事件 `replay_step`（index/total/action/params/result/ok/locate/id），**[N/M] 是本批次计数不是轨迹总步数**。

## 5. 引擎侧行为约定（对齐冒烟）

1. 每步前 `_wait_if_loading`，每步后重取 page（tab 切换 page 失效）。
2. Element UI 铁律：native setter 绝不裸 `page.fill()`；el-select 走真实 mousedown + 选项点击；每步重查 DOM。
3. 对拍冒烟（每次版本 bump 双方必跑、结果须一致）：test.creditv5p2 一条轨迹含 ① fill_form_field ② select_option ③ click_button 保存，判 ok/failed 一致。

## 6. 契约变更流程

改动作词汇/参数/结果分类 → 同一提交更新本文档 → bump engine-subset（MANIFEST 记 git hash）→ agent-log 收工条目注明。本文档与 `replay_names.py` 不一致时**以代码为准并视本文档为待修缺陷**。
