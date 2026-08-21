# Batch Push V2.0 — Region Evidence + Phase Screenshot Metadata Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 批量推送 V2.0：每步附 `regionId`/`parentRegionId` 层级作证、完善整页大树 `assembleRegionTree`、阶段截图改为干净图 + 元数据（长宽 + 全部可见 L2 控件坐标 + region 树），供产品前端动态高亮。

**Architecture:** 纯加法式改造。新增 `src/services/region-tree.js`（推导 + 组树）；重写 CDP 阶段截图捕获（去掉 mark/unmark，逐片收集控件 rect 换算拼接图坐标）；`screenshot` 表加 `metadata_json` JSON 列（元数据与阶段树同存）；`transaction-export.js` 每步推导层级字段、每交易附 `phases[]`（截图引用 + 元数据）。旧数据不回填，envelope 旧字段拼写不动，`schemaVersion` 1→2。

**Tech Stack:** Node.js ESM（`"type": "module"`）、Knex + MySQL、Playwright 1.58（characterization 用 chromium headless）、pngjs。测试 = `scripts/characterization/*.mjs` 断言脚本 + `bash scripts/refactor/verify-all.sh` 回归门。

**Spec:** [2026-08-14-batch-push-v2-region-evidence-design.md](../specs/2026-08-14-batch-push-v2-region-evidence-design.md)

## Global Constraints

- ESM only；不用 TypeScript/JSX；characterization 是 Node 断言脚本，跑法是 `node scripts/characterization/<file>.mjs`。
- **CHANGELOG 义务**：改 `migrations/` / `src/routes/` / `src/services/` → 必须在本任务内追加 `CHANGELOG.md` `[Unreleased]` 条目（Keep a Changelog 分类 + 影响范围 + Python 同步提示）。仅改 `src/cdp/`、`executor/`、`scripts/`、`src/dao/`、`src/dashboard/` 可不写 CHANGELOG，但 `schemas/init.sql` 必须与迁移同步。
- **禁止手改** `scripts/controller/actions/js_snippets/_locator_helpers_js.py`（由 `node scripts/_gen_locator_helpers_py.mjs` 生成）。本计划不改 `page-locator-helpers.js` 内容，无需重生成。
- 迁移跑法：`npx knex migrate:latest --knexfile config/knexfile.js`（需本地 MySQL 在跑；无库时跳过执行、只做文件断言）。
- 每步先写失败断言再实现；每个任务末 `git commit`。提交风格：`feat:` / `docs:` / `chore:`。
- 旧行为不动：旧 `phase_highlight` 图保留原样不回填；envelope 旧字段（`transcation*`/`mothed`）拼写不改。
- 湿测（9242 对公客户修改/评级向导）依赖执行机在线，仅做最终人工验收，不阻塞任务完成。

---

### Task 1: 迁移 `screenshot.metadata_json` + init.sql + CHANGELOG

**Files:**
- Create: `migrations/20260815090000_screenshot_metadata_json.js`
- Modify: `schemas/init.sql:461-477`（screenshot 表）
- Modify: `CHANGELOG.md`（`[Unreleased]` 加迁移条目）
- Modify: `scripts/characterization/characterize-phase-highlight-screenshot.mjs:13-30`（加新列 cue 断言）

**Interfaces:**
- Produces: DB 列 `screenshot.metadata_json`（JSON NULL）；后续 Task 5 的 DAO 写它。

- [ ] **Step 1: 写迁移文件**

```js
/**
 * screenshot.metadata_json — 阶段长图元数据：
 * { imageWidth, imageHeight, contentWidth, contentHeight, truncated,
 *   elements: [{ index, kind, label, layers, regionId, parentRegionId, rect, outsideRoot }],
 *   regionTree: { pageLabel, roots } | null }
 */

export async function up(knex) {
  if (await knex.schema.hasTable('screenshot')) {
    if (!(await knex.schema.hasColumn('screenshot', 'metadata_json'))) {
      await knex.schema.alterTable('screenshot', (t) => {
        t.json('metadata_json').nullable()
          .comment('阶段长图元数据（长宽/元素坐标/region_tree）；kind=phase_highlight 时有效')
          .after('mime_type');
      });
    }
  }
}

export async function down(knex) {
  if (await knex.schema.hasTable('screenshot')) {
    if (await knex.schema.hasColumn('screenshot', 'metadata_json')) {
      await knex.schema.alterTable('screenshot', (t) => {
        t.dropColumn('metadata_json');
      });
    }
  }
}
```

- [ ] **Step 2: 同步 `schemas/init.sql`**

在 `screenshot` 表 `mime_type` 行后加：

```sql
  `metadata_json`       JSON DEFAULT NULL COMMENT '阶段长图元数据（长宽/元素坐标/region_tree）；kind=phase_highlight 时有效',
```

- [ ] **Step 3: 加 characterization 断言**

`characterize-phase-highlight-screenshot.mjs` 第一个块（migration cues）里加两行；第二个块（init.sql cues）里加一行：

```js
  assert.match(src, /metadata_json/);
```

（migration 块加在 `assert.match(src, /stitch_screenshot_id/);` 之后；init.sql 块加在 `assert.match(sql, /uk_ss_phase_kind/);` 之后。）

- [ ] **Step 4: CHANGELOG**

在 `CHANGELOG.md` `[Unreleased]` 的 `### Changed`（或 `### Added`，按文件既有分类）追加：

```markdown
- `migrations/20260815090000_screenshot_metadata_json`：`screenshot` 表新增 `metadata_json` JSON 列（阶段长图元数据：长宽/元素坐标/region_tree）。
  影响范围：screenshot schema、阶段截图捕获链路。
  Python 同步提示：无（截图捕获在 Node CDP 侧）；`schemas/init.sql` 已同步。
```

- [ ] **Step 5: 跑验证**

Run: `node scripts/characterization/characterize-phase-highlight-screenshot.mjs`
Expected: 输出 `ok: migration cues`、`ok: init.sql cues`，结尾 `characterize-phase-highlight-screenshot: ok`，exit 0。

（可选，本地有 MySQL：`npx knex migrate:latest --knexfile config/knexfile.js` 后 `SELECT` 确认列存在；然后 `npx knex migrate:down --knexfile config/knexfile.js` 再 `migrate:latest` 验证可逆。无库则跳过，不阻塞。）

- [ ] **Step 6: Commit**

```bash
git add migrations/20260815090000_screenshot_metadata_json.js schemas/init.sql CHANGELOG.md scripts/characterization/characterize-phase-highlight-screenshot.mjs
git commit -m "feat: screenshot.metadata_json column for phase screenshot metadata"
```

---

### Task 2: `src/services/region-tree.js` — deriveRegionRef + assembleRegionTree

**Files:**
- Create: `src/services/region-tree.js`
- Create: `scripts/characterization/characterize-region-tree.mjs`

**Interfaces:**
- Produces:
  - `deriveRegionRef(element) => { regionId: string, parentRegionId: string }`
  - `assembleRegionTree(items, { pageLabel = '' } = {}) => { pageLabel: string, roots: RegionNode[] }`
  - `RegionNode = { id: string, role: string, label: string, parentId: string|null, children: RegionNode[], controls: [{ elementIndex: number }] }`
  - items: `[{ layers?: [{ role, label }] }]`；`elementIndex` = items 数组下标。
- Consumed by Task 5（捕获元数据组树）、Task 6（导出推导）、Task 7（resolve 挂树）。

- [ ] **Step 1: 写失败测试**

创建 `scripts/characterization/characterize-region-tree.mjs`：

```js
/**
 * Region tree + step hierarchy evidence.
 *   node scripts/characterization/characterize-region-tree.mjs
 */
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
function ok(n) { console.log(`ok: ${n}`); }

{
  const { deriveRegionRef } = await import('../../src/services/region-tree.js');
  assert.deepEqual(deriveRegionRef({ layers: [
    { role: 'tab', label: '客户基本信息' },
    { role: 'section', label: '对公客户概况' },
    { role: 'titlebox', label: '基本信息' },
  ] }), { regionId: 'titlebox:基本信息', parentRegionId: 'section:对公客户概况' });
  assert.deepEqual(deriveRegionRef({ layers: [{ role: 'overlay', label: '提示' }] }),
    { regionId: 'overlay:提示', parentRegionId: '' });
  assert.deepEqual(deriveRegionRef({ region_id: 'tab:A|section:B' }),
    { regionId: 'section:B', parentRegionId: 'tab:A' });
  assert.deepEqual(deriveRegionRef({ region_id: 'table' }),
    { regionId: 'table', parentRegionId: '' });
  assert.deepEqual(deriveRegionRef({ display_group: '客户基本信息 / 对公客户概况' }),
    { regionId: '对公客户概况', parentRegionId: '客户基本信息' });
  assert.deepEqual(deriveRegionRef({ region_label: '只有一个区' }),
    { regionId: '只有一个区', parentRegionId: '' });
  assert.deepEqual(deriveRegionRef({}), { regionId: '', parentRegionId: '' });
  ok('deriveRegionRef fallback chain');
}

{
  const { assembleRegionTree } = await import('../../src/services/region-tree.js');
  const items = [
    { layers: [{ role: 'tab', label: '客户基本信息' }, { role: 'section', label: '对公客户概况' }, { role: 'titlebox', label: '基本信息' }] },
    { layers: [{ role: 'tab', label: '客户基本信息' }, { role: 'section', label: '对公客户概况' }] },
    { layers: [] },
  ];
  const tree = assembleRegionTree(items, { pageLabel: '' });
  assert.equal(tree.roots.length, 2);
  const tab = tree.roots.find((r) => r.id === 'tab:客户基本信息');
  assert.ok(tab);
  assert.equal(tab.parentId, null);
  assert.equal(tab.children.length, 1);
  const sec = tab.children[0];
  assert.equal(sec.id, 'section:对公客户概况');
  assert.equal(sec.parentId, 'tab:客户基本信息');
  assert.deepEqual(sec.controls, [{ elementIndex: 1 }]);
  assert.equal(sec.children.length, 1);
  assert.equal(sec.children[0].id, 'titlebox:基本信息');
  assert.equal(sec.children[0].parentId, 'section:对公客户概况');
  assert.deepEqual(sec.children[0].controls, [{ elementIndex: 0 }]);
  const other = tree.roots.find((r) => r.id === 'other');
  assert.ok(other);
  assert.equal(other.role, 'other');
  assert.deepEqual(other.controls, [{ elementIndex: 2 }]);
  ok('assembleRegionTree prefix merge + other bucket');
}

{
  const { assembleRegionTree } = await import('../../src/services/region-tree.js');
  const paged = assembleRegionTree([
    { layers: [{ role: 'page', label: '对公客户管理' }, { role: 'tab', label: 'T1' }] },
    { layers: [{ role: 'tab', label: 'T1' }, { role: 'page', label: '内层页' }, { role: 'section', label: 'S1' }] },
  ], { pageLabel: '对公客户管理' });
  const pageRoot = paged.roots.find((r) => r.role === 'page');
  assert.ok(pageRoot);
  assert.equal(pageRoot.id, 'page:对公客户管理');
  const t1 = pageRoot.children.find((c) => c.id === 'tab:T1');
  assert.ok(t1);
  assert.equal(t1.children[0].id, 'section:S1');
  const hasPageChild = (n) => n.children.some((c) => c.role === 'page');
  assert.equal(hasPageChild(pageRoot), false);
  assert.equal(hasPageChild(t1), false);
  ok('page only at root; inner page dropped');
}

{
  const { assembleRegionTree } = await import('../../src/services/region-tree.js');
  const twoPages = assembleRegionTree([
    { layers: [{ role: 'page', label: 'A' }, { role: 'tab', label: 'X' }] },
    { layers: [{ role: 'page', label: 'B' }, { role: 'tab', label: 'X' }] },
  ], { pageLabel: '' });
  assert.equal(twoPages.roots.length, 2);
  for (const r of twoPages.roots) {
    assert.equal(r.role, 'page');
    assert.equal(r.children[0].id, 'tab:X');
  }
  ok('different page labels are different roots');
}

console.log('characterize-region-tree: ok');
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node scripts/characterization/characterize-region-tree.mjs`
Expected: FAIL（`Cannot find module '../../src/services/region-tree.js'`）。

- [ ] **Step 3: 实现 `src/services/region-tree.js`**

```js
/**
 * 分区树（整页大树）+ 每步层级作证字段推导。
 * 节点 id = region_id 段（role:label）；parentId = 上一层段 id。
 * 遵守 PR-LAYER 锁定规则：page 只当根（内层 page 丢弃）；
 * 其余按 layers 前缀合并（同一父下同 id 同节点）。
 */

function layerIdOf(l) {
  const role = String(l?.role || '').replace(/\s+/g, ' ').trim();
  const label = String(l?.label || '').replace(/\s+/g, ' ').trim();
  return `${role}:${label}`;
}

/**
 * 从 element 推导最内层区域节点 id 与其父节点 id。
 * 回退链：layers → region_id 按 '|' 拆 → region_label/display_group 按 ' / ' 拆 → 空串。
 */
export function deriveRegionRef(element = {}) {
  const el = element && typeof element === 'object' ? element : {};
  const layers = Array.isArray(el.layers)
    ? el.layers.filter((l) => l && typeof l === 'object' && l.role && l.label != null)
    : [];
  if (layers.length) {
    const innermost = layers[layers.length - 1];
    const parent = layers.length > 1 ? layers[layers.length - 2] : null;
    return {
      regionId: layerIdOf(innermost),
      parentRegionId: parent ? layerIdOf(parent) : '',
    };
  }
  const rid = String(el.region_id || '').trim();
  if (rid) {
    const segs = rid.split('|').map((s) => s.trim()).filter(Boolean);
    if (segs.length) {
      return {
        regionId: segs[segs.length - 1],
        parentRegionId: segs.length > 1 ? segs[segs.length - 2] : '',
      };
    }
  }
  const path = String(el.region_label || el.display_group || '').trim();
  if (path) {
    const segs = path.split(/\s*\/\s*/).map((s) => s.trim()).filter(Boolean);
    if (segs.length) {
      return {
        regionId: segs[segs.length - 1],
        parentRegionId: segs.length > 1 ? segs[segs.length - 2] : '',
      };
    }
  }
  return { regionId: '', parentRegionId: '' };
}

function ensureChild(parent, id, role, label) {
  const siblings = parent ? parent.children : null;
  if (parent) {
    let n = parent.children.find((c) => c.id === id && c.role === role);
    if (n) return n;
    n = { id, role, label, parentId: parent.id, children: [], controls: [] };
    parent.children.push(n);
    return n;
  }
  return null;
}

/**
 * items: [{ layers?: [{ role, label }] }]；controls 引用 elementIndex = 数组下标。
 * 无 layers 的控件进 { id:'other', role:'other', label:'其他' }。
 */
export function assembleRegionTree(items = [], { pageLabel = '' } = {}) {
  const rootPageLabel = String(pageLabel || '').trim();
  const roots = [];

  function ensureRoot(id, role, label) {
    let n = roots.find((r) => r.id === id && r.role === role);
    if (n) return n;
    n = { id, role, label, parentId: null, children: [], controls: [] };
    roots.push(n);
    return n;
  }

  const rootPage = rootPageLabel ? ensureRoot(`page:${rootPageLabel}`, 'page', rootPageLabel) : null;

  (items || []).forEach((item, elementIndex) => {
    const raw = Array.isArray(item?.layers) ? item.layers : [];
    let chain = raw.filter((l) => l && typeof l === 'object' && l.role && l.label != null);

    let parent = null;
    if (chain.length && String(chain[0].role) === 'page') {
      parent = ensureRoot(layerIdOf(chain[0]), 'page', String(chain[0].label));
      chain = chain.slice(1);
    } else if (rootPage) {
      parent = rootPage;
    }

    if (!chain.length) {
      const other = parent
        ? ensureChild(parent, `${parent.id}|other`, 'other', '其他')
        : ensureRoot('other', 'other', '其他');
      other.controls.push({ elementIndex });
      return;
    }

    for (const l of chain) {
      const node = parent
        ? ensureChild(parent, layerIdOf(l), String(l.role), String(l.label))
        : ensureRoot(layerIdOf(l), String(l.role), String(l.label));
      parent = node;
    }
    parent.controls.push({ elementIndex });
  });

  return { pageLabel: rootPageLabel, roots };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node scripts/characterization/characterize-region-tree.mjs`
Expected: 全 `ok:` 输出，exit 0。

- [ ] **Step 5: Commit**

```bash
git add src/services/region-tree.js scripts/characterization/characterize-region-tree.mjs
git commit -m "feat: region-tree service (deriveRegionRef + assembleRegionTree)"
```

---

### Task 3: 干净阶段截图捕获 — phase-screenshot-page.js + phase-screenshot-capture.js

> **几何修正记录（2026-08-15 final review I1/I2，已落地 commit 73c3a01）：** 本节 brief 中的公式 `step = clientHeight - OVERLAP`、`y = sliceOffset + rect.top`（sliceOffset = i\*step）已被最终审查发现的两处缺陷推翻——末片 clamp 产生底部重复条带与坐标偏移；滚动根小于视口时每片丢内容带。最终实现：capture 用 `clip` 到滚动根 box（片高==容器高）、每片按**实际 scrollTop** 放置（`stitchPngSlices` 接受 `overlaps` 数组）、坐标 `x = rect.left - box.x`、`y = top_i + rect.top - box.y`（恒为内容坐标）、`contentHeight = top_last + clientHeight`。执行本任务时以最终实现为准，勿再写旧公式。

**Files:**
- Create: `src/cdp/phase-screenshot-page.js`
- Create: `src/cdp/phase-screenshot-capture.js`
- Modify: `scripts/characterization/characterize-phase-highlight-screenshot.mjs`（替换 mark/unmark 测试块 66-94 行与 capture 测试块 130-157 行、capture source cues 块 119-128 行）

**Interfaces:**
- Consumes: `PAGE_LOCATOR_HELPERS`（`src/cdp/locator-candidates.js`，内含 `collectL2Hosts` / `assignRegion` / `buildRegionLayers`）
- Produces:
  - `buildPhaseScreenshotScrollExpression({ top }) => string`
  - `buildPhaseScreenshotCollectExpression() => string` — evaluate 返回 `[{ kind, text, rect:{left,top,right,bottom}, layers, region_id, region_label, outsideRoot }]`
  - `buildPhaseScreenshotCleanExpression() => string`
  - `runPhaseScreenshotCapture(client) => Promise<{ buffer: Buffer, meta: { contentWidth, contentHeight, truncated, elements } }>`
- Consumed by Task 4（executor 桥）、Task 5（orchestrator）。

- [ ] **Step 1: 写失败测试（改 characterization）**

替换 `characterize-phase-highlight-screenshot.mjs` 的「page mark/unmark」块为 collect 表达式测试：

```js
{
  const { chromium } = await import('playwright');
  const { buildPhaseScreenshotCollectExpression, buildPhaseScreenshotCleanExpression } =
    await import('../../src/cdp/phase-screenshot-page.js');
  const html = `<!DOCTYPE html><html><body>
  <div class="el-main" style="height:200px;overflow:auto">
    <div class="el-form-item"><label>客户编号</label><input id="no"></div>
    <div style="height:400px"></div>
    <button id="save">保存</button>
  </div>
  </body></html>`;
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setContent(html);
  const first = await page.evaluate(buildPhaseScreenshotCollectExpression());
  assert.ok(Array.isArray(first));
  const inputHit = first.find((e) => e.kind === 'form_input');
  assert.ok(inputHit, 'form input collected');
  assert.equal(typeof inputHit.rect.left, 'number');
  assert.equal(typeof inputHit.rect.top, 'number');
  assert.ok(inputHit.rect.right > inputHit.rect.left);
  assert.ok(Array.isArray(inputHit.layers));
  assert.equal(await page.locator('[data-jsgen-rect]').count(), first.length);
  const second = await page.evaluate(buildPhaseScreenshotCollectExpression());
  assert.equal(second.length, 0, 'marker dedupes across slices');
  await page.evaluate(buildPhaseScreenshotCleanExpression());
  assert.equal(await page.locator('[data-jsgen-rect]').count(), 0);
  await browser.close();
  ok('rect collect expression + dedupe + clean');
}
```

替换「capture module source cues」块为：

```js
{
  const capPath = join(root, 'src/cdp/phase-screenshot-capture.js');
  assert.equal(existsSync(capPath), true, 'phase-screenshot-capture.js must exist');
  const capSrc = readFileSync(capPath, 'utf8');
  assert.match(capSrc, /Page\.captureScreenshot/);
  assert.match(capSrc, /buildPhaseScreenshotCollectExpression/);
  assert.match(capSrc, /stitchPngSlices/);
  assert.match(capSrc, /finally/);
  assert.match(capSrc, /contentHeight/);
  ok('capture module source cues');
}
```

替换「runPhaseHighlightCapture」块为：

```js
{
  const { chromium } = await import('playwright');
  const { runPhaseScreenshotCapture } = await import('../../src/cdp/phase-screenshot-capture.js');
  const html = `<!DOCTYPE html><html><body>
  <div class="el-main" style="height:200px;overflow:auto">
    <div class="el-form-item"><label>客户编号</label><input id="no"></div>
    <div style="height:400px"></div>
    <button id="save">保存</button>
  </div>
  </body></html>`;
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setContent(html);
  const client = await page.context().newCDPSession(page);
  await client.send('Page.enable');
  await client.send('Runtime.enable');
  const result = await runPhaseScreenshotCapture(client);
  assert.ok(Buffer.isBuffer(result.buffer));
  assert.equal(result.buffer[0], 0x89);
  assert.equal(result.buffer[1], 0x50);
  assert.equal(result.buffer[2], 0x4e);
  assert.equal(result.buffer[3], 0x47);
  assert.ok(Array.isArray(result.meta?.elements));
  assert.ok(result.meta.elements.some((e) => e.kind === 'form_input'));
  assert.ok(result.meta.elements.some((e) => e.kind === 'button'));
  assert.ok(result.meta.contentHeight > 200, 'long page content height');
  assert.equal(await page.locator('[data-jsgen-rect]').count(), 0, 'markers cleaned');
  const { PNG } = await import('pngjs');
  const dims = PNG.sync.read(result.buffer);
  assert.equal(dims.width, result.meta.contentWidth);
  ok('runPhaseScreenshotCapture PNG + elements meta + clean');
}
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node scripts/characterization/characterize-phase-highlight-screenshot.mjs`
Expected: FAIL（import 找不到 `phase-screenshot-page.js`）。

- [ ] **Step 3: 写 `src/cdp/phase-screenshot-page.js`**

```js
import { PAGE_LOCATOR_HELPERS } from './locator-candidates.js';

export function buildPhaseScreenshotScrollExpression({ top }) {
  const y = Number(top) || 0;
  return `(() => {
    const cands = document.querySelectorAll('.el-main, .app-main');
    let root = document.scrollingElement || document.documentElement;
    for (let k = 0; k < cands.length; k++) {
      const el = cands[k];
      const s = getComputedStyle(el);
      const oy = s.overflowY || s.overflow;
      if ((oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight + 8) { root = el; break; }
    }
    root.scrollTop = ${y};
    return { top: root.scrollTop, clientHeight: root.clientHeight, scrollHeight: root.scrollHeight };
  })()`;
}

export function buildPhaseScreenshotCollectExpression() {
  return `(() => {
    ${PAGE_LOCATOR_HELPERS}
    function pickScrollRoot() {
      const cands = document.querySelectorAll('.el-main, .app-main');
      for (let k = 0; k < cands.length; k++) {
        const el = cands[k];
        const s = getComputedStyle(el);
        const oy = s.overflowY || s.overflow;
        if ((oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight + 8) return el;
      }
      return document.scrollingElement || document.documentElement;
    }
    const root = pickScrollRoot();
    const hosts = collectL2Hosts();
    const out = [];
    for (let i = 0; i < hosts.length; i++) {
      const host = hosts[i].el;
      if (!host || !host.getBoundingClientRect) continue;
      if (host.hasAttribute('data-jsgen-rect')) continue;
      const rect = host.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) continue;
      const region = assignRegion(host);
      host.setAttribute('data-jsgen-rect', '1');
      out.push({
        kind: hosts[i].kind || '',
        text: hosts[i].text || '',
        rect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom },
        layers: Array.isArray(region.layers) ? region.layers : [],
        region_id: region.region_id || '',
        region_label: region.region_label || '',
        outsideRoot: !root.contains(host),
      });
    }
    return out;
  })()`;
}

export function buildPhaseScreenshotCleanExpression() {
  return `(() => {
    const els = document.querySelectorAll('[data-jsgen-rect]');
    for (let i = 0; i < els.length; i++) els[i].removeAttribute('data-jsgen-rect');
    return { removed: els.length };
  })()`;
}
```

- [ ] **Step 4: 写 `src/cdp/phase-screenshot-capture.js`**

```js
import { PNG } from 'pngjs';
import {
  buildPhaseScreenshotCollectExpression,
  buildPhaseScreenshotCleanExpression,
  buildPhaseScreenshotScrollExpression,
} from './phase-screenshot-page.js';
import { stitchPngSlices } from './png-stitch.js';

const OVERLAP = 48;
const MAX_SLICES = 30;

async function cdpEval(client, expression) {
  const result = await client.send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: false,
  });
  if (result?.exceptionDetails) {
    throw new Error(result.exceptionDetails.text || 'evaluate failed');
  }
  return result?.result?.value;
}

async function cdpPng(client) {
  const shot = await client.send('Page.captureScreenshot', {
    format: 'png',
    fromSurface: true,
    captureBeyondViewport: false,
  });
  return Buffer.from(shot.data, 'base64');
}

/**
 * 干净阶段长图：无 mark/unmark；同一遍滚动里逐片收集可见 L2 控件 rect。
 * 坐标 = 内容坐标：x = rect.left；y = sliceOffset + rect.top（sliceOffset = i * step）。
 */
export async function runPhaseScreenshotCapture(client) {
  let scroll = { top: 0, clientHeight: 0, scrollHeight: 0 };
  let started = false;
  let origTop = 0;
  const elements = [];
  try {
    const first = await cdpEval(client, buildPhaseScreenshotScrollExpression({ top: 0 }));
    if (first && typeof first === 'object') scroll = first;
    started = true;
    origTop = Number(scroll.top) || 0;
    const clientHeight = Number(scroll.clientHeight) || 0;
    const scrollHeight = Number(scroll.scrollHeight) || 0;
    const step = Math.max(1, clientHeight - OVERLAP);
    const slices = [];
    let truncated = false;
    let top = 0;
    for (let i = 0; i < MAX_SLICES; i++) {
      await cdpEval(client, buildPhaseScreenshotScrollExpression({ top }));
      const collected = await cdpEval(client, buildPhaseScreenshotCollectExpression());
      const sliceOffset = i * step;
      for (const el of Array.isArray(collected) ? collected : []) {
        if (!el || !el.rect) continue;
        elements.push({
          kind: el.kind || '',
          text: el.text || '',
          rect: {
            left: Number(el.rect.left) || 0,
            top: (Number(el.rect.top) || 0) + sliceOffset,
            right: Number(el.rect.right) || 0,
            bottom: (Number(el.rect.bottom) || 0) + sliceOffset,
          },
          layers: Array.isArray(el.layers) ? el.layers : [],
          region_id: el.region_id || '',
          region_label: el.region_label || '',
          outsideRoot: !!el.outsideRoot,
        });
      }
      slices.push(await cdpPng(client));
      if (clientHeight <= 0 || top + clientHeight >= scrollHeight - 1) break;
      if (i === MAX_SLICES - 1) { truncated = true; break; }
      top += step;
      if (top > scrollHeight - clientHeight) top = Math.max(0, scrollHeight - clientHeight);
    }
    const buffer = stitchPngSlices(slices, { overlap: OVERLAP });
    const dims = PNG.sync.read(buffer);
    const contentHeight = clientHeight + Math.max(0, slices.length - 1) * step;
    return {
      buffer,
      meta: {
        contentWidth: dims.width,
        contentHeight,
        truncated,
        elements,
      },
    };
  } finally {
    if (started) {
      try {
        await cdpEval(client, buildPhaseScreenshotScrollExpression({ top: origTop }));
      } catch {
        /* restore must not hide capture errors */
      }
    }
    try {
      await cdpEval(client, buildPhaseScreenshotCleanExpression());
    } catch {
      /* clean must not hide capture errors */
    }
  }
}
```

- [ ] **Step 5: 跑测试确认通过**

Run: `node scripts/characterization/characterize-phase-highlight-screenshot.mjs`
Expected: 新三个块全 `ok`，结尾 `characterize-phase-highlight-screenshot: ok`，exit 0。
注意：该脚本 159-200 行仍引用旧名 `capturePhaseHighlightScreenshot` / `collectHighlightTargets` / `runPhaseHighlightCapture` 的 cue——**Task 5 会改**，本任务先只改上述三块；若旧 cue 块因此报错（不会，它们只断言旧文件文本），保持通过即可。旧文件 `phase-highlight-page.js` / `phase-highlight-capture.js` 暂不删除（Task 4 executor 切换后再删）。

- [ ] **Step 6: Commit**

```bash
git add src/cdp/phase-screenshot-page.js src/cdp/phase-screenshot-capture.js scripts/characterization/characterize-phase-highlight-screenshot.mjs
git commit -m "feat: clean phase screenshot capture with per-slice element rects"
```

---

### Task 4: Executor 桥接切换 + 删除旧捕获模块

**Files:**
- Modify: `executor/bib-bridge.js:497-502`（`capturePhaseHighlight` 改用新捕获，返回 `meta`）
- Modify: `executor/session-manager.js:431-460`（`hitCount` → `meta`）
- Modify: `executor/agent.mjs:150-157`（relay `meta`）
- Delete: `src/cdp/phase-highlight-capture.js`、`src/cdp/phase-highlight-page.js`
- Modify: `scripts/characterization/characterize-phase-highlight-screenshot.mjs:159-182`（service cue 块改指向新模块与 executor meta 字段）

**Interfaces:**
- Consumes: `runPhaseScreenshotCapture(client)`（Task 3）
- Produces: WS 消息 `session.bib_phase_highlight_capture`（消息名不变）→ `session.bib_phase_highlight_capture_result` payload `{ sessionId, requestId, pngBase64, meta, error }`（`hitCount` 字段删除）。

- [ ] **Step 1: 改 `executor/bib-bridge.js`**

```js
  async capturePhaseHighlight() {
    const { runPhaseScreenshotCapture } = await import('../src/cdp/phase-screenshot-capture.js');
    if (!this.client) throw new Error('BiB not attached');
    const { buffer, meta } = await runPhaseScreenshotCapture(this.client);
    return { pngBase64: buffer.toString('base64'), meta };
  }
```

- [ ] **Step 2: 改 `executor/session-manager.js` 的 `bibPhaseHighlightCapture`**

返回对象中把 `hitCount: 0` → `meta: null`、`hitCount: captured.hitCount` → `meta: captured.meta || null`（三处返回路径：无 BiB / 成功 / catch）。

- [ ] **Step 3: 改 `executor/agent.mjs` relay**

```js
      } else if (msg.type === 'session.bib_phase_highlight_capture' && result) {
        client.send('session.bib_phase_highlight_capture_result', {
          sessionId: msg.payload?.sessionId,
          requestId: result.requestId || msg.payload?.requestId,
          pngBase64: result.pngBase64 || null,
          meta: result.meta || null,
          error: result.error || null,
        });
      }
```

- [ ] **Step 4: 删除旧捕获模块 + 更新 cue**

删除 `src/cdp/phase-highlight-capture.js`、`src/cdp/phase-highlight-page.js`。

`characterize-phase-highlight-screenshot.mjs` 的「orchestrator fail-soft cues」块（约 159-167 行）暂时保留（Task 5 重写）；「runner + executor wire cues」块（176-181 行）改为：

```js
{
  const handler = readFileSync(join(root, 'executor/session-handler.js'), 'utf8');
  assert.match(handler, /bib_phase_highlight_capture/);
  const manager = readFileSync(join(root, 'executor/session-manager.js'), 'utf8');
  assert.match(manager, /meta: captured\.meta/);
  const agent = readFileSync(join(root, 'executor/agent.mjs'), 'utf8');
  assert.match(agent, /meta: result\.meta/);
  const bib = readFileSync(join(root, 'executor/bib-bridge.js'), 'utf8');
  assert.match(bib, /runPhaseScreenshotCapture/);
  ok('executor wire meta cues');
}
```

- [ ] **Step 5: 跑验证**

Run: `node scripts/characterization/characterize-phase-highlight-screenshot.mjs`
Expected: exit 0（本任务改动后的所有块通过）。

- [ ] **Step 6: Commit**

```bash
git add executor/bib-bridge.js executor/session-manager.js executor/agent.mjs scripts/characterization/characterize-phase-highlight-screenshot.mjs
git rm src/cdp/phase-highlight-capture.js src/cdp/phase-highlight-page.js
git commit -m "feat: executor bib phase screenshot capture returns meta (no highlight)"
```

---

### Task 5: 截图服务 V2 — DAO 元数据写入 + orchestrator 重写

**Files:**
- Modify: `src/dao/screenshot-dao.js`（META_COLS 加 `metadata_json`；`replaceForPhase` 写元数据；新增 `listPhaseHighlightsByTrajectory`）
- Modify: `src/services/screenshot-service.js:29-45`（透传 `metadataJson`）
- Rewrite: `src/services/trajectory/phase-highlight-screenshot.js`（`capturePhaseScreenshot` + `buildMetadata`）
- Modify: `src/services/trajectory/trajectory-recording-runner.js:437-447`（调用新函数名）
- Delete: `src/models/phase-highlight-targets.js`（唯一消费者已被移除）
- Modify: `scripts/characterization/characterize-phase-highlight-screenshot.mjs`（orchestrator cue 块 159-167、dao cue 块 32-40、runner cue 块 176-181 重写；`collectHighlightTargets` 块 42-64 删除）
- Modify: `CHANGELOG.md`（services 语义变更条目）

**Interfaces:**
- Consumes: `runPhaseScreenshotCapture`（Task 3）、`deriveRegionRef` / `assembleRegionTree`（Task 2）
- Produces:
  - `capturePhaseScreenshot({ trajectoryId, phaseId, cdpClient, sessionId, executorNodeUuid }) => Promise<{ ok: true, screenshotId, elementCount } | { ok: false, skipped: string }>`（保持 fail-soft）
  - `wrapCaptureError(err)` 不变
  - `screenshotDao.replaceForPhase({ ..., metadataJson })`；`screenshotDao.listPhaseHighlightsByTrajectory(trajectoryId) => [{ id, trajectoryPhaseId, metadataJson }]`
- Consumed by Task 6（导出 phases 装载）。

- [ ] **Step 1: 改 `src/dao/screenshot-dao.js`**

META_COLS 数组加 `'screenshot.metadata_json'`。

`replaceForPhase` 改为：

```js
export async function replaceForPhase(screenshot) {
  const phaseId = screenshot.trajectoryPhaseId != null ? Number(screenshot.trajectoryPhaseId) : null;
  const kind = 'phase_highlight';
  if (!Number.isFinite(phaseId) || phaseId <= 0) {
    throw new Error('trajectoryPhaseId required for replaceForPhase');
  }
  const imageData = screenshot.imageData;
  const fileSize = screenshot.fileSize || (imageData ? imageData.length : 0);
  const mimeType = screenshot.mimeType || 'image/png';
  const trajectoryId = screenshot.trajectoryId != null ? Number(screenshot.trajectoryId) : null;
  const metadataJson = screenshot.metadataJson ?? null;

  const db = getDB();
  const phaseExists = await db('trajectory_phase').where({ id: phaseId }).first('id');
  if (!phaseExists) {
    const err = new Error(`trajectory_phase ${phaseId} not found`);
    err.code = 'ER_NO_REFERENCED_ROW_2';
    throw err;
  }

  await db.raw(
    `INSERT INTO \`${TABLE}\`
      (image_data, file_size, mime_type, trajectory_id, trajectory_step_id, trajectory_phase_id, kind, metadata_json)
     VALUES (?, ?, ?, ?, NULL, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
      image_data = VALUES(image_data),
      file_size = VALUES(file_size),
      mime_type = VALUES(mime_type),
      trajectory_id = VALUES(trajectory_id),
      metadata_json = VALUES(metadata_json)`,
    [imageData, fileSize, mimeType, trajectoryId, phaseId, kind, metadataJson],
  );

  const row = await db(TABLE)
    .select('id')
    .where({ trajectory_phase_id: phaseId, kind })
    .first();
  return row?.id != null ? Number(row.id) : null;
}

export async function listPhaseHighlightsByTrajectory(trajectoryId) {
  const rows = await getDB()(TABLE)
    .select('id', 'trajectory_phase_id', 'metadata_json')
    .where({ trajectory_id: trajectoryId, kind: 'phase_highlight' });
  return fromDbRows(rows).map((r) => {
    let metadataJson = null;
    if (r.metadataJson != null && typeof r.metadataJson === 'string') {
      try { metadataJson = JSON.parse(r.metadataJson); } catch { metadataJson = null; }
    } else if (r.metadataJson != null) {
      metadataJson = r.metadataJson;
    }
    return { id: r.id, trajectoryPhaseId: r.trajectoryPhaseId, metadataJson };
  });
}
```

- [ ] **Step 2: 改 `src/services/screenshot-service.js`**

`replacePhaseHighlightScreenshot` 签名加 `metadataJson = null`，透传给 DAO：

```js
export async function replacePhaseHighlightScreenshot(trajectoryPhaseId, {
  trajectoryId = null,
  buffer,
  mimeType = 'image/png',
  metadataJson = null,
} = {}) {
  // ...原有校验不变...
  return screenshotDao.replaceForPhase({
    trajectoryPhaseId: phaseId,
    trajectoryId: trajectoryId != null ? Number(trajectoryId) : null,
    imageData: buf,
    fileSize: buf.length,
    mimeType,
    metadataJson,
  });
}
```

- [ ] **Step 3: 重写 orchestrator `phase-highlight-screenshot.js`**

```js
import { randomUUID } from 'node:crypto';
import { PNG } from 'pngjs';
import * as trajectoryPhaseDao from '../../dao/trajectory-phase-dao.js';
import { runPhaseScreenshotCapture } from '../../cdp/phase-screenshot-capture.js';
import { deriveRegionRef, assembleRegionTree } from '../region-tree.js';
import { replacePhaseHighlightScreenshot } from '../screenshot-service.js';
import { USE_EXECUTOR } from '../../../config/config.js';
import * as execSession from '../../executor-session-client.js';
import { getAttachedCdpClient } from '../../cdp/remote-bridge.js';

export function wrapCaptureError(err) {
  console.warn('[record] phase screenshot skipped:', err?.message || err);
  return { ok: false, skipped: String(err?.message || err || 'error') };
}

function buildMetadata(buffer, meta) {
  const dims = PNG.sync.read(buffer);
  const elements = (Array.isArray(meta?.elements) ? meta.elements : []).map((el, index) => {
    const { regionId, parentRegionId } = deriveRegionRef({
      layers: el.layers,
      region_id: el.region_id,
      region_label: el.region_label,
    });
    return {
      index,
      kind: String(el.kind || ''),
      label: String(el.text || ''),
      layers: Array.isArray(el.layers) ? el.layers : [],
      regionId,
      parentRegionId,
      rect: el.rect
        ? { x1: el.rect.left, y1: el.rect.top, x2: el.rect.right, y2: el.rect.bottom }
        : null,
      outsideRoot: !!el.outsideRoot,
    };
  });
  const regionTree = assembleRegionTree(
    elements.map((e) => ({ layers: e.layers })),
    { pageLabel: '' },
  );
  return {
    imageWidth: dims.width,
    imageHeight: dims.height,
    contentWidth: Number(meta?.contentWidth) || dims.width,
    contentHeight: Number(meta?.contentHeight) || dims.height,
    truncated: !!meta?.truncated,
    elements,
    regionTree,
  };
}

export async function capturePhaseScreenshot({
  trajectoryId,
  phaseId,
  cdpClient,
  sessionId,
  executorNodeUuid,
} = {}) {
  try {
    let buffer;
    let meta = null;

    if (cdpClient) {
      const captured = await runPhaseScreenshotCapture(cdpClient);
      buffer = captured.buffer;
      meta = captured.meta;
    } else if (USE_EXECUTOR && executorNodeUuid && sessionId) {
      const requestId = randomUUID();
      const resultP = execSession.waitForSessionEvent(
        sessionId,
        'session.bib_phase_highlight_capture_result',
        60000,
      );
      execSession.sendToExecutor(executorNodeUuid, 'session.bib_phase_highlight_capture', {
        sessionId,
        requestId,
      });
      const payload = await resultP;
      if (payload?.error) return { ok: false, skipped: String(payload.error) };
      if (!payload?.pngBase64) return { ok: false, skipped: 'no_png' };
      buffer = Buffer.from(payload.pngBase64, 'base64');
      meta = payload?.meta || null;
    } else {
      const local = getAttachedCdpClient();
      if (!local) return { ok: false, skipped: 'no_cdp' };
      const captured = await runPhaseScreenshotCapture(local);
      buffer = captured.buffer;
      meta = captured.meta;
    }

    const metadata = buildMetadata(buffer, meta);
    const screenshotId = await replacePhaseHighlightScreenshot(phaseId, {
      trajectoryId,
      buffer,
      mimeType: 'image/png',
      metadataJson: JSON.stringify(metadata),
    });
    if (screenshotId) {
      await trajectoryPhaseDao.update(phaseId, { stitchScreenshotId: screenshotId });
    }
    return { ok: true, screenshotId, elementCount: metadata.elements.length };
  } catch (err) {
    return wrapCaptureError(err);
  }
}
```

- [ ] **Step 4: 改 runner 调用点 `trajectory-recording-runner.js:437-447`**

```js
      try {
        const { capturePhaseScreenshot } = await import('./phase-highlight-screenshot.js');
        await capturePhaseScreenshot({
          trajectoryId: tid,
          phaseId: phase.id,
          sessionId: runtime.sessionId,
          executorNodeUuid: runtime.executorNodeUuid,
        });
      } catch (err) {
        console.warn('[record] phase screenshot skipped:', err?.message || err);
      }
```

- [ ] **Step 5: 删 `src/models/phase-highlight-targets.js`**（不再有引用）。

- [ ] **Step 6: 更新 characterization**

- dao cue 块（32-40 行）追加：`assert.match(dao, /metadata_json/);` 和 `assert.match(dao, /listPhaseHighlightsByTrajectory/);`；service 块追加 `assert.match(svc, /metadataJson/);`
- 删除 `collectHighlightTargets` 块（42-64 行）
- orchestrator cue 块（159-167 行）改为：

```js
{
  const src = readFileSync(join(root, 'src/services/trajectory/phase-highlight-screenshot.js'), 'utf8');
  assert.match(src, /export async function capturePhaseScreenshot/);
  assert.match(src, /runPhaseScreenshotCapture/);
  assert.match(src, /deriveRegionRef/);
  assert.match(src, /assembleRegionTree/);
  assert.match(src, /metadataJson: JSON\.stringify\(metadata\)/);
  assert.match(src, /stitchScreenshotId/);
  assert.match(src, /console\.warn/);
  ok('orchestrator fail-soft cues');
}
```

- runner cue 块（176-181 行）中 `capturePhaseHighlightScreenshot` 改为 `capturePhaseScreenshot`。

- [ ] **Step 7: CHANGELOG**

`[Unreleased]` 追加：

```markdown
- 阶段截图 V2：phase_done 长图不再烘焙元素高亮；`screenshot.metadata_json` 记录截图长宽 + 全部可见 L2 控件坐标（拼接图内容坐标）+ region_tree；录制链路 `capturePhaseHighlightScreenshot` → `capturePhaseScreenshot`。
  影响范围：src/services/trajectory 录制链路、executor `session.bib_phase_highlight_capture`（消息名不变，payload `hitCount` → `meta`）。
  Python 同步提示：executor 桥接为 JS-gen executor 内部实现，Python 控制面无需改动；前端契约见 /api/v2/export/transaction/schema（Task 6）。
```

- [ ] **Step 8: 跑验证**

Run: `node scripts/characterization/characterize-phase-highlight-screenshot.mjs`
Expected: exit 0，全 `ok`。

- [ ] **Step 9: Commit**

```bash
git add src/dao/screenshot-dao.js src/services/screenshot-service.js src/services/trajectory/phase-highlight-screenshot.js src/services/trajectory/trajectory-recording-runner.js scripts/characterization/characterize-phase-highlight-screenshot.mjs CHANGELOG.md
git rm src/models/phase-highlight-targets.js
git commit -m "feat: phase screenshot metadata write + capturePhaseScreenshot orchestrator"
```

---

### Task 6: resolve-by-label 列表挂 `regionTree`

**Files:**
- Modify: `src/cdp/resolve-by-label.js`（`enrichOne` 之后 / 返回处挂 `regionTree`）
- Modify: `scripts/characterization/characterize-region-tree.mjs`（加 source cue 块）

**Interfaces:**
- Consumes: `assembleRegionTree`（Task 2）
- Produces: resolve 响应（ambiguous 分支，含 inventory forceAmbiguous）多一个 `regionTree: { pageLabel, roots }`；单命中响应不挂。

- [ ] **Step 1: 加失败 cue（characterize-region-tree.mjs 尾部追加）**

```js
{
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(join(root, 'src/cdp/resolve-by-label.js'), 'utf8');
  assert.match(src, /assembleRegionTree/);
  assert.match(src, /regionTree/);
  ok('resolve-by-label mounts regionTree');
}
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node scripts/characterization/characterize-region-tree.mjs`
Expected: FAIL（resolve-by-label.js 无 regionTree 引用）。

- [ ] **Step 3: 实现**

`src/cdp/resolve-by-label.js` 顶部 import 加：

```js
import { assembleRegionTree } from '../services/region-tree.js';
```

`resolve-by-label.js` 中 `const matches = uniquifyDisplayGroups(list.map(enrichOne));` 之后加：

```js
  const regionTree = assembleRegionTree(
    matches.map((m) => ({ layers: (m && m.element && Array.isArray(m.element.layers)) ? m.element.layers : [] })),
    { pageLabel: pageLabel || '' },
  );
```

两个返回 ambiguous 的分支（`forceAmbiguous` 与末尾 `matches.length !== 1`）都加 `regionTree,`（放在 `ambiguous: true,` 之后）。

- [ ] **Step 4: 跑测试确认通过**

Run: `node scripts/characterization/characterize-region-tree.mjs`
Expected: exit 0。

- [ ] **Step 5: Commit**

```bash
git add src/cdp/resolve-by-label.js scripts/characterization/characterize-region-tree.mjs
git commit -m "feat: resolve-by-label ambiguous lists mount regionTree"
```

---

### Task 7: 导出每步 `regionId` / `parentRegionId`（无状态推导）

**Files:**
- Modify: `src/services/transaction-export.js`（`mapStepToTransactionEvent` 加两字段；`TRANSACTION_ENVELOPE_FIELDS` 补两项；新增 `TRANSACTION_SCHEMA_VERSION = 2`）
- Create: `scripts/characterization/characterize-transaction-export-region.mjs`

**Interfaces:**
- Consumes: `deriveRegionRef`（Task 2）
- Produces: 每个 `transcationProperties[]` 项新增 `regionId`、`parentRegionId`（空串兜底）；`TRANSACTION_SCHEMA_VERSION` 供 Task 8 路由使用。

- [ ] **Step 1: 写失败测试**

创建 `scripts/characterization/characterize-transaction-export-region.mjs`：

```js
/**
 * Transaction export per-step region evidence.
 *   node scripts/characterization/characterize-transaction-export-region.mjs
 */
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
function ok(n) { console.log(`ok: ${n}`); }

{
  const { mapStepToTransactionEvent, TRANSACTION_SCHEMA_VERSION } =
    await import('../../src/services/transaction-export.js');
  assert.equal(TRANSACTION_SCHEMA_VERSION, 2);

  const ev1 = mapStepToTransactionEvent({
    actionType: 'fill_form_field',
    params: { label_text: '客户名称', value: 'x' },
    element: {
      xpath_smart: "//input[@id='a']",
      layers: [
        { role: 'tab', label: '客户基本信息' },
        { role: 'section', label: '对公客户概况' },
        { role: 'titlebox', label: '基本信息' },
      ],
    },
  });
  assert.equal(ev1.regionId, 'titlebox:基本信息');
  assert.equal(ev1.parentRegionId, 'section:对公客户概况');
  assert.equal(ev1.elementType, "//input[@id='a']", 'old fields unchanged');

  const ev2 = mapStepToTransactionEvent({
    actionType: 'select_option',
    params: { label_text: '类型', option_text: 'A' },
    element: { xpath_smart: "//div[@id='s']", region_id: 'tab:T|section:S' },
  });
  assert.equal(ev2.regionId, 'section:S');
  assert.equal(ev2.parentRegionId, 'tab:T');

  const ev3 = mapStepToTransactionEvent({
    actionType: 'click_element_by_index',
    params: { text: '保存' },
    element: { xpath_smart: "//button[.='保存']", region_label: '基本信息 / 对公客户概况' },
  });
  assert.equal(ev3.regionId, '对公客户概况');
  assert.equal(ev3.parentRegionId, '基本信息');

  const ev4 = mapStepToTransactionEvent({
    actionType: 'click_element_by_index',
    params: { text: '保存' },
    element: { xpath_smart: "//button[.='保存']" },
  });
  assert.equal(ev4.regionId, '');
  assert.equal(ev4.parentRegionId, '');

  const ev5 = mapStepToTransactionEvent({ actionType: 'done', element: {} });
  assert.equal(ev5, null, 'meta actions still skipped');
  ok('mapStepToTransactionEvent region evidence');
}

console.log('characterize-transaction-export-region: ok');
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node scripts/characterization/characterize-transaction-export-region.mjs`
Expected: FAIL（`ev1.regionId` 为 `undefined`；`TRANSACTION_SCHEMA_VERSION` 不存在）。

- [ ] **Step 3: 实现 `transaction-export.js`**

顶部 import 区加：

```js
import { deriveRegionRef } from './region-tree.js';

export const TRANSACTION_SCHEMA_VERSION = 2;
```

`TRANSACTION_ENVELOPE_FIELDS` 数组 `{ key: 'transcationProperties', ... }` 项后加：

```js
  { key: 'regionId', zh: '步骤所属区域节点 id（最内层 region_id 段 role:label）' },
  { key: 'parentRegionId', zh: '父区域节点 id（上一层段；根为空串）' },
```

`mapStepToTransactionEvent` 中，在 `const element = entry.element || {};` 之后加：

```js
  const { regionId, parentRegionId } = deriveRegionRef(element);
```

return 对象中 `mothed: 'By.XPATH',` 之后加：

```js
    regionId,
    parentRegionId,
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node scripts/characterization/characterize-transaction-export-region.mjs`
Expected: exit 0。

- [ ] **Step 5: Commit**

```bash
git add src/services/transaction-export.js scripts/characterization/characterize-transaction-export-region.mjs
git commit -m "feat: transaction export per-step regionId + parentRegionId"
```

---

### Task 8: 导出 `phases[]` + schema v2 + api-docs 同步

**Files:**
- Modify: `src/services/transaction-export.js`（`buildTransactionPhases` + `buildTransactionEntry` 挂 `phases`）
- Modify: `src/routes/v2/export-mgmt.js`（`buildOneTrajectory` 装载 phases/截图；schemaVersion 全部 1→`TRANSACTION_SCHEMA_VERSION`；schema 接口 notes）
- Modify: `src/dashboard/api-docs/groups/export-mgmt.js:126-138,158-185`（schemaVersion 2、字段示例、notes）
- Modify: `scripts/characterization/characterize-transaction-export-region.mjs`（加 phases 形状断言）
- Modify: `CHANGELOG.md`（routes 契约条目）

**Interfaces:**
- Consumes: `trajectoryPhaseDao.listByTrajectory`、`screenshotDao.listPhaseHighlightsByTrajectory`（Task 5）
- Produces: envelope 每交易项 `phases: [{ phaseId, phaseNumber, screenshotId, stitchScreenshotUrl, metadata }]`；`buildTransactionEntry(traj, { systemId, projectId, phases, phaseScreenshots })`。

- [ ] **Step 1: 加失败断言（characterize-transaction-export-region.mjs 追加）**

```js
{
  const { buildTransactionEntry, buildTransactionPhases } =
    await import('../../src/services/transaction-export.js');
  const phases = buildTransactionPhases(
    [{ id: 7, phaseNumber: 1 }, { id: 8, phaseNumber: 2 }],
    [{ id: 55, trajectoryPhaseId: 7, metadataJson: { imageWidth: 1280, imageHeight: 3200, elements: [], regionTree: { pageLabel: '', roots: [] } } }],
  );
  assert.equal(phases.length, 2);
  assert.equal(phases[0].screenshotId, 55);
  assert.equal(phases[0].stitchScreenshotUrl, '/api/v2/screenshots/55/image');
  assert.equal(phases[0].metadata.imageWidth, 1280);
  assert.equal(phases[1].screenshotId, null);
  assert.equal(phases[1].metadata, null);

  const built = buildTransactionEntry(
    { id: 3, name: 't', steps: [] },
    { systemId: '98', projectId: '31', phases: [{ id: 7, phaseNumber: 1 }], phaseScreenshots: [] },
  );
  assert.equal(built.entry.phases.length, 1);
  assert.equal(built.entry.phases[0].screenshotId, null);
  ok('buildTransactionPhases + entry phases');
}
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node scripts/characterization/characterize-transaction-export-region.mjs`
Expected: FAIL（`buildTransactionPhases` 不存在）。

- [ ] **Step 3: 实现 `transaction-export.js`**

```js
export function buildTransactionPhases(phases = [], phaseScreenshots = []) {
  const byPhase = new Map();
  for (const s of phaseScreenshots || []) {
    if (s?.trajectoryPhaseId != null && !byPhase.has(Number(s.trajectoryPhaseId))) {
      byPhase.set(Number(s.trajectoryPhaseId), s);
    }
  }
  return (phases || []).map((p) => {
    const shot = p?.id != null ? byPhase.get(Number(p.id)) || null : null;
    const screenshotId = shot ? Number(shot.id) : null;
    return {
      phaseId: p?.id != null ? Number(p.id) : null,
      phaseNumber: p?.phaseNumber != null ? Number(p.phaseNumber) : 0,
      screenshotId,
      stitchScreenshotUrl: screenshotId ? `/api/v2/screenshots/${screenshotId}/image` : null,
      metadata: shot?.metadataJson ?? null,
    };
  });
}
```

`buildTransactionEntry(traj, { systemId, projectId } = {})` 签名改为 `{ systemId, projectId, phases, phaseScreenshots } = {}`；entry 对象 `transcationProperties: properties,` 后加：

```js
      phases: buildTransactionPhases(phases, phaseScreenshots),
```

`TRANSACTION_ENVELOPE_FIELDS` 加一项：

```js
  { key: 'phases', zh: '阶段数组（截图引用 + 元数据；旧截图 metadata 为 null）' },
```

- [ ] **Step 4: 改 `export-mgmt.js`**

顶部 import 加：

```js
import * as trajectoryPhaseDao from '../../dao/trajectory-phase-dao.js';
import * as screenshotDao from '../../dao/screenshot-dao.js';
```

`buildOneTrajectory` 改为：

```js
async function buildOneTrajectory(traj, { systemId, projectId }) {
  const [phases, phaseScreenshots] = await Promise.all([
    trajectoryPhaseDao.listByTrajectory(traj.id),
    screenshotDao.listPhaseHighlightsByTrajectory(traj.id),
  ]);
  const built = buildTransactionPayload(traj, { systemId, projectId, phases, phaseScreenshots });
  return {
    trajectoryId: traj.id,
    schemaVersion: TRANSACTION_SCHEMA_VERSION,
    ...built,
  };
}
```

（`buildTransactionPayload` 需把 `phases`/`phaseScreenshots` 透传给 `buildTransactionEntry`——在 `transaction-export.js` 的 `buildTransactionPayload(traj, opts)` 中把 `opts.phases` / `opts.phaseScreenshots` 传下去。）

本文件所有响应里的硬编码 `schemaVersion: 1`（schema 接口、batch 各返回分支、single 无关）改为 `schemaVersion: TRANSACTION_SCHEMA_VERSION`（顶部 import 加 `TRANSACTION_SCHEMA_VERSION`）。schema 接口 notes 数组加：

```js
        'V2: 每步 regionId/parentRegionId（层级作证）；每交易 phases[]（截图引用 + metadata）。旧字段拼写不变',
```

- [ ] **Step 5: 同步 api-docs `export-mgmt.js`**

- schema 接口 respExample 改 `schemaVersion: 2`，fields 数组加 `{ key: 'regionId', zh: '步骤所属区域节点 id' }`、`{ key: 'parentRegionId', zh: '父区域节点 id' }`、`{ key: 'phases', zh: '阶段数组（截图引用 + 元数据）' }`
- batch 接口 respExample 改 `schemaVersion: 2`，notes 追加 `'每交易含 phases[]：阶段截图引用 + metadata（imageWidth/imageHeight/elements/regionTree）；前端经 stitchScreenshotUrl 拉图后按坐标动态高亮'`

- [ ] **Step 6: 跑验证**

Run: `node scripts/characterization/characterize-transaction-export-region.mjs` 与 `node scripts/characterization/characterize-phase-highlight-screenshot.mjs`
Expected: 均 exit 0。

- [ ] **Step 7: CHANGELOG**

`[Unreleased]` 追加：

```markdown
- 导出/推送 envelope V2（schemaVersion 2）：每个 `transcationProperties` 项新增 `regionId`/`parentRegionId`（层级作证，空串兜底）；每交易新增 `phases[]`（phaseId/phaseNumber/screenshotId/stitchScreenshotUrl/metadata）。
  影响范围：src/routes/v2/export-mgmt、src/services/transaction-export、api-docs 契约。
  Python 同步提示：前端契约以 /api/v2/export/transaction/schema 为准；Python 控制面无对应端点。
```

- [ ] **Step 8: Commit**

```bash
git add src/services/transaction-export.js src/routes/v2/export-mgmt.js src/dashboard/api-docs/groups/export-mgmt.js scripts/characterization/characterize-transaction-export-region.mjs CHANGELOG.md
git commit -m "feat: export envelope v2 phases + schema docs sync"
```

---

### Task 9: 全量回归 + 文档收尾

**Files:**
- Modify: `docs/superpowers/todo-list.md`（PR-PUSH / PR-LAYER 状态更新）
- Modify: `CHANGELOG.md`（如需补漏）

**Interfaces:** 无新接口。

- [ ] **Step 1: 全量回归**

Run: `bash scripts/refactor/verify-all.sh`
Expected: 全部 characterization + smoke 绿，exit 0。若 `characterize-ctrl.mjs` 或其它与本次无关的脚本失败，先确认失败是否由本计划改动引起（`git stash` 对照）；由本计划引起则修复，否则报告但不阻塞。

- [ ] **Step 2: 逐条跑核心表征**

Run:
- `node scripts/characterization/characterize-region-tree.mjs`
- `node scripts/characterization/characterize-transaction-export-region.mjs`
- `node scripts/characterization/characterize-phase-highlight-screenshot.mjs`
- `node scripts/characterization/characterize-partition-compose.mjs`
- `node scripts/smoke/accept-replay-apis.mjs`

Expected: 全部 exit 0。

- [ ] **Step 3: 更新 todo-list.md**

- 产品任务表 **PR-PUSH** 状态补 `V2.0：每步 regionId/parentRegionId + 每交易 phases[]（截图引用+元数据）— [spec](specs/2026-08-14-batch-push-v2-region-evidence-design.md)`
- **PR-LAYER** 行把「整页大树 TODO」改为「整页大树已落地（assembleRegionTree + 扫描/阶段树）」
- 更新记录表加一行：`| 2026-08-15 | 批量推送 V2.0 + 整页大树 + 阶段截图元数据 落地 — [plan](plans/2026-08-15-batch-push-v2-region-evidence.md) |`

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/todo-list.md CHANGELOG.md
git commit -m "docs: todo-list sync for batch push v2 + region tree"
```

- [ ] **Step 5: 人工湿测清单（不阻塞本计划完成，需要执行机在线）**

1. `npm start` + executor 在线；录制对公客户修改（账号 701994 / 1）至少一个阶段。
2. phase_done 后查 `screenshot` 行：`metadata_json` 非空，`imageWidth/imageHeight` 与图一致，`elements` 含坐标与 `regionId/parentRegionId`，`regionTree.roots` 非空；`trajectory_phase.stitch_screenshot_id` 有值。
3. `GET /api/v2/export/trajectories/{id}/transaction?raw=1&systemId=98&projectId=31`：每步有 `regionId`/`parentRegionId`；`phases[]` 带 `stitchScreenshotUrl` 与 `metadata`。
4. 下载阶段图确认**无**蓝色高亮残留。
5. 前端（另仓）按 `metadata` 坐标画高亮框验收。

---

## Self-Review Notes

- 规范覆盖：spec 五节 + 兼容矩阵全部映射到 Task 1-9（deriveRegionRef 三层回退链 = Task 2 断言；坐标换算 = Task 3 `sliceOffset`；旧数据不回填 = 各任务空串/null 兜底；CHANGELOG/init.sql/catalog 义务 = Task 1/5/8/9）。
- 类型一致：`RegionNode`、`deriveRegionRef`、`buildTransactionPhases`、`runPhaseScreenshotCapture` 返回形状在各任务 Interfaces 中一致引用。
- 无占位符：所有步骤含实际代码/断言/命令。
