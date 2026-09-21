# Colloquial Bridge Implementation Plan（口语桥接：E 层与近域 FPR 靶区）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** 用**领域语料建的桥接表**修 v2 照出的两个靶区——E 层口语改写（Acc@1 0.100）与近域负样本误命中（FPR 0.92）——**零依赖、可辩护、达标才接线**。

**Architecture:** 沿用已落地的 opt-in 扩展机制（`applySynonymExpansion` + `SYNONYM_WEIGHT` + `scope` 门控），**只换资产与建法**：新文件 `data/kb/colloquial-bridge.json` 由三类**领域语料**（卡面同义 / 需求文档 / 湿测 drift 记录）构建，**禁止使用任何评测失败条目**。不改算法、不改评测集、不改门禁阈值。

**Tech Stack:** Node ESM、既有 `rankFlowCards({synonyms})`、`scripts/kb/recall-eval.mjs`（指标引擎）、`scripts/characterization/characterize-kb-recall-eval.mjs`（v2 门禁）、`data/kb/req/*/{chapters,wet-test.md,through-chains.md}`（素材）。

**Spec:** `docs/superpowers/specs/2026-09-10-recall-colloquial-bridge-design.md`

## Approved Decisions（2026-09-10 Lead 裁定：全部按 reviewer 推荐）

| # | 决策 | 采纳结论 |
|---|---|---|
| B1 | 方向重定位 | 口语桥接为主；**BM25 押后**；**embedding 另立项**（不做） |
| B2 | E 层目标 | **≥0.25**（现 0.100），刻意压低防过拟合 |
| B3 | 素材配比 | **A+B ≥60%、C（wet-test drift）≤40%**；每条 C 引到「模块 + 叶号」 |
| B4 | 接线 | **达标即授权**（条件见 B5）；**独立 commit** 便于回退 |
| B5 | 接线验收（新增） | 除门禁 5 passed 外，须有**端到端证据**：真实 `proposeDraftTrajectories`（tmp 副本 + 假 LLM）证明桥接表被加载且 `moduleKey` scope 门控生效 |

**v2 基线（门禁现行）**：Acc@1 **0.600** · Recall@5 0.725 · MRR@5 0.653 · nDCG@5 0.667 · 拒答 **0.382**；分层 A **1.00** / B 0.400 / C 0.900 / D 0.900 / **E 0.100**；FP 集合 34 条。

## Global Constraints

- **零依赖**：不引 BM25 / embedding / 任何新包（§0 可行性结论）。
- **建表禁读评测失败**：`kb-recall-eval.v2.json` 与 `kb-recall-failures.v1.json` 在建表期**物理隔离**（G2 专查）。
- **不改**：召回主算法、评测集、门禁阈值、`verify-all.sh`、`data/kb/req/**`（只读）。
- **不复活** `data/kb/synonyms.json`（`unvalidated`，作为反例保留）。
- **达标才接线**；未达标 → 资产置 `status: archived`，**不计成果**。
- 阈值只升不降；floor 不变。

## File map

| Path | Responsibility | Task |
|---|---|---|
| `scripts/kb/build-colloquial-bridge.mjs`（新建） | 从三类素材抽候选 + 双向校验（纯语料 grep） | 1,2 |
| `data/kb/colloquial-bridge.json`（新建） | 桥接表 v1（40–80 条，每条带 source） | 2 |
| `scripts/characterization/characterize-flow-card-recall.mjs` | 新增 3 条 pin（加载/scope 门控/空表不变） | 2 |
| `src/services/req-draft-traj/propose.js` | **仅达标后**：注入桥接表 + moduleKey（不改既有语义） | 4 |
| `docs/superpowers/reports/2026-09-10-colloquial-bridge-report.md`（新建） | 建表来源统计 + 增量度量 + 达标/归档判决 | 5 |

---

### Task 0: Pre-flight（开工声明 + 基线复现 + 素材可得性实证）

- [ ] **Step 1: 开工声明并立即 commit**

范围：`scripts/kb/build-colloquial-bridge.mjs`、`data/kb/colloquial-bridge.json`、`characterize-flow-card-recall.mjs`、报告、agent-log；**条件性**含 `propose.js`（仅 T4 达标后）。
禁入：`kb-recall-eval.v2.json`、`kb-recall-failures.v1.json`（**建表期物理隔离**）、`data/kb/synonyms.json`、`verify-all.sh`、`data/kb/req/**`（只读）、`.cursor/`。

- [ ] **Step 2: v2 基线复现（须逐位一致）**

```bash
node scripts/kb/recall-eval.mjs --fixture scripts/characterization/fixtures/kb-recall-eval.v2.json --json > tmp/kb-bridge/T0-baseline.json
node scripts/characterization/characterize-kb-recall-eval.mjs   # 期望 5 passed
```
期望：0.600 / 0.725 / 0.653 / 0.667 / 拒答 0.382；E 层 0.100。

- [ ] **Step 3: 素材可得性实证**（三类各抽 5 例，证明能抽出候选）
  - A 卡面同义：`data/kb/flows/*.json` 内 `flow/aliases/keywords` 的**非同形近义**
  - B 需求语料：`data/kb/req/*/chapters/*.md`、`through-chains.md` 中括号/并列替代说法
  - C 湿测 drift：`data/kb/req/*/wet-test.md` 中类别为 `wording` 的行（「文档口径 vs SUT 实测」成对）
- [ ] **Step 4: Commit**

---

### Task 1: 候选抽取脚本

**Files:** Create `scripts/kb/build-colloquial-bridge.mjs`

**Interfaces:**
- 输出候选池 `tmp/kb-bridge/candidates.json`：`{ term, expand, sourceKind, sourceRef, evidence }`
- **只读语料**，不读任何评测文件；纯字符串/正则处理，**不得 import 召回模块**（防"无意跑匹配器"）

- [ ] **Step 1: 实现三类抽取器**（各带 `sourceRef` 定位到文件 + 行/叶号）
- [ ] **Step 2: 运行并统计**：每类候选数、去重后总数（目标池 ≥150，终表 40–80）
- [ ] **Step 3: Commit**

---

### Task 2: 双向校验 + 人工裁决 + 落表

- [ ] **Step 1: 双向校验（机械）**
  - `term` 侧：必须在真实业务文本中有出现可能（在 chapters/through-chains/wet-test 中出现过）
  - `expand` 侧：必须能在目标卡面命中（`data/kb/flows` grep）
  - **禁跑匹配器**；校验脚本与召回模块零 import
- [ ] **Step 2: 人工裁决**（逐条判可辩护性；剔除过泛/歧义/纯同形）
- [ ] **Step 3: 落表** `data/kb/colloquial-bridge.json`（`status: "candidate"`，每条带 `source`）
- [ ] **Step 4: 新增 3 条 pin**（`characterize-flow-card-recall.mjs`）：桥接表可加载 / scope 门控生效 / **空表或不传时字节不变**
- [ ] **Step 5: 复跑** `characterize-flow-card-recall`（期望 26 passed）

- [ ] **Step 6: Commit**

**DoD**：终表 40–80 条；**每条 source ∈ {corpus-card, corpus-req-doc, wet-test-drift}**；**配比 A+B ≥60% / C ≤40%**（B3）；C 类每条引到「模块 + 叶号」；0 条来自评测失败；pin 全绿。

---

### Task 3: 离线增量度量（达标判定）

- [ ] **Step 1: on/off 对比（只跑 v2）**

```bash
node scripts/kb/recall-eval.mjs --fixture scripts/characterization/fixtures/kb-recall-eval.v2.json --json > tmp/kb-bridge/T3-off.json
node scripts/kb/recall-eval.mjs --fixture scripts/characterization/fixtures/kb-recall-eval.v2.json --synonyms data/kb/colloquial-bridge.json --json > tmp/kb-bridge/T3-on.json
```

- [ ] **Step 2: 逐条归因（必须按 `source` 与层拆）**
  - **全新地面增量** = 翻转条目中 `source: v2-new` 的条数（**这是唯一计功的口径**）
  - 同时报 v1 携带条目的翻转数（**仅作参照，不计功**）
- [ ] **Step 3: 达标判定**

| 判据 | 门槛 |
|---|---|
| E 层 Acc@1 | **≥0.25** |
| 全新地面独立增量 | **≥4 条** |
| A 层 | ≥0.95（现 1.00，不得掉） |
| B / C / D | ≥0.400 / 0.900 / 0.900 |
| 拒答率 | ≥0.382，**零新增 FP** |

- [ ] **Step 4: Commit**（证据+度量；**不接线**）

---

### Task 4: 接线（**仅当 T3 全过**）

- [ ] **Step 1: 接线 `propose.js`**：加载 `data/kb/colloquial-bridge.json` + 传 `synonyms` 与 `moduleKey`（scope 门控）；**只新增参数与透传，不改既有语义**；开工声明已含该文件（A5 先例）
- [ ] **Step 2: 空路径不变式**：桥接表缺失/损坏时退化为不扩展（warn 不红）
- [ ] **Step 2b: 端到端证据（B5 硬要求）**：在 tmp 副本 + 假 LLM 上跑真实 `proposeDraftTrajectories`，证明 ① 桥接表被加载；② `moduleKey` 传入且 scope 门控生效（构造一条 scope 不匹配的条目验证不注入）；③ 无桥接表时行为与接线前一致
- [ ] **Step 3: 复跑门禁**：`characterize-kb-recall-eval` 5 passed、`characterize-flow-card-recall` 26 passed、`--baseline` exit 0
- [ ] **Step 4: Commit**（独立 commit，便于回退）

> **若 T3 未达标**：跳过 T4，把 `colloquial-bridge.json` 置 `status: "archived"` 并在报告写明"本版不计成果"，直接进 T5。

---

### Task 5: 报告 + 台账

- [ ] **Step 1: 报告**：素材来源统计（三类各多少条）、候选→裁决漏斗、on/off 全表、**全新地面增量**、达标/归档判决、若接线则附生产口径
- [ ] **Step 2: agent-log 收工 + todo 更新**
- [ ] **Step 3: Commit**

---

## DoD 矩阵

| Task | 验收命令 | 期望 | 证据 |
|---|---|---|---|
| 0 | 基线复现 + 素材抽 5 例 | 0.600/0.382/E 0.100；三类素材均可抽 | `T0-baseline.json`、`T0-material.txt` |
| 1 | 候选池生成 | ≥150 条候选，各带 sourceRef | `candidates.json` |
| 2 | 终表 + pin | 40–80 条、source 全合规、pin 26 passed | `T2-bridge.txt` |
| 3 | on/off 度量 | E ≥0.25；**全新地面 ≥4**；零新增 FP | `T3-on.json` / `T3-off.json` |
| 4 | 接线（条件性） | 门禁 5 passed；空表退化为不变 | `T4-wired.txt` |
| 5 | 报告 | 漏斗 + 归因 + 判决 | report |

## Reviewer Checklist（G1/G2/G3）

1. **G1（资产）**：抽检 **10 条**桥接条目 — 核 `source` 真实性（回原文找到证据）+ 判合理性；**核 0 条来自评测失败**。
2. **G2（纪律）**：建表脚本与召回模块**零 import**；建表期未读 v2/失败清单；`synonyms.json` 未被复活；门禁/评测集/阈值未动；接线为独立 commit。
3. **G3（度量）**：reviewer 独立复算 v2 六项 + E 层 + **全新地面增量**；反作弊（桥接条目是否照抄 E 层 query、是否 query 特判）。
4. **判决**：达标 → 允许接线；不达标 → 资产归档、不计成果（**不接受"接近达标"**）。

## 附录 A：靶区与素材线索

- **E 层样例**：`把客户的口子先封住不让他接着支取`（→ limit）；`拼盘里跟投的那家行怎么发起自己的那份`（→ 参与行社团子用信）
- **近域负样本**：25 条中 23 条误命中（`loan` / `approval_chain` / `product_query` …）—— 本版**只要求不恶化**
- **素材 C 线索**：`data/kb/req/*/wet-test.md` 的 `wording` 类 drift（例：文档「提交流程」vs SUT「流程提交」）——仓库独有、可回溯到叶号
- **反例**：`data/kb/synonyms.json`（16 条失败反推，泛化 1/115）——**不要照抄它**

## 附录 B：为什么不做 BM25 / embedding（写进计划防止返工）

- BM25 依赖**词面重叠**，E 层恰恰是"无卡面词"的口语 → **原理上无效**；
- embedding 在仓库内**只有 schema 没有实现**（`special_element` 的 embedding 列无计算侧），且每次查询走网络会让热态 **p95 0.14ms → 数十~数百 ms**（propose 逐原子调用）；
- 两者都需**独立立项**（embedding 需 Lead 决策端点/模型/存储/离线降级），**不得混入本线**。
