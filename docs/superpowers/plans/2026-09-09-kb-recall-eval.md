# KB Recall Eval Implementation Plan（召回评测常态化）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox ([`-`]) syntax for tracking.

**Goal:** 把 KB 召回质量变成「独立标注评测集 + 标准指标 + 门禁阈值 + 基线对比」的常态能力，使任何召回改动都有可回归的质量护栏。

**Architecture:** 三层分离——① **契约层**：既有 24 条 `kb-recall-golden.json` 继续承担 JS/PY 跨语言一致性；② **质量层**：新建 `kb-recall-eval.v1.json`（≥130 条，独立标注）+ `scripts/kb/recall-eval.mjs` 指标运行器 + `characterize-kb-recall-eval.mjs` 门禁；③ **算法层**：本版不动（ranked 输出仅补契约，不换算法）。

**Tech Stack:** Node ESM、`scripts/characterization/*`（pin 式断言）、`scripts/refactor/verify-all.sh`、Python 侧 `scripts/kb/recall.py`（仅一致性断言）、RAGAS/IR 指标口径。

**Spec:** `docs/superpowers/specs/2026-09-09-kb-recall-eval-design.md`

## Approved Decisions（2026-09-09 Lead 裁定：全部按 reviewer 推荐）

| # | 决策 | 采纳结论 |
|---|---|---|
| D1 | 契约层/质量层 | 分离：`kb-recall-golden.json`（24 条，跨语言契约）+ `kb-recall-eval.v1.json`（130 条，质量门禁） |
| D2 | ranked 形态 | 新增 `rankFlowCards()`；`matchFlowForAtom` 不变 |
| D3 | 标注纪律 | 禁反推 + 多 gold + 歧义剔除 |
| D4 | 阈值 | 先测后定（基线 − 余量），Lead 批准 |
| D5 | 延迟 | 冷/热分报 |
| D6 | PY 范围 | 只断言正样本 flowRef 一致，不入门禁 |
| D7 | 评测集 | 冻结 + `evalVersion` + `changeLog` |
| D8 | 配额 | 130 条（A40/B30/C15/D15/N30），≥50 卡，单卡 ≤4 条 |
| D9 | 标注分工 | 主标=实施方（禁跑匹配器）；复核=reviewer 抽检 15 条（分歧 >10% 回炉）；歧义 Lead 裁决 |
| D10 | ranked 暴露 | 默认仅内部，不写 api-docs |
| D11 | 阈值余量 | Acc@1 −0.05 / Recall@5 −0.05 / MRR −0.08 / nDCG −0.08 / 拒答 −0.05 / 噪声 −0.10 |

**基线（2026-09-09 reviewer 实测，20 条独立 hold-out + 留一法近似排序）**

| 指标 | 基线 |
|---|---|
| Acc@1 | 0.90（18/20，Wilson 95% CI [0.699, 0.972]） |
| Recall@5 | 1.000 |
| MRR@5 | 0.942 |
| nDCG@5 | 0.957 |
| 拒答率 | 0.90（9/10；FP：`计算 2 加 3 等于多少` → `collection_scorecard`） |
| 噪声 Acc@1 | 0.90（Δ0.00） |
| 延迟 | 热 p50 0.08ms / p95 0.14ms；冷 p50 4.18ms / p95 8.77ms |
| 分层 | 词面一致 10/10；改写 8/10 |

## Global Constraints

- **R1 characterization 是 pin**：新增断言不得恒真化；阈值断言必须能被「人为抬高」证伪。
- **R2 标注独立**：标注人只看语料，**禁止先跑匹配器**；反推输出的 gold 一律作废。
- **R3 评测集冻结**：v1 建好后只读；变更 = 新版本 + `changeLog` 记原因与批准人。
- **R4 只读真实语料**：不得写 `data/kb/**`、`data/kb/flows/**`；探针用 tmp 副本。
- **R5 文件集互斥**：本线**不含** `src/services/req-draft-traj/propose.js`（他线 entry-only atom 折叠在改）；`verify-all.sh` 只追加一行、独立 commit。
- **R6 不烧执行机**：不得调用 `prepare` / `record/start` / `detach`。
- **R7 JSDoc**：新公开函数必须有 `@param`/`@returns`；`npm run lint` 不得新增 warning（用 `git blame` 归因自查）。
- **R8 先测后定**：阈值必须在评测集建成并测出基线后提案，Lead 批准后写入；禁止拍脑袋。

## File map

| Path | Responsibility | Task |
|---|---|---|
| `scripts/characterization/fixtures/kb-recall-eval.v1.json` | 质量评测集（≥130 条，冻结） | 1 |
| `src/services/req-draft-traj/flow-card-recall.js` | 新增 `rankFlowCards`（`matchFlowForAtom` 语义不变） | 2 |
| `scripts/kb/recall-eval.mjs` | 指标运行器（Acc@1/Recall@5/MRR@5/nDCG@5/拒答/噪声/延迟冷热） | 3 |
| `scripts/characterization/characterize-kb-recall-eval.mjs` | 门禁断言（阈值 + 结构校验） | 4 |
| `scripts/refactor/verify-all.sh` | 注册新套件（追加一行） | 4 |
| `scripts/characterization/characterize-kb-recall.py` | PY 侧正样本 flowRef 一致性 | 5 |
| `scripts/characterization/characterize-flow-card-recall.mjs` | `rankFlowCards` 行为 pin | 2 |
| `AGENTS.md` | 「质量门禁=评测集 / 跨语言契约=金样例」一句 | 7 |
| `docs/superpowers/reports/2026-09-09-kb-recall-eval-baseline.md` | 基线与趋势报告 | 6 |

---

### Task 0: Pre-flight（开工声明 + 基线复现）

**Files:**
- Create: `tmp/kb-eval/baseline.json`（基线快照，不入库）
- Modify: `docs/superpowers/agent-log.md`（开工条目）

- [ ] **Step 1: 开工声明并立即 commit**

范围写清：`scripts/kb/recall-eval.mjs`、`scripts/characterization/fixtures/kb-recall-eval.v1.json`、`scripts/characterization/characterize-kb-recall-eval.mjs`、`characterize-kb-recall.py`、`characterize-flow-card-recall.mjs`、`src/services/req-draft-traj/flow-card-recall.js`、`verify-all.sh`（仅一行）、本文件。
禁入：`propose.js`（他线在改）、`data/kb/**`、`.cursor/`、`config/update-db-whitelist.ps1`。

- [ ] **Step 2: 复现基线**

用 spec §附录的探针口径跑一遍现有 24 条契约金样例 + 20 条 reviewer hold-out，落 `tmp/kb-eval/baseline.json`。**期望与上表一致**（Acc@1 0.90 / MRR@5 0.942 / …）；若不一致，先查语料是否变动，再继续。

- [ ] **Step 3: 记录环境**

`node -v`、`git rev-parse --short HEAD`、机器负载写入 `tmp/kb-eval/env.txt`（延迟类指标对机器敏感）。

---

### Task 1: 评测集 v1（≥130 条，独立标注，冻结）

**Files:**
- Create: `scripts/characterization/fixtures/kb-recall-eval.v1.json`
- Modify: `docs/superpowers/specs/2026-09-09-kb-recall-eval-design.md`（附录回填实际条数与复核记录）

**Interfaces:**
- 数据结构：

```json
{
  "evalVersion": "v1",
  "frozenAt": "2026-09-09T00:00:00Z",
  "labelers": ["<name>"],
  "reviewers": ["<name>"],
  "changeLog": [{ "at": "...", "by": "...", "why": "...", "approvedBy": "..." }],
  "entries": [
    { "id": "A-001", "tier": "A", "query": "...", "gold": ["product_library"], "note": "" },
    { "id": "N-001", "tier": "N", "query": "写一首关于春天的诗", "gold": [], "whyNegative": "跨域无关，无任何业务卡对应" }
  ],
  "excluded": [{ "query": "...", "why": "歧义无法判定" }]
}
```

- 配额（spec §5.1）：A 40 / B 30 / C 15 / D 15 / N 30 = **130**；正样本覆盖 **≥50 张不同卡**，单卡 ≤4 条。

- [ ] **Step 1: 标注（禁跑匹配器）**

从语料出发生成 query：`data/kb/flows/*.json`（flow/aliases/keywords/menu_path/nodes）＋ `data/kb/req/*/through-chains.md` 步骤 ＋ wet-test 叶名。
**种子**：reviewer 上一轮的 20 条 hold-out 可直接收编为 A/B 层（已独立标注），另新写 80 条。

- [ ] **Step 2: 双人复核**

复核人独立判 gold；分歧条目 Lead 裁决；无法判定者进 `excluded[]`（宁少勿脏）。

- [ ] **Step 3: 结构自检（脚本化）**

```bash
node -e "const f=require('./scripts/characterization/fixtures/kb-recall-eval.v1.json');
 const e=f.entries; const pos=e.filter(x=>x.tier!=='N'); const neg=e.filter(x=>x.tier==='N');
 const stems=new Set(pos.flatMap(x=>x.gold));
 console.assert(e.length>=130, 'need >=130');
 console.assert(neg.length===30, 'need 30 negatives');
 console.assert(stems.size>=50, 'need >=50 distinct cards, got '+stems.size);
 console.assert(new Set(e.map(x=>x.query)).size===e.length, 'duplicate queries');
 for (const x of e) { console.assert(x.query && (x.tier==='N' ? x.whyNegative : (x.gold||[]).length), 'bad entry '+x.id); }
 console.log('OK entries='+e.length+' positives='+pos.length+' cards='+stems.size);"
```

- [ ] **Step 4: 冻结并提交**

文件头写 `frozenAt`/`labelers`/`reviewers`；提交后该文件只读（R3）。

---

### Task 2: ranked 输出（`rankFlowCards`）

**Files:**
- Modify: `src/services/req-draft-traj/flow-card-recall.js`
- Modify: `scripts/characterization/characterize-flow-card-recall.mjs`

**Interfaces:**
- Produces: `rankFlowCards({ title, taskDraft, cards, k = 5 }) → { flowRef, nodeId, score, candidates: [{ flowRef, score, nodeId }] }`
- 不变量：`matchFlowForAtom` 的返回形状与语义**不变**，内部改为调用 `rankFlowCards(..., k=1)`。

- [ ] **Step 1: 先写失败 pin**

```js
await runAsync('rankFlowCards top-1 matches matchFlowForAtom', async () => {
  const ranked = rankFlowCards({ title: '查询产品列表', taskDraft: '', cards: realCards, k: 5 });
  const single = matchFlowForAtom({ title: '查询产品列表', taskDraft: '', cards: realCards });
  assert.equal(ranked.flowRef, single.flowRef);
  assert.equal(ranked.nodeId, single.nodeId);
  assert.equal(ranked.candidates[0].flowRef, single.flowRef);
  assert.ok(ranked.candidates.length <= 5);
  const scores = ranked.candidates.map((c) => c.score);
  assert.deepEqual(scores, scores.slice().sort((a, b) => b - a), 'candidates must be score-desc');
});
await runAsync('rankFlowCards returns empty candidates on no-hit', async () => {
  const r = rankFlowCards({ title: '写一首关于春天的诗', taskDraft: '', cards: realCards, k: 5 });
  assert.equal(r.flowRef, null);
  assert.deepEqual(r.candidates, []);
});
```

- [ ] **Step 2: 运行确认失败**

- [ ] **Step 3: 实现**

把现有「算全卡得分 → 取 best」的循环改为收集全部得分、过滤阈值、排序、切片 `k`；`matchFlowForAtom` 复用其结果。

- [ ] **Step 4: 运行确认通过 + 复跑既有套件**

```bash
node scripts/characterization/characterize-flow-card-recall.mjs   # 期望 17 passed（15 + 2 新增）
node scripts/characterization/characterize-req-draft-traj.mjs     # 他线在改 propose.js，若红先确认是否他线所致
npm run lint 2>&1 | Select-Object -Last 2
```

- [ ] **Step 5: Commit**

---

### Task 3: 指标运行器

**Files:**
- Create: `scripts/kb/recall-eval.mjs`

**Interfaces:**
- CLI：`node scripts/kb/recall-eval.mjs [--fixture <path>] [--baseline <json>] [--json] [--k 5]`
- 输出 JSON 结构：

```json
{
  "evalVersion": "v1", "k": 5, "generatedAt": "...", "gitHead": "...",
  "metrics": { "accuracyAt1": 0.0, "recallAt5": 0.0, "mrrAt5": 0.0, "ndcgAt5": 0.0,
               "rejectionRate": 0.0, "noiseAccuracyAt1": 0.0,
               "latencyMs": { "warmP50": 0, "warmP95": 0, "coldP50": 0, "coldP95": 0 } },
  "perQuery": [{ "id": "A-001", "query": "...", "gold": ["..."], "top5": ["..."], "rank": 1, "ok": true }],
  "negatives": [{ "id": "N-001", "query": "...", "got": null, "rejected": true }],
  "noise": { "accuracyAt1": 0.0, "delta": 0.0 }
}
```

- [ ] **Step 1: 实现指标计算**

- 正样本用 `rankFlowCards(k)` 的真实排序（**不再用留一法**）；`ok = gold ∩ top1 ≠ ∅`；`rank` = 首个 gold 的 1-based 名次。
- `ndcg@k`：二值相关，`DCG = Σ rel/log2(i+1)`，`IDCG = 1/log2(2) = 1`（单 gold）或按 gold 数计算。
- 负样本 `rejected = (flowRef === null)`。
- 噪声：对 A–D 层 query 追加统一子句后重跑 `Acc@1`，报 Δ。
- 延迟：热态 200 次取 p50/p95；冷态用**新建数组**（`cards.map(c=>({...c}))`）击穿语料画像缓存，测 20 次。

- [ ] **Step 2: 与基线对账**

先用 reviewer 的 20 条 hold-out 跑一次，结果应与 `tmp/kb-eval/baseline.json` 一致（允许 MRR/nDCG 因真实排序而小幅变化，需在报告注明「留一法 → 真实排序」的口径切换）。

- [ ] **Step 3: `--baseline` diff 模式**

超阈值打印逐项 diff 与非零退出。

- [ ] **Step 4: 验收 + Commit**

```bash
node scripts/kb/recall-eval.mjs --json > tmp/kb-eval/v1-run1.json
node scripts/kb/recall-eval.mjs --baseline tmp/kb-eval/baseline.json; echo "exit=$?"
```

---

### Task 4: 门禁（阈值 + 注册）

**Files:**
- Create: `scripts/characterization/characterize-kb-recall-eval.mjs`
- Modify: `scripts/refactor/verify-all.sh`（**只追加一行**）

**Interfaces:**
- 断言：§Spec §6 的七项指标 ≥ 批准阈值；结构校验（条数/分层/无重复/gold 存在）。

- [ ] **Step 1: 先测后定阈值**

用 Task 3 在 v1 上测出基线 → 按「基线 − 余量（Acc@1 −0.05 / MRR −0.08 / nDCG −0.08 / 拒答 −0.05 / 噪声 −0.10）」提案 → **Lead 批准** → 写入。

- [ ] **Step 2: 写 characterization**

打印指标表 + 断言；失败时打印 `perQuery` 退化明细。

- [ ] **Step 3: 注册（独立 commit）**

```bash
run "characterize-kb-recall-eval" node scripts/characterization/characterize-kb-recall-eval.mjs
```

- [ ] **Step 4: 门禁自证**

临时把阈值 +0.2 → 必须红；还原 → 绿。证据落 `tmp/kb-eval/T4-selfproof.txt`。

- [ ] **Step 5: Commit**

---

### Task 5: 跨语言一致性（PY 侧正样本）

**Files:**
- Modify: `scripts/characterization/characterize-kb-recall.py`

- [ ] **Step 1: 增加对评测集正样本的 flowRef 断言**

PY 侧对 A–D 层每条跑 `find_flow_for_task`，与 `gold` 交集非空即通过；不一致条目输出明细并**登记**（不阻塞，因 D3 决策 py 算法未升级）。

- [ ] **Step 2: 报告一致性率**

打印 `py agreement: N/M (xx%)`，写入 Task 6 报告；不设门禁阈值（避免长期红）。

- [ ] **Step 3: 复跑既有契约套件**

`./python/python.exe scripts/characterization/characterize-kb-recall.py` 仍须绿（24 条契约不变）。

---

### Task 6: 基线与趋势报告

**Files:**
- Create: `docs/superpowers/reports/2026-09-09-kb-recall-eval-baseline.md`

- [ ] **Step 1: 报告内容**

指标表（v1 基线 + 与上一轮 20 条 hold-out 的对比 + 口径切换说明）、分层表现（A/B/C/D）、失败条目清单（query → 实得 → gold → 原因分类）、PY 一致率、延迟冷热、Wilson CI。

- [ ] **Step 2: 固化基线 JSON**

`tmp/kb-eval/baseline.json` 内容摘要写进报告附录（文件本身不入库）。

---

### Task 7: 文档收尾

**Files:**
- Modify: `AGENTS.md`
- Modify: `docs/superpowers/todo-list.md`（⑧ 追加一行）

- [ ] **Step 1: AGENTS.md 补一句**

在「KB 召回金样例是唯一跨语言契约」附近补：**质量门禁 = `kb-recall-eval.v1.json`（独立标注）；跨语言契约 = `kb-recall-golden.json`（两侧一致）**，两者职责分离。

- [ ] **Step 2: 收工条目**

agent-log 顶部写收工：完成（commit hash）/ 验收证据 / 遗留。

---

## DoD 矩阵

| Task | 验收命令 | 期望 | 证据 |
|---|---|---|---|
| 0 | 基线复现 | 与 spec 附录基线一致 | `tmp/kb-eval/baseline.json` |
| 1 | 结构自检脚本 | `OK entries≥130 cards≥50` | `tmp/kb-eval/T1-struct.txt` |
| 2 | `characterize-flow-card-recall` | 17 passed | `tmp/kb-eval/T2.txt` |
| 3 | `recall-eval.mjs --json` | 指标 JSON 完整 | `tmp/kb-eval/v1-run1.json` |
| 4 | 门禁自证（阈值 +0.2） | 红；还原绿 | `tmp/kb-eval/T4-selfproof.txt` |
| 5 | `characterize-kb-recall.py` | 24 条契约仍绿 + 打印 agreement | `tmp/kb-eval/T5.txt` |
| 6 | 报告存在且含失败清单 | — | `reports/2026-09-09-kb-recall-eval-baseline.md` |
| 全局 | `bash scripts/refactor/verify-all.sh` | ALL GREEN | `tmp/kb-eval/gate.txt` |
| 全局 | `npm run lint` + blame 归因 | 新增 warning = 0 | `tmp/kb-eval/lint.txt` |

## Reviewer Checklist

1. 读 diff 不读自述；重点看**评测集是否被反推**（gold 与实现输出的重合率异常高即为红旗）。
2. 复跑：DoD 矩阵 + 既有五条基线（req-draft-traj / fk-guard / kb-req-modules / flow-card-recall / py 契约）。
3. 独立抽检评测集：随机 15 条自行判 gold，与文件标注比对；分歧率 >10% 即 FAIL 回炉。
4. 门禁自证：自己动手把阈值抬高，确认真的会红。
5. 反作弊：阈值被改成恒真、评测集条目被删、`excluded` 被滥用、`--baseline` 被绕过、把失败条目从评测集移除后宣称通过 —— 发现即 FAIL。
6. 判定：PASS / FAIL（附复现命令）/ DONE_WITH_CONCERNS。

## 附录 A：基线与探针口径（reviewer 上一轮实测）

- 排序近似：留一法（移除 top-1 后重查）；Task 2 之后改用真实 `rankFlowCards`，口径切换必须写进报告。
- 冷态：`cards.map(c => ({ ...c }))` 新建数组击穿 WeakMap 语料画像缓存。
- 负样本：10 条跨域无关（含 1 例 FP `计算 2 加 3 等于多少` → `collection_scorecard`，应作为回归靶子保留）。
- Wilson 95%：18/20 → [0.699, 0.972]；9/10 → [0.596, 0.982]。
