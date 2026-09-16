# Form-field intra-slot xpath Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 同一 `el-form-item` 内同族控件（保证金比例双 select / 双 input）录出唯一 `xpath_smart`，步骤展示为 `选择下拉 | 保证金比例-A`，且不改写语义 `label_text`。

**Architecture:** Live `formFieldXpathSmartOf` 用 class-token leaf，同族 ≥2 时输出 `(itemPred//leaf)[n]`；`buildLocatorSnap` 派生 `field_slot`/`display_label`。离线 `buildFormFieldXPathSmart` 对齐 leaf；`locator_occurrence` 重建 `[n]`。SPA `pickParamText` 用 `display_label` / `field_slot` 拼展示名。

**Tech Stack:** PAGE_LOCATOR_HELPERS (`src/cdp/page-locator-helpers.js`) → `node scripts/_gen_locator_helpers_py.mjs`；Playwright characterization；Vue SPA `trajectory-tree.ts`。

**Spec:** [`docs/superpowers/specs/2026-09-16-form-field-intra-slot-xpath-design.md`](../specs/2026-09-16-form-field-intra-slot-xpath-design.md)

## Global Constraints

- `label_text` / `formLabel` 永不拼 `-A`
- 不手改 `_locator_helpers_js.py`
- 字段内 pin 后 `eval` 唯一则不得被 region 清 smart
- 历史轨迹不迁移
- 新 JSDoc 只插注释不改既有行语义

---

### Task 1: Live + offline form-field leaf + intra-item pin

**Files:**
- Modify: `src/cdp/page-locator-helpers.js` (`formFieldXpathSmartOf` ~332–389, `buildLocatorSnap` return ~1714–1746)
- Modify: `src/cdp/locator-builders/controls.js` (`buildFormFieldXPathSmart` leaf ~101–152)
- Test: `scripts/characterization/cold/characterize-locator-candidates.mjs`（select/date 断言改 class-token；occurrence=2 断言）
- Test: Create `scripts/characterization/cold/characterize-form-field-intra-slot.mjs`
- Modify: `scripts/refactor/verify-all.sh` 注册新 pin
- Run: `node scripts/_gen_locator_helpers_py.mjs`

**Interfaces:**
- Consumes: `classTokenPred`, `withOccurrence`, `evalXpathAll`, `scopedXPath`
- Produces: unique `xpath_smart`; snap fields `field_slot` (`A`|`B`|…), `display_label` (`formLabel-A`), `locator_occurrence` (1-based 字段内序)

- [ ] **Step 1: Failing characterization**

Fixture 单 form-item「保证金比例」：input、el-select + hidden `el-select-dropdown`、字面「值」、第二 el-select、第二 input。`buildLocatorSnap` 两枚 `.el-select` 的 `xpath_smart` 各 `eval` 命中 1，`field_slot` 为 `A`/`B`，`formLabel` 仍为 `保证金比例`。Loose `contains(@class,'el-select')` 不得作为 exported leaf。

- [ ] **Step 2: Implement helpers**

`formFieldXpathSmartOf`：widget leaf 用 `div[${classTokenPred('el-select')}]`（date/radio/checkbox/cascader/tree 同理）。`input` 若 `eval`≥2，改 `input[not(ancestor::div[class-token el-select])]` 再 pin。`pinFormFieldFamily(expr, host)` → `withOccurrence`。`buildLocatorSnap` 从已 pin xpath 的 `)[n]` 或 family 序写 `field_slot`/`display_label`/`locator_occurrence`。

`buildFormFieldXPathSmart` 同步 tight leaf；`occurrence≥1` 时 `withOccurrence`（已有）。

- [ ] **Step 3: Regenerate Python mirror + run pins**

```bash
node scripts/_gen_locator_helpers_py.mjs
node scripts/characterization/cold/characterize-locator-candidates.mjs
node scripts/characterization/cold/characterize-locator-parity.mjs
node scripts/characterization/cold/characterize-form-field-intra-slot.mjs
```

- [ ] **Step 4: Commit** `fix(xpath): pin same-family controls inside a form-item`

---

### Task 2: Persist field_slot through recording pipelines

**Files:**
- Modify: `src/models/element.js` `copyLocatorMeta` keys
- Modify: `scripts/manual_recorder/js_parts/b.py` `elMeta`
- Modify: `scripts/manual_recorder/mapper.py` element copy
- Modify: `scripts/controller/actions/js_snippets/enrich.py`
- Modify: `scripts/controller/actions/js_snippets/base.py` JSON return
- Modify: `scripts/controller/actions/_helpers.py` `_enrich_click_element` out dict
- Modify: `scripts/models/action.py` `ElementInfo` + `to_element_json` + meta_key copy list

**Interfaces:**
- Consumes: snap `field_slot`, `display_label`
- Produces: `element_json.field_slot` / `display_label` for AI + 人工；可选 `params.field_slot` 镜像，不以 params 为权威

- [ ] Copy fields whenever locator_occurrence is copied today.
- [ ] Verify mapper + ElementInfo dump include non-empty slot only.
- [ ] Commit `fix(recording): persist field_slot and display_label`

---

### Task 3: SPA step title uses display_label / field_slot

**Files:**
- Modify: `D:\dev\ui-auto-recording-agent-vue-master\vue-project\src\utils\trajectory-tree.ts` `pickParamText` + `mapTrajectoryStep`
- Modify: `...\src\api\recording.ts` `ElementJson`
- Modify: `...\src\views\ui-recording\step-detail\index.vue` `getStepTitle` / `stepTitle` 传入 element；编辑框仍绑 `label_text`

**Interfaces:**
- `pickParamText(params, element?)`：展示 label = `element.display_label || params.display_label || (label_text + (slot ? '-' + slot : ''))`，再拼 ` = option/value` 如现有。
- 无 slot 时标题与今日一致。

- [ ] `选择下拉 | 保证金比例-A`（有 option 时 `保证金比例-A = ≤`）
- [ ] Commit on SPA repo: `fix(ui): unique step titles for in-field control slots`

---

### Task 4: Wet check on 保证金比例

Playwright MCP 已登录产品库页：对两枚 select / 两枚 input `evaluate` 新 helpers，确认 `xpath_smart` 唯一。单控件「业务产品编号」无 `field_slot`。

---

## Spec coverage

| Spec | Task |
|------|------|
| tight class-token | 1 |
| intra-item `[n]` | 1 |
| field_slot / display_label | 1–2 |
| label_text unchanged | 1–3 |
| AI + manual persist | 2 |
| SPA title | 3 |
| wet 保证金比例 | 4 |
| no history migrate | (none) |
