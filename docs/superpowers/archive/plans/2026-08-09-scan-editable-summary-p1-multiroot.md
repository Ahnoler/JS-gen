# T4-P1 multi-root `scan_editable_summary` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `scan_editable_summary` scan **all visible overlays ∪ main content (sans shell)** in one pass, merge/dedupe by `xpath_smart`, while keeping default `JS_SCAN_FORM_FIELDS` callers unchanged.

**Architecture:** Extend `JS_SCAN_FORM_FIELDS` with optional 3rd arg `{ mode: 'multi' }`. When set, collect root set R (visible dialog/message-box/drawer; else `.el-main` / content host, not `.el-aside`/`.el-menu`), run Source A/B/C per root with shared xpath dedupe, return one JSON. Action passes `mode:'multi'`. No store writes / no autofill.

**Tech Stack:** `scripts/controller/actions/js_snippets/scan_form.py`, `_form.py`, characterization, CHANGELOG/backlog/spec.

**Spec:** `docs/superpowers/specs/2026-08-09-scan-editable-summary-design.md` (§ Architecture root set R; Phasing P1)

## Global Constraints

- Do **not** change default behavior when 3rd arg absent (existing `scan_form_fields` / assistant paths).
- Never autofill; never write `task_list` / `_scan_fields`.
- Shell excluded from main root (prefer `.el-main`; if fallback `document`/`body`, skip querying inside `.el-aside` / `.el-menu` when collecting items — or prefer `.el-main` only).
- Buttons remain `{text, section}` via `build_editable_summary`.
- TDD characterization; commit scripts + docs notes.

## File map

| File | Role |
|------|------|
| `js_snippets/scan_form.py` | Optional `mode:'multi'` root set + per-root scan merge |
| `_form.py` | `scan_editable_summary` passes multi mode |
| `characterize-scan-editable-summary.py` | Assert multi cues; drop/replace P0 single-root deferral gate |
| `CHANGELOG.md` / backlog / spec | P1 Implemented |

---

### Task 1: Characterization red for multi-root

**Files:** `scripts/characterization/characterize-scan-editable-summary.py`

- [ ] Assert `JS_SCAN_FORM_FIELDS` source accepts 3rd arg / `mode` / `multi` cue
- [ ] Assert `scan_editable_summary` body passes multi mode (not bare `[True, keywords]` only)
- [ ] Replace `test_single_root_p1_deferral` with assert that P1 multi is wired (no “deferred to T4-P1” comment as the only story)
- [ ] Run — expect fail
- [ ] Commit: `test: characterize scan_editable_summary multi-root (T4-P1 red)`

---

### Task 2: JS multi-root in `JS_SCAN_FORM_FIELDS`

**Files:** `scripts/controller/actions/js_snippets/scan_form.py`

Signature: `async ([quick, buttonKeywords, opts]) => { ... }`

When `opts && opts.mode === 'multi'`:
1. Build roots = all `wrapOk` `.el-dialog, .el-message-box, .el-drawer`
2. If empty → `[.el-main]` if present else content host (not aside-only)
3. For each root, run existing A/B/C collection with that root as `container`
4. Shared `seenXpaths` / field+button merge across roots
5. `container` id = topmost overlay identity (same as today’s identify) or `main`

When `opts` absent/null: **identical** to current single `JS_GET_CONTAINER` behavior.

- [ ] Implement; keep default path byte-behavior compatible
- [ ] Characterization JS asserts pass
- [ ] Commit: `feat: JS_SCAN_FORM_FIELDS mode=multi root set`

---

### Task 3: Wire action + docs

**Files:** `_form.py`, characterization, CHANGELOG, backlog, spec

- [ ] `scan_editable_summary` → `evaluate(JS_SCAN_FORM_FIELDS, [True, keywords, {'mode': 'multi'}])`
- [ ] Update comments; full characterize green
- [ ] Regression: form-scan-control-first + control-ops-closed-loop
- [ ] CHANGELOG Unreleased; backlog T4-P1 done; spec note P1 Implemented
- [ ] Commit: `feat: scan_editable_summary multi-root (T4-P1)`

---

## Out of scope

- T4-P2 memory Fact Pack
- T4-P3 T5/T6/T8
- T4-P4 MCP a11y
- Changing global `JS_GET_CONTAINER` for other actions
