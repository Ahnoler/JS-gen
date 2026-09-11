# 18 动作映射支持矩阵 — tansun_ui_engine 调研汇总

> 2026-09-10 · JS-gen 引擎线 · 4 路并行子智能体调研（click 族 / input-select-radio 族 / 报文链路 / JS-gen 推送侧）+ 主会话汇总。
> 目标：JS-gen 18 个录制动作按映射表推给同事执行引擎（D:\dev\tansun_ui_engine），确保全部可执行。
> 映射表：录制动作 → 伙伴 type + 操作名样式（dataName）+ objectValue。
> **更正（同日，用户确认）**：`radio` / `select:tree` 已在同事**最新（尚未推送）版本**实现——本仓克隆只含远端唯一提交 2b22613，未含这两者；矩阵 #14/#15 由 ❌ 改为「待复验」，`date`（fill 日期升格）用户未提及，仍按缺失对待。
> **第二次更正（2026-09-11，同事已推送 1bf04f0+5e12ff1）**：radio / select:tree / click_button 兜底已**实码入库**（见 §8 重评估）；实装基线从 2b22613 换为 TY_UI_ENGINE_1.0.0（5e12ff1）。
> **范围约定（同日，用户二次澄清）**：当前问题=**推送的操作同事引擎无法正确处理，需要做兼容**——在 tansun_ui_engine 侧使 18 映射操作全部被正确执行：①补齐缺失操作 handler（映射表逐行）；②修正已接收操作的错误处理（值字段分流、dataName 前缀语义路由）。**仍不做**：JS-gen 推送链改动（§4 P1-P6）、消歧/沉降/absent=skip 等打磨项（§5 尾步）、对方引擎无关 bug 与重构；radio/select:tree 待同事推送后复验、不在快照上重复实现。执行蓝图见 §7。
> **词表冻结（同日，用户定盘）**：推送 type 就六个——`click / input / select:click / select:tree / radio / date`，**不新增第七种**；18 操作全部在这六个 type 内表达，dataName 前缀是 type 内子操作路由键（见 §7）。
> **注**：§4 P6「前缀=污染」论断在映射表语境下需修正——「图标：/选择：/页签：…」前缀是映射表有意设计的**操作语义通道**（引擎路由读前缀、labelHint 匹配剥前缀），见 §7 批 1。

---

## 0. 三行总结论

1. **本仓快照（2b22613，远端唯一提交）可跑通的只有 3 类 event**：`click / input / select:click`。**用户确认：`radio`、`select:tree` 已在同事最新（未推送）版本实现**——合入前联调 mapped 报文仍会 v3 整包拒（payload.py:323-325 ValueError）/ v1 静默丢步（case.py:50-60）；`date`（fill 日期升格）未获确认，仍按缺失对待。
2. **操作名前缀样式（图标：/选择：/单选：…）只存在于 JS-gen 的传统 5 字段导出**（legacy-engine-export.js buildOperationName），**V3 推送链路用的是裸名词**（transaction-export.js buildBusinessObjectName）。同事引擎对 dataName **零解析**（纯日志/labelHint），且**前缀会污染 label 匹配**（fill/select 的 labelHint 带前缀导致精确匹配失效）——**推送侧不该加前缀，引擎侧 norm 需剥前缀**，二选一，推荐前者维持现状+后者防御。
3. **最大的单点是值字段分流**：引擎 handler 的 `value` 参数来自 `step.val`（operation.value），**只有 select:click 读 objectValue**。JS-gen 映射表「objectValue=取值」对 input/radio 两族必须同时写 `operation.value`，否则引擎拿到空值；radio event 合入前若需先行联调，可用 `checkSelect` 通道过渡（快照版有布尔伪成功 misc.py:176），合入后直接映射 radio。

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
| 14 | select_tree_option | select:tree | 同事最新版已实现（未推送） | 🟡→待复验 | 本仓快照无此 event；同事推送后按对齐清单复验：event 字面量=`select:tree`、handler 读 object_value、absent=skip、`$emit('input',code)` 契约（select-tree-handover.zip 可对照） |
| 15 | click_radio | radio | 同事最新版已实现（未推送） | 🟡→待复验 | 本仓快照无此 event（checkSelect 布尔伪成功 misc.py:176 为快照现状）；推送后复验：event 字面量=`radio`、值读 object_value or val、[last()]+scrollIntoView、absent=skip（radio-handover.zip 可对照） |
| 16 | click_table_row_button | click | 无等价 | ❌ | 全缺：行文本→tr→行内按钮（禁盲点带结构化错误）；「表格：行/文案」按 `/` 拆 |
| 17 | click_table_row_radio | radio | 无等价 | ❌ | 全缺；与 #13 共用表格行定位基建 |
| — | （表外）tssc_multi_select | select:click | handle_select_click | 🟡 | **分形态（09-11 复核 JS-gen `js_snippets/tssc_multi_select.py` 头注）**：字典选项形态（`.el-select-dropdown__item`，如要素类型）✅ 零改动可跑；**远程表格形态（`.select-table` 的 `tr.el-table__row`，如要素名称）❌**——handle_select_click 只等 `.el-select-dropdown__item`，表格面板 10s 超时→Escape→error；且远程搜索异步 ~300ms 须过滤静置（禁见行就点，历史坑：误点残留首行 ok-p1:部署方式）。修复入批 4 tssc 分支 |

## 2. 新增 event 改动面（同事引擎，select:click 样板六处）

~~对 `radio`、`select:tree`、`date`（fill_form_field 日期升格）三个新 event~~（**更正：radio / select:tree 已在同事最新未推送版本实现，本节仅剩 `date` 适用**；radio/select:tree 合入后按下表口径复验）：

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
| P5 | radio 映射等待同事新版本合入（radio event 已实现未推送）；合入前联调可选 checkSelect 过渡 | 映射表 #15 | 合入后直接推 radio（值仍须双写 operation.value） |
| P6 | 操作名前缀：**推送侧维持裸名词**（V3 现状），与同事确认映射表前缀样式仅用于伙伴平台展示 | `transaction-export.js:73 buildBusinessObjectName` | 引擎把 dataName 当 labelHint，带前缀反而破坏精确匹配；若伙伴平台确需前缀，引擎 norm 同步剥前缀（防御） |

## 5. 同事引擎侧实施优先级（给同事的路线图）

> 更正：原第 2/3 步中 radio、select:tree 已在同事最新未推送版本实现，从本路线图移除；保留项按快照（2b22613）列出。

1. **第 0 刀（一处救三动作）**：click.py/replay_adapter norm 增 dataName 前缀剥离（`^[^：:]{1,4}[：:]`），救活 switch_tab/click_menu_item/click_element_by_index 的文本兜底；
2. **零成本两动作**：expand_all_el_tree（纯 JS 移植）/close_dialog（JS 移植）；
3. **date event 单连**：fill_form_field 日期升格按 §2 六处清单落地（JS 从 radio-handover.zip / select-tree-handover.zip / click-button-handover.zip 移植 js_snippets 的方式不变）；
4. **radio / select:tree 合入后复验**（对齐清单见矩阵 #14/#15：event 字面量与映射表一致、object_value 读取、absent=skip、布尔伪成功是否已堵）；
5. **表格基建一箭双雕**：新建 table_action.py（行文本→tr 定位）同时承载 picker_dialog_select（行选择）与 click_table_row_button/click_table_row_radio；
6. **补齐 JS 移植**：邻钮（fill_engine.py:685）/菜单 submenu 展开（_navigation.py:40）/页签 chips（workspace_tabs.py）/G1 容器优先（_misc.py:67）/表格行按钮（_table.py:54）；
7. **收尾**：click_button 池化消歧（ambiguous 不盲点）+ 分类沉降（replay_wait）+ absent=skip 语义统一（级联场景 not-found 不中断）。
4. **表格基建一箭双雕**：新建 table_action.py（行文本→tr 定位）同时承载 picker_dialog_select（行选择）与 click_table_row_button/click_table_row_radio；
5. **补齐 JS 移植**：邻钮（fill_engine.py:685）/菜单 submenu 展开（_navigation.py:40）/页签 chips（workspace_tabs.py）/G1 容器优先（_misc.py:67）/表格行按钮（_table.py:54）；
6. **收尾**：click_button 池化消歧（ambiguous 不盲点）+ 分类沉降（replay_wait）+ absent=skip 语义统一（级联场景 not-found 不中断）。

## 6. 横切提醒（联调必核）

1. **v1/v3 容错差异**：v3 未知 event=整单失败；v1=该步静默丢——radio/select:tree 已在同事最新版实现但**尚未推送**，本仓快照联调仍会触发；联调前必须先对齐 event 白名单（含 date 是否同步实现），否则步骤无声消失；
2. **值字段双写**：input/radio 族 objectValue 与 operation.value **双写同值**（引擎 input/checkSelect 只读 val）；
3. **xpath 硬前提**：五族动作都无 label-only 路径（引擎无 scan 缓存体系），element(xpath) 缺失=必 skip——JS-gen 侧 P3/P4 两个「不采集 element」的坑修掉前，两个动作推了也白推；
4. **登录组件**：引擎 scheduler 链有硬编码临时登录（scheduler/payload.py:30，701994/stepRefId 777488…），functional-module 登录组件接口已有文档但引擎无调用点——与映射无关但联调时会先撞上。

## 7. 兼容实装方案（词表冻结版执行蓝图，待开工）

> 范围=让本表 18 行推送操作在同事引擎全部被正确处理；落点=tansun_ui_engine（本地克隆，当前 2b22613）；**不改 JS-gen 推送链**。
> **词表冻结（用户定盘）**：type 词表=六——`click / input / select:click / select:tree / radio / date`，不新增第七种；18 操作全部在六 type 内表达，处理三层模型：**type 定 handler → dataName 前缀定子路径 → 剥前缀后文本作 labelHint**。各 type 承载：click=10 操作（图标：/点击：/菜单：/邻钮：/页签：/树选：/关闭弹窗/展开树/表格：），input=2（填写：/弹窗查询：），select:click=2（选择：/弹窗选择：），select:tree=1（选择：），radio=2（单选：/表格单选：），date=fill 日期升格（推送侧自动升格，引擎侧 event 必须存在）。

- **批 1 错误处理修正**：`input_action.py` 值改读 `step.object_value or value`（select_click.py:243 样板）；dataName 前缀解析 helper——前缀是子操作路由键（路由读前缀、labelHint 用剥前缀余部），一并修 fill/select 现有 hint 传参；
- **批 2 click 前缀子路由（一）**：`handle_click` 按 dataName 前缀分流到移植 JS：`关闭弹窗`（可见弹窗逆序+headerbtn 选择器族，移植 close_visible_dialog）/`页签：`（workspace_tabs.py chips JS，switch_tab 同通道）/`展开树`（el-tree 递归展开 JS）——纯 click 通道，无新 type；
- **批 3 click 前缀子路由（二）**：`表格：{行文本}/{文案}`（_table.py:54 移植，按 `/` 拆行文本与按钮文案）/`树选：`（select-tree-handover 包 tree_picker_click JS）/`邻钮：`（fill_engine.py:685）/`菜单：`（_navigation.py:40 submenu 自动展开）；
- **批 4 date event + select:click 行选分支**：`date` 是六 type 之一，按 §2 六处清单落地（enums/payload/registry/handler/文档/tests），daterange 契约=$emit('input',[s,e])；`弹窗选择：`行选=select_click handler 内前置分支（object_value=行文本→表格行选择，绕开 .el-select 硬依赖），同样不新增 type；
- **批 5 同事新版本合入后复验**：radio / select:tree 按矩阵 #14/#15 四条清单核对（字面量/object_value/absent=skip/布尔伪成功）；click_table_row_radio 依赖其 radio 对表格列场景的支持度，不足再补（补法仍是 radio type 内分支，非新 type）；
- **工程约定**：分支 `compat/js-gen-operations`（不推远端，由用户/同事验收后合并）；每批配 `tests/test_*.py`（test_select_click.py 三层断言样板）；除批 4（date 进 enums/payload/registry）外不动共享三处，降低与同事未推送版本的合并冲突面；
- **已知边界（推送侧事实，仅备案不改）**：`展开树` 录制端不落步骤（P3）；V3 推送链日期未接升格（P2）——引擎侧六 type 支持照做，步骤是否实际到达属推送侧行为。

### §7.1 推送接口数据格式核对（2026-09-10 深夜补，全链路实证）

> 应用户要求重读推送接口数据格式。JS-gen 推送侧（`transaction-export.js`）与同事引擎接收侧（`scheduler/payload.py` → `models/payload.py` → `CaseModel.steps` → `StepModel`）逐字段对齐结论：

**两条推送通道是两套报文，同事引擎两套都吃：**

1. **importDemand 建交易通道（JS-gen → 伙伴平台 ATP）**：`{transcationEventTypeList:[{transcationName,systemId,projectId,transcationType:'web',testFrame:'playwright',transcationProperties:[{options,elementType,eventTypeName,eventTypeValue,objectValue,propertiesName,mothed:'By.XPATH'}]}]}`。`eventTypeValue` ∈ 六 type 词表（`EVENT_TYPE_NAME` 中文标签映射），`elementType`=xpath，`propertiesName`=裸名词+同交易内去重加后缀。**引擎不直接吃这个报文**——它先落 ATP 平台，调度平台再组装成 payloadJson 下发。
2. **payloadJson 执行通道（ATP/调度平台 Pull → 引擎 scheduler/payload.py:105）**：V2/V3 结构化报文（schemaVersion 2.0/3.0）→ `ExecutionPayload` → 每 component 拆一个 `ExecuteRequest`，`_step_to_transaction`（payload.py:318-382）把 Step 压平成老版 transaction JSON 字符串。**V1 老格式**（无 schemaVersion）直接按 `ExecuteRequest`+`transactionList` 收（payload.py:164-177，id 必须>0）。

**字段级核对（V3 Step → transaction → StepModel → handler 可见值）：**

| 报文字段 | 映射 | handler 侧 | 影响 |
|---|---|---|---|
| operation.type | 白名单校验 payload.py:323-325 → `event` | `step.event`（Event 枚举） | 六 type 词表冻结点=这行校验；未在白名单即 PAYLOAD_INVALID 整单拒 |
| step.name | → `dataName` | `step.data_name` | **三层模型的子操作路由键就是这里**；ATP 组装时 propertiesName→name 是否保前缀待联调实证 |
| operation.value | → `val` | 经 `_data_source.resolve(step.data_source, step.val, context)`（case_executor.py:428） | dataSource=constant 时原样透传；quantity 走上下文变量池 |
| operation.objectValue | → `objectValue` **双写**（payload.py:374 `xpathObjectValue` + :380 `objectValue`） | `step.object_value` | 值字段分流结论不变：handler 只有显式读才有 |
| elementTarget.primaryLocator | → `element`+`mothed`（CSS_SELECTOR→By.CSS 归一，COORDINATE→element 空+location 坐标，payload.py:331-341） | `step.element`/`step.mothed` | **primaryLocator.method+value 双非空硬校验（:333-334），缺即整单拒**——推送侧 elementType=null 的步骤（如 expand_all_el_tree）在 V3 通道必炸，v1 通道才静默 |
| elementTarget.scrollIntoView | → `isScroll` | `step.is_scroll` | isScroll=1 时 resolver 30s 无可见节点抛 EXCEPTION（locator.py 语义）——新子路径建议 0 |
| operation.waitSeconds / elementTarget.timeoutSeconds | → `waitTime` | 定位后 visible wait（case_executor.py:421-422） | handler 不自处理 |
| operation.menuPath | 仅 executeAgent 用（:348-349 `' > '.join`） | — | 六 type 不用；菜单导航走 component.menuXPath |
| component.menuXPath | → 自动注入逐级 click 步骤（payload.py:385-416，dataName=`菜单切换-N`，isScroll=1，screenshot=1） | 普通 click 步骤 | **引擎已自带菜单导航**，映射表 click_menu_item 的「菜单：」前缀只覆盖组件内菜单点击，二者并存不冲突 |
| eleType | 非 ele（page/tab/collapse/dialog/step）→ operation 强制置 None 跳过执行（payload.py:146-154 + case_executor.py:394） | — | 分组容器步骤不消耗 type 词表 |
| dataSource/transmit/screenshotPolicy/executionHints | 全链透传 | 截图 executor 统一做 | 无新增兼容点 |

**对蓝图的三点修正：**

1. **批 1 的 dataName 前缀路由多一个上游验证点**：前缀活在 `step.name`→`dataName`，而 ATP 组装 payloadJson 时 name 取自建交易的 propertiesName（裸名词）还是我们映射表的带前缀样式，**联调第一步必须实证**——若平台侧剥前缀，引擎侧前缀路由拿不到键，兼容方案退化为「element xpath 主路径 + labelHint 兜底」，仍可跑但丢失子路径语义。给同事的联调清单加一条：抓一单真实 payloadJson 看步骤 name 实样。
2. **V3 通道 primaryLocator 硬校验改变了「推送侧也缺」动作的爆炸面**：elementType 为空的步骤（expand_all_el_tree/workspace_tabs 未采集）不是静默 skip，而是 **PAYLOAD_INVALID 整单拒**（比 v1 更响）。在词表冻结+不改推送链前提下，这些步骤到达引擎前就会被平台组装拦下——引擎侧子路径照做，但联调排期必须把「推送侧补采集」排进同一窗口，否则主路径根本到不了引擎。
3. **select:click 的 objectValue 双写位已确认**：payload.py:374/380 两处都写，引擎 `step.object_value` 必有值——批 4 行选分支读 object_value 的前提成立；radio/input 同理（前提是推送侧 value/objectValue 双写，属推送侧行为，备案）。

**报文样例（引擎侧单步 transaction，payload.py:352-382 实产）**：
```json
{"id":123,"dataName":"选择：结算方式","eleType":"ele","val":"","event":"select:click",
 "element":"//label[text()='结算方式']/..//input","mothed":"By.XPATH","location":"","waitTime":0,
 "dataSource":"constant","transmit":0,"screenshot":0,"xpathObjectValue":"银行转账","objectValue":"银行转账","isScroll":0}
```

---

## 8. 同事新提交重评估（2026-09-11，基线 2b22613 → TY_UI_ENGINE_1.0.0/5e12ff1）

> 同事推送两笔：**1bf04f0「补充操作事件」**（+1385 行：radio.py 206 行新文件 / select_tree.py 918 行新文件 / click.py 重写 +248 行 / enums+payload+registry）与 **5e12ff1「修改配置」**（config.py 默认值：MinIO/ATP 地址+密钥——同事自用配置，与本线无关，注意其中含 API key 明文）。全量测试 `pytest tests/ --ignore=tests/test_agent_e2e.py` = **216 passed**（test_agent_e2e 4 errors 为本机缺 Playwright 浏览器环境，非代码问题）。

### 8.1 已落地的（对照 18 动作矩阵）

| 项 | 状态 | 实证 |
|---|---|---|
| **radio event + handler** | ✅ 已实现 | radio.py 新文件；`radio`+`click_radio` 双注册（:205-206）；值取 `object_value or value or val`（:179）；absent=skip 语义（`label-not-found`→status ok method=absent-skip，:195）；[last()] 弹窗修正+drawer 感知在 JS 内；**布尔伪成功已堵**（pick() 精确→包含分序，非布尔关键字不再 toggle 假 ok） |
| **select:tree event + handler** | ✅ 已实现，**event 名=`select_tree_option` 不是 `select:tree`** | select_tree.py 918 行；`_EVENT_ALIASES = {"select:tree": "select_tree_option"}`（payload.py:293-294）——**V3 报文里 `select:tree` 会被别名归一后收下**，兼容面已覆盖；另注册 `tree_check_confirm`/`tree_picker_click` 两个独立 event |
| **click_button 兜底三层** | ✅ 已实现 | click.py 重写：JS_CLICK_BUTTON_IN_CONTAINER（z-index 最高 overlay+popper 补扫+label 开 trigger，移植自 JS-gen _misc.py G1）→ JS_CLICK_ICON_BUTTON（精确文本→icon aria/tooltip/Vue content→泛化兜底+**ambiguous 不盲点返回 err**）；locator 点击失败也落兜底（:267-273）；还有 JS_STAMP_ICON_ARIA_LABELS 图标打标 |
| **click 元素失败兜底链** | ✅ xpath replay→locator→**按钮文本兜底**→坐标（原来没有中间层） | click.py handle_click 新结构 |
| **tree_picker_click 独立 event** | ✅ 已实现（超出映射表预期） | select_tree.py:865 handler；path 收 JSON 数组（`_parse_json`），CDP real-click 兜底+回显验证 |
| **popup eleType** | ✅ 枚举+跳过执行同步 | enums.py POPUP + payload.py 描述更新 |

### 8.2 与映射表的差异点（实装时须适配，勿按旧蓝图硬做）

1. **event 名错位**：映射表推 `select:tree`，引擎原生枚举是 `select_tree_option`（靠 `_EVENT_ALIASES` 桥接）。复验重点=V3 报文 `operation.type="select:tree"` 实测走通 alias；若 ATP 平台对 type 值有自己的白名单（转发前校验），alias 救不了平台侧——联调时验证。
2. **radio 的 label 语义**：handle_radio 用 `data_name` 当 label（JS_CLICK_RADIO 按 form label 找组）——映射表 dataName 样式是「单选：{label}」**带前缀**，label 匹配会失败；但 element xpath 主路径在前（`step.element` 非空先走 JS_CLICK_RADIO_BY_XPATH），xpath 命中则前缀无碍；xpath miss 才落 label 路，**前缀剥离防御仍有价值**（与原批 1 结论一致）。
3. **tree_picker_click 的 path 载体**：handler 读 `_selection(step,value)`（object_value or value or val）再 `JSON.parse`——映射表要求的 path_texts 数组须以 JSON 字符串进 objectValue；**我们推送侧 P1（path_texts 进 objectValue）从"建议"变"硬前提"**，且格式必须是 JSON 数组字符串（如 `["集团","子公司","审批"]`），不是 `/` 拼接。
4. **select:click 行选（picker_dialog_select）仍未覆盖**：handle_select_click 未动，表格行仍必返 no-select-found——原批 4 行选分支照做。
5. **date event 仍缺**：六 type 词表之一，未在本次提交；批 4 照做（六处清单）。
6. **值字段分流已部分自愈**：radio/select_tree/click_button 新 handler 都读 `object_value or value or val`——**input 族仍只读 val**（input_action.py 未动），批 1 的 input 修正范围收窄为仅此一处。
7. **dataName 前缀路由面收窄**：click 兜底已用 `object_value or value or data_name` 取按钮文本（含 data_name 兜底）——「图标：新增」会整串当按钮文本找（带前缀匹配大概率 miss→err-icon-label-miss→整案 error）。**批 1 前缀剥离 helper 仍需要**，且落点变为：click 的 button_text、radio 的 label、select_tree 的 label、input 的 hint 四处统一走 parse_data_name。

### 8.3 更新后的实装计划（周末版，基线=TY_UI_ENGINE_1.0.0）

| 批 | 内容 | 相比原计划的变化 |
|---|---|---|
| ~~批 2/3 click 子路由~~ | **整批取消**——click.py 兜底已由同事实现（G1 容器+icon 三层+ambiguous 防盲点全部到位） | 省掉最大一块；仅存「关闭弹窗/展开树/页签：/表格：/树选：/邻钮：/菜单：」七前缀无专属子路径——见下行 |
| 批 1（收窄重定义） | dataName 前缀解析 helper + 四处接线（click button_text / radio label / select_tree label / input hint）：**路由到七前缀子路径 + 剥前缀作 labelHint** | helper 职责从"修 fill/select hint"扩展为"子路由+剥前缀"两用；input 值字段改读 object_value or val 保留 |
| 批 2（新） | **七前缀子路径注册**：关闭弹窗（close_dialog JS 移植）/展开树（expand JS）/页签：/表格：/树选：/邻钮：/菜单：——挂在 click handler 前缀路由层（批 1 helper 产出的 route_key 分发），miss 落回同事新兜底链 | 从"在 handle_click 里分流"改为"独立子路由模块（click_subroutes.py），handle_click 前置调用"，与同事代码冲突面最小 |
| 批 3（并入批 2） | —— | 原批 3 内容并入批 2 |
| 批 4（两处新增） | date event 六处清单 + select:click 面板内行选分支——**两个分支：①「弹窗选择：」（picker_dialog_select，objectValue=行文本）；②tssc_multi_select 远程表格形态（`.select-table` tr，移植 JS_TSSC_MULTI_SELECT 含过滤静置，字典形态走原链不动）**——本质同为"面板内表格行选择" | 09-11 复核后新增 ②；date 仍依赖推送侧升格接线（备案） |
| 批 5（升级为验证批） | select:tree alias 实测 + radio/树三兄弟（select_tree_option/tree_check_confirm/tree_picker_click）用映射表报文样例逐个过——他们已实现，只验不修 | 从"复验"升级为"用真实 V3 报文打样"；click_table_row_radio 若 radio 表格列场景缺，补 radio 内分支 |
| 新增批 0 | `git fetch` 后在 TY_UI_ENGINE_1.0.0 上重建 compat/js-gen-operations；跑通全量测试基线（当前 216 passed） | 原计划的开工前置正式化 |

**仍不做**（范围不变）：JS-gen 推送链 P1-P6、消歧/沉降/absent=skip 打磨、对方 MinIO/ATP 配置（5e12ff1 是同事环境配置，勿动勿评）。

---

## 9. 真实业务场景端到端湿测（实装收尾门，2026-09-11 增补）

> 定位：§8.3 各批做完只算"代码完成"，**本线验收以本节湿测 PASS 为准**——沿用本仓教训铁律「验收认业务证据，不认 recorded/代码绿」（recording-authenticity-lessons-0907）。

### 9.1 湿测形态与判据

**两级：**

- **L1 单链路湿测（每批收尾即做）**：真机启动同事引擎（`.venv` + Playwright chromium，被测系统 test.creditv5p2 或同事配置的 SUT），用 §9.2 场景构造单操作 V3 payloadJson 直投引擎执行接口（或经调度平台 Pull），判据=步骤 status=ok **且页面业务结果成立**（选中值回显/按钮后果可见/截图佐证），error/skip 逐条归因。
- **L2 端到端全链湿测（全部批完+批 5 验证过后做）**：JS-gen 真实录制一笔业务轨迹 → 按映射表推送 ATP 建交易 → 调度平台组装 payloadJson 下发 → 同事引擎真机执行 → 结果回传。判据=**整案 paas**（或逐案核对业务终态），18 操作在链路中至少各出现一次。

**环境前置（实装当天核对）：** ①引擎 `.venv` 装浏览器 `playwright install chromium`（当前本机 4 个 e2e error 即缺此）；②SUT 地址与账号（同事 config 或 JS-gen 侧 test.creditv5p2 701994）；③ATP 平台连通（同事 config.py 已配 test.atp.tansun.com.cn，key 在 5e12ff1）；④radio/树三兄弟若同事后续还有推送，先 fetch 再开测。

### 9.2 场景清单（18 操作 × L1，按批分组）

| 批 | 操作 | L1 场景（信贷系统页面形态） | 判据要点 |
|---|---|---|---|
| 批1 | input 值字段 | 客户名称/要素名称填值 | objectValue 进值且回显；「填写：xxx」带前缀 dataName 也能命中字段 |
| 批1 | radio（复验同事实现） | 评级表单单选「是/否」 | 选值落盘+absent=skip 行为；带前缀「单选：xxx」 |
| 批2 | 关闭弹窗 | 打开客户选择弹窗后关 | 弹窗消失，主页面可交互 |
| 批2 | 展开树 | 组织机构树展开 | 树节点全展开可见（注意：录制端不落步骤，L1 用手工构造 payloadJson 驱动） |
| 批2 | 页签：/switch_tab | 客户详情页签切换 | 目标页签激活态 |
| 批2 | 表格：行/按钮 | 授信列表行内「删除/编辑」 | 正确行的按钮被点（禁盲点，错行须报错） |
| 批2 | 树选：/树三兄弟 | TsscMultiTree 选「集团/子公司」 | 回显=选中 code/文本；tree_picker_click path=JSON 数组 |
| 批2 | 邻钮： | form label 相邻「查询」按钮 | 相邻按钮命中而非同文案远处按钮 |
| 批2 | 菜单： | 组件内菜单点击（一级+submenu） | submenu 自动展开后目标项被点 |
| 批4 | date | 日期字段单选+daterange | $emit('input',[s,e]) 双值落 model（注意：推送侧未接升格，L1 手工构造 date 报文） |
| 批4 | 弹窗选择 | 客户选择弹窗表格行 | objectValue=行文本→正确行选中回显 |
| 批4 | tssc_multi_select | 要素库「要素名称」（远程表格）+「要素类型」（字典） | **表格形态：过滤静置后再点**（禁误点残留首行）；字典形态走原链 |
| 批5 | select:tree alias | V3 报文 type=`select:tree` 直投 | alias 归一后 select_tree_option 执行成功（同时验证 ATP 平台侧是否拦截 type 值） |

### 9.3 执行纪律（沿用本仓既有约定）

1. **L1 每批收尾立即跑**，不攒到 L2——问题当场归因（引擎缺陷/报文构造错/环境问题三选一）；
2. 湿测发现的引擎 bug 就地修在 compat 分支（同批 commit），**同事主干上的问题只记录不改**（他可能还在推代码）；
3. L2 之前须用户确认推送通道就绪（ATP 侧建交易+调度下发可达）；若平台侧未就绪，L2 降级为「本地 payloadJson 全链模拟」并在报告中显式标注降级；
4. 湿测产物（payloadJson 样例/执行日志/截图/结果 json）落 `tmp/tansun-wet/`，报告 §9 收尾时补「湿测证据表」（操作→场景→payload 路径→结果→证据文件）；
5. 副作用类操作（删除/提交/审批推进）湿测用可弃数据（如湿测客户残留惯例），**审批流推进类操作须用户授权**（W5 教训）。

### 9.4 人机分工湿测模式（2026-09-11 与用户约定，周末执行）

> 用户拍板：**周末一起跑测试——用户负责导航，ZCode 负责 18 操作复刻验证**，Playwright MCP 有头浏览器作为操作台。本节为该模式的执行契约。

**分工：**
- **用户**：登录（凭据不经过 ZCode）、页面导航（导航到某场景页面后知会一声）、副作用授权（删除/提交/审批推进类操作先问后跑）；
- **ZCode**：页面形态确认（snapshot）→ 派发操作 → 按业务判据验证（回显/弹窗消失/页签激活态）→ 逐项记入 §9 证据表，产物落 `tmp/tansun-wet/`。

**操作协议：**
1. ZCode 起 Playwright MCP 有头浏览器；**若检测到浏览器被其他会话占用则另起独立实例，绝不动别人的浏览器**；
2. **严格串行**：一次验一个操作，验完用户再翻下一页；
3. ZCode 只派发事件 JS（evaluate），**不碰用户鼠标/焦点，不做导航点击**；
4. **两档保真度**（结论措辞须区分）：
   - **A 档=引擎已实现操作真打样**（radio/树三兄弟/select_option/click 兜底/tssc 字典形态/input）：把同事 handler 里的 JS **原样抽出**派发，验的是他的实现——高保真，周末引擎内复跑确认；
   - **B 档=未实装操作移植源验证**（七前缀子路径/date/弹窗行选/tssc 远程表格形态）：派发我们待移植的 JS 验证语义成立——消掉移植风险，不等于引擎验收；
5. 湿测当天若同事又有推送，先 fetch 再开测。

**当日流程：** ①装 chromium（`playwright install chromium`，当前本机缺）→ ②起 MCP 浏览器到登录页等用户 → ③按 §9.2 清单串行过（用户导航+ZCode 验证）→ ④收工补 §9 证据表（操作→场景→结果→证据文件）。
