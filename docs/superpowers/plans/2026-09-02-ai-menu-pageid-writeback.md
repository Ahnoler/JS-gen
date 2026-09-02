# AI/JSON 菜单落地 pageId（场景编号回退）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 录制 prepare 从天元弹窗取落地 pageId（单码组件编号优先，否则场景编号 FS…），仅对 `source∈{json_import,ai}` 的功能节点回写 `pd_cmpt_ecd`；确认推送已含 `source=ai` 菜单。

**Architecture:** 扩展 `JS_READ_PAGE_COMPONENT_CODE` 解析 `scenarioCode` 并收紧 `componentCode` 为整行单码；`recording-page-bind.js` 用 `componentCode || scenarioCode` 作为 landing，查功能节点 `source` 白名单后再 `writeBackFunctionLandingPage`；`_replay.py` 已整对象透传 `pageCode`，通常无需改逻辑。推送侧过滤已全量，只补特征化 pin（可选）。

**Tech Stack:** Node ESM（`recording-page-bind.js`）、Playwright `page.evaluate` JS 字符串（`page_id.py`）、characterization `readFileSync` 断言。

## Global Constraints

- 组件编号有效：整行匹配 `^[A-Za-z0-9]+$`；长文案/多括号 → 空
- 场景编号：仅弹窗「场景编号：」行，形如 `FS…`；不用 URL `fcnScnEcd`
- 回写菜单：仅 type=3 且 `source ∈ {json_import, ai}`；AILZ 不回写
- 不阻断 prepare：异常吞掉 warn
- 不改伙伴 importData 契约；不改扫描写 pageId

## File map

| 文件 | 职责 |
|------|------|
| `scripts/controller/actions/js_snippets/page_id.py` | 天元弹窗解析：componentCode / scenarioCode |
| `scripts/controller/actions/_replay.py` | 直派透传 pageCode（确认即可） |
| `src/services/trajectory/recording-page-bind.js` | landing 优先级 + source 白名单回写 |
| `scripts/characterization/characterize-page-bind.mjs` | wiring / 契约 pin |
| `scripts/characterization/characterize-menu-push.mjs` | （可选）pin menus 含 source=ai |
| `CHANGELOG.md` | Unreleased |

---

### Task 1: 天元 JS 解析 — 单码组件编号 + 场景编号

**Files:**
- Modify: `scripts/controller/actions/js_snippets/page_id.py`（`JS_READ_PAGE_COMPONENT_CODE`）
- Modify: `scripts/characterization/characterize-page-bind.mjs`（`testWiringPageIdPy`）
- Test: `node scripts/characterization/characterize-page-bind.mjs`

**Interfaces:**
- Consumes: 现有弹窗等待 / `页面路径` 与路由对齐逻辑
- Produces: evaluate 返回 `{ componentCode, scenarioCode, pageName, pagePath, activityName, reason, diag? }`；`_replay` 仍 `{'pageCode': payload}`

- [ ] **Step 1: 写失败特征化（pin 新字段与单码规则）**

在 `testWiringPageIdPy` 追加：

```js
function testWiringPageIdPy() {
  const py = readFileSync(join(root, 'scripts/controller/actions/js_snippets/page_id.py'), 'utf8');
  assert.match(py, /JS_READ_PAGE_COMPONENT_CODE/, 'page_id.py defines JS_READ_PAGE_COMPONENT_CODE');
  assert.match(py, /scenarioCode/, 'returns scenarioCode');
  assert.match(py, /场景编号/, 'parses 场景编号 label');
  assert.match(py, /\^\[A-Za-z0-9\]\+\$/, 'componentCode gated on whole-line single token');
  // 仅有场景编号的页面：等待条件不能只认「组件编号：」
  assert.match(py, /场景编号：/, 'wait/parse path includes 场景编号');
}
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node scripts/characterization/characterize-page-bind.mjs`  
Expected: FAIL — `scenarioCode` / 单码门禁未出现

- [ ] **Step 3: 改 `JS_READ_PAGE_COMPONENT_CODE`**

要点（在现有 IIFE 内改，保持 `JS_POLL_UTIL` / 关弹窗逻辑）：

1. **等待条件**：dialog 文本含 `组件编号：` **或** `场景编号：`，且「页面路径」仍与 `currentRoute` 一致（把 `indexOf('组件编号：')` 改为二者之一）。
2. **组件编号**：先抽「组件编号：」后到下一标签（`场景编号：|任务名称：|任务编号：|页面名称：|页面路径：|活动名称：|$`）的整段并 `trim`；仅当 `/^[A-Za-z0-9]+$/.test(raw)` 时 `componentCode = raw`，否则 `''`。
3. **场景编号**：`text.match(/场景编号：\\s*([A-Za-z0-9]+)/)` → `scenarioCode`（无则 `''`）。
4. **返回**增加 `scenarioCode`；`reason: 'ok'` 路径不变。

参考替换片段（解析段）：

```javascript
    // componentCode: whole line after label must be a single token
    const compRawMatch = text.match(/组件编号：\\s*([^\\n]+?)(?=场景编号：|任务名称：|任务编号：|页面名称：|页面路径：|活动名称：|$)/);
    const compRaw = compRawMatch ? compRawMatch[1].trim() : '';
    const componentCode = /^[A-Za-z0-9]+$/.test(compRaw) ? compRaw : '';

    const scenMatch = text.match(/场景编号：\\s*([A-Za-z0-9]+)/);
    const scenarioCode = scenMatch ? scenMatch[1] : '';

    // ... pageName / pagePath / activityName 保持；返回加 scenarioCode
    return { componentCode: componentCode, scenarioCode: scenarioCode, pageName: pageName, pagePath: pagePath, activityName: activityName, reason: 'ok' };
```

同步：`no-trigger` / timeout 返回对象也加 `scenarioCode: ''`，避免调用方缺字段。

- [ ] **Step 4: 确认 `_replay.py` 透传**

`_direct_read_page_component_code` 已 `return 'ok', {'pageCode': payload}` —— **不要剥字段**。可选：stderr 日志加 `scenario=`。

Run: `node scripts/characterization/characterize-page-bind.mjs`  
Expected: Task1 相关 wiring PASS（bind 侧旧断言可能仍 FAIL，Task2 处理）

- [ ] **Step 5: Commit**

```bash
git add scripts/controller/actions/js_snippets/page_id.py scripts/controller/actions/_replay.py scripts/characterization/characterize-page-bind.mjs
git commit -m "feat(page-id): parse scenario code; require whole-line component code"
```

---

### Task 2: page-bind — landing 回退 + source 白名单回写

**Files:**
- Modify: `src/services/trajectory/recording-page-bind.js`
- Modify: `scripts/characterization/characterize-page-bind.mjs`
- Modify: `CHANGELOG.md`
- Test: `node scripts/characterization/characterize-page-bind.mjs`

**Interfaces:**
- Consumes: `row.pageCode.componentCode` / `row.pageCode.scenarioCode`；`systemDao.getById(fid)` → `.source`
- Produces: `bindRecordingPageId` 行为不变签名；`source='read'` 当 landing 来自组件或场景；回写仅白名单

- [ ] **Step 1: 更新特征化（替换旧「仅 source===read」门禁表述）**

改 `testWiringService` / `testWiringWriteBackOnlyOnRead`：

```js
function testWiringService() {
  const service = readFileSync(join(root, 'src/services/trajectory/recording-page-bind.js'), 'utf8');
  assert.match(service, /runReplayActions/, 'service routes read_page_component_code replay through runReplayActions');
  assert.match(service, /read_page_component_code/, 'service references read_page_component_code');
  assert.match(service, /AILZ/, 'service references AILZ prefix');
  assert.match(service, /updateMeta/, 'service references updateMeta');
  assert.match(service, /writeBackFunctionLandingPage/, 'service defines write-back helper');
  assert.match(service, /scenarioCode/, 'reads scenarioCode from pageCode payload');
  assert.match(service, /json_import/, 'write-back whitelist includes json_import');
  assert.match(service, /['"]ai['"]/, 'write-back whitelist includes ai');
  assert.match(service, /replaceForNode/, 'write-back replaces system_page via replaceForNode');
  assert.match(service, /pdCmptEcd/, 'write-back updates system.pdCmptEcd');
}

function testWiringWriteBackOnlyOnRead() {
  const service = readFileSync(join(root, 'src/services/trajectory/recording-page-bind.js'), 'utf8');
  const earlyIdx = service.indexOf('no functionId, generated pageId');
  assert.ok(earlyIdx > 0, 'early AILZ log present');
  const earlyReturnIdx = service.indexOf('return { pageId, source, persisted }', earlyIdx);
  assert.ok(earlyReturnIdx > earlyIdx, 'early return present');
  const earlyBlock = service.slice(earlyIdx, earlyReturnIdx);
  assert.ok(!earlyBlock.includes('writeBackFunctionLandingPage'), 'AILZ early path does not write back menu');
  assert.match(service, /source = 'generated'/, 'generated source still assigned');
  // AILZ / generated 路径不得因白名单误回写：生成分支后回写调用须仍要求非 generated
  assert.match(service, /source === ['"]read['"]/, 'write-back still requires bind source=read (landing from dialog)');
}
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node scripts/characterization/characterize-page-bind.mjs`  
Expected: FAIL — 缺 `scenarioCode` / whitelist cues

- [ ] **Step 3: 改 `bindRecordingPageId`**

在读 `pageCode` 后：

```js
      const payload = row?.pageCode && typeof row.pageCode === 'object' ? row.pageCode : {};
      if (row) {
        componentCode = String(payload.componentCode || '').trim();
        scenarioCode = String(payload.scenarioCode || '').trim();
        pageName = String(payload.pageName || '').trim();
        pagePath = String(payload.pagePath || '').trim();
      }
// ...
    pageId = String(componentCode || scenarioCode || '').trim();
    if (!pageId) {
      pageId = generatePageId();
      source = 'generated';
    } else {
      source = 'read';
    }
```

回写块改为：

```js
    if (source === 'read' && pageId) {
      try {
        const fnNode = await systemDao.getById(fid);
        const menuSource = String(fnNode?.source || '').trim();
        if (menuSource === 'json_import' || menuSource === 'ai') {
          await writeBackFunctionLandingPage(fid, {
            pageId,
            pageName,
            resPath: pagePath,
          });
        } else {
          console.log('[page-bind] skip menu write-back: function#%s source=%s', fid, menuSource || '(empty)');
        }
      } catch (wbErr) {
        console.warn('[page-bind] write-back gate failed function#%s: %s', fid, wbErr?.message || wbErr);
      }
    }
```

文件头注释同步：优先级与白名单。

- [ ] **Step 4: CHANGELOG**

`CHANGELOG.md` `[Unreleased]` → `### Added` 顶部：

```markdown
- 2026-09-02: **录制 prepare 落地 pageId：场景编号回退 + 菜单来源白名单回写**：天元弹窗组件编号仅整行单码有效，否则用场景编号（FS…）；回写 `pd_cmpt_ecd` 仅当功能节点 `source` 为 `json_import` 或 `ai`；AILZ 仍不回写菜单。影响：`page_id.py`、`recording-page-bind.js`、characterize-page-bind。
```

- [ ] **Step 5: 跑全套特征化**

Run:

```bash
node scripts/characterization/characterize-page-bind.mjs
node scripts/characterization/characterize-menu-push.mjs
```

Expected: 全部 OK

- [ ] **Step 6: Commit**

```bash
git add src/services/trajectory/recording-page-bind.js scripts/characterization/characterize-page-bind.mjs CHANGELOG.md
git commit -m "feat(page-bind): scenario fallback landing + json_import/ai write-back gate"
```

---

### Task 3: 推送侧确认（可选 pin）+ 终验

**Files:**
- Modify（可选）: `scripts/characterization/characterize-menu-push.mjs`
- Test: `node scripts/characterization/characterize-menu-push.mjs`

**Interfaces:**
- Consumes: 现有 `buildMenuPushPayload`（已不按 source 过滤）
- Produces: 特征化证明 `source=ai` 进入 menus

- [ ] **Step 1: 在 payload shape 测试中加一条 ai 节点**

```js
  const nodes = [
    { id: 10, type: 2, name: '客户管理', umlEcd: 'UML00092041', parentId: 1, pdCmptEcd: '', source: 'json_import', menuXpath: "//li[@data-id='RES1']", unmatchedFlag: 0, removedFlag: 0, sortOrder: 1 },
    { id: 11, type: 3, name: '对公客户管理', umlEcd: 'UML00005556', parentId: 10, pdCmptEcd: 'ZJJK00066153', source: 'json_import', menuXpath: "//li[@data-id='RES101']", unmatchedFlag: 0, removedFlag: 0, sortOrder: 1 },
    { id: 12, type: 3, name: '工作台入口', umlEcd: '', parentId: 10, pdCmptEcd: 'FS00005518', source: 'ai', menuXpath: "//li[@data-id='RES999']", unmatchedFlag: 0, removedFlag: 0, sortOrder: 2 },
  ];
  // ...
  const ai = payload.menus.find((m) => m.name === '工作台入口');
  assert.equal(ai.source, 'ai');
  assert.equal(ai.pageId, 'FS00005518');
```

- [ ] **Step 2: 跑测试**

Run: `node scripts/characterization/characterize-menu-push.mjs`  
Expected: OK（现实现应已通过；若失败说明误加了 source 过滤，去掉过滤）

- [ ] **Step 3: Commit（若有改动）**

```bash
git add scripts/characterization/characterize-menu-push.mjs
git commit -m "test: pin menu-push includes source=ai with pageId"
```

---

## Spec coverage checklist

| Spec 要求 | Task |
|-----------|------|
| 推送含 ai（不按 source 过滤） | Task 3（确认 + pin） |
| 组件编号整行单码 | Task 1 |
| 场景编号 FS 回退 | Task 1 + Task 2 |
| 回写仅 json_import / ai | Task 2 |
| AILZ 不回写菜单 | Task 2（保留既有 early / generated 门） |
| 不改扫描 / 伙伴契约 / URL 兜底 | 各 Task 非目标，不实现 |

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-09-02-ai-menu-pageid-writeback.md`. Two execution options:

**1. Subagent-Driven (recommended)** — 每任务一个新 subagent，任务间审查，迭代快

**2. Inline Execution** — 本会话按 executing-plans 批量执行并设检查点

Which approach?
