# E2E 计划：菜单导入 / 中间菜单 / 扫描覆盖 / 推送（验证「真菜单都能录入」）

> 日期：2026-09-05  
> 对应规则：`≥2 managePage → intermediate` + 白名单 `INTERMEDIATE_LEAF_UML_ECDS`（含 UML00092663 产品要素管理）  
> 结论前置：**不能事先保证**全库真菜单都录入；本计划用实测把缺口量化。通过标准见 §5。

## 0. 方案说明（给决策用）

| 来源 | 职责 |
|------|------|
| **JSON 导入** | 模块；单页叶子→可导航功能（带 umlEcd/pageId）；多页/白名单→intermediate（隐藏，目录页挂 system_page） |
| **菜单扫描** | SUT 真实可点 L2（data-id/xpath/文案）；补漏、写 xpath；**不得**改 intermediate |
| **覆盖校对** | routemenu 或扫描结果 vs DB 可导航节点；产出缺口清单 |

**不保证的情况（必须靠 E2E 暴露）：**

- 白名单漏了其它「单页但不可点」分组 → 假导航功能残留  
- 扫描角色菜单不全 / 飞出层未展开 → 真叶子漏建  
- 同名不同叶、xpath 错绑 → 需人工看 diff  

## 1. 前置

- [ ] DB 隧道 `13306`；控制面 `4097` 已起  
- [ ] Executor 在线，槽位可开扫  
- [ ] 建模文件：`全部领域-建模组件关系.json`  
- [ ] 目标系统节点 id（信贷一般为 `1`）  
- [ ] 账号可登 SUT（如 701994/1）  
- [ ] 代码含：`intermediate_flag` + `≥2`/白名单规则（非「一律 intermediate」）

## 2. 步骤 A — 再导入（打标）

```text
POST /api/v2/system-mgmt/nodes/{systemId}/import-json
multipart file=全部领域-建模组件关系.json
```

**断言（导入后立刻查库/API）：**

| 节点 | 期望 |
|------|------|
| 产品信息管理 UML00092662 | `intermediate_flag=1`，无导航 pageId，system_page≥2 |
| 产品要素管理 UML00092663 | `intermediate_flag=1`（白名单） |
| 对公客户管理 UML00005556 | `intermediate_flag=0`，有 pageId |
| hierarchy 默认树 | 不出现上述两个 intermediate 名 |

可选 dry-run：`node` 调 `buildImportJsonPlan` 打印 intermediate 列表与单页可导航数（期望 intermediate≈32+白名单，可导航≈189−白名单）。

## 3. 步骤 B — 扫描（真菜单录入）

```text
POST /api/v2/system-mgmt/nodes/{systemId}/scan-menu
轮询 GET .../menu-scan/{scanId} 至 done
```

**断言：**

- 扫描 creates/updates 统计非空；无把 intermediate 改名/写 xpath 的 change  
- 产品管理下存在可导航：`产品阶段管理`/`核心产品映射`/`产品库管理`/`查询产品信息`/`产品要素库`（xpath 含 RES24008/04066/04067/04069/04070）

## 4. 步骤 C — 覆盖 diff（核心：能不能「保证」）

脚本目标（可新建 `tmp/product-mgmt/e2e-menu-coverage.mjs` 或手工表）：

1. 取 SUT 权威叶集：优先本次扫描 menus；或 `localStorage` routemenu 中所有带 `url`/`data-id` 的叶  
2. 取 DB 可导航集：`type=3 AND intermediate_flag=0 AND removed_flag=0`（可加 menu_xpath 非空）  
3. 匹配键优先级：`data-id` ⊂ xpath → 中文名（同模块下）  
4. 输出三类：

| 桶 | 含义 | 通过标准 |
|----|------|----------|
| **SUT∩DB** | 已录入 | — |
| **仅 SUT** | 真菜单漏录 | **必须 = 0**（或附豁免：角色无权限菜单） |
| **仅 DB** | 库有 SUT 无（假叶/旧数据） | intermediate 误标为 0 的必须清；其余列清单人工判 |

**「真菜单都录入」的操作定义：** `仅 SUT` 在约定角色菜单范围内为 **0**。  
首次全量跑通前允许有缺口，但须写入报告并排期补扫/补白名单，**不得**称为已保证。

## 5. 步骤 D — 推送样例（伙伴）

```text
# 本地组包（可不真调伙伴）
用 buildMenuPushPayload / 现有 push 逻辑导出 wire-only JSON
```

**断言：**

- payload.menus 无「产品信息管理」「产品要素管理」  
- 含扫描到的产品管理可点叶  
- `unmatched`/`removed`/`intermediate` 字段语义与文档一致（intermediate 节点根本不进数组）

真推：`POST .../push-menu`（需伙伴 systemNodeId/token）— 仅在 C 桶通过后执行。

## 6. 报告模板

写入 `tmp/product-mgmt/e2e-menu-coverage-report.md`：

- 时刻 / commit / systemId / 角色账号  
- 导入统计、扫描统计  
- 覆盖：SUT 叶数、DB 可导航数、仅 SUT、仅 DB（附样例 20 条）  
- 白名单是否需增补（仅 DB 且像分组标题的名）  
- 结论：PASS / FAIL / PASS-with-waivers  

## 7. 回滚与禁令

- **禁止**在未跑 §4 前恢复「一律 intermediate」  
- 新发现的单页分组：只加 `INTERMEDIATE_LEAF_UML_ECDS`，并补一条 characterize  
- 若 `仅 SUT` 大量来自扫不全：修扫描展开/角色，不改回一律打标  

## 8. 建议执行顺序（本会话或下一会话）

1. 合并本规则回退提交  
2. 起库 + 控制面 + executor  
3. A→B→C；C 出报告  
4. C 通过后再 D（给伙伴新包）  
