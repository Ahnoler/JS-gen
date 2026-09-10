# KB 召回评测常态化 — 实施报告（v1 基线）

- **时刻**：2026-09-09 22:44 – 2026-09-10 00:30（+08:00）
- **执行者**：ZCode（主标+实施）；盲态子智能体（临时二次标注）；G1/G2/reviewer 结论栏待 DSH reviewer / Lead 回填
- **环境**：node v24.14.1 / git `55a558ab..1e487ca4`（uara_V1.2）/ win32 10.0.26200 / i7-14650HX×24（`tmp/kb-eval/env.txt`）
- **规格**：[`specs/2026-09-09-kb-recall-eval-design.md`](../specs/2026-09-09-kb-recall-eval-design.md)（§13 D1–D12）/ [`plans/2026-09-09-kb-recall-eval.md`](../plans/2026-09-09-kb-recall-eval.md) / handoff §1–§8

## T0 基线复现（与 spec 附录基线逐项对照）

| 指标 | spec 基线（留一法，20 hold-out） | 复现 | 判定 |
|---|---|---|---|
| Acc@1 | 0.90 | 0.90 | **MATCH** |
| Recall@5 | 1.000 | 1.000 | **MATCH** |
| MRR@5 | 0.942 | 0.942 | **MATCH** |
| nDCG@5 | 0.957 | 0.957 | **MATCH** |
| 拒答率 | 0.90 | 0.90 | **MATCH** |
| 噪声 Acc@1 | 0.90 | 0.90 | **MATCH** |
| 热 p50/p95 | 0.08 / 0.14 ms | 0.082 / 0.136 ms | 吻合 |
| 冷 p50/p95 | 4.18 / 8.77 ms | 1.94 / 6.10 ms | 同量级偏快（机器态差异；排序指标 6/6 精确一致证语料未变） |

证据：`tmp/kb-eval/baseline.json`（探针 `tmp/kb-eval/baseline-probe.mjs`，语料 84 卡）。

## T1 评测集 v1（冻结）

- **130 条 = A40 / B30 / C15 / D15 / N30**；正样本 100 覆盖 **62 张不同卡**（≥50 达标）；单卡最多 3 条（≤4）；query 零重复；负样本 30 条全带 `whyNegative`。
- 种子：reviewer 20 条 hold-out 原样收编（A15/B5）+ 跨域负样本 10 条（含已知 FP 靶子 `计算 2 加 3 等于多少`→`collection_scorecard`，保留为回归靶子）。
- 标注纪律：全程只读语料词表（`tmp/kb-eval/corpus-inventory.json`），**未运行匹配器**；近域负样本经语料关键词缺席 grep 验证；`excluded[]` 4 条（含「打印企业征信报告」——「征信」在 customer_360/rating 词表中存在，宁少勿脏剔除）。
- 复核：盲态子智能体 15 条敏感条目独立标注 **15/15 主判一致（分歧率 0%）**，多 gold 判断逐条吻合（`tmp/kb-eval/T1-blind-review.txt`）。**G1（reviewer 正式抽检 15 条）仍待执行**。
- commit `0e8a9f64`；spec 附录 B 已回填。

## T2 ranked 输出

- 新增 `rankFlowCards({title,taskDraft,cards,k=5}) → {flowRef,nodeId,score,candidates[]}`；`matchFlowForAtom` 委托 k=1，返回形状与语义不变。
- **不变量实证**：+2 pin（top-1 与 matchFlowForAtom 的 flowRef/nodeId/score 完全相等；no-hit 空 candidates）→ 17 passed；重构后基线探针 **6/6 仍 MATCH**；24 条跨语言金样例绿。
- commit `5acbbbe4`。

## T3 v1 指标（真实排序，`tmp/kb-eval/v1-run1.json`）

**口径切换说明**：T2 后排序改用 `rankFlowCards` 真实排序（此前留一法近似）。对账实验：reviewer 20 条 hold-out 用两种口径各跑一遍，**四项排序指标 Δ 全 0**——本语料上留一法≈真实排序，两套数字可直接对比。

| 指标 | v1 实测（100 正/30 负） | Wilson 95% CI |
|---|---|---|
| **Acc@1** | **0.650** | [0.553, 0.736] |
| Recall@5 | 0.757 | — |
| MRR@5 | 0.694 | — |
| nDCG@5 | 0.708 | — |
| 拒答率 | 0.633（19/30） | [0.455, 0.781] |
| 噪声 Acc@1 | 0.650（Δ 0.00） | — |
| 热 p95 | 0.27 ms | 预算 50ms |
| 冷 p95 | 3.6 ms | 预算 200ms |

**分层 Acc@1：A 40/40 = 1.00 ｜ C 13/15 = 0.87 ｜ D 5/15 = 0.33 ｜ B 7/30 = 0.23。**

**与上一轮 hold-out 的关系（重要）**：hold-out 基线 0.90 建立在「词面为主」的 20 条上；v1 的独立标注把改写层（B）与短码层（D）按配额纳入后，现行匹配器的真实水位是 **0.65**。这不是回归（算法未动，hold-out 复测仍 0.90），而是**旧 24 条金样例（16/24 以实现输出为期望）无法暴露的存量缺口第一次被独立评测集量化**。spec §10「0.85–0.95 量级」预期对 v1 难度分布不成立，如实报告，不改题、不放宽（handoff §8）。

### 失败清单（35/100，按根因归类）

**B 层 23 条 — 同义词鸿沟（查询无卡词原串，bigram 无法跨词面）**：
- 拒绝（rank=-，覆盖率地板拦下）：B-006 担保物→押品登记、B-009 基本资料→客户信息查询、B-010 信用等级评定→评级、B-014 打款→放款、B-015 借款合同→合同签订、B-021 估算值多少钱→押品估值、B-022 外包→委外清收、B-023 打官司起诉→司法诉讼、B-024 按约定付给交易对手→受托支付、B-025 红字冲回→账务异常、B-027 产业链打包→集群客户、B-028 总户头→总集团、B-029 股东/实际控制人关系→关联关系、B-030 加新品让它可用→产品库
- 错卡（rank=2–4，同域 bigram 撞击）：B-001 止付恢复→误中规则一键失效（limit 排 3）、B-005 机构合并→误中委外清收、B-008 全景→credit_application（customer_360 排 4）、B-011 评级结果过程→rating（rating-query-view 排 2）、B-012 对公授信业务→credit_usage、B-013 借钱用款→总集团、B-016 找人担保→customer_360、B-019 上门要账→collection_scorecard、B-020 法院占了→guaranty_contract、B-012 同类。

**D 层 10 条 — ASCII 短码/别名全灭（分词器只产 FS\d+/ZJJK\d+ 码与 CJK bigram，camelCase 别名不进词表）**：D-001 W0、D-002 lmtRgstAndOcp、D-003 lmtRgst、D-004 doOcpRevoke、D-005 cstInfQuery、D-006 enqrPdInf、D-007 mntPdStg、D-008 cpctMgtPg、D-009 FS00006502（*）、D-010 360视图（rank 2，被 customer_onboarding 抢走）。（*）FS00006502 为 FS 码形态但只在 flow 名文本内、不在 aliases/keywords，语义词典未收录。

**C 层 2 条**：C-001 登录场景→customer_onboarding 抢中（session_login 无 keywords，登录一词信号弱）；C-008 权证出入库→collateral-func-warning 抢中（custody 排 2）。

**负样本 FP 11/30（拒答率 0.633 的成因）**：已知靶子 N-002 计算2加3→collection_scorecard；跨域新发现 N-012 太阳系**最大**的行星→customer-group-cluster（撞「最大股东」）、N-013 量子力学基本概念→loan（撞「基本/贷款」？低 maxPossible 下覆盖率地板过松）；近域全部误中：N-021 展期→loan、N-022 罚息复利→collection_scorecard、N-023 请假审批→approval_todo、N-024 反洗钱→limit-ctrl-api-ocp-revoke-loop、N-026 报销→product_query、N-028 ATM 吞卡→approval_chain、N-029 APP 下载→guaranty_contract（撞「下载合同」）、N-030 营业网点几点开门→session_login。

**噪声鲁棒性**：Δ 0.00——追加无关子句对命中无扰动（bigram 词面匹配对噪声子句天然免疫）。

## T4 阈值写入（G2 批准后落地，2026-09-10）

**G1/G2 结论**（[`reports/2026-09-09-kb-recall-eval-g1-g2.md`](./2026-09-09-kb-recall-eval-g1-g2.md)）：G1 **PASS**（reviewer 独立抽检 15 条 = 新标 11/11 一致，0 分歧；反作弊六项核对通过）；G2 **PASS**（阈值无条件批准；reviewer 双向复现 exit 0/1）。另：reviewer 撤回其对 runner `execSync` 的阻断结论（EPERM 系其审查沙箱所致），未为此改动代码。

写入位置：`scripts/characterization/characterize-kb-recall-eval.mjs`（commit `71c24fa7`），4 断言：
1. 评测集结构（130/30 负/62 卡/无重复/无 stale gold）；
2. **lockstep pin**：APPROVED+DEFAULT_MARGINS 必须重构出 G2 基线 `{0.65,0.757,0.694,0.708,0.633,0.65}`——门禁与 runner `--baseline` 模式不能静默漂移（同时是防篡改绊线）；
3. 六项批准 floor（compareWithBaseline，失败打印 perQuery 退化明细）；
4. 延迟预算（热 p95≤50ms / 冷 p95≤200ms）。

单一指标引擎：门禁复用 runner 的 `runRecallEval`/`compareWithBaseline`，无第二套指标实现。注册：`verify-all.sh` 追加一行（commit `8ae492ed`，独立 commit）。

**门禁自证**（`tmp/kb-eval/T4-selfproof.txt`）：提交态绿（exit 0）→ 阈值 +0.2 且 lockstep pin 同步位移 → 六项 floor 全 FAIL 红（exit 1）→ 还原绿（exit 0）。floor 断言可证伪，防恒真闭环。

**reviewer 三条非阻塞建议落地**（commit `56b52af3`）：
1. 多 gold 口径入文档：Recall@5/nDCG@5 用**分摊口径**（hits/|gold|，DCG/IDCG），写入 `ndcgAtK` JSDoc 与 runner 文件头；reviewer 二值口径（0.760/0.711）与本口径（0.757/0.708）差异已显式记录，杜绝基线静默漂移 0.003。
2. seed 标记统一：30 条种子加 `seed: true` 字段、移除 note/whyNegative 前缀；行级手术编辑（冻结文件审计 diff 最小化），changeLog 记录批准来源（reviewer G1/G2 §五.2），query/gold/条目数零改动。
3. 分层可见性：`metrics.byTier` 随每次运行输出；renderTable 消费。**A 层独立下限未加**——G2 批准的恰是六项，加第七项须单独走批准（已向 Lead 标记，不捆绑落地）。

## T5 PY 一致性

`py agreement: 62/100 (62%)`——分歧集中在 B 层（PY 关键词精确匹配对改写大量返回 None）与 D 层短码，符合 D6/D3「py 算法未升级、不入门禁」预期；分歧清单逐条登记于脚本输出（`tmp/kb-eval/T5.txt`）。24 条跨语言契约仍绿（5 条已登记分歧）。

## 结论

**T0–T7 全部完成**：T0–T3、T5、T6 首轮交付（`55a558ab`→`0e8a9f64`→`5acbbbe4`→`7543157e`→`1e487ca4`→`1be0ac8b`→`f67d89f2`）；**T4 于 G1/G2 双 PASS 后写入**（`62aa956f`→`71c24fa7`→`8ae492ed`→`56b52af3`）。G3 终局结论待 reviewer 按 plan Reviewer Checklist 出具。

## 遗留与通报

1. ~~并行线冲突通报~~（已解决：flow-card-guided-propose 线已收工提交，未触碰本线 `flow-card-recall.js`；`rankFlowCards` 完好）。
2. ~~verify-all 注册行~~（已落地：`8ae492ed`）。
3. 算法缺口（另立项）：同义词桥/受控词表（B 层 0.23）、ASCII 别名分词（D 层 0.33）、低 maxPossible 查询的覆盖率地板收紧（FP 11/30）。评测集与门禁已就位，改进即测得。
4. 评测集 v2 候选：spec §12 R3（CI 宽，Acc@1 CI [0.55,0.74]）→ 扩到 300+ 条时再议。
5. A 层独立下限（reviewer 建议 3 的后半）：G2 批准六项为限，加第七项须 Lead 单独批准。

## 附录：复现命令

```bash
node scripts/kb/recall-eval.mjs                     # v1 指标表 + 逐条失败明细
node scripts/kb/recall-eval.mjs --json              # 机器可读（tmp/kb-eval/v1-run1.json 同构）
node scripts/kb/recall-eval.mjs --baseline tmp/kb-eval/baseline-v1.json   # 门禁 diff（超阈值 exit 1）
node tmp/kb-eval/baseline-probe.mjs                # T0 hold-out 基线复现
node scripts/characterization/characterize-flow-card-recall.mjs           # 17 passed
./python/python.exe scripts/characterization/characterize-kb-recall.py    # 24 契约 + py agreement
```

证据目录：`tmp/kb-eval/`（baseline.json / env.txt / T1-struct.txt / T1-blind-review.txt / T2.txt / T3.txt / T5.txt / v1-run1.json / baseline-v1.json / corpus-inventory.json）。
