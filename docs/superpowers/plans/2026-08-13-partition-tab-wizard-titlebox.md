# Partition Compose (tab / wizard / titlebox) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Each L2 control’s L1 key is a composed path of content chrome (active tab or current wizard step) + collapse + nearest titlebox, instead of returning on the first matching container.

**Architecture:** Keep overlay / table / todo-item / shell short-circuits. Remove the collapse early-return. After shell, `composeContentRegion(el)` reads chrome + collapse (strip trailing action words) + nearest titlebox in the same collapse (else same chrome pane). Join non-empty segments into `region_label` (` / `) and `region_id` (`|`). Stamp `region_chrome` / `region_section` / `region_block` for PR-LAYER. Collision refine must merge titlebox into that path, never replace the path with titlebox-only. `display_group` stays `region_label`; uniquify only when the full path + control label still collide.

**Tech Stack:** `PAGE_LOCATOR_HELPERS` in `src/cdp/page-locator-helpers.js` (CDP `Runtime.evaluate` / Playwright `page.evaluate`), regenerate `scripts/controller/actions/js_snippets/_locator_helpers_js.py` via `node scripts/_gen_locator_helpers_py.mjs`, `src/cdp/display-group.js`, `src/cdp/resolve-by-label.js`, `src/models/element.js`, Node characterization + Playwright chromium fixtures.

**Spec:** `docs/superpowers/specs/2026-08-13-partition-tab-wizard-titlebox-design.md`

## Global Constraints

- Overlay / table / `.todo-item` / shell-aside / shell-header still short-circuit **before** compose.
- Tables stay global `region_id: table` this cut.
- Homepage custom `.tab-item` / `.msg-card-item` out of scope.
- Content tabs must ignore `.tags-view-container` / `header` / `.el-header` / `.navbar` (do not treat 顶栏「对公客户管理」as content chrome).
- Wizard steps are often **siblings** of the pane, not ancestors — `el.closest('.el-steps')` is not enough; walk ancestors for `:scope > .el-steps`.
- Wizard current-step: prefer `is-process` / `process`; else first step after last `is-finish`/`is-success`; else first visible step title. Do not match only one skin class.
- Collapse header: strip trailing 新增/修改/查看/删除/保存 / `+ 新增`. Titlebox: reuse `isActionOnlyTitle`, `titleboxTitleText`, `pickNearestTitlebox`; reject empty, action-only, title===control text.
- Fail-soft: skip missing segments; all empty → today’s `main`/`other`; never throw; never drop L2.
- Collision refine: do **not** assign `it.region = finer` (titlebox-only). Merge block into the composed path; if `region_id` already has `titlebox:`, no-op. Remaining collisions → existing `uniquifyDisplayGroups` (`#n` / 主键).
- Do not change xpath recipes (`xpath_smart` / `titleboxAnchorXPath` leaf behavior). Do not backfill old `trajectory_step`. Do not change Vue grouping. No L1c LLM. No PR-LAYER tree UI.
- `PAGE_LOCATOR_HELPERS` lives in a JS template literal — regex backslashes stay doubled (`\\s`, `\\b`) like the rest of that file.
- After any edit to `page-locator-helpers.js`: `node scripts/_gen_locator_helpers_py.mjs` (never hand-edit `_locator_helpers_js.py`).
- Characterization scripts pin substrings; keep `SHARED_ASSIGN_REGION`, `function assignRegion`, `function regionLabelOf`, `SHARED_COLLISION_REFINE`, and `buildFeatureCard` **before** `isActionOnlyTitle`.
- `src/` changes need `CHANGELOG.md` `[Unreleased]` with Python 同步提示: no schema; `display_group` / `region_label` may contain ` / `.
- 9242 wet is **manual**, not CI.
- **Commit only when the user explicitly asks.** Skip every Commit step until then.

## File map

| File | Role |
|------|------|
| `src/cdp/page-locator-helpers.js` | Compose helpers + `assignRegion` reorder; `regionLabelOf` +tab/wizard; `refineCollidingRegions` merge; `buildLocatorSnap` extra fields |
| `scripts/controller/actions/js_snippets/_locator_helpers_js.py` | Generated mirror |
| `src/cdp/display-group.js` | Add `tab` / `wizard` to `TAXONOMY_ROLES` so bare tokens are not picker titles |
| `src/cdp/resolve-by-label.js` | Pass `region_chrome` / `region_section` / `region_block` through snap → preview/element |
| `src/models/element.js` | `copyLocatorMeta` copies the three structured fields into persisted `element_json` |
| `src/services/trajectory/trajectory-record-lifecycle.js` | `patchRegionFields`: when `keepPrevLabel`, do not strip structured fields |
| `scripts/characterization/characterize-partition-compose.mjs` | Playwright fixtures (spec 验收) |
| `scripts/characterization/characterize-resolve-collision-titlebox.mjs` | Refine must not replace path with titlebox-only |
| `scripts/characterization/characterize-l1c-region-classify.mjs` | `displayGroupOf` keeps a ` / ` Chinese path; taxonomy includes tab/wizard |
| `CHANGELOG.md` | `[Unreleased]` |
| `src/dashboard/api-docs/groups/recording.js` | One sentence: `display_group` may be a ` / ` path |
| Spec + `docs/superpowers/todo-list.md` | Status → Implemented when green |

```text
el
  → overlay / table / todo-item / shell-*     (unchanged return)
  → composeContentRegion:
       chrome  = nearest content .el-tabs active item
                 OR nearest page .el-steps current step (sibling-aware)
       section = .el-collapse-item header, stripActionTail
       block   = pickNearestTitlebox in collapse else chrome pane
  → finishCompose → region_id / region_label / region_role
                 + region_chrome / region_section / region_block
  → else main / other
```

**Locked helper names** (later tasks consume these exact names):

- `isShellChromeNode(node) → boolean`
- `nearestContentTabs(el) → Element|null`
- `activeTabLabel(tabs) → string`
- `nearestPageSteps(el) → Element|null`
- `stepTitle(step) → string`
- `currentStepLabel(steps) → string`
- `readChrome(el) → { role: 'tab'|'wizard', label: string }|null`
- `stripActionTail(title) → string`
- `collapseSectionTitle(el) → string`
- `composeTitleboxTitle(el, scope) → string`
- `finishCompose(chrome, section, block) → object|null`
- `composeContentRegion(el) → object|null`
- `mergeTitleboxIntoRegion(region, finer) → object`

`finishCompose` return shape when at least one segment is non-empty:

```javascript
{
  region_role: 'section' | 'wizard' | 'tab',
  region_id: 'tab:…|section:…|titlebox:…',   // present segments only, joined with |
  region_label: 'A / B / C',                 // present segments only, joined with ' / '
  region_chrome: { role: 'tab'|'wizard', label: string },  // omitted if no chrome
  region_section: string,                    // omitted if empty
  region_block: string,                      // omitted if empty
}
```

`region_role`: `section` if collapse or titlebox present; else `wizard` if only wizard chrome; else `tab` if only tab chrome.

---

### Task 0: Baseline green

**Files:**
- Verify only

**Interfaces:**
- Consumes: N/A
- Produces: Confirmed current collapse-first / titlebox-replace behavior before edits

- [ ] **Step 1: Run related characterization**

```powershell
cd d:\dev\JS-gen
node scripts/characterization/characterize-resolve-collision-titlebox.mjs
node scripts/characterization/characterize-resolve-ambiguous-region.mjs
node scripts/characterization/characterize-l1c-region-classify.mjs
python scripts/characterization/characterize-unify-partition-locator.py
python scripts/characterization/characterize-todo-item-action.py
python scripts/characterization/characterize-scan-assign-region-once.py
```

Expected: each prints an `ok` / `OK` last line. If red, fix only blockers before Task 1.

- [ ] **Step 2: Commit** — skip unless the user asked.

---

### Task 1: Failing Playwright characterization

**Files:**
- Create: `scripts/characterization/characterize-partition-compose.mjs`

**Interfaces:**
- Consumes: `PAGE_LOCATOR_HELPERS` / `assignRegion(el)` (today: collapse-first, no tab/wizard compose)
- Produces: CI fixture covering spec 验收; implementer in Task 2 must make these asserts pass

- [ ] **Step 1: Write the failing char**

Create `scripts/characterization/characterize-partition-compose.mjs`:

```javascript
/**
 * Partition compose: tab + wizard + collapse + titlebox.
 *   node scripts/characterization/characterize-partition-compose.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { PAGE_LOCATOR_HELPERS } from '../../src/cdp/page-locator-helpers.js';
import { displayGroupOf } from '../../src/cdp/display-group.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
function ok(n) { console.log(`ok: ${n}`); }

const helpersSrc = readFileSync(join(root, 'src/cdp/page-locator-helpers.js'), 'utf8');

{
  assert.match(helpersSrc, /function composeContentRegion\s*\(/);
  assert.match(helpersSrc, /function nearestPageSteps\s*\(/);
  assert.match(helpersSrc, /function stripActionTail\s*\(/);
  assert.match(helpersSrc, /function finishCompose\s*\(/);
  assert.match(helpersSrc, /function mergeTitleboxIntoRegion\s*\(/);
  assert.match(helpersSrc, /tags-view-container/);
  ok('helpers: compose API cues');
}

{
  assert.equal(
    displayGroupOf({
      region_label: '客户基本信息 / 对公客户概况 / 法定代表人/负责人信息',
      region_id: 'tab:客户基本信息|section:对公客户概况|titlebox:法定代表人/负责人信息',
    }),
    '客户基本信息 / 对公客户概况 / 法定代表人/负责人信息',
  );
  ok('display_group keeps composed Chinese path');
}

const FIXTURE = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>partition compose</title>
<style>
  .el-tabs__item, .el-step, .el-collapse-item__header, span.title, .field, button {
    display: block; padding: 4px 8px;
  }
  .titlebox { margin: 16px 0; min-height: 24px; }
  .el-tab-pane, .el-main, .el-collapse-item { min-height: 40px; }
  header, .tags-view-container { min-height: 20px; }
</style></head><body>
<header>
  <div class="tags-view-container">
    <div class="el-tabs">
      <div class="el-tabs__item is-active">对公客户管理</div>
    </div>
  </div>
</header>
<div id="corp" class="el-tabs">
  <div class="el-tabs__header">
    <div class="el-tabs__item is-active">客户基本信息</div>
    <div class="el-tabs__item">客户综合信息</div>
  </div>
  <div class="el-tab-pane">
    <div class="el-collapse-item">
      <div class="el-collapse-item__header">对公客户概况</div>
      <div class="el-collapse-item__wrap">
        <div class="titlebox"><span class="title">基本信息</span>
          <input id="corp-basic" class="field" value="x" />
        </div>
        <div class="titlebox"><span class="title">法定代表人/负责人信息</span>
          <input id="corp-legal" class="field" value="y" />
        </div>
        <div class="titlebox"><span class="title">实际控制人</span>
          <input id="corp-actual" class="field" value="z" />
        </div>
      </div>
    </div>
  </div>
</div>
<div id="ops" class="el-collapse-item">
  <div class="el-collapse-item__header">经营情况 保存</div>
  <div class="el-collapse-item__wrap">
    <button id="ops-save">保存</button>
  </div>
</div>
<div id="wizard-page">
  <div class="el-steps">
    <div class="el-step is-horizontal is-finish"><div class="el-step__title">基本信息</div></div>
    <div class="el-step is-horizontal"><div class="el-step__title">影像资料</div></div>
    <div class="el-step is-horizontal is-wait"><div class="el-step__title">风险阻断</div></div>
  </div>
  <main class="el-main">
    <button id="img-upload">上传</button>
  </main>
</div>
<div id="wizard-process">
  <div class="el-steps">
    <div class="el-step is-horizontal is-finish"><div class="el-step__title">基本信息</div></div>
    <div class="el-step is-horizontal is-process"><div class="el-step__title">影像资料</div></div>
  </div>
  <main class="el-main"><button id="img-process">下一步</button></main>
</div>
<div id="no-chrome" class="el-collapse-item">
  <div class="el-collapse-item__header">评级基本情况</div>
  <div class="titlebox"><span class="title">基本信息</span>
    <input id="rate-basic" class="field" />
  </div>
</div>
<table class="el-table" id="tbl"><tbody><tr><td><button id="tbl-btn">修改</button></td></tr></tbody></table>
<div class="el-dialog"><div class="el-dialog__title">提示</div><button id="dlg-ok">确定</button></div>
<div class="todo-item">
  <div class="todo-item__header">【对公授信申请】信贷调查
    <div class="todo-item-actions"><div class="todo-item-action">处理</div></div>
  </div>
  <div>业务主键： DGSX20260812056002</div>
  <button id="todo-handle">处理</button>
</div>
</body></html>`;

function assignExpr(selector) {
  return `(() => {
${PAGE_LOCATOR_HELPERS}
    const el = document.querySelector(${JSON.stringify(selector)});
    return assignRegion(el);
  })()`;
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setContent(FIXTURE);

  const legal = await page.evaluate(assignExpr('#corp-legal'));
  assert.equal(legal.region_role, 'section');
  assert.match(String(legal.region_label), /客户基本信息/);
  assert.match(String(legal.region_label), /对公客户概况/);
  assert.match(String(legal.region_label), /法定代表人\/负责人信息/);
  assert.equal(
    legal.region_label,
    '客户基本信息 / 对公客户概况 / 法定代表人/负责人信息',
  );
  assert.match(String(legal.region_id), /tab:客户基本信息/);
  assert.match(String(legal.region_id), /section:对公客户概况/);
  assert.match(String(legal.region_id), /titlebox:法定代表人\/负责人信息/);
  assert.equal(legal.region_chrome && legal.region_chrome.role, 'tab');
  assert.equal(legal.region_chrome && legal.region_chrome.label, '客户基本信息');
  assert.equal(legal.region_section, '对公客户概况');
  assert.equal(legal.region_block, '法定代表人/负责人信息');
  assert.doesNotMatch(String(legal.region_label), /对公客户管理/);
  ok('tab + collapse + titlebox three segments');

  const actual = await page.evaluate(assignExpr('#corp-actual'));
  assert.equal(actual.region_block, '实际控制人');
  assert.notEqual(actual.region_id, legal.region_id);
  ok('adjacent titleboxes stay distinct');

  const ops = await page.evaluate(assignExpr('#ops-save'));
  assert.equal(ops.region_section, '经营情况');
  assert.doesNotMatch(String(ops.region_label), /经营情况 保存/);
  assert.match(String(ops.region_id), /section:经营情况/);
  ok('collapse header strips trailing 保存');

  const img = await page.evaluate(assignExpr('#img-upload'));
  assert.equal(img.region_role, 'wizard');
  assert.equal(img.region_label, '影像资料');
  assert.match(String(img.region_id), /^wizard:影像资料$/);
  assert.notEqual(img.region_role, 'main');
  assert.doesNotMatch(String(img.region_label), /基本信息/);
  assert.equal(img.region_chrome && img.region_chrome.role, 'wizard');
  ok('wizard sibling steps, no collapse → not main');

  const img2 = await page.evaluate(assignExpr('#img-process'));
  assert.equal(img2.region_label, '影像资料');
  assert.equal(img2.region_role, 'wizard');
  ok('wizard is-process class');

  const rate = await page.evaluate(assignExpr('#rate-basic'));
  assert.match(String(rate.region_label), /评级基本情况/);
  assert.match(String(rate.region_label), /基本信息/);
  assert.doesNotMatch(String(rate.region_id), /tab:/);
  assert.doesNotMatch(String(rate.region_id), /wizard:/);
  ok('no chrome: collapse + titlebox only');

  const tbl = await page.evaluate(assignExpr('#tbl-btn'));
  assert.equal(tbl.region_role, 'table');
  assert.equal(tbl.region_id, 'table');
  ok('table short-circuit');

  const dlg = await page.evaluate(assignExpr('#dlg-ok'));
  assert.equal(dlg.region_role, 'overlay');
  ok('overlay short-circuit');

  const todo = await page.evaluate(assignExpr('#todo-handle'));
  assert.notEqual(todo.region_role, 'main');
  assert.match(String(todo.region_label), /对公授信申请|信贷调查/);
  ok('todo-item still before compose');

  await browser.close();
  console.log('characterize-partition-compose: ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Run char — expect FAIL**

```powershell
node scripts/characterization/characterize-partition-compose.mjs
```

Expected: `AssertionError` on `function composeContentRegion` (missing) **or**, if cues are added first, `#corp-legal` `region_label` is only `对公客户概况` / `#img-upload` is `main`.

- [ ] **Step 3: Commit** — skip unless the user asked.

```powershell
git add scripts/characterization/characterize-partition-compose.mjs
git commit -m "test: add partition compose characterization fixtures"
```

---

### Task 2: Implement compose + reorder `assignRegion`

**Files:**
- Modify: `src/cdp/page-locator-helpers.js` (`regionLabelOf` ~457–467, `assignRegion` ~468–535, insert helpers after `pickNearestTitlebox` ~655, change `refineCollidingRegions` ~724–741)

**Interfaces:**
- Consumes: existing `isActionOnlyTitle`, `titleboxTitleText`, `pickNearestTitlebox`, `findTitleboxRegion`
- Produces: `composeContentRegion(el)`, `finishCompose`, `mergeTitleboxIntoRegion`, `nearestPageSteps`; `assignRegion` order overlay → table → todo → shell → compose → main → other

- [ ] **Step 1: Extend `regionLabelOf`**

In `src/cdp/page-locator-helpers.js`, inside `regionLabelOf`, after the `section` line add:

```javascript
      if (role === 'tab') return t || '页签';
      if (role === 'wizard') return t || '向导';
```

- [ ] **Step 2: Rewrite `assignRegion` body after the table short-circuit**

Delete the entire `.el-collapse-item` early-return block (today ~483–494). Keep overlay and table unchanged. After table, keep the existing `.todo-item` block and both shell returns **exactly as they are today**. Then replace the `el-main` / `other` tail with:

```javascript
      const composed = composeContentRegion(el);
      if (composed && composed.region_id) return composed;
      if (el.closest('.el-main, .app-main, .plugin-content, main')) {
        return { region_role: 'main', region_id: 'main', region_label: regionLabelOf('main') };
      }
      return { region_role: 'other', region_id: 'other', region_label: regionLabelOf('other') };
```

`function assignRegion` must remain under `/* SHARED_ASSIGN_REGION` and **before** `buildFeatureCard`. `composeContentRegion` is a later `function` declaration in the same IIFE — it hoists.

Do not put a large compose implementation inside `assignRegion` (todo-item characterization slices the first ~3000–3500 chars of `assignRegion` and must still see `.todo-item` / `业务主键`).

- [ ] **Step 3: Insert compose helpers after `pickNearestTitlebox`, before `findTitleboxRegion`**

Paste this block into the `PAGE_LOCATOR_HELPERS` template (keep doubled backslashes):

```javascript
    function isShellChromeNode(node) {
      if (!node || !node.closest) return false;
      return !!node.closest('.tags-view-container, header, .el-header, .navbar');
    }
    function nearestContentTabs(el) {
      let n = el;
      while (n && n.closest) {
        const tabs = n.closest('.el-tabs');
        if (!tabs) break;
        if (!isShellChromeNode(tabs)) return tabs;
        n = tabs.parentElement;
      }
      return null;
    }
    function activeTabLabel(tabs) {
      if (!tabs || !tabs.querySelector) return '';
      const item = tabs.querySelector('.el-tabs__item.is-active');
      return String((item && (item.innerText || item.textContent)) || '')
        .replace(/\\s+/g, ' ').trim().slice(0, 40);
    }
    function nearestPageSteps(el) {
      if (!el) return null;
      if (el.closest) {
        const inside = el.closest('.el-steps');
        if (inside && !isShellChromeNode(inside)) return inside;
      }
      let n = el.parentElement;
      while (n) {
        if (n.matches && n.matches('.el-steps') && !isShellChromeNode(n)) return n;
        if (n.querySelector) {
          const kids = n.querySelectorAll(':scope > .el-steps');
          for (let i = 0; i < kids.length; i++) {
            if (!isShellChromeNode(kids[i])) return kids[i];
          }
        }
        n = n.parentElement;
      }
      return null;
    }
    function stepTitle(step) {
      if (!step) return '';
      const t = step.querySelector && (
        step.querySelector('.el-step__title') || step.querySelector('.el-step__head')
      );
      return String((t && (t.innerText || t.textContent)) || step.innerText || '')
        .replace(/\\s+/g, ' ').trim().slice(0, 40);
    }
    function currentStepLabel(steps) {
      if (!steps || !steps.querySelectorAll) return '';
      const items = Array.from(steps.querySelectorAll('.el-step'));
      if (!items.length) return '';
      for (let i = 0; i < items.length; i++) {
        const cls = String(items[i].className || '');
        if (/\\bis-process\\b|\\bprocess\\b/.test(cls)
          && !/\\bis-wait\\b/.test(cls)
          && !/\\bis-finish\\b/.test(cls)) {
          const t = stepTitle(items[i]);
          if (t) return t;
        }
      }
      let lastFinish = -1;
      for (let i = 0; i < items.length; i++) {
        if (/\\bis-finish\\b|\\bis-success\\b/.test(String(items[i].className || ''))) {
          lastFinish = i;
        }
      }
      if (lastFinish >= 0 && lastFinish + 1 < items.length) {
        const t = stepTitle(items[lastFinish + 1]);
        if (t) return t;
      }
      for (let i = 0; i < items.length; i++) {
        const t = stepTitle(items[i]);
        if (t) return t;
      }
      return '';
    }
    function readChrome(el) {
      const tabs = nearestContentTabs(el);
      if (tabs) {
        const label = activeTabLabel(tabs);
        if (label) return { role: 'tab', label: label };
      }
      const steps = nearestPageSteps(el);
      if (steps) {
        const label = currentStepLabel(steps);
        if (label) return { role: 'wizard', label: label };
      }
      return null;
    }
    function stripActionTail(title) {
      let s = String(title || '').replace(/\\s+/g, ' ').trim();
      s = s.replace(/\\s+(新增|修改|查看|删除|保存|\\+\\s*新增)$/g, '').trim();
      return s.slice(0, 40);
    }
    function collapseSectionTitle(el) {
      if (!el || !el.closest) return '';
      const it = el.closest('.el-collapse-item');
      if (!it) return '';
      const h = it.querySelector && it.querySelector('.el-collapse-item__header');
      return stripActionTail((h && (h.innerText || h.textContent)) || '');
    }
    function composeTitleboxTitle(el, scope) {
      if (!el || !scope) return '';
      const want = String((el.innerText || el.textContent || '')).replace(/\\s+/g, ' ').trim().slice(0, 40);
      const inside = el.closest && el.closest('.titlebox');
      if (inside && (!scope.contains || scope.contains(inside))) {
        const t = titleboxTitleText(inside);
        if (t && !isActionOnlyTitle(t) && t !== want) return t;
      }
      const nodeList = scope.querySelectorAll ? scope.querySelectorAll('.titlebox') : [];
      const boxes = [];
      for (let i = 0; i < nodeList.length; i++) boxes.push(nodeList[i]);
      const picked = pickNearestTitlebox(boxes, el);
      const title = titleboxTitleText(picked);
      if (!title || isActionOnlyTitle(title) || title === want) return '';
      return title;
    }
    function finishCompose(chrome, section, block) {
      const parts = [];
      const ids = [];
      if (chrome && chrome.label) {
        parts.push(chrome.label);
        ids.push((chrome.role === 'wizard' ? 'wizard:' : 'tab:') + chrome.label);
      }
      if (section) {
        parts.push(section);
        ids.push('section:' + section);
      }
      if (block) {
        parts.push(block);
        ids.push('titlebox:' + block);
      }
      if (!parts.length) return null;
      let role = 'section';
      if (block || section) role = 'section';
      else if (chrome && chrome.role === 'wizard') role = 'wizard';
      else role = 'tab';
      const out = {
        region_role: role,
        region_id: ids.join('|'),
        region_label: parts.join(' / '),
      };
      if (chrome && chrome.label) out.region_chrome = { role: chrome.role, label: chrome.label };
      if (section) out.region_section = section;
      if (block) out.region_block = block;
      return out;
    }
    function composeContentRegion(el) {
      if (!el || !el.closest) return null;
      const chrome = readChrome(el);
      const section = collapseSectionTitle(el);
      let scope = null;
      if (el.closest('.el-collapse-item')) scope = el.closest('.el-collapse-item');
      else if (el.closest('.el-tab-pane')) scope = el.closest('.el-tab-pane');
      else if (el.closest('.el-main, .app-main, .plugin-content, main')) {
        scope = el.closest('.el-main, .app-main, .plugin-content, main');
      } else {
        scope = (typeof document !== 'undefined' && document.body) ? document.body : el;
      }
      const block = composeTitleboxTitle(el, scope);
      try {
        return finishCompose(chrome, section, block);
      } catch (e) {
        return finishCompose(chrome, section, '');
      }
    }
    function mergeTitleboxIntoRegion(region, finer) {
      const title = finer && (finer.title || finer.region_label);
      if (!title) return region;
      const rid = String((region && region.region_id) || '');
      if (rid.indexOf('titlebox:') >= 0) return region;
      const chrome = region && region.region_chrome ? region.region_chrome : null;
      const section = (region && region.region_section) || '';
      const next = finishCompose(chrome, section, String(title));
      return next || region;
    }
```

- [ ] **Step 4: Change `refineCollidingRegions` so it never replaces the path**

Replace the inner loop body that currently does `if (finer) it.region = finer;` with:

```javascript
          const role = String((it.region && it.region.region_role) || '');
          if (role === 'overlay' || role === 'table'
            || role === 'shell-aside' || role === 'shell-header') continue;
          const finer = findTitleboxRegion(it.el, needle);
          if (finer) it.region = mergeTitleboxIntoRegion(it.region, finer);
```

Keep grouping by `region_id` and `idxs.length < 2`. Do not change `findTitleboxRegion` return shape (`title` is still required for `titleboxAnchorXPath`).

- [ ] **Step 5: Run compose char — expect PASS**

```powershell
node scripts/characterization/characterize-partition-compose.mjs
```

Expected: `characterize-partition-compose: ok`

If `#img-upload` is still `main`, `nearestPageSteps` is not seeing sibling `.el-steps` — fix that helper, do not special-case the fixture.

If `#corp-legal` label includes `对公客户管理`, content tabs are picking header `.el-tabs` — `isShellChromeNode` / `nearestContentTabs` must skip `.tags-view-container` / `header`.

- [ ] **Step 6: Commit** — skip unless the user asked.

```powershell
git add src/cdp/page-locator-helpers.js
git commit -m "feat: compose tab, wizard, and titlebox into assignRegion"
```

---

### Task 3: Regen Python helper mirror

**Files:**
- Generate: `scripts/controller/actions/js_snippets/_locator_helpers_js.py`

**Interfaces:**
- Consumes: `PAGE_LOCATOR_HELPERS` from `src/cdp/locator-candidates.js` (re-exports page-locator-helpers)
- Produces: Python `PAGE_LOCATOR_HELPERS` used by scan / unify Playwright char

- [ ] **Step 1: Regenerate**

```powershell
node scripts/_gen_locator_helpers_py.mjs
```

Expected: `ok: wrote _locator_helpers_js.py (...)`

- [ ] **Step 2: Confirm generated file contains compose cues**

```powershell
rg "composeContentRegion|nearestPageSteps|mergeTitleboxIntoRegion" scripts/controller/actions/js_snippets/_locator_helpers_js.py
```

Expected: all three names present. Do not hand-edit the file if missing — regenerate after fixing JS.

- [ ] **Step 3: Re-run Python unify + todo chars**

```powershell
python scripts/characterization/characterize-unify-partition-locator.py
python scripts/characterization/characterize-todo-item-action.py
python scripts/characterization/characterize-scan-assign-region-once.py
```

Expected: `OK` / existing ok lines. Todo cards must still not dump to `main`.

- [ ] **Step 4: Commit** — skip unless the user asked.

```powershell
git add scripts/controller/actions/js_snippets/_locator_helpers_js.py
git commit -m "chore: regen locator helpers after partition compose"
```

---

### Task 4: Persist structured `region_*` fields

**Files:**
- Modify: `src/cdp/page-locator-helpers.js` (`buildLocatorSnap` return ~1275–1301)
- Modify: `src/cdp/resolve-by-label.js` (`toPreview` ~30–43, `snap()` return ~108–131, `enrichOne` ~566–568)
- Modify: `src/models/element.js` (`copyLocatorMeta` keys ~109–121)
- Modify: `src/services/trajectory/trajectory-record-lifecycle.js` (`patchRegionFields` ~50–79)

**Interfaces:**
- Consumes: `assignRegion` / `composeContentRegion` objects from Task 2
- Produces: `region_chrome`, `region_section`, `region_block` on locator snap, resolve preview/element, and persisted `element_json`

- [ ] **Step 1: Stamp fields on `buildLocatorSnap` return**

Next to existing `region_label: region.region_label`, add:

```javascript
      region_chrome: region.region_chrome,
      region_section: region.region_section,
      region_block: region.region_block,
```

- [ ] **Step 2: Copy through resolve**

In `toPreview`, after `region_label`:

```javascript
    region_chrome: el?.region_chrome,
    region_section: el?.region_section || '',
    region_block: el?.region_block || '',
```

In `snap()` return and in `enrichOne`’s `enrichLocatorFields({...})` object, pass the same three fields from `loc` / `raw` (same pattern as `region_label`).

- [ ] **Step 3: `copyLocatorMeta` whitelist**

In `src/models/element.js`, add `'region_chrome'`, `'region_section'`, `'region_block'` to the `copyLocatorMeta` key list after `'region_label'`.

- [ ] **Step 4: L1c must not strip structured fields**

In `patchRegionFields`, replace the first two statements (`const role = …` and `target.region_role = role`) with a `prevRole` capture. After the existing `keepPrevLabel` const (do not declare it twice), set role like this:

```javascript
  const prevRole = String(target.region_role || '');
  const role = String(classified.role || prevRole || 'other');
  const prevLabel = String(target.region_label || '').trim();
  const prevId = String(target.region_id || '').trim();
  let nextLabel = String(classified.label || '').trim();
  const keepPrevLabel = !!(prevLabel && !isTaxonomyRegionToken(prevLabel));
  if (keepPrevLabel && (prevRole === 'tab' || prevRole === 'wizard' || prevRole === 'section')) {
    target.region_role = prevRole;
  } else {
    target.region_role = role;
  }
```

Then keep the existing `if (keepPrevLabel) { nextLabel = prevLabel; } …` label/id/`displayGroupOf` logic. Do not `delete` `region_chrome` / `region_section` / `region_block`.

- [ ] **Step 5: Extend compose char with a snap cue + run**

In `characterize-partition-compose.mjs` source-cue block add:

```javascript
  assert.match(helpersSrc, /region_chrome:\s*region\.region_chrome/);
  assert.match(helpersSrc, /region_section:\s*region\.region_section/);
  assert.match(helpersSrc, /region_block:\s*region\.region_block/);
```

In `src/models/element.js` cue (same char file, new block):

```javascript
{
  const elSrc = readFileSync(join(root, 'src/models/element.js'), 'utf8');
  assert.match(elSrc, /region_chrome/);
  assert.match(elSrc, /region_section/);
  assert.match(elSrc, /region_block/);
  ok('element_json copies structured region fields');
}
```

Run:

```powershell
node scripts/characterization/characterize-partition-compose.mjs
node scripts/_gen_locator_helpers_py.mjs
```

Expected: compose char ok; py regen ok.

- [ ] **Step 6: Commit** — skip unless the user asked.

```powershell
git add src/cdp/page-locator-helpers.js src/cdp/resolve-by-label.js src/models/element.js src/services/trajectory/trajectory-record-lifecycle.js scripts/controller/actions/js_snippets/_locator_helpers_js.py scripts/characterization/characterize-partition-compose.mjs
git commit -m "feat: persist composed region_chrome/section/block on element_json"
```

---

### Task 5: `display_group` taxonomy for `tab` / `wizard`

**Files:**
- Modify: `src/cdp/display-group.js` (`TAXONOMY_ROLES` ~9–20)
- Modify: `scripts/characterization/characterize-l1c-region-classify.mjs` (taxonomy asserts ~96–103)

**Interfaces:**
- Consumes: composed `region_label` Chinese path from Task 2
- Produces: `isTaxonomyRegionToken('tab')` / `'wizard'` true; a ` / ` path is **not** a taxonomy token; `displayGroupOf` returns the path unchanged

- [ ] **Step 1: Add roles**

In `TAXONOMY_ROLES` add `'tab'` and `'wizard'` (alongside `'section'`).

- [ ] **Step 2: Extend L1c char + compose char**

After the existing `isTaxonomyRegionToken('section')` assert in `characterize-l1c-region-classify.mjs` add:

```javascript
  assert.equal(isTaxonomyRegionToken('tab'), true);
  assert.equal(isTaxonomyRegionToken('wizard'), true);
  assert.equal(isTaxonomyRegionToken('客户基本信息 / 对公客户概况'), false);
  assert.equal(
    displayGroupOf({ region_label: '客户基本信息 / 对公客户概况 / 法定代表人/负责人信息' }),
    '客户基本信息 / 对公客户概况 / 法定代表人/负责人信息',
  );
```

In `characterize-partition-compose.mjs`, next to the existing `displayGroupOf` block, import `isTaxonomyRegionToken` and add the same `tab` / `wizard` taxonomy asserts (do **not** put these in Task 1 — they fail until this task).

- [ ] **Step 3: Run**

```powershell
node scripts/characterization/characterize-l1c-region-classify.mjs
node scripts/characterization/characterize-partition-compose.mjs
```

Expected: both ok. Do not change `uniquifyDisplayGroups` collision key — it already keys on full `display_group` + control label.

- [ ] **Step 4: Commit** — skip unless the user asked.

```powershell
git add src/cdp/display-group.js scripts/characterization/characterize-l1c-region-classify.mjs
git commit -m "fix: treat tab/wizard as taxonomy tokens in display_group"
```

---

### Task 6: Collision-refine contract (no titlebox-only replace)

**Files:**
- Modify: `scripts/characterization/characterize-resolve-collision-titlebox.mjs`
- Verify: `src/cdp/page-locator-helpers.js` `refineCollidingRegions` from Task 2

**Interfaces:**
- Consumes: `mergeTitleboxIntoRegion(region, finer)` from Task 2
- Produces: characterization forbids `it.region = finer` as a whole-object replace

- [ ] **Step 1: Replace the coarse-then-replace contract block**

In `scripts/characterization/characterize-resolve-collision-titlebox.mjs`, change the block that currently says “coarse assignRegion first, refine only on region_id collision” to:

```javascript
{
  // Contract: compose path first; on region_id collision merge titlebox into the
  // path. Never replace region_* with a titlebox-only object.
  assert.match(helpers, /function refineCollidingRegions\s*\(/);
  assert.match(helpers, /idxs\.length < 2/);
  assert.match(helpers, /findTitleboxRegion/);
  assert.match(helpers, /function mergeTitleboxIntoRegion\s*\(/);
  assert.match(helpers, /indexOf\('titlebox:'\)/);
  const refineStart = helpers.indexOf('function refineCollidingRegions');
  const refineEnd = helpers.indexOf('function titleboxAnchorXPath') > refineStart
    ? helpers.indexOf('SHARED_INVENTORY_COLLECT', refineStart)
    : helpers.indexOf('SHARED_INVENTORY_COLLECT', refineStart);
  const refineBody = helpers.slice(refineStart, refineEnd > refineStart ? refineEnd : refineStart + 1200);
  assert.match(refineBody, /mergeTitleboxIntoRegion/);
  assert.equal(/it\.region\s*=\s*finer\s*;/.test(refineBody), false);
  const life = readFileSync(join(root, 'src/services/trajectory/trajectory-record-lifecycle.js'), 'utf8');
  assert.match(life, /keepPrevLabel|collision-refine|titlebox refine/);
  ok('contract: compose then merge-on-collision; never titlebox-only replace');
}
```

Keep the other cue blocks (`findTitleboxRegion`, `titleboxAnchorXPath`, resolve expression injects refine).

- [ ] **Step 2: Run**

```powershell
node scripts/characterization/characterize-resolve-collision-titlebox.mjs
node scripts/characterization/characterize-resolve-ambiguous-region.mjs
```

Expected: both ok. If `it.region = finer` still exists, Task 2 Step 4 is incomplete.

- [ ] **Step 3: Commit** — skip unless the user asked.

```powershell
git add scripts/characterization/characterize-resolve-collision-titlebox.mjs
git commit -m "test: collision refine must merge titlebox into composed path"
```

---

### Task 7: CHANGELOG, api-docs, spec/todo status

**Files:**
- Modify: `CHANGELOG.md` (`[Unreleased]` Changed)
- Modify: `src/dashboard/api-docs/groups/recording.js` (~line 135)
- Modify: `docs/superpowers/specs/2026-08-13-partition-tab-wizard-titlebox-design.md` (Status line)
- Modify: `docs/superpowers/todo-list.md` (PR-PART row + 更新记录)

**Interfaces:**
- Consumes: behavior from Tasks 2–6
- Produces: Python sync hint; SPA contract note; status Implemented

- [ ] **Step 1: CHANGELOG `[Unreleased]` → `### Changed`**

Insert at the top of Changed (Keep a Changelog format already used in the file):

```markdown
- 2026-08-13: **分区拼接（tab / 向导 / titlebox）**：`assignRegion` 在 overlay/表格/待办/壳短路之后，把内容 tab 或向导当前步、collapse、最近 titlebox 拼成 `region_label`（` / `）与 `region_id`（`|`）；collapse 标题剥尾部动作字。撞车 refine 不再把路径打回单独 titlebox。`display_group` 仍等于中文路径。
  影响范围：扫描 / resolve / 录制 `element_json` 的 `region_*` 与 `display_group`；无 schema。
  文件：src/cdp/page-locator-helpers.js, src/cdp/display-group.js, src/cdp/resolve-by-label.js, src/models/element.js
  Python 同步提示：无 HTTP/schema。透传 `display_group` / `region_label` 原样展示（可能含 ` / `）；可选透传 `region_chrome` / `region_section` / `region_block`。勿再按单层 collapse 标题重算分组。
```

- [ ] **Step 2: api-docs sentence**

In `src/dashboard/api-docs/groups/recording.js`, extend the existing 分区 sentence so it also says `display_group` 可以是 `tab / collapse / titlebox` 用 ` / ` 连接的中文路径，SPA 仍原样展示、不要拆 `region_id`。

- [ ] **Step 3: Spec + todo**

Spec status → `Implemented` (this plan’s chars green).

`docs/superpowers/todo-list.md` PR-PART 状态改为第一刀已实现（CI fixture），并同时链 spec 与本 plan。更新记录加一行 2026-08-13 PR-PART 第一刀落地。湿测 9242 仍可在说明里标「手册待跑」——不要把产品行改成完成直到 Task 8 湿测做过或用户明确跳过。

- [ ] **Step 4: Commit** — skip unless the user asked.

```powershell
git add CHANGELOG.md src/dashboard/api-docs/groups/recording.js docs/superpowers/specs/2026-08-13-partition-tab-wizard-titlebox-design.md docs/superpowers/todo-list.md
git commit -m "docs: changelog and contract for composed partition paths"
```

---

### Task 8: Regression + optional 9242 wet

**Files:**
- Verify only (plus optional local wet script — do **not** commit `_wet_*`)

**Interfaces:**
- Consumes: all previous tasks
- Produces: related chars green; wet handbook evidence if Chrome `:9242` is up

- [ ] **Step 1: Related characterization**

```powershell
cd d:\dev\JS-gen
node scripts/characterization/characterize-partition-compose.mjs
node scripts/characterization/characterize-resolve-collision-titlebox.mjs
node scripts/characterization/characterize-resolve-ambiguous-region.mjs
node scripts/characterization/characterize-l1c-region-classify.mjs
python scripts/characterization/characterize-unify-partition-locator.py
python scripts/characterization/characterize-todo-item-action.py
python scripts/characterization/characterize-scan-assign-region-once.py
```

Expected: all ok/OK.

- [ ] **Step 2: Core refactor gate (optional if bash available)**

```powershell
bash scripts/refactor/verify-all.sh
```

Expected: `verify-all: ALL GREEN`. If Git Bash is missing, run the six commands listed in that script individually (`characterize-dedup`, `characterize-ctrl`, `characterize-trajectory`, assembler, form-rules, `accept-replay-apis`).

- [ ] **Step 3: Manual wet on CDP 9242 (not CI)**

Only if Chrome is listening on `http://127.0.0.1:9242`. Do not `browser.close()` the user’s Chrome; after `connectOverCDP` always `process.exit(0)`.

Checklist from the spec:

1. 对公客户修改 / 客户基本信息：概况控件 `region_label` contains `客户基本信息 / 对公客户概况 / <titlebox>`；法定代表人 vs 实际控制人 `region_block` 不同。
2. 客户综合信息：资产 vs 联系 的「新增」titlebox 段不同。
3. 评级待发起修改第一步：`基本信息 / 评级基本情况`（有 titlebox 再加第三段）；collapse 无尾「保存」。
4. 下一步影像资料：分区为 `影像资料`，不得残留「基本信息」、不得整页 `main`。
5. 顶栏仍「顶栏」；开着的弹层仍 overlay；表仍 `table`。

A one-shot dump may reuse `scripts/characterization/_wet_partition_survey.mjs` (keep untracked). If 9242 is down, record that wet was skipped; CI fixtures still count as Task 8 Step 1 done.

- [ ] **Step 4: Commit** — skip unless the user asked.
