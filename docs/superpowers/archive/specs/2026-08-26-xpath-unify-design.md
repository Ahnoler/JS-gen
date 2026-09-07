# 三路径相对 XPath 统一（以自动抓取为基准）（Spec）

> 状态：待评审
> 日期：2026-08-26
> 关联：[[xpath-three-sources-comparison]]；目标：**同一个 DOM 节点，无论从哪个入口（AI 录制 / 人工录制 / 自动抓取）进来，最终得到的 `xpath_smart` / `xpath_full` / `candidates` 完全一致**

---

## 1. 背景与问题

### 1.1 三个入口共用同一个算法内核

三个入口（AI 录制 `src/cdp/inspect-payload-script.js`、人工录制 `scripts/manual_recorder/js_parts/b.py`、自动抓取 `src/cdp/resolve-by-label.js`）最终都调用**同一份** `buildLocatorSnap`（`src/cdp/page-locator-helpers.js:1520`，由 `_locator_helpers_js.py` 镜像到 Python 侧）。算法内核**一行未分叉**。

### 1.2 真正的差异：调用方的喂参与透传

差异不在算法，而在三个入口作为调用方：
- **参数个数**：AI/人工用 4 参（无 opts），自动抓取用 5 参（`{targetKind, region}`）
- **targetKind**：AI/人工缺失 → 内部 `detectTargetKind` 靠 DOM 猜；自动抓取显式传（action-aware）
- **region**：自动抓取多匹配时传 `refineCollidingRegions` 精修后的 region；AI/人工缺失 → 内部 `assignRegion` 原始结果
- **formLabel 来源**：AI=`formItemLabel(node)`（含 placeholder 回退）；人工=内联 IIFE（仅真实 label，无回退）；自动抓取=`matchedLabel`（匹配到的 label）
- **字段透传**：自动抓取全取（`region_*/layers/feature_card`）；AI 丢 region/layers；人工丢更多（连 `cssSelector`/`placeholder`/`icon_class`）
- **action 覆盖**：AI/自动抓取所有 action 走算法；人工的 `select_option`/`click_radio`/`switch_tab`/`close_dialog` 绕过算法，只有裸 `xpathOf` 绝对路径

**后果**：同一个 DOM 节点，从三个入口进来，产出的 `xpath_smart` 可能不同（因 formLabel/targetKind 来源不同），甚至缺失（人工 4 类弱 action），回放鲁棒性和一致性无法保证。

### 1.3 评估结论（2026-08-26 重新评估）

以"喂参与工程完备度"为维度打分（每项 5 分制）：

| 维度 | AI 录制 | 人工录制 | 自动抓取 |
|---|---|---|---|
| kind 喂参 | 2 | 2 | 5 |
| region 喂参 | 2 | 2 | 5 |
| formLabel 来源 | 4 | 2 | 4 |
| action 覆盖 | 5 | 1 | 5 |
| 字段透传 | 2 | 1 | 5 |
| 后处理兜底 | 1 | 1 | 5 |
| **合计** | **16** | **9** | **29** |

**结论：以自动抓取路径的喂参规范为统一基准**（用户已确认）。

---

## 2. 目标 / 非目标

**目标**

- 三个入口以相同的方式调用 `buildLocatorSnap`（5 参，`{targetKind, region}`）
- 同一个 DOM 节点，三个入口产出的 `xpath_smart` / `xpath_full` / `candidates` / `locator_strategy` / `target_kind` 完全一致
- 人工录制 4 类弱 action（select_option/click_radio/switch_tab/close_dialog）补齐 smart locator
- 字段透传清单三路径统一（全量透传，含 `region_*/layers/feature_card`）
- 新增「三入口一致性」characterization 测试作为回归护栏

**非目标**

- 不改 `buildLocatorSnap` 算法内核（`page-locator-helpers.js` 逻辑不变；若 formLabel 统一需要微调其调用语义，则同步评估 characterization 影响）
- Node 侧后处理链（`enrichLocatorFields`/`assembleRegionTree`/`displayGroup`）本次**不动**——自动抓取保留，AI/人工保持页内产出+Python 兜底（用户已确认）
- L1c 区域语义分类维持现状：仅自动抓取走 `applyL1cRegionClassify`（用户已确认）
- 不合并三份 `elMeta` 入口（执行环境本质不同：CDP 快照 / DOM listener / CDP resolve-element），只统一调用规范
- 不改 Python `mapper.py` 的 offline 重建优先级链（已对齐 placeholder→label→name；offline 不设 `verified=true` 已如此）

---

## 3. 设计

### 3.1 统一调用规范（三个入口一致）

```js
const host = normalizeTargetRoot(node) || node;              // 调用前统一归一
const abs = xpathOf(host);
const text = textOverride != null ? String(textOverride) : shortLabel(host);
const formLabel = formItemLabel(host);                       // 统一 DOM 取（含 placeholder 回退）
const loc = buildLocatorSnap(host, text, abs, formLabel, {
  targetKind,        // 必填：由 action 分支显式映射（见 3.2）
  region,            // 可选：多匹配精修场景传入；单匹配省略（内部 assignRegion）
});
```

要点：
- **5 参调用**，`opts` 必带 `targetKind`
- 调用前统一 `normalizeTargetRoot`（自动抓取已做，AI/人工补上；`buildLocatorSnap` 内部再归一，幂等无害）
- `targetKind` 由调用方根据 action 类型显式传入，不再依赖 `detectTargetKind` 猜测（对 `form_date`/`form_tree_select`/`adjacent_button` 等易误判类型尤其重要）

### 3.2 targetKind 映射表（以自动抓取 `resolve-by-label.js` 为唯一基准）

| action | targetKind |
|---|---|
| fill_form_field（input） | `form_input` |
| fill_date | `form_date` |
| select_option | `form_select` |
| click_radio | `form_radio` |
| fill_form_field（tree-select） | `form_tree_select` |
| click_adjacent_button | `adjacent_button` |
| click_menu_item / submenu | `menu` |
| switch_tab | `tab` |
| close_dialog | `dialog_close` |
| click_table_row_button / click_table_row_radio | `table_row_button` |
| click_icon_button | `icon` |
| generic click（button） | `button` |
| click（tree node） | `tree_node` |

实施前核对 `resolve-by-label.js` 各分支的 kind 枚举作为唯一基准源，AI 录制 `inspect-payload-script.js` 和人工录制 `b.py` 的每个 emit 分支对齐到这张表。

### 3.3 formLabel 来源统一（统一 DOM 取）

- 三路径统一：`formLabel = formItemLabel(host)`——从 DOM 取 `.el-form-item__label` 文本，剥尾部 `：:*空白`，无真实 label 时**回退 placeholderLabel**
- 自动抓取改造：`asFormField` 时**不再直接用 `matchedLabel` 作 formLabel**，改为 `formItemLabel(root)`；`matchedLabel` 仅用于"匹配"与返回展示
- 效果：同一节点三路径 formLabel 同源 → `formFieldXpathSmartOf` 产出必然一致
- 注意：此改动要求自动抓取 `snap()` 内 `formLabel` 的取值逻辑调整，需同步检查 `resolve-by-label.js` 中 `asFormField` 语义及 `characterize-*` 对 `matchedLabel` 的断言

### 3.4 字段透传清单统一（全量透传）

三入口统一透传 `buildLocatorSnap` 的全部返回字段：

```
xpath, xpath_smart, xpath_full, xpath_abs, cssSelector, candidates,
tag, attributes, text, formLabel, target_kind, parent_text, icon_class,
placeholder, locator_scope, locator_occurrence, locator_verified,
locator_strategy, locator_fallback_reason,
region_role, region_id, region_label, region_chrome, region_section,
region_block, layers, feature_card, page_bbox
```

- AI `elMeta`：补 `region_*/layers/feature_card/page_bbox` 透传
- 人工 `elMeta`：补 `cssSelector/icon_class/placeholder/region_*/layers/feature_card/page_bbox` 透传
- 保留各自入口的附加字段：AI 无；人工保留 `highlight_index`、todo-card `parent_text`；自动抓取保留 `matchedLabel`/`className`

### 3.5 人工录制弱 action 改造

`scripts/manual_recorder/js_parts/b.py` 以下 4 个 emit 分支从裸 `xpathOf` 改为走 `elMeta`（带 targetKind）：
- `select_option`（~b.py:154-163）→ `form_select`
- `click_radio`（~b.py:291-300）→ `form_radio`
- `switch_tab`（~b.py:306-313）→ `tab`
- `close_dialog`（~b.py:319-326）→ `dialog_close`

同时 b.py 的 `elMeta` 内联 IIFE 补 placeholder 回退（对齐 AI `formItemLabel`）。

### 3.6 Python 侧 `mapper.py` 对齐

- `_offline_xpath_smart_fallback` 优先级链（placeholder→label→name）已对齐 JS 侧 `formFieldXpathSmartOf`，**不改**
- offline 重建不设 `verified=true`，**不改**
- `_map_dom_event_to_action` 对弱 action 补齐 smart 后，Python 侧无需额外改动（trust snap 逻辑不变）

### 3.7 测试与验收

**新增「三入口一致性」characterization 测试**（回归护栏，验收标准）：
- 构造同一 DOM fixture（含 dialog/表单/多同名控件/树选择/radio/tab 等场景）
- 分别模拟三入口调用：AI `elMeta`（inspect-payload-script）、人工 `elMeta`（b.py）、自动抓取 `snap`（resolve-by-label）
- 断言同一节点三入口产出的 `xpath_smart` / `xpath_full` / `candidates` / `locator_strategy` / `target_kind` 完全一致
- 测试形式：Node `.mjs`（可复用 `characterize-live-xpath-e2e.mjs` 的浏览器驱动模式），或 Python（复用 `smoke-locator-policy.py` 模式）

**现有 characterization 保持 GREEN**：
- `characterize-capture-element-xpath.py`（`JS_CAPTURE_FROM_XPATH` 必须含 `formFieldXpathSmartOf`、`_capture_element` 禁调 `JS_SMART_LOCATOR`、`params['xpath_smart']` 禁赋值）
- `characterize-xpath-primary-ops.py` / `characterize-form-assistant.py` / `characterize-control-ops-closed-loop.py` 等（xpath_smart 形态断言）
- 若 3.3 改动影响 `matchedLabel` 相关断言，同步更新对应测试

---

## 4. 风险与兼容性

| 风险 | 缓解 |
|---|---|
| 自动抓取 formLabel 改 DOM 取，可能影响 `resolve-by-label.js` 现有行为 | 精确/模糊匹配的 `matchedLabel` 仍返回给前端；仅 formLabel 传参改 DOM 取；跑 `characterize-resolve-ambiguous-region.mjs` 等验证 |
| 人工录制 4 类弱 action 改造后，action 字段结构变化 | Python `mapper.py` 信任 snap 逻辑不变；`select_option` 等 action 的 controller 回放路径已有 label 兜底 |
| characterization 大量 pin 源码子串 | 不改 `buildLocatorSnap` 内核；新增改动集中在三入口调用层；改后全量跑 verify-all |
| 人工录制 `b.py` 是 Python 字符串内嵌 JS，改后需重新 attach | 按既有约定：改 `scripts/` 须重新 attach 验证 |

## 5. 验证方式

```bash
bash scripts/refactor/verify-all.sh        # refactor gate：CTRL parity + core smokes
node scripts/characterization/characterize-live-xpath-e2e.mjs   # 浏览器驱动类
python scripts/characterization/characterize-capture-element-xpath.py
python scripts/characterization/characterize-xpath-primary-ops.py
# 新增：
node scripts/characterization/characterize-xpath-three-sources.mjs  # 三入口一致性（验收）
```
