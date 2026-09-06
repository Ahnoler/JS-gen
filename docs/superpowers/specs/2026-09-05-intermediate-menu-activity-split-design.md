# 设计：中间菜单标记（`intermediate_flag`）

> 日期：2026-09-05  
> 状态：**待用户确认后实施**  
> 依据：建模 JSON 湿读 + SUT 产品管理飞出层  
> 决策：中间菜单 ≠ 未匹配；**新列**优于复用 `unmatched_flag`；**禁止**仅凭活动 managePage 拆出真实页面不存在的二级菜单

## 1. 问题

建模叶子子领域（如「产品信息管理」UML00092662）常带多个活动页；SUT 上同名是**不可点分组标题**。旧导入把它建成可导航功能并只留第一个 pageId → 假挂载 / 漏叶。

## 2. 语义三分

| 标记 | 谁写 | 含义 | 产品树默认 |
|------|------|------|------------|
| `intermediate_flag` | **导入**；**扫描同名升格可清 0** | 建模草稿，未证实前不可导航；SUT 同名可点证实后升格合入（见 `2026-09-05-intermediate-promote-on-scan-design.md`） | 为 1 时默认不展示 |
| `unmatched_flag` | **扫描** | 本应是菜单，尚未对上 xpath；命中可清 0 | 可展示（现有） |
| `removed_flag` | **导入** | JSON 版本下线 | 可展示或另议（现有） |

> **修订（2026-09-05）**：废除「中间菜单永不可导航 / 扫描不得救活」。同名可点证实 → 升格合入，保持 `source=json_import`。

## 3. 数据

- 新列 `system.intermediate_flag` TINYINT NOT NULL DEFAULT 0  
- API/DAO：`intermediateFlag`  
- 存量：`0230`/`0231` 等 → `intermediate_flag=1`；若仅因中间层误标 `removed`，可清 `removed_flag`（保留 umlEcd）

## 4. 导入规则（层 1）— 无白名单修订

非顶层叶子子领域（`umlType=2` 且无子 umlType=2）：

- **一律** `intermediateFlag=1`（含单 managePage）  
- 全量 `system_page` 作目录；清空导航 pageId/xpath  
- **不**按活动拆可见导航叶；**不加**按系统的 umlEcd 白名单  

可点二级菜单 = **扫描**；扫描后同模块按 **同名 / pageId** 从 intermediate 回填 `UML…` 到可导航叶（`menu-scan-uml-adopt`）。

树/推送默认隐藏 intermediate。真菜单是否录全 → E2E 覆盖 diff（`plans/2026-09-05-menu-intermediate-e2e.md`），**不能事先保证**。

## 5. 二级菜单从哪来（层 2 修订）

- **权威来源 = 菜单扫描**（真实 data-id / 文案）  
- 导入 **不得** 按活动批量 `create` 导航功能（避免 `pdCfgVw` / `pdElmtEdit` 这类 SUT 飞出层不存在的假 L2）  
- **同名升格**：扫描可点 L2 与 intermediate 同名 → 合入该节点（清 intermediate、写 xpath，保持 `json_import`）——见 promote-on-scan spec  
- **异名叶**：仍 create/update 可导航叶；可用 intermediate 的 `system_page` 做 UML/pageId 回填

## 6. 过滤与禁写

默认排除 `intermediate_flag=1`：

- hierarchy tree / 挂交易选功能  
- push-menu 的 menus（path 不含中间名）  

扫描：可导航优先匹配；未命中时允许**同名** intermediate **升格**（禁止异名改名升格）。

可选：`?includeIntermediate=1` 仅调试。

## 7. 验收

- 再导入或 dry-run：`产品信息管理`/`产品要素管理`（若按规则命中）为 intermediate，树默认不可见，umlEcd 仍在  
- 不出现仅因活动而新建的「产品配置视图」「产品要素编辑」功能节点  
- 可点叶仍来自扫描（或已有 0811/0812 等），pageId 可与 system_page 对齐  
- `unmatched` 行为回归不被破坏（表征）  
- characterize + 文档/api-docs 一句说明

## 8. 明确不做

- 复用 unmatched / removed 表达中间层  
- 新 type=4 / 嵌套模块挂子功能  
- 单页叶子一律 intermediate（157，易误伤）  
- 无 SUT 证据的活动→导航功能自动拆叶

## 9. 实施顺序

1. migration + dao/API  
2. import：≥2 managePage → intermediate + 多页写入 system_page  
3. tree/list/push/scan 过滤与禁写  
4. 存量回填 0230/0231  
5. 表征与 api-docs  
