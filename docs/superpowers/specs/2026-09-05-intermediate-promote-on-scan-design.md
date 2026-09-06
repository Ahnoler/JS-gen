# 设计：扫描同名升格 intermediate（合入，不建 AI 孪生）

> 日期：2026-09-05  
> 状态：**已确认**（用户认可 source 保持 `json_import`）  
> 修订：`2026-09-05-intermediate-menu-activity-split-design.md` §2/§5「永不可导航 / 扫描不得救活」  
> 相关：E2E `plans/2026-09-05-menu-intermediate-e2e.md`；隔离实测 `9000000813`；正式 `systemId=1`

## 1. 问题

导入将建模叶子一律标 `intermediate=1`（`source=json_import`）。扫描匹配**跳过** intermediate → 同名可点叶（如「对公客户管理」`UML00005556`）被 **新建** `source=ai` 孪生，再 uml 回填。  
产品树默认隐藏 intermediate → 界面只见「AI识别」，与「节点来自建模 JSON」的预期冲突；且拆成两行（正式库例：`7` json intermediate + `9000001478` ai 可导航）。

## 2. 目标语义

| 状态 | 含义 |
|------|------|
| `intermediate=1` | 导入草稿，**尚未**被 SUT 同名可点菜单证实 → 树/推送默认隐藏 |
| 扫描同名证实后 | **升格合入**该节点：`intermediate=0`，写 xpath（及后续 pageId），**保持** `source=json_import` 与既有 `UML…` |
| SUT 无同名可点叶 | 保持 intermediate（分组标题等，如「产品信息管理」） |

权威关系不变：**可点菜单形态以扫描为准**；建模节点在同名证实时**复用身份**（不另开 AI 行）。

## 3. 扫描匹配（同模块 L2）

在 `buildScanApplyPlan`（及落库路径）中：

1. 仅在 `intermediate≠1` 子节点中按现有规则匹配（xpath data-id 优先，其次同名且 xpath 兼容）  
2. 未命中时：若同模块存在 **同名且 `intermediate=1`** 的功能 → 记入 **升格更新**（写 xpath / sortOrder；落库时 `intermediateFlag=0`，清 `unmatchedFlag`；**不改** `source`、`umlEcd`）  
3. 仍无 → `creates`（`source=ai`，既有行为）  
4. **禁止**对 intermediate 做「异名 xpath 改名升格」（避免把分组标题节点改成别的 SUT 文案）

`applyScanPlan`：升格走 `updates`（或显式 `promotes`），更新字段含 `intermediateFlag: 0`；新建仍 `assignAiUmlEcdFromId`。

pageId 补采后：`adoptModelingUmlEcdUnderSystem` 仍保留（异名叶从 intermediate 目录回填 UML）；已升格节点本身已是 `UML…`，adopt 不覆盖。

## 4. 存量孪生清理

同系统、同父模块下：存在 `intermediate=1` 的 json 节点 A，与同名 `intermediate=0` 的可导航叶 B（多为 `source=ai`）时：

1. 将 B 上 `trajectory.function_id`（及其他 function 外键若有）迁到 A  
2. 把 B 的 xpath / pageId（若 A 空）合入 A；A：`intermediate=0`，**保持** `source=json_import`  
3. 删除 B（及仅挂在 B 上的 `system_page` 视策略合并）

正式 `systemId=1`：「对公客户管理」`7`（21 条 traj）← 合入并删 `9000001478`（0 条 traj）。

可做一次性脚本或扫描事务尾部幂等清理；优先扫描路径自愈 + 补跑一趟 scan / 小脚本。

## 5. 非目标

- 不改 source 枚举、不加 `json_import+scan`  
- 不按活动 managePage 自动拆可见导航叶  
- 不恢复 umlEcd 白名单  
- 不把「异名 + pageId∈目录」的 AI 叶改成改名 intermediate（仍独立可导航叶 + UML 回填）

## 6. 验收

- 特征化：`buildScanApplyPlan` 同名 intermediate → updates 升格、无 create；异名分组仍不误升格  
- 湿测 / 正式 `1`：对公客户管理仅一行、`source=json_import`、有 xpath、`intermediate=0`、uml=`UML00005556`；无 AI 孪生  
- 产品管理：0230/0231 仍 intermediate；五真叶行为不回归  
- 推送 wire：该叶来源为 json 导入语义（非 AI）

## 7. 文档同步

- 本 spec 取代 intermediate 设计中「永不可导航 / 扫描不得救活」条款  
- 更新 api-docs 对 `intermediate` 的一句话说明（若有）  
- todo：实施后勾选；推送仍下周一  
