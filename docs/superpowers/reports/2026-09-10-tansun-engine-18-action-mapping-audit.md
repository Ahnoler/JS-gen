# 18 动作映射支持矩阵 — tansun_ui_engine 调研汇总

> 2026-09-10 · JS-gen 引擎线 · 4 路并行子智能体调研（click 族 / input-select-radio 族 / 报文链路 / JS-gen 推送侧）+ 主会话汇总。
> 目标：JS-gen 18 个录制动作按映射表推给同事执行引擎（D:\dev\tansun_ui_engine），确保全部可执行。
> 映射表：录制动作 → 伙伴 type + 操作名样式（dataName）+ objectValue。

---

## 0. 三行总结论

1. **同事引擎现有可跑通的只有 3 类 event**：`click / input / select:click`（18 白名单内）。映射表要求但引擎**不存在**的 event：**`radio`、`select:tree`、`date`**——v3 链路整包被拒（payload.py:323-325 ValueError），v1 链路该步**静默丢弃**（case.py:50-60），联调时极危险。
2. **操作名前缀样式（图标：/选择：/单选：…）只存在于 JS-gen 的传统 5 字段导出**（legacy-engine-export.js buildOperationName），**V3 推送链路用的是裸名词**（transaction-export.js buildBusinessObjectName）。同事引擎对 dataName **零解析**（纯日志/labelHint），且**前缀会污染 label 匹配**（fill/select 的 labelHint 带前缀导致精确匹配失效）——**推送侧不该加前缀，引擎侧 norm 需剥前缀**，二选一，推荐前者维持现状+后者防御。
3. **最大的单点是值字段分流**：引擎 handler 的 `value` 参数来自 `step.val`（operation.value），**只有 select:click 读 objectValue**。JS-gen 映射表「objectValue=取值」对 input/radio 两族必须同时写 `operation.value`，否则引擎拿到空值；date/radio/select:tree 三个 event 未实现前，先靠这个分流可让 radio 走 `checkSelect` 通道跑通主路径。

## 1. 映射支持矩阵（18 动作）

图例：✅=可跑通｜🟡=type 对但语义缺口｜❌=引擎不承载｜🚫=推送侧也缺

| # | JS-gen 动作 | type | 引擎 handler | 现状 | 主要缺口（引擎侧 / 推送侧） |
|---|---|---|---|---|---|
| 1 | click_button | click | handle_click | 🟡 | 缺 G1 容器优先三层/图标 aria 打标/池化消歧（ambiguous 静默点第一个）/提交类护栏；**dataName「图标：」前缀污染文本兜底** |
| 2 | click_element_by_index | click | handle_click | 🟡 | durable 链等价；缺分类沉降/locator 兜底 .last；前缀「点击：」污染 |
| 3 | click_menu_item | click | handle_click | 🟡 | **缺 submenu 自动展开**（只能点一级）；「菜单：」前缀污染 |
| 4 | click_adjacent_button | click | 无等价 | ❌ | 全缺：按 form label 找相邻按钮（label exact/partial 分序+按钮关键字池）；element=xpath 可兜底主路径 |
| 5 | workspace_tabs(activate) | click | 无等价 | ❌/🚫 | 引擎无 .tag-item 概念；**且录制未调 _enrich_click_element，导出 target 可能为空** |
| 6 | switch_tab | click | handle_click | 🟡 | `.el-tabs__item` 在池中，**剥「页签：」前缀即可基本等价**（成本最低） |
| 7 | tree_picker_click | click | 无等价 | ❌/🚫 | 全缺：path_texts 逐级真实点击+回显验证；**推送侧 path_texts 未进 objectValue（恒空）——双侧都要改** |
| 8 | close_dialog | click | 无等价（closeWindow=关页面，勿混用！） | ❌ | 全缺：可见弹窗逆序+headerbtn 选择器族；dataName 固定「关闭弹窗」无参数 |
| 9 | expand_all_el_tree | click | 无等价 | ❌/🚫 | 全缺；**录制端从不落步骤（无 _record_action+SKIP 表），推送侧实际推不出** |
| 10 | fill_form_field | input | handle_input+replay_fill | 🟡 | native setter 同构可用；**缺日期升格 date（推送链未调 resolveEngineType，恒 input）+daterange 双 input**；「填写：」前缀污染 labelHint；**值必须写 operation.value（引擎只读 val）** |
| 11 | picker_dialog_query | input | 拆步可承载 | 🟡 | 无复合 handler——推荐 JS-gen 拆 N×input+1×click；dataName 加字段名区分 |
| 12 | select_option | select:click | handle_select_click | ✅ | **承载最完整**：objectValue 优先+[last()] 弹窗修正+精确+最短包含+回读校验。可选补 absent=skip 语义（现 not-found=error 中断整案） |
| 13 | picker_dialog_select | select:click | **语义不符** | ❌ | handle_select_click 强依赖 .el-select，**表格行必返 no-select-found**；需新建行选择 handler |
| 14 | select_tree_option | select:tree | **event 不存在** | ❌ | v3 整包拒/v1 静默丢；需新 event+handler+JS（$emit('input',code) 契约，见 select:tree 交接包） |
| 15 | click_radio | radio | **event 不存在**；checkSelect 可近似 | ❌ | 短平快=映射到 checkSelect+选项值写 operation.value（引擎零改动跑通主路径）；引擎侧需补 [last()]+scrollIntoView+**堵布尔伪成功**（misc.py:176 选项文本非布尔关键字时 toggle 返回假 ok） |
| 16 | click_table_row_button | click | 无等价 | ❌ | 全缺：行文本→tr→行内按钮（禁盲点带结构化错误）；「表格：行/文案」按 `/` 拆 |
| 17 | click_table_row_radio | radio | 无等价 | ❌ | 全缺；与 #13 共用表格行定位基建 |
| — | （表外）tssc_multi_select | select:click | handle_select_click | ✅ | 推送照发，el-select 场景可跑 |

## 2. 新增 event 改动面（同事引擎，select:click 样板六处）

对 `radio`、`select:tree`、`date`（fill_form_field 日期升格）三个新 event：

1. `ui_execute/models/enums.py:6-26` — Event 枚举加成员（样板 SELECT_CLICK:12）；
2. `ui_execute/models/payload.py:284-288` — `_EVENT_TYPES` 白名单同步（**双重校验，漏一处即 PAYLOAD_INVALID_OPERATION**）；
3. 新建 `ui_execute/engine/actions/<name>.py` — handler + `action_registry.register(...)`（select_click.py:298 样板）；
4. `ui_execute/engine/action_registry.py:48-63` — load_actions() 加 side-effect import；
5. `docs/EXECUTION_PAYLOAD_MIGRATION.md:152-172 / :472-494` — event 枚举表+操作类型表补行；
6. `tests/test_<name>.py` — 三层断言样板（registry 注册 / v3 dict→payload_to_case→event.value / handler skip-ok-error 行为，Fake page 模式见 test_select_click.py）。

仓外协调：ATP 侧 operation.type 支持列表 + 调度平台 payloadJson 透传（v1 未知 event 静默丢步骤——联调必核）。

## 3. handler 约定（case_executor.py:386-579 生命周期）

- 签名 `async def handler(page, step, locator, value, context) -> dict`；
- 返回 `{"status": "ok"|"skip"|"error", "action": ..., "reason"/"error": ...}`——**error=整案终止**（无步骤级重试），skip=记日志继续（absent 语义可直接用 skip 承载）；
- `value` 来自 step.val 经数据源解析；**object_value 不经解析，handler 自取**（样板 `step.object_value or value`，select_click.py:243）；
- 定位：`element` 非空 → LocatorResolver.resolve；`is_scroll=1` 时 30s 无可见节点直接 EXCEPTION——**新动作 is_scroll 建议恒 0**，定位交给 handler 内 JS；
- 截图由 executor 统一做（step.screenshot==1）；handler 不自处理 wait_time；
- Element UI 铁律：el-select 走真实 mousedown+选项点击（select_click.py JS 即样板）。

## 4. JS-gen 推送侧修复清单（我方）

| # | 修复 | 位置 | 说明 |
|---|---|---|---|
| P1 | tree_picker_click 的 path_texts 进 objectValue | `src/services/legacy-engine-export.js:223 pickOperationValue` 补 case | 否则引擎侧无从拿逐级路径 |
| P2 | fill_form_field 日期升格接入 V3 推送链 | `transaction-export.js:111 mapStepToTransactionEvent` 接 `resolveEngineType`（legacy-engine-export.js:246） | 现在恒 input，`date` eventTypeName 不可达 |
| P3 | expand_all_el_tree 录制端落步骤 | `scripts/controller/actions/tree_engine.py:39`（无 _record_action+在 _SKIP_SCREENSHOT_ACTIONS） | 否则转换器空转，映射表第 9 行永不可达 |
| P4 | workspace_tabs 补 element 采集 | `_workspace.py:130`（未调 _enrich_click_element） | 否则导出 target 空，引擎必 skip |
| P5 | radio 主路径兼容 checkSelect 通道（过渡方案，与同事约定后启用） | 映射表 #15 改推 checkSelect+选项值写 operation.value | 引擎零改动先跑通；radio event 落地后切回 |
| P6 | 操作名前缀：**推送侧维持裸名词**（V3 现状），与同事确认映射表前缀样式仅用于伙伴平台展示 | `transaction-export.js:73 buildBusinessObjectName` | 引擎把 dataName 当 labelHint，带前缀反而破坏精确匹配；若伙伴平台确需前缀，引擎 norm 同步剥前缀（防御） |

## 5. 同事引擎侧实施优先级（给同事的路线图）

1. **第 0 刀（一处救三动作）**：click.py/replay_adapter norm 增 dataName 前缀剥离（`^[^：:]{1,4}[：:]`），救活 switch_tab/click_menu_item/click_element_by_index 的文本兜底；
2. **零成本三动作**：expand_all_el_tree（纯 JS 移植）/close_dialog（JS 移植）/radio 短平快（JS_CLICK_RADIO_BY_XPATH 补 [last()]+scrollIntoView+堵布尔伪成功+值改读 object_value or val）；
3. **event 三连**：radio/select:tree/date 按 §2 六处清单落地（JS 从三份交接包移植：radio-handover.zip / select-tree-handover.zip / click-button-handover.zip 的 js_snippets）；
4. **表格基建一箭双雕**：新建 table_action.py（行文本→tr 定位）同时承载 picker_dialog_select（行选择）与 click_table_row_button/click_table_row_radio；
5. **补齐 JS 移植**：邻钮（fill_engine.py:685）/菜单 submenu 展开（_navigation.py:40）/页签 chips（workspace_tabs.py）/G1 容器优先（_misc.py:67）/表格行按钮（_table.py:54）；
6. **收尾**：click_button 池化消歧（ambiguous 不盲点）+ 分类沉降（replay_wait）+ absent=skip 语义统一（级联场景 not-found 不中断）。

## 6. 横切提醒（联调必核）

1. **v1/v3 容错差异**：v3 未知 event=整单失败；v1=该步静默丢——联调前必须先对齐 event 白名单，否则 select:tree/radio 步骤无声消失；
2. **值字段双写**：input/radio 族 objectValue 与 operation.value **双写同值**（引擎 input/checkSelect 只读 val）；
3. **xpath 硬前提**：五族动作都无 label-only 路径（引擎无 scan 缓存体系），element(xpath) 缺失=必 skip——JS-gen 侧 P3/P4 两个「不采集 element」的坑修掉前，两个动作推了也白推；
4. **登录组件**：引擎 scheduler 链有硬编码临时登录（scheduler/payload.py:30，701994/stepRefId 777488…），functional-module 登录组件接口已有文档但引擎无调用点——与映射无关但联调时会先撞上。
