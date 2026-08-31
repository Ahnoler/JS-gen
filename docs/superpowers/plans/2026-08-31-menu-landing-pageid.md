# 菜单落地 pageId 单一化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 菜单 JSON 导入与录制 prepare 回写统一为「功能节点 0 或 1 个落地 pageId（仅 managePage）」；存量清掉 guidePage 多行。

**Architecture:** 导入侧改纯函数 `collectPages`（只收第一个非空 managePage，忽略 guidePages），模块 upsert 强制空 pages；prepare 在 `source==='read'` 时双写 `system.pd_cmpt_ecd` + `system_page` 整替一行；AILZ/`source==='generated'` 不碰菜单。存量用一次性 Knex migration 清理。

**Tech Stack:** Node.js ESM、Knex/MySQL、characterization 脚本（`node scripts/characterization/*.mjs`）。

## Global Constraints

- Spec：`docs/superpowers/specs/2026-08-31-menu-landing-pageid-design.md`（已评审）
- 功能节点落地 pageId = 建模**第一个非空** `managePage.pdCmptEcd`，或 `""`；**不入库** guidePage / task 级 pdCmptEcd
- 模块 type=2：落地恒 `""`，`system_page` 0 行
- 双写：`system.pd_cmpt_ecd` ↔ `system_page`（0 或 1 行，`page_type='managePage'`）
- prepare：仅 `source === 'read'` 且有效 `functionId` 且组件编号非空时回写菜单；AILZ 只写 `trajectory.page_id`
- 不改推送 HTTP（D1–D5）；不删 `system_page` 表；不回刷历史 `trajectory.page_id`
- 导入仍**不**打开浏览器；`collectPages` 只读建模 JSON
- `src/` 变更必须追加 `CHANGELOG.md` `[Unreleased]`
- characterization 用 `readFileSync`/`assert.match` 钉源码子串时，**禁止删掉**被 pin 的标记字符串
- 每个任务提交前跑该任务列出的验证命令；全部完成后跑 import + page-bind 两条 characterization

## File map

| File | Responsibility |
|------|----------------|
| `src/services/menu-json-import.js` | `collectPages` 只收 0/1 managePage；模块 upsert 传空 pages |
| `src/services/trajectory/recording-page-bind.js` | `source=read` 后回写功能落地页 |
| `src/dao/system-page-dao.js` | 继续用现有 `replaceForNode`（不新增包装，YAGNI） |
| `migrations/20260831120000_system_page_landing_only.js` | 存量清 guidePage + 塌缩多行 + 同步 `pd_cmpt_ecd` |
| `scripts/characterization/characterize-system-import-json.mjs` | 断言只含 managePage 单码 |
| `scripts/characterization/characterize-page-bind.mjs` | pin 回写 / AILZ 不回写 |
| `src/dashboard/api-docs/groups/overview.js` | import-json 文案改为单落地 pageId |
| `CHANGELOG.md` | `[Unreleased]` 实现条目 |

---

### Task 1: 导入侧 — collectPages 只留 managePage（0/1）

**Files:**
- Modify: `scripts/characterization/characterize-system-import-json.mjs`（断言与 fixture 注释）
- Modify: `src/services/menu-json-import.js`（`collectPages` ~40–80；`upsertNode` 调用处 ~347–352）
- Modify: `src/dashboard/api-docs/groups/overview.js`（import-json `desc`/`notes`）
- Modify: `CHANGELOG.md` `[Unreleased]`

**Interfaces:**
- Consumes: 建模 JSON activity 的 `managePage.pdCmptEcd` / `pdCmptNm` / `resPath`
- Produces: `collectPages(node) → object[]` 长度 ≤ 1，项形如 `{ pageId, pageName, resPath, pageType: 'managePage' }`；模块入库 pages 恒 `[]`

- [ ] **Step 1: 改 characterization 断言（先让红）**

在 `characterize-system-import-json.mjs` 中替换下列逻辑：

`testBuildPlanStructure` 内 pageType 约束改为仅 `managePage`：

```js
assert.equal(p.pageType, 'managePage', 'pageType is managePage only');
```

`testBuildPlanSharedManagePageDedup` 整段改为（对公客户管理只剩落地码）：

```js
function testBuildPlanSharedManagePageDedup() {
  if (!importAvailable) { console.log('    (skipped: SUT not importable)'); return; }
  const fixture = buildFixture();
  const plan = buildImportJsonPlan(fixture);
  const gongGong = plan.modules[0].functions.find((f) => f.name === '对公客户管理');
  const pageIds = gongGong.pages.map((p) => p.pageId);
  assert.deepEqual(pageIds, ['ZJJK00066153'], 'only first managePage; guidePage ignored');
  assert.ok(!pageIds.includes('ZJJK99999999'), 'task-level pdCmptEcd ignored');
  assert.ok(!pageIds.includes('ZJJK00066158'), 'guidePage ZJJK00066158 not imported');
  assert.equal(gongGong.pages.length, 1);
  assert.equal(gongGong.pages[0].pageType, 'managePage');
}
```

`testBuildPlanEmptyGuidePageSkipped` 改名为语义「guide 忽略」但保留函数名亦可；断言不变（仍只要 `ZJJK00067207`）。更新文件头 fixture 注释：`- guidePages never imported` / `- at most one managePage per function`。

在 `testWiringService` 末尾追加（钉「不收集 guidePages」）：

```js
assert.doesNotMatch(service, /guidePages/, 'collectPages no longer iterates guidePages');
```

（若实现里 JSDoc 仍写 guidePages 字样会导致失败——实现步骤须同步改掉 JSDoc，禁止保留 `guidePages` 标识符。）

main 里对应测试标题可改为：
`'buildImportJsonPlan shared managePage only (no guidePage)'`

- [ ] **Step 2: 跑测试确认失败**

Run:

```bash
node scripts/characterization/characterize-system-import-json.mjs
```

Expected: FAIL — 对公客户管理仍含 `ZJJK00066158`，且/或 `guidePages` 仍出现在源码。

- [ ] **Step 3: 实现 `collectPages` + 模块空 pages**

将 `src/services/menu-json-import.js` 的 `collectPages` 替换为：

```js
/**
 * 收集一个节点直属活动（children 中 umlType='3'）的落地页（0 或 1 个）。
 * 只取建模第一个非空 managePage.pdCmptEcd；忽略 guidePages 与后续 managePage。
 * @param {object} node 子领域/模块节点
 * @returns {object[]} 长度 0 或 1；项含 pageId/pageName/resPath/pageType='managePage'
 */
function collectPages(node) {
  const pages = [];
  const children = Array.isArray(node.children) ? node.children : [];
  let skippedExtraManage = 0;
  for (const child of children) {
    if (String(child.umlType) !== '3') continue;
    const managePage = child.managePage;
    const pageId = managePage ? String(managePage.pdCmptEcd || '').trim() : '';
    if (!pageId) continue;
    if (pages.length === 0) {
      pages.push({
        pageId,
        pageName: String(managePage.pdCmptNm || '').trim(),
        resPath: String(managePage.resPath || '').trim(),
        pageType: 'managePage',
      });
    } else {
      skippedExtraManage += 1;
    }
  }
  if (skippedExtraManage > 0) {
    console.warn(
      '[menu-json-import] multiple managePages under node %s; kept first %s, skipped %d',
      String(node.umlEcd || node.umlNm || ''),
      pages[0]?.pageId,
      skippedExtraManage,
    );
  }
  return pages;
}
```

模块入库强制不挂落地页（调用处）：

```js
for (const mod of plan.modules) {
  const moduleNode = await upsertNode(mod, target.id, NODE_TYPE_MODULE, []);
  for (const fn of mod.functions || []) {
    await upsertNode(fn, moduleNode.id, NODE_TYPE_FUNCTION, fn.pages || []);
  }
}
```

（`mod.pages` 仍可出现在 plan 对象上供调试，但**不得**写入 DB。）

- [ ] **Step 4: 更新 api-docs 文案**

`src/dashboard/api-docs/groups/overview.js` 中 import-json 条目：

- `desc`：将「页面ID(pdCmptEcd→system_page)」改为明确「功能节点落地 pageId（仅 managePage，0/1；写入 `system.pd_cmpt_ecd` + 至多一行 `system_page`）」
- `notes` 中把 `'页面 ID 只收 managePage/guidePages 的 pdCmptEcd，空编码跳过'` 改为 `'落地 pageId 只收第一个非空 managePage.pdCmptEcd；guidePages 不入库；模块不挂落地页'`

- [ ] **Step 5: CHANGELOG**

在 `CHANGELOG.md` `[Unreleased]` → `### Changed` 追加一条（可与 Task 2/3 合并为一条最终文案；本任务至少写导入侧）：

```md
- 2026-08-31: **菜单落地 pageId 单一化（导入）**：`collectPages` 只入库第一个非空 managePage；忽略 guidePages；模块 upsert 强制空 pages。影响：`system_page` 每功能 0/1 行；characterization-system-import-json 断言同步。
```

并可将既有「设计」Added 条目末尾改为「实现计划见 `docs/superpowers/plans/2026-08-31-menu-landing-pageid.md`」。

- [ ] **Step 6: 跑测试确认通过**

Run:

```bash
node scripts/characterization/characterize-system-import-json.mjs
```

Expected: OK（全部 ✓）

- [ ] **Step 7: Commit**

```bash
git add scripts/characterization/characterize-system-import-json.mjs \
  src/services/menu-json-import.js \
  src/dashboard/api-docs/groups/overview.js \
  CHANGELOG.md \
  docs/superpowers/plans/2026-08-31-menu-landing-pageid.md
git commit -m "$(cat <<'EOF'
feat: import menu landing pageId as single managePage only

Ignore guidePages; modules get no system_page rows; align characterization and api-docs.
EOF
)"
```

---

### Task 2: prepare 回写 — `source=read` 覆盖功能落地页

**Files:**
- Modify: `scripts/characterization/characterize-page-bind.mjs`
- Modify: `src/services/trajectory/recording-page-bind.js`
- Modify: `CHANGELOG.md` `[Unreleased]`（补 prepare 回写）

**Interfaces:**
- Consumes: `bindRecordingPageId` 已有 `source`/`pageId`/`pageName`/`pagePath`/`fid`；`systemDao.update`；`systemPageDao.replaceForNode`
- Produces: 内部 helper `writeBackFunctionLandingPage(functionId, { pageId, pageName, resPath }) → Promise<void>`（可不 export）；失败只 warn，不 throw

- [ ] **Step 1: 写 failing characterization（源码 cue）**

在 `characterize-page-bind.mjs` 的 `testWiringService` 中追加：

```js
assert.match(service, /writeBackFunctionLandingPage/, 'service defines write-back helper');
assert.match(service, /source === ['"]read['"]/, 'write-back gated on source===read');
assert.match(service, /replaceForNode/, 'write-back replaces system_page via replaceForNode');
assert.match(service, /pdCmptEcd/, 'write-back updates system.pdCmptEcd');
```

新增独立测试，钉「AILZ / generated 路径不调用回写」（用源码结构：`generatePageId` 分支 return 之前不得出现 `writeBackFunctionLandingPage` 调用——用分段断言）：

```js
function testWiringWriteBackOnlyOnRead() {
  const service = readFileSync(join(root, 'src/services/trajectory/recording-page-bind.js'), 'utf8');
  // no-functionId early return block must not call write-back
  const earlyIdx = service.indexOf('no functionId, generated pageId');
  assert.ok(earlyIdx > 0, 'early AILZ log present');
  const earlyReturnIdx = service.indexOf('return { pageId, source, persisted }', earlyIdx);
  assert.ok(earlyReturnIdx > earlyIdx, 'early return present');
  const earlyBlock = service.slice(earlyIdx, earlyReturnIdx);
  assert.ok(!earlyBlock.includes('writeBackFunctionLandingPage'), 'AILZ early path does not write back menu');
  // generated branch after empty componentCode
  assert.match(service, /source = 'generated'/, 'generated source still assigned');
}
```

把 `testWiringWriteBackOnlyOnRead` 加入 `main` 的 tests 数组。

- [ ] **Step 2: 跑测试确认失败**

Run:

```bash
node scripts/characterization/characterize-page-bind.mjs
```

Expected: FAIL — 缺少 `writeBackFunctionLandingPage` / `replaceForNode` 等。

- [ ] **Step 3: 实现回写 helper 与调用点**

在 `recording-page-bind.js` 中、`generatePageId` 之后增加：

```js
/**
 * 将天元实测组件编号回写为功能节点唯一落地 pageId（pd_cmpt_ecd + system_page 整替一行）。
 * 失败只 warn，不抛——不得阻断录制启动。
 * @param {number} functionId 功能节点 id
 * @param {{ pageId: string, pageName?: string, resPath?: string }} landing 落地页
 * @returns {Promise<void>}
 */
async function writeBackFunctionLandingPage(functionId, landing) {
  const pageId = String(landing?.pageId || '').trim();
  if (!pageId) return;
  const fid = Number(functionId);
  if (!Number.isFinite(fid) || fid <= 0) return;
  try {
    await systemDao.update(fid, { pdCmptEcd: pageId });
    await systemPageDao.replaceForNode(fid, [{
      pageId,
      pageName: String(landing.pageName || '').trim(),
      resPath: String(landing.resPath || '').trim(),
      pageType: 'managePage',
    }]);
    console.log('[page-bind] wrote back function#%s landing pageId=%s', fid, pageId);
  } catch (err) {
    console.warn('[page-bind] write-back landing failed function#%s: %s', fid, err?.message || err);
  }
}
```

在步骤 4 定好 `source`/`pageId` 之后、步骤 5 交叉校验之前（或步骤 6 `updateMeta` 成功之后均可；**推荐步骤 6 之前**，与轨迹落库同一次 prepare）：

```js
if (source === 'read' && pageId) {
  await writeBackFunctionLandingPage(fid, {
    pageId,
    pageName,
    resPath: pagePath,
  });
}
```

注意：
- `same-menu` 复用早退（`reused: true`）**不必**再回写（首次 read 已写；避免多余 DB）
- `source === 'generated'`（含 AILZ）**禁止**调用 `writeBackFunctionLandingPage`
- 无 functionId 早退路径保持现状，不回写

更新文件头 JSDoc 流程说明，增加「7. source=read 时回写功能落地 pageId」。

- [ ] **Step 4: CHANGELOG**

在 `[Unreleased]` `### Changed`（或 `### Fixed` 若更贴切用 Changed）追加/并入：

```md
- 2026-08-31: **菜单落地 pageId 单一化（prepare 回写）**：`bindRecordingPageId` 在 `source=read` 时回写功能 `pd_cmpt_ecd` + 单行 `system_page`；AILZ 不回写菜单。
```

- [ ] **Step 5: 跑测试确认通过**

Run:

```bash
node scripts/characterization/characterize-page-bind.mjs
node scripts/characterization/characterize-system-import-json.mjs
```

Expected: 两条均 OK。

- [ ] **Step 6: Commit**

```bash
git add scripts/characterization/characterize-page-bind.mjs \
  src/services/trajectory/recording-page-bind.js \
  CHANGELOG.md
git commit -m "$(cat <<'EOF'
feat: write back function landing pageId on prepare read

When read_page_component_code succeeds, overwrite system.pd_cmpt_ecd and a single system_page row; AILZ path unchanged.
EOF
)"
```

---

### Task 3: 存量迁移 — guidePage 清理与塌缩

**Files:**
- Create: `migrations/20260831120000_system_page_landing_only.js`
- Modify: `CHANGELOG.md` `[Unreleased]`

**Interfaces:**
- Consumes: MySQL 表 `system_page`（列 `id`, `system_node_id`, `page_id`, `page_type`）、`system`（列 `id`, `pd_cmpt_ecd`）
- Produces: up/down knex migration；up 后每 `system_node_id` 至多 1 行 managePage；对应 `system.pd_cmpt_ecd` 同步；**不改** `trajectory`

- [ ] **Step 1: 编写 migration**

创建 `migrations/20260831120000_system_page_landing_only.js`：

```js
/**
 * 菜单落地 pageId 单一化存量清理：
 * 1) 删除 page_type='guidePage'
 * 2) 同一 system_node_id 多行时只留一行（优先 managePage，同类型取最小 id）
 * 3) 按保留行回写 system.pd_cmpt_ecd；无行则置 ''
 * 不修改 trajectory.page_id。
 *
 * down：不可无损恢复已删 guidePage，仅 log 说明（no-op）。
 */

/**
 * @param {import('knex').Knex} knex
 * @returns {Promise<void>}
 */
export async function up(knex) {
  // Nodes that currently have any system_page row (including guide-only) — must sync after cleanup
  const affectedBefore = await knex('system_page').distinct('system_node_id').pluck('system_node_id');
  const touchIds = new Set(affectedBefore.map(Number));

  const deletedGuides = await knex('system_page').where({ page_type: 'guidePage' }).del();
  console.log('[migration] system_page: deleted guidePage rows=%s', deletedGuides);

  const dupes = await knex('system_page')
    .select('system_node_id')
    .groupBy('system_node_id')
    .havingRaw('COUNT(*) > 1');

  let collapsed = 0;
  for (const row of dupes) {
    const nodeId = Number(row.system_node_id);
    touchIds.add(nodeId);
    const pages = await knex('system_page')
      .where({ system_node_id: nodeId })
      .orderBy([{ column: 'id', order: 'asc' }]);
    const keep =
      pages.find((p) => String(p.page_type) === 'managePage') || pages[0];
    if (!keep) continue;
    const removed = await knex('system_page')
      .where({ system_node_id: nodeId })
      .whereNot({ id: keep.id })
      .del();
    collapsed += removed;
  }
  console.log('[migration] system_page: collapsed extra rows=%s', collapsed);

  const kept = await knex('system_page').select('system_node_id', 'page_id');
  const byNode = new Map();
  for (const p of kept) {
    byNode.set(Number(p.system_node_id), String(p.page_id || ''));
  }
  // Only sync nodes that had system_page before/during this migration — never blanket-clear unrelated system rows
  let synced = 0;
  for (const id of touchIds) {
    const next = byNode.has(id) ? byNode.get(id) : '';
    await knex('system').where({ id }).update({ pd_cmpt_ecd: next });
    synced += 1;
  }
  console.log('[migration] system: synced pd_cmpt_ecd for nodes=%s', synced);
}

/**
 * @param {import('knex').Knex} knex
 * @returns {Promise<void>}
 */
export async function down(knex) {
  console.log('[migration] system_page_landing_only: down is no-op (guidePage rows not restored)');
}
```

- [ ] **Step 2: 语法检查**

Run:

```bash
node --check migrations/20260831120000_system_page_landing_only.js
```

Expected: 无输出、exit 0。

- [ ] **Step 3: 有 DB 时跑迁移（可选湿测）**

Run（需隧道/`DB_*` 可用）：

```bash
npx knex migrate:latest --knexfile config/knexfile.js
```

Expected: log 含 `deleted guidePage` / `collapsed` / `synced`；无 SQL 错误。

无 DB 时跳过本步，不阻塞提交（migration 文件仍入库）。

- [ ] **Step 4: CHANGELOG**

```md
- 2026-08-31: **存量迁移** `migrations/20260831120000_system_page_landing_only.js`：删 guidePage、塌缩每节点至多 1 行、同步 `system.pd_cmpt_ecd`；不改 trajectory。
```

- [ ] **Step 5: Commit**

```bash
git add migrations/20260831120000_system_page_landing_only.js CHANGELOG.md
git commit -m "$(cat <<'EOF'
chore: migrate system_page to single landing managePage

Delete guidePage rows, collapse duplicates per node, sync system.pd_cmpt_ecd.
EOF
)"
```

---

### Task 4: 收尾验证

**Files:**
- 无新代码（除非验证失败需回修）

- [ ] **Step 1: 跑两条核心 characterization**

```bash
node scripts/characterization/characterize-system-import-json.mjs
node scripts/characterization/characterize-page-bind.mjs
```

Expected: 皆 OK。

- [ ] **Step 2:（可选）refactor gate 子集**

若环境有 bash：

```bash
bash scripts/refactor/verify-all.sh
```

Windows 无 bash 时可跳过，以 Step 1 为准。

- [ ] **Step 3: 对照 spec 自检清单（人工）**

| Spec 项 | 落点 |
|---------|------|
| 导入只 managePage 0/1 | Task 1 `collectPages` |
| 模块恒空 | Task 1 upsert `[]` |
| prepare read 回写 | Task 2 |
| AILZ 不回写 | Task 2 cue + early path |
| 存量清 guide / 塌缩 / 同步 | Task 3 |
| 不改 trajectory 历史 | Task 3 无 trajectory SQL |
| api-docs / CHANGELOG | Task 1–3 |

无新 commit 若无 diff；若 Step 1 失败则回对应 Task 修并补 commit。

---

## Self-review (plan vs spec)

1. **Spec coverage:** §4 入库语义 → Task 1；§5 prepare 回写/AILZ → Task 2；§6 存量 → Task 3；§7 触点表文件均已列出；§8 验证命令在 Task 1/2/4；§3 非目标未写入任何任务。
2. **Placeholders:** 无 TBD；测试断言与实现代码块完整。
3. **Types:** `writeBackFunctionLandingPage(functionId, { pageId, pageName, resPath })`；`replaceForNode` 签名未改；`source === 'read'` 与现有返回值一致。
