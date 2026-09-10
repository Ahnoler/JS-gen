# KB Recall P0 Three-Lever Implementation Plan（血缘作用域 / ASCII 分词 / 受控词表）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用三条零依赖杠杆提升 KB 召回质量：①按模块血缘做作用域调整（救跨模块误召回）；②camelCase/ASCII 别名分词（救 D 层 null）；③业务受控词表查询扩展（救同义词鸿沟）。每条独立度量、独立回退。

**Architecture:** 新增两个**数据资产**（`data/kb/flow_lineage.json`、`data/kb/synonyms.json`）+ 对 `src/services/req-draft-traj/flow-card-recall.js` 的三处**局部增强**（打分后作用域系数、分词函数同源替换、查询侧低权重扩展）。不改门禁、不改阈值、不改口径、不引依赖、不动 `propose.js`。

**Tech Stack:** Node ESM、既有 `rankFlowCards`/`matchFlowForAtom`、`scripts/kb/recall-eval.mjs` 指标引擎、`scripts/characterization/characterize-kb-recall-eval.mjs` 门禁（已注册，勿再改 `verify-all.sh`）、`scripts/kb/promote_draft.mjs`（补写血缘）。

**Spec:** `docs/superpowers/specs/2026-09-10-recall-p0-three-levers-design.md`

## Approved Decisions（2026-09-10 Lead 裁定：全部按 reviewer 推荐）

| # | 决策 | 采纳结论 |
|---|---|---|
| A1 | 防泄漏（D6） | v1 上**构建/验证五五分离**；划分冻结、分层平衡、报告须给 verify 集**逐条**结果 |
| A2 | 作用域系数 | **先保守 1.15 / 0.92**；转正 <6 条可升至 1.30 / 0.85，升级须同 commit 附对比度量 |
| A3 | DoD 门槛 | 认可下限，另加硬约束：**A 层 1.00 不回退**；T2 九条 null ≥6 转正；**T3 verify 集必须上行** |
| A4 | 组织方式 | 三杠杆一 spec，**独立 commit / 独立度量 / 独立回退** |
| A5 | `propose.js` | **允许动**（无在途声明、工作区干净、基线 `b927a170`）；开工声明须列入；只新增参数不改语义 |

**冻结基线（v1，须逐项对比）**：Acc@1 **0.650** · Recall@5 **0.757** · MRR@5 **0.694** · nDCG@5 **0.708** · 拒答 **0.633** · 噪声 **0.650**；分层 **A 1.00 / C 0.867 / D 0.333 / B 0.233**。

## Global Constraints

- **承接条件**（G3 §8.3）：改 `flow-card-recall.js` → **同 commit** 复跑评测与门禁；**floor 只升不降**；口径与冻结评测集不动。
- **`propose.js`**：A5 允许动，但**只新增** `moduleKey`/`_modules` 注入，不改既有语义；开工声明必须列入该文件；冲突先协调。
- **不动**：`scripts/refactor/verify-all.sh`（门禁已注册 :159）、`kb-recall-eval.v1.json`（冻结）、`data/kb/req/**`（只读）。
- **不引依赖**：不得加入 embedding / BM25 / 向量库 / 新 npm 包。
- **口径不动**：`Recall@5/nDCG@5` 维持 multi-gold 分数化（`hits/|gold|`、`DCG/IDCG`）。
- **证据**：每个 Task 落 `tmp/kb-p0/<task-id>/`；不达标**单项回退**，不连坐。

## File map

| Path | Responsibility | Task |
|---|---|---|
| `scripts/kb/build-flow-lineage.mjs`（新建） | 从 drafts 反查生成血缘资产（幂等） | 1a |
| `data/kb/flow_lineage.json`（新建） | 卡→模块血缘 + `unmapped`/`ambiguous` | 1a |
| `scripts/kb/promote_draft.mjs` | 晋升时补写 `moduleKey`（防再丢） | 1a |
| `src/services/req-draft-traj/flow-card-recall.js` | 作用域系数 / 分词 / 查询扩展 | 1b,2,3 |
| `src/services/req-draft-traj/propose.js` | **仅注入** `moduleKey` 与 `_modules`（A5 允许；不改既有语义） | 1b |
| `data/kb/synonyms.json`（新建） | 业务受控词表 | 3 |
| `scripts/characterization/characterize-flow-card-recall.mjs` | 三组新 pin（既有 17 条不得变） | 1b,2,3 |
| `scripts/characterization/fixtures/kb-recall-failures.v1.json`（新建） | 冻结失败清单 + 构建/验证分离划分 | 0 |
| `docs/superpowers/reports/2026-09-10-recall-p0-report.md`（新建） | 三杠杆度量报告 | 4 |

---

### Task 0: Pre-flight（开工声明 + 失败清单冻结 + 基线复现）

**Files:**
- Create: `scripts/characterization/fixtures/kb-recall-failures.v1.json`
- Create: `tmp/kb-p0/baseline.json`、`tmp/kb-p0/T0-failures.txt`
- Modify: `docs/superpowers/agent-log.md`（开工条目）

- [ ] **Step 1: 开工声明并立即 commit**

范围：`scripts/kb/build-flow-lineage.mjs`、`data/kb/flow_lineage.json`、`data/kb/synonyms.json`、`src/services/req-draft-traj/flow-card-recall.js`、`scripts/kb/promote_draft.mjs`、`scripts/characterization/characterize-flow-card-recall.mjs`、`scripts/characterization/fixtures/kb-recall-failures.v1.json`、report、agent-log。
禁入：`propose.js`、`verify-all.sh`、`data/kb/req/**`（只读）、`kb-recall-eval.v1.json`（冻结）、`.cursor/`。

- [ ] **Step 2: 复现基线（须逐位一致）**

```bash
node scripts/kb/recall-eval.mjs --json > tmp/kb-p0/baseline.json
node scripts/kb/recall-eval.mjs --baseline tmp/kb-eval/baseline-v1.json; echo "exit=$?"
```

- [ ] **Step 3: 冻结失败清单并做构建/验证划分（D6）**

导出 35 条失败（id/query/tier/gold/top1/rank），并**分层五五划分**（B 层两边各半、D 层两边各半）：

```json
{
  "failuresVersion": "v1",
  "generatedAt": "2026-09-10T00:00:00+08:00",
  "source": "kb-recall-eval.v1.json @ <git head>",
  "build": ["B-001", "B-005", "..."],
  "verify": ["B-006", "B-008", "..."],
  "note": "build 仅供 T3 建表；verify 只用于验证，禁止据其反推词条"
}
```

> ⚠️ 划分落盘后**不得再改**；T3 建表时**只能看 build 的条目**。

---

### Task 1: 血缘资产 + 作用域三态

#### 1a. 血缘资产（纯数据，无算法改动）

**Files:** Create `scripts/kb/build-flow-lineage.mjs`、`data/kb/flow_lineage.json`；Modify `scripts/kb/promote_draft.mjs`

**Interfaces:**
- `flow_lineage.json`：`{ lineageVersion, generatedAt, source, cards: {stem: [moduleKey...]}, unmapped: [stem...], ambiguous: [{stem, modules}] }`
- 生成脚本：只读 `data/kb/req/*/drafts/*.json` 与 `data/kb/flows/*.json`，幂等；血缘指向不存在的卡 → **报错**

- [ ] **Step 1: 实现生成脚本**
- [ ] **Step 2: 生成并核对**

```bash
node scripts/kb/build-flow-lineage.mjs
node -e "const l=require('./data/kb/flow_lineage.json');console.log('mapped='+Object.keys(l.cards).length,'unmapped='+l.unmapped.length,'ambiguous='+l.ambiguous.length)"
# 期望 mapped >= 71（86% x 84）、unmapped/ambiguous 显式列出
```

- [ ] **Step 3: promote_draft.mjs 补写 moduleKey**（仅新增字段，不改既有字段）
- [ ] **Step 4: 验证评测指标未变**（纯资产，`--baseline` 应仍 exit 0）
- [ ] **Step 5: Commit**

#### 1b. 作用域三态（算法）

**Interfaces:**
- 新增具名常量导出：`SAME_MODULE_BOOST`、`OTHER_MODULE_PENALTY` —— **先取保守值 1.15 / 0.92**（A2；A 层 1.00 零容错）。仅在「11 条跨模块靶子转正 <6 条」时才允许升至 1.30 / 0.85，**升级须同 commit 附对比度量**
- `rankFlowCards({ title, taskDraft, cards, k, moduleKey })` —— **`moduleKey` 缺省时行为与今完全一致**
- `cards` 可携带 `_modules`（由调用方从血缘注入）；**flow-card-recall 不得直接读文件**（保持纯函数可测）

- [ ] **Step 1: 先写失败 pin**

```js
await runAsync('scope factor: same-module boost / other-module penalty / unmapped neutral', async () => {
  const cards = [ { _stem: 'a', _modules: ['m1'], flow: 'jia', keywords: ['shenqing'] },
                  { _stem: 'b', _modules: ['m2'], flow: 'yi',  keywords: ['shenqing'] },
                  { _stem: 'c', _modules: [],     flow: 'bing', keywords: ['shenqing'] } ];
  const base = rankFlowCards({ title: 'shenqing', taskDraft: '', cards, k: 3 });
  const scoped = rankFlowCards({ title: 'shenqing', taskDraft: '', cards, k: 3, moduleKey: 'm1' });
  assert.equal(scoped.candidates[0].flowRef, 'a');
  const cBase = base.candidates.find((c) => c.flowRef === 'c').score;
  const cScoped = scoped.candidates.find((c) => c.flowRef === 'c').score;
  assert.equal(cScoped, cBase, 'unmapped card must stay neutral');
  const bBase = base.candidates.find((c) => c.flowRef === 'b').score;
  const bScoped = scoped.candidates.find((c) => c.flowRef === 'b').score;
  assert.ok(bScoped < bBase, 'other-module card must be penalized');
});
await runAsync('moduleKey absent => identical to legacy ranking', async () => { /* deepEqual base */ });
```

> 注：pin 用的 title 用拼音占位即可，实现与断言保持一致；真实中文 query 的度量交给评测门禁。

- [ ] **Step 2: 运行确认失败**
- [ ] **Step 3: 实现**（乘系数 → 再走既有阈值判定）
- [ ] **Step 4: 运行确认通过 + 复跑既有 17 条**
- [ ] **Step 5: 接调用方**（在 `propose.js` 注入 `moduleKey` 与 `_modules`）

> **A5 已放行**：`propose.js` 当前无在途声明覆盖、工作区干净、基线 `b927a170`。要求：① 开工声明把 `propose.js` 列入文件集；② 只**新增**参数与透传，不改既有语义；③ 若届时出现他线在途声明，先协调再动。

```js
// 目标形态（示意）：propose 侧把模块归属喂进去，recall 模块保持纯函数
const cards = await listFlowCardsDetailed({});
const lineage = /* 读 data/kb/flow_lineage.json */;
const cardsWithScope = cards.map((c) => ({ ...c, _modules: lineage.cards[c._stem] || [] }));
const hit = matchFlowForAtom({ title, taskDraft, cards: cardsWithScope, moduleKey });
```

- [ ] **Step 6: 度量（DoD）**

```bash
node scripts/kb/recall-eval.mjs --baseline tmp/kb-eval/baseline-v1.json   # 期望 exit 0
node scripts/kb/recall-eval.mjs --json > tmp/kb-p0/T1b-after.json
```

**DoD**：A.1 的 11 条跨模块失败 **≥6 条转正**；**A 层 1.00 保持**；**A.3 的 10 条无血缘项不退化**；拒答 ≥0.633。

- [ ] **Step 7: Commit**

---

### Task 2: camelCase / ASCII 别名分词

**Files:** Modify `src/services/req-draft-traj/flow-card-recall.js`、`scripts/characterization/characterize-flow-card-recall.mjs`

**Interfaces:**
- 新增 `tokenizeCodes(text) → Set<string>`（非字母数字切分 + camelCase 边界拆分 + 整词保留 + 小写）
- `profileTokens` 与 `extractQueryTokens` **同源调用**；**不改 IDF 公式 / 覆盖率地板 / 阈值**

- [ ] **Step 1: 先写失败 pin**

```js
await runAsync('code tokenizer splits camelCase and keeps whole token', async () => {
  const t = tokenizeCodes('enqrPdInf');
  assert.ok(t.has('enqrpdinf'), 'whole token kept (lowercased)');
  for (const part of ['enqr', 'pd', 'inf']) assert.ok(t.has(part), 'camelCase part ' + part);
});
```

- [ ] **Step 2: 运行确认失败 → Step 3: 实现 → Step 4: 运行确认通过**
- [ ] **Step 5: 度量（DoD）**

**DoD**：D 层 Acc@1 **≥0.60**（现 0.333；A.2 的 9 条 null 中至少 6 条转正）；**A/C 不回退**；拒答 ≥0.633；**N-002 靶子必须回到 null**（若因分词变化被命中也算不达标）。

- [ ] **Step 6: Commit**

---

### Task 3: 业务受控词表（构建/验证分离）

**Files:** Create `data/kb/synonyms.json`；Modify `flow-card-recall.js`、`characterize-flow-card-recall.mjs`

**Interfaces:**
- `data/kb/synonyms.json`：`{ synonymVersion, entries: [{ term, expand: [], scope: string|null, source: string }] }`
- 查询侧：命中 `term` → 注入 `expand` 项，权重 = 原权重 × `SYNONYM_WEIGHT`（默认 0.5）；`scope` 有值且与查询模块不匹配 → 不注入

- [ ] **Step 1: 只据 build 集建表（D6 纪律）**

依据 `kb-recall-failures.v1.json` 的 **build** 条目 + 业务通识建词条；每条写 `source`（`业务通识` / `失败反推 <id>`）。**不得查看 verify 集条目来调词条。**

- [ ] **Step 2: 先写 pin**（扩展权重 + scope 门控 + 关闭时行为不变）
- [ ] **Step 3: 实现 → Step 4: 复跑既有 17 条**
- [ ] **Step 5: 度量（DoD）**

**DoD**：B 层 Acc@1 **≥0.35**（现 0.233）；**验证集（verify）必须上行**——只在 build 集上行而 verify 不动 = 过拟合，判不达标；A/C 不回退；拒答 ≥0.633。

- [ ] **Step 6: 报告 build/verify 两套数字与命中条目清单**
- [ ] **Step 7: Commit**

---

### Task 4: 收尾

**Files:** Create `docs/superpowers/reports/2026-09-10-recall-p0-report.md`；Modify `agent-log.md`、`todo-list.md`

- [ ] **Step 1: 报告**：三杠杆各自 before/after（六项 + 分层）、失败转正清单、**未转正清单与原因**、回退与否、`--baseline` 退出码、门禁输出
- [ ] **Step 2: 门禁复核**：`characterize-kb-recall-eval`（4 passed）+ `characterize-flow-card-recall`（17+n passed）
- [ ] **Step 3: lint 归因**：`git blame` 证明新增 warning = 0
- [ ] **Step 4: agent-log 收工条目**（回链 T0）
- [ ] **Step 5: Commit**

---

## DoD 矩阵

| Task | 验收命令 | 期望 | 证据 |
|---|---|---|---|
| 0 | 基线复现 + `--baseline` | 指标 6/6 一致；exit 0 | `tmp/kb-p0/baseline.json` |
| 1a | 血缘生成 | mapped ≥71；unmapped/ambiguous 显式 | `tmp/kb-p0/T1-lineage.txt` |
| 1b | `--baseline` + 逐条 diff | 11 条中 ≥6 转正；A=1.00；10 条无血缘不退化 | `tmp/kb-p0/T1b-after.json` |
| 2 | 同上 | D ≥0.60；A/C 不回退；N-002 回到 null | `tmp/kb-p0/T2-after.json` |
| 3 | 同上 + build/verify 分离 | B ≥0.35 且 **verify 集上行** | `tmp/kb-p0/T3-*.json` |
| 4 | 门禁 + lint | 4 passed；新增 warning 0 | `tmp/kb-p0/gate.txt` |

## Reviewer Checklist（沿用三 gate）

1. **G1（数据资产）**：血缘随机抽 15 张卡人工核对模块归属；词表随机抽 10 条判合理性并核 `source` 真实性。
2. **G2（纪律）**：确认 build/verify 划分未被改；`kb-recall-eval.v1.json` 与阈值未动；`verify-all.sh` 未被改。
3. **G3（算法与度量）**：reviewer 独立复算六项 + 分层；**自己动手**验证 pin 可证伪（如把 boost 调成 5.0 看 A 层是否真掉）；反作弊：词条是否照抄 verify 集 query、是否对评测集 query 特判。
4. **回归集**：A.3 的 10 条 + A.4 靶子逐条复测。

## 附录 A：靶子清单（来自 v1 实测）

**A.1 跨模块误召回（作用域靶子，11 条）**
B-005 两家机构合并怎么登记（asset-preserve-ops→system-mgmt）· B-006 担保物登记（collateral-func→collateral-info）· B-010 企业信用等级评定（credit-retail→rating）· B-012 发起对公授信（loan-corp→credit-corp）· B-013 企业借钱用款（customer-group→loan-corp）· B-014 贷款打款（loan-corp→disburse）· B-022 催收外包（customer-group→asset-preserve-ops）· B-024 受托支付（limit-ctrl-api→disburse）· B-027 产业链小企业打包（loan-corp→customer-group）· B-028 子公司挂总户头（product-mgmt→customer-group）· B-029 股东关系登记（customer-group→customer-common）

**A.2 D 层 null（分词靶子，9 条）**
D-001 `W0` · D-002 `lmtRgstAndOcp` · D-003 `lmtRgst` · D-004 `doOcpRevoke` · D-005 `cstInfQuery` · D-006 `enqrPdInf` · D-007 `mntPdStg` · D-008 `cpctMgtPg` · D-009 `FS00006502`

**A.3 不许退化集（无血缘 gold，10 条）**
B-001(`limit`) · B-008(`customer_360`) · B-009(`customer_query`) · B-015(`duigong_contract_sign`) · B-016(`guarantee_intro`) · B-020(`collateral_seizure`) · C-001/D-001(`session_login`) · D-005(`customer_query`) · D-010(`customer_360`)

**A.4 FP 靶子**：N-002 `计算 2 加 3 等于多少` → 现命中 `collection_scorecard`；**目标是回到 null**。
