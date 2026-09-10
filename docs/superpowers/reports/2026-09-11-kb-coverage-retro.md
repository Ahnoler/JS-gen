# KB 覆盖回溯 — 基线报告（M1–M6）

> 日期：2026-09-11 · 执行：Zcode 主会话
> 规格/计划：[`specs/2026-09-11-kb-coverage-retrospective-design.md`](../specs/2026-09-11-kb-coverage-retrospective-design.md) · [`plans/2026-09-11-kb-coverage-retrospective.md`](../plans/2026-09-11-kb-coverage-retrospective.md)（`ecfc4ab6`）
> 数据：fixture `scripts/characterization/fixtures/kb-coverage.v1.json`（489.9 KB，data sha `375329fde791d4a9`，416 轨迹/370 带 page_id/11,114 步/688 页）；基线快照 `scripts/characterization/fixtures/kb-coverage-baseline.v1.json`
> 提交链：开工 `ca4763b6` → T0 `8612b6c4`+修正 `c52b929c` → T1 `dfa3a1c2` → T2 `d5de67dc` → 本报告
> 复算：`node scripts/kb/kb-coverage.mjs --json`（确定性已验证：连跑两次逐位一致）

## 1. 六项基线（含分母）

| # | 指标 | 值 | 分母 | 一句话解读 |
|---|---|---|---|---|
| M1 | joinability | **0.857**（72/84） | 84 卡 | 12 张卡**一个可连接码都没有**（见 §2），与卡库永远失联 |
| M2 | coverage | **0.206**（69/335） | recorded+completed 且带 page_id（335 条） | 真实录制里**只有 1/5 能映射到卡** |
| M3 | utilization | **0.321**（27/84） | 84 卡 | **57 张死卡**（从未被真实录制命中，清单见 §3） |
| M4 | uncovered | 266 条 / 263 页 | 未映射轨迹 | Top 缺口见 §4；18/20 是 AILZ 组件码（不在 system_page） |
| M5 | nodeCoverage / orderAgreement / offCardRate | **0.131 / 0.012 / 0.835** | 69 条映射轨迹中 64 条有 visitedRegions | 即便映射上了，实跑访问序列与卡 `nodes` **几乎不吻合**（84% 访问在卡上找不到对应节点） |
| M6 | freshness | **0.250**（33/132 个 ZJJK/FS 码） | 卡 hash_markers 中的页面码 | **38 张卡带陈旧码**（清单见 §5；与库核对：抽查 3 个 stale 全不在 system_page、1 个 fresh 在） |

映射链命中分布：**ZJJK 58 / FS 0 / ROUTE 58**（多链命中按链计入；FS 链全军覆没——全库只有 1 条 URL 带 `fcnScnEcd`，且 `res_path` 中无 FS 码）。映射歧义率 **0.101**（34 条轨迹命中多卡）。

## 2. M1 的 12 张无码卡（结构性失联）

`approval_chain` `collateral-func-ledger` `collateral-func-params` `collateral-func-warning` `customer_360` `guarantee_intro` `loan_account` `rating_flow` `session_login` `system-mgmt-loan-calc` `system-mgmt-org-merge` `system-mgmt-route-mgmt`

这 12 张（占 14.3%）无 ZJJK/FS/路由片段，覆盖回溯对它们**永久不可见**——要接入必须先补码（补码属卡治理动作，不属本线）。

## 3. M3 dead-card 清单（57 张，从未被真实录制命中）

`approval_chain` `approval_todo` `archive-stock-in` `asset-preserve-ops-counter-entrust` `asset-preserve-ops-outsourced-collection` `collateral-func-ext-assess` `collateral-func-ledger` `collateral-func-params` `collateral-func-warning` `collection-remind-cfg` `collection_scorecard` `collection_strategy` `collection_task` `credit-corp-approval-result` `credit-corp-approval-task` `credit_application` `customer-group-cluster` `customer_360` `digital-loan-desk-data-index` `disburse-account-abnormal` `disburse-entrusted-payment` `duigong_contract_sign` `electronic_signing` `guarantee_intro` `guaranty_contract` `judicial-litigation` `limit` `limit-ctrl-api-grant-use-one` `limit-ctrl-api-ocp-revoke-loop` `loan` `loan-corp-entrust-loan` `loan-corp-syndicate-lead-apply` `loan-corp-syndicate-participant-apply` `loan-retail-erheyi-apply` `loan_account` `portal-home-mgmt` `portal-personalization` `portal-public-info` `portal-subapp` `rating-query-view` `rating_flow` `risk-class-default-config` `risk-class-gen-config` `risk-class-ledger` `risk-class-observation-whitelist` `risk-class-query` `session_login` `smart-ctrl-log-query` `smart-ctrl-rule-toggle` `system-mgmt-base-mgmt` `system-mgmt-data-perm` `system-mgmt-gov-bond` `system-mgmt-message-center` `system-mgmt-org-merge` `system-mgmt-param-mgmt` `system-mgmt-route-mgmt`

注意口径：**dead ≠ 无价值**。sample 偏置会压低命中（本快照的录制集中在部分模块）；dead-card 清单是「卡库投资 vs 实际使用」的输入，处置建议（补录制/降级/归档）归 Lead。

## 4. M4 缺口 Top20 与页面族

Top20 中 **18 条是 `AILZ…` 组件编号**（不在 `system_page`，是录制端组件级兜底码，非页面码）——它们天然无法走页面码映射，属于「映射体系之外的录制」。

按页面族聚类（近似，ZJJK 链口径）：

| 真实业务族 | 未映射轨迹数 | 有对应卡？ |
|---|---|---|
| **对公客户评级申请** | 6 | **有**（`rating` 卡：节点页含「对公客户评级申请主页/弹窗」；卡的 hash_markers 用路由片段 `cpctRtg`，与该页 `res_path` 匹配链在快照窗口内只命中部分轨迹） |
| 智能控制执行日志 | 3 | 有 `smart-ctrl-log-query`（dead），页面 `ZJJK00171540PDCP` 不在卡码中 |
| 对公用信申请 | 2 | **有**（`credit_usage` 卡，`res_path` 含 `corpCrutAply`） |
| 对私用信 | 2 | **无**（`prvtCrutAply` 无任何卡片段——真实缺口） |
| 查询交易信息 | 2 | 无（`ZJJK00069541` 不在任何卡） |

**最有价值的单点发现**：`对公客户评级申请`（6 条轨迹，最大真实缺口）**有卡但映射不全**——卡的 `hash_markers` 缺该主页的 ZJJK 码。补一个 marker 即可让 6 条真实录制接入覆盖体系，是**性价比最高的单一改动**。

## 5. M6 陈旧卡（38 张带失效码）

样例（完整清单在引擎输出 `metrics.m6.staleCards`，每条含具体失效 marker）：
`archive-stock-in`（ZJJK00099979/FS00003418 失效）· `asset-preserve-ops-counter-entrust`（5 码中 5 全失效）· `customer-group-cluster`（9 码中 8 失效）· `customer-group-general-group`（7 码中 6 失效）…

**已与生产库逐码核对**（抽查：3 个失效码 COUNT=0、1 个新鲜码 COUNT=1）。38/84 张卡（45%）至少带 1 个已从系统树消失的页面码——**近域 FPR 与召回漂移的一个结构性来源**（陈旧码参与召回 haystack）。

## 6. 结论（覆盖边界 + 下一步 + 投入判断）

1. **KB 的实际覆盖边界**：84 张卡只解释了 20.6% 的真实录制（M2）；27 张卡承载了全部命中（M3 0.321）；约 80% 的录制流量发生在**卡库没有准确页面码**的页面上。**KB 目前是「少数高频交易的深知识」，不是「全行交易的广覆盖」**。
2. **下一步该补哪些卡**（按真实频次）：
   ① **补 `rating` 卡的 ZJJK 码**（对公客户评级申请族 ×6，已有卡只缺码）——最便宜的一笔；
   ② **对私用信管理页**（×2）无卡——真实业务有、KB 无，候选建卡；
   ③ AILZ 组件码录制（18 条）需要另外的接入路径（组件级映射），页面码体系够不着。
3. **M5 的含义比 M2/M3 更重**：映射上的 64 条轨迹，节点一致性只有 0.13/顺序 0.01/卡外 0.835——说明**卡描述的节点序列与实跑路径系统性脱节**（录制轨迹跨页穿梭+region 标签粒度与卡 node 粒度不同构）。这佐证了「用真实轨迹反哺卡节点」的方向（属卡治理，另立项）。
4. **值不值得继续投**：覆盖 20%+利用率 32% 本身不是否定结论——hit 的 27 张卡正是 recall 评测里 B 层 0.400 那批的供给面。**KB 的投资逻辑应该从「铺广度」转向「把 27 张活的做准 + 按真实频次补缺口」**，而不是先扩卡数。门禁（M1/M2/M3/M5 floor）已固化，后续任何卡增补/码修复都在这四条地板上可度量。

## 7. 复核指引（reviewer）

- 脱敏：抽 10 条 fixture 轨迹回库比对（白名单字段级一致；`task`/`name`/业务 query 值不入库——`grep '"task"' fixture` = 0）；
- 独立复算：M1/M2/M3/M6 从 fixture + `data/kb/flows` 可纯离线重算；
- 证伪：`KB_COVERAGE_FIXTURE`（塞 `task` 字段 → 必红）/ `KB_COVERAGE_BASELINE`（抬 0.2 → 必红），两次输出已在 T2 commit message；
- 边界：`src/**` 零改动、只 SELECT、评测集/阈值/verify-all/data/kb/req 零改动。
