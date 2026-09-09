# 树/列表「先查再点」设计

> 日期：2026-09-09  
> 状态：已批准；计划 [`docs/superpowers/plans/2026-09-09-search-then-click.md`](../plans/2026-09-09-search-then-click.md)  
> Lead：本会话 Cursor  
> 实证锚点：traj **#709** 人工步 `fill_form_field`「搜索关键字=担保方式」→ agent 再点树节点；#708 同套路

## 1. 目标

AI 录制在侧栏树 / 数据列表上定位目标时，统一为 **先查询，再点击**。页面上可见搜索/查询控件时，禁止盲点树节点或直接选列表行。

成功判据：新录轨迹在「有搜索」场景下出现搜索写入（及必要时点「查询」）之后才出现定位点击；护栏在未查询时返回 `err-search-first:…`。

## 2. 决策摘要

| 项 | 选择 |
|----|------|
| 落地层级 | **C**：提示词 + KB + analyze enrichment + **运行时软护栏** |
| 护栏触发 | **A**：页上**可见**搜索/查询/过滤控件时一律拦截直点；无搜索框允许直点 |
| 「已查询」 | **A**：有「查询」按钮则本阶段须已点过；无按钮则本阶段已成功填写搜索框即可 |
| 实现路径 | **1**：提示词 + 既有动作入口前置守卫（不新增复合动作） |
| 搜索步 source | Agent `fill` 即可，**不强制** `manual`（人工补步仅作实证参考） |

## 3. 范围

### In

- 运行时软护栏（见 §4）
- 提示词：`scripts/prompts/agent-core.md`、`agent-tools-table.md`、`agent-tools-common.md`、`phase-reviewer-prompt.md`
- analyze enrichment：`src/services/trajectory/trajectory-meta-service.js` → `analyzeRequirementToPhases` prompt
- KB 强制 rule：`data/kb/flows/product_library.json`、`product_element.json`（可顺带同类产品页，非必须）
- 任务模板一句：req-doc / 贯通样板「树或表定位须含搜索→点击」
- 表征 pin：护栏分支 + `err-search-first` 前缀 + 提示词/analyze 关键子串

### Out

- 新复合动作（如 `locate_tree_or_row`）
- 强制步骤 `source=manual`
- 改变回放引擎语义或新增 actionType
- 存量轨迹批量重录 / 自动改写历史 steps
- 与「列表是否默认自动加载」模块策略混谈（无搜索框则本护栏不触发）

## 4. 护栏语义

### 4.1 「有搜索」判定

页上可见任一即可：

- placeholder / label 含「搜索关键字」「输入关键字」「过滤」等（与既有 tree-filter 扫描口径对齐）
- 工具栏可见主「查询」按钮（列表常用）

### 4.2 「本阶段已查询」

按 **phase** 记账，换阶段清零：

1. 若可见「查询」按钮 → 本阶段须已成功点击「查询」（优先工具栏主「查询」，与现 `click_button` 一致）
2. 否则 → 本阶段已对搜索框成功 `fill_form_field`（或等价写入）即可

### 4.3 拦截入口

在「有搜索」且未「已查询」时拦截：

- 命中侧栏/页内 `el-tree` 节点的点击（含 `click_element_by_index`）
- `click_table_row_radio` / `click_table_row_button`（及等价「先选行」步）

**不拦：** 菜单导航、`expand_all_el_tree`、纯表单 fill/select、无搜索框时的直点、与定位无关的按钮。

### 4.4 失败与恢复

- 返回：`err-search-first:<why>`，文案指引：先填搜索关键字 →（有则）点查询 → 再点目标
- 不计「重复失败」猎场；Agent 按指引补步后重试
- 回放：不新增动作类型；录制仍为 fill →（可选 click 查询）→ click，回放照旧

## 5. 提示词 / analyze / KB

### 5.1 执行提示词

- `agent-core.md`：CRITICAL——树/列表定位 = 先查询再点击；遇 `err-search-first` 按指引补搜，禁止盲点重试
- `agent-tools-table.md`：`click_table_row_*` 前声明同一纪律
- `agent-tools-common.md`：有搜索时禁止「`expand_all` + 滚屏/盲点」代替查询
- `phase-reviewer-prompt.md`：`brief_plan` / `in_scope` 含定位树或列表时，必须写出「先搜索/查询 → 再点击」

### 5.2 analyze

`analyzeRequirementToPhases` prompt：阶段文案含「定位/选中树节点或列表行」时，**同一 phase 字符串内**补「先在搜索框填写关键字（有查询按钮则点查询）再点击」；**不增删** phase 条数（遵守既有编号条数硬约束）。

### 5.3 KB

- `product_library.json`：将「搜索关键字可筛树」升为**强制** rule
- `product_element.json`：左树定位组件 + 右侧要素列表选行，各写强制「先搜索/查询再选中」
- 不改召回金样例算法

### 5.4 任务模板

req-doc-to-kb / 贯通任务样板加一句：树或表定位须含「搜索→（查询）→点击」。

## 6. 验收与风险

### 验收

- 表征：可见搜索 + 未查询 → 拦截；已查询或无搜索 → 放行；`err-search-first` 前缀 pin
- 提示词 / analyze 关键子串 pin
- 可选湿测：产品要素库树——无搜索直点被拒；填关键字（+查询若有）后再点通过；步序对齐 #709

### 风险

- 误伤：搜索框常驻但与当前目标无关 → 依赖「本阶段已查询」一次放行；仍误伤再加白名单（本 spec 不预置）
- 多「查询」按钮 → 优先工具栏主「查询」
- 自动加载且无搜索的列表模块：护栏不触发（正确）

### 落地顺序

1. 护栏 + characterization  
2. 提示词  
3. analyze enrichment  
4. KB rules  
5. （可选）湿测  

## 7. 开放项（实现计划阶段再拆）

- 护栏状态挂在 `business_data_store` / phase state 的具体键名
- 树节点点击与 `click_element_by_index` 的「是否树节点」判定实现点
- 是否对 `scroll_to_text` 指向树节点一并拦截（建议：是，若随后会点；实现时钉死）
