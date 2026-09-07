# T1 执行计划：drafts → 正式卡晋升管线（2026-09-06）

> 状态：**立项准备完成，待执行**。上游：湿测战役 30/30（1958 叶，checker 0 FAIL）+ 草稿卡 174/174。
> 本文回答三件事：晋升什么、怎么转换、按什么流程走。

## 1. 现状与基数

- 草稿卡 174 张（30 模块），gate 分布：**pass/full 53 张**（可首批晋升）、partial 121 张（pendingSteps 未回收，第二批）。
- 现有 `scripts/kb/promote.py` 是「staging 回流记录 → 既有卡 rules 追加」管线，**不做卡级晋升**——T1 需新建转换器（建议 `scripts/kb/promote_draft.mjs`，与 checker 同栈）。
- 正式卡 29 张（data/kb/flows/）为 KB v1 答案级真值，schema 主体：`flow/aliases/hash_markers/keywords/menu_path/biz_key_prefix/preconditions/nodes[]/state_actions[]/field_deps[]/rules[]/exceptions[]/source`。

## 2. 第一批范围：53 张 gate=pass 卡

全量清单见各 drafts/ 的 coverage.gate（脚本可列）。按域分组：

- 客户域：customer-group 3、customer-common 3
- 授信/用信域：credit-retail 1、loan-corp 3、loan-retail 2
- 放还款/贷后：disburse 2、postloan-check 3、postloan-risk-class 8
- 押品/资产保全：collateral-info 3、collateral-func 3、asset-ops 2、asset-npl 1
- 配置/门户/系统：smart-ctrl 5、portal 4、system-mgmt 9、collection 2、archive 1、digital-loan-desk 1、limit-ctrl-api 1

## 3. 转换规则（draft → formal schema）

| draft 字段 | formal 去向 | 转换规则 |
|-----------|------------|----------|
| steps[] | **nodes[]** | `{name→page, enter→菜单路径+路由, buttons, columns, note}`；`id` 取步骤 slug；`leafRef/verify` 不进正式卡 |
| chapters「关键规则」+ SUT 实测 | **rules[]** | 提取 `keyword→rule` 对（keyword≤8 字，rule 一句话）；source 标 `"req-promote 2026-09-06"` |
| wet-test 状态机证据 | **state_actions[]** | 仅当 chapters/wet-test 有「状态→允许操作」实证时生成 |
| SUT 缺陷/异常原文 | **exceptions[]** | 从 wet-test 运行记录摘录（如 tsscMutilDialog 残留） |
| sourceRefs + coverage | **source** | `"req-promote 2026-09-06（湿测叶N~M，match 实证）"` |
| hash_markers | hash_markers | 从 wet-test 证据的路由/FS 号取（无编号模块留空） |

**待 влаж测字段（draft 独有）不进正式卡**：`draftFrom/moduleKey/verify/pendingSteps/coverage` —— pendingSteps 信息转记 `exceptions[]` 尾条「待回收步骤 N 项见 _blocked-backlog.md」。

## 4. 同域合并策略（关键裁决，已定）

29 张正式卡已覆盖部分域（credit_usage/rating/collection_task 等）。晋升时：

- **草稿域与正式卡同域**（如 loan-corp 用信申请 ↔ credit_usage.json）：**不新建卡**，转为向既有卡 **append** `nodes[]/rules[]/exceptions[]`（去重：page+keyword 相同跳过），source 追加 req-promote 标注。
- **草稿域无正式卡**（如 smart-ctrl/archive/portal/system-mgmt/资产保全 等 20+ 域）：**新建卡**，命名 `<域>-<业务>.json`，registry 化（新建 `data/kb/flows/_index.json` 或依赖目录扫描——保持现有目录扫描机制，不建 index）。
- 同域判定由转换脚本按 `menu_path` 与既有卡 `menu_path/aliases` 相似度半自动建议 + 人工确认。

## 5. 执行流程（三棒）

1. **B1 转换脚本 + dry-run 审查表**：写 `scripts/kb/promote_draft.mjs`；对 53 张 pass 卡产出审查表 `tmp/promote-review.md`（每卡：目标文件/新建或合并/nodes 数/rules 数/同域建议）；人工过表。
2. **B2 应用 + 验证**：`--apply` 写入 flows/；跑 `verify-all`（含 KB 系 checker）+ recall 冒烟（挑 3 张新卡走 matcher 查询验证可召回）；命名冲突/同域合并逐一确认。
3. **C 收工**：agent-log 收官 + 推送；drafts/ 保留（晋升来源存档，manifest.status 可选升级 drafted——**不做**，status 语义是"该模块出过草稿"而非"已晋升"，避免 pin 影响）。

## 6. 质量门

- 晋升脚本内建校验：JSON.parse、nodes 必填字段（id/page/enter）、rules keyword 非空、与既有卡去重；
- `verify-all` 全绿（KB store/recall/normalize/promote 四 checker 不受新卡破坏）；
- recall 冒烟：新卡 flow/aliases/keywords 至少一条可命中。

## 7. 风险与开放问题

| 风险 | 处置 |
|------|------|
| rules 提取质量参差（chapters 粒度不一） | 首批仅取「SUT 实测」标注段 + 关键规则小节，宁缺毋滥；审查表人工逐条过 |
| 与 29 张旧卡同域重叠（credit_usage/rating 等） | 合并策略（§4），合并失败的单卡降级第二批 |
| 无编号模块 hash_markers 缺失 | 留空数组（recall 退化到 keywords/aliases 匹配，可接受） |
| partial 卡 121 张 | 第二批：待 T2 blocked 回收后 pendingSteps→steps 重出，再走同一管线 |

## 8. 验收标准

- 53 张 pass 卡 100% 处理（晋升或明确降级原因）；
- 新增/合并后的 flows/ 全部 JSON 可解析、recall 冒烟通过、verify-all ALL GREEN；
- agent-log 收官条目含晋升清单与 commit hash。
