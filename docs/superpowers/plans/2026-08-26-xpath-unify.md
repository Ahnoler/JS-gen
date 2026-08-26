# 三路径相对 XPath 统一 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 同一个 DOM 节点，无论从 AI 录制 / 人工录制 / 自动抓取哪个入口进来，最终得到的 `xpath_smart` / `xpath_full` / `candidates` / `locator_strategy` / `target_kind` 完全一致。

**Architecture:** 算法内核 `buildLocatorSnap`（`src/cdp/page-locator-helpers.js:1520`）一行不改；统一三个入口作为调用方的行为——5 参调用（`{targetKind, region}`）、formLabel 统一 DOM 取（含 placeholder 回退）、全量字段透传。自动抓取路径（`resolve-by-label.js` 的 `snap`）为喂参规范基准。

**Tech Stack:** Node.js（`src/cdp/*` 页内注入 JS）、Python 内嵌 JS 字符串（`scripts/manual_recorder/*`）、Playwright（一致性测试）、characterization 源码断言。

## Global Constraints

- 不改 `buildLocatorSnap` 算法内核（`src/cdp/page-locator-helpers.js` 逻辑一行不变；`_locator_helpers_js.py` 不重新生成）
- Node 侧后处理链（`enrichLocatorFields`/`assembleRegionTree`/`displayGroup`）本次不动，自动抓取保留
- L1c 区域语义分类维持现状：仅自动抓取走 `applyL1cRegionClassify`
- 不合并三份 elMeta 入口（`inspect-payload-script.js` / `b.py` / `resolve-by-label.js` 各自保留），只统一调用规范
- Python `mapper.py` 的 `_offline_xpath_smart_fallback` 优先级链（placeholder→label→text）不变；offline 重建不设 `verified=true`（已如此）
- `fill_form_field`/`select_option`/`click_radio` 的 action 签名必须仍接受 `xpath_smart` 参数（`characterize-xpath-primary-ops.py` `test_phase_b_action_signatures` pin）
- `JS_CAPTURE_FROM_XPATH` 必须仍含 `formFieldXpathSmartOf`；`_capture_element` 函数体禁调 `JS_SMART_LOCATOR`；`params['xpath_smart']` 禁赋值（`characterize-capture-element-xpath.py` pin）
- 每个任务提交前跑对应验证命令（见各任务），全部完成后再跑 `bash scripts/refactor/verify-all.sh`
- `src/` 变更按 同步约定 在 `CHANGELOG.md` `[Unreleased]` 追加条目
- 改 `scripts/manual_recorder/` 后运行期需重新 attach（既有约定）

---

### Task 1: 人工录制 elMeta 统一调用规范（b.py）

**Files:**
- Modify: `scripts/manual_recorder/js_parts/b.py:4-47`（elMeta 函数）
- Test: `scripts/characterization/characterize-locator-parity.mjs`（跑全部）

**Interfaces:**
- Consumes: `buildLocatorSnap(host, text, abs, formLabel, opts)`（来自 `PAGE_LOCATOR_HELPERS`，拼接于 `js.py:12`）；`normalizeFormLabel`（PAGE_LOCATOR_HELPERS 内，运行时可用）；`placeholderLabel`（`a.py` 内定义）
- Produces: `elMeta(el, textOverride, kindHint, regionOverride)`——新增第 3/4 参（可选），返回对象补 `cssSelector/icon_class/placeholder/region_role/region_id/region_label/region_chrome/region_section/region_block/layers/feature_card`

- [ ] **Step 1: 改 elMeta 签名与 buildLocatorSnap 调用（5 参）**

把 `b.py:4-47` 的 elMeta 改为：

```js
function elMeta(el, textOverride, kindHint, regionOverride) {
  const t = textOverride != null ? String(textOverride) : shortLabel(el);
  const hi = highlightIndexOf(el);
  const bu = buXPathOf(el);
  const abs = xpathOf(el);
  const formLbl = formItemLabel(el);
  const loc = buildLocatorSnap(el, t, abs, formLbl, {
    targetKind: kindHint || undefined,
    region: regionOverride || undefined,
  });
  const meta = {
    xpath: loc.xpath || bu || abs,
    bu_xpath: bu,
    xpath_abs: abs,
    xpath_full: loc.xpath_full || abs,
    xpath_smart: loc.xpath_smart || '',
    cssSelector: loc.cssSelector || '',
    candidates: loc.candidates || [],
    tag: loc.tag || (el.tagName || '').toLowerCase(),
    attributes: loc.attributes || attrs(el),
    text: loc.text || t,
    formLabel: loc.formLabel || formLbl || '',
    target_kind: loc.target_kind || kindHint || '',
    parent_text: loc.parent_text || '',
    icon_class: loc.icon_class || '',
    placeholder: loc.placeholder || '',
    locator_scope: loc.locator_scope || '',
    locator_occurrence: loc.locator_occurrence || 0,
    locator_verified: loc.locator_verified === true,
    locator_strategy: loc.locator_strategy || '',
    region_role: loc.region_role || '',
    region_id: loc.region_id || '',
    region_label: loc.region_label || '',
    region_chrome: loc.region_chrome || '',
    region_section: loc.region_section || '',
    region_block: loc.region_block || '',
    layers: Array.isArray(loc.layers) ? loc.layers : [],
    feature_card: loc.feature_card || undefined,
  };
  if (loc.locator_fallback_reason) meta.locator_fallback_reason = loc.locator_fallback_reason;
  if (hi != null) meta.highlight_index = hi;
  // Todo card actions (处理/转交/…) — stamp card business key / title for replay scope
  const todoCard = el.closest && el.closest('.todo-item');
  if (todoCard) {
    const blob = String(todoCard.innerText || todoCard.textContent || '');
    const keyM = blob.match(/\b(?:PJ|DGSX)\d+\b/);
    if (keyM) meta.parent_text = keyM[0];
    else {
      const titleLine = blob.split(/[\n\r]+/).map((s) => s.trim()).filter(Boolean)[0] || '';
      if (titleLine) meta.parent_text = titleLine.slice(0, 80);
    }
  }
  return meta;
}
```

注意：`formLbl` 从内联 IIFE 改为调用 `formItemLabel(el)`（Task 2 会统一 `formItemLabel` 的 placeholder 回退；此处先用 `a.py` 现有定义）。

- [ ] **Step 2: 语法检查 + 跑 locator parity 测试**

Run: `python -m py_compile scripts/manual_recorder/js_parts/b.py && node scripts/characterization/characterize-locator-parity.mjs`
Expected: py_compile 无输出；characterize-locator-parity 全 PASS

- [ ] **Step 3: Commit**

```bash
git add scripts/manual_recorder/js_parts/b.py
git commit -m "refactor(recorder): 人工录制 elMeta 统一 5 参调用 + 全量字段透传（对齐自动抓取）"
```

---

### Task 2: 人工录制 formItemLabel 补 placeholder 回退 + 4 类弱 action 改走 elMeta

**Files:**
- Modify: `scripts/manual_recorder/js_parts/a.py:95-101`（formItemLabel 定义）
- Modify: `scripts/manual_recorder/js_parts/b.py:154-163`（select_option）、`:291-300`（click_radio）、`:306-313`（switch_tab）、`:319-326`（close_dialog）
- Test: `scripts/characterization/characterize-capture-element-xpath.py` + `characterize-xpath-primary-ops.py`

**Interfaces:**
- Consumes: `elMeta(el, textOverride, kindHint, regionOverride)`（Task 1 产出）
- Produces: `formItemLabel(node)`——含 placeholder 回退（对齐 AI `formItemLabel` 语义）；4 类弱 action 的 emit 输出补齐 `xpath_smart/candidates/locator_strategy` 等

- [ ] **Step 1: 统一 formItemLabel（a.py）**

`a.py:95-101` 的 `formItemLabel` 当前用内联正则 `[：:*\s]+$` 且无 placeholder 回退。改为：

```js
function formItemLabel(node) {
  const item = node.closest && node.closest('.el-form-item');
  if (!item) return '';
  const lbl = item.querySelector('.el-form-item__label');
  const t = (lbl && lbl.textContent || '').trim().replace(/[：:*\s]+$/g, '');
  return t || placeholderLabel(node);
}
```

（与 `inspect-payload-script.js:130-136` 的 `formItemLabel` 逐行一致——统一语义；若 `a.py` 无 `placeholderLabel` 定义，则从 `inspect-payload-script.js:137-145` 拷贝同名函数进 `a.py`。）

- [ ] **Step 2: select_option 改走 elMeta（b.py:154-163）**

```js
const meta = elMeta(opt, optionText, 'form_select');
emit(Object.assign({
  kind: 'select_option',
  label_text: label,
  option_text: optionText,
  options: options,
  tag: meta.tag || 'li',
  attributes: meta.attributes || attrs(opt),
  text: optionText,
}, meta));
```

- [ ] **Step 3: click_radio 改走 elMeta（b.py:291-300）**

```js
const meta = elMeta(radio, optionText, 'form_radio');
emit(Object.assign({
  kind: 'click_radio',
  label_text: label,
  option_text: optionText,
  tag: meta.tag || radio.tagName.toLowerCase(),
  attributes: meta.attributes || attrs(radio),
  text: optionText,
}, meta));
```

- [ ] **Step 4: switch_tab 改走 elMeta（b.py:306-313）**

```js
const tabText = visibleText(tab);
const meta = elMeta(tab, tabText, 'tab');
emit(Object.assign({
  kind: 'switch_tab',
  tab_name: tabText,
  tag: meta.tag || tab.tagName.toLowerCase(),
  attributes: meta.attributes || attrs(tab),
  text: tabText,
}, meta));
```

- [ ] **Step 5: close_dialog 改走 elMeta（b.py:319-326）**

```js
const meta = elMeta(el, 'close', 'dialog_close');
emit(Object.assign({
  kind: 'close_dialog',
  tag: meta.tag || el.tagName.toLowerCase(),
  attributes: meta.attributes || attrs(el),
  text: '',
}, meta));
```

- [ ] **Step 6: 语法检查 + 跑相关 characterization**

Run: `python -m py_compile scripts/manual_recorder/js_parts/a.py scripts/manual_recorder/js_parts/b.py && python scripts/characterization/characterize-capture-element-xpath.py && python scripts/characterization/characterize-xpath-primary-ops.py`
Expected: 全 PASS（capture-element-xpath 的 `test_form_record_params_omit_xpath_smart` 断言 `params['xpath_smart']` 计数为 0——本任务只在 action 顶层字段带 smart，params 不带，不冲突）

- [ ] **Step 7: Commit**

```bash
git add scripts/manual_recorder/js_parts/a.py scripts/manual_recorder/js_parts/b.py
git commit -m "fix(recorder): 人工录制 4 类弱 action 补 smart locator + formItemLabel 统一 placeholder 回退"
```

---

### Task 3: AI 录制 elMeta 统一调用规范（inspect-payload-script.js）

**Files:**
- Modify: `src/cdp/inspect-payload-script.js:207-235`（elMeta 函数）
- Modify: `src/cdp/inspect-payload-script.js` 各 action 分支调用处（:357/:372/:414/:429/:441/:455/:466/:476/:481/:498）
- Test: `node scripts/characterization/characterize-live-xpath-e2e.mjs`

**Interfaces:**
- Consumes: `buildLocatorSnap`（本文件注入上下文可用）；`formItemLabel`（:130-136，已含 placeholder 回退）
- Produces: `elMeta(node, textOverride, kindHint)`——新增第 3 参（可选），返回对象补 `region_*/layers/feature_card/page_bbox`

- [ ] **Step 1: 改 elMeta 签名与 buildLocatorSnap 调用（5 参）+ 字段透传**

`inspect-payload-script.js:207-235` 改为：

```js
function elMeta(node, textOverride, kindHint) {
  const t = textOverride != null ? String(textOverride) : shortLabel(node);
  const bu = buXPathOf(node);
  const abs = xpathOf(node);
  const formLbl = formItemLabel(node);
  const loc = buildLocatorSnap(node, t, abs, formLbl, {
    targetKind: kindHint || undefined,
  });
  return {
    xpath: loc.xpath || bu || abs,
    bu_xpath: bu,
    xpath_abs: abs,
    xpath_full: loc.xpath_full || abs,
    xpath_smart: loc.xpath_smart || '',
    cssSelector: loc.cssSelector || '',
    candidates: loc.candidates || [],
    tag: (node.tagName || '').toLowerCase(),
    attributes: loc.attributes || attrs(node),
    text: loc.text || t,
    formLabel: loc.formLabel || formLbl || '',
    target_kind: loc.target_kind || kindHint || '',
    parent_text: loc.parent_text || '',
    icon_class: loc.icon_class || '',
    placeholder: loc.placeholder || '',
    locator_scope: loc.locator_scope || '',
    locator_occurrence: loc.locator_occurrence || 0,
    locator_verified: loc.locator_verified === true,
    locator_strategy: loc.locator_strategy || '',
    locator_fallback_reason: loc.locator_fallback_reason || undefined,
    region_role: loc.region_role || '',
    region_id: loc.region_id || '',
    region_label: loc.region_label || '',
    region_chrome: loc.region_chrome || '',
    region_section: loc.region_section || '',
    region_block: loc.region_block || '',
    layers: Array.isArray(loc.layers) ? loc.layers : [],
    feature_card: loc.feature_card || undefined,
    page_bbox: loc.page_bbox || undefined,
  };
}
```

- [ ] **Step 2: 各 action 分支传 kindHint**

逐个改为（保留现有 textOverride，追加第 3 参）：
- `:357` `elMeta(opt, optionText, 'form_select')`
- `:372` `elMeta(meta.input || dateTd, value, 'form_date')`
- `:414` `elMeta(menu, menuText, 'menu')`
- `:429` `elMeta(item, menuText, 'menu')`
- `:441` `elMeta(rowBtn, buttonText, 'table_row_button')`
- `:455` `elMeta(tableRadio, rowText, 'table_row_button')`
- `:466` `elMeta(radio, optionText, 'form_radio')`
- `:476` `elMeta(tab, tabName, 'tab')`
- `:481` `elMeta(closeBtn, 'close', 'dialog_close')`
- `:498` `elMeta(target, text)`（generic click——保持不传 kind，由内部 `detectTargetKind` 决定）

- [ ] **Step 3: 语法检查 + 跑 live e2e**

Run: `node --check src/cdp/inspect-payload-script.js && node scripts/characterization/characterize-live-xpath-e2e.mjs`
Expected: --check 无输出；live e2e 全 PASS

- [ ] **Step 4: Commit**

```bash
git add src/cdp/inspect-payload-script.js
git commit -m "refactor(locator): AI 录制 elMeta 统一 5 参调用（targetKind action-aware）+ region/layers 透传"
```

---

### Task 4: 自动抓取 snap formLabel 改 DOM 取（resolve-by-label.js）

**Files:**
- Modify: `src/cdp/resolve-by-label.js:106-142`（snap 函数）
- Test: `node scripts/characterization/characterize-resolve-ambiguous-region.mjs` + `characterize-resolve-collision-titlebox.mjs` + `characterize-locator-candidates.mjs`

**Interfaces:**
- Consumes: `formItemLabel`（`resolve-by-label.js` 内已有，或 `page-locator-helpers.js` 的 `normalizeFormLabel` + `placeholderLabel`）
- Produces: `snap(el, matchedLabel, asFormField, kindHint, regionOverride)`——`formLabel` 语义从 `matchedLabel` 改为 DOM 取 `formItemLabel(root)`

- [ ] **Step 1: 改 snap 的 formLabel 取值**

`resolve-by-label.js:106-142` 中 `snap` 的 formLabel 逻辑改为：

```js
function snap(el, matchedLabel, asFormField, kindHint, regionOverride) {
  const abs = xpathOf(el);
  const rawText = cleanVisibleText(el);
  // 统一：formLabel 一律从 DOM 取真实 label（含 placeholder 回退），
  // 与 AI/人工录制同源；matchedLabel 仅用于匹配与返回展示。
  const formLabel = asFormField ? formItemLabel(el) : '';
  const loc = buildLocatorSnap(el, rawText, abs, formLabel, {
    targetKind: kindHint || undefined,
    region: regionOverride || undefined,
  });
  return {
    matchedLabel,
    formLabel: formLabel || loc.formLabel || '',
    /* 其余字段不变（:114-141） */
  };
}
```

`formItemLabel` 需在本文件 IIFE 内定义（若不存在，从 `inspect-payload-script.js:130-136` 拷贝，含 placeholder 回退）。

- [ ] **Step 2: 语法检查 + 跑 resolve 相关测试**

Run: `node --check src/cdp/resolve-by-label.js && node scripts/characterization/characterize-resolve-ambiguous-region.mjs && node scripts/characterization/characterize-resolve-collision-titlebox.mjs && node scripts/characterization/characterize-locator-candidates.mjs`
Expected: 全 PASS。若 `matchedLabel` 相关断言失败（如断言 `element.formLabel === matchedLabel`），需审查该断言语义——`matchedLabel` 仍返回，`formLabel` 改为 DOM 真实值，语义更准确

- [ ] **Step 3: Commit**

```bash
git add src/cdp/resolve-by-label.js
git commit -m "refactor(locator): 自动抓取 snap formLabel 统一 DOM 取（与 AI/人工同源）"
```

---

### Task 5: mapper.py element 组装透传 region/layers

**Files:**
- Modify: `scripts/manual_recorder/mapper.py:230-256`（element 字典组装）
- Test: `python scripts/smoke/smoke-locator-policy.py`

**Interfaces:**
- Consumes: `payload`（页内 elMeta 快照，Task 1 后含 `region_*/layers/feature_card`）
- Produces: `element` 字典新增 `region_role/region_id/region_label/region_chrome/region_section/region_block/layers/feature_card`（有值才写入，保持向后兼容）

- [ ] **Step 1: element 组装补透传**

`mapper.py:254-256`（parent_text 之后）追加：

```python
    region_fields = {
        'region_role': 'region_role',
        'region_id': 'region_id',
        'region_label': 'region_label',
        'region_chrome': 'region_chrome',
        'region_section': 'region_section',
        'region_block': 'region_block',
    }
    for dest, src in region_fields.items():
        v = payload.get(src)
        if v:
            element[dest] = v
    if isinstance(payload.get('layers'), list) and payload['layers']:
        element['layers'] = payload['layers']
    fc = payload.get('feature_card')
    if isinstance(fc, dict) and fc:
        element['feature_card'] = fc
```

- [ ] **Step 2: 语法检查 + 跑 smoke**

Run: `python -m py_compile scripts/manual_recorder/mapper.py && python scripts/smoke/smoke-locator-policy.py`
Expected: 全 PASS

- [ ] **Step 3: Commit**

```bash
git add scripts/manual_recorder/mapper.py
git commit -m "feat(recorder): mapper element 透传 region/layers/feature_card（对齐自动抓取）"
```

---

### Task 6: 新增三入口一致性 characterization 测试

**Files:**
- Create: `scripts/characterization/characterize-xpath-three-sources.mjs`
- Create: `scripts/characterization/fixtures/xpath-unify-fixture.html`
- Test: `node scripts/characterization/characterize-xpath-three-sources.mjs`

**Interfaces:**
- Consumes: `src/cdp/page-locator-helpers.js`（PAGE_LOCATOR_HELPERS 字符串）、`src/cdp/inspect-payload-script.js`（AI elMeta）、`scripts/manual_recorder/js_parts/b.py`（人工 elMeta JS 字符串）、`src/cdp/resolve-by-label.js`（snap）
- Produces: 退出码 0 = 三入口一致；非 0 = 列出不一致的节点与字段

- [ ] **Step 1: 写 fixture HTML**

创建 `scripts/characterization/fixtures/xpath-unify-fixture.html`，包含（参照现有 characterize 场景）：
- 一个 `el-form-item` 带真实 `<label>` 的 input（`<div class="el-form-item"><label class="el-form-item__label">客户名称</label><div class="el-input"><input class="el-input__inner"></div></div>`）
- 一个无 label 只有 placeholder 的 input（登录场景）
- 一个 `el-select` 控件
- 一个 `el-radio-group` 内两个 radio
- 一个 dialog（`.el-dialog`）内表单 + `.el-dialog__headerbtn` 关闭按钮
- 两个同名「保存」按钮分属不同 region（`el-card__header` 标题区分）
- 一个 `el-tabs` 内两个 `el-tabs__item`

- [ ] **Step 2: 写测试——提取三份入口源码**

```js
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');

// 1) PAGE_LOCATOR_HELPERS 字符串（唯一真源）
const helpersSrc = readFileSync(path.join(root, 'src/cdp/page-locator-helpers.js'), 'utf8');
// 2) AI elMeta 函数体
const aiSrc = readFileSync(path.join(root, 'src/cdp/inspect-payload-script.js'), 'utf8');
const aiElMeta = aiSrc.match(/function elMeta\([^)]*\) \{[\s\S]*?\n  \}/)[0];
// 3) 人工 elMeta 函数体（从 b.py 的 Python 字符串中提取）
const bPy = readFileSync(path.join(root, 'scripts/manual_recorder/js_parts/b.py'), 'utf8');
const bJsMatch = bPy.match(/function elMeta\([^)]*\) \{[\s\S]*?\n  \}/);
if (!bJsMatch) throw new Error('b.py elMeta not found');
const manualElMeta = bJsMatch[0];
// 4) 自动抓取 snap 函数体
const resolveSrc = readFileSync(path.join(root, 'src/cdp/resolve-by-label.js'), 'utf8');
const snapSrc = resolveSrc.match(/function snap\([^)]*\) \{[\s\S]*?\n    \}/)[0];
```

- [ ] **Step 3: 写测试——同一节点三入口断言一致**

```js
import { chromium } from 'playwright';
import assert from 'node:assert';

// 页内环境：PAGE_LOCATOR_HELPERS + 三个入口函数 + 辅助（xpathOf/shortLabel/formItemLabel/placeholderLabel/buXPathOf/attrs/highlightIndexOf/cleanVisibleText/normalizeTargetRoot）
// 对 fixture 中每个目标节点（用 data-testid 标记）分别调用：
//   ai:     elMeta_ai(node, textOverride, kindHint)
//   manual: elMeta_manual(node, textOverride, kindHint, undefined)
//   auto:   snap(node, matchedLabel, asFormField, kindHint, undefined)
// 断言三者的 xpath_smart / xpath_full / candidates / locator_strategy / target_kind 深相等。
```

具体实现（`characterize-xpath-three-sources.mjs`）：

```js
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(`file://${path.join(__dirname, 'fixtures/xpath-unify-fixture.html')}`);

const results = await page.evaluate(({ helpersSrc, aiElMeta, manualElMeta, snapSrc }) => {
  // 注入 helpers（以字符串求值）
  (0, eval)(helpersSrc);
  const ai = (0, eval)('(' + aiElMeta + ')');
  const manual = (0, eval)('(' + manualElMeta + ')');
  const snap = (0, eval)('(' + snapSrc + ')');
  // 若 helpers 内已有同名函数（formItemLabel/xpathOf/shortLabel/…），三份函数直接可用

  const out = [];
  const cases = [
    { sel: '[data-testid="cust-name"]', text: '客户名称', kind: 'form_input', asForm: true },
    { sel: '[data-testid="login-user"]', text: '请输入用户名', kind: 'form_input', asForm: true },
    { sel: '[data-testid="crop-select"]', text: '所属机构', kind: 'form_select', asForm: true },
    { sel: '[data-testid="radio-1"]', text: '对公', kind: 'form_radio', asForm: false },
    { sel: '[data-testid="dialog-input"]', text: '审批意见', kind: 'form_input', asForm: true },
    { sel: '[data-testid="dialog-close"]', text: 'close', kind: 'dialog_close', asForm: false },
    { sel: '[data-testid="save-1"]', text: '保存', kind: 'button', asForm: false },
    { sel: '[data-testid="save-2"]', text: '保存', kind: 'button', asForm: false },
    { sel: '[data-testid="tab-1"]', text: '基本信息', kind: 'tab', asForm: false },
  ];
  for (const c of cases) {
    const node = document.querySelector(c.sel);
    const r1 = ai(node, c.text, c.kind);
    const r2 = manual(node, c.text, c.kind, undefined);
    const r3 = snap(node, c.text, c.asForm, c.kind, undefined);
    out.push({ sel: c.sel, r1, r2, r3 });
  }
  return out;
}, { helpersSrc, aiElMeta, manualElMeta, snapSrc });

for (const { sel, r1, r2, r3 } of results) {
  for (const f of ['xpath_smart', 'xpath_full', 'candidates', 'locator_strategy', 'target_kind']) {
    assert.deepStrictEqual(r2[f], r1[f], `${sel} ${f}: manual≠ai`);
    assert.deepStrictEqual(r3[f], r1[f], `${sel} ${f}: auto≠ai`);
  }
}
console.log(`OK: ${results.length} nodes × 5 fields consistent across 3 sources`);
await browser.close();
```

（若 `manual` 的函数体内引用了 `a.py` 定义的辅助函数如 `highlightIndexOf`，则需把 `a.py` 的相关函数体也一并提取注入；实现时以运行报错为准补齐依赖注入。）

- [ ] **Step 4: 跑测试验证**

Run: `node scripts/characterization/characterize-xpath-three-sources.mjs`
Expected: `OK: 9 nodes × 5 fields consistent across 3 sources`（或等价的通过输出）

- [ ] **Step 5: Commit**

```bash
git add scripts/characterization/characterize-xpath-three-sources.mjs scripts/characterization/fixtures/xpath-unify-fixture.html
git commit -m "test(characterization): 三入口相对 XPath 一致性回归护栏"
```

---

### Task 7: 全量验证 + CHANGELOG + 收尾

**Files:**
- Modify: `CHANGELOG.md`（`[Unreleased]` 区段）
- Test: 全量验证

- [ ] **Step 1: 全量 characterization + verify-all**

Run:
```bash
node scripts/characterization/characterize-xpath-three-sources.mjs
python scripts/characterization/characterize-capture-element-xpath.py
python scripts/characterization/characterize-xpath-primary-ops.py
node scripts/characterization/characterize-live-xpath-e2e.mjs
node scripts/characterization/characterize-resolve-ambiguous-region.mjs
node scripts/characterization/characterize-locator-candidates.mjs
bash scripts/refactor/verify-all.sh
```
Expected: 全 GREEN

- [ ] **Step 2: CHANGELOG 追加条目**

在 `CHANGELOG.md` `[Unreleased]` 按格式追加：

```markdown
### Changed
- 三路径相对 XPath 统一：AI 录制 / 人工录制 / 自动抓取统一 `buildLocatorSnap` 5 参调用（targetKind action-aware）+ formLabel 统一 DOM 取（含 placeholder 回退）+ region/layers/feature_card 全量透传。人工录制 select_option/click_radio/switch_tab/close_dialog 补齐 smart locator（原仅绝对 xpath）。同一 DOM 节点三入口产出 xpath_smart/xpath_full/candidates 完全一致（新增 characterize-xpath-three-sources.mjs 回归护栏）。Python 同步提示：mapper.py element 新增 region/layers/feature_card 透传；offline 重建链不变。
```

- [ ] **Step 3: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs(changelog): 三路径相对 XPath 统一（含 Python 同步提示）"
```

---

## Self-Review

**Spec 覆盖对照：**
- 3.1 统一调用规范 → Task 1/3（5 参 + normalizeTargetRoot 由 buildLocatorSnap 内部承担，调用前归一已在 pushUnique/snap 侧，AI/人工传原始 node 由内部归一——与 spec 一致）
- 3.2 targetKind 映射表 → Task 2/3（人工 4 弱 action + AI 各分支传 kindHint；generic click 保持内部探测）
- 3.3 formLabel 统一 DOM 取 → Task 2（a.py formItemLabel 补回退）+ Task 4（snap 改 DOM 取）
- 3.4 字段透传清单 → Task 1/3/5
- 3.5 人工 4 类弱 action → Task 2
- 3.6 Python mapper 对齐 → Task 5（offline 链不改）
- 3.7 一致性测试 → Task 6
- 非目标（Node 后处理不动 / L1c 现状 / 不合并入口）→ 无对应任务，符合

**占位符扫描：** 无 TBD/TODO；Step 3 中"实现时以运行报错为准补齐依赖注入"为明确的执行指引，非占位。

**类型一致性：** `elMeta(el, textOverride, kindHint, regionOverride)`（Task 1）与 Task 2/3 调用处一致；`snap(el, matchedLabel, asFormField, kindHint, regionOverride)`（Task 4）保持原签名；`formItemLabel(node)`（Task 2/4）语义一致。
