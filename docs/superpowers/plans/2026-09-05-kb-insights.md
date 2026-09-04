# KB Insights（A1/A2/A3）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 KB 流程卡与轨迹/系统树从孤岛变成可互相反查的资产——溯源 ID 化（A1）、功能覆盖度量报表（A2）、菜单变更影响反查 + KB 卡 stale 只读检测（A3），共 4 个新只读端点。

**Architecture:** Node 控制面单向只读 `data/kb/flows/*.json`（方案甲，零 Python 改动、零 `data/kb` 写入）。纯函数（匹配器/rollup/影响推导）与 IO 组装分离，特征化用临时目录 fixture 不依赖真实数据。

**Tech Stack:** Express（既有 v2 路由）+ knex/MySQL（两个 dao 聚合方法）+ `node:fs/promises`（KB 只读器）+ 仓内 characterization 惯例（无框架断言脚本）。

**Spec:** `docs/superpowers/specs/2026-09-05-kb-insights-design.md`（已批准，含全部决策：覆盖=存在性+明细；A3 含 stale 三态只读；回填后置）。

## Global Constraints

- **禁入**：`scripts/kb/**`、`data/kb/**` 零改动（Task 8 的迁移脚本只创建不执行）；`scripts/prompts/**`、工作区他线 WIP 不碰。
- **错误处理风格**：路由用 `asyncHandler` + `AppError`（`src/http/app-error.js`）；system-mgmt.js 内照邻居 change-log 路由形态（asyncHandler 包 try/catch `toHttp(e)`）。
- **响应**：v2 envelope `{code,message,data}` 由中间件自动包，handler 直接 `res.json(数据)`。
- **JSDoc**：所有新导出函数中文 JSDoc 含 `@param`/`@returns`，不加 `@author`/`@since`；`npx eslint` 0 error 0 warning。
- **特征化**：`scripts/characterization/characterize-kb-insights.mjs` 纯 fixture 驱动（临时目录），不依赖真实 `data/kb` 与 DB；**严禁修改 characterization 其他文件**。
- **verify-all 基线**：唯一允许红 = `characterize-kb-actions`（存量，已定性）。接线前查 agent-log 在途声明，`scripts/refactor/verify-all.sh` 若他线占用则本计划不接线、留待冷区补。
- **协议**：开工声明先行（主会话代子智能体声明）；子智能体不 commit；每 Task 一个 commit，消息 `feat(kb-insights): ...`。
- **关键列名**（已核实）：`trajectory.function_id`/`trajectory.updated_at`；`batch_recording_job.function_id`；`batch_recording_item.batch_id`（FK→job.id）/`status`；`system_menu_change_log`：`systemNodeId/menuVersion/source/changeType/nodeId/detail(JSON)/createdAt`（dao 层 camelCase）。

## File Structure

```
Create:
  src/services/menu-path-matcher.js       纯函数：menu_path 解析/匹配（A2/A3 共享）
  src/services/kb-flow-cards.js           KB 卡只读器（fs/promises，可注入目录）
  src/services/coverage-service.js        A2：rollup 纯函数 + 组装
  src/services/change-impact-service.js   A3：影响推导纯函数 + 组装 + stale 检测
  src/routes/v2/kb.js                     GET /api/v2/kb/cards、/api/v2/kb/stale-cards
  migrations/backfill-kb-source-refs.mjs  A1 回填（只创建，不执行）
  scripts/characterization/characterize-kb-insights.mjs  特征化（逐任务扩展）
Modify:
  src/dao/trajectory-dao.js               + statsByFunctionIds()
  src/dao/batch-recording-dao.js          + statsByFunctionId()
  src/routes/v2/hierarchy.js              + GET /api/v2/hierarchy/coverage
  src/routes/v2/system-mgmt.js            + GET /api/v2/system-mgmt/nodes/:id/change-impact
  src/routes/v2/__init__.js               注册 kb 路由
  src/dashboard/api-docs/groups/hierarchy.js  + coverage 条目
  src/dashboard/api-docs/groups/kb.js（新）   + cards/stale 组
  src/dashboard/api-docs/catalog.js       挂载 GROUP_KB
```

依赖顺序：Task 1（matcher）→ Task 2/3 并行 → Task 4（用 1+2+3）→ Task 5 → Task 6/7 并行 → Task 8 → Task 9。

---

### Task 1: menu-path 匹配器（纯函数）

**Files:**
- Create: `src/services/menu-path-matcher.js`
- Create: `scripts/characterization/characterize-kb-insights.mjs`（初始版，只含 matcher 段）

**Interfaces:**
- Produces（后续任务依赖的精确签名）:
  - `normSegName(s: string) => string`（去全部空白字符）
  - `isFreeTextMenuPath(menuPath: string) => boolean`（true=非路径形态，不算 stale）
  - `resolveMenuPath(menuPath: string, flatNodes: Array<{id:number, parentId:number, name:string, type:number}>) => { matchStatus: 'matched'|'possibly-stale'|'unparsed', matchedNodeId?: number, matchedNodeType?: number, missingSegment?: string, resolvedPrefix?: string, ambiguous?: boolean }`
- flatNodes 来源（Task 4/6 传入）：`systemDao.listAll()`（camelCase，含 id/parentId/type/name，不含根 id=0 也可——根由 isRootParentId 语义天然终止）。注意 `parentId` 字段名。

- [ ] **Step 1: 写特征化（先失败）**

创建 `scripts/characterization/characterize-kb-insights.mjs`：

```js
/**
 * characterize-kb-insights: KB Insights 纯函数 pin（matcher/cards-loader/rollup/影响推导）。
 * 全部 fixture 驱动（临时目录/内存数组），不依赖真实 data/kb 与 DB。
 */
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = new URL('../../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
let passed = 0;
/** 单例断言包装：通过计数，失败抛出。 */
function run(name, fn) {
  try { fn(); passed += 1; console.log(`  ✓ ${name}`); }
  catch (e) { console.error(`  ✗ ${name}\n${e.message}`); throw e; }
}

// ── 段 1：menu-path matcher ──
async function testMatcher() {
  const m = await import(join(ROOT, 'src/services/menu-path-matcher.js'));
  const nodes = [
    { id: 1, parentId: 0, name: '信贷系统', type: 1 },
    { id: 11, parentId: 1, name: '授信管理', type: 2 },
    { id: 111, parentId: 11, name: '对公授信管理', type: 2 },
    { id: 1111, parentId: 111, name: '新增对公授信管理', type: 3 },
    { id: 12, parentId: 1, name: '押品管理', type: 2 },
    { id: 121, parentId: 12, name: ' 押品信息管理 ', type: 2 }, // 名字带空格
  ];
  run('matcher: 三级路径解析到功能节点', () => {
    const r = m.resolveMenuPath('授信管理/对公授信管理/新增对公授信管理', nodes);
    assert.equal(r.matchStatus, 'matched');
    assert.equal(r.matchedNodeId, 1111);
    assert.equal(r.matchedNodeType, 3);
  });
  run('matcher: 段名与节点名空白规范化后相等', () => {
    const r = m.resolveMenuPath('押品管理/押品信息管理', nodes);
    assert.equal(r.matchStatus, 'matched');
    assert.equal(r.matchedNodeId, 121);
  });
  run('matcher: 卡停在模块层也算 matched', () => {
    const r = m.resolveMenuPath('信贷系统/授信管理', nodes);
    assert.equal(r.matchStatus, 'matched');
    assert.equal(r.matchedNodeId, 11);
  });
  run('matcher: 中段缺失 → possibly-stale 带缺失段名与前缀', () => {
    const r = m.resolveMenuPath('授信管理/已删除菜单/新增对公授信管理', nodes);
    assert.equal(r.matchStatus, 'possibly-stale');
    assert.equal(r.missingSegment, '已删除菜单');
    assert.equal(r.resolvedPrefix, '授信管理');
  });
  run('matcher: 首段就缺失 → possibly-stale 空前缀', () => {
    const r = m.resolveMenuPath('不存在系统/某菜单', nodes);
    assert.equal(r.matchStatus, 'possibly-stale');
    assert.equal(r.missingSegment, '不存在系统');
  });
  run('matcher: 自由文本（含括号说明）→ unparsed', () => {
    const r = m.resolveMenuPath('未采到（押品管理菜单树普查未发现专属子菜单）', nodes);
    assert.equal(r.matchStatus, 'unparsed');
  });
  run('matcher: 单段路径 → unparsed', () => {
    assert.equal(m.resolveMenuPath('首页', nodes).matchStatus, 'unparsed');
  });
  run('matcher: 同级同名兄弟 → matched 且 ambiguous', () => {
    const dup = [...nodes, { id: 999, parentId: 1, name: '授信管理', type: 2 }];
    const r = m.resolveMenuPath('信贷系统/授信管理', dup);
    assert.equal(r.matchStatus, 'matched');
    assert.equal(r.ambiguous, true);
  });
  run('matcher: isFreeTextMenuPath 括号/「未采到」判定', () => {
    assert.equal(m.isFreeTextMenuPath('未采到（xxx）'), true);
    assert.equal(m.isFreeTextMenuPath('工作台/任务事项/待办任务'), false);
  });
}
await testMatcher();
console.log(`characterize-kb-insights(matcher): OK (${passed} checks)`);
```

- [ ] **Step 2: 跑特征化确认失败**

Run: `node scripts/characterization/characterize-kb-insights.mjs`
Expected: FAIL —— `Cannot find module '.../menu-path-matcher.js'`

- [ ] **Step 3: 实现 matcher**

创建 `src/services/menu-path-matcher.js`：

```js
/**
 * KB 流程卡 menu_path ↔ 系统树 匹配器（纯函数，无 IO）。
 * A2（覆盖报表的 kbCards 列）与 A3（变更影响反查/stale 检测）共享。
 * 段名与节点名比较前去除全部空白字符，与 Python 侧 _norm_name 语义一致。
 */

/**
 * 规范化段名/节点名：去除全部空白字符。
 * @param {string} s 原始名称
 * @returns {string} 去空白后的名称
 */
export function normSegName(s) {
  return String(s || '').replace(/\s+/g, '');
}

/**
 * 判断 menu_path 是否为自由文本（非「段/段/段」路径形态）。
 * 含括号说明、「未采到」前缀、或切分后不足 2 段 → 视为自由文本。
 * @param {string} menuPath 卡片 menu_path 原文
 * @returns {boolean} true=自由文本（不算 stale）
 */
export function isFreeTextMenuPath(menuPath) {
  const raw = String(menuPath || '').trim();
  if (!raw) return true;
  if (/[（）()]/.test(raw)) return true;
  if (raw.includes('未采到')) return true;
  return raw.split('/').map((s) => s.trim()).filter(Boolean).length < 2;
}

/**
 * 把「段/段/段」形态的 menu_path 解析到扁平节点列表。
 * 首段匹配 type=1 系统名，其后逐段在子节点中精确匹配（空白规范化后）；
 * 允许停在模块层（type=2）；同级同名兄弟取首个并标 ambiguous。
 * @param {string} menuPath 卡片 menu_path 原文
 * @param {Array<{id:number, parentId:number, name:string, type:number}>} flatNodes 扁平节点（systemDao.listAll() 形状）
 * @returns {{ matchStatus: 'matched'|'possibly-stale'|'unparsed', matchedNodeId?: number, matchedNodeType?: number, missingSegment?: string, resolvedPrefix?: string, ambiguous?: boolean }} 解析结果（unparsed 不带其余键）
 */
export function resolveMenuPath(menuPath, flatNodes) {
  const raw = String(menuPath || '').trim();
  if (isFreeTextMenuPath(raw)) {
    return { matchStatus: 'unparsed' };
  }
  const segments = raw.split('/').map((s) => s.trim()).filter(Boolean);
  const childrenOf = new Map();
  for (const n of flatNodes) {
    const key = Number(n.parentId) || 0;
    if (!childrenOf.has(key)) childrenOf.set(key, []);
    childrenOf.get(key).push(n);
  }

  let cur = null;
  const resolvedNames = [];
  let ambiguous = false;
  for (let i = 0; i < segments.length; i += 1) {
    const seg = normSegName(segments[i]);
    const expectedType = i === 0 ? 1 : null;
    const pool = (cur ? (childrenOf.get(Number(cur.id)) || []) : flatNodes)
      .filter((n) => expectedType == null || Number(n.type) === expectedType);
    const hits = pool.filter((n) => normSegName(n.name) === seg);
    if (!hits.length) {
      return {
        matchStatus: 'possibly-stale',
        missingSegment: segments[i],
        resolvedPrefix: resolvedNames.join('/'),
      };
    }
    if (hits.length > 1) ambiguous = true;
    cur = hits[0];
    resolvedNames.push(String(cur.name).trim());
  }
  return {
    matchStatus: 'matched',
    matchedNodeId: Number(cur.id),
    matchedNodeType: Number(cur.type),
    ...(ambiguous ? { ambiguous: true } : {}),
  };
}
```

注意：`'  押品信息管理 '.trim()` 后被 push 进 resolvedNames——测试只断言 matchedNodeId，名字trim即可。

- [ ] **Step 4: 跑特征化确认通过**

Run: `node scripts/characterization/characterize-kb-insights.mjs`
Expected: `characterize-kb-insights(matcher): OK (9 checks)`

- [ ] **Step 5: lint + commit**

Run: `npx eslint src/services/menu-path-matcher.js scripts/characterization/characterize-kb-insights.mjs`
Expected: 0 error 0 warning

```bash
git add src/services/menu-path-matcher.js scripts/characterization/characterize-kb-insights.mjs
git commit -m "feat(kb-insights): menu_path 匹配器——三态解析(matched/possibly-stale/unparsed)+空白规范化+同名兄弟 ambiguous，A2/A3 共享纯函数"
```

---

### Task 2: KB 卡只读器

**Files:**
- Create: `src/services/kb-flow-cards.js`
- Modify: `scripts/characterization/characterize-kb-insights.mjs`（追加 cards 段）

**Interfaces:**
- Consumes: 无（只 `node:fs/promises` + `node:path`）。
- Produces: `listFlowCards({ dir } = {}) => Promise<Array<{ flow: string, menu_path: string, source: any, source_refs: object|undefined }>>`——默认目录 `<repoRoot>/data/kb/flows`；按文件名排序；损坏/非 dict/缺 `flow` 键跳过+warn。Task 4/6/7 消费。

- [ ] **Step 1: 特征化追加 cards 段（先失败）**

在 `characterize-kb-insights.mjs` 的 `await testMatcher();` 之前插入：

```js
// ── 段 2：KB 卡只读器（临时目录 fixture）──
async function testCardsLoader() {
  const { listFlowCards } = await import(join(ROOT, 'src/services/kb-flow-cards.js'));
  const dir = mkdtempSync(join(tmpdir(), 'kb-cards-'));
  writeFileSync(join(dir, 'b.json'), JSON.stringify({ flow: '卡片B', menu_path: '授信管理/对公授信管理', source: 'K1 笔记', source_refs: { trajectory_ids: ['26081317115618826'] } }));
  writeFileSync(join(dir, 'a.json'), JSON.stringify({ flow: '卡片A', menu_path: '押品管理/押品信息管理' }));
  writeFileSync(join(dir, 'broken.json'), '{ not json');
  writeFileSync(join(dir, 'nocard.json'), JSON.stringify({ menu_path: 'x/y' })); // 缺 flow 键
  try {
    const cards = await listFlowCards({ dir });
    run('cards: 按文件名排序且透传字段', () => {
      assert.equal(cards.length, 2);
      assert.equal(cards[0].flow, '卡片A');
      assert.equal(cards[1].source_refs.trajectory_ids[0], '26081317115618826');
    });
    run('cards: 损坏/缺 flow 键跳过', () => {
      assert.ok(!cards.some((c) => c.flow == null));
    });
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
await testCardsLoader();
```

- [ ] **Step 2: 跑确认失败**

Run: `node scripts/characterization/characterize-kb-insights.mjs`
Expected: FAIL —— `Cannot find module '.../kb-flow-cards.js'`

- [ ] **Step 3: 实现只读器**

创建 `src/services/kb-flow-cards.js`：

```js
/**
 * KB 流程卡只读器：Node 控制面对 data/kb/flows/*.json 的单向只读面（方案甲）。
 * 不写 KB、不 import Python 侧；容错语义与 scripts/kb/store.py load_flows 对齐：
 * 目录缺失→空数组；单卡 JSON 损坏/非 dict/缺 flow 键→跳过并 warn。
 */
import { readdir, readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_FLOWS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'data', 'kb', 'flows');

/**
 * 列出全部流程卡的消费侧字段（按文件名排序，确定性）。
 * @param {{ dir?: string }} [opts] 可注入目录（特征化用）；缺省=仓库 data/kb/flows
 * @returns {Promise<Array<{flow: string, menu_path: string, source: any, source_refs: object|undefined}>>} 卡片列表（仅消费侧字段）
 */
export async function listFlowCards({ dir = DEFAULT_FLOWS_DIR } = {}) {
  let names;
  try {
    names = (await readdir(dir)).filter((n) => n.endsWith('.json')).sort();
  } catch (e) {
    if (e.code === 'ENOENT') return [];
    throw e;
  }
  const cards = [];
  for (const name of names) {
    let card;
    try {
      card = JSON.parse(await readFile(join(dir, name), 'utf-8'));
    } catch (e) {
      console.warn(`[kb-flow-cards] skip unparseable card: ${name} (${e.message})`);
      continue;
    }
    if (!card || typeof card !== 'object' || !card.flow) {
      console.warn(`[kb-flow-cards] skip card missing flow key: ${name}`);
      continue;
    }
    cards.push({
      flow: String(card.flow),
      menu_path: card.menu_path == null ? '' : String(card.menu_path),
      source: card.source ?? null,
      ...(card.source_refs != null ? { source_refs: card.source_refs } : {}),
    });
  }
  return cards;
}
```

- [ ] **Step 4: 跑特征化确认通过**

Run: `node scripts/characterization/characterize-kb-insights.mjs`
Expected: matcher 段 OK + `cards: …` 2 项 OK + 最终 OK 行

- [ ] **Step 5: lint + commit**

```bash
npx eslint src/services/kb-flow-cards.js scripts/characterization/characterize-kb-insights.mjs
git add src/services/kb-flow-cards.js scripts/characterization/characterize-kb-insights.mjs
git commit -m "feat(kb-insights): KB 卡只读器 listFlowCards——fs 单向只读+store.py 对齐容错+目录可注入"
```

---

### Task 3: 两个 dao 聚合方法

**Files:**
- Modify: `src/dao/trajectory-dao.js`（在 `countByFunctionIds`（:695）之后追加）
- Modify: `src/dao/batch-recording-dao.js`（文件尾部追加）
- Modify: `scripts/characterization/characterize-kb-insights.mjs`（追加 dao 文本 pin 段）

**Interfaces:**
- Produces:
  - `trajectoryDao.statsByFunctionIds(functionIds: number[]) => Promise<Map<number, {trajCount: number, lastExecutedAt: string|null}>>`
  - `batchRecordingDao.statsByFunctionId() => Promise<Map<number, {batchTotal: number, batchSuccess: number}>>`（只统计 function_id 非空的 job；join item on batch_id=job.id；success= item.status='success'）

（dao 方法按仓惯例不加 DB 单测——以源码文本 pin 钉住关键 SQL 形态，与 characterize-batch-actions.py 手法一致。）

- [ ] **Step 1: 特征化追加 dao pin 段（先失败）**

在 `console.log('characterize-kb-insights(matcher)...')` 行之前插入：

```js
// ── 段 3：dao 聚合方法源码 pin ──
async function testDaoPins() {
  const { readFileSync } = await import('node:fs');
  const tj = readFileSync(join(ROOT, 'src/dao/trajectory-dao.js'), 'utf-8');
  run('dao pin: statsByFunctionIds 按 function_id 分组且取 MAX(updated_at)', () => {
    const i = tj.indexOf('export async function statsByFunctionIds');
    assert.ok(i > 0, 'statsByFunctionIds 存在');
    const body = tj.slice(i, i + 1200);
    assert.match(body, /whereIn\('function_id'/);
    assert.match(body, /max\('updated_at' as last_at\)|MAX\(updated_at\) as last_at/);
    assert.match(body, /groupBy\('function_id'\)/);
  });
  const bd = readFileSync(join(ROOT, 'src/dao/batch-recording-dao.js'), 'utf-8');
  run('dao pin: statsByFunctionId join batch_id 且 success 计数', () => {
    const i = bd.indexOf('export async function statsByFunctionId');
    assert.ok(i > 0, 'statsByFunctionId 存在');
    const body = bd.slice(i, i + 1600);
    assert.match(body, /batch_recording_item/);
    assert.match(body, /batch_id/);
    assert.match(body, /'success'/);
    assert.match(body, /groupBy\('function_id'\)|groupBy\('j\.function_id'\)/);
  });
}
await testDaoPins();
```

- [ ] **Step 2: 跑确认失败**

Run: `node scripts/characterization/characterize-kb-insights.mjs`
Expected: FAIL —— `statsByFunctionIds 存在`

- [ ] **Step 3: 实现 trajectory-dao.statsByFunctionIds**

在 `src/dao/trajectory-dao.js` 的 `countByFunctionIds` 函数之后追加（先读该函数结尾确认插入点）：

```js
/**
 * 按功能节点批量统计绑定轨迹数与最近执行时间（覆盖报表用，一次查询防 N+1）。
 * 最近执行时间取该 function_id 下 updated_at 最大值。
 * @param {number[]} functionIds 功能节点 id 数组
 * @returns {Promise<Map<number, {trajCount: number, lastExecutedAt: string|null}>>} functionId → 统计（无绑定轨迹的 id 不在 Map 中）
 */
export async function statsByFunctionIds(functionIds) {
  const ids = (Array.isArray(functionIds) ? functionIds : []).map(Number).filter(Number.isFinite);
  if (!ids.length) return new Map();
  const rows = await getDB()(TABLE)
    .whereIn('function_id', ids)
    .groupBy('function_id')
    .select([
      'function_id',
      getDB().client.count('* as c'),
      getDB().client.max('updated_at as last_at'),
    ]);
  const out = new Map();
  for (const r of rows) {
    out.set(Number(r.function_id), {
      trajCount: Number(r.c) || 0,
      lastExecutedAt: r.last_at == null ? null : String(r.last_at),
    });
  }
  return out;
}
```

（若 knex 聚合 select 写法与文件内既有聚合风格不一致——对照 `countByRecordStatus` 的写法改为 `count('* as c')` 与 `max('updated_at as last_at')` 直接进 select 数组——以能跑通为准，两种写法 knex 均支持。）

- [ ] **Step 4: 实现 batch-recording-dao.statsByFunctionId**

在 `src/dao/batch-recording-dao.js` 尾部追加：

```js
/**
 * 按功能节点聚合批量执行统计（覆盖报表用）：绑定过批量任务的 functionId →
 * item 总数与 success 数。job.function_id 为空的行不参与。
 * @returns {Promise<Map<number, {batchTotal: number, batchSuccess: number}>>} functionId → 统计
 */
export async function statsByFunctionId() {
  const db = getDB();
  const rows = await db(ITEM_TABLE)
    .join(JOB_TABLE, `${ITEM_TABLE}.batch_id`, `${JOB_TABLE}.id`)
    .whereNotNull(`${JOB_TABLE}.function_id`)
    .groupBy(`${JOB_TABLE}.function_id`)
    .select([
      `${JOB_TABLE}.function_id`,
      db.client.count('* as total'),
      db.client.sum("case when batch_recording_item.status = 'success' then 1 else 0 end as ok"),
    ]);
  const out = new Map();
  for (const r of rows) {
    out.set(Number(r.function_id), {
      batchTotal: Number(r.total) || 0,
      batchSuccess: Number(r.ok) || 0,
    });
  }
  return out;
}
```

（表名常量若在 join 里被 knex 加前缀导致 sum 的 raw SQL 表名不匹配——把 `sum(...)` 的 raw 串改为 `sum(case when status = 'success' then 1 else 0 end as ok)`（无表名前缀，单表语义无歧义）。pin 已兼容两种 groupBy 写法。）

- [ ] **Step 5: 跑特征化确认通过 + lint + commit**

```bash
node scripts/characterization/characterize-kb-insights.mjs   # 全段 OK
npx eslint src/dao/trajectory-dao.js src/dao/batch-recording-dao.js scripts/characterization/characterize-kb-insights.mjs
git add src/dao/trajectory-dao.js src/dao/batch-recording-dao.js scripts/characterization/characterize-kb-insights.mjs
git commit -m "feat(kb-insights): dao 聚合——trajectory statsByFunctionIds(轨迹数+最近执行) 与 batch statsByFunctionId(item 总数/成功数)"
```

---

### Task 4: coverage-service（rollup 纯函数 + 组装）

**Files:**
- Create: `src/services/coverage-service.js`
- Modify: `scripts/characterization/characterize-kb-insights.mjs`（追加 rollup 段）

**Interfaces:**
- Consumes: `normSegName` 不直接用；`resolveMenuPath`（Task 1）、`listFlowCards`（Task 2）、`statsByFunctionIds`（Task 3）、`statsByFunctionId`（Task 3）、`systemDao.listAll()`、`buildPath(nodeId, byId: Map)`（hierarchy-tree-query）。
- Produces:
  - `rollupCoverage(flatNodes, { trajStats: Map, batchStats: Map, kbCardsByNode: Map }) => { rows, summary }`（纯函数）
  - `buildCoverageReport({ systemId, type } = {}) => Promise<{ rows, summary }>`（组装；type 默认 'function' 只出 type=3 行，'all' 出全部非根行）
- rows 行形状（Task 5 端点直接 res.json 的 data）：`{ nodeId, type, name, path, trajCount, lastExecutedAt, batchTotal, batchSuccess, kbCards, covered }`；summary：`{ totalFunctions, coveredFunctions, coverageRate }`。

- [ ] **Step 1: 特征化追加 rollup 段（先失败）**

在最终 OK 行之前插入：

```js
// ── 段 4：coverage rollup ──
async function testRollup() {
  const { rollupCoverage } = await import(join(ROOT, 'src/services/coverage-service.js'));
  const nodes = [
    { id: 1, parentId: 0, name: '信贷系统', type: 1 },
    { id: 11, parentId: 1, name: '授信管理', type: 2 },
    { id: 111, parentId: 11, name: '新增对公授信', type: 3 },
    { id: 112, parentId: 11, name: '授信查询', type: 3 },
  ];
  const trajStats = new Map([[111, { trajCount: 4, lastExecutedAt: '2026-09-01T10:00:00.000Z' }]]);
  const batchStats = new Map([[112, { batchTotal: 12, batchSuccess: 10 }]]);
  const kbCardsByNode = new Map([[111, 1]]);
  run('rollup: 行覆盖判定与明细列', () => {
    const { rows, summary } = rollupCoverage(nodes, { trajStats, batchStats, kbCardsByNode });
    const r111 = rows.find((r) => r.nodeId === 111);
    assert.equal(r111.covered, true);
    assert.equal(r111.trajCount, 4);
    assert.equal(r111.lastExecutedAt, '2026-09-01T10:00:00.000Z');
    assert.equal(r111.batchTotal, 0);
    assert.equal(r111.kbCards, 1);
    assert.equal(r111.path, '信贷系统/授信管理/新增对公授信');
    const r112 = rows.find((r) => r.nodeId === 112);
    assert.equal(r112.covered, false); // 只有批量成功、无绑定轨迹 → 未覆盖（存在性判定）
    assert.equal(r112.batchSuccess, 10);
    assert.equal(summary.totalFunctions, 2);
    assert.equal(summary.coveredFunctions, 1);
    assert.equal(summary.coverageRate, 0.5);
  });
  run('rollup: 空树空统计', () => {
    const { rows, summary } = rollupCoverage([], { trajStats: new Map(), batchStats: new Map(), kbCardsByNode: new Map() });
    assert.equal(rows.length, 0);
    assert.equal(summary.coverageRate, 0);
  });
}
await testRollup();
```

- [ ] **Step 2: 跑确认失败**

Run: `node scripts/characterization/characterize-kb-insights.mjs`
Expected: FAIL —— `Cannot find module '.../coverage-service.js'`

- [ ] **Step 3: 实现 coverage-service**

创建 `src/services/coverage-service.js`：

```js
/**
 * A2 覆盖分析服务：功能树执行覆盖度量与报表组装。
 * 覆盖判定=存在性（有 functionId 绑定轨迹即 covered）；最近执行/批量成功率/KB 卡数为明细列。
 */
import * as systemDao from '../dao/system-dao.js';
import * as trajectoryDao from '../dao/trajectory-dao.js';
import * as batchRecordingDao from '../dao/batch-recording-dao.js';
import { buildPath } from './hierarchy-tree-query.js';
import { resolveMenuPath } from './menu-path-matcher.js';
import { listFlowCards } from './kb-flow-cards.js';

/**
 * 由节点名链拼可读路径（用「/」连接，不含根节点）。
 * @param {Array<{id:number,name:string}>} chain buildPath 返回的祖先链
 * @returns {string} 形如「信贷系统/授信管理/新增对公授信」
 */
function chainToPath(chain) {
  return chain.map((c) => String(c.name).trim()).join('/');
}

/**
 * 纯函数：把扁平节点与三组统计卷成覆盖报表行（供特征化与组装复用）。
 * @param {Array<{id:number, parentId:number, name:string, type:number}>} flatNodes 扁平节点
 * @param {{ trajStats: Map<number, {trajCount:number, lastExecutedAt:string|null}>, batchStats: Map<number, {batchTotal:number, batchSuccess:number}>, kbCardsByNode: Map<number, number>, byId?: Map<number, object> }} deps 统计与 byId 索引（缺省由 flatNodes 自建）
 * @returns {{ rows: Array<object>, summary: { totalFunctions: number, coveredFunctions: number, coverageRate: number } }} 报表
 */
export function rollupCoverage(flatNodes, { trajStats, batchStats, kbCardsByNode, byId } = {}) {
  const idx = byId || new Map(flatNodes.map((n) => [Number(n.id), n]));
  const rows = [];
  let totalFunctions = 0;
  let coveredFunctions = 0;
  for (const n of flatNodes) {
    const traj = trajStats.get(Number(n.id));
    const batch = batchStats.get(Number(n.id));
    const kbCards = kbCardsByNode.get(Number(n.id)) || 0;
    const covered = (traj?.trajCount || 0) > 0;
    if (Number(n.type) === 3) {
      totalFunctions += 1;
      if (covered) coveredFunctions += 1;
    }
    rows.push({
      nodeId: Number(n.id),
      type: Number(n.type),
      name: String(n.name).trim(),
      path: chainToPath(buildPath(n.id, idx)),
      trajCount: traj?.trajCount || 0,
      lastExecutedAt: traj?.lastExecutedAt ?? null,
      batchTotal: batch?.batchTotal || 0,
      batchSuccess: batch?.batchSuccess || 0,
      kbCards,
      covered,
    });
  }
  return {
    rows,
    summary: {
      totalFunctions,
      coveredFunctions,
      coverageRate: totalFunctions ? coveredFunctions / totalFunctions : 0,
    },
  };
}

/**
 * 组装覆盖报表：全量节点 + 轨迹/批量统计 + KB 卡计数。
 * @param {{ systemId?: number|string, type?: 'function'|'all' }} [opts] systemId 限定系统子树；type 缺省只出功能节点行
 * @returns {Promise<{ rows: Array<object>, summary: object }>} 报表（rows 按 path 字典序）
 */
export async function buildCoverageReport({ systemId, type = 'function' } = {}) {
  const flatNodes = await systemDao.listAll();
  const sysId = systemId == null || systemId === '' ? null : Number(systemId);
  let scoped = flatNodes;
  if (sysId != null && Number.isFinite(sysId)) {
    const byId = new Map(flatNodes.map((n) => [Number(n.id), n]));
    const keep = new Set();
    const collect = (id) => {
      if (keep.has(id)) return;
      keep.add(id);
      for (const n of flatNodes) if (Number(n.parentId) === id) collect(Number(n.id));
    };
    collect(sysId);
    scoped = flatNodes.filter((n) => keep.has(Number(n.id)) || Number(n.id) === sysId);
    void byId;
  }
  const trajStats = await trajectoryDao.statsByFunctionIds(scoped.filter((n) => Number(n.type) === 3).map((n) => Number(n.id)));
  const batchStats = await batchRecordingDao.statsByFunctionId();
  const cards = await listFlowCards();
  const kbCardsByNode = new Map();
  for (const card of cards) {
    const r = resolveMenuPath(card.menu_path, flatNodes);
    if (r.matchStatus === 'matched') {
      kbCardsByNode.set(r.matchedNodeId, (kbCardsByNode.get(r.matchedNodeId) || 0) + 1);
    }
  }
  const report = rollupCoverage(scoped, { trajStats, batchStats, kbCardsByNode });
  const rows = type === 'all' ? report.rows : report.rows.filter((r) => r.type === 3);
  rows.sort((a, b) => String(a.path).localeCompare(String(b.path), 'zh-Hans-CN'));
  return { rows, summary: report.summary };
}
```

（`scoped` 子树收集用 O(n²) 邻接遍历即可——386 节点量级；`void byId` 行若 lint 报 unused 直接删除该行与 byId 声明。）

- [ ] **Step 4: 跑特征化确认通过 + lint + commit**

```bash
node scripts/characterization/characterize-kb-insights.mjs
npx eslint src/services/coverage-service.js scripts/characterization/characterize-kb-insights.mjs
git add src/services/coverage-service.js scripts/characterization/characterize-kb-insights.mjs
git commit -m "feat(kb-insights): coverage-service——rollup 纯函数(存在性覆盖+明细列)+buildCoverageReport 组装(systemId 限域/type 过滤/kbCards 计数)"
```

---

### Task 5: coverage 路由 + catalog hierarchy 条目

**Files:**
- Modify: `src/routes/v2/hierarchy.js`（import 区 + 路由注册体内追加）
- Modify: `src/dashboard/api-docs/groups/hierarchy.js`（endpoints 数组追加）

**Interfaces:**
- Consumes: `buildCoverageReport`（Task 4）。
- Produces: `GET /api/v2/hierarchy/coverage?systemId=&type=function|all` → data 为 `{rows, summary}`。

- [ ] **Step 1: 加 handler**

`hierarchy.js` import 区加 `import * as coverageService from '../../services/coverage-service.js';`；在 `registerBrowserHierarchyRoutes` 注册体内（`/api/v2/hierarchy/tree` 附近）追加：

```js
  /** Coverage report: per-function execution coverage over the hierarchy tree. */
  app.get('/api/v2/hierarchy/coverage', asyncHandler(async (req, res) => {
    const type = req.query.type === 'all' ? 'all' : 'function';
    if (req.query.systemId != null && req.query.systemId !== '' && !Number.isFinite(Number(req.query.systemId))) {
      throw new AppError('systemId must be a number', { code: 'VALIDATION' });
    }
    res.json(await coverageService.buildCoverageReport({ systemId: req.query.systemId, type }));
  }));
```

- [ ] **Step 2: catalog 条目**

`groups/hierarchy.js` 的 GROUP_HIERARCHY endpoints 数组尾部追加（沿用 `J` helper）：

```js
      {
        method: 'GET', path: '/api/v2/hierarchy/coverage',
        summary: '功能执行覆盖报表（覆盖=有绑定轨迹；含最近执行/批量成功率/KB卡数明细）',
        params: [
          { name: 'systemId', type: 'number', required: false, in: 'query', desc: '限定系统子树' },
          { name: 'type', type: 'string', required: false, in: 'query', desc: 'function(默认,仅功能节点)|all(含系统/模块聚合行)' },
        ],
        respExample: J({
          rows: [{
            nodeId: 111, type: 3, name: '新增对公授信管理', path: '信贷系统/授信管理/新增对公授信管理',
            trajCount: 4, lastExecutedAt: '2026-09-01T10:00:00.000Z',
            batchTotal: 12, batchSuccess: 10, kbCards: 1, covered: true,
          }],
          summary: { totalFunctions: 386, coveredFunctions: 57, coverageRate: 0.148 },
        }),
      },
```

- [ ] **Step 3: 语法/lint + 模块加载冒烟 + commit**

```bash
node --check src/routes/v2/hierarchy.js && node --check src/dashboard/api-docs/groups/hierarchy.js
npx eslint src/routes/v2/hierarchy.js src/dashboard/api-docs/groups/hierarchy.js
node scripts/characterization/characterize-system-node-accounts.mjs   # hierarchy.js 既有 pin 不破
git add src/routes/v2/hierarchy.js src/dashboard/api-docs/groups/hierarchy.js
git commit -m "feat(kb-insights): GET /api/v2/hierarchy/coverage 端点 + /api/docs hierarchy 组条目"
```

---

### Task 6: change-impact-service + system-mgmt 路由

**Files:**
- Create: `src/services/change-impact-service.js`
- Modify: `src/routes/v2/system-mgmt.js`（change-log 路由之后追加）
- Modify: `scripts/characterization/characterize-kb-insights.mjs`（追加影响推导段）

**Interfaces:**
- Consumes: `menuChangeLogDao.listBySystem(systemNodeId, {version, limit}, db?)`（既有，返回 `{id,systemNodeId,menuVersion,source,changeType,nodeId,detail,createdAt}`，detail 为对象或字符串）；`resolveMenuPath`（Task 1）；`listFlowCards`（Task 2）；`systemDao.listAll()`；trajectory 绑定查询（见 Step 3 的 dao 内联查询——不改 trajectory-dao，用 knex 直查，避免为本计划扩公共 dao 面）。
- Produces:
  - `deriveChangeImpacts(changeRows, { flatNodes, trajectoriesByFunction: Map<number, Array<{id,name}>>, cards }) => { changes, summary }`（纯函数）
  - `analyzeChangeImpact(systemNodeId, { version, limit } = {}) => Promise<{ changes, summary }>`
- 受影响轨迹推导：变更行 nodeId 非空 → `trajectoriesByFunction.get(nodeId)`；nodeId 为空 → 按 detail 内新旧名匹配受影响卡（轨迹侧跳过）。受影响卡：变更行 changeType 对应名字段（detail.oldName 或 detail.name）作为段名，命中任一卡 menu_path 的段 → 该卡受影响。

- [ ] **Step 1: 特征化追加段（先失败）**

在最终 OK 行之前插入：

```js
// ── 段 5：change impact 推导 ──
async function testImpact() {
  const { deriveChangeImpacts } = await import(join(ROOT, 'src/services/change-impact-service.js'));
  const nodes = [
    { id: 1, parentId: 0, name: '信贷系统', type: 1 },
    { id: 11, parentId: 1, name: '授信管理', type: 2 },
    { id: 111, parentId: 11, name: '新增对公授信管理', type: 3 },
  ];
  const cards = [
    { flow: '授信卡', menu_path: '授信管理/新增对公授信管理' },
    { flow: '押品卡', menu_path: '押品管理/押品信息管理' },
  ];
  const trajByFunc = new Map([[111, [{ id: 9001, name: 'traj-A' }]]]);
  run('impact: nodeId 命中轨迹 + oldName 命中卡片', () => {
    const { changes, summary } = deriveChangeImpacts(
      [{ id: 1, changeType: 'renamed', nodeId: 111, detail: { oldName: '新增对公授信管理', name: '新增对公授信' } }],
      { flatNodes: nodes, trajectoriesByFunction: trajByFunc, cards },
    );
    assert.equal(changes[0].affectedTrajectories.length, 1);
    assert.equal(changes[0].affectedTrajectories[0].id, 9001);
    assert.deepEqual(changes[0].affectedKbCards, ['授信卡']);
    assert.equal(summary.affectedKbCardCount, 1);
  });
  run('impact: nodeId 空时轨迹侧跳过、名字侧仍匹配', () => {
    const { changes } = deriveChangeImpacts(
      [{ id: 2, changeType: 'created', nodeId: null, detail: { name: '新菜单' } }],
      { flatNodes: nodes, trajectoriesByFunction: trajByFunc, cards },
    );
    assert.equal(changes[0].affectedTrajectories.length, 0);
    assert.equal(changes[0].affectedKbCards.length, 0);
  });
  run('impact: 空变更流水', () => {
    const { changes, summary } = deriveChangeImpacts([], { flatNodes: nodes, trajectoriesByFunction: new Map(), cards: [] });
    assert.equal(changes.length, 0);
    assert.equal(summary.changes, 0);
  });
}
await testImpact();
```

- [ ] **Step 2: 跑确认失败**

Run: `node scripts/characterization/characterize-kb-insights.mjs`
Expected: FAIL —— `Cannot find module '.../change-impact-service.js'`

- [ ] **Step 3: 实现 change-impact-service**

创建 `src/services/change-impact-service.js`：

```js
/**
 * A3 变更影响反查服务：菜单变更流水 → 受影响轨迹（functionId 绑定）与受影响 KB 卡（menu_path 段名命中）。
 * 纯推导函数与 IO 组装分离；只读，不写任何数据。
 */
import { getDB } from '../config/database.js';
import * as menuChangeLogDao from '../dao/menu-change-log-dao.js';
import * as systemDao from '../dao/system-dao.js';
import { listFlowCards } from './kb-flow-cards.js';
import { normSegName } from './menu-path-matcher.js';

const TRAJECTORY_TABLE = 'trajectory';

/**
 * 从变更行 detail 提取参与名字匹配的候选名集合（新旧名）。
 * @param {object|string|null} detail 变更明细（对象或 JSON 字符串）
 * @returns {string[]} 非空候选名数组
 */
function detailNames(detail) {
  let d = detail;
  if (typeof d === 'string') {
    try { d = JSON.parse(d); } catch { return []; }
  }
  if (!d || typeof d !== 'object') return [];
  return [d.oldName, d.name, d.newName].filter((x) => x != null && String(x).trim() !== '').map((x) => String(x).trim());
}

/**
 * 纯函数：变更流水 → 逐行影响面（轨迹按 nodeId 直查绑定；卡按新旧名段命中 menu_path）。
 * @param {Array<object>} changeRows menu_change_log 行（camelCase）
 * @param {{ flatNodes: Array<object>, trajectoriesByFunction: Map<number, Array<{id:number,name:string}>>, cards: Array<{flow:string, menu_path:string}> }} deps 节点/轨迹绑定索引/卡片
 * @returns {{ changes: Array<object>, summary: { changes: number, affectedTrajectoryCount: number, affectedKbCardCount: number } }} 影响报表
 */
export function deriveChangeImpacts(changeRows, { flatNodes, trajectoriesByFunction, cards }) {
  const cardSegs = cards.map((c) => ({
    card: c,
    segs: String(c.menu_path || '').split('/').map((s) => normSegName(s)).filter(Boolean),
  }));
  const changes = changeRows.map((row) => {
    const nodeId = row.nodeId == null ? null : Number(row.nodeId);
    const affectedTrajectories = nodeId != null ? (trajectoriesByFunction.get(nodeId) || []) : [];
    const names = detailNames(row.detail).map(normSegName);
    const affectedKbCards = cardSegs
      .filter(({ segs }) => names.some((nm) => nm !== '' && segs.includes(nm)))
      .map(({ card }) => card.flow);
    return { ...row, affectedTrajectories, affectedKbCards };
  });
  return {
    changes,
    summary: {
      changes: changes.length,
      affectedTrajectoryCount: changes.reduce((acc, c) => acc + c.affectedTrajectories.length, 0),
      affectedKbCardCount: changes.reduce((acc, c) => acc + c.affectedKbCards.length, 0),
    },
  };
}

/**
 * 组装变更影响分析：变更流水 + 轨迹绑定 + KB 卡一次性查齐后推导。
 * @param {number} systemNodeId 系统节点 id
 * @param {{ version?: number|string|null, limit?: number }} [opts] 版本过滤与行数上限（默认 200）
 * @returns {Promise<{ changes: Array<object>, summary: object }>} 影响报表（无变更→空表非错误）
 */
export async function analyzeChangeImpact(systemNodeId, { version, limit = 200 } = {}) {
  const changeRows = await menuChangeLogDao.listBySystem(Number(systemNodeId), {
    version: version || null,
    limit,
  });
  if (!changeRows.length) {
    return { changes: [], summary: { changes: 0, affectedTrajectoryCount: 0, affectedKbCardCount: 0 } };
  }
  const [flatNodes, cards] = await Promise.all([systemDao.listAll(), listFlowCards()]);
  const nodeIds = new Set(flatNodes.map((n) => Number(n.id)));
  const fnIds = [...nodeIds];
  const boundRows = fnIds.length
    ? await getDB()(TRAJECTORY_TABLE).whereIn('function_id', fnIds).select(['id', 'name', 'function_id'])
    : [];
  const trajectoriesByFunction = new Map();
  for (const r of boundRows) {
    const fid = Number(r.function_id);
    if (!trajectoriesByFunction.has(fid)) trajectoriesByFunction.set(fid, []);
    trajectoriesByFunction.get(fid).push({ id: Number(r.id), name: String(r.name || '') });
  }
  return deriveChangeImpacts(changeRows, { flatNodes, trajectoriesByFunction, cards });
}
```

- [ ] **Step 4: 跑特征化确认通过 + 实现 system-mgmt handler**

在 `src/routes/v2/system-mgmt.js` 的 change-log 路由（:243-250）之后追加（import 区加 `import * as changeImpactService from '../../services/change-impact-service.js';`）：

```js
  /** 4.4b 菜单变更影响反查：受影响轨迹（functionId 绑定）与受影响 KB 流程卡 */
  app.get('/api/v2/system-mgmt/nodes/:id/change-impact', asyncHandler(async (req, res) => {
    try {
      const limit = Math.min(Math.max(Number(req.query.limit) || 200, 1), 1000);
      const report = await changeImpactService.analyzeChangeImpact(Number(req.params.id), {
        version: req.query.version || null,
        limit,
      });
      res.json(report);
    } catch (e) {
      toHttp(e);
    }
  }));
```

- [ ] **Step 5: 验证 + commit**

```bash
node scripts/characterization/characterize-kb-insights.mjs
node --check src/routes/v2/system-mgmt.js && node --check src/services/change-impact-service.js
npx eslint src/services/change-impact-service.js src/routes/v2/system-mgmt.js scripts/characterization/characterize-kb-insights.mjs
git add src/services/change-impact-service.js src/routes/v2/system-mgmt.js scripts/characterization/characterize-kb-insights.mjs
git commit -m "feat(kb-insights): A3 变更影响反查——deriveChangeImpacts 纯函数 + GET /nodes/:id/change-impact（轨迹按 nodeId 绑定、卡按新旧名段命中）"
```

---

### Task 7: kb 路由（cards + stale-cards）+ 注册 + catalog 组

**Files:**
- Create: `src/routes/v2/kb.js`
- Create: `src/dashboard/api-docs/groups/kb.js`
- Modify: `src/routes/v2/__init__.js`（import + 调用）
- Modify: `src/dashboard/api-docs/catalog.js`（import GROUP_KB + `...GROUP_KB` 挂载）
- Modify: `scripts/characterization/characterize-kb-insights.mjs`（追加 stale 段）

**Interfaces:**
- Consumes: `listFlowCards`（Task 2）、`resolveMenuPath`（Task 1）、`analyzeChangeImpact` 不在本路由（在 system-mgmt）。
- Produces: `GET /api/v2/kb/cards`（data=cards 数组）；`GET /api/v2/kb/stale-cards`（data=`{cards, summary}`，card 三态 matched/possibly-stale/unparsed）。

- [ ] **Step 1: 特征化追加 stale 段（先失败）**

在最终 OK 行之前插入：

```js
// ── 段 6：stale 检测组装 ──
async function testStale() {
  const { detectStaleCards } = await import(join(ROOT, 'src/services/change-impact-service.js'));
  const nodes = [
    { id: 1, parentId: 0, name: '信贷系统', type: 1 },
    { id: 11, parentId: 1, name: '授信管理', type: 2 },
  ];
  const cards = [
    { flow: '好卡', menu_path: '信贷系统/授信管理' },
    { flow: '疑失效卡', menu_path: '信贷系统/已删菜单' },
    { flow: '自由文本卡', menu_path: '未采到（说明）' },
  ];
  run('stale: 三态分布', () => {
    const { cards: out, summary } = detectStaleCards(cards, nodes);
    const by = Object.fromEntries(out.map((c) => [c.flow, c.matchStatus]));
    assert.equal(by['好卡'], 'matched');
    assert.equal(by['疑失效卡'], 'possibly-stale');
    assert.equal(by['自由文本卡'], 'unparsed');
    assert.equal(summary.possiblyStale, 1);
    assert.equal(summary.unparsed, 1);
  });
}
await testStale();
```

- [ ] **Step 2: 跑确认失败**

Run: `node scripts/characterization/characterize-kb-insights.mjs`
Expected: FAIL —— `detectStaleCards is not a function`

- [ ] **Step 3: 实现 detectStaleCards（追加到 change-impact-service.js）**

```js
/**
 * KB 卡 possibly-stale 检测（只读）：逐卡 menu_path 解析到当前系统树，三态报告。
 * 自由文本 → unparsed（不算 stale）；永不写卡、不影响召回。
 * @param {Array<{flow:string, menu_path:string}>} cards 流程卡列表
 * @param {Array<{id:number, parentId:number, name:string, type:number}>} flatNodes 当前树扁平节点
 * @returns {{ cards: Array<{flow:string, menu_path:string, matchStatus:string, matchedNodeId?:number, missingSegment?:string, resolvedPrefix?:string}>, summary: { total:number, matched:number, possiblyStale:number, unparsed:number } }} 检测报告
 */
export function detectStaleCards(cards, flatNodes) {
  const out = cards.map((c) => {
    const r = resolveMenuPath(c.menu_path, flatNodes);
    return {
      flow: c.flow,
      menu_path: c.menu_path,
      matchStatus: r.matchStatus,
      ...(r.matchedNodeId != null ? { matchedNodeId: r.matchedNodeId } : {}),
      ...(r.missingSegment != null ? { missingSegment: r.missingSegment } : {}),
      ...(r.resolvedPrefix != null ? { resolvedPrefix: r.resolvedPrefix } : {}),
    };
  });
  return {
    cards: out,
    summary: {
      total: out.length,
      matched: out.filter((c) => c.matchStatus === 'matched').length,
      possiblyStale: out.filter((c) => c.matchStatus === 'possibly-stale').length,
      unparsed: out.filter((c) => c.matchStatus === 'unparsed').length,
    },
  };
}
```

（文件顶部 import 区补 `resolveMenuPath`——Task 6 已 import `normSegName`，改为 `import { normSegName, resolveMenuPath } from './menu-path-matcher.js';`。）

- [ ] **Step 4: 实现 kb.js 路由**

创建 `src/routes/v2/kb.js`：

```js
import { asyncHandler } from '../../http/app-error.js';
import { listFlowCards } from '../../services/kb-flow-cards.js';
import { detectStaleCards } from '../../services/change-impact-service.js';
import * as systemDao from '../../dao/system-dao.js';

/**
 * KB insights routes: flow-card listing (with source_refs provenance) and
 * read-only possibly-stale detection against the current hierarchy tree.
 *
 * Prefix: /api/v2/kb/*
 * @param {import('express').Application} app Express application
 */
export default function registerKbRoutes(app) {
  /** GET /api/v2/kb/cards — 全部流程卡消费侧字段（含 source/ source_refs 溯源）。 */
  app.get('/api/v2/kb/cards', asyncHandler(async (req, res) => {
    res.json(await listFlowCards());
  }));

  /** GET /api/v2/kb/stale-cards — menu_path 对当前树三态解析（只读，不写卡）。 */
  app.get('/api/v2/kb/stale-cards', asyncHandler(async (req, res) => {
    const [cards, flatNodes] = await Promise.all([listFlowCards(), systemDao.listAll()]);
    res.json(detectStaleCards(cards, flatNodes));
  }));
}
```

- [ ] **Step 5: 注册 + catalog**

`src/routes/v2/__init__.js`：import 区加 `import registerKb from './kb.js';`，函数体内（其他 register 调用旁）加 `registerKb(app);`。

创建 `src/dashboard/api-docs/groups/kb.js`：

```js
/**
 * API group(s): kb — extracted per kb-insights plan.
 * Keep in sync with src/routes/v2/kb.js
 */

/** @typedef {{ name: string, type: string, required?: boolean, in?: 'path'|'query'|'body', desc: string, example?: string }} Param */
/** @typedef {{ method: string, path: string, summary: string, desc?: string, params?: Param[], reqExample?: string, respExample?: string, notes?: string[], deprecated?: boolean, tryable?: boolean }} Endpoint */
/** @typedef {{ id: string, name: string, description: string, endpoints: Endpoint[] }} TagGroup */

import { J } from './_j.js';

/** @type {TagGroup[]} */
export const GROUP_KB = [{
  id: 'kb',
  name: 'KB 洞察',
  description: '信贷知识库流程卡只读面：溯源清单与失效检测（与 data/kb/flows 单向只读）',
  endpoints: [
    {
      method: 'GET', path: '/api/v2/kb/cards',
      summary: '流程卡清单（flow/menu_path/source/source_refs 溯源）',
      respExample: J([{
        flow: '对公授信申请', menu_path: '授信管理/对公授信管理/新增对公授信管理',
        source: 'K1 2026-08-31 + 交易 203-206',
        source_refs: { trajectory_ids: ['26081317115618826'], tx_nos: ['009'], dates: ['2026-09-01'] },
      }]),
    },
    {
      method: 'GET', path: '/api/v2/kb/stale-cards',
      summary: '卡 menu_path 对当前树三态解析（matched/possibly-stale/unparsed，只读）',
      respExample: J({
        cards: [{ flow: '某卡', menu_path: '授信管理/已删菜单', matchStatus: 'possibly-stale', missingSegment: '已删菜单', resolvedPrefix: '授信管理' }],
        summary: { total: 25, matched: 20, possiblyStale: 2, unparsed: 3 },
      }),
    },
  ],
}];
```

`catalog.js`：import 区加 `import { GROUP_KB } from './groups/kb.js';`，groups 汇总数组（`...GROUP_HIERARCHY,` 同级）加 `...GROUP_KB,`。

- [ ] **Step 6: 验证 + commit**

```bash
node scripts/characterization/characterize-kb-insights.mjs
node --check src/routes/v2/kb.js && node --check src/routes/v2/__init__.js && node --check src/dashboard/api-docs/catalog.js
npx eslint src/routes/v2/kb.js src/routes/v2/__init__.js src/dashboard/api-docs/catalog.js src/dashboard/api-docs/groups/kb.js src/services/change-impact-service.js scripts/characterization/characterize-kb-insights.mjs
git add src/routes/v2/kb.js src/routes/v2/__init__.js src/dashboard/api-docs/catalog.js src/dashboard/api-docs/groups/kb.js src/services/change-impact-service.js scripts/characterization/characterize-kb-insights.mjs
git commit -m "feat(kb-insights): GET /api/v2/kb/cards 与 /kb/stale-cards 端点 + detectStaleCards 三态 + /api/docs KB 组"
```

---

### Task 8: A1 回填迁移脚本（只创建，不执行）

**Files:**
- Create: `migrations/backfill-kb-source-refs.mjs`

**Interfaces:**
- Consumes: `data/kb/flows/*.json`（只读写盘在 `--apply` 时；本任务创建后不执行）。
- Produces: 可执行回填脚本；解析器导出 `parseSourceRefs(source: string) => { trajectory_ids: string[], tx_nos: string[], dates: string[] }`（供特征化引用为纯函数）。

- [ ] **Step 1: 实现脚本**

创建 `migrations/backfill-kb-source-refs.mjs`：

```js
/**
 * A1 回填：解析 data/kb/flows/*.json 的 source 自由文本 → source_refs 结构化溯源。
 * 默认 --dry-run 只打印；--apply 才写盘；仅写 source_refs 键，绝不触碰卡片其他字段。
 * 执行时机（spec 定案）：后置——KB 线 WIP 提交、data/kb/flows 无未提交改动后单独跑。
 * 用法：node migrations/backfill-kb-source-refs.mjs [--apply]
 */
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const FLOWS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'kb', 'flows');
const APPLY = process.argv.includes('--apply');

/**
 * 解析 source 文本中的溯源 ID（高置信正则）。
 * @param {string} source 卡片 source 自由文本
 * @returns {{ trajectory_ids: string[], tx_nos: string[], dates: string[] }} 三类引用（可为空数组）
 */
export function parseSourceRefs(source) {
  const s = String(source || '');
  const trajectoryIds = [...new Set((s.match(/\d{18,}/g) || []))];
  const txNos = [...new Set((s.match(/交易\s*#?(\d{3})/g) || []).map((m) => (m.match(/(\d{3})/) || [])[1]).filter(Boolean))];
  const dates = [...new Set((s.match(/\d{4}-\d{2}-\d{2}/g) || []))];
  return { trajectory_ids: trajectoryIds, tx_nos: txNos, dates };
}

const names = (await readdir(FLOWS_DIR)).filter((n) => n.endsWith('.json')).sort();
const report = [];
for (const name of names) {
  const path = join(FLOWS_DIR, name);
  const raw = await readFile(path, 'utf-8');
  let card;
  try { card = JSON.parse(raw); } catch { report.push({ name, status: 'unparseable' }); continue; }
  if (!card || typeof card !== 'object' || !card.flow || card.source_refs) {
    report.push({ name, status: card?.source_refs ? 'already-has-refs' : 'skipped' });
    continue;
  }
  const refs = parseSourceRefs(card.source);
  const empty = !refs.trajectory_ids.length && !refs.tx_nos.length && !refs.dates.length;
  report.push({ name, status: empty ? 'low-confidence' : 'parsed', refs });
  if (!empty && APPLY) {
    const next = { ...card, source_refs: refs };
    await writeFile(path, `${JSON.stringify(next, null, 2)}\n`, 'utf-8');
  }
}
console.log(JSON.stringify(report, null, 2));
console.log(APPLY ? '[applied] 已写盘' : '[dry-run] 未写盘（加 --apply 生效）');
```

- [ ] **Step 2: 语法/lint（migrations 为 eslint ignore 区，node --check 兜底）+ 干跑验证 + commit**

```bash
node --check migrations/backfill-kb-source-refs.mjs
node migrations/backfill-kb-source-refs.mjs   # dry-run 对真实 data/kb 只读，确认输出表合理（不写盘）
git status --short data/kb   # 必须为空（dry-run 零写入）
git add migrations/backfill-kb-source-refs.mjs
git commit -m "feat(kb-insights): A1 回填脚本 parseSourceRefs——默认 dry-run/--apply 写盘仅增 source_refs 键；执行后置（spec §2.2）"
```

- [ ] **Step 3: 特征化补 parseSourceRefs pin（追加到 characterize-kb-insights.mjs 并跑通）**

```js
// ── 段 7：source 解析器 ──
const { parseSourceRefs } = await import(join(ROOT, 'migrations/backfill-kb-source-refs.mjs'));
run('source 解析: 轨迹号/交易号/日期', () => {
  const r = parseSourceRefs('K1 2026-08-31 + 交易 203-206 + 轨迹 26081317115618826 与 26081400000000001');
  assert.deepEqual(r.trajectory_ids, ['26081317115618826', '26081400000000001']);
  assert.deepEqual(r.tx_nos, ['203', '206']);
  assert.deepEqual(r.dates, ['2026-08-31']);
});
run('source 解析: 无模式 → 全空数组（低置信跳过）', () => {
  const r = parseSourceRefs('K5 computer-use 调研 + A6 全链实证');
  assert.equal(r.trajectory_ids.length + r.tx_nos.length + r.dates.length, 0);
});
```

```bash
node scripts/characterization/characterize-kb-insights.mjs
git add scripts/characterization/characterize-kb-insights.mjs
git commit -m "test(kb-insights): parseSourceRefs 特征化 pin"
```

（注意：migrations 被 eslint ignore 但 import 进 mjs 特征化没有问题——node ESM 直接加载。）

---

### Task 9: 端到端冒烟 + verify-all 对照 + 收工

**Files:**
- 无新文件（验证任务）

**Interfaces:**
- Consumes: 全部前置任务。

- [ ] **Step 1: 起本地 server（若 4097 已有实例则复用；新起用独立任务）**

```bash
npm start &   # 或已有实例则跳过；等 ready 日志
sleep 8
```

- [ ] **Step 2: 四端点冒烟（连真实 DB 与真实 data/kb，只读）**

```bash
curl -s http://localhost:4097/api/v2/kb/cards | head -c 600
curl -s http://localhost:4097/api/v2/kb/stale-cards | head -c 600
curl -s "http://localhost:4097/api/v2/hierarchy/coverage" | head -c 600
curl -s "http://localhost:4097/api/v2/hierarchy/coverage?type=all&systemId=1" | head -c 600
curl -s http://localhost:4097/api/v2/system-mgmt/nodes/1/change-impact | head -c 600
```

Expected: 各端点 200 + envelope data；coverage 数字与 `GET /api/v2/trajectories/batch/:id` 既有报表抽样一致（挑一个批量 functionId 对照 batchTotal/batchSuccess）；stale-cards 的 unparsed/possibly-stale 分布人工抽查 3 张卡合理（spec 验收 §8.3）。

- [ ] **Step 3: /api/docs 同步核查**

打开 `http://localhost:4097/api/docs`，确认「KB 洞察」组与 hierarchy/coverage 条目可见。

- [ ] **Step 4: verify-all 基线对照**

```bash
bash scripts/refactor/verify-all.sh 2>&1 | grep -E "FAILED|verify-all:"
```

Expected: 唯一 FAILED = `characterize-kb-actions`（存量基线）；`characterize-kb-insights` 若已接线（接线前查 agent-log，verify-all.sh 冷区才加一行 `run "characterize-kb-insights" node scripts/characterization/characterize-kb-insights.mjs`）应 OK。

- [ ] **Step 5: 收工回报**

agent-log 顶部收工条目（回链开工声明）：完成明细 + commit hash 列表 + 验收证据（四端点输出摘要/verify-all 对照/特征化全绿）+ 遗留（A1 回填执行时机待 KB 线冷却；verify-all 接线若本次未做则注明）。

---

## Self-Review 记录

- **Spec coverage**：A1 schema（Task 8 解析器/回填）✓ 消费面（Task 7 cards 端点）✓；A2 API+参数（Task 5）+ 数据流四源（Task 4）✓；A3 双 API（Task 6/7）✓；错误处理（Task 5 VALIDATION/Task 7 只读降级——KB 目录缺失由 listFlowCards 返回 []，端点不 500）✓；测试（Task 1-8 特征化 + Task 9 冒烟/verify-all）✓；catalog 同步（Task 5/7）✓；验收标准 §8.1-8.5 全部映射到 Task 9 ✓。
- **Placeholder 扫描**：无 TBD/TODO；两处「以既有风格为准」的括号说明（knex 聚合写法、sum raw 表名前缀）均给了确定 fallback 且 pin 兼容两形态，非占位符。
- **类型一致性**：`resolveMenuPath` 返回键（matchStatus/matchedNodeId/missingSegment/resolvedPrefix/ambiguous）在 Task 4/6/7 消费处一致；`statsByFunctionIds` Map 值形状 `{trajCount,lastExecutedAt}` 在 Task 4 rollup 消费一致；`listFlowCards` 返回 snake 字段（menu_path/source_refs）在 Task 4/6/7/8 一致。
