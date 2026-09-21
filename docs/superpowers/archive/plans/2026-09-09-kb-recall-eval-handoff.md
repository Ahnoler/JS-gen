# 移交：KB 召回评测常态化（方向 3）—— 给执行 Agent

> **给执行 Agent**：本任务把 KB 召回质量从「一次性人工探针」变成「独立标注评测集 + 标准指标 + 门禁阈值 + 基线对比」的常态能力。**先读 spec 与 plan，再动第一行**。  
> **作者**：DSH reviewer（2026-09-09）  
> **规格**：[`specs/2026-09-09-kb-recall-eval-design.md`](../specs/2026-09-09-kb-recall-eval-design.md)（状态**已确认**，§13 决策 D1–D12 已定）  
> **计划**：[`plans/2026-09-09-kb-recall-eval.md`](./2026-09-09-kb-recall-eval.md)（Approved Decisions / T0–T7 / DoD 矩阵 / Reviewer Checklist）  
> **复核人**：DSH reviewer（三个 gate 见 §6；不通过不得进入下一阶段）

---

## 0. 为何做这件事

2026-09-09 基于公开标准的重评分（RAGAS / IR 排序指标 / RAG Triad / Chroma 分块评估 / DAMA-DMBOK）显示，KB 四维中**召回的「评测独立性」子项仅 3.5/10**，是全表最低：

| 问题 | 证据 |
|---|---|
| P1 评测集自证 | `fixtures/kb-recall-golden.json` 24 条中 **16 条以实现输出为期望**；仅 5 条为 spec 独立给定 |
| P2 无 ranked 输出 | `matchFlowForAtom` 只返回 top-1，MRR/nDCG 只能用留一法近似 |
| P3 无门禁 | 召回改动无回归护栏 |
| P4 无基线 | 一次测量（hold-out n=20，Wilson CI [0.699, 0.972]）不足以支撑决策 |
| P5 跨语言样本太小 | 5/24 已登记分歧，收敛/回归都看不出来 |

**基线（reviewer 实测，20 条独立 hold-out + 留一法近似排序）**

| 指标 | 基线 |
|---|---|
| Acc@1 | 0.90（18/20，Wilson 95% CI [0.699, 0.972]） |
| Recall@5 | 1.000 |
| MRR@5 | 0.942 |
| nDCG@5 | 0.957 |
| 拒答率 | 0.90（9/10；已知 FP：`计算 2 加 3 等于多少` → `collection_scorecard`，**保留为回归靶子**） |
| 噪声 Acc@1 | 0.90（Δ0.00） |
| 延迟 | 热 p50 0.08ms / p95 0.14ms；冷 p50 4.18ms / p95 8.77ms |
| 分层 | 词面一致 10/10；改写 8/10 |

---

## 1. 禁区（违反即返工）

- **文件集互斥**：本线**不含** `src/services/req-draft-traj/propose.js`（他线「entry-only atom 折叠」正在改）；`scripts/refactor/verify-all.sh` **只追加一行**且独立 commit（多条线在改它）。
- **只读真实语料**：不得写 `data/kb/**`、`data/kb/flows/**`；探针用 tmp 副本。
- **不碰他线 WIP**：`.cursor/`、`config/update-db-whitelist.ps1`、`scripts/controller/actions/**`、fill/select/radio/search-then-click 热区。
- **不烧执行机**：不得调用 `prepare` / `record/start` / `detach`。
- **不改召回算法**：本版只建护栏（ranked 输出是契约补充，不是算法替换）；BM25/embedding/rerank 另立项。
- **不改 24 条契约金样例的职责**：它继续管 JS/PY 跨语言一致性。

---

## 2. 前置（缺一不可）

```bash
git log --oneline -5
git status --short
node scripts/characterization/characterize-req-draft-traj.mjs   # 若红，先确认是否他线 propose.js 所致
node scripts/characterization/characterize-flow-card-recall.mjs # 期望 15 passed
./python/python.exe scripts/characterization/characterize-kb-recall.py  # 期望 24 entries, 5 divergences
```

1. **开工声明**：`docs/superpowers/agent-log.md` 顶部插入开工条目（时刻 + 文件集 + 禁入区 + 方式）并**立即 commit**；子智能体不写、由主会话代写。
2. **基线复现**：用 plan 附录口径复现 §0 基线，落 `tmp/kb-eval/baseline.json`；与上表不一致先查语料变动再继续。

---

## 3. 任务顺序（T0 → T7，细节见 plan）

| Task | 一句话 | 关键产出 |
|---|---|---|
| **T0** | 开工声明 + 基线复现 + 环境记录 | `tmp/kb-eval/{baseline.json,env.txt}` |
| **T1** | 评测集 v1：**130 条**（A40/B30/C15/D15/N30），独立标注 + 双人复核 + 冻结 | `scripts/characterization/fixtures/kb-recall-eval.v1.json` |
| **T2** | ranked 输出：新增 `rankFlowCards()`，`matchFlowForAtom` 语义不变 | `flow-card-recall.js` + 2 条 pin |
| **T3** | 指标运行器：一条命令产出标准指标 JSON + `--baseline` diff | `scripts/kb/recall-eval.mjs` |
| **T4** | 门禁：阈值（**先测后定 + Lead 批准**）+ 新 characterization + verify-all 一行 | `characterize-kb-recall-eval.mjs` |
| **T5** | PY 侧正样本 flowRef 一致性（不入门禁） | `characterize-kb-recall.py` |
| **T6** | 基线与趋势报告（含失败条目清单） | `reports/2026-09-09-kb-recall-eval-baseline.md` |
| **T7** | 文档收尾：AGENTS.md 一句 + agent-log 收工 | — |

### T1 配额与覆盖

| 层 | 条数 | 说明 |
|---|---|---|
| A 词面一致 | 40 | 用卡片 `flow/aliases/keywords` 原词 |
| B 改写同义 | 30 | **不出现**卡片原词，业务口语/近义 |
| C 场景长句 | 15 | 带任务上下文（模拟 agent phase 文本） |
| D 别名/缩写 | 15 | `aliases`、菜单简称、页面编码 |
| N 负样本 | 30 | 跨域无关 20 + **近域无关** 10，每条写 `whyNegative` |
| 合计 | **130** | 正样本 100 参与指标；覆盖 **≥50 张卡**，单卡 ≤4 条 |

**种子**：reviewer 上一轮的 20 条独立 hold-out 可直接收编为 A/B 层，另新写 80 条。

### T4 阈值口径（先测后定）

| 指标 | 余量上限 | 备注 |
|---|---|---|
| Acc@1 | 基线 − 0.05 | 正样本 |
| Recall@5 | 基线 − 0.05 | 正样本 |
| MRR@5 | 基线 − 0.08 | 正样本 |
| nDCG@5 | 基线 − 0.08 | 正样本（二值相关） |
| 拒答率 | 基线 − 0.05 | 负样本 |
| 噪声 Acc@1 | 基线 − 0.10 | A–D 层追加统一噪声子句 |
| 热 p95 / 冷 p95 | ≤ 50ms / ≤ 200ms | 冷态用新建数组击穿语料画像缓存 |

阈值必须在 v1 上测出真实基线后提案（**基线值 + 提案值 + 理由**），Lead 批准后写入。

---

## 4. 关键纪律（本次的核心风险是「评测集被反推」）

1. **标注禁止先跑匹配器**：gold 从语料（84 卡 + `through-chains.md` 步骤 + 湿测叶名）出发；反推实现输出的 gold **一律作废**。
2. **多 gold 允许**：一条 query 命中多张卡时全部列入 `gold: [...]`，命中任一即算对；歧义无法判定者进 `excluded[]`（宁少勿脏）。
3. **冻结**：v1 建好后只读；增删改 = 新版本 + `changeLog`（原因 + 批准人）。
4. **结构自检脚本化**（plan T1 Step 3）：条数 ≥130、负样本 =30、覆盖卡 ≥50、query 无重复、每条 gold 非空。
5. **口径切换要写进报告**：T2 之前 MRR/nDCG 用留一法近似，T2 之后用真实排序；两套数字不可混报。

---

## 5. 交付与回报

- 一个 Task 一个 commit；证据落 `tmp/kb-eval/<task-id>/`（命令输出、指标 JSON、自证红/绿）。
- 回报格式：

```
Task N | commit <hash> | 验收命令与输出 | 证据路径 | PASS/FAIL/CONCERNS | 遗留
```

- **必须额外交**：T1 的 `labelers/reviewers/changeLog/excluded` 记录；T4 的阈值提案（等批准）。

---

## 6. reviewer 介入点（三个 gate，不通过不得继续）

| Gate | 时机 | 我做什么 | 不通过怎么办 |
|---|---|---|---|
| **G1** | T1 完成后 | 独立抽检 15 条自判 gold | 分歧率 >10% → 回炉重标；**T2–T4 暂停** |
| **G2** | T4 写入前 | 审阈值提案（基线值 + 余量 + 理由） | 阈值不合理 → 退回重提 |
| **G3** | 全部完成后 | 按 plan 的 Reviewer Checklist 出结论 | 出 `PASS` / `FAIL`（附复现命令）/ `DONE_WITH_CONCERNS` |

reviewer 复核方式：读 diff 不读自述 → 复跑 DoD 矩阵 + 五条既有基线 → 独立抽检 gold → 自己把阈值抬高验证门禁真会红 → 反作弊清单（gold 反推 / 条目删改 / `excluded` 滥用 / `--baseline` 绕过）→ 判定。**reviewer 不代提交。**

---

## 7. 报告模板

```markdown
# KB 召回评测常态化 — 实施报告

- 时刻 / 执行者 / 控制面或 CLI 环境（node 版本、git HEAD）
- T0 基线复现：与 spec 附录基线是否一致（逐项）
- T1 评测集：条数 / 分层计数 / 覆盖卡数 / excluded 数 / 复核分歧与裁决
- T2 ranked：pin 数 / `matchFlowForAtom` 不变量验证
- T3 指标：v1 指标表（含 perQuery 失败清单、延迟冷热、Wilson CI）
- T4 阈值提案 + 批准记录 + 门禁自证（抬高阈值 → 红）
- T5 PY 一致率
- T6 报告链接
- 结论：PASS / FAIL（FAIL 贴失败条目原文）
- 遗留
```

---

## 8. FAIL 时怎么办

停。把**失败条目原文 + 指标 JSON + 复现命令**贴回 Lead，不要：
- 把失败条目从评测集里删掉再宣称通过；
- 放宽阈值让测试变绿（阈值变更必须走 G2）；
- 改 `gold` 去迎合实现输出（G1 会发现）。

---

## 附录：反作弊清单（reviewer 逐条查）

| 条目 | 判据 |
|---|---|
| gold 反推 | 随机 15 条自判，分歧率 >10% |
| 条目删改 | `changeLog` 与实际 diff 对不上 |
| `excluded` 滥用 | excluded 条目多为「实现答错」而非真歧义 |
| 阈值恒真 | 抬高阈值后门禁仍绿 |
| `--baseline` 绕过 | 门禁用例不读 baseline / 读被改过的 baseline |
| 评测集只覆盖头部卡 | 覆盖卡数 <50 或单卡 >4 条 |
