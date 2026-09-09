# Design: 有 xpath 的菜单 `uml_ecd` 唯一（生成列 + 写入校验）

**日期**：2026-09-09  
**状态**：设计已确认；实现计划 [`../plans/2026-09-09-uml-ecd-nav-unique.md`](../plans/2026-09-09-uml-ecd-nav-unique.md)  
**前置**：菜单活动级 adopt [`2026-09-09-menu-activity-uml-adopt-design.md`](./2026-09-09-menu-activity-uml-adopt-design.md)；`system.uml_ecd` 现仅为普通索引 `idx_uml_ecd`  
**用户裁决**：仅保证「有非空 `menu_xpath` 且非空 `uml_ecd`」的行之间 `uml_ecd` 唯一；库约束用生成列 UNIQUE；写入冲突**拒绝**，不静默改码。

---

## 1. 问题

### 1.1 现状

- `system.uml_ecd`：`varchar(64) NOT NULL DEFAULT ''`，索引 `idx_uml_ecd` 为**非唯一**。
- 注释称「菜单唯一 ID」，导入按 `umlEcd` 幂等查找，但 DB 不强制；全表非空码已有多组重复。
- 产品需要：可导航（有 xpath）菜单的建模/导航身份码不撞车；intermediate / 无 xpath 可继续与可导航叶共享历史子领域码等，不必进唯一集。

### 1.2 目标 / 非目标

**In**

1. MySQL 约束：仅对「有 xpath + 非空 uml_ecd」唯一。
2. 应用层写入前冲突检测，失败抛可读错误（`VALIDATION` 或 `CONFLICT`）。
3. 迁移前探测重复；有重复则迁移失败并打印样例（当前连库探测：该子集重复组为 0）。

**Out**

- 整表 `UNIQUE(uml_ecd)`。
- 强制有 xpath 必须有非空 `uml_ecd`（存量空码可保留）。
- 自动合并重复节点或冲突时清空旧码。
- 改推送契约字段名。

---

## 2. 库设计

### 2.1 生成列

环境：MySQL **5.7+**（现网 5.7.44）支持 STORED 生成列。

```sql
-- 逻辑等价（迁移用 knex.raw）
uml_ecd_nav VARCHAR(64)
  GENERATED ALWAYS AS (
    CASE
      WHEN `menu_xpath` IS NOT NULL AND TRIM(`menu_xpath`) <> ''
       AND `uml_ecd` IS NOT NULL AND TRIM(`uml_ecd`) <> ''
      THEN `uml_ecd`
      ELSE NULL
    END
  ) STORED
```

- 无 xpath / 空 `uml_ecd` → `NULL`；UNIQUE 允许多个 `NULL`。
- 有 xpath + 非空码 → 值为该 `uml_ecd`；第二行同码插入/更新失败。

列名：`uml_ecd_nav`（navigable）。应用 DAO **不必**手写该列（GENERATED）。

### 2.2 唯一索引

```sql
UNIQUE INDEX `uk_uml_ecd_nav` (`uml_ecd_nav`)
```

保留现有 `idx_uml_ecd`（全表查询仍有用）。

### 2.3 迁移

文件建议：`migrations/20260909220000_system_uml_ecd_nav_unique.js`

`up`：

1. `SELECT uml_ecd, COUNT(*), GROUP_CONCAT(id) … WHERE xpath 非空 AND uml 非空 GROUP BY uml_ecd HAVING COUNT(*)>1`；若有行 → `throw` 并 `console.error` 样例（最多 N 组）。
2. 若无 `uml_ecd_nav` 列则 `ALTER TABLE` 加生成列。
3. 若无 `uk_uml_ecd_nav` 则加 UNIQUE。

`down`：丢索引再丢列（幂等探测）。

TRIM：生成列表达式与探测 SQL 对 xpath/uml 使用一致的「空」定义（`NULL` 或 trim 后 `''`）。

---

## 3. 应用写入校验

### 3.1 共享 helper

建议 `src/services/menu-uml-ecd-nav-guard.js`（名可微调）：

```js
/**
 * @param {{ umlEcd: string, menuXpath?: string, excludeNodeId?: number }} candidate
 * @param {object} [trx]
 * @returns {Promise<void>}
 * @throws {{ code: 'CONFLICT' }} 已存在另一「有 xpath」节点占用同一非空 umlEcd
 */
export async function assertUmlEcdNavAvailable(candidate, trx)
```

规则：仅当候选 **自身**将形成「有 xpath + 非空 uml」时检查；查库是否存在 `id <> excludeNodeId` 且对方有非空 xpath 且 `uml_ecd` 相等（trim）。有则抛错，message 含冲突 `id`/`name`。

也可直接依赖 DB UNIQUE 并翻译 errno 1062；**仍要**显式 guard，以便 API 返回稳定 `code` 与中文说明（不依赖驱动错误串）。

### 3.2 接线（最小集）

| 路径 | 时机 |
|---|---|
| `menu-json-import` upsert 模块/功能 | 写入/更新 `umlEcd` 前（功能通常 xpath 空，多不触发；模块同理；若将来带 xpath 则触发） |
| `menu-scan-apply` create/update 可导航叶、写 xpath、`assignAiUmlEcdFromId` | 在节点将带非空 xpath 时 |
| `adoptModelingUmlEcdUnderSystem` | `update({ umlEcd })` 前（叶已有 xpath） |

不改：纯改名、只改 `pd_cmpt_ecd`、中间目录无 xpath 的重复子领域码。

### 3.3 冲突语义

- HTTP：建议 409 + `code: 'CONFLICT'`（或现有 `toHttp` 映射）。
- **不**自动清空旧节点 `uml_ecd`、**不**抢码。

---

## 4. 验收

| 用例 | 期望 |
|---|---|
| 迁移在无重复子集上成功 | OK |
| 两行均有 xpath + 同非空 uml | UNIQUE / guard 拒绝 |
| 一行有 xpath、一行无 xpath、同 uml | 允许 |
| 有 xpath + 空 uml 多行 | 允许（生成列为 NULL） |
| adopt/import 冲突 | 可读 CONFLICT，库未被脏写 |

表征：纯函数/对 guard 用 mock DAO 或 cold SQL 夹具（按仓库现有菜单表征风格）。

---

## 5. 风险

- 迁移窗口：若他环境仍有「双 xpath 同 uml」，迁移硬失败——需先手工/脚本消重。
- `TRIM` 在生成列：xpath 仅空白字符视为空；与应用 `String(x).trim()` 对齐。
- 控制面多实例：UNIQUE 仍是跨实例最终一致；guard 与 UNIQUE 双层。

---

## 6. 实现提示

触点：迁移、`menu-uml-ecd-nav-guard.js`、`menu-json-import.js` / `menu-scan-apply.js` / adopt 更新处、`system-dao` 若有通用 update 包装、api-docs 一句、characterize 新 pin、`verify-all` 注册（若有惯例）。
