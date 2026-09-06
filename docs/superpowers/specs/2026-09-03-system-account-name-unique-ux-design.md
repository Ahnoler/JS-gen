# 系统账号角色名称唯一约束：中文提示 + 提交前校验（A+B）

日期：2026-09-03  
状态：已定案（不做自动交换 C）  
范围：本仓控制面 `system_account` 经系统节点 POST/PUT `accounts[]` 的同步路径

## 背景

编辑系统节点「被测系统登录用户」时，用户将对调两条账号的**角色名称**（`name`）后提交，接口返回库层错误：

```text
Duplicate entry '…-李淼一' for key 'system_account_system_id_name_unique'
```

根因：`(system_id, name)` 唯一；`syncSystemAccounts` 按行 `UPDATE`，交叉更名时中间态撞键。业务仍要求同系统下角色名唯一；本需求只改善校验与提示，不实现自动交换。

## 目标

1. **A**：唯一键失败不再暴露 SQL；返回可读中文与明确 HTTP 状态。
2. **B**：提交前拦住包内重名与「占用他人当前名称」的交叉更名；引导用户用临时名分两步改。
3. **非目标**：不放宽唯一约束；不做临时名中转的自动 swap；不改 `account` 登录名字段规则；前端另仓可同源文案，本仓以保证 API 为准。

## 现状锚点

| 位置 | 行为 |
|------|------|
| `normalizeSystemAccounts` | 已拦提交包内 `name` 大小写不敏感重复 → `VALIDATION` |
| `syncSystemAccounts` | 按 id / 无 id 按 name 匹配后逐行 update/create，再删未出现行；未捕获 `ER_DUP_ENTRY` |
| `src/routes/v2/system-mgmt.js` `httpError` | `VALIDATION`→400，`CONFLICT`→409；未映射的 DB 错误→500 |

## 设计

### B1 — 包内重名文案统一

`normalizeSystemAccounts` 在 `seenNames` 冲突时改为：

`同一系统下角色名称不能重复：「{name}」`

- `code: 'VALIDATION'` → HTTP 400  
- 大小写不敏感规则不变（`toLocaleLowerCase`）

### B2 — 交叉占用 / 真占用预检（UPDATE 前）

在 `syncSystemAccounts` 取得 `existing`、完成 id 归属校验之后、**任何** `update`/`create`/`remove` 之前：

对每个待写入项 `item`，令 `nameKey = key(item.name)`。若存在另一条 `other ∈ existing`，满足：

- `key(other.name) === nameKey`
- `Number(other.id) !== Number(target?.id)`（新建无 target 时：任意占用该名的 existing 都算冲突）

则抛出：

`角色名称「{name}」已被占用。若要对调，请先将其中一条改为临时名称后再提交。`

- `code: 'VALIDATION'` → HTTP 400  

说明：

- **对调 / 交叉更名**：对方本批也会改名，仍判冲突（刻意：本需求不做 C，引导临时名）。
- **真重复**：目标名留给本批未改走且仍保留的行，同样命中。
- **仅改自身其它字段、name 不变**：`other.id === target.id`，不触发。
- **先删后占**：本批全量替换下，未出现在 payload 的行会在循环后删除；若新建/改名占用「将被删除」行的当前名，仍走本预检拒绝（避免中间态撞键；用户可先提交删除该行，再提交占用该名）。

### A — 库唯一键兜底

`syncSystemAccounts` 内对 `systemAccountDao.update` / `create`（及如有必要的事务边界）捕获：

- `err.code === 'ER_DUP_ENTRY'` 或 `err.errno === 1062`

映射为：

`同一系统下角色名称「{name}」已存在，请修改后再提交。若要对调两条账号，请先将其中一条改为临时名称。`

- `code: 'CONFLICT'` → HTTP 409  
- `{name}` 优先用当次写入的 `item.name`；解析不出则用「该名称」  
- **禁止**把 `err.sql` / knex 原文写入 `Error.message` 或响应体  

预检应覆盖主路径；A 仅作竞态与漏网兜底。

### 错误码约定

| 场景 | code | HTTP |
|------|------|------|
| 包内重名、交叉/真占用预检 | `VALIDATION` | 400 |
| DB 唯一键兜底 | `CONFLICT` | 409 |
| 账号被 batch 引用无法删（已有） | `CONFLICT` | 409 |

路由层已有映射，无需改 `httpError` 表；确保抛错带 `code`。

### API 文档

`src/dashboard/api-docs/groups/overview.js`（或 hierarchy 组中 nodes POST/PUT 说明）补一句：

- 同系统 `accounts[].name` 唯一；交叉更名/对调须先临时名；冲突返回 400/409 中文，不返回 SQL。

## 验证

1. 扩展 `scripts/characterization/characterize-system-node-accounts.mjs`：
   - 包内重名断言新文案；
   - 导出或测得到的预检逻辑：existing 中他行占用目标名 → 抛出 B2 文案（可用纯函数抽 `assertAccountNamesAvailable`，便于离线测）。
2. 手工湿测（有执行机/控制面时）：
   - 对调两角色名 → 400 + B2 文案；
   - 改为全新名 → 200；
   - 临时名两步对调 → 两次均成功。

## 实现触点（计划用）

- `src/services/hierarchy-service.js`：`normalizeSystemAccounts`、`syncSystemAccounts`（+ 可选小函数预检）
- `scripts/characterization/characterize-system-node-accounts.mjs`
- `src/dashboard/api-docs/...` 一句说明
- 收工：`docs/superpowers/agent-log.md` 顶插一条

## 不做清单

- 不改 `schemas/init.sql` / 迁移中的唯一键
- 不实现自动 swap / 临时占位写库
- 不在本仓改外部 SPA（若前端仍展示原始 `message`，API 中文即可；若前端另拼 SQL，另仓跟文案）
