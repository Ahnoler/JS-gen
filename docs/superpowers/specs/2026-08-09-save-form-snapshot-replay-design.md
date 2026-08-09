# Design: T10 — `save_form_snapshot` replay (form-structure checkpoint)

**Date:** 2026-08-09  
**Status:** Implemented P0 — plan at `docs/superpowers/plans/2026-08-09-save-form-snapshot-replay-p0.md` (P1 still pending)  
**Backlog:** T10  
**Related:** `form-structure-heal.js` Type B；`JS_VERIFY_FORM_STRUCTURE`；`replay-batch-runner.js`；T4 Source B inventory

## Problem

Product `steps/replay` treats recorded `save_form_snapshot` as a Type B form-structure checkpoint. When live verify is unsafe (`container_not_found`, count collapse, mass missing, …), the handler returns `aborted: true` and the batch runner **ends the entire replay**. Users see checkpoint steps “直接回放失败” and lose remaining steps.

Root causes stack:

1. **Abort-on-unsafe** (P0) — soft structural mismatch should not kill the batch.
2. **Verify ≠ record scan** (P1) — verify only walks `.el-form-item`, while snapshots can include Source B table labels → false collapse into unsafe.

## Goals

1. **P0:** Unsafe / `container_not_found` checkpoints mark the step failed (`confirmed=0`) but **do not abort** the replay batch (A2).
2. **P0:** Still never mutate trajectory/snapshot on unsafe paths.
3. **P1 (spec only this cycle):** Align verify field set with recording scan (Source A+B at minimum) so false unsafes drop; implement in a later plan.
4. Keep user abort, transport timeout, and Type B heal-failure abort behavior unchanged in P0.

## Non-goals (P0)

- Changing `JS_VERIFY_FORM_STRUCTURE` / CTRL `verifyFormStructure` scan surface (→ P1)
- Relaxing `assessFormStructureDiffSafety` thresholds
- Skipping Type B heal when diff is safe and `needsTypeB`
- Treating unsafe as success / `confirmed=1`
- T5 custom grids; MCP a11y

## Decisions (locked)

| Topic | Choice |
|-------|--------|
| Delivery | **2** — one T10 spec with **P0=A / P1=B**; implement **P0 only** this round |
| Soft-fail semantics | **A2** — `confirmed=0` / failed step, batch continues |
| P0 approach | **1** — only unsafe / `container_not_found` stop aborting; heal fail / timeout / userAbort still abort |
| P1 | Document intent; separate implementation plan later |

## Architecture

### P0 — unsafe does not abort

```
handleFormStructureCheckpoint
  … verify …
  safety = assessFormStructureDiffSafety(report, snap)
  if safety.unsafe:
      markStepReplayFailed(stepId)
      emit replay:step status=failed (reason)
      return { ok: false, aborted: false, error, results }  // was aborted: true
      // no delete / no snapshot rewrite / no heal

replay-batch-runner (save_form_snapshot branch)
  if typeB.userAbort → finish aborted
  if typeB.aborted → finish (unchanged paths)
  if !typeB.ok && !typeB.aborted:
      failedStepIds.push(stepId)
      allResults.push(...); continue   // NEW
  if typeB.ok → successCount++; continue
```

### P1 — verify alignment (later)

- Live actual labels from same control surface as recording: Source A (`.el-form-item`) **+ Source B** (`el-table` editable cells / display names).
- Keep container scoping (`main` / `drawer:` / `dialog:`).
- Keep safety guards; do not widen thresholds as a substitute for better scans.
- Parity: Agent `JS_VERIFY_FORM_STRUCTURE` and CTRL `verifyFormStructure`.

## Verification (P0)

| Check | Pass |
|-------|------|
| heal unsafe return | `aborted === false`, `ok === false`; still failed step emit |
| runner | source cue or unit: `!ok && !aborted` continues batch |
| no mutate on unsafe | no `removeById` / `updateFields` / heal on that branch |
| regression | userAbort / heal failure / timeout still abort |
| char | extend `characterize-form-snapshot-trigger.mjs` (or sibling) with P0 cues |

## Errors / edges

| Case | P0 behavior |
|------|-------------|
| No bound snapshot | Unchanged skip-success |
| Unsafe / container_not_found | Failed step; continue batch |
| Safe, no Type B need | Success (unchanged) |
| Safe, needs Type B | Heal path unchanged (may still abort on heal fail) |
| User stop | Abort (unchanged) |

## Phasing

| Phase | Deliverable | This cycle |
|-------|-------------|------------|
| **P0** | Abort-on-unsafe → A2 continue | **Yes** |
| **P1** | Verify scan ≡ record (A+B) | Spec only |

## Follow-ups

- Implement P1 after P0 ships and false-unsafe rate is measured
- Optional: product UI copy distinguishing soft checkpoint fail vs hard abort
