# 口语桥接收尾计划（F-2 / F-5 / R-1）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 关闭口语桥接线的三笔挂账——F-2（`T2-bridge.txt` 修正未入库）、F-5（入库的生成脚本会把归档资产还原回 `candidate`）、R-1（`--synonyms` 资产 `status` 留痕 + 告警）——并让台账与 HEAD 一致。

**Architecture:** 只做加法。F-2 是一个文件入库；F-5 是把生成脚本的产物对齐**已归档**的表（重跑成为幂等 no-op）；R-1 在度量引擎里加"留痕 + 告警"，**不触碰任何加载/度量语义**。

**Spec:** `docs/superpowers/specs/2026-09-10-colloquial-bridge-closeout-decisions.md`
**判决:** `docs/superpowers/reports/2026-09-10-colloquial-bridge-g-verdict.md`（`666e0215` + §5 收尾复核 `33da2125`）

## Global Constraints

- **不加依赖**、不引新包；**不改**评测集、阈值、`data/kb/synonyms.json`、`data/kb/req/**`、`verify-all.sh`、他线 WIP。
- **不禁用**任何加载行为：`status` 只用于留痕/告警，**绝不作为过滤器**。
- 一 Task 一 commit；只 stage 本线文件；agent-log 开工/收工按协议。
- 收尾期间 `data/kb/colloquial-bridge.json` 的 `entries` **必须逐位不变**（sha256 `eb4ec272…`，67 条）——任何改动都是事故。

---

### Task 0: F-2 + F-5 收口（同一 commit）

- [ ] **Step 1: F-2 —把已改好的 `T2-bridge.txt` 入库**

`tmp/` 被 `.gitignore` 忽略、该文件已是 tracked，仅工作区有 1 行 `note` 改动：

```bash
git status --porcelain tmp/kb-bridge/        # 期望 " M tmp/kb-bridge/T2-bridge.txt"
git add -f tmp/kb-bridge/T2-bridge.txt
git diff --cached --stat                      # 期望 1 insertion(+), 1 deletion(-)
```

> **禁止**为了"重新生成"这个文件去跑 `t2-build-table.mjs`（见 Step 2：跑之前它会覆盖表的归档态）。

- [ ] **Step 2: F-5 —生成脚本幂等化**

现状：`t2-build-table.mjs` 的 table 字面量为 `status: 'candidate'`，且不含 `archiveNote` / `archivedSemantics`；头注释写着 `Run: node tmp/kb-bridge/t2-build-table.mjs`。**任何人重跑一次就会把表打回 `candidate` 并抹掉 F-4 注记。**

改法（**从当前 `data/kb/colloquial-bridge.json` 原样复制**两个注记字段的字符串，一个字都不要改写）：

1. table 字面量补 `status: 'archived'`、`archiveNote: '<原样>' `、`archivedSemantics: '<原样>'`；
2. 头注释加一行警示：`重跑会重写 data/kb/colloquial-bridge.json 与 tmp/kb-bridge/T2-bridge.txt；产物必须与归档态逐位一致（status/两个注记不得丢失）`。

- [ ] **Step 3: 幂等性验收（真跑一次，这是本 Task 的核心证据）**

要求工作区除本 Task 改动外干净；然后：

```bash
node tmp/kb-bridge/t2-build-table.mjs
git diff --stat data/kb/colloquial-bridge.json tmp/kb-bridge/T2-bridge.txt
```

**期望：`git diff` 为空**（脚本产物 == 归档态，重跑安全）。若不为空，说明字段值没对齐，**修脚本而不是改表**。

- [ ] **Step 4: 复核度量未受影响（不必重跑评测）**

```bash
node -e "const j=require('./data/kb/colloquial-bridge.json');const c=require('crypto').createHash('sha256').update(JSON.stringify(j.entries)).digest('hex');console.log(c, j.entries.length, j.status)"
# 期望 eb4ec272ec40e3a76d38febc19009d26d476533c5a0761ee75ffcaacbb1e6197 67 archived
```

- [ ] **Step 5: Commit**

```
fix(kb): colloquial bridge closeout — T2-bridge pointer now in git; generator made idempotent with the archived table
```

---

### Task 1: R-1 —— `--synonyms` 资产 status 留痕 + 告警（独立 commit）

**Files:** `scripts/kb/recall-eval.mjs`、`scripts/characterization/characterize-kb-recall-eval.mjs`

- [ ] **Step 1: 留痕**：`--synonyms` 模式下，资产**声明了** `status` 时把它写入 `result.synonyms.status`；未声明则不出现该字段（历史产物形状不变）。
- [ ] **Step 2: 告警**：`status` 存在且 ≠ `'active'` 时，向 **stderr** 打一行 `[recall-eval] synonyms asset status="<x>" — 仅限度量口径，禁止接线`。**不影响 exit code、不写入 metrics、不改变加载条数**。
- [ ] **Step 3: pin（`characterize-kb-recall-eval.mjs`，5 → 6 passed）**：三态断言——① 带 `status:"archived"` 的临时资产 → 条目**全量加载**（计数与资产 `entries.length` 相等，证明确实没被过滤）+ status 被暴露；② 无 `status` 的临时资产 → 与现状完全一致（无新字段）；③ 告警不改变指标与 exit code。临时资产写 `tmp/`，**不得落 `data/`**。
- [ ] **Step 4: 门禁复跑（三条命令 + 一条等价性证据）**

```bash
node scripts/characterization/characterize-kb-recall-eval.mjs      # 期望 6 passed
node scripts/characterization/characterize-flow-card-recall.mjs    # 期望 26 passed
node scripts/kb/recall-eval.mjs --fixture scripts/characterization/fixtures/kb-recall-eval.v2.json --baseline tmp/kb-bridge/T0-baseline.json > /dev/null; echo $?   # 期望 0
node scripts/kb/recall-eval.mjs --fixture scripts/characterization/fixtures/kb-recall-eval.v2.json --synonyms data/kb/colloquial-bridge.json --json > tmp/kb-bridge/T3-on.after.json
# 期望：六项指标与 T3-on.json 逐位相同（差异仅 generatedAt/gitHead/新增 status 字段/延迟计时）
```

- [ ] **Step 5: Commit**（独立、可回退）

```
feat(kb): recall-eval records synonyms asset status + warns on non-active (provenance only, no filtering)
```

---

### Task 2: 台账对齐

- [ ] **Step 1**: 报告 §8 的 F-2 行补一句「`.txt` 于 `<hash>` 入库；生成脚本已幂等化（重跑 `git diff` 为空）」；F-4 行追加「R-1 留痕已实施（`<hash>`），loader 仍不过滤」。
- [ ] **Step 2**: agent-log 收工条目（回链 23:23 开工 `d41cb787` 与本次复核）＋ todo-list 更新为「CLOSED（FAIL，不计成果；F-1/F-3/F-4 关闭，F-2/F-5/R-1 已收口）」。
- [ ] **Step 3**: Commit。

---

## DoD 矩阵

| Task | 验收命令 | 期望 |
|---|---|---|
| 0 | `node tmp/kb-bridge/t2-build-table.mjs && git diff --stat` | 空 diff（幂等）；`entries` sha256 不变 |
| 0 | `git status --porcelain tmp/kb-bridge/` | 干净 |
| 1 | `characterize-kb-recall-eval` | **6 passed** |
| 1 | `characterize-flow-card-recall` | **26 passed** |
| 1 | `--baseline` exit code | **0** |
| 1 | ON 复跑 vs `T3-on.json` | 六项指标逐位相同 |
| 2 | 报告 §8 / agent-log / todo | 与 HEAD 一致 |

## Reviewer Checklist

1. **F-2**：`git show HEAD:tmp/kb-bridge/T2-bridge.txt` 的 `note` 已是「汇总原则非逐条理由」，且工作区无残留 dirty；
2. **F-5**：脚本产物字面量为 `status:'archived'` + 两注记；**幂等性由一次真跑 + 空 diff 证明**（不是"看了一眼改好了"）；
3. **R-1**：pin 必须能证伪——把 `status` 过滤加进去，① 号断言必须红；把告警改成改 exit code，③ 号断言必须红；
4. **不许顺手改**：加载条数、metrics、阈值、`synonyms.json`、`colloquial-bridge.json` 的 `entries`。
