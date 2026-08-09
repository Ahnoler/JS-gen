# XPath-primary control ops (+ semantic label) — Design

**Date:** 2026-08-07  
**Status:** Implemented — plan at `docs/superpowers/archive/plans/2026-08-08-xpath-primary-control-ops.md`  

**Note:** `docs/` is gitignored in this repo; this file is local-only (same as prior superpowers specs).  
**Related:** `2026-08-07-control-ops-section-closed-loop-design.md` (xpath-first fill/select landed; label DOM fallback still present).

## Problem

Visible editable controls are still often located by **label text in the DOM** (`.el-form-item` / `JS_FILL_FORM_FIELD` / `JS_FIND_LABELED_*`). Labels are unreliable:

- Table controls use composite names (e.g. `业务往来及使用|指标值`) while the Agent passes short labels → `label-not-found`.
- Duplicate display names map to **different relative xpaths** (body vs fixed column).
- Some controls have **no usable label**; placeholder (e.g. 用户名 / 密码) carries the semantic meaning for value generation.

Scan already records `xpath_smart` and assistants often resolve it, but write paths still **fall back to DOM label search**, and the Agent contract is still label-primary.

## Goals

1. **Locate & operate by relative xpath (`xpath_smart`)** for visible editable controls.
2. **Keep label (semantic name) for value generation** — `match_rule`, LLM, recording display — not for DOM lookup.
3. **Scan records and exposes** `{xpath_smart, display_label}` pairs to Agent / task / assistant summaries.
4. **Two-phase delivery (approach C / resolve-gate):**
   - **Phase A:** Execution hard-cut — no DOM label locate fallback after resolve.
   - **Phase B:** Agent contract — optional `xpath_smart` param; exact unique semantic label may resolve; ambiguous → refuse.

## Non-goals

- Renaming public actions to `control_*`.
- Fuzzy short-label matching (e.g. `业务往来及使用` ↛ `业务往来及使用|指标值`).
- Large rewrite of login hardcoded `JS_FILL_FORM_FIELD(['用户名', …])` paths.
- `CTRL.selectOption` lazy-load parity (dropdown scroll-to-load more options in `src/ctrl-actions.js`; separate track — product `JS_SELECT_OPTION` already has lazy scroll).
- Full-page Agent DOM inventory redesign（→ **T4** α 业务控件；见 `2026-08-09-scan-editable-summary`；不是裸 DOM）。

## Approach (chosen)

**Resolve gate + xpath-only execute.**

Shared `_resolve_control(label, xpath_hint="")` → `{xpath_smart, label}` or error code. All write `page.evaluate` calls use xpath-only helpers. Label rides along for rules / recording / task done.

Rejected alternatives:

- Rename APIs to `control_fill(xpath, label)` — breaking, conflicts with prior non-goal.
- Soft JS-only preference while Python stays label-primary — leaves Agent short-label / ambiguity bugs.

## Responsibilities

| Key | Used for | Not used for |
|-----|----------|--------------|
| **Relative xpath (`xpath_smart`)** | Locate, click, fill, replay | Value generation / `form_rules` |
| **Semantic label (`display_label`)** | Assistant/LLM, `match_rule`, recording display, task text | DOM text search for the control |

Public action names unchanged: `fill_form_field`, `select_option`, `fill_date_field`, `click_radio`, …  
Phase B adds optional `xpath_smart` argument where missing.

## Semantic label (placeholder fallback)

At scan time:

```
display_label = (label non-empty) ? label : placeholder
```

If both empty, keep existing fallbacks (column header / kind / etc.).

Assistant, `match_rule`, task list, and `_resolve_control` **exact match** all use this single synthesized name. No second resolve channel on raw placeholder (avoids dual-key ambiguity). **Option A.**

## Resolve rules

`_resolve_control(label, xpath_hint="")`:

1. If `xpath_hint` non-empty → use it. Optionally reverse-lookup scan for the same xpath to refresh `display_label`; if none, keep caller label.
2. Else exact-match `display_label == label` among current scan + task items that have `xpath_smart`:
   - **0** → `xpath-not-found`
   - **1** → that xpath
   - **≥2 with distinct xpaths** → `ambiguous-label` (caller must pass `xpath_smart`) — **Option 1**
   - **≥2 with identical xpath** → treat as unique

**Forbidden:** DOM label search; fuzzy label matching.

On successful write: `mark_done` / recorded params include both `label_text` and `xpath_smart` when available.

### Error codes (Agent-visible)

| Code | Meaning |
|------|---------|
| `xpath-not-found` | No hint and no exact semantic label→xpath in scan/task |
| `ambiguous-label` | Same semantic label maps to multiple xpaths |
| Existing (`xpath-miss`, `*-disabled`, …) | Xpath resolved but node not operable |

## Phases

### Phase A — Execution hard-cut (first)

- Assistant / internal write paths for input / select / date / radio / checkbox: resolve then **xpath-only** evaluate.
- Remove locate fallbacks via `JS_FILL_FORM_FIELD` / `JS_FIND_LABELED_*` (and equivalents) on those success paths.
- Scan writes synthesized `display_label`; assistant still generates values from label + rules.
- Characterization: no label-DOM locate on success path; ambiguous → `ambiguous-label`.

### Phase B — Agent contract

- Actions accept optional `xpath_smart`.
- Update `scripts/prompts/agent-prompt.md`: prefer xpath from scan/task; on `ambiguous-label`, must pass xpath.
- Recording params prefer both keys.

## Data flow

```
scan_visible_fields / Source A+B
  → per field: xpath_smart + display_label(=label||placeholder) + kind + section_*
  → task list / assistant summary (Agent-visible pair)

value gen:  display_label → match_rule / LLM → value
write:      _resolve_control(label?, xpath?) → xpath_smart
            → JS_*_BY_XPATH (no DOM label locate)
record:     params include label_text + xpath_smart
```

Scan continues to **persist relative xpath**; Agent is expected to **see and prefer** it. Label remains required so the assistant knows *what* value to generate when it only had an xpath.

## Success criteria

- Same-named table controls do not cross-fill when xpath differs.
- Controls with placeholder-only semantics still get sensible generated values.
- Agent calling only an ambiguous label gets `ambiguous-label`, not a blind click.
- After Phase A, write success paths do not locate via DOM label helpers.

## Testing

1. Synthesized label: empty label + placeholder → scan name = placeholder.
2. Unique exact label, no xpath arg → resolve + xpath fill OK.
3. Same label, two xpaths → `ambiguous-label`, no click.
4. Characterization / source: success path does not call `JS_FILL_FORM_FIELD` / `JS_FIND_LABELED_*` for locate.
5. Assistant action payloads include both label and `xpath_smart`.

## Out of scope reminders

- Login hardcoded fills: leave for a later pass unless they block Phase A tests.
- `CTRL.selectOption` lazy-load: product path already scrolls dropdown to load options; CTRL injection parity is separate.
