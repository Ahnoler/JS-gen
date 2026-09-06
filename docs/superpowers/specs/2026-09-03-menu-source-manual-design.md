# 菜单来源 `manual`（手工新增）设计

> 状态：待评审（2026-09-03）  
> 日期：2026-09-03  
> 范围：系统管理手工新增模块/功能标 `source=manual`；存量空 source 的 type=2|3 回填  
> 关联：推送 menus[].source；`json_import` / `ai` 既有来源不变

## 1. 背景

推送菜单里仍有 `source=""`（如「导航」「登录」），实为系统管理 UI 手工新建。需要显式来源值，并与建模导入、AI 扫描区分。

## 2. 已拍板决策

| 项 | 决策 |
|----|------|
| 取值 | `source = 'manual'` |
| 新增入口 | `hierarchyService.createNode`：`type∈{2,3}` 且 source 空/缺省 → 默认 `manual` |
| 系统/根 | type=0/1 **不**写 `manual` |
| 存量回填 | 仅 `type IN (2,3)` 且 `source` 空或 null → `manual`（knex 数据迁移） |
| JSON 导入覆盖 | 收编/更新把 `manual` 改成 `json_import` **允许**，属菜单更新，不改导入逻辑 |
| 显式传入 | 若调用方显式传非空 `source`（如 `ai`），**尊重**，不强制覆盖 |

## 3. 非目标

- 改 push 过滤 / 契约字段集合
- 给 type=0/1 回填或默认 `manual`
- 单独 backfill HTTP API
- 改 Excel 导入专用分支（若走 `createNode` 则自然继承默认）

## 4. 实现要点

1. **`createNode`**：落库前对模块/功能补默认 `source='manual'`。  
2. **迁移**：`UPDATE system SET source='manual' WHERE type IN (2,3) AND (source IS NULL OR TRIM(source)='')`。down：不回滚数据（或仅记录 affected，可选 no-op down）。  
3. **api-docs**：`POST .../nodes` 注明 type=2|3 默认 `manual`；push-menu notes 列出 `manual`。  
4. **characterization**：钉住 createNode / 路由或 service 源码含 `manual` 默认。  
5. **CHANGELOG** `[Unreleased]`。

## 5. 验收

- 手工 POST 新建模块/功能 → 响应与库 `source=manual`。  
- 扫描新建仍为 `ai`；JSON 导入仍为 `json_import`。  
- 迁移后推送报文中不再出现 type=2|3 的空 `source`（本仓信贷树「导航/登录」等变为 `manual`）。  
- 根与系统节点 source 可仍为空。
