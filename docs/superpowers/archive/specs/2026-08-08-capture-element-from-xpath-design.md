# Design: Capture element from write xpath (element ≡ params)

**Date:** 2026-08-08  
**Status:** Implemented — plan at `docs/superpowers/archive/plans/2026-08-08-capture-element-from-xpath.md`  
**Backlog:** T3 in `docs/superpowers/backlog-visible-editable-controls.md`  
**Related:** xpath-primary Phase A/B (done); params-first replay (done); form-scan Source B (done)

## Problem

On successful fill/select (especially table Source B), **params** store the correct relative `xpath_smart` from scan/resolve, but `_capture_element(page, label)` still runs `JS_SMART_LOCATOR(label)`, which regenerates a **form-item** xpath into **element**. Replay historically preferred element → table steps miss or false-ok. Replay now prefers params; dual-write remains a recording defect.

## Goals

1. When a write path has `xpath_smart`, persist the **same** value on `element.xpath_smart`.
2. Derive `xpath_full` from the **DOM node** hit by that xpath (`absXPath(node)`), not from label→smart generation.
3. Change `_capture_element` so it **never** calls `JS_SMART_LOCATOR` on the success path that stamps smart xpath.

## Non-goals

- Historical MySQL/DB backfill of old `element_json`
- Changing product replay read order (already params-first)
- Full-page **α 业务控件** inventory（T4 → `2026-08-09-scan-editable-summary`；不是裸 DOM）
- Renaming actions to `control_*`
- Writing both `xpath_full` and `xpath_abs` (canonical absolute field is **`xpath_full` only**)

## Decisions (locked)

| Topic | Choice |
|-------|--------|
| Scope | All write paths that already have `xpath_smart` + API change to `_capture_element` |
| Approach | Capture API takes xpath + stamps from the write-hit node (approach 1) |
| No `xpath_smart` | Do not blind-generate smart; return `None` |
| Absolute path | From DOM node via `absXPath`; field name **`xpath_full` only** (no `xpath_abs`) |
| Node source | The node used for this write (xpath evaluate / trigger) |

## Architecture

```
resolve / scan → xpath_smart
       ↓
write JS_*_BY_XPATH (node N)
       ↓
_capture_element(page, label, xpath_smart=xp, target_kind=…)
       ↓  evaluate(xp) → N
       ↓  xpath_smart = xp (verbatim)
       ↓  xpath_full  = absXPath(N)
       ↓
_record_action(params{xpath_smart: xp}, element{xpath_smart: xp, xpath_full, …})
```

**Invariant:** `params.xpath_smart == element.xpath_smart` whenever both are present after a successful xpath-based write.

## API: `_capture_element`

```python
async def _capture_element(
    page,
    label_text,
    *,
    xpath_smart: str = "",
    target_kind: str = "",
) -> dict | None:
```

| Input | Behavior |
|-------|----------|
| `xpath_smart` non-empty | `page.evaluate(JS_CAPTURE_FROM_XPATH, …)` → dict with `xpath_smart`, `xpath_full`, tag/attrs/text/`formLabel`; **no** `JS_SMART_LOCATOR` |
| `xpath_smart` empty | Return `None` (no blind smart) |

### `JS_CAPTURE_FROM_XPATH` (new snippet)

- Resolve node by `xpath_smart` with the same visibility / dialog-last preferences as fill/select helpers.
- `xpath_full = absXPath(node)` (reuse existing helper in snippets / locator helpers).
- Do **not** call `JS_SMART_LOCATOR` or label→`.el-form-item` `buildLocatorSnap` smart generation.
- Do **not** set `xpath_abs` (readers already fall back `xpath_full || xpath_abs`).
- Optional `candidates`: only the stamped smart + full, if needed for schema compatibility.

### Errors

| Case | Result |
|------|--------|
| Empty xpath | `None` |
| Evaluate 0 hits | `None` (params may still carry xpath; write may already have succeeded) |
| Multi-hit | Same visible / last-host policy as `JS_FILL_BY_XPATH` |

## Call sites

Pass the xpath used for the write into capture:

- `fill_form_field` / `fill_date_field` / `select_option` / `click_radio` — `resolved.xpath_smart`
- `_execute_round` success path — round `xpath_smart`
- Tree misclassification fallback — only if xpath known; else `element=None`
- Audit remaining `_capture_element(page, label)` call sites; update or accept `None`

## Verification

1. Characterization `characterize-capture-element-xpath.py`:
   - Source: capture path with xpath must not reference `JS_SMART_LOCATOR`
   - Element shape: `xpath_smart` equals input; has `xpath_full`; **no** `xpath_abs` key required
   - Empty xpath → `None`
2. Regression: `characterize-xpath-primary-ops`, `characterize-form-scan-control-first`, `characterize-xpath-fill-select`
3. Optional CDP: one table fill/select record → `element.xpath_smart == params.xpath_smart`

## Follow-ups (out of this cut)

- T4 inventory（α；见 `2026-08-09-scan-editable-summary`）
- T1r tree/`no-tree-component` label fallbacks
- Optional later: stop reading `xpath_abs` entirely once writers are clean
