# 报文转换链路参考：JS-gen 推送 → ATP 平台 → 同事引擎执行

> 2026-09-12 湿测期间固化。目的：把「JS-gen 录制步骤 → 推送报文 → 同事引擎（tansun_ui_engine）事务」的**全链字段转换**钉成一份带 file:line 的参考文档，供联调排查（某字段丢了/变形了，先查这张表再怀疑代码）。事实均经本会话逐处复核；tansun_ui_engine 侧行号基于分支 `compat/js-gen-operations`（4e5e2a9 前后，75bd130+），JS-gen 侧基于 `uara_V1.2`（2026-09-12）。

## 0. 全链鸟瞰

```
JS-gen 录制轨迹 (trajectory_step, action 词汇 ~30 种)
        │  ① 映射：ACTION_TO_ENGINE_TYPE（18 操作 → 六 type 词表）
        ▼
importDemand 建交易报文  ──────────────►  ATP 伙伴平台（落库为交易）
   {transcationEventTypeList: [...]}              │
                                                   │ ② 调度平台 Pull + 组装 payloadJson
                                                   ▼
                                    V3 结构化报文 {schemaVersion:"3.0", case.components[].steps[]}
                                                   │ ③ ExecutionPayload 校验 + payload_to_case
                                                   ▼
                                    _step_to_transaction：每步压平成 legacy 事务 JSON 串
                                                   │ ④ CaseModel.steps → 各 handler
                                                   ▼
                                    引擎执行（Playwright）→ 步骤结果/整案结果回传
```

**两套报文、两个通道，同事引擎只吃右侧两个：**
- **importDemand（建交易）**：JS-gen → ATP。`transcationProperties[]` 携带六 type 词表 + xpath + value。引擎**不直接吃**这个报文。
- **payloadJson（执行）**：ATP/调度平台 → 引擎 `scheduler/payload.py`。V2/V3 结构化（schemaVersion 2.0/3.0）或 V1 老格式（直接 ExecuteRequest+transactionList，id 必须>0）。

## 1. 第①步：JS-gen 录制动作 → 引擎操作（映射核心）

**映射总表** `src/services/legacy-engine-export.js:20`（`ACTION_TO_ENGINE_TYPE`，冻结）：

| 录制 action | 引擎 type | dataName（`buildOperationName` :164） | value（`pickOperationValue` :223） |
|---|---|---|---|
| fill_form_field | input | `填写:{label}` | p.value ?? option_text ?? text |
| select_option | select:click | `选择:{label}` | option_text ?? value ?? option |
| tssc_multi_select | select:click | `选择:{label}` | 同上 |
| select_tree_option | select:tree | `选择:{label}` | 同上 |
| click_table_row_radio | radio | `表格单选:{row_text}` | **default 空串**（行定位靠 xpath） |
| click_radio | radio | `单选:{label}` | option_text ?? value ?? option |
| click_element_by_index | click | `点击:{text}` | 空串 |
| click_menu_item | click | `菜单:{text}` | 空串 |
| click_table_row_button | click | `表格:{row}/{text}` | 空串 |
| click_adjacent_button | click | `邻钮:{label}` | 空串 |
| click_button | click | `图标:{text}` | 空串 |
| switch_tab | click | `页签:{text}` | 空串 |
| close_dialog | click | `关闭弹窗` | 空串 |
| expand_all_el_tree | click | `展开树` | 空串 |
| workspace_tabs(仅 activate) | click | `页签:{text}` | 空串 |
| tree_picker_click | click | `树选:{label}` | 空串 |
| picker_dialog_query | input | `弹窗查询:{dialog_name}` | fields[].value 逗号拼接 |
| picker_dialog_select | select:click | `弹窗选择:{dialog_name}` | row_text |
| fill_form_field(日期形态) | **date** | `填写:{label}` | 日期值（`resolveEngineType` :246 按 el-date-editor/tsscdatepicker 等特征升格） |

- **跳过不导出**：`SKIP_ACTIONS`（legacy-engine-export.js:48）——scroll/meta/扫描类。
- **dataName 前缀 = type 内子操作路由键**（引擎 `data_name.py` `parse_data_name` 15 前缀最长优先匹配），不是装饰。
- **elementType=primaryLocator.value**；`pickExportTarget` 优先 xpath_smart → label/semantic → xpath_full（fallback 记 `absolute_xpath_fallback` warning）。

**importDemand 报文形态**（`transaction-export.js:105` `mapStepToTransactionEvent`）：
```json
{
  "options": "[\"银行转账\"]",            // resolveOptions :48——仅 select 族/radio 录制带选项时非空（JSON 数组串）
  "elementType": "//label[text()='结算方式']/..//input",
  "eventTypeName": "下拉选择",            // EVENT_TYPE_NAME :28 中文标签
  "eventTypeValue": "select:click",       // 六 type 词表
  "transcationType": "playwright",
  "objectValue": "银行转账",              // = pickOperationValue（与 legacy op 同源）
  "propertiesName": "结算方式",           // buildBusinessObjectName :73 裸名词；同交易内 uniquifyPropertiesNames 去重加后缀
  "mothed": "By.XPATH"
}
```
⚠️ **联调关键悬案（报告 §7.1 修正①）**：ATP 组装 payloadJson 时步骤 `name` 取自 propertiesName（裸名词）还是映射表带前缀样式，**未实证**。若平台剥前缀，引擎前缀路由退化为 xpath 主路径 + labelHint 兜底（仍可跑，丢子路径语义）。联调第一步=抓一单真实 payloadJson 看步骤 name 实样。

## 2. 第③步：引擎侧 V3 报文 → 内部事务（tansun_ui_engine）

**入口**：`scheduler/payload.py` 收 payloadJson → `ui_execute/models/payload.py`：

1. **解析**：`ExecutionPayload`（pydantic，alias 收 V3 驼峰字段）→ `payload_to_case`（payload.py:424）。
   - componentId / stepId / sequence 唯一性硬校验（:457 sequence、:460 stepId，重复即整单拒）。
   - **eleType 非 ele**（page/tab/collapse/dialog/popup/step）：operation 强制置 None，仅作结构不执行（:146 `_ignore_container_operations`）。
   - component.menuXPath 非空 → 自动注入逐级 click 步骤（:385 `_menu_click_transactions`，dataName=`菜单切换-N`，isScroll=1）。
2. **白名单与别名**（payload.py:284/291）：`_EVENT_TYPES` = 六 type + select_tree_option 等引擎枚举；`_EVENT_ALIASES = {"select:tree": "select_tree_option"}`——映射表字面 type 进引擎前先归一。**不在白名单 → ValueError 整单拒（PAYLOAD_INVALID）**。
3. **primaryLocator 硬校验**（payload.py:333-334）：method+value 双非空，缺 → 整单拒。**elementType 为空的步骤（expand_all_el_tree/workspace_tabs 未采集形态）在 V3 通道必炸**——推送侧补采集（P3/P4）是硬前提。
4. **压平**：`_step_to_transaction`（payload.py:323）把 Step 拍成老版 transaction JSON 串：

| V3 报文字段 | transaction 字段 | handler 可见 | 备注 |
|---|---|---|---|
| step.name | dataName | step.data_name | **前缀路由键** |
| operation.type（过别名/白名单） | event | step.event | — |
| operation.value | val | 经 data_source.resolve（constant 原样；quantity 走变量池） | — |
| operation.objectValue | **双写** xpathObjectValue(:379) + objectValue(:385) | step.object_value | 值字段分流关键 |
| elementTarget.primaryLocator | element + mothed | step.element / step.mothed | CSS_SELECTOR→By.CSS；COORDINATE→element 空+location=坐标 |
| elementTarget.scrollIntoView | isScroll | step.is_scroll | =1 时 resolver 30s 无可见节点抛 EXCEPTION——推送侧建议 0 |
| operation.waitSeconds / timeoutSeconds | waitTime | 定位后 visible wait | handler 不自处理 |
| operation.menuPath | 仅 executeAgent 用（:348 `' > '.join`） | — | 六 type 不用 |
| dataSource/transmit/screenshot/hints | 全链透传 | 截图 executor 统一做 | — |

**单步 transaction 实产样例**：
```json
{"id":123,"dataName":"选择：结算方式","eleType":"ele","val":"","event":"select:click",
 "element":"//label[text()='结算方式']/..//input","mothed":"By.XPATH","location":"","waitTime":0,
 "dataSource":"constant","transmit":0,"screenshot":0,"xpathObjectValue":"银行转账","objectValue":"银行转账","isScroll":0}
```

## 3. 第④步：handler 消费约定（compat 分支实装后）

- handler 签名：`async def handler(page, step, locator, value, context) -> dict`；status ∈ ok/skip/error（error=整案终止）。
- **值读取约定**（批 1 统一）：`step.object_value or value or step.val`——objectValue 优先，四路接线（input_action/radio/select_tree/replay_adapter `_hint`）。
- **前缀路由**（批 1/2）：`parse_data_name(step.data_name) -> (route_key, label_hint)`；click 七前缀子路径（click_subroutes.py）前置路由，miss 落回同事兜底链；裸路由（关闭弹窗/展开树）miss=skip。
- **select:click**：字典形态（.el-select-dropdown__item）走原链；「弹窗选择」表格行选 + tssc 远程表格走 75bd130 新分支（16×250ms 静置轮询防残留首行误点）。
- **date**：单日期移植 fill_date.py（native setter + input/change/blur + 面板收起）；daterange 双 input、commitRangeVue 走 $emit('input',[s,e])。

## 4. 排障速查（字段丢了先查这里）

| 症状 | 根因 | 出入点 |
|---|---|---|
| 整单 PAYLOAD_INVALID | 六 type 白名单外 / stepId 重复 / sequence 重复 | payload.py:284 白名单、:457/:460 唯一性 |
| 步骤没到引擎就没了 | V3 primaryLocator 双非空校验拦下（elementType 空） | payload.py:333-334；推送侧 P3/P4 |
| handler 拿不到值 | objectValue 没写 / 写进 options 没写 objectValue | 双写点 payload.py:379+385；推送侧 pickOperationValue |
| 前缀路由 miss | 平台剥了 propertiesName 前缀（§1 联调实证项） | 引擎 data_name.py；退路=xpath 主路径+labelHint |
| select:tree 报不支持 | 平台拦了带冒号 type 值（待实证） | 引擎别名 payload.py:291 |
| 树路径变成串 | tree path 必须 JSON 数组进 objectValue | 推送侧构造；离线打样已验 `["集团","子公司","审批"]` 保真 |
| 无线弹窗步骤整单挂 | error=整案终止语义 | handler 约定：error 停案、skip 继续 |

## 5. 变更纪律

- **六 type 词表冻结**（用户 09-10 定盘）：不新增第七种 type；新操作一律在六 type 内用 dataName 前缀表达。
- 改本链路任一侧：JS-gen 侧改 `legacy-engine-export.js` / `transaction-export*.js` 须复跑 `characterize-export-v3.mjs`；引擎侧改 payload.py 须复跑离线打样（`AppData/Local/Temp/tansun-wet/offline-payload-check.py`，迁入仓库后以其仓库路径为准）+ 全量 pytest。
- 跨语言契约金样例（JS 侧 characterize-flow-card-recall.mjs / Python 侧 characterize-kb-recall.py）不受本链路影响，勿混淆。

## 相关
- 蓝图总报告：`docs/superpowers/reports/2026-09-10-tansun-engine-18-action-mapping-audit.md`（§7 蓝图 / §7.1 字段表 / §8 同事 1bf04f0 再评估 / §9 湿测门）
- 引擎 actions 契约：`docs/superpowers/specs/2026-09-05-engine-actions-contract.md`
- 湿测证据：`tmp/tansun-wet/`（本地，gitignore）
