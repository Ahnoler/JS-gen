# Design: 菜单扫描回填改用活动级 `umlEcd`

**日期**：2026-09-09  
**状态**：设计待审（用户已裁决方案 1 + 1:N 仅唯一）  
**前置**：[`archive/specs/2026-09-05-intermediate-promote-on-scan-design.md`](../archive/specs/2026-09-05-intermediate-promote-on-scan-design.md)、`menu-scan-uml-adopt`  
**用户裁决**：可导航叶 `uml_ecd` 以**活动级**为准（`umlType=3` 的 `umlEcd` ↔ `managePage.pdCmptEcd`）；1:N 共享页**仅唯一才回填**。

---

## 1. 问题

### 1.1 表象

产品管理模块下多个可导航功能曾共用同一 `uml_ecd`（如 `UML00092662`）。该码在《建模组件关系》JSON 中只属于叶子子领域「产品信息管理」，其下各活动（维护产品阶段 / 维护核心产品映射 / 配置产品信息 / 查询产品等）各自有**唯一**活动码与 `pdCmptEcd`。

### 1.2 根因

| 步骤 | 行为 |
|---|---|
| JSON 导入 | 叶子子领域 → 一个 intermediate；`system.uml_ecd` = **子领域**码；多活动 `managePage` 写入 `system_page` |
| 菜单扫描 | 异名可点叶 `source=ai`，落地 `pd_cmpt_ecd` |
| `pickUmlEcdFromIntermediates` | 同名失败后，按 `pageId ∈ intermediate.pageIds` 回填 **intermediate 子领域码** |

同一 intermediate 目录下多页 → 多个叶撞同一建模码。JSON 本身无重复；错在回填粒度。

### 1.3 目标 / 非目标

**In**

1. 导入时每条 `system_page` 保留所属活动的 `activityUmlEcd`。
2. 扫描 pageId 回填改为写入该活动码；同名回填仍可用 intermediate 子领域码（升格场景）。
3. 同一 intermediate 下某 `pageId` 对应 **多于一个** 活动（带活动码）时：**不回填**。
4. 表征覆盖唯一 / 歧义 / 同名；存量经再导入 + adopt（或等价）纠偏。

**Out**

- 不按活动自动拆导航叶（仍禁止「仅凭 managePage 造可点菜单」）。
- 不改模块/功能两级树与 intermediate 目录语义。
- 不强制改推送 API 契约字段名；推送仍读 `system.uml_ecd`。
- 不做「1:N 硬选 seqNo 最小」；不做批量人工改库脚本为交付硬门（同事已手工纠产品四叶；实现后提供可重复路径即可）。

---

## 2. 数据与映射

### 2.1 权威对应（活动）

活动节点（`umlType=3`）上：

- `umlEcd` → 写入可导航叶的建模身份（目标）
- `managePage.pdCmptEcd` → `system_page.page_id` / 叶 `pd_cmpt_ecd`

示例（产品信息管理目录内）：

| 活动 umlNm | activity umlEcd | pdCmptEcd |
|---|---|---|
| 维护产品阶段 | `UML00031611` | `ZJJK00095902` |
| 维护核心产品映射 | `UML00031743` | `ZJJK00095454` |
| 配置产品信息 | `UML00057701` | `ZJJK00110131` |
| 查询产品 | `UML00031622` | `ZJJK00095907` |

### 2.2 全量 JSON 事实

约 38 个 `pdCmptEcd` 被多个活动共享（页面→活动 1:N）。对这些 pageId，本设计在 adopt 时**跳过** pageId 回填，避免绑错身份。

### 2.3 表变更

`system_page` 新增可空列：

- 列名：`activity_uml_ecd` `VARCHAR`（长度与 `system.uml_ecd` 对齐，建议 ≥64）
- 语义：导入时该页所属活动的 `umlEcd`；非 JSON 导入路径可为空
- 迁移：`migrations/20260909XXXXXX_system_page_activity_uml_ecd.js`（时间戳实现时定）

DAO `replaceForNode` / `listBy*` 经现有 `toDbRow`/`fromDbRow` 读写 `activityUmlEcd`。

---

## 3. 行为变更

### 3.1 导入（`menu-json-import`）

`collectPages` 对每个活动的 `managePage` 产出：

```text
{ pageId, pageName, resPath, pageType: 'managePage', activityUmlEcd }
```

`activityUmlEcd` = 该活动节点 `umlEcd` 的 trim；空则字段空字符串或不写（列 NULL）。

其余 flatten / intermediate / 幂等 upsert **不变**：功能节点自身 `uml_ecd` 仍为子领域码。

### 3.2 回填（`menu-scan-uml-adopt`）

`pickUmlEcdFromIntermediates(nav, intermediates)` 调整：

1. 叶上已有建模码（`/^UML/i`）→ 仍不覆盖。
2. **同名**命中 intermediate → 仍返回 intermediate 的 `umlEcd`（子领域码）。
3. **pageId**：在 intermediates 展开的 `(pageId → activityUmlEcd)` 候选中：
   - 恰好 **1** 条非空 `activityUmlEcd` → 返回该码；
   - 0 条或多条 → 返回 `''`。

`adoptModelingUmlEcdUnderSystem` 构建 intermediate 时需带上每页的 `activityUmlEcd`（从 `system_page` 读），不能只用 `pageIds: string[]`。

建议 intermediate 形状：

```js
{ name, umlEcd, pages: [{ pageId, activityUmlEcd }] }
```

（或等价 `pageIds` + 并行 map；表征以行为为准。）

### 3.3 存量纠偏

1. 部署迁移。
2. 对目标系统再执行一次菜单 JSON 导入（写满 `activity_uml_ecd`）。
3. 再跑 adopt（扫描 apply 末尾已有调用，或暴露/复用 `adoptModelingUmlEcdUnderSystem`）。

已手工改正的产品四叶：若已是正确活动码，adopt「不覆盖已有 UML…」会保持；若仍为错误子领域码且 pageId 唯一，adopt 会写成活动码。

---

## 4. 验收

### 4.1 表征

| 用例 | 期望 |
|---|---|
| pageId 唯一且带 `activityUmlEcd` | 回填该活动码 |
| 同 pageId 两条不同 `activityUmlEcd` | 不回填 |
| 同名命中 | 仍回填 intermediate 子领域码 |
| 叶上已有 `UML…` | 不覆盖 |
| `collectPages` / 导入计划 | 页含 `activityUmlEcd` |

更新 `characterize-menu-scan-uml-adopt.mjs`：原「产品库管理 + ZJJK_A → UML00092662」改为期望活动码（夹具自带 `activityUmlEcd`）。

### 4.2 湿测（产品管理）

再导入 + adopt 后，四叶（按 `pd_cmpt_ecd`）应为：

| pd_cmpt_ecd | uml_ecd |
|---|---|
| ZJJK00095902 | UML00031611 |
| ZJJK00095454 | UML00031743 |
| ZJJK00110131 | UML00057701 |
| ZJJK00095907 | UML00031622 |

且同模块内无重复建模 `uml_ecd`（数字串 AI 码除外）。

---

## 5. 风险与注意

- **同名回填仍给子领域码**：仅当 SUT 叶名与 intermediate 名完全一致；产品四叶为异名，走 pageId 活动码路径。
- **未再导入前**：`activity_uml_ecd` 为空 → pageId 回填静默跳过（不恶化；需导入才修复自动路径）。
- **推送**：叶上活动码更细，利于下游区分；parent 仍用模块码。

---

## 6. 实现提示（非计划正文）

主要触点：`menu-json-import.js`、`system-page-dao.js`、迁移、`menu-scan-uml-adopt.js`、`menu-scan-apply.js`（若构造 intermediate 处）、`characterize-menu-scan-uml-adopt.mjs`、必要时 `characterize-system-import-json.mjs`。
