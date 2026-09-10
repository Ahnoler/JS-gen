# KB 覆盖回溯 — 基线报告（M1–M6）

> 日期：2026-09-11 · 执行：Zcode 主会话
> 规格/计划：[`specs/2026-09-11-kb-coverage-retrospective-design.md`](../specs/2026-09-11-kb-coverage-retrospective-design.md) · [`plans/2026-09-11-kb-coverage-retrospective.md`](../plans/2026-09-11-kb-coverage-retrospective.md)（`ecfc4ab6`）
> 数据：fixture `scripts/characterization/fixtures/kb-coverage.v1.json` **v1.1**（498.8 KB，data sha `33ad3e617280d07f`，416 轨迹/370 带 page_id/11,114 步/688 页；v1 被 G 判决 D1 判废——`page_level_key` 被 40 字守卫剥空，已重冻修复）；基线快照 `kb-coverage-baseline.v1.json` v1.1（M5 已出 floor，见 §1 注）
> 提交链：开工 `ca4763b6` → T0 `8612b6c4`+修正 `c52b929c` → T1 `dfa3a1c2` → T2 `d5de67dc` → T3 `5b05c5d8` → T4 `7b3f1fae` → **G 判决 `38e0ef7d` → T5 迭代：开工 `ed2ef2cb` → D1+D5 `996163e0` → D3+D2 `93c848a5` → 本报告修订**
> 复算：`node scripts/kb/kb-coverage.mjs --json`（确定性已验证：连跑两次逐位一致）
> **G 复核结论（`38e0ef7d`）：M1/M2/M3/M4/M6 数据面与门禁通过，可用作决策；M5 v1 作废，v2 已按 D2 重建（定义与台账见 §8）**

## 1. 六项基线（含分母）

| # | 指标 | 值 | 分母 | 一句话解读 |
|---|---|---|---|---|
| M1 | joinability | **0.857**（72/84） | 84 卡 | 12 张卡**一个可连接码都没有**（见 §2），与卡库永远失联 |
| M2 | coverage | **0.206**（69/335） | recorded+completed 且带 page_id（335 条） | 真实录制里**只有 1/5 能映射到卡** |
| M3 | utilization | **0.321**（27/84） | 84 卡 | **57 张死卡**（从未被真实录制命中，清单见 §3） |
| M4 | uncovered | 266 条 / 263 页 | 未映射轨迹 | Top 缺口见 §4；18/20 是 AILZ 组件码（不在 system_page） |
| M5 | nodeCoverage / entryOnCard / offCardRate | **v2：1.000 / 1.000 / 0.000**（上限 1.000） | 69 条映射轨迹中 **18 条**带页面 key（page_level_key；全 fixture 仅 9 个去重路由） | v1 作废（D2：label 词表重合非行为，饱和于自身 matcher 上限的 91.9%；orderAgreement 0.0117 已等于精确串等上界）。v2=页面 key↔卡路由 marker 同类比较；**1.0 饱和是小样本面事实**（key 只存在于产品管理族录制，族内卡共享 `pdMgt/pdInfMgt` markers），非 matcher 伪影；**informational 不设 floor（D4）**，样本面扩大后再议门槛。重建定义与台账见 §8 |
| M6 | freshness | **0.250**（33/132 个 ZJJK/FS 码） | 卡 hash_markers 中的页面码 | **38 张卡带陈旧码**（清单见 §5；与库核对：抽查 3 个 stale 全不在 system_page、1 个 fresh 在） |

映射链命中分布：**ZJJK 58 / FS 0 / ROUTE 58**（多链命中按链计入；FS 链全军覆没——全库只有 1 条 URL 带 `fcnScnEcd`，且 `res_path` 中无 FS 码）。映射歧义率 **0.101**（34 条轨迹命中多卡）。**D6 精度标注：ROUTE 链是弱匹配链**——5 个泛化片段各命中 ≥10 个页面（`lmtMgt` 43 页、`cstMgt` 32 页…），58 条 ROUTE 命中里相当部分是「同模块泛命中」而非「卡↔页面精确对应」；ZJJK 链（58 条）是精确主键命中，ZJJK 计数可信，ROUTE 计数只作模块级归因、不作卡级结论。

**D3 订正**：primaryCard 曾按字母序取（实现与头注释不符），24/69 条映射轨迹的 primaryCard 不来自最高优先级链——已修为链优先级（ZJJK>FS>ROUTE）+字母序 tiebreak（`93c848a5`，`attribution.primaryCardMisaligned=24` 留档审计）。M2/M3 是多标签计数，不受此错影响；受影响的只有 M5 的「按哪张卡算」——v2 数字以修后 primaryCard 为准。

## 2. M1 的 12 张无码卡（结构性失联）

`approval_chain` `collateral-func-ledger` `collateral-func-params` `collateral-func-warning` `customer_360` `guarantee_intro` `loan_account` `rating_flow` `session_login` `system-mgmt-loan-calc` `system-mgmt-org-merge` `system-mgmt-route-mgmt`

这 12 张（占 14.3%）无 ZJJK/FS/路由片段，覆盖回溯对它们**永久不可见**——要接入必须先补码（补码属卡治理动作，不属本线）。

## 3. M3 dead-card 清单（57 张，从未被真实录制命中）

`approval_chain` `approval_todo` `archive-stock-in` `asset-preserve-ops-counter-entrust` `asset-preserve-ops-outsourced-collection` `collateral-func-ext-assess` `collateral-func-ledger` `collateral-func-params` `collateral-func-warning` `collection-remind-cfg` `collection_scorecard` `collection_strategy` `collection_task` `credit-corp-approval-result` `credit-corp-approval-task` `credit_application` `customer-group-cluster` `customer_360` `digital-loan-desk-data-index` `disburse-account-abnormal` `disburse-entrusted-payment` `duigong_contract_sign` `electronic_signing` `guarantee_intro` `guaranty_contract` `judicial-litigation` `limit` `limit-ctrl-api-grant-use-one` `limit-ctrl-api-ocp-revoke-loop` `loan` `loan-corp-entrust-loan` `loan-corp-syndicate-lead-apply` `loan-corp-syndicate-participant-apply` `loan-retail-erheyi-apply` `loan_account` `portal-home-mgmt` `portal-personalization` `portal-public-info` `portal-subapp` `rating-query-view` `rating_flow` `risk-class-default-config` `risk-class-gen-config` `risk-class-ledger` `risk-class-observation-whitelist` `risk-class-query` `session_login` `smart-ctrl-log-query` `smart-ctrl-rule-toggle` `system-mgmt-base-mgmt` `system-mgmt-data-perm` `system-mgmt-gov-bond` `system-mgmt-message-center` `system-mgmt-org-merge` `system-mgmt-param-mgmt` `system-mgmt-route-mgmt`

注意口径：**dead ≠ 无价值**。sample 偏置会压低命中（本快照的录制集中在部分模块）；dead-card 清单是「卡库投资 vs 实际使用」的输入，处置建议（补录制/降级/归档）归 Lead。

## 4. M4 缺口 Top20 与页面族

Top20 中 **18 条是 `AILZ…` 组件编号**（不在 `system_page`，是录制端组件级兜底码，非页面码）——它们天然无法走页面码映射，属于「映射体系之外的录制」。

按页面族聚类（**T5 订正后**——评级/对公用信两族已被 ROUTE 链映射，不在 266 条里；表中仅存真实缺口）：

| 真实业务族 | 未映射轨迹数 | 有对应卡？ |
|---|---|---|
| 智能控制执行日志 | 3（`ZJJK00171540PDCP`） | 有 `smart-ctrl-log-query`（dead 卡），但页面码不在卡 `hash_markers` 中——**补 1 个 marker 即接入**，当前最便宜的真实缺口 |
| 查询交易信息 | 2（`ZJJK00069541`） | 无卡——候选建卡 |
| 对私用信管理 | 2（`prvtCrutAply` 族） | 无卡——真实业务有、KB 无，候选建卡 |
| AILZ 组件码 | 18（各 ×1） | 不在 `system_page`（录制端组件级兜底码）——页面码体系够不着，需组件级映射另议 |

**最有价值的单点发现（T5 订正，原结论作废）**：初版报告称「对公客户评级申请 ×6 补一个 marker 即可接入」——**这是错的（G 判决 D8）**。那 6 条（入口页 `ZJJK00070599`）**早已被映射**：`rating` 卡的 `hash_markers` 含 `rtgMgt/cpctRtg/cpctRtgAplyMgtPg`，页面 `res_path=/rtgMgt/cpctRtg/cpctRtgAplyMgtPg`，ROUTE 链 6/6 命中，M4 的 266 条未映射里**没有评级族**。评级向导链真实存在且已被覆盖体系看见——该建议已删除，不会误导下一条线去补一个不需要补的码。**真实 Top 缺口**：`智能控制执行日志列表 ZJJK00171540PDCP ×3`、`查询交易信息管理页 ZJJK00069541 ×2`、AILZ 组件码 18 条（各 ×1，见下表）。

## 5. M6 陈旧卡（38 张带失效码）

样例（完整清单在引擎输出 `metrics.m6.staleCards`，每条含具体失效 marker）：
`archive-stock-in`（ZJJK00099979/FS00003418 失效）· `asset-preserve-ops-counter-entrust`（5 码中 5 全失效）· `customer-group-cluster`（9 码中 8 失效）· `customer-group-general-group`（7 码中 6 失效）…

**已与生产库逐码核对**（抽查：3 个失效码 COUNT=0、1 个新鲜码 COUNT=1）。38/84 张卡（45%）至少带 1 个已从系统树消失的页面码——**近域 FPR 与召回漂移的一个结构性来源**（陈旧码参与召回 haystack）。

## 6. 结论（覆盖边界 + 下一步 + 投入判断；T5 修订版）

1. **KB 的实际覆盖边界**：84 张卡只解释了 20.6% 的真实录制（M2）；27 张卡承载了全部命中（M3 0.321）；约 80% 的录制流量发生在**卡库没有准确页面码**的页面上。**KB 目前是「少数高频交易的深知识」，不是「全行交易的广覆盖」**。
2. **下一步该补哪些卡**（按真实频次，T5 订正后——原「补 rating 码」条目作废，评级族已被 ROUTE 链覆盖）：
   ① **给 `smart-ctrl-log-query` 卡补 `ZJJK00171540PDCP` marker**（智能控制执行日志 ×3，dead 卡 + 页面码现成）——最便宜的真实缺口；
   ② **查询交易信息管理页（×2）与对私用信管理页（×2）无卡**——真实业务有、KB 无，候选建卡；
   ③ AILZ 组件码录制（18 条）需要另外的接入路径（组件级映射），页面码体系够不着。
3. **卡↔实跑一致性（M5 v2，样本面尚小）**：`page_level_key` 只在产品管理族录制里落了值（28 条轨迹/9 个去重路由），该族映射轨迹的页面序列与 primary 卡路由 markers **完全吻合（v2：1.000/卡外 0，n=18）**——这是「路由面卡片描述与实跑一致」的正向证据，但只覆盖产品管理一个族，**不构成全局结论**；旧 M5 的「系统性脱节 0.835 卡外」是 label 词表重合伪影，已作废。**「轨迹反哺卡节点」方向要重新立项论证**：先扩大 `page_level_key` 落值面（录制端结构键铺开）再量化，当前证据不足。
4. **值不值得继续投**：覆盖 20%+利用率 32% 本身不是否定结论——hit 的 27 张卡正是 recall 评测里 B 层 0.400 那批的供给面。**KB 的投资逻辑应该从「铺广度」转向「把 27 张活的做准 + 按真实频次补缺口」**，而不是先扩卡数。门禁（M1/M2/M3 floor）已固化（**M5 已按 G 判决 D4 移出 floor**——label 版 M5 会奖励「改卡节点页名去凑 region 标签」的无意义动作；v2 informational 运行，等样本面扩大再议门槛），后续任何卡增补/码修复都在三条地板上可度量。

## 7. 复核指引（reviewer）

- 脱敏：抽 10 条 fixture 轨迹回库比对（白名单字段级一致；`task`/`name`/业务 query 值不入库——`grep '"task"' fixture` = 0）；**T5 已复核**：fixture v1.1 中 `visitedRegions[].key` 28 轨迹/110 region 非空，库里 314 步 `page_level_key` 原值 314/314 reduce 后落入 fixture key 集合（`host#/route`，query 已剥，无 `?`）；
- 独立复算：M1/M2/M3/M6 从 fixture + `data/kb/flows` 可纯离线重算；
- 证伪：`KB_COVERAGE_FIXTURE`（塞 `task` 字段 → 必红）/ `KB_COVERAGE_BASELINE`（抬 0.2 → 必红），两次输出已在 T2 commit message（G 复核已亲手复跑两侧证伪）；
- 边界：`src/**` 零改动、只 SELECT、评测集/阈值/verify-all/data/kb/req 零改动。

## 8. T5 迭代台账（G 判决 `38e0ef7d` 逐项处置）

| 项 | 处置 | commit |
|---|---|---|
| D1（根因·必改） | 结构键免 40 字守卫；`redactPageKey()` 只留 `host#/route`（剥 scheme/page: 前缀、query、dialog/anchor 后缀）；重冻 fixture **v1.1**（key 28 轨迹/110 region 非空；回库 314/314 原值 reduce 可追溯）；门禁 +D1 恢复 pin（≥20 轨迹带 key + key 无 `?`） | `996163e0` |
| D2（必改） | M5 重建：visited 页面 key ↔ primary 卡 ROUTE-chain markers（同类页面身份比较）；orderAgreement 废除（LCS over label 词表=饱和伪影），换 `entryOnCardRate`；上限分析随引擎输出（`m5.ceiling`）。v2=n18/1.000/1.000/0（饱和=9 个去重路由的小样本面事实，非 matcher 伪影） | `93c848a5` |
| D3（必改） | primaryCard 改链优先级（ZJJK>FS>ROUTE）+字母序 tiebreak；`attribution.primaryCardMisaligned=24` 留档（与复核数一致）；头注释对齐实现 | `93c848a5` |
| D4（门禁） | M5 两项移出 floor（engine `--baseline` FLOORS + gate FLOORS 同步；门禁打 INFO 行）；基线 v1.1 `floorPolicy.removedReason` 记录缘由 | `996163e0`+`93c848a5` |
| D5（轻） | `createdDate` → `toISOString().slice(0,10)`（有年份、时区稳定；`Wed Jul 22` → `2026-07-22`） | `996163e0` |
| D6（观察） | ROUTE 链精度区间已标注（§1 链分布段：5 片段 ≥10 页，泛命中只作模块级归因） | 本 commit |
| D8（事实错误·必改） | §4 头条订正：评级族 6 条 ROUTE 链 6/6 已映射（`rating` 卡 `rtgMgt/cpctRtg/cpctRtgAplyMgtPg` ↔ `res_path=/rtgMgt/cpctRtg/…`），「补 rating 码」建议删除；真实缺口=智能控制执行日志 ×3（补 1 marker）/查询交易信息 ×2/对私用信 ×2/AILZ ×18 | 本 commit |

**给复核者的三验入口**（对应 reviewer 留言）：① D1 恢复证据=`node scripts/characterization/characterize-kb-coverage.mjs` 第 4 个 pin（`28 trajectories`，DB 真值 28）+ 回库 314/314；② 新 M5 上限分析=引擎输出 `metrics.m5.ceiling`（=1.000，与 nodeCoverage 同值——小样本面事实，报告 §1.1 注）；③ D8 订正=本报告 §4。
