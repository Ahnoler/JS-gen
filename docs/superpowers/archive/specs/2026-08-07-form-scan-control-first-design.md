# Form scan: control-first (+ el-table) — Design

**Date:** 2026-08-07  
**Status:** Implemented (2026-08-07) — plan at `docs/superpowers/archive/plans/2026-08-07-form-scan-control-first.md`
**Trigger:** Trajectory/recording on 评级等级测算 — `run_form_assistant` only filled 3 `.el-form-item` fields; ~40 editable table cells were invisible to scan.

## Problem

Current `JS_SCAN_FORM_FIELDS` is **form-item-centric**: it only walks `.el-form-item`. Element UI standard forms work; table-based editors (row label + cell input/select) are systematically missed.

Extending one special-case type per new UI does not scale. Scanning needs a clearer model: **discover editable controls, then attach a display name and a durable locator**.

## Goals (this iteration)

1. **Unified scan output** for both:
   - `run_form_assistant` batch fill
   - recording structure (`save_form_snapshot`) and replay locators
2. **First adapter:** visible Element UI `el-table` editable cells only.
3. **Display names for tables:** row-leading text; if multiple controls in a row, suffix with column header / placeholder / `#n`.
4. **Execute xpath-first:** fill/select (and assistant execution) consume relative `xpath_smart` (or equivalent) bound on the field — **not** global label string search as the primary key. Label/placeholder are for humans, LLM planning, and snapshot display.

## Non-goals (this iteration)

- Custom non-`<table>` / non-`el-table` grids
- New dedicated `fill_table_*` public actions (reuse `fill_form_field` / `select_option` with xpath-bound execution)
- Full-page DOM visibility for the main Agent (see Future TODO)
- Changing Phase Reviewer / contract schema

## Architecture

Two-phase scan inside the current container (`JS_GET_CONTAINER`):

1. **Discover** editable controls  
   - **Source A:** `.el-form-item` (existing behavior, preserved)  
   - **Source B (new):** visible `el-table` row cells — `input` / `textarea` / `.el-select`  
   - After both sources: **dedupe by relative `xpath_smart`** (one field per unique operable control)  
2. **Label + locate**  
   - Attach **displayName** (label / placeholder / row text rules)  
   - Attach **relative xpath_smart** (required for execution, replay, and dedup)

**Single export:** `ScannedField[]` (extend as needed with locator fields). Downstream unchanged in concept:

| Consumer | Uses |
|----------|------|
| `TaskList.from_scan` | pending/done from display + disabled/value |
| `save_form_snapshot` | structure fingerprint (include table fields) |
| `run_form_assistant` | plans by display name; **executes via field xpath** |
| Replay | prefers recorded `xpath_smart` |

```
container
  ├─ discover form-items  ──┐
  └─ discover el-table     ─┼─→ ScannedField{ displayName, kind, value, disabled, xpath_smart, ... }
                            └─→ task_list / snapshot / assistant / replay
```

## Table display-name rules

1. Primary name = visible **row-leading / first-column text** (e.g. `资产负债率`).  
2. One editable control in the row → displayName = row text.  
3. Multiple controls in the row →  
   - prefer `行首|列头`  
   - else `行首|placeholder`  
   - else `行首|#2`, `行首|#3` (left-to-right)  
4. Normalize whitespace; truncate long row text (≤40 recommended).  
5. **Drop** controls with empty row-leading text (no semantic name for planning; still may be reachable later via Future TODO full-DOM path).

## Dedup / noise

**Dedup key = relative `xpath_smart` (the operable control itself).**  
Visible operable controls are unique; two scan hits that resolve to the **same relative xpath** are one field — keep one (prefer Source A / form-item metadata if both fire). Do **not** dedupe primarily by displayName (labels/placeholders can collide).

> **Why xpath dedup (not displayName):** On dialogs and complex pages, **two or more controls often share the same visible name**. Example: this rating page can show two「保存」buttons — one inside the「系统评级结论」collapse, another inside the「客户综合评价」collapse. They are different operable components; relative xpath (scoped to collapse/section) keeps them distinct. DisplayName collision must not collapse them into one scan entry, and execute/replay must not click the wrong「保存」by label alone.

| Rule | Action |
|------|--------|
| Same relative xpath already emitted | skip duplicate (regardless of Source A vs B) |
| Disabled / read-only cell | include with `disabled=true` (assistant skips) |
| Pager / “page size” tool rows | exclude |
| Hidden / non-operable controls | skip (not in discover set) |
| Different xpath, same displayName | **keep both** (disambiguate via xpath at execute time; displayName may share row text + suffix) |

**Kind:** same as today — `.el-select` → select; date editor → date; else input/textarea.

## Execution: xpath-first (revision)

**Problem with label-only fill:** login and similar UIs have **no** `.el-form-item__label`; the hint lives in **placeholder** (e.g. `请输入账号`). Table cells can share display names. Global `label_text` search is the wrong primary key.

| Concern | Source of truth |
|---------|-----------------|
| Which control to operate | Relative `xpath_smart` (or bound locator) on the scanned field |
| Human / LLM / snapshot title | displayName: label → else placeholder → else row/synthetic short name |
| Legacy trajectories | Keep label fallback when no xpath is stored |

Assistant flow:

1. Scan → fields with `{ displayName, xpath_smart, kind, ... }`  
2. LLM may plan using displayName  
3. Auto-fill **must** call fill/select with the field’s xpath (API shape: extend params or internal path so controller does not re-resolve by label alone)

Placeholder-only fields (no label) **are** included in scan: displayName = placeholder; execute via xpath.

## Compatibility

- Pages with only classic el-form: behavior stays as today (Source A only effectively).  
- Old action logs without xpath: label fallback remains.  
- New scans always emit xpath for both form-item and table fields.

## Testing (must pass for v1)

1. **Characterization:** scan includes table row display names; duplicates collapsed by **relative xpath** (not by displayName alone).  
2. **CDP/E2E (评级等级测算):** editable count ≫ 3 (order of empty table cells).  
3. **Assistant:** sample table select/input writes succeed and task-done.  
4. **Regression:** pure form page (no table) scan/assistant unchanged.  
5. **Placeholder-only:** field with no label but placeholder appears in scan; fill uses xpath not label hunt.

## Future TODO → **superseded by T4**

> ~~全页 DOM~~ → 产品定稿为 **α 业务控件全集**（不是裸 DOM）。  
> 接替规格：`docs/superpowers/specs/2026-08-09-scan-editable-summary-design.md`（T4-P0 `scan_editable_summary`）+ backlog T4-P1…P4。  
> 清单**永不** auto-fill；填写由主 Agent 控制。

### Known defect TODO — `click_save` with multiple「保存」

> **`click_save` currently clicks only one save button** when the page has two or more visible「保存」controls (e.g. one under「系统评级结论」collapse and one under「客户综合评价」collapse). That is a **defect**: the wrong or only-first match may be clicked; section-scoped / xpath-bound save is needed. Track separately from this scan redesign; do not silently ignore multi-save pages.

Related: xpath-first dedup/execute above; `click_save` should eventually consume a relative xpath or scoped container, not a global first-match on button text.

## Implementation sketch (delivered 2026-08-07; Tasks 1–6)

- Extend `JS_SCAN_FORM_FIELDS` (and Python mirror cues / CTRL if needed) with Source B + xpath emission.  
- Extend `ScannedField` / snapshot field entries if locator must persist.  
- Wire `_auto_fill_pending` / fill actions to xpath-first.  
- Characterization + optional CDP script against rating page.  
- CHANGELOG if product-facing scan/replay semantics change.

## Decisions log

| Decision | Choice |
|----------|--------|
| Dual use of scan | C — assistant + record/replay |
| Table naming | A — row text (+ suffix if multiple) |
| v1 scope | A — `el-table` only |
| Approach | Control-first scan + table adapter |
| Execution key | Relative xpath first; label/placeholder for display |
| Dedup key | Relative xpath (unique operable control); not displayName — e.g. two「保存」in different collapses |
| Full-page Agent DOM | TODO only |
| `click_save` multi-button | Known defect TODO — only clicks one「保存」; needs scoped/xpath save |
