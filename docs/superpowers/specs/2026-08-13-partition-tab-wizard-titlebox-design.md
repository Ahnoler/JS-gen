# Design: Partition compose — tab / wizard / titlebox (PR-PART 第一刀)

**Date:** 2026-08-13  
**Status:** Approved (brainstorming) — implementation plan not written yet  
**Trigger:** PR-LAYER 分层树依赖分区质量。V2.1 `assignRegion` 只认 collapse / overlay / 待办卡 / 壳，对公客户修改把 143 个控件糊在「对公客户概况」；评级向导第二步整页掉进「主区」。  
**Related:** [product brief](2026-08-12-product-requirements-miaoyi-brief.md) PR-PART / PR-LAYER; [unify partition](2026-08-12-unify-partition-locator-architecture-design.md); [titlebox collision refine](2026-08-10-resolve-collision-finer-l1-titlebox-design.md); [todo-list](../todo-list.md)  
**E2E (9242, 2026-08-13):** 对公客户管理 → 正式客户 MBP → 修改；对公客户评级 → 待发起「测试科技发展有限公司」→ 修改 → 下一步影像资料。

## Problem

`assignRegion` 返回扁平 `{ region_role, region_id, region_label }`，命中一层即 return。

9242 对照：

| 页 | 实际容器 | 现分区 |
|----|----------|--------|
| 对公客户修改 | 6× `el-tabs`；collapse「对公客户概况」内多个 `.titlebox`（基本信息 / 法定代表人 / 实际控制人…） | tab 不进 L1；概况 **143** 控件共用 `section:对公客户概况` |
| 客户综合信息 | 同一 collapse 下「资产信息 / 客户联系信息」各一套新增修改 | 共用 collapse 名 |
| 对公客户评级修改 | 4× `el-steps`（基本信息 → 影像资料 → 风险阻断 → 签署信息）；第一步 collapse 较细 | 向导不进 L1；第一步靠 collapse 尚可 |
| 评级「下一步」影像资料 | 左树 + 右空态，无 collapse | L2 几乎全在 `main` |
| 同页多表 | ~8 张可见表 | 全部 `region_id: table`（本刀不改） |
| collapse 标题 | header 含「保存」按钮文案 | `经营情况 保存` |
| 首页待办 | 自定义 `.tab-item` / `.msg-card-item` | 本刀不做 |

产品分层树要 `页面 → tab/向导/弹窗 → 功能分区 → 控件`。本刀仍是 **分区键**，不排树。

## Goals

1. 每个 L2 控件有可拆开的分区键：chrome（tab 或向导当前步）+ collapse + titlebox（缺段跳过）。  
2. `region_label` 中文路径，SPA `display_group` 原样展示。  
3. 结构化三段留给 PR-LAYER，不必再拆字符串。  
4. 算法 B：分区失败不删 L2、不丢步骤。  
5. 与现有 `PAGE_LOCATOR_HELPERS` 单核一致（扫描 / resolve / 录制 snap）。

## Non-goals

- PR-LAYER 产品树 UI / 嵌套 JSON 树。  
- 表格独立 `region_id`（全局 `table` 短路保留）。  
- 首页自定义 `.tab-item` / `.msg-card-item`。  
- L1c LLM。  
- 改回放主定位（仍录好的 `xpath_smart`）。  
- 旧 `trajectory_step.element_json` 回填。  
- Vue 改分组算法。  
- 本刀改 xpath 配方（titlebox 锚仍只在现有 collision-refine / regionAnchor 路径）。

## Locked decisions

| # | Decision |
|---|----------|
| 1 | 两刀：本刀分区；分层树第二刀。 |
| 2 | 本刀范围 = **tab + 向导 + titlebox**；表格身份后置。 |
| 3 | 编码 = **拼接层级身份**（方案 C），不是扁平抢一层，也不是仅撞车才挂 titlebox。 |
| 4 | 弹层 / 表格 / 待办卡 / 顶栏 / 侧栏 **仍先短路**。 |
| 5 | Titlebox **默认挂上**（`pickNearestTitlebox`），不限于 resolve 同名碰撞。 |
| 6 | 撞车 refine：只在 **完整路径仍重复** 时加主键/`#n`；禁止把路径打回单独 titlebox。 |
| 7 | Collapse 标题剥尾部动作字（保存/新增/修改/查看/删除）。 |
| 8 | 旧轨迹不回填。 |

## Architecture

```text
el
  → overlay / table / todo-item / shell-*   (unchanged short-circuit)
  → compose:
       chrome  = active el-tabs item  OR  current el-steps step
       section = el-collapse-item header (hygiene)
       block   = nearest titlebox in same collapse (else same chrome pane)
  → region_id / region_label / region_role
  → region_chrome / region_section / region_block
  → display_group = region_label
```

Chrome 与 collapse/titlebox **叠加**，不是互斥。无 tab 无向导则从 collapse 起；无 collapse 也可只挂向导步（影像资料）。

## `region_*` 形状

| 字段 | 规则 | 例 |
|------|------|----|
| `region_chrome` | `{ role: 'tab'\|'wizard', label }` 或省略 | `{ role: 'tab', label: '客户基本信息' }` |
| `region_section` | collapse 标题（已剥动作字）或省略 | `对公客户概况` |
| `region_block` | titlebox `span.title` 或省略 | `法定代表人/负责人信息` |
| `region_label` | 非空段用 ` / ` 连接 | `客户基本信息 / 对公客户概况 / 法定代表人/负责人信息` |
| `region_id` | `tab:` / `wizard:` / `section:` / `titlebox:` 用 `\|` 连接 | `tab:客户基本信息\|section:对公客户概况\|titlebox:法定代表人/负责人信息` |
| `region_role` | 最细一层：`overlay` / `table` / `section`（有 collapse 或 titlebox）/ `wizard`（仅向导）/ `tab`（仅 tab）/ 壳与 `main`/`other` 不变 | `section` |

`display_group` = `region_label`。SPA 原样展示，不解析 `region_id`。

### Chrome 读取

- **Tab：** 控件向上最近的 `.el-tabs`，且不在 `.tags-view-container` / `header` 壳里（避免把顶栏「对公客户管理」页签当内容 tab）。取该实例 `.el-tabs__item.is-active` 文案，trim ≤40。  
- **向导：** 否则控件向上最近的 `.el-steps`（同样排除壳）。当前步：优先带进行中 class（`is-process` 等）；否则已完成步之后的第一步；再否则该条 steps 里可见步标题。不要只认一种皮肤 class——评级页湿测为准。  
- 二者都没有 → 无 chrome 段。

### Collapse

最近 `.el-collapse-item`。标题来自 `.el-collapse-item__header`，去掉与 `isActionOnlyTitle` 相同的尾部动作字，避免 `经营情况 保存`。

### Titlebox

同一 collapse 内（无 collapse 则同一 chrome 面板 / tab pane）调用已有 `pickNearestTitlebox`。拒绝空标题、纯动作字、标题等于控件文案。字段不在 `.titlebox` 包裹内时，仍取几何上最近的上方 titlebox（与现 refine 一致）。

### 短路（不变）

1. overlay（dialog/drawer/message-box）  
2. table（`.el-table` / tssc / myTable）→ 仍 `table`  
3. `.todo-item` 卡片  
4. shell-aside / shell-header  
5. 然后才 compose  
6. 都没有 → `main` / `other`

## 碰撞 refine

现 resolve：同 `(needle, region_id)` 且 size≥2 时，用 titlebox **替换** 整段 region。本刀之后：

- 初值已是完整路径，titlebox 已在默认 assign 中。  
- 仅当完整 `region_id` 仍碰撞 → `display_group` 加主键或 `#n`（现 `display-group.js` uniquify）。  
- 不得再把 `region_label` 收成只有 titlebox。

## 失败兜底

- 某一段 DOM 读不到：跳过该段，不抛、不删 L2。  
- 三段全空：保持今日 `main`/`other`。  
- 不让扫描/录制失败。

## 验收

Characterization（CI fixture，不连 9242）：

- tab + collapse + titlebox → label 含三段、`region_id` 含 `tab:` `section:` `titlebox:`。  
- header「经营情况 保存」→ section 为「经营情况」。  
- 仅 `.el-steps` 当前步、无 collapse → `region_role=wizard`，label 为步名，不是 `main`。  
- 无 chrome → 不崩，从 collapse/titlebox 起。  
- 更新 `characterize-resolve-collision-titlebox.mjs`：refine 不再把路径打回单 titlebox。

湿测手册（9242，不进 CI）：

1. 对公客户修改 / 客户基本信息：概况控件 label 含 `客户基本信息 / 对公客户概况 / <titlebox>`。  
2. 客户综合信息：资产 vs 联系 的「新增」titlebox 不同。  
3. 评级待发起修改第一步：`基本信息 / 评级基本情况`（有 block 再加第三段）；collapse 无尾「保存」。  
4. 下一步影像资料：分区为 `影像资料`，不得残留「基本信息」、不得整页 `main`。  
5. 顶栏仍「顶栏」；开着的弹层仍 overlay。

## 文件

| 路径 | 变更 |
|------|------|
| `src/cdp/page-locator-helpers.js` | compose `assignRegion`；collapse 卫生；三段字段 |
| `node scripts/_gen_locator_helpers_py.mjs` | 生成 `_locator_helpers_js.py`（禁止手改） |
| `src/cdp/display-group.js` | `display_group` = 新 `region_label`；完整路径撞车才 uniquify |
| `src/cdp/resolve-by-label.js` | refine 契约对齐完整路径 |
| characterization 若干 | 上节 fixture + collision 契约 |
| `CHANGELOG.md` | `[Unreleased]`；Python 同步提示：无 schema；`display_group` 可能含 ` / ` |

## 风险

- `region_id` 变长：旧碰撞组键变化；只影响新扫描。  
- 向导当前步 class 因皮肤而异：禁止只匹配一种 `is-process`；实现按「最近 `.el-steps` + 可见步标题启发式」，湿测钉评级四步。读不到步名才允许无 chrome 段（影像资料若因此掉 `main` 视为验收失败）。  
- 同一 collapse 多个 titlebox 几何误绑：沿用 `pickNearestTitlebox`，湿测法定代表人 vs 实际控制人。
