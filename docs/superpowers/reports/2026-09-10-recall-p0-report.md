# KB 召回 P0 三杠杆 — 实施报告（血缘作用域 / camelCase 分词 / 受控词表）

- **时刻**：2026-09-10 18:32 – 21:10（+08:00）
- **执行者**：ZCode（主会话，按 spec 决策 A1–A5 实施）
- **规格**：[`specs/2026-09-10-recall-p0-three-levers-design.md`](../specs/2026-09-10-recall-p0-three-levers-design.md)（§11 已裁定）/ [`plans/2026-09-10-recall-p0-three-levers.md`](../plans/2026-09-10-recall-p0-three-levers.md)
- **环境**：node v24.14.1 / win32 / uara_V1.2（T0 基线复现 @ `06dbe12d`）
- **冻结基线（v1，逐位复现 6/6）**：Acc@1 **0.650** · Recall@5 **0.757** · MRR@5 **0.694** · nDCG@5 **0.708** · 拒答 **0.633** · 噪声 **0.650**；分层 **A 1.00 / B 0.233 / C 0.867 / D 0.333**

## 结果总览（六项 + 分层，base → T2 → T3 链态）

| 指标 | 基线 | +T2 分词 | +T3 词表 | Δ（终态 vs 基线） |
|---|---|---|---|---|
| Acc@1 | 0.650 | 0.740 | **0.790** | **+0.140** |
| Recall@5 | 0.757 | 0.847 | **0.917** | **+0.160** |
| MRR@5 | 0.694 | 0.784 | **0.843** | **+0.149** |
| nDCG@5 | 0.708 | 0.798 | **0.860** | **+0.152** |
| 拒答率 | 0.633 | 0.633 | **0.633** | 0.000（FP 集逐条同基线，零新增） |
| 噪声 Acc@1 | 0.650 | 0.740 | **0.790** | **+0.140** |
| 分层 A | 1.00 | 1.00 | **1.00** | 保持（零容错 ✓） |
| 分层 B | 0.233 | 0.233 | **0.400** | +0.167 |
| 分层 C | 0.867 | 0.867 | **0.867** | 不动 ✓ |
| 分层 D | 0.333 | **0.933** | 0.933 | **+0.600** |

三杠杆结局：**T2 分词 PASS（落地）、T3 词表 PASS（落地）、T1b 作用域 FAIL（整体回退）**。

## Task 交付清单

| Task | commit | 判定 | 证据 |
|---|---|---|---|
| T0 失败清单冻结 + build/verify 划分 | `06dbe12d` | PASS | `tmp/kb-p0/T0-failures.txt` + `kb-recall-failures.v1.json`（B 12/11 · D 5/5 · C 1/1，层内 id 数序交替机械规则） |
| T1a 血缘资产 + promote 补写 moduleKey | `b0e0e534` | PASS | `tmp/kb-p0/T1-lineage.txt`（mapped 72/84=85.7% ≥84%；unmapped 12 + ambiguous 1 显式；幂等双跑；`--baseline` exit 0） |
| T1b 作用域三态 | **回退（无代码提交）** | **FAIL** | `tmp/kb-p0/T1b-verdict.txt` + `T1b-after.json`（1.15/.92）+ `T1b-exp-13085.json`（1.30/.85） |
| T2 camelCase/ASCII 分词 | `01572239` | PASS | `tmp/kb-p0/T2-verdict.txt` + `T2-after.json` |
| T3 受控词表 | `2ae8e4e1` | PASS（附归因披露） | `tmp/kb-p0/T3-verdict.txt` + `T3-after.json` + `T3-build-set.txt` |
| T4 收尾 | 本 commit | — | `tmp/kb-p0/T4-verify-perentry.txt` + `gate.txt` |

## T1b 作用域杠杆：FAIL 根因（为何回退）

A2 保守系数 1.15/0.92 → 11 条跨模块靶子仅 **2/11 转正**（B-005 两家机构合并、B-012 发起对公授信）< 6；按 A2 升至授权上限 1.30/0.85 → **仍 2/11**（聚合指标继续上行 rec5 0.777/mrr 0.712/ndcg 0.727，但靶子数不变）。原始分差量化：9 条未转正靶子中 **7 条 gold 卡原始分=0.00**（B-006/010/022/024/027/028/029——gold 对打分器完全不可见，乘法系数无从拯救，属词面/词表鸿沟即 T3 领域）；仅 B-013（ratio 0.401）/B-014（0.608）是真排序问题，但翻转需 penalty/boost < 0.608，超出授权区间（0.92/1.15=0.800；0.85/1.30=0.654）。三态实现与 pin（19 passed）按 A4 单项回退（`git checkout b0e0e534`），验证 17 pins 绿 + `--baseline` exit 0 + 我方文件零残留。**A5 放行的 `propose.js` 最终未触碰**——作用域回退后 moduleKey 注入失去消费者；synonyms 的产品侧装配（scope 门控需要 moduleKey 时）另立任务。

正面遗产：三态 pin 可证伪性已验证（TDD 红→绿），血缘资产（T1a）保留为审计基础；scope 系数试验数据（两套系数的完整 perQuery）已存档供后续调参参考。

## T2 分词杠杆：D 层 0.333 → 0.933

- `tokenizeCodes()`：ASCII run → camelCase/字母数字边界拆分 + **整词保留** + 小写 + <2 字符丢弃；卡侧 `profileTokens` 与查询侧 `extractQueryTokens` **同源调用**（spec §6.2 契约）；IDF 公式/覆盖率地板/阈值/口径全部未动。
- 删除死权重：旧 FS/ZJJK token 大写化但对小写 haystack 判 `includes` → **永不命中**（D-009 根因之一）。
- `bestNodeIdFor` 比率分母改为「节点可表达 token 权重和」（全部可表达时=cardScore，行为不变）——修复码只活在卡级 `hash_markers` 时 NODE_SCORE_RATIO 被抬高误杀正确节点（存量 pin `对公客户转正并补齐任务页信息`→convert 复活）。
- **A.2 九条 null：9/9 全部转正**（≥6 达标）：W0→session_login、lmtRgstAndOcp、lmtRgst、doOcpRevoke、cstInfQuery、enqrPdInf、mntPdStg、cpctMgtPg、FS00006502。
- 金样例（跨语言契约）1 条 nodeId 期望手术更新：`在 ZJJK00066153 页面新增客户` expectNodeId `check_drawer`→`list`——旧值系码 token 大小写失配死亡时的 bigram 巧合；码 token 激活后命中码所在 `list` 节点=查询所指页面起点（py 侧只断言 flowRef，`characterize-kb-recall.py` ok，不受影响）。24/24 绿。
- **N-002 如实登记**：`计算 2 加 3 等于多少`→collection_scorecard 分数**逐位不变**（6.734591659972948）——它是基线存量 FP（「计算」bigram 撞「计算方式」），T2 未引入该命中（该 query 无 ASCII token）。回 null 需收紧覆盖率地板=改口径（红线禁止）或 query 特判（禁止）。**移交 Lead**。

## T3 词表杠杆：B 层 0.233 → 0.400（verify 上行 + 归因披露）

- `data/kb/synonyms.json`：**16 词条全部 source 可溯**（`失败反推 <build-id>`），expand 项尽量取 gold 卡词面原词。
- **D6 纪律执行**：建表唯一输入 = build 集 18 条（`T3-build-set.txt`）；verify 17 条建表期间未读取；任务书 A.1 清单中的 verify 侧条目（B-005/010/012/014/022/024/027/029）**未用于建词条**（防 G3 反作弊命中）。
- 实现：`SYNONYM_WEIGHT=0.5` 具名导出；`applySynonymExpansion` 注入 expand 项（经同源分词器，卡面语义词条走最长匹配）；已有 token 不覆盖（只加信号）；`scope` 有值且 ≠ moduleKey → 不注入；不传 `synonyms` = 字节级不变（pin 断言）。runner 加 `--synonyms` 模式（单指标引擎：复用 `runRecallEval`）。
- **build 集 18 条：0/18 → 10/18**（词表转正 5 条 B：B-001 止付→冻结/limit、B-009 基本资料→客户信息查询、B-013 借钱→用信/credit_usage、B-015 借款合同→对公合同签订、B-023 打官司→司法诉讼；另 5 条 D 为 T2 归因）。
- **verify 集 17 条：0/17 → 4/17 上行**（非「只在 build 上行」；逐条见下节）。
- FP：11 条与基线逐条相同——词表零新增误召回。
- **归因披露（如实报告）**：T3 词表对 verify 的独立增量 = 0（T3 vs T2 diff：build +5 全词表、verify +0）。verify 的 +4 全部归因 T2 分词。词条只据 build 反推，verify B 层改写模式未被覆盖，系 D6 纪律的预期结果而非过拟合证据。**若 reviewer/Lead 判定「词表自身 verify 增量>0」才达标，按 A4 词表单项回退**（回到 `01572239` 链态 = T2 态，B 层 0.233），不连坐。

### verify 集逐条结果（A1 硬约束）

| id | query | gold | 基线 top1 | T2 top1 | T3 top1 | 终态 |
|---|---|---|---|---|---|---|
| B-005 | 两家机构合并怎么登记 | system-mgmt-org-merge | asset-preserve-ops-outsourced-collection | 同左 | 同左 | MISS |
| B-008 | 看看某个客户都有哪些业务往来全景 | customer_360 | credit_application | 同左 | 同左 | MISS |
| B-010 | 给企业客户做信用等级评定 | rating | credit-retail-credit-config | 同左 | 同左 | MISS |
| B-012 | 发起一笔对公的授信业务 | credit_application | credit_usage | 同左 | 同左 | MISS |
| B-014 | 贷款批下来了安排打款给客户 | loan | loan-corp-syndicate-lead-apply | 同左 | 同左 | MISS |
| B-016 | 找个人给这笔贷款做担保 | guarantee_intro | customer_360 | 同左 | 同左 | MISS |
| B-020 | 抵押的房子被法院占了怎么办 | collateral_seizure | guaranty_contract | 同左 | 同左 | MISS |
| B-022 | 把催收的活儿外包给外面的公司 | asset-preserve-ops-outsourced-collection | customer-group-group | 同左 | 同左 | MISS |
| B-024 | 按合同约定直接把钱付给交易对手 | disburse-entrusted-payment | limit-ctrl-api-ocp-revoke-loop | 同左 | 同左 | MISS |
| B-027 | 一批产业链上的小企业打包管理 | customer-group-cluster | credit_usage | 同左 | 同左 | MISS |
| B-029 | 股东和实际控制人之间的关系要登记 | customer-common-cust-relation | customer-group-group | 同左 | 同左 | MISS |
| C-008 | 阶段8：押品权证先入库…出库 | collateral_custody | collateral-func-warning | 同左 | 同左 | MISS |
| D-002 | lmtRgstAndOcp | limit-ctrl-api-grant-use-one | null | **limit-ctrl-api-grant-use-one** | 同左 | **OK** |
| D-004 | doOcpRevoke | limit-ctrl-api-ocp-revoke-loop | null | **limit-ctrl-api-ocp-revoke-loop** | 同左 | **OK** |
| D-006 | enqrPdInf | product_query | null | **product_query** | 同左 | **OK** |
| D-008 | cpctMgtPg | customer_onboarding | null | **customer_onboarding** | 同左 | **OK** |
| D-010 | 360视图 | customer_360 | customer_onboarding | 同左 | 同左 | MISS |

## 未转正清单与原因（35 条失败终态仍 MISS 的 21 条）

- **B 层 18 条**：词表只据 build 反推（D6 纪律），verify 侧 11 条的改写词不在词条内；build 侧余 7 条为 gold raw=0 且非本轮词条可桥（如 B-006 担保物→押品已建词条但 gold 卡面仍无「担保物/押品」近邻信号、B-011 评级结果过程撞同域 rating、B-019 上门要账撞催收评分卡、B-021 估算抵押物撞 guaranty_contract、B-025 红字冲回撞 loan_account、B-028 总户头撞 product_element、B-030 加新品撞 product_query）。
- **C 层 2 条**：C-001 登录场景（session_login 词面弱）、C-008 权证出入库（custody 排 2）——节点级/场景级问题，词表杠杆覆盖不足。
- **D 层 1 条**：D-010 `360视图`（rank 2 被 customer_onboarding 抢走——「360」与 bigram 撞击，非 null 类）。
- 共性根因：同域近邻混淆（「同模块近邻混淆」类，spec §3.3 表末行）与 gold 卡词面稀疏，需节点级信号或 embedding（另立项）。

## 回退与否

- **T1b 作用域：已回退**（整体，A4 单项回退；回退后 17 pins 绿 + `--baseline` exit 0 复验）。
- T1a / T2 / T3：全部保留（各自 DoD 达标）。

## 门禁与 lint

- `node scripts/kb/recall-eval.mjs --synonyms --baseline tmp/kb-eval/baseline-v1.json` → **exit 0**，六项 OK（终态 0.790/0.917/0.843/0.860/0.633/0.790，全部高于 floor）。
- `node scripts/characterization/characterize-kb-recall-eval.mjs` → **4 passed**（评测集结构 / lockstep pin / 六项 floor / 延迟预算——floor 只升不降 ✓）。
- `node scripts/characterization/characterize-flow-card-recall.mjs` → **22 passed**（存量 17 + T2 2 条 + T3 3 条；scope 2 条随 T1b 回退移除）。
- `./python/python.exe scripts/characterization/characterize-kb-recall.py` → **ok**（24 条跨语言契约；py agreement 不受影响——py 侧不消费 synonyms/tokenizeCodes）。
- lint 归因：`flow-card-recall.js` warning 数 HEAD 态 16 = 工作区态 16，逐条同规则同函数仅行号平移（44→72→118…），**新增 warning = 0**；`recall-eval.mjs` / `promote_draft.mjs` / `build-flow-lineage.mjs` / `synonyms.json` 零 warning。
- `verify-all.sh` 未改（红线）；`kb-recall-eval.v1.json` 未改（冻结）；`data/kb/req/**` 只读；无新依赖。

## 遗留与移交

1. **N-002（计算2加3→collection_scorecard）**：基线存量 FP，本轮三杠杆均不触碰其成因（bigram 撞「计算方式」）。候选修法=覆盖率地板收紧（**改口径，须 Lead 批准**）或 embedding 兜底（另立项）。
2. **T1b 作用域杠杆的归类偏差**：35 条失败清单中 11 条「跨模块误召回」实际 7/11 是词面鸿沟（gold raw=0）——作用域系数不是正确的杠杆。建议下版评审时把该类改归词表/节点级；作用域思路保留（血缘资产已在），若未来同域卡密度上升可复评。
3. **T3 verify 归因**：词表对 verify 独立增量=0（披露见上）；是否达标由 reviewer/Lead 裁，不达标则词表单项回退。
4. **词表 v2**：评测集扩 v2 后按 D6 在新查询上复验；scope 门控字段已就位（产品侧装配 moduleKey 另立任务）。
5. **verify 侧 B 层 11 条 + C 层 2 条 + D-010**：需节点级信号/同域消歧/低地板查询处理，归「方向 4：切片」或 embedding 立项。

## 复现命令

```bash
node scripts/kb/recall-eval.mjs --synonyms                       # 终态指标表（0.790/0.917/0.843/0.860/0.633/0.790）
node scripts/kb/recall-eval.mjs --synonyms --baseline tmp/kb-eval/baseline-v1.json   # exit 0
node scripts/kb/recall-eval.mjs                                  # 无词表态（=T2 态 0.740/0.847/0.784/0.798/0.633/0.740）
node scripts/characterization/characterize-flow-card-recall.mjs  # 22 passed
node scripts/characterization/characterize-kb-recall-eval.mjs    # 4 passed
node scripts/kb/build-flow-lineage.mjs                           # 幂等重建血缘资产
./python/python.exe scripts/characterization/characterize-kb-recall.py  # py 契约 ok
```

证据目录：`tmp/kb-p0/`（baseline.json / T0-failures.txt / T1-lineage.txt / T1b-verdict.txt / T1b-after.json / T1b-exp-13085.json / T2-verdict.txt / T2-after.json / T3-verdict.txt / T3-after.json / T3-build-set.txt / T4-verify-perentry.txt / gate.txt）。
