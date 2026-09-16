# Design: 产品树节点录制文本去脏后缀

**日期**：2026-09-16  
**状态**：已批准；计划 [`../plans/2026-09-16-tree-node-dirty-suffix.md`](../plans/2026-09-16-tree-node-dirty-suffix.md)  
**触发**：AI/人工录制产品树点击后，步骤文本与批量推送携带脏后缀（如 `年龄限制 -`、`金融新产品(7)`），伙伴平台无法使用；回放侧已部分容忍但推送仍脏。  
**相关**：`stripVolatileTreeText`（`src/cdp/locator-builders/text.js` + `page-locator-helpers.js`）；`buildLocatorSnap` tree_node；manual `js_parts/b.py` 树点击；AI capture / click 落库 `text`；推送 `buildBusinessObjectName` / transaction export。  
**用户裁决**：
1. 脏后缀判定标准 = **后缀取值是否依赖其他因素**（子节点数、装饰拼接），而非「看起来像后缀」。
2. `(N)` 为脏 → 剥除；装饰拼接 `- ` 为脏 → 剥除；`[V-…]` **不是脏** → **保留**。
3. 装饰 `- ` 在 DOM 上是内层语义 span 之外的拼接文本，优先按结构取名，不只靠正则。

---

## 1. 问题

### 1.1 真机结构（Playwright MCP + 用户提供 DOM · 2026-09-16）

#### A. 装饰拼接 `- `（脏）

```html
<span class="custom-tree-node">
  <span style="color: …"> 年龄限制</span>- 
</span>
```

- 语义名在**内层** colored `span`。
- `- `（或 ` -`）是 `custom-tree-node` 内、内层 span **之外** 的兄弟文本节点。
- `innerText` / `cleanVisibleText` 拼成 `年龄限制 -` → 录制脏串。

#### B. 子节点计数 `(N)`（脏）

```html
<span class="custom-tree-node">
  <span><i class="el-icon-folder"></i> 金融新产品(7)</span>
</span>
```

- `(7)` 与名称在**同一文本节点**（非独立后缀元素）。
- `N` 随下属节点数量变化 → 挥发性脏数据。
- 期望落库：`金融新产品`。

#### C. 版本标记 `[V-…]`（非脏，保留）

```html
<span class="custom-tree-node">
  <span style="color: …">测试111[V-0.0.1]</span>
</span>
```

- 版本是产品身份的一部分，一般不随子节点数等外部因素变。
- 期望落库 / 推送：**完整保留** `测试111[V-0.0.1]`。

### 1.2 现状缺口

| 层 | 行为 | 问题 |
|----|------|------|
| `stripVolatileTreeText` | 剥 `(digits)` **且** 剥 `[V-…]` | 误伤稳定版本；xpath 与推送语义绑死在「V 也脏」的旧假设 |
| xpath `tree_node` | 用 strip 后文本 `starts-with` | 回放可对上脏/净文本，但依赖「匹配侧 strip」 |
| 录制落库 `text` | 多数走未 strip 的 `cleanVisibleText` / AI `elem_text` | SPA 标题与批量推送带 `(N)` / 拼接 `- ` |
| form tree-select `option_text` | manual 已 strip | 与 sidebar `tree_node` 不一致 |
| 推送 | `buildBusinessObjectName` 用原始 `text` | 伙伴平台收到脏串 |

---

## 2. 目标 / 非目标

### 2.1 目标

1. **录制**（AI + 人工）：树节点写入的 `element.text` / `params.text` / `option_text`（树选项）为**语义名**——无装饰 `- `、无 `(N)`；**保留** `[V-…]`。
2. **回放**：匹配不依赖脏后缀；对历史脏串在匹配前做与录制相同的清洗规则（剥 `(N)` / 装饰 `-`，**不**剥 `[V-…]`）。
3. **批量推送**：出口对树相关展示字段再清洗一次，兜住历史脏轨迹（同样保留 `[V-…]`）。

### 2.2 非目标

- 不批量改写历史 DB 行（除非另开 migrate 任务）。
- 不把 `[V-…]` 从产品身份中抹掉。
- 不手改 `_locator_helpers_js.py`（改 JS 源后走 gen）。
- 不借此改 SPA 标题拼装逻辑（后端落库干净后 SPA 自然干净；若仅读旧数据可由推送/展示侧 strip）。

---

## 3. 方案

### 3.1 清洗规则（单源）

在现有 `stripVolatileTreeText`（或拆名为更准确的 `normalizeTreeNodeText`，对外可保留旧名并改语义）中固定：

```
输入 → 空白归一
  → 【DOM 优先】若传入节点：取 custom-tree-node 内「语义子 span」的文本
       （有独立 colored/label 子 span 时，不用整节点 innerText，避免拼上兄弟 `- `）
  → 【文本规则】剥尾部 \(\d+\)
  → 【文本规则】剥尾部装饰连接符：/\s*-\s*$/（仅当确认为装饰；见下）
  → 不剥 [V-…]
  → trim + 长度上限（现有 40，可维持）
```

**装饰 `-` 与名称内合法连字符**：

- 产品/分类名中的 `-`（如 `KB测一级-20260907-1835`）在**中间**，不得剥。
- 只剥**尾部** `/\s*-\s*$/`（对应「年龄限制」后拼接的 `- `）。
- DOM 优先取内层 span 时，通常已无尾部 `-`，正则作兜底。

**`[V-…]` 变更（相对旧实现）**：

- **删除** `stripVolatileTreeText` 中对 `/\[\s*V[-\d.]+\s*\]$/i` 的剥除。
- xpath `starts-with` 改为基于「保留 V 后的语义名」；若录制文本含 V，匹配文本也含 V。历史仅有「剥 V 后」的 xpath 仍可用 `starts-with(净名)`：`测试111[V-0.0.1]` starts-with `测试111` 仍成立；反向「录制有 V、页面暂时无 V」属产品数据异常，不在本设计兜底。

### 3.2 录制落点

对 `target_kind === 'tree_node'`（及 form `select_tree_option` 的 `option_text`）统一：

| 路径 | 改动 |
|------|------|
| `buildLocatorSnap` | `tree_node` 的返回 `text`（及用于 xpath 的 base）走新清洗；`parent_text` 同步 |
| manual sidebar 树点击 `elMeta` | 与 form tree-select 一样写入清洗后文本 |
| AI / CDP capture、click enrich | 树节点 `text` 清洗后再入 `element` / params |
| `JS_CAPTURE_FROM_XPATH` / resolve 树相关 | 若产出 tree 文本，同样清洗 |

### 3.3 回放

- xpath_smart 仍可用 `starts-with(normalize-space(), <清洗后文本>)`（现结构保留）。
- 按文本定位的 JS/引擎路径：比较前对两侧（录制串、现场串）做同一清洗函数。
- **不**要求现场 DOM 上存在 `(N)` 或拼接 `-`。

### 3.4 推送兜底

- `buildBusinessObjectName`（及树点击导出用到的 `text`/`menu_text`/`option_text`）在选用树节点文案时调用同一清洗函数。
- 仅影响导出视图，不写回轨迹。

### 3.5 测试

- Characterization：`(N)` 剥除、尾部 `- ` 剥除、中间 `-` 保留、`[V-0.0.1]` 保留、DOM 内层 span 优先于拼接。
- 可选湿测：产品树点分类 / 产品节点各一，断言落库 text。

---

## 4. 风险与回滚

| 风险 | 缓解 |
|------|------|
| 旧 xpath 在 strip V 时代生成，新匹配保留 V | `starts-with` 对「短前缀」仍兼容；characterization 锁住 V 保留 |
| 误剥名称末尾合法 `-` | 只剥 `/\s*-\s*$/`；DOM 优先取内层 span |
| 与「V 曾被剥」的旧推送数据不一致 | 推送变干净+保留 V 是预期；伙伴侧以新语义为准 |

回滚：恢复函数旧正则并撤销落点调用即可。

---

## 5. 验收

1. 录制点击「年龄限制」类节点 → 落库 / 步骤标题为 `年龄限制`（无尾部 `-`）。
2. 录制「金融新产品(7)」→ 落库 `金融新产品`。
3. 录制「测试111[V-0.0.1]」→ 落库仍含 `[V-0.0.1]`。
4. 回放上述三类不依赖脏后缀；批量推送字段与落库语义一致（历史脏串经出口清洗后无 `(N)` / 尾部 `-`，仍保留 V）。

---

## 6. 实现顺序（计划阶段展开）

1. 改清洗函数语义 + characterization（含「不再剥 V」回归）。
2. 同步 `page-locator-helpers.js` → gen `_locator_helpers_js.py`。
3. 录制落点（snap / manual / AI）。
4. 回放文本匹配对齐。
5. 推送出口兜底。
6. 可选 SUT 湿测。
