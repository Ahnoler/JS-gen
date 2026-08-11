# Visible Errors Done Gate — Contract-First Soft-Demotion — Design

**Date:** 2026-08-07  
**Status:** Approved (user: reuse overlay signal; no per-field error filter)  
**Related:** `2026-08-07-overlay-done-gate-design.md`

## Decision

Visible `formErrors` / error notifications use the **same** predicate as overlay:

`overlay_blocks_done(contract)`

| Contract | Errors hard-block done? |
|----------|-------------------------|
| None | Yes |
| `submit.required=true` or non-empty `success.kinds` | Yes |
| `required=false` and empty kinds | No (soft warn only) |

**Non-goal:** Filter errors by current-phase field labels.

## Implementation

- `scripts/recorder.py`: mirror overlay hard/soft branch for the errors gate
- Soft log: `visible errors present (…) but contract allows done`
- Docstring on `overlay_blocks_done` notes shared use
