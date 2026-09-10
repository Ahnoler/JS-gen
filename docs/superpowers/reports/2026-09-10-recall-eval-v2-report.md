# KB 召回评测集 v2 — 实施报告（扩版 + 独立标注 + 门禁切换 + T3 重评）

> 日期：2026-09-10 · 线：recall-eval-v2（spec §10 决策 A1–A6 已批，未回问）
> 区间：`6e2ceeb7..`（本线 10 commits，一 Task 一 commit，T4 拆门禁/证据两笔）
> 计划：[`plans/2026-09-10-recall-eval-v2.md`](../plans/2026-09-10-recall-eval-v2.md) · 设计：[`specs/2026-09-10-recall-eval-v2-design.md`](../specs/2026-09-10-recall-eval-v2-design.md) · 前线裁决：[`reports/2026-09-10-recall-p0-g-verdict.md`](2026-09-10-recall-p0-g-verdict.md) §6/§7

## 0. 一句话结论

v2 评测集落地并冻结：**245 条 = v1 130 原样（机械 diff 0 差异）+ 新增 115 全独立**（A55/B45/C20/D20/E50/N55，覆盖 83 卡，E 三子模式 17/17/16），G1 盲判抽检分歧率 **6.7%**（≤10%）；门禁**显式切到 v2**（独立 commit，runner DEFAULT 仍指 v1），阈值按 A6 重测 = 新基线 − 不变 D11 margins + **A 层 ≥0.95**（A5），证伪自证通过；**T3 重评按 DoD 字面 = PASS**（六项聚合全上行、B+5/E+1、零丢失零新增 FP、拒答不变、A 层不动），但**泛化归因必须如实拆解：6 条增量中 5 条落在建表集自身，真正全新增量 = 1 条（E-030，+1/115）**——是否据此解除 T3 停用并接线 propose.js，**移交 Lead 裁定**（本线红线未接线）。

## 1. 交付总览（Task → commit）

| Task | commit | 内容 | 验收 |
|---|---|---|---|
| T0 | `6e2ceeb7` + `d30f273f` | 开工声明（立即 commit）+ v1 盘点（130/A40B30C15D15N30/62 卡）+ 配额表冻结 | `T0-inventory.txt` ✓ |
| T1 | `db4c1582` | v2 骨架：**脚本搬运**（`gen-v2-skeleton.mjs`，禁止手抄），v1 130 条全字段 verbatim + `source:"v1"`，excluded 4 随迁，relabels 空 | **保真 diffs=0，count=130/130**（plan 三层校验 + 全字段深校验双过）`T1-fidelity.txt` |
| T2 | `3bc31e8f` | 新增 115 条（A15/B15/C5/D5/E50/N25），语料出发标注、**全程零匹配器调用**；E 层全词 ban-check；N 近域 25 条语料缺席验证；D 码 5 枚 grep 单卡实证；**盲态第二标注人复核**（9 弱歧义补消歧 note、E-019/N-034 换靶、E-039 措辞） | 245 条结构自检全绿 `T2-struct.txt`；复核记录 `T2-labeling-log.md` |
| T3 | `16e6bab0` + `de4ee6a3` | **冻结**（frozenAt/labelers×2/reviewers/changeLog；此后只读，唯一变更通道=relabels）+ **G1 盲判抽检**：独立子智能体先盲判后对照，零匹配器 | **15 条分歧 1 条 = 6.7% ≤ 10% PASS**（唯一分歧 A-024 属合理歧义已被 multi-gold 吸收；换靶 2 条 + excluded 4 条复核全成立）`T3-blind-review.txt` |
| T4 | `8f906527` + `33d28f12` | **门禁切换独立 commit**：显式读 v2（runner DEFAULT_FIXTURE 保持 v1 一字不动）、结构断言升级 spec §7、lockstep pin 更新为 v2 实测、floor = 新基线 − 不变 margins、**A 层 ≥0.95 新断言**；对跑表 + 阈值提案先出 | 切换后 5 passed exit 0；`--baseline` 对 v2 快照 exit 0；**证伪自证：全 floor +0.2（含 A=1.15）必红、仅六项 +0.2 必红（6 FAIL 行）、还原 5 passed 字节一致** `T4-selfproof.txt` |
| T5 | `939e61a6` | **T3 重评**：v1 失败建词表（复用 `data/kb/synonyms.json`，本线零词表改动——建表隔离天然成立）vs 冻结 v2，on/off 对比 | 判决 `T5-t3-reeval.json`（详见 §4） |
| T6 | 本 commit | 报告 + todo + agent-log 收工 | — |

## 2. v1/v2 对跑表（A6：切换前必出）

| 指标 | v1（n=100+30） | v2（n=190+55） | 漂移解读 |
|---|---|---|---|
| Acc@1 | 0.740 | **0.600** | E 层 50 条全口语改写（无卡面原词）首战 0.100，拉低聚合——新判别面的真实起点，非回归 |
| Recall@5 | 0.847 | **0.725** | 同上 |
| MRR@5 | 0.784 | **0.653** | 同上 |
| nDCG@5 | 0.798 | **0.667** | 同上 |
| 拒答率 | 0.633 | **0.382** | 近域负样本 25 条 = 设计出的 FP 压力面（34 FP 中 24 个来自近域）——**该层就是用来暴露拒答分辨率缺口的** |
| 噪声 Acc@1 | 0.740 | **0.600** | 随 Acc@1 |
| 分层 A | 1.000 | **1.000** | 零容错保持（55/55） |
| 分层 B / C / D | 0.233 / 0.867 / 0.933 | 0.400 / 0.900 / 0.900 | D 新码 5/5 全中（18/20） |
| 分层 E | — | **0.100** | 新层基线（5/50） |
| 延迟 warm/cold p95 | 0.154 / 4.115ms | 0.138 / 4.263ms | 预算内 |

**分布差异方向可解释**（E 新层 + 近域负压面），继承 v1 floor 会产出无意义红/绿——A6 重测必要性被实测证实。v1 数字切换后仍可复现：`node scripts/kb/recall-eval.mjs --fixture ...v1.json`（runner 默认即 v1，历史对跑零成本）。

## 3. 阈值提案（A6：先测后定，**待 Lead 批准/追认**）

floor = v2 冻结基线（`T4-v2.json` 实测）− **不变的 D11 margins**（与 v1 §T4 同方法论；margins 实值取自 runner `DEFAULT_MARGINS`，lockstep pin 在切换实测中纠偏一次——ndcg margin 实为 0.08、noise 实为 0.10）：

| 指标 | v2 实测基线 | margin | **提案 floor** |
|---|---|---|---|
| Acc@1 | 0.600 | 0.05 | **0.550** |
| Recall@5 | 0.725 | 0.05 | **0.675** |
| MRR@5 | 0.653 | 0.08 | **0.573** |
| nDCG@5 | 0.667 | 0.08 | **0.587** |
| 拒答率 | 0.382 | 0.05 | **0.332**（floor 随拒答能力提升应只升，Lead 应在 T3/方向5 落地后上调） |
| 噪声 Acc@1 | 0.600 | 0.10 | **0.500** |
| **A 层 Acc@1** | 1.000 | — | **0.95（A5 已批，55 条允许 miss ≤2）** |
| warm/cold p95 | 0.138 / 4.263ms | — | ≤50 / ≤200ms（绝对预算不变） |

证伪自证：全 floor +0.2（含 A=1.15）→ exit 1（A 层断言红）；仅六项 +0.2 → exit 1（6 FAIL 行）；还原 → 5 passed，文件与 `8f906527` 字节一致（`T4-selfproof.txt`）。

## 4. T3 重评判决（附录 B 协议：旧集建表 → 新集验证）

**同一冻结 v2，synonyms on/off**（词表 = `data/kb/synonyms.json` 16 条，P0/T3 据 v1 失败 35 条反推，本线零改动）：

| 项 | off | on | Δ | DoD |
|---|---|---|---|---|
| Acc@1 | 0.600 | 0.632 | +0.032 | ✓ 上行 |
| Recall@5 | 0.725 | 0.761 | +0.036 | ✓ |
| MRR@5 / nDCG@5 | 0.653 / 0.667 | 0.687 / 0.702 | +0.034 / +0.035 | ✓ |
| 拒答率 | 0.382 | 0.382 | 0（翻转 0） | ✓ 不降 |
| 噪声 Acc@1 | 0.600 | 0.632 | +0.032 | ✓ |
| 分层 A | 55/55 | 55/55 | 0 | ✓ 不掉 |
| 分层 B | 18/45 | **23/45** | +5 | ✓ > 0 |
| 分层 E | 5/50 | **6/50** | +1 | ✓ > 0 |

翻转明细：+6（B-001/009/013/015/023 + E-030）、−0、新增 FP 0、拒答翻转 0。

**归因拆解（如实披露，G3 反作弊视点）**：
- +5 的 B **全部是 v1 携带条目且正是 P0/T3 的建表集成员**（B-001 止付→冻结 / B-009 基本资料→客户信息查询 / B-013 借钱→用信 / B-015 借款合同→对公合同签订 / B-023 打官司→司法诉讼）——这 5 条证明词表对反推来源仍有效（**记忆一致性**），**不构成泛化证据**；v2 的 A1 决策（v1 原样携带）使建表集天然包含在 v2 内，这是协议的已知边界。
- **真正全新地面上的增量 = E-030 一条**：「个人用款申请填错了信息要改一改在哪操作」（v2-new 口语条，建表期不存在），桥 = 词表条目「用款→用信」，注入 token 命中 gold 卡 alias「对私用信申请修改查看」（loan-retail-apply-maintain）。**泛化增量为正但薄（+1/115 新条目；E 层 +1/50）。**
- **DoD 字面判定 = PASS**（E/B 独立正增量 > 0、聚合不退化、拒答不降、A 层不掉）——与 P0/T3 的 verify=0 有了本质区别；但「+1/115 是否足以解除停用并接线 propose.js 计入成果」是程度判断，**移交 Lead**。本线按红线**未接线**，T3 生产态维持停用（生产数字仍 = T2 链态口径）。

## 5. v2 新基线与失败清单（76 miss / 190 正样本）

| 层 | Acc@1 | miss | 主因归类 |
|---|---|---|---|
| A | 1.000 | 0 | — |
| B | 0.400 | 27 | 口语改写撞同域近邻（担保物/基本资料/评级过程类词面鸿沟 12 条为 v1 已知存量）+ 新 B 语料侧改写 9 条（智能控制/催收/门户域词面稀疏） |
| C | 0.900 | 2 | C-001 登录场景词面弱（存量）、C-008 权证出入库（存量） |
| D | 0.900 | 2 | D-010「360视图」bigram 撞击（存量）、D-017 `wf_usecredit_004` 排 3（**新发现**：下划线流程码不在分词桥接范围，rank 3 被社团卡抢走） |
| E | 0.100 | 45 | 判别层真实基线——口语同义改写与 84 卡词面几乎零重叠，BM25 系打分天然弱；这正是 E 层存在的意义：给方向 5（混合检索/embedding）提供可量化靶区 |
| N | 拒答 0.382 | 21 正确拒答 | 34 FP 中 24 个来自近域 25 条——同业务域无卡 query 与语料词汇天然重叠，暴露拒答分辨率缺口（设计意图）；存量 N-002 计算2加3 FP 逐位不变（移交项维持） |

失败清单全量：`tmp/kb-eval-v2/T4-v2.json` perQuery（门禁打印 top20）；E 层 45 miss 逐条 id 见 §5 归类。

## 6. 纪律与红线自查（G2 预检）

1. **建表隔离** ✓：本线零词表/别名/阈值资产据 v2 构建——`git log -- data/kb/synonyms.json`（自 b7bdb8e8 标注后零改动）；阈值 = 基线 − 不变 margins 的机械推导；T5 只消费现成 v1 失败反推词表。
2. **v1 保真** ✓：`kb-recall-eval.v1.json` 一字未改（T1/T2/T3 冻结后三次机械全字段校验均 diffs=0，130/130）；`kb-recall-failures.v1.json` 未触碰。
3. **标注禁跑匹配器** ✓：主标 + 第二标注人 + G1 盲判三轮全程零匹配器调用（盲判答案先固定后对照，子智能体报告含过程披露）。
4. **不引依赖 / 不改召回算法** ✓：`src/**`、`scripts/kb/recall-eval.mjs` 零改动（仅门禁文件切换 fixture 与断言）。
5. **门禁切换独立 commit** ✓：`8f906527`（切换）与 `33d28f12`(证据) 分离；runner `DEFAULT_FIXTURE` 保持 v1。
6. **不接线 propose.js** ✓：全程未触碰（红线，T3 未由 Lead 解除停用前禁止）。
7. **阈值只升不降** ✓：六项 floor 相对 v1 是「重测」非放宽（margins 不变、A 层新增 0.95）；拒答 floor 0.332 系新负压面下的重测值，已注明只升约束。
8. **一 Task 一 commit** ✓：10 commits（T4 拆切换/证据两笔——切换独立 commit 是红线要求）。

## 7. 移交与遗留

| # | 事项 | 归属 |
|---|---|---|
| 1 | **T3 处置裁定**：DoD 字面 PASS + 全新地面增量 +1/115（E-030 桥接实证）——解除停用并接线 propose.js（A5 已放行接线参数面），或维持停用至词表 v2 重建 | **Lead** |
| 2 | **阈值提案追认**：六项 floor + A 层 0.95（§3 表）；若调整只改 `APPROVED` 一处 + lockstep 字面量同 commit | **Lead** |
| 3 | E 层 45 miss + 近域 24 FP：方向 5（混合检索/embedding）的量化靶区，v2 首次给出可测基线 | 另立项 |
| 4 | D-017 新发现：下划线流程实例码（wf_usecredit_004）不在 tokenizeCodes 桥接范围——若 Lead 认为该形态值得救，属分词器小迭代（**改 flow-card-recall.js 须同 commit 复跑两门禁**） | 待裁决 |
| 5 | N-002 计算2加3 存量 FP：逐位不变，维持移交（地板收紧须批） | Lead（维持） |
| 6 | G1 抽检 C 层未覆盖：正式 G1 建议对 C 层单独加抽 3-5 条 | reviewer |

## 8. 复现命令

```bash
# v1 历史基线（runner 默认仍 v1）
node scripts/kb/recall-eval.mjs --baseline tmp/kb-eval/baseline-v1.json
# v2 新基线（切换后门禁同款）
node scripts/kb/recall-eval.mjs --fixture scripts/characterization/fixtures/kb-recall-eval.v2.json --baseline tmp/kb-eval-v2/T4-v2.json
# v2 门禁
node scripts/characterization/characterize-kb-recall-eval.mjs
# T3 重评 on/off
node scripts/kb/recall-eval.mjs --fixture scripts/characterization/fixtures/kb-recall-eval.v2.json [--synonyms] --json
```
