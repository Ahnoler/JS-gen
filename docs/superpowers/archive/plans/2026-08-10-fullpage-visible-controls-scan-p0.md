# Full-page L2 + dynamic L1 scan (P0) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform product scan so `scan_editable_summary` (and shared JS) collect a full-page L2 pool of visible operable controls (incl. shell), discover L1 regions via feature cards + rules, assign controls to regions — without using containers as admission gates.

**Architecture:** Extract MCP-inspired pipeline inside `scan_form.py`: (1) L2 collectors for taxonomy kinds across `document`, (2) L1a/b candidate + feature cards, (3) rule classify, (4) assign. Wire `mode:'fullpage'` (or extend `multi`) for `scan_editable_summary` only in P0; keep legacy A/B/C paths callable until P1 rebase. Characterization-first.

**Tech Stack:** `scripts/controller/actions/js_snippets/scan_form.py`, `_form.py` `scan_editable_summary`, characterization scripts, backlog/spec.

**Spec:** `docs/superpowers/specs/2026-08-10-fullpage-visible-controls-scan-design.md`

## Global Constraints

- Algorithm **B**: L2 admission = visibility + taxonomy; never require `.el-form-item` / `.el-table` to exist in pool.
- Shell (top/left nav) **in** inventory.
- No auto-fill from summary; do not write `task_list` in `scan_editable_summary`.
- Dynamic L1 P0 = feature cards + **rules only** (no LLM in P0).
- TDD: characterization fail → implement → green.
- Prefer additive `mode:'fullpage'` so existing `multi` / default scan do not regress until P1.
- Commit only if user asks.

## How we 改造 (current → target)

| Today | P0 target |
|-------|-----------|
| A/B/C each query inside form / `.el-table` / button sels | Shared **L2** full-page detectors; A/B/C become **projections** (P1 full rebase; P0 summary uses L2+assign) |
| `mode:'multi'` merges overlays but **strips shell** | `mode:'fullpage'` includes shell + main + overlays |
| Single `container` string | `regions[]` feature cards + per-control `region` / `region_role` |
| Unknown wrappers → invisible to labeling | L1 candidate + `custom:`/`other` + features kept |

```text
JS_SCAN_FORM_FIELDS opts.mode === 'fullpage'
  → collectL2(document)
  → discoverL1Candidates(document) → featureCards → ruleClassify
  → assign(l2, regions)
  → return { scope, regions, fields, buttons, ... }
scan_editable_summary → evaluate mode fullpage → summarize (incl. region on entries)
```

## File map

| File | Role |
|------|------|
| `scripts/controller/actions/js_snippets/scan_form.py` | Add L2/L1 helpers + `fullpage` branch; markers for char |
| `scripts/controller/actions/_form.py` | `scan_editable_summary` pass `mode:'fullpage'`; shape summary with regions |
| `scripts/characterization/characterize-scan-editable-summary.py` | P0 cues + wiring |
| `scripts/characterization/characterize-form-scan-control-first.py` | L2 no-gate cues if needed |
| `docs/superpowers/specs/2026-08-10-fullpage-visible-controls-scan-design.md` | Tick success criteria when done |
| `docs/superpowers/backlog-visible-editable-controls.md` | Mark P0 progress / 推荐下一刀 |

---

### Task 1: Characterization — fullpage L2 + L1 markers

**Files:**
- Modify: `scripts/characterization/characterize-scan-editable-summary.py`
- Test: same

**Interfaces:**
- Consumes: `JS_SCAN_FORM_FIELDS` source string
- Produces: failing asserts until implementation lands

- [ ] **Step 1: Add tests**

```python
def test_fullpage_l2_l1_cues() -> None:
    from scripts.controller.actions._js_snippets import JS_SCAN_FORM_FIELDS
    js = JS_SCAN_FORM_FIELDS
    assert_true("FULLPAGE_L2_POOL" in js or "mode === 'fullpage'" in js or "mode=='fullpage'" in js, "fullpage mode")
    assert_true("L2_ADMIT" in js or "collectL2" in js, "L2 collector cue")
    assert_true("L1_FEATURE_CARD" in js or "featureCard" in js, "L1 feature card cue")
    assert_true("ASSIGN_L2_TO_L1" in js or "assignRegion" in js, "assign cue")
    # L2 must not require form-item for admission (comment or code path marker)
    assert_true("L2_NO_CONTAINER_GATE" in js, "explicit no-gate marker")
```

Also assert `_form.py` `scan_editable_summary` uses `fullpage` (or documents fallback).

- [ ] **Step 2: Run — expect FAIL**

```powershell
$env:PYTHONPATH="."
python scripts/characterization/characterize-scan-editable-summary.py
```

- [ ] **Step 3: Stop** — implement in Task 2

---

### Task 2: JS — L2 pool + L1 feature cards + assign (`fullpage`)

**Files:**
- Modify: `scripts/controller/actions/js_snippets/scan_form.py`

**Interfaces:**
- Consumes: existing `isVisible`, kind detectors, button keywords
- Produces: when `opts.mode === 'fullpage'`, JSON with `fields` (each may include `region`, `region_role`), `buttons`, `regions` (feature cards + role), `scope: 'fullpage'`

- [ ] **Step 1: Implement L2 collectors**

Markers: `FULLPAGE_L2_POOL`, `L2_ADMIT`, `L2_NO_CONTAINER_GATE`.  
Collect input/select/date/radio/checkbox/button/icon/tree/menu_item from `document` with visibility; dedupe; name from label/aria/text; include shell.

- [ ] **Step 2: Implement L1a/b + rule classify**

Markers: `L1_FEATURE_CARD`. Candidates: `header`/`banner`, `aside`/`nav`, `.el-dialog`/drawer, `.el-table` hosts, `.el-collapse-item`, large `main`/`.app-main`, `tssc-multiple-table-content`. Feature card fields: classTokens, title, band (top/side/center), childKindCounts, flags. Rules map to seed roles or `other`/`custom:tssc-table`.

- [ ] **Step 3: Assign**

Marker: `ASSIGN_L2_TO_L1`. Ancestry into candidate root else geometry else `page`/`other`.

- [ ] **Step 4: Branch in `JS_SCAN_FORM_FIELDS`**

If `fullpage`, return new shape; else existing multi/default unchanged.

- [ ] **Step 5: Re-run characterization — expect PASS for Task 1 cues**

---

### Task 3: Wire `scan_editable_summary` + summary shape

**Files:**
- Modify: `scripts/controller/actions/_form.py` (`scan_editable_summary`)
- Modify: characterization wiring asserts

**Interfaces:**
- Consumes: `JS_SCAN_FORM_FIELDS` fullpage result
- Produces: summary JSON including `scope`, `regions` (truncated), `pending_labels` / `buttons` with optional `region`; still **no** `task_list` write

- [ ] **Step 1: Pass `{'mode': 'fullpage'}`** (replace or beside `multi`)
- [ ] **Step 2: Map fields/buttons into existing summary keys; add `regions` capped list**
- [ ] **Step 3: Char assert `_form.py` contains `fullpage`**
- [ ] **Step 4: Run** `characterize-scan-editable-summary.py` + `characterize-form-scan-control-first.py`

---

### Task 4: Docs + optional live check

**Files:**
- Modify: spec success checkboxes; backlog 推荐下一刀 (P0 done → P1 rebase A/B/C)

- [ ] **Step 1: Update backlog / spec status**
- [ ] **Step 2 (optional):** On modify-mode 对公评级 via browser MCP, call summary path or inject JS — confirm table cell select + one shell menu_item appear
- [ ] **Step 3: User-facing summary of 改造**

**Done when:** P0 success criteria in spec checked; legacy `multi` still green on old chars.

---

## Out of scope (later)

- P1: rebase `scan_form_fields` / assistant A/B/C onto L2  
- P1: LLM L1 classify  
- P2: icon noise filter, vision  

## Execution handoff

Plan: `docs/superpowers/plans/2026-08-10-fullpage-visible-controls-scan-p0.md`  
After user says execute → `executing-plans` or `subagent-driven-development` from Task 1.
