# Design: PR-LAYER — per-control `layers[]` (整页树后置)

**Date:** 2026-08-14  
**Status:** Approved (brainstorming) — implementation plan not written yet  
**Trigger:** PR-PART 已把 tab / 向导 / collapse / titlebox 拼进 `region_*`。产品树要 `页面 → tab/向导/弹窗 → 功能分区 → 控件`，但 Vue 是另仓；缺的是本仓稳定契约，不是新 DOM 启发式。  
**Related:** [PR-PART compose](2026-08-13-partition-tab-wizard-titlebox-design.md); [product brief](2026-08-12-product-requirements-miaoyi-brief.md) PR-LAYER; [todo-list](../todo-list.md)

## Problem

`region_label` / `display_group` 是用 ` / ` 拼的中文路径。SPA 按约定**原样展示、不拆 `region_id`**。结构化字段 `region_chrome` / `region_section` / `region_block` 已有，但：

1. overlay / table / todo / 壳走短路，没有统一的「外→内」数组。  
2. 没有给 Vue 的分层数组，选择器和阶段树都会各拆一套字符串。  
3. 整页合成树（多控件合并成一棵）尚未做；规则已锁，本刀不实现。

## Goals

1. 每个 L2 控件带 `layers[]`：`{ role, label }[]`，外→内，由现有 `region_*` 推导，**不再扫 DOM**。  
2. 写入 snap / resolve preview / `element_json`（`copyLocatorMeta`）。  
3. `display_group` 仍等于 `region_label`，现 SPA 不破。  
4. 录制/resolve 若已有功能名或菜单名，可在数组头加上 `{ role: 'page', label }`（不进 `assignRegion`）。  
5. 旧步骤没有 `layers`：消费者回退 `display_group`；**不回填**。

## Non-goals

- Vue 画树 / 选择器改分组。  
- **整页大树** `assembleRegionTree` / 扫描返回 `region_tree`（见文末 TODO）。  
- 改 overlay / table / todo / 壳短路（本刀不出现 `tab → overlay` 路径；组装器以后允许）。  
- 改 xpath、L1c、表格拆身份、回填历史。

## Locked decisions

| # | Decision |
|---|----------|
| 1 | 本仓先出契约；Vue 另刀。 |
| 2 | 每控件 `layers[]`，不在本刀拼整页树。 |
| 3 | `page` 不进 `assignRegion`。有 `pageLabel` 时 API/录制 `unshift`；若 `layers[0]` 已是 `page` 则不再加。 |
| 4 | `page` 只能在根上，且不能再套 `page`（内层 `page` 丢弃）。其余 role 可按路径互套——**整页树 TODO 必须遵守**；本刀 `layers[]` 同样：最多一个 `page` 且仅 index 0。 |
| 5 | overlay / table / todo / 壳短路不变。todo 的 `region_role` 改为 `todo`（`TAXONOMY_ROLES` 加上）；`region_label` 仍是中文标题。 |
| 6 | `display_group` 不变。旧步无 `layers` 回退路径字符串。不回填。 |

## `layers[]` 形状

```text
layers: [{ role, label }, ...]
role = page | overlay | tab | wizard | section | titlebox | table | todo
```

例：

- 对公客户修改字段：`[{ role:'tab', label:'客户基本信息' }, { role:'section', label:'对公客户概况' }, { role:'titlebox', label:'基本信息' }]`  
- 有功能名外套后：再在头上 `{ role:'page', label:'对公客户管理' }`  
- 影像资料按钮：`[{ role:'wizard', label:'影像资料' }]`  
- 弹层确定：`[{ role:'overlay', label:'提示' }]`  
- 顶栏 / 侧栏 / 无 compose 的主区：`[]`

## 映射（`buildRegionLayers(region)`）

从 `assignRegion` 结果填，不读 DOM。

| 来源 | layers |
|------|--------|
| `region_role === 'overlay'` | `[{ role:'overlay', label: region_label }]`（已是弹层标题或「弹层」） |
| `region_role === 'table'` | `[{ role:'table', label: region_label }]`（现为「表格」） |
| `region_role === 'todo'`（原 todo-item 短路，今日误标 `section`） | `[{ role:'todo', label: region_label }]` |
| compose：`region_chrome` + `region_section` + `region_block` | 有哪段填哪段；chrome 的 role 为 `tab` 或 `wizard` |
| `shell-header` / `shell-aside` / `main` / `other` 且无 chrome/section/block | `[]` |

`label` trim，长度与现 `region_label` 段一致（≤40）。空 label 的段跳过。

`prependPageLayer(layers, pageLabel)`：`pageLabel` 非空且 `layers[0].role !== 'page'` 时，头插 `{ role:'page', label: pageLabel }`；若数组中后方出现 `role === 'page'`，删掉那些项。

## 挂载

| 出口 | 行为 |
|------|------|
| `buildLocatorSnap` | 在已有 `region_*` 旁写 `layers` |
| `resolve-by-label` preview / 命中 element | 透传 `layers` |
| `copyLocatorMeta` / `element_json` | 拷贝 `layers` |
| `patchRegionFields` | 有 `layers` 则保留（与 tab/wizard/section 角色保留同一策略） |
| 扫描 / inventory 列表 | **本刀只给每项 `layers`**，不返回整页 `region_tree` |

## Architecture

```text
assignRegion(el)                    // 不改短路顺序；todo → region_role todo
  → buildRegionLayers(region)
  → optional prependPageLayer(pageLabel)
  → snap.layers / preview.layers / element_json.layers

display_group = region_label        // 不变
```

`buildRegionLayers` 放在 `PAGE_LOCATOR_HELPERS`（与 snap 同核），regen `_locator_helpers_js.py`。Node 侧 `copyLocatorMeta` 增加 `layers`。

## Testing

`characterize-partition-compose.mjs`（及碰撞 / L1c 若触及 todo role）：

- 对公 tab+collapse+titlebox → 三段 `layers` role `tab,section,titlebox`。  
- 向导 `.steps-wrapper` 页脚 → `[{ role:'wizard', label:'影像资料' }]`。  
- overlay / table → 单层。  
- todo-item → `[{ role:'todo', label }]`，`region_role === 'todo'`。  
- 壳 / 无 compose 主区 → `[]`。  
- `prependPageLayer`：头插 page；内层 page 被丢掉。  
- `display_group` 仍为中文路径。

不要求扫描接口返回 `region_tree`。

## TODO: 整页大树（本刀不做）

以后单独 design/plan。输入：带 `layers[]` 的控件列表 + 可选 `pageLabel`。输出：一棵（或森林）`region_tree`，叶为控件。

已锁定规则（实现时不得改）：

1. **`page` 下不能再挂 `page`**。二者不兼容。`page` 只出现在根；内层 `page` 丢弃。不同 `page` label 是不同根，不互相嵌套。  
2. **其余层级可互相嵌套挂载**：`overlay | tab | wizard | section | titlebox | table | todo` 按 `layers` 前缀合并；同一前缀同一节点。  
3. 组装器允许 `tab → overlay` 这类路径；**生产路径仍受 assignRegion 短路限制**，要出现该路径需另改 compose（不在本 TODO 必做范围，除非那时重开短路）。  
4. Vue 画树仍可以后做；本 TODO 只覆盖 JS-gen `assembleRegionTree` + 扫描/resolve 列表挂 `region_tree`。

建议入口：`assembleRegionTree(items, { pageLabel }) → tree`。表征用对公客户修改 / 评级向导 fixture 的多控件 `layers` 合并，并断言 page 不套 page。
