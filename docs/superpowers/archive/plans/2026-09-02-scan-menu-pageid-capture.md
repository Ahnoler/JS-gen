# 菜单扫描全量补采 pageId Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** scan-menu 落库后对空 `pd_cmpt_ecd` 的二级菜单逐个点开读天元并写入落地 pageId；record/prepare 不再回写菜单。

**Architecture:** 抽出公共 `writeFunctionLandingPage`；新建 `menu-scan-pageid.js` 在 `applyScanPlan` 之后列举候选并 `click_menu_xpath` + `read_page_component_code`；统计并入 scan job；`recording-page-bind.js` 删除菜单回写分支。

**Tech Stack:** Node ESM、`runReplayActions`、`systemDao` / `systemPageDao`、characterization `readFileSync` pins。

## Global Constraints

- 候选：type=3 且 `pd_cmpt_ecd` 为空（不限 source）；非空不覆盖
- 取值：`componentCode || scenarioCode`；无码 skip；**不写 AILZ 到菜单**
- 单条失败 catch → skip；不导致整次扫描 failed
- prepare：**不回写** `pd_cmpt_ecd` / `system_page`；仍可写 `trajectory.page_id`
- 复用现有 replay 动作；不改 phase2 merge 语义

## File map

| 文件 | 职责 |
|------|------|
| `src/services/function-landing-page.js`（新建） | 导出 `writeFunctionLandingPage` |
| `src/services/trajectory/recording-page-bind.js` | 改用公共写库后**删除**菜单回写调用 |
| `src/services/menu-scan-pageid.js`（新建） | 列举候选 + 补采循环 |
| `src/services/menu-scan-session.js` | apply 后调用补采；stats 合并 |
| `src/dashboard/api-docs/groups/overview.js` | scan-menu 文档 + stats 示例 |
| `scripts/characterization/characterize-page-bind.mjs` | prepare 无菜单回写 |
| `scripts/characterization/characterize-menu-scan.mjs` | pin 补采入口 |
| `CHANGELOG.md` | Unreleased |

---

### Task 1: 抽出 writeFunctionLandingPage + prepare 取消菜单回写

**Files:**
- Create: `src/services/function-landing-page.js`
- Modify: `src/services/trajectory/recording-page-bind.js`
- Modify: `scripts/characterization/characterize-page-bind.mjs`
- Test: `node scripts/characterization/characterize-page-bind.mjs`

**Interfaces:**
- Produces: `export async function writeFunctionLandingPage(functionId, landing) → Promise<void>`
  - `landing: { pageId: string, pageName?: string, resPath?: string }`
  - 空 pageId / 无效 id → return；失败 warn 不抛（与现 writeBack 一致）
- Consumes: `systemDao.update`、`systemPageDao.replaceForNode`

- [ ] **Step 1: 更新特征化（prepare 不再 pin 菜单回写）**

改 `testWiringService` / `testWiringWriteBackOnlyOnRead`：

```js
function testWiringService() {
  const service = readFileSync(join(root, 'src/services/trajectory/recording-page-bind.js'), 'utf8');
  assert.match(service, /runReplayActions/, 'service routes read_page_component_code replay through runReplayActions');
  assert.match(service, /read_page_component_code/, 'service references read_page_component_code');
  assert.match(service, /AILZ/, 'service references AILZ prefix');
  assert.match(service, /updateMeta/, 'service references updateMeta');
  assert.doesNotMatch(service, /writeBackFunctionLandingPage|writeFunctionLandingPage/, 'prepare must not write menu landing page');
  assert.doesNotMatch(service, /json_import/, 'prepare must not gate on menu source for write-back');
}

function testWiringWriteBackOnlyOnRead() {
  const service = readFileSync(join(root, 'src/services/trajectory/recording-page-bind.js'), 'utf8');
  const earlyIdx = service.indexOf('no functionId, generated pageId');
  assert.ok(earlyIdx > 0, 'early AILZ log present');
  assert.match(service, /source = 'generated'/, 'generated source still assigned');
  assert.doesNotMatch(service, /writeFunctionLandingPage|writeBackFunctionLandingPage/, 'no menu write-back helper calls');
}

function testWiringLandingHelper() {
  const helper = readFileSync(join(root, 'src/services/function-landing-page.js'), 'utf8');
  assert.match(helper, /export async function writeFunctionLandingPage/, 'shared landing writer exported');
  assert.match(helper, /replaceForNode/, 'writes system_page via replaceForNode');
  assert.match(helper, /pdCmptEcd/, 'updates system.pdCmptEcd');
}
```

把 `testWiringLandingHelper` 加入 `main()` 测试列表。

- [ ] **Step 2: 跑测试确认失败**

Run: `node scripts/characterization/characterize-page-bind.mjs`  
Expected: FAIL — 缺 `function-landing-page.js` 或仍含 write-back

- [ ] **Step 3: 新建 `function-landing-page.js`**

```js
/**
 * 功能节点落地 pageId 写入（pd_cmpt_ecd + system_page 单行）。
 * 失败只 warn，不抛。
 */
import * as systemDao from '../dao/system-dao.js';
import * as systemPageDao from '../dao/system-page-dao.js';

/**
 * @param {number} functionId 功能节点 id
 * @param {{ pageId: string, pageName?: string, resPath?: string }} landing 落地页
 * @returns {Promise<void>}
 */
export async function writeFunctionLandingPage(functionId, landing) {
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
    console.log('[landing] wrote function#%s pageId=%s', fid, pageId);
  } catch (err) {
    console.warn('[landing] write failed function#%s: %s', fid, err?.message || err);
  }
}
```

- [ ] **Step 4: 改 `recording-page-bind.js`**

- 删除私有 `writeBackFunctionLandingPage` 整函数  
- 删除 `source === 'read' && pageId` 下查 `systemDao.getById` + 白名单 + write-back 整块  
- 删除对 `systemPageDao` 的 import（若不再使用）；交叉校验仍可用 `systemPageDao.listByNodeId` 则保留  
- 文件头注释改为：菜单落地由 scan-menu 补采；prepare 只写轨迹  

保留：导航、读码、`componentCode || scenarioCode || AILZ`、`trajectoryDao.updateMeta`。

- [ ] **Step 5: 跑测试确认通过**

Run: `node scripts/characterization/characterize-page-bind.mjs`  
Expected: OK

- [ ] **Step 6: Commit**

```bash
git add src/services/function-landing-page.js src/services/trajectory/recording-page-bind.js scripts/characterization/characterize-page-bind.mjs
git commit -m "refactor: extract landing writer; stop prepare menu write-back"
```

---

### Task 2: menu-scan-pageid — 候选列举 + 补采循环

**Files:**
- Create: `src/services/menu-scan-pageid.js`
- Modify: `scripts/characterization/characterize-menu-scan.mjs`（追加 wiring）
- Test: `node scripts/characterization/characterize-menu-scan.mjs`

**Interfaces:**
- Consumes: `systemDao.listAll`（或 listByParent 拼树）、`NODE_TYPE`、`runReplayActions`、`writeFunctionLandingPage`、`REPLAY_PHASE2_TIMEOUT_MS`（或专用超时）
- Produces:
  - `export function listEmptyPageIdFunctions(allNodes, systemNodeId) → Array<{ id, name, menuXpath, parentId }>`
  - `export async function fillEmptyPageIdsForSystem({ systemNodeId, runtime, execSession }) → { pageIdCandidates, pageIdFilled, pageIdSkipped }`

- [ ] **Step 1: 写失败特征化**

在 `characterize-menu-scan.mjs` 追加：

```js
function testWiringPageIdFill() {
  const pageid = readFileSync(join(root, 'src/services/menu-scan-pageid.js'), 'utf8');
  assert.match(pageid, /export function listEmptyPageIdFunctions/, 'lists empty pd_cmpt_ecd L2');
  assert.match(pageid, /export async function fillEmptyPageIdsForSystem/, 'fill entry exported');
  assert.match(pageid, /read_page_component_code/, 'reads tianyuan codes');
  assert.match(pageid, /click_menu_xpath/, 'clicks menu xpath');
  assert.match(pageid, /writeFunctionLandingPage/, 'writes landing via shared helper');
  assert.match(pageid, /pageIdSkipped|pageIdFilled/, 'returns fill stats');
}

function testListEmptyPageIdFunctionsPure() {
  // 若模块可 import：用假节点测过滤；否则仅 wiring
}
```

并在 `testWiringService` 拼接文件列表中加入 `menu-scan-pageid.js`（若 Task 3 才接线，本步可只测 pageid 文件存在）。

可选纯函数测试（模块可 import 时）：

```js
import { listEmptyPageIdFunctions } from '../../src/services/menu-scan-pageid.js';
import { NODE_TYPE } from '../../src/dao/system-dao.js'; // 或 hierarchy-constants

const nodes = [
  { id: 1, type: 1, parentId: 0, name: 'S', pdCmptEcd: '', menuXpath: '' },
  { id: 10, type: 2, parentId: 1, name: 'M', pdCmptEcd: '', menuXpath: '//m' },
  { id: 11, type: 3, parentId: 10, name: 'empty', pdCmptEcd: '', menuXpath: '//a' },
  { id: 12, type: 3, parentId: 10, name: 'filled', pdCmptEcd: 'ZJJK1', menuXpath: '//b' },
  { id: 13, type: 3, parentId: 10, name: 'no-xpath', pdCmptEcd: '', menuXpath: '' },
];
const list = listEmptyPageIdFunctions(nodes, 1);
assert.equal(list.length, 1);
assert.equal(list[0].id, 11);
```

（无 xpath 的空 pageId：仍计入 candidates，fill 时 skip 导航 → pageIdSkipped。）

- [ ] **Step 2: 跑测试确认失败**

Run: `node scripts/characterization/characterize-menu-scan.mjs`  
Expected: FAIL — 缺文件

- [ ] **Step 3: 实现 `menu-scan-pageid.js`**

```js
import { REPLAY_PHASE2_TIMEOUT_MS } from '../../config/config.js';
import * as systemDao from '../dao/system-dao.js';
import { NODE_TYPE } from '../dao/system-dao.js'; // 若 NODE_TYPE 在 hierarchy-constants，从其 import
import { runReplayActions } from './replay-actions.js';
import { writeFunctionLandingPage } from './function-landing-page.js';

const PAGEID_FILL_MAX = 200; // 硬上限，防超长扫描

/**
 * @param {object[]} allNodes systemDao.listAll 行
 * @param {number} systemNodeId
 * @returns {Array<{ id: number, name: string, menuXpath: string, parentId: number }>}
 */
export function listEmptyPageIdFunctions(allNodes, systemNodeId) {
  const modules = (allNodes || []).filter(
    (n) => Number(n.type) === NODE_TYPE.MODULE && Number(n.parentId) === Number(systemNodeId),
  );
  const moduleIds = new Set(modules.map((m) => Number(m.id)));
  return (allNodes || [])
    .filter((n) => Number(n.type) === NODE_TYPE.FUNCTION && moduleIds.has(Number(n.parentId)))
    .filter((n) => !String(n.pdCmptEcd || '').trim())
    .map((n) => ({
      id: Number(n.id),
      name: String(n.name || ''),
      menuXpath: String(n.menuXpath || '').trim(),
      parentId: Number(n.parentId),
    }));
}

/**
 * @param {object} opts
 * @param {number} opts.systemNodeId
 * @param {{ sessionId: string, nodeUuid: string }} opts.runtime
 * @param {object} opts.execSession
 * @returns {Promise<{ pageIdCandidates: number, pageIdFilled: number, pageIdSkipped: number }>}
 */
export async function fillEmptyPageIdsForSystem({ systemNodeId, runtime, execSession }) {
  const all = await systemDao.listAll();
  const candidates = listEmptyPageIdFunctions(all, systemNodeId);
  const byId = new Map(all.map((n) => [Number(n.id), n]));
  let pageIdFilled = 0;
  let pageIdSkipped = 0;
  const limit = Math.min(candidates.length, PAGEID_FILL_MAX);

  for (let i = 0; i < limit; i += 1) {
    const c = candidates[i];
    try {
      const parent = byId.get(Number(c.parentId));
      const moduleXpath = String(parent?.menuXpath || '').trim();
      const functionXpath = c.menuXpath;
      if (!moduleXpath && !functionXpath) {
        pageIdSkipped += 1;
        continue;
      }
      const actions = [];
      if (moduleXpath) actions.push({ action: 'click_menu_xpath', params: { xpath: moduleXpath } });
      if (functionXpath) actions.push({ action: 'click_menu_xpath', params: { xpath: functionXpath } });
      actions.push({ action: 'read_page_component_code', params: {} });

      const { result: r } = await runReplayActions({
        execSession,
        sessionId: runtime.sessionId,
        nodeUuid: runtime.nodeUuid,
        actions,
        timeoutMs: REPLAY_PHASE2_TIMEOUT_MS,
        stopOnFail: false,
        isReplay: true,
      });
      const results = Array.isArray(r?.results) ? r.results : [];
      const row = results.find((it) => it && it.action === 'read_page_component_code');
      const payload = row?.pageCode && typeof row.pageCode === 'object' ? row.pageCode : {};
      const componentCode = String(payload.componentCode || '').trim();
      const scenarioCode = String(payload.scenarioCode || '').trim();
      const pageId = componentCode || scenarioCode;
      if (!pageId) {
        pageIdSkipped += 1;
        continue;
      }
      await writeFunctionLandingPage(c.id, {
        pageId,
        pageName: String(payload.pageName || '').trim(),
        resPath: String(payload.pagePath || '').trim(),
      });
      pageIdFilled += 1;
    } catch (err) {
      pageIdSkipped += 1;
      console.warn('[menu-scan-pageid] skip function#%s: %s', c.id, err?.message || err);
    }
  }
  // 超出硬上限的候选计为 skipped
  pageIdSkipped += Math.max(0, candidates.length - limit);

  return {
    pageIdCandidates: candidates.length,
    pageIdFilled,
    pageIdSkipped,
  };
}
```

确认 `NODE_TYPE` 实际导出路径（`../dao/system-dao.js` 或 `../models/hierarchy-constants.js`），与 `menu-scan-apply.js` 一致。

- [ ] **Step 4: 跑测试**

Run: `node scripts/characterization/characterize-menu-scan.mjs`  
Expected: 新 wiring PASS（若 session 尚未接线，不要在本任务断言 session 调用）

- [ ] **Step 5: Commit**

```bash
git add src/services/menu-scan-pageid.js scripts/characterization/characterize-menu-scan.mjs
git commit -m "feat(menu-scan): fill empty L2 pageIds after apply (module)"
```

---

### Task 3: 接入 runScan + api-docs + CHANGELOG

**Files:**
- Modify: `src/services/menu-scan-session.js`
- Modify: `src/dashboard/api-docs/groups/overview.js`（scan-menu 段）
- Modify: `scripts/characterization/characterize-menu-scan.mjs`（session wiring）
- Modify: `CHANGELOG.md`
- Test: `node scripts/characterization/characterize-menu-scan.mjs`  
  `node scripts/characterization/characterize-page-bind.mjs`

**Interfaces:**
- Consumes: `fillEmptyPageIdsForSystem` from Task 2
- Produces: `job.stats` 含 `pageIdCandidates` / `pageIdFilled` / `pageIdSkipped`

- [ ] **Step 1: 特征化 pin session 调用**

在拼接 wiring 或单独断言：

```js
assert.match(service, /fillEmptyPageIdsForSystem/, 'runScan calls pageId fill after apply');
```

（`service` 为 menu-scan-* 拼接文本。）

- [ ] **Step 2: 跑测试确认失败**

Run: `node scripts/characterization/characterize-menu-scan.mjs`  
Expected: FAIL — session 尚未 import/调用

- [ ] **Step 3: 改 `runScan`**

在 `applyScanPlan(...)` 成功之后、`job.status = 'completed'` 之前：

```js
    const pageIdStats = await fillEmptyPageIdsForSystem({
      systemNodeId,
      runtime: { sessionId, nodeUuid },
      execSession,
    });

    job.status = 'completed';
    job.stats = {
      ...plan.stats,
      updates: plan.updates.length,
      phase2Reads: phase2.reads,
      mergedByPageId: phase2.merges.length,
      unmatchedMarked: applyStats.unmatchedMarked,
      ...pageIdStats,
    };
```

`fillEmptyPageIdsForSystem` 自身不抛；若仍担心，可再包 try/catch，失败时 stats 记 0 并 warn，**仍** completed。

更新文件头注释流程第 6 步为「补采空 pageId」，原「释放会话」顺延。

- [ ] **Step 4: api-docs**

`overview.js` scan-menu：

- `desc`：补充 apply 后对空 `pd_cmpt_ecd` 的 L2 点开读天元写入  
- `stats` 示例加 `pageIdCandidates` / `pageIdFilled` / `pageIdSkipped`  
- notes：读不到 skip；不覆盖已有 pageId；不写 AILZ 到菜单  

- [ ] **Step 5: CHANGELOG**

```markdown
- 2026-09-02: **菜单扫描补采落地 pageId**：apply 后对空 `pd_cmpt_ecd` 的 L2 点开读天元（组件单码→场景编号）写入；skip 不失败。prepare 取消菜单回写。影响：`menu-scan-pageid.js`、`menu-scan-session.js`、`function-landing-page.js`、`recording-page-bind.js`。
```

- [ ] **Step 6: 终验**

```bash
node scripts/characterization/characterize-menu-scan.mjs
node scripts/characterization/characterize-page-bind.mjs
```

Expected: 全部 OK

- [ ] **Step 7: Commit**

```bash
git add src/services/menu-scan-session.js src/dashboard/api-docs/groups/overview.js scripts/characterization/characterize-menu-scan.mjs CHANGELOG.md
git commit -m "feat(menu-scan): run pageId fill after apply; docs + changelog"
```

---

## Spec coverage checklist

| Spec 要求 | Task |
|-----------|------|
| apply 后补采空 pageId L2 | Task 2–3 |
| 不覆盖非空 | Task 2 `listEmptyPageIdFunctions` |
| 无码 skip、不写 AILZ 到菜单 | Task 2 |
| prepare 不回写菜单 | Task 1 |
| stats 三字段 | Task 3 |
| 不改 phase2 / partner | 各 Task 非目标 |

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-09-02-scan-menu-pageid-capture.md`. Two execution options:

**1. Subagent-Driven (recommended)** — 每任务新 subagent + 任务间审查  

**2. Inline Execution** — 本会话按计划连续执行  

Which approach?
