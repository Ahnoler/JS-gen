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

- [x] DB `13306`、控制面、Executor、SUT 账号  
- [x] 建模 JSON；目标 `systemId` = **`9000000813`（信贷系统-菜单导入测试）**  
- [x] 代码含 intermediate + `menu-scan-uml-adopt` 回填  

## 2. A — import-json

- [x] 断言：产品信息管理 / 产品要素管理 / 对公客户管理 等叶子均为 `intermediate=1`；默认树不可见这些名。  
  - 证据：232/232 intermediate；`tmp/product-mgmt/_assert_import_9000000813.json`

## 3. B — scan-menu

- [x] 产品管理五叶可导航且带 xpath；分组 intermediate 无 xpath  
- [x] 同名「对公客户管理」`umlEcd=UML00005556`  
- [x] pageId 回填：须在补采后二次 adopt（E2E 暴露时序 bug，已修；存量补跑 adopt 103 条）  
  - 证据：scan `488526d6-…` completed；`tmp/product-mgmt/_assert_scan_9000000813.json`

## 4. C — 覆盖 diff（通过标准）

SUT 权威叶（扫描 `unmatchedScanned` 带父） vs DB `type=3 AND intermediate_flag=0` 有 xpath：

- **仅 SUT = 0** → PASS「真菜单都录入」  
- **仅 DB**：人工判假叶/旧数据  

报告：`tmp/product-mgmt/e2e-menu-coverage-report.md`

| 指标 | 值 |
|------|----|
| 仅 SUT | **0** → **PASS** |
| 产品管理 SUT 五叶 | 均已入库且有 xpath |

## 5. D — 推送

- [x] wire-only（未真正 POST 伙伴）：过滤 intermediate 后无「产品信息管理/产品要素管理」；对公客户管理带 `UML00005556`  
  - 证据：`tmp/product-mgmt/_push_wire_9000000813.json`（menuCount=432，`pass=true`）

## 6. 禁令

- 不为单系统加 umlEcd 白名单  
- 不按活动 managePage 自动拆可见导航叶  
- 覆盖未过不得对伙伴宣称菜单已对齐  

## 遗留

- **产品要素库** pageId 空 → 仍数字串 umlEcd（非 UML00092663）；可再跑 fill-pageid 后 adopt  
- 正式 `systemId=1`：本轮开工时曾误对 1 做过一次 `import-json?autoScan=false`；隔离实测改用 `9000000813`。是否回滚/重扫 1 另议  
- 控制面需重启后新扫描才会自动「补采后二次 adopt」  
