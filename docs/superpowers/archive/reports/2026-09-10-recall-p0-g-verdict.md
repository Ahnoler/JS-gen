# KB 召回 P0 三杠杆 — G1/G2/G3 结论（reviewer）

> 日期：2026-09-10 · 审查者：DSH reviewer
> 被审区间：**`1e047cc6..d8146da9`**（6 笔：开工 + T0 + T1a + T2 + T3 + T4；T1b **无提交**）
> 规格/计划：[`specs/2026-09-10-recall-p0-three-levers-design.md`](../specs/2026-09-10-recall-p0-three-levers-design.md) · [`plans/2026-09-10-recall-p0-three-levers.md`](../plans/2026-09-10-recall-p0-three-levers.md)
> **总判定：DONE_WITH_CONCERNS** —— T0/T1a/T2 **PASS**；T1b **FAIL 且已正确回退**；**T3 判 FAIL（未过 A3 硬约束 + 未接线生产路径）**

## 1. 门禁逐项

| Gate | 结果 |
|---|---|
| **G1 数据资产** | 血缘：reviewer **独立重建 name→module 映射**后全量比对 → **84/84 一致**，无假映射/假未映射，declared mapped 72 / unmapped 12 / ambiguous 1 与实测完全吻合 ✓。词表：**verify 集泄漏 = 0**（16 条全部 source∈build）✓ |
| **G2 纪律** | `verify-all.sh` / `kb-recall-eval.v1.json` / `characterize-kb-recall-eval.mjs` **均未被本线改动**（各自最后提交属前序线）✓；划分文件 `kb-recall-failures.v1.json` **只被 T0 `06dbe12d` 动过**、此后未改 ✓；零新依赖 ✓；lint 新增 warning = 0 ✓；T1b 确实**无代码提交**（单项回退的正确形态）✓ |
| **G3 算法与度量** | reviewer **独立复算**（自写探针，非采信 runner 输出）：syn-off **0.740/0.847/0.784/0.798**、syn-on **0.790/0.917/0.843/0.860**；分层 A 1.00 / B 0.233→0.400 / C 0.867 / D 0.333→**0.933**；拒答 0.633 不变 —— **与报告数字逐位一致** ✓ |

## 2. 阻断项

### 2.1 【阻断】T3 未接线生产路径 —— 0.790 是**离线数字**，生产实为 0.740

`grep synonyms` 全仓结果：`src/` 内只有 `flow-card-recall.js` **自己的可选参数**；传该参数的只有 `scripts/kb/recall-eval.mjs`（`--synonyms`）与 characterization pin。
`git log 1e047cc6~1..d8146da9 -- propose.js commit.js routes/v2/kb.js` → **全空**，本线零改动。
⇒ 生产路径 `matchFlowForPropose → matchFlowForAtom` **不传 synonyms**，实际行为 = **T2 链态（Acc@1 0.740）**。

报告的「结果总览」是 `base → +T2 → +T3` 链态表，**数字未失实**；但**未披露**「+T3 一列需显式传 synonyms 才成立」，且 Task 表把 T3 记为「**落地**」——读者会误认为 0.790 已生效。**这是本次交付最关键的信息缺口。**

### 2.2 【阻断】T3 未过 A3 硬约束：verify 集独立增量 = **0**

A3 原文：「T3 **verify 集必须单独上行**（只在 build 上行 = 判过拟合）」。reviewer 隔离度量（synonyms on/off 对同一份 T2 链态）：

| 子集 | syn-off | syn-on | 翻转条目 |
|---|---|---|---|
| build（18） | 0.278 | **0.556** | B-001 / B-009 / B-013 / B-015 / B-023（5 条） |
| verify（17） | 0.235 | **0.235** | **无（翻转 0、丢失 0）** |

⇒ 词表**只对它自己反推来源的那一半有效**，对留出的一半零泛化 —— 正是 A3 设计要拦下的过拟合特征。报告「verify 0→4/17 上行」是相对 **T2 之前**的基线统计的，那 4 条实为 T2 分词之功（reviewer 实测确认）。
按 **A4「任一项不达标 → 该杠杆单独回退」**：**T3 应回退至 `01572239` 链态**（T2 保留）。

## 3. reviewer 自身更正（我欠这一次）

spec §3.3 把 11 条失败归为「跨模块误召回 = 作用域可救」——**该分类部分错误**。用单卡语料法实测 gold 卡可见性：

- **9 条未转正靶子中 8 条 gold 对打分器完全不可见**（B-006/013/014/022/024/027/028/029 单卡语料仍返回 `null`）；
- 仅 B-010 / B-005 / B-012 可见。

⇒ 乘法系数无法拯救 0 分卡，**T1b 的 FAIL 判定正确，实施方的根因诊断优于我的归类**。正确归类应为：这 8 条属**词表鸿沟**、2 条属真排序问题。§3.3 的分类表应在下版 spec 更正。

## 4. 需 Lead 知悉的其他事项

| # | 事项 | reviewer 意见 |
|---|---|---|
| 1 | **契约金样例被改**：`在 ZJJK00066153 页面新增客户` 的 `expectNodeId` check_drawer → list（`01572239`） | **实质可接受**：码 token 激活后命中码所在的 `list` 节点，语义上 `list` 才是查询所指页面起点；旧值是"码 token 大小写失配死亡"时的 bigram 巧合；py 侧只断言 flowRef，跨语言契约不受损；且在文件内写了 note。**但属对契约夹具的行为性改动，建议 Lead 在 todo 补一句追认**（先例：上一线 seed 字段同样处理） |
| 2 | **T2 超出计划字面的评分改动**：`bestNodeIdFor` 的比率分母由 `cardScore` 改为 `nodeEligibleScore`（无节点可表达 token 时收缩，全可表达时=旧行为） | **原理正当**（节点证据应相对"节点可表达"的信号计），但**影响 node 选择语义 → 会经 `kb_flow_node_id` 影响录制前言的节点提示**。需在报告显式记录并让 Lead 知悉；建议补一条 characterization pin 钉住"码只活在卡级字段"的场景 |
| 3 | `N-002` FP 未回 null | 实测确认：该 FP 前后分数**逐位不变**，T2 未引入；回 null 需收紧覆盖率地板 = 改口径 = 须 Lead 批准。**登记移交合理** |
| 4 | `rankFlowCards` 仍带 `moduleKey` 参数 | 作用域**确已回退干净**；该参数现仅用于词表 scope 门控（符合 spec §6.3），非残留 ✓ |

## 5. 结论与放行条件

| 项 | 判定 |
|---|---|
| T0 失败清单冻结 + 划分 | **PASS** |
| T1a 血缘资产 + promote 补写 | **PASS**（reviewer 全量一致性核验 84/84） |
| T1b 作用域 | **FAIL → 已正确回退**（无提交、无残留；根因量化可信） |
| T2 分词 | **PASS**（生产已生效：D 0.333→0.933、Acc@1 0.650→0.740、A/C 不动、拒答不变、零新依赖） |
| T3 词表 | **FAIL**（A3 verify 零增量；且未接线） |
| T4 收尾 | **PASS**（报告透明、证据齐、lint 归因到位） |

**放行条件（Lead 二选一）**：
- **(A) 按 A4 回退 T3** → 交付 = T0/T1a/T2，**生产 Acc@1 0.740**；词表资产可作为"待验证素材"保留但不得计入成果；
- **(B) 保留 T3 但补两件事** → ① 接线 `propose.js`（加载 `data/kb/synonyms.json` 并传 `synonyms`+ `moduleKey`，A5 已放行）；② 词表**不据失败反推**，改以领域语料/需求文档重建，并在 verify 集复测出**独立正增量**后再生效。

**无论 A/B**：报告的「终态」口径必须改成「**生产 = T2 链态 0.740；0.790 为 offline runner 链态**」，避免成果被高估。

## 6. Lead 裁定与收尾（2026-09-10）

Lead 采纳 reviewer 的**第三条路**——既不是原 (A) 全删机制，也不是原 (B) 直接接线：

| # | 裁定 | 理由 |
|---|---|---|
| 1 | **机制保留、词表停用、不接线** | 不 `git revert 2ae8e4e1`：扩展机制 opt-in、未传参时字节不变（已实测），删除是无谓返工；但在词表被证明泛化前，**不接线 propose、不计入成果** |
| 2 | **口径更正（强制）** | 报告「终态」须改为「**生产 = T2 链态 Acc@1 0.740**；0.790 为 offline runner 链态（需显式传 synonyms）」 |
| 3 | **词表资产标注未验证** | `data/kb/synonyms.json` 增 `"status": "unvalidated"`（附加字段），报告与 todo 同步注明 |
| 4 | **T3 重评前置** | 先做评测集 **v2** 扩版（≥100 条独立新查询，另立项）→ 在 v2 上建表并验证**独立正增量** → 通过后才接线 propose 并计入成果 |
| 5 | **两条追认 + 一条补丁** | ① 契约金样例 `expectNodeId`（check_drawer→list）Lead 追认；② T2 的 `bestNodeIdFor` 分母改动补一条 characterization pin，钉住「码只活在卡级字段」场景 |
| 6 | **线状态** | T0/T1a/T2 = **交付**；T1b = **FAIL 已回退**；T3 = **停用待 v2 重评**（不计成果）。收尾小任务 = 本表 2/3/5② |

## 7. 收尾复核（reviewer 实测，2026-09-10）

4 项收尾由实施方完成（`62fca4c5` 开工 / `b7bdb8e8` / `eeca9fa6`），reviewer 逐项实测：

| 项 | 复核结果 |
|---|---|
| ① 报告口径更正 | 报告顶部已加**口径更正块**，「生产实际生效 = T2 链态 0.740」；Task 表 T3 改为「FAIL → 停用待评测集 v2 重评」；T3 章节标题、遗留、复现命令同步 ✓ |
| ② 词表标注 | `data/kb/synonyms.json` 仅 **+2 行**（`status: "unvalidated"` + `statusNote`），**entries 零改动** ✓ |
| ③ 分母 pin | `characterize-flow-card-recall.mjs` +25 行；**reviewer 自己动手证伪**：还原旧分母 `cardScore` → **exit 1 / pin 红**（`✗ matchFlowForAtom scores customer_onboarding + convert node`）→ `git checkout` 还原 → **23 passed / exit 0 / 工作区干净** ✓ |
| ④ 台账 | agent-log 收工回链 `62fca4c5`；todo 线标「✅ 线关闭——G1/G2/G3 已出，T3 被 Lead 裁停用」并带生产口径 ✓ |
| 纪律 | 本收尾区间**未动** `kb-recall-eval.v1.json` / `characterize-kb-recall-eval.mjs` / `verify-all.sh` / `propose.js`（`git log` 空）；未 revert `2ae8e4e1`、未删 `synonyms.json` ✓ |

**HEAD 终态（reviewer 独立复算）**：生产 Acc@1 **0.740** / Recall@5 0.847 / MRR@5 0.784 / nDCG@5 0.798 / 拒答 0.633 / 噪声 0.740；分层 A **1.00** · B 0.233 · C 0.867 · D **0.933**；`--baseline` **exit 0**；`characterize-flow-card-recall` **23 passed**；py 跨语言契约 **ok**。

**结论：本线 CLOSED。** 成果 = **T1a 血缘资产 + T2 分词**（生产 Acc@1 0.650→0.740、D 层 0.333→0.933、A 层零退、拒答零变、零新依赖）；T1b FAIL 已回退；T3 机制保留但停用、不计成果、待评测集 v2 重评。

**移交 Lead 的两项**：① `N-002` 存量 FP 处置（回 null 需收紧覆盖率地板 = 改口径，须批准）；② **评测集 v2 扩版立项**（≥100 条独立新查询，是 T3 重评的前置）。
