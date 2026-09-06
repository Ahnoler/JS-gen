# T10-P0 save_form_snapshot unsafe continue Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When form-structure checkpoint verify is unsafe / `container_not_found`, mark the step failed (`confirmed=0`) but do **not** abort the replay batch so later steps still run.

**Architecture:** Change `handleFormStructureCheckpoint` unsafe return from `aborted: true` to `aborted: false`. Update `replay-batch-runner` to record `failedStepIds` and `continue` when `!ok && !aborted`. Extend form-snapshot characterization cues. P1 verify alignment is out of this plan.

**Tech Stack:** Node.js control-plane (`src/services/trajectory/*`); characterization `.mjs`.

**Spec:** `docs/superpowers/specs/2026-08-09-save-form-snapshot-replay-design.md` (P0 only)

## Global Constraints

- Soft-fail = **A2**: `ok: false`, `confirmed=0` / failed WS step; batch continues.
- Only **unsafe / container_not_found** stop aborting; userAbort, verify transport timeout, Type B heal failure still abort.
- Never mutate (delete steps / update snapshot / heal) on unsafe branch.
- Do **not** change `JS_VERIFY_FORM_STRUCTURE` / safety thresholds (P1).
- Do **not** treat unsafe as success.
- CHANGELOG required (`src/services/`); Python 同步提示：无.
- TDD: characterization fail first.

## File map

| File | Role |
|------|------|
| `src/services/trajectory/form-structure-heal.js` | unsafe return `aborted: false` |
| `src/services/trajectory/replay-batch-runner.js` | `!ok && !aborted` → failedStepIds + continue |
| `scripts/characterization/characterize-form-snapshot-trigger.mjs` | P0 cues |
| `CHANGELOG.md` / backlog / spec | Docs |

---

### Task 1: Characterization + heal `aborted: false`

**Files:**
- Modify: `scripts/characterization/characterize-form-snapshot-trigger.mjs`
- Modify: `src/services/trajectory/form-structure-heal.js` (unsafe return ~line 258)
- Test: `node scripts/characterization/characterize-form-snapshot-trigger.mjs`

**Interfaces:**
- Consumes: existing `assessFormStructureDiffSafety` + unsafe branch in `handleFormStructureCheckpoint`
- Produces: unsafe path returns `{ ok: false, aborted: false, error, results, healed }`

- [x] **Step 1: Extend characterization (fail first)**

After existing form-structure assertions in `characterize-form-snapshot-trigger.mjs`, add:

```javascript
const fsh = readFileSync(path.join(root, 'src/services/trajectory/form-structure-heal.js'), 'utf-8');
// Locate unsafe return block: after assessFormStructureDiffSafety / safety.unsafe
assert(
  /safety\.unsafe[\s\S]{0,800}?aborted:\s*false/.test(fsh)
  || /FORM_STRUCTURE_UNSAFE_CONTINUE/.test(fsh),
  'unsafe form-structure path returns aborted: false (P0 continue)',
);
assert(
  !/if \(safety\.unsafe\) \{[\s\S]{0,600}?return \{ ok: false, aborted: true/.test(fsh),
  'unsafe path must not return aborted: true',
);

const runner = readFileSync(
  path.join(root, 'src/services/trajectory/replay-batch-runner.js'),
  'utf-8',
);
assert(
  /!typeB\.ok\s*&&\s*!typeB\.aborted/.test(runner)
  || /FORM_STRUCTURE_SOFT_FAIL_CONTINUE/.test(runner),
  'runner continues on Type B soft-fail (!ok && !aborted)',
);
```

(If `fsh` is already declared earlier in the file, reuse that binding — do not double-declare.)

- [x] **Step 2: Run — expect FAIL**

```powershell
node scripts/characterization/characterize-form-snapshot-trigger.mjs
```

Expected: FAIL on `aborted: false` and/or runner soft-fail cue.

- [x] **Step 3: Fix heal unsafe return**

In `form-structure-heal.js`, change the unsafe return only:

```javascript
  if (safety.unsafe) {
    // ... existing markStepReplayFailed + emitReplay failed unchanged ...
    /* FORM_STRUCTURE_UNSAFE_CONTINUE */
    return { ok: false, aborted: false, error: msg, results, healed };
  }
```

Do **not** change the catch block that returns `aborted: true` on transport errors. Do not change heal-failure returns.

- [x] **Step 4: Fix runner soft-fail continue**

In `replay-batch-runner.js`, replace the post-`typeB.aborted` success-only block with:

```javascript
        if (typeB.aborted) {
          // unchanged finish path
        }
        /* FORM_STRUCTURE_SOFT_FAIL_CONTINUE */
        if (!typeB.ok && !typeB.aborted) {
          if (stepId != null) failedStepIds.push(stepId);
          allResults.push(...typeB.results);
          if (typeB.healed) healed.push(...typeB.healed);
          continue;
        }
        if (typeB.ok) successCount += 1;
        allResults.push(...typeB.results);
        if (typeB.healed) healed.push(...typeB.healed);
        continue;
```

Remove any duplicate `allResults` / `continue` that the old code had immediately after `if (typeB.ok)`.

- [x] **Step 5: Run — expect PASS**

```powershell
node scripts/characterization/characterize-form-snapshot-trigger.mjs
```

Expected: `All form-snapshot trigger characterizations passed.`

- [x] **Step 6: Commit**

```bash
git add src/services/trajectory/form-structure-heal.js src/services/trajectory/replay-batch-runner.js scripts/characterization/characterize-form-snapshot-trigger.mjs
git commit -m "$(cat <<'EOF'
fix: form-structure unsafe checkpoint fails step but continues replay

EOF
)"
```

---

### Task 2: Docs — CHANGELOG / backlog / spec P0

**Files:**
- Modify: `CHANGELOG.md` `[Unreleased]`
- Modify: `docs/superpowers/backlog-visible-editable-controls.md`
- Modify: `docs/superpowers/specs/2026-08-09-save-form-snapshot-replay-design.md`
- This plan (checkboxes when implementing)

- [x] **Step 1: CHANGELOG**

```markdown
- **T10-P0:** `save_form_snapshot` form-structure unsafe / `container_not_found` marks step failed (`confirmed=0`) but does not abort the replay batch.
  - 影响范围: `src/services/trajectory/form-structure-heal.js`, `replay-batch-runner.js`
  - Python 同步提示：无
```

- [x] **Step 2: Backlog**

- T10 → **P0 已实施** / **P1 未做**
- 推荐下一刀 → T10-P1 或 T5 / T1r

- [x] **Step 3: Spec status**

`**Status:** Implemented P0 — plan at docs/superpowers/plans/2026-08-09-save-form-snapshot-replay-p0.md` (P1 still pending)

- [x] **Step 4: Commit (force-add docs if needed)**

```bash
git add CHANGELOG.md
git add -f docs/superpowers/backlog-visible-editable-controls.md docs/superpowers/specs/2026-08-09-save-form-snapshot-replay-design.md docs/superpowers/plans/2026-08-09-save-form-snapshot-replay-p0.md
git commit -m "$(cat <<'EOF'
docs: CHANGELOG/backlog for T10-P0 form-structure soft-fail

EOF
)"
```

---

## Out of scope

- T10-P1 verify Source A+B alignment
- Relaxing safety thresholds
- Product UI soft-fail copy
- Changing heal-failure / timeout abort behavior

## Spec coverage (self-review)

| Spec P0 requirement | Task |
|---------------------|------|
| unsafe → aborted false | Task 1 |
| confirmed=0 / failed emit | Task 1 (unchanged markStepReplayFailed) |
| runner continue | Task 1 |
| no mutate on unsafe | Task 1 (branch unchanged aside from aborted flag) |
| char cues | Task 1 |
| docs / P1 still later | Task 2 |
| P1 verify not in this plan | Out of scope |
