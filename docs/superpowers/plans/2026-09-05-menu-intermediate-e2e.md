# E2E 计划：菜单导入 / 中间菜单 / 扫描覆盖 / 推送（无白名单）

> 日期：2026-09-05（修订：取消 umlEcd 白名单）  
> 规则：**非顶层叶子子领域一律 intermediate**；**可点二级菜单只认扫描**；扫描结束按同名/pageId 回填建模 `umlEcd`  
> **不能事先保证**全库真菜单；以 §4 覆盖 diff 为准。

## 0. 为什么不用白名单

跨系统无法维护「哪些单页叶子是分组标题」。  
改用双轨：导入只存建模目录（隐藏）；扫描录入真实可点叶；`umlEcd` 自动对齐。

| 步骤 | 职责 |
|------|------|
| JSON 导入 | 模块 + 叶子→`intermediate=1` + 全量 `system_page` |
| 菜单扫描 | 按 SUT DOM 建/更可导航叶（xpath）；跳过 intermediate |
| uml 回填 | 同模块下同名或 pageId∈目录 → 把 `UML…` 写到可导航叶 |
| 覆盖 diff | SUT 可点叶 vs DB `intermediate=0`；**仅 SUT = 0** 才算录全 |

## 1. 前置

- [ ] DB `13306`、控制面、Executor、SUT 账号  
- [ ] 建模 JSON；目标 `systemId`  
- [ ] 代码含 intermediate + `menu-scan-uml-adopt` 回填  

## 2. A — import-json

断言：产品信息管理 / 产品要素管理 / 对公客户管理 等叶子均为 `intermediate=1`；默认树不可见这些名。

## 3. B — scan-menu

断言：产品管理下出现可导航叶（阶段/映射/库/查询/要素库等）且带 xpath；change-log 无对 intermediate 写 xpath。  
断言：与 intermediate **同名**的可导航叶（如对公客户管理）`umlEcd` 为 `UML…`（回填成功）。

## 4. C — 覆盖 diff（通过标准）

SUT 权威叶（扫描 menus 或 routemenu 带 url/data-id） vs DB `type=3 AND intermediate_flag=0`：

- **仅 SUT = 0**（约定角色菜单内）→ PASS「真菜单都录入」  
- **仅 DB**：人工判假叶/旧数据  

报告：`tmp/product-mgmt/e2e-menu-coverage-report.md`

## 5. D — 推送

wire-only / push-menu：无 intermediate 名；可导航叶尽量带建模 umlEcd。

## 6. 禁令

- 不为单系统加 umlEcd 白名单  
- 不按活动 managePage 自动拆可见导航叶  
- 覆盖未过不得对伙伴宣称菜单已对齐  
