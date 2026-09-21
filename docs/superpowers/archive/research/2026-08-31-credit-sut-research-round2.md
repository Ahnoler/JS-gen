# 被测系统二轮实地调研 + Python Agent 动作层真机验证（round 2）

- 日期：2026-08-31（同日二轮）
- 前置：[一轮调研](2026-08-31-credit-sut-framework-research.md)、[编排设计 v1](../specs/2026-08-31-credit-agent-workflow-orchestration.md)（A-G 已全部落地并单片段湿测通过）
- 本轮目的：① 补齐一轮未覆盖的页面形态与流程深水区；② **不经 LLM 直接驱动真实 controller**，验证 A-G 动作层端到端；③ 为编排 v2 供给实证
- 驱动方式：ZCode 内置浏览器（页面结构探查）+ `tmp/wet_run_agent.py`（browser_use chromium + `build_controller` 直调注册动作）

## 一、真机动作层验证结果（controller 直调，无 LLM）

| 动作 | 结果 | 证据 |
|---|---|---|
| `login('701994','1')` | ⚠️ 能过但路径意外 | `user:ok-placeholder pass:ok-placeholder btn:ok`——label 匹配失败后靠 **placeholder 兜底** 填充成功；但**没有法人显式步骤**，且观察到首次点登录停在 `#/login`、第二次点击才到 `#/home` 的非确定性 |
| `select_option('法人', …)` | ❌ `xpath-not-found` | 登录页选择器无 `el-form-item__label`，按 label 定位失效（与查询区无 form 同构的缺口，但发生在 select 上） |
| `read_business_date` | ✅ | `businessDate=2026-8-19, tenantId=9881`（databaseDate 为字符串 "undefined"，SUT 写入瑕疵） |
| `workspace_tabs list` | ✅ | 首页空 → 打开授信页后正确返回 `首页 + 新增对公授信管理(active)` |
| `click_menu_item('客户管理')` | ✅ | `ok \| loc:menu:客户管理` |
| `scan_visible_fields` | ✅ | 返回含选项清单的字段结构（登录页残留态也能扫出「请选择法人」全 7 个法人选项） |
| `click_button('选择客户')` | ✅ | `ok-text:选择客户` |
| `picker_dialog_query` | ✅ | 「选择对公授信客户」20 行 + 前 5 行文本 |
| `picker_dialog_select` | ✅ | `changed:{客户编号, 客户名称}` 正确回填 |

结论：A-G 动作层在真实 controller 链路上全绿；W0 是唯一实证缺口（见 §三.1）。

## 二、二轮页面形态新发现

### 2.1 第五种页面形态：上下文编辑页（修改 ≠ 抽屉）

列表页点「修改」**不开抽屉，而是新开工作区页签**跳全量上下文页：

```
/#/cstMgt/csinfMntSubDmn/cpctMgt/crtCpctInf/hostCstmgrCrtCpctInf/FS00005518…
  ?crdtNo=…&cstNo=…&cstSt=2&operoratFlag=edit&viewType=edit&avyEcd=UML00005557&fcnScnEcd=FS00005518…
```

对公客户编辑页实测（26 字段普查）：

- 字段构成：15 input / 6 select / 4 date / 1 textarea；**无 tabs/collapse/steps 分组**
- **过半字段 disabled**（客户编号/名称/证件/法人代表/管户机构等场景锁定）——扫描输出必须带 disabled 标记，Agent 不得尝试填写
- 可编辑主战场：登记注册地址、联系方式、经营范围、3 个日期、国别/投资主体类型
- 动作按钮：**选择 / 引入 / 联网核查 / 保存 / 客户转正 / 返回**（编辑页内也有选择器触发点）

### 2.2 日期字段填充机制（实测可提交）

`成立日期` 上 native setter + `input`+`change` 事件 + `blur` 后，值 `2018-06-15→2018-06-20` **提交成功**（重新 focus/blur 不回显旧值 = Vue model 已接受）。无需打开日期面板——fill 路径与文本输入同构。

**营业日期规则例外**：`登记日期` 默认填的是**真实当前时间**（`2026-08-31 11:08:19`），不是营业日期。「日期默认=营业日期」规则须限定为**业务日期字段**（成立/注册/失效日期等），系统戳字段（登记日期/创建时间）除外。

### 2.3 待办任务页：卡片列表而非表格（W5 入口形态）

`#/portal/wfPendTask` 实测：

- 顶部页签：待办(98) / 已办未结 / 已办已结；业务分类 chips（额度管理(4)、放款管理(13)、评级管理(19)…）
- 任务以**卡片**呈现（`todo-item` 结构）：【流程名】+ 节点角色 + `div.todo-item-action` 文本动作（**处理 / 转交 / 流程跟踪**——是 div 不是 button/el-table）+ 业务主键 + 上一节点处理人 + 发起人 + 审批中状态
- Agent 要点：`click_button` 类文本按钮定位对 `div.todo-item-action` 失效风险高，需按 class + 文本配对

### 2.4 W5 向导审批页深探（权限申请·客户经理发起节点）

待办卡片点「处理」→ `#/cstMgt/workflow/detail?bsnPk=…&tskId=…&nodeCode=…`（**无 iframe**，同文档路由）：

- `el-steps` 两步：**基本信息 → 提交流程**；按钮 保存/下一步/返回
- 第 1 步：6 字段全预填（含 textarea 申请原因描述）
- 第 2 步（提交流程）实测结构：
  - **流程操作** = `el-select`，**选项集随节点角色变化**（发起节点实测只有「下一步」；审批节点才会有同意/退回类）
  - **意见详情** = textarea（0/500 计数）
  - 按钮组：上一步 / 返回 / **流程提交** / **流程撤销** / 流程轨迹——**流程提交与流程撤销均为不可逆动作**
  - 下方**审批历史表**（节点名称/处理时间/处理人/处理状态/审批耗时/审批意见）——完成校验的事实源
- URL 参数含完整流程上下文（pcsSt=approving、tskNodeId、pcsTodoBtnMnpltTp=approve 等），不可手工构造，必须走 UI 链

### 2.5 选择器弹窗泛化验证（第二实例）

用信管理「引入」→ **「客户放大镜」** 弹窗：查询区（客户编号/客户名称 input + 3 个 select）+ 单选表格 + 取消/确认——与「选择对公授信客户」**完全同构**。`picker_dialog_query/select` 逐字复用：query 20 行、select 回填 **3 字段**（客户编号/客户名称/证件号码）。三段式 snippet 泛化成立，可编排为通用 W4。

## 三、编排级缺口清单（实证）

1. **W0 登录引擎无法人步骤**：`login()` 无法人 el-select 处理（虽然实测测试环境法人非阻塞、placeholder 兜底能过）；登录页 select 按 label 定位失效；首次点击→二次成功的非确定性需要「登录后探针 + 重试一次」语义。
2. **上下文编辑页无编排条目**：v1 只定义了抽屉（W3）；修改=新页签+上下文页形态需要独立工作流（disabled 字段纪律、日期 blur 提交、保存/返回守卫）。
3. **W5 入口无法解析卡片**：待办卡片是 div 结构，现有 scan/click_button 不覆盖 `todo-item-action`。
4. **W5 末步守卫缺专款**：流程提交/流程撤销是不可逆动作，须复用 click_save 级别的「LLM 声明意图→引擎二次确认」守卫；流程操作 select 选项随节点变化，LLM 需先读选项再选。
5. **营业日期规则需加例外**：系统戳字段（登记日期）用真实时间。

## 四、对 v1 编排设计的修订（供 v2 采纳）

- 页面形态 4 种 → **6 种**：列表页 / 编辑抽屉 / **上下文编辑页** / 选择器弹窗 / **待办卡片页** / 向导审批页
- W2 查询区、W3 抽屉结论不变；新增 W3'（上下文编辑页）与 W5 前置 W4.5（待办卡片解析）
- W4 选择器 snippet 已泛化验证，从「值得做」升级为「已就绪，编排直接引用」
- A-G 之外的新改造点编号 **H1-H5**（见编排 v2 文件集分配表）
