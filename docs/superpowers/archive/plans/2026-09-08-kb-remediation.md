# KB Remediation Implementation Plan（切片 / 存储 / 召回 / 草稿交易）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox ([`-`]) syntax for tracking.

**Goal:** 修复「需求切片 → 草稿交易 → 录制」链路的幂等、缓存失效、出处锚点与召回质量问题，使同一需求切片在任意次重跑下产出稳定的原子草稿，并且召回可测、可控、可跨语言一致。

**Architecture:** 不改变产品语义（人审勾选 / 不自动录制 / 出处硬约束）。改动集中在四处：① `req-draft-traj/*`（atomKey、缓存、错误语义、召回）；② `trajectory-dao.js` + 迁移（幂等唯一性、出处哈希）；③ `routes/v2/kb.js` + api-docs（validate 端点、字段透出）；④ `scripts/kb/*` + characterization（金样例、门禁）。

**Tech Stack:** Node ESM (Express control plane)、Knex/MySQL 迁移、`scripts/characterization/*`（pin 式断言）、`scripts/kb/*`（Python 侧 KB）、api-docs catalog `src/dashboard/api-docs/groups/kb.js`。

**Spec:** `docs/superpowers/specs/2026-09-08-kb-remediation-design.md`

**被审快照:** HEAD `93cd430f`（审查期间由 `475328d4` 推进而来）→ 现行快照 `e8127000`

## Approved Decisions（2026-09-08 Lead 裁定：全部按 reviewer 推荐）

| # | 决策 | 采纳结论 |
|---|---|---|
| D1 | 幂等实现 | `req_atom_seq` 列 + 唯一索引 `(req_module_key, req_atom_key, req_atom_seq)` |
| D2 | 出处锚点范围 | 本版只做 `req_source_hash` + `req_chunk_id`；段落级锚点另立项 |
| D3 | Python 召回改调控制面 HTTP | **不做**；先共享金样例（Task 7） |
| D4 | 上传中间件 | **复用** `multer ^2.2.0` + `src/http/upload-xlsx.js`，不新增依赖 |
| D5 | 已晋升 drafts | 打 `promotedAt` 标记，保留存档 |
| D6 | 召回依赖 | 本版不引入向量/BM25；只做确定性升级 |
| D7 | 历史 atomKey 回填 | 执行（旧键截前 3 段；687/688/689 一并回填） |

## Global Constraints

- **R1 characterization 是 pin 不是测试**：`scripts/characterization/*` 用 `read_text` 断言源码子串。改实现必须**同 commit** 更新对应断言；**禁止**恒真化、删除、跳过。
- **R2 api-docs 是前端唯一契约**：任何字段/语义变更必须同步 `src/dashboard/api-docs/groups/kb.js`。
- **R3 JSDoc**：核心公开函数必须 `@param`/`@returns`；`npm run lint` 不得新增 warning；加注释时严禁删改已有代码行。
- **R4 迁移规范**：`migrations/YYYYMMDDHHMMSS_name.js`，`up`/`down` 成对 + `hasColumn` 守卫，风格对齐 `20260907120000_trajectory_req_provenance.js`。
- **R5** 不维护 `CHANGELOG.md`；变更史写 commit message。
- **R6** 每个微步跑 `bash scripts/refactor/verify-all.sh`（**先做 Task 0** 修好其顺序缺陷）。
- **R7 禁止烧执行机**：全程不得调用 `prepare` / `record/start` / `detach`。
- **R8 禁止伪造证据**：不得手改 `data/kb/req/**/.draft-traj-propose.json` 或 `data/kb/flows/**` 让验收通过；不得在召回实现里对金样例 query 特判。
- **并发**：开工前必须确认工作区不处于半成品态（见 Task 0）。`pageCodes` 特性已于 `e8127000` 落地（`atom-keydata.js` + `characterize-req-draft-traj` OK 26），但仓库多会话并行，**每个 Task 开工前都要重跑 Task 0 Step 4**；若出现未落地依赖，只做 D 线任务（Task 5/10/11/12/13/14）。

## File map

| Path | Responsibility | Task |
|---|---|---|
| `src/services/req-draft-traj/parse-through-chains.js` | `buildAtomKey` 去 title | 1 |
| `src/dao/trajectory-dao.js` | 幂等查重改全状态；透出 seq/hash/chunk 字段 | 1/2/5 |
| `src/services/req-draft-traj/commit.js` | 写 seq、校验哈希/章节、透传 paasUserId、抽 validate 纯函数 | 2/3/5/9 |
| `src/services/req-draft-traj/propose-cache.js` | cacheVersion/sourceHash/原子写 | 3 |
| `src/services/req-draft-traj/propose.js` | 错误语义、functionIdCandidates、kind、truncated | 4/8/13 |
| `src/services/req-draft-traj/flow-card-recall.js` | 术语化 + IDF + 极性消歧 | 6 |
| `src/services/req-draft-traj/provenance.js` | 可解释加权 + 章节内容缓存 + chunkId/hash | 5/6 |
| `src/routes/v2/kb.js` | validate 端点 | 9 |
| `src/dashboard/api-docs/groups/kb.js` | 契约同步 | 1/3/4/5/8/9/13 |
| `scripts/kb/recall.py` | 共享金样例断言 | 7 |
| `scripts/kb/promote_draft.mjs` | 已晋升卡打标 | 12 |
| `scripts/refactor/verify-all.sh` | 门禁顺序修复 | 0/12 |
| `scripts/characterization/fixtures/kb-recall-golden.json` | 跨语言金样例 | 6/7 |
| `data/kb/staging/propose-runs.jsonl`（运行期生成） | 观测指标 | 10 |
| `migrations/<ts>_req_atom_key_stable.js` | 历史键回填 | 1 |
| `migrations/<ts>_req_atom_seq_unique.js` | seq + 唯一索引 | 2 |
| `migrations/<ts>_req_source_anchor.js` | source_hash + chunk_id | 5 |

---

### Task 0: Pre-flight（门禁修复 + 基线证据）

**Files:**
- Modify: `scripts/refactor/verify-all.sh`（把两条 KB 套件移到 `ALL GREEN` 之前）
- Create: `tmp/kb-remediation/D0/`（基线证据）

**Interfaces:**
- Produces: 可信任的门禁（失败即非零退出）；基线快照

- [ ] **Step 1: 修 verify-all 顺序**

当前 `scripts/refactor/verify-all.sh:148-155` 把 `characterize-kb-staging` / `characterize-kb-promote` 排在 `echo "verify-all: ALL GREEN"` **之后**，失败不影响退出码。把这两行移到 `if [ "$FAILED" -ne 0 ]` 之前。

- [ ] **Step 2: 自证门禁生效**

```bash
# 临时把 characterize-kb-staging 改成必失败（例如指向不存在文件），运行，确认整体 FAIL，然后还原
bash scripts/refactor/verify-all.sh; echo "exit=$?"
```

- [ ] **Step 3: 落基线证据**

```bash
git log --oneline -5 > tmp/kb-remediation/D0/git-head.txt
git status --short > tmp/kb-remediation/D0/git-status.txt
node scripts/characterization/characterize-req-draft-traj.mjs > tmp/kb-remediation/D0/char-req-draft-traj.txt 2>&1
node tmp/kb-remediation/D0/probe-stats.mjs > tmp/kb-remediation/D0/module-stats.jsonl   # 见附录 A.4
```

- [ ] **Step 4: 确认并发态**

`pageCodes` 特性已于 `e8127000` 落地（`src/services/req-draft-traj/atom-keydata.js` 存在，`characterize-req-draft-traj` OK 26）。仍按以下判据确认：

```bash
Test-Path src/services/req-draft-traj/atom-keydata.js
node scripts/characterization/characterize-req-draft-traj.mjs   # 期望 OK 26+（基线由 25 升至 26）
git status --short src/services/req-draft-traj/
```

若出现未落地依赖（模块缺失 / characterization 报 `ERR_MODULE_NOT_FOUND` / 目标文件处于 `M` 半成品态）：**记录到 `tmp/kb-remediation/D0/concurrency-note.md` 并只做 D 线任务**（Task 5/10/11/12/13/14），等对方收尾后再开 A/B/C 线。

- [ ] **Step 5: Commit**

```bash
git add scripts/refactor/verify-all.sh
git commit -m "fix(gate): run kb-staging/kb-promote characterizations before the green banner"
```

---

### Task 1: Stable atomKey + backfill (F-01, P0)

**Files:**
- Modify: `src/services/req-draft-traj/parse-through-chains.js`（`buildAtomKey` ~238）
- Modify: `src/services/req-draft-traj/propose.js`（两处调用点：multi_write 分支 + 正常分支）
- Create: `migrations/<ts>_req_atom_key_stable.js`
- Test: `scripts/characterization/characterize-req-draft-traj.mjs`
- Modify: `src/dashboard/api-docs/groups/kb.js`

**Interfaces:**
- Produces: `buildAtomKey({ moduleKey, chainId, stepIndex }) → '<module-slug>:<chain-slug>:<step-index>'`；`stepIndex` 非法时用 `'0'`

- [ ] **Step 1: 先写失败断言（pin 先行）**

在 `characterize-req-draft-traj.mjs` 增加：

```js
await runAsync('buildAtomKey is title-independent and stable', async () => {
  const { buildAtomKey } = await import(pathToFileURL(join(ROOT, 'src/services/req-draft-traj/parse-through-chains.js')).href);
  assert.equal(
    buildAtomKey({ moduleKey: 'product-mgmt', chainId: 'chain-a', stepIndex: 2 }),
    'product-mgmt:chain-a:2',
  );
  assert.equal(buildAtomKey({ moduleKey: 'product-mgmt', chainId: 'chain-a' }), 'product-mgmt:chain-a:0');
});
```

- [ ] **Step 2: 运行确认失败**

```bash
node scripts/characterization/characterize-req-draft-traj.mjs   # 期望 FAIL（当前签名要求 title）
```

- [ ] **Step 3: 实现**

`buildAtomKey` 改为：

```js
export function buildAtomKey({ moduleKey, chainId, stepIndex }) {
  const mod = slugPart(moduleKey);
  const chain = slugPart(chainId);
  const idx = Number(stepIndex);
  const step = Number.isFinite(idx) ? String(idx) : '0';
  return `${mod}:${chain}:${step}`;
}
```

同步更新两处调用点（去掉 `title` 入参）。

- [ ] **Step 4: 运行确认通过**

```bash
node scripts/characterization/characterize-req-draft-traj.mjs   # 期望 OK 26+
bash scripts/refactor/verify-all.sh
```

- [ ] **Step 5: 历史键回填迁移**

旧键形如 `a:b:c:title-slug`；`slugPart` 已把 `:` 归一为 `-`，故截前 3 段安全。

```js
export async function up(knex) {
  const rows = await knex('trajectory').select('id', 'req_atom_key').whereNotNull('req_atom_key');
  const affected = rows.filter((r) => String(r.req_atom_key).split(':').length > 3);
  for (const r of affected) {
    await knex('trajectory').where({ id: r.id })
      .update({ req_atom_key: String(r.req_atom_key).split(':').slice(0, 3).join(':') });
  }
}
// down: 不可逆（标题 slug 无法还原）—— 仅注释说明，不执行还原
```

迁移前先把 `affected` 清单导出到 `tmp/kb-remediation/T1/backfill-rows.json`。

- [ ] **Step 6: 同步 api-docs**

`api-docs/groups/kb.js` 中 `atomKey` 示例改为 `product-mgmt:chain-a:2`。

- [ ] **Step 7: Commit**

```bash
git add src/services/req-draft-traj/parse-through-chains.js src/services/req-draft-traj/propose.js \
        migrations/<ts>_req_atom_key_stable.js scripts/characterization/characterize-req-draft-traj.mjs \
        src/dashboard/api-docs/groups/kb.js
git commit -m "fix(req-draft): stable title-independent atomKey + legacy key backfill"
```

---

### Task 2: Idempotency across lifecycle + unique guarantee (F-02, P0)

**Files:**
- Create: `migrations/<ts>_req_atom_seq_unique.js`
- Modify: `src/dao/trajectory-dao.js`（`findDraftByReqAtomKey` ~578；`save` 透出 `reqAtomSeq`）
- Modify: `src/services/req-draft-traj/commit.js`
- Modify: `src/services/trajectory/trajectory-meta-service.js`（`reqAtomSeq` 透传）
- Test: `scripts/characterization/characterize-req-draft-traj.mjs`

**Interfaces:**
- Produces: 列 `req_atom_seq int not null default 0`；唯一索引 `traj_req_atom_uq(req_module_key, req_atom_key, req_atom_seq)`；`findDraftByReqAtomKey` 返回**任意状态**的最新一行

- [ ] **Step 1: 写失败断言**

```js
await runAsync('findDraftByReqAtomKey matches non-draft rows too', async () => {
  const src = readFileSync(join(ROOT, 'src/dao/trajectory-dao.js'), 'utf8');
  const fn = src.slice(src.indexOf('export async function findDraftByReqAtomKey'));
  assert.equal(fn.includes("record_status: 'draft'"), false);   // 断言已去掉状态限定
});
await runAsync('commit force increments req_atom_seq', async () => {
  // 用注入的 createFn/findDraftFn 断言第二笔 force 提交 seq=1
});
```

- [ ] **Step 2: 运行确认失败**

- [ ] **Step 3: 迁移（含重复检测）**

```js
export async function up(knex) {
  const has = await knex.schema.hasColumn('trajectory', 'req_atom_seq');
  if (has) return;
  const dup = await knex('trajectory')
    .select('req_module_key', 'req_atom_key')
    .count({ c: '*' })
    .whereNotNull('req_atom_key')
    .groupBy('req_module_key', 'req_atom_key')
    .havingRaw('COUNT(*) > 1');
  if (dup.length) {
    throw new Error('duplicate req_atom_key rows exist; resolve manually: ' + JSON.stringify(dup));
  }
  await knex.schema.alterTable('trajectory', (t) => {
    t.integer('req_atom_seq').notNullable().defaultTo(0);
    t.unique(['req_module_key', 'req_atom_key', 'req_atom_seq'], { indexName: 'traj_req_atom_uq' });
  });
}
```

- [ ] **Step 4: 改查重与提交**

`findDraftByReqAtomKey` 去掉 `record_status: 'draft'`（函数名保持不变，避免打断 pin），JSDoc 改为「任意状态」。`commit` 中：

```js
const existing = await findDraft(moduleKey, atomKey);       // 任意状态
if (existing && !force) {
  skipped.push({ atomKey, reason: 'duplicate_draft', trajectoryId: existing.id });
  continue;
}
const seq = force && existing ? Number(existing.reqAtomSeq ?? 0) + 1 : 0;
// create 时传 reqAtomSeq: seq
```

并把 `ER_DUP_ENTRY` 捕获转为 `skipped: duplicate_draft`（不 500）。

- [ ] **Step 5: 运行确认通过 + 门禁**

- [ ] **Step 6: Commit**

```bash
git commit -m "fix(req-draft): idempotency across lifecycle states + unique(module,atom,seq)"
```

---

### Task 3: Propose cache hardening (F-03, P0)

**Files:**
- Modify: `src/services/req-draft-traj/propose-cache.js`
- Modify: `src/services/req-draft-traj/propose.js`（写缓存时传 sourceHash/inputHash）
- Modify: `src/services/req-draft-traj/commit.js`（校验）
- Modify: `.gitignore`
- Modify: `src/dashboard/api-docs/groups/kb.js`
- Test: `scripts/characterization/characterize-req-draft-traj.mjs`

**Interfaces:**
- Produces: `writeProposeCache(moduleDir, { atoms, rejected, sourceHash, inputHash, truncated })`；缓存含 `cacheVersion: 1`

- [ ] **Step 1: gitignore**

```gitignore
data/kb/req/*/.draft-traj-propose.json
```

工作区已存在的 10 个缓存文件：**先与 Lead 确认**再决定删除或保留（保留时它们会被新代码判为版本过期）。

- [ ] **Step 2: 缓存体扩展 + 原子写**

```js
const body = {
  cacheVersion: 1,
  updatedAt: new Date().toISOString(),
  sourceHash,
  inputHash,
  atoms,
  rejected,
  truncated,
};
const tmp = `${target}.tmp`;
await writeFile(tmp, JSON.stringify(body, null, 2) + '\n', 'utf-8');
await rename(tmp, target);
```

- [ ] **Step 3: commit 校验**

```js
if (!cache || cache.cacheVersion !== 1) throw new AppError('propose cache outdated — run propose again', { code: 'STALE_PROPOSE_CACHE' });
const md = await readFile(join(modDir, 'through-chains.md'), 'utf-8');
if (sha256(md) !== cache.sourceHash) throw new AppError('through-chains changed — run propose again', { code: 'STALE_PROPOSE_CACHE' });
```

- [ ] **Step 4: 断言 + 门禁**

```bash
git check-ignore -v data/kb/req/product-mgmt/.draft-traj-propose.json   # 必须命中
node scripts/characterization/characterize-req-draft-traj.mjs            # OK 30+
```

- [ ] **Step 5: Commit**

---

### Task 4: Propose error semantics + wizard gate (F-04, P0)

**Files:**
- Modify: `src/services/req-draft-traj/propose.js`
- Modify: `src/dashboard/api-docs/groups/kb.js`
- Test: `scripts/characterization/characterize-req-draft-traj.mjs`

- [ ] **Step 1: 断言先行**

```js
await runAsync('propose rejects unparseable chains', async () => {
  await assert.rejects(
    () => proposeDraftTrajectories({ moduleKey: 'archive-like', rootDir: tmp }),
    (e) => e.code === 'VALIDATION' && /no parseable step table/.test(e.message),
  );
});
await runAsync('propose rejects chainIds with no match', async () => {
  await assert.rejects(
    () => proposeDraftTrajectories({ moduleKey: 'demo-mod', rootDir: tmp, chainIds: ['nope'] }),
    (e) => e.code === 'VALIDATION' && /matched no chains/.test(e.message),
  );
});
```

- [ ] **Step 2: 实现**

入口加 `hasProposeableChainSteps(md)` 与 `chainIds` 过滤后空判断，均抛 `AppError(..., { code: 'VALIDATION' })`。**保留** LLM 失败 → 确定性兜底（不得因 LLM 异常 400）。

- [ ] **Step 3: 真实 HTTP 验收（archive 只读）**

```bash
curl -s -X POST localhost:4097/api/v2/kb/req-modules/archive/draft-traj/propose \
  -H 'Content-Type: application/json' -d '{}' | tee tmp/kb-remediation/T4/archive-propose.json
# 期望 4xx + 'no parseable step table'
```

- [ ] **Step 4: 前端契约派单**

把 spec §6.4 的要求（禁用条件改 `canProposeAtoms`）写进前端仓库的待办，并在本 Task 报告里注明「前端未改前，archive 仍会出现在列表」。

- [ ] **Step 5: Commit**

---

### Task 5: Provenance anchors (F-05, P1)

**Files:**
- Create: `migrations/<ts>_req_source_anchor.js`
- Modify: `src/services/req-draft-traj/provenance.js`（`resolveChapterRef` 返回值扩展）
- Modify: `src/services/req-draft-traj/propose.js`、`commit.js`、`src/dao/trajectory-dao.js`
- Modify: `src/dashboard/api-docs/groups/kb.js`
- Test: `scripts/characterization/characterize-req-draft-traj.mjs`

**Interfaces:**
- Produces: 列 `req_source_hash string(64)`、`req_chunk_id string(191)`；`resolveChapterRef() → { ref, chunkId, sourceHash } | null`

- [ ] **Step 1: 断言先行**：同一章节解析两次返回相同 `chunkId`；改动章节内容后 `sourceHash` 变化。
- [ ] **Step 2: 迁移 + 实现**（`chunkId = <file-stem>#<h1-slug>`，slug 走 `normalizeHint` 规则）。
- [ ] **Step 3: commit 回查**：章节文件不存在或哈希不符 → `skipped: { reason: 'stale_chapter_ref' }`。
- [ ] **Step 4: 验收**：propose → 改章节文件 → commit → 该原子 skipped 且 reason 正确。
- [ ] **Step 5: Commit**

> **Phase 2（不做）**：chapters 段落级锚点 `<!-- chunk:NN -->` + SKILL 契约升级 + 30 模块重切，需 Lead 另批。

---

### Task 6: Recall upgrade — deterministic (F-06, F-16, P1)

**Files:**
- Modify: `src/services/req-draft-traj/flow-card-recall.js`
- Modify: `src/services/req-draft-traj/provenance.js`
- Create: `scripts/characterization/fixtures/kb-recall-golden.json`
- Test: `scripts/characterization/characterize-flow-card-recall.mjs`

**Interfaces:**
- 保持导出名不变：`matchFlowForAtom({ title, taskDraft, cards }) → { flowRef, nodeId }`；常量 `MIN_CARD_SCORE` / `MIN_NODE_SCORE` 保留

- [ ] **Step 1: 金样例先行**（写入 fixture，Task 7 共用）

| query | expectFlowRef | expectNodeId |
|---|---|---|
| 对公客户主页 点击客户转正 | `customer_onboarding` | 非 null 且属该卡 |
| 启用产品 | `product_library` | 含启用语义，**不得** `prod_disable_dlg` |
| 维护客户信息并保存 | `customer_360` 或 `customer_corp` 系列 | — |
| 查询产品列表 | `product_query` | `qry_home` |
| 今天天气不错，我们去吃饭吧 | null | null |

- [ ] **Step 2: 改写 tokenizer**：CJK 只取 bigram + 码整词 + 最长匹配优先（删除长度 2..L 全枚举）。
- [ ] **Step 3: 打分改 IDF**：`score = Σ idf(term) × len(term)`，相对阈值 `cardScore/maxPossible ≥ 0.25`、`nodeScore ≥ cardScore × 0.5`。
- [ ] **Step 4: 极性消歧**：`启用` vs `禁用/下架/disable` 互斥。
- [ ] **Step 5: provenance 可解释加权 + 章节缓存**：ZJJK 命中 > 标题 > 文件名 > 正文，权重具名常量；章节内容按 `moduleDir + mtime` 缓存。
- [ ] **Step 6: 性能上界断言**：800 字单次 < 200 ms（基线 654 ms）。
- [ ] **Step 7: 验收 + Commit**

```bash
node scripts/characterization/characterize-flow-card-recall.mjs
node tmp/kb-remediation/T6/probe-recall.mjs   # 附录 A.3
```

---

### Task 7: Cross-language recall golden fixture (F-07, P1)

**Files:**
- Modify: `scripts/characterization/characterize-flow-card-recall.mjs`（读 fixture）
- Modify: `scripts/characterization/characterize-kb-recall.py`（读同一 fixture）
- Create: `scripts/characterization/fixtures/kb-recall-golden.json`（≥20 条，Task 6 Step 1 已起）

- [ ] **Step 1: fixture 补齐 ≥20 条**，必须包含 F-07 三个反例（`维护客户信息并保存` / `查询产品列表` / `对公客户转正`）。
- [ ] **Step 2: 两侧都断言 flowRef 一致**；分数允许不同。
- [ ] **Step 3: 确实无法一致的条目**标 `divergenceAccepted: true` + 理由，并在报告中列出。
- [ ] **Step 4: 更新 AGENTS.md**：在「跨语言单源」段落补一行「KB 召回金样例是唯一跨语言契约」。
- [ ] **Step 5: 验收 + Commit**

```bash
node scripts/characterization/characterize-flow-card-recall.mjs
<PYTHON> scripts/characterization/characterize-kb-recall.py
```

> **决策 D3（已定）**：Python 召回**不**改调控制面 HTTP；先以共享金样例建立一致性契约，合并实现另议。

---

### Task 8: functionId candidates (F-08, P1)

**Files:**
- Modify: `src/services/req-draft-traj/propose.js`
- Modify: `src/dashboard/api-docs/groups/kb.js`
- Test: `scripts/characterization/characterize-req-draft-traj.mjs`

**Interfaces:**
- Produces: `atoms[].functionIdCandidates: [{ id, name, score, reason }]`（≤3 条，`reason ∈ {page_code, menu_path, name_match}`）

- [ ] **Step 1: 建索引**：用 `systemDao.listAll()` 建 `name → id`、`menuXpath → id`、`pdCmptEcd/umlEcd → id`。
- [ ] **Step 2: 生成候选**：输入 `title` + `pageCodes`（已落地，见 `src/services/req-draft-traj/atom-keydata.js`）+ `sourceChapter` + `taskDraft`；仅在 `suggestedFunctionId` 为空时给候选。
- [ ] **Step 3: 不改变** `suggestedFunctionId` 语义与 FK 守卫；`functionIdOverrides` 契约不变。
- [ ] **Step 4: 验收**：product-mgmt 重跑后 ≥60% 原子有候选；抽查 5 条人工确认正确（证据落盘）。
- [ ] **Step 5: Commit**

---

### Task 9: Validate endpoint + operator audit (F-09, P1)

**Files:**
- Modify: `src/routes/v2/kb.js`
- Modify: `src/services/req-draft-traj/commit.js`（抽 `validateCommitAtoms()`）
- Modify: `src/dashboard/api-docs/groups/kb.js`
- Test: `scripts/characterization/characterize-req-draft-traj.mjs`

- [ ] **Step 1: 抽纯函数** `validateCommitAtoms({ cache, atomKeys, overrides, ... }) → { ok, problems }`，commit 与 validate 共用。
- [ ] **Step 2: 新端点** `POST /api/v2/kb/req-modules/:moduleKey/draft-traj/validate`（不写库、不调 LLM）。
- [ ] **Step 3: `paasUserId` 透传**到 `createTransactionWithPhases`。
- [ ] **Step 4: 验收**：同输入下 validate 的 `problems` 与 commit 的 `skipped` 集合一致。
- [ ] **Step 5: Commit**

---

### Task 10: Observability (F-* 全局, P2)

**Files:**
- Modify: `src/services/req-draft-traj/propose.js`（写 `propose-runs.jsonl`）
- Modify: `src/services/req-draft-traj/flow-card-recall.js` 或调用侧（写 `recall-events.jsonl`）
- Create: `scripts/kb/propose-stats.mjs`（只读统计）

- [ ] **Step 1:** 每行 `{ ts, moduleKey, atoms, rejected, truncated, cacheVersion, sourceHash, durationMs, flowRefHits, functionIdCandidateHits }`。
- [ ] **Step 2:** 召回事件 `{ ts, query, flowRef, score, source: 'py'|'js' }`。
- [ ] **Step 3:** 验收：连跑两次 propose 后 JSONL 有 2 行且字段完整。
- [ ] **Step 4: Commit**

---

### Task 11: Self-contained source doc (F-13, P2；D4 已定：复用现有 multer)

**Files:**
- Modify: `src/routes/v2/kb.js`（实现 `POST …/source`，当前 501）
- Reuse: `src/http/upload-xlsx.js`（`multer ^2.2.0` 已在依赖中，`memoryStorage` + 字段 `file`）、`src/http/decode-upload-filename.js`（中文文件名修复）
- Modify: `src/services/req-draft-traj/provenance.js`（优先用本地副本）
- Modify: `src/dashboard/api-docs/groups/kb.js`

- [ ] **Step 1:** 复用 `upload-xlsx.js` 的 multer 中间件（或抽一个通用 `upload-file.js`），落盘 `data/kb/req/<module>/source/<原文件名>`；`source.link.json` 增 `sha256`/`bytes`/`uploadedAt`，保留 `sourcePath` 兼容。
- [ ] **Step 2:** propose 时本地副本优先，`sourceDoc` 用相对路径（缺副本则回退旧 `sourcePath`，行为不变）。
- [ ] **Step 3:** 验收：上传后 `source.link.json` 含 sha256；propose 的 `sourceDoc` 指向副本相对路径；旧模块（无副本）行为不变。

---

### Task 12: Gate & hygiene (F-12, F-14, P2)

**Files:**
- Modify: `scripts/kb/promote_draft.mjs`（**D5 已定：打 `promotedAt` 标记，保留存档，不移文件**）
- Modify: `scripts/kb/store.py`（可选：卡 schemaVersion 校验）
- Modify: `scripts/refactor/verify-all.sh`（若 Task 0 未做则此处补）

- [ ] **Step 1:** `--apply` 成功后给每张已晋升卡写入 `promotedAt`（ISO 时间）+ `promotedTo`（目标 flows 文件名），保留 `drafts/` 存档。
- [ ] **Step 2:** 验收：`data/kb/req/*/drafts/*.json` 中已晋升卡带 `promotedAt`。
- [ ] **Step 3: Commit**

---

### Task 13: Granularity guard + truncation transparency (F-10, F-11, P2)

**Files:**
- Modify: `src/services/req-draft-traj/propose.js`
- Modify: `src/dashboard/api-docs/groups/kb.js`
- Test: `scripts/characterization/characterize-req-draft-traj.mjs`

- [ ] **Step 1:** 新增 `REF_STEP_RE = /回主链|同主链|见主链|同上|参照/`；命中且无独立写动作 → `rejected: { reason: 'reference_step' }`。
- [ ] **Step 2:** `atoms[].kind: 'write'|'nav'`；`maxAtoms` 截断优先保留 `write`。
- [ ] **Step 3:** 响应增 `truncated: { dropped, requestedMax }`；`rejected` 不被 `maxAtoms` 截断。
- [ ] **Step 4:** 验收：product-mgmt 重跑后 `chain-b:4` 不在 atoms；`maxAtoms:3` 时 `truncated.dropped` 正确。

---

### Task 14: Evidence coverage（F-15，**需 Lead 批准，另开任务**）

- 湿测新增判定词 `readonly-partial`（走到最终确认前一步并记录字段/按钮/校验提示），让写路径也有证据。
- 涉及 `scripts/prompts/skills/req-doc-to-kb/SKILL.md`、`scripts/kb/wet-test-check.mjs`、草稿卡 gate 计算与 30 模块语料。
- **本计划只登记，不实施。**

---

## 依赖与并行分组

```
Task 0 (门禁修复)
  ├─> A 线: Task 1 ──> Task 2 ──> Task 9
  ├─> B 线: Task 3 ──> Task 4 ──> Task 8 ──> Task 13
  ├─> C 线: Task 6 ──> Task 7
  └─> D 线: Task 5 / 10 / 11 / 12 / 14
```

- **A 线文件集**：`parse-through-chains.js`、`trajectory-dao.js`、`commit.js`、`trajectory-meta-service.js`、`migrations/*`。
- **B 线文件集**：`propose.js`、`propose-cache.js`、`routes/v2/kb.js`、`api-docs/groups/kb.js`。
- **C 线文件集**：`flow-card-recall.js`、`provenance.js`、`scripts/kb/recall.py`、`fixtures/kb-recall-golden.json`。
- **D 线文件集**：`verify-all.sh`、`.gitignore`、`kb-req-modules.js`、`promote_draft.mjs`、`SKILL.md`。
- **冲突点**：`commit.js` 同时被 Task 2/3/5/9 使用 → 由 A 线串行；`propose.js` 被 Task 3/4/8/13 使用 → 由 B 线串行；`api-docs/groups/kb.js` 被多条线使用 → **各线只改自己那几行，冲突时由最后一条线统一 rebase**。

## DoD 矩阵

| Task | 验收命令 | 期望 | 证据 |
|---|---|---|---|
| 0 | `bash scripts/refactor/verify-all.sh` + 故意失败 | ALL GREEN；故意失败时整体 FAIL | `tmp/kb-remediation/D0/` |
| 1 | `characterize-req-draft-traj` / 附录 A.1 | OK 26+；两次 propose 键相同 | `tmp/kb-remediation/T1/` |
| 2 | 同 + 唯一冲突用例 | OK 28+；`ER_DUP_ENTRY` → skipped | `tmp/kb-remediation/T2/` |
| 3 | `git check-ignore` + 改链后 commit | 命中 ignore；4xx `STALE_PROPOSE_CACHE` | `tmp/kb-remediation/T3/` |
| 4 | HTTP archive / 假 chainIds | 4xx + 指定 message | `tmp/kb-remediation/T4/` |
| 5 | 改章节后 commit | `skipped: stale_chapter_ref` | `tmp/kb-remediation/T5/` |
| 6 | 附录 A.3 + 金样例 | 全命中；800 字 < 200 ms | `tmp/kb-remediation/T6/` |
| 7 | py + js characterization | flowRef 一致 | `tmp/kb-remediation/T7/` |
| 8 | product-mgmt 重跑 | ≥60% 有候选；抽查 5 条正确 | `tmp/kb-remediation/T8/` |
| 9 | validate vs commit 同输入 | `problems` = `skipped` | `tmp/kb-remediation/T9/` |
| 10 | 连跑两次 + `propose-stats.mjs` | JSONL 2 行、字段完整 | `tmp/kb-remediation/T10/` |
| 11 | 上传 + propose | `sourceDoc` 指向副本 | `tmp/kb-remediation/T11/` |
| 12 | 已晋升卡检查 | 带 `promotedAt` | `tmp/kb-remediation/T12/` |
| 13 | product-mgmt + `maxAtoms:3` | 无 `reference_step`；truncated 正确 | `tmp/kb-remediation/T13/` |
| 全局 | `bash scripts/refactor/verify-all.sh` | ALL GREEN | `tmp/kb-remediation/gate.txt` |

## Reviewer Checklist（审查者逐 Task 执行）

1. **读 diff 不读自述**：`git show <hash>` 逐行看，重点看 characterization 是否被削弱。
2. **复跑命令**：DoD 矩阵 + 基线绿灯（`characterize-req-draft-traj` / `fk-guard` / `kb-req-modules` / `kb-req-modules-list` / `flow-card-recall` / `kb-recall.py`）。
3. **独立探针**：用附录 A 自行验证，**不采信实施方提供的输出**。
4. **反作弊（发现即 FAIL）**：
   - characterization 断言被恒真化 / 删除 / 跳过；
   - 用 `force:true` 冒充幂等修复；
   - 手改 `.draft-traj-propose.json` 或 `data/kb/flows/**` 让金样例通过；
   - 召回实现里对金样例 query 特判；
   - 迁移 `down` 缺失或不可执行；
   - api-docs 未同步（R2）；
   - 越界改动他线文件集。
5. **判定**：`PASS` / `FAIL`（附复现命令）/ `DONE_WITH_CONCERNS`（功能达成但有未闭环风险，必须写明）。
6. **不代提交**：实施方按 AGENTS.md 自行提交；reviewer 只在验收报告给出 hash 与结论。

## 附录 A：探针脚本（实施方需自行复跑）

### A.1 atomKey 稳定性（Task 1）

```js
// tmp/kb-remediation/T1/probe-atomkey.mjs
import { readFile } from 'node:fs/promises';
const a = JSON.parse(await readFile('tmp/req-draft-traj/quality-rerun-propose.json', 'utf-8'));
const b = JSON.parse(await readFile('data/kb/req/product-mgmt/.draft-traj-propose.json', 'utf-8'));
const keys = (x) => (x.atoms || x.data?.atoms || []).map((v) => v.atomKey);
console.log('run1:', keys(a).filter((k) => k.includes(':chain-a:2:')));
console.log('run2:', keys(b).filter((k) => k.includes(':chain-a:2:')));
// 基线：两个不同的键；修复后应为同一键 product-mgmt:chain-a:2
```

### A.2 stale 缓存（Task 3，必须用 tmp 副本）

```js
// tmp/kb-remediation/T3/probe-stale-cache.mjs
import { cp, mkdir, rm } from 'node:fs/promises';
import { proposeDraftTrajectories } from '../../../src/services/req-draft-traj/propose.js';
const ROOT = 'tmp/kb-probe';
await rm(ROOT, { recursive: true, force: true });
await mkdir(ROOT, { recursive: true });
await cp('data/kb/req/loan-corp', ROOT + '/loan-corp', { recursive: true });
const r = await proposeDraftTrajectories({
  moduleKey: 'loan-corp', rootDir: ROOT,
  callLLM: async () => { throw new Error('no-llm'); },
});
console.log('atoms=' + r.atoms.length + ' rejected=' + r.rejected.length); // 基线 35/0（真实缓存是空壳）
```

### A.3 召回成本与精度（Task 6）

```js
// tmp/kb-remediation/T6/probe-recall.mjs
import { matchFlowForAtom } from '../../../src/services/req-draft-traj/flow-card-recall.js';
import { listFlowCardsDetailed } from '../../../src/services/kb-flow-cards.js';
const cards = await listFlowCardsDetailed({});
for (const q of ['对公客户主页 点击客户转正', '启用产品', '维护客户信息并保存', '查询产品列表', '今天天气不错，我们去吃饭吧']) {
  const t0 = Date.now();
  const h = matchFlowForAtom({ title: q, taskDraft: '', cards });
  console.log(JSON.stringify({ q, flowRef: h.flowRef, nodeId: h.nodeId, ms: Date.now() - t0 }));
}
const long = '维'.repeat(800);
const t1 = Date.now();
matchFlowForAtom({ title: '', taskDraft: long, cards });
console.log('800-char ms=' + (Date.now() - t1)); // 基线 654 ms，目标 < 200 ms
```

### A.4 模块与湿测统计（Task 0）

```js
// tmp/kb-remediation/D0/probe-stats.mjs
import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { parseThroughChainsMarkdown } from '../../../src/services/req-draft-traj/parse-through-chains.js';
const ROOT = 'data/kb/req';
const mods = (await readdir(ROOT, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name).sort();
for (const m of mods) {
  const dir = join(ROOT, m);
  let chapters = [];
  try { chapters = (await readdir(join(dir, 'chapters'))).filter((f) => f.endsWith('.md')); } catch {}
  let chains = 0, steps = 0;
  try {
    const md = await readFile(join(dir, 'through-chains.md'), 'utf-8');
    const p = parseThroughChainsMarkdown(md);
    chains = p.chains.length;
    steps = p.chains.reduce((a, c) => a + c.steps.length, 0);
  } catch {}
  let wet = false; try { wet = (await stat(join(dir, 'wet-test.md'))).isFile(); } catch {}
  let drafts = 0; try { drafts = (await readdir(join(dir, 'drafts'))).filter((f) => f.endsWith('.json')).length; } catch {}
  console.log(JSON.stringify({ m, chapters: chapters.length, chains, steps, wet, drafts }));
}
```

## 附录 B：基线快照

```json
{
  "modules": 30,
  "canProposeAtoms": 29,
  "notProposeable": ["archive"],
  "wetTestLeaves": { "match": 1006, "drift": 118, "blocked": 686, "notFound": 148, "pending": 0 },
  "draftCards": { "total": 177, "partial": 110, "full": 44, "pass": 10, "match": 9, "notFoundEnv": 3, "blockedPending": 1 },
  "flowCards": 84,
  "proposeCaches": { "files": 10, "withAtoms": 3, "emptyShells": 7 },
  "productMgmt": { "atoms": 20, "rejected": 2, "functionIdNull": 20, "nodeMisattributed": 4 },
  "recallCostMs": { "800char": 654, "2000char": 2796 },
  "characterization": { "reqDraftTraj": 26, "fkGuard": 11, "kbReqModules": 11, "kbReqModulesList": 3, "flowCardRecall": 12 },
  "note": "reqDraftTraj 25→26 因 pageCodes 特性（atom-keydata.js）落地；本快照为 e8127000"
}
```
