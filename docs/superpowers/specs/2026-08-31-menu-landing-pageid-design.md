# 菜单落地 pageId 单一化入库设计

> 状态：已评审（2026-08-31）  
> 日期：2026-08-31  
> 范围：JS-gen 菜单 JSON 导入 + 录制 prepare 回写；不含推送菜单 HTTP（D1/D2）  
> 关联：`docs/需求评审-菜单切换/push-menu-v1.sample.json`（推送契约样例）

## 1. 背景

推送菜单契约约定：每个二级菜单（功能节点）的落地页 `pageId` **只有两种取值**——恰好一个非空字符串，或空串 `""`。模块无落地页。

现状偏离契约：

- `collectPages` 同时收集建模 JSON 的 `managePage` + `guidePages`，写入多行 `system_page`  
  （例：对公客户管理 → `ZJJK00066153` managePage + `ZJJK00066158` guidePage）
- 真机天元「组件编号」仅对应落地页一个码（CDP 实测 `ZJJK00066153`）；活动名括号内的码是 guidePage，不是落地页
- `system.pd_cmpt_ecd` 已存在，但语义是 `pages[0]`，未明确「唯一落地页」

## 2. 目标

1. **菜单初始化 / 更新（JSON 导入）**：按契约入库——功能节点 0 或 1 个落地 `pageId`（只信建模 managePage）
2. **真机录制 prepare**：读到天元真实组件编号时，**回写**该功能节点落地 `pageId`（覆盖建模值）；AILZ 兜底不回写菜单
3. 存量清理 guidePage 多行，使库表与契约一致

## 3. 非目标

- 推送菜单接口 / 平台回调（D1–D5）
- 导入时打开浏览器二次采集 pageId
- 删除 `system_page` 表（仍保留 0/1 行模型）
- 扫描路径主动「造」pageId
- 回刷历史 `trajectory.page_id`

## 4. 入库语义

| 节点 | 落地 pageId |
|------|-------------|
| 功能 type=3 | 建模 **第一个非空 managePage.pdCmptEcd**，或 `""` |
| 模块 type=2 | 恒 `""`（不挂落地页） |
| guidePage / task 级 pdCmptEcd | **不入库** |
| 多个 managePage | 确定性取第一个非空；可 log warn |

双写一致：

- `system.pd_cmpt_ecd` = 落地 pageId（或空）
- `system_page`：有 pageId 时恰好 1 行（`page_type='managePage'`，带 pageName/resPath）；无则 0 行

## 5. 写入路径

| 路径 | 菜单落地 pageId | `trajectory.page_id` |
|------|-----------------|----------------------|
| JSON 导入 / 重复导入 | managePage 或 `""`；`replaceForNode` 整替 | 不动 |
| 菜单扫描 | 不写 pageId | 不动 |
| prepare 读到天元编号（`source=read`） | **回写**功能节点（`pd_cmpt_ecd` + `system_page` 整替为这一行） | 写入实测编号 |
| prepare 失败 → AILZ | **不回写**菜单 | 写入 AILZ |

回写前置条件：`source === 'read'`、有效 `functionId`、组件编号非空。无功能节点（仅 AILZ 交易）不碰菜单。

## 6. 存量迁移

1. 删除 `system_page` 中 `page_type = 'guidePage'` 的行  
2. 同一 `system_node_id` 仍多行时：只保留一条（优先 `managePage`，同类型取最小 `id`）  
3. 按保留行回写对应 `system.pd_cmpt_ecd`；无行则置 `""`  
4. 不修改 `trajectory.page_id`

## 7. 实现触点

| 文件 | 变更 |
|------|------|
| `src/services/menu-json-import.js` | `collectPages` 只收 managePage，每功能最多 1 个；去掉 guidePages 循环 |
| `src/services/trajectory/recording-page-bind.js` | `source=read` 成功后回写功能落地页 helper |
| `src/dao/system-page-dao.js` | 可选：`replaceLandingPage(nodeId, page\|null)` 语义化包装；或继续用 `replaceForNode` |
| `migrations/YYYYMMDD_system_page_landing_only.js` | 存量清理 |
| `scripts/characterization/characterize-system-import-json.mjs` | 断言只含 managePage 单码 |
| `scripts/characterization/characterize-page-bind.mjs` | pin 回写 / AILZ 不回写 |
| `src/dashboard/api-docs/groups/overview.js` | import-json 描述改为单落地 pageId |
| `docs/需求评审-菜单切换/push-menu-v1.sample.json` | 已与契约对齐（参考） |
| `CHANGELOG.md` | `[Unreleased]` |

## 8. 验证

- `node scripts/characterization/characterize-system-import-json.mjs`  
  - 对公客户管理 pages / 入库只含 `ZJJK00066153`，不含 `ZJJK00066158`  
  - 空 guide / 无 manage → `pageId=""`  
- `node scripts/characterization/characterize-page-bind.mjs`  
  - read 成功 → 调用回写（源码 cue 或 mock）  
  - AILZ 路径无回写 cue  
- 湿测（可选）：导入信贷 JSON → 对公客户管理 `pd_cmpt_ecd`/`system_page` 单行 `ZJJK00066153`；prepare 后与天元一致

## 9. 风险与兼容

- **规则 5.4**（按 `system_page.page_id` 迁交易）：匹配集变为仅落地页。交易起点本就绑定天元组件编号（= managePage），与录制路径一致；历史若误用 guidePage 作 `trajectory.page_id` 将不再被 5.4 命中（保留原菜单，可接受）  
- **扫描 phase2 幽灵匹配**：幽灵「有页面 ID」改为仅落地页；仍够用  
- **page-bind 交叉校验**：`knownIds` 变为 0/1 个；行为更严、更准  

## 10. 决策记录

- 入库含义选 **A**：不入库 guidePage  
- 正确性：导入信建模 managePage；真机录制 read 成功后覆盖菜单落地 pageId  
- 字段名：推送契约用 `pageId`（单值）；库列仍为 `pd_cmpt_ecd` + `system_page.page_id`
