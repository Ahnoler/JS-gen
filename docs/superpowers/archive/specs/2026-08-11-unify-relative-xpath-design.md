# Unify relative xpath generation — Design

**Status:** Approved (brainstorming)  
**Date:** 2026-08-11  
**Scope:** Recording contract so `params.xpath_smart` cannot diverge from DOM-authoritative relative xpath; then converge live/offline builders onto one algorithm source  
**Trigger:** Trajectory 130 — agent fill stored invented `//input[@placeholder='请输入'][1]` in `params_json` while `element_json` held correct dialog+label xpath; replay is params-first so UI looked correct and replay filled the wrong control

## Problem

Relative `xpath_smart` is produced on multiple paths today:

| Path | Role | Can write params? |
|------|------|-------------------|
| Live `formFieldXpathSmartOf` / `buildLocatorSnap` (`page-locator-helpers.js`) | Scan / manual / (should) capture | Via stamp |
| Offline `buildFormFieldXPathSmart` (`locator-builders`) | `prepareElementJson` enrich | Element only |
| Agent tool argument `xpath_smart` | Intended as inventory copy | **Historically stamped into params via resolve trust** |
| Placeholder branch (no label) | Legitimate for login-like fields | When no label |

Bug chain for traj 130:

1. Prompt pressure: always pass `xpath_smart`.
2. LLM invented placeholder+occurrence xpath (prompt forbade inventing dialog/drawer, not placeholder).
3. Old `_resolve_control` trusted any non-empty hint.
4. `_record_action` wrote `resolved.xpath_smart` into `params_json`.
5. Element capture/enrich produced durable dialog+label xpath into `element_json`.
6. Replay `_resolve_replay_xpath` prefers params → bad params win.

Additional gap: current `JS_CAPTURE_FROM_XPATH` **echoes** the write xpath (`xpath_smart: xp`) instead of rebuilding durable xpath from the hit node. `stamp_recorded_xpath_smart` therefore cannot heal invented hints when capture only echoes.

## Goals

1. **Recording hard contract:** After a successful form write is recorded, `params.xpath_smart === element.xpath_smart` (both DOM-authoritative relative xpath), or params is empty when rebuild failed — never LLM-invented weak xpath.
2. **Agent hint = lookup only:** Tool `xpath_smart` may select an inventory entry; it must not be persisted unless it exactly matches inventory (or is replaced by capture rebuild).
3. **Single algorithm source (phased):** Live `page-locator-helpers.js` is canonical; offline builders converge to the same rules.
4. **Replay unchanged:** Keep params-first; fix recording so params are correct.

## Non-goals

- Changing replay priority to prefer element over params.
- Removing `xpath_smart` from agent tool schemas.
- Product API for bulk historical traj repair (ops script only).
- Merging CTRL injection and locator helpers into a third mega-bundle.
- Full Python control-plane sync of scripts-only changes (scripts/ stay JS-gen local).

## Decisions (from brainstorming)

| Topic | Choice |
|-------|--------|
| Overall | Phase A (params gate) then Phase B (unify implementation) |
| Agent `xpath_smart` | Keep as **inventory lookup key** only |
| Canonical source | `src/cdp/page-locator-helpers.js` |
| Delivery | One design, two implementation milestones |
| Approach | Recording gate first (M1), then source unification (M2) |

## Architecture

### Hard contract

1. `params.xpath_smart` and `element.xpath_smart` are **same-origin**: scan, capture rebuild, or manual snap — never raw LLM strings.
2. Agent `xpath_smart` is **lookup-only** against `_scan_fields` / `task_list`. Miss → discard hint; use unique label inventory or label-DOM write path. Do not persist unverified hints.
3. Replay remains **params-first**; correctness is enforced at record time.

### Target recording flow (M1)

```text
LLM hint ──lookup──► inventory xpath? ──yes──► write xpath
                         │ no
                         ▼
                   label inventory / label DOM
                         │
                         ▼
              capture: hit node → rebuild durable xpath
                         │
            ┌────────────┴────────────┐
            ▼                         ▼
   element.xpath_smart          params.xpath_smart
            └────────── must be equal ──────────┘
```

### Authoritative source by milestone

| Milestone | Source of durable relative xpath |
|-----------|----------------------------------|
| M1 | Live helpers (`formFieldXpathSmartOf` / `buildLocatorSnap`); capture **must rebuild**, never echo write xpath |
| M2 | Same helpers as sole algorithm; Node `locator-builders` become thin/shared; Python `PAGE_LOCATOR_HELPERS` stays generated |

## Milestone 1 — Recording gate (stop the bleeding)

### Resolve

- Hint in inventory → use that inventory xpath for write.
- Hint not in inventory → **discard**; unique label inventory → use it; else `xpath-not-found` / `ambiguous-label` (or existing non-strict label-DOM fallback for write only).
- **Forbidden:** treating invented hint as `resolved.xpath_smart` for **persistence** when inventory is empty. If write used label-DOM, `params.xpath_smart` may only come from subsequent capture rebuild; if rebuild fails, params xpath is `""` (empty preferred over dirty).

### Capture rebuild

- `JS_CAPTURE_FROM_XPATH`: locate node via write xpath (+ label disambiguation), then rebuild with `formFieldXpathSmartOf` / equivalent `buildLocatorSnap` host path.
- Return rebuilt `xpath_smart` + candidates; do not set `xpath_smart: xp` echo.

### Stamp

- `params.xpath_smart = stamp(capture.xpath_smart)`; fallback only if capture missed **and** fallback was inventory-validated.
- Manual mapper: keep params stamp + dialog/drawer overlay scope aligned with auto (no `[last()]`).

### Weak xpath (must not be final params when a durable alternative exists)

- Placeholder-only without `el-form-item` label anchor (when the field has a real label).
- Occurrence-only patterns like `//input[...][n]`.
- If params ≠ element after stamp, **overwrite params from element** (rebuild wins).

### Prompt (secondary)

- State explicitly: copy scan/pending `xpath_smart` verbatim; inventing any xpath (including placeholder) is forbidden. Does not replace code gates.

### Historical repair

- Keep ops script `scripts/characterization/repair-traj-params-xpath.py` (weak/empty params ← durable element; optional dialog wrap when siblings are scoped). Not a product API.

### Characterization (M1)

- Resolve discards invented hint when inventory exists.
- Capture rebuild ≠ echo of write xpath.
- Successful fill: `params.xpath_smart == element.xpath_smart`.
- Weak xpath cannot be the final stamped params when rebuild produced a durable label xpath.

## Milestone 2 — Single algorithm source

### Canonical

- `src/cdp/page-locator-helpers.js` owns predicates and scope (`scopeOf`, `scopedXPath`, `formFieldXpathSmartOf`, `buildLocatorSnap`, …).
- Python `PAGE_LOCATOR_HELPERS` continues via `_gen_locator_helpers_py` (or equivalent); **no hand-edits** to the generated copy.
- `src/cdp/locator-builders/*` converges: shared module or generated parity; no independently evolving form-field formula.

### In scope

- Form-control relative xpath (label, placeholder-when-no-label, dialog/drawer scope) parity across scan / capture / offline enrich / manual offline fallback.
- Characterization locking same inputs → same outputs for live helpers vs offline builders.

### Out of scope

- Replay params-first change.
- Removing agent `xpath_smart` argument.
- Bulk traj migration product API.
- Unifying CTRL scripts with helpers.

### Errors

- Lookup miss → explicit error codes; never silently keep invented hint for params.
- Capture rebuild fail → empty params xpath or xpath_full only; never fall back to LLM hint.
- M2 live vs offline mismatch → failing characterization; block merge.

## Testing strategy

| Layer | Coverage |
|-------|----------|
| Characterization | Resolve, capture rebuild, params≡element, helpers↔builders parity |
| Wet (CDP 9242) | Dialog with two fields sharing `请输入`; after fill, params is dialog+label for the named field |
| Regression | `characterize-live-xpath-e2e`, `characterize-manual-dialog-scope`, existing xpath-primary / fill-select tests |

## Success criteria

- **M1:** New recordings cannot persist weak placeholder-occurrence `params.xpath_smart` when the field has a form label and rebuild/inventory produced a durable xpath.
- **M2:** Changing helpers once updates (or regenerates) scan, capture, offline enrich, and manual paths; characterization proves parity.

## Compatibility

- Existing trajs with dirty params: repair via ops script; new code does not rewrite DB automatically.
- Assembled Playwright replay (deprecated) unchanged.
- Feature flag `XPATH_SMART_FILL_ONLY` remains orthogonal (strict write vs label fallback); persistence rules above still apply.

## Implementation notes (for planning)

- Prefer extending current WIP (`_resolve_control` inventory prefer, `stamp_recorded_xpath_smart`, manual overlay scope) rather than parallel systems.
- M1 must fix capture echo before relying on stamp-from-capture.
- Do not weaken replay params-first as a shortcut.
