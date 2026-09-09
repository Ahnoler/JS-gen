# KB 召回评测常态化 — 设计

> 日期：2026-09-09  
> 状态：**待审阅**（批准后进入 [`plans/2026-09-09-kb-recall-eval.md`](../plans/2026-09-09-kb-recall-eval.md)）  
> 作者：DSH reviewer（依据 2026-09-09 基于公开标准的重评分结论）  
> 相关：[`specs/2026-09-08-kb-remediation-design.md`](./2026-09-08-kb-remediation-design.md)（D3 共享金样例）、[`reports/2026-09-09-kb-remediation-reviewer-verdict.md`](../reports/2026-09-09-kb-remediation-reviewer-verdict.md)  
> 标准依据（公开资料）：RAGAS 指标族、IR 排序指标（Recall@k/MRR/nDCG）、TruLens RAG Triad、RAG 评测综述（arXiv 2405.07437）、Chroma 分块评估（token 级 P/R/IoU）、DAMA-DMBOK 数据质量维度

## 1. 目标

把召回质量从「一次性人工探针」升级为**独立标注集 + 标准指标 + 门禁阈值 + 基线对比**的常态能力。

成功终点（每条可机械验证）：

1. 存在一份 **≥130 条**（正样本 ≥100 + 负样本 30）的评测集，**标注不依赖实现输出**，冻结且带 `evalVersion`；
2. 一条命令产出标准指标 JSON：`Acc@1 / Recall@5 / MRR@5 / nDCG@5 / 拒答率 / 噪声鲁棒性 / 延迟 p50·p95（冷/热）`，并附逐条明细；
3. 指标写入门禁，**召回回归即红**；
4. 基线固化在案，任何召回改动必须复跑并与基线 diff；
5. JS/PY 两侧对同一评测集的正样本断言 `flowRef` 一致，分歧显式登记。

## 2. 范围

### In

- 评测集 v1 的建设、标注规范与冻结机制。
- ranked 输出契约（供 MRR/nDCG 直接计算，不再依赖留一法近似）。
- 指标运行器与门禁断言。
- 跨语言（JS/PY）一致性断言与分歧登记。
- 基线与趋势记录、报告模板。

### Out（本版不做）

- **不改召回算法**（不引入 BM25/embedding/rerank）——先建护栏，算法另立项。
- 不改 24 条契约金样例的跨语言角色（它继续承担「两侧必须一致」的契约职责）。
- 不做切片评测（分块 P/R/IoU）——本版只覆盖召回；切片评测另立项。
- 不重切语料、不动 `data/kb/**` 语料与 `data/kb/flows/**`。

## 3. 现状与问题

| # | 问题 | 证据 |
|---|---|---|
| P1 | **评测独立性低** | 现有 `fixtures/kb-recall-golden.json` 24 条中 16 条以新算法在真实语料上的输出为期望（自 pin）；仅 5 条为 spec 独立给定 |
| P2 | **无 ranked 输出** | `matchFlowForAtom` 只返回 top-1，MRR/nDCG 只能用「留一法黑盒重建」近似，扰动 idf 分布 |
| P3 | **无门禁阈值** | 召回改动无回归护栏；上一轮 68→65 lint 归因靠人肉 blame |
| P4 | **无基线与趋势** | 无「变好还是变坏」的判据；一次测量（hold-out n=20，Wilson CI [0.70, 0.97]）无法支撑决策 |
| P5 | **跨语言一致性靠 24 条** | 5/24 已登记分歧；样本太小，收敛/回归都看不出来 |

## 4. 设计决策

| # | 决策 | 理由 | 备选 |
|---|---|---|---|
| D1 | **质量评测集与契约金样例分离**：新建 `kb-recall-eval.v1.json`（≥130 条，独立标注，JS 指标门禁）；`kb-recall-golden.json`（24 条）降级为**跨语言契约**（两侧 flowRef 必须一致） | 两个目标不同：质量评测要独立真值，跨语言契约要稳定小样本 | 合并成一份（会把契约抖动和指标抖动耦合） |
| D2 | ranked 用**新增函数** `rankFlowCards({title,taskDraft,cards,k})`，`matchFlowForAtom` 语义不变（内部复用） | 向后兼容，既有 pin 与调用点零改动 | 改 `matchFlowForAtom` 返回 `candidates`（破坏面大） |
| D3 | 标注**禁止先跑实现**；从语料（84 卡 + through-chains + 湿测叶名）出发标注，允许一条 query 多个 gold | 反推输出 = 自证；多 gold 是 IR 标准做法（歧义查询） | 单 gold 严格匹配（会把合理歧义判成错） |
| D4 | 阈值 = **基线 − 余量**，先测后定，Lead 批准；写在独立 characterization 里 | 避免拍脑袋阈值；可审计 | 直接写死一个数（不可解释） |
| D5 | 延迟分**冷/热**两档；热态含进程内语料画像缓存 | 冷态 4.18ms vs 热态 0.08ms 差 50×，混报会误导 | 只报热态（掩盖首次成本） |
| D6 | PY 侧只断言**正样本 flowRef 一致性**，不参与 JS 指标门禁 | py 算法未升级（D3 决策），强行对齐会制造假红 | py 也跑全套指标（会长期红） |
| D7 | 评测集**冻结 + 版本号**；变更需 Lead 批准并在文件头记录原因与批准人 | 防止「改题让测试过」 | 允许自由增删（可被 gaming） |

## 5. 评测集设计

### 5.1 规模与分层（v1 配额）

| 层 | 条数 | 说明 | 例 |
|---|---|---|---|
| A 词面一致 | 40 | query 使用卡片 `flow/aliases/keywords` 原词 | 「额度冻结解冻操作」 |
| B 改写同义 | 30 | **不出现**卡片原词，用业务口语/近义 | 「把额度临时止付再恢复」 |
| C 场景长句 | 15 | 带任务上下文（模拟 agent 的 phase 文本） | 「阶段1：在新增对公授信管理里发起授信申请」 |
| D 别名/缩写 | 15 | 用 `aliases`、菜单简称、页面编码 | 「W0 登录」「lmtRgstAndOcp 注册并占用」 |
| N 负样本 | 30 | 跨域无关 20 + **近域无关** 10（同业务域但无对应卡） | 「写一首关于春天的诗」/「贷款展期怎么申请」 |
| **合计** | **130** | 正样本 100 参与指标，负样本 30 参与拒答率 | |

- 噪声鲁棒性不单列条目：对 A–D 全量追加统一噪声子句（如「（顺便问一下，今天天气怎么样）」）后重测，报 Δ。
- 覆盖约束：正样本必须覆盖 **≥50 张不同卡**（84 卡中），每张卡 ≤4 条，避免头部卡刷分。

### 5.2 标注规范

1. 标注人只看**语料**（`data/kb/flows/*.json` 的 flow/aliases/keywords/menu_path/nodes + `data/kb/req/*/through-chains.md` + wet-test 叶名），**不得先运行匹配器**。
2. gold 用 **stem 数组**；一条 query 可命中多张卡时全部列入（`gold: ["a","b"]`），命中任一即算对。
3. 歧义无法判定 → 该条**不进评测集**（宁少勿脏）；进入 `excluded[]` 并记原因。
4. 双人复核：主标 + 复核各一遍，分歧条目由 Lead 裁决；复核记录进文件头。
5. 负样本必须写 `whyNegative`（为什么不该命中任何卡），便于日后回归。

### 5.3 冻结与版本

- 文件头：`evalVersion: "v1"`, `frozenAt`, `labelers`, `reviewers`, `changeLog[]`。
- 任何增删改条目 = 新版本（v2…），必须在 `changeLog` 写**原因 + 批准人**；禁止原地改。
- 评测集文件改动必须与 `characterize-kb-recall-eval` 的阈值变更同 commit。

## 6. 指标口径（标准对齐）

| 指标 | 定义 | 标准来源 | v1 门禁阈值（先测后定） |
|---|---|---|---|
| `Acc@1` | top-1 命中 gold 的比例（正样本） | IR / 本仓上一轮基线 0.90 | ≥ 基线 − 0.05 |
| `Recall@5` | top-5 覆盖 gold 的比例 | [Meilisearch](https://www.meilisearch.com/blog/search-relevance-metrics) | ≥ 基线 − 0.05 |
| `MRR@5` | 首个 gold 排名倒数的均值 | 同上 | ≥ 基线 − 0.08 |
| `nDCG@5` | 二值相关下的归一化折损累积增益 | 同上 | ≥ 基线 − 0.08 |
| `拒答率` | 负样本返回 null 的比例（1 − FPR） | [RAGAS Noise Sensitivity](https://docs.ragas.io/en/stable/concepts/metrics/available_metrics/) 对应「不该命中」面 | ≥ 基线 − 0.05 |
| `噪声 Acc@1` | 追加噪声子句后的 Acc@1 | RAGAS Noise Sensitivity | ≥ 基线 − 0.10 |
| `p95 热/冷` | 单次匹配耗时（热=语料画像已缓存） | 工程预算（本仓 200ms） | 热 ≤ 50ms，冷 ≤ 200ms |

> **先测后定**：阈值在评测集建成并测出基线后，由实施方给出「基线 − 余量」提案，Lead 批准后写入 characterization；本文档只给方法与余量上限。

## 7. ranked 输出契约

```js
/**
 * 返回按得分降序的候选卡列表（供 MRR/nDCG 直接计算）。
 * @param {{ title?: string, taskDraft?: string, cards?: object[], k?: number }} opts
 * @returns {{ flowRef: string|null, nodeId: string|null, score: number|null, candidates: Array<{ flowRef: string|null, score: number, nodeId: string|null }> }}
 */
export function rankFlowCards({ title, taskDraft, cards, k = 5 } = {})
```

- `matchFlowForAtom` 语义与返回形状**不变**（`{flowRef,nodeId,score}`），内部复用 `rankFlowCards`（k=1）。
- `candidates` 仅含过阈值的卡；空结果返回 `candidates: []`。
- 若产品 API 暴露该能力，需同步 `api-docs`（本版默认不暴露，仅内部评测用）。

## 8. 运行器与门禁

### 8.1 `scripts/kb/recall-eval.mjs`

```bash
node scripts/kb/recall-eval.mjs                      # 跑 v1，打印指标表 + 写 tmp/kb-eval/<ts>.json
node scripts/kb/recall-eval.mjs --baseline <file>    # 与基线 diff，超阈值即非零退出
node scripts/kb/recall-eval.mjs --json               # 机器可读
```

- 输出包含：`metrics`、`perQuery[]`（query/gold/top5/rank/ok）、`latency`、`negatives[]`、`noise`。
- 复用 `listFlowCardsDetailed()` 真实语料；**不 mock**。

### 8.2 门禁 characterization

- 新增 `scripts/characterization/characterize-kb-recall-eval.mjs`：读冻结评测集 → 跑指标 → 断言阈值 → 打印指标表。
- 在 `scripts/refactor/verify-all.sh` **只追加一行**（独立 commit，避免与他线冲突）。
- 自证：临时把阈值抬高 0.2 → 必须红；还原 → 绿。

### 8.3 与既有套件的关系

| 套件 | 职责 | 变更规则 |
|---|---|---|
| `characterize-kb-recall.py`（契约） | 24 条金样例跨语言一致性 | 不改职责 |
| `characterize-flow-card-recall.mjs`（行为） | 匹配/拼装/幂等 pin | 保留 |
| **新增** `characterize-kb-recall-eval.mjs`（质量） | 130 条指标门禁 | 阈值变更需 Lead 批准 |

## 9. 错误处理与降级

| 情况 | 行为 |
|---|---|
| 评测集缺失/版本不符 | 门禁直接红，报 `eval fixture missing/version mismatch` |
| 某条 query 无 gold（标注遗漏） | 加载时校验并红，禁止静默跳过 |
| 语料卡被删导致 gold 失效 | 报 `stale gold: <stem>`，由 Lead 决定改题或改卡 |
| 指标低于阈值 | 红，并打印 perQuery 明细（哪几条退化） |
| 延迟抖动 | 取 200 次中位数/p95；单次 GC 抖动不判红 |

## 10. 验收

1. 评测集 v1 ≥130 条、覆盖 ≥50 张卡、负样本 30 条带 `whyNegative`，双人复核记录在文件头。
2. `node scripts/kb/recall-eval.mjs` 一条命令产出指标 JSON；指标与上一轮 20 条 hold-out 结论方向一致（Acc@1 量级 0.85–0.95）。
3. 门禁自证：阈值抬高 → 红；正常 → 绿；`verify-all.sh` ALL GREEN。
4. `rankFlowCards` 的 top-1 与 `matchFlowForAtom` 完全一致（pin）。
5. JS/PY 对正样本 flowRef 一致或分歧已登记；契约金样例 24 条仍绿。
6. 基线 JSON 落盘并记录在 spec/plan 附录。

## 11. 测试策略

- characterization 是 pin：新增断言不得恒真化；阈值断言必须能被「人为抬高」证伪。
- 评测集是**数据**，不进 `read_text` 源码 pin；只做结构校验（条数/分层/无重复/gold 存在）。
- 探针一律用 tmp 副本或只读真实语料；禁止写 `data/kb/**`。

## 12. 风险

| 风险 | 缓解 |
|---|---|
| R1 标注主观性 → 评测集质量差 | 双人复核 + 歧义条目剔除 + 允许 多 gold |
| R2 评测集被「改题」通过 | 版本冻结 + 变更需批准 + 与阈值同 commit |
| R3 130 条仍偏小（CI 宽） | 报 Wilson CI；后续 v2 扩到 300+ |
| R4 与他线 `verify-all.sh` 冲突 | 只追加一行，独立 commit |
| R5 `propose.js` 他线在改（entry-only atom 折叠） | 本线文件集不含 `propose.js`；`flow-card-recall.js` 改动与 `propose.js` 无同文件冲突，但需复跑 `characterize-req-draft-traj` |
| R6 阈值过紧导致误红 | 余量上限见 §6；先测后定 |

## 13. 审阅请确认

1. §4 D1（评测集与契约金样例分离）是否接受。
2. §5.1 配额（130 条 / 覆盖 ≥50 卡 / 负样本 30）是否调整。
3. §5.2 标注人由谁承担（Lead / 业务 / 实施方），复核人是否为 reviewer。
4. §7 ranked 是否对外暴露（默认仅内部）。
5. §6 阈值「基线 − 余量」的上限是否认可（Acc@1 −0.05 / MRR −0.08 / 拒答 −0.05）。

确认后进入 plan 逐 Task 实施；实施完成后由 reviewer 按 plan 的 Reviewer Checklist 复核。
