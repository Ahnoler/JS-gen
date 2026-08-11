# Control ops closed loop (+ section chunks) — Design

**Date:** 2026-08-07  
**Status:** Implemented — plan at `docs/superpowers/archive/plans/2026-08-07-control-ops-section-closed-loop.md`  
**Note:** `docs/` is gitignored in this repo; this file is local-only (same as prior superpowers specs). E2E dump: `.superpowers/sdd/cdp-e2e-sections.json`

## Problem

Filling / verifying / clicking is still mentally and often mechanically bounded by **`.el-form-item`**, not by **visible editable/operable controls** in the current container.

Concrete gaps (评级申请 CDP E2E, 2026-08-07):

| Collapse section | What is operable | Gap today |
|------------------|------------------|-----------|
| 评级基本情况 | 14 form-items, all disabled | OK to skip fill |
| 征信信息 | Table **radio×4**; action buttons | Source B skips radio groups |
| 评级等级测算 | Table **input×7 + select×18**; 模拟/测算/**暂存** | Scan Source B partial; assistant historically only saw ~3 form fields |
| 系统评级结论 | Few editable form fields; **保存** | |
| 客户综合评价 | Few editable form fields; **保存** | |
| (root) | 下一步 / 返回 | Outside collapse |

Two visible **「保存」** buttons live in **不同 collapse**（系统评级结论 vs 客户综合评价）. Global `click_save('保存')` cannot safely pick one. Models also lack a **section-chunked** inventory, so same-named buttons are ambiguous in planning.

Control-first scan + xpath-first fill/select landed for input/select in tables, but:

- Table kinds are not aligned with form-item (`date` / `radio` / `checkbox` incomplete).
- Date / radio / checkbox write paths still prefer label + `.el-form-item`.
- Scan summary is flat; no `section_*`; `click_save` has no section disambiguation.

## Goals (this iteration)

1. **Operational closed loop:** Every control kind the scan emits can be written via **xpath-first** (input / select / date / radio / checkbox as applicable). API **names** stay (`fill_form_field`, `scan_form_fields`, `click_save`, …).
2. **Source B kind parity:** `el-table` discovery aligns with form-item classify (at least date, radio, checkbox groups, plus existing input/select/textarea).
3. **Section chunks inside current container:** Attach `section_id` / `section_title` to fields and buttons so the model sees blocks (e.g. 评级等级测算 vs 系统评级结论).
4. **Button disambiguation:** `click_save(button_text, section='')` scopes by section; ambiguous multi-match **must not** click blindly.
5. **Model-facing summary:** Scan / assistant returns section-grouped summary + `ambiguous_buttons`.

## Non-goals

- Renaming the public action surface to “control_*”.
- Full-page scan outside `JS_GET_CONTAINER`.
- Custom non-`el-table` grids.
- Hard-coding 「暂存」 into `click_save` (use `button_text` + `section`).
- Forcing 下一步/返回 into `click_save` (remain navigation / other actions; may appear under `section_id=__root__` in scan only).
- Fixing empty row-leading text naming for all table radios (may drop; column-header naming is future).

## Architecture

Approach: **control-centric discovery + section attach** (build on control-first).

```
JS_GET_CONTAINER
  ├─ Source A: .el-form-item controls
  ├─ Source B: el-table editable cells (kind-aligned)
  ├─ Source C: visible buttons (not auto-fill pending)
  ├─ attach section (nearest collapse / tab / card)
  ├─ attach xpath_smart + displayName
  └─ → ScannedControl[] → TaskList / snapshot / assistant summary / replay
                            ├─ fill|select|date|radio|… (xpath-first)
                            └─ click_save(section|xpath) (scoped)
```

Dedup key for fields remains **relative `xpath_smart`**. Buttons are a separate list (not deduped against fields).

## Data model

Extend scan field objects (conceptual `ScannedControl`; keep JSON compatible with `ScannedField` + new keys):

| Field | Meaning |
|-------|---------|
| `label` / displayName | Human/LLM name (existing table row rules) |
| `kind` | `input` / `select` / `date` / `radio` / `checkbox` / `textarea` / … (buttons live in `buttons[]`, not `fields[]`) |
| `xpath_smart` | Relative operable locator (execute + field dedup) |
| `section_id` | Stable block key (normalized title + collision suffix) |
| `section_title` | Readable block title |
| `disabled` / `currentValue` / `options` / … | Existing |

Buttons are **not** mixed into `fields[]` for `TaskList.from_scan`. Scan result shape:

- `fields[]` — editable controls only (form-item + table), each with `section_*` + `xpath_smart`
- `buttons[]` — visible operable buttons with `label`, `section_*`, `xpath_smart` (also rolled into `sections[].buttons` for the model summary)

## Section attachment rules

Nearest ancestor wins:

| Priority | DOM | `section_title` |
|----------|-----|-----------------|
| 1 | `.el-collapse-item` | `.el-collapse-item__header` visible text (strip icon noise, ≤40 chars) |
| 2 | `.el-tab-pane` (visible tab) | Matching tab label |
| 3 | `.el-card` | `.el-card__header` if present |
| 4 | none | `section_title=""`, `section_id="__root__"` |

- Nested collapse: **innermost** only.
- Hidden collapse content: follow existing visibility / `quick` rules; do not expose hidden save buttons as operable.
- E2E validates collapse titles on this page match product language (评级基本情况, 征信信息, 评级等级测算, 系统评级结论, 历年评级情况, 客户综合评价).

## Source B kind parity

| kind | Table cell cues |
|------|-----------------|
| `input` / `textarea` | Existing |
| `select` | Existing `.el-select` |
| `date` | `.el-date-editor` / datepicker classes — **collect**, not only classify |
| `radio` | `.el-radio` group → one control + options (do not skip `input[type=radio]` only) |
| `checkbox` | `.el-checkbox` group similarly |

Keep exclusions: pager rows, hidden, quick-invisible, empty row-leading text drop (same as control-first). E2E note: some 征信 radio rows have empty `rowText` — they may be dropped until naming improves.

## Execution

### Fields (xpath-first)

| kind | Path |
|------|------|
| input / textarea | `JS_FILL_BY_XPATH` (exists) |
| select | `JS_SELECT_TRIGGER_BY_XPATH` + option (exists) |
| date | xpath-scoped date fill (new or shared helper); no form-item-only primary |
| radio / checkbox | resolve group via xpath, then click option by text |

Fallback: if no `xpath_smart`, keep legacy label / `.el-form-item` behavior for old trajectories.

### `click_save(button_text='保存', section='')`

Resolution order (v1 — **no** implicit “active section” state):

1. If `section` set → search only inside that section’s content for a visible button matching `button_text`.
2. Else if exactly **one** visible match in container → click it.
3. Else if **≥2** matches → **do not click**; return error listing `{ section_title, text }` candidates.
4. If section set but missing / no matching button → error listing buttons actually present in container (and in that section if found).

「暂存」 under 评级等级测算 is `click_save('暂存', section='评级等级测算')` — not a special-case synonym for 保存.

## Model-facing summary

Scan / assistant should expose section-grouped structure, e.g.:

```json
{
  "container": "main",
  "sections": [
    {
      "section_id": "评级等级测算",
      "section_title": "评级等级测算",
      "fields_total": 25,
      "fields_editable_pending": 22,
      "fields_sample": ["资产负债率", "发展前景"],
      "buttons": ["模拟", "测算", "暂存"]
    },
    {
      "section_id": "系统评级结论",
      "section_title": "系统评级结论",
      "fields_total": 8,
      "fields_editable_pending": 2,
      "buttons": ["保存"]
    }
  ],
  "ambiguous_buttons": [
    {"text": "保存", "sections": ["系统评级结论", "客户综合评价"]}
  ]
}
```

## Error handling

| Case | Behavior |
|------|----------|
| xpath miss | Clear err; optional one label fallback; stop if still failing |
| ambiguous save, no section | No click; return candidates |
| bad section / missing button | Err + list buttons in container/section |
| disabled control | In scan; skip auto-fill |
| empty table row name | Drop from scan (existing rule) |

## Compatibility

- Classic el-form-only pages: Source A + `__root__` or single collapse; behavior should not regress.
- Old logs without xpath / section: label fallback; `click_save` without section still works when unique.
- Snapshot fingerprint: keep xpath-based identity; section is advisory/display (optional fingerprint later — not required for v1).

## Testing

1. **Characterization:** scan emits `section_*`; Source B includes table radio when named; multi-「保存」 without section does not click and returns candidates; with `section` clicks scoped control.
2. **CDP E2E (this rating page):**
   - 评级等级测算 editable table count ≫ form-item-only (~3).
   - xpath fill ≥1 table input and ≥1 table select.
   - `click_save('保存')` → ambiguous list of two sections.
   - `click_save('保存', section='系统评级结论')` → only that button.
3. **Regression:** pure form page scan/fill unchanged.
4. Optional: `click_save('暂存', section='评级等级测算')` smoke.

## Relationship to prior work

- **Keeps:** control-first Source A/B, xpath dedup, xpath-first fill/select for input/select, container scope.
- **Extends:** section metadata, button inventory, Source B kinds, date/radio/checkbox xpath write, `click_save` section API, sectioned summaries.
- **Deferred → backlog:** full-page **α 业务控件** inventory = **T4**（P0=`scan_editable_summary`）；rename = T7；non-el-table = T5；empty-row naming = T6。不再使用「全 DOM」表述。

## Decisions log

| Topic | Choice |
|-------|--------|
| Primary goal | A — operational closed loop; API names unchanged |
| Write coverage | B — all scanned kinds xpath-first |
| Table discovery | B — Source B kind-aligned with form-item |
| Container | A — current `JS_GET_CONTAINER` only |
| Sections + multi-save | Same iteration (scan sections + scoped click) |
| Approach | 1 — control-centric + section attach (not separate section-tree action first) |
