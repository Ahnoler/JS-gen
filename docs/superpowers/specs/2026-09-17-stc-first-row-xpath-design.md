# STC 后选首行/首叶 + 结构相对 xpath 落库

> 日期：2026-09-17  
> 状态：设计定稿（待实现计划）  
> Lead：本会话 Cursor  
> 相关：[`2026-09-09-search-then-click-design.md`](2026-09-09-search-then-click-design.md)

## 1. 目标

伙伴平台对原子交易做**查询条件数据替换**后，同一套步骤仍可回放。选行/选树不得把具体业务键（客户编号、名称等）写死进落库主契约。

成功判据：

1. 本阶段 STC 已满足时，选中的是**当前作用域内表第一可见数据行**或**树第一个叶节点**。
2. 落库同时具备：`params.row_text = "first"`（或表/树侧等价 first 别名）+ **结构/位次**相对 `xpath_smart`（不含业务文案）。
3. 旧轨迹（业务键 `row_text` / 文案锚 xpath）行为不变。

## 2. 决策摘要

| 项 | 选择 |
|----|------|
| 策略范围 | **A**：本阶段走过 STC（有搜索 UI 且已满足「已查询」）后，选行/选叶一律首条 |
| 执行与落库 | **硬约束**：执行强制首行/首叶；落库 `row_text` 归一 `"first"`，**禁止**「按业务键点、却录成 first」 |
| xpath 生成 | **模板 A**：合成结构 xpath，不用 live 文案 xpath 再消毒 |
| 容器（首版） | 沿用现有顶层可见 dialog/drawer（与今日 `click_table_row_radio` / G1 一致）；**不**做「查询按钮锚容器」硬绑定 |
| 加载 | best-effort 复用现有 loading 等待；不新造 XHR 闸 |

## 3. 动作契约：`click_table_row_radio`

动作名与 actionType 不变。

| 场景 | 执行 | 落库 |
|------|------|------|
| 有搜索/查询 UI，且 STC **已满足** | 强制首行（现有 `wantFirst`），忽略调用方业务键 | `row_text="first"` + 结构 `xpath_smart`（§5） |
| 有搜索/查询 UI，STC **未满足** | `err-search-first`，不落库 | — |
| 无搜索/查询 UI | 保持现状（精确键 → 去空白包含） | 原样（可含业务键 + 现有文案 xpath） |
| 调用方已传 first 别名 | 与今日一致 | `"first"` + 结构 xpath（若走了首行路径） |

STC「已满足」= 页上确有搜索 UI，且 `should_block_locate(...) == false`（与护栏同源：有「查询」钮则须 `query_clicked`；仅有搜索框则 `search_filled` 即可）。

## 4. 树

同策略：STC 后点**第一个叶节点**；参数侧可用 `first`；`xpath_smart` 用 §5.2 模板。

首版实现可先表后树，但契约以本文为准；树入口分散时分批接线，不得改变表侧已定语义。

## 5. 结构 / 位次相对 xpath

### 5.1 表：首行 radio

语义：作用域内主表 `body-wrapper` 第 1 条数据行上的 radio/checkbox；避开 fixed 列克隆（`preferVisibleXpath`）。

形状（示意；`{scope}` 由 `scopedXPath` / `detectContainerKind` 加 dialog/drawer 前缀，无弹层则为 `//`）：

```text
{scope}//div[contains(@class,'el-table__body-wrapper')]
  //tr[contains(@class,'el-table__row')][1]
  //*[contains(@class,'el-radio') or contains(@class,'el-radio-button')
      or contains(@class,'el-checkbox')]
```

硬禁止：`tr[.//*[normalize-space()='业务文案']]`、客户编号/名称字面量。

生成：新增 builder（名示例）`buildTableRowRadioFirstXPathSmart`；**不**改写默认 `buildTableRowRadioXPathSmart(rowText=业务键)`（旧轨迹仍依赖）。

### 5.2 树：第一个叶节点

```text
{scope}//div[contains(@class,'el-tree')]
  //div[contains(@class,'el-tree-node')]
    [.//span[contains(@class,'el-tree-node__expand-icon')
             and contains(@class,'is-leaf')]][1]
  /div[contains(@class,'el-tree-node__content')]
```

无 `is-leaf` 时降级为第一个可见 `.el-tree-node__content`，并在实现注释登记。

硬禁止：现有 `starts-with(normalize-space(),'节点名')` 文案锚作为本模式落库主 xpath。

生成：新增 `buildTreeFirstLeafXPathSmart`（或等价）；默认 `buildTreeNodeXPathSmart` 不动。

## 6. 回放顺序

1. 有可用结构 `xpath_smart` → xpath / durable 点击  
2. 否则 `row_text` ∈ first 别名（`first` / `1st` / `第一个` / `第一项` / `首行`）→ `wantFirst`  
3. 否则旧逻辑（业务键 / 文案匹配）

存量：具体业务键轨迹**不**改写为 first。

回放 STC flags：继续 `mark_stc_flags_on_replay_ok`；首版回放**不**把旧键强制改写成 first。

## 7. 实现落点（首版）

| 位置 | 改动 |
|------|------|
| `search_then_click_guard.py` | 只读 helper：`stc_satisfied(store, snapshot)`（有搜索 UI 且不 block） |
| `_table.py` `click_table_row_radio` | STC 后强制 wantFirst；落库 `row_text=first`；写入结构 xpath；成功前 best-effort loading 等待 |
| `locator-builders` + 生成链（若 JS 侧同源） | 新增 first-row / first-leaf builder；表征 pin |
| 提示词薄改 | `agent-tools-table.md` / `agent-core.md`：STC 后传 `first`，与引擎对齐 |
| **不改** | `JS_GET_CONTAINER` 语义、G1 按钮逻辑、默认文案 xpath builder、伙伴替换协议本身、批量改历史轨迹 |

### 7.1 TODO（注释 + 本文遗留，不首版实现）

调研结论：现有 `JS_GET_CONTAINER` / 选行 overlay / G1 均为「当前顶层弹层」，**不能**硬保证「与刚点的查询按钮同容器」。

若湿测出现「主页查询点到弹窗表 / 同页多表点错」：

1. `click_button('查询')` 成功时锚定按钮 `closest(.el-dialog|.el-drawer|查询工具栏卡片)` 记入 phase store；  
2. 选行/选叶强制在该根下找首行/首叶与合成 xpath。  

实现时在 `click_button`（查询成功分支）与 `click_table_row_radio`（STC 首行分支）加**代码 TODO 注释**指向本小节。

## 8. 错误

- 空表 / 无可选 radio：显式失败（对齐 `err-no-row-match`），不假 ok。  
- 树无叶：显式错误，不盲点非叶。

## 9. Characterization

- 扩 `characterize-search-then-click-guard`（或紧邻 cold pin）：  
  - STC 满足 + 传入业务键 → 落库 `row_text=first`；xpath 为结构模板（断言不含业务键子串 / 含 `el-table__body-wrapper`+`tr`…`[1]` 等针）。  
  - STC 未满足 → 仍 `err-search-first`。  
  - 无搜索 UI → 不强制 first。  
- builder 单测：first-row / first-leaf 模板形状 + dialog scope 前缀。  
- 证伪：去掉归一 → 红。

## 10. Out of scope

- 伙伴平台数据替换协议细节（只保证原子步契约）。  
- 查询锚容器硬绑定（§7.1 TODO）。  
- 强制改写历史轨迹。  
- 新复合动作 / 新 actionType。

## 11. 验收口径（实现后）

1. 弹窗内查询 → 选行：落库 `row_text=first` + 结构 xpath；换查询条件后回放仍点结果集第一行。  
2. 主列表无弹层、STC 后选行：同上。  
3. 旧业务键轨迹回放仍按键匹配。  
4. 未查询盲点仍 `err-search-first`。
