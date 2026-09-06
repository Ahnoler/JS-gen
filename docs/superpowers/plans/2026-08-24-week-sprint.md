# 本周冲刺 Implementation Plan：partition-via-pid + budget-extend + v3-payload-size ②③

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 三项开发在周三（8/26）EOD 前全部完成：①分区数据改 propertiesID/propertiesPID 父子树；②阶段步数预算耗尽续跑；③V3 字段完整性校验+推送前自检+超长截断。

**Architecture:** partition-via-pid 在 V3 导出构建期插入 `type='section'` 中间节点建立 PID 父子树；budget-extend 在 agent run 后质量门加续跑循环（同实例二次 run）；v3-payload-size 在导出层加字段完整性统计+截断+推送前自检。三项文件依赖：partition 与 v3-payload-size 同改 export-v3.js（先后接续），budget-extend 改 scripts/（并行）。

**Tech Stack:** Node.js ESM（src/services/）、Python 3（scripts/agent/、scripts/controller/）、characterization 测试（JS .mjs + Python .py）、verify-all.sh gate。

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-24-week-sprint-spec.md`
- CTRL parity hard: `src/ctrl-actions/` canonical，Python cue copy 在 `scripts/controller/actions/_js_snippets.py`，保持同步
- characterization pin 源码子串：拆文件时保留 markers，characterization 改读拼接文件
- CHANGELOG：涉及 `src/services/` 变更必须写 [Unreleased] 条目
- Python 同步暂停：CHANGELOG 照常更新，Python 控制面同步后置
- 湿测需本地浏览器环境（D:\anaconda3\envs\browser_use\python.exe）
- `verify-all.sh` ALL GREEN 是每个 task 的交付门
- 分区节点 `type='section'`，角色信息不保留在 type（角色在控件 xpath 中体现）
- budget-extend done 检测用闭包 flag（`case_data_store['_done_fired']`），不依赖 `agent._done_fired`
- budget-extend 引入字段计数从 `_scan_fields`（disabled && hasButton）读
- v3-payload-size ②③ 只统计不阻断

---

## File Structure

| 文件 | 责任 | 改动类型 |
|------|------|----------|
| `src/services/transaction-export-v3.js` | V3 导出构建（分区节点+字段校验+截断） | 修改 |
| `src/services/partner-platform.js` | 出站契约适配（section type fallback+preflight） | 修改 |
| `src/routes/v2/export-mgmt.js` | 推送路由（surface merged.stats） | 修改 |
| `src/dashboard/api-docs/groups/export-mgmt.js` | API 文档（type='section' 说明） | 修改 |
| `scripts/controller/actions/phase/reviewer.py` | `compute_budget_extension` 纯函数 | 修改 |
| `scripts/agent_utils.py` | `make_done_callback` 闭包 flag | 修改 |
| `scripts/agent/service.py` | 续跑循环+引入字段计数+可观测性 | 修改 |
| `scripts/tools/lightup-phase-screenshot.mjs` | PID 树视图 | 修改 |
| `scripts/tools/layer-tree-from-properties.mjs` | section 节点识别 | 修改 |
| `scripts/characterization/characterize-export-v3-pid.mjs` | 分区 PID 树 characterization | 新建 |
| `scripts/characterization/characterize-budget-extend.py` | 续跑 characterization | 新建 |
| `scripts/characterization/characterize-export-v3-field-completeness.mjs` | 字段完整性 characterization | 新建 |
| `scripts/characterization/characterize-export-v3.mjs` | 更新 first ele id 断言 | 修改 |
| `scripts/refactor/verify-all.sh` | 注册 3 个新 characterization | 修改 |
| `CHANGELOG.md` | [Unreleased] 条目 | 修改 |

---

## Task 1: partition-via-pid — buildV3Properties 插入 section 节点

**Files:**
- Modify: `src/services/transaction-export-v3.js:362-514`（`buildV3Properties`）
- Test: `scripts/characterization/characterize-export-v3-pid.mjs`（新建）

**Interfaces:**
- Consumes: `buildScreenshotEntries` 返回的 `idByPageLevel`/`idByDialog`/`idByPhase`/`pageLevelById` maps（现有）
- Produces: `buildV3Properties` 输出的 `properties[]` 含 `type='section'` 中间节点；ele 的 `propertiesPID` 指向最近 section 节点（无分区段则指向 page/dialog 截图）

- [ ] **Step 1: 写 section 节点创建逻辑的 failing test**

创建 `scripts/characterization/characterize-export-v3-pid.mjs`，写入分区节点创建测试：

```js
import { buildV3Properties, buildScreenshotEntries, buildTransactionEntryV3 } from '../../src/services/transaction-export-v3.js';

const failures = [];
function check(label, cond) { if (!cond) failures.push(label); }

// 构造 1 个 page 截图 + 2 个 ele（不同分区段，同名"保存"）
const shotEntries = buildScreenshotEntries({
  pageLevelScreenshots: [{
    levelType: 'page', levelKey: 'page:url#/home',
    metadataJson: { displayName: '首页' },
    image_url: 'http://minio/page1.png',
  }],
});
const { properties } = buildV3Properties({
  traj: { steps: [
    { id: 1, trajectoryPhaseId: 1, actionType: 'click_save', params: { text: '保存' },
      elementJson: JSON.stringify({ region_id: 'page:url#/home|tab:基本信息|section:概况', region_label: '概况', formLabel: '保存', bbox: {x1:1,y1:1,x2:2,y2:2}, page_level_key: 'page:url#/home' }) },
    { id: 2, trajectoryPhaseId: 1, actionType: 'click_save', params: { text: '保存' },
      elementJson: JSON.stringify({ region_id: 'page:url#/home|tab:详情|section:详情', region_label: '详情', formLabel: '保存', bbox: {x1:3,y1:3,x2:4,y2:4}, page_level_key: 'page:url#/home' }) },
  ]},
  phases: [],
  screenshotCount: shotEntries.entries.length,
  idByPageLevel: shotEntries.idByPageLevel,
  idByDialog: shotEntries.idByDialog,
  idByPhase: shotEntries.idByPhase,
  idByPageLevelNorm: shotEntries.idByPageLevelNorm,
  pageLevelById: shotEntries.pageLevelById,
});

// section 节点存在
const sections = properties.filter(p => p.type === 'section');
check('section count >= 2', sections.length >= 2);

// ele pid 指向 section 而非 page
const eles = properties.filter(p => p.type === 'ele');
check('ele count === 2', eles.length === 2);
check('ele[0] pid not page id', eles[0].propertiesPID !== '1');
check('ele[1] pid not page id', eles[1].propertiesPID !== '1');

// 同名"保存"pid 不同 → 可区分
check('same-name ele pids differ', eles[0].propertiesPID !== eles[1].propertiesPID);

// section 嵌套层级：tab → section 两层
const tabSections = sections.filter(s => s.propertiesPID === '1'); // pid 指向 page
check('tab-level sections >= 2', tabSections.length >= 2);

if (failures.length) { console.error('FAIL:', failures); process.exit(1); }
console.log('OK: section nodes created, ele pids point to sections, same-name distinguishable');
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node scripts/characterization/characterize-export-v3-pid.mjs`
Expected: FAIL — section 节点不存在（当前 `buildV3Properties` 不创建 section）

- [ ] **Step 3: 实现 section 节点创建逻辑**

在 `buildV3Properties`（`transaction-export-v3.js`）中，在 ele 节点创建之前，为每个分区段创建 section 节点。在 `buildV3Properties` 函数内 `nextId` 递增逻辑之后、ele 节点 `properties.push` 之前插入：

```js
// sectionCache: Map<partitionKey, entryId> — 同页同分区段复用
const sectionCache = new Map();

// 从 region_id 链提取分区段（跳过 page: 和 overlay: 段）
function extractPartitionSegments(regionId) {
  const rid = String(regionId || '').trim();
  if (!rid) return [];
  return rid.split('|')
    .map(s => s.trim())
    .filter(s => s && !s.startsWith('page:') && !s.startsWith('overlay:'));
}

// 从分区段提取 label（"role:label" → "label"；无冒号则整段）
function segmentLabel(seg) {
  const i = seg.indexOf(':');
  return i > 0 ? seg.slice(i + 1).trim() : seg;
}

// 为 step 的分区段创建/复用 section 节点，返回最近 section 的 id（无分区段返回 null）
function ensureSectionNodes(segments, rootPid) {
  if (!segments.length) return null;
  let parentId = rootPid;
  for (let i = 0; i < segments.length; i++) {
    const key = rootPid + '|' + segments.slice(0, i + 1).join('|');
    let sectionId = sectionCache.get(key);
    if (sectionId == null) {
      nextId += 1;
      sectionId = String(nextId);
      sectionCache.set(key, sectionId);
      properties.push({
        propertiesName: segmentLabel(segments[i]),
        eventTypeValue: '', eventTypeName: '', elementType: '',
        mothed: '', options: '', objectValue: '',
        transcationType: 'playwright',
        type: 'section',
        screenshot: [],
        propertiesID: sectionId,
        propertiesPID: String(parentId),
        realLabel: segmentLabel(segments[i]),
        regionId: '', regionLabel: '',
        rect: {},
      });
    }
    parentId = sectionId;
  }
  return parentId;
}
```

然后在 ele 节点创建处（有 element_json 的分支，`:475-486` 附近），在 `nextId += 1` 之前调用：

```js
// 分区段 → section 节点；ele pid 指向最近 section（无分区段则用原 pid）
const segments = extractPartitionSegments(rawRegionId);
const sectionPid = ensureSectionNodes(segments, pid);
const elePid = sectionPid || pid;
```

把 ele 节点的 `propertiesPID: pid` 改为 `propertiesPID: elePid`。

- [ ] **Step 4: 运行测试确认通过**

Run: `node scripts/characterization/characterize-export-v3-pid.mjs`
Expected: OK

- [ ] **Step 5: 补充存量兼容测试**

在 `characterize-export-v3-pid.mjs` 追加 legacy 兼容测试：

```js
// legacy：无分区段的 ele → pid 直指 page（无 section 节点创建）
const { properties: legacyProps } = buildV3Properties({
  traj: { steps: [
    { id: 10, trajectoryPhaseId: 1, actionType: 'click_element_by_index', params: { text: '按钮' },
      elementJson: JSON.stringify({ region_id: 'page:url#/home', region_label: '', formLabel: '按钮', bbox: {x1:1,y1:1,x2:2,y2:2}, page_level_key: 'page:url#/home' }) },
  ]},
  phases: [],
  screenshotCount: 1,
  idByPageLevel: new Map([['page:url#/home', 1]]),
  idByDialog: new Map(), idByPhase: new Map(),
  idByPageLevelNorm: new Map(), pageLevelById: new Map(),
});
const legacyEles = legacyProps.filter(p => p.type === 'ele');
const legacySections = legacyProps.filter(p => p.type === 'section');
check('legacy no section', legacySections.length === 0);
check('legacy ele pid = page id', legacyEles[0].propertiesPID === '1');
```

- [ ] **Step 6: 运行测试确认通过**

Run: `node scripts/characterization/characterize-export-v3-pid.mjs`
Expected: OK

- [ ] **Step 7: 更新现有 characterization 断言**

在 `scripts/characterization/characterize-export-v3.mjs` 中，找到断言 first ele id = `String(shotEntries.length + 1)` 的位置（`:117` 附近），改为：first ele id = screenshotCount + sectionCount + 1（或改为 `>= screenshotCount + 1`，因 section 插入后编号顺延）。

- [ ] **Step 8: 运行现有 V3 characterization**

Run: `node scripts/characterization/characterize-export-v3.mjs`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add src/services/transaction-export-v3.js scripts/characterization/characterize-export-v3-pid.mjs scripts/characterization/characterize-export-v3.mjs
git commit -m "feat(export-v3): insert type='section' partition nodes into PID tree for same-page same-name disambiguation"
```

---

## Task 2: partition-via-pid — validatePageLevelCoverage 向上追溯

**Files:**
- Modify: `src/services/transaction-export-v3.js:522-562`（`validatePageLevelCoverage`）
- Test: `scripts/characterization/characterize-export-v3-pid.mjs`（追加）

**Interfaces:**
- Consumes: Task 1 产生的 section 节点（properties[] 含 type='section'）
- Produces: `validatePageLevelCoverage` 对 ele pid→section→page 链向上追溯命中 page/dialog 截图

- [ ] **Step 1: 写向上追溯的 failing test**

在 `characterize-export-v3-pid.mjs` 追加：

```js
import { validatePageLevelCoverage, buildTransactionEntryV3 } from '../../src/services/transaction-export-v3.js';

// 构造含 section 节点的完整 entry，验证覆盖校验向上追溯
const built = buildTransactionEntryV3(
  { id: 1, name: 'test', steps: [
    { id: 1, trajectoryPhaseId: 1, actionType: 'click_save', params: { text: '保存' },
      elementJson: JSON.stringify({ region_id: 'page:url#/home|tab:基本信息|section:概况', region_label: '概况', formLabel: '保存', bbox: {x1:1,y1:1,x2:2,y2:2}, page_level_key: 'page:url#/home' }) },
  ]},
  { systemId: 1, projectId: 1, phases: [], phaseScreenshots: [], dialogScreenshots: [],
    pageLevelScreenshots: [{ levelType: 'page', levelKey: 'page:url#/home', metadataJson: { displayName: '首页' }, image_url: 'http://minio/p.png' }] },
);
const coverage = validatePageLevelCoverage(built.entry);
check('coverage ok with section nodes', coverage.ok);
check('coverage missing empty', coverage.missing.length === 0);
```

- [ ] **Step 2: 运行确认失败**

Run: `node scripts/characterization/characterize-export-v3-pid.mjs`
Expected: FAIL — `coverage ok` false（当前 `shotIds.has(pid)` 直接检查，ele pid 指向 section 不在 shotIds 中）

- [ ] **Step 3: 实现 resolveRootScreenshotId + 改造 validatePageLevelCoverage**

在 `transaction-export-v3.js` 的 `validatePageLevelCoverage` 之前新增：

```js
/** 沿 propertiesPID 链向上追溯，返回最近的 type=page/dialog 条目的 propertiesID；无则 null。 */
export function resolveRootScreenshotId(prop, propsById) {
  let cur = prop;
  let guard = 0; // 防环
  while (cur && cur.type !== 'page' && cur.type !== 'dialog' && guard < 100) {
    const pid = String(cur.propertiesPID || '0');
    if (pid === '0' || pid === '') return null;
    cur = propsById.get(pid);
    guard += 1;
  }
  return cur ? String(cur.propertiesID) : null;
}
```

改造 `validatePageLevelCoverage`（`:522-562`）：在函数开头构建 `propsById` map，然后把 `shotIds.has(pid)` 检查改为 `resolveRootScreenshotId` 追溯：

```js
export function validatePageLevelCoverage(entry) {
  const props = Array.isArray(entry?.transcationProperties) ? entry.transcationProperties : [];
  const propsById = new Map(props.map(p => [String(p.propertiesID ?? ''), p]));
  const shotIds = new Set(
    props.filter((p) => p.type === 'page' || p.type === 'dialog')
      .map((p) => String(p.propertiesID ?? '')),
  );
  const missing = [];
  const exempt = [];
  const hasRect = (p) => (typeof p.rect === 'string'
    ? p.rect.trim() !== ''
    : !!(p.rect && Object.keys(p.rect).length > 0));
  const isLocatable = (p) => !!(
    String(p.elementType || '').trim()
    || String(p.regionId || '').trim()
    || hasRect(p)
    || String(p.realLabel || '').trim()
  );
  for (const p of props) {
    if (p.type !== 'ele') continue;
    if (!isLocatable(p)) {
      exempt.push({ propertiesID: p.propertiesID || '', propertiesPID: p.propertiesPID || '0', propertiesName: p.propertiesName || '' });
      continue;
    }
    const rootId = resolveRootScreenshotId(p, propsById);
    if (!rootId || !shotIds.has(rootId)) {
      missing.push({ propertiesID: p.propertiesID || '', propertiesPID: p.propertiesPID || '0', propertiesName: p.propertiesName || '', regionId: p.regionId || '' });
    }
  }
  return { ok: missing.length === 0, missing, exempt };
}
```

- [ ] **Step 4: 运行确认通过**

Run: `node scripts/characterization/characterize-export-v3-pid.mjs`
Expected: OK

- [ ] **Step 5: 运行现有 page-level characterization 回归**

Run: `node scripts/characterization/characterize-page-level-screenshot.mjs`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/services/transaction-export-v3.js scripts/characterization/characterize-export-v3-pid.mjs
git commit -m "fix(export-v3): validatePageLevelCoverage traverse PID chain to root screenshot"
```

---

## Task 3: partition-via-pid — partner-platform section type fallback

**Files:**
- Modify: `src/services/partner-platform.js:135-171`（`toPartnerImportPayload`）
- Test: `scripts/characterization/characterize-partner-platform.mjs`（追加断言）

**Interfaces:**
- Consumes: Task 1 的 `type='section'` 节点
- Produces: `PARTNER_SECTION_TYPE` 开关（默认 'section'，fallback 'ele'+elementType='partition'）

- [ ] **Step 1: 写 section type 保留的 failing test**

在 `characterize-partner-platform.mjs` 追加：

```js
import { toPartnerImportPayload } from '../../src/services/partner-platform.js';

// section 节点在 toPartnerImportPayload 后保留，type='section'
const payload = {
  transcationEventTypeList: [{
    transcationProperties: [
      { propertiesID: '1', propertiesPID: '0', type: 'page', screenshot: ['http://x/p.png'], propertiesName: 'page' },
      { propertiesID: '2', propertiesPID: '1', type: 'section', screenshot: [], propertiesName: 'tab1', elementType: '', realLabel: 'tab1' },
      { propertiesID: '3', propertiesPID: '2', type: 'ele', screenshot: [], propertiesName: '保存', elementType: '//xpath', realLabel: '保存' },
    ],
  }],
};
const adapted = toPartnerImportPayload(payload);
const props = adapted.transcationEventTypeList[0].transcationProperties;
const section = props.find(p => p.propertiesID === '2');
check('section retained', !!section);
check('section type=section', section.type === 'section');
check('section no screenshot key', !section.screenshot);
check('section no screenCapture', !section.screenCapture);
```

- [ ] **Step 2: 运行确认**

Run: `node scripts/characterization/characterize-partner-platform.mjs`
Expected: PASS（当前 `toPartnerImportPayload` 只剥 regionId/regionLabel 和 screenshot→screenCapture，section 节点天然保留）——如果 PASS 说明 section 保留逻辑已天然满足，测试是回归保护。

- [ ] **Step 3: 加 PARTNER_SECTION_TYPE fallback 开关**

在 `partner-platform.js` 顶部加配置：

```js
import { PARTNER_SECTION_TYPE } from '../../config/config.js';
// config.js: PARTNER_SECTION_TYPE = process.env.PARTNER_SECTION_TYPE || 'section'
```

在 `toPartnerImportPayload` 的 prop map 逻辑中，section 节点按开关适配：

```js
.map((p) => {
  const out = { ...p };
  // section type fallback：伙伴不接受 'section' 时改用 'ele'+elementType='partition'
  if (out.type === 'section' && PARTNER_SECTION_TYPE !== 'section') {
    out.type = 'ele';
    out.elementType = 'partition';
  }
  for (const k of PARTNER_PROP_DROP_KEYS) delete out[k];
  const shots = Array.isArray(out.screenshot) ? out.screenshot : [];
  if (shots.length) {
    out.screenCapture = shots.filter(Boolean).join(',');
  }
  delete out.screenshot;
  return out;
});
```

- [ ] **Step 4: 在 config.js 加 PARTNER_SECTION_TYPE**

在 `config/config.js` 中加：

```js
export const PARTNER_SECTION_TYPE = process.env.PARTNER_SECTION_TYPE || 'section';
```

- [ ] **Step 5: 运行 characterization 确认通过**

Run: `node scripts/characterization/characterize-partner-platform.mjs`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/services/partner-platform.js config/config.js scripts/characterization/characterize-partner-platform.mjs
git commit -m "feat(partner): PARTNER_SECTION_TYPE fallback switch for section node type"
```

---

## Task 4: partition-via-pid — 工具同步更新（lightup + layer-tree）

**Files:**
- Modify: `scripts/tools/lightup-phase-screenshot.mjs`
- Modify: `scripts/tools/layer-tree-from-properties.mjs`
- Test: 手动验证（用 traj 33/182 dry-run payload 跑工具）

**Interfaces:**
- Consumes: Task 1 的 V3 payload（含 type='section' 节点）
- Produces: 两个工具能渲染 PID 父子树，section 为可折叠容器节点

- [ ] **Step 1: lightup-phase-screenshot.mjs 加 PID 树视图**

在 `--v3`/`--file` 模式下，读 V3 payload 的 `transcationProperties[]`，按 propertiesID/propertiesPID 构建树并在 HTML 侧栏渲染。在 `buildHtml` 函数中（或新增 `buildPidTreeHtml` 辅助函数），从 properties 构建:

```js
function buildPidTreeHtml(properties) {
  const byId = new Map(properties.map(p => [String(p.propertiesID ?? ''), p]));
  const roots = properties.filter(p => String(p.propertiesPID ?? '0') === '0');
  function renderNode(p) {
    const children = properties.filter(c => String(c.propertiesPID ?? '') === String(p.propertiesID));
    const isSection = p.type === 'section';
    const icon = p.type === 'page' ? '📄' : p.type === 'dialog' ? '🪟' : isSection ? '📁' : '🔘';
    const childHtml = children.length ? `<ul>${children.map(renderNode).join('')}</ul>` : '';
    return `<li><span class="tree-node type-${p.type}">${icon} ${esc(p.propertiesName)} <small>(${p.type} #${p.propertiesID})</small></span>${childHtml}</li>`;
  }
  return `<ul class="pid-tree">${roots.map(renderNode).join('')}</ul>`;
}
```

在 HTML 模板中加一个侧栏 `<div id="pid-tree-panel">` 显示该树。section 节点显示为文件夹图标（📁），无画框；ele 节点保留现有画框逻辑。

- [ ] **Step 2: layer-tree-from-properties.mjs 识别 section 节点**

在构建树的逻辑中，识别 `type='section'` 作为非叶子层纳入渲染。当前代码从 regionId 拆层级链——改为优先用 propertiesID/propertiesPID 父子链建树（`--file`/`--v3` 模式下），section 节点作为树的中间层：

```js
// --file/--v3 模式：按 PID 父子链建树（而非只看 regionId 拆段）
function buildTreeFromPid(properties) {
  const byId = new Map(properties.map(p => [String(p.propertiesID ?? ''), p]));
  const roots = properties.filter(p => String(p.propertiesPID ?? '0') === '0');
  function buildNode(p) {
    const children = properties.filter(c => String(c.propertiesPID ?? '') === String(p.propertiesID));
    return {
      id: p.propertiesID, name: p.propertiesName, type: p.type,
      realLabel: p.realLabel, children: children.map(buildNode),
    };
  }
  return roots.map(buildNode);
}
```

- [ ] **Step 3: 手动验证**

Run:
```bash
node scripts/tools/lightup-phase-screenshot.mjs --v3 .v3d.json
node scripts/tools/layer-tree-from-properties.mjs --file .v3d.json
```
打开生成的 HTML，确认 PID 树层级与 region_id 链分段一致、同页同名控件落在不同 section 下、section 无坐标/ele 有坐标。

- [ ] **Step 4: Commit**

```bash
git add scripts/tools/lightup-phase-screenshot.mjs scripts/tools/layer-tree-from-properties.mjs
git commit -m "feat(tools): PID tree view in lightup + section node support in layer-tree"
```

---

## Task 5: budget-extend — compute_budget_extension 纯函数

**Files:**
- Modify: `scripts/controller/actions/phase/reviewer.py`（末尾追加）
- Test: `scripts/characterization/characterize-budget-extend.py`（新建）

**Interfaces:**
- Consumes: 无（纯函数）
- Produces: `compute_budget_extension(pending_state: dict) -> int`

- [ ] **Step 1: 写 failing test**

创建 `scripts/characterization/characterize-budget-extend.py`：

```python
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from controller.actions.phase.reviewer import compute_budget_extension

failures = []
def check(label, cond):
    if not cond: failures.append(label)

# 引入 2 + pending 3 + tree 1 → 2*4+3*2+1+2 = 17
check('basic', compute_budget_extension({
    'introduce_fields': 2, 'pending_fields': 3, 'tree_select_fields': 1,
    'ceiling': 100, 'used_steps': 10,
}) == 17)

# clamp 到 ceiling - used
check('clamp', compute_budget_extension({
    'introduce_fields': 10, 'pending_fields': 10, 'tree_select_fields': 5,
    'ceiling': 30, 'used_steps': 25,
}) == 5)  # raw=10*4+10*2+5+2=67, clamp to 30-25=5

# 全空 → ≤0 不续跑（无引入/无 pending/无 tree → 不加 +2 收尾，直接返回 0）
check('empty', compute_budget_extension({
    'introduce_fields': 0, 'pending_fields': 0, 'tree_select_fields': 0,
    'ceiling': 30, 'used_steps': 10,
}) == 0)

# 预算用尽 → ≤0
check('exhausted', compute_budget_extension({
    'introduce_fields': 5, 'pending_fields': 5, 'tree_select_fields': 0,
    'ceiling': 30, 'used_steps': 30,
}) <= 0)

if failures:
    print('FAIL:', failures); sys.exit(1)
print('OK: compute_budget_extension')
```

- [ ] **Step 2: 运行确认失败**

Run: `D:\anaconda3\envs\browser_use\python.exe scripts/characterization/characterize-budget-extend.py`
Expected: FAIL — `ImportError: cannot import name 'compute_budget_extension'`

- [ ] **Step 3: 实现 compute_budget_extension**

在 `reviewer.py` 末尾追加：

```python
_BUDGET_EXTEND_MAX_ROUNDS = 2

def compute_budget_extension(pending_state: dict) -> int:
    """Compute extension steps for budget-exhausted continuation.

    Cost model: introduce fields ×4 (点旁钮+弹窗检索+选择+回填验证),
    pending fields ×2 (fill/select 直填), tree-select ×1 (额外检索),
    +2 (verify + done 收尾). Clamped to (ceiling - used_steps).
    Returns <=0 when no budget remains.
    """
    try:
        introduce = int(pending_state.get('introduce_fields', 0))
        pending = int(pending_state.get('pending_fields', 0))
        tree_select = int(pending_state.get('tree_select_fields', 0))
        ceiling = int(pending_state.get('ceiling', 0))
        used = int(pending_state.get('used_steps', 0))
    except (TypeError, ValueError):
        return 0
    raw = introduce * 4 + pending * 2 + tree_select * 1 + 2
    remaining = ceiling - used
    # 无工作量时不续跑（+2 收尾仅在有待完成字段时才加）
    if introduce == 0 and pending == 0 and tree_select == 0:
        return 0
    return max(0, min(raw, remaining))
```

- [ ] **Step 4: 运行确认通过**

Run: `D:\anaconda3\envs\browser_use\python.exe scripts/characterization/characterize-budget-extend.py`
Expected: OK

- [ ] **Step 5: Commit**

```bash
git add scripts/controller/actions/phase/reviewer.py scripts/characterization/characterize-budget-extend.py
git commit -m "feat(reviewer): compute_budget_extension pure function for step budget continuation"
```

---

## Task 6: budget-extend — done 检测闭包 flag

**Files:**
- Modify: `scripts/agent_utils.py:399-408`（`make_done_callback`）
- Test: `scripts/characterization/characterize-budget-extend.py`（追加）

**Interfaces:**
- Consumes: `case_data_store` dict（从 `service.py` 传入）
- Produces: `case_data_store['_done_fired']` 在 done 回调触发时设为 True

- [ ] **Step 1: 写 failing test**

在 `characterize-budget-extend.py` 追加：

```python
from agent_utils import make_done_callback

# done callback 设置 _done_fired flag
case_data = {}
cb = make_done_callback(Path('/tmp/test_done.json'), case_data)
# 模拟 done 回调（history_list 有 is_done 方法）
class FakeHistory:
    def __init__(self): self.history = []
    def is_done(self): return True
    def is_successful(self): return True
    def final_result(self): return 'ok'
    def errors(self): return []
    def save_to_file(self, p): pass
cb(FakeHistory())
check('done_fired set', case_data.get('_done_fired') == True)

# 未传入 case_data_store 时不报错（向后兼容）
cb2 = make_done_callback(Path('/tmp/test_done2.json'))
cb2(FakeHistory())  # 不应抛异常
check('backward compat no crash', True)
```

- [ ] **Step 2: 运行确认失败**

Run: `D:\anaconda3\envs\browser_use\python.exe scripts/characterization/characterize-budget-extend.py`
Expected: FAIL — `make_done_callback` 只接受 1 个参数

- [ ] **Step 3: 改造 make_done_callback**

在 `agent_utils.py:399-408` 修改：

```python
def make_done_callback(output_path, case_data_store=None):
    """Create a done callback that saves trajectory and emits JSON event.

    When case_data_store is provided, sets case_data_store['_done_fired'] = True
    so the quality gate can detect whether done() was triggered.
    """
    def on_done(history_list):
        try:
            if case_data_store is not None:
                case_data_store['_done_fired'] = True
            output_path.parent.mkdir(parents=True, exist_ok=True)
            history_list.save_to_file(str(output_path))
            emit_json({"event": "done", "data": {"output_file": str(output_path), "steps": len(history_list.history), "is_done": history_list.is_done(), "is_successful": history_list.is_successful(), "final_result": history_list.final_result(), "errors": history_list.errors()}})
        except:
            pass
    return on_done
```

- [ ] **Step 4: 运行确认通过**

Run: `D:\anaconda3\envs\browser_use\python.exe scripts/characterization/characterize-budget-extend.py`
Expected: OK

- [ ] **Step 5: 更新 service.py 传参**

在 `service.py:448` 把 `make_done_callback(output_path)` 改为 `make_done_callback(output_path, case_data_ref)`。

- [ ] **Step 6: Commit**

```bash
git add scripts/agent_utils.py scripts/agent/service.py scripts/characterization/characterize-budget-extend.py
git commit -m "feat(agent): done callback sets _done_fired flag in case_data_store for budget extend"
```

---

## Task 7: budget-extend — service.py 续跑循环

**Files:**
- Modify: `scripts/agent/service.py:454-512`（run 后质量门区域）
- Test: `scripts/characterization/characterize-budget-extend.py`（追加控制流断言）

**Interfaces:**
- Consumes: Task 5 `compute_budget_extension` + Task 6 `_done_fired` flag
- Produces: 续跑循环（run→门评估→续跑→最终 phase_end + `budgetExtensions` payload）

- [ ] **Step 1: 在 service.py 加引入字段计数函数**

在 `service.py` `_run_agent_step` 函数之前加：

```python
def _count_introduce_fields(case_data_ref):
    """Count introduce-type fields (disabled + hasButton) from _scan_fields."""
    scan_fields = case_data_ref.get('_scan_fields') or []
    return sum(1 for f in scan_fields if f.get('disabled') and f.get('hasButton'))

def _count_tree_select(case_data_ref):
    """Count tree-select fields from _scan_fields."""
    scan_fields = case_data_ref.get('_scan_fields') or []
    return sum(1 for f in scan_fields if f.get('kind') in ('tree-select', 'tree'))
```

- [ ] **Step 2: 改造 run 后质量门为续跑循环**

在 `service.py:454-512` 区域，把现有 `await agent.run(...)` 后的无条件质量门改为续跑循环。替换 `:459` 到 `:509` 的逻辑：

```python
    # budget-extend: 续跑循环
    from ..controller.actions.phase.reviewer import compute_budget_extension, _BUDGET_EXTEND_MAX_ROUNDS
    budget_extensions = []
    try:
        if case_data_ref is not None:
            case_data_ref['_phase_max_steps'] = int(max_steps)
            case_data_ref['_done_fired'] = False
        await agent.run(max_steps=max_steps, on_step_start=on_step_start_hook, on_step_end=on_step_end_hook)
        sys.stderr.write(f"Agent run completed\n");
        sys.stderr.flush()

        # 续跑循环（≤ _BUDGET_EXTEND_MAX_ROUNDS 轮）
        for round_num in range(1, _BUDGET_EXTEND_MAX_ROUNDS + 1):
            if case_data_ref is None:
                break
            done_fired = case_data_ref.get('_done_fired', False)
            # 检查取消
            if cancel_flag_path.exists():
                break
            # 评估续跑条件
            from ..controller.actions._phase_intent import check_pending_write_gate, has_contract_success
            from ..controller.actions.section_scope import resolve_phase_section
            _sec = resolve_phase_section(case_data_ref)
            ok_pending, pending_labels = check_pending_write_gate(case_data_ref, section=_sec)
            introduce_count = _count_introduce_fields(case_data_ref)
            needs_agent = case_data_ref.get('_assistant_needs_agent') or []
            # done 触发且工作完成 → 不续跑
            if done_fired and ok_pending and introduce_count == 0 and not needs_agent:
                break
            # 工作完成（无论 done）→ 不续跑
            if ok_pending and introduce_count == 0 and not needs_agent:
                break
            # 计算 extension
            used = agent.state.n_steps if hasattr(agent, 'state') else max_steps
            extension = compute_budget_extension({
                'introduce_fields': introduce_count,
                'pending_fields': len(pending_labels),
                'tree_select_fields': _count_tree_select(case_data_ref),
                'ceiling': ceiling,
                'used_steps': used,
            })
            if extension <= 0 or used + extension > ceiling:
                break
            sys.stderr.write(
                f"[budget] extend round={round_num} +{extension} steps (introduce={introduce_count} pending={len(pending_labels)})\n"
            )
            sys.stderr.flush()
            budget_extensions.append({
                'round': round_num, 'steps': extension,
                'introduce': introduce_count, 'pending': len(pending_labels),
            })
            case_data_ref['_done_fired'] = False
            await agent.run(max_steps=extension, on_step_start=on_step_start_hook, on_step_end=on_step_end_hook)

        if not hasattr(agent, '_done_fired') and hasattr(agent, 'history'):
            output_path.parent.mkdir(parents=True, exist_ok=True)
            agent.history.save_to_file(str(output_path))
    except asyncio.CancelledError:
        # ... (保持现有)
    except Exception as e:
        # ... (保持现有)

    # Phase-end observability + soft quality gate（循环结束后最终评估）
    try:
        if case_data_ref is not None:
            from ..controller.actions._phase_intent import (
                check_pending_write_gate, emit_phase_observability,
                has_contract_success, mark_quality_failed,
            )
            from ..controller.actions.section_scope import resolve_phase_section
            _sec = resolve_phase_section(case_data_ref)
            ok_pending, labels = check_pending_write_gate(case_data_ref, section=_sec)
            contract = get_phase_intent(case_data_ref)
            if contract and contract.get('refill') == 'all_editable' and not ok_pending:
                mark_quality_failed(case_data_ref, f'pending_fields:{",".join(labels[:8])}')
            submit = (contract or {}).get('submit') or {}
            if submit.get('required') and not has_contract_success(case_data_ref):
                if contract and contract.get('mode') not in ('introduce_pick',):
                    mark_quality_failed(case_data_ref, 'missing_success_token')
            emit_phase_observability(case_data_ref, emit_json)
            phase_payload = {"phase": step_index, "name": task_text[:60]}
            phase_payload["maxActionsPerStep"] = max_actions_per_step
            if budget_extensions:
                phase_payload["budgetExtensions"] = budget_extensions
            c = get_phase_intent(case_data_ref)
            if c:
                phase_payload["phase_intent"] = c
            if case_data_ref.get('_quality_failed'):
                reasons = list(case_data_ref.get('_quality_failed_reasons') or [])
                sys.stderr.write(f"QUALITY FAIL phase={step_index} reasons={reasons}\n")
                sys.stderr.flush()
                phase_payload["quality_failed"] = True
                phase_payload["quality_failed_reasons"] = reasons
            emit_json({"event": "phase_end", "data": phase_payload})
    except Exception as e:
        sys.stderr.write(f"phase_end observability skipped: {e}\n")
        sys.stderr.flush()
```

- [ ] **Step 3: 写续跑闸门 characterization**

在 `characterize-budget-extend.py` 追加闸门测试：

```python
from controller.actions.phase.reviewer import _BUDGET_EXTEND_MAX_ROUNDS

check('max rounds = 2', _BUDGET_EXTEND_MAX_ROUNDS == 2)

# 续跑闸门：轮次限制
# （纯函数层验证；控制流集成在 phase-runtime characterization 覆盖）
check('rounds limit', _BUDGET_EXTEND_MAX_ROUNDS <= 2)
```

- [ ] **Step 4: 运行 characterization 确认通过**

Run: `D:\anaconda3\envs\browser_use\python.exe scripts/characterization/characterize-budget-extend.py`
Expected: OK

- [ ] **Step 5: 运行现有 phase-runtime characterization 回归**

Run: `D:\anaconda3\envs\browser_use\python.exe scripts/characterization/characterize-phase-runtime.py`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add scripts/agent/service.py scripts/characterization/characterize-budget-extend.py
git commit -m "feat(agent): budget-extend continuation loop (max 2 rounds, ceiling-clamped)"
```

---

## Task 8: v3-payload-size ②③ — validateFieldCompleteness + 截断 + preflight

**Files:**
- Modify: `src/services/transaction-export-v3.js`（新增 `validateFieldCompleteness` + 截断逻辑 + stats 扩展）
- Modify: `src/services/partner-platform.js`（新增 `preflightCheck`）
- Modify: `src/routes/v2/export-mgmt.js`（surface merged.stats）
- Test: `scripts/characterization/characterize-export-v3-field-completeness.mjs`（新建）

**Interfaces:**
- Consumes: Task 1-2 的 V3 payload（含 section 节点）
- Produces: `validateFieldCompleteness(entry)` + 截断 + `preflightCheck(wirePayload)` + stats 扩展

- [ ] **Step 1: 写 failing test**

创建 `scripts/characterization/characterize-export-v3-field-completeness.mjs`：

```js
import { validateFieldCompleteness, buildTransactionEntryV3 } from '../../src/services/transaction-export-v3.js';
import { preflightCheck, toPartnerImportPayload } from '../../src/services/partner-platform.js';

const failures = [];
function check(label, cond) { if (!cond) failures.push(label); }

// validateFieldCompleteness: ele 缺 elementType+realLabel → issue
const entry1 = { transcationProperties: [
  { type: 'page', propertiesID: '1', propertiesPID: '0', screenshot: ['url'], propertiesName: 'page' },
  { type: 'ele', propertiesID: '2', propertiesPID: '1', elementType: '', realLabel: '', propertiesName: 'orphan', regionId: 'x', rect: '{"x1":1,"y1":1,"x2":2,"y2":2}' },
]};
const c1 = validateFieldCompleteness(entry1);
check('ele missing elementType+label', c1.missing.some(m => m.issues.includes('missingElementTypeAndLabel')));

// section 节点不报 issue
const entry2 = { transcationProperties: [
  { type: 'page', propertiesID: '1', propertiesPID: '0', screenshot: ['url'], propertiesName: 'page' },
  { type: 'section', propertiesID: '2', propertiesPID: '1', screenshot: [], propertiesName: 'tab1', elementType: '', realLabel: 'tab1' },
  { type: 'ele', propertiesID: '3', propertiesPID: '2', elementType: '//x', realLabel: 'btn', propertiesName: 'btn', regionId: 'x', rect: '' },
]};
const c2 = validateFieldCompleteness(entry2);
check('section no issue', !c2.missing.some(m => m.propertiesID === '2'));

// page 无 screenshot → issue
const entry3 = { transcationProperties: [
  { type: 'page', propertiesID: '1', propertiesPID: '0', screenshot: [], propertiesName: 'page' },
]};
const c3 = validateFieldCompleteness(entry3);
check('page empty screenshot', c3.missing.some(m => m.issues.includes('emptyScreenshot')));

// preflight: undefined 值检测
const wirePayload = toPartnerImportPayload({
  transcationEventTypeList: [{
    transcationProperties: [
      { type: 'page', propertiesID: '1', propertiesPID: '0', screenCapture: 'http://x/p.png', propertiesName: 'page', elementType: undefined },
    ],
  }],
});
const pf = preflightCheck(wirePayload);
check('preflight undefined detected', pf.issues.some(i => i.issue === 'undefinedValue'));

if (failures.length) { console.error('FAIL:', failures); process.exit(1); }
console.log('OK: field completeness + preflight');
```

- [ ] **Step 2: 运行确认失败**

Run: `node scripts/characterization/characterize-export-v3-field-completeness.mjs`
Expected: FAIL — `validateFieldCompleteness` 和 `preflightCheck` 不存在

- [ ] **Step 3: 实现 validateFieldCompleteness**

在 `transaction-export-v3.js` 的 `validatePageLevelCoverage` 之后追加：

```js
/**
 * 字段完整性校验：统计缺失字段，不阻断推送。
 * section 节点无 elementType/screenshot 是正常的，不报 issue。
 * @returns {{ ok: boolean, missing: Array }}
 */
export function validateFieldCompleteness(entry) {
  const props = Array.isArray(entry?.transcationProperties) ? entry.transcationProperties : [];
  const missing = [];
  for (const p of props) {
    const issues = [];
    if (p.type === 'ele') {
      if (!String(p.elementType || '').trim() && !String(p.realLabel || '').trim())
        issues.push('missingElementTypeAndLabel');
      if (String(p.propertiesPID || '0') === '0')
        issues.push('orphanPid');
    }
    if (p.type === 'page' || p.type === 'dialog') {
      const shots = Array.isArray(p.screenshot) ? p.screenshot : [];
      if (shots.length === 0) issues.push('emptyScreenshot');
    }
    if (!String(p.propertiesName || '').trim()) issues.push('emptyName');
    if (issues.length) missing.push({ propertiesID: p.propertiesID || '', type: p.type || '', issues });
  }
  return { ok: missing.length === 0, missing };
}
```

- [ ] **Step 4: 实现超长截断**

在 `transaction-export-v3.js` 中新增截断函数，在 `buildV3Properties` 的 ele 节点构建时、`uniquifyPropertiesNames` 之前应用：

```js
const FIELD_LENGTH_LIMITS = Object.freeze({
  elementType: 2000,
  options: 4000,
  objectValue: 500,
  propertiesName: 100,
});
const truncatedSuffix = '...truncated';

function truncateFieldValue(field, value) {
  const limit = FIELD_LENGTH_LIMITS[field];
  if (!limit || typeof value !== 'string') return { value, truncated: false };
  if (value.length <= limit) return { value, truncated: false };
  return { value: value.slice(0, limit - truncatedSuffix.length) + truncatedSuffix, truncated: true };
}
```

在 `buildTransactionEntryV3` 合并后、`uniquifyPropertiesNames` 之前，对每个 prop 截断：

```js
const truncatedCounts = { elementType: 0, options: 0, objectValue: 0, propertiesName: 0 };
for (const p of properties) {
  for (const field of Object.keys(FIELD_LENGTH_LIMITS)) {
    if (p[field] != null) {
      const { value, truncated } = truncateFieldValue(field, String(p[field]));
      if (truncated) truncatedCounts[field] += 1;
      p[field] = value;
    }
  }
}
```

- [ ] **Step 5: 实现 preflightCheck**

在 `partner-platform.js` 追加：

```js
/**
 * 推送前自检：检查 wire payload 的信息丢失风险（只统计不阻断）。
 * - undefined 值检测（JSON.stringify 静默丢弃 undefined key）
 * - page/dialog 无 screenCapture
 */
export function preflightCheck(wirePayload) {
  const list = wirePayload?.transcationEventTypeList || [];
  const issues = [];
  for (const entry of list) {
    for (const p of entry.transcationProperties || []) {
      for (const [k, v] of Object.entries(p)) {
        if (v === undefined) issues.push({ id: p.propertiesID, field: k, issue: 'undefinedValue' });
      }
      if ((p.type === 'page' || p.type === 'dialog') && !p.screenCapture)
        issues.push({ id: p.propertiesID, issue: 'emptyScreenCapture' });
    }
  }
  return { ok: issues.length === 0, issues };
}
```

在 `pushImportDemand`（`:289-312`）的 `toPartnerImportPayload` 之后调用：

```js
const wirePayload = toPartnerImportPayload(payload);
const preflight = preflightCheck(wirePayload);
if (!preflight.ok) {
  sys.stderr.write(`[preflight] ${preflight.issues.length} issues found (non-blocking)\n`);
  // non-blocking: continue to push
}
```

（注意：`partner-platform.js` 是 Node ESM，没有 `sys.stderr`——用 `process.stderr.write` 或 `console.error`）

- [ ] **Step 6: stats 扩展**

在 `buildTransactionEntryV3` 的 return stats 中追加：

```js
const completeness = validateFieldCompleteness(entry);
// ... 在 stats 对象中追加：
fieldCompletenessIssues: completeness.missing.length,
truncatedFields: truncatedCounts,
```

在 `wrapTransactionListV3` 中聚合 `fieldCompletenessIssues` 和 `truncatedFields`。

- [ ] **Step 7: surface merged.stats 到 batch 响应**

在 `export-mgmt.js:681-689` 的 batch 响应中追加 `merged.stats`：

```js
res.json({ ok: true, pushed: true, items, stats: merged.stats, skipped: merged.skipped });
```

- [ ] **Step 8: 运行 characterization 确认通过**

Run: `node scripts/characterization/characterize-export-v3-field-completeness.mjs`
Expected: OK

- [ ] **Step 9: Commit**

```bash
git add src/services/transaction-export-v3.js src/services/partner-platform.js src/routes/v2/export-mgmt.js scripts/characterization/characterize-export-v3-field-completeness.mjs
git commit -m "feat(export-v3): field completeness validation + truncation + pre-push preflight (non-blocking)"
```

---

## Task 9: 注册 characterization + verify-all + api-docs + CHANGELOG

**Files:**
- Modify: `scripts/refactor/verify-all.sh`
- Modify: `src/dashboard/api-docs/groups/export-mgmt.js`
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: Task 1-8 的新 characterization 文件
- Produces: verify-all ALL GREEN + api-docs + CHANGELOG 更新

- [ ] **Step 1: 注册新 characterization 到 verify-all.sh**

在 `verify-all.sh:101`（`characterize-batch-actions` 行之后）追加：

```bash
run "characterize-export-v3-pid" node scripts/characterization/characterize-export-v3-pid.mjs
run "characterize-budget-extend" "$PY" scripts/characterization/characterize-budget-extend.py
run "characterize-export-v3-field-completeness" node scripts/characterization/characterize-export-v3-field-completeness.mjs
```

- [ ] **Step 2: 更新 api-docs**

在 `src/dashboard/api-docs/groups/export-mgmt.js` 的 V3 契约说明中（`:218-226` 附近），type 值列表追加 `'section'`：

```js
// type: 'page' | 'dialog' | 'section' | 'ele'
// section: 分区容器节点（propertiesID/propertiesPID 表达分区父子层级，无截图/坐标/action）
```

- [ ] **Step 3: 更新 CHANGELOG**

在 `CHANGELOG.md` [Unreleased] Changed 追加 3 条：

```markdown
- 2026-08-24: **V3 分区数据改用 propertiesID/propertiesPID 父子树表达**：构建期插入 `type='section'` 中间节点...（详述）
- 2026-08-24: **阶段步数预算耗尽续跑（budget-extend）**：run 后质量门改为续跑循环...（详述）
- 2026-08-24: **V3 字段完整性校验 + 超长截断 + 推送前自检**：`validateFieldCompleteness`（只统计不阻断）...（详述）
```

- [ ] **Step 4: 运行 verify-all**

Run: `bash scripts/refactor/verify-all.sh`
Expected: ALL GREEN

- [ ] **Step 5: Commit**

```bash
git add scripts/refactor/verify-all.sh src/dashboard/api-docs/groups/export-mgmt.js CHANGELOG.md
git commit -m "chore: register new characterizations + api-docs + CHANGELOG for week sprint"
```

---

## Task 10: 湿测验证

**Files:** 无代码改动

- [ ] **Step 1: partition-via-pid 湿测**

用 traj 33 或 182 dry-run 生成 V3 payload，推送伙伴平台（172.20.101.63:11002）：
- 伙伴返回 200 → section 方案确立
- 伙伴返回 400 → 设 `PARTNER_SECTION_TYPE=ele`，重推验证 fallback

用 lightup-phase-screenshot.mjs 和 layer-tree-from-properties.mjs 跑 payload，人工检查 PID 树层级。

- [ ] **Step 2: budget-extend 湿测**

重录 traj 33 P2（引入 刘伟/刘玲）：
- 预算耗尽后检测到引入字段未完 → stderr `[budget] extend round=1 +N steps` → 续跑 → 引入完成 → done(success=True)
- 或续跑 2 轮后仍失败且 QUALITY FAIL 落库（可接受下限）

- [ ] **Step 3: 确认全部交付**

- verify-all ALL GREEN
- CHANGELOG 已记
- todo-list 状态更新
