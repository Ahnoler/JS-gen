# T10-P1 form-structure verify Source A+B Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make live form-structure verify collect the same label surface as recording snapshots — Source A (`.el-form-item`) **plus** Source B (`el-table` editable cells with `row#N` / `row#N|col` display names) — so false count-collapse unsafes drop without relaxing safety thresholds.

**Architecture:** Extend Agent `JS_VERIFY_FORM_STRUCTURE` (`scripts/controller/actions/js_snippets/misc.py`) to append Source B labels using the same naming rules as `SCAN_SOURCE_B_EL_TABLE` in `scan_form.py`. Mirror into CTRL `verifyFormStructure` (`src/ctrl-actions/structure.js`). Keep container scoping and `assessFormStructureDiffSafety` unchanged. Dual-copy OK this cut.

**Tech Stack:** Python JS string snippets; CTRL template string; characterization scripts.

**Spec:** `docs/superpowers/specs/2026-08-09-save-form-snapshot-replay-design.md` § P1

## Global Constraints

- P1 only: verify label collection ≡ record Source A+B; **do not** widen safety thresholds.
- Do not change T10-P0 soft-fail / abort behavior.
- Dual-copy Agent + CTRL; extract shared helper is out of scope.
- Source B naming must match scan: `getRowLeadingText` → else `row#N` (`domRowIndex` among non-pager body rows); `buildTableDisplayName` for multi-control rows.
- Table-sourced **added** labels: treat as **optional** unless an `.el-form-item` with that label is found (existing required detection).
- Deduplicate `actualLabels` preserving first-seen order.
- TDD characterization first; CHANGELOG with Python 同步提示：无.

## File map

| File | Role |
|------|------|
| `scripts/controller/actions/js_snippets/misc.py` | `JS_VERIFY_FORM_STRUCTURE` + Source B labels |
| `src/ctrl-actions/structure.js` | CTRL `verifyFormStructure` parity |
| `scripts/characterization/characterize-verify-form-structure.mjs` (new) or extend form-snapshot-trigger | P1 cues |
| `CHANGELOG.md` / backlog / spec | Docs |

---

### Task 1: Characterization red + Agent `JS_VERIFY_FORM_STRUCTURE` Source B

**Files:**
- Create or modify: `scripts/characterization/characterize-verify-form-structure.mjs` (preferred dedicated; may extend `characterize-form-snapshot-trigger.mjs`)
- Modify: `scripts/controller/actions/js_snippets/misc.py` (`JS_VERIFY_FORM_STRUCTURE`)
- Test: characterization with `--agent-only` for mid-slice green

**Interfaces:**
- Consumes: Source B naming from `scan_form.py` (`SOURCE_B_EMPTY_LEADING`, leading text, `buildTableDisplayName`, table controls)
- Produces: `actualLabels` = form-item labels ∪ table display names under same `root`

- [x] **Step 1: Write failing characterization**

```javascript
const misc = readFileSync(path.join(root, 'scripts/controller/actions/js_snippets/misc.py'), 'utf-8');
assert(/JS_VERIFY_FORM_STRUCTURE/.test(misc), 'JS_VERIFY_FORM_STRUCTURE defined');
assert(
  /VERIFY_SOURCE_B_EL_TABLE/.test(misc),
  'JS_VERIFY_FORM_STRUCTURE includes VERIFY_SOURCE_B_EL_TABLE marker',
);
assert(
  /row#/.test(misc) && (/SOURCE_B_EMPTY_LEADING/.test(misc) || /domRowIndex/.test(misc) || /getRowLeadingText/.test(misc)),
  'verify Source B uses row# / leading-text naming cues',
);
assert(
  /buildTableDisplayName/.test(misc) || (/colHeader/.test(misc) && /\|#/.test(misc)),
  'verify Source B multi-control display name cue',
);

const ctrl = readFileSync(path.join(root, 'src/ctrl-actions/structure.js'), 'utf-8');
assert(
  /VERIFY_SOURCE_B_EL_TABLE/.test(ctrl),
  'CTRL verifyFormStructure includes VERIFY_SOURCE_B_EL_TABLE',
);
```

Support `--agent-only` to skip CTRL assert until Task 2.

- [x] **Step 2: Run — expect FAIL**

```powershell
node scripts/characterization/characterize-verify-form-structure.mjs --agent-only
```

Expected: FAIL missing `VERIFY_SOURCE_B_EL_TABLE` in `misc.py`.

- [x] **Step 3: Implement Source B in `JS_VERIFY_FORM_STRUCTURE`**

After `.el-form-item` label loop (before missing/added classification):

1. Marker `/* VERIFY_SOURCE_B_EL_TABLE */`
2. Inline minimal copies of scan helpers: `normalizeControlText`, `getRowLeadingText`, `getColumnHeader`, `isPagerRow`, `collectTableControls` / cell classify, `buildTableDisplayName` — match `scan_form.py` semantics (including empty-leading `row#` + `domRowIndex`).
3. Walk `root.querySelectorAll('.el-table')`; for `scopeMode === 'main'`, skip tables inside visible drawer/dialog/message-box (`wrapOk`), same spirit as form-item filter.
4. Push display names into `actualLabels`; then dedupe preserving order.
5. Keep JSON report shape; do not edit `assessFormStructureDiffSafety`.

Escape carefully inside the Python `'''` string (follow existing `scan_form.py` / `misc.py` patterns).

- [x] **Step 4: Run — expect PASS (agent-only)**

```powershell
node scripts/characterization/characterize-verify-form-structure.mjs --agent-only
```

Expected: agent cues OK.

- [x] **Step 5: Commit**

```bash
git add scripts/controller/actions/js_snippets/misc.py scripts/characterization/characterize-verify-form-structure.mjs
git commit -m "$(cat <<'EOF'
feat: form-structure verify collects Source B table labels

EOF
)"
```

---

### Task 2: CTRL `verifyFormStructure` Source B parity

**Files:**
- Modify: `src/ctrl-actions/structure.js`
- Modify: characterization (full run)
- Test: full char + `node scripts/characterization/characterize-ctrl.mjs`

**Interfaces:**
- Consumes: Task 1 Agent Source B behavior / markers
- Produces: CTRL with `VERIFY_SOURCE_B_EL_TABLE` and same naming cues

- [x] **Step 1: Run full char — expect FAIL on CTRL**

```powershell
node scripts/characterization/characterize-verify-form-structure.mjs
```

Expected: FAIL CTRL marker until Step 2.

- [x] **Step 2: Port Source B block into `structure.js`**

Same algorithm/markers as Agent after form-item labels; dedupe; preserve CTRL template indentation for `characterize-ctrl.mjs`.

- [x] **Step 3: Run — expect PASS**

```powershell
node scripts/characterization/characterize-verify-form-structure.mjs
node scripts/characterization/characterize-ctrl.mjs
node scripts/characterization/characterize-form-snapshot-trigger.mjs
```

Expected: all OK.

- [x] **Step 4: Commit**

```bash
git add src/ctrl-actions/structure.js scripts/characterization/characterize-verify-form-structure.mjs
git commit -m "$(cat <<'EOF'
feat: CTRL verifyFormStructure Source B parity with Agent

EOF
)"
```

---

### Task 3: Docs — CHANGELOG / backlog / spec P1

**Files:**
- Modify: `CHANGELOG.md`
- Modify: `docs/superpowers/backlog-visible-editable-controls.md`
- Modify: `docs/superpowers/specs/2026-08-09-save-form-snapshot-replay-design.md`
- This plan (checkboxes when implementing)

- [x] **Step 1: CHANGELOG**

```markdown
- **T10-P1:** `JS_VERIFY_FORM_STRUCTURE` / CTRL `verifyFormStructure` collect Source B `el-table` labels (same `row#N` naming as scan) so snapshot verify matches recording surface.
  - 影响范围: `scripts/controller/actions/js_snippets/misc.py`, `src/ctrl-actions/structure.js`
  - Python 同步提示：无
```

- [x] **Step 2: Backlog** — T10 **P0+P1 已实施**; 推荐下一刀 → T5 / T1r / T4-P4

- [x] **Step 3: Spec** — Status `Implemented P0+P1`; link this plan

- [x] **Step 4: Commit (force-add docs if needed)**

```bash
git add CHANGELOG.md
git add -f docs/superpowers/backlog-visible-editable-controls.md docs/superpowers/specs/2026-08-09-save-form-snapshot-replay-design.md docs/superpowers/plans/2026-08-09-save-form-snapshot-replay-p1.md
git commit -m "$(cat <<'EOF'
docs: CHANGELOG/backlog for T10-P1 verify Source B

EOF
)"
```

---

## Out of scope

- Relaxing `assessFormStructureDiffSafety` ratios
- Changing T10-P0 abort/soft-fail semantics
- Extracting shared scan/verify JS module
- T5 non-`el-table` grids
- Wet CDP proof (optional later)

## Spec coverage (self-review)

| Spec P1 requirement | Task |
|---------------------|------|
| Actual labels Source A+B | Tasks 1–2 |
| Keep container scoping | Tasks 1–2 |
| Keep safety guards | No threshold edits |
| Agent + CTRL parity | Task 1 + Task 2 |
| Docs / backlog | Task 3 |
