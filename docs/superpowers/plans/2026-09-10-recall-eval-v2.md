# Recall Eval v2 Implementation Plan（扩版 + 独立标注 + 门禁切换 + T3 重评）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** 把召回评测集从 130 条扩到 **≥230 条**（v1 原样保留 + 新增 ≥100 条全独立，含口语层 E ≥50、负样本 ≥50），把门禁切到 v2 并**重测阈值**，最后用「**旧集建表 → 新集验证**」给 T3 受控词表一个干净的泛化判决。

**Architecture:** 纯**数据与门禁**工程——不改召回算法、不引依赖、不接线 `propose.js`。新增一个冻结评测集文件，门禁**显式**指向它；runner 默认仍指 v1 以保历史对跑。

**Tech Stack:** Node ESM、`scripts/kb/recall-eval.mjs`（指标引擎，单一来源）、`scripts/characterization/characterize-kb-recall-eval.mjs`（门禁）、既有 `kb-recall-failures.v1.json`（建表集，只读）。

**Spec:** `docs/superpowers/specs/2026-09-10-recall-eval-v2-design.md`

**现行生产基线（T2 链态，用作对跑参照）**：Acc@1 **0.740** · Recall@5 **0.847** · MRR@5 **0.784** · nDCG@5 **0.798** · 拒答 **0.633** · 噪声 **0.740**；分层 **A 1.00 / B 0.233 / C 0.867 / D 0.933**（v1，n=100）。

## Global Constraints

- **不改算法、不引依赖、不接线** `propose.js`（T3 未过泛化前禁止接线）。
- **v1 保真**：`kb-recall-eval.v1.json` **一字不改**；v2 中 v1 部分必须与其**逐字段一致**（机械 diff 允许 0 差异）。
- **标注禁跑匹配器**：gold 只从语料（84 卡 + through-chains + 湿测叶名）出发；反推实现输出即作废。
- **建表隔离**：任何资产（词表/别名/阈值）**不得**读 v2 条目来构建；建表只允许用 v1 失败集。
- **阈值只升不降**；改口径 = 改基线 = 须 Lead 批准。
- **门禁切换独立 commit**；切换前必须先出 v1/v2 对跑表。
- 证据落 `tmp/kb-eval-v2/<task-id>/`；每个 Task 一个 commit。

## File map

| Path | Responsibility | Task |
|---|---|---|
| `scripts/characterization/fixtures/kb-recall-eval.v2.json`（新建） | v2 冻结集（v1 130 + 新增 ≥100） | 1,2,3 |
| `scripts/characterization/fixtures/kb-recall-v2-quota.md`（新建） | 分层配额表 + 标注纪律记录 | 0 |
| `scripts/kb/recall-eval.mjs` | 仅当需要时支持 `--fixture`（**已有**）；**不改默认** | 4 |
| `scripts/characterization/characterize-kb-recall-eval.mjs` | **显式**指向 v2 + 新阈值 + A 层下限 | 4 |
| `docs/superpowers/reports/2026-09-10-recall-eval-v2-report.md`（新建） | v1/v2 对跑表 + 阈值提案 + T3 重评判决 | 6 |

---

### Task 0: Pre-flight（开工声明 + v1 盘点 + 配额表）

**Files:** Create `tmp/kb-eval-v2/T0-inventory.txt`、`scripts/characterization/fixtures/kb-recall-v2-quota.md`；Modify `docs/superpowers/agent-log.md`

- [ ] **Step 1: 开工声明并立即 commit**

范围：v2 fixture、配额表、门禁文件、报告、agent-log。
禁入：`propose.js`、`kb-recall-eval.v1.json`、`kb-recall-failures.v1.json`（只读）、`data/kb/req/**`（只读）、`verify-all.sh`、`.cursor/`。

- [ ] **Step 2: v1 盘点（机械统计）**

```bash
node -e "const f=require('./scripts/characterization/fixtures/kb-recall-eval.v1.json');const t={};for(const e of f.entries)t[e.tier]=(t[e.tier]||0)+1;const pos=f.entries.filter(e=>e.tier!=='N');console.log('entries',f.entries.length,JSON.stringify(t),'cards',new Set(pos.flatMap(e=>e.gold)).size)"
```
期望：130 / A40 B30 C15 D15 N30 / 62 卡。

- [ ] **Step 3: 配额表落盘**（写入 `kb-recall-v2-quota.md`）

| 层 | v2 目标 | 来源 |
|---|---|---|
| A 词面一致 | 55–60 | v1 40 原样 + 新增 15–20 |
| B 改写同义 | 45–50 | v1 30 原样 + 新增 15–20 |
| C 场景长句 | 20 | v1 15 原样 + 新增 5 |
| D 别名/短码 | 20 | v1 15 原样 + 新增 5 |
| **E 口语改写（新层）** | **≥50** | 全新 |
| N 负样本 | **≥50**（跨域 30 + 近域 20） | v1 30 原样 + 近域新增 20 |
| **合计** | **≥230**，正 ≥180 / 负 ≥50 | |

覆盖约束：正样本 ≥70 卡；单卡 ≤4；query 无重复。

- [ ] **Step 4: Commit**

---

### Task 1: v2 骨架（v1 原样搬入 + 机械保真校验）

**Files:** Create `scripts/characterization/fixtures/kb-recall-eval.v2.json`

**Interfaces:** entry 增加 `source` 字段（`v1` | `v2-new`）；顶层 `carriedFromV1`、`relabels`（默认空）、`relabelsNote`、`changeLog`。

- [ ] **Step 1: 生成骨架**（脚本搬运，禁止手抄）
- [ ] **Step 2: 机械保真校验（0 差异）**

```bash
node -e "const a=require('./scripts/characterization/fixtures/kb-recall-eval.v1.json');const b=require('./scripts/characterization/fixtures/kb-recall-eval.v2.json');const m=new Map(b.entries.filter(e=>e.source==='v1').map(e=>[e.id,e]));let d=0;for(const e of a.entries){const o=m.get(e.id);if(!o||o.tier!==e.tier||o.query!==e.query||JSON.stringify(o.gold)!==JSON.stringify(e.gold)){d++;console.log('DIFF',e.id)}}console.log('v1-preserved diffs='+d,'count='+m.size+'/'+a.entries.length)"
```
期望：`diffs=0 count=130/130`。

- [ ] **Step 3: Commit**

---

### Task 2: 新增 ≥100 条（标注纪律）

**Files:** Modify `kb-recall-eval.v2.json`；Create `tmp/kb-eval-v2/T2-labeling-log.md`

- [ ] **Step 1: 标注（禁跑匹配器）**

从语料出发生成 query：`data/kb/flows/*.json`（flow/aliases/keywords/menu_path/nodes）+ `data/kb/req/*/through-chains.md` 步骤 + 湿测叶名。
**E 层**：业务口语/近义改写，**不得出现卡面原词**（例：止付→冻结类、要账→催收类、打包管理→集群类）。
**N 层近域 20 条**：同业务域但**无对应卡**（例：贷款展期）；每条写 `whyNegative`。

- [ ] **Step 2: 双人复核 + 歧义剔除**（歧义进 `excluded`，宁少勿脏）
- [ ] **Step 3: 结构自检**

```bash
node -e "const f=require('./scripts/characterization/fixtures/kb-recall-eval.v2.json');const e=f.entries;const t={};for(const x of e)t[x.tier]=(t[x.tier]||0)+1;const pos=e.filter(x=>x.tier!=='N');const per={};for(const x of pos)for(const g of x.gold)per[g]=(per[g]||0)+1;console.log('entries',e.length,JSON.stringify(t),'cards',Object.keys(per).length,'max',Math.max(...Object.values(per)),'dups',e.length-new Set(e.map(x=>x.query)).size,'excluded',(f.excluded||[]).length)"
```

- [ ] **Step 4: Commit**

**DoD**：条目 ≥230；E ≥50；N ≥50（含近域 20）；覆盖 ≥70 卡；单卡 ≤4；dups=0。

---

### Task 3: 冻结 + reviewer G1 抽检

- [ ] **Step 1: 冻结**（`frozenAt`、`labelers`、`reviewers`、`changeLog`；此后只读）
- [ ] **Step 2: reviewer 抽检 15 条（重心在新标部分、不含 v1 种子）** → 分歧 ≤10%，否则回炉
- [ ] **Step 3: 证据落盘 + Commit**

---

### Task 4: 门禁切换（独立 commit）+ 基线重测 + 阈值提案

**Files:** Modify `scripts/characterization/characterize-kb-recall-eval.mjs`

**Interfaces:** 门禁**显式**读 v2（`runRecallEval({ fixture: <v2> })`）；`recall-eval.mjs` 的 `DEFAULT_FIXTURE` **保持 v1 不动**（历史对跑零成本）。

- [ ] **Step 1: v1/v2 对跑表（切换前必出）**

```bash
node scripts/kb/recall-eval.mjs --fixture scripts/characterization/fixtures/kb-recall-eval.v1.json --json > tmp/kb-eval-v2/T4-v1.json
node scripts/kb/recall-eval.mjs --fixture scripts/characterization/fixtures/kb-recall-eval.v2.json --json > tmp/kb-eval-v2/T4-v2.json
```

- [ ] **Step 2: 阈值提案（先测后定，不继承 v1 floor；含 **A 层 ≥0.95**）** → 待 Lead 批准
- [ ] **Step 3: 写入门禁 + `--baseline` 对新基线 exit 0**
- [ ] **Step 4: 证伪自证**：阈值 +0.2 → 必红；还原 → 绿（含 A 层断言）
- [ ] **Step 5: 独立 commit**

---

### Task 5: T3 重评（v1 建表 → v2 验证）

**Files:** 只读 `data/kb/synonyms.json`；Create `tmp/kb-eval-v2/T5-t3-reeval.json`

- [ ] **Step 1: 物理隔离 v2**（构建期不得读 v2 条目；沿用 P0/T3 做法）
- [ ] **Step 2: 用 **v1 失败集**（35 条）建表**（或直接复用现有表 —— 它正是 v1 失败反推产物）
- [ ] **Step 3: 在 v2 上测独立增量**：同一 v2 集，synonyms on/off 对比

```bash
node scripts/kb/recall-eval.mjs --fixture scripts/characterization/fixtures/kb-recall-eval.v2.json --json > tmp/kb-eval-v2/T5-off.json
node scripts/kb/recall-eval.mjs --fixture scripts/characterization/fixtures/kb-recall-eval.v2.json --synonyms --json > tmp/kb-eval-v2/T5-on.json
```

**DoD**：v2 上 **E/B 层独立正增量 > 0 且聚合不退化、拒答不降、A 层不掉** → 通过；否则 **T3 维持停用**（机制保留、不接线、不计成果），并把结论写入报告。

- [ ] **Step 4: Commit**

---

### Task 6: 报告 + 台账

**Files:** Create `docs/superpowers/reports/2026-09-10-recall-eval-v2-report.md`；Modify `todo-list.md`、`agent-log.md`

- [ ] **Step 1: 报告**：v1/v2 对跑表、新基线、阈值与批准记录、分层表现、T3 重评判决、失败清单（新集）
- [ ] **Step 2: agent-log 收工 + todo 更新**
- [ ] **Step 3: Commit**

---

## DoD 矩阵

| Task | 验收命令 | 期望 | 证据 |
|---|---|---|---|
| 0 | v1 盘点 | 130 / A40B30C15D15N30 / 62 卡 | `T0-inventory.txt` |
| 1 | 保真校验 | **diffs=0，count=130/130** | `T1-fidelity.txt` |
| 2 | 结构自检 | 条目 ≥230；E ≥50；N ≥50；≥70 卡；单卡 ≤4；dups=0 | `T2-struct.txt` |
| 3 | reviewer 抽检 | 15 条分歧 ≤10% | `T3-blind-review.txt` |
| 4 | 门禁自证 | 阈值 +0.2 必红；还原绿；`--baseline` exit 0 | `T4-selfproof.txt` |
| 5 | T3 重评 | v2 上独立正增量 > 0 且无退化 | `T5-on.json` / `T5-off.json` |
| 6 | 报告 | 含 v1/v2 对跑表与判决 | report |

## Reviewer Checklist（G1/G2/G3）

1. **G1（数据）**：抽检 15 条自判 gold（重心新标）；核 `source` 字段与 v1 保真 diff；检查 `excluded` 是否真歧义。
2. **G2（纪律）**：v1 文件与 `kb-recall-failures.v1.json` 未被改；建表期未读 v2；阈值经 Lead 批准；门禁切换为独立 commit。
3. **G3（度量）**：reviewer 独立复算 v2 六项 + 分层；**自己动手**抬阈值验证红/绿；反作弊（照抄 v2 条目建表 / query 特判 / 删条目）。
4. **对跑可比性**：v1 数字切换后仍可复现（`--fixture v1`）。

## 附录 A：v1 现状（对跑参照）

- 条目 130（正 100 / 负 30）；A40 B30 C15 D15；覆盖 62 卡；excluded 4。
- 生产基线（T2 链态）：0.740 / 0.847 / 0.784 / 0.798 / 拒答 0.633；分层 A 1.00 / B 0.233 / C 0.867 / D 0.933。
- v1 已知失败 35 条（build/verify 已划分，见 `kb-recall-failures.v1.json`）——**只作建表集，不作验证集**。

## 附录 B：为什么这是 T3 的正确判决方式

P0/T3 失败根因：**建表集与验证集同源且都太小**（18/17）。本版把两件事物理分开——**建表只能用旧集（v1 失败 35 条），验证只在全新集（v2）上**。这样得到的正增量才代表**泛化**，而不是对建表样本的记忆。
