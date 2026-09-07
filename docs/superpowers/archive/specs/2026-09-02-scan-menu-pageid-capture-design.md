# 菜单扫描全量补采落地 pageId 设计

> 状态：已评审（2026-09-02）  
> 日期：2026-09-02  
> 范围：scan-menu 落库后对空 `pd_cmpt_ecd` 的二级菜单点开读天元并写入；prepare 取消菜单回写  
> 关联：`docs/superpowers/specs/2026-09-02-ai-menu-pageid-writeback-design.md`（天元取值规则）、`docs/superpowers/specs/2026-08-31-menu-landing-pageid-design.md`

## 1. 背景

产品要求：**全量菜单流程**中点开每个需要补齐的二级菜单 → 读天元 → 写入 `pd_cmpt_ecd`。  
现状 pageId 主要依赖交易 `record/prepare` 回写，与「录菜单时就齐」不一致；AI 扫描新建菜单尤其常空。

## 2. 已拍板决策

| 项 | 决策 |
|----|------|
| 挂载点 | 现有 **scan-menu** 同一次流程（方案 A） |
| 候选 L2 | 该系统下 type=3 且 **`pd_cmpt_ecd` 为空**（不限 source） |
| 已有非空 pageId | **不重读、不覆盖** |
| 读失败 / 无天元 | **skip**，保持空；不写 AILZ 到菜单；不导致整次扫描失败 |
| 天元取值 | 与既有规则一致：整行单码组件编号 → 否则场景编号 FS… → 否则空 |
| prepare | **去掉菜单回写**；只写 `trajectory.page_id` |
| 架构 | apply 落库**之后**第二阶段补采（节点已有 id/xpath） |

## 3. 非目标

- 扫描写 AILZ 到菜单
- URL `fcnScnEcd` 第三兜底
- 覆盖已有非空 `pd_cmpt_ecd`
- 改伙伴 importData / push 契约
- 独立「只补 pageId」产品按钮（可后续；本期绑在 scan-menu）
- 改菜单树匹配 / 阶段二 merge 语义

## 4. 流程

```
scan_menu_tree → buildScanApplyPlan → phase2 → applyScanPlan
  → list candidates (type=3, empty pd_cmpt_ecd)
  → for each: click menu xpath → read_page_component_code
       → landing = componentCode || scenarioCode
       → if landing: write pd_cmpt_ecd + system_page
       → else: skip
  → return scan stats + pageIdFilled / pageIdSkipped / pageIdCandidates
```

单条异常：catch → skip + 计数；外层扫描仍成功（结构已落库）。

## 5. 与 prepare 的关系

| 路径 | 菜单 `pd_cmpt_ecd` | `trajectory.page_id` |
|------|-------------------|----------------------|
| 菜单扫描第二阶段 | 空则尝试写入 | 不动 |
| record/prepare | **不回写** | 组件/场景/AILZ 照旧 |

## 6. 实现触点

| 文件 | 变更 |
|------|------|
| `src/services/menu-scan-pageid.js`（新建，推荐）或扩 `menu-scan-session.js` | 候选列举 + 点读 + 写库循环 |
| `menu-scan-session.js` | apply 后调用补采；汇总统计进 job/响应 |
| 公共写库 | 抽出 `writeFunctionLandingPage`（自 `recording-page-bind.js` 的 write-back）供扫描与（若有）他处复用 |
| `recording-page-bind.js` | 删除菜单回写分支；保留轨迹落库与导航/读码 |
| scan 路由 / api-docs | 文档说明第二阶段；响应统计字段 |
| `scripts/characterization/*` | pin 候选条件、skip、prepare 无 write-back |
| `CHANGELOG.md` | Unreleased |

## 7. 统计字段（建议）

| 字段 | 含义 |
|------|------|
| `pageIdCandidates` | 本轮空 pageId 的 L2 数 |
| `pageIdFilled` | 成功写入数 |
| `pageIdSkipped` | 读不到/导航失败跳过数 |

## 8. 验证

- characterization：候选过滤、prepare 无 `writeBackFunctionLandingPage` 调用、扫描 wiring 含补采入口
- （可选湿测）空 pageId 的 AI L2：scan 后 `pd_cmpt_ecd` 非空；无天元页 skip；已有 ZJJK 的 L2 不被覆盖

## 9. 风险

- 空 pageId 的 L2 很多时扫描耗时长（每条约数秒～十余秒读弹窗）
- 部分页无浮窗 → skip 后推送仍可能 `pageId:""`（符合「读不到就跳过」）
- prepare 取消回写后，仅靠扫描补齐；从未扫过且 pageId 空的节点需再扫一次
